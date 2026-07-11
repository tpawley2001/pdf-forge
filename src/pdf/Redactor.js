/**
 * Redactor.js — True redaction (Acrobat "Redact" tool).
 *
 * Unlike drawing a black rectangle (which leaves the text in the file), this
 * permanently removes content:
 *
 *   1. Text runs intersecting a redaction rect are removed from the page
 *      content stream (unambiguous matches only).
 *   2. The result is VERIFIED: text is re-extracted, and the pixels under
 *      each redaction rect are inspected after removal.
 *   3. Any page that still has content under a rect (scanned images, vector
 *      art, subset-font text that couldn't be matched, rotated pages) is
 *      flattened to a rendered image with the redaction burned in — a
 *      guaranteed removal path.
 *   4. Black boxes are drawn over the redacted areas.
 *
 * Redaction rects use viewer coordinates: top-left origin, PDF points.
 */
import { PDFDocument, PDFName, rgb, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { removePageTextRunsByText } from './ContentStreamTextEditor.js';

const RASTER_SCALE = 2.5;   // render resolution for flattened pages
const VERIFY_SCALE = 2;     // render resolution for pixel verification
const PIXEL_INSET = 2;      // pts shaved off rect edges before pixel test (anti-aliasing slack)
const NONWHITE_FRACTION = 0.005;

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Extract text items for a page as top-left-origin boxes in points. */
async function extractItems(pdfjsDoc, pageIndex) {
  const page = await pdfjsDoc.getPage(pageIndex + 1);
  const tc = await page.getTextContent();
  const [x0, y0, , y1] = page.view;
  const pageH = y1 - y0;
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const h = it.height || Math.hypot(it.transform[2], it.transform[3]) || 1;
    items.push({
      str: it.str,
      x: it.transform[4] - x0,
      y: pageH - (it.transform[5] - y0) - h,
      width: it.width || 1,
      // extend below the baseline to catch descenders
      height: h * 1.25,
    });
  }
  return items;
}

async function renderPageToCanvas(pdfjsDoc, pageIndex, scale) {
  const page = await pdfjsDoc.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return { canvas, vp };
}

/** True if any meaningfully non-white pixels remain inside the rect. */
function rectHasContent(canvas, rect, scale) {
  const x = Math.max(0, Math.floor((rect.x + PIXEL_INSET) * scale));
  const y = Math.max(0, Math.floor((rect.y + PIXEL_INSET) * scale));
  const w = Math.floor(Math.max(0, rect.width - PIXEL_INSET * 2) * scale);
  const h = Math.floor(Math.max(0, rect.height - PIXEL_INSET * 2) * scale);
  if (w < 2 || h < 2) return false;

  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(
    Math.min(x, canvas.width - 1),
    Math.min(y, canvas.height - 1),
    Math.min(w, canvas.width - x),
    Math.min(h, canvas.height - y),
  ).data;

  let nonWhite = 0;
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) nonWhite += 1;
  }
  return nonWhite / total > NONWHITE_FRACTION;
}

async function loadPdfjs(bytes) {
  return pdfjsLib.getDocument({ data: bytes.slice() }).promise;
}

function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1];
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/**
 * Apply redactions.
 *
 * @param {Uint8Array} pdfBytes
 * @param {Object} rectsByPage — { [zeroBasedPageIndex]: [{x,y,width,height}, …] }
 * @returns {Promise<{bytes: Uint8Array, summary: Object}>}
 */
export async function applyRedactions(pdfBytes, rectsByPage) {
  const pageIndices = Object.keys(rectsByPage).map(Number).filter(i => rectsByPage[i]?.length);
  if (!pageIndices.length) return { bytes: pdfBytes, summary: { runsRemoved: 0, boxes: 0, flattenedPages: [] } };

  // ── Pass 1: content-stream text removal ──
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const srcJs = await loadPdfjs(pdfBytes);
  let runsRemoved = 0;

  for (const idx of pageIndices) {
    const page = doc.getPages()[idx];
    if (!page) continue;
    if (page.getRotation().angle % 360 !== 0) continue; // rotated → raster path handles it

    const rects = rectsByPage[idx];
    const items = await extractItems(srcJs, idx);
    const targets = items
      .filter(it => rects.some(r => rectsOverlap(r, it)))
      .map(it => it.str);
    if (!targets.length) continue;

    const result = removePageTextRunsByText(doc, idx, targets);
    runsRemoved += result.removed;
    // unresolved targets are caught by verification below
  }

  const intermediate = await doc.save();
  await srcJs.destroy().catch(() => {});

  // ── Pass 2: verification ──
  const midJs = await loadPdfjs(intermediate.slice());
  const outDoc = await PDFDocument.load(intermediate, { ignoreEncryption: true });
  const flattenPages = new Set();

  for (const idx of pageIndices) {
    const page = outDoc.getPages()[idx];
    if (!page) continue;
    const rects = rectsByPage[idx];

    if (page.getRotation().angle % 360 !== 0) {
      flattenPages.add(idx);
      continue;
    }

    // Text check: anything intersecting a rect must be gone
    const items = await extractItems(midJs, idx);
    if (items.some(it => rects.some(r => rectsOverlap(r, it)))) {
      flattenPages.add(idx);
      continue;
    }

    // Pixel check: catches images, vector art, and unextractable text
    const { canvas } = await renderPageToCanvas(midJs, idx, VERIFY_SCALE);
    if (rects.some(r => rectHasContent(canvas, r, VERIFY_SCALE))) {
      flattenPages.add(idx);
    }
  }

  // ── Pass 3a: vector black boxes on pages that verified clean ──
  let boxes = 0;
  for (const idx of pageIndices) {
    if (flattenPages.has(idx)) continue;
    const page = outDoc.getPages()[idx];
    if (!page) continue;
    const cb = page.getCropBox();
    for (const r of rectsByPage[idx]) {
      page.drawRectangle({
        x: cb.x + r.x,
        y: cb.y + cb.height - r.y - r.height,
        width: r.width,
        height: r.height,
        color: rgb(0, 0, 0),
      });
      boxes += 1;
    }
  }

  // ── Pass 3b: guaranteed removal — flatten failing pages to an image ──
  for (const idx of flattenPages) {
    const page = outDoc.getPages()[idx];
    if (!page) continue;

    const { canvas, vp } = await renderPageToCanvas(midJs, idx, RASTER_SCALE);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    for (const r of rectsByPage[idx]) {
      ctx.fillRect(r.x * RASTER_SCALE, r.y * RASTER_SCALE, r.width * RASTER_SCALE, r.height * RASTER_SCALE);
      boxes += 1;
    }

    const png = await outDoc.embedPng(dataUrlToBytes(canvas.toDataURL('image/png')));
    const w = vp.width / RASTER_SCALE;
    const h = vp.height / RASTER_SCALE;

    // Wipe the original content, links, and geometry; replace with the render
    page.node.set(PDFName.of('Contents'), outDoc.context.obj([]));
    page.node.set(PDFName.of('Annots'), outDoc.context.obj([]));
    page.setRotation(degrees(0));
    page.setMediaBox(0, 0, w, h);
    page.setCropBox(0, 0, w, h);
    page.drawImage(png, { x: 0, y: 0, width: w, height: h });
  }

  await midJs.destroy().catch(() => {});
  const bytes = await outDoc.save();
  return {
    bytes,
    summary: {
      runsRemoved,
      boxes,
      flattenedPages: [...flattenPages].map(i => i + 1).sort((a, b) => a - b),
    },
  };
}
