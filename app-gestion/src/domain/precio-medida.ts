// El precio por mazo de un tabaco de mazo sale de su medida: un precio para todas y otro para las
// medidas que se anotan aparte (por ejemplo, las grandes). La regla vive en Ajustes (la cambia
// Administración), nunca en el código. Un precio puesto a mano en un producto manda sobre la regla.
import type { LineSettings, Product } from '../data/types';
import { round2 } from '../lib/money';
import { fmtInches } from './products';

/** Largo en pulgadas × cepo. */
export interface Medida {
  largo: number;
  cepo: number;
}

/** La regla de Ajustes (`LineSettings.precioMazo`). */
export interface ReglaPrecioMazo {
  /** Precio por mazo de las medidas que no están en ninguna lista. */
  precio: number;
  /** Medidas que van a otro precio. */
  especiales: { medidas: Medida[]; precio: number }[];
}

const FRACCIONES: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

/** «6½», «6 1/2», «6-1/2», «6.5» o «6,5» → 6.5. Sin número: NaN. */
export function leerLargo(texto: string): number {
  const t = texto.trim();
  const m = /^(\d+)(?:\s*([½¼¾⅛⅜⅝⅞])|[\s-]+(\d+)\s*\/\s*(\d+)|[.,](\d+))?$/.exec(t);
  if (!m) return Number.NaN;
  const entero = Number(m[1]);
  if (m[2]) return entero + FRACCIONES[m[2]]!;
  if (m[3] && m[4]) return Number(m[4]) > 0 ? entero + Number(m[3]) / Number(m[4]) : Number.NaN;
  if (m[5]) return Number(`${m[1]}.${m[5]}`);
  return entero;
}

// Un largo (con su fracción, si tiene) × un cepo de dos dígitos: «6½ × 64», «6 1/2x64», «6.5 x 64», «7X70».
const PATRON_MEDIDA = /(\d+(?:\s*[½¼¾⅛⅜⅝⅞]|[\s-]+\d+\s*\/\s*\d+|[.,]\d+)?)\s*[x×X*]\s*(\d{2,3})(?!\d)/g;

/** Todas las medidas que aparecen en un texto, sin repetir: «6½ × 64, 7x70» → dos medidas. */
export function leerMedidas(texto: string): Medida[] {
  const out: Medida[] = [];
  for (const m of texto.matchAll(PATRON_MEDIDA)) {
    const largo = leerLargo(m[1]!);
    const cepo = Number(m[2]);
    if (!Number.isFinite(largo) || largo < 2 || largo > 14 || cepo < 20 || cepo > 120) continue;
    const med = { largo: round3(largo), cepo };
    if (!out.some((x) => mismaMedida(x, med))) out.push(med);
  }
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function mismaMedida(a: Medida, b: Medida): boolean {
  return Math.abs(a.largo - b.largo) < 0.01 && a.cepo === b.cepo;
}

/** «6½ × 64». */
export function medidaTexto(m: Medida): string {
  return `${fmtInches(m.largo)} × ${m.cepo}`;
}

/** La medida de un producto, como la guarda la app (largo en pulgadas y cepo). */
export function medidaDe(attrs: Product['attrs'] | undefined): Medida | null {
  const largo = Number(attrs?.lengthIn);
  const cepo = Number(attrs?.ringGauge);
  if (!Number.isFinite(largo) || !Number.isFinite(cepo) || largo <= 0 || cepo <= 0) return null;
  return { largo: round3(largo), cepo };
}

/** La regla se aplica a los tabacos de mazo (su precio es por mazo). */
export function sigueRegla(p: Pick<Product, 'kind'>): boolean {
  return p.kind === 'mazo';
}

/** La regla de Ajustes, si está bien puesta. */
export function reglaDe(settings: Pick<LineSettings, 'precioMazo'> | undefined | null): ReglaPrecioMazo | null {
  const r = settings?.precioMazo;
  if (!r || !(r.precio > 0)) return null;
  return { precio: round2(r.precio), especiales: (r.especiales ?? []).filter((e) => e.precio > 0 && e.medidas.length > 0) };
}

/**
 * El precio por mazo que da la regla para una medida (sin medida: el precio de todas). Si la medida
 * está en más de una lista, manda la primera.
 */
export function precioPorRegla(regla: ReglaPrecioMazo, medida: Medida | null): number {
  if (medida) {
    for (const e of regla.especiales) if (e.medidas.some((m) => mismaMedida(m, medida))) return round2(e.precio);
  }
  return round2(regla.precio);
}

/** «Precio por mazo: $35.00; 6½ × 64, 7 × 70 → $40.00». */
export function reglaTexto(regla: ReglaPrecioMazo, fmt: (n: number) => string): string {
  const partes = [`Precio por mazo: ${fmt(regla.precio)}`];
  for (const e of regla.especiales) partes.push(`${e.medidas.map(medidaTexto).join(', ')} → ${fmt(e.precio)}`);
  return partes.join('; ');
}

/** Un cambio de precio que haría «Aplicar a los productos de mazo». */
export interface CambioPrecio {
  productId: string;
  name: string;
  medida: string;
  antes: number;
  despues: number;
}

/**
 * Lo que cambiaría al aplicar la regla a los productos de mazo guardados: los que no tienen precio
 * puesto a mano y cuyo precio no es ya el de la regla.
 */
export function cambiosDeRegla(regla: ReglaPrecioMazo, products: readonly Pick<Product, 'id' | 'name' | 'kind' | 'attrs' | 'priceToStore' | 'precioManual'>[]): { cambios: CambioPrecio[]; aMano: number } {
  const cambios: CambioPrecio[] = [];
  let aMano = 0;
  for (const p of products) {
    if (!sigueRegla(p)) continue;
    if (p.precioManual) {
      aMano += 1;
      continue;
    }
    const medida = medidaDe(p.attrs);
    const despues = precioPorRegla(regla, medida);
    if (round2(p.priceToStore) === despues) continue;
    cambios.push({ productId: p.id, name: p.name, medida: medida ? medidaTexto(medida) : 'sin medida', antes: round2(p.priceToStore), despues });
  }
  return { cambios: cambios.sort((a, b) => a.name.localeCompare(b.name, 'es')), aMano };
}
