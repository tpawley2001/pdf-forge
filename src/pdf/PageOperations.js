/**
 * PageOperations.js - Page manipulation operations for PDF documents.
 *
 * All functions operate on pdf-lib PDFDocument instances and return
 * the modified document (or a new document for extraction/splitting).
 */

import { PDFDocument } from 'pdf-lib';
import * as Assembler from './DocAssembler.js';

export class PageOperations {
  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  /**
   * Remove pages by their indices. Modifies the document in-place.
   *
   * @param {PDFDocument} doc
   * @param {number[]} pageIndices - 0-based indices to delete (sorted descending recommended)
   * @returns {PDFDocument}
   */
  deletePages(doc, pageIndices) {
    if (!pageIndices || pageIndices.length === 0) return doc;
    // Also cleans up links, bookmarks and fields that pointed at the pages.
    return Assembler.removePages(doc, pageIndices);
  }


  // ---------------------------------------------------------------------------
  // Insert
  // ---------------------------------------------------------------------------

  /**
   * Insert pages from a source document into the target document at a specific
   * position. Their links, bookmarks, form fields, layers and attachments come
   * along (see DocAssembler).
   *
   * @param {PDFDocument} doc               - Target document
   * @param {PDFDocument} sourceDoc         - Source document
   * @param {number[]} sourcePageIndices    - 0-based indices of pages to copy
   * @param {number} targetIndex            - 0-based index to insert before (or at end)
   * @returns {Promise<PDFDocument>}
   */
  async insertPages(doc, sourceDoc, sourcePageIndices, targetIndex) {
    if (!sourcePageIndices || sourcePageIndices.length === 0) return doc;
    return Assembler.importPages(doc, sourceDoc, sourcePageIndices, targetIndex);
  }


  // ---------------------------------------------------------------------------
  // Extract
  // ---------------------------------------------------------------------------

  /**
   * Extract pages into a brand-new PDFDocument.
   *
   * @param {PDFDocument} doc
   * @param {number[]} pageIndices  - 0-based indices to extract
   * @returns {Promise<PDFDocument>} New document containing only the extracted pages
   */
  async extractPages(doc, pageIndices) {
    if (!pageIndices || pageIndices.length === 0) {
      return PDFDocument.create();
    }
    return Assembler.extractPages(doc, pageIndices);
  }


  // ---------------------------------------------------------------------------
  // Reorder
  // ---------------------------------------------------------------------------

  /**
   * Reorder pages according to a new ordering array.
   * newOrder[i] = original 0-based index of the page that should become page i.
   *
   * Example: reorderPages(doc, [2, 0, 1]) moves original page 2 to position 0,
   * original page 0 to position 1, original page 1 to position 2.
   *
   * @param {PDFDocument} doc
   * @param {number[]} newOrder
   * @returns {PDFDocument}
   */
  reorderPages(doc, newOrder) {
    return Assembler.reorderPages(doc, newOrder);
  }


  // ---------------------------------------------------------------------------
  // Rotate
  // ---------------------------------------------------------------------------

  /**
   * Rotate pages by a multiple of 90 degrees.
   *
   * @param {PDFDocument} doc
   * @param {number[]} pageIndices  - 0-based page indices
   * @param {number} degrees        - 90, 180, or 270
   * @returns {PDFDocument}
   */
  rotatePages(doc, pageIndices, degrees) {
    if (![90, 180, 270].includes(degrees)) {
      throw new Error(`Rotation must be 90, 180, or 270 degrees, got ${degrees}`);
    }

    const count = doc.getPageCount();
    const pages = doc.getPages();

    for (const idx of pageIndices) {
      if (idx < 0 || idx >= count) {
        throw new Error(`Page index ${idx} out of range [0, ${count - 1}]`);
      }
      const page = pages[idx];
      const currentRotation = page.getRotation().angle;
      page.setRotation({ angle: (currentRotation + degrees) % 360 });
    }

    return doc;
  }

  // ---------------------------------------------------------------------------
  // Crop
  // ---------------------------------------------------------------------------

  /**
   * Crop a page to a rectangle. Sets the media box and crop box.
   *
   * @param {PDFDocument} doc
   * @param {number} pageIndex      - 0-based
   * @param {{x: number, y: number, width: number, height: number}} rect
   * @returns {PDFDocument}
   */
  cropPage(doc, pageIndex, rect) {
    const count = doc.getPageCount();
    if (pageIndex < 0 || pageIndex >= count) {
      throw new Error(`Page index ${pageIndex} out of range [0, ${count - 1}]`);
    }

    const page = doc.getPages()[pageIndex];
    const { width: pageW, height: pageH } = page.getSize();

    // Validate crop rect
    if (rect.x < 0 || rect.y < 0 ||
        rect.x + rect.width > pageW ||
        rect.y + rect.height > pageH) {
      throw new Error('Crop rectangle extends beyond page bounds');
    }

    page.setCropBox(rect.x, rect.y, rect.width, rect.height);
    // Also set media box to match crop for consistent behaviour
    page.setMediaBox(rect.x, rect.y, rect.width, rect.height);

    return doc;
  }

  // ---------------------------------------------------------------------------
  // Split
  // ---------------------------------------------------------------------------

  /**
   * Split a document into multiple PDFs based on page ranges.
   *
   * @param {PDFDocument} doc
   * @param {Array<{start: number, end: number}>} ranges
   *   Each range: start inclusive, end inclusive (0-based). E.g. [{start:0, end:2}, {start:3, end:5}]
   * @returns {Promise<PDFDocument[]>}
   */
  async splitDocument(doc, ranges) {
    if (!ranges || ranges.length === 0) {
      return [];
    }

    const results = [];
    for (const range of ranges) {
      const indices = [];
      for (let i = range.start; i <= range.end; i++) {
        indices.push(i);
      }
      const extracted = await this.extractPages(doc, indices);
      results.push(extracted);
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Merge
  // ---------------------------------------------------------------------------

  /**
   * Merge multiple PDFDocument instances into one.
   *
   * @param {PDFDocument[]} docs
   * @returns {Promise<PDFDocument>}
   */
  async mergeDocuments(docs) {
    if (!docs || docs.length === 0) {
      return PDFDocument.create();
    }
    return Assembler.assemble(docs.filter(d => d.getPageCount() > 0).map(doc => ({ doc })));
  }


  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Duplicate specific pages within the same document, appending copies at the
   * end.
   *
   * @param {PDFDocument} doc
   * @param {number[]} pageIndices
   * @returns {Promise<PDFDocument>}
   */
  async duplicatePages(doc, pageIndices) {
    const copied = await doc.copyPages(doc, pageIndices);
    for (const page of copied) {
      doc.addPage(page);
    }
    return doc;
  }

  /**
   * Move a page from one index to another.
   *
   * @param {PDFDocument} doc
   * @param {number} fromIndex
   * @param {number} toIndex
   * @returns {PDFDocument}
   */
  movePage(doc, fromIndex, toIndex) {
    const count = doc.getPageCount();
    if (fromIndex < 0 || fromIndex >= count || toIndex < 0 || toIndex >= count) {
      throw new Error('Invalid page index');
    }

    const pages = doc.getPages();
    const page = pages[fromIndex];

    doc.removePage(fromIndex);
    // Adjust toIndex if it was after fromIndex
    const adjusted = toIndex > fromIndex ? toIndex - 1 : toIndex;
    doc.insertPage(adjusted, page);

    return doc;
  }
}

export default PageOperations;
