import React, { useState } from 'react';

/**
 * ProtectDialog — configure password protection (Acrobat "Protect Using
 * Password"). Settings are held in App state and applied at Save time so the
 * in-memory document stays editable.
 */
export default function ProtectDialog({ current, onApply, onRemove, onClose }) {
  const [userPassword, setUserPassword] = useState(current?.userPassword || '');
  const [confirm, setConfirm] = useState(current?.userPassword || '');
  const [ownerPassword, setOwnerPassword] = useState(current?.ownerPassword || '');
  const [perms, setPerms] = useState(current?.permissions || {
    printing: true, copying: true, modifying: false,
    annotating: true, fillingForms: true,
  });
  const [error, setError] = useState('');

  const setPerm = (key, val) => setPerms(p => ({ ...p, [key]: val }));

  const handleApply = () => {
    if (!userPassword && !ownerPassword) { setError('Set at least one password'); return; }
    if (userPassword !== confirm) { setError('Passwords do not match'); return; }
    onApply({ userPassword, ownerPassword: ownerPassword || userPassword, permissions: perms });
    onClose();
  };

  const permRow = (key, label) => (
    <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
      <input type="checkbox" checked={perms[key] !== false} onChange={e => setPerm(key, e.target.checked)} />
      {label}
    </label>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Protect with Password
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Encryption is applied when you <b>Save</b> the document.
          </div>

          <label className="dialog-field">
            <span>Password to open (user password)</span>
            <input type="password" value={userPassword} autoFocus
              onChange={e => setUserPassword(e.target.value)} />
          </label>
          <label className="dialog-field">
            <span>Confirm password</span>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </label>
          <label className="dialog-field">
            <span>Permissions password (owner — optional)</span>
            <input type="password" value={ownerPassword}
              onChange={e => setOwnerPassword(e.target.value)}
              placeholder="Defaults to the open password" />
          </label>

          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>Allow readers to:</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {permRow('printing', 'Print')}
            {permRow('copying', 'Copy text & images')}
            {permRow('modifying', 'Modify content')}
            {permRow('annotating', 'Comment / annotate')}
            {permRow('fillingForms', 'Fill form fields')}
          </div>

          {error && <div className="dialog-error">{error}</div>}
        </div>
        <div className="modal__footer">
          {current && (
            <button className="btn btn-secondary" style={{ marginRight: 'auto', color: 'var(--danger, #e74c3c)' }}
              onClick={() => { onRemove(); onClose(); }}>
              Remove Protection
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>Set Protection</button>
        </div>
      </div>
    </div>
  );
}
