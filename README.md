# PDF Forge

Free, open-source, Adobe Acrobat–style PDF editor for Windows. Built with Electron, React, pdf.js, and pdf-lib.

## Features

- **View & navigate** — continuous scrolling, thumbnails, bookmarks/outline, search, zoom/fit, rotate
- **Annotate** — highlight, underline, strikethrough, freehand, shapes, arrows, text boxes, sticky notes, stamps, signatures (flattened into the PDF on save)
- **Edit text** — click existing text to replace it, with automatic font matching; OCR-powered editing for scanned pages (Tesseract)
- **Fill forms** — interactive AcroForm fields (text, checkboxes, radios, dropdowns) rendered right on the page; flatten fields when done
- **Redact** — true redaction: marked content is *removed* from the file, verified, and pages that can't be cleanly scrubbed are flattened to an image — never just a black box over live text
- **Watermark & headers/footers** — diagonal/horizontal text watermarks; headers and footers with `{page}`, `{pages}`, `{date}`, and `{bates}` numbering tokens
- **Protect** — real password encryption (open password + permissions), and open/unlock password-protected files
- **Organize pages** — reorder, rotate, delete, extract, duplicate, insert from another PDF; merge PDFs; export pages as images
- **Document properties** — edit title, author, and metadata

## Development

```bash
npm install
npm start            # webpack dev server + Electron
npm run build        # production build + Windows installer (NSIS)
```

## License

MIT
