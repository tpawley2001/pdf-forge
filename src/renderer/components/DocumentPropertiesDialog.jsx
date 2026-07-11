import React, { useState, useEffect } from 'react';
import { PDFDocument } from 'pdf-lib';

function toBase64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

export default function DocumentPropertiesDialog({ pdfData, onSave, onClose }) {
  const [fields, setFields] = useState({
    title: '', author: '', subject: '', keywords: '',
    creator: '', producer: '', creationDate: '', modDate: '',
  });
  const [pageCount, setPageCount] = useState(0);
  const [fileSize, setFileSize]   = useState(0);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!pdfData) return;
    setFileSize(pdfData.byteLength || pdfData.length || 0);
    PDFDocument.load(pdfData, { ignoreEncryption: true }).then(doc => {
      setPageCount(doc.getPageCount());
      setFields({
        title:       doc.getTitle()       || '',
        author:      doc.getAuthor()      || '',
        subject:     doc.getSubject()     || '',
        keywords:    (doc.getKeywords()   || []).join(', '),
        creator:     doc.getCreator()     || '',
        producer:    doc.getProducer()    || '',
        creationDate: doc.getCreationDate()?.toISOString?.() || '',
        modDate:     doc.getModificationDate()?.toISOString?.() || '',
      });
    }).catch(() => {});
  }, [pdfData]);

  const handleSave = async () => {
    setBusy(true);
    setError('');
    try {
      const doc = await PDFDocument.load(pdfData, { ignoreEncryption: true });
      doc.setTitle(fields.title);
      doc.setAuthor(fields.author);
      doc.setSubject(fields.subject);
      doc.setKeywords(fields.keywords ? fields.keywords.split(',').map(k => k.trim()).filter(Boolean) : []);
      doc.setCreator(fields.creator);
      doc.setProducer(fields.producer);
      doc.setModificationDate(new Date());
      const bytes = await doc.save();
      onSave(bytes);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save properties');
    } finally {
      setBusy(false);
    }
  };

  const field = (label, key, readOnly = false, hint = '') => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>{label}</label>
      <input
        type="text"
        value={fields[key]}
        onChange={e => !readOnly && setFields(f => ({ ...f, [key]: e.target.value }))}
        readOnly={readOnly}
        placeholder={hint || label}
        style={{
          width: '100%', padding: '6px 8px',
          background: readOnly ? 'var(--bg-app)' : 'var(--bg-input)',
          border: '1px solid var(--border-input)', borderRadius: 4,
          color: readOnly ? 'var(--text-secondary)' : 'var(--text-primary)',
          fontSize: 12, outline: 'none',
        }}
      />
    </div>
  );

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Document Properties
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          {/* Info row */}
          <div style={{
            display: 'flex', gap: 24, marginBottom: 16, padding: '8px 10px',
            background: 'var(--bg-app)', borderRadius: 4, fontSize: 11, color: 'var(--text-muted)',
          }}>
            <span><b>{pageCount}</b> pages</span>
            <span><b>{formatSize(fileSize)}</b></span>
          </div>

          {/* Editable fields */}
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Editable Metadata
          </div>
          {field('Title', 'title', false, 'Document title')}
          {field('Author', 'author', false, 'Author name')}
          {field('Subject', 'subject', false, 'Subject or description')}
          {field('Keywords', 'keywords', false, 'Comma-separated keywords')}

          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: '16px 0 8px' }}>
            Document Info (read-only)
          </div>
          {field('Creator Application', 'creator', true)}
          {field('PDF Producer', 'producer', true)}
          {field('Creation Date', 'creationDate', true)}
          {field('Last Modified', 'modDate', true)}

          {error && (
            <div style={{ padding: '6px 10px', background: '#f44336', borderRadius: 4, fontSize: 12, marginTop: 8 }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save Properties'}
          </button>
        </div>
      </div>
    </div>
  );
}
