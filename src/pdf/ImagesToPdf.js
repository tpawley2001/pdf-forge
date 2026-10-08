/**
 * ImagesToPdf.js - Build a multi-page PDF from JPEG/PNG images.
 *
 * CommonJS on purpose: shared by the webpack renderer (ImagesToPdfDialog),
 * and the Node CLI (cli/img2pdf.js), neither of which share a module loader.
 */
const { PDFDocument } = require('pdf-lib');

const PAGE_SIZES = {
  a4:     [595.28, 841.89],
  letter: [612, 792],
  legal:  [612, 1008],
};

function detectImageType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length > 7 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return null;
}

/**
 * @param {Array<{data: Uint8Array, name?: string}>} images - one page per image, in order
 * @param {Object} opts
 * @param {'auto'|'a4'|'letter'|'legal'} [opts.pageSize='auto'] - 'auto' sizes each page to its image
 * @param {'auto'|'portrait'|'landscape'} [opts.orientation='auto'] - ignored for 'auto' pageSize
 * @param {number} [opts.margin=0] - page margin in points (fixed sizes only)
 * @returns {Promise<Uint8Array>} PDF bytes
 */
async function imagesToPdf(images, opts = {}) {
  if (!images || images.length === 0) throw new Error('No images provided');
  const pageSize = opts.pageSize || 'auto';
  const orientation = opts.orientation || 'auto';
  const margin = Number(opts.margin) || 0;

  const doc = await PDFDocument.create();

  for (const img of images) {
    const type = detectImageType(img.data);
    if (!type) throw new Error(`Unsupported image format: ${img.name || 'image'} (only JPEG and PNG)`);
    const embedded = type === 'jpg' ? await doc.embedJpg(img.data) : await doc.embedPng(img.data);

    if (pageSize === 'auto') {
      const page = doc.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
      continue;
    }

    let [pw, ph] = PAGE_SIZES[pageSize] || PAGE_SIZES.a4;
    const wantLandscape = orientation === 'landscape' ||
      (orientation === 'auto' && embedded.width > embedded.height);
    if (wantLandscape) [pw, ph] = [ph, pw];

    const page = doc.addPage([pw, ph]);
    const maxW = pw - margin * 2;
    const maxH = ph - margin * 2;
    const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1e6);
    const w = embedded.width * scale;
    const h = embedded.height * scale;
    page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }

  return doc.save();
}

module.exports = { imagesToPdf, detectImageType, PAGE_SIZES };
