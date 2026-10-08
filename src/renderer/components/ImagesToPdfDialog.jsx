import React, { useState } from 'react';
import { imagesToPdf, detectImageType } from '../../pdf/ImagesToPdf';

function fromBase64(b64) {
  const bin = atob(b64);
  const u8  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export default function ImagesToPdfDialog({ onCreate, onClose }) {
  const [images, setImages]         = useState([]); // { name, data (Uint8Array), thumbUrl }
  const [pageSize, setPageSize]     = useState('auto');
  const [orientation, setOrientation] = useState('auto');
  const [margin, setMargin]         = useState(0);
  const [busy,  setBusy]            = useState(false);
  const [error, setError]           = useState('');

  const handleAddImages = async () => {
    setError('');
    try {
      const result = await window.electronAPI.openImageFiles();
      if (result.canceled) return;
      const added = [];
      for (const f of result.files || []) {
        const bytes = fromBase64(f.data);
        const type  = detectImageType(bytes);
        if (!type) {
          setError(`${f.fileName}: only JPEG and PNG images are supported`);
          continue;
        }
        const mime = type === 'jpg' ? 'image/jpeg' : 'image/png';
        added.push({ name: f.fileName, data: bytes, thumbUrl: `data:${mime};base64,${f.data}` });
      }
      setImages(prev => [...prev, ...added]);
    } catch (err) {
      setError(err.message || 'Failed to open images');
    }
  };

  const moveUp = (i) => {
    if (i === 0) return;
    setImages(prev => { const a = [...prev]; [a[i-1], a[i]] = [a[i], a[i-1]]; return a; });
  };
  const moveDown = (i) => {
    setImages(prev => { if (i >= prev.length - 1) return prev; const a = [...prev]; [a[i], a[i+1]] = [a[i+1], a[i]]; return a; });
  };
  const remove = (i) => setImages(prev => prev.filter((_, idx) => idx !== i));

  const handleCreate = async () => {
    if (images.length === 0) { setError('Add at least one image'); return; }
    setBusy(true);
    setError('');
    try {
      const bytes = await imagesToPdf(images, { pageSize, orientation, margin: Number(margin) || 0 });
      onCreate(bytes);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create PDF');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Create PDF from Images
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Each image becomes one page, in the order below. Use the arrows to reorder.
          </div>

          {images.length === 0 ? (
            <div style={{
              border: '2px dashed var(--border-color)', borderRadius: 6,
              padding: 40, textAlign: 'center', color: 'var(--text-muted)',
              marginBottom: 12,
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🖼️</div>
              <div style={{ fontSize: 13 }}>No images added yet</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Click "Add Images" to select JPEG or PNG files</div>
            </div>
          ) : (
            <div style={{ marginBottom: 12, maxHeight: 260, overflowY: 'auto' }}>
              {images.map((img, i) => (
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
                  <img
                    src={img.thumbUrl} alt=""
                    style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--border-color)' }}
                  />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                    {img.name}
                  </span>
                  <button
                    onClick={() => moveUp(i)} disabled={i === 0}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 3px', fontSize: 14 }}
                    title="Move up"
                  >↑</button>
                  <button
                    onClick={() => moveDown(i)} disabled={i === images.length - 1}
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
                {images.length} image{images.length !== 1 ? 's' : ''} · {images.length} page{images.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}

          <button className="btn btn-secondary" onClick={handleAddImages} disabled={busy} style={{ marginBottom: 12 }}>
            ＋ Add Images…
          </button>

          {/* Page options */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Page size<br />
              <select value={pageSize} onChange={e => setPageSize(e.target.value)} style={{ marginTop: 4 }}>
                <option value="auto">Fit to image</option>
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
                <option value="legal">Legal</option>
              </select>
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Orientation<br />
              <select value={orientation} onChange={e => setOrientation(e.target.value)} disabled={pageSize === 'auto'} style={{ marginTop: 4 }}>
                <option value="auto">Auto</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Margin (pts)<br />
              <input
                type="number" min="0" max="200" value={margin}
                onChange={e => setMargin(e.target.value)}
                disabled={pageSize === 'auto'}
                style={{ marginTop: 4, width: 70 }}
              />
            </label>
          </div>

          {error && (
            <div style={{ padding: '6px 10px', background: '#f44336', borderRadius: 4, fontSize: 12, marginTop: 8 }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={busy || images.length === 0}>
            {busy ? 'Creating…' : `Create PDF${images.length > 0 ? ` (${images.length} pages)` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
