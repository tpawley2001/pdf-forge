/**
 * FormOperations.js - PDF form field manipulation.
 * Fills, reads, flattens, imports, and exports AcroForm fields.
 */
import { PDFName, PDFString, PDFHexString, PDFDict, PDFArray } from 'pdf-lib';

export class FormOperations {
  /** Return all terminal form fields (with full names). */
  getFormFields(doc) {
    const form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (!form) return [];
    const fields = form.lookupMaybe(PDFName.of('Fields'), PDFArray);
    if (!fields) return [];
    return this._collectFields(fields, '');
  }

  _collectFields(fieldsArray, prefix) {
    const results = [];
    for (let i = 0; i < fieldsArray.size(); i++) {
      const ref = fieldsArray.lookup(i);
      const dict = ref instanceof PDFDict ? ref : null;
      if (!dict) continue;
      const t = dict.lookupMaybe(PDFName.of('T'), PDFString, PDFHexString);
      const name = t ? t.decodeText() : '';
      const full = prefix ? `${prefix}.${name}` : name;
      const ft = dict.lookupMaybe(PDFName.of('FT'), PDFName);
      const type = ft ? ft.asString() : 'Tx';
      const kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray);
      if (kids && kids.size() > 0) {
        results.push(...this._collectFields(kids, full));
      } else {
        results.push({ name: full, type, ref: dict });
      }
    }
    return results;
  }

  _setFieldValue(doc, fieldName, value) {
    const fields = this.getFormFields(doc);
    const f = fields.find(x => x.name === fieldName);
    if (!f) throw new Error(`Field "${fieldName}" not found`);
    f.ref.set(PDFName.of('V'), PDFString.of(String(value)));
    // Mark as dirty
    f.ref.set(PDFName.of('AP'), undefined);
  }

  fillTextField(doc, fieldName, value) {
    this._setFieldValue(doc, fieldName, value);
    return doc;
  }

  fillCheckbox(doc, fieldName, checked) {
    const fields = this.getFormFields(doc);
    const f = fields.find(x => x.name === fieldName);
    if (!f) throw new Error(`Field "${fieldName}" not found`);
    f.ref.set(PDFName.of('V'), checked ? PDFName.of('Yes') : PDFName.of('Off'));
    return doc;
  }

  fillRadioButton(doc, fieldName, value) {
    this._setFieldValue(doc, fieldName, value);
    return doc;
  }

  fillDropdown(doc, fieldName, value) {
    this._setFieldValue(doc, fieldName, value);
    return doc;
  }

  /** Flatten all form fields so they become static page content. */
  flattenForm(doc) {
    doc.catalog.delete(PDFName.of('AcroForm'));
    return doc;
  }

  exportFormData(doc) {
    const fields = this.getFormFields(doc);
    const data = {};
    for (const f of fields) {
      const v = f.ref.lookupMaybe(PDFName.of('V'), PDFString, PDFHexString);
      data[f.name] = v ? v.decodeText() : '';
    }
    return data;
  }

  importFormData(doc, data) {
    for (const [name, value] of Object.entries(data)) {
      try { this._setFieldValue(doc, name, value); } catch (_) {}
    }
    return doc;
  }
}

export default FormOperations;
