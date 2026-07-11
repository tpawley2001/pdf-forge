/**
 * Security.js - Document security, encryption, permissions, and watermarking.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export class Security {
  /**
   * Encrypt a document with user and owner passwords.
   * Sets basic permissions flags on the document.
   */
  encrypt(doc, userPassword, ownerPassword, permissions = {}) {
    // pdf-lib supports setting encryption via low-level dict manipulation.
    // For a full implementation, use the encrypt method on the save options.
    // We store encryption metadata so the save pipeline can apply it.
    doc._encryption = {
      userPassword,
      ownerPassword,
      permissions: {
        printing: permissions.printing !== false,
        modifying: permissions.modifying !== false,
        copying: permissions.copying !== false,
        annotating: permissions.annotating !== false,
        fillingForms: permissions.fillingForms !== false,
        contentAccessibility: permissions.contentAccessibility !== false,
        documentAssembly: permissions.documentAssembly !== false,
      },
    };
    return doc;
  }

  /** Decrypt a password-protected doc (handled at load time by pdf-lib). */
  decrypt(doc, password) {
    doc._encryption = null;
    return doc;
  }

  /** Return human-readable permission flags. */
  getPermissions(doc) {
    const defaults = {
      printing: true, modifying: true, copying: true,
      annotating: true, fillingForms: true,
      contentAccessibility: true, documentAssembly: true,
    };
    if (!doc._encryption) return { encrypted: false, ...defaults };
    return { encrypted: true, ...doc._encryption.permissions };
  }

  /**
   * Add a diagonal watermark across all pages.
   * @param {PDFDocument} doc
   * @param {string} watermarkText
   * @param {number} [opacity=0.08]
   */
  async addWatermark(doc, watermarkText, opacity = 0.08) {
    const pages = doc.getPages();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);

    for (const page of pages) {
      const { width, height } = page.getSize();
      const fontSize = Math.min(width, height) / 8;
      const textWidth = watermarkText.length * fontSize * 0.6;

      // Center the watermark
      const x = (width - textWidth) / 2;
      const y = height / 2;

      // Rotate and draw
      page.drawText(watermarkText, {
        x, y,
        size: fontSize,
        font,
        color: rgb(0.6, 0.6, 0.6),
        opacity,
        rotate: { angle: 45, origin: { x: width / 2, y: height / 2 } },
      });
    }
    return doc;
  }

  /** Remove document metadata (title, author, subject, keywords, creator, producer). */
  sanitizeMetadata(doc) {
    const info = doc.getInfoDict();
    if (info) {
      const keys = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'];
      for (const key of keys) {
        try { doc.setTitle(''); } catch (_) {}
        try { doc.setAuthor(''); } catch (_) {}
        try { doc.setSubject(''); } catch (_) {}
        try { doc.setKeywords([]); } catch (_) {}
        try { doc.setCreator(''); } catch (_) {}
        try { doc.setProducer(''); } catch (_) {}
      }
    }
    return doc;
  }
}

export default Security;
