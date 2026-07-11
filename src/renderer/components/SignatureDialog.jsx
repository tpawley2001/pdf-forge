import React, { useState, useRef, useCallback } from 'react';
import { IconClose } from './Icons';

function UploadSignature({ onDataUrl }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);

  const handleFile = useCallback(e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setPreview(ev.target.result);
    reader.readAsDataURL(file);
  }, []);

  return (
    <div>
      <div
        style={{ border: '2px dashed var(--border-color)', borderRadius: 8, padding: 20, textAlign: 'center', cursor: 'pointer', marginBottom: 10 }}
        onClick={() => inputRef.current?.click()}
      >
        {preview ? (
          <img src={preview} alt="signature preview" style={{ maxWidth: '100%', maxHeight: 120 }} />
        ) : (
          <>
            <div style={{ fontSize: 28 }}>📁</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>Click to select an image</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>PNG or JPEG recommended</div>
          </>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={handleFile} />
      {preview && (
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => onDataUrl(preview)}>
          Use This Signature
        </button>
      )}
    </div>
  );
}

export default function SignatureDialog({ onApply, onClose }) {
  const [mode, setMode] = useState('draw'); // 'draw' | 'type' | 'upload'
  const [typedName, setTypedName] = useState('');
  const drawCanvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);

  const handleApply = () => {
    if (mode === 'type' && typedName) {
      onApply(typedName); // Pass the typed name as signature
    }
    if (mode === 'draw' && drawCanvasRef.current) {
      const dataUrl = drawCanvasRef.current.toDataURL('image/png');
      onApply(dataUrl);
    }
    onClose();
  };

  const startDraw = (e) => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    const rect = canvas.getBoundingClientRect();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setDrawing(true);
  };

  const draw = (e) => {
    if (!drawing || !drawCanvasRef.current) return;
    const canvas = drawCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDraw = () => setDrawing(false);

  const clearDraw = () => {
    const canvas = drawCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#1565C0';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 500 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Add Signature
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 16, background: 'var(--bg-input)', borderRadius: 6, padding: 3 }}>
            {['type', 'draw', 'upload'].map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1, padding: '6px 12px', borderRadius: 4, border: 'none',
                  cursor: 'pointer', fontSize: 12,
                  background: mode === m ? 'var(--accent)' : 'transparent',
                  color: mode === m ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {m === 'type' ? '✎ Type' : m === 'draw' ? '✐ Draw' : '📁 Upload'}
              </button>
            ))}
          </div>

          {mode === 'type' && (
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Type your name</label>
              <input
                type="text"
                value={typedName}
                onChange={e => setTypedName(e.target.value)}
                placeholder="Your signature..."
                style={{
                  width: '100%', marginTop: 8, padding: '10px 12px',
                  background: 'var(--bg-input)', border: '1px solid var(--border-input)',
                  borderRadius: 4, color: 'var(--text-primary)', fontSize: 16, outline: 'none',
                }}
              />
              {typedName && (
                <div style={{
                  marginTop: 16, padding: 16, border: '1px dashed var(--border-color)',
                  borderRadius: 4, textAlign: 'center',
                }}>
                  <span style={{
                    fontFamily: "'Brush Script MT', 'Great Vibes', 'Pacifico', cursive",
                    fontSize: 48, color: '#1565C0',
                  }}>
                    {typedName}
                  </span>
                </div>
              )}
            </div>
          )}

          {mode === 'draw' && (
            <div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Draw your signature below
              </p>
              <canvas
                ref={drawCanvasRef}
                width={440}
                height={140}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
                style={{
                  border: '1px solid var(--border-input)', borderRadius: 4,
                  background: '#fff', cursor: 'crosshair', width: '100%',
                }}
              />
              <button onClick={clearDraw} className="btn btn-secondary" style={{ marginTop: 8 }}>
                Clear
              </button>
            </div>
          )}

          {mode === 'upload' && (
            <UploadSignature onDataUrl={url => { onApply(url); onClose(); }} />
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>Apply Signature</button>
        </div>
      </div>
    </div>
  );
}
