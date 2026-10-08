/**
 * DocAssembler.js - Combine, extract, split and insert pages without losing
 * the document-level structure that pdf-lib's copyPages() leaves behind.
 *
 * copyPages() copies a page dict and follows every reference it finds, so a
 * link or widget pointing at another page drags a parentless duplicate of that
 * page into the output, while bookmarks, the AcroForm field list, optional
 * content (layers) and attachments - which live on the catalog - are dropped.
 *
 * Here one copier is shared by all pages taken from a source document, with
 * the chosen pages pre-mapped. Anything else page-shaped is cut off, and the
 * catalog-level structures are rebuilt in the output:
 *   - links and GoTo actions (explicit or named destinations) are re-pointed at
 *     the copied pages; links into pages that were left behind are removed;
 *   - form fields keep working: the field tree is pruned to the widgets that
 *     came along and registered in the output AcroForm (root names that clash
 *     with fields already there are renamed, so values stay independent);
 *   - layers are registered with their on/off defaults and panel order;
 *   - bookmarks are carried over (optionally nested under one per file);
 *   - embedded file attachments come along.
 *
 * Approach inspired by PdfCraft's organize crate (MIT OR Apache-2.0,
 * Copyright (c) 2026 ArtCraft Team and the PdfCraft contributors); this is an
 * independent JavaScript implementation on top of pdf-lib.
 */

import {
  PDFDocument, PDFPage, PDFPageLeaf, PDFDict, PDFArray, PDFName, PDFRef,
  PDFNull, PDFNumber, PDFString, PDFHexString, PDFStream,
} from 'pdf-lib';

const N = (s) => PDFName.of(s);
const FIT = () => N('Fit');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function nameOf(obj) {
  return obj instanceof PDFName ? obj.decodeText() : undefined;
}

function textOf(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  if (obj instanceof PDFName) return obj.decodeText();
  return undefined;
}

function lookupDict(ctx, obj) {
  const v = ctx.lookup(obj);
  return v instanceof PDFDict ? v : undefined;
}

function lookupArray(ctx, obj) {
  const v = ctx.lookup(obj);
  return v instanceof PDFArray ? v : undefined;
}

/** Flatten a name tree into [key, value] pairs (value left unresolved). */
function flattenNameTree(ctx, node, out = [], depth = 0) {
  const dict = lookupDict(ctx, node);
  if (!dict || depth > 32) return out;
  const names = lookupArray(ctx, dict.get(N('Names')));
  if (names) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const key = textOf(ctx.lookup(names.get(i)));
      if (key !== undefined) out.push([key, names.get(i + 1)]);
    }
  }
  const kids = lookupArray(ctx, dict.get(N('Kids')));
  if (kids) for (let i = 0; i < kids.size(); i++) flattenNameTree(ctx, kids.get(i), out, depth + 1);
  return out;
}

/** Write a flat name tree (sorted) holding the given [key, value] pairs. */
function writeNameTree(ctx, pairs) {
  const sorted = [...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const arr = ctx.obj([]);
  for (const [k, v] of sorted) { arr.push(PDFHexString.fromText(k)); arr.push(v); }
  return ctx.register(ctx.obj({ Names: arr }));
}

function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Page refs and leaves, read from the page tree itself: pdf-lib 1.17's
 * removePage() doesn't invalidate the cache behind getPages().
 */
function livePages(doc) {
  const ctx = doc.context;
  const out = [];
  const seen = new Set();
  const walk = (ref, depth) => {
    if (!(ref instanceof PDFRef) || seen.has(ref) || depth > 64) return;
    seen.add(ref);
    const node = lookupDict(ctx, ref);
    if (!node) return;
    const kids = lookupArray(ctx, node.get(N('Kids')));
    if (kids && nameOf(node.get(N('Type'))) !== 'Page') {
      for (let i = 0; i < kids.size(); i++) walk(kids.get(i), depth + 1);
    } else {
      out.push({ ref, node });
    }
  };
  walk(doc.catalog.get(N('Pages')), 0);
  return out;
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

const namedDestCache = new WeakMap();

/** All named destinations of a document: name -> raw value. */
function namedDests(doc) {
  let map = namedDestCache.get(doc);
  if (map) return map;
  map = new Map();
  const ctx = doc.context;
  const old = lookupDict(ctx, doc.catalog.get(N('Dests')));
  if (old) for (const [k, v] of old.entries()) map.set(k.decodeText(), v);
  const names = lookupDict(ctx, doc.catalog.get(N('Names')));
  if (names) for (const [k, v] of flattenNameTree(ctx, names.get(N('Dests')))) map.set(k, v);
  namedDestCache.set(doc, map);
  return map;
}

/** Resolve a destination (array, name or string) to an explicit array. */
function resolveDest(doc, dest) {
  const ctx = doc.context;
  let d = ctx.lookup(dest);
  if (d instanceof PDFName || d instanceof PDFString || d instanceof PDFHexString) {
    d = ctx.lookup(namedDests(doc).get(textOf(d)));
  }
  if (d instanceof PDFDict) d = ctx.lookup(d.get(N('D')));
  return d instanceof PDFArray && d.size() > 0 ? d : undefined;
}

/**
 * Where an annotation or outline item jumps to inside this document.
 * Returns { kind: 'Dest' | 'A' | null, explicit } - kind is null when the
 * object has no internal GoTo (URI, launch, remote GoTo, ...).
 */
function internalTarget(doc, dict) {
  const ctx = doc.context;
  if (dict.has(N('Dest'))) return { kind: 'Dest', explicit: resolveDest(doc, dict.get(N('Dest'))) };
  const action = lookupDict(ctx, dict.get(N('A')));
  if (action && nameOf(action.get(N('S'))) === 'GoTo') {
    return { kind: 'A', explicit: resolveDest(doc, action.get(N('D'))) };
  }
  return { kind: null };
}

// ---------------------------------------------------------------------------
// The copier
// ---------------------------------------------------------------------------

const CUT_TYPES = new Set(['Page', 'Pages', 'Catalog', 'Outlines']);

/**
 * Copies objects from one document into another, like pdf-lib's
 * PDFObjectCopier, but with a fixed page mapping: references to chosen pages
 * resolve to their copies, references to any other page (or to the page
 * tree, catalog, or annotations left behind) become null instead of pulling
 * a stray copy across.
 */
class Copier {
  constructor(src, dest) {
    this.src = src;
    this.dest = dest;
    this.srcCtx = src.context;
    this.destCtx = dest.context;
    this.refs = new Map();      // src PDFRef -> dest PDFRef
    this.objs = new Map();      // src direct object -> dest object
    this.cut = new Set();       // src PDFRefs that must not be copied
  }

  mapped(ref) {
    return ref instanceof PDFRef ? this.refs.get(ref) : undefined;
  }

  copy(obj) {
    if (obj instanceof PDFRef) return this.copyRef(obj);
    if (obj instanceof PDFStream) return this.copyStream(obj);
    if (obj instanceof PDFDict) return this.copyDict(obj);
    if (obj instanceof PDFArray) return this.copyArray(obj);
    return obj.clone();
  }

  copyRef(ref) {
    const known = this.refs.get(ref);
    if (known) return known;
    if (this.cut.has(ref)) return PDFNull;
    const obj = this.srcCtx.lookup(ref);
    if (obj === undefined) return PDFNull;
    const dict = obj instanceof PDFStream ? obj.dict : obj;
    if (dict instanceof PDFDict && CUT_TYPES.has(nameOf(dict.get(N('Type'))))) return PDFNull;
    const newRef = this.destCtx.nextRef();
    this.refs.set(ref, newRef);
    this.destCtx.assign(newRef, this.copy(obj));
    return newRef;
  }

  copyDict(dict, skip) {
    if (this.objs.has(dict)) return this.objs.get(dict);
    const out = PDFDict.withContext(this.destCtx);
    this.objs.set(dict, out);
    for (const [k, v] of dict.entries()) {
      if (skip && skip.has(k.decodeText())) continue;
      out.set(k, this.copy(v));
    }
    return out;
  }

  copyArray(arr) {
    if (this.objs.has(arr)) return this.objs.get(arr);
    const out = PDFArray.withContext(this.destCtx);
    this.objs.set(arr, out);
    for (let i = 0; i < arr.size(); i++) out.push(this.copy(arr.get(i)));
    return out;
  }

  copyStream(stream) {
    if (this.objs.has(stream)) return this.objs.get(stream);
    const out = stream.clone(this.destCtx);
    this.objs.set(stream, out);
    for (const [k, v] of stream.dict.entries()) out.dict.set(k, this.copy(v));
    return out;
  }
}

// ---------------------------------------------------------------------------
// Transplant: one source document -> one destination document
// ---------------------------------------------------------------------------

class Transplant {
  /**
   * @param {PDFDocument} src
   * @param {PDFDocument} dest
   * @param {number[]} indices - unique 0-based source page indices, in output order
   */
  constructor(src, dest, indices) {
    const count = src.getPageCount();
    const seen = new Set();
    for (const i of indices) {
      if (!Number.isInteger(i) || i < 0 || i >= count) throw new Error(`Page index ${i} out of range [0, ${count - 1}]`);
      if (seen.has(i)) throw new Error(`Page ${i + 1} selected twice`);
      seen.add(i);
    }
    this.src = src;
    this.dest = dest;
    this.indices = indices;
    this.copier = new Copier(src, dest);
    this.srcPages = src.getPages();
    this.newPages = [];
    this.newWidgets = [];   // dest refs of copied widget annotations

    // Pre-map the chosen pages; cut annotations that stay on pages left behind.
    const srcCtx = src.context;
    for (const i of indices) this.copier.refs.set(this.srcPages[i].ref, dest.context.nextRef());
    this.srcPages.forEach((page, i) => {
      if (seen.has(i)) return;
      const annots = lookupArray(srcCtx, page.node.get(N('Annots')));
      if (annots) for (let j = 0; j < annots.size(); j++) {
        const a = annots.get(j);
        if (a instanceof PDFRef) this.copier.cut.add(a);
      }
    });
  }

  /** Copy the chosen pages; returns PDFPage objects not yet in the page tree. */
  copyPages() {
    const { copier, dest } = this;
    for (const i of this.indices) {
      const srcPage = this.srcPages[i];
      const leaf = srcPage.node;
      const newRef = copier.refs.get(srcPage.ref);
      const out = PDFPageLeaf.withContextAndParent(dest.context, PDFNull);
      out.delete(N('Parent'));
      for (const key of PDFPageLeaf.InheritableEntries) {
        const v = leaf.getInheritableAttribute(N(key));
        if (v !== undefined && !leaf.has(N(key))) out.set(N(key), copier.copy(v));
      }
      for (const [k, v] of leaf.entries()) {
        const key = k.decodeText();
        // Parent is set on insertion; B (article beads) would drag in threads
        // spanning other pages; Annots are handled one by one below.
        if (key === 'Parent' || key === 'B' || key === 'Annots' || key === 'Type') continue;
        out.set(k, copier.copy(v));
      }
      out.set(N('Type'), N('Page'));
      const annots = this.copyAnnots(leaf, newRef);
      if (annots.size() > 0) out.set(N('Annots'), annots);
      dest.context.assign(newRef, out);
      const page = PDFPage.of(out, newRef, dest);
      this.newPages.push(page);
    }
    return this.newPages;
  }

  copyAnnots(leaf, newPageRef) {
    const { src, copier } = this;
    const srcCtx = src.context;
    const result = PDFArray.withContext(this.dest.context);
    const annots = lookupArray(srcCtx, leaf.get(N('Annots')));
    if (!annots) return result;

    for (let j = 0; j < annots.size(); j++) {
      const raw = annots.get(j);
      const annot = lookupDict(srcCtx, raw);
      if (!annot) continue;
      const subtype = nameOf(annot.get(N('Subtype')));
      const target = internalTarget(src, annot);
      let newDest;
      if (target.kind) {
        const pageRef = target.explicit?.get(0);
        const ok = pageRef instanceof PDFRef ? copier.mapped(pageRef) : target.explicit && pageRef instanceof PDFNumber;
        if (ok) newDest = copier.copy(target.explicit);
        else if (subtype === 'Link') {
          // A link into a page that was left behind would jump nowhere.
          if (raw instanceof PDFRef) copier.cut.add(raw);
          continue;
        }
      }

      const copied = copier.copy(raw);
      const out = lookupDict(this.dest.context, copied);
      if (!out) continue;
      out.set(N('P'), newPageRef);
      if (target.kind === 'Dest') {
        if (newDest) out.set(N('Dest'), newDest); else out.delete(N('Dest'));
      } else if (target.kind === 'A') {
        const action = lookupDict(this.dest.context, out.get(N('A')));
        if (newDest && action) action.set(N('D'), newDest); else out.delete(N('A'));
      }
      for (const key of ['Popup', 'IRT', 'Parent']) {
        if (out.get(N(key)) === PDFNull) out.delete(N(key));
      }
      if (subtype === 'Widget' && copied instanceof PDFRef) this.newWidgets.push(copied);
      result.push(copied);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Forms
  // -------------------------------------------------------------------------

  /**
   * Prune copied field trees down to the widgets that came along and register
   * their roots in dest's AcroForm. `takenNames` holds root field names
   * already present in the destination.
   */
  mergeForm(takenNames) {
    if (this.newWidgets.length === 0) return;
    const { src, dest, copier } = this;
    const dctx = dest.context;

    const roots = [];
    const rootSet = new Set();
    for (const w of this.newWidgets) {
      let ref = w;
      let node = dctx.lookup(ref);
      for (let depth = 0; depth < 64; depth++) {
        const parent = node.get(N('Parent'));
        if (!(parent instanceof PDFRef)) break;
        ref = parent;
        node = dctx.lookup(ref);
      }
      if (!rootSet.has(ref)) { rootSet.add(ref); roots.push(ref); }
    }

    const keptRoots = roots.filter(r => !pruneField(dctx, r));
    if (keptRoots.length === 0) return;

    const form = ensureAcroForm(dest);
    const fields = form.lookup(N('Fields'), PDFArray);
    const existing = new Set(fields.asArray());
    for (const r of keptRoots) {
      if (existing.has(r)) continue;
      const node = dctx.lookup(r);
      const name = textOf(node.get(N('T')));
      if (name !== undefined) {
        const unique = uniqueName(name, takenNames);
        if (unique !== name) node.set(N('T'), PDFHexString.fromText(unique));
        takenNames.add(unique);
      }
      fields.push(r);
      existing.add(r);
    }

    // Form-wide defaults: resources, default appearance, flags.
    const srcForm = lookupDict(src.context, src.catalog.get(N('AcroForm')));
    if (!srcForm) return;
    const srcDR = lookupDict(src.context, srcForm.get(N('DR')));
    if (srcDR) {
      let destDR = lookupDict(dctx, form.get(N('DR')));
      if (!destDR) { destDR = dctx.obj({}); form.set(N('DR'), destDR); }
      for (const [cat, catVal] of srcDR.entries()) {
        const srcCat = lookupDict(src.context, catVal);
        if (!srcCat) continue;
        let destCat = lookupDict(dctx, destDR.get(cat));
        if (!destCat) { destCat = dctx.obj({}); destDR.set(cat, destCat); }
        for (const [k, v] of srcCat.entries()) if (!destCat.has(k)) destCat.set(k, copier.copy(v));
      }
    }
    for (const key of ['DA', 'Q']) {
      const v = srcForm.get(N(key));
      if (v !== undefined && !form.has(N(key))) form.set(N(key), copier.copy(v));
    }
    if (src.context.lookup(srcForm.get(N('NeedAppearances')))?.asBoolean?.()) {
      form.set(N('NeedAppearances'), dctx.obj(true));
    }
    const srcSig = src.context.lookup(srcForm.get(N('SigFlags')));
    if (srcSig instanceof PDFNumber) {
      const cur = dctx.lookup(form.get(N('SigFlags')));
      form.set(N('SigFlags'), PDFNumber.of((cur instanceof PDFNumber ? cur.asNumber() : 0) | srcSig.asNumber()));
    }
    const srcCO = lookupArray(src.context, srcForm.get(N('CO')));
    if (srcCO) {
      let co = lookupArray(dctx, form.get(N('CO')));
      for (let i = 0; i < srcCO.size(); i++) {
        const m = copier.mapped(srcCO.get(i));
        if (!m) continue;
        if (!co) { co = dctx.obj([]); form.set(N('CO'), co); }
        co.push(m);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Layers (optional content)
  // -------------------------------------------------------------------------

  mergeLayers() {
    const { src, dest, copier } = this;
    const sctx = src.context;
    const dctx = dest.context;
    const srcOC = lookupDict(sctx, src.catalog.get(N('OCProperties')));
    const srcOCGs = srcOC && lookupArray(sctx, srcOC.get(N('OCGs')));
    if (!srcOCGs) return;
    const used = srcOCGs.asArray().filter(r => copier.mapped(r));
    if (used.length === 0) return;

    let destOC = lookupDict(dctx, dest.catalog.get(N('OCProperties')));
    if (!destOC) {
      destOC = dctx.obj({ OCGs: [], D: { Order: [] } });
      dest.catalog.set(N('OCProperties'), destOC);
    }
    let ocgs = lookupArray(dctx, destOC.get(N('OCGs')));
    if (!ocgs) { ocgs = dctx.obj([]); destOC.set(N('OCGs'), ocgs); }
    let D = lookupDict(dctx, destOC.get(N('D')));
    if (!D) { D = dctx.obj({}); destOC.set(N('D'), D); }
    const destBaseOff = nameOf(D.get(N('BaseState'))) === 'OFF';
    const list = (key) => {
      let a = lookupArray(dctx, D.get(N(key)));
      if (!a) { a = dctx.obj([]); D.set(N(key), a); }
      return a;
    };

    const srcD = lookupDict(sctx, srcOC.get(N('D')));
    const srcBaseOff = srcD && nameOf(srcD.get(N('BaseState'))) === 'OFF';
    const refsIn = (key) => new Set(srcD ? (lookupArray(sctx, srcD.get(N(key)))?.asArray() || []) : []);
    const srcOn = refsIn('ON');
    const srcOff = refsIn('OFF');
    const present = new Set(ocgs.asArray());
    for (const r of used) {
      const m = copier.mapped(r);
      if (!present.has(m)) { ocgs.push(m); present.add(m); }
      const on = srcBaseOff ? srcOn.has(r) : !srcOff.has(r);
      if (on && destBaseOff) list('ON').push(m);
      if (!on && !destBaseOff) list('OFF').push(m);
    }

    if (srcD) {
      const mapOrder = (arr) => {
        const out = dctx.obj([]);
        for (let i = 0; i < arr.size(); i++) {
          const item = arr.get(i);
          const sub = item instanceof PDFArray ? item : (item instanceof PDFRef ? undefined : lookupArray(sctx, item));
          if (sub) {
            const m = mapOrder(sub);
            const hasLayer = m.asArray().some(x => x instanceof PDFRef || x instanceof PDFArray);
            if (hasLayer) out.push(m);
          } else if (item instanceof PDFRef) {
            const m = copier.mapped(item);
            if (m) out.push(m);
          } else {
            out.push(item.clone());   // group label
          }
        }
        return out;
      };
      const srcOrder = lookupArray(sctx, srcD.get(N('Order')));
      if (srcOrder) {
        const order = list('Order');
        for (const item of mapOrder(srcOrder).asArray()) order.push(item);
      }
      const srcRB = lookupArray(sctx, srcD.get(N('RBGroups')));
      if (srcRB) for (let i = 0; i < srcRB.size(); i++) {
        const g = lookupArray(sctx, srcRB.get(i));
        const m = g ? g.asArray().map(r => copier.mapped(r)).filter(Boolean) : [];
        if (m.length > 1) list('RBGroups').push(dctx.obj(m));
      }
      const srcLocked = lookupArray(sctx, srcD.get(N('Locked')));
      if (srcLocked) for (const r of srcLocked.asArray()) {
        const m = copier.mapped(r);
        if (m) list('Locked').push(m);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------

  collectAttachments() {
    const { src, copier } = this;
    const names = lookupDict(src.context, src.catalog.get(N('Names')));
    if (!names) return [];
    return flattenNameTree(src.context, names.get(N('EmbeddedFiles')))
      .map(([k, v]) => [k, copier.copy(v)]);
  }

  // -------------------------------------------------------------------------
  // Bookmarks
  // -------------------------------------------------------------------------

  /** Source outline as a plain tree, filtered to items that still lead somewhere. */
  collectOutline() {
    const { src, copier } = this;
    const ctx = src.context;
    const root = lookupDict(ctx, src.catalog.get(N('Outlines')));
    if (!root) return [];

    const visited = new Set();
    const walk = (first, depth) => {
      const items = [];
      let ref = first;
      while (ref instanceof PDFRef && !visited.has(ref) && depth < 64) {
        visited.add(ref);
        const node = lookupDict(ctx, ref);
        if (!node) break;
        const children = walk(node.get(N('First')), depth + 1);
        const target = internalTarget(src, node);
        let dest;
        let action;
        if (target.kind) {
          const pageRef = target.explicit?.get(0);
          if (pageRef instanceof PDFRef && copier.mapped(pageRef)) dest = copier.copy(target.explicit);
        } else if (node.has(N('A'))) {
          action = copier.copy(node.get(N('A')));   // URI, launch, ... stay as they are
        }
        if (dest || action || children.length) {
          const count = ctx.lookup(node.get(N('Count')));
          items.push({
            title: textOf(ctx.lookup(node.get(N('Title')))) || '',
            color: node.has(N('C')) ? copier.copy(node.get(N('C'))) : undefined,
            flags: node.has(N('F')) ? copier.copy(node.get(N('F'))) : undefined,
            open: !(count instanceof PDFNumber && count.asNumber() < 0),
            dest, action, children,
          });
        }
        ref = node.get(N('Next'));
      }
      return items;
    };
    return walk(root.get(N('First')), 0);
  }
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

function ensureAcroForm(doc) {
  const ctx = doc.context;
  let form = lookupDict(ctx, doc.catalog.get(N('AcroForm')));
  if (!form) {
    form = ctx.obj({ Fields: [] });
    doc.catalog.set(N('AcroForm'), ctx.register(form));
  }
  if (!lookupArray(ctx, form.get(N('Fields')))) form.set(N('Fields'), ctx.obj([]));
  // Field arrays reached through a ref must be resolved for push() to stick.
  const fields = form.get(N('Fields'));
  if (fields instanceof PDFRef) form.set(N('Fields'), ctx.lookup(fields));
  form.delete(N('XFA'));   // an XFA packet no longer matches the assembled fields
  return form;
}

/**
 * Drop null and dead kids from a field subtree. Returns true when the field
 * itself is now empty and should be removed.
 */
function pruneField(ctx, ref, depth = 0) {
  const node = lookupDict(ctx, ref);
  if (!node || depth > 64) return true;
  if (nameOf(node.get(N('Subtype'))) === 'Widget' && !node.has(N('Kids'))) return false;
  const kids = lookupArray(ctx, node.get(N('Kids')));
  if (!kids) return false;   // a terminal field merged with its widget elsewhere
  for (let i = kids.size() - 1; i >= 0; i--) {
    const k = kids.get(i);
    if (k === PDFNull || !(k instanceof PDFRef) || pruneField(ctx, k, depth + 1)) kids.remove(i);
  }
  return kids.size() === 0;
}

function rootFieldNames(doc) {
  const ctx = doc.context;
  const form = lookupDict(ctx, doc.catalog.get(N('AcroForm')));
  const fields = form && lookupArray(ctx, form.get(N('Fields')));
  const names = new Set();
  if (fields) for (const r of fields.asArray()) {
    const t = textOf(lookupDict(ctx, r)?.get(N('T')));
    if (t !== undefined) names.add(t);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Outline writing
// ---------------------------------------------------------------------------

function visibleCount(items) {
  let n = 0;
  for (const it of items) n += 1 + (it.open ? visibleCount(it.children) : 0);
  return n;
}

function writeOutlineItems(ctx, parentRef, items) {
  const refs = items.map(() => ctx.nextRef());
  items.forEach((it, i) => {
    const dict = ctx.obj({ Title: PDFHexString.fromText(it.title), Parent: parentRef });
    if (i > 0) dict.set(N('Prev'), refs[i - 1]);
    if (i < items.length - 1) dict.set(N('Next'), refs[i + 1]);
    if (it.dest) dict.set(N('Dest'), it.dest);
    if (it.action) dict.set(N('A'), it.action);
    if (it.color) dict.set(N('C'), it.color);
    if (it.flags) dict.set(N('F'), it.flags);
    if (it.children.length) {
      const kids = writeOutlineItems(ctx, refs[i], it.children);
      dict.set(N('First'), kids[0]);
      dict.set(N('Last'), kids[kids.length - 1]);
      const c = visibleCount(it.children);
      dict.set(N('Count'), PDFNumber.of(it.open ? c : -c));
    }
    ctx.assign(refs[i], dict);
  });
  return refs;
}

/** Recompute /Count on every node of an outline (after appending items). */
function fixOutlineCounts(ctx, ref, depth = 0) {
  const node = lookupDict(ctx, ref);
  if (!node || depth > 64) return 0;
  let visible = 0;
  let child = node.get(N('First'));
  const seen = new Set();
  while (child instanceof PDFRef && !seen.has(child)) {
    seen.add(child);
    const c = lookupDict(ctx, child);
    if (!c) break;
    const inner = fixOutlineCounts(ctx, child, depth + 1);
    const cnt = ctx.lookup(c.get(N('Count')));
    const open = !(cnt instanceof PDFNumber && cnt.asNumber() < 0);
    if (c.has(N('First'))) c.set(N('Count'), PDFNumber.of(open ? inner : -inner));
    visible += 1 + (open ? inner : 0);
    child = c.get(N('Next'));
  }
  return visible;
}

/** Append outline items to the end of a document's top-level bookmarks. */
function appendOutline(doc, items) {
  if (items.length === 0) return;
  const ctx = doc.context;
  let rootRef = doc.catalog.get(N('Outlines'));
  let root = lookupDict(ctx, rootRef);
  if (!root || !(rootRef instanceof PDFRef)) {
    root = ctx.obj({ Type: 'Outlines' });
    rootRef = ctx.register(root);
    doc.catalog.set(N('Outlines'), rootRef);
  }
  const refs = writeOutlineItems(ctx, rootRef, items);
  const lastRef = root.get(N('Last'));
  const last = lookupDict(ctx, lastRef);
  if (last && lastRef instanceof PDFRef) {
    last.set(N('Next'), refs[0]);
    ctx.lookup(refs[0]).set(N('Prev'), lastRef);
  } else {
    root.set(N('First'), refs[0]);
  }
  root.set(N('Last'), refs[refs.length - 1]);
  root.set(N('Count'), PDFNumber.of(fixOutlineCounts(ctx, rootRef)));
  if (!doc.catalog.has(N('PageMode'))) doc.catalog.set(N('PageMode'), N('UseOutlines'));
}

// ---------------------------------------------------------------------------
// Attachments helper
// ---------------------------------------------------------------------------

function appendAttachments(doc, pairs) {
  if (pairs.length === 0) return;
  const ctx = doc.context;
  let names = lookupDict(ctx, doc.catalog.get(N('Names')));
  if (!names) { names = ctx.obj({}); doc.catalog.set(N('Names'), names); }
  const existing = flattenNameTree(ctx, names.get(N('EmbeddedFiles')));
  const taken = new Set(existing.map(([k]) => k));
  const all = [...existing];
  for (const [k, v] of pairs) {
    const name = uniqueName(k, taken);
    taken.add(name);
    all.push([name, v]);
  }
  names.set(N('EmbeddedFiles'), writeNameTree(ctx, all));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function runTransplant(src, dest, indices, takenNames) {
  const t = new Transplant(src, dest, indices);
  const pages = t.copyPages();
  t.mergeForm(takenNames);
  t.mergeLayers();
  return { t, pages };
}

/**
 * Build a new document from pages of one or more documents.
 *
 * @param {Array<{doc: PDFDocument, pages?: number[], title?: string}>} parts
 * @param {object} [opts]
 * @param {boolean} [opts.fileBookmarks] - nest each part's bookmarks under a
 *   bookmark named after `title` that opens the part's first page
 * @returns {Promise<PDFDocument>}
 */
export async function assemble(parts, opts = {}) {
  const out = await PDFDocument.create();
  const takenNames = new Set();
  const outline = [];
  const attachments = [];

  for (const part of parts) {
    const indices = part.pages || part.doc.getPageIndices();
    if (indices.length === 0) continue;
    const { t, pages } = runTransplant(part.doc, out, indices, takenNames);
    for (const p of pages) out.addPage(p);
    const items = t.collectOutline();
    if (opts.fileBookmarks) {
      outline.push({
        title: part.title || `Document ${outline.length + 1}`,
        dest: out.context.obj([pages[0].ref, FIT()]),
        open: false,
        children: items,
      });
    } else {
      outline.push(...items);
    }
    attachments.push(...t.collectAttachments());
  }

  appendOutline(out, outline);
  appendAttachments(out, attachments);

  // A document carved from a single source keeps its description.
  const sources = new Set(parts.filter(p => (p.pages || [0]).length).map(p => p.doc));
  if (sources.size === 1) {
    const [src] = sources;
    const get = (fn) => { try { return fn(); } catch { return undefined; } };
    const title = get(() => src.getTitle());
    const author = get(() => src.getAuthor());
    const subject = get(() => src.getSubject());
    const keywords = get(() => src.getKeywords());
    if (title) out.setTitle(title);
    if (author) out.setAuthor(author);
    if (subject) out.setSubject(subject);
    if (keywords) out.setKeywords([keywords]);
  }
  return out;
}

/** Extract pages (0-based, in the given order) into a new document. */
export function extractPages(doc, indices) {
  return assemble([{ doc, pages: indices }]);
}

/**
 * Split a document into several.
 * @param {PDFDocument} doc
 * @param {number[][]} groups - 0-based page indices for each output
 * @returns {Promise<PDFDocument[]>}
 */
export async function splitDocument(doc, groups) {
  const out = [];
  for (const g of groups) out.push(await extractPages(doc, g));
  return out;
}

/**
 * Page groups for splitting.
 * @param {number} count - page count
 * @param {{every?: number, before?: number[]}} how - split every n pages, or
 *   start a new part before each listed 0-based page
 */
export function splitGroups(count, { every, before } = {}) {
  const starts = new Set([0]);
  if (every && every > 0) for (let i = every; i < count; i += every) starts.add(i);
  if (before) for (const i of before) if (i > 0 && i < count) starts.add(i);
  const sorted = [...starts].sort((a, b) => a - b);
  return sorted.map((s, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1] : count;
    return Array.from({ length: end - s }, (_, k) => s + k);
  });
}

/**
 * Insert pages of another document into `doc` (in place) before `at`.
 * Their bookmarks are appended under one bookmark named `title` when given.
 */
export function importPages(doc, src, indices, at, { title } = {}) {
  const count = doc.getPageCount();
  if (at < 0 || at > count) throw new Error(`Target index ${at} out of range [0, ${count}]`);
  if (indices.length === 0) return doc;
  const { t, pages } = runTransplant(src, doc, indices, rootFieldNames(doc));
  pages.forEach((p, i) => doc.insertPage(at + i, p));
  const items = t.collectOutline();
  if (title) {
    appendOutline(doc, [{ title, dest: doc.context.obj([pages[0].ref, FIT()]), open: false, children: items }]);
  } else {
    appendOutline(doc, items);
  }
  appendAttachments(doc, t.collectAttachments());
  return doc;
}

/**
 * Reorder pages in place. newOrder[i] is the current index of the page that
 * should end up at position i. Page objects are kept, so links, bookmarks and
 * fields still point at the right pages.
 */
export function reorderPages(doc, newOrder) {
  const pages = doc.getPages();
  if (newOrder.length !== pages.length || new Set(newOrder).size !== pages.length ||
      newOrder.some(i => !Number.isInteger(i) || i < 0 || i >= pages.length)) {
    throw new Error('newOrder must be a permutation of the page indices');
  }
  for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
  newOrder.forEach((src, i) => doc.insertPage(i, pages[src]));
  return doc;
}

/**
 * Delete pages in place, then clean up whatever pointed at them: links and
 * widget actions into deleted pages, bookmarks that now lead nowhere, form
 * fields whose widgets were all on deleted pages, and named destinations.
 */
export function removePages(doc, indices) {
  const count = doc.getPageCount();
  const unique = [...new Set(indices)];
  for (const i of unique) {
    if (!Number.isInteger(i) || i < 0 || i >= count) throw new Error(`Page index ${i} out of range [0, ${count - 1}]`);
  }
  if (unique.length >= count) throw new Error('Cannot delete every page');
  const pages = doc.getPages();
  const removedWidgets = new Set();
  for (const i of unique) {
    const annots = lookupArray(doc.context, pages[i].node.get(N('Annots')));
    if (annots) for (const a of annots.asArray()) if (a instanceof PDFRef) removedWidgets.add(a);
  }
  for (const i of unique.sort((a, b) => b - a)) doc.removePage(i);
  doc.pageCache?.invalidate?.();
  pruneDangling(doc, removedWidgets);
  return doc;
}

/** Remove references to pages that are no longer in the page tree. */
export function pruneDangling(doc, removedAnnots = new Set()) {
  const ctx = doc.context;
  const pages = livePages(doc);
  const live = new Set(pages.map(p => p.ref));
  const leadsSomewhere = (explicit) => {
    const p = explicit?.get(0);
    return p instanceof PDFNumber || (p instanceof PDFRef && live.has(p));
  };

  // Links and GoTo actions on the remaining pages.
  for (const page of pages) {
    const annots = lookupArray(ctx, page.node.get(N('Annots')));
    if (!annots) continue;
    for (let j = annots.size() - 1; j >= 0; j--) {
      const annot = lookupDict(ctx, annots.get(j));
      if (!annot) continue;
      const target = internalTarget(doc, annot);
      if (!target.kind || leadsSomewhere(target.explicit)) continue;
      if (nameOf(annot.get(N('Subtype'))) === 'Link') annots.remove(j);
      else annot.delete(N(target.kind));
    }
  }

  // Form fields: drop widgets that went with the deleted pages.
  const form = lookupDict(ctx, doc.catalog.get(N('AcroForm')));
  const fields = form && lookupArray(ctx, form.get(N('Fields')));
  if (fields && removedAnnots.size) {
    const prune = (ref, depth) => {
      if (removedAnnots.has(ref)) return true;
      const node = lookupDict(ctx, ref);
      if (!node || depth > 64) return true;
      const kids = lookupArray(ctx, node.get(N('Kids')));
      if (!kids) return false;
      for (let i = kids.size() - 1; i >= 0; i--) if (prune(kids.get(i), depth + 1)) kids.remove(i);
      return kids.size() === 0;
    };
    for (let i = fields.size() - 1; i >= 0; i--) if (prune(fields.get(i), 0)) fields.remove(i);
  }

  // Bookmarks: strip dead destinations, drop dead leaves.
  const rootRef = doc.catalog.get(N('Outlines'));
  const root = lookupDict(ctx, rootRef);
  if (root) {
    const prune = (parent, depth) => {
      let ref = parent.get(N('First'));
      const kept = [];
      const seen = new Set();
      while (ref instanceof PDFRef && !seen.has(ref) && depth < 64) {
        seen.add(ref);
        const node = lookupDict(ctx, ref);
        if (!node) break;
        const next = node.get(N('Next'));
        prune(node, depth + 1);
        const target = internalTarget(doc, node);
        const dead = target.kind && !leadsSomewhere(target.explicit);
        if (dead) node.delete(N(target.kind));
        if (!dead || node.has(N('First'))) kept.push(ref);
        ref = next;
      }
      kept.forEach((r, i) => {
        const node = ctx.lookup(r);
        if (i > 0) node.set(N('Prev'), kept[i - 1]); else node.delete(N('Prev'));
        if (i < kept.length - 1) node.set(N('Next'), kept[i + 1]); else node.delete(N('Next'));
      });
      if (kept.length) {
        parent.set(N('First'), kept[0]);
        parent.set(N('Last'), kept[kept.length - 1]);
      } else {
        parent.delete(N('First')); parent.delete(N('Last')); parent.delete(N('Count'));
      }
    };
    prune(root, 0);
    if (root.has(N('First'))) root.set(N('Count'), PDFNumber.of(fixOutlineCounts(ctx, rootRef)));
    else doc.catalog.delete(N('Outlines'));
  }

  // Old-style named destination dictionary.
  const dests = lookupDict(ctx, doc.catalog.get(N('Dests')));
  if (dests) for (const [k, v] of dests.entries()) {
    const d = ctx.lookup(v);
    const arr = d instanceof PDFDict ? lookupArray(ctx, d.get(N('D'))) : lookupArray(ctx, d);
    if (arr && !leadsSomewhere(arr)) dests.delete(k);
  }
  namedDestCache.delete(doc);
  return doc;
}

export default { assemble, extractPages, splitDocument, splitGroups, importPages, reorderPages, removePages, pruneDangling };
