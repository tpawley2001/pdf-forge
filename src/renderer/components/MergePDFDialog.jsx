import React, { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { assemble } from '../../pdf/DocAssembler.js';

function fromBase64(b64) {
  const bin = atob(b64);
  const u8  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export default function MergePDFDialog({ onMerge, onClose }) {
  const [files, setFiles] = useState([]); // { name, data (Uint8Array), pages }
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');
  const [fileBookmarks, setFileBookmarks] = useState(true);

  const handleAddFiles = async () => {
    setError('');
    try {
      const result = await window.electronAPI.openMultipleFiles();
      if (result.canceled) return;
      const newFiles = [];
      for (const f of result.files || []) {
        try {
          const bytes = fromBase64(f.data);
          const doc   = await PDFDocument.load(bytes, { ignoreEncryption: true });
          newFiles.push({ name: f.fileName, data: bytes, pages: doc.getPageCount() });
        } catch (err) {
          console.error(`Failed to load ${f.fileName}:`, err);
        }
      }
      setFiles(prev => [...prev, ...newFiles]);
    } catch (err) {
      setError(err.message || 'Failed to open files');
    }
  };

  const moveUp = (i) => {
    if (i === 0) return;
    setFiles(prev => { const a = [...prev]; [a[i-1], a[i]] = [a[i], a[i-1]]; return a; });
  };
  const moveDown = (i) => {
    setFiles(prev => { if (i >= prev.length - 1) return prev; const a = [...prev]; [a[i], a[i+1]] = [a[i+1], a[i]]; return a; });
  };
  const remove = (i) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  const totalPages = files.reduce((sum, f) => sum + f.pages, 0);

  const handleMerge = async () => {
    if (files.length === 0) { setError('Add at least one PDF file'); return; }
    setBusy(true);
    setError('');
    try {
      const parts = [];
      for (const f of files) {
        const doc = await PDFDocument.load(f.data, { ignoreEncryption: true });
        parts.push({ doc, title: f.name.replace(/\.pdf$/i, '') });
      }
      // Keeps links, bookmarks, form fields, layers and attachments working.
      const merged = await assemble(parts, { fileBookmarks });
      const bytes = await merged.save();
      onMerge(bytes);
      onClose();
    } catch (err) {
      setError(err.message || 'Merge failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Merge PDF Files
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Add PDF files in the order you want them merged. Drag or use the arrows to reorder.
          </div>

          {/* File list */}
          {files.length === 0 ? (
            <div style={{
              border: '2px dashed var(--border-color)', borderRadius: 6,
              padding: 40, textAlign: 'center', color: 'var(--text-muted)',
              marginBottom: 12,
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
              <div style={{ fontSize: 13 }}>No files added yet</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Click "Add PDFs" to select files</div>
            </div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              {files.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', marginBottom: 4,
                    background: 'var(--bg-input)', borderRadius: 4,
                    border: '1px solid var(--border-color)', fontSize: 12,
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', minWidth: 20 }}>{i + 1}.</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                    {f.name}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {f.pages} page{f.pages !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={() => moveUp(i)} disabled={i === 0}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 3px', fontSize: 14 }}
                    title="Move up"
                  >↑</button>
                  <button
                    onClick={() => moveDown(i)} disabled={i === files.length - 1}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 3px', fontSize: 14 }}
                    title="Move down"
                  >↓</button>
                  <button
                    onClick={() => remove(i)}
                    style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0 3px', fontSize: 14 }}
                    title="Remove"
                  >✕</button>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                {files.length} file{files.length !== 1 ? 's' : ''} · {totalPages} total pages
              </div>
            </div>
          )}

          <button className="btn btn-secondary" onClick={handleAddFiles} disabled={busy} style={{ marginBottom: 4 }}>
            ＋ Add PDFs…
          </button>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 8, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={fileBookmarks} onChange={e => setFileBookmarks(e.target.checked)} />
            Add a bookmark for each file (its own bookmarks nest underneath)
          </label>

          {error && (
            <div style={{ padding: '6px 10px', background: '#f44336', borderRadius: 4, fontSize: 12, marginTop: 8 }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleMerge} disabled={busy || files.length === 0}>
            {busy ? 'Merging…' : `Merge ${files.length > 0 ? `(${totalPages} pages)` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
