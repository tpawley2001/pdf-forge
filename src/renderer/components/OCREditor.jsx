import React, { useState, useEffect, useRef } from 'react';
import { recognizePage, confidenceColor } from '../services/ocr.js';

export default function OCREditor({ dataUrl, pageNum, onClose, onCommit }) {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState('Initializing OCR...');
  const [blocks, setBlocks] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editedText, setEditedText] = useState('');
  const [error, setError] = useState('');
  const editRef = useRef(null);

  // Run OCR on mount
  useEffect(() => {
    if (!dataUrl) { setError('No page image available'); setLoading(false); return; }

    setLoading(true);
    setError('');

    recognizePage(dataUrl, {
      onProgress: (info) => {
        if (info.status) {
          setProgress(`${info.status}${Number.isFinite(info.progress) ? `: ${Math.round(info.progress * 100)}%` : ''}`);
        }
        if (info.status === 'recognizing text') {
          setProgress(`OCR: ${Math.round(info.progress * 100)}%`);
        }
      },
    })
      .then((result) => {
        setBlocks(result.map((b, i) => ({ ...b, _id: i })));
        setLoading(false);
      })
      .catch((err) => {
        setError(err?.message || String(err) || 'OCR failed');
        setLoading(false);
      });
  }, [dataUrl]);

  // Focus edit field
  useEffect(() => {
    if (editingId && editRef.current) editRef.current.focus();
  }, [editingId]);

  const startEdit = (block) => {
    setEditingId(block._id);
    setEditedText(block.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditedText('');
  };

  const saveEdit = () => {
    setBlocks((prev) =>
      prev.map((b) => (b._id === editingId ? { ...b, text: editedText, _dirty: true } : b)),
    );
    setEditingId(null);
    setEditedText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    }
    if (e.key === 'Escape') cancelEdit();
  };

  // Commit all dirty edits back to PDF
  const handleCommit = async () => {
    const dirty = blocks.filter((b) => b._dirty);
    if (dirty.length === 0) { onClose(); return; }

    try {
      onCommit(dirty.map((b) => ({
        bbox: b.bbox,
        text: b.text,
        fontSize: Math.round(b.bbox.height * 0.72),
      })));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ minWidth: 520, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          🔍 OCR Text Editor — Page {pageNum}
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div className="loading-indicator">
                <div className="loading-dot" />
                <div className="loading-dot" />
                <div className="loading-dot" />
              </div>
              <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                {progress}
              </div>
            </div>
          )}

          {error && (
            <div style={{
              background: 'var(--danger)', color: '#fff',
              borderRadius: 6, padding: 12, fontSize: 12, marginBottom: 12,
            }}>
              {error}
            </div>
          )}

          {!loading && !error && blocks.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No text found on this page
            </div>
          )}

          {!loading && blocks.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                {blocks.length} text block{blocks.length !== 1 ? 's' : ''} recognized
                ({blocks.filter((b) => b._dirty).length} edited)
              </div>

              {/* Blocks list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {blocks.map((block, i) => {
                  const isEditing = editingId === block._id;
                  const conf = Math.round(block.confidence);
                  const color = confidenceColor(conf);

                  return (
                    <div
                      key={i}
                      style={{
                        border: '1px solid var(--border-light)',
                        borderRadius: 6,
                        padding: 10,
                        background: isEditing ? 'var(--accent-light)' : block._dirty ? 'var(--accent-light)' : 'var(--bg-input)',
                      }}
                    >
                      {/* Header: confidence + position */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        marginBottom: 6, fontSize: 11,
                      }}>
                        <span style={{
                          background: color, color: '#fff',
                          padding: '1px 6px', borderRadius: 3,
                          fontWeight: 600, fontSize: 10,
                        }}>
                          {conf}%
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          x:{Math.round(block.bbox.x)} y:{Math.round(block.bbox.y)}
                        </span>
                        {block._dirty && (
                          <span style={{ color: 'var(--warning)', marginLeft: 'auto' }}>● edited</span>
                        )}
                      </div>

                      {/* Text content */}
                      {isEditing ? (
                        <div>
                          <textarea
                            ref={editRef}
                            value={editedText}
                            onChange={(e) => setEditedText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={2}
                            style={{
                              width: '100%',
                              background: 'var(--bg-app)',
                              border: '1px solid var(--border-focus)',
                              borderRadius: 4,
                              color: 'var(--text-primary)',
                              fontSize: 13,
                              padding: 8,
                              resize: 'vertical',
                              fontFamily: 'inherit',
                            }}
                          />
                          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                            <button className="btn btn-primary" onClick={saveEdit}>Save</button>
                            <button className="btn btn-secondary" onClick={cancelEdit}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => startEdit(block)}
                          style={{
                            fontSize: 13,
                            color: 'var(--text-primary)',
                            cursor: 'text',
                            lineHeight: 1.5,
                            padding: '4px 6px',
                            borderRadius: 3,
                            wordBreak: 'break-word',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--bg-hover)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          {block.text || '(empty)'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="modal__footer">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 'auto' }}>
            Click text to edit. Edits are committed as whiteout+rewrite.
          </div>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleCommit}
            disabled={loading || blocks.filter((b) => b._dirty).length === 0}
          >
            Apply Edits
          </button>
        </div>
      </div>
    </div>
  );
}
