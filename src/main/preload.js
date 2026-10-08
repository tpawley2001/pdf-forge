const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_CHANNELS = [
  'file:opened', 'file:saved',
  'menu:new', 'menu:save', 'menu:saveAs',
  'menu:undo', 'menu:redo',
  'menu:zoomIn', 'menu:zoomOut', 'menu:zoomReset',
  'menu:rotateCw', 'menu:rotateCcw',
  'menu:toolSelect', 'menu:toolHand',
  'menu:toolHighlight', 'menu:toolUnderline', 'menu:toolStrikethrough', 'menu:toolStickyNote',
  'menu:toolFreehand', 'menu:toolRectangle', 'menu:toolEllipse', 'menu:toolLine',
  'menu:toolArrow', 'menu:toolText',
  'menu:find',
  'menu:organizePages', 'menu:export', 'menu:mergePDF', 'menu:imagesToPdf', 'menu:documentProperties',
  'menu:toolRedact', 'menu:watermark', 'menu:headerFooter', 'menu:protect', 'menu:flattenForm',
];

contextBridge.exposeInMainWorld('electronAPI', {
  openFile:          ()       => ipcRenderer.invoke('dialog:openFile'),
  saveFile:          (opts)   => ipcRenderer.invoke('dialog:saveFile', opts),
  saveFileAs:        (opts)   => ipcRenderer.invoke('dialog:saveFileAs', opts),
  openMultipleFiles: ()       => ipcRenderer.invoke('dialog:openMultipleFiles'),
  openImageFiles:    ()       => ipcRenderer.invoke('dialog:openImageFiles'),
  readFile:          (p)      => ipcRenderer.invoke('file:read', p),
  writeFile:         (p, d)   => ipcRenderer.invoke('file:write', p, d),
  saveNow:           (d, p)   => ipcRenderer.invoke('menu:saveNow', d, p),
  printPDF:          ()       => ipcRenderer.invoke('print:pdf'),
  validateDrop:      (p)      => ipcRenderer.invoke('file:validateDrop', p),
  checkUpdate:       ()       => ipcRenderer.invoke('update:check'),
  downloadUpdate:    (v)      => ipcRenderer.invoke('update:download', v),
  appInfo:           ()       => ipcRenderer.invoke('app:info'),

  on: (channel, cb) => {
    if (!ALLOWED_CHANNELS.includes(channel)) return () => {};
    const fn = (_ev, ...args) => cb(...args);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
