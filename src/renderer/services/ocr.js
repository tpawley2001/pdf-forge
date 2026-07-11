import { createWorker, OEM, PSM } from 'tesseract.js';

/**
 * Compute absolute base URL for OCR assets.
 * tesseract.js skips URL resolution in Electron (returns paths as-is), so
 * relative paths used inside a web worker resolve against the wrong base.
 * We pre-resolve to absolute here to fix that.
 * In packaged builds (asar) web workers can't read from inside the archive;
 * asarUnpack moves OCR files to app.asar.unpacked so they are accessible.
 */
function getOCRBasePath() {
  const base = new URL('ocr/', window.location.href).href;
  if (base.includes('/app.asar/')) {
    return base.replace('/app.asar/', '/app.asar.unpacked/');
  }
  return base;
}

/** Build the worker-creation options (paths + no blob URL). */
function workerOptions() {
  const base = getOCRBasePath();
  return {
    workerPath:    `${base}worker.min.js`,
    corePath:      `${base}core`,
    langPath:      `${base}lang`,
    workerBlobURL: false,
    gzip:          true,
  };
}

/**
 * Create a long-lived Tesseract worker suitable for sequential page OCR.
 * PSM.AUTO (3) handles pages that mix text, graphics, and whitespace.
 * Reuse this worker across pages — creating it once amortises the WASM load.
 */
export async function createOCRWorker(progressCallback) {
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    ...workerOptions(),
    logger: progressCallback || (() => {}),
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  return worker;
}

/** Parse a Tesseract result into line-level blocks. */
export function parseBlocks(result) {
  const { words, lines } = result.data;
  if (!words || words.length === 0) return [];

  const blocks = [];
  for (const line of lines) {
    const lineWords = words.filter(w =>
      w.bbox.y0 >= line.bbox.y0 - 5 && w.bbox.y0 <= line.bbox.y1 + 5,
    );
    if (lineWords.length === 0) continue;

    blocks.push({
      text:       lineWords.map(w => w.text).join(' '),
      bbox:       { x: line.bbox.x0, y: line.bbox.y0, width: line.bbox.x1 - line.bbox.x0, height: line.bbox.y1 - line.bbox.y0 },
      confidence: line.confidence,
    });
  }
  return blocks;
}

/** One-shot convenience wrapper (used for manual re-runs). */
export async function recognizePage(dataUrl) {
  const worker = await createOCRWorker();
  try {
    const result = await worker.recognize(dataUrl);
    return parseBlocks(result);
  } finally {
    await worker.terminate();
  }
}

/** Format confidence as a colour: green (high) → red (low). */
export function confidenceColor(conf) {
  if (conf >= 90) return '#27ae60';
  if (conf >= 75) return '#f39c12';
  if (conf >= 60) return '#e67e22';
  return '#e74c3c';
}
