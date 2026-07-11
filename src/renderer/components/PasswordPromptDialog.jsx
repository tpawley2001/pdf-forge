import React, { useState } from 'react';

/** Shown when an encrypted PDF is opened. Unlocks the file into the session. */
export default function PasswordPromptDialog({ fileName, onSubmit, onCancel, error, busy }) {
  const [password, setPassword] = useState('');

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 380 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">🔒 Password Required</div>
        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12 }}>
            “{fileName || 'This document'}” is password-protected.
          </div>
          <label className="dialog-field">
            <span>Password</span>
            <input
              type="password" value={password} autoFocus
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && password) onSubmit(password); }}
            />
          </label>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            The document will be unlocked for this session. Saving writes an
            unprotected copy unless you re-apply protection (Document → Protect).
          </div>
          {error && <div className="dialog-error">{error}</div>}
        </div>
        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSubmit(password)} disabled={busy || !password}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  );
}
