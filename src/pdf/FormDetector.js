/**
 * FormDetector.js — find the blanks on a "flat" PDF form (one with no real
 * AcroForm fields) so they can be made fillable, like Acrobat's Prepare Form.
 *
 * Works on a rendered page image, so it handles born-digital and scanned
 * forms the same way. Text positions (pdf.js textContent, when the page has
 * real text) are only used to name the fields.
 *
 * What it finds:
 *   - boxes / table cells that are empty, or have a small label at the top or
 *     left with room to write below / beside it  → text field
 *   - small empty squares (and ☐ □ glyphs)        → check box
 *   - writing lines ("Name: ________", lines with a caption under them) → text field
 *
 * Pure JS, no DOM: input is { data (RGBA), width, height } at `scale` px/pt.
 * Output rects are in image pixels (top-left origin); the caller converts.
 */

const CHECK_GLYPHS = /[☐□❑❒⬜▢❏❐]/;

/**
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img
 * @param {object} opts
 * @param {number} opts.scale       image pixels per PDF point
 * @param {Array}  [opts.textItems] [{ str, x, baseline, w, size }] in image px (horizontal text only)
 * @returns {Array<{type:'text'|'checkbox', x:number, y:number, w:number, h:number, label:string, multiLine:boolean}>}
 */
export function detectFormFields(img, { scale = 2, textItems = [], debug = null } = {}) {
  const { width: W, height: H, data } = img;
  const P = pt => pt * scale;
  const N = W * H;
  textItems = (textItems || []).filter(t => t && t.str && t.size > 0 && t.w > 0)
    .map(t => ({ ...t, y: t.baseline - t.size, h: t.size * 1.15 }));

  // ── 1. Ink masks ──
  // Paper = the brightest colour covering a real share of the page (white margins on a
  // tinted form, the yellowish background of a scan). Anything visibly different from it
  // (rules, grey or tinted fills) is "fill"; dark marks are text.
  const lum = new Uint8Array(N);
  const bins = new Uint32Array(4096);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const r = data[j], g = data[j + 1], b = data[j + 2];
    const v = data[j + 3] < 32 ? 255 : ((r * 299 + g * 587 + b * 114) / 1000) | 0;
    lum[i] = v;
    bins[data[j + 3] < 32 ? 4095 : ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)]++;
  }
  let paperBin = 4095, bestLum = -1;
  for (let k = 0; k < 4096; k++) {
    if (bins[k] < N * 0.03) continue;
    const l = ((k >> 8) * 299 + ((k >> 4) & 15) * 587 + (k & 15) * 114);
    if (l > bestLum) { bestLum = l; paperBin = k; }
  }
  let pr = 0, pg = 0, pb = 0, pn = 0;
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    if (data[j + 3] < 32) continue;
    if ((((data[j] >> 4) << 8) | ((data[j + 1] >> 4) << 4) | (data[j + 2] >> 4)) !== paperBin) continue;
    pr += data[j]; pg += data[j + 1]; pb += data[j + 2]; pn++;
  }
  if (pn) { pr /= pn; pg /= pn; pb /= pn; } else { pr = pg = pb = 255; }
  const paperLum = (pr * 299 + pg * 587 + pb * 114) / 1000;
  const lineMax = Math.min(200, paperLum - 40);   // a real (grey or darker) rule
  const textMax = Math.min(160, paperLum - 70);   // real marks: text, filled-in content
  const fillInk = new Uint8Array(N);
  const lineInk = new Uint8Array(N);
  const textInk = new Uint8Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const v = lum[i];
    const d = data[j + 3] < 32 ? 0 : Math.max(Math.abs(data[j] - pr), Math.abs(data[j + 1] - pg), Math.abs(data[j + 2] - pb));
    if (d > 20) fillInk[i] = 1;
    if (v < lineMax) lineInk[i] = 1;
    if (v < textMax) textInk[i] = 1;
  }

  // Glyphs are not rules: at this resolution the strokes of a word blur into runs long
  // enough to look like lines and would cut boxes in two. Blank them out of the line masks
  // (keeping underscores and box glyphs, which are real writing lines / check boxes).
  const glyph = new Uint8Array(N);               // where text was blanked out
  for (const t of textItems) {
    const chars = [...t.str];
    const cw = t.w / chars.length;
    const y1 = Math.max(0, Math.round(t.baseline - t.size * 0.78)), y2 = Math.min(H, Math.round(t.baseline + t.size * 0.05));
    chars.forEach((c, i) => {
      if (c === '_' || c === ' ' || CHECK_GLYPHS.test(c)) return;
      const x1 = Math.max(0, Math.round(t.x + i * cw)), x2 = Math.min(W, Math.round(t.x + (i + 1) * cw));
      for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) { const k = y * W + x; fillInk[k] = 0; lineInk[k] = 0; glyph[k] = 1; }
    });
  }

  // ── 2. Rule mask: long horizontal / vertical runs ──
  const minRun = Math.max(4, Math.round(P(6)));
  const rule = new Uint8Array(N);
  const hRule = new Uint8Array(N);               // horizontal runs of real lines, for writing lines
  const hRuns = (src, dst) => {
    for (let y = 0; y < H; y++) {
      let start = -1;
      for (let x = 0; x <= W; x++) {
        const on = x < W && src[y * W + x];
        if (on && start < 0) start = x;
        else if (!on && start >= 0) {
          if (x - start >= minRun) for (let k = start; k < x; k++) dst[y * W + k] = 1;
          start = -1;
        }
      }
    }
  };
  hRuns(fillInk, rule);
  hRuns(lineInk, hRule);
  for (let x = 0; x < W; x++) {
    let start = -1;
    for (let y = 0; y <= H; y++) {
      const on = y < H && fillInk[y * W + x];
      if (on && start < 0) start = y;
      else if (!on && start >= 0) {
        if (y - start >= minRun) for (let k = start; k < y; k++) rule[k * W + x] = 1;
        start = -1;
      }
    }
  }

  // Summed-area table of marks (text ink that is not part of a rule or fill) for O(1) "how much ink is in this rect".
  const sat = new Uint32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += textInk[y * W + x] & (rule[y * W + x] ^ 1);
      sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row;
    }
  }
  const inkIn = (x1, y1, x2, y2) => {           // half-open, clamped
    x1 = Math.max(0, Math.min(W, Math.round(x1))); x2 = Math.max(0, Math.min(W, Math.round(x2)));
    y1 = Math.max(0, Math.min(H, Math.round(y1))); y2 = Math.max(0, Math.min(H, Math.round(y2)));
    if (x2 <= x1 || y2 <= y1) return 0;
    const w1 = W + 1;
    return sat[y2 * w1 + x2] - sat[y1 * w1 + x2] - sat[y2 * w1 + x1] + sat[y1 * w1 + x1];
  };
  const inkFrac = (x1, y1, x2, y2) => {
    const a = Math.max(1, (Math.round(x2) - Math.round(x1)) * (Math.round(y2) - Math.round(y1)));
    return inkIn(x1, y1, x2, y2) / a;
  };
  // Close 1-px gaps where anti-aliased lines meet.
  const barrier = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!rule[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          barrier[yy * W + xx] = 1;
        }
      }
    }
  }

  // Boxes left open on one side (no rule at the page edge, e.g. an SSN box on the right
  // margin): when the lines above and below end at the same x, close them there. Regions
  // that rely on such a closing line are weaker evidence (see step 7).
  const virt = new Uint8Array(N);
  {
    const hs = horizontalSegments(hRule, W, H, Math.round(P(20)), Math.max(2, Math.round(P(3.5))));
    hs.sort((a, b) => a.y1 - b.y1);
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i];
      for (let j = i + 1; j < hs.length; j++) {
        const b = hs[j];
        const gap = b.y1 - a.y2;
        if (gap > P(40)) break;
        if (gap < P(8)) continue;
        // Only close a box that is already closed on its other side by a real vertical rule.
        const colClosed = x => { let c = 0; for (let y = a.y2; y < b.y1; y++) if (rule[y * W + x]) c++; return c >= gap * 0.9; };
        const hasRule = (from, to) => { for (let x = Math.max(0, from); x < Math.min(W, to); x++) if (colClosed(x)) return true; return false; };
        const ends = [];
        if (Math.abs(a.x2 - b.x2) <= 3) { const e = Math.min(a.x2, b.x2) - 1; if (hasRule(Math.max(a.x1, b.x1), e - Math.round(P(10)))) ends.push(e); }
        if (Math.abs(a.x1 - b.x1) <= 3) { const e = Math.max(a.x1, b.x1); if (hasRule(e + Math.round(P(10)), Math.min(a.x2, b.x2))) ends.push(e); }
        for (const ex of ends) {
          let open = 0;
          for (let y = a.y2; y < b.y1; y++) if (!barrier[y * W + ex]) open++;
          if (open < gap * 0.5) continue;               // already closed by a real rule
          for (let y = a.y1; y < b.y2; y++) for (let x = ex - 1; x <= ex + 1; x++) {
            if (x < 0 || x >= W) continue;
            const k = y * W + x;
            if (!barrier[k]) { barrier[k] = 1; virt[k] = 1; }
          }
        }
      }
    }
  }

  // ── 3. Enclosed regions (boxes / cells) = connected non-rule areas ──
  const label = new Int32Array(N);
  const stack = new Int32Array(N);
  const regions = [];
  let next = 1;
  for (let s = 0; s < N; s++) {
    if (barrier[s] || label[s]) continue;
    let sp = 0; stack[sp++] = s; label[s] = next;
    let area = 0, minX = W, minY = H, maxX = -1, maxY = -1, border = false, usesVirt = false;
    while (sp) {
      const p = stack[--sp];
      const x = p % W, y = (p / W) | 0;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      if ((x > 0 && virt[p - 1]) || (x < W - 1 && virt[p + 1])) usesVirt = true;
      if (x > 0 && !barrier[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < W - 1 && !barrier[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && !barrier[p - W] && !label[p - W]) { label[p - W] = next; stack[sp++] = p - W; }
      if (y < H - 1 && !barrier[p + W] && !label[p + W]) { label[p + W] = next; stack[sp++] = p + W; }
    }
    next++;
    if (border) continue;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw < P(4) || bh < P(4)) continue;
    if (area / (bw * bh) < 0.8) continue;           // not rectangular → not a box
    if (textItems.length) {                            // a hole left by blanking text, not a box
      let inGlyph = 0;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (label[y * W + x] === next - 1 && glyph[y * W + x]) inGlyph++;
      if (inGlyph > area * 0.5) continue;
    }
    if (bw > W * 0.85 && bh > H * 0.4) continue;     // page frame, not a field
    // Box edges sit at the barrier; grow back by 1 px to the real interior edge.
    regions.push({ x: minX - 1, y: minY - 1, w: bw + 2, h: bh + 2, weak: usesVirt });
  }

  const fields = [];
  const boxes = [];                                  // every region we treat as a box (for line de-dupe)

  // ── 4. Classify boxes ──
  const combCells = [];
  const sizes = textItems.map(t => t.size).sort((a, b) => a - b);
  const medianSize = sizes.length ? sizes[sizes.length >> 1] : 0;
  const isHeading = (x1, y1, x2, y2) => medianSize > 0 && textItems.some(t =>
    t.size >= medianSize * 1.18 && t.x < x2 && t.x + t.w > x1 && t.baseline > y1 && t.baseline - t.size < y2);
  for (const r of regions) {
    const pad = Math.max(2, Math.round(P(1.5)));
    const ix1 = r.x + pad, iy1 = r.y + pad, ix2 = r.x + r.w - pad, iy2 = r.y + r.h - pad;
    if (ix2 <= ix1 || iy2 <= iy1) continue;
    boxes.push(r);
    const square = r.w / r.h > 0.7 && r.w / r.h < 1.43;

    // Check box
    if (square && r.w <= P(20) && r.w >= P(5)) {
      if (inkFrac(ix1, iy1, ix2, iy2) < 0.04) fields.push({ type: 'checkbox', x: r.x, y: r.y, w: r.w, h: r.h, weak: r.weak, src: 'cbox' });
      continue;
    }
    if (r.h < P(9) || r.w < P(18)) {
      // Narrow empty cell: maybe one digit of a comb (SSN, EIN, date) — grouped below.
      if (r.w >= P(5) && r.h >= P(9) && r.h <= P(40) && inkIn(ix1, iy1, ix2, iy2) <= P(1) * P(1)) combCells.push(r);
      continue;
    }

    // Empty box → the whole box is the field
    if (inkIn(ix1, iy1, ix2, iy2) <= P(1) * P(1)) {
      fields.push({ type: 'text', x: r.x, y: r.y, w: r.w, h: r.h, weak: r.weak, src: 'box' });
      continue;
    }
    // Label at the top, blank below it
    const band = emptyBottomBand(ix1, iy1, ix2, iy2);
    // Form style: a small label tucked into the top of the box. Text sitting lower (table
    // padding, a centred header) is table content, not a prompt.
    let topGap = 0;
    while (iy1 + topGap < iy2 && inkIn(ix1, iy1 + topGap, ix2, iy1 + topGap + 1) === 0) topGap++;
    if (band && band >= P(9) && topGap <= P(3)) {
      fields.push({ type: 'text', x: r.x, y: iy2 - band, w: r.w, h: band + pad, weak: r.weak, src: 'band' });
      continue;
    }
    // Label on the left, blank to the right
    const right = emptyRightBand(ix1, iy1, ix2, iy2);
    if (right && right >= P(36) && r.h <= P(40) && !isHeading(ix1, iy1, ix2 - right, iy2)) {
      fields.push({ type: 'text', x: ix2 - right, y: r.y, w: right + pad, h: r.h, weak: true, src: 'right' });
    }
  }

  function emptyBottomBand(x1, y1, x2, y2) {
    // Rows from the bottom up that hold (almost) no ink.
    const tol = Math.max(1, Math.round((x2 - x1) * 0.004));
    let y = y2;
    while (y > y1 && inkIn(x1, y - 1, x2, y) <= tol) y--;
    if (y <= y1) return 0;                            // fully empty — handled above
    // Leave a little air under the label.
    return Math.max(0, y2 - y - Math.round(P(1.5)));
  }
  function emptyRightBand(x1, y1, x2, y2) {
    const tol = Math.max(1, Math.round((y2 - y1) * 0.02));
    let x = x2;
    while (x > x1 && inkIn(x - 1, y1, x, y2) <= tol) x--;
    if (x <= x1) return 0;
    return Math.max(0, x2 - x - Math.round(P(3)));
  }

  // Combs: runs of narrow empty cells on one row become one field (an SSN is 3 groups).
  combCells.sort((a, b) => a.y - b.y || a.x - b.x);
  const usedComb = new Set();
  for (let i = 0; i < combCells.length; i++) {
    if (usedComb.has(i)) continue;
    const group = [combCells[i]];
    usedComb.add(i);
    for (let j = i + 1; j < combCells.length; j++) {
      if (usedComb.has(j)) continue;
      const last = group[group.length - 1], c = combCells[j];
      if (Math.abs(c.y - last.y) <= P(2) && Math.abs(c.h - last.h) <= P(2) && c.x - (last.x + last.w) <= P(3) && c.x > last.x) {
        group.push(c); usedComb.add(j);
      }
    }
    if (group.length < 2) continue;
    const x = group[0].x, end = group[group.length - 1];
    fields.push({ type: 'text', x, y: group[0].y, w: end.x + end.w - x, h: group[0].h, comb: group.length, src: 'comb' });
    boxes.push({ x, y: group[0].y, w: end.x + end.w - x, h: group[0].h });
  }

  // ── 5. Writing lines ──
  const segs = horizontalSegments(hRule, W, H, Math.round(P(28)), Math.max(2, Math.round(P(3.5))));
  const lineFields = [];
  for (const s of segs) {
    // A box edge? (top or bottom of a box we already handled)
    let covered = 0;
    for (const b of boxes) {
      if (Math.abs(s.y1 - (b.y + b.h)) <= P(2.5) || Math.abs(s.y2 - b.y) <= P(2.5) || Math.abs(s.y1 - b.y) <= P(2.5)) {
        covered += overlap(s.x1, s.x2, b.x, b.x + b.w);
      }
    }
    const onBox = covered > 0.5 * (s.x2 - s.x1);
    if (debug) debug('seg', s, { onBox });
    if (onBox) continue;
    // Vertical rules leaving the line at both ends = part of a table/box we couldn't close.
    let x1 = s.x1 + Math.round(P(1)), x2 = s.x2 - Math.round(P(1)), tagLen = 0;
    // A label sitting on the line ("$", "Name:") — start the field after it.
    {
      const bandTop = s.y1 - Math.round(P(12));
      const limit = x1 + Math.round((x2 - x1) * 0.45);
      let lastInk = -1;
      for (let x = x1; x < limit; x++) if (inkIn(x, bandTop, x + 1, s.y1) > 0) lastInk = x;
      if (lastInk >= 0) {
        // Short tags ("$", "1a") are fine; a longer run of text on the line is the end of a
        // paragraph or table cell above a rule, unless it reads like a prompt ("Signature:").
        if (lastInk - x1 > P(26)) {
          const t = textItems.find(t => t.x <= lastInk + P(2) && t.x + t.w >= lastInk - P(4) &&
            t.baseline <= s.y1 + P(2) && t.baseline >= s.y1 - P(12));
          if (!t || !/:\s*$/.test(t.str.replace(/_+\s*$/, ''))) continue;
        }
        tagLen = lastInk - x1;
        x1 = lastInk + Math.round(P(2));
      }
      if (x2 - x1 < P(24)) continue;
    }
    // How much empty room is there above the line?
    const maxH = Math.round(P(26));
    let room = 0;
    const tol = Math.max(1, Math.round((x2 - x1) * 0.01));
    while (room < maxH && s.y1 - room - 1 >= 0 && inkIn(x1, s.y1 - room - 1, x2, s.y1 - room) <= tol) room++;
    if (debug) debug('room', s, { room });
    if (room < P(9)) continue;                       // underlined text, or rows too tight
    const h = Math.min(room, Math.round(P(18)));
    // Needs a label: ink just left of the line at writing height, or a caption right under it.
    const leftInk = x1 > s.x1 + P(3) || inkFrac(s.x1 - P(120), s.y1 - h, s.x1 - P(1), s.y1 + P(2)) > 0.004;
    const belowInk = inkFrac(s.x1, s.y2 + P(1), s.x2, s.y2 + P(11)) > 0.004;
    const onLine = x1 > s.x1 + P(3) && tagLen <= P(14);   // "$", "1a" — longer text on the line is weaker
    // A heading beside the line ("Part I  Taxpayer Identification Number") is a section bar.
    if (!onLine && isHeading(s.x1 - P(220), s.y1 - P(12), x1 + P(1), s.y1 + P(2))) continue;
    // Full-width rules are section dividers unless something says "write here".
    const wide = s.x2 - s.x1 > W * 0.72;
    lineFields.push({ type: 'text', x: x1, y: s.y1 - h, w: s.x2 - x1, h, labelled: wide ? onLine : (leftInk || belowInk), strong: onLine || (belowInk && !wide), seg: s });
  }
  // Unlabelled lines count when stacked with another writing line (address / comment lines).
  for (const f of lineFields) {
    const stacked = lineFields.some(o => o !== f &&
      Math.abs(o.seg.y1 - f.seg.y1) <= P(40) && Math.abs(o.seg.y1 - f.seg.y1) >= P(9) &&
      overlap(o.x, o.x + o.w, f.x, f.x + f.w) > 0.6 * Math.min(o.w, f.w));
    if (f.labelled || stacked) fields.push({ type: 'text', x: f.x, y: f.y, w: f.w, h: f.h, weak: !(f.strong || stacked), src: 'line' });
  }

  // "Name: ________ Date: ____" often arrives as one text run. Split it into its labels and
  // place each one using where the underlines really are (character widths vary too much
  // to estimate). Falls back to an even split when the lines don't line up with the text.
  const labelItems = [];
  for (const t of textItems) {
    if (!t.str.includes('_')) { labelItems.push(t); continue; }
    const str = t.str;
    const parts = [];                                  // { text, run: index of the underscore run before it }
    const re = /_+|[^_]+/g; let m, runs = 0;
    while ((m = re.exec(str))) {
      if (m[0][0] === '_') runs++;
      else parts.push({ text: m[0], idx: m.index, after: runs });
    }
    const lines = segs.filter(g => g.y1 >= t.baseline - P(3) && g.y1 <= t.baseline + P(5) &&
      g.x2 > t.x - P(2) && g.x1 < t.x + t.w + P(2)).sort((a, b) => a.x1 - b.x1);
    const chars = [...str], cw = t.w / chars.length;
    for (const p of parts) {
      if (!p.text.trim()) continue;
      let x1, x2;
      if (lines.length === runs) {
        x1 = p.after === 0 ? t.x : lines[p.after - 1].x2;
        x2 = p.after < lines.length ? lines[p.after].x1 : t.x + t.w;
      } else {
        const i0 = [...str.slice(0, p.idx)].length;
        x1 = t.x + i0 * cw; x2 = x1 + [...p.text].length * cw;
      }
      labelItems.push({ ...t, str: p.text, x: x1, w: Math.max(1, x2 - x1) });
    }
  }

  // ── 6. ☐ glyphs in the text layer ──
  for (const t of textItems) {
    if (!t.str || !CHECK_GLYPHS.test(t.str)) continue;
    const chars = [...t.str];
    const cw = t.w / Math.max(1, chars.length);
    chars.forEach((c, i) => {
      if (!CHECK_GLYPHS.test(c)) return;
      const side = Math.min(cw, t.h) * 0.9;
      fields.push({ type: 'checkbox', x: t.x + i * cw + (cw - side) / 2, y: t.y + (t.h - side) / 2, w: side, h: side });
    });
  }

  // ── 7. De-dupe, name, sort in reading order ──
  // Weak evidence (a label with space beside it, a line with text somewhere to its left) only
  // counts on a page that clearly is a form; on instruction pages it is just table layout.
  // "Label on top, blank below" cells are common in forms but also in instruction tables:
  // they need a clear form page or several of them.
  const strong = fields.filter(f => !f.weak && f.src !== 'band').length;
  const bands = fields.filter(f => !f.weak && f.src === 'band').length;
  const kept = fields.filter(f => f.weak ? strong >= 3 : f.src === 'band' ? (strong >= 3 || (strong >= 1 && bands >= 4)) : true);
  const out = [];
  for (const f of kept) {
    if (f.w < P(4) || f.h < P(4)) continue;
    if (out.some(o => iou(o, f) > 0.3 || contains(o, f) || (o.type === 'text' && f.type === 'text' && contains(f, o)))) continue;
    out.push(f);
  }
  out.sort((a, b) => (Math.abs(a.y - b.y) < P(6) ? a.x - b.x : a.y - b.y));
  for (const f of out) {
    f.label = findLabel(f, labelItems, P);
    f.multiLine = f.type === 'text' && f.h >= P(30);
    f.x = Math.round(f.x); f.y = Math.round(f.y); f.w = Math.round(f.w); f.h = Math.round(f.h);
    delete f.weak;
    if (!debug) delete f.src;
  }
  return out;
}

function horizontalSegments(mask, W, H, minLen, maxThick) {
  // Row runs → merged across consecutive rows into line segments.
  const runs = [];
  for (let y = 0; y < H; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const on = x < W && mask[y * W + x];
      if (on && start < 0) start = x;
      else if (!on && start >= 0) { if (x - start >= minLen) runs.push({ y, x1: start, x2: x }); start = -1; }
    }
  }
  const segs = [];
  const open = [];
  for (const r of runs) {
    let s = null;
    for (const o of open) {
      if (o.y2 === r.y - 1 && overlap(o.x1, o.x2, r.x1, r.x2) > 0.7 * Math.min(o.x2 - o.x1, r.x2 - r.x1)) { s = o; break; }
    }
    if (s) { s.y2 = r.y; s.x1 = Math.min(s.x1, r.x1); s.x2 = Math.max(s.x2, r.x2); }
    else { s = { x1: r.x1, x2: r.x2, y1: r.y, y2: r.y }; open.push(s); segs.push(s); }
    // drop open segments that can no longer continue
    for (let i = open.length - 1; i >= 0; i--) if (open[i].y2 < r.y - 1) open.splice(i, 1);
  }
  for (const s of segs) s.y2 += 1;                  // half-open
  // Underscore glyphs leave hairline gaps: join pieces on the same row.
  const thin = segs.filter(s => s.y2 - s.y1 <= maxThick).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  const out = [];
  for (const s of thin) {
    const prev = out.find(o => Math.abs(o.y1 - s.y1) <= 1 && Math.abs(o.y2 - s.y2) <= 1 && s.x1 - o.x2 >= 0 && s.x1 - o.x2 <= Math.max(2, minLen * 0.12));
    if (prev) { prev.x2 = Math.max(prev.x2, s.x2); prev.y1 = Math.min(prev.y1, s.y1); prev.y2 = Math.max(prev.y2, s.y2); }
    else out.push({ ...s });
  }
  return out;
}

function overlap(a1, a2, b1, b2) { return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)); }
function iou(a, b) {
  const ix = overlap(a.x, a.x + a.w, b.x, b.x + b.w), iy = overlap(a.y, a.y + a.h, b.y, b.y + b.h);
  const i = ix * iy;
  return i / (a.w * a.h + b.w * b.h - i);
}
function contains(a, b) {
  return b.x >= a.x - 2 && b.y >= a.y - 2 && b.x + b.w <= a.x + a.w + 2 && b.y + b.h <= a.y + a.h + 2;
}

function cleanLabel(s) {
  return String(s || '')
    .replace(/[_☐□❑❒⬜▢]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*\(?[0-9]{1,2}[a-z]?[.)]\s+|^\s*\(?[a-z][.)]\s+|^\s*[0-9]{1,2}[a-z]?\s+(?=[A-Za-z(])/i, '')   // "1.", "3a)", "(b)", "5 Address" numbering
    .replace(/[\s:.*]+$/, '')
    .trim()
    .slice(0, 60);
}

/** Best text label for a field: inside its box above it, left on the same line, the caption under it, or right of a check box. */
function findLabel(f, items, P) {
  if (!items.length) return '';
  const cy = f.y + f.h / 2;
  let growLeft = f.type !== 'checkbox';
  const pick = cands => {
    cands = cands.filter(c => /\p{L}{2,}/u.test(cleanLabel(c.t.str)));   // not a bare line number
    if (!cands.length) return '';
    cands.sort((a, b) => a.d - b.d);
    // Join neighbours on the same line as the best one (pdf.js splits runs).
    const best = cands[0].t;
    // Grow left and right over runs that touch it (pdf.js splits words), not over other labels.
    const row = items.filter(t => Math.abs((t.y + t.h / 2) - (best.y + best.h / 2)) < best.h * 0.5).sort((a, b) => a.x - b.x);
    let i = row.indexOf(best), j = i;
    const gap = best.size * 0.6;
    while (growLeft && i > 0 && row[i].x - (row[i - 1].x + row[i - 1].w) < gap && !/:\s*$/.test(row[i - 1].str)) i--;
    while (j < row.length - 1 && row[j + 1].x - (row[j].x + row[j].w) < gap && !/:\s*$/.test(row[j].str)) j++;
    return cleanLabel(row.slice(i, j + 1).map(t => t.str).join(' '));
  };
  if (f.type === 'checkbox') {
    return pick(items.filter(t => t.x >= f.x + f.w - P(1) && t.x - (f.x + f.w) < P(40) &&
      Math.abs((t.y + t.h / 2) - cy) < Math.max(f.h, t.h) * 0.7)
      .map(t => ({ t, d: t.x - (f.x + f.w) })));
  }
  // label tucked into the top of the box (IRS style) comes first for those
  if (f.src === 'band') {
    const inside = pick(items.filter(t => t.y + t.h <= f.y + P(3) && f.y - (t.y + t.h) < P(14) &&
      t.x >= f.x - P(2) && t.x < f.x + f.w)
      .map(t => ({ t, d: (f.y - (t.y + t.h)) * 0.2 + (t.x - f.x) })));
    if (inside) return inside;
  }
  const aboveLabel = () => pick(items.filter(t => t.y + t.h <= f.y + P(3) && f.y - (t.y + t.h) < P(14) &&
    overlap(t.x, t.x + t.w, f.x, f.x + f.w) > 0)
    .map(t => ({ t, d: (f.y - (t.y + t.h)) + Math.abs(t.x - f.x) * 0.1 })));
  if (f.src === 'comb') { const a = aboveLabel(); if (a) return a; }
  // left, same line
  const left = pick(items.filter(t => t.x + t.w <= f.x + P(2) && f.x - (t.x + t.w) < P(150) &&
    t.y + t.h > f.y && t.y < f.y + f.h + P(3))
    .map(t => ({ t, d: f.x - (t.x + t.w) })));
  if (left) return left;
  // above, within the box/just above the line
  const above = aboveLabel();
  if (above) return above;
  // caption under the line
  return pick(items.filter(t => t.y >= f.y + f.h - P(1) && t.y - (f.y + f.h) < P(12) &&
    overlap(t.x, t.x + t.w, f.x, f.x + f.w) > 0)
    .map(t => ({ t, d: t.y - (f.y + f.h) })));
}
