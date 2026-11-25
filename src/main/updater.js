/**
 * updater.js — updates from GitHub Releases (tpawley2001/pdf-forge).
 *
 * check:    GET the latest release, offer it only when its version is newer than ours.
 *           At most one network check per CHECK_EVERY_MS (the last answer is cached in
 *           userData); "Check for Updates…" in the Help menu forces one.
 * download: the release's PDF-Forge-Setup-<v>.exe, redirects followed only to GitHub hosts,
 *           verified against GitHub's sha256 asset digest (or electron-builder's latest.yml
 *           sha512). No hash → no install.
 * install:  refuses while the open document has unsaved changes; otherwise starts the
 *           installer silently (it asks for admin rights) and quits; the installer
 *           restarts PDF Forge when done.
 *
 * PDF_FORGE_UPDATE_API overrides the release URL (tests); http is allowed only then.
 */
const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { VERSION } = require('./version');

const REPO = 'tpawley2001/pdf-forge';
const DEFAULT_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const API = process.env.PDF_FORGE_UPDATE_API || DEFAULT_API;
const TEST_MODE = API !== DEFAULT_API;
const ALLOWED_HOSTS = /^(api\.github\.com|github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com|[a-z0-9-]+\.githubusercontent\.com)$/i;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const UA = `PDF-Forge/${VERSION} (update check)`;

/** "1.10.0" > "1.9.3"; pre-release tags ("1.5.0-beta") sort below the release. */
function compareVersions(a, b) {
  const parse = v => {
    const [core, pre] = String(v).replace(/^v/i, '').split('-', 2);
    return { nums: core.split('.').map(n => parseInt(n, 10) || 0), pre: pre || null };
  };
  const A = parse(a), B = parse(b);
  for (let i = 0; i < Math.max(A.nums.length, B.nums.length); i++) {
    const d = (A.nums[i] || 0) - (B.nums[i] || 0);
    if (d) return Math.sign(d);
  }
  if (A.pre && !B.pre) return -1;
  if (!A.pre && B.pre) return 1;
  return 0;
}

function allowedUrl(u) {
  try {
    const url = new URL(u);
    if (TEST_MODE && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) return true;
    return url.protocol === 'https:' && ALLOWED_HOSTS.test(url.hostname);
  } catch { return false; }
}

function get(url, { json = false, timeout = 15000, accept } = {}, depth = 0) {
  if (depth > 5) return Promise.reject(new Error('Too many redirects'));
  if (!allowedUrl(url)) return Promise.reject(new Error(`Blocked update URL: ${url}`));
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const headers = { 'User-Agent': UA, Accept: accept || (json ? 'application/vnd.github+json' : 'application/octet-stream') };
    const req = mod.get(url, { timeout, headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return get(next, { json, timeout, accept }, depth + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (!json) return resolve(buf);
        try { resolve(JSON.parse(buf.toString('utf8'))); } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

/** Turn a GitHub release into what the app needs; null when it has no Windows installer. */
function describeRelease(rel) {
  if (!rel || rel.draft || rel.prerelease) return null;
  const version = String(rel.tag_name || '').replace(/^v/i, '');
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const exe = assets.find(a => /^PDF[-. ]Forge[-. ]Setup[-. ].*\.exe$/i.test(a.name));
  if (!version || !exe) return null;
  const yml = assets.find(a => a.name === 'latest.yml');
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(exe.digest || '');
  return {
    version,
    notes: String(rel.body || '').trim(),
    url: rel.html_url || `https://github.com/${REPO}/releases/tag/${rel.tag_name}`,
    asset: { name: exe.name, url: exe.browser_download_url, size: exe.size },
    sha256: digest ? digest[1].toLowerCase() : null,
    ymlUrl: yml ? yml.browser_download_url : null,
  };
}

function cachePath() { return path.join(app.getPath('userData'), 'update-check.json'); }
function readCache() { try { return JSON.parse(fs.readFileSync(cachePath(), 'utf8')); } catch { return null; } }
function writeCache(c) { try { fs.writeFileSync(cachePath(), JSON.stringify(c)); } catch (_) {} }

let latest = null;          // describeRelease() of the newest release seen this session
let downloaded = null;      // { version, path }

function result(rel, source) {
  const newer = rel && compareVersions(rel.version, VERSION) > 0;
  return newer
    ? { updateAvailable: true, version: rel.version, currentVersion: VERSION, releaseNotes: rel.notes, source, releaseUrl: rel.url }
    : { updateAvailable: false, currentVersion: VERSION, latestVersion: rel ? rel.version : null, source };
}

async function check({ force = false } = {}) {
  const cache = readCache();
  if (!force && cache && Date.now() - cache.at < CHECK_EVERY_MS && cache.api === API) {
    latest = cache.release;
    return result(latest, 'GitHub (cached)');
  }
  try {
    const rel = describeRelease(await get(API, { json: true }));
    latest = rel;
    writeCache({ at: Date.now(), api: API, release: rel });
    return result(rel, 'GitHub');
  } catch (err) {
    return { updateAvailable: false, currentVersion: VERSION, offline: true, error: err.message };
  }
}

async function expectedHash(rel) {
  if (rel.sha256) return { algo: 'sha256', value: rel.sha256, enc: 'hex' };
  if (rel.ymlUrl) {
    const yml = (await get(rel.ymlUrl, { accept: 'application/octet-stream' })).toString('utf8');
    // electron-builder latest.yml: top-level "sha512: <base64>" for the installer
    const m = /^sha512:\s*(\S+)\s*$/m.exec(yml);
    if (m) return { algo: 'sha512', value: m[1], enc: 'base64' };
  }
  return null;
}

async function download(version) {
  if (!latest || latest.version !== version) {
    const r = await check({ force: true });
    if (!latest || latest.version !== version) return { success: false, error: r.error || 'That version is no longer the latest release' };
  }
  try {
    const want = await expectedHash(latest);
    if (!want) return { success: false, error: 'The release has no checksum to verify the installer against' };
    const buf = await get(latest.asset.url, { timeout: 120000 });
    const got = crypto.createHash(want.algo).update(buf).digest(want.enc);
    if (got !== want.value) return { success: false, error: 'Downloaded installer failed the checksum check' };
    const dir = path.join(app.getPath('temp'), 'pdf-forge-update');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `PDF-Forge-Setup-${version.replace(/[^0-9a-zA-Z._-]/g, '_')}.exe`);
    await fs.promises.writeFile(file, buf);
    downloaded = { version, path: file };
    return { success: true, path: file };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * @param {() => {modified: boolean}} getDocState
 * @param {() => void} quit
 */
function install(getDocState, quit) {
  if (!downloaded || !fs.existsSync(downloaded.path)) return { success: false, error: 'Download the update first' };
  if (getDocState().modified) return { success: false, error: 'Save your document (or close it) before installing the update.' };
  if (process.platform !== 'win32') return { success: false, error: `Installer saved to ${downloaded.path}` };
  // /S = silent (UAC still asks for admin rights), --force-run = start PDF Forge again afterwards.
  const child = spawn(downloaded.path, ['/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  setTimeout(quit, 400);
  return { success: true };
}

function registerUpdater({ getDocState, quit }) {
  ipcMain.handle('update:check', (_e, opts) => check({ force: !!(opts && opts.force) }));
  ipcMain.handle('update:download', (_e, version) => download(String(version || '')));
  ipcMain.handle('update:install', () => install(getDocState, quit));
}

module.exports = { registerUpdater, check, compareVersions, describeRelease };
