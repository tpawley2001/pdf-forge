/**
 * signing.js — certificate-based digital signatures (main process).
 *
 *   readDigitalId()     unlock a .p12/.pfx and describe its certificate
 *   createDigitalId()   self-signed Digital ID (RSA-2048, SHA-256) as .p12
 *   signPdf()           PAdES-style signature via zgapdfsigner (MIT), with
 *                       optional visible appearance, RFC 3161 timestamp, LTV
 *   verifySignatures()  check every signature in a PDF: integrity, signer,
 *                       time, timestamp, coverage, and chain-to-Mozilla-root
 *
 * Runs in the main process so private keys never reach the renderer and the
 * TSA/OCSP network calls aren't subject to the page CSP. ASN.1 is parsed with
 * node-forge (used under its BSD-3 licence); signatures are checked with
 * Node's crypto so RSA, RSA-PSS and ECDSA all verify.
 */

const crypto = require('crypto');
const tls = require('tls');
const forge = require('node-forge');

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  timeStampToken: '1.2.840.113549.1.9.16.2.14',
  rsaPss: '1.2.840.113549.1.1.10',
};

const HASHES = {
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
};

const toBinary = bytes => Buffer.from(bytes).toString('binary');
const fromBinary = str => Buffer.from(str, 'binary');

// ─── Digital IDs ──────────────────────────────────────────────────────────

function certSummary(x509) {
  const field = (dn, key) => (dn.match(new RegExp(`(?:^|\\n)${key}=([^\\n]+)`)) || [])[1] || '';
  return {
    name: field(x509.subject, 'CN') || field(x509.subject, 'O') || x509.subject,
    email: field(x509.subject, 'emailAddress') || (x509.subjectAltName || '').replace(/^email:/, ''),
    organization: field(x509.subject, 'O'),
    issuer: field(x509.issuer, 'CN') || field(x509.issuer, 'O') || x509.issuer,
    validFrom: new Date(x509.validFrom).toISOString(),
    validTo: new Date(x509.validTo).toISOString(),
    serialNumber: x509.serialNumber,
    selfSigned: x509.subject === x509.issuer,
    fingerprint256: x509.fingerprint256,
  };
}

/** Unlock a PKCS#12 file; throws a friendly error on a bad password. */
function readDigitalId(p12Bytes, password) {
  let p12;
  try {
    const asn = forge.asn1.fromDer(toBinary(p12Bytes));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn, false, password || '');
  } catch (err) {
    if (/mac|password|decrypt/i.test(String(err.message))) throw new Error('Incorrect password for this Digital ID.');
    throw new Error(`Not a valid .p12/.pfx Digital ID (${err.message})`);
  }
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  if (!certBags.length) throw new Error('This Digital ID contains no certificate.');
  if (!keyBags.length || !keyBags[0].key) {
    // forge only decodes RSA keys; anything else shows up as a key-less bag
    throw new Error('This Digital ID has no usable RSA private key (only RSA Digital IDs can sign).');
  }
  // The signing cert is the one whose public key matches the private key
  const key = keyBags[0].key;
  const match = certBags.find(b => b.cert && b.cert.publicKey && b.cert.publicKey.n && b.cert.publicKey.n.equals(key.n))
    || certBags.find(b => b.cert);
  const der = fromBinary(forge.asn1.toDer(forge.pki.certificateToAsn1(match.cert)).getBytes());
  const x509 = new crypto.X509Certificate(der);
  const summary = certSummary(x509);
  const now = Date.now();
  summary.expired = now > Date.parse(summary.validTo);
  summary.notYetValid = now < Date.parse(summary.validFrom);
  return summary;
}

/** Create a self-signed Digital ID (like Acrobat's "Create a new Digital ID"). */
function createDigitalId({ name, email = '', organization = '', password, years = 5 }) {
  if (!name) throw new Error('A name is required.');
  if (!password || password.length < 6) throw new Error('Use a password of at least 6 characters.');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const fKey = forge.pki.privateKeyFromPem(keyPem);
  const fPub = forge.pki.setRsaPublicKey(fKey.n, fKey.e);

  const cert = forge.pki.createCertificate();
  cert.publicKey = fPub;
  cert.serialNumber = `01${crypto.randomBytes(15).toString('hex')}`;
  cert.validity.notBefore = new Date(Date.now() - 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + years * 365.25 * 24 * 3600 * 1000);
  const attrs = [{ name: 'commonName', value: name }];
  if (organization) attrs.push({ name: 'organizationName', value: organization });
  if (email) attrs.push({ name: 'emailAddress', value: email });
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, dataEncipherment: true },
    { name: 'extKeyUsage', emailProtection: true },
    ...(email ? [{ name: 'subjectAltName', altNames: [{ type: 1, value: email }] }] : []),
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(fKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(fKey, [cert], password, {
    algorithm: '3des', // widest compatibility (Acrobat, Windows, older OpenSSL)
    friendlyName: name,
    generateLocalKeyId: true,
  });
  return fromBinary(forge.asn1.toDer(p12Asn1).getBytes());
}

// ─── Signing ──────────────────────────────────────────────────────────────

const PERMISSION_MAP = {
  printing: ['print', 'print-high'],
  modifying: ['modify'],
  copying: ['copy-extract', 'extract'],
  annotating: ['annot-forms'],
  fillingForms: ['fill-forms'],
  documentAssembly: ['assemble'],
};

/**
 * @param {object} o
 *   pdfBytes, p12Bytes, password,
 *   reason?, location?, contact?,
 *   appearance?: { pageIndex, x, y, width, height (top-left page units), text?, imagePng? (bytes) },
 *   tsaUrl?, ltv?: boolean,
 *   protection?: { userPassword, ownerPassword, permissions } (same shape as Protect.js)
 */
async function signPdf(o) {
  const z = require('zgapdfsigner');
  const signopt = {
    p12cert: new Uint8Array(o.p12Bytes),
    pwd: o.password || '',
    reason: o.reason || undefined,
    location: o.location || undefined,
    contact: o.contact || undefined,
    signdate: o.tsaUrl ? { url: o.tsaUrl } : undefined,
    ltv: o.ltv ? 1 : undefined,
  };
  const ap = o.appearance;
  if (ap && ap.width > 4 && ap.height > 4) {
    signopt.drawinf = {
      pageidx: ap.pageIndex || 0,
      area: { x: ap.x, y: ap.y, w: ap.width, h: ap.height },
    };
    if (ap.imagePng) signopt.drawinf.imgInfo = { imgData: new Uint8Array(ap.imagePng), imgType: 'png' };
    if (ap.text) {
      // Fit every line inside the box: height by line count, width by the
      // longest line (Helvetica averages ~0.52 em per character)
      const lines = String(ap.text).split('\n');
      const longest = Math.max(...lines.map(l => l.length), 1);
      const byHeight = (ap.height - 6) / (lines.length * 1.2);
      const byWidth = (ap.width - 8) / (longest * 0.52);
      const size = Math.max(4, Math.min(14, byHeight, byWidth));
      signopt.drawinf.textInfo = { text: ap.text, size, color: '000000', lineHeight: size * 1.2, xOffset: 4, yOffset: 3, wMax: ap.width - 8 };
    }
  }

  let cypopt;
  if (o.protection && (o.protection.userPassword || o.protection.ownerPassword)) {
    const p = o.protection.permissions || {};
    const blocked = Object.entries(PERMISSION_MAP).filter(([k]) => p[k] === false).flatMap(([, v]) => v);
    cypopt = {
      mode: z.Crypto.Mode.AES_256,
      userpwd: o.protection.userPassword || '',
      ownerpwd: o.protection.ownerPassword || o.protection.userPassword,
      permissions: blocked,
    };
  }

  const signer = new z.PdfSigner(signopt);
  const out = await signer.sign(new Uint8Array(o.pdfBytes), cypopt);
  return Buffer.from(out);
}

// ─── Verification ─────────────────────────────────────────────────────────

const A = forge.asn1;
const isCtx = (node, n) => node && node.tagClass === A.Class.CONTEXT_SPECIFIC && node.type === n;
const oidOf = node => A.derToOid(node.value);
const derOf = node => fromBinary(A.toDer(node).getBytes());

function parseTime(node) {
  if (!node) return null;
  try {
    if (node.type === A.Type.UTCTIME) return A.utcTimeToDate(node.value);
    if (node.type === A.Type.GENERALIZEDTIME) return A.generalizedTimeToDate(node.value);
  } catch (_) { /* fall through */ }
  return null;
}

function attributesOf(setNode) {
  const out = new Map();
  for (const attr of (setNode && setNode.value) || []) {
    out.set(oidOf(attr.value[0]), attr.value[1].value);
  }
  return out;
}

/** Walk a CMS ContentInfo → { signedData parts }. */
function parseCms(der) {
  const ci = A.fromDer(der.toString('binary'), { strict: false, parseAllBytes: false });
  if (oidOf(ci.value[0]) !== OID.signedData) throw new Error('Not a CMS SignedData signature');
  const sd = ci.value[1].value[0];
  const parts = sd.value;
  let i = 1; // skip version
  const digestAlgorithms = parts[i++];
  const encap = parts[i++];
  let certificates = [];
  if (isCtx(parts[i], 0)) certificates = parts[i++].value;
  if (isCtx(parts[i], 1)) i += 1; // crls
  const signerInfos = parts[i].value;
  void digestAlgorithms;
  const eContentNode = encap.value[1] && isCtx(encap.value[1], 0) ? encap.value[1].value[0] : null;
  const eContent = eContentNode ? fromBinary(eContentNode.value instanceof Array
    ? eContentNode.value.map(v => v.value).join('') : eContentNode.value) : null;
  return {
    eContentType: oidOf(encap.value[0]),
    eContent,
    certificates: certificates.map(c => new crypto.X509Certificate(derOf(c))),
    signerInfos,
  };
}

function findSignerCert(certs, sid) {
  // sid: IssuerAndSerialNumber SEQUENCE { issuer Name, serial INTEGER } | [0] SubjectKeyIdentifier
  if (sid.tagClass === A.Class.UNIVERSAL) {
    const serial = Buffer.from(sid.value[1].value, 'binary').toString('hex').replace(/^0+/, '').toUpperCase();
    const hit = certs.find(c => c.serialNumber.replace(/^0+/, '').toUpperCase() === serial);
    if (hit) return hit;
  }
  return certs.find(c => !c.ca) || certs[0];
}

/** Verify one SignerInfo; returns { ok, hash, signingTime, cert, timestamp }. */
function verifySignerInfo(cms, si, contentBytes) {
  const v = si.value;
  let i = 1; // version
  const sid = v[i++];
  const hashName = HASHES[oidOf(v[i++].value[0])];
  if (!hashName) throw new Error('Unsupported digest algorithm');
  let signedAttrsNode = null;
  if (isCtx(v[i], 0)) signedAttrsNode = v[i++];
  const sigAlg = v[i++];
  const signature = fromBinary(v[i++].value);
  const unsigned = isCtx(v[i], 1) ? attributesOf(v[i]) : new Map();

  const cert = findSignerCert(cms.certificates, sid);
  if (!cert) throw new Error('Signer certificate not embedded');

  let toVerify;
  let digestOk = true;
  let signingTime = null;
  if (signedAttrsNode) {
    const attrs = attributesOf(signedAttrsNode);
    const md = attrs.get(OID.messageDigest);
    const expected = md ? fromBinary(md[0].value) : null;
    const actual = crypto.createHash(hashName).update(contentBytes).digest();
    digestOk = !!expected && expected.equals(actual);
    signingTime = parseTime(attrs.get(OID.signingTime)?.[0]);
    // Signature is over the DER of the attributes as a SET (tag 0x31), not [0]
    const asSet = A.create(A.Class.UNIVERSAL, A.Type.SET, true, signedAttrsNode.value);
    toVerify = derOf(asSet);
  } else {
    toVerify = contentBytes;
  }

  const sigOid = oidOf(sigAlg.value[0]);
  const keyOpts = sigOid === OID.rsaPss
    ? { key: cert.publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_AUTO }
    : cert.publicKey;
  let sigOk = false;
  try { sigOk = crypto.verify(hashName, toVerify, keyOpts, signature); } catch (_) { sigOk = false; }

  // RFC 3161 timestamp on the signature value (PAdES-T)
  let timestamp = null;
  const tst = unsigned.get(OID.timeStampToken);
  if (tst) {
    try {
      timestamp = verifyTimestampToken(derOf(tst[0]), signature);
    } catch (err) {
      timestamp = { ok: false, error: err.message };
    }
  }
  return { ok: digestOk && sigOk, digestOk, sigOk, hashName, signingTime, cert, chain: cms.certificates, timestamp };
}

/** TimeStampToken whose messageImprint must equal hash(imprintOf). */
function verifyTimestampToken(der, imprintOf) {
  const cms = parseCms(der);
  if (!cms.eContent) throw new Error('Timestamp has no TSTInfo');
  const tst = A.fromDer(cms.eContent.toString('binary'));
  const imprint = tst.value[2];
  const hashName = HASHES[oidOf(imprint.value[0].value[0])];
  const hashed = fromBinary(imprint.value[1].value);
  const genTime = parseTime(tst.value[4]);
  const imprintOk = !!hashName && crypto.createHash(hashName).update(imprintOf).digest().equals(hashed);
  const inner = verifySignerInfo(cms, cms.signerInfos[0], cms.eContent);
  return {
    ok: imprintOk && inner.ok,
    time: genTime ? genTime.toISOString() : null,
    authority: certSummary(inner.cert).name,
  };
}

/** Does the chain end at a root Mozilla/Node trusts? */
function chainTrusted(cert, certs) {
  const roots = tls.rootCertificates.map(pem => { try { return new crypto.X509Certificate(pem); } catch (_) { return null; } }).filter(Boolean);
  let cur = cert;
  for (let depth = 0; depth < 8 && cur; depth += 1) {
    const root = roots.find(r => cur.checkIssued(r) && cur.verify(r.publicKey));
    if (root) return true;
    const next = certs.find(c => c !== cur && cur.checkIssued(c) && cur.verify(c.publicKey));
    if (!next || next.fingerprint256 === cur.fingerprint256) return false;
    cur = next;
  }
  return false;
}

/** Decode a PDF string object's bytes (literal or hex) */
function pdfStringValue(obj) {
  if (!obj) return '';
  try { return obj.decodeText(); } catch (_) { return String(obj.asString ? obj.asString() : obj); }
}

/**
 * Verify all signatures. Returns [] for unsigned documents.
 * [{ field, signer, email, issuer, signingTime, reason, location, kind,
 *    intact, coversWholeDocument, trusted, selfSigned, timestamp, error? }]
 */
async function verifySignatures(pdfBytes) {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFString } = require('pdf-lib');
  const bytes = Buffer.from(pdfBytes);
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (_) {
    return [];
  }
  const results = [];
  const seen = new Set();
  const sigDicts = [];
  // Every indirect /Sig (or /DocTimeStamp) dictionary that has a /ByteRange
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of('Type'));
    const br = obj.get(PDFName.of('ByteRange'));
    if (!br || !(br instanceof PDFArray)) continue;
    if (type && !['/Sig', '/DocTimeStamp'].includes(type.toString())) continue;
    sigDicts.push(obj);
  }
  // Map sig dicts back to field names
  const fieldNames = new Map();
  try {
    for (const field of doc.getForm().getFields()) {
      const v = field.acroField.dict.lookup(PDFName.of('V'));
      if (v instanceof PDFDict) fieldNames.set(v, field.getName());
    }
  } catch (_) { /* no AcroForm */ }

  for (const sig of sigDicts) {
    const br = sig.get(PDFName.of('ByteRange')).asArray().map(n => n.asNumber());
    const key = br.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = {
      field: fieldNames.get(sig) || 'Signature',
      kind: sig.get(PDFName.of('Type'))?.toString() === '/DocTimeStamp'
        || sig.get(PDFName.of('SubFilter'))?.toString() === '/ETSI.RFC3161' ? 'timestamp' : 'signature',
      reason: pdfStringValue(sig.lookup(PDFName.of('Reason'))),
      location: pdfStringValue(sig.lookup(PDFName.of('Location'))),
    };
    try {
      const [a, b, c, d] = br;
      if (a !== 0 || a + b > bytes.length || c + d > bytes.length || c < a + b) throw new Error('Malformed /ByteRange');
      const signed = Buffer.concat([bytes.subarray(a, a + b), bytes.subarray(c, c + d)]);
      const contentsObj = sig.get(PDFName.of('Contents'));
      let der;
      if (contentsObj instanceof PDFHexString) der = Buffer.from(contentsObj.asString().replace(/[^0-9a-f]/gi, ''), 'hex');
      else if (contentsObj instanceof PDFString) der = Buffer.from(contentsObj.asString(), 'binary');
      else throw new Error('Signature has no /Contents');
      // The hole between the ranges must be exactly the /Contents string
      const tail = bytes.subarray(c + d).toString('latin1');
      entry.coversWholeDocument = c + d === bytes.length || /^\s*$/.test(tail);

      const cms = parseCms(der);
      if (entry.kind === 'timestamp') {
        const ts = verifyTimestampToken(der, signed);
        const inner = verifySignerInfo(cms, cms.signerInfos[0], cms.eContent);
        Object.assign(entry, {
          intact: ts.ok,
          signingTime: ts.time,
          timestamp: ts,
          ...pickCert(inner.cert, cms.certificates),
        });
      } else {
        const r = verifySignerInfo(cms, cms.signerInfos[0], signed);
        const pdfTime = pdfStringValue(sig.lookup(PDFName.of('M')));
        Object.assign(entry, {
          intact: r.ok,
          signingTime: (r.timestamp?.ok && r.timestamp.time) || (r.signingTime && r.signingTime.toISOString()) || parsePdfDate(pdfTime),
          timestamp: r.timestamp,
          hash: r.hashName,
          ...pickCert(r.cert, cms.certificates),
        });
      }
    } catch (err) {
      entry.intact = false;
      entry.error = err.message;
    }
    results.push(entry);
  }
  // Earliest-signed first (matches the order signatures were applied)
  results.sort((x, y) => String(x.signingTime || '').localeCompare(String(y.signingTime || '')));
  return results;
}

function pickCert(cert, certs) {
  const s = certSummary(cert);
  return {
    signer: s.name,
    email: s.email,
    issuer: s.issuer,
    selfSigned: s.selfSigned,
    certValidTo: s.validTo,
    trusted: !s.selfSigned && chainTrusted(cert, certs),
  };
}

function parsePdfDate(s) {
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?/.exec(s || '');
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m;
  const off = !tz || tz === 'Z' ? 'Z' : `${tz}${th}:${tm}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}${off}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

module.exports = { readDigitalId, createDigitalId, signPdf, verifySignatures };
