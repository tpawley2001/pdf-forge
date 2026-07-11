/**
 * PDFEngine.js - Main PDF engine class
 *
 * Provides the core document manipulation layer. Uses pdf-lib (PDFDocument)
 * for document editing and page operations, and pdfjs-dist for rendering
 * pages to canvas.
 */

import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { PageOperations } from './PageOperations.js';
import { Annotations } from './Annotations.js';
import { FormOperations } from './FormOperations.js';
import { TextOperations } from './TextOperations.js';
import { Security } from './Security.js';
import { Export } from './Export.js';

// Set the worker source for pdfjs-dist
// In a bundler environment this should be configured appropriately.
// For production, use a local worker or CDN worker.
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    pdfjsLib.GlobalWorkerOptions.workerSrc ||
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
} catch (_) {
  // Worker already configured or unavailable
}

export class PDFEngine {
  constructor() {
    /** @type {PDFDocument|null} */
    this._pdfDoc = null;
    /** @type {pdfjsLib.PDFDocumentProxy|null} */
    this._pdfJsDoc = null;
    /** @type {Uint8Array|null} */
    this._sourceBuffer = null;
    /** @type {PageOperations} */
    this.pageOps = new PageOperations();
    /** @type {Annotations} */
    this.annotations = new Annotations();
    /** @type {FormOperations} */
    this.formOps = new FormOperations();
    /** @type {TextOperations} */
    this.textOps = new TextOperations();
    /** @type {Security} */
    this.security = new Security();
    /** @type {Export} */
    this.exporter = new Export(this);
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  /**
   * Load a PDF from a buffer (Uint8Array or ArrayBuffer).
   * Loads the document into both pdf-lib (for editing) and pdfjs-dist (for
   * rendering).
   *
   * @param {Uint8Array|ArrayBuffer} buffer
   * @returns {Promise<PDFEngine>}
   */
  async loadFromBuffer(buffer) {
    const bytes = buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : buffer;

    this._sourceBuffer = bytes;

    // Load with pdf-lib for document editing
    this._pdfDoc = await PDFDocument.load(bytes.slice(), {
      ignoreEncryption: true,
    });

    // Load with pdfjs-dist for rendering
    this._pdfJsDoc = await pdfjsLib.getDocument({
      data: bytes.slice(),
    }).promise;

    return this;
  }

  /**
   * Load a PDF from a base64-encoded string.
   *
   * @param {string} base64
   * @returns {Promise<PDFEngine>}
   */
  async loadFromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return this.loadFromBuffer(bytes);
  }

  /**
   * Load a PDF from a URL.
   *
   * @param {string} url
   * @returns {Promise<PDFEngine>}
   */
  async loadFromUrl(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    return this.loadFromBuffer(buffer);
  }

  /**
   * Create a new empty PDF document.
   *
   * @returns {Promise<PDFEngine>}
   */
  async createNew() {
    this._pdfDoc = await PDFDocument.create();
    this._pdfDoc.addPage();
    // For pdfjs, we save and reload so rendering works
    const bytes = await this._pdfDoc.save();
    this._sourceBuffer = bytes;
    this._pdfJsDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Document accessors
  // ---------------------------------------------------------------------------

  /** @returns {PDFDocument|null} The underlying pdf-lib PDFDocument. */
  get document() {
    return this._pdfDoc;
  }

  /** @returns {pdfjsLib.PDFDocumentProxy|null} The underlying pdfjs document proxy. */
  get pdfJsDocument() {
    return this._pdfJsDoc;
  }

  // ---------------------------------------------------------------------------
  // Page info
  // ---------------------------------------------------------------------------

  /**
   * Returns the total number of pages in the document.
   * @returns {number}
   */
  getPageCount() {
    return this._pdfDoc ? this._pdfDoc.getPageCount() : 0;
  }

  /**
   * Returns the dimensions (in PDF points) of a page.
   *
   * @param {number} pageNum - 0-based page index
   * @returns {{width: number, height: number}}
   */
  getPageSize(pageNum) {
    if (!this._pdfDoc) {
      throw new Error('No document loaded');
    }
    const pages = this._pdfDoc.getPages();
    if (pageNum < 0 || pageNum >= pages.length) {
      throw new Error(`Page index ${pageNum} out of range [0, ${pages.length - 1}]`);
    }
    const page = pages[pageNum];
    const { width, height } = page.getSize();
    return { width, height };
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * Render a page onto an HTMLCanvasElement using pdfjs-dist.
   *
   * @param {number} pageNum     - 0-based page index
   * @param {HTMLCanvasElement} canvas
   * @param {number} [scale=1]   - Render scale factor
   * @returns {Promise<void>}
   */
  async renderPage(pageNum, canvas, scale = 1) {
    if (!this._pdfJsDoc) {
      throw new Error('No document loaded for rendering');
    }
    const page = await this._pdfJsDoc.getPage(pageNum + 1); // pdfjs is 1-based
    const viewport = page.getViewport({ scale });

    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;
  }

  /**
   * Create a thumbnail (data URL) for a page.
   *
   * @param {number} pageNum    - 0-based page index
   * @param {number} [width=200] - Desired thumbnail width in pixels
   * @returns {Promise<string>} Data URL (PNG)
   */
  async createThumbnail(pageNum, width = 200) {
    if (!this._pdfJsDoc) {
      throw new Error('No document loaded');
    }
    const page = await this._pdfJsDoc.getPage(pageNum + 1);
    const originalViewport = page.getViewport({ scale: 1 });
    const scale = width / originalViewport.width;
    const viewport = page.getViewport({ scale });

    // Offscreen canvas for thumbnail
    const canvas = new OffscreenCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Render a page to an ImageData object.
   *
   * @param {number} pageNum
   * @param {number} [scale=1]
   * @returns {Promise<ImageData>}
   */
  async renderPageToImageData(pageNum, scale = 1) {
    if (!this._pdfJsDoc) {
      throw new Error('No document loaded');
    }
    const page = await this._pdfJsDoc.getPage(pageNum + 1);
    const viewport = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    return ctx.getImageData(0, 0, viewport.width, viewport.height);
  }

  // ---------------------------------------------------------------------------
  // Save / export
  // ---------------------------------------------------------------------------

  /**
   * Serialize the current document to PDF bytes.
   *
   * @returns {Promise<Uint8Array>}
   */
  async save() {
    if (!this._pdfDoc) {
      throw new Error('No document loaded');
    }
    return this._pdfDoc.save();
  }

  /**
   * Serialize and return as a Blob.
   *
   * @param {string} [mimeType='application/pdf']
   * @returns {Promise<Blob>}
   */
  async saveAsBlob(mimeType = 'application/pdf') {
    const bytes = await this.save();
    return new Blob([bytes], { type: mimeType });
  }

  /**
   * Serialize and return as a base64-encoded string.
   *
   * @returns {Promise<string>}
   */
  async saveAsBase64() {
    const bytes = await this.save();
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Get raw bytes without re-saving (returns the last saved state).
   * @returns {Promise<Uint8Array>}
   */
  async getBytes() {
    return this.save();
  }

  // ---------------------------------------------------------------------------
  // Refresh rendering document
  // ---------------------------------------------------------------------------

  /**
   * After editing with pdf-lib, call this to synchronize the pdfjs-dist
   * document proxy so future renders reflect the latest state.
   *
   * @returns {Promise<void>}
   */
  async syncRenderDoc() {
    if (!this._pdfDoc) return;
    this._sourceBuffer = await this._pdfDoc.save();
    this._pdfJsDoc = await pdfjsLib.getDocument({
      data: this._sourceBuffer.slice(),
    }).promise;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Release resources (destroy pdfjs document, null references).
   */
  async close() {
    if (this._pdfJsDoc) {
      await this._pdfJsDoc.destroy();
      this._pdfJsDoc = null;
    }
    this._pdfDoc = null;
    this._sourceBuffer = null;
  }

  /**
   * Cleanup synchronously (best-effort).
   */
  destroy() {
    if (this._pdfJsDoc) {
      this._pdfJsDoc.destroy().catch(() => {});
      this._pdfJsDoc = null;
    }
    this._pdfDoc = null;
    this._sourceBuffer = null;
  }
}

export default PDFEngine;
