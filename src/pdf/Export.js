/**
 * Export.js - Export PDF pages to images, text, and other formats.
 */
import { PDFDocument } from 'pdf-lib';

export class Export {
  constructor(engine) {
    this._engine = engine;
  }

  /** Export all pages as data URLs in the specified format. */
  async exportAsImages(format = 'png') {
    const count = this._engine.getPageCount();
    const images = [];
    for (let i = 0; i < count; i++) {
      const dataUrl = await this.exportPageAsImage(i, format);
      images.push(dataUrl);
    }
    return images;
  }

  /** Export a single page as a data URL. */
  async exportPageAsImage(pageIndex, format = 'png') {
    if (!this._engine.pdfJsDocument) throw new Error('No document loaded');
    const page = await this._engine.pdfJsDocument.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 2 }); // 2x for quality

    const canvas = new OffscreenCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const mimeType = format === 'jpeg' || format === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await canvas.convertToBlob({ type: mimeType });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /** Extract all text from the document. */
  async exportAsText() {
    return this._engine.textOps;
  }

  /** Export selected pages as a new PDF and return the bytes. */
  async exportSelectedPages(pageIndices) {
    const newDoc = await this._engine.pageOps.extractPages(this._engine.document, pageIndices);
    return newDoc.save();
  }

  /** Linearize and compress for web delivery (approximation via pdf-lib save). */
  async optimizeForWeb() {
    return this._engine.save();
  }
}

export default Export;
