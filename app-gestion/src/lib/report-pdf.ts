// PDF de una tabla (reportes), con pdf-lib cargado solo al usarse: carta apaisada, encabezado que
// se repite en cada página, fila de totales y número de página.
import type { PDFFont } from 'pdf-lib';

export interface PdfColumn {
  label: string;
  /** Ancho relativo. */
  width: number;
  align?: 'left' | 'right';
}

export interface TablePdfInput {
  title: string;
  subtitle: string[];
  columns: PdfColumn[];
  rows: string[][];
  totals?: string[];
  footnote?: string;
}

/** Deja solo lo que la letra estándar del PDF sabe dibujar (WinAnsi: tildes y ñ sí). */
function encodable(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += ch === '·' ? '-' : '';
    }
  }
  return out;
}

function fit(font: PDFFont, text: string, size: number, width: number): string {
  let t = encodable(font, text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t}…`;
}

export async function tablePdf(input: TablePdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, grayscale } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 792;
  const H = 612;
  const M = 32;
  const size = 7.2;
  const rowH = 13;
  const gray = grayscale(0.45);
  const totalW = input.columns.reduce((a, c) => a + c.width, 0);
  const widths = input.columns.map((c) => ((W - 2 * M) * c.width) / totalW);
  const xs = widths.map((_, i) => M + widths.slice(0, i).reduce((a, b) => a + b, 0));
  let page = doc.addPage([W, H]);
  let y = H - M;
  let pageNo = 1;

  const cell = (text: string, i: number, font: PDFFont) => {
    const w = widths[i]! - 6;
    const t = fit(font, text, size, w);
    const align = input.columns[i]!.align ?? 'left';
    const x = align === 'right' ? xs[i]! + widths[i]! - 3 - font.widthOfTextAtSize(t, size) : xs[i]! + 3;
    page.drawText(t, { x, y, size, font });
  };
  const header = () => {
    page.drawText(encodable(bold, input.title), { x: M, y: y - 14, size: 14, font: bold });
    y -= 24;
    for (const line of input.subtitle) {
      page.drawText(encodable(regular, line), { x: M, y: y - 9, size: 9, font: regular, color: gray });
      y -= 12;
    }
    y -= 8;
    input.columns.forEach((c, i) => cell(c.label, i, bold));
    y -= 4;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6 });
    y -= rowH - 4;
  };
  const footer = () => {
    page.drawText(`Página ${pageNo}`, { x: W - M - 40, y: M - 14, size: 8, font: regular, color: gray });
  };
  header();
  for (const row of input.rows) {
    if (y < M + rowH * 2) {
      footer();
      page = doc.addPage([W, H]);
      pageNo += 1;
      y = H - M;
      header();
    }
    row.forEach((v, i) => cell(v, i, regular));
    y -= rowH;
  }
  if (input.totals) {
    if (y < M + rowH * 3) {
      footer();
      page = doc.addPage([W, H]);
      pageNo += 1;
      y = H - M;
      header();
    }
    page.drawLine({ start: { x: M, y: y + rowH - 3 }, end: { x: W - M, y: y + rowH - 3 }, thickness: 0.6 });
    input.totals.forEach((v, i) => cell(v, i, bold));
    y -= rowH;
  }
  if (input.footnote) {
    y -= 8;
    const words = encodable(regular, input.footnote).split(/\s+/);
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (regular.widthOfTextAtSize(next, 8) > W - 2 * M) {
        page.drawText(line, { x: M, y, size: 8, font: regular, color: gray });
        y -= 11;
        line = w;
      } else line = next;
    }
    if (line) page.drawText(line, { x: M, y, size: 8, font: regular, color: gray });
  }
  footer();
  return doc.save();
}
