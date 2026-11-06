// «Diferencias de la importación» en PDF, para reclamar a la fábrica: por producto y por bulto,
// lo que dice la lista de empaque contra lo contado, la diferencia en unidades y en dólares (al
// costo de la lista), con las notas. Se carga solo al pedir el PDF.
import { PDFDocument, StandardFonts, grayscale, type PDFFont, type PDFPage } from 'pdf-lib';
import type { DiffReport } from '../domain/receiving';
import { BALE_STATUS_LABEL } from '../domain/receiving';
import { unitsText } from '../domain/products';
import { fmtMoney } from './money';
import { fit, pdfText } from './pdf-text';

export interface DifferencesPdfInput {
  code: string;
  supplier: string;
  origin: string;
  /** «Recibida el 6 nov 2026» o «Llegó el …». */
  dateText: string;
  generatedText: string;
  report: DiffReport;
  info: (productId: string) => { name: string; sku: string; unitName: string };
}

const W = 612;
const H = 792;
const M = 44;

interface Col {
  title: string;
  width: number;
  right?: boolean;
}

export async function differencesPdf(input: DifferencesPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Diferencias de ${input.code}`);
  doc.setCreator('Grupo Miami · gestión');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const ensure = (h: number) => {
    if (y - h < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (t: string, opts: { x?: number; size?: number; font?: PDFFont; gray?: number; width?: number }) => {
    const f = opts.font ?? regular;
    const size = opts.size ?? 9.5;
    const s = fit(f, pdfText(f, t), size, opts.width ?? W - 2 * M);
    page.drawText(s, { x: opts.x ?? M, y, size, font: f, color: opts.gray !== undefined ? grayscale(opts.gray) : undefined });
  };
  const line = () => page.drawLine({ start: { x: M, y: y + 3 }, end: { x: W - M, y: y + 3 }, thickness: 0.5, color: grayscale(0.7) });

  const r = input.report;
  text(`Diferencias de la importación ${input.code}`, { size: 16, font: bold });
  y -= 20;
  text(`${input.supplier}${input.origin ? ` · ${input.origin}` : ''}`, { size: 10.5 });
  y -= 14;
  text(`${input.dateText} · bultos revisados: ${r.checked} de ${r.total} · con diferencias: ${r.withIssues}`, { size: 9.5, gray: 0.3 });
  y -= 13;
  text(`Diferencia total: ${r.diff > 0 ? '+' : ''}${r.diff} unidades · ${fmtMoney(r.value)} al costo de la lista de empaque`, { size: 10.5, font: bold });
  y -= 24;

  const table = (title: string, cols: Col[], rows: { cells: string[]; note?: string; strong?: boolean }[]) => {
    ensure(40);
    text(title, { size: 12, font: bold });
    y -= 16;
    const header = () => {
      let x = M;
      for (const c of cols) {
        const t = fit(bold, pdfText(bold, c.title), 8.5, c.width - 4);
        page.drawText(t, { x: c.right ? x + c.width - 4 - bold.widthOfTextAtSize(t, 8.5) : x, y, size: 8.5, font: bold, color: grayscale(0.25) });
        x += c.width;
      }
      y -= 5;
      line();
      y -= 10;
    };
    header();
    for (const row of rows) {
      const need = row.note ? 26 : 14;
      if (y - need < M) {
        ensure(need + 30);
        header();
      }
      let x = M;
      row.cells.forEach((cell, i) => {
        const c = cols[i]!;
        const f = row.strong ? bold : regular;
        const t = fit(f, pdfText(f, cell), 8.8, c.width - 4);
        page.drawText(t, { x: c.right ? x + c.width - 4 - f.widthOfTextAtSize(t, 8.8) : x, y, size: 8.8, font: f });
        x += c.width;
      });
      y -= 12;
      if (row.note) {
        text(`Nota: ${row.note}`, { x: M + 8, size: 8.3, font: italic, gray: 0.3, width: W - 2 * M - 8 });
        y -= 12;
      }
    }
    y -= 12;
  };

  const qty = (productId: string, n: number) => unitsText({ unitName: input.info(productId).unitName }, n);
  const signed = (productId: string, n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${qty(productId, Math.abs(n))}`;

  table(
    'Por producto',
    [
      { title: 'Producto', width: 190 },
      { title: 'SKU', width: 90 },
      { title: 'Lista', width: 62, right: true },
      { title: 'Contado', width: 62, right: true },
      { title: 'Diferencia', width: 62, right: true },
      { title: 'USD', width: 58, right: true },
    ],
    [
      ...r.byProduct.map((x) => ({
        cells: [input.info(x.productId).name, input.info(x.productId).sku, qty(x.productId, x.expected), qty(x.productId, x.counted), signed(x.productId, x.diff), fmtMoney(x.value)],
      })),
      { cells: ['Total', '', String(r.expected), String(r.counted), `${r.diff > 0 ? '+' : ''}${r.diff}`, fmtMoney(r.value)], strong: true },
    ],
  );

  if (r.rows.length) {
    table(
      'Por bulto (solo los que tienen algo que reclamar)',
      [
        { title: 'Bulto', width: 42 },
        { title: 'Producto', width: 176 },
        { title: 'Lista', width: 58, right: true },
        { title: 'Contado', width: 58, right: true },
        { title: 'Diferencia', width: 62, right: true },
        { title: 'USD', width: 56, right: true },
        { title: 'Estado', width: 72 },
      ],
      r.rows.map((x, i) => {
        const prev = r.rows[i - 1];
        const firstOfBale = !prev || prev.bale !== x.bale;
        const lastOfBale = r.rows[i + 1]?.bale !== x.bale;
        return {
          cells: [firstOfBale ? x.bale : '', input.info(x.productId).name, qty(x.productId, x.expected), qty(x.productId, x.counted), signed(x.productId, x.diff), fmtMoney(x.value), firstOfBale ? BALE_STATUS_LABEL[x.status] : ''],
          note: lastOfBale ? x.note : undefined,
        };
      }),
    );
  } else {
    ensure(20);
    text('Todos los bultos revisados están bien: no hay nada que reclamar.', { size: 10 });
    y -= 20;
  }
  ensure(20);
  text(`${input.generatedText}. Los dólares son al costo de cada bulto según la lista de empaque.`, { size: 8, gray: 0.4 });
  return doc.save();
}
