import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js';
import AnnotationLayer from './AnnotationLayer';
import TextReplacementOverlay from './TextReplacementOverlay';
import OCROverlay from './OCROverlay';
import FormFillLayer from './FormFillLayer';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const OCR_RENDER_SCALE = 2;

function rgbToHex(rgb) {
  if (!rgb) return null;
  const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}

export default function PDFViewer({
  pdfData, scale, currentPage, setPageCount, activeTool,
  annotations, selectedAnnotationId,
  onAnnotationAdd, onAnnotationSelect, onAnnotationDelete,
  pendingStampType,
  annotationColor, annotationSize,
  onThumbnailReady, onTextContent, onPageImage,
  onTextEditRequest,
  textEdit, onTextEditChange, onTextEditApply, onTextEditCancel,
  pageOCRData, ocrEditPage, onOCRCommit, onOCRCancel,
  onOutlineReady,
  onFirstPageSize,
  formValues, onFormValueChange,
  onPasswordRequired,
}) {
  const containerRef   = useRef(null);
  const textLayerRefs  = useRef({});
  // Populated after each renderTextLayer so openTextEditFromEvent can look up font metadata
  const textDivsRef    = useRef({});   // { [pageNum]: HTMLElement[] }
  const textMetaRef    = useRef({});   // { [pageNum]: { items, styles } }
  const [pdfDoc,    setPdfDoc]    = useState(null);
  const [pageCount, setLocalPageCount] = useState(0);
  const [renderedPages, setRenderedPages] = useState({});   // { n: { dataUrl, w, h, vp } }
  const [dragging,  setDragging]  = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [drawStart, setDrawStart] = useState(null);
  const [freehandPts, setFreehandPts] = useState([]);

  // ── Load document ──
  useEffect(() => {
    if (!pdfData) { setPdfDoc(null); setRenderedPages({}); setLocalPageCount(0); return; }
    const task = pdfjsLib.getDocument({ data: pdfData.slice() });
    task.promise.then(async doc => {
      setPdfDoc(doc);
      setLocalPageCount(doc.numPages);
      if (setPageCount) setPageCount(doc.numPages);
      setRenderedPages({});
      // Extract bookmark outline
      if (onOutlineReady) {
        try {
          const outline = await doc.getOutline();
          onOutlineReady(outline || []);
        } catch (_) { onOutlineReady([]); }
      }
    }).catch(err => {
      if (err?.name === 'PasswordException') {
        onPasswordRequired?.();
      } else {
        console.error('PDF load error:', err);
      }
    });
    return () => task.destroy().catch(() => {});
  }, [pdfData]);

  // ── Render pages ──
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    setRenderedPages({});

    (async () => {
      for (let n = 1; n <= pdfDoc.numPages; n++) {
        if (cancelled) break;
        try {
          const page = await pdfDoc.getPage(n);
          const vp   = page.getViewport({ scale });
          // Report natural size of first page for Fit Page/Width calculation
          if (n === 1 && onFirstPageSize) {
            const naturalVp = page.getViewport({ scale: 1 });
            onFirstPageSize(naturalVp.width, naturalVp.height);
          }
          const canvas = document.createElement('canvas');
          canvas.width  = vp.width;
          canvas.height = vp.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

          const ocrVp = page.getViewport({ scale: OCR_RENDER_SCALE });
          const ocrCanvas = document.createElement('canvas');
          ocrCanvas.width = ocrVp.width;
          ocrCanvas.height = ocrVp.height;
          await page.render({ canvasContext: ocrCanvas.getContext('2d'), viewport: ocrVp }).promise;

          // Text content for search + text layer
          const textContent = await page.getTextContent();
          const text = textContent.items.map(i => i.str).join(' ');
          if (onTextContent) onTextContent(n, text);

          // Interactive form widgets (AcroForm)
          let widgets = [];
          try {
            const annots = await page.getAnnotations({ intent: 'display' });
            widgets = annots.filter(a => a.subtype === 'Widget');
          } catch (_) {}

          if (!cancelled) {
            // Stable higher-resolution image for OCR and font sampling.
            if (onPageImage) onPageImage(n, ocrCanvas.toDataURL(), OCR_RENDER_SCALE);
            setRenderedPages(prev => ({
              ...prev,
              [n]: { dataUrl: canvas.toDataURL(), w: vp.width, h: vp.height, vp, textContent, widgets },
            }));
          }

          // Thumbnails at 0.25 scale — rendered once after first full render
          if (onThumbnailReady && !cancelled) {
            const tvp = page.getViewport({ scale: 0.25 });
            const tc  = document.createElement('canvas');
            tc.width  = tvp.width;
            tc.height = tvp.height;
            await page.render({ canvasContext: tc.getContext('2d'), viewport: tvp }).promise;
            if (!cancelled) onThumbnailReady(n, tc.toDataURL());
          }
        } catch (err) {
          console.error(`Render error page ${n}:`, err);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [pdfDoc, scale]);

  // ── Text layers (populate after render) ──
  useEffect(() => {
    Object.entries(renderedPages).forEach(([nStr, pg]) => {
      const n   = parseInt(nStr);
      const el  = textLayerRefs.current[n];
      if (!el || !pg.textContent || !pg.vp) return;
      el.innerHTML = '';
      el.style.width  = `${pg.w}px`;
      el.style.height = `${pg.h}px`;
      // pdf.js ≥3 sizes the layer and its spans with calc(var(--scale-factor) * …);
      // without this property the layer collapses to 0×0 and spans pile up at
      // the page corner (breaks selection, click-to-edit, and span geometry).
      el.style.setProperty('--scale-factor', String(pg.vp.scale));
      const divs = [];
      try {
        pdfjsLib.renderTextLayer({
          textContentSource: pg.textContent,
          container:         el,
          viewport:          pg.vp,
          textDivs:          divs,
        }).promise.then(() => {
          textDivsRef.current[n] = divs;
          textMetaRef.current[n] = { items: pg.textContent.items, styles: pg.textContent.styles };
        }).catch(() => {});
      } catch (_) {}
    });
  }, [renderedPages]);

  // ── Scroll to current page ──
  useEffect(() => {
    const el = document.getElementById(`pdf-page-${currentPage}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentPage]);

  // ── Mouse handlers ──
  const handleMouseDown = useCallback((e, pageNum) => {
    if (activeTool === 'hand') {
      setDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }
    if (activeTool === 'select' || activeTool === 'editText') return;

    const wrapper = document.getElementById(`pdf-page-${pageNum}`);
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top)  / scale;

    if (activeTool === 'note') {
      onAnnotationAdd?.('note', { page: pageNum, x, y, text: '', color: annotationColor || '#ffe066' });
      return;
    }
    if (activeTool === 'stamp') {
      onAnnotationAdd?.('stamp', { page: pageNum, x, y, stampType: pendingStampType || 'Approved' });
      return;
    }
    if (activeTool === 'text') {
      onAnnotationAdd?.('textbox', { page: pageNum, x, y, width: 200, height: 60, text: '', fontSize: 13, color: annotationColor || '#000000' });
      return;
    }

    setDrawStart({ x, y, pageNum });
    if (activeTool === 'freehand') {
      setDragging(true);
      setFreehandPts([{ x, y }]);
    }
  }, [activeTool, scale, annotationColor, pendingStampType, onAnnotationAdd]);

  const handleMouseMove = useCallback((e) => {
    if (!dragging) return;

    if (activeTool === 'hand') {
      const dy = e.clientY - dragStart.y;
      const dx = e.clientX - dragStart.x;
      if (containerRef.current) {
        containerRef.current.scrollTop  -= dy;
        containerRef.current.scrollLeft -= dx;
      }
      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    if (activeTool === 'freehand' && drawStart) {
      const wrapper = document.getElementById(`pdf-page-${drawStart.pageNum}`);
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top)  / scale;
      setFreehandPts(prev => [...prev, { x, y }]);
    }
  }, [dragging, activeTool, dragStart, drawStart, scale]);

  const handleMouseUp = useCallback((e) => {
    if (activeTool === 'hand') { setDragging(false); return; }

    if (activeTool === 'freehand' && drawStart && freehandPts.length > 1) {
      onAnnotationAdd?.('freehand', {
        page: drawStart.pageNum,
        path: freehandPts,
        color: annotationColor || '#e74c3c',
        width: annotationSize || 2,
      });
    }

    if (drawStart && activeTool !== 'freehand') {
      const wrapper = document.getElementById(`pdf-page-${drawStart.pageNum}`);
      if (wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const endX = (e.clientX - rect.left) / scale;
        const endY = (e.clientY - rect.top)  / scale;
        const dx = endX - drawStart.x;
        const dy = endY - drawStart.y;
        const color = annotationColor || '#e74c3c';
        const size  = annotationSize  || 2;

        switch (activeTool) {
          case 'redact':
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3)
              onAnnotationAdd?.('redact', {
                page: drawStart.pageNum,
                rect: { x: Math.min(drawStart.x, endX), y: Math.min(drawStart.y, endY), width: Math.abs(dx), height: Math.abs(dy) },
              });
            break;
          case 'rectangle':
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3)
              onAnnotationAdd?.('rectangle', {
                page: drawStart.pageNum,
                x: Math.min(drawStart.x, endX), y: Math.min(drawStart.y, endY),
                width: Math.abs(dx), height: Math.abs(dy),
                color, borderWidth: size,
              });
            break;
          case 'ellipse':
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3)
              onAnnotationAdd?.('ellipse', {
                page: drawStart.pageNum,
                x: Math.min(drawStart.x, endX), y: Math.min(drawStart.y, endY),
                width: Math.abs(dx), height: Math.abs(dy),
                color, borderWidth: size,
              });
            break;
          case 'line':
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3)
              onAnnotationAdd?.('line', {
                page: drawStart.pageNum,
                startPoint: { x: drawStart.x, y: drawStart.y },
                endPoint: { x: endX, y: endY },
                color, width: size,
              });
            break;
          case 'arrow':
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3)
              onAnnotationAdd?.('arrow', {
                page: drawStart.pageNum,
                startPoint: { x: drawStart.x, y: drawStart.y },
                endPoint: { x: endX, y: endY },
                color,
              });
            break;
          case 'highlight':
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3)
              onAnnotationAdd?.('highlight', {
                page: drawStart.pageNum,
                rect: { x: Math.min(drawStart.x, endX), y: Math.min(drawStart.y, endY), width: Math.abs(dx), height: Math.abs(dy) },
                color: annotationColor || 'rgba(255,255,0,0.4)',
              });
            break;
          case 'underline':
            if (Math.abs(dx) > 3)
              onAnnotationAdd?.('underline', {
                page: drawStart.pageNum,
                rect: { x: Math.min(drawStart.x, endX), y: Math.min(drawStart.y, endY), width: Math.abs(dx), height: Math.abs(dy) || 16 },
                color,
              });
            break;
          case 'strikethrough':
            if (Math.abs(dx) > 3)
              onAnnotationAdd?.('strikethrough', {
                page: drawStart.pageNum,
                rect: { x: Math.min(drawStart.x, endX), y: Math.min(drawStart.y, endY), width: Math.abs(dx), height: Math.abs(dy) || 16 },
                color,
              });
            break;
          default: break;
        }
      }
    }

    setDragging(false);
    setDrawStart(null);
    setFreehandPts([]);
  }, [activeTool, drawStart, freehandPts, scale, annotationColor, annotationSize, onAnnotationAdd]);

  const openTextEditFromEvent = useCallback((e, pageNum, force = false) => {
    if (activeTool !== 'editText' && !(force && activeTool === 'select')) return;

    const span = e.target?.closest?.('span');
    if (!span || !span.textContent?.trim()) return;

    const wrapper = document.getElementById(`pdf-page-${pageNum}`);
    if (!wrapper) return;

    const spanRect = span.getBoundingClientRect();
    const pageRect = wrapper.getBoundingClientRect();
    const bbox = {
      x: (spanRect.left - pageRect.left) / scale,
      y: (spanRect.top - pageRect.top) / scale,
      width: spanRect.width / scale,
      height: spanRect.height / scale,
    };

    // ── Extract real font properties ──
    const computed = window.getComputedStyle(span);

    // Font size: look up the text content item's transform matrix for the exact PDF point size.
    // The transform [a, b, c, d, e, f] from pdfjs is in PDF user-space (points for a standard PDF).
    // For horizontal text, |d| (or the vector magnitude √(c²+d²)) is the font height in points.
    let fontSizePt = Math.max(4, Math.round(bbox.height * 0.75)); // fallback estimate
    let fontFamily = '';
    const divs = textDivsRef.current[pageNum];
    const meta = textMetaRef.current[pageNum];
    if (divs && meta?.items) {
      const idx = divs.indexOf(span);
      if (idx >= 0 && idx < meta.items.length) {
        const item = meta.items[idx];
        const tf   = item.transform; // [a, b, c, d, e, f]
        // Magnitude of the column vector [c, d] = font size in PDF points
        const raw = Math.sqrt(tf[2] * tf[2] + tf[3] * tf[3]);
        if (raw >= 1 && raw <= 500) fontSizePt = Math.round(raw);
        // Font family from the styles map
        if (meta.styles && item.fontName) {
          fontFamily = meta.styles[item.fontName]?.fontFamily || '';
        }
      }
    }

    // Bold: check CSS font-weight and font-family name (pdfjs often encodes bold in the family string)
    const fontWeightNum = parseInt(computed.fontWeight) || 400;
    const isBold   = fontWeightNum >= 600 || /bold/i.test(computed.fontFamily) || /bold/i.test(fontFamily);
    const isItalic = computed.fontStyle === 'italic' || /italic|oblique/i.test(computed.fontFamily) || /italic|oblique/i.test(fontFamily);

    // Color: pdfjs sets color on spans when not default black; falls back to rgb(0,0,0)
    const colorHex = rgbToHex(computed.color) || '#000000';

    onTextEditRequest?.({
      page: pageNum,
      text: span.textContent,
      originalText: span.textContent,
      bbox,
      fontSize: fontSizePt,
      color: colorHex,
      bold: isBold,
      italic: isItalic,
      fontFamily,
      align: 'left',
      paddingX: 2,
      paddingY: 1,
      whiteout: true,
    });
  }, [activeTool, scale, onTextEditRequest]);

  if (!pdfData) {
    return (
      <div className="viewer" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="empty-state">
          <svg viewBox="0 0 64 64"><rect x="8" y="4" width="48" height="56" rx="4" fill="none" stroke="currentColor" strokeWidth="2"/><text x="32" y="42" textAnchor="middle" fontSize="20" fontWeight="bold" fill="currentColor">PDF</text></svg>
          <div className="empty-state__text">No document open</div>
          <div className="empty-state__hint">Ctrl+O or drag a PDF file here</div>
        </div>
      </div>
    );
  }

  const pageNums = Array.from({ length: pageCount }, (_, i) => i + 1);
  return (
    <div
      className="viewer"
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { setDragging(false); setDrawStart(null); setFreehandPts([]); }}
      style={{
        cursor: activeTool === 'hand'
          ? (dragging ? 'grabbing' : 'grab')
          : activeTool === 'select' || activeTool === 'editText' ? 'text'
          : 'crosshair',
      }}
    >
      {(activeTool === 'editText' || activeTool === 'select') && (
        <div className="viewer__hint">
          {activeTool === 'editText'
            ? (pageOCRData?.[currentPage]?.done && (!textDivsRef.current[currentPage] || textDivsRef.current[currentPage].length === 0)
                ? 'Scanned page — click any highlighted text region to edit it.'
                : pageOCRData?.[currentPage]?.running
                ? 'Detecting text via OCR…'
                : 'Click existing text to replace it. For scanned pages, wait for OCR to complete.')
            : 'Double-click existing text to edit it, or use the Edit Text tool for single-click editing.'}
        </div>
      )}
      {pageNums.map(n => {
        const pg   = renderedPages[n];
        const w    = pg ? pg.w : 612 * scale;
        const h    = pg ? pg.h : 792 * scale;

        return (
          <div
            key={n}
            id={`pdf-page-${n}`}
            className="viewer__page-wrapper"
            style={{ width: w, height: h }}
            onMouseDown={e => handleMouseDown(e, n)}
          >
            {pg ? (
              <img
                src={pg.dataUrl}
                alt={`Page ${n}`}
                style={{ width: w, height: h, display: 'block' }}
                draggable={false}
              />
            ) : (
              <div style={{ width: w, height: h, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 13 }}>
                <span className="loading-dot" />&nbsp;<span className="loading-dot" />&nbsp;<span className="loading-dot" />
              </div>
            )}

            <div
              className={`pdf-text-layer ${activeTool === 'select' ? 'select-active' : activeTool === 'editText' ? 'edit-active' : 'tool-active'}`}
              ref={el => { textLayerRefs.current[n] = el; }}
              style={{ width: w, height: h }}
              onClick={e => openTextEditFromEvent(e, n, false)}
              onDoubleClick={e => openTextEditFromEvent(e, n, true)}
            />

            {/* Freehand preview */}
            {dragging && activeTool === 'freehand' && drawStart?.pageNum === n && freehandPts.length > 1 && (
              <svg style={{ position: 'absolute', top: 0, left: 0, width: w, height: h, pointerEvents: 'none', zIndex: 4 }}>
                <path
                  d={freehandPts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x * scale},${pt.y * scale}`).join(' ')}
                  fill="none"
                  stroke={annotationColor || '#e74c3c'}
                  strokeWidth={annotationSize || 2}
                  strokeLinecap="round"
                />
              </svg>
            )}

            {pg?.widgets?.length > 0 && (
              <FormFillLayer
                widgets={pg.widgets}
                viewport={pg.vp}
                scale={scale}
                values={formValues || {}}
                onChange={onFormValueChange}
                interactive={activeTool === 'select' || activeTool === 'hand'}
              />
            )}

            <div className="viewer__annotation-layer">
              <AnnotationLayer
                pageNum={n}
                annotations={annotations.filter(a => a.page === n)}
                scale={scale}
                selectedId={selectedAnnotationId}
                onSelect={onAnnotationSelect}
                onDelete={onAnnotationDelete}
              />
            </div>

            {textEdit?.page === n && (
              <TextReplacementOverlay
                edit={textEdit}
                scale={scale}
                onChange={onTextEditChange}
                onApply={onTextEditApply}
                onCancel={onTextEditCancel}
              />
            )}

            {/* OCR: running spinner (shown on any page still being processed) */}
            {pageOCRData?.[n]?.running && (
              <div className="ocr-running">
                <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
                <span style={{ marginLeft: 8 }}>Running OCR…</span>
              </div>
            )}

            {/* OCR: editable overlays for the active edit page */}
            {ocrEditPage === n && pageOCRData?.[n]?.done && pageOCRData[n].blocks?.length > 0 && (
              <OCROverlay
                blocks={pageOCRData[n].blocks}
                scale={scale}
                onCommit={onOCRCommit}
                onCancel={onOCRCancel}
              />
            )}

            {/* editText on image-only page: show OCR blocks as click-to-edit targets */}
            {activeTool === 'editText' && ocrEditPage !== n &&
              pageOCRData?.[n]?.done && pageOCRData[n].blocks?.length > 0 &&
              (!textDivsRef.current[n] || textDivsRef.current[n].length === 0) && (
              <div className="ocr-editable-layer" style={{ width: w, height: h }}>
                {pageOCRData[n].blocks.map(block => (
                  <div
                    key={block._id}
                    className="ocr-edit-target"
                    style={{
                      left:   block.bbox.x * scale,
                      top:    block.bbox.y * scale,
                      width:  Math.max(block.bbox.width  * scale, 24),
                      height: Math.max(block.bbox.height * scale, 12),
                    }}
                    title={`Click to edit: "${block.text.slice(0, 40)}"`}
                    onClick={e => {
                      e.stopPropagation();
                      const fontSize = Math.max(4, Math.round(block.bbox.height * 0.82));
                      onTextEditRequest?.({
                        page: n,
                        text: block.text,
                        originalText: block.text,
                        bbox: { ...block.bbox },
                        fontSize,
                        color: '#000000',
                        bold: false,
                        italic: false,
                        fontFamily: '',
                        align: 'left',
                        paddingX: 2,
                        paddingY: 1,
                        whiteout: true,
                      });
                    }}
                  />
                ))}
              </div>
            )}

            {/* OCR: active page but nothing found */}
            {ocrEditPage === n && pageOCRData?.[n]?.done && !pageOCRData[n].blocks?.length && (
              <div className="ocr-running" style={{ flexDirection: 'column', gap: 10 }}>
                <span style={{ fontSize: 13 }}>No text detected on this page</span>
                <button className="btn btn-secondary" onClick={onOCRCancel} style={{ fontSize: 11, padding: '3px 12px' }}>Close</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
