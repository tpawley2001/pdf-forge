import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function parseColor(input, fallback = rgb(0, 0, 0)) {
  if (!input || typeof input !== 'string') return fallback;

  const hex = input.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1];
    return rgb(
      parseInt(value.slice(0, 2), 16) / 255,
      parseInt(value.slice(2, 4), 16) / 255,
      parseInt(value.slice(4, 6), 16) / 255,
    );
  }

  const rgba = input.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map(part => Number(part.trim()));
    if (parts.length >= 3 && parts.every((part, index) => index > 2 || Number.isFinite(part))) {
      return rgb(parts[0] / 255, parts[1] / 255, parts[2] / 255);
    }
  }

  const named = {
    black: rgb(0, 0, 0),
    blue: rgb(0, 0, 1),
    cyan: rgb(0, 1, 1),
    gray: rgb(0.5, 0.5, 0.5),
    green: rgb(0, 0.5, 0),
    orange: rgb(1, 0.55, 0),
    red: rgb(1, 0, 0),
    white: rgb(1, 1, 1),
    yellow: rgb(1, 1, 0),
  };

  return named[input.toLowerCase()] || fallback;
}

function parseOpacity(input, fallback = 1) {
  if (typeof input !== 'string') return fallback;
  const rgba = input.match(/^rgba\(([^)]+)\)$/i);
  if (!rgba) return fallback;
  const alpha = Number(rgba[1].split(',')[3]?.trim());
  return Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : fallback;
}

function toPdfRect(page, rect) {
  const height = page.getHeight();
  return {
    x: rect.x,
    y: height - rect.y - rect.height,
    width: rect.width,
    height: rect.height,
  };
}

function toPdfPoint(page, point) {
  return {
    x: point.x,
    y: page.getHeight() - point.y,
  };
}

function annotationRect(annotation) {
  return annotation.rect || {
    x: annotation.x || 0,
    y: annotation.y || 0,
    width: annotation.width || 0,
    height: annotation.height || 0,
  };
}

function drawArrow(page, start, end, color, width) {
  page.drawLine({ start, end, color, thickness: width });

  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLen = 12;
  const spread = Math.PI * 0.15;
  const left = {
    x: end.x - headLen * Math.cos(angle - spread),
    y: end.y - headLen * Math.sin(angle - spread),
  };
  const right = {
    x: end.x - headLen * Math.cos(angle + spread),
    y: end.y - headLen * Math.sin(angle + spread),
  };

  page.drawLine({ start: end, end: left, color, thickness: width });
  page.drawLine({ start: end, end: right, color, thickness: width });
}

async function embedDataUrlImage(doc, dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!match) return null;

  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  return match[1].toLowerCase() === 'png'
    ? doc.embedPng(bytes)
    : doc.embedJpg(bytes);
}

function wrapText(text, font, fontSize, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, fontSize) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }

  if (line) lines.push(line);
  return lines;
}

export async function flattenAnnotations(pdfBytes, annotations = []) {
  if (!annotations.length) return pdfBytes;

  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const annotation of annotations) {
    const page = pages[(annotation.page || 1) - 1];
    if (!page) continue;

    const color = parseColor(annotation.color, rgb(0.9, 0, 0));
    const width = annotation.width || annotation.borderWidth || annotation.size || 2;

    switch (annotation.type) {
      case 'highlight': {
        const rect = toPdfRect(page, annotationRect(annotation));
        page.drawRectangle({
          ...rect,
          color: parseColor(annotation.color, rgb(1, 1, 0)),
          opacity: parseOpacity(annotation.color, 0.35),
        });
        break;
      }
      case 'underline': {
        const rect = annotationRect(annotation);
        const y = page.getHeight() - (rect.y + rect.height);
        page.drawLine({
          start: { x: rect.x, y },
          end: { x: rect.x + rect.width, y },
          color,
          thickness: width,
        });
        break;
      }
      case 'strikethrough': {
        const rect = annotationRect(annotation);
        const y = page.getHeight() - (rect.y + rect.height / 2);
        page.drawLine({
          start: { x: rect.x, y },
          end: { x: rect.x + rect.width, y },
          color,
          thickness: width,
        });
        break;
      }
      case 'freehand': {
        const path = annotation.path || [];
        for (let i = 1; i < path.length; i += 1) {
          page.drawLine({
            start: toPdfPoint(page, path[i - 1]),
            end: toPdfPoint(page, path[i]),
            color,
            thickness: width,
          });
        }
        break;
      }
      case 'rectangle': {
        page.drawRectangle({
          ...toPdfRect(page, annotationRect(annotation)),
          borderColor: color,
          borderWidth: width,
        });
        break;
      }
      case 'ellipse': {
        const rect = toPdfRect(page, annotationRect(annotation));
        page.drawEllipse({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          xScale: rect.width / 2,
          yScale: rect.height / 2,
          borderColor: color,
          borderWidth: width,
        });
        break;
      }
      case 'line': {
        if (!annotation.startPoint || !annotation.endPoint) break;
        page.drawLine({
          start: toPdfPoint(page, annotation.startPoint),
          end: toPdfPoint(page, annotation.endPoint),
          color,
          thickness: width,
        });
        break;
      }
      case 'arrow': {
        if (!annotation.startPoint || !annotation.endPoint) break;
        drawArrow(
          page,
          toPdfPoint(page, annotation.startPoint),
          toPdfPoint(page, annotation.endPoint),
          color,
          width,
        );
        break;
      }
      case 'textbox': {
        const rect = toPdfRect(page, annotationRect(annotation));
        const fontSize = annotation.fontSize || 13;
        page.drawRectangle({
          ...rect,
          color: rgb(1, 1, 0.86),
          opacity: 0.9,
          borderColor: parseColor(annotation.color, rgb(0.65, 0.65, 0.65)),
          borderWidth: 0.75,
        });
        const lines = wrapText(annotation.text, font, fontSize, Math.max(0, rect.width - 8));
        let y = rect.y + rect.height - fontSize - 4;
        for (const line of lines) {
          if (y < rect.y + 4) break;
          page.drawText(line, { x: rect.x + 4, y, size: fontSize, font, color: rgb(0, 0, 0) });
          y -= fontSize * 1.2;
        }
        break;
      }
      case 'note': {
        const x = annotation.x || 20;
        const y = page.getHeight() - (annotation.y || 20);
        page.drawRectangle({
          x,
          y,
          width: 20,
          height: 20,
          color: rgb(1, 0.96, 0.45),
          borderColor: rgb(0.95, 0.65, 0.1),
          borderWidth: 1,
        });
        page.drawText('N', { x: x + 6.5, y: y + 5, size: 10, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
        break;
      }
      case 'stamp': {
        const x = annotation.x || 40;
        const y = page.getHeight() - (annotation.y || 40);
        const text = String(annotation.stampType || 'Approved').toUpperCase();
        // Match stamp colors to the UI
        const stampColorMap = {
          'APPROVED':     rgb(0.898, 0.224, 0.208),
          'DRAFT':        rgb(0.082, 0.396, 0.753),
          'CONFIDENTIAL': rgb(0.714, 0.110, 0.110),
          'FOR REVIEW':   rgb(0.180, 0.490, 0.196),
          'VOID':         rgb(0.427, 0.298, 0.255),
          'FINAL':        rgb(0.106, 0.369, 0.125),
          'EXPIRED':      rgb(0.459, 0.459, 0.459),
          'NOT APPROVED': rgb(0.776, 0.157, 0.157),
          'REVISED':      rgb(0.902, 0.318, 0.000),
          'RECEIVED':     rgb(0.157, 0.196, 0.576),
          'COPY':         rgb(0.290, 0.290, 0.290),
          'SIGN HERE':    rgb(0.082, 0.396, 0.753),
        };
        const stampColor = stampColorMap[text] || rgb(0.95, 0.1, 0.1);
        page.drawRectangle({
          x,
          y,
          width: 130,
          height: 32,
          borderColor: stampColor,
          borderWidth: 3,
        });
        const textWidth = boldFont.widthOfTextAtSize(text, 12);
        page.drawText(text, {
          x: x + (130 - textWidth) / 2,
          y: y + 10,
          size: 12,
          font: boldFont,
          color: stampColor,
        });
        break;
      }
      case 'signature': {
        const image = await embedDataUrlImage(doc, annotation.dataUrl);
        const x = annotation.x || 40;
        const y = page.getHeight() - (annotation.y || 40);
        if (image) {
          const targetWidth = annotation.width || 180;
          const dims = image.scale(targetWidth / image.width);
          page.drawImage(image, { x, y: y - dims.height, width: dims.width, height: dims.height });
        } else {
          page.drawText('Signature', { x, y, size: 18, font, color: rgb(0.08, 0.4, 0.75) });
        }
        break;
      }
      default:
        break;
    }
  }

  return doc.save();
}
