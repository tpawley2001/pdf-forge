import React from 'react';

/** Result / prompt for Repair, Reduce File Size and Fast Web View. */
export default function PdfToolResultDialog({ state, onRepair, onClose }) {
  const { title, message, error, offerRepair, busy } = state;
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          {title}
          {!busy && <button className="modal__close" onClick={onClose}>✕</button>}
        </div>
        <div className="modal__body" style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {busy ? 'Working…' : message}
          {error && <div className="dialog-error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
        <div className="modal__footer">
          {offerRepair && !busy && <button className="btn btn-primary" onClick={onRepair}>Repair</button>}
          {!busy && <button className={offerRepair ? 'btn btn-secondary' : 'btn btn-primary'} onClick={onClose}>{offerRepair ? 'Cancel' : 'OK'}</button>}
        </div>
      </div>
    </div>
  );
}
