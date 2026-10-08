import React from 'react';

/**
 * Signature status for the open document — the Acrobat blue bar
 * ("Signed and all signatures are valid") plus a details dialog.
 */

export function signatureStatus(signatures) {
  if (!signatures?.length) return null;
  const latest = signatures[signatures.length - 1];
  if (signatures.some(s => !s.intact)) {
    return { level: 'error', text: 'At least one signature is invalid — the document was altered or the signature is damaged.' };
  }
  if (!latest.coversWholeDocument) {
    return { level: 'warn', text: 'Signed, but the document has been changed since the last signature was applied.' };
  }
  const untrusted = signatures.filter(s => !s.trusted && s.kind !== 'timestamp');
  if (untrusted.length) {
    return {
      level: 'info',
      text: `Signed and all signatures are valid. Signer identity not verified for ${[...new Set(untrusted.map(s => s.signer))].join(', ')}.`,
    };
  }
  return { level: 'ok', text: 'Signed and all signatures are valid.' };
}

export function SignatureBanner({ signatures, modified, onOpenPanel }) {
  const status = signatureStatus(signatures);
  if (!status) return null;
  return (
    <div className={`sig-banner sig-banner--${modified ? 'warn' : status.level}`}>
      <span className="sig-banner__icon">{status.level === 'error' ? '✖' : status.level === 'ok' && !modified ? '✔' : '⚠'}</span>
      <span>{status.text}{modified ? ' Saving your changes will invalidate the signatures.' : ''}</span>
      <button className="btn btn-secondary" onClick={onOpenPanel}>Signature Panel</button>
    </div>
  );
}

const fmt = iso => (iso ? new Date(iso).toLocaleString() : 'unknown time');

export function SignaturePanelDialog({ signatures, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Signatures
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60vh', overflow: 'auto' }}>
          {signatures.map((s, i) => (
            <div key={`${s.field}-${i}`} className={`sig-entry ${s.intact ? '' : 'sig-entry--bad'}`}>
              <div className="sig-entry__title">
                {s.intact ? '✔' : '✖'} Rev. {i + 1}: {s.kind === 'timestamp' ? 'Document timestamp' : `Signed by ${s.signer || 'unknown'}`}
                {s.email ? ` <${s.email}>` : ''}
              </div>
              <ul>
                <li>{s.intact
                  ? 'Document has not been modified since this signature was applied.'
                  : `Signature is invalid${s.error ? `: ${s.error}` : ' — signed content was altered.'}`}</li>
                {s.intact && !s.coversWholeDocument && <li>The document was updated after this signature (later revisions or signatures).</li>}
                <li>{s.trusted
                  ? `Signer's identity is valid (issued by ${s.issuer}).`
                  : s.selfSigned
                  ? 'Signer\'s identity is unknown — self-signed certificate.'
                  : `Signer's identity could not be verified (issued by ${s.issuer || 'unknown'}).`}</li>
                <li>Signing time: {fmt(s.signingTime)}{s.timestamp?.ok ? ` (trusted timestamp from ${s.timestamp.authority})` : s.timestamp ? ' (timestamp invalid)' : ' (from signer\'s clock)'}</li>
                {s.reason && <li>Reason: {s.reason}</li>}
                {s.location && <li>Location: {s.location}</li>}
                {s.certValidTo && <li>Certificate valid until {new Date(s.certValidTo).toLocaleDateString()}</li>}
              </ul>
            </div>
          ))}
        </div>
        <div className="modal__footer">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
