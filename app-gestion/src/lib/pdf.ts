// PDF: ver (pdf.js), estampar firmas y textos (pdf-lib) y crear un PDF desde el texto del contrato.
// Todo se carga con import() dinámico: pdf.js y pdf-lib nunca entran en el bundle inicial.
// Importaciones solo de tipos: se borran al compilar, así que no meten pdf.js ni pdf-lib en el bundle.
import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFFont } from 'pdf-lib';
import type { TemplateField, TemplateFieldType } from '../data/types';

type PdfJs = typeof PdfJsModule;
type PdfDocumentProxy = PDFDocumentProxy;

let pdfjsPromise: Promise<PdfJs> | null = null;

/** pdf.js (versión «legacy», que funciona también en teléfonos con navegadores más viejos). */
async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

export type PdfDoc = PdfDocumentProxy;

/** Abre un PDF para mostrarlo. pdf.js se queda con el buffer: se le pasa una copia. `close` libera el worker. */
export async function openPdf(bytes: Uint8Array): Promise<{ doc: PdfDocumentProxy; close: () => void }> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  return { doc, close: () => void task.destroy() };
}

/** Dibuja una página en un canvas al ancho dado (en píxeles CSS), nítida en pantallas de alta densidad. */
export async function renderPdfPage(doc: PdfDocumentProxy, pageIndex: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<{ cssHeight: number }> {
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
  const viewport = page.getViewport({ scale: scale * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const cssHeight = viewport.height / ratio;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  await page.render({ canvas, viewport }).promise;
  return { cssHeight };
}

/** Lee el tamaño de cada página (puntos PDF) y valida que el archivo sea un PDF que se puede usar. */
export async function readPdfInfo(bytes: Uint8Array): Promise<{ pageSizes: { w: number; h: number }[] }> {
  const { PDFDocument } = await import('pdf-lib');
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch {
    throw new Error('No pude leer ese archivo: tiene que ser un PDF sin contraseña.');
  }
  const pages = doc.getPages();
  // Una página girada (/Rotate) se ve derecha en pantalla, pero sus coordenadas no: las firmas
  // quedarían fuera de su recuadro. Se pide el PDF guardado derecho.
  if (pages.some((p) => ((p.getRotation().angle % 360) + 360) % 360 !== 0)) {
    throw new Error('Ese PDF tiene páginas giradas. Ábrelo, guárdalo derecho (Imprimir → Guardar como PDF) y vuelve a subirlo.');
  }
  const pageSizes = pages.map((p) => {
    const box = p.getCropBox();
    return { w: box.width, h: box.height };
  });
  if (pageSizes.length === 0) throw new Error('El PDF no tiene páginas.');
  if (pageSizes.length > 20) throw new Error('El PDF tiene más de 20 páginas: usa uno más corto para el contrato.');
  return { pageSizes };
}

export type StampValues = Partial<Record<TemplateFieldType, string>>;

/**
 * Firma de la demo (SVG) o de la pantalla (PNG) → PNG para pdf-lib. En el navegador se deja solo
 * el trazo: el fondo del recuadro de firma (color «papel») pasa a transparente y se recortan los
 * márgenes, para que la firma llene su recuadro y no deje una mancha de color sobre el papel.
 */
async function signatureToPng(dataUrl: string): Promise<Uint8Array> {
  const isPng = dataUrl.startsWith('data:image/png');
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    if (isPng) return dataUrlBytes(dataUrl);
    throw new Error('Esta firma necesita el navegador para convertirse.');
  }
  try {
    return await inkOnly(dataUrl);
  } catch (e) {
    if (isPng) return dataUrlBytes(dataUrl);
    throw e;
  }
}

async function inkOnly(dataUrl: string): Promise<Uint8Array> {
  const img = new Image();
  img.decoding = 'async';
  img.src = dataUrl;
  await img.decode();
  const k = dataUrl.startsWith('data:image/svg') ? 3 : 1;
  const w = Math.max(1, Math.round((img.naturalWidth || 400) * k));
  const h = Math.max(1, Math.round((img.naturalHeight || 120) * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('Sin canvas');
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  const px = data.data;
  // El fondo es el color de la esquina, si es opaco (la firma de la pantalla lo trae; la de la demo no).
  const [br, bg, bb, ba] = [px[0] ?? 0, px[1] ?? 0, px[2] ?? 0, px[3] ?? 0];
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (ba > 0) {
        const d = Math.abs((px[i] ?? 0) - br) + Math.abs((px[i + 1] ?? 0) - bg) + Math.abs((px[i + 2] ?? 0) - bb);
        if (d < 60) px[i + 3] = 0;
        else if (d < 140) px[i + 3] = Math.round((px[i + 3] ?? 0) * ((d - 60) / 80));
      }
      if ((px[i + 3] ?? 0) > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('La firma está vacía.');
  g.putImageData(data, 0, 0);
  const pad = 3 * k;
  const cx = Math.max(0, minX - pad);
  const cy = Math.max(0, minY - pad);
  const cw = Math.min(w, maxX + pad + 1) - cx;
  const ch = Math.min(h, maxY + pad + 1) - cy;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d')?.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
  return dataUrlBytes(out.toDataURL('image/png'));
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  if (meta.includes(';base64')) {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(data));
}

type Font = PDFFont;

/** Deja solo los caracteres que la letra estándar del PDF sabe dibujar (WinAnsi: tildes y ñ sí). */
function encodable(font: Font, text: string): string {
  let out = '';
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += ch === '\t' ? ' ' : '';
    }
  }
  return out;
}

/** Pone firmas y textos en los recuadros de la plantilla. Devuelve el PDF nuevo. */
export async function stampPdf(templateBytes: Uint8Array, fields: readonly TemplateField[], values: StampValues): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.load(templateBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const images = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>();
  for (const f of fields) {
    const page = pages[f.page];
    const value = values[f.type];
    if (!page || !value) continue;
    const crop = page.getCropBox();
    const box = {
      x: crop.x + f.x * crop.width,
      y: crop.y + crop.height - (f.y + f.h) * crop.height,
      w: f.w * crop.width,
      h: f.h * crop.height,
    };
    if (f.type === 'firma_local' || f.type === 'firma_vendedor') {
      let img = images.get(value);
      if (!img) {
        img = await doc.embedPng(await signatureToPng(value));
        images.set(value, img);
      }
      // Ocupa el recuadro sin deformarse, pegada a la izquierda (como se firma sobre una línea).
      const inset = Math.min(3, box.w * 0.04, box.h * 0.08);
      const scale = Math.min((box.w - 2 * inset) / img.width, (box.h - 2 * inset) / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: box.x + inset, y: box.y + (box.h - h) / 2, width: w, height: h });
      continue;
    }
    // Primero se parte en líneas: el salto de línea no es un carácter que la letra del PDF dibuje.
    const lines = value
      .split('\n')
      .map((l) => encodable(font, l))
      .filter((l, i, all) => l.trim() || i < all.length - 1);
    if (f.type === 'detalle_entrega' || lines.length > 1) {
      const size = Math.max(6, Math.min(11, box.h / (lines.length * 1.3)));
      const maxLines = Math.max(1, Math.floor(box.h / (size * 1.3)));
      lines.slice(0, maxLines).forEach((line, i) => {
        let text = line;
        while (text.length > 1 && font.widthOfTextAtSize(text, size) > box.w) text = text.slice(0, -1);
        page.drawText(text, { x: box.x + 2, y: box.y + box.h - (i + 1) * size * 1.3 + size * 0.25, size, font });
      });
      continue;
    }
    const text = lines[0] ?? '';
    let size = Math.max(6, Math.min(13, box.h * 0.62));
    while (size > 6 && font.widthOfTextAtSize(text, size) > box.w - 4) size -= 0.5;
    let fitted = text;
    while (fitted.length > 1 && font.widthOfTextAtSize(fitted, size) > box.w - 4) fitted = fitted.slice(0, -1);
    page.drawText(fitted, { x: box.x + 2, y: box.y + (box.h - size) / 2 + size * 0.22, size, font });
  }
  return doc.save();
}

export interface PdfSlot {
  type: TemplateFieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Convierte un texto (títulos «# », secciones «## », viñetas «- », notas «> ») en un PDF
 * tamaño carta, sin líneas de firma (por ejemplo, el anexo de precios). Una línea «[[espacio]]»
 * deja lugar para el detalle de una entrega.
 */
export async function textToPdf(text: string, title: string): Promise<Uint8Array> {
  return (await textToPdfWithSlots(text, title, [])).bytes;
}

/** Como textToPdf, con un espacio al final para las firmas (por defecto, la del local y la del vendedor) y dónde quedó cada una, para sugerir los recuadros. */
export async function textToPdfWithSlots(
  text: string,
  title: string,
  signatures: { label: string; type: TemplateFieldType }[] = [
    { label: 'Por el local (encargado)', type: 'firma_local' },
    { label: 'Por la empresa (vendedor)', type: 'firma_vendedor' },
  ],
): Promise<{ bytes: Uint8Array; slots: PdfSlot[] }> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const W = 612;
  const H = 792;
  const M = 56;
  const slots: PdfSlot[] = [];
  let page = doc.addPage([W, H]);
  let pageIndex = 0;
  let y = H - M;
  const newPage = () => {
    page = doc.addPage([W, H]);
    pageIndex += 1;
    y = H - M;
  };
  const write = (raw: string, f: Font, size: number, indent = 0, gapBefore = 0) => {
    const words = encodable(f, raw).split(/\s+/).filter(Boolean);
    const maxW = W - 2 * M - indent;
    const lineH = size * 1.38;
    y -= gapBefore;
    let line = '';
    const flush = () => {
      if (!line) return;
      if (y - lineH < M) newPage();
      y -= lineH;
      page.drawText(line, { x: M + indent, y, size, font: f });
      line = '';
    };
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > maxW && line) {
        flush();
        line = w;
      } else line = next;
    }
    flush();
  };
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) write(para.join(' '), regular, 10.5, 0, 4);
    para = [];
  };
  for (const raw of text.split('\n')) {
    const l = raw.trimEnd();
    if (!l.trim()) {
      flushPara();
      continue;
    }
    if (l.trim() === '[[espacio]]') {
      flushPara();
      const h = 150;
      if (y - h - 8 < M) newPage();
      y -= 8;
      slots.push({ type: 'detalle_entrega', page: pageIndex, x: M / W, y: (H - y) / H, w: (W - 2 * M) / W, h: h / H });
      page.drawRectangle({ x: M, y: y - h, width: W - 2 * M, height: h, borderWidth: 0.6, opacity: 0, borderOpacity: 0.5 });
      y -= h;
    } else if (l.startsWith('# ')) {
      flushPara();
      write(l.slice(2), bold, 17, 0, 0);
    } else if (l.startsWith('## ')) {
      flushPara();
      write(l.slice(3), bold, 12, 0, 12);
    } else if (l.startsWith('- ')) {
      flushPara();
      write(`• ${l.slice(2)}`, regular, 10, 10, 3);
    } else if (l.startsWith('> ')) {
      flushPara();
      write(l.slice(2), italic, 10, 0, 6);
    } else para.push(l.trim());
  }
  flushPara();
  if (signatures.length) {
    // Espacio de firmas: una línea por firma, con su leyenda.
    if (y - 170 < M) newPage();
    y -= 40;
    write('Firmas', bold, 12, 0, 0);
    y -= 80;
    const cols = signatures.length;
    const gap = 40;
    const colW = (W - 2 * M - gap * (cols - 1)) / cols;
    signatures.forEach((sig, i) => {
      const x = M + i * (colW + gap);
      page.drawLine({ start: { x, y }, end: { x: x + colW, y }, thickness: 0.8 });
      page.drawText(encodable(regular, sig.label), { x, y: y - 14, size: 9, font: regular });
      const boxH = 56;
      slots.push({ type: sig.type, page: pageIndex, x: x / W, y: (H - y - boxH) / H, w: colW / W, h: boxH / H });
    });
  }
  return { bytes: await doc.save(), slots };
}

/** Blob → bytes (las plantillas se guardan como Blob en IndexedDB). */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Descarga o abre en otra pestaña unos bytes PDF. */
export function pdfObjectUrl(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/pdf' }));
}

/** Une dos PDF (por ejemplo, el contrato firmado y su anexo de precios). */
export async function mergePdfs(first: Uint8Array, second: Uint8Array): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const a = await PDFDocument.load(first);
  const b = await PDFDocument.load(second);
  const pages = await a.copyPages(b, b.getPageIndices());
  for (const p of pages) a.addPage(p);
  return a.save();
}
