// Qué lleva cada etiqueta: nombre, vitola y capa (o peso y molido), el código y el QR.
// Solo datos: el PDF se arma en lib/labels-pdf.ts, que se baja al imprimir.
import type { CaseUnit, LineId, Product } from '../../data/types';
import type { PublicProduct } from '../../services/catalog';
import { capaLabel, sizeText } from '../../domain/products';
import { cleanCode } from '../../lib/barcode';
import { fmtDate } from '../../lib/time';
import type { LabelSpec } from '../../lib/labels-pdf';

/** Dirección de la app (en GitHub Pages: https://rengifojjrr.github.io/cafe-el-mio/gestion/). */
export function appBaseUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

export function productUrl(line: LineId, productId: string): string {
  return `${appBaseUrl()}#/${line}/catalogo/${productId}`;
}

export function codeUrl(line: LineId, code: string): string {
  return `${appBaseUrl()}#/${line}/codigos?c=${encodeURIComponent(cleanCode(code))}`;
}

/** El código de la etiqueta: el código de barras del producto o, si no tiene, su SKU. */
export function labelCode(p: Pick<Product, 'barcode' | 'sku'>): string {
  return p.barcode || p.sku;
}

/** Líneas cortas bajo el nombre: «Toro · 6 × 52» y «Capa Maduro» (o peso y molido en café). */
export function labelLines(line: LineId, p: Pick<Product, 'attrs'>): string[] {
  const a = p.attrs;
  if (line === 'tabaco') {
    const vitola = [a.vitola ? String(a.vitola) : '', sizeText(a)].filter(Boolean).join(' · ');
    return [vitola, a.capa ? `Capa ${capaLabel(a.capa)}` : ''].filter(Boolean);
  }
  return [[a.weight, a.grind].filter(Boolean).map(String).join(' · '), a.roast ? `Tueste ${String(a.roast)}` : ''].filter(Boolean);
}

export function productLabel(line: LineId, p: Product | PublicProduct, copies: number): LabelSpec {
  return { title: p.name, lines: labelLines(line, p), code: labelCode(p), qr: productUrl(line, p.id), copies };
}

/** Etiqueta de una caja: su número propio en barras y un QR a «Buscar código». */
export function caseLabel(line: LineId, c: CaseUnit, product: Pick<Product, 'name'> | undefined, arrivalCode: string | undefined): LabelSpec {
  const origin = [arrivalCode, c.baleNumber ? `bulto ${c.baleNumber}` : ''].filter(Boolean).join(' · ');
  const people = [c.roller ? `Torció ${c.roller}` : '', c.packer ? `empacó ${c.packer}` : '', c.packedOn ? fmtDate(c.packedOn) : ''].filter(Boolean).join(' · ');
  return { title: product?.name ?? 'Caja', lines: [origin, people].filter(Boolean), code: c.code, qr: codeUrl(line, c.code), copies: 1 };
}
