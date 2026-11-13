// Productos: familias y variantes, unidades (tabaco → mazo → caja → bulto) y la capa.
// Funciones puras: las usan el catálogo, la importación de Excel, los pedidos y la semilla.
import type { LineId, Product } from '../data/types';

export interface UnitNames {
  one: string;
  many: string;
}

const UNITS: Record<string, UnitNames> = {
  tabaco: { one: 'tabaco', many: 'tabacos' },
  mazo: { one: 'mazo', many: 'mazos' },
  unidad: { one: 'unidad', many: 'unidades' },
  caja: { one: 'caja', many: 'cajas' },
  bulto: { one: 'bulto', many: 'bultos' },
};

export function unitNames(unit: string): UnitNames {
  return UNITS[unit] ?? { one: unit, many: `${unit}s` };
}

/** Unidad en que se cuenta el producto en el libro (mazo, tabaco o unidad). */
export function unitOf(p: Pick<Product, 'unitName'>): UnitNames {
  return unitNames(p.unitName);
}

const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function countText(qty: number, unit: UnitNames): string {
  return `${int.format(qty)} ${Math.abs(qty) === 1 ? unit.one : unit.many}`;
}

/** «12 mazos», «40 tabacos», «6 unidades». */
export function unitsText(p: Pick<Product, 'unitName'>, qty: number): string {
  return countText(qty, unitOf(p));
}

/** Tabacos por mazo (solo para lo que se cuenta por mazo; 25 si no se dijo). */
export function cigarsPerBundle(p: Pick<Product, 'unitName' | 'attrs'>): number | null {
  if (p.unitName !== 'mazo') return null;
  const n = Number(p.attrs.cigarsPerBundle);
  return Number.isFinite(n) && n > 0 ? n : 25;
}

/** Existencias con su equivalencia: «120 mazos · 3,000 tabacos» o «240 tabacos · 12 cajas». */
export function stockText(p: Pick<Product, 'unitName' | 'attrs' | 'packSize'>, qty: number): string {
  const main = unitsText(p, qty);
  const perBundle = cigarsPerBundle(p);
  if (perBundle) return `${main} · ${countText(qty * perBundle, UNITS.tabaco!)}`;
  if (p.packSize > 1 && qty >= p.packSize && qty % p.packSize === 0) return `${main} · ${countText(qty / p.packSize, UNITS.caja!)}`;
  return main;
}

/** De a cuánto se pide: de a un mazo (lo de mazo) o de a una caja (lo demás). */
export function orderStep(p: Pick<Product, 'unitName' | 'packSize'>): number {
  return p.unitName === 'mazo' ? 1 : Math.max(1, p.packSize);
}

/** Precio al local por caja: el propio o unidades por caja × precio por unidad. */
export function boxPrice(p: Pick<Product, 'priceToStore' | 'packSize' | 'boxPrice'>): number {
  if (p.boxPrice && p.boxPrice > 0) return p.boxPrice;
  return Math.round(p.priceToStore * p.packSize * 100) / 100;
}

/** «Caja de 50 mazos (1,250 tabacos)» o «Caja de 20 tabacos». */
export function packText(p: Pick<Product, 'unitName' | 'attrs' | 'packSize'>): string {
  const perBundle = cigarsPerBundle(p);
  const base = `Caja de ${unitsText(p, p.packSize)}`;
  return perBundle ? `${base} (${countText(p.packSize * perBundle, UNITS.tabaco!)})` : base;
}

// ---------- Capa ----------
export type WrapperShade = 'claro' | 'natural' | 'colorado' | 'rosado' | 'maduro' | 'oscuro' | 'candela';

export interface Capa {
  value: string;
  label: string;
  shade: WrapperShade;
}

/**
 * Las capas que se ofrecen al crear o editar un tabaco (ronda 5, pedido del mayorista): Habano,
 * Maduro, Connecticut y Doble Capa. Doble Capa se dibuja con el tono maduro (por confirmar).
 */
export const CAPAS_OFRECIDAS: readonly Capa[] = [
  { value: 'habano', label: 'Habano', shade: 'colorado' },
  { value: 'maduro', label: 'Maduro', shade: 'maduro' },
  { value: 'connecticut', label: 'Connecticut', shade: 'claro' },
  { value: 'doble_capa', label: 'Doble Capa', shade: 'maduro' },
];

/**
 * Las que ya no se ofrecen. Los productos que las tienen se quedan como están: se siguen viendo con
 * su nombre y su color, y se pueden editar sin perderla.
 */
export const CAPAS_ANTIGUAS: readonly Capa[] = [
  { value: 'natural', label: 'Natural', shade: 'natural' },
  { value: 'corojo', label: 'Corojo', shade: 'colorado' },
  { value: 'criollo', label: 'Criollo', shade: 'colorado' },
  { value: 'sumatra', label: 'Sumatra', shade: 'natural' },
  { value: 'rosado', label: 'Rosado', shade: 'rosado' },
  { value: 'oscuro', label: 'Oscuro (Broadleaf)', shade: 'oscuro' },
  { value: 'candela', label: 'Candela', shade: 'candela' },
];

/** Las que se reconocen al leer datos (las que se ofrecen y las antiguas). */
export const CAPAS_RECONOCIDAS: readonly Capa[] = [...CAPAS_OFRECIDAS, ...CAPAS_ANTIGUAS];

export function capaLabel(value: unknown): string {
  const v = String(value ?? '');
  return CAPAS_RECONOCIDAS.find((c) => c.value === v)?.label ?? v;
}

export function capaShade(value: unknown): WrapperShade {
  return CAPAS_RECONOCIDAS.find((c) => c.value === String(value ?? ''))?.shade ?? 'colorado';
}

/** ¿Una capa que ya no se ofrece (Corojo, Natural…)? */
export function esCapaAntigua(value: unknown): boolean {
  return CAPAS_ANTIGUAS.some((c) => c.value === String(value ?? ''));
}

/** Vitolas que pueden ir después de «doble»/«double» («Doble Corona», «Double Toro»): ahí no es la capa. */
const VITOLA_TRAS_DOBLE = new Set([
  'corona', 'coronas', 'toro', 'toros', 'robusto', 'robustos', 'churchill', 'perfecto', 'torpedo', 'piramide', 'pyramid',
  'belicoso', 'lancero', 'panetela', 'gordo', 'figurado', 'lonsdale', 'rothschild', 'presidente', 'diadema', 'gigante',
  'salomon', 'sublime', 'aleta', 'nub', 'coronita',
]);

/**
 * ¿Dice «Doble Capa» en la palabra `i`? Devuelve cuántas palabras ocupa: 2 para «doble capa» o
 * «double wrapper», 1 para «doble» o «double» solos, 0 si no. Las palabras ya van normalizadas y sin
 * signos. «Doble Corona», «Double Toro»… son vitolas, no la capa.
 */
export function dobleCapaEn(words: readonly string[], i: number): number {
  const w = words[i];
  // «Doble-Capa» o «DoubleWrapper» escritos juntos (así llegan del nombre de un Excel).
  if (w === 'doblecapa' || w === 'doublewrapper') return 1;
  if (w !== 'doble' && w !== 'double') return 0;
  const next = words[i + 1] ?? '';
  if (VITOLA_TRAS_DOBLE.has(next)) return 0;
  return next === 'capa' || next === 'wrapper' ? 2 : 1;
}

/** «Doble capa», «doble», «double wrapper» o «double» en un texto libre (no «Doble Corona»). */
export function esDobleCapa(text: string): boolean {
  const words = normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((_, i) => dobleCapaEn(words, i) > 0);
}

/** Reconoce la capa en un texto libre («Maduro San Andrés», «HABANO», «connecticut shade», «doble capa»…). */
export function capaFromText(text: unknown): string | null {
  const t = normalize(String(text ?? ''));
  if (!t) return null;
  if (esDobleCapa(t)) return 'doble_capa';
  if (/broadleaf|oscuro/.test(t)) return 'oscuro';
  for (const c of CAPAS_RECONOCIDAS) if (t.includes(c.value)) return c.value;
  if (/colorado/.test(t)) return 'habano';
  return null;
}

// ---------- Medidas ----------
const FRACTIONS: Record<number, string> = { 0.125: '⅛', 0.25: '¼', 0.375: '⅜', 0.5: '½', 0.625: '⅝', 0.75: '¾', 0.875: '⅞' };

/** 6.125 → «6⅛». */
export function fmtInches(inches: number): string {
  const whole = Math.floor(inches);
  const frac = Math.round((inches - whole) * 1000) / 1000;
  if (!frac) return String(whole);
  return `${whole}${FRACTIONS[frac] ?? `.${String(frac).slice(2)}`}`;
}

/** «6 × 52» (largo en pulgadas × cepo). */
export function sizeText(attrs: Product['attrs']): string {
  const len = Number(attrs.lengthIn);
  const ring = Number(attrs.ringGauge);
  if (!len || !ring) return '';
  return `${fmtInches(len)} × ${ring}`;
}

// ---------- Familias y variantes ----------
/** Para comparar medidas y nombres: «6 × 52», «6x52» y «6X52» son lo mismo. */
function loose(text: string): string {
  return normalize(text).replace(/[×x]/g, 'x').replace(/[^a-z0-9x½¼¾⅛⅜⅝⅞]+/g, '');
}

/**
 * Lo que distingue a una variante: en tabaco, la capa y la medida; en café, el molido y el peso.
 * Lo que ya dice el nombre de la familia no se repite («Toro 6 × 52» + Maduro → «Maduro»).
 */
export function variantLabelFor(line: LineId, attrs: Product['attrs'], familyName = ''): string {
  const parts =
    line === 'tabaco'
      ? [attrs.capa ? capaLabel(attrs.capa) : '', sizeText(attrs)]
      : [attrs.grind, attrs.weight].map((v) => String(v ?? '').trim());
  const fam = loose(familyName);
  return parts.filter((part) => part && !(fam && fam.includes(loose(String(part))))).join(' · ');
}

/** «Toro 6 × 52» + «Maduro» → «Toro 6 × 52 · Maduro». El nombre nunca se escribe a mano con la capa. */
export function composeName(familyName: string, variantLabel: string): string {
  const fam = familyName.trim();
  const keep = variantLabel
    .split(' · ')
    .map((p) => p.trim())
    .filter((p) => p && !loose(fam).includes(loose(p)));
  return keep.length ? `${fam} · ${keep.join(' · ')}` : fam;
}

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function slug(text: string): string {
  return normalize(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Id estable de la familia: la misma familia (tipo, marca y nombre) siempre da el mismo id. */
export function familyIdFor(line: LineId, familyName: string, kind?: string, brand?: string): string {
  return `fam-${line}-${slug([kind ?? '', brand ?? '', familyName].filter(Boolean).join(' '))}`;
}

export function familyKey(p: Pick<Product, 'id' | 'familyId'>): string {
  return p.familyId ?? p.id;
}

export function familyNameOf(p: Pick<Product, 'name' | 'familyName'>): string {
  return p.familyName ?? p.name;
}

/** Texto en el que se busca: nombre, familia, variante, SKU, código y atributos. */
export function searchText(p: Pick<Product, 'name' | 'sku' | 'brandLine' | 'attrs'> & Partial<Pick<Product, 'familyName' | 'variantLabel' | 'barcode'>>): string {
  const attrs = Object.values(p.attrs).map(String);
  const capa = p.attrs.capa ? capaLabel(p.attrs.capa) : '';
  return normalize([p.name, p.familyName, p.variantLabel, p.sku, p.barcode, p.brandLine, capa, ...attrs].filter(Boolean).join(' '));
}

/** Cantidad que se propone al pedir: 10 mazos o una caja. */
export function defaultOrderQty(p: Pick<Product, 'unitName' | 'packSize'>): number {
  return p.unitName === 'mazo' ? 10 : Math.max(1, p.packSize);
}

/** Suma por unidad: «15 mazos y 40 tabacos». */
export function mixedUnitsText(items: readonly { product: Pick<Product, 'unitName'>; qty: number }[]): string {
  const byUnit = new Map<string, number>();
  for (const it of items) if (it.qty) byUnit.set(it.product.unitName, (byUnit.get(it.product.unitName) ?? 0) + it.qty);
  const parts = [...byUnit].map(([unit, qty]) => countText(qty, unitNames(unit)));
  if (parts.length <= 1) return parts[0] ?? countText(0, unitNames('unidad'));
  return `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
}
