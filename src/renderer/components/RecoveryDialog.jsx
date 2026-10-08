import React from 'react';

function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleString();
}

export default function RecoveryDialog({ items, onRecover, onDiscard, onClose }) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ minWidth: 480, maxWidth: 620 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Recover Unsaved Work
          <button className="modal__close" onClick={onClose} title="Decide later">✕</button>
        </div>
        <div className="modal__body">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
            PDF Forge didn't close normally last time. These documents had changes that weren't saved:
          </div>
          {items.map(item => (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 6,
              background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 4, fontSize: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.fileName}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  Autosaved {ago(item.savedAt)}{item.filePath ? ` · ${item.filePath}` : ' · never saved'}
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => onRecover(item)}>Recover</button>
              <button className="btn btn-secondary" onClick={() => onDiscard(item)}>Discard</button>
            </div>
          ))}
        </div>
        <div className="modal__footer">
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 'auto' }}>
            Closing this keeps the copies for next time.
          </span>
          <button className="btn btn-secondary" onClick={onClose}>Later</button>
        </div>
      </div>
    </div>
  );
}
