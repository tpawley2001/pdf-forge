const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_CHANNELS = [
  'file:opened', 'file:saved', 'app:saveThenClose',
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
  'menu:toolRedact', 'menu:watermark', 'menu:headerFooter', 'menu:protect', 'menu:flattenForm', 'menu:digitalSign', 'menu:repair', 'menu:optimize', 'menu:linearize',
];

contextBridge.exposeInMainWorld('electronAPI', {
  openFile:          ()       => ipcRenderer.invoke('dialog:openFile'),
  saveFile:          (opts)   => ipcRenderer.invoke('dialog:saveFile', opts),
  saveFileAs:        (opts)   => ipcRenderer.invoke('dialog:saveFileAs', opts),
  openMultipleFiles: ()       => ipcRenderer.invoke('dialog:openMultipleFiles'),
  saveParts:         (o)      => ipcRenderer.invoke('dialog:saveParts', o),
  openImageFiles:    ()       => ipcRenderer.invoke('dialog:openImageFiles'),
  readFile:          (p)      => ipcRenderer.invoke('file:read', p),
  loadPdfiumWasm:    ()       => ipcRenderer.invoke('asset:pdfiumWasm'),
  signRecentIds:     ()       => ipcRenderer.invoke('sign:recentIds'),
  signPickId:        ()       => ipcRenderer.invoke('sign:pickId'),
  signReadId:        (p, pw)  => ipcRenderer.invoke('sign:readId', p, pw),
  signCreateId:      (o)      => ipcRenderer.invoke('sign:createId', o),
  signAndSave:       (o)      => ipcRenderer.invoke('sign:signAndSave', o),
  verifySignatures:  (b64)    => ipcRenderer.invoke('sign:verify', b64),
  pdfTransform:      (op, b64) => ipcRenderer.invoke('pdf:transform', op, b64),
  writeFile:         (p, d)   => ipcRenderer.invoke('file:write', p, d),
  saveNow:           (d, p)   => ipcRenderer.invoke('menu:saveNow', d, p),
  printPDF:          ()       => ipcRenderer.invoke('print:pdf'),
  validateDrop:      (p)      => ipcRenderer.invoke('file:validateDrop', p),
  checkUpdate:       ()       => ipcRenderer.invoke('update:check'),
  downloadUpdate:    (v)      => ipcRenderer.invoke('update:download', v),
  appInfo:           ()       => ipcRenderer.invoke('app:info'),
  docState:          (s)      => ipcRenderer.send('doc:state', s),
  closeNow:          ()       => ipcRenderer.invoke('app:closeNow'),
  unsavedPrompt:     (n, r)   => ipcRenderer.invoke('dialog:unsaved', n, r),
  showError:         (t, m)   => ipcRenderer.invoke('dialog:error', t, m),
  recoveryWrite:     (d, m)   => ipcRenderer.invoke('recovery:write', d, m),
  recoveryClear:     (id)     => ipcRenderer.invoke('recovery:clear', id),
  recoveryList:      ()       => ipcRenderer.invoke('recovery:list'),
  recoveryRead:      (id)     => ipcRenderer.invoke('recovery:read', id),

  on: (channel, cb) => {
    if (!ALLOWED_CHANNELS.includes(channel)) return () => {};
    const fn = (_ev, ...args) => cb(...args);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
