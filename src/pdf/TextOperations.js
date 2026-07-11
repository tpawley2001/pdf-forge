/**
 * TextOperations.js - Text extraction, search, redaction, and insertion.
 * Uses pdfjs-dist for extraction and pdf-lib for insertion/redaction.
 */
import { StandardFonts, rgb } from 'pdf-lib';

export class TextOperations {
  constructor() {
    this._textCache = new Map(); // keyed by `${pageIndex}`
  }

  /** Extract text with positions for a page using pdfjs text layer. */
  async extractTextForPage(engine, pageIndex) {
    const cacheKey = `p${pageIndex}`;
    if (this._textCache.has(cacheKey)) return this._textCache.get(cacheKey);

    const pdfJsDoc = engine.pdfJsDocument;
    if (!pdfJsDoc) throw new Error('No document loaded');

    const page = await pdfJsDoc.getPage(pageIndex + 1);
    const textContent = await page.getTextContent();

    const items = textContent.items.map(item => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      height: item.height,
      fontName: item.fontName,
    }));

    this._textCache.set(cacheKey, items);
    return items;
  }

  /** Search across all pages. Returns [{page, rect, text}]. */
  async searchText(engine, query) {
    if (!query || !engine.pdfJsDocument) return [];
    const pageCount = engine.getPageCount();
    const results = [];
    const q = query.toLowerCase();

    for (let p = 0; p < pageCount; p++) {
      const items = await this.extractTextForPage(engine, p);
      // Group items by lines
      const lines = [];
      let currentLine = [];
      let lastY = null;

      for (const item of items) {
        if (lastY !== null && Math.abs(item.y - lastY) > 2) {
          if (currentLine.length) {
            lines.push(currentLine);
            currentLine = [];
          }
        }
        currentLine.push(item);
        lastY = item.y;
      }
      if (currentLine.length) lines.push(currentLine);

      for (const line of lines) {
        const fullText = line.map(i => i.text).join('');
        if (fullText.toLowerCase().includes(q)) {
          results.push({
            page: p,
            text: fullText.trim(),
            rect: {
              x: line[0].x,
              y: line[0].y,
              width: line.reduce((sum, i) => sum + i.width, 0),
              height: line[0].height || 12,
            },
          });
        }
      }
    }
    return results;
  }

  /** Draw black rectangles over text areas for redaction. */
  redactText(doc, pageIndex, rects) {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];
    for (const rect of rects) {
      page.drawRectangle({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        color: rgb(0, 0, 0),
      });
    }
    return doc;
  }

  /** Add text content to a page. */
  async addTextContent(doc, pageIndex, text, x, y, fontSize = 12, fontName = 'Helvetica') {
    const pages = doc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range`);
    }
    const page = pages[pageIndex];

    const fontMap = {
      Helvetica: StandardFonts.Helvetica,
      TimesRoman: StandardFonts.TimesRoman,
      Courier: StandardFonts.Courier,
      HelveticaBold: StandardFonts.HelveticaBold,
    };
    const font = await doc.embedFont(fontMap[fontName] || StandardFonts.Helvetica);

    page.drawText(text, { x, y, size: fontSize, font, color: rgb(0, 0, 0) });
    return doc;
  }

  /** Get structured text blocks with bounding boxes for a page. */
  async getPageTextBlocks(engine, pageIndex) {
    const items = await this.extractTextForPage(engine, pageIndex);
    const blocks = [];
    let currentBlock = [];

    for (const item of items) {
      if (currentBlock.length > 0) {
        const last = currentBlock[currentBlock.length - 1];
        if (Math.abs(item.y - last.y) > 5 || Math.abs(item.x - (last.x + last.width)) > 12) {
          blocks.push(this._makeBlock(currentBlock));
          currentBlock = [];
        }
      }
      currentBlock.push(item);
    }
    if (currentBlock.length) blocks.push(this._makeBlock(currentBlock));
    return blocks;
  }

  _makeBlock(items) {
    const text = items.map(i => i.text).join('');
    const xs = items.map(i => i.x);
    const ys = items.map(i => i.y);
    const heights = items.map(i => i.height || 12);
    return {
      text,
      bbox: {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs.map((x, i) => x + items[i].width)) - Math.min(...xs),
        height: Math.max(...heights),
      },
    };
  }

  clearCache() {
    this._textCache.clear();
  }
}

export default TextOperations;
