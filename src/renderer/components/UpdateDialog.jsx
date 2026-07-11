import React, { useState } from 'react';

export default function UpdateDialog({ info, onClose }) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    setProgress('Downloading...');

    try {
      const result = await window.electronAPI.downloadUpdate(info.version);

      if (result.success) {
        setProgress(`Downloaded to ${result.path}. Please close PDF Forge and run the installer.`);
      } else {
        setError(result.error || 'Download failed');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 400, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          🔄 Update Available
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          <div style={{
            background: 'var(--accent-light)',
            border: '1px solid var(--accent)',
            borderRadius: 8, padding: 16, marginBottom: 16,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              Version {info.version} is available
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              You have {info.currentVersion || '?'} · Source: {info.source || 'network'}
            </div>
          </div>

          {info.releaseNotes && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Release Notes:
              </div>
              <div style={{
                background: 'var(--bg-input)', borderRadius: 6, padding: 12,
                fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap',
                maxHeight: 120, overflow: 'auto',
              }}>
                {info.releaseNotes}
              </div>
            </div>
          )}

          {progress && (
            <div style={{
              background: 'var(--bg-input)', borderRadius: 6, padding: 12,
              fontSize: 12, color: 'var(--success)', marginBottom: 12,
            }}>
              {progress}
            </div>
          )}

          {error && (
            <div style={{
              background: 'var(--danger)', color: '#fff', borderRadius: 6,
              padding: 12, fontSize: 12, marginBottom: 12,
            }}>
              {error}
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Auto-update checks your local network and Tailscale for updates.
            Place an update server at <code>pdf-update.local:3000</code> or
            on your Tailscale network to receive updates automatically.
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Later
          </button>
          <button
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={downloading || !!progress}
          >
            {downloading ? 'Downloading...' : 'Download Update'}
          </button>
        </div>
      </div>
    </div>
  );
}
