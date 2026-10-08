const { app, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { addAllowedPath } = require('./ipc');
const { VERSION } = require('./version');

function setupMenu(getMainWindow) {
  const isMac = process.platform === 'darwin';

  // ── Helper: open a PDF file dialog, read it, send to renderer ──
  async function openAndSend(win) {
    if (!win && !(win = getMainWindow())) return;

    const result = await dialog.showOpenDialog(win, {
      title: 'Open PDF',
      filters: [
        { name: 'PDF Documents', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) return;

    const filePath = result.filePaths[0];
    try {
      addAllowedPath(filePath);
      const buf = await fs.promises.readFile(filePath);
      win.webContents.send('file:opened', {
        filePath,
        fileName: path.basename(filePath),
        data: buf.toString('base64'),
      });
    } catch (err) {
      dialog.showErrorBox('Open Failed', err.message);
    }
  }

  // ── Helper: save via dialog ──
  async function saveAsAndSend(win, dataB64, defaultName) {
    if (!win && !(win = getMainWindow())) return;

    const result = await dialog.showSaveDialog(win, {
      title: 'Save PDF As',
      defaultPath: defaultName || 'document.pdf',
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    });

    if (result.canceled || !result.filePath) return;

    try {
      await fs.promises.writeFile(result.filePath, Buffer.from(dataB64, 'base64'));
      win.webContents.send('file:saved', {
        filePath: result.filePath,
        fileName: path.basename(result.filePath),
      });
    } catch (err) {
      dialog.showErrorBox('Save Failed', err.message);
    }
  }

  // ── Safe window getter ──
  function getWin(menuItem, browserWindow) {
    return browserWindow || getMainWindow();
  }

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' },
        { role: 'unhide' }, { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),

    // ── File ──
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: (_mi, bw) => {
            const win = getWin(_mi, bw);
            if (win) win.webContents.send('menu:new');
          },
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: (_mi, bw) => openAndSend(getWin(_mi, bw)),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: (_mi, bw) => {
            const win = getWin(_mi, bw);
            if (win) win.webContents.send('menu:save');
          },
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (_mi, bw) => {
            const win = getWin(_mi, bw);
            if (win) win.webContents.send('menu:saveAs');
          },
        },
        { type: 'separator' },
        {
          label: 'Print...',
          accelerator: 'CmdOrCtrl+P',
          click: (_mi, bw) => {
            const win = getWin(_mi, bw);
            if (win) win.webContents.print({ silent: false, printBackground: true }, () => {});
          },
        },
        { type: 'separator' },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+W', click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.close(); } },
        ...(isMac ? [] : [{ label: 'Exit', accelerator: 'Alt+F4', click: () => app.quit() }]),
      ],
    },

    // ── Edit ──
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo', accelerator: 'CmdOrCtrl+Z',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:undo'); },
        },
        {
          label: 'Redo', accelerator: 'CmdOrCtrl+Y',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:redo'); },
        },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find...', accelerator: 'CmdOrCtrl+F',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:find'); },
        },
      ],
    },

    // ── View ──
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In', accelerator: 'CmdOrCtrl+=',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:zoomIn'); },
        },
        {
          label: 'Zoom Out', accelerator: 'CmdOrCtrl+-',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:zoomOut'); },
        },
        {
          label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:zoomReset'); },
        },
        { type: 'separator' },
        {
          label: 'Rotate Clockwise', accelerator: 'CmdOrCtrl+Shift+]',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:rotateCw'); },
        },
        {
          label: 'Rotate Counterclockwise', accelerator: 'CmdOrCtrl+Shift+[',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:rotateCcw'); },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // ── Document ──
    {
      label: 'Document',
      submenu: [
        {
          label: 'Organize Pages…', accelerator: 'CmdOrCtrl+Shift+O',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:organizePages'); },
        },
        {
          label: 'Export…', accelerator: 'CmdOrCtrl+Shift+E',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:export'); },
        },
        {
          label: 'Merge PDFs…',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:mergePDF'); },
        },
        {
          label: 'Create PDF from Images…',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:imagesToPdf'); },
        },
        { type: 'separator' },
        {
          label: 'Add Watermark…',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:watermark'); },
        },
        {
          label: 'Header && Footer / Page Numbers…',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:headerFooter'); },
        },
        { type: 'separator' },
        {
          label: 'Redact Tool', accelerator: 'CmdOrCtrl+Shift+X',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolRedact'); },
        },
        { type: 'separator' },
        {
          label: 'Protect with Password…',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:protect'); },
        },
        {
          label: 'Sign with Digital ID…',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:digitalSign'); },
        },
        {
          label: 'Flatten Form Fields',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:flattenForm'); },
        },
        { type: 'separator' },
        {
          label: 'Document Properties…', accelerator: 'CmdOrCtrl+D',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:documentProperties'); },
        },
      ],
    },

    // ── Tools ──
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Select Tool', accelerator: 'V',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolSelect'); },
        },
        {
          label: 'Hand Tool', accelerator: 'H',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolHand'); },
        },
        { type: 'separator' },
        {
          label: 'Annotation Tools', submenu: [
            { label: 'Highlight', click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolHighlight'); } },
            { label: 'Underline', click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolUnderline'); } },
            { label: 'Strikethrough', click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolStrikethrough'); } },
            { label: 'Sticky Note', click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolStickyNote'); } },
          ],
        },
        {
          label: 'Drawing Tools', submenu: [
            { label: 'Freehand', click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolFreehand'); } },
            { label: 'Rectangle', click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolRectangle'); } },
            { label: 'Ellipse', click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolEllipse'); } },
            { label: 'Line', click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolLine'); } },
            { label: 'Arrow', click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolArrow'); } },
          ],
        },
        { type: 'separator' },
        {
          label: 'Text Tool',
          click: (_mi, bw) => { const w = getWin(_mi, bw); if (w) w.webContents.send('menu:toolText'); },
        },
      ],
    },

    // ── Help ──
    {
      label: 'Help',
      submenu: [
        {
          label: 'About PDF Forge',
          click: () => {
            dialog.showMessageBox({
              type: 'info', title: 'About PDF Forge',
              message: `PDF Forge v${VERSION}`,
              detail: 'Free, open-source PDF editor for Windows.\n\nBuilt with Electron, React, and PDF.js.\n\nMIT License',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = { setupMenu };
