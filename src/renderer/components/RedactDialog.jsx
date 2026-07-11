import React from 'react';

/** Confirm + result dialog for Apply Redactions. */
export default function RedactDialog({ count, pages, busy, result, onApply, onClose }) {
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          Apply Redactions
          {!busy && <button className="modal__close" onClick={onClose}>✕</button>}
        </div>
        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12 }}>
          {!result ? (
            <>
              <div>
                You are about to permanently redact <b>{count}</b> marked area{count === 1 ? '' : 's'} on
                page{pages.length === 1 ? '' : 's'} <b>{pages.join(', ')}</b>.
              </div>
              <div style={{ color: 'var(--text-muted)' }}>
                Text under each mark is <b>removed from the file</b>, not just covered.
                The result is verified; pages where content can't be cleanly removed
                (scans, images, rotated pages) are flattened to a picture with the
                redaction burned in — those pages lose selectable text.
              </div>
              <div style={{ color: 'var(--danger, #e74c3c)', fontWeight: 600 }}>
                This cannot be undone after saving.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600 }}>✓ Redactions applied</div>
              <div>{result.runsRemoved} text run{result.runsRemoved === 1 ? '' : 's'} removed, {result.boxes} area{result.boxes === 1 ? '' : 's'} blacked out.</div>
              {result.flattenedPages.length > 0 && (
                <div style={{ color: 'var(--text-muted)' }}>
                  Page{result.flattenedPages.length === 1 ? '' : 's'} {result.flattenedPages.join(', ')} flattened
                  to image to guarantee removal.
                </div>
              )}
              <div style={{ color: 'var(--text-muted)' }}>Save the document to keep the changes.</div>
            </>
          )}
        </div>
        <div className="modal__footer">
          {!result ? (
            <>
              <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={onApply} disabled={busy}
                style={{ background: busy ? undefined : '#c62828', borderColor: '#c62828' }}>
                {busy ? 'Redacting…' : 'Apply Redactions'}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
