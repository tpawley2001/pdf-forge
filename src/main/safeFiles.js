/**
 * safeFiles.js - Saves that can't leave a half-written PDF behind, plus the
 * autosave store used for crash recovery.
 */
const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Write to a temporary file beside the target, flush it, then swap it in, so
 * a crash or full disk mid-save never truncates the existing file. If the
 * swap is refused (Windows: the file is open in another program), fall back
 * to copying over the target.
 */
async function writeFileAtomic(target, data) {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const fh = await fs.promises.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await fs.promises.rename(tmp, target);
  } catch (err) {
    if (!['EPERM', 'EACCES', 'EBUSY', 'EXDEV'].includes(err.code)) {
      await fs.promises.unlink(tmp).catch(() => {});
      throw err;
    }
    try {
      await fs.promises.copyFile(tmp, target);
    } finally {
      await fs.promises.unlink(tmp).catch(() => {});
    }
  }
}

// ── Unsaved changes prompt ──────────────────────────────────────────────────

/** @returns {Promise<'save'|'discard'|'cancel'>} */
async function promptUnsaved(win, fileName, reason = 'close') {
  const name = fileName || 'Untitled.pdf';
  const action = reason === 'open' ? 'opening another document' : 'closing';
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: `Save changes to "${name}" before ${action}?`,
    detail: "Your changes will be lost if you don't save them.",
  });
  return ['save', 'discard', 'cancel'][response];
}

// ── Crash recovery ──────────────────────────────────────────────────────────
// Each running instance autosaves to recovery/<pid>.pdf (+ .json metadata).
// Files left behind by a process that is no longer running are offered for
// recovery on the next start.

function recoveryDir() {
  return path.join(app.getPath('userData'), 'recovery');
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

let wroteRecovery = false;

async function writeRecovery(dataB64, meta = {}) {
  wroteRecovery = true;
  const dir = recoveryDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const base = path.join(dir, String(process.pid));
  await writeFileAtomic(`${base}.pdf`, Buffer.from(dataB64, 'base64'));
  const info = {
    fileName: String(meta.fileName || 'Untitled.pdf'),
    filePath: meta.filePath ? String(meta.filePath) : null,
    savedAt: new Date().toISOString(),
  };
  await writeFileAtomic(`${base}.json`, JSON.stringify(info));
}

async function clearRecovery(id = String(process.pid)) {
  if (!/^\d+$/.test(String(id))) return;
  const base = path.join(recoveryDir(), String(id));
  await fs.promises.unlink(`${base}.pdf`).catch(() => {});
  await fs.promises.unlink(`${base}.json`).catch(() => {});
}

/** Autosaves left by instances that are no longer running, newest first. */
async function listRecoverable() {
  let names;
  try { names = await fs.promises.readdir(recoveryDir()); } catch { return []; }
  const out = [];
  for (const n of names) {
    const m = /^(\d+)\.json$/.exec(n);
    if (!m) continue;
    const pid = Number(m[1]);
    // A leftover can carry our pid if the OS reused it; it's ours once we've written.
    if (pid === process.pid ? wroteRecovery : isAlive(pid)) continue;
    try {
      const info = JSON.parse(await fs.promises.readFile(path.join(recoveryDir(), n), 'utf8'));
      const stat = await fs.promises.stat(path.join(recoveryDir(), `${pid}.pdf`));
      out.push({ id: String(pid), fileName: info.fileName, filePath: info.filePath, savedAt: info.savedAt, size: stat.size });
    } catch {
      await clearRecovery(pid);   // half-written leftovers
    }
  }
  return out.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

async function readRecovery(id) {
  if (!/^\d+$/.test(String(id))) throw new Error('Bad recovery id');
  const base = path.join(recoveryDir(), String(id));
  const info = JSON.parse(await fs.promises.readFile(`${base}.json`, 'utf8'));
  const data = (await fs.promises.readFile(`${base}.pdf`)).toString('base64');
  return { ...info, data };
}

module.exports = { writeFileAtomic, promptUnsaved, writeRecovery, clearRecovery, listRecoverable, readRecovery };
