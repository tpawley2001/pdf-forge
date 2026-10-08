import React, { useEffect, useRef, useState } from 'react';

function genericFamily(name) {
  if (/mono|courier|consol/i.test(name || '')) return 'monospace';
  if (/sans|arial|helvetica|calibri|verdana|segoe|tahoma|gothic/i.test(name || '')) return 'sans-serif';
  return 'serif';
}

const COLORS = ['#000000', '#e74c3c', '#3498db', '#2ecc71', '#e67e22', '#ffffff'];

export default function TextReplacementOverlay({ edit, scale, onChange, onApply, onCancel }) {
  const [drag, setDrag] = useState(null);
  const textRef = useRef(null);

  useEffect(() => {
    textRef.current?.focus();
    textRef.current?.select();
  }, [edit?.page, edit?.bbox?.x, edit?.bbox?.y]);

  if (!edit) return null;

  const update = changes => onChange?.({ ...edit, ...changes });
  const updateBbox = changes => update({ bbox: { ...edit.bbox, ...changes } });

  const startMove = (e, mode) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag({
      mode,
      startX: e.clientX,
      startY: e.clientY,
      bbox: { ...edit.bbox },
    });
  };

  useEffect(() => {
    if (!drag) return undefined;

    const move = e => {
      const dx = (e.clientX - drag.startX) / scale;
      const dy = (e.clientY - drag.startY) / scale;
      if (drag.mode === 'move') {
        updateBbox({
          x: Math.max(0, drag.bbox.x + dx),
          y: Math.max(0, drag.bbox.y + dy),
        });
      } else {
        updateBbox({
          width: Math.max(16, drag.bbox.width + dx),
          height: Math.max(12, drag.bbox.height + dy),
        });
      }
    };

    const stop = () => setDrag(null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
  }, [drag, scale, edit]);

  return (
    <div
      className="text-edit-overlay"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{
        left: edit.bbox.x * scale,
        top: edit.bbox.y * scale,
        width: edit.bbox.width * scale,
        minHeight: edit.bbox.height * scale,
      }}
    >
      <div className="text-edit-overlay__bar" onMouseDown={e => startMove(e, 'move')}>
        <span>{edit.pdfium ? `Paragraph · ${edit.fontFamily || 'original font'}` : 'Drag to position'}</span>
        <button onClick={onCancel}>Cancel</button>
        <button className="text-edit-overlay__apply" onClick={() => onApply?.(edit)}>Apply</button>
      </div>

      <textarea
        ref={textRef}
        value={edit.text}
        onChange={e => update({ text: e.target.value })}
        onKeyDown={e => {
          if (e.key === 'Escape') onCancel?.();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onApply?.(edit);
        }}
        style={{
          fontSize: `${edit.fontSize * scale}px`,
          ...(edit.pdfium ? {
            lineHeight: `${edit.pdfium.lineHeight * scale}px`,
            fontFamily: `"${edit.fontFamily}", ${genericFamily(edit.fontFamily)}`,
            minHeight: `${(edit.bbox.height + edit.pdfium.lineHeight * 0.5) * scale}px`,
          } : {}),
          color: edit.color,
          fontWeight: edit.bold ? 700 : 400,
          fontStyle: edit.italic ? 'italic' : 'normal',
          textAlign: edit.align || 'left',
        }}
      />

      <div className="text-edit-overlay__controls">
        <label>
          Size
          <input
            type="number"
            min="4"
            max="96"
            value={edit.fontSize}
            onChange={e => update({ fontSize: Number(e.target.value) || 12 })}
          />
        </label>
        {!edit.pdfium && (
          <label>
            Pad
            <input
              type="number"
              min="0"
              max="32"
              value={edit.paddingX ?? 3}
              onChange={e => {
                const value = Number(e.target.value) || 0;
                update({ paddingX: value, paddingY: Math.max(0, Math.round(value * 0.65)) });
              }}
            />
          </label>
        )}
        <button className={edit.bold ? 'active' : ''} style={{ fontWeight: 700 }} onClick={() => update({ bold: !edit.bold })}>B</button>
        <button className={edit.italic ? 'active' : ''} style={{ fontStyle: 'italic' }} onClick={() => update({ italic: !edit.italic })}>I</button>
        <select value={edit.align || 'left'} onChange={e => update({ align: e.target.value })}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
          <option value="justify">Justify</option>
        </select>
        {!edit.pdfium && (
          <label className="text-edit-overlay__check">
            <input
              type="checkbox"
              checked={edit.whiteout !== false}
              onChange={e => update({ whiteout: e.target.checked })}
            />
            Whiteout
          </label>
        )}
        <div className="text-edit-overlay__colors">
          {COLORS.map(color => (
            <button
              key={color}
              className={edit.color === color ? 'active' : ''}
              style={{ background: color }}
              onClick={() => update({ color })}
              aria-label={`Text color ${color}`}
            />
          ))}
        </div>
      </div>

      <button
        className="text-edit-overlay__resize"
        onMouseDown={e => startMove(e, 'resize')}
        aria-label="Resize text edit box"
      />
    </div>
  );
}
