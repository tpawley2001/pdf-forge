const { app, BrowserWindow, globalShortcut, screen, session, ipcMain } = require('electron');
const path = require('path');
const { setupMenu } = require('./menu');
const { registerIpcHandlers } = require('./ipc');
const { promptUnsaved, clearRecovery } = require('./safeFiles');

let mainWindow = null;
// What the renderer last reported about the open document.
let docState = { modified: false, fileName: '' };
let closeConfirmed = false;

const isDev = !app.isPackaged;

const PROD_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "font-src 'self' data:; " +
  "img-src 'self' data: blob:; " +
  "connect-src https://cdn.jsdelivr.net https://tessdata.projectnaptha.com; " +
  "worker-src 'self' blob:; " +
  "object-src 'none'; " +
  "base-uri 'none';";

function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  // Grant local-fonts permission so queryLocalFonts() works for font matching
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'local-fonts') { callback(true); return; }
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'local-fonts') return true;
    return false;
  });

  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [PROD_CSP],
        },
      });
    });
  }

  mainWindow = new BrowserWindow({
    width: Math.min(1400, screenWidth),
    height: Math.min(900, screenHeight),
    minWidth: 800,
    minHeight: 600,
    title: 'PDF Forge',
    icon: path.join(__dirname, '../../assets/icon.ico'),
    backgroundColor: '#1e1e2e',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false,
      devTools: isDev,
      webSecurity: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:9000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist-renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Ask before unsaved changes are lost (window close, Exit, app quit).
  mainWindow.on('close', async (event) => {
    if (closeConfirmed || !docState.modified) return;
    if (mainWindow.webContents.isCrashed()) return;   // nothing left to save from
    event.preventDefault();
    const choice = await promptUnsaved(mainWindow, docState.fileName, 'close');
    if (!mainWindow) return;
    if (choice === 'discard') {
      closeConfirmed = true;
      await clearRecovery();
      mainWindow.close();
    } else if (choice === 'save') {
      mainWindow.webContents.send('app:saveThenClose');   // renderer saves, then calls app:closeNow
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key.toLowerCase() === 'r') {
      event.preventDefault();
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
    }
  });

  // Dev keyboard shortcuts
  if (isDev) {
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      if (mainWindow) {
        mainWindow.webContents.toggleDevTools();
      }
    });
    globalShortcut.register('CommandOrControl+R', () => {
      if (mainWindow) {
        mainWindow.webContents.reload();
      }
    });
  }
}

function getMainWindow() {
  return mainWindow;
}

ipcMain.on('doc:state', (_event, state) => {
  docState = { modified: !!state?.modified, fileName: String(state?.fileName || '') };
});
ipcMain.handle('app:closeNow', async () => {
  closeConfirmed = true;
  await clearRecovery();
  if (mainWindow) mainWindow.close();
});

app.whenReady().then(() => {
  setupMenu(getMainWindow);
  registerIpcHandlers(getMainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
});

module.exports = { getMainWindow };
