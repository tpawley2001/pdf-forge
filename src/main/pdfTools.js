/**
 * pdfTools.js — qpdf (Apache-2.0, via @neslinesli93/qpdf-wasm, ISC) in the
 * main process: structural rewrite, linearization, and size optimisation.
 *
 * Note: this wasm build can't run qpdf's damaged-file recovery (it aborts
 * instead of reconstructing the xref), so "Repair" first re-saves through
 * PDFium in the renderer, then calls rewrite() here for a clean file.
 */

const fs = require('fs');
const path = require('path');
const createQpdf = require('@neslinesli93/qpdf-wasm');

// Real Node require even inside the webpack bundle (don't bundle the .wasm)
// eslint-disable-next-line no-undef
const nodeRequire = typeof __non_webpack_require__ === 'function' ? __non_webpack_require__ : require;

function wasmBinary() {
  // Bundled (dist-main/qpdf.wasm sits next to this file) vs. dev (node_modules)
  const bundled = path.join(__dirname, 'qpdf.wasm');
  if (fs.existsSync(bundled)) return fs.readFileSync(bundled);
  return fs.readFileSync(nodeRequire.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm'));
}

let wasmCache = null;

/** Run qpdf once on `input`; a fresh module per call (callMain isn't re-entrant). */
async function runQpdf(args, input) {
  wasmCache = wasmCache || wasmBinary();
  const messages = [];
  const m = await createQpdf({
    wasmBinary: wasmCache,
    noInitialRun: true,
    print: t => messages.push(t),
    printErr: t => messages.push(t),
  });
  m.FS.writeFile('/in.pdf', input);
  let code;
  const prevExitCode = process.exitCode; // emscripten sets this on qpdf exit
  try {
    code = m.callMain(args.map(a => (a === 'IN' ? '/in.pdf' : a === 'OUT' ? '/out.pdf' : a)));
  } catch (e) {
    code = typeof e.status === 'number' ? e.status : 2;
  } finally {
    process.exitCode = prevExitCode;
  }
  let output = null;
  try { output = Buffer.from(m.FS.readFile('/out.pdf')); } catch (_) { /* no output */ }
  // qpdf exit codes: 0 ok, 3 ok-with-warnings, 2 error
  if (code === 2 || !output) {
    throw new Error(messages.filter(Boolean).join('\n').replace(/this\.program: \/in\.pdf:?\s*/g, '') || 'qpdf failed');
  }
  return { bytes: output, warnings: code === 3 ? messages.filter(Boolean) : [] };
}

const OPS = {
  rewrite: ['IN', 'OUT'],
  linearize: ['--linearize', 'IN', 'OUT'],
  optimize: ['--object-streams=generate', '--compress-streams=y', '--recompress-flate',
    '--compression-level=9', 'IN', 'OUT'],
};

async function transform(op, bytes) {
  const args = OPS[op];
  if (!args) throw new Error(`Unknown operation ${op}`);
  const res = await runQpdf(args, Buffer.from(bytes));
  return { ...res, before: bytes.length, after: res.bytes.length };
}

module.exports = { transform };
