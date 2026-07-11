/**
 * PageDecorations.js — Watermarks, headers/footers, page numbering, and
 * Bates numbering (Acrobat's "Add Watermark" and "Header & Footer" tools).
 */
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

function parseColor(input, fallback = rgb(0.5, 0.5, 0.5)) {
  const hex = String(input || '').match(/^#([0-9a-f]{6})$/i);
  if (!hex) return fallback;
  return rgb(
    parseInt(hex[1].slice(0, 2), 16) / 255,
    parseInt(hex[1].slice(2, 4), 16) / 255,
    parseInt(hex[1].slice(4, 6), 16) / 255,
  );
}

/**
 * Parse an Acrobat-style page range string ("1-3, 5, 8-") into 0-based indices.
 * Returns all pages for empty/"all" input. Out-of-range entries are clamped.
 */
export function parsePageRange(str, pageCount) {
  const all = Array.from({ length: pageCount }, (_, i) => i);
  const trimmed = String(str || '').trim().toLowerCase();
  if (!trimmed || trimmed === 'all') return all;

  const indices = new Set();
  for (const part of trimmed.split(',')) {
    const m = part.trim().match(/^(\d+)?\s*(-)?\s*(\d+)?$/);
    if (!m || (!m[1] && !m[3])) continue;
    const start = m[1] ? parseInt(m[1]) : 1;
    const end = m[2] ? (m[3] ? parseInt(m[3]) : pageCount) : start;
    for (let p = Math.max(1, start); p <= Math.min(pageCount, end); p++) indices.add(p - 1);
  }
  return [...indices].sort((a, b) => a - b);
}

/**
 * Stamp a text watermark across pages.
 *
 * @param {Uint8Array} pdfBytes
 * @param {Object} opts
 *   text       — watermark text
 *   diagonal   — true for 45°, false for horizontal (default true)
 *   opacity    — 0..1 (default 0.25)
 *   color      — hex color (default #808080)
 *   fontSize   — number, or 0/undefined for auto-fit
 *   pageIndices — 0-based indices (default: all pages)
 *   behind     — currently ignored; watermark is drawn over content
 * @returns {Promise<Uint8Array>}
 */
export async function addWatermark(pdfBytes, opts) {
  const { text } = opts;
  if (!text) return pdfBytes;

  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const targets = opts.pageIndices || pages.map((_, i) => i);
  const color = parseColor(opts.color, rgb(0.5, 0.5, 0.5));
  const opacity = Math.max(0.02, Math.min(1, opts.opacity ?? 0.25));
  const diagonal = opts.diagonal !== false;

  for (const idx of targets) {
    const page = pages[idx];
    if (!page) continue;
    const { width: w, height: h } = page.getSize();

    let fontSize = opts.fontSize;
    if (!fontSize) {
      // Auto-fit: span ~70% of the diagonal (or width) at the chosen angle
      const span = diagonal ? Math.hypot(w, h) * 0.7 : w * 0.8;
      const widthAtTen = font.widthOfTextAtSize(text, 10);
      fontSize = Math.max(10, Math.min(180, (span / widthAtTen) * 10));
    }
    const tw = font.widthOfTextAtSize(text, fontSize);

    if (diagonal) {
      const theta = Math.atan2(h, w); // match the page's own diagonal
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      page.drawText(text, {
        x: w / 2 - (tw / 2) * cos,
        y: h / 2 - (tw / 2) * sin,
        size: fontSize,
        font,
        color,
        opacity,
        rotate: degrees((theta * 180) / Math.PI),
      });
    } else {
      page.drawText(text, {
        x: (w - tw) / 2,
        y: h / 2 - fontSize * 0.35,
        size: fontSize,
        font,
        color,
        opacity,
      });
    }
  }

  return doc.save();
}

/**
 * Expand header/footer tokens for one page.
 * Supported: {page} {pages} {date} {bates}
 */
function expandTokens(template, ctx) {
  return String(template || '')
    .replace(/\{page\}/gi, String(ctx.page))
    .replace(/\{pages\}/gi, String(ctx.pages))
    .replace(/\{date\}/gi, ctx.date)
    .replace(/\{bates\}/gi, ctx.bates);
}

/**
 * Add headers/footers (Acrobat "Header & Footer" + Bates numbering).
 *
 * @param {Uint8Array} pdfBytes
 * @param {Object} opts
 *   header/footer — { left, center, right } template strings with tokens
 *   fontSize    — default 10
 *   color       — hex, default #333333
 *   marginX     — default 36 (0.5")
 *   marginY     — default 24
 *   batesStart  — starting Bates number (default 1)
 *   batesDigits — zero-pad width (default 6)
 *   pageIndices — 0-based indices (default: all)
 * @returns {Promise<Uint8Array>}
 */
export async function addHeaderFooter(pdfBytes, opts) {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const targets = opts.pageIndices || pages.map((_, i) => i);
  const color = parseColor(opts.color, rgb(0.2, 0.2, 0.2));
  const fontSize = opts.fontSize || 10;
  const marginX = opts.marginX ?? 36;
  const marginY = opts.marginY ?? 24;
  const batesDigits = opts.batesDigits || 6;
  let bates = opts.batesStart ?? 1;

  const date = new Date().toLocaleDateString();
  const header = opts.header || {};
  const footer = opts.footer || {};

  for (const idx of targets) {
    const page = pages[idx];
    if (!page) continue;
    const { width: w, height: h } = page.getSize();
    const ctx = {
      page: idx + 1,
      pages: pages.length,
      date,
      bates: String(bates).padStart(batesDigits, '0'),
    };
    bates += 1;

    const draw = (template, y, align) => {
      const text = expandTokens(template, ctx);
      if (!text) return;
      const tw = font.widthOfTextAtSize(text, fontSize);
      const x = align === 'left' ? marginX
        : align === 'center' ? (w - tw) / 2
        : w - marginX - tw;
      page.drawText(text, { x, y, size: fontSize, font, color });
    };

    const headerY = h - marginY - fontSize * 0.8;
    const footerY = marginY;
    draw(header.left, headerY, 'left');
    draw(header.center, headerY, 'center');
    draw(header.right, headerY, 'right');
    draw(footer.left, footerY, 'left');
    draw(footer.center, footerY, 'center');
    draw(footer.right, footerY, 'right');
  }

  return doc.save();
}
