/**
 * FormFiller.js — Apply interactive AcroForm field values collected in the
 * viewer back into the PDF, and flatten forms (Acrobat "Flatten Fields").
 */
import {
  PDFDocument,
  StandardFonts,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
} from 'pdf-lib';

/**
 * Write changed field values into the document.
 *
 * @param {Uint8Array} pdfBytes
 * @param {Object} values — { [fullyQualifiedFieldName]: string|boolean|string[] }
 * @returns {Promise<Uint8Array>} — new bytes (or the original if nothing applied)
 */
export async function applyFormValues(pdfBytes, values) {
  const names = Object.keys(values || {});
  if (!names.length) return pdfBytes;

  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  let form;
  try {
    form = doc.getForm();
  } catch (_) {
    return pdfBytes;
  }

  let applied = 0;
  for (const name of names) {
    const value = values[name];
    let field;
    try {
      field = form.getField(name);
    } catch (_) {
      continue;
    }

    try {
      if (field instanceof PDFTextField) {
        try { field.setText(String(value ?? '')); }
        catch (err) {
          // Retry without maxLength constraint (some PDFs have stale MaxLen)
          try { field.setMaxLength(undefined); field.setText(String(value ?? '')); }
          catch (_) { throw err; }
        }
      } else if (field instanceof PDFCheckBox) {
        if (value === true || value === 'true' || value === 'on') field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (value == null || value === '') {
          try { field.clear(); } catch (_) {}
        } else {
          const v = String(value);
          try { field.select(v); }
          catch (err) {
            // pdf.js reports /Opt-indirected groups by appearance-state index
            // ("0", "1", …) while pdf-lib select() wants the option name.
            const options = field.getOptions();
            const asIndex = Number(v);
            if (Number.isInteger(asIndex) && options[asIndex] !== undefined) {
              field.select(options[asIndex]);
            } else {
              throw err;
            }
          }
        }
      } else if (field instanceof PDFDropdown) {
        const v = String(value ?? '');
        try { field.select(v); }
        catch (_) {
          // Editable combo with a custom value: extend options, then select
          if (v) { field.addOptions([v]); field.select(v); }
          else field.clear();
        }
      } else if (field instanceof PDFOptionList) {
        const arr = Array.isArray(value) ? value.map(String) : [String(value ?? '')];
        field.select(arr.filter(Boolean));
      } else {
        continue; // signatures, buttons — nothing to write
      }
      applied += 1;
    } catch (err) {
      console.warn(`FormFiller: could not set "${name}":`, err.message);
    }
  }

  if (!applied) return pdfBytes;

  try { form.updateFieldAppearances(); } catch (_) {}
  return doc.save();
}

/**
 * Flatten all form fields into static page content (values become permanent,
 * fields are removed). Mirrors Acrobat's "Flatten" on forms.
 */
export async function flattenFormFields(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  try { form.updateFieldAppearances(); } catch (_) {}
  form.flatten();
  return doc.save();
}

/** Quick check: does the document contain any form fields? */
export async function hasFormFields(pdfBytes) {
  try {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    return doc.getForm().getFields().length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Turn detected blanks (FormDetector, on a flat form) into real AcroForm fields, so the saved
 * file is fillable everywhere — then apply the values typed into them.
 *
 * @param {Uint8Array} pdfBytes
 * @param {Object} fieldsByPage — { [pageNumber]: [{ id, type: 'text'|'checkbox', rect: [x1,y1,x2,y2], label, multiLine }] }
 * @param {Object} values — { [id]: string|boolean }
 */
export async function addDetectedFields(pdfBytes, fieldsByPage, values = {}) {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const used = new Set(form.getFields().map(f => f.getName()));
  const uniqueName = (label, fallback) => {
    // "." separates name parts in AcroForm, so keep it out of plain labels.
    const base = String(label || '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || fallback;
    let name = base, k = 2;
    while (used.has(name)) name = `${base} ${k++}`;
    used.add(name);
    return name;
  };
  let nText = 0, nCheck = 0;
  const pageNums = Object.keys(fieldsByPage || {}).map(Number).sort((a, b) => a - b);
  for (const pn of pageNums) {
    const page = pages[pn - 1];
    if (!page) continue;
    for (const f of fieldsByPage[pn] || []) {
      const [x1, y1, x2, y2] = f.rect;
      const box = {
        x: x1, y: y1, width: x2 - x1, height: y2 - y1,
        // The page already draws the box / line; the field itself stays invisible.
        backgroundColor: undefined, borderColor: undefined, borderWidth: 0,
      };
      const v = values[f.id];
      if (f.type === 'checkbox') {
        const cb = form.createCheckBox(uniqueName(f.label, `Check Box ${++nCheck}`));
        cb.addToPage(page, box);
        if (v === true) cb.check();
      } else {
        const tf = form.createTextField(uniqueName(f.label, `Text Field ${++nText}`));
        if (f.multiLine) tf.enableMultiline();
        tf.addToPage(page, { ...box, font });
        if (v != null && v !== '') tf.setText(String(v));
      }
    }
  }
  form.updateFieldAppearances(font);
  return doc.save();
}

/** True when the user typed into / ticked any detected field. */
export function anyDetectedValue(values) {
  return Object.entries(values || {}).some(([k, v]) => k.startsWith('det-') && v !== '' && v !== false && v != null);
}
