/**
 * FormFiller.js — Apply interactive AcroForm field values collected in the
 * viewer back into the PDF, and flatten forms (Acrobat "Flatten Fields").
 */
import {
  PDFDocument,
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
