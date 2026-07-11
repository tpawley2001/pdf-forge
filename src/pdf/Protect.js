/**
 * Protect.js — Real PDF password protection (Acrobat "Protect Using Password").
 *
 * Uses @cantoo/pdf-lib (a pdf-lib fork with standard security handler support)
 * only for the encrypt/decrypt steps, so the rest of the app keeps using
 * upstream pdf-lib on plain-text bytes.
 */
import { PDFDocument as SecurePDFDocument } from '@cantoo/pdf-lib';

/** True if the bytes are an encrypted PDF. */
export async function isEncrypted(pdfBytes) {
  try {
    const doc = await SecurePDFDocument.load(pdfBytes.slice(), { ignoreEncryption: true });
    return !!doc.isEncrypted;
  } catch (_) {
    return false;
  }
}

/**
 * Encrypt a PDF with user/owner passwords and permission flags.
 *
 * @param {Uint8Array} pdfBytes — plain (unencrypted) PDF bytes
 * @param {Object} opts
 *   userPassword  — password required to open (optional if ownerPassword set)
 *   ownerPassword — password for full access (defaults to userPassword)
 *   permissions   — { printing, modifying, copying, annotating, fillingForms,
 *                     contentAccessibility, documentAssembly } booleans
 * @returns {Promise<Uint8Array>} encrypted bytes
 */
export async function encryptPdf(pdfBytes, { userPassword, ownerPassword, permissions = {} }) {
  const doc = await SecurePDFDocument.load(pdfBytes.slice(), { ignoreEncryption: true });
  doc.encrypt({
    userPassword: userPassword || undefined,
    ownerPassword: ownerPassword || userPassword,
    permissions: {
      printing: permissions.printing === false ? false : 'highResolution',
      modifying: permissions.modifying !== false,
      copying: permissions.copying !== false,
      annotating: permissions.annotating !== false,
      fillingForms: permissions.fillingForms !== false,
      contentAccessibility: permissions.contentAccessibility !== false,
      documentAssembly: permissions.documentAssembly !== false,
    },
  });
  return doc.save({ useObjectStreams: false });
}

/**
 * Decrypt an encrypted PDF given its password. Returns plain bytes that the
 * rest of the editing stack (upstream pdf-lib, pdf.js) can work with freely.
 * Throws if the password is wrong.
 */
export async function decryptPdf(pdfBytes, password) {
  const doc = await SecurePDFDocument.load(pdfBytes.slice(), {
    ignoreEncryption: true,
    password: password || '',
  });
  return doc.save({ useObjectStreams: false });
}
