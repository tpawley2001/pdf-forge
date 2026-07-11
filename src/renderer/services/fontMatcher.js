/**
 * fontMatcher.js
 *
 * Pixel-level font recognition for scanned PDF text regions.
 * Pipeline:
 *   1. Extract image crop at the OCR block's bounding box
 *   2. Binarize (dark-on-light → 1/0)
 *   3. Measure stroke width → bold detection
 *   4. Measure horizontal extensions at stroke tips → serif detection
 *   5. Render candidate installed fonts at the same size on a canvas
 *   6. Score by normalized cross-correlation
 *   7. Return the best-matching font family + characteristics
 */

// ─── Image analysis helpers ───────────────────────────────────────────────

function toBinary(imageData, w, h, threshold = 140) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = imageData.data[i * 4];
    const g = imageData.data[i * 4 + 1];
    const b = imageData.data[i * 4 + 2];
    out[i] = (0.299 * r + 0.587 * g + 0.114 * b) < threshold ? 1 : 0;
  }
  return out;
}

// Normalized cross-correlation (0–1, higher = more similar)
function ncc(a, b, len) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < len; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  const denom = Math.sqrt(aa * bb);
  return denom > 0 ? ab / denom : 0;
}

// Median horizontal dark-pixel run length in middle 60% of image → stroke width
function medianStrokeWidth(bin, w, h) {
  const runs = [];
  const y0 = Math.floor(h * 0.2);
  const y1 = Math.floor(h * 0.8);
  for (let y = y0; y < y1; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (bin[y * w + x]) {
        run++;
      } else if (run > 0) {
        runs.push(run);
        run = 0;
      }
    }
    if (run > 0) runs.push(run);
  }
  if (!runs.length) return 0;
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length / 2)];
}

// Score how "serif-like" the image is (0–1)
// Serifs show up as horizontal extensions at the top/bottom of vertical strokes.
function serifScore(bin, w, h) {
  const zone = Math.max(2, Math.floor(h * 0.18));
  let extensions = 0, candidates = 0;

  // For each column that has a dark pixel in the middle band, check if top/bottom
  // zones have horizontal neighbors (= serif foot)
  for (let x = 1; x < w - 1; x++) {
    const midY = Math.floor(h / 2);
    if (!bin[midY * w + x]) continue;
    candidates++;

    // Top zone
    for (let y = 0; y < zone; y++) {
      if (bin[y * w + x]) {
        if (bin[y * w + x - 1] || bin[y * w + x + 1]) extensions++;
        break;
      }
    }
    // Bottom zone
    for (let y = h - 1; y >= h - zone; y--) {
      if (bin[y * w + x]) {
        if (bin[y * w + x - 1] || bin[y * w + x + 1]) extensions++;
        break;
      }
    }
  }
  return candidates > 0 ? extensions / (candidates * 2) : 0;
}

// Detect column-of-mass shift left-to-right → italic
function italicSlant(bin, w, h) {
  const centers = [];
  for (let x = 0; x < w; x++) {
    let sum = 0, count = 0;
    for (let y = 0; y < h; y++) {
      if (bin[y * w + x]) { sum += y; count++; }
    }
    if (count > 1) centers.push({ x, cy: sum / count });
  }
  if (centers.length < 4) return 0;
  const n = centers.length;
  const sx  = centers.reduce((s, c) => s + c.x,  0);
  const sy  = centers.reduce((s, c) => s + c.cy, 0);
  const sxy = centers.reduce((s, c) => s + c.x * c.cy, 0);
  const sx2 = centers.reduce((s, c) => s + c.x * c.x,  0);
  const denom = n * sx2 - sx * sx;
  return denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
}

// ─── Font rendering ───────────────────────────────────────────────────────

function renderSample(text, fontCSS, targetW, targetH) {
  const c = document.createElement('canvas');
  c.width  = targetW;
  c.height = targetH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.fillStyle = '#000';
  ctx.font = fontCSS;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 2, targetH / 2);
  return toBinary(ctx.getImageData(0, 0, targetW, targetH), targetW, targetH);
}

// ─── System font access ───────────────────────────────────────────────────

let _fontsCache = null;

async function getSystemFonts() {
  if (_fontsCache) return _fontsCache;
  if (!window.queryLocalFonts) return [];
  try {
    _fontsCache = await window.queryLocalFonts();
    return _fontsCache;
  } catch (_) {
    return [];
  }
}

/** Returns Uint8Array of the font file, or null if unavailable. */
export async function getFontBytes(fontFamily, bold, italic) {
  const fonts = await getSystemFonts();
  if (!fonts.length) return null;

  // Exact style match
  let hit = fonts.find(f => {
    if (f.family !== fontFamily) return false;
    const s = f.style.toLowerCase();
    const hasBold   = s.includes('bold');
    const hasItalic = s.includes('italic') || s.includes('oblique');
    return hasBold === !!bold && hasItalic === !!italic;
  });
  // Fallback: any variant of the family (will look "close enough")
  if (!hit) hit = fonts.find(f => f.family === fontFamily);
  if (!hit) return null;

  try {
    const blob = await hit.blob();
    return new Uint8Array(await blob.arrayBuffer());
  } catch (_) {
    return null;
  }
}

// ─── Candidate pools ─────────────────────────────────────────────────────

const SANS_POOL  = ['Arial', 'Calibri', 'Segoe UI', 'Tahoma', 'Verdana', 'Trebuchet MS', 'Century Gothic'];
const SERIF_POOL = ['Times New Roman', 'Georgia', 'Cambria', 'Book Antiqua', 'Palatino Linotype'];
const MONO_POOL  = ['Courier New', 'Consolas', 'Lucida Console'];

// ─── Main export ─────────────────────────────────────────────────────────

/**
 * Analyze a text region in a rendered page canvas and return the best-matching
 * installed font family + detected characteristics.
 *
 * @param {HTMLCanvasElement} pageCanvas  - full rendered page (at `scale`)
 * @param {{ x, y, width, height }}  bbox - in PDF points (already divided by scale)
 * @param {string} text    - OCR'd text in this region
 * @param {number} scale   - render scale used for pageCanvas
 * @returns {{ fontFamily, isBold, isItalic, isSerif, confidence } | null}
 */
export async function matchFontFromRegion(pageCanvas, bbox, text, scale) {
  if (!text?.trim() || !pageCanvas) return null;

  const px = Math.round(bbox.x      * scale);
  const py = Math.round(bbox.y      * scale);
  const pw = Math.round(bbox.width  * scale);
  const ph = Math.round(bbox.height * scale);
  if (pw < 6 || ph < 6) return null;

  const ctx = pageCanvas.getContext('2d');
  const safeW = Math.min(pw, pageCanvas.width  - px);
  const safeH = Math.min(ph, pageCanvas.height - py);
  if (safeW < 4 || safeH < 4) return null;

  const imageData = ctx.getImageData(Math.max(0, px), Math.max(0, py), safeW, safeH);
  const bin = toBinary(imageData, safeW, safeH);

  // ── Detect characteristics ──
  const sw     = medianStrokeWidth(bin, safeW, safeH);
  const isBold = sw > 0 && sw / safeH > 0.10;
  const serif  = serifScore(bin, safeW, safeH);
  const isSerif = serif > 0.22;
  const slant  = italicSlant(bin, safeW, safeH);
  const isItalic = Math.abs(slant) > 0.15; // >~9° slant

  // ── Pick candidate pool ──
  const fonts = await getSystemFonts();
  const installed = new Set(fonts.map(f => f.family));
  const pool = isSerif ? SERIF_POOL : SANS_POOL;
  const candidates = pool.filter(f => installed.has(f));
  if (!candidates.length) candidates.push(...pool.slice(0, 3));

  // ── Canvas comparison ──
  const fontSize = Math.max(8, Math.round(safeH * 0.72));
  const sample   = text.replace(/\s+/g, ' ').slice(0, 20);
  let best = candidates[0], bestScore = -1;

  for (const family of candidates) {
    const css = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${fontSize}px "${family}"`;
    const rendered = renderSample(sample, css, safeW, safeH);
    const score = ncc(bin, rendered, safeW * safeH);
    if (score > bestScore) { bestScore = score; best = family; }
  }

  return { fontFamily: best, isBold, isItalic, isSerif, confidence: bestScore };
}
