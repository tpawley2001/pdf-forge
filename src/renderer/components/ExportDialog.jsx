import React, { useState } from 'react';
import { PDFDocument } from 'pdf-lib';

function toBase64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

function parsePageRange(rangeStr, max) {
  const indices = new Set();
  const parts = rangeStr.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      if (!isNaN(a) && !isNaN(b)) {
        for (let i = Math.max(1, a); i <= Math.min(max, b); i++) indices.add(i);
      }
    } else {
      const n = Number(part);
      if (!isNaN(n) && n >= 1 && n <= max) indices.add(n);
    }
  }
  return [...indices].sort((a, b) => a - b);
}

export default function ExportDialog({ pdfData, pageImages, pageTexts, currentPage, pageCount, fileName, onClose }) {
  const [format,      setFormat]      = useState('pdf');
  const [pageRange,   setPageRange]   = useState('all');
  const [customRange, setCustomRange] = useState('');
  const [quality,     setQuality]     = useState(92);
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState('');
  const [done,        setDone]        = useState('');

  const baseName = (fileName || 'document').replace(/\.pdf$/i, '');

  function getPageNums() {
    if (pageRange === 'all')     return Array.from({ length: pageCount }, (_, i) => i + 1);
    if (pageRange === 'current') return [currentPage];
    return parsePageRange(customRange, pageCount);
  }

  const handleExport = async () => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const pages = getPageNums();
      if (pages.length === 0) { setError('No valid pages in range'); setBusy(false); return; }

      if (format === 'pdf') {
        // Export selected pages as PDF
        const saveResult = await window.electronAPI.saveFileAs({
          title: 'Export PDF',
          defaultPath: pages.length === pageCount ? `${baseName}.pdf` : `${baseName}-pages.pdf`,
          filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
        });
        if (saveResult.canceled) { setBusy(false); return; }

        if (pages.length === pageCount) {
          // Full doc — just write the existing bytes
          await window.electronAPI.saveNow(toBase64(pdfData), saveResult.filePath);
        } else {
          // Subset — extract pages
          const doc    = await PDFDocument.load(pdfData, { ignoreEncryption: true });
          const newDoc = await PDFDocument.create();
          const indices = pages.map(p => p - 1);
          const copied = await newDoc.copyPages(doc, indices);
          for (const p of copied) newDoc.addPage(p);
          const bytes = await newDoc.save();
          await window.electronAPI.saveNow(toBase64(bytes), saveResult.filePath);
        }
        setDone(`Saved ${pages.length} page${pages.length !== 1 ? 's' : ''} as PDF`);

      } else if (format === 'png' || format === 'jpeg') {
        const ext = format === 'jpeg' ? 'jpg' : 'png';
        if (pages.length === 1) {
          const dataUrl = pageImages?.[pages[0]];
          if (!dataUrl) { setError(`Page ${pages[0]} image not rendered yet — scroll to it first`); setBusy(false); return; }

          const saveResult = await window.electronAPI.saveFileAs({
            title: `Export as ${format.toUpperCase()}`,
            defaultPath: `${baseName}-page${pages[0]}.${ext}`,
            filters: [{ name: `${format.toUpperCase()} Image`, extensions: [ext] }],
          });
          if (saveResult.canceled) { setBusy(false); return; }

          const exportUrl = format === 'jpeg' ? await convertToJpeg(dataUrl, quality) : dataUrl;
          await window.electronAPI.saveNow(exportUrl.split(',')[1], saveResult.filePath);
          setDone(`Saved page ${pages[0]} as ${format.toUpperCase()}`);
        } else {
          // Multiple pages — save to a folder
          const saveResult = await window.electronAPI.saveFileAs({
            title: `Export first page as ${format.toUpperCase()} (others saved alongside)`,
            defaultPath: `${baseName}-page${pages[0]}.${ext}`,
            filters: [{ name: `${format.toUpperCase()} Image`, extensions: [ext] }],
          });
          if (saveResult.canceled) { setBusy(false); return; }

          const basePath = saveResult.filePath.replace(/(-page\d+)?\.\w+$/, '');
          let saved = 0;
          for (const p of pages) {
            const dataUrl = pageImages?.[p];
            if (!dataUrl) continue;
            const exportUrl = format === 'jpeg' ? await convertToJpeg(dataUrl, quality) : dataUrl;
            const outPath = `${basePath}-page${p}.${ext}`;
            // We need to authorize each path — use the same dir as the chosen path
            const result = await window.electronAPI.saveNow(exportUrl.split(',')[1], outPath);
            if (result?.success) saved++;
          }
          setDone(`Saved ${saved} image${saved !== 1 ? 's' : ''}`);
        }

      } else if (format === 'text') {
        const saveResult = await window.electronAPI.saveFileAs({
          title: 'Export as Text',
          defaultPath: `${baseName}.txt`,
          filters: [{ name: 'Text Files', extensions: ['txt'] }],
        });
        if (saveResult.canceled) { setBusy(false); return; }

        const lines = pages.map(p => {
          const text = pageTexts?.[p] || '';
          return `--- Page ${p} ---\n${text}`;
        });
        const full = lines.join('\n\n');
        const b64  = btoa(unescape(encodeURIComponent(full)));
        await window.electronAPI.saveNow(b64, saveResult.filePath);
        setDone(`Exported text from ${pages.length} page${pages.length !== 1 ? 's' : ''}`);
      }
    } catch (err) {
      console.error('Export failed:', err);
      setError(err.message || 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  async function convertToJpeg(dataUrl, q) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', q / 100));
      };
      img.src = dataUrl;
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Export Document
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          {/* Format */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              Export Format
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { id: 'pdf',  label: 'PDF',  icon: '📄' },
                { id: 'png',  label: 'PNG',  icon: '🖼' },
                { id: 'jpeg', label: 'JPEG', icon: '📸' },
                { id: 'text', label: 'Text', icon: '📝' },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  style={{
                    flex: 1, padding: '10px 8px', borderRadius: 4,
                    border: format === f.id ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                    background: format === f.id ? 'var(--accent-light)' : 'var(--bg-input)',
                    cursor: 'pointer', textAlign: 'center', color: 'var(--text-primary)',
                  }}
                >
                  <div style={{ fontSize: 20 }}>{f.icon}</div>
                  <div style={{ fontSize: 11, color: format === f.id ? 'var(--accent)' : 'var(--text-secondary)' }}>
                    {f.label}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Page Range */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              Page Range
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { id: 'all',     label: `All Pages (${pageCount})` },
                { id: 'current', label: `Current Page (${currentPage})` },
                { id: 'custom',  label: 'Custom Range' },
              ].map(r => (
                <label key={r.id} style={{ fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-primary)' }}>
                  <input type="radio" name="pageRange" checked={pageRange === r.id} onChange={() => setPageRange(r.id)} />
                  {r.label}
                </label>
              ))}
              {pageRange === 'custom' && (
                <input
                  type="text"
                  value={customRange}
                  onChange={e => setCustomRange(e.target.value)}
                  placeholder="e.g. 1,3,5-7"
                  autoFocus
                  style={{
                    padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-input)',
                    borderRadius: 4, color: 'var(--text-primary)', fontSize: 12, outline: 'none', width: 200,
                  }}
                />
              )}
            </div>
          </div>

          {/* Quality (for JPEG) */}
          {format === 'jpeg' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Quality: {quality}%
              </label>
              <input
                type="range" min={10} max={100} value={quality}
                onChange={e => setQuality(parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
              />
            </div>
          )}

          {format === 'png' && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              PNG export uses the current rendered resolution. Scroll to each page first to ensure it's rendered.
            </div>
          )}

          {format === 'text' && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              Text extraction works best on PDFs with real text (not scanned images). Use OCR for scanned pages.
            </div>
          )}

          {error && (
            <div style={{ padding: '6px 10px', background: '#f44336', borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
              {error}
            </div>
          )}
          {done && (
            <div style={{ padding: '6px 10px', background: '#4caf50', borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
              ✓ {done}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={handleExport} disabled={busy}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
