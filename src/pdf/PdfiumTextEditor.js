/**
 * PdfiumTextEditor.js — Acrobat-style paragraph editing on top of PDFium.
 *
 *   findParagraph()    click → the whole paragraph (lines, font, size, color,
 *                      alignment, line spacing) as an editable block
 *   replaceParagraph() remove the paragraph's text objects and re-lay the new
 *                      text out with the same font/matrix/color, reflowed to
 *                      the paragraph width
 *
 * The original embedded font is reused when it has every glyph the new text
 * needs (subset fonts only carry glyphs that were used somewhere in the
 * document); otherwise the paragraph switches to the matching system font, or
 * the closest standard-14 font.
 *
 * Every edit is verified before it is accepted: the page is rendered before
 * and after, and any pixel change outside the edited region (i.e. PDFium's
 * content regeneration damaged something else) rejects the edit so the caller
 * can fall back to the older content-stream / whiteout paths. Returns null in
 * every "can't do this safely" case.
 */

import {
  withPdfiumDoc,
  renderPageBGRA,
  pageViewTransform,
  invertTransform,
  transformRect,
} from './PdfiumEngine.js';

const PAGEOBJ_TEXT = 1;
const FPDF_FONT_TRUETYPE = 2;
const MAX_LINES = 200;

// ─── Small utils ──────────────────────────────────────────────────────────

const squash = s => String(s || '').replace(/\s+/g, '');
const median = arr => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function toHex(r, g, b) {
  return `#${[r, g, b].map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
}

function unionRect(rects) {
  return rects.reduce((u, r) => (u ? {
    left: Math.min(u.left, r.left), right: Math.max(u.right, r.right),
    bottom: Math.min(u.bottom, r.bottom), top: Math.max(u.top, r.top),
  } : { ...r }), null);
}

function overlapArea(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);
  return w > 0 && h > 0 ? w * h : 0;
}

// ─── Page text model ──────────────────────────────────────────────────────

function stripSubsetPrefix(name) {
  return String(name || '').replace(/^[A-Z]{6}\+/, '');
}

function fontInfo(pdoc, font, cache) {
  if (cache.has(font)) return cache.get(font);
  const { m } = pdoc;
  const baseName = pdoc.readUtf8((p, n) => m.FPDFFont_GetBaseFontName(font, p, n));
  const familyName = pdoc.readUtf8((p, n) => m.FPDFFont_GetFamilyName(font, p, n));
  const weight = m.FPDFFont_GetWeight(font);
  const italicAngle = pdoc.withBuffer(4, p => (m.FPDFFont_GetItalicAngle(font, p) ? pdoc.P.getValue(p, 'i32') : 0));
  const info = {
    baseName,
    familyName: familyName || stripSubsetPrefix(baseName).split(/[-,]/)[0],
    embedded: !!m.FPDFFont_GetIsEmbedded(font),
    bold: weight >= 600 || /bold|black|heavy|semibold|demi/i.test(baseName),
    italic: italicAngle !== 0 || /italic|oblique/i.test(baseName),
  };
  cache.set(font, info);
  return info;
}

/** All top-level text objects on a page, with geometry and style. */
function collectRuns(pdoc, page, textPage, fontCache) {
  const { m, P } = pdoc;
  const runs = [];
  const count = m.FPDFPage_CountObjects(page);
  pdoc.withBuffer(32, buf => {
    for (let index = 0; index < count; index += 1) {
      const obj = m.FPDFPage_GetObject(page, index);
      if (!obj || m.FPDFPageObj_GetType(obj) !== PAGEOBJ_TEXT) continue;
      const text = pdoc.readUtf16((p, n) => m.FPDFTextObj_GetText(obj, textPage, p, n));
      if (!text || !text.trim()) continue;
      if (!m.FPDFPageObj_GetBounds(obj, buf, buf + 4, buf + 8, buf + 12)) continue;
      const [left, bottom, right, top] = pdoc.floats(buf, 4);
      if (!m.FPDFPageObj_GetMatrix(obj, buf)) continue;
      const matrix = pdoc.floats(buf, 6);
      const rawSize = m.FPDFTextObj_GetFontSize(obj, buf) ? P.getValue(buf, 'float') : 0;
      const fill = m.FPDFPageObj_GetFillColor(obj, buf, buf + 4, buf + 8, buf + 12)
        ? [0, 1, 2, 3].map(k => P.getValue(buf + k * 4, 'i32') >>> 0)
        : [0, 0, 0, 255];
      const font = m.FPDFTextObj_GetFont(obj);
      const [a, b, c, d] = matrix;
      runs.push({
        index, obj, text, matrix, rawSize, fill, font,
        fontInfo: fontInfo(pdoc, font, fontCache),
        renderMode: m.FPDFTextObj_GetTextRenderMode(obj),
        rect: { left, bottom, right, top },
        size: rawSize * Math.hypot(c, d),
        upright: Math.abs(b) < 1e-3 && Math.abs(c) < 1e-3 && a > 0 && d > 0,
        originX: matrix[4],
        baseline: matrix[5],
      });
    }
  });
  return runs;
}

/** Group upright runs into visual lines (same baseline + size, no column gap). */
function buildLines(runs) {
  const upright = runs.filter(r => r.upright && r.size > 0).sort((a, b) => b.baseline - a.baseline || a.rect.left - b.rect.left);
  const bands = [];
  for (const run of upright) {
    const band = bands.find(bd => near(bd.baseline, run.baseline, 0.3 * bd.size) && near(bd.size, run.size, 0.15 * bd.size));
    if (band) band.runs.push(run);
    else bands.push({ baseline: run.baseline, size: run.size, runs: [run] });
  }
  const lines = [];
  for (const band of bands) {
    band.runs.sort((a, b) => a.rect.left - b.rect.left);
    let cur = null;
    for (const run of band.runs) {
      if (cur && run.rect.left - cur.right <= 1.5 * band.size) {
        cur.runs.push(run);
        cur.right = Math.max(cur.right, run.rect.right);
      } else {
        cur = { runs: [run], right: run.rect.right };
        lines.push(cur);
      }
    }
  }
  for (const line of lines) {
    const first = line.runs[0];
    line.left = Math.min(...line.runs.map(r => r.rect.left));
    line.originX = first.originX;
    line.baseline = median(line.runs.map(r => r.baseline));
    line.size = first.size;
    line.rect = unionRect(line.runs.map(r => r.rect));
    let text = '';
    let prev = null;
    for (const run of line.runs) {
      if (prev && run.rect.left - prev.rect.right > 0.12 * line.size && !/\s$/.test(text) && !/^\s/.test(run.text)) text += ' ';
      text += run.text;
      prev = run;
    }
    line.text = text.replace(/\s+$/, '');
    // Dominant font = the one covering the most characters
    const byFont = new Map();
    for (const run of line.runs) byFont.set(run.fontInfo.baseName, (byFont.get(run.fontInfo.baseName) || 0) + run.text.length);
    line.fontName = [...byFont.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return lines;
}

function horizontalOverlap(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  return w / Math.max(1, Math.min(a.right - a.left, b.right - b.left));
}

function canJoin(cur, cand, seed, spacing) {
  if (!near(cand.size, seed.size, 0.15 * seed.size)) return false;
  if (cand.fontName !== seed.fontName) return false;
  if (horizontalOverlap(cur, cand) < 0.3) return false;
  const delta = Math.abs(cur.baseline - cand.baseline);
  if (delta < 0.9 * seed.size || delta > 2.2 * seed.size) return false;
  if (spacing && !near(delta, spacing, 0.2 * seed.size)) return false;
  const leftOk = near(cand.left, cur.left, 2.5 * seed.size);
  const centerOk = near((cand.left + cand.right) / 2, (cur.left + cur.right) / 2, seed.size);
  return leftOk || centerOk;
}

// List items are separate paragraphs, like Acrobat's edit boxes
const BULLET_RE = /^\s*(?:[•◦▪▫■□●○‣⁃∙·\-–—*]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s*/;
const startsItem = line => BULLET_RE.test(line.text) || /^Symbol|Wingding|Dingbat/i.test(line.runs[0].fontInfo.baseName);

/** Grow a paragraph up and down from the seed line. */
function growParagraph(lines, seed) {
  const para = [seed];
  let spacing = 0;
  const step = (dir) => {
    let cur = dir < 0 ? para[0] : para[para.length - 1];
    while (para.length < MAX_LINES) {
      const candidates = lines
        .filter(l => !para.includes(l) && (dir < 0 ? l.baseline > cur.baseline : l.baseline < cur.baseline) && horizontalOverlap(cur, l) > 0)
        .sort((a, b) => Math.abs(a.baseline - cur.baseline) - Math.abs(b.baseline - cur.baseline));
      const cand = candidates[0];
      if (!cand || !canJoin(cur, cand, seed, spacing)) break;
      // Going down, a new list item ends the paragraph; going up, stop once
      // the current line is itself the start of an item.
      if (dir > 0 ? startsItem(cand) : startsItem(cur)) break;
      if (!spacing) spacing = Math.abs(cur.baseline - cand.baseline);
      if (dir < 0) para.unshift(cand); else para.push(cand);
      cur = cand;
    }
  };
  step(-1);
  step(1);
  return { lines: para, spacing };
}

function detectAlign(lines) {
  if (lines.length < 2) return 'left';
  const size = lines[0].size;
  const body = lines.slice(1);
  const lefts = body.map(l => l.left);
  const leftAligned = Math.max(...lefts) - Math.min(...lefts) <= 0.5 * size;
  const rights = lines.slice(0, -1).map(l => l.right);
  const rightAligned = Math.max(...rights) - Math.min(...rights) <= 0.1 * size;
  const centers = lines.map(l => (l.left + l.right) / 2);
  const centered = Math.max(...centers) - Math.min(...centers) <= 0.5 * size;
  if (leftAligned && rightAligned && lines.length >= 3) return 'justify';
  if (leftAligned) return 'left';
  if (centered) return 'center';
  if (rights.length && Math.max(...lines.map(l => l.right)) - Math.min(...lines.map(l => l.right)) <= 0.5 * size) return 'right';
  return 'left';
}

function joinLines(lines) {
  let text = '';
  for (const line of lines) {
    if (!text) text = line.text;
    else if (/[A-Za-z]-$/.test(text)) text += line.text.trimStart();
    else text += ` ${line.text.trimStart()}`;
  }
  return text;
}

function describeParagraph(pdoc, page, para, viewT) {
  const { lines, spacing } = para;
  const first = lines[0].runs[0];
  const rect = unionRect(lines.map(l => l.rect));
  const v = transformRect(viewT, rect);
  const [r, g, b] = first.fill;
  return {
    text: joinLines(lines),
    runIndexes: lines.flatMap(l => l.runs.map(run => run.index)),
    signature: lines.map(l => l.text).join('\n'),
    bbox: { x: v.left, y: v.bottom, width: v.right - v.left, height: v.top - v.bottom },
    fontSize: Math.round(first.size * 10) / 10,
    color: toHex(r, g, b),
    bold: first.fontInfo.bold,
    italic: first.fontInfo.italic,
    // Mixed styling inside the paragraph (e.g. a bold lead-in): the editor
    // shows B/I as neutral so a toggle is an explicit whole-paragraph change
    mixedBold: new Set(lines.flatMap(l => l.runs.map(r => r.fontInfo.bold))).size > 1,
    mixedItalic: new Set(lines.flatMap(l => l.runs.map(r => r.fontInfo.italic))).size > 1,
    fontFamily: first.fontInfo.familyName,
    align: detectAlign(lines),
    lineCount: lines.length,
    lineHeight: spacing || first.size * 1.2,
  };
}

function viewBboxToPdfRect(viewT, bbox) {
  const inv = invertTransform(viewT);
  return transformRect(inv, { left: bbox.x, right: bbox.x + bbox.width, bottom: bbox.y, top: bbox.y + bbox.height });
}

function locateSeedLine(lines, target, originalText) {
  const want = squash(originalText);
  let best = null;
  let bestScore = 0;
  for (const line of lines) {
    for (const run of line.runs) {
      const area = overlapArea(run.rect, target);
      if (!area) continue;
      let score = area / Math.max(1, (run.rect.right - run.rect.left) * (run.rect.top - run.rect.bottom));
      if (want && squash(line.text).includes(want)) score += 1;
      if (score > bestScore) { bestScore = score; best = line; }
    }
  }
  return best;
}

function openPage(pdoc, pageIndex) {
  const { m } = pdoc;
  if (pageIndex < 0 || pageIndex >= pdoc.pageCount()) throw new Error(`Page index ${pageIndex} out of range`);
  const page = m.FPDF_LoadPage(pdoc.doc, pageIndex);
  if (!page) throw new Error(`PDFium could not load page ${pageIndex + 1}`);
  const textPage = m.FPDFText_LoadPage(page);
  return {
    page,
    textPage,
    close() { m.FPDFText_ClosePage(textPage); m.FPDF_ClosePage(page); },
  };
}

function resolveParagraph(lines, viewT, target) {
  // Prefer the exact objects identified at click time, if the page is unchanged
  if (target.runIndexes?.length) {
    const wanted = new Set(target.runIndexes);
    const picked = lines.filter(l => l.runs.some(r => wanted.has(r.index)));
    const all = picked.flatMap(l => l.runs.map(r => r.index));
    if (picked.length && all.length === wanted.size && all.every(i => wanted.has(i))) {
      picked.sort((a, b) => b.baseline - a.baseline);
      if (!target.signature || picked.map(l => l.text).join('\n') === target.signature) {
        return growParagraphFixed(picked);
      }
    }
  }
  if (!target.bbox) return null;
  const seed = locateSeedLine(lines, viewBboxToPdfRect(viewT, target.bbox), target.originalText);
  if (!seed) return null;
  return growParagraph(lines, seed);
}

function growParagraphFixed(lines) {
  const deltas = lines.slice(1).map((l, i) => lines[i].baseline - l.baseline);
  return { lines, spacing: median(deltas) };
}

// ─── Public: find ─────────────────────────────────────────────────────────

/**
 * Find the paragraph under a viewport-space bbox (pdf.js scale-1 coords).
 * Returns a descriptor usable as a text-edit seed, or null.
 */
export async function findParagraph(pdfBytes, pageIndex, bbox, originalText = '') {
  try {
    return await withPdfiumDoc(pdfBytes, (pdoc) => {
      const pg = openPage(pdoc, pageIndex);
      try {
        const viewT = pageViewTransform(pdoc, pg.page);
        const lines = buildLines(collectRuns(pdoc, pg.page, pg.textPage, new Map()));
        const para = resolveParagraph(lines, viewT, { bbox, originalText });
        if (!para) return null;
        // The clicked text must actually be part of what we found
        if (originalText && !squash(para.lines.map(l => l.text).join('')).includes(squash(originalText))) return null;
        return describeParagraph(pdoc, pg.page, para, viewT);
      } finally {
        pg.close();
      }
    });
  } catch (err) {
    console.warn('PDFium findParagraph failed:', err);
    return null;
  }
}

// ─── Fonts ────────────────────────────────────────────────────────────────

/** Characters each subset font is known to have glyphs for (doc-wide). */
function subsetCoverage(pdoc, fontBaseName, maxPages = 300) {
  const { m } = pdoc;
  const chars = new Set();
  const pages = Math.min(pdoc.pageCount(), maxPages);
  const fontCache = new Map();
  for (let i = 0; i < pages; i += 1) {
    const pg = openPage(pdoc, i);
    try {
      for (const run of collectRuns(pdoc, pg.page, pg.textPage, fontCache)) {
        if (run.fontInfo.baseName === fontBaseName) for (const ch of run.text) chars.add(ch);
      }
    } finally {
      pg.close();
    }
  }
  return chars;
}

function standardFontName(family, bold, italic) {
  const f = String(family || '').toLowerCase();
  if (/courier|mono|consol|typewriter/.test(f)) {
    return ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'][(bold ? 1 : 0) + (italic ? 2 : 0)];
  }
  if (/times|serif|roman|georgia|garamond|cambria|book|palatino|minion/.test(f) && !/sans/.test(f)) {
    return ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'][(bold ? 1 : 0) + (italic ? 2 : 0)];
  }
  return ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'][(bold ? 1 : 0) + (italic ? 2 : 0)];
}

function familyCandidates(family) {
  const base = stripSubsetPrefix(family).replace(/(MT|PS|Std|Pro)$/,'').split(/[-,]/)[0];
  const spaced = base.replace(/([a-z])([A-Z])/g, '$1 $2');
  return [...new Set([family, base, spaced].filter(Boolean))];
}

async function loadSubstituteFont(pdoc, family, bold, italic, loadFontBytes) {
  const { m } = pdoc;
  if (loadFontBytes) {
    for (const name of familyCandidates(family)) {
      let bytes = null;
      try { bytes = await loadFontBytes(name, bold, italic); } catch (_) { bytes = null; }
      if (!bytes || bytes.length < 12) continue;
      const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      if (tag === 'OTTO' || tag === 'ttcf') continue; // CFF / collections: PDFium TrueType loader can't take these
      const ptr = pdoc.malloc(bytes.length);
      pdoc.P.HEAPU8.set(bytes, ptr);
      try {
        const font = m.FPDFText_LoadFont(pdoc.doc, ptr, bytes.length, FPDF_FONT_TRUETYPE, true);
        if (font) return { font, name, owned: true };
      } finally {
        pdoc.free(ptr);
      }
    }
  }
  const std = standardFontName(family, bold, italic);
  const font = m.FPDFText_LoadStandardFont(pdoc.doc, std);
  return font ? { font, name: std, owned: true, standard: true } : null;
}

// ─── Styled words ─────────────────────────────────────────────────────────

/** A run's visual style; words keep the style of the run they came from. */
function runStyle(run) {
  return {
    key: `${run.font}|${run.rawSize.toFixed(3)}|${run.fill.join(',')}|${run.renderMode}|${run.matrix.slice(0, 4).map(v => v.toFixed(4)).join(',')}`,
    font: run.font,
    fontInfo: run.fontInfo,
    rawSize: run.rawSize,
    size: run.size,
    fill: run.fill,
    renderMode: run.renderMode,
    matrix: run.matrix,
  };
}

/**
 * Paragraph → [{ text, style }] in reading order, split the same way
 * joinLines() builds the paragraph's text (so word i lines up with
 * describeParagraph().text.split(' ')[i]).
 */
function paragraphWords(lines) {
  const words = [];
  let cur = null;
  const flush = () => { if (cur && cur.text) words.push(cur); cur = null; };
  lines.forEach((line, li) => {
    // A line ending in letter+hyphen glues to the next line's first word
    const glue = li > 0 && words.length && /[A-Za-z]-$/.test(words[words.length - 1].text) && !cur;
    let prev = null;
    let first = true;
    for (const run of line.runs) {
      const gap = prev && run.rect.left - prev.rect.right > 0.12 * line.size;
      if (gap) flush();
      for (const piece of run.text.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) { flush(); continue; }
        if (first && glue) {
          cur = words.pop();
          cur.text += piece;
        } else if (cur) {
          cur.text += piece;
        } else {
          cur = { text: piece, style: runStyle(run) };
        }
        first = false;
      }
      prev = run;
    }
    flush();
  });
  return words;
}

/** Longest-common-subsequence match of new words onto old words. */
function matchWords(oldWords, newWords) {
  const n = oldWords.length;
  const k = newWords.length;
  if (n * k > 4e6) return new Array(k).fill(-1); // huge edits: skip diff
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(k + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = k - 1; j >= 0; j -= 1) {
      dp[i][j] = oldWords[i] === newWords[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const map = new Array(k).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < k) {
    if (oldWords[i] === newWords[j]) { map[j] = i; i += 1; j += 1; } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1; else j += 1;
  }
  // Unmatched words between two matches that replaced old words 1:1 keep
  // those old words' styles (a "changed" word stays bold if it was bold).
  let lastOld = -1;
  for (let j2 = 0; j2 < k; j2 += 1) {
    if (map[j2] >= 0) { lastOld = map[j2]; continue; }
    let next = j2;
    while (next < k && map[next] < 0) next += 1;
    const nextOld = next < k ? map[next] : n;
    const gapOld = nextOld - lastOld - 1;
    const gapNew = next - j2;
    if (gapOld === gapNew) {
      for (let t = 0; t < gapNew; t += 1) map[j2 + t] = -(lastOld + 1 + t) - 2; // encode "replaced old index"
    }
    j2 = next - 1;
  }
  return map;
}

function styleForNewWords(oldWords, newTexts) {
  const map = matchWords(oldWords.map(w => w.text), newTexts);
  const styles = new Array(newTexts.length).fill(null);
  map.forEach((v, j) => {
    if (v >= 0) styles[j] = oldWords[v].style;
    else if (v <= -2) styles[j] = oldWords[-v - 2].style;
  });
  // Pure insertions inherit from the previous word (or the next one at the start)
  for (let j = 0; j < styles.length; j += 1) if (!styles[j] && j > 0) styles[j] = styles[j - 1];
  for (let j = styles.length - 1; j >= 0; j -= 1) if (!styles[j]) styles[j] = styles[j + 1] || oldWords[0]?.style;
  return styles;
}

// ─── Layout ───────────────────────────────────────────────────────────────

function makeMeasurer(pdoc, font, rawSize, matrix) {
  const { m } = pdoc;
  const cache = new Map();
  const obj = m.FPDFPageObj_CreateTextObj(pdoc.doc, font, rawSize);
  if (!obj) throw new Error('CreateTextObj failed');
  pdoc.withBuffer(24, p => {
    [matrix[0], matrix[1], matrix[2], matrix[3], 0, 0].forEach((v, i) => pdoc.P.setValue(p + i * 4, v, 'float'));
    m.FPDFPageObj_SetMatrix(obj, p);
  });
  const measure = (text) => {
    if (!text) return 0;
    if (cache.has(text)) return cache.get(text);
    const w = pdoc.allocUtf16(text);
    let width = 0;
    try {
      m.FPDFText_SetText(obj, w);
      width = pdoc.withBuffer(16, b => (m.FPDFPageObj_GetBounds(obj, b, b + 4, b + 8, b + 12)
        ? pdoc.P.getValue(b + 8, 'float') - pdoc.P.getValue(b, 'float') : 0));
    } finally {
      pdoc.free(w);
    }
    cache.set(text, width);
    return width;
  };
  const spaceWidth = Math.max(0, measure('x x') - measure('xx')) || rawSize * Math.abs(matrix[0]) * 0.25;
  return { measure, spaceWidth, destroy: () => m.FPDFPageObj_Destroy(obj) };
}

/**
 * Greedy wrap of styled tokens.
 * tokens: [{ text, style }] | { hard: true } markers between typed paragraphs.
 * Returns lines: [{ tokens, hard }].
 */
function wrapTokens(tokens, widthOf, spaceOf, maxWidth) {
  const out = [];
  let line = [];
  let width = 0;
  for (const tok of tokens) {
    if (tok.hard) { out.push({ tokens: line, hard: true }); line = []; width = 0; continue; }
    const ww = widthOf(tok);
    const next = line.length ? width + spaceOf(line[line.length - 1]) + ww : ww;
    if (line.length && next > maxWidth) {
      out.push({ tokens: line, hard: false });
      line = [tok];
      width = ww;
    } else {
      line.push(tok);
      width = next;
    }
  }
  out.push({ tokens: line, hard: true });
  return out;
}

// ─── Verification ─────────────────────────────────────────────────────────

/** [left, bottom, right, top] of the visible page box (what PDFium renders). */
function cropBox(pdoc, page) {
  const { m } = pdoc;
  return pdoc.withBuffer(16, b => {
    const ok = m.FPDFPage_GetCropBox(page, b, b + 4, b + 8, b + 12)
      || m.FPDFPage_GetMediaBox(page, b, b + 4, b + 8, b + 12);
    if (!ok) return [0, 0, m.FPDF_GetPageWidthF(page), m.FPDF_GetPageHeightF(page)];
    const [l, bt, r, t] = pdoc.floats(b, 4);
    return [Math.min(l, r), Math.min(bt, t), Math.max(l, r), Math.max(bt, t)];
  });
}

/** Fraction of pixels outside `skip` (PDF-space rect) that changed noticeably. */
function diffOutside(before, after, skip, scale) {
  if (before.width !== after.width || before.height !== after.height) return 1;
  // Bitmaps are rendered unrotated in PDFium page space (top-left origin)
  const sx0 = Math.floor(skip.left * scale);
  const sx1 = Math.ceil(skip.right * scale);
  const sy0 = Math.floor((before.pageTop - skip.top) * scale);
  const sy1 = Math.ceil((before.pageTop - skip.bottom) * scale);
  let changed = 0;
  let total = 0;
  const { width, height } = before;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= sx0 && x <= sx1 && y >= sy0 && y <= sy1) continue;
      total += 1;
      const i = (y * width + x) * 4;
      if (Math.abs(before.data[i] - after.data[i]) > 48
        || Math.abs(before.data[i + 1] - after.data[i + 1]) > 48
        || Math.abs(before.data[i + 2] - after.data[i + 2]) > 48) changed += 1;
    }
  }
  return total ? changed / total : 0;
}

// ─── Public: replace ──────────────────────────────────────────────────────

/**
 * Replace a paragraph's text.
 *
 * Each new word keeps the style (font, size, color) of the old word it
 * replaces (word-level diff); inserted words take their neighbour's style.
 *
 * @param {Uint8Array} pdfBytes
 * @param {number} pageIndex 0-based
 * @param {object} target { runIndexes?, signature?, bbox?, originalText? }
 * @param {string} newText  '\n' = hard paragraph break; everything else reflows
 * @param {object} opts {
 *   fontSize?, color?, bold?, italic?, align?   — explicit user overrides
 *   viewOffset?: {dx, dy}  — box moved in the viewer (pdf.js scale-1 units)
 *   viewWidth?             — box resized: new wrap width
 *   loadFontBytes?(family, bold, italic) → Uint8Array  — system font source
 * }
 * @returns {Promise<null | { bytes, fontSubstituted, fontName, lines }>}
 */
export async function replaceParagraph(pdfBytes, pageIndex, target, newText, opts = {}) {
  try {
    return await withPdfiumDoc(pdfBytes, async (pdoc) => {
      const { m } = pdoc;
      const pg = openPage(pdoc, pageIndex);
      let closed = false;
      const closePage = () => { if (!closed) { closed = true; pg.close(); } };
      const measurers = new Map();
      try {
        const viewT = pageViewTransform(pdoc, pg.page);
        const lines = buildLines(collectRuns(pdoc, pg.page, pg.textPage, new Map()));
        const para = resolveParagraph(lines, viewT, target);
        if (!para) return null;
        const oldText = para.lines.map(l => l.text).join('');
        if (target.originalText && !squash(oldText).includes(squash(target.originalText))
          && !squash(target.originalText).includes(squash(oldText))) return null;

        const paraLines = para.lines;
        const first = paraLines[0].runs[0];
        const desc = describeParagraph(pdoc, pg.page, para, viewT);

        // ── Explicit user overrides (only what differs from what was detected) ──
        const sizeScale = opts.fontSize && !near(opts.fontSize, desc.fontSize, 0.05) ? opts.fontSize / first.size : 1;
        const forceBold = opts.bold != null && (desc.mixedBold || opts.bold !== desc.bold) ? opts.bold : null;
        const forceItalic = opts.italic != null && (desc.mixedItalic || opts.italic !== desc.italic) ? opts.italic : null;
        const forceFill = opts.color && opts.color.toLowerCase() !== desc.color ? [...parseHex(opts.color), 255] : null;
        let align = opts.align || desc.align;

        // ── Styled tokens ──
        const oldWords = paragraphWords(paraLines);
        const typed = String(newText).split('\n').map(p => p.split(/[ \t]+/).filter(Boolean));
        const flat = typed.flat();
        const styles = styleForNewWords(oldWords, flat);
        const tokens = [];
        let wi = 0;
        typed.forEach((words, pi) => {
          if (pi > 0) tokens.push({ hard: true });
          for (const w of words) tokens.push({ text: w, style: styles[wi++] });
        });

        // ── Fonts: reuse each original font only if it can draw its words ──
        const coverage = new Map();
        const covered = (style, chars) => {
          if (!style.fontInfo.embedded) return true; // non-embedded: encodability checked on readback
          // PDFium strips the ABCDEF+ subset tag from names, so treat every
          // embedded font as a possible subset: only glyphs seen in use are safe.
          const name = style.fontInfo.baseName;
          if (!coverage.has(name)) coverage.set(name, subsetCoverage(pdoc, name));
          const have = coverage.get(name);
          return [...chars].every(ch => have.has(ch));
        };
        const needByKey = new Map();
        for (const tok of tokens) {
          if (tok.hard) continue;
          const set = needByKey.get(tok.style.key) || new Set();
          for (const ch of tok.text) set.add(ch);
          needByKey.set(tok.style.key, set);
        }
        const resolved = new Map(); // style.key → final style
        let substituted = false;
        let fontName = first.fontInfo.baseName;
        for (const tok of tokens) {
          if (tok.hard || resolved.has(tok.style.key)) continue;
          const st = tok.style;
          const bold = forceBold ?? st.fontInfo.bold;
          const italic = forceItalic ?? st.fontInfo.italic;
          let font = st.font;
          let name = st.fontInfo.baseName;
          if (forceBold != null || forceItalic != null || !covered(st, needByKey.get(st.key))) {
            const sub = await loadSubstituteFont(pdoc, st.fontInfo.familyName, bold, italic, opts.loadFontBytes);
            if (!sub) return null;
            font = sub.font;
            name = sub.name;
            substituted = true;
          }
          if (st === first || st.key === runStyle(first).key) fontName = name;
          resolved.set(st.key, { ...st, font, rawSize: st.rawSize * sizeScale, size: st.size * sizeScale, fill: forceFill || st.fill });
        }
        for (const tok of tokens) if (!tok.hard) tok.style = resolved.get(tok.style.key);

        const measurerFor = (st) => {
          const key = `${st.font}|${st.rawSize}|${st.matrix.slice(0, 4).join(',')}`;
          if (!measurers.has(key)) measurers.set(key, makeMeasurer(pdoc, st.font, st.rawSize, st.matrix));
          return measurers.get(key);
        };
        const widthOf = tok => measurerFor(tok.style).measure(tok.text);
        const spaceOf = tok => measurerFor(tok.style).spaceWidth;

        // ── Geometry ──
        // Box dragged in the viewer → move the paragraph (viewport delta → PDF delta)
        let shiftX = 0;
        let shiftY = 0;
        const off = opts.viewOffset;
        if (off && (Math.abs(off.dx) > 0.25 || Math.abs(off.dy) > 0.25)) {
          const inv = invertTransform(viewT);
          shiftX = inv[0] * off.dx + inv[2] * off.dy;
          shiftY = inv[1] * off.dx + inv[3] * off.dy;
        }
        const leftX = Math.min(...paraLines.map(l => l.originX)) + shiftX;
        const rightX = Math.max(...paraLines.map(l => l.right)) + shiftX;
        const firstX = paraLines[0].originX + shiftX;
        const restX = (paraLines.length > 1 ? paraLines[1].originX : paraLines[0].originX) + shiftX;
        const lineHeight = (para.spacing || first.size * 1.2) * sizeScale;
        const unrotated = Math.abs(viewT[1]) < 1e-6; // view x ∥ PDF x
        let maxWidth;
        if (opts.viewWidth && unrotated) maxWidth = opts.viewWidth;
        else if (paraLines.length > 1) maxWidth = rightX - leftX + 0.5;
        else maxWidth = Infinity; // single line: grow like Acrobat, don't wrap

        // Justified text whose geometry looked left-aligned (e.g. only two
        // lines): non-last lines stretched well past their natural width.
        if (align === 'left' && !opts.align && paraLines.length >= 2) {
          const wordsOf = line => paragraphWords([line]);
          const stretched = paraLines.slice(0, -1).every(line => {
            const ws = wordsOf(line);
            if (ws.length < 3) return false;
            const natural = ws.reduce((sum, w, i) => {
              const ms = measurerFor({ ...w.style, rawSize: w.style.rawSize });
              return sum + ms.measure(w.text) + (i < ws.length - 1 ? ms.spaceWidth : 0);
            }, 0);
            return (line.right - line.originX) - natural > 0.25 * line.size;
          });
          if (stretched) align = 'justify';
        }

        const layout = wrapTokens(tokens, widthOf, spaceOf, maxWidth === Infinity ? Infinity : maxWidth - (firstX - leftX));

        // Before-render for verification (must happen before mutation)
        const scale = 1.5;
        const before = renderPageBGRA(pdoc, pg.page, scale);

        // ── Remove old objects (highest index first keeps indexes valid) ──
        const removeIdx = [...new Set(paraLines.flatMap(l => l.runs.map(r => r.index)))].sort((a, b) => b - a);
        let insertAt = removeIdx[removeIdx.length - 1];
        for (const idx of removeIdx) {
          const obj = m.FPDFPage_GetObject(pg.page, idx);
          if (!obj || !m.FPDFPage_RemoveObject(pg.page, obj)) return null;
          m.FPDFPageObj_Destroy(obj);
        }

        // ── Create new objects ──
        const created = [];
        const place = (text, st, x, y) => {
          const obj = m.FPDFPageObj_CreateTextObj(pdoc.doc, st.font, st.rawSize);
          if (!obj) throw new Error('CreateTextObj failed');
          const w = pdoc.allocUtf16(text);
          try { m.FPDFText_SetText(obj, w); } finally { pdoc.free(w); }
          pdoc.withBuffer(24, p => {
            [st.matrix[0], st.matrix[1], st.matrix[2], st.matrix[3], x, y]
              .forEach((v, i) => pdoc.P.setValue(p + i * 4, v, 'float'));
            m.FPDFPageObj_SetMatrix(obj, p);
          });
          m.FPDFPageObj_SetFillColor(obj, st.fill[0], st.fill[1], st.fill[2], st.fill[3]);
          if (st.renderMode >= 0) m.FPDFTextObj_SetTextRenderMode(obj, st.renderMode);
          m.FPDFPage_InsertObjectAtIndex(pg.page, obj, insertAt);
          insertAt += 1;
          created.push({ obj, text });
        };

        let y = paraLines[0].baseline + shiftY;
        let firstOfPara = true;
        for (const ln of layout) {
          const x0 = firstOfPara ? firstX : restX;
          const toks = ln.tokens;
          if (toks.length) {
            const widths = toks.map(widthOf);
            const natural = widths.reduce((s, v) => s + v, 0)
              + toks.slice(0, -1).reduce((s, t) => s + spaceOf(t), 0);
            const avail = maxWidth === Infinity ? natural : (leftX + maxWidth) - x0;
            const justify = align === 'justify' && !ln.hard && toks.length > 1;
            const extra = justify ? (avail - natural) / (toks.length - 1) : 0;
            let x = x0;
            if (align === 'center') x = x0 + (avail - natural) / 2;
            else if (align === 'right') x = x0 + (avail - natural);
            // Merge consecutive same-style words into one object (not when justifying)
            let segText = '';
            let segStyle = null;
            let segX = x;
            const flushSeg = () => { if (segText) place(segText, segStyle, segX, y); segText = ''; };
            toks.forEach((tok, i) => {
              if (justify || tok.style !== segStyle) {
                flushSeg();
                segStyle = tok.style;
                segX = x;
                segText = tok.text;
              } else {
                segText += ` ${tok.text}`;
              }
              x += widths[i] + (i < toks.length - 1 ? spaceOf(tok) + extra : 0);
            });
            flushSeg();
          }
          firstOfPara = ln.hard;
          y -= lineHeight;
        }

        if (!m.FPDFPage_GenerateContent(pg.page)) return null;

        // Characters PDFium couldn't encode → this font can't draw them.
        // (The text page must be rebuilt to see the new objects.)
        const freshText = m.FPDFText_LoadPage(pg.page);
        try {
          const bad = created.some(c => squash(pdoc.readUtf16((p, n) => m.FPDFTextObj_GetText(c.obj, freshText, p, n))) !== squash(c.text));
          if (bad) return null;
        } finally {
          m.FPDFText_ClosePage(freshText);
        }

        // Region the edit is allowed to change
        const newRects = created.map(c => pdoc.withBuffer(16, b => (m.FPDFPageObj_GetBounds(c.obj, b, b + 4, b + 8, b + 12)
          ? (([l, bt, r, t]) => ({ left: l, bottom: bt, right: r, top: t }))(pdoc.floats(b, 4)) : null))).filter(Boolean);
        const pad = 2;
        const region = unionRect([...paraLines.map(l => l.rect), ...newRects]);
        region.left -= pad; region.bottom -= pad; region.right += pad; region.top += pad;

        for (const ms of measurers.values()) ms.destroy();
        measurers.clear();
        closePage();
        const bytes = pdoc.save();

        // ── Verify ──
        const verified = await withPdfiumDoc(bytes, (check) => {
          const cp = openPage(check, pageIndex);
          try {
            const after = renderPageBGRA(check, cp.page, scale);
            const [cropLeft, , , cropTop] = cropBox(check, cp.page);
            before.pageTop = cropTop;
            const shifted = { left: region.left - cropLeft, right: region.right - cropLeft, top: region.top, bottom: region.bottom };
            const outside = check.m.FPDFPage_GetRotation(cp.page) === 0
              ? diffOutside(before, after, shifted, scale)
              : 0; // rotated pages: bitmap axes differ; rely on the text check below
            const count = check.m.FPDFText_CountChars(cp.textPage);
            const pageText = check.withBuffer((count + 1) * 2, p => {
              check.m.FPDFText_GetText(cp.textPage, 0, count, p);
              return check.P.UTF16ToString(p);
            });
            return { outside, hasText: squash(pageText).includes(squash(newText)) };
          } finally {
            cp.close();
          }
        });
        if (verified.outside > 0.0005 || !verified.hasText) {
          console.warn('PDFium edit rejected by verification', verified);
          return null;
        }

        return { bytes, fontSubstituted: substituted, fontName, lines: layout.length };
      } finally {
        for (const ms of measurers.values()) ms.destroy();
        closePage();
      }
    });
  } catch (err) {
    console.warn('PDFium replaceParagraph failed:', err);
    return null;
  }
}
