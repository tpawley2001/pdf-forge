import React, { useState } from 'react';

/**
 * Update dialog (GitHub Releases, see src/main/updater.js).
 * info.updateAvailable → download (checksum-verified) → Install and restart.
 * Otherwise it reports "up to date" or that the check failed (Help → Check for Updates…).
 */
export default function UpdateDialog({ info, onClose }) {
  const [stage, setStage] = useState('idle');   // idle | downloading | ready | installing
  const [error, setError] = useState('');

  const download = async () => {
    setStage('downloading'); setError('');
    try {
      const r = await window.electronAPI.downloadUpdate(info.version);
      if (r?.success) setStage('ready');
      else { setError(r?.error || 'Download failed'); setStage('idle'); }
    } catch (err) { setError(err.message); setStage('idle'); }
  };

  const install = async () => {
    setStage('installing'); setError('');
    try {
      const r = await window.electronAPI.installUpdate();
      if (!r?.success) { setError(r?.error || 'Could not start the installer'); setStage('ready'); }
    } catch (err) { setError(err.message); setStage('ready'); }
  };

  const box = { borderRadius: 8, padding: 16, marginBottom: 16, background: 'var(--accent-light)', border: '1px solid var(--accent)' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal update-dialog" style={{ minWidth: 400, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          {info.updateAvailable ? 'Update Available' : 'Check for Updates'}
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          {info.updateAvailable ? (
            <div style={box}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>PDF Forge {info.version} is available</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>You have {info.currentVersion || '?'}</div>
            </div>
          ) : info.offline ? (
            <div style={box}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Couldn't check for updates</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{info.error || 'No connection to GitHub.'} You have {info.currentVersion}.</div>
            </div>
          ) : (
            <div style={box}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>You're up to date</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>PDF Forge {info.currentVersion} is the latest version.</div>
            </div>
          )}

          {info.updateAvailable && info.releaseNotes && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>What's new:</div>
              <div className="update-dialog__notes" style={{
                background: 'var(--bg-input)', borderRadius: 6, padding: 12,
                fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto',
              }}>
                {info.releaseNotes.replace(/\*\*|`/g, '')}
              </div>
            </div>
          )}

          {stage === 'ready' && !error && (
            <div style={{ background: 'var(--bg-input)', borderRadius: 6, padding: 12, fontSize: 12, color: 'var(--success)', marginBottom: 12 }}>
              Downloaded and verified. PDF Forge will close, install the update (Windows asks for permission) and start again.
            </div>
          )}
          {stage === 'installing' && (
            <div style={{ background: 'var(--bg-input)', borderRadius: 6, padding: 12, fontSize: 12, marginBottom: 12 }}>Starting the installer… click <b>Yes</b> when Windows asks for permission.</div>
          )}
          {error && (
            <div className="update-dialog__error" style={{ background: 'var(--danger)', color: '#fff', borderRadius: 6, padding: 12, fontSize: 12, marginBottom: 12 }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onClose}>{info.updateAvailable ? 'Later' : 'Close'}</button>
          {info.updateAvailable && (stage === 'idle' || stage === 'downloading') && (
            <button className="btn btn-primary" onClick={download} disabled={stage === 'downloading'}>
              {stage === 'downloading' ? 'Downloading…' : 'Download Update'}
            </button>
          )}
          {info.updateAvailable && (stage === 'ready' || stage === 'installing') && (
            <button className="btn btn-primary" onClick={install} disabled={stage === 'installing'}>Install and restart</button>
          )}
        </div>
      </div>
    </div>
  );
}
