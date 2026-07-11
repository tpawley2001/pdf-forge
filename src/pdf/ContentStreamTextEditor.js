import {
  PDFArray,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';

const TEXT_SHOW_OPERATORS = new Set(['Tj', "'", '"', 'TJ']);

function bytesToBinaryString(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

function isWhite(ch) {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\0';
}

function isDelimiter(ch) {
  return isWhite(ch) || '[]<>()/{}'.includes(ch);
}

function decodeLiteral(raw) {
  let out = '';
  for (let i = 1; i < raw.length - 1; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }

    const next = raw[++i];
    if (next === undefined) break;
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === 'b') out += '\b';
    else if (next === 'f') out += '\f';
    else if (next === '\n') {
      // Line continuation.
    } else if (next === '\r') {
      if (raw[i + 1] === '\n') i += 1;
    } else if (/[0-7]/.test(next)) {
      let oct = next;
      for (let j = 0; j < 2 && /[0-7]/.test(raw[i + 1]); j += 1) oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else {
      out += next;
    }
  }
  return out;
}

function encodeLiteral(text) {
  return `(${String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')})`;
}

function decodeHex(raw) {
  const clean = raw.slice(1, -1).replace(/\s+/g, '');
  const even = clean.length % 2 === 0 ? clean : `${clean}0`;
  let out = '';
  for (let i = 0; i < even.length; i += 2) {
    out += String.fromCharCode(parseInt(even.slice(i, i + 2), 16));
  }
  return out;
}

function encodeHex(text) {
  let out = '<';
  for (const ch of String(text)) {
    out += ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase();
  }
  return `${out}>`;
}

function parseLiteralToken(src, start) {
  let i = start + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    i += 1;
  }
  const raw = src.slice(start, i);
  return { type: 'string', raw, start, end: i, value: decodeLiteral(raw) };
}

function parseHexToken(src, start) {
  let i = start + 1;
  while (i < src.length && src[i] !== '>') i += 1;
  i = Math.min(i + 1, src.length);
  const raw = src.slice(start, i);
  return { type: 'hex', raw, start, end: i, value: decodeHex(raw) };
}

function parseBareToken(src, start) {
  let i = start;
  while (i < src.length && !isDelimiter(src[i])) i += 1;
  if (i === start) i += 1;
  const raw = src.slice(start, i);
  return { type: TEXT_SHOW_OPERATORS.has(raw) ? 'operator' : 'atom', raw, start, end: i };
}

function parseNameToken(src, start) {
  let i = start + 1;
  while (i < src.length && !isDelimiter(src[i])) i += 1;
  return { type: 'name', raw: src.slice(start, i), start, end: i };
}

function parseArrayToken(src, start) {
  let i = start + 1;
  const elements = [];
  while (i < src.length) {
    const ch = src[i];
    if (isWhite(ch)) {
      i += 1;
      continue;
    }
    if (ch === '%') {
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i += 1;
      continue;
    }
    if (ch === ']') {
      i += 1;
      break;
    }
    const token = parseToken(src, i);
    elements.push(token);
    i = token.end;
  }
  return { type: 'array', raw: src.slice(start, i), start, end: i, elements };
}

function parseToken(src, start) {
  const ch = src[start];
  if (ch === '(') return parseLiteralToken(src, start);
  if (ch === '<' && src[start + 1] !== '<') return parseHexToken(src, start);
  if (ch === '[') return parseArrayToken(src, start);
  if (ch === '/') return parseNameToken(src, start);
  if ((ch === '<' && src[start + 1] === '<') || (ch === '>' && src[start + 1] === '>')) {
    return { type: 'atom', raw: src.slice(start, start + 2), start, end: start + 2 };
  }
  return parseBareToken(src, start);
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (isWhite(ch)) {
      i += 1;
      continue;
    }
    if (ch === '%') {
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i += 1;
      continue;
    }
    const token = parseToken(src, i);
    tokens.push(token);
    i = token.end;
  }
  return tokens;
}

function tokenText(token) {
  if (!token) return '';
  if (token.type === 'string' || token.type === 'hex') return token.value;
  if (token.type === 'array') return token.elements.map(tokenText).join('');
  return '';
}

function replacementForToken(token, text) {
  if (token.type === 'hex') return encodeHex(text);
  return encodeLiteral(text);
}

function replacementForArray(token, text) {
  const stringElements = token.elements.filter(el => el.type === 'string' || el.type === 'hex');
  const first = stringElements[0];
  return `[${replacementForToken(first || { type: 'string' }, text)}]`;
}

function replaceRange(src, start, end, replacement) {
  return `${src.slice(0, start)}${replacement}${src.slice(end)}`;
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function findEditableRuns(tokens) {
  const runs = [];
  const operands = [];
  for (const token of tokens) {
    if (token.type !== 'operator') {
      operands.push(token);
      continue;
    }

    const op = token.raw;
    if (op === 'Tj' || op === "'") {
      const valueToken = operands[operands.length - 1];
      if (valueToken?.type === 'string' || valueToken?.type === 'hex') {
        runs.push({ op, token: valueToken, text: tokenText(valueToken) });
      }
    } else if (op === '"') {
      const valueToken = operands[operands.length - 1];
      if (valueToken?.type === 'string' || valueToken?.type === 'hex') {
        runs.push({ op, token: valueToken, text: tokenText(valueToken) });
      }
    } else if (op === 'TJ') {
      const arrayToken = operands[operands.length - 1];
      if (arrayToken?.type === 'array') {
        runs.push({ op, token: arrayToken, text: tokenText(arrayToken) });
      }
    }

    operands.length = 0;
  }
  return runs;
}

function rewriteContentStream(content, edits) {
  let src = content;
  let replacements = 0;

  for (const edit of edits) {
    const original = normalizeText(edit.originalText || edit.searchText || '');
    if (!original || edit.text == null) continue;

    const tokens = tokenize(src);
    const runs = findEditableRuns(tokens);
    const run = runs.find(candidate => normalizeText(candidate.text) === original);
    if (!run) continue;

    const replacement = run.token.type === 'array'
      ? replacementForArray(run.token, edit.text)
      : replacementForToken(run.token, edit.text);
    src = replaceRange(src, run.token.start, run.token.end, replacement);
    replacements += 1;
  }

  return { content: src, replacements };
}

function decodedStreamString(stream) {
  if (!(stream instanceof PDFRawStream)) return null;
  try {
    return bytesToBinaryString(decodePDFRawStream(stream).decode());
  } catch (_) {
    return null;
  }
}

export function rewritePageTextRuns(doc, pageIndex, edits) {
  const page = doc.getPages()[pageIndex];
  if (!page) return { replacements: 0 };

  page.node.normalize();
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray)) return { replacements: 0 };

  let total = 0;
  for (let i = 0; i < contents.size(); i += 1) {
    const ref = contents.get(i);
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFStream)) continue;

    const decoded = decodedStreamString(stream);
    if (decoded == null) continue;

    const result = rewriteContentStream(decoded, edits);
    if (result.replacements === 0) continue;

    const newStream = doc.context.flateStream(result.content);
    contents.set(i, doc.context.register(newStream));
    total += result.replacements;
  }

  return { replacements: total };
}

export function canAttemptNativeTextEdit(edit) {
  return !!normalizeText(edit?.originalText || edit?.searchText || '');
}

/**
 * Permanently remove text-show runs whose decoded text matches the given
 * target strings (used by redaction). A run is only removed when the match is
 * unambiguous: the number of matching runs on the page equals the number of
 * times that text was targeted. Anything else is reported back so the caller
 * can fall back to rasterization.
 *
 * @returns {{ removed: number, unresolved: string[] }}
 *   unresolved — target texts that could not be safely removed
 */
export function removePageTextRunsByText(doc, pageIndex, targetTexts) {
  const page = doc.getPages()[pageIndex];
  const unresolved = [];
  if (!page) return { removed: 0, unresolved: [...targetTexts] };

  page.node.normalize();
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray)) return { removed: 0, unresolved: [...targetTexts] };

  // Decode every stream and collect all runs with their stream index
  const streams = [];
  const allRuns = [];
  for (let i = 0; i < contents.size(); i += 1) {
    const ref = contents.get(i);
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFStream)) { streams.push(null); continue; }
    const decoded = decodedStreamString(stream);
    streams.push(decoded);
    if (decoded == null) continue;
    for (const run of findEditableRuns(tokenize(decoded))) {
      allRuns.push({ streamIdx: i, token: run.token, text: normalizeText(run.text) });
    }
  }

  // Group targets by normalized text so duplicates are handled correctly
  const targetCounts = new Map();
  for (const t of targetTexts) {
    const norm = normalizeText(t);
    if (!norm) continue;
    targetCounts.set(norm, (targetCounts.get(norm) || 0) + 1);
  }

  const removals = []; // { streamIdx, start, end }
  let removed = 0;
  for (const [text, wanted] of targetCounts) {
    const matches = allRuns.filter(r => r.text === text);
    if (matches.length === 0 || matches.length !== wanted) {
      // 0 matches: encoding mismatch (subset font). >wanted: ambiguous —
      // removing could destroy an instance outside the redaction area.
      unresolved.push(text);
      continue;
    }
    for (const m of matches) {
      removals.push({ streamIdx: m.streamIdx, start: m.token.start, end: m.token.end, isArray: m.token.type === 'array' });
      removed += 1;
    }
  }

  // Apply removals per stream, back-to-front so offsets stay valid
  const byStream = new Map();
  for (const r of removals) {
    if (!byStream.has(r.streamIdx)) byStream.set(r.streamIdx, []);
    byStream.get(r.streamIdx).push(r);
  }
  for (const [idx, list] of byStream) {
    let src = streams[idx];
    if (src == null) continue;
    list.sort((a, b) => b.start - a.start);
    for (const r of list) {
      src = replaceRange(src, r.start, r.end, r.isArray ? '[()]' : '()');
    }
    const newStream = doc.context.flateStream(src);
    contents.set(idx, doc.context.register(newStream));
  }

  return { removed, unresolved };
}
