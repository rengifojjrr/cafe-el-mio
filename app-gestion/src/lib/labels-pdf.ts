// Etiquetas en PDF: nombre, vitola y capa, el código como barras (EAN-13 si es válido, si no
// Code 128) y un QR. Hoja carta de 3 × 10 (2.625″ × 1″) o una etiqueta de 2″ × 1″ por página
// para impresoras térmicas. Todo vectorial. Este archivo se carga solo al imprimir.
import { PDFDocument, StandardFonts, grayscale, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { barcodeKindFor, code128Modules, darkRuns, ean13GuardModules, ean13Modules } from './barcode-draw';
import { cleanCode } from './barcode';
import { fit, pdfText } from './pdf-text';

export type LabelFormat = 'carta' | 'termica';

export interface LabelSpec {
  /** «Toro 6 × 52 · Maduro». */
  title: string;
  /** Una o dos líneas cortas: vitola y medida, capa… */
  lines: string[];
  /** El código: va en barras y escrito debajo. */
  code: string;
  /** Lo que abre el QR (la ficha del producto o «Buscar código»). */
  qr: string;
  copies: number;
}

const PT = 72;

interface Sheet {
  page: [number, number];
  label: [number, number];
  /** Posición (abajo a la izquierda) de cada etiqueta de la página. */
  slots: [number, number][];
  pad: number;
}

function sheetFor(format: LabelFormat): Sheet {
  if (format === 'termica') return { page: [2 * PT, 1 * PT], label: [2 * PT, 1 * PT], slots: [[0, 0]], pad: 4 };
  // Carta, 3 columnas × 10 filas de 2.625″ × 1″ (márgenes de 0.1875″ a los lados y 0.5″ arriba).
  const slots: [number, number][] = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 3; col++) slots.push([0.1875 * PT + col * 2.75 * PT, 11 * PT - 0.5 * PT - (row + 1) * PT]);
  }
  return { page: [8.5 * PT, 11 * PT], label: [2.625 * PT, 1 * PT], slots, pad: 5 };
}

interface BarcodePlan {
  modules: boolean[];
  /** Módulos de silencio a cada lado. */
  quiet: [number, number];
  ean: boolean;
  /** Lo que se escribe debajo. */
  human: string;
}

function planBarcode(code: string): BarcodePlan {
  if (barcodeKindFor(code) === 'ean13') return { modules: ean13Modules(code), quiet: [11, 7], ean: true, human: code };
  // En el Code 128 va el código limpio (sin guiones ni espacios): más corto y es lo que se busca.
  return { modules: code128Modules(cleanCode(code)), quiet: [10, 10], ean: false, human: code };
}

function units(plan: BarcodePlan): number {
  return plan.modules.length + plan.quiet[0] + plan.quiet[1];
}

/** Dibuja el código de barras en el recuadro (x, y abajo a la izquierda), con el texto debajo. */
function drawBarcode(page: PDFPage, font: PDFFont, plan: BarcodePlan, box: { x: number; y: number; w: number; h: number }): void {
  const x = Math.min(1.6, box.w / units(plan));
  const used = units(plan) * x;
  const left = box.x + (box.w - used) / 2 + plan.quiet[0] * x;
  const textSize = Math.max(4.6, Math.min(6.5, box.h * 0.2));
  const barBottom = box.y + textSize + 1.2;
  const barH = Math.max(6, box.h - textSize - 1.2);
  const guards = plan.ean ? ean13GuardModules() : null;
  for (const [start, len] of darkRuns(plan.modules)) {
    const long = guards?.has(start) ?? false;
    const extra = long ? textSize * 0.55 : 0;
    page.drawRectangle({ x: left + start * x, y: barBottom - extra, width: len * x, height: barH + extra });
  }
  if (plan.ean) {
    // Como en los productos: el primer dígito afuera, a la izquierda; luego dos grupos de 6.
    const d = plan.human;
    const y = box.y + 0.6;
    page.drawText(d[0]!, { x: left - font.widthOfTextAtSize(d[0]!, textSize) - x * 2, y, size: textSize, font });
    const leftGroup = d.slice(1, 7);
    const rightGroup = d.slice(7);
    const lw = font.widthOfTextAtSize(leftGroup, textSize);
    const rw = font.widthOfTextAtSize(rightGroup, textSize);
    page.drawText(leftGroup, { x: left + 3 * x + (42 * x - lw) / 2, y, size: textSize, font });
    page.drawText(rightGroup, { x: left + 50 * x + (42 * x - rw) / 2, y, size: textSize, font });
    return;
  }
  const human = fit(font, pdfText(font, plan.human), textSize, box.w);
  const hw = font.widthOfTextAtSize(human, textSize);
  page.drawText(human, { x: box.x + (box.w - hw) / 2, y: box.y + 0.6, size: textSize, font });
}

/** QR como rectángulos (una tira por cada racha de módulos oscuros de una fila). */
function drawQr(page: PDFPage, text: string, x: number, y: number, size: number): void {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const m = size / n;
  for (let row = 0; row < n; row++) {
    const bits: boolean[] = [];
    for (let col = 0; col < n; col++) bits.push(Boolean(qr.modules.get(row, col)));
    for (const [start, len] of darkRuns(bits)) {
      page.drawRectangle({ x: x + start * m, y: y + size - (row + 1) * m, width: len * m, height: m });
    }
  }
}

function drawLabel(page: PDFPage, fonts: { regular: PDFFont; bold: PDFFont }, spec: LabelSpec, at: [number, number], sheet: Sheet): void {
  const [x0, y0] = at;
  const [w, h] = sheet.label;
  const pad = sheet.pad;
  const plan = planBarcode(spec.code);
  // Junto al QR si las barras quedan de buen tamaño (≥ 0.75 pt por módulo); si no, el código
  // va abajo a todo lo ancho y el QR sube a la esquina.
  const sideQr = Math.min(h - 2 * pad, w * 0.3);
  const sideCol = w - 2 * pad - sideQr - 4;
  const side = sideCol / units(plan) >= 0.75;
  const qr = side ? sideQr : h * 0.44;
  const titleSize = w > 170 ? 7.6 : 6.8;
  const lineSize = w > 170 ? 6.2 : 5.6;
  const colW = side ? sideCol : w - 2 * pad - qr - 3;
  drawQr(page, spec.qr, x0 + w - pad - qr, side ? y0 + (h - qr) / 2 : y0 + h - pad - qr, qr);
  let y = y0 + h - pad - titleSize;
  page.drawText(fit(fonts.bold, pdfText(fonts.bold, spec.title), titleSize, colW), { x: x0 + pad, y, size: titleSize, font: fonts.bold });
  const lines = spec.lines.slice(0, side ? 2 : 2);
  for (const line of lines) {
    y -= lineSize + 1.6;
    page.drawText(fit(fonts.regular, pdfText(fonts.regular, line), lineSize, colW), { x: x0 + pad, y, size: lineSize, font: fonts.regular, color: grayscale(0.25) });
  }
  const top = side ? y - 2.5 : y0 + h - pad - qr - 2;
  const barW = side ? sideCol : w - 2 * pad;
  drawBarcode(page, fonts.regular, plan, { x: x0 + pad, y: y0 + pad - 1, w: barW, h: Math.max(14, top - (y0 + pad - 1)) });
}

/** Arma el PDF con todas las etiquetas (cada una repetida `copies` veces). */
export async function labelsPdf(specs: readonly LabelSpec[], format: LabelFormat, title = 'Etiquetas'): Promise<Uint8Array> {
  const all = specs.flatMap((s) => Array.from({ length: Math.max(0, Math.min(500, Math.floor(s.copies))) }, () => s));
  if (all.length === 0) throw new Error('Elige al menos una etiqueta.');
  if (all.length > 3000) throw new Error('Son demasiadas etiquetas para un solo PDF (más de 3,000).');
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator('Grupo Miami · gestión');
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const sheet = sheetFor(format);
  let page: PDFPage | null = null;
  all.forEach((spec, i) => {
    const slot = i % sheet.slots.length;
    if (slot === 0) page = doc.addPage(sheet.page);
    drawLabel(page!, fonts, spec, sheet.slots[slot]!, sheet);
  });
  return doc.save();
}
