import React from 'react';

/**
 * FormFillLayer — renders interactive AcroForm widgets (from pdf.js
 * getAnnotations) as HTML inputs positioned over the page, Acrobat-style.
 *
 * Values live in App state as { [fieldName]: value } holding only fields the
 * user changed; unchanged fields fall back to the value stored in the PDF.
 */

const FLAG_HIDDEN = 2;
const FLAG_NOVIEW = 32;

function widgetCss(vp, rect) {
  const [x1, y1, x2, y2] = vp.convertToViewportRectangle(rect);
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

export default function FormFillLayer({ widgets, viewport, scale, values, onChange, interactive }) {
  if (!widgets || widgets.length === 0) return null;

  return (
    <div
      className="form-fill-layer"
      style={{
        position: 'absolute', top: 0, left: 0,
        width: viewport.width, height: viewport.height,
        pointerEvents: 'none', // children opt in individually
        zIndex: 3,
      }}
    >
      {widgets.map((w, i) => {
        if (!w.fieldName) return null;
        if (w.annotationFlags & (FLAG_HIDDEN | FLAG_NOVIEW)) return null;
        const pos = widgetCss(viewport, w.rect);
        if (pos.width < 2 || pos.height < 2) return null;

        const changed = values[w.fieldName];
        const key = `${w.id || w.fieldName}-${i}`;
        const common = {
          className: 'form-field',
          disabled: !interactive || !!w.readOnly,
          style: {
            position: 'absolute',
            left: pos.left, top: pos.top,
            width: pos.width, height: pos.height,
            pointerEvents: interactive && !w.readOnly ? 'auto' : 'none',
          },
        };
        const daFontSize = w.defaultAppearanceData?.fontSize;
        const textFontSize = (daFontSize && daFontSize > 0)
          ? daFontSize * scale
          : Math.min(pos.height * 0.62, 15 * scale);

        // ── Text field ──
        if (w.fieldType === 'Tx') {
          const value = changed !== undefined ? changed : (w.fieldValue ?? '');
          const inputProps = {
            ...common,
            value,
            maxLength: w.maxLen > 0 ? w.maxLen : undefined,
            onChange: e => onChange(w.fieldName, e.target.value),
            style: { ...common.style, fontSize: textFontSize },
            title: w.alternativeText || w.fieldName,
          };
          return w.multiLine
            ? <textarea key={key} {...inputProps} />
            : <input key={key} type="text" {...inputProps} />;
        }

        // ── Checkbox / radio ──
        if (w.fieldType === 'Btn' && !w.pushButton) {
          if (w.radioButton) {
            const groupValue = changed !== undefined ? changed : w.fieldValue;
            const isOn = groupValue === w.buttonValue;
            return (
              <input
                key={key} type="radio" {...common}
                checked={!!isOn}
                onChange={() => onChange(w.fieldName, w.buttonValue)}
                title={`${w.fieldName} = ${w.buttonValue}`}
              />
            );
          }
          const exportValue = w.exportValue || 'Yes';
          const isChecked = changed !== undefined
            ? changed === true
            : (w.fieldValue && w.fieldValue !== 'Off' && w.fieldValue === exportValue) ||
              (w.fieldValue && w.fieldValue !== 'Off' && !w.exportValue);
          return (
            <input
              key={key} type="checkbox" {...common}
              checked={!!isChecked}
              onChange={e => onChange(w.fieldName, e.target.checked)}
              title={w.alternativeText || w.fieldName}
            />
          );
        }

        // ── Dropdown / list box ──
        if (w.fieldType === 'Ch') {
          const options = (w.options || []).map(o => ({
            value: o.exportValue ?? o.displayValue,
            label: o.displayValue ?? o.exportValue,
          }));
          const raw = changed !== undefined ? changed : w.fieldValue;
          const value = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
          return (
            <select
              key={key} {...common}
              value={value}
              onChange={e => onChange(w.fieldName, e.target.value)}
              style={{ ...common.style, fontSize: Math.min(pos.height * 0.55, 14 * scale) }}
              title={w.alternativeText || w.fieldName}
            >
              {!options.some(o => o.value === value) && <option value={value}>{value}</option>}
              {options.map((o, j) => <option key={j} value={o.value}>{o.label}</option>)}
            </select>
          );
        }

        // Signature fields and push buttons: outline only
        // (signed fields already show their appearance — no outline)
        if (w.fieldType === 'Sig' && !w.hasAppearance) {
          return (
            <div
              key={key}
              className="form-field form-field--sig"
              style={{ position: 'absolute', ...pos, pointerEvents: 'none' }}
              title="Signature field — use the Signature tool to sign"
            />
          );
        }

        return null;
      })}
    </div>
  );
}
