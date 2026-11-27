// Runs FormDetector off the UI thread (a page takes a few hundred ms).
import { analyzeFormPage } from './FormDetector.js';

self.onmessage = (e) => {
  const { id, width, height, buffer, scale, textItems } = e.data;
  try {
    const result = analyzeFormPage({ width, height, data: new Uint8ClampedArray(buffer) }, { scale, textItems });
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
