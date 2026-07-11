import React, { useState, useCallback, useRef } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';

function toBase64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

async function loadDoc(pdfData) {
  return PDFDocument.load(pdfData, { ignoreEncryption: true });
}

export default function PageOrganizer({ pdfData, thumbnails, currentPage, pageCount: pageCountProp, onPdfChange, onClose }) {
  // Prefer the real page count; fall back to loaded thumbnails if unset
  const pageCount = pageCountProp || Object.keys(thumbnails || {}).length;

  const [selected, setSelected]   = useState(new Set([currentPage - 1]));
  const [busy,     setBusy]       = useState(false);
  const [error,    setError]      = useState('');
  const [dragIdx,  setDragIdx]    = useState(null);
  const [dragOver, setDragOver]   = useState(null);
  // Local order array (indices into original pages)
  const [order, setOrder] = useState(() => Array.from({ length: pageCount }, (_, i) => i));

  const numPages = order.length;

  const toggle = (i) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(order.map((_, i) => i)));
  const clearAll  = () => setSelected(new Set());

  // ── Apply a pdf-lib operation and call onPdfChange ──
  const withDoc = useCallback(async (fn) => {
    if (!pdfData) return;
    setBusy(true);
    setError('');
    try {
      const doc  = await loadDoc(pdfData);
      const result = await fn(doc);
      if (result instanceof Uint8Array) {
        onPdfChange(result);
        onClose();
      }
    } catch (err) {
      console.error('PageOrganizer:', err);
      setError(err.message || 'Operation failed');
    } finally {
      setBusy(false);
    }
  }, [pdfData, onPdfChange, onClose]);

  // ── Delete selected pages ──
  const handleDelete = useCallback(() => {
    if (selected.size === 0) return;
    if (selected.size >= numPages) { setError('Cannot delete all pages'); return; }
    withDoc(async doc => {
      // Map selected display positions → original page indices → current page indices
      const origIndices = [...selected].map(i => order[i]);
      const sorted = [...origIndices].sort((a, b) => b - a);
      for (const idx of sorted) doc.removePage(idx);
      return doc.save();
    });
  }, [selected, numPages, order, withDoc]);

  // ── Rotate selected pages ──
  const handleRotate = useCallback((deg) => {
    if (selected.size === 0) return;
    withDoc(async doc => {
      const pages = doc.getPages();
      for (const i of selected) {
        const page = pages[order[i]];
        if (!page) continue;
        const angle = page.getRotation().angle;
        page.setRotation(degrees((angle + deg + 360) % 360));
      }
      return doc.save();
    });
  }, [selected, order, withDoc]);

  // ── Extract selected pages to new PDF ──
  const handleExtract = useCallback(async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setError('');
    try {
      const saveResult = await window.electronAPI.saveFileAs({
        title: 'Save Extracted Pages',
        defaultPath: 'extracted.pdf',
        filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
      });
      if (saveResult.canceled) { setBusy(false); return; }

      const doc    = await loadDoc(pdfData);
      const newDoc = await PDFDocument.create();
      const indices = [...selected].sort((a, b) => a - b).map(i => order[i]);
      const copied = await newDoc.copyPages(doc, indices);
      for (const p of copied) newDoc.addPage(p);
      const bytes  = await newDoc.save();
      await window.electronAPI.saveNow(toBase64(bytes), saveResult.filePath);
    } catch (err) {
      setError(err.message || 'Extract failed');
    } finally {
      setBusy(false);
    }
  }, [selected, order, pdfData]);

  // ── Duplicate selected pages (copies inserted after the originals) ──
  const handleDuplicate = useCallback(() => {
    if (selected.size === 0) return;
    withDoc(async doc => {
      const indices = [...selected].sort((a, b) => a - b).map(i => order[i]);
      const copied = await doc.copyPages(doc, indices);
      let insertAt = Math.max(...indices) + 1;
      for (const p of copied) { doc.insertPage(insertAt, p); insertAt++; }
      return doc.save();
    });
  }, [selected, order, withDoc]);

  // ── Insert pages from another PDF ──
  const handleInsert = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const opened = await window.electronAPI.openFile();
      if (opened.canceled || !opened.data) { setBusy(false); return; }

      const targetDoc = await loadDoc(pdfData);
      const srcBytes  = Uint8Array.from(atob(opened.data), c => c.charCodeAt(0));
      const srcDoc    = await loadDoc(srcBytes);
      const srcCount  = srcDoc.getPageCount();
      const insertAt  = selected.size > 0 ? Math.min(...selected) + 1 : targetDoc.getPageCount();
      const copied    = await targetDoc.copyPages(srcDoc, Array.from({ length: srcCount }, (_, i) => i));
      let pos = insertAt;
      for (const p of copied) { targetDoc.insertPage(pos, p); pos++; }
      const bytes = await targetDoc.save();
      onPdfChange(bytes);
      onClose();
    } catch (err) {
      setError(err.message || 'Insert failed');
    } finally {
      setBusy(false);
    }
  }, [pdfData, selected, onPdfChange, onClose]);

  // ── Apply current display order as a reorder ──
  const handleApplyOrder = useCallback(() => {
    withDoc(async doc => {
      const pages = doc.getPages();
      const newDoc = await PDFDocument.create();
      const copied = await newDoc.copyPages(doc, order);
      for (const p of copied) newDoc.addPage(p);
      return newDoc.save();
    });
  }, [order, withDoc]);

  // ── Drag-and-drop reorder ──
  const handleDragStart = (e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(idx);
  };
  const handleDrop = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOver(null); return; }
    const newOrder = [...order];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(idx, 0, moved);
    setOrder(newOrder);
    // Remap selected to new positions
    const selArr = [...selected].map(s => {
      const origIdx = order[s];
      return newOrder.indexOf(origIdx);
    }).filter(s => s !== -1);
    setSelected(new Set(selArr));
    setDragIdx(null);
    setDragOver(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDragOver(null); };

  const orderChanged = order.some((v, i) => v !== i);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 760, maxWidth: 900 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Organize Pages
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-secondary" onClick={selectAll} disabled={busy}>Select All</button>
            <button className="btn btn-secondary" onClick={clearAll}  disabled={busy}>Clear</button>
            <span style={{ width: 1, background: 'var(--border-color)', margin: '0 4px', alignSelf: 'stretch' }} />
            <button className="btn btn-secondary" onClick={handleDelete}       disabled={busy || selected.size === 0}>
              🗑 Delete
            </button>
            <button className="btn btn-secondary" onClick={() => handleRotate(90)}  disabled={busy || selected.size === 0}>
              ↻ Rotate Right
            </button>
            <button className="btn btn-secondary" onClick={() => handleRotate(-90)} disabled={busy || selected.size === 0}>
              ↺ Rotate Left
            </button>
            <button className="btn btn-secondary" onClick={handleExtract} disabled={busy || selected.size === 0}>
              ✂ Extract
            </button>
            <button className="btn btn-secondary" onClick={handleDuplicate} disabled={busy || selected.size === 0}>
              ⧉ Duplicate
            </button>
            <span style={{ width: 1, background: 'var(--border-color)', margin: '0 4px', alignSelf: 'stretch' }} />
            <button className="btn btn-secondary" onClick={handleInsert} disabled={busy}>
              ＋ Insert Pages…
            </button>
            {orderChanged && (
              <button className="btn btn-primary" onClick={handleApplyOrder} disabled={busy} style={{ marginLeft: 'auto' }}>
                Apply New Order
              </button>
            )}
          </div>

          {error && (
            <div style={{ marginBottom: 10, padding: '6px 10px', background: '#f44336', borderRadius: 4, fontSize: 12 }}>
              {error}
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            Drag pages to reorder · Click to select · {selected.size} of {numPages} selected
            {orderChanged && ' · Unsaved reorder — click "Apply New Order" to save'}
          </div>

          {/* Page grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: 8,
            maxHeight: 420,
            overflowY: 'auto',
            padding: 4,
          }}>
            {order.map((origIdx, displayIdx) => {
              const thumbUrl = thumbnails?.[origIdx + 1];
              const isSelected = selected.has(displayIdx);
              const isDragged  = dragIdx === displayIdx;
              const isOver     = dragOver === displayIdx;
              return (
                <div
                  key={origIdx}
                  draggable
                  onDragStart={e => handleDragStart(e, displayIdx)}
                  onDragOver={e  => handleDragOver(e, displayIdx)}
                  onDrop={e      => handleDrop(e, displayIdx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => toggle(displayIdx)}
                  style={{
                    border: isSelected ? '2px solid var(--accent)' : isOver ? '2px dashed var(--accent)' : '1px solid var(--border-color)',
                    borderRadius: 4,
                    background: isSelected ? 'var(--accent-light)' : isDragged ? 'var(--bg-hover)' : 'var(--bg-input)',
                    cursor: 'grab',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: 6,
                    opacity: isDragged ? 0.5 : 1,
                    transition: 'border-color 0.1s, background 0.1s',
                    userSelect: 'none',
                  }}
                >
                  <div style={{
                    width: '100%',
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 2,
                    marginBottom: 4,
                    minHeight: 140,
                    overflow: 'hidden',
                    background: '#fff',
                  }}>
                    {thumbUrl ? (
                      <img src={thumbUrl} alt={`Page ${origIdx + 1}`} style={{ width: '100%', display: 'block' }} />
                    ) : (
                      <span style={{ fontSize: 11, color: '#aaa' }}>p.{origIdx + 1}</span>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: isSelected ? 'var(--accent)' : 'var(--text-secondary)' }}>
                    {busy ? '…' : `Page ${displayIdx + 1}`}
                    {origIdx !== displayIdx && ` (was ${origIdx + 1})`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 8 }}>
            {busy && 'Working…'}
          </span>
        </div>
      </div>
    </div>
  );
}
