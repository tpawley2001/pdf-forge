/**
 * TextEditor.js — Apply OCR edits back into a PDF.
 *
 * For each edited text block, we:
 *   1. Draw a white rectangle over the old text region (whiteout)
 *   2. Draw the replacement text using pdf-lib
 *
 * This produces a visually correct result. The original text still
 * exists in the content stream but is hidden behind the whiteout.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getFontBytes } from '../renderer/services/fontMatcher.js';
import { canAttemptNativeTextEdit, rewritePageTextRuns } from './ContentStreamTextEditor.js';

// Map detected font family keywords → the four pdf-lib StandardFont variants
const FONT_VARIANTS = {
  times:   [StandardFonts.TimesRoman,  StandardFonts.TimesBoldItalic, StandardFonts.TimesItalic,  StandardFonts.TimesBold],
  courier: [StandardFonts.Courier,     StandardFonts.CourierBoldOblique, StandardFonts.CourierOblique, StandardFonts.CourierBold],
  // default / helvetica / sans-serif
  default: [StandardFonts.Helvetica,   StandardFonts.HelveticaBoldOblique, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBold],
};
// index: 0=regular, 1=bold+italic, 2=italic, 3=bold

function pickFontName(fontFamily, bold, italic) {
  let bucket = 'default';
  const lc = (fontFamily || '').toLowerCase();
  if (/times|serif/.test(lc) && !/sans/.test(lc)) bucket = 'times';
  else if (/courier|mono|typewriter/.test(lc)) bucket = 'courier';
  const idx = bold && italic ? 1 : italic ? 2 : bold ? 3 : 0;
  return FONT_VARIANTS[bucket][idx];
}

function parseColor(color, fallback = rgb(0, 0, 0)) {
  if (!color || typeof color !== 'string') return fallback;
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (!hex) return fallback;
  return rgb(
    parseInt(hex[1].slice(0, 2), 16) / 255,
    parseInt(hex[1].slice(2, 4), 16) / 255,
    parseInt(hex[1].slice(4, 6), 16) / 255,
  );
}

function wrapLines(text, font, fontSize, maxWidth) {
  return String(text || '')
    .split('\n')
    .flatMap(paragraph => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (words.length === 0) return [''];
      const lines = [];
      let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, fontSize) > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      if (line) lines.push(line);
      return lines;
    });
}

export class TextEditor {
  /**
   * Apply edited text blocks to a page.
   *
   * @param {Uint8Array} pdfBytes  — current PDF as bytes
   * @param {number}     pageIndex — 0-based page index
   * @param {Array}      edits     — [{ bbox: {x,y,width,height}, text: 'new text', fontSize?: number }]
   * @returns {Promise<Uint8Array>} modified PDF bytes
   */
  static async applyEdits(pdfBytes, pageIndex, edits) {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    doc.registerFontkit(fontkit);
    const pages = doc.getPages();

    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }

    const page = pages[pageIndex];

    // Font cache: keyed by "family|bold|italic" to avoid re-embedding the same font
    const fontCache = {};
    const getFont = async (fontFamily, bold, italic) => {
      const key = `${fontFamily}|${!!bold}|${!!italic}`;
      if (fontCache[key]) return fontCache[key];

      // 1. Try the actual system font (gives pixel-perfect match)
      if (fontFamily) {
        try {
          const bytes = await getFontBytes(fontFamily, bold, italic);
          if (bytes) {
            fontCache[key] = await doc.embedFont(bytes, { subset: true });
            return fontCache[key];
          }
        } catch (_) {}
      }

      // 2. Fall back to closest pdf-lib Standard Font
      const stdName = pickFontName(fontFamily, bold, italic);
      if (!fontCache[stdName]) fontCache[stdName] = await doc.embedFont(stdName);
      fontCache[key] = fontCache[stdName];
      return fontCache[key];
    };

    for (const edit of edits) {
      if (canAttemptNativeTextEdit(edit)) {
        const result = rewritePageTextRuns(doc, pageIndex, [edit]);
        if (result.replacements > 0) continue;
      }

      const { bbox, text, fontSize: overrideSize } = edit;
      if (!bbox || text == null) continue;

      const padX = edit.paddingX ?? 3;
      const padY = edit.paddingY ?? 2;
      const wx = bbox.x - padX;
      const wy = page.getHeight() - bbox.y - bbox.height - padY; // pdf-lib uses bottom-left origin
      const ww = bbox.width + padX * 2;
      const wh = bbox.height + padY * 2;

      if (edit.whiteout !== false) {
        page.drawRectangle({
          x: wx,
          y: wy,
          width: Math.max(ww, 10),
          height: Math.max(wh, 10),
          color: rgb(1, 1, 1),
        });
      }

      const fontSize = overrideSize || Math.round(bbox.height * 0.72);
      if (text === '') continue;
      const font = await getFont(edit.fontFamily, edit.bold, edit.italic);
      const color = parseColor(edit.color);
      const lineHeight = fontSize * 1.18;
      const lines = wrapLines(text, font, fontSize, Math.max(8, bbox.width));
      let ty = wy + bbox.height - fontSize - 1;

      for (const line of lines) {
        if (ty < wy + 1) break;
        let tx = wx + padX;
        if (edit.align === 'center') {
          tx = wx + padX + Math.max(0, (bbox.width - font.widthOfTextAtSize(line, fontSize)) / 2);
        } else if (edit.align === 'right') {
          tx = wx + padX + Math.max(0, bbox.width - font.widthOfTextAtSize(line, fontSize));
        }
        page.drawText(line, { x: tx, y: ty, size: fontSize, font, color });
        ty -= lineHeight;
      }
    }

    return doc.save();
  }

  // NOTE: the old redact() helper was removed — it only drew a black box and
  // left the text in the file. Use src/pdf/Redactor.js (true removal) instead.
}

export default TextEditor;
