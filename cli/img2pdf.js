#!/usr/bin/env node
/**
 * img2pdf - combine pictures into a PDF from the command line.
 *
 * Usage:
 *   img2pdf photo1.jpg photo2.png -o out.pdf
 *   img2pdf *.jpg --page a4 --margin 24 -o album.pdf
 *
 * JPEG/PNG embed directly; anything else (webp/heic/tiff/bmp/gif) is
 * converted through ImageMagick if installed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { imagesToPdf, detectImageType } = require('../src/pdf/ImagesToPdf');

function usage(code) {
  console.log(`Usage: img2pdf <images...> [options]

Options:
  -o, --output <file>   Output PDF path (default: first image name + .pdf)
  --page <size>         Page size: auto, a4, letter, legal (default: auto)
  --orientation <o>     portrait, landscape, auto (default: auto)
  --margin <pts>        Page margin in points (default: 0; fixed page sizes only)
  -h, --help            Show this help`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { inputs: [], output: null, pageSize: 'auto', orientation: 'auto', margin: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') usage(0);
    else if (a === '-o' || a === '--output') opts.output = argv[++i];
    else if (a === '--page') opts.pageSize = (argv[++i] || '').toLowerCase();
    else if (a === '--orientation') opts.orientation = (argv[++i] || '').toLowerCase();
    else if (a === '--margin') opts.margin = Number(argv[++i]) || 0;
    else if (a.startsWith('-')) { console.error(`Unknown option: ${a}`); usage(1); }
    else opts.inputs.push(a);
  }
  if (opts.inputs.length === 0) usage(1);
  return opts;
}

function loadImage(file, tmpDir) {
  let data = fs.readFileSync(file);
  if (!detectImageType(data)) {
    const converted = path.join(tmpDir, path.basename(file) + '.png');
    try {
      execFileSync('convert', [file, converted], { stdio: 'pipe' });
    } catch (err) {
      throw new Error(`${file}: not JPEG/PNG and ImageMagick conversion failed (${err.message.split('\n')[0]})`);
    }
    data = fs.readFileSync(converted);
  }
  return { data: new Uint8Array(data), name: path.basename(file) };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const output = opts.output ||
    path.basename(opts.inputs[0], path.extname(opts.inputs[0])) + '.pdf';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'img2pdf-'));
  try {
    const images = opts.inputs.map(f => loadImage(f, tmpDir));
    const bytes = await imagesToPdf(images, {
      pageSize: opts.pageSize, orientation: opts.orientation, margin: opts.margin,
    });
    fs.writeFileSync(output, Buffer.from(bytes));
    console.log(`${output}: ${images.length} page${images.length !== 1 ? 's' : ''}, ${(bytes.length / 1024).toFixed(0)} KB`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(`img2pdf: ${err.message}`); process.exit(1); });
