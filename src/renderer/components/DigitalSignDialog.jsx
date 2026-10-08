import React, { useEffect, useState } from 'react';

/**
 * DigitalSignDialog — Acrobat "Use a certificate" / "Digitally Sign".
 * Pick (or create) a .p12/.pfx Digital ID, unlock it, choose reason and
 * appearance, optionally timestamp it. The private key never leaves the main
 * process; this dialog only handles the file path and password.
 */

const REASONS = [
  'I am the author of this document',
  'I have reviewed this document',
  'I am approving this document',
  'I agree to the terms defined by the placement of my signature on this document',
];

const DEFAULT_TSA = 'http://timestamp.digicert.com';

const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString() : '');

export default function DigitalSignDialog({ initial, error: externalError, onSign, onClose }) {
  const api = window.electronAPI;
  const [ids, setIds] = useState([]);
  const [idPath, setIdPath] = useState(initial?.idPath || '');
  const [password, setPassword] = useState(initial?.password || '');
  const [id, setId] = useState(initial?.id || null);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState({ name: '', email: '', organization: '', password: '', confirm: '' });
  const [reason, setReason] = useState(initial?.reason ?? REASONS[2]);
  const [location, setLocation] = useState(initial?.location || '');
  const [contact, setContact] = useState(initial?.contact || '');
  const [visible, setVisible] = useState(initial?.visible ?? true);
  const [useTsa, setUseTsa] = useState(initial?.tsaUrl != null ? !!initial.tsaUrl : false);
  const [tsaUrl, setTsaUrl] = useState(initial?.tsaUrl || DEFAULT_TSA);
  const [ltv, setLtv] = useState(!!initial?.ltv);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(externalError || '');

  useEffect(() => {
    api?.signRecentIds?.().then(list => {
      setIds(list || []);
      if (!idPath && list?.length) setIdPath(list[0].path);
    });
  }, []);

  const addId = (info) => {
    setIds(prev => [info, ...prev.filter(x => x.path !== info.path)]);
    setIdPath(info.path);
    setId(null);
  };

  const browse = async () => {
    const r = await api.signPickId();
    if (r && !r.canceled) addId(r);
  };

  const unlock = async () => {
    if (!idPath) { setError('Choose a Digital ID first.'); return null; }
    setBusy(true); setError('');
    try {
      const r = await api.signReadId(idPath, password);
      if (!r.success) { setError(r.error); setId(null); return null; }
      setId(r.id);
      return r.id;
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!newId.name.trim()) { setError('Enter your name.'); return; }
    if (newId.password.length < 6) { setError('Use a password of at least 6 characters.'); return; }
    if (newId.password !== newId.confirm) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.signCreateId({ name: newId.name.trim(), email: newId.email.trim(), organization: newId.organization.trim(), password: newId.password });
      if (r?.canceled) return;
      if (!r?.success) { setError(r?.error || 'Could not create Digital ID'); return; }
      addId({ path: r.path, fileName: r.fileName });
      setPassword(newId.password);
      setId(r.id);
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const unlocked = id || await unlock();
    if (!unlocked) return;
    if (unlocked.expired) { setError('This Digital ID has expired.'); return; }
    onSign({
      idPath, password, id: unlocked,
      reason: reason.trim(), location: location.trim(), contact: contact.trim(),
      visible,
      tsaUrl: useTsa ? tsaUrl.trim() : '',
      ltv: ltv && !unlocked.selfSigned,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 500 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Sign with Digital ID
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!creating ? (
            <>
              <label className="dialog-field">
                <span>Digital ID (.pfx / .p12)</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={idPath} onChange={e => { setIdPath(e.target.value); setId(null); }} style={{ flex: 1 }}>
                    {!ids.length && <option value="">No Digital ID selected</option>}
                    {ids.map(x => <option key={x.path} value={x.path} title={x.path}>{x.fileName}</option>)}
                  </select>
                  <button className="btn btn-secondary" onClick={browse}>Browse…</button>
                  <button className="btn btn-secondary" onClick={() => { setCreating(true); setError(''); }}>Create…</button>
                </div>
              </label>
              <label className="dialog-field">
                <span>Password</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="password" value={password} autoFocus style={{ flex: 1 }}
                    onChange={e => { setPassword(e.target.value); setId(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') unlock(); }} />
                  <button className="btn btn-secondary" onClick={unlock} disabled={busy || !idPath}>Unlock</button>
                </div>
              </label>
              {id && (
                <div className="sig-id-card">
                  <div><b>{id.name}</b>{id.email ? ` <${id.email}>` : ''}</div>
                  <div>Issued by {id.issuer}{id.selfSigned ? ' (self-signed)' : ''} · valid until {fmtDate(id.validTo)}</div>
                  {id.selfSigned && (
                    <div className="sig-id-card__warn">Self-signed IDs prove the document wasn't changed, but readers must trust your certificate manually to verify who signed.</div>
                  )}
                  {id.expired && <div className="sig-id-card__warn">This Digital ID has expired.</div>}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Creates a self-signed Digital ID (RSA 2048, SHA-256) saved as a password-protected .pfx file.
              </div>
              <label className="dialog-field"><span>Name</span>
                <input value={newId.name} autoFocus onChange={e => setNewId(v => ({ ...v, name: e.target.value }))} /></label>
              <label className="dialog-field"><span>Email (optional)</span>
                <input value={newId.email} onChange={e => setNewId(v => ({ ...v, email: e.target.value }))} /></label>
              <label className="dialog-field"><span>Organization (optional)</span>
                <input value={newId.organization} onChange={e => setNewId(v => ({ ...v, organization: e.target.value }))} /></label>
              <label className="dialog-field"><span>Password</span>
                <input type="password" value={newId.password} onChange={e => setNewId(v => ({ ...v, password: e.target.value }))} /></label>
              <label className="dialog-field"><span>Confirm password</span>
                <input type="password" value={newId.confirm} onChange={e => setNewId(v => ({ ...v, confirm: e.target.value }))} /></label>
            </>
          )}

          {!creating && (
            <>
              <label className="dialog-field">
                <span>Reason</span>
                <input list="sig-reasons" value={reason} onChange={e => setReason(e.target.value)} />
                <datalist id="sig-reasons">{REASONS.map(r => <option key={r} value={r} />)}</datalist>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label className="dialog-field"><span>Location (optional)</span>
                  <input value={location} onChange={e => setLocation(e.target.value)} /></label>
                <label className="dialog-field"><span>Contact (optional)</span>
                  <input value={contact} onChange={e => setContact(e.target.value)} /></label>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="radio" checked={visible} onChange={() => setVisible(true)} /> Visible signature (drag to place)
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="radio" checked={!visible} onChange={() => setVisible(false)} /> Invisible
                </label>
              </div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                <input type="checkbox" checked={useTsa} onChange={e => setUseTsa(e.target.checked)} />
                Add a trusted timestamp (needs internet)
              </label>
              {useTsa && (
                <label className="dialog-field"><span>Timestamp server (RFC 3161)</span>
                  <input value={tsaUrl} onChange={e => setTsaUrl(e.target.value)} /></label>
              )}
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, opacity: id?.selfSigned ? 0.5 : 1 }}>
                <input type="checkbox" checked={ltv && !id?.selfSigned} disabled={id?.selfSigned}
                  onChange={e => setLtv(e.target.checked)} />
                Embed revocation info for long-term validation (LTV, needs internet)
              </label>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Pending edits, comments and form entries are saved into the document first. The signed PDF is saved as a new file —
                any later change to it invalidates the signature.
              </div>
            </>
          )}

          {error && <div className="dialog-error">{error}</div>}
        </div>
        <div className="modal__footer">
          {creating ? (
            <>
              <button className="btn btn-secondary" onClick={() => { setCreating(false); setError(''); }}>Back</button>
              <button className="btn btn-primary" onClick={create} disabled={busy}>Create &amp; Save ID…</button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={busy || !idPath}>
                {visible ? 'Place & Sign…' : 'Sign & Save…'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
