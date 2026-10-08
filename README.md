# PDF Forge

Free, open-source, Adobe Acrobat–style PDF editor for Windows. Built with Electron, React, pdf.js, pdf-lib, and PDFium (via [@embedpdf/pdfium](https://github.com/embedpdf/embed-pdf-viewer), MIT).

## Features

- **View & navigate** — continuous scrolling, thumbnails, bookmarks/outline, search, zoom/fit, rotate
- **Annotate** — highlight, underline, strikethrough, freehand, shapes, arrows, text boxes, sticky notes, stamps, signatures (flattened into the PDF on save)
- **Edit text** — Acrobat-style paragraph editing powered by PDFium: click any line to edit the whole paragraph, which reflows to its original width (left/center/right/justified) in the document's own embedded font; mixed bold/regular words keep their styles; drag the box to move it or resize it to change the wrap width. Missing glyphs switch the paragraph to the matching system font. Every edit is verified by rendering the page before and after — if anything outside the paragraph would change, it falls back to overlay editing. OCR-powered editing for scanned pages (Tesseract)
- **Fill forms** — interactive AcroForm fields (text, checkboxes, radios, dropdowns) rendered right on the page; flatten fields when done
- **Redact** — true redaction: marked content is *removed* from the file, verified, and pages that can't be cleanly scrubbed are flattened to an image — never just a black box over live text
- **Watermark & headers/footers** — diagonal/horizontal text watermarks; headers and footers with `{page}`, `{pages}`, `{date}`, and `{bates}` numbering tokens
- **Digital signatures** — sign with a certificate (.pfx/.p12 Digital ID) like Acrobat's "Use a certificate": visible (drag to place) or invisible, reason/location, optional RFC 3161 trusted timestamp and LTV; create a self-signed Digital ID in-app. Opening a signed PDF verifies every signature (integrity, signer, time, timestamp, later changes, chain to a trusted root) and shows a status bar plus a Signature Panel
- **Protect** — real password encryption (open password + permissions), and open/unlock password-protected files
- **Repair & optimize** — Repair PDF rebuilds damaged files (PDFium recovery + qpdf rewrite; offered automatically when a file won't open), Reduce File Size (qpdf object streams + recompression), and Optimize for Fast Web View (qpdf linearization)
- **Organize pages** — reorder, rotate, delete, extract, duplicate, insert from another PDF; merge PDFs; split into several files (every *n* pages or before chosen pages); export pages as images
- **Combine & split without losing anything** — merging, extracting, splitting and inserting keep links (re-pointed at the copied pages), bookmarks (merged files can get one bookmark each with theirs nested underneath), interactive form fields (same-named fields from different files are renamed so their values stay separate), layers with their on/off defaults, and file attachments. Deleting pages also removes the links and bookmarks that pointed at them
- **Safe saving** — saves are written to a temporary file and swapped in, so a crash or full disk mid-save never leaves a truncated PDF; closing, quitting or opening another file with unsaved changes asks Save / Don't Save / Cancel; unsaved work is autosaved every minute and offered for recovery if PDF Forge quits unexpectedly (protected documents are autosaved encrypted)
- **Create PDF from images** — combine JPEG/PNG pictures into a PDF with reordering, page size (fit/A4/Letter/Legal), orientation, and margins
- **Document properties** — edit title, author, and metadata

## Development

```bash
npm install
npm start            # webpack dev server + Electron
npm run build        # renderer + main bundles + Windows installer (NSIS)
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

The page assembly design (one copier per source document, rebuilding links, bookmarks, fields, layers and attachments) was inspired by [PdfCraft](https://github.com/storytold/pdfcraft) (MIT OR Apache-2.0); PDF Forge's implementation is its own.
