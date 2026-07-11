import React from 'react';

const STAMPS = [
  { id: 'Approved',     label: 'APPROVED',      color: '#e53935' },
  { id: 'Draft',        label: 'DRAFT',          color: '#1565C0' },
  { id: 'Confidential', label: 'CONFIDENTIAL',   color: '#b71c1c' },
  { id: 'For Review',   label: 'FOR REVIEW',     color: '#2e7d32' },
  { id: 'Void',         label: 'VOID',           color: '#6d4c41' },
  { id: 'Final',        label: 'FINAL',          color: '#1b5e20' },
  { id: 'Expired',      label: 'EXPIRED',        color: '#757575' },
  { id: 'Not Approved', label: 'NOT APPROVED',   color: '#c62828' },
  { id: 'Revised',      label: 'REVISED',        color: '#e65100' },
  { id: 'Received',     label: 'RECEIVED',       color: '#283593' },
  { id: 'Copy',         label: 'COPY',           color: '#4a4a4a' },
  { id: 'Sign Here',    label: 'SIGN HERE',      color: '#1565C0' },
];

export default function StampPickerDialog({ onSelect, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Choose a Stamp
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Select a stamp type, then click on the document to place it.
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
          }}>
            {STAMPS.map(stamp => (
              <button
                key={stamp.id}
                onClick={() => onSelect(stamp.id)}
                style={{
                  padding: '10px 8px',
                  background: 'var(--bg-input)',
                  border: `2px solid ${stamp.color}`,
                  borderRadius: 4,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: stamp.color,
                  fontWeight: 'bold',
                  fontSize: 11,
                  letterSpacing: 1,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = `${stamp.color}22`}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-input)'}
              >
                {stamp.label}
              </button>
            ))}
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
