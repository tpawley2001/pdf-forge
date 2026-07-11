/**
 * Annotations.js - PDF annotation system
 *
 * Provides methods to add various annotation types to PDF pages using
 * pdf-lib's annotation API.  Annotations are rendered as PDF annotation
 * objects where the format supports them, and as drawn content (form
 * XObjects / draw primitives) when necessary.
 */

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFString, rgb, StandardFonts } from 'pdf-lib';

/** Helper to convert #RRGGBB or 'red' etc. to pdf-lib RGB */
function parseColor(color) {
  if (typeof color === 'string') {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      return rgb(r, g, b);
    }
    // Named colours – simple mapping
    const named = {
      red: rgb(1, 0, 0),
      green: rgb(0, 1, 0),
      blue: rgb(0, 0, 1),
      yellow: rgb(1, 1, 0),
      black: rgb(0, 0, 0),
      white: rgb(1, 1, 1),
      orange: rgb(1, 0.647, 0),
      purple: rgb(0.5, 0, 0.5),
      cyan: rgb(0, 1, 1),
      magenta: rgb(1, 0, 1),
      gray: rgb(0.5, 0.5, 0.5),
    };
    if (named[color.toLowerCase()]) return named[color.toLowerCase()];
    return rgb(0, 0, 0); // fallback black
  }
  // Assume pdf-lib RGB object already
  return color;
}

export class Annotations {
  constructor() {
    this._annotationStore = new Map(); // keyed by `${pageIndex}`
  }

  _storeKey(pageIndex) {
    return `p${pageIndex}`;
  }

  _addAnnotation(pageIndex, annotation) {
    const key = this._storeKey(pageIndex);
    if (!this._annotationStore.has(key)) {
      this._annotationStore.set(key, []);
    }
    this._annotationStore.get(key).push(annotation);
  }

  // ---------------------------------------------------------------------------
  // Text annotation (free-text, visible on page)
  // ---------------------------------------------------------------------------

  /**
   * Add a visible free-text annotation to a page.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {{fontSize?: number, color?: string|object}} [options]
   * @returns {{type: string, pageIndex: number, ref: object}}
   */
  addTextAnnotation(doc, pageIndex, text, x, y, options = {}) {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];
    const fontSize = options.fontSize || 12;
    const color = parseColor(options.color || '#000000');

    const textAnnot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'FreeText',
      Rect: [x, y - fontSize - 4, x + (text.length * fontSize * 0.6) + 8, y + 4],
      Contents: text,
      DA: `/Helv ${fontSize} Tf 0 g`,
      F: 4, // Print flag
      Border: [0, 0, 1],
    });

    const annotRef = doc.context.register(textAnnot);
    this._addPageAnnotation(page, annotRef);
    this._addAnnotation(pageIndex, {
      type: 'text',
      text,
      x,
      y,
      fontSize,
      color,
      ref: annotRef,
    });

    return { type: 'text', pageIndex, ref: annotRef };
  }

  // ---------------------------------------------------------------------------
  // Highlight
  // ---------------------------------------------------------------------------

  /**
   * Add a text highlight annotation (translucent rectangle typically over
   * text).
   *
   * Uses the PDF highlight annotation subtype.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {{x: number, y: number, width: number, height: number}} rect
   * @param {string|object} [color='#FFFF00']
   * @returns {{type: string, pageIndex: number, ref: object}}
   */
  addHighlight(doc, pageIndex, rect, color = '#FFFF00') {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];

    const [r, g, b] = this._colorToArray(color);

    const highlightAnnot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
      QuadPoints: [
        rect.x, rect.y + rect.height,
        rect.x + rect.width, rect.y + rect.height,
        rect.x, rect.y,
        rect.x + rect.width, rect.y,
      ],
      C: [r, g, b],
      CA: 0.4, // opacity
      F: 4,
    });

    const annotRef = doc.context.register(highlightAnnot);
    this._addPageAnnotation(page, annotRef);
    this._addAnnotation(pageIndex, {
      type: 'highlight',
      rect,
      color,
      ref: annotRef,
    });

    return { type: 'highlight', pageIndex, ref: annotRef };
  }

  // ---------------------------------------------------------------------------
  // Underline
  // ---------------------------------------------------------------------------

  /**
   * Add an underline annotation.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {{x: number, y: number, width: number, height: number}} rect
   * @param {string|object} [color='#0000FF']
   * @returns {{type: string, pageIndex: number, ref: object}}
   */
  addUnderline(doc, pageIndex, rect, color = '#0000FF') {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];

    const [r, g, b] = this._colorToArray(color);

    const underlineAnnot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Underline',
      Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
      QuadPoints: [
        rect.x, rect.y,
        rect.x + rect.width, rect.y,
        rect.x, rect.y - 1,
        rect.x + rect.width, rect.y - 1,
      ],
      C: [r, g, b],
      F: 4,
    });

    const annotRef = doc.context.register(underlineAnnot);
    this._addPageAnnotation(page, annotRef);
    this._addAnnotation(pageIndex, {
      type: 'underline',
      rect,
      color,
      ref: annotRef,
    });

    return { type: 'underline', pageIndex, ref: annotRef };
  }

  // ---------------------------------------------------------------------------
  // Strikethrough
  // ---------------------------------------------------------------------------

  /**
   * Add a strikethrough annotation.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {{x: number, y: number, width: number, height: number}} rect
   * @returns {{type: string, pageIndex: number, ref: object}}
   */
  addStrikethrough(doc, pageIndex, rect) {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];

    const strikethroughAnnot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'StrikeOut',
      Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
      QuadPoints: [
        rect.x, rect.y + rect.height / 2,
        rect.x + rect.width, rect.y + rect.height / 2,
        rect.x, rect.y + rect.height / 2 - 1,
        rect.x + rect.width, rect.y + rect.height / 2 - 1,
      ],
      C: [1, 0, 0],
      F: 4,
    });

    const annotRef = doc.context.register(strikethroughAnnot);
    this._addPageAnnotation(page, annotRef);
    this._addAnnotation(pageIndex, {
      type: 'strikethrough',
      rect,
      ref: annotRef,
    });

    return { type: 'strikethrough', pageIndex, ref: annotRef };
  }

  // ---------------------------------------------------------------------------
  // Freehand drawing (stored as form XObject)
  // ---------------------------------------------------------------------------

  /**
   * Add a freehand ink annotation.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {Array<{x: number, y: number}>} path
   * @param {string|object} [color='#000000']
   * @param {number} [width=1]
   * @returns {{type: string, pageIndex: number, ref: object}}
   */
  addFreehand(doc, pageIndex, path, color = '#000000', width = 1) {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];

    if (!path || path.length < 2) {
      throw new Error('Freehand path must contain at least 2 points');
    }

    // Build ink list: one stroke containing all points as alternating x,y
    const inkList = [];
    for (const pt of path) {
      inkList.push(pt.x, pt.y);
    }

    const [r, g, b] = this._colorToArray(color);

    const inkAnnot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Ink',
      Rect: this._inkBoundingBox(path, width),
      InkList: [inkList],
      BS: { W: width, S: 'S' },
      C: [r, g, b],
      F: 4,
    });

    const annotRef = doc.context.register(inkAnnot);
    this._addPageAnnotation(page, annotRef);
    this._addAnnotation(pageIndex, {
      type: 'freehand',
      path,
      color,
      width,
      ref: annotRef,
    });

    return { type: 'freehand', pageIndex, ref: annotRef };
  }

  // ---------------------------------------------------------------------------
  // Rectangle shape (drawn as content on the page)
  // ---------------------------------------------------------------------------

  /**
   * Draw a rectangle shape onto the page content.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {{x: number, y: number, width: number, height: number}} rect
   * @param {string|object} [color='#000000']
   * @param {number} [borderWidth=1]
   * @returns {{type: string, pageIndex: number}}
   */
  addRectangle(doc, pageIndex, rect, color = '#000000', borderWidth = 1) {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];
    const c = parseColor(color);

    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      borderColor: c,
      borderWidth,
    });

    this._addAnnotation(pageIndex, {
      type: 'rectangle',
      rect,
      color,
      borderWidth,
    });

    return { type: 'rectangle', pageIndex };
  }

  // ---------------------------------------------------------------------------
  // Ellipse shape
  // ---------------------------------------------------------------------------

  /**
   * Draw an ellipse shape onto the page content (as a circle/oval within a
   * bounding rect).
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {{x: number, y: number, width: number, height: number}} rect
   * @param {string|object} [color='#000000']
   * @param {number} [borderWidth=1]
   * @returns {{type: string, pageIndex: number}}
   */
  addEllipse(doc, pageIndex, rect, color = '#000000', borderWidth = 1) {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];
    const c = parseColor(color);

    page.drawEllipse({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      xScale: rect.width / 2,
      yScale: rect.height / 2,
      borderColor: c,
      borderWidth,
    });

    this._addAnnotation(pageIndex, {
      type: 'ellipse',
      rect,
      color,
      borderWidth,
    });

    return { type: 'ellipse', pageIndex };
  }

  // ---------------------------------------------------------------------------
  // Line
  // ---------------------------------------------------------------------------

  /**
   * Draw a line onto the page.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {{x: number, y: number}} startPoint
   * @param {{x: number, y: number}} endPoint
   * @param {string|object} [color='#000000']
   * @param {number} [width=1]
   * @returns {{type: string, pageIndex: number}}
   */
  addLine(doc, pageIndex, startPoint, endPoint, color = '#000000', width = 1) {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];
    const c = parseColor(color);

    page.drawLine({
      start: startPoint,
      end: endPoint,
      color: c,
      thickness: width,
    });

    this._addAnnotation(pageIndex, {
      type: 'line',
      startPoint,
      endPoint,
      color,
      width,
    });

    return { type: 'line', pageIndex };
  }

  // ---------------------------------------------------------------------------
  // Arrow
  // ---------------------------------------------------------------------------

  /**
   * Draw an arrow (line with arrowhead) from startPoint to endPoint.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {{x: number, y: number}} startPoint
   * @param {{x: number, y: number}} endPoint
   * @param {string|object} [color='#000000']
   * @returns {{type: string, pageIndex: number}}
   */
  addArrow(doc, pageIndex, startPoint, endPoint, color = '#000000') {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];
    const c = parseColor(color);
    const headLen = 10;

    // Main line
    page.drawLine({
      start: startPoint,
      end: endPoint,
      color: c,
      thickness: 1.5,
    });

    // Arrowhead
    const angle = Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x);
    const arrowAngle1 = angle + Math.PI * 0.85;
    const arrowAngle2 = angle - Math.PI * 0.85;

    const p1 = {
      x: endPoint.x - headLen * Math.cos(arrowAngle1),
      y: endPoint.y - headLen * Math.sin(arrowAngle1),
    };
    const p2 = {
      x: endPoint.x - headLen * Math.cos(arrowAngle2),
      y: endPoint.y - headLen * Math.sin(arrowAngle2),
    };

    page.drawLine({ start: endPoint, end: p1, color: c, thickness: 1.5 });
    page.drawLine({ start: endPoint, end: p2, color: c, thickness: 1.5 });

    this._addAnnotation(pageIndex, {
      type: 'arrow',
      startPoint,
      endPoint,
      color,
    });

    return { type: 'arrow', pageIndex };
  }

  // ---------------------------------------------------------------------------
  // Sticky note
  // ---------------------------------------------------------------------------

  /**
   * Add a sticky note (comment) annotation.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {number} x
   * @param {number} y
   * @param {string} text
   * @returns {{type: string, pageIndex: number, ref: object}}
   */
  addStickyNote(doc, pageIndex, x, y, text) {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];

    const noteAnnot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [x, y - 20, x + 20, y],
      Contents: text,
      Name: 'Note',
      F: 28, // Print + NoZoom + NoRotate
    });

    const annotRef = doc.context.register(noteAnnot);
    this._addPageAnnotation(page, annotRef);
    this._addAnnotation(pageIndex, {
      type: 'stickyNote',
      text,
      x,
      y,
      ref: annotRef,
    });

    return { type: 'stickyNote', pageIndex, ref: annotRef };
  }

  // ---------------------------------------------------------------------------
  // Text box (drawn as content)
  // ---------------------------------------------------------------------------

  /**
   * Draw a text box with optional background on the page.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {{x: number, y: number, width: number, height: number}} rect
   * @param {string} text
   * @param {number} [fontSize=12]
   * @returns {Promise<{type: string, pageIndex: number}>}
   */
  async addTextbox(doc, pageIndex, rect, text, fontSize = 12) {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];

    const font = await doc.embedFont(StandardFonts.Helvetica);

    // Background
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      color: rgb(1, 1, 0.9),
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.5,
    });

    // Text (word-wrapped approximately)
    const lineHeight = fontSize * 1.2;
    const charsPerLine = Math.floor(rect.width / (fontSize * 0.6));
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + ' ' + word).length > charsPerLine && currentLine.length > 0) {
        lines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine += (currentLine ? ' ' : '') + word;
      }
    }
    if (currentLine) lines.push(currentLine.trim());

    let textY = rect.y + rect.height - fontSize - 4;
    for (const line of lines) {
      if (textY < rect.y + 4) break;
      page.drawText(line, {
        x: rect.x + 4,
        y: textY,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
      textY -= lineHeight;
    }

    this._addAnnotation(pageIndex, {
      type: 'textbox',
      rect,
      text,
      fontSize,
    });

    return { type: 'textbox', pageIndex };
  }

  // ---------------------------------------------------------------------------
  // Stamp
  // ---------------------------------------------------------------------------

  /**
   * Add a standard rubber-stamp annotation.
   *
   * Supported types: APPROVED, DRAFT, CONFIDENTIAL, REVIEWED, FINAL,
   *                  COMPLETED, REVISED, NOT_APPROVED, AS_IS, VOID
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {number} x
   * @param {number} y
   * @param {string} stampType
   * @returns {{type: string, pageIndex: number, ref: object}}
   */
  addStamp(doc, pageIndex, x, y, stampType) {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];

    const validStamps = [
      'Approved', 'Draft', 'Confidential', 'Reviewed', 'Final',
      'Completed', 'Revised', 'NotApproved', 'AsIs', 'Void',
    ];

    // Normalise the stamp name
    const normalised = stampType
      .replace(/[_\s-]/g, '')
      .replace(/^[a-z]/, c => c.toUpperCase());

    if (!validStamps.includes(normalised)) {
      throw new Error(
        `Invalid stamp type "${stampType}". Must be one of: ${validStamps.join(', ')}`,
      );
    }

    const stampAnnot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Stamp',
      Rect: [x, y - 32, x + 130, y],
      Name: normalised,
      F: 4,
    });

    const annotRef = doc.context.register(stampAnnot);
    this._addPageAnnotation(page, annotRef);
    this._addAnnotation(pageIndex, {
      type: 'stamp',
      stampType: normalised,
      x,
      y,
      ref: annotRef,
    });

    return { type: 'stamp', pageIndex, ref: annotRef };
  }

  // ---------------------------------------------------------------------------
  // Signature
  // ---------------------------------------------------------------------------

  /**
   * Embed a signature image on the page.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {Uint8Array|ArrayBuffer} imageBytes  - PNG or JPEG bytes
   * @returns {Promise<{type: string, pageIndex: number}>}
   */
  async addSignature(doc, pageIndex, x, y, width, imageBytes) {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];

    let image;
    const bytes = imageBytes instanceof ArrayBuffer
      ? new Uint8Array(imageBytes)
      : imageBytes;

    // Detect PNG vs JPEG by magic bytes
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      image = await doc.embedPng(bytes);
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      image = await doc.embedJpg(bytes);
    } else {
      throw new Error('Unsupported image format. Provide PNG or JPEG bytes.');
    }

    const dims = image.scale(width / image.width);

    page.drawImage(image, {
      x,
      y: y - dims.height,
      width: dims.width,
      height: dims.height,
    });

    this._addAnnotation(pageIndex, {
      type: 'signature',
      x,
      y,
      width,
    });

    return { type: 'signature', pageIndex };
  }

  // ---------------------------------------------------------------------------
  // Get / remove annotations
  // ---------------------------------------------------------------------------

  /**
   * Return all annotations tracked for a given page.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @returns {Array<object>}
   */
  getAnnotations(doc, pageIndex) {
    return this._annotationStore.get(this._storeKey(pageIndex)) || [];
  }

  /**
   * Remove a tracked annotation by its reference object.
   *
   * Note: This removes the annotation from our tracking store and attempts
   * to remove it from the page's Annots array. Fully removing content drawn
   * via the page content stream (shapes, lines, etc.) is not trivial with
   * pdf-lib's high-level API; those are best handled by re-saving without
   * re-drawing.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex
   * @param {object} annotationRef - The object previously returned by an add* method
   * @returns {boolean}
   */
  removeAnnotation(doc, pageIndex, annotationRef) {
    const key = this._storeKey(pageIndex);
    const annots = this._annotationStore.get(key);
    if (!annots) return false;

    const idx = annots.findIndex(a => a.ref === annotationRef || a === annotationRef);
    if (idx === -1) return false;

    const removed = annots.splice(idx, 1)[0];

    // If the annotation has a PDF ref, try to remove it from the page's Annots
    if (removed.ref) {
      const pages = doc.getPages();
      if (pageIndex < pages.length) {
        const page = pages[pageIndex];
        this._removePageAnnotation(page, removed.ref);
      }
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Add an annotation reference to a page's Annots array.
   */
  _addPageAnnotation(page, annotRef) {
    try {
      const pageDict = page.node;
      let annots = pageDict.lookup(PDFName.of('Annots'));
      if (!annots) {
        annots = pageDict.context.obj([]);
        pageDict.set(PDFName.of('Annots'), annots);
      }
      if (annots instanceof PDFArray) {
        annots.push(annotRef);
      }
    } catch (_) {
      // Silently ignore – annotation is still tracked in our store
    }
  }

  /**
   * Remove an annotation reference from a page's Annots array.
   */
  _removePageAnnotation(page, annotRef) {
    try {
      const pageDict = page.node;
      const annots = pageDict.lookup(PDFName.of('Annots'));
      if (annots instanceof PDFArray) {
        const idx = annots.indexOf(annotRef);
        if (idx >= 0) {
          annots.remove(idx);
        }
      }
    } catch (_) {
      // Silently ignore
    }
  }

  /**
   * Convert a hex or named colour to [r, g, b] array (0-1 range).
   */
  _colorToArray(color) {
    if (typeof color === 'string' && color.startsWith('#')) {
      const hex = color.slice(1);
      return [
        parseInt(hex.substring(0, 2), 16) / 255,
        parseInt(hex.substring(2, 4), 16) / 255,
        parseInt(hex.substring(4, 6), 16) / 255,
      ];
    }
    const c = parseColor(color);
    return [c.red, c.green, c.blue];
  }

  /**
   * Compute bounding box for an ink path.
   */
  _inkBoundingBox(path, strokeWidth) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pad = strokeWidth + 2;
    for (const pt of path) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    return [minX - pad, minY - pad, maxX + pad, maxY + pad];
  }
}

export default Annotations;
