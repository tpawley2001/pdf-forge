const { ipcMain, dialog, app } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { VERSION } = require('./version');

const UPDATE_HOSTS = [
  'http://pdf-update.local:3000',
  'http://100.64.0.1:3000',
  'http://192.168.1.100:3000',
];

const UPDATE_TOKEN = process.env.PDF_FORGE_UPDATE_TOKEN || '';

const allowedPaths = new Set();

function registerIpcHandlers(getMainWindow) {

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
