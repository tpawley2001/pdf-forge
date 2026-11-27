import React, { useState, useRef, useEffect, useCallback } from 'react';
import { snapField, labelForRect } from '../../pdf/FormDetector.js';
import { toPdfRect, fromPdfRect } from '../services/formDetect';

/**
 * FieldEditLayer — "fix the fields" mode for a flat form that PDF Forge made fillable.
 *
 * Point at a blank the scan missed and click: the field snaps to the line / box / check box
 * under the pointer (the preview shows what you'll get). Drag to draw a field of any size.
 * Every field shows a × to remove it (for things that aren't blanks at all).
 *
 * Works in two pixel spaces: the on-screen page (`viewport`, viewer scale) and the detector's
 * 2× render (`analysis.vp`) where the snap candidates live. Both share rotation and origin,
 * so one is a plain multiple of the other.
 */

const DRAG_MIN = 4;   // px of movement before a press counts as drawing a box

export default function FieldEditLayer({ pageNum, viewport, fields, analysis, editType = 'auto', onAdd, onRemove }) {
  const layerRef = useRef(null);
  const [hover, setHover] = useState(null);     // snap preview, viewer px
  const [drag, setDrag] = useState(null);       // { x0, y0, x1, y1 } viewer px
  const dragRef = useRef(null);

  const vp = viewport;
  const avp = analysis?.vp || null;
  const k = avp ? avp.scale / vp.scale : 1;      // viewer px → analysis px
  const ptScale = avp ? avp.scale : vp.scale;    // analysis px per PDF point

  const local = e => {
    const r = layerRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const existingPx = useCallback(() =>
    (fields || []).map(f => fromPdfRect(f.rect, avp || vp)), [fields, avp, vp]);

  /** The field a click at (x, y) viewer px would add, in analysis px (null if on a field). */
  const snapAt = useCallback((x, y) => {
    const ax = x * k, ay = y * k;
    const existing = existingPx();
    if (existing.some(e => ax >= e.x && ax <= e.x + e.w && ay >= e.y && ay <= e.y + e.h)) return null;
    return snapField(analysis, ax, ay, {
      scale: ptScale, existing, textItems: analysis?.items || [], width: (avp || vp).width, type: editType,
    });
  }, [analysis, k, ptScale, existingPx, avp, vp, editType]);

  const addAnalysisRect = useCallback(f => {
    onAdd(pageNum, { type: f.type, label: f.label || '', multiLine: !!f.multiLine, rect: toPdfRect(f, avp || vp) });
  }, [onAdd, pageNum, avp, vp]);

  // Drawing a box: follow the pointer outside the page too.
  useEffect(() => {
    if (!drag) return;
    const move = e => {
      const p = local(e);
      const d = { ...dragRef.current, x1: p.x, y1: p.y };
      dragRef.current = d;
      setDrag(d);
    };
    const up = e => {
      const p = local(e);
      const d = { ...dragRef.current, x1: p.x, y1: p.y };
      dragRef.current = null;
      setDrag(null);
      const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      if (w < DRAG_MIN && h < DRAG_MIN) {
        const f = snapAt(d.x0, d.y0);
        if (f) addAnalysisRect(f);
        setHover(null);
        return;
      }
      // Drawn box, in analysis px.
      const r = {
        x: Math.max(0, Math.min(d.x0, d.x1)) * k, y: Math.max(0, Math.min(d.y0, d.y1)) * k,
        w: w * k, h: h * k,
      };
      const wPt = r.w / ptScale, hPt = r.h / ptScale;
      let type = editType;
      if (type === 'auto') type = wPt <= 20 && hPt <= 20 && wPt / hPt > 0.6 && wPt / hPt < 1.66 ? 'checkbox' : 'text';
      if (wPt < 4 || hPt < 4) return;
      const label = labelForRect(r, { textItems: analysis?.items || [], scale: ptScale, type });
      addAnalysisRect({ ...r, type, label, multiLine: type === 'text' && hPt >= 30 });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [!!drag, snapAt, addAnalysisRect, k, ptScale, editType, analysis]);

  const onMouseDown = e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const p = local(e);
    dragRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    setDrag(dragRef.current);
  };
  const onMouseMove = e => {
    if (drag) return;
    const p = local(e);
    const f = snapAt(p.x, p.y);
    setHover(f ? { x: f.x / k, y: f.y / k, w: f.w / k, h: f.h / k, type: f.type } : null);
  };

  const dragBox = drag && (Math.abs(drag.x1 - drag.x0) >= DRAG_MIN || Math.abs(drag.y1 - drag.y0) >= DRAG_MIN)
    ? { left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }
    : null;

  return (
    <div
      ref={layerRef}
      className="field-edit-layer"
      style={{ width: vp.width, height: vp.height }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      {(fields || []).map(f => {
        const r = fromPdfRect(f.rect, vp);
        return (
          <div
            key={f.id}
            className={`field-edit-box${f.user ? ' field-edit-box--added' : ''}${f.type === 'checkbox' ? ' field-edit-box--check' : ''}`}
            style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
            title={f.label || (f.type === 'checkbox' ? 'Check box' : 'Text field')}
            onMouseDown={e => e.stopPropagation()}
            onMouseMove={e => { e.stopPropagation(); setHover(null); }}
          >
            <button
              className="field-edit-remove"
              title="Remove this field"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onRemove(pageNum, f.id); }}
            >×</button>
          </div>
        );
      })}
      {hover && !drag && (
        <div
          className={`field-edit-preview${hover.type === 'checkbox' ? ' field-edit-box--check' : ''}`}
          style={{ left: hover.x, top: hover.y, width: hover.w, height: hover.h }}
        />
      )}
      {dragBox && <div className="field-edit-preview field-edit-preview--draw" style={dragBox} />}
    </div>
  );
}
