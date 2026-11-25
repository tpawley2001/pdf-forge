/**
 * Find the blanks on a flat (non-fillable) form page — see src/pdf/FormDetector.js.
 * Runs in a Web Worker; falls back to the UI thread if the worker can't start.
 */
import { detectFormFields } from '../../pdf/FormDetector.js';

let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('../../pdf/formDetect.worker.js', import.meta.url));
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.fields);
    };
    worker.onerror = (e) => {
      // Worker failed to load: finish what is queued on the UI thread from now on.
      workerBroken = true;
      worker = null;
      for (const [id, p] of pending) { pending.delete(id); p.retry(); }
      if (e && e.preventDefault) e.preventDefault();
    };
  } catch (_) {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

/** pdf.js text content → detector text items, in the image's pixel space. */
export function textItemsFor(textContent, viewport, Util) {
  const out = [];
  for (const i of textContent?.items || []) {
    if (!i.str || !i.str.trim()) continue;
    const tx = Util.transform(viewport.transform, i.transform);
    if (Math.abs(tx[1]) > Math.abs(tx[0]) * 0.1 || tx[0] <= 0) continue;   // rotated / mirrored text
    out.push({ str: i.str, x: tx[4], baseline: tx[5], w: i.width * viewport.scale, size: Math.hypot(tx[2], tx[3]) });
  }
  return out;
}

/**
 * @param {HTMLCanvasElement} canvas  page rendered at `scale` px per point
 * @returns {Promise<Array>} fields in canvas pixels (see detectFormFields)
 */
export function detectOnCanvas(canvas, { scale, textItems }) {
  const { width, height } = canvas;
  const img = canvas.getContext('2d').getImageData(0, 0, width, height);
  const runHere = () => detectFormFields({ width, height, data: img.data }, { scale, textItems });
  const w = getWorker();
  if (!w) return Promise.resolve().then(runHere);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, retry: () => { try { resolve(runHere()); } catch (err) { reject(err); } } });
    const buffer = img.data.buffer;
    w.postMessage({ id, width, height, buffer, scale, textItems }, [buffer]);
  });
}

/** Canvas-pixel rect → PDF user-space rect [x1, y1, x2, y2] (handles page rotation). */
export function toPdfRect(f, viewport) {
  const [ax, ay] = viewport.convertToPdfPoint(f.x, f.y);
  const [bx, by] = viewport.convertToPdfPoint(f.x + f.w, f.y + f.h);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}
