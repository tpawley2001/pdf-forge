import React, { useState, useCallback, useEffect, useRef } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';
import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import PDFViewer from './components/PDFViewer';
import StatusBar from './components/StatusBar';
import WelcomeScreen from './components/WelcomeScreen';
import SignatureDialog from './components/SignatureDialog';
import PageOrganizer from './components/PageOrganizer';
import ExportDialog from './components/ExportDialog';
import UpdateDialog from './components/UpdateDialog';
import DocumentPropertiesDialog from './components/DocumentPropertiesDialog';
import MergePDFDialog from './components/MergePDFDialog';
import ImagesToPdfDialog from './components/ImagesToPdfDialog';
import StampPickerDialog from './components/StampPickerDialog';
import WatermarkDialog from './components/WatermarkDialog';
import HeaderFooterDialog from './components/HeaderFooterDialog';
import ProtectDialog from './components/ProtectDialog';
import PasswordPromptDialog from './components/PasswordPromptDialog';
import RedactDialog from './components/RedactDialog';
import DigitalSignDialog from './components/DigitalSignDialog';
import PdfToolResultDialog from './components/PdfToolResultDialog';
import { withPdfiumDoc } from '../pdf/PdfiumEngine.js';
import { SignatureBanner, SignaturePanelDialog } from './components/SignaturePanel';
import { useAnnotations } from './hooks/useAnnotations';
import { TextEditor } from '../pdf/TextEditor.js';
import { createOCRWorker, parseBlocks } from './services/ocr.js';
import { matchFontFromRegion, getFontBytes } from './services/fontMatcher.js';
import { findParagraph, replaceParagraph } from '../pdf/PdfiumTextEditor.js';
import { flattenAnnotations } from '../pdf/AnnotationFlattener.js';
import { applyFormValues, flattenFormFields } from '../pdf/FormFiller.js';
import { applyRedactions } from '../pdf/Redactor.js';
import { encryptPdf, decryptPdf } from '../pdf/Protect.js';
import RecoveryDialog from './components/RecoveryDialog';

function toBase64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64);
  const u8  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export default function App() {
  const ann = useAnnotations();

  const [activeTool,   setActiveTool]   = useState('hand');
  const [scale,        setScale]        = useState(1.0);
  const [currentPage,  setCurrentPage]  = useState(1);
  const [pageCount,    setPageCount]    = useState(0);
  const [leftSidebarOpen,  setLeftSidebarOpen]  = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [sidebarTab,   setSidebarTab]   = useState('thumbnails');
  const [searchQuery,  setSearchQuery]  = useState('');
  const [searchResults,setSearchResults]= useState([]);
  const [showSignature,          setShowSignature]          = useState(false);
  const [showPageOrganizer,      setShowPageOrganizer]      = useState(false);
  const [showExport,             setShowExport]             = useState(false);
  const [showUpdate,             setShowUpdate]             = useState(false);
  const [showDocumentProperties, setShowDocumentProperties] = useState(false);
  const [showMergePDF,           setShowMergePDF]           = useState(false);
  const [showImagesToPdf,        setShowImagesToPdf]        = useState(false);
  const [showStampPicker,        setShowStampPicker]        = useState(false);
  const [showWatermark,          setShowWatermark]          = useState(false);
  const [showHeaderFooter,       setShowHeaderFooter]       = useState(false);
  const [showProtect,            setShowProtect]            = useState(false);
  const [formValues,             setFormValues]             = useState({});
  const [protection,             setProtection]             = useState(null); // encrypt-at-save settings
  const [signatures,             setSignatures]             = useState(null); // verified signatures of the opened file
  const [signDialog,             setSignDialog]             = useState(null); // { initial?, error? } while open
  const [pendingSign,            setPendingSign]            = useState(null); // settings waiting for a placed box
  const [showSigPanel,           setShowSigPanel]           = useState(false);
  const [pdfToolState,           setPdfToolState]           = useState(null); // Repair / optimize dialog
  const [passwordPrompt,         setPasswordPrompt]         = useState(null); // { error, busy }
  const [redactDialog,           setRedactDialog]           = useState(null); // { busy, result }
  const [pendingStampType,       setPendingStampType]       = useState('Approved');
  const [pageOutline,            setPageOutline]            = useState([]);
  // pageOCRData: { [n]: { running, done, blocks } } — blocks in PDF points
  const [pageOCRData,  setPageOCRData]  = useState({});
  const [ocrEditPage,  setOcrEditPage]  = useState(null);
  const [textEdit,     setTextEdit]     = useState(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [pdfData,      setPdfData]      = useState(null);
  const [filePath,     setFilePath]     = useState(null);
  const [fileName,     setFileName]     = useState('');
  const [isModified,   setIsModified]   = useState(false);
  const [isLoading,    setIsLoading]    = useState(false);
  const [updateInfo,   setUpdateInfo]   = useState(null);
  const [thumbnails,   setThumbnails]   = useState({});
  const [pageTexts,    setPageTexts]    = useState({});
  const [pageImages,   setPageImages]   = useState({}); // data URLs for OCR
  const [pageImageScales, setPageImageScales] = useState({});
  const [annotationColor, setAnnotationColor] = useState('rgba(255,255,0,0.5)');
  const [annotationSize,  setAnnotationSize]  = useState(2);
  const [defaultPageSize, setDefaultPageSize] = useState(null); // {w, h} at scale=1
  const viewerRef = useRef(null);

  const hasDocument = !!pdfData;

  // ── OCR background worker ──
  const ocrWorkerRef     = useRef(null);   // long-lived Tesseract worker
  const ocrQueueRef      = useRef([]);     // { pageNum, dataUrl, scale }
  const ocrProcessingRef = useRef(false);  // queue drain in progress

  const terminateOCRWorker = useCallback(() => {
    if (ocrWorkerRef.current) {
      ocrWorkerRef.current.terminate().catch(() => {});
      ocrWorkerRef.current = null;
    }
    ocrQueueRef.current = [];
    ocrProcessingRef.current = false;
  }, []);

  const processOCRQueue = useCallback(async () => {
    if (ocrProcessingRef.current) return;
    ocrProcessingRef.current = true;
    try {
      if (!ocrWorkerRef.current) {
        ocrWorkerRef.current = await createOCRWorker();
      }
      while (ocrQueueRef.current.length > 0) {
        const { pageNum, dataUrl, scale: capturedScale } = ocrQueueRef.current.shift();
        setPageOCRData(prev => ({ ...prev, [pageNum]: { running: true, done: false, blocks: null } }));
        try {
          const result = await ocrWorkerRef.current.recognize(dataUrl);
          const raw    = parseBlocks(result);
          // Convert pixel bboxes → PDF points so they stay correct across zoom changes
          const blocks = raw.map((b, i) => ({
            ...b,
            _id:  i,
            bbox: {
              x:      b.bbox.x      / capturedScale,
              y:      b.bbox.y      / capturedScale,
              width:  b.bbox.width  / capturedScale,
              height: b.bbox.height / capturedScale,
            },
          }));
          setPageOCRData(prev => ({ ...prev, [pageNum]: { running: false, done: true, blocks } }));
        } catch (err) {
          console.error(`OCR page ${pageNum}:`, err);
          setPageOCRData(prev => ({ ...prev, [pageNum]: { running: false, done: false, blocks: [] } }));
        }
      }
    } catch (workerErr) {
      console.error('OCR worker:', workerErr);
      ocrWorkerRef.current = null;
    } finally {
      ocrProcessingRef.current = false;
    }
  }, []);

  const loadB64 = useCallback((b64, path, name) => {
    terminateOCRWorker();
    setPageOCRData({});
    setOcrEditPage(null);
    setPageOutline([]);
    setDefaultPageSize(null);
    setPdfData(fromBase64(b64));
    setSignatures(null);
    setPendingSign(null);
    window.electronAPI?.verifySignatures?.(b64).then(r => setSignatures(r?.signatures?.length ? r.signatures : null)).catch(() => {});
    setFilePath(path || null);
    setFileName(name || 'Untitled.pdf');
    setFormValues({});
    setProtection(null);
    setPasswordPrompt(null);
    setRedactDialog(null);
    setIsModified(false);
    setCurrentPage(1);
    setPageCount(0);
    setThumbnails({});
    setPageTexts({});
    setPageImages({});
    setPageImageScales({});
    ann.clear();
  }, [ann, terminateOCRWorker]);

  // ── Thumbnails from PDFViewer ──
  const handleThumbnailReady = useCallback((pageNum, dataUrl) => {
    setThumbnails(prev => ({ ...prev, [pageNum]: dataUrl }));
  }, []);

  // ── Text content from PDFViewer ──
  const handleTextContent = useCallback((pageNum, text) => {
    setPageTexts(prev => ({ ...prev, [pageNum]: text }));
  }, []);

  // ── Page image — auto-queue for background OCR on first arrival ──
  const handlePageImage = useCallback((pageNum, dataUrl, renderScale = scale) => {
    setPageImages(prev => ({ ...prev, [pageNum]: dataUrl }));
    setPageImageScales(prev => ({ ...prev, [pageNum]: renderScale }));
    setPageOCRData(prev => {
      if (prev[pageNum]?.done || prev[pageNum]?.running) return prev;
      if (ocrQueueRef.current.some(q => q.pageNum === pageNum)) return prev;
      ocrQueueRef.current.push({ pageNum, dataUrl, scale: renderScale });
      // Kick off queue drain outside of setState (safe: just schedules async work)
      setTimeout(() => processOCRQueue(), 0);
      return prev;
    });
  }, [scale, processOCRQueue]);

  // ── Search ──
  useEffect(() => {
    if (!searchQuery || !Object.keys(pageTexts).length) { setSearchResults([]); return; }
    const q   = searchQuery.toLowerCase();
    const res = [];
    for (const [page, text] of Object.entries(pageTexts)) {
      if (text.toLowerCase().includes(q)) {
        const idx = text.toLowerCase().indexOf(q);
        const ctx = text.slice(Math.max(0, idx - 40), idx + searchQuery.length + 40).trim();
        res.push({ page: parseInt(page), text: ctx });
      }
    }
    setSearchResults(res);
  }, [searchQuery, pageTexts]);

  // ── File:opened via menu ──
  useEffect(() => {
    const unsub = window.electronAPI.on('file:opened', async ({ filePath: fp, fileName: fn, data: b64 }) => {
      if (b64 && await guardUnsaved()) loadB64(b64, fp, fn);
    });
    return () => { if (unsub) unsub(); };
  }, [loadB64, guardUnsaved]);

  // ── Unsaved changes: ask before anything replaces the open document ──
  const docRef = useRef({});
  docRef.current.isModified = isModified;
  docRef.current.fileName = fileName;
  /** Resolves true when it's fine to replace the open document. */
  const guardUnsaved = useCallback(async () => {
    if (!docRef.current.isModified) return true;
    const choice = await window.electronAPI.unsavedPrompt(docRef.current.fileName, 'open');
    if (choice === 'save') return !!(await docRef.current.save?.());
    if (choice === 'discard') { window.electronAPI.recoveryClear(); return true; }
    return false;
  }, []);

  const handleOpen     = useCallback(async () => { if (!(await guardUnsaved())) return; try { const r = await window.electronAPI.openFile(); if (!r || r.canceled) return; if (r.data) loadB64(r.data, r.filePath, r.fileName); } catch (_) {} }, [loadB64, guardUnsaved]);
  const bytesForSave   = useCallback(async ({ encrypt = true } = {}) => {
    let bytes = pdfData;
    if (Object.keys(formValues).length) bytes = await applyFormValues(bytes, formValues);
    bytes = await flattenAnnotations(bytes, ann.annotations.filter(a => a.type !== 'sigField'));
    if (protection && encrypt) bytes = await encryptPdf(bytes, protection);
    return bytes;
  }, [pdfData, ann.annotations, formValues, protection]);
  // ── Digital signatures ──
  const [signPlacement, setSignPlacement] = useState(null);

  const performSign = useCallback(async (settings, placement) => {
    setIsLoading(true);
    try {
      const bytes = await bytesForSave({ encrypt: false }); // signer encrypts (if protected) while signing
      let appearance;
      if (placement) {
        const lines = [`Digitally signed by ${settings.id.name}`, `Date: ${new Date().toLocaleString()}`];
        if (settings.reason) lines.push(`Reason: ${settings.reason}`);
        if (settings.location) lines.push(`Location: ${settings.location}`);
        appearance = {
          pageIndex: placement.page - 1,
          x: placement.rect.x, y: placement.rect.y,
          width: placement.rect.width, height: placement.rect.height,
          text: lines.join('\n'),
        };
      }
      const base = (fileName || 'document.pdf').replace(/\.pdf$/i, '');
      const r = await window.electronAPI.signAndSave({
        pdfB64: toBase64(bytes),
        idPath: settings.idPath,
        password: settings.password,
        reason: settings.reason, location: settings.location, contact: settings.contact,
        appearance,
        tsaUrl: settings.tsaUrl || undefined,
        ltv: settings.ltv,
        protection: protection || undefined,
        defaultPath: `${base}_signed.pdf`,
      });
      if (r?.canceled) return;
      if (!r?.success) { setSignDialog({ initial: settings, error: r?.error || 'Signing failed' }); return; }
      loadB64(r.data, r.filePath, r.fileName); // reopen the signed file (re-verifies)
    } catch (err) {
      setSignDialog({ initial: settings, error: err.message });
    } finally {
      setIsLoading(false);
    }
  }, [bytesForSave, fileName, protection, loadB64]);

  const handleSignSettings = useCallback((settings) => {
    setSignDialog(null);
    if (settings.visible) {
      setPendingSign(settings);
      setActiveTool('sigField');
    } else {
      performSign(settings, null);
    }
  }, [performSign]);

  useEffect(() => {
    if (!signPlacement || !pendingSign) return;
    const settings = pendingSign;
    setSignPlacement(null);
    setPendingSign(null);
    setActiveTool('hand');
    performSign(settings, signPlacement);
  }, [signPlacement, pendingSign, performSign]);

  useEffect(() => {
    if (activeTool !== 'sigField') return undefined;
    const onKey = e => { if (e.key === 'Escape') { setPendingSign(null); setActiveTool('hand'); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool]);

  // Both resolve true once the document is safely on disk.
  const reportSaveError = (err) => { console.error('Save failed:', err); window.electronAPI.showError('Save Failed', `The document could not be saved.\n\n${err?.message || err}`); };
  const handleSave     = useCallback(async () => { if (!pdfData) return false; if (!filePath) return handleSaveAs(); setIsLoading(true); try { const bytes = await bytesForSave(); const r = await window.electronAPI.saveNow(toBase64(bytes), filePath); if (!r?.success) throw new Error(r?.error || 'Unknown error'); setIsModified(false); return true; } catch (err) { reportSaveError(err); return false; } finally { setIsLoading(false); } }, [filePath, pdfData, bytesForSave]);
  const handleSaveAs   = useCallback(async () => { if (!pdfData) return false; setIsLoading(true); try { const r = await window.electronAPI.saveFile({ defaultPath: fileName || 'document.pdf' }); if (!r || r.canceled) return false; const bytes = await bytesForSave(); const wr = await window.electronAPI.saveNow(toBase64(bytes), r.filePath); if (!wr?.success) throw new Error(wr?.error || 'Unknown error'); setFilePath(r.filePath); setFileName(r.filePath.split(/[/\\]/).pop() || 'document.pdf'); setIsModified(false); return true; } catch (err) { reportSaveError(err); return false; } finally { setIsLoading(false); } }, [pdfData, fileName, bytesForSave]);
  docRef.current.save = handleSave;
  const handlePrint    = useCallback(async () => { try { await window.electronAPI.printPDF(); } catch (_) {} }, []);
  const resetDocument  = useCallback(() => { terminateOCRWorker(); setPageOCRData({}); setOcrEditPage(null); setPdfData(null); setFilePath(null); setFileName(''); setCurrentPage(1); setPageCount(0); setIsModified(false); setThumbnails({}); setPageTexts({}); setPageImages({}); setPageImageScales({}); setPageOutline([]); ann.clear(); }, [ann, terminateOCRWorker]);
  const handleNewFile  = useCallback(async () => { if (await guardUnsaved()) resetDocument(); }, [guardUnsaved, resetDocument]);
  const handleAnnAdd     = useCallback((type, data) => {
    if (type === 'sigField') { setSignPlacement(data); return; }
    ann.addAnnotation(type, data); setIsModified(true);
  }, [ann]);
  const handleAnnDelete  = useCallback(id => { ann.removeAnnotation(id); if (selectedAnnotationId === id) setSelectedAnnotationId(null); setIsModified(true); }, [ann, selectedAnnotationId]);

  // Debug/automation hook (harmless in prod; used by dev tooling)
  useEffect(() => { window.__pdfforge = { loadB64, bytesForSave }; }, [loadB64, bytesForSave]);

  // ── Safety net: close prompt, autosave, crash recovery ──
  useEffect(() => { window.electronAPI.docState({ modified: isModified && !!pdfData, fileName }); }, [isModified, pdfData, fileName]);
  useEffect(() => window.electronAPI.on('app:saveThenClose', async () => {
    if (await handleSave()) window.electronAPI.closeNow();
  }), [handleSave]);

  // Autosave a copy for crash recovery every minute while there are unsaved
  // changes (encrypted documents are autosaved encrypted, as on save).
  docRef.current.autosave = { pdfData, filePath, bytesForSave };
  useEffect(() => { if (!isModified) window.electronAPI.recoveryClear(); }, [isModified]);
  useEffect(() => {
    let timer;
    let busy = false;
    let cancelled = false;
    window.electronAPI.appInfo().then(info => {
      if (cancelled) return;
      timer = setInterval(async () => {
        const { pdfData: data, filePath: fp, bytesForSave: getBytes } = docRef.current.autosave;
        if (busy || !data || !docRef.current.isModified) return;
        busy = true;
        try {
          const bytes = await getBytes();
          if (docRef.current.isModified) await window.electronAPI.recoveryWrite(toBase64(bytes), { fileName: docRef.current.fileName, filePath: fp });
        } catch (err) {
          console.warn('Autosave failed:', err);
        } finally {
          busy = false;
        }
      }, info?.autosaveMs || 60000);
    });
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const [recoverable, setRecoverable] = useState([]);
  useEffect(() => { window.electronAPI.recoveryList().then(list => setRecoverable(list || [])).catch(() => {}); }, []);
  const handleRecover = useCallback(async (item) => {
    try {
      const r = await window.electronAPI.recoveryRead(item.id);
      loadB64(r.data, r.filePath, r.fileName);
      setIsModified(true);
      await window.electronAPI.recoveryClear(item.id);
      setRecoverable([]);
    } catch (err) {
      window.electronAPI.showError('Recovery Failed', err?.message || String(err));
    }
  }, [loadB64]);
  const handleDiscardRecovery = useCallback(async (item) => {
    await window.electronAPI.recoveryClear(item.id);
    setRecoverable(list => list.filter(x => x.id !== item.id));
  }, []);

  // ── Interactive form filling ──
  const handleFormValueChange = useCallback((name, value) => {
    setFormValues(prev => ({ ...prev, [name]: value }));
    setIsModified(true);
  }, []);

  // ── Repair / Reduce File Size / Fast Web View (PDFium + qpdf) ──
  const TOOL_TITLES = { repair: 'Repair PDF', optimize: 'Reduce File Size', linearize: 'Optimize for Fast Web View' };
  const fmtKB = n => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  const handlePdfTool = useCallback(async (op) => {
    if (!pdfData) return;
    const title = TOOL_TITLES[op];
    if (signatures?.length && !window.confirm(`${title} rewrites the file, which invalidates its digital signatures. Continue?`)) return;
    setPdfToolState({ title, busy: true });
    try {
      let input = pdfData;
      // qpdf-wasm can't reconstruct damaged files; PDFium can — load + resave first
      if (op === 'repair') input = await withPdfiumDoc(pdfData, d => d.save());
      const r = await window.electronAPI.pdfTransform(op === 'repair' ? 'rewrite' : op, toBase64(input));
      if (!r?.success) { setPdfToolState({ title, error: r?.error || 'Failed' }); return; }
      setPdfData(fromBase64(r.data));
      setIsModified(true);
      setThumbnails({}); setPageTexts({}); setPageImages({}); setPageImageScales({}); setPageOCRData({});
      const sizes = `${fmtKB(r.before)} → ${fmtKB(r.after)}`;
      const message = op === 'repair'
        ? `The document structure was rebuilt (${sizes}). Save to keep the repaired file.`
        : op === 'optimize'
        ? `${sizes} (${Math.round((1 - r.after / r.before) * 100)}% smaller). Save to keep it.`
        : `The file is now linearized so web browsers can show page 1 before it finishes downloading (${sizes}). Save to keep it — it stays linearized as long as there are no further edits.`;
      setPdfToolState({ title, message: r.warnings?.length ? `${message}\n\nqpdf notes:\n${r.warnings.slice(0, 5).join('\n')}` : message });
    } catch (err) {
      setPdfToolState({ title, error: err.message });
    }
  }, [pdfData, signatures]);

  const handleLoadError = useCallback((err) => {
    setPdfToolState({
      title: 'Couldn\'t open this PDF',
      message: `The file looks damaged (${err?.message || 'unreadable'}). PDF Forge can try to rebuild it.`,
      offerRepair: true,
    });
  }, []);

  const handleFlattenForm = useCallback(async () => {
    if (!pdfData) return;
    setIsLoading(true);
    try {
      let bytes = pdfData;
      if (Object.keys(formValues).length) bytes = await applyFormValues(bytes, formValues);
      bytes = await flattenFormFields(bytes);
      setPdfData(bytes);
      setFormValues({});
      setIsModified(true);
    } catch (err) { console.error('Flatten form failed:', err); }
    finally { setIsLoading(false); }
  }, [pdfData, formValues]);

  // ── Encrypted document: unlock into the session ──
  const handlePasswordRequired = useCallback(() => {
    setPasswordPrompt({ error: '', busy: false });
  }, []);

  const handlePasswordSubmit = useCallback(async (pw) => {
    setPasswordPrompt(p => ({ ...p, busy: true, error: '' }));
    try {
      const decrypted = await decryptPdf(pdfData, pw);
      setPasswordPrompt(null);
      setPdfData(decrypted);
    } catch (_) {
      setPasswordPrompt({ busy: false, error: 'Incorrect password — try again.' });
    }
  }, [pdfData]);

  const handlePasswordCancel = useCallback(() => {
    setPasswordPrompt(null);
    resetDocument();
  }, [resetDocument]);

  // ── Redaction ──
  const redactAnnotations = ann.annotations.filter(a => a.type === 'redact');

  const handleApplyRedactionsClick = useCallback(() => {
    if (redactAnnotations.length) setRedactDialog({ busy: false, result: null });
  }, [redactAnnotations.length]);

  const handleRedactConfirm = useCallback(async () => {
    setRedactDialog({ busy: true, result: null });
    try {
      const byPage = {};
      for (const a of redactAnnotations) {
        if (!a.rect) continue;
        const idx = (a.page || 1) - 1;
        (byPage[idx] = byPage[idx] || []).push(a.rect);
      }
      const { bytes, summary } = await applyRedactions(pdfData, byPage);
      setPdfData(bytes);
      setIsModified(true);
      for (const a of redactAnnotations) ann.removeAnnotation(a.id);
      setPageOCRData({});
      setRedactDialog({ busy: false, result: summary });
    } catch (err) {
      console.error('Redaction failed:', err);
      setRedactDialog(null);
    }
  }, [redactAnnotations, pdfData, ann]);

  // ── Page rotation ──
  const handleRotateCW = useCallback(async () => {
    if (!pdfData) return;
    setIsLoading(true);
    try {
      const doc = await PDFDocument.load(pdfData, { ignoreEncryption: true });
      const page = doc.getPages()[currentPage - 1];
      if (page) {
        const angle = page.getRotation().angle;
        page.setRotation(degrees((angle + 90) % 360));
        const bytes = await doc.save();
        setPdfData(bytes);
        setIsModified(true);
      }
    } catch (err) { console.error('Rotate CW failed:', err); }
    finally { setIsLoading(false); }
  }, [pdfData, currentPage]);

  const handleRotateCCW = useCallback(async () => {
    if (!pdfData) return;
    setIsLoading(true);
    try {
      const doc = await PDFDocument.load(pdfData, { ignoreEncryption: true });
      const page = doc.getPages()[currentPage - 1];
      if (page) {
        const angle = page.getRotation().angle;
        page.setRotation(degrees((angle + 270) % 360));
        const bytes = await doc.save();
        setPdfData(bytes);
        setIsModified(true);
      }
    } catch (err) { console.error('Rotate CCW failed:', err); }
    finally { setIsLoading(false); }
  }, [pdfData, currentPage]);

  // ── Outline/bookmarks from PDFViewer ──
  const handleOutlineReady = useCallback(outline => {
    setPageOutline(outline || []);
  }, []);

  // ── First-page size from PDFViewer (used for Fit Page / Fit Width) ──
  const handleFirstPageSize = useCallback((w, h) => {
    setDefaultPageSize({ w, h });
  }, []);

  // ── Fit page / fit width ──
  const handleFitWidth = useCallback(() => {
    if (!defaultPageSize || !viewerRef.current) return;
    const containerW = viewerRef.current.clientWidth - 40; // 20px padding each side
    setScale(Math.max(0.1, +(containerW / defaultPageSize.w).toFixed(3)));
  }, [defaultPageSize]);

  const handleFitPage = useCallback(() => {
    if (!defaultPageSize || !viewerRef.current) return;
    const containerW = viewerRef.current.clientWidth - 40;
    const containerH = viewerRef.current.clientHeight - 40;
    const scaleW = containerW / defaultPageSize.w;
    const scaleH = containerH / defaultPageSize.h;
    setScale(Math.max(0.1, +(Math.min(scaleW, scaleH)).toFixed(3)));
  }, [defaultPageSize]);

  // ── OCR ──
  const handleOCR = useCallback(() => {
    if (!hasDocument) return;
    // Toggle overlay for current page; if page not yet OCR'd, ensure it's queued
    if (ocrEditPage === currentPage) { setOcrEditPage(null); return; }
    setOcrEditPage(currentPage);
    const entry = pageOCRData[currentPage];
    if (!entry?.done && !entry?.running) {
      const dataUrl = pageImages[currentPage];
      if (dataUrl && !ocrQueueRef.current.some(q => q.pageNum === currentPage)) {
        ocrQueueRef.current.push({ pageNum: currentPage, dataUrl, scale });
        setTimeout(() => processOCRQueue(), 0);
        setPageOCRData(prev => ({ ...prev, [currentPage]: { running: false, done: false, blocks: null } }));
      }
    }
  }, [hasDocument, currentPage, ocrEditPage, pageOCRData, pageImages, scale, processOCRQueue]);

  // Bboxes are already in PDF points — no division by scale needed
  const handleOCRCommit = useCallback(async (editedBlocks) => {
    const dirty   = editedBlocks.filter(b => b._dirty);
    const pageNum = ocrEditPage;
    setOcrEditPage(null);
    if (!pdfData || dirty.length === 0 || !pageNum) return;
    setIsLoading(true);
    try {
      // Build a canvas from the page image so fontMatcher can sample pixels
      let pageCanvas = null;
      const dataUrl  = pageImages[pageNum];
      const imageScale = pageImageScales[pageNum] || scale;
      if (dataUrl) {
        pageCanvas = document.createElement('canvas');
        const img  = await new Promise((res, rej) => {
          const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
        });
        pageCanvas.width  = img.width;
        pageCanvas.height = img.height;
        pageCanvas.getContext('2d').drawImage(img, 0, 0);
      }

      // Run pixel-level font matching for each edited block in parallel
      const edits = await Promise.all(dirty.map(async (b) => {
        let fm = null;
        if (pageCanvas) {
          try { fm = await matchFontFromRegion(pageCanvas, b.bbox, b.text, imageScale); } catch (_) {}
        }
        return {
          text:       b.text,
          originalText: b._origText,
          bbox:       b.bbox,
          fontSize:   Math.max(4, Math.round(b.bbox.height * 0.82)),
          bold:       fm?.isBold   ?? false,
          italic:     fm?.isItalic ?? false,
          fontFamily: fm?.fontFamily ?? '',
          color:      '#000000',
          whiteout:   true,
        };
      }));

      const newBytes = await TextEditor.applyEdits(pdfData, pageNum - 1, edits);
      setPdfData(newBytes);
      setIsModified(true);
      // Re-run OCR on that page after edits are applied
      setPageOCRData(prev => ({ ...prev, [pageNum]: { running: false, done: false, blocks: null } }));
    } catch (err) {
      console.error('OCR commit:', err);
    } finally {
      setIsLoading(false);
    }
  }, [ocrEditPage, pdfData, pageImages, pageImageScales, scale]);

  const handleOCRCancel = useCallback(() => setOcrEditPage(null), []);

  // Click on text → open the editor immediately, then widen it to the whole
  // paragraph (with its real font/size/color) once PDFium has analysed it.
  const handleTextEditRequest = useCallback(async (edit) => {
    setTextEdit(edit);
    if (!pdfData || !edit?.bbox) return;
    const para = await findParagraph(pdfData, edit.page - 1, edit.bbox, edit.originalText);
    if (!para) return;
    setTextEdit(cur => (cur && cur.page === edit.page && cur.bbox === edit.bbox && cur.text === edit.text ? {
      ...cur,
      text: para.text,
      originalText: para.text,
      bbox: para.bbox,
      fontSize: para.fontSize,
      color: para.color,
      bold: para.mixedBold ? null : para.bold,
      italic: para.mixedItalic ? null : para.italic,
      fontFamily: para.fontFamily,
      align: para.align,
      pdfium: para,
    } : cur));
  }, [pdfData]);

  const handleTextEditApply = useCallback(async (edit) => {
    if (!pdfData || !edit) return;
    setIsLoading(true);
    try {
      // Native paragraph edit: original font where possible, reflow, verified
      if (edit.pdfium) {
        const p = edit.pdfium;
        const res = await replaceParagraph(pdfData, edit.page - 1, p, edit.text, {
          fontSize: edit.fontSize !== p.fontSize ? edit.fontSize : undefined,
          color: edit.color,
          bold: edit.bold,
          italic: edit.italic,
          align: edit.align !== p.align ? edit.align : undefined,
          viewOffset: { dx: edit.bbox.x - p.bbox.x, dy: edit.bbox.y - p.bbox.y },
          viewWidth: Math.abs(edit.bbox.width - p.bbox.width) > 0.5 ? edit.bbox.width : undefined,
          loadFontBytes: getFontBytes,
        });
        if (res) {
          setPdfData(res.bytes);
          setIsModified(true);
          setTextEdit(null);
          return;
        }
        console.warn('PDFium paragraph edit not possible here; falling back to overlay edit');
      }

      // If font info is missing (e.g. click on OCR block), run pixel-level matching
      let { fontFamily, bold, italic } = edit;
      if (!fontFamily) {
        const dataUrl = pageImages[edit.page];
        const imageScale = pageImageScales[edit.page] || scale;
        if (dataUrl) {
          try {
            const canvas = document.createElement('canvas');
            const img = await new Promise((res, rej) => {
              const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
            });
            canvas.width = img.width; canvas.height = img.height;
            canvas.getContext('2d').drawImage(img, 0, 0);
            const fm = await matchFontFromRegion(canvas, edit.bbox, edit.text, imageScale);
            if (fm) { fontFamily = fm.fontFamily; bold = fm.isBold; italic = fm.isItalic; }
          } catch (_) {}
        }
      }

      const newBytes = await TextEditor.applyEdits(pdfData, edit.page - 1, [{
        bbox:       edit.bbox,
        text:       edit.text,
        originalText: edit.originalText,
        fontSize:   edit.fontSize,
        color:      edit.color,
        bold:       bold ?? edit.bold,
        italic:     italic ?? edit.italic,
        fontFamily: fontFamily ?? edit.fontFamily,
        align:      edit.align,
        paddingX:   edit.paddingX,
        paddingY:   edit.paddingY,
        whiteout:   edit.whiteout,
      }]);
      setPdfData(newBytes);
      setIsModified(true);
      setTextEdit(null);
    } catch (err) {
      console.error('Text edit failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [pdfData, pageImages, pageImageScales, scale]);

  // ── Drag & Drop ──
  const handleDragOver = useCallback(e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }, []);
  const handleDrop     = useCallback(async e => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (!file) return; if (!(await guardUnsaved())) return; if (file.path) { const v = await window.electronAPI.validateDrop(file.path); if (!v?.valid) return; const r = await window.electronAPI.readFile(file.path); if (r?.success) loadB64(r.data, file.path, r.fileName); } else { const reader = new FileReader(); reader.onload = () => loadB64(reader.result.split(',')[1], null, file.name); reader.readAsDataURL(file); } }, [loadB64, guardUnsaved]);

  // ── Auto-update ──
  useEffect(() => { (async () => { try { const info = await window.electronAPI.checkUpdate(); if (info?.updateAvailable) { setUpdateInfo(info); setShowUpdate(true); } else setUpdateInfo(info); } catch (_) {} })(); }, []);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = e => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Delete/Backspace: remove selected annotation
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey) {
        if (selectedAnnotationId) { e.preventDefault(); handleAnnDelete(selectedAnnotationId); }
        return;
      }

      if (!e.ctrlKey && !e.metaKey) return;
      switch (e.key.toLowerCase()) {
        case 'o': e.preventDefault(); handleOpen(); break;
        case 's': e.preventDefault(); e.shiftKey ? handleSaveAs() : handleSave(); break;
        case 'z': e.preventDefault(); ann.undo(); break;
        case 'y': e.preventDefault(); ann.redo(); break;
        case 'f': e.preventDefault(); setSidebarTab('search'); setLeftSidebarOpen(true); break;
        case '=': case '+': e.preventDefault(); setScale(s => Math.min(5, +(s + 0.1).toFixed(2))); break;
        case '-': e.preventDefault(); setScale(s => Math.max(0.1, +(s - 0.1).toFixed(2))); break;
        case '0': e.preventDefault(); setScale(1.0); break;
        case 'n': e.preventDefault(); handleNewFile(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleOpen, handleSave, handleSaveAs, handleNewFile, ann, selectedAnnotationId, handleAnnDelete]);

  // ── Menu IPC ──
  useEffect(() => {
    const offs = [];
    const on = (ch, fn) => { const u = window.electronAPI.on(ch, fn); if (u) offs.push(u); };
    on('menu:new', handleNewFile); on('menu:save', handleSave); on('menu:saveAs', handleSaveAs);
    on('menu:undo', ann.undo); on('menu:redo', ann.redo);
    on('menu:zoomIn', () => setScale(s => Math.min(5, +(s + 0.25).toFixed(2))));
    on('menu:zoomOut', () => setScale(s => Math.max(0.1, +(s - 0.25).toFixed(2))));
    on('menu:zoomReset', () => setScale(1.0));
    on('menu:rotateCw', handleRotateCW);
    on('menu:rotateCcw', handleRotateCCW);
    on('menu:toolSelect', () => setActiveTool('select')); on('menu:toolHand', () => setActiveTool('hand'));
    on('menu:toolHighlight', () => setActiveTool('highlight')); on('menu:toolUnderline', () => setActiveTool('underline'));
    on('menu:toolStrikethrough', () => setActiveTool('strikethrough')); on('menu:toolStickyNote', () => setActiveTool('note'));
    on('menu:toolFreehand', () => setActiveTool('freehand')); on('menu:toolRectangle', () => setActiveTool('rectangle'));
    on('menu:toolEllipse', () => setActiveTool('ellipse')); on('menu:toolLine', () => setActiveTool('line'));
    on('menu:toolArrow', () => setActiveTool('arrow')); on('menu:toolText', () => setActiveTool('text'));
    on('menu:find', () => { setSidebarTab('search'); setLeftSidebarOpen(true); });
    on('menu:organizePages', () => setShowPageOrganizer(true));
    on('menu:export', () => setShowExport(true));
    on('menu:mergePDF', () => setShowMergePDF(true));
    on('menu:imagesToPdf', () => setShowImagesToPdf(true));
    on('menu:documentProperties', () => setShowDocumentProperties(true));
    on('menu:toolRedact', () => setActiveTool('redact'));
    on('menu:watermark', () => setShowWatermark(true));
    on('menu:headerFooter', () => setShowHeaderFooter(true));
    on('menu:protect', () => setShowProtect(true));
    on('menu:digitalSign', () => setSignDialog({}));
    on('menu:repair', () => handlePdfTool('repair'));
    on('menu:optimize', () => handlePdfTool('optimize'));
    on('menu:linearize', () => handlePdfTool('linearize'));
    on('menu:flattenForm', handleFlattenForm);
    return () => offs.forEach(c => { try { c(); } catch (_) {} });
  }, [handleSave, handleSaveAs, handleNewFile, ann, handleRotateCW, handleRotateCCW, handleFlattenForm, handlePdfTool]);

  const handleToolChange = useCallback(t => {
    if (t === 'signature') { setShowSignature(true); return; }
    if (t === 'stamp') { setShowStampPicker(true); return; }
    setActiveTool(t);
  }, []);

  return (
    <div className="app-container" onDragOver={handleDragOver} onDrop={handleDrop}>
      <Toolbar
        activeTool={activeTool} onToolChange={handleToolChange}
        canUndo={ann.canUndo} canRedo={ann.canRedo}
        onUndo={ann.undo} onRedo={ann.redo}
        onZoomIn={() => setScale(s => Math.min(5, +(s + 0.1).toFixed(2)))}
        onZoomOut={() => setScale(s => Math.max(0.1, +(s - 0.1).toFixed(2)))}
        onFitPage={handleFitPage} onFitWidth={handleFitWidth}
        onRotateCW={handleRotateCW} onRotateCCW={handleRotateCCW}
        searchQuery={searchQuery} onSearchChange={q => { setSearchQuery(q); if (q) { setSidebarTab('search'); setLeftSidebarOpen(true); } }}
        onSearchSubmit={() => { setSidebarTab('search'); setLeftSidebarOpen(true); }}
        onOpen={handleOpen} onSave={handleSave} onSaveAs={handleSaveAs}
        onPrint={handlePrint} onNewFile={handleNewFile} onOCR={handleOCR}
        ocrActive={ocrEditPage === currentPage}
        ocrRunning={!!pageOCRData[currentPage]?.running}
        onToggleLeftSidebar={() => setLeftSidebarOpen(o => !o)}
        onToggleRightSidebar={() => setRightSidebarOpen(o => !o)}
        leftSidebarOpen={leftSidebarOpen} rightSidebarOpen={rightSidebarOpen}
        hasDocument={hasDocument} scale={scale} onScaleChange={setScale}
        annotationColor={annotationColor} onColorChange={setAnnotationColor}
        annotationSize={annotationSize}   onSizeChange={setAnnotationSize}
        onOrganizePages={() => setShowPageOrganizer(true)}
        onExport={() => setShowExport(true)}
        onDocumentProperties={() => setShowDocumentProperties(true)}
        onMergePDF={() => setShowMergePDF(true)}
        onImagesToPdf={() => setShowImagesToPdf(true)}
        onWatermark={() => setShowWatermark(true)}
        onHeaderFooter={() => setShowHeaderFooter(true)}
        onProtect={() => setShowProtect(true)}
        onDigitalSign={() => setSignDialog({})}
        onPdfTool={handlePdfTool}
        onFlattenForm={handleFlattenForm}
        redactCount={redactAnnotations.length}
        onApplyRedactions={handleApplyRedactionsClick}
        isProtected={!!protection}
      />

      <div className="main-area" ref={viewerRef}>
        {leftSidebarOpen && (
          <Sidebar
            open={leftSidebarOpen}
            activeTab={sidebarTab} onTabChange={setSidebarTab}
            pageCount={pageCount} currentPage={currentPage} onPageSelect={setCurrentPage}
            hasDocument={hasDocument} thumbnails={thumbnails}
            annotations={ann.annotations} selectedAnnotationId={selectedAnnotationId}
            onAnnotationSelect={setSelectedAnnotationId} onAnnotationDelete={handleAnnDelete}
            searchQuery={searchQuery} onSearchChange={setSearchQuery}
            searchResults={searchResults}
            onSearchResultClick={p => { setCurrentPage(p); setSidebarTab('thumbnails'); }}
            outline={pageOutline}
          />
        )}

        {hasDocument ? (
          <div className="viewer-column">
          <SignatureBanner signatures={signatures} modified={isModified} onOpenPanel={() => setShowSigPanel(true)} />
          <PDFViewer
            pdfData={pdfData} scale={scale} currentPage={currentPage}
            setPageCount={setPageCount}
            activeTool={activeTool} annotations={ann.annotations}
            selectedAnnotationId={selectedAnnotationId}
            onAnnotationAdd={handleAnnAdd}
            onAnnotationSelect={setSelectedAnnotationId}
            onAnnotationDelete={handleAnnDelete}
            pendingStampType={pendingStampType}
            annotationColor={annotationColor}
            annotationSize={annotationSize}
            onThumbnailReady={handleThumbnailReady}
            onTextContent={handleTextContent}
            onPageImage={handlePageImage}
            onTextEditRequest={handleTextEditRequest}
            textEdit={textEdit}
            onTextEditChange={setTextEdit}
            onTextEditApply={handleTextEditApply}
            onTextEditCancel={() => setTextEdit(null)}
            pageOCRData={pageOCRData}
            ocrEditPage={ocrEditPage}
            onOCRCommit={handleOCRCommit}
            onOCRCancel={handleOCRCancel}
            onOutlineReady={handleOutlineReady}
            onFirstPageSize={handleFirstPageSize}
            formValues={formValues}
            onFormValueChange={handleFormValueChange}
            onPasswordRequired={handlePasswordRequired}
            onLoadError={handleLoadError}
          />
          </div>
        ) : (
          <WelcomeScreen onOpen={handleOpen} onNewFile={handleNewFile} isLoading={isLoading} />
        )}
      </div>

      <StatusBar
        currentPage={currentPage} pageCount={pageCount} scale={scale}
        onPageChange={setCurrentPage} isModified={isModified}
        isLoading={isLoading} fileName={fileName}
        isProtected={!!protection}
      />

      {showSignature && (
        <SignatureDialog
          onApply={dataUrl => { ann.addAnnotation('signature', { dataUrl, page: currentPage, x: 40, y: 40 }); setIsModified(true); }}
          onClose={() => setShowSignature(false)}
        />
      )}
      {showPageOrganizer && (
        <PageOrganizer
          pdfData={pdfData}
          thumbnails={thumbnails}
          currentPage={currentPage}
          pageCount={pageCount}
          fileName={fileName}
          onPdfChange={bytes => { setPdfData(bytes); setIsModified(true); setThumbnails({}); setPageTexts({}); setPageImages({}); setPageImageScales({}); setPageOCRData({}); }}
          onClose={() => setShowPageOrganizer(false)}
        />
      )}
      {showExport && (
        <ExportDialog
          pdfData={pdfData}
          pageImages={pageImages}
          pageTexts={pageTexts}
          currentPage={currentPage}
          pageCount={pageCount}
          fileName={fileName}
          onClose={() => setShowExport(false)}
        />
      )}
      {showDocumentProperties && (
        <DocumentPropertiesDialog
          pdfData={pdfData}
          onSave={bytes => { setPdfData(bytes); setIsModified(true); }}
          onClose={() => setShowDocumentProperties(false)}
        />
      )}
      {showMergePDF && (
        <MergePDFDialog
          onMerge={async bytes => { if (!(await guardUnsaved())) return; loadB64(toBase64(bytes), null, 'merged.pdf'); setIsModified(true); }}
          onClose={() => setShowMergePDF(false)}
        />
      )}
      {recoverable.length > 0 && (
        <RecoveryDialog items={recoverable} onRecover={handleRecover} onDiscard={handleDiscardRecovery} onClose={() => setRecoverable([])} />
      )}
      {showImagesToPdf && (
        <ImagesToPdfDialog
          onCreate={async bytes => { if (!(await guardUnsaved())) return; loadB64(toBase64(bytes), null, 'images.pdf'); setIsModified(true); }}
          onClose={() => setShowImagesToPdf(false)}
        />
      )}
      {showStampPicker && (
        <StampPickerDialog
          onSelect={stampType => { setPendingStampType(stampType); setActiveTool('stamp'); setShowStampPicker(false); }}
          onClose={() => setShowStampPicker(false)}
        />
      )}
      {showWatermark && (
        <WatermarkDialog
          pdfData={pdfData}
          pageCount={pageCount}
          currentPage={currentPage}
          onApply={bytes => { setPdfData(bytes); setIsModified(true); }}
          onClose={() => setShowWatermark(false)}
        />
      )}
      {showHeaderFooter && (
        <HeaderFooterDialog
          pdfData={pdfData}
          pageCount={pageCount}
          onApply={bytes => { setPdfData(bytes); setIsModified(true); }}
          onClose={() => setShowHeaderFooter(false)}
        />
      )}
      {signDialog && (
        <DigitalSignDialog
          initial={signDialog.initial}
          error={signDialog.error}
          onSign={handleSignSettings}
          onClose={() => setSignDialog(null)}
        />
      )}
      {pdfToolState && (
        <PdfToolResultDialog
          state={pdfToolState}
          onRepair={() => handlePdfTool('repair')}
          onClose={() => setPdfToolState(null)}
        />
      )}
      {showSigPanel && signatures && (
        <SignaturePanelDialog signatures={signatures} onClose={() => setShowSigPanel(false)} />
      )}
      {showProtect && (
        <ProtectDialog
          current={protection}
          onApply={settings => { setProtection(settings); setIsModified(true); }}
          onRemove={() => { setProtection(null); setIsModified(true); }}
          onClose={() => setShowProtect(false)}
        />
      )}
      {passwordPrompt && (
        <PasswordPromptDialog
          fileName={fileName}
          error={passwordPrompt.error}
          busy={passwordPrompt.busy}
          onSubmit={handlePasswordSubmit}
          onCancel={handlePasswordCancel}
        />
      )}
      {redactDialog && (
        <RedactDialog
          count={redactAnnotations.length || redactDialog.result?.boxes || 0}
          pages={[...new Set(redactAnnotations.map(a => a.page))].sort((a, b) => a - b)}
          busy={redactDialog.busy}
          result={redactDialog.result}
          onApply={handleRedactConfirm}
          onClose={() => setRedactDialog(null)}
        />
      )}
      {showUpdate && updateInfo && <UpdateDialog info={updateInfo} onClose={() => setShowUpdate(false)} />}
    </div>
  );
}
