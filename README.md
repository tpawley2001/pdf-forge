# PDF Forge

Free, open-source, Adobe Acrobat–style PDF editor for Windows. Built with Electron, React, pdf.js, pdf-lib, and PDFium (via [@embedpdf/pdfium](https://github.com/embedpdf/embed-pdf-viewer), MIT).

## Features

- **View & navigate** — continuous scrolling, thumbnails, bookmarks/outline, search, zoom/fit, rotate
- **Annotate** — highlight, underline, strikethrough, freehand, shapes, arrows, text boxes, sticky notes, stamps, signatures (flattened into the PDF on save)
- **Edit text** — Acrobat-style paragraph editing powered by PDFium: click any line to edit the whole paragraph, which reflows to its original width (left/center/right/justified) in the document's own embedded font; mixed bold/regular words keep their styles; drag the box to move it or resize it to change the wrap width. Missing glyphs switch the paragraph to the matching system font. Every edit is verified by rendering the page before and after — if anything outside the paragraph would change, it falls back to overlay editing. OCR-powered editing for scanned pages (Tesseract)
- **Fill forms** — interactive AcroForm fields (text, checkboxes, radios, dropdowns) rendered right on the page; flatten fields when done
- **Redact** — true redaction: marked content is *removed* from the file, verified, and pages that can't be cleanly scrubbed are flattened to an image — never just a black box over live text
- **Watermark & headers/footers** — diagonal/horizontal text watermarks; headers and footers with `{page}`, `{pages}`, `{date}`, and `{bates}` numbering tokens
- **Protect** — real password encryption (open password + permissions), and open/unlock password-protected files
- **Organize pages** — reorder, rotate, delete, extract, duplicate, insert from another PDF; merge PDFs; export pages as images
- **Create PDF from images** — combine JPEG/PNG pictures into a PDF with reordering, page size (fit/A4/Letter/Legal), orientation, and margins
- **Document properties** — edit title, author, and metadata

## Development

```bash
npm install
npm start            # webpack dev server + Electron
npm run build        # production build + Windows installer (NSIS)
```

### img2pdf CLI

The image-to-PDF engine is also available from the command line:

```bash
node cli/img2pdf.js photo1.jpg photo2.png -o out.pdf
node cli/img2pdf.js *.jpg --page a4 --margin 24 -o album.pdf
```

Non-JPEG/PNG formats (webp, heic, tiff, …) are converted through ImageMagick if it's installed.

## License

MIT © Hillyard Tech. PDF Forge only uses permissively licensed dependencies (MIT, BSD, Apache-2.0, ISC).
