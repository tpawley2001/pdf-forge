import React, { useState, useRef, useEffect } from 'react';

// blocks bboxes are in PDF points; multiply by scale to get screen pixels
export default function OCROverlay({ blocks, scale = 1, onCommit, onCancel }) {
  const [editBlocks, setEditBlocks] = useState(() =>
    blocks.map(b => ({ ...b, _origText: b.text, _dirty: false }))
  );
  const [editingId, setEditingId] = useState(null);
  const [editText,  setEditText]  = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editingId !== null) inputRef.current?.focus();
  }, [editingId]);

  const flushEdit = (blocks = editBlocks) => {
    if (editingId === null) return blocks;
    return blocks.map(b =>
      b._id === editingId
        ? { ...b, text: editText, _dirty: editText.trim() !== b._origText.trim() }
        : b
    );
  };

  const startEdit = (block) => {
    if (editingId !== null) {
      setEditBlocks(prev => flushEdit(prev));
    }
    setEditingId(block._id);
    setEditText(block.text);
  };

  const commitEdit = () => {
    setEditBlocks(prev => flushEdit(prev));
    setEditingId(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') cancelEdit();
  };

  const handleApply = () => {
    const final = flushEdit(editBlocks);
    onCommit(final);
  };

  const liveBlocks = editingId !== null
    ? editBlocks.map(b => b._id === editingId ? { ...b, text: editText, _dirty: editText.trim() !== b._origText.trim() } : b)
    : editBlocks;
  const dirtyCount = liveBlocks.filter(b => b._dirty).length;

  return (
    <div className="ocr-overlay">
      <div className="ocr-control-bar">
        <span className="ocr-control-bar__info">
          {editBlocks.length} block{editBlocks.length !== 1 ? 's' : ''}
          {dirtyCount > 0 && <span className="ocr-control-bar__dirty"> · {dirtyCount} edited</span>}
        </span>
        <span className="ocr-control-bar__hint">Click any highlighted text to edit</span>
        <button
          className="btn btn-primary ocr-control-bar__btn"
          onClick={handleApply}
          disabled={dirtyCount === 0}
        >
          Apply Edits
        </button>
        <button className="btn btn-secondary ocr-control-bar__btn" onClick={onCancel}>
          Discard
        </button>
      </div>

      {editBlocks.map(block => {
        const isEditing = editingId === block._id;
        // bbox is in PDF points — scale to current screen pixels
        const px = block.bbox.x      * scale;
        const py = block.bbox.y      * scale;
        const pw = block.bbox.width  * scale;
        const ph = block.bbox.height * scale;
        const fontSize = Math.max(10, Math.round(ph * 0.72));

        return (
          <div
            key={block._id}
            className={`ocr-block${block._dirty ? ' ocr-block--dirty' : ''}${isEditing ? ' ocr-block--editing' : ''}`}
            style={{
              left:   px,
              top:    py,
              width:  Math.max(pw, 24),
              height: Math.max(ph, 12),
            }}
            title={`${Math.round(block.confidence)}% confidence — click to edit`}
            onClick={e => { e.stopPropagation(); if (!isEditing) startEdit(block); }}
          >
            {isEditing && (
              <textarea
                ref={inputRef}
                className="ocr-block__input"
                value={editText}
                onChange={e => setEditText(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={commitEdit}
                style={{ fontSize }}
              />
            )}
            {!isEditing && block._dirty && (
              <span className="ocr-block__badge">✓</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
