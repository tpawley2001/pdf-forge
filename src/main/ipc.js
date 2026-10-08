const { ipcMain, dialog, app } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { VERSION } = require('./version');
// Packaged builds ship without node_modules: use the webpack bundle there
const signing = app.isPackaged ? require('../../dist-main/signing.js') : require('./signing');
const pdfTools = app.isPackaged ? require('../../dist-main/pdfTools.js') : require('./pdfTools');

const UPDATE_HOSTS = [
  'http://pdf-update.local:3000',
  'http://100.64.0.1:3000',
  'http://192.168.1.100:3000',
];

const UPDATE_TOKEN = process.env.PDF_FORGE_UPDATE_TOKEN || '';

const allowedPaths = new Set();

function registerIpcHandlers(getMainWindow) {

  // PDFium wasm for the renderer: file:// pages can't fetch() under the CSP,
  // so the main process reads this one fixed asset (works inside app.asar).
  ipcMain.handle('asset:pdfiumWasm', async () => (
    fs.promises.readFile(path.join(__dirname, '../../dist-renderer/pdfium/pdfium.wasm'))
  ));

  ipcMain.handle('dialog:openFile', async () => {
    const win = getMainWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      title: 'Open PDF',
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }, { name: 'All Files', extensions: ['*'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const filePath = result.filePaths[0];
    try {
      const buf = await fs.promises.readFile(filePath);
      allowedPaths.add(path.resolve(filePath));
      return { canceled: false, filePath, fileName: path.basename(filePath), data: buf.toString('base64') };
    } catch (err) {
      return { canceled: false, error: err.message };
    }
  });

  ipcMain.handle('file:read', async (_event, filePath) => {
    if (!filePath) return { success: false, error: 'No path' };
    const resolved = path.resolve(filePath);
    if (!allowedPaths.has(resolved)) return { success: false, error: 'Path not authorized' };
    try {
      const buf = await fs.promises.readFile(resolved);
      return { success: true, data: buf.toString('base64'), fileName: path.basename(resolved), fileSize: buf.length };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('file:write', async (_event, filePath, dataB64) => {
    if (!filePath) return { success: false, error: 'No path' };
    const resolved = path.resolve(filePath);
    if (!allowedPaths.has(resolved)) return { success: false, error: 'Path not authorized' };
    try {
      await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
      await fs.promises.writeFile(resolved, Buffer.from(dataB64, 'base64'));
      return { success: true, filePath: resolved };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('dialog:saveFile', async (_event, opts = {}) => {
    const win = getMainWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showSaveDialog(win, {
      title: 'Save PDF As',
      defaultPath: opts.defaultPath || 'document.pdf',
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    allowedPaths.add(path.resolve(result.filePath));
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('menu:saveNow', async (_event, dataB64, filePath) => {
    if (!filePath) return { success: false, error: 'No path' };
    const resolved = path.resolve(filePath);
    if (!allowedPaths.has(resolved)) return { success: false, error: 'Path not authorized' };
    try {
      await fs.promises.writeFile(resolved, Buffer.from(dataB64, 'base64'));
      return { success: true, filePath: resolved };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('print:pdf', async () => {
    const win = getMainWindow();
    if (!win) return { success: false };
    win.webContents.print({ silent: false, printBackground: true }, () => {});
    return { success: true };
  });

  ipcMain.handle('file:validateDrop', async (_event, filePath) => {
    if (!filePath) return { valid: false };
    if (path.extname(filePath).toLowerCase() !== '.pdf') return { valid: false };
    try {
      const buf = Buffer.alloc(5);
      const fd = await fs.promises.open(filePath, 'r');
      await fd.read(buf, 0, 5, 0);
      await fd.close();
      if (buf.toString('ascii') !== '%PDF-') return { valid: false, reason: 'Not a valid PDF' };
      allowedPaths.add(path.resolve(filePath));
      return { valid: true };
    } catch (err) { return { valid: false, reason: err.message }; }
  });

  // ── Digital signatures (keys stay in the main process) ──
  const idPaths = new Set();               // Digital ID files the user picked/created
  const recentIdsFile = () => path.join(app.getPath('userData'), 'digital-ids.json');
  const loadRecentIds = async () => {
    try {
      const list = JSON.parse(await fs.promises.readFile(recentIdsFile(), 'utf8'));
      return Array.isArray(list) ? list.filter(p => typeof p === 'string') : [];
    } catch (_) { return []; }
  };
  const rememberId = async (p) => {
    const list = [p, ...(await loadRecentIds()).filter(x => x !== p)].slice(0, 8);
    await fs.promises.mkdir(path.dirname(recentIdsFile()), { recursive: true });
    await fs.promises.writeFile(recentIdsFile(), JSON.stringify(list, null, 2));
  };
  const idInfo = p => ({ path: p, fileName: path.basename(p) });

  ipcMain.handle('sign:recentIds', async () => {
    const out = [];
    for (const p of await loadRecentIds()) {
      try { await fs.promises.access(p); idPaths.add(p); out.push(idInfo(p)); } catch (_) { /* gone */ }
    }
    return out;
  });

  ipcMain.handle('sign:pickId', async () => {
    const win = getMainWindow();
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a Digital ID',
      filters: [{ name: 'Digital ID (PKCS#12)', extensions: ['p12', 'pfx'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return { canceled: true };
    const p = path.resolve(r.filePaths[0]);
    idPaths.add(p);
    return { canceled: false, ...idInfo(p) };
  });

  ipcMain.handle('sign:readId', async (_e, idPath, password) => {
    const p = path.resolve(String(idPath || ''));
    if (!idPaths.has(p)) return { success: false, error: 'Digital ID not authorized' };
    try {
      const summary = signing.readDigitalId(await fs.promises.readFile(p), password);
      await rememberId(p);
      return { success: true, id: summary };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('sign:createId', async (_e, opts = {}) => {
    const win = getMainWindow();
    try {
      const bytes = signing.createDigitalId(opts);
      const safe = String(opts.name || 'DigitalID').replace(/[^\w.-]+/g, '_');
      const r = await dialog.showSaveDialog(win, {
        title: 'Save your new Digital ID',
        defaultPath: path.join(app.getPath('documents'), `${safe}.pfx`),
        filters: [{ name: 'Digital ID (PKCS#12)', extensions: ['pfx', 'p12'] }],
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      const p = path.resolve(r.filePath);
      await fs.promises.writeFile(p, bytes, { mode: 0o600 });
      idPaths.add(p);
      await rememberId(p);
      return { success: true, ...idInfo(p), id: signing.readDigitalId(bytes, opts.password) };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // Sign, then write straight to disk: any later rewrite would break the signature
  ipcMain.handle('sign:signAndSave', async (_e, o = {}) => {
    const win = getMainWindow();
    const p = path.resolve(String(o.idPath || ''));
    if (!idPaths.has(p)) return { success: false, error: 'Digital ID not authorized' };
    // E2E tests can't click native dialogs; this env var is only set by the harness
    const r = process.env.PDF_FORGE_TEST_SIGN_OUT
      ? { canceled: false, filePath: process.env.PDF_FORGE_TEST_SIGN_OUT }
      : await dialog.showSaveDialog(win, {
        title: 'Save Signed PDF',
        defaultPath: o.defaultPath || 'signed.pdf',
        filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
      });
    if (r.canceled || !r.filePath) return { canceled: true };
    try {
      const signed = await signing.signPdf({
        pdfBytes: Buffer.from(o.pdfB64, 'base64'),
        p12Bytes: await fs.promises.readFile(p),
        password: o.password,
        reason: o.reason,
        location: o.location,
        contact: o.contact,
        appearance: o.appearance ? {
          ...o.appearance,
          imagePng: o.appearance.imagePngB64 ? Buffer.from(o.appearance.imagePngB64, 'base64') : undefined,
        } : undefined,
        tsaUrl: o.tsaUrl,
        ltv: o.ltv,
        protection: o.protection,
      });
      const out = path.resolve(r.filePath);
      await fs.promises.writeFile(out, signed);
      allowedPaths.add(out);
      return { success: true, filePath: out, fileName: path.basename(out), data: signed.toString('base64') };
    } catch (err) {
      return { success: false, error: /password|mac/i.test(err.message) ? 'Incorrect password for this Digital ID.' : err.message };
    }
  });

  // ── qpdf: repair rewrite / linearize / optimize ──
  ipcMain.handle('pdf:transform', async (_e, op, pdfB64) => {
    try {
      const r = await pdfTools.transform(op, Buffer.from(pdfB64, 'base64'));
      return { success: true, data: r.bytes.toString('base64'), before: r.before, after: r.after, warnings: r.warnings };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('sign:verify', async (_e, pdfB64) => {
    try { return { success: true, signatures: await signing.verifySignatures(Buffer.from(pdfB64, 'base64')) }; }
    catch (err) { return { success: false, error: err.message, signatures: [] }; }
  });

  // ── Auto-update ──
  let updateSource = null;
  let pendingVersion = null;
  let pendingHash = null;

  ipcMain.handle('update:check', async () => {
    for (const host of UPDATE_HOSTS) {
      try {
        const result = await fetchJSON(`${host}/api/version`);
        if (result && result.version && result.version !== VERSION) {
          updateSource = host;
          pendingVersion = result.version;
          pendingHash = result.sha256 || null;
          return { updateAvailable: true, version: result.version, releaseNotes: result.notes || '', source: host };
        }
        if (result) return { updateAvailable: false, currentVersion: VERSION, source: host };
      } catch (_) {}
    }
    return { updateAvailable: false, currentVersion: VERSION, offline: true };
  });

  ipcMain.handle('update:download', async (_event, version) => {
    if (!updateSource) return { success: false, error: 'No update source discovered' };
    if (version !== pendingVersion) return { success: false, error: 'Version mismatch' };
    const url = `${updateSource}/api/download/${encodeURIComponent(version)}`;
    try {
      const buf = await downloadFile(url, updateSource, 0);
      if (pendingHash) {
        const actual = crypto.createHash('sha256').update(buf).digest('hex');
        if (actual !== pendingHash) return { success: false, error: 'Hash verification failed' };
      }
      const downloadsDir = app.getPath('downloads');
      const savePath = path.join(downloadsDir, `pdf-forge-update-${version.replace(/[^0-9a-zA-Z._-]/g, '_')}.exe`);
      await fs.promises.writeFile(savePath, buf);
      return { success: true, path: savePath };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ── Save with custom filters (for image/text export) ──
  ipcMain.handle('dialog:saveFileAs', async (_event, opts = {}) => {
    const win = getMainWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showSaveDialog(win, {
      title: opts.title || 'Save File',
      defaultPath: opts.defaultPath || 'document',
      filters: opts.filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    allowedPaths.add(path.resolve(result.filePath));
    return { canceled: false, filePath: result.filePath };
  });

  // ── Save split parts: one dialog picks the base name, parts are numbered ──
  ipcMain.handle('dialog:saveParts', async (_event, opts = {}) => {
    const win = getMainWindow();
    const parts = Array.isArray(opts.parts) ? opts.parts : [];
    if (!win || parts.length === 0) return { canceled: true };
    const result = await dialog.showSaveDialog(win, {
      title: opts.title || 'Save Split Parts',
      defaultPath: opts.defaultPath || 'document.pdf',
      buttonLabel: 'Save Parts',
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const base = path.resolve(result.filePath).replace(/\.pdf$/i, '');
    const width = String(parts.length).length;
    const paths = parts.map((_, i) => `${base}-part${String(i + 1).padStart(width, '0')}.pdf`);
    const existing = paths.filter(p => fs.existsSync(p));
    if (existing.length) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Replace', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `${existing.length} of the ${paths.length} files already exist. Replace them?`,
        detail: existing.map(p => path.basename(p)).join('\n'),
      });
      if (response !== 0) return { canceled: true };
    }
    try {
      for (let i = 0; i < parts.length; i++) {
        await fs.promises.writeFile(paths[i], Buffer.from(parts[i], 'base64'));
      }
      return { canceled: false, success: true, paths };
    } catch (err) {
      return { canceled: false, success: false, error: err.message };
    }
  });

  // ── Open multiple PDF files (for merge) ──
  ipcMain.handle('dialog:openMultipleFiles', async () => {
    const win = getMainWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      title: 'Select PDF Files to Merge',
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }, { name: 'All Files', extensions: ['*'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const files = [];
    for (const fp of result.filePaths) {
      try {
        const buf = await fs.promises.readFile(fp);
        allowedPaths.add(path.resolve(fp));
        files.push({ filePath: fp, fileName: path.basename(fp), data: buf.toString('base64') });
      } catch (err) {
        console.error(`Failed to read ${fp}:`, err.message);
      }
    }
    return { canceled: false, files };
  });

  // ── Open image files (for Images to PDF) ──
  ipcMain.handle('dialog:openImageFiles', async () => {
    const win = getMainWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Images',
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const files = [];
    for (const fp of result.filePaths) {
      try {
        const buf = await fs.promises.readFile(fp);
        allowedPaths.add(path.resolve(fp));
        files.push({ filePath: fp, fileName: path.basename(fp), data: buf.toString('base64') });
      } catch (err) {
        console.error(`Failed to read ${fp}:`, err.message);
      }
    }
    return { canceled: false, files };
  });

  // ── App info ──
  ipcMain.handle('app:info', async () => ({ version: VERSION, name: 'PDF Forge', platform: process.platform }));
}

function addAllowedPath(p) { allowedPaths.add(path.resolve(p)); }

// ── Helpers ──
function getAuthHeaders() { return UPDATE_TOKEN ? { Authorization: `Bearer ${UPDATE_TOKEN}` } : {}; }

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 3000, headers: getAuthHeaders() }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function downloadFile(url, originalHost, depth) {
  if (depth > 3) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 30000, headers: getAuthHeaders() }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const redirectUrl = new URL(res.headers.location, url);
          if (redirectUrl.hostname !== new URL(originalHost).hostname) return reject(new Error('Redirect host blocked'));
          return downloadFile(redirectUrl.toString(), originalHost, depth + 1).then(resolve, reject);
        } catch { return reject(new Error('Invalid redirect URL')); }
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = { registerIpcHandlers, addAllowedPath };
