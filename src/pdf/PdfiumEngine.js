/**
 * PdfiumEngine.js — thin loader + helpers around @embedpdf/pdfium (MIT,
 * PDFium itself is BSD/Apache). One module instance is shared per process.
 *
 * Renderer: the wasm is copied to dist-renderer/pdfium/pdfium.wasm by
 * webpack; Electron hands it over via IPC (the dev server falls back to
 * fetching it relative to the page). Node (tests/CLI): call
 * setPdfiumWasmBinary(bytes) before first use.
 */

import { init } from '@embedpdf/pdfium';

let wasmBinaryOverride = null;
let modulePromise = null;

export function setPdfiumWasmBinary(bytes) {
  wasmBinaryOverride = bytes;
}

async function loadWasmBinary() {
  if (wasmBinaryOverride) return wasmBinaryOverride;
  if (typeof window === 'undefined') {
    throw new Error('PDFium wasm not configured (call setPdfiumWasmBinary in Node)');
  }
  // Electron: file:// pages can't fetch() under the app CSP — ask main
  if (window.electronAPI?.loadPdfiumWasm) {
    try {
      const bytes = await window.electronAPI.loadPdfiumWasm();
      if (bytes?.byteLength) return bytes;
    } catch (_) { /* dev server: fall through to fetch */ }
  }
  const url = new URL('pdfium/pdfium.wasm', window.location.href).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.arrayBuffer();
}

export function getPdfium() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasmBinary = await loadWasmBinary();
      const m = await init({ wasmBinary });
      m.PDFiumExt_Init();
      return m;
    })().catch(err => {
      modulePromise = null;
      throw err;
    });
  }
  return modulePromise;
}

/** Small wrapper over a loaded document: memory helpers, pages, save. */
export class PdfiumDoc {
  constructor(m, bytes, password = '') {
    this.m = m;
    this.P = m.pdfium;
    this._dataPtr = this.malloc(bytes.length);
    this.P.HEAPU8.set(bytes, this._dataPtr);
    this.doc = m.FPDF_LoadMemDocument(this._dataPtr, bytes.length, password);
    if (!this.doc) {
      const code = m.FPDF_GetLastError();
      this.P.wasmExports.free(this._dataPtr);
      throw new Error(`PDFium could not open document (error ${code})`);
    }
  }

  malloc(size) { return this.P.wasmExports.malloc(Math.max(1, size)); }
  free(ptr) { this.P.wasmExports.free(ptr); }

  /** Run fn(ptr) with a temporary zeroed buffer of `size` bytes. */
  withBuffer(size, fn) {
    const ptr = this.malloc(size);
    this.P.HEAPU8.fill(0, ptr, ptr + size);
    try { return fn(ptr); } finally { this.free(ptr); }
  }

  floats(ptr, count) {
    const out = [];
    for (let i = 0; i < count; i += 1) out.push(this.P.getValue(ptr + i * 4, 'float'));
    return out;
  }

  /** Read a UTF-16LE string from a (len-query, then fill) API. */
  readUtf16(call) {
    const bytes = call(0, 0);
    if (!bytes || bytes <= 2) return '';
    return this.withBuffer(bytes, ptr => {
      call(ptr, bytes);
      return this.P.UTF16ToString(ptr);
    });
  }

  /** Read a NUL-terminated byte string from a (len-query, then fill) API. */
  readUtf8(call) {
    const bytes = call(0, 0);
    if (!bytes || bytes <= 1) return '';
    return this.withBuffer(bytes, ptr => {
      call(ptr, bytes);
      return this.P.UTF8ToString(ptr);
    });
  }

  /** Allocate a UTF-16LE NUL-terminated copy of `text`; caller frees. */
  allocUtf16(text) {
    const size = (String(text).length + 1) * 2;
    const ptr = this.malloc(size);
    this.P.stringToUTF16(String(text), ptr, size);
    return ptr;
  }

  pageCount() { return this.m.FPDF_GetPageCount(this.doc); }

  save() {
    const { m } = this;
    const writer = m.PDFiumExt_OpenFileWriter();
    try {
      if (!m.PDFiumExt_SaveAsCopy(this.doc, writer)) throw new Error('PDFium save failed');
      const size = m.PDFiumExt_GetFileWriterSize(writer);
      return this.withBuffer(size, ptr => {
        m.PDFiumExt_GetFileWriterData(writer, ptr, size);
        return this.P.HEAPU8.slice(ptr, ptr + size);
      });
    } finally {
      m.PDFiumExt_CloseFileWriter(writer);
    }
  }

  close() {
    if (this.doc) this.m.FPDF_CloseDocument(this.doc);
    this.doc = 0;
    if (this._dataPtr) this.free(this._dataPtr);
    this._dataPtr = 0;
  }
}

export async function withPdfiumDoc(bytes, fn, password = '') {
  const m = await getPdfium();
  const doc = new PdfiumDoc(m, bytes, password);
  try {
    return await fn(doc);
  } finally {
    doc.close();
  }
}

/**
 * Render a page to RGBA-ish (BGRA) pixels. Returns { width, height, data }.
 * Used for before/after verification, not display.
 */
export function renderPageBGRA(pdoc, page, scale = 1.5) {
  const { m } = pdoc;
  const width = Math.max(1, Math.round(m.FPDF_GetPageWidthF(page) * scale));
  const height = Math.max(1, Math.round(m.FPDF_GetPageHeightF(page) * scale));
  const bitmap = m.FPDFBitmap_Create(width, height, 0);
  try {
    m.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
    // FPDF_ANNOT (0x01) so annotations appear the same on both sides
    m.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0x01);
    const buf = m.FPDFBitmap_GetBuffer(bitmap);
    const stride = m.FPDFBitmap_GetStride ? m.FPDFBitmap_GetStride(bitmap) : width * 4;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      data.set(pdoc.P.HEAPU8.subarray(buf + y * stride, buf + y * stride + width * 4), y * width * 4);
    }
    return { width, height, data };
  } finally {
    m.FPDFBitmap_Destroy(bitmap);
  }
}

/**
 * pdf.js-style viewport transform at scale 1 for a page:
 * PDF user space → top-left-origin viewport space (rotation applied).
 */
export function pageViewTransform(pdoc, page) {
  const { m } = pdoc;
  const box = pdoc.withBuffer(16, ptr => {
    const ok = m.FPDFPage_GetCropBox(page, ptr, ptr + 4, ptr + 8, ptr + 12)
      || m.FPDFPage_GetMediaBox(page, ptr, ptr + 4, ptr + 8, ptr + 12);
    // left, bottom, right, top
    return ok ? pdoc.floats(ptr, 4) : [0, 0, m.FPDF_GetPageWidthF(page), m.FPDF_GetPageHeightF(page)];
  });
  const [x0, y0, x1, y1] = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
  const rotation = ((m.FPDFPage_GetRotation(page) % 4) + 4) % 4;
  // Same matrices pdf.js PageViewport uses (scale 1)
  switch (rotation) {
    case 1: return [0, 1, 1, 0, -y0, -x0];
    case 2: return [-1, 0, 0, 1, x1, -y0];
    case 3: return [0, -1, -1, 0, y1, x1];
    default: return [1, 0, 0, -1, -x0, y1];
  }
}

export function applyTransform(t, x, y) {
  return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}

export function invertTransform(t) {
  const det = t[0] * t[3] - t[1] * t[2];
  return [
    t[3] / det, -t[1] / det, -t[2] / det, t[0] / det,
    (t[2] * t[5] - t[3] * t[4]) / det, (t[1] * t[4] - t[0] * t[5]) / det,
  ];
}

/** Map a rect {left,bottom,right,top} through a transform → axis-aligned rect. */
export function transformRect(t, r) {
  const pts = [
    applyTransform(t, r.left, r.bottom), applyTransform(t, r.right, r.bottom),
    applyTransform(t, r.left, r.top), applyTransform(t, r.right, r.top),
  ];
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
}
