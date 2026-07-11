import React, { useState } from 'react';
import { addWatermark, parsePageRange } from '../../pdf/PageDecorations.js';

const WM_COLORS = [
  { hex: '#808080', label: 'Gray' },
  { hex: '#c62828', label: 'Red' },
  { hex: '#1565c0', label: 'Blue' },
  { hex: '#2e7d32', label: 'Green' },
];

export default function WatermarkDialog({ pdfData, pageCount, currentPage, onApply, onClose }) {
  const [text, setText] = useState('CONFIDENTIAL');
  const [diagonal, setDiagonal] = useState(true);
  const [opacity, setOpacity] = useState(0.25);
  const [color, setColor] = useState('#808080');
  const [fontSize, setFontSize] = useState(0); // 0 = auto
  const [rangeMode, setRangeMode] = useState('all'); // all | current | custom
  const [customRange, setCustomRange] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleApply = async () => {
    if (!text.trim()) { setError('Enter watermark text'); return; }
    setBusy(true);
    setError('');
    try {
      const pageIndices =
        rangeMode === 'current' ? [currentPage - 1]
        : rangeMode === 'custom' ? parsePageRange(customRange, pageCount)
        : undefined;
      if (rangeMode === 'custom' && (!pageIndices || pageIndices.length === 0)) {
        setError('Page range is empty — use e.g. "1-3, 5"');
        setBusy(false);
        return;
      }
      const bytes = await addWatermark(pdfData, {
        text: text.trim(),
        diagonal,
        opacity,
        color,
        fontSize: fontSize > 0 ? fontSize : undefined,
        pageIndices,
      });
      onApply(bytes);
      onClose();
    } catch (err) {
      console.error('Watermark:', err);
      setError(err.message || 'Failed to add watermark');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Add Watermark
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="dialog-field">
            <span>Text</span>
            <input type="text" value={text} onChange={e => setText(e.target.value)} autoFocus
              placeholder="CONFIDENTIAL, DRAFT, DO NOT COPY…" />
          </label>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
              <input type="checkbox" checked={diagonal} onChange={e => setDiagonal(e.target.checked)} />
              Diagonal
            </label>
            <span style={{ fontSize: 12 }}>Color:</span>
            {WM_COLORS.map(c => (
              <div key={c.hex}
                className={`color-swatch${color === c.hex ? ' color-swatch--active' : ''}`}
                style={{ background: c.hex }} title={c.label}
                onClick={() => setColor(c.hex)} />
            ))}
          </div>

          <label className="dialog-field">
            <span>Opacity: {Math.round(opacity * 100)}%</span>
            <input type="range" min={5} max={100} value={opacity * 100}
              onChange={e => setOpacity(Number(e.target.value) / 100)} />
          </label>

          <label className="dialog-field">
            <span>Font size (0 = auto-fit)</span>
            <input type="number" min={0} max={200} value={fontSize}
              onChange={e => setFontSize(Number(e.target.value) || 0)} style={{ width: 90 }} />
          </label>

          <div className="dialog-field">
            <span>Pages</span>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12 }}>
              <label><input type="radio" checked={rangeMode === 'all'} onChange={() => setRangeMode('all')} /> All</label>
              <label><input type="radio" checked={rangeMode === 'current'} onChange={() => setRangeMode('current')} /> Current</label>
              <label><input type="radio" checked={rangeMode === 'custom'} onChange={() => setRangeMode('custom')} /> Range:</label>
              <input type="text" value={customRange} placeholder="1-3, 5"
                onChange={e => { setCustomRange(e.target.value); setRangeMode('custom'); }}
                style={{ width: 90 }} />
            </div>
          </div>

          {error && <div className="dialog-error">{error}</div>}
        </div>
        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={busy}>
            {busy ? 'Applying…' : 'Apply Watermark'}
          </button>
        </div>
      </div>
    </div>
  );
}
