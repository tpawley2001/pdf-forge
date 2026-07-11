import React, { useState } from 'react';
import { addHeaderFooter, parsePageRange } from '../../pdf/PageDecorations.js';

export default function HeaderFooterDialog({ pdfData, pageCount, onApply, onClose }) {
  const [hLeft, setHLeft] = useState('');
  const [hCenter, setHCenter] = useState('');
  const [hRight, setHRight] = useState('');
  const [fLeft, setFLeft] = useState('');
  const [fCenter, setFCenter] = useState('Page {page} of {pages}');
  const [fRight, setFRight] = useState('');
  const [fontSize, setFontSize] = useState(10);
  const [batesStart, setBatesStart] = useState(1);
  const [batesDigits, setBatesDigits] = useState(6);
  const [range, setRange] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleApply = async () => {
    const slots = [hLeft, hCenter, hRight, fLeft, fCenter, fRight];
    if (!slots.some(s => s.trim())) { setError('Fill in at least one header or footer slot'); return; }
    setBusy(true);
    setError('');
    try {
      const pageIndices = range.trim() ? parsePageRange(range, pageCount) : undefined;
      if (range.trim() && (!pageIndices || !pageIndices.length)) {
        setError('Page range is empty — use e.g. "1-3, 5" or leave blank for all');
        setBusy(false);
        return;
      }
      const bytes = await addHeaderFooter(pdfData, {
        header: { left: hLeft, center: hCenter, right: hRight },
        footer: { left: fLeft, center: fCenter, right: fRight },
        fontSize: fontSize || 10,
        batesStart: batesStart || 1,
        batesDigits: batesDigits || 6,
        pageIndices,
      });
      onApply(bytes);
      onClose();
    } catch (err) {
      console.error('Header/Footer:', err);
      setError(err.message || 'Failed to add header/footer');
    } finally {
      setBusy(false);
    }
  };

  const slotInput = (label, value, setter, placeholder = '') => (
    <label className="dialog-field" style={{ flex: 1, minWidth: 0 }}>
      <span>{label}</span>
      <input type="text" value={value} placeholder={placeholder}
        onChange={e => setter(e.target.value)} />
    </label>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Header &amp; Footer / Page Numbers
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Tokens: <code>{'{page}'}</code> <code>{'{pages}'}</code> <code>{'{date}'}</code> <code>{'{bates}'}</code>
            &nbsp;— e.g. “Page {'{page}'} of {'{pages}'}”, Bates: “ACME-{'{bates}'}”
          </div>

          <div style={{ fontSize: 12, fontWeight: 600 }}>Header</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {slotInput('Left', hLeft, setHLeft)}
            {slotInput('Center', hCenter, setHCenter)}
            {slotInput('Right', hRight, setHRight, '{date}')}
          </div>

          <div style={{ fontSize: 12, fontWeight: 600 }}>Footer</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {slotInput('Left', fLeft, setFLeft, 'ACME-{bates}')}
            {slotInput('Center', fCenter, setFCenter)}
            {slotInput('Right', fRight, setFRight)}
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="dialog-field">
              <span>Font size</span>
              <input type="number" min={6} max={24} value={fontSize}
                onChange={e => setFontSize(Number(e.target.value))} style={{ width: 64 }} />
            </label>
            <label className="dialog-field">
              <span>Bates start #</span>
              <input type="number" min={0} value={batesStart}
                onChange={e => setBatesStart(Number(e.target.value))} style={{ width: 90 }} />
            </label>
            <label className="dialog-field">
              <span>Bates digits</span>
              <input type="number" min={3} max={10} value={batesDigits}
                onChange={e => setBatesDigits(Number(e.target.value))} style={{ width: 64 }} />
            </label>
            <label className="dialog-field" style={{ flex: 1 }}>
              <span>Pages (blank = all)</span>
              <input type="text" value={range} placeholder="1-3, 5"
                onChange={e => setRange(e.target.value)} />
            </label>
          </div>

          {error && <div className="dialog-error">{error}</div>}
        </div>
        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={busy}>
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
