// Factura o recibo en PDF (pdf-lib, cargado al usarse: nunca entra en el bundle inicial) y cómo
// compartirlo: con el menú del teléfono si deja mandar archivos; si no, descarga + WhatsApp + correo.
import type { PDFFont, PDFPage } from 'pdf-lib';

export interface InvoicePdfData {
  /** «Factura F-0012» o «Recibo F-0012». */
  title: string;
  company: string;
  warehouse: string;
  issued: string;
  due: string;
  terms: string;
  store: { name: string; address: string; manager: string; phone: string; taxId?: string };
  lines: { name: string; qty: string; price: string; amount: string }[];
  totals: [string, string][];
  /** «Pagada: efectivo», «A cuenta: vence el…». */
  payment: string;
  notes: string[];
}

const FRACTIONS: Record<string, string> = { '⅛': ' 1/8', '¼': ' 1/4', '⅜': ' 3/8', '½': ' 1/2', '⅝': ' 5/8', '¾': ' 3/4', '⅞': ' 7/8' };

/** Deja solo lo que la letra estándar del PDF sabe dibujar (tildes y ñ sí; «⅛» pasa a «1/8»). */
function clean(font: PDFFont, text: string): string {
  let out = '';
  for (const raw of text) {
    const ch = FRACTIONS[raw] ?? raw;
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += raw === '\n' || raw === '\t' ? ' ' : '';
    }
  }
  return out;
}

/** Arma el PDF tamaño carta. */
export async function invoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, grayscale } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(`${d.title} · ${d.store.name}`);
  doc.setAuthor(d.company);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 48;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const text = (t: string, x: number, size: number, font: PDFFont = regular, color = 0) => page.drawText(clean(font, t), { x, y, size, font, color: grayscale(color) });
  const right = (t: string, xRight: number, size: number, font: PDFFont = regular) => {
    const s = clean(font, t);
    page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y, size, font });
  };
  const fit = (t: string, maxW: number, size: number, font: PDFFont = regular) => {
    let s = clean(font, t);
    while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxW) s = s.slice(0, -1);
    return s;
  };
  const rule = (gray = 0.75) => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: grayscale(gray) });

  // Encabezado: la empresa a la izquierda, el número a la derecha.
  text(d.company, M, 15, bold);
  right(d.title, W - M, 15, bold);
  y -= 16;
  text(`Desde ${d.warehouse}`, M, 9.5, regular, 0.35);
  right(`Emitida el ${d.issued}`, W - M, 9.5);
  y -= 13;
  right(`Vence el ${d.due} · ${d.terms}`, W - M, 9.5);
  y -= 22;
  rule();
  y -= 18;
  text('Para', M, 9, bold, 0.35);
  y -= 14;
  text(d.store.name, M, 12, bold);
  y -= 14;
  for (const l of [d.store.address, `${d.store.manager} · ${d.store.phone}`, d.store.taxId ? `Tax ID ${d.store.taxId}` : '']) {
    if (!l) continue;
    text(l, M, 9.5);
    y -= 12.5;
  }
  y -= 12;

  // Tabla: producto, cantidad, precio e importe.
  const cols = { qty: M + 270, price: M + 400, amount: W - M };
  const header = () => {
    text('Producto', M, 9, bold, 0.35);
    text('Cantidad', cols.qty, 9, bold, 0.35);
    text('Precio', cols.price, 9, bold, 0.35);
    right('Importe', cols.amount, 9, bold);
    y -= 8;
    rule(0.6);
    y -= 15;
  };
  header();
  for (const l of d.lines) {
    if (y < M + 140) {
      page = doc.addPage([W, H]);
      y = H - M;
      header();
    }
    text(fit(l.name, cols.qty - M - 10, 10), M, 10);
    text(fit(l.qty, cols.price - cols.qty - 8, 9.5), cols.qty, 9.5);
    text(fit(l.price, cols.amount - cols.price - 70, 9.5), cols.price, 9.5);
    right(l.amount, cols.amount, 10);
    y -= 17;
  }
  y += 4;
  rule(0.6);
  y -= 18;
  for (const [k, v] of d.totals) {
    const strong = /^Total/.test(k);
    text(k, cols.price - 40, strong ? 11.5 : 10, strong ? bold : regular);
    right(v, cols.amount, strong ? 11.5 : 10, strong ? bold : regular);
    y -= strong ? 18 : 15;
  }
  y -= 6;
  text(d.payment, M, 11, bold);
  y -= 20;
  for (const n of d.notes) {
    // Notas en renglones que caben en la hoja.
    const words = clean(regular, n).split(/\s+/);
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (regular.widthOfTextAtSize(next, 9) > W - 2 * M && line) {
        text(line, M, 9, regular, 0.3);
        y -= 12;
        line = w;
      } else line = next;
    }
    if (line) {
      text(line, M, 9, regular, 0.3);
      y -= 15;
    }
  }
  page.drawText(clean(regular, 'La app solo anota los pagos: no cobra ni mueve dinero.'), {
    x: M,
    y: M - 14,
    size: 8,
    font: regular,
    color: grayscale(0.45),
  });
  return doc.save();
}

/** Nombre del archivo: «F-0012-bodega-el-primo.pdf». */
export function pdfFileName(code: string, storeName: string): string {
  const slug = storeName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${code}-${slug}.pdf`;
}

/** Comparte el PDF con el menú del teléfono (Web Share con archivo). Devuelve false si no se puede. */
export async function sharePdf(bytes: Uint8Array, fileName: string, text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof File === 'undefined' || !navigator.share || !navigator.canShare) return false;
  const file = new File([bytes.slice()], fileName, { type: 'application/pdf' });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: fileName, text });
  } catch (e) {
    // Cerrar el menú sin elegir no es un error.
    if (e instanceof DOMException && e.name === 'AbortError') return true;
    throw e;
  }
  return true;
}

/** Descarga el PDF (o lo abre, según el navegador). */
export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function whatsappLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${to.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
