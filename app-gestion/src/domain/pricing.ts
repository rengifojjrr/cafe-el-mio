// Listas de precios: cuánto paga un local por un producto, por unidad (mazo, tabaco o unidad)
// o por caja. Funciones puras: las usan la factura en firme, la venta rápida, el catálogo y la semilla.
import type { PriceEntry, PriceList, Product, SalePack } from '../data/types';
import { round2 } from '../lib/money';

/** De dónde salió el precio. */
export type PriceSource = 'lista' | 'margen' | 'margen_lista' | 'pvp' | 'producto';

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  lista: 'Precio escrito en la lista',
  margen: '% sobre el costo',
  margen_lista: '% sobre el costo de toda la lista',
  pvp: 'PVP del producto',
  producto: 'Precio al local del producto',
};

export const PRICE_LIST_KIND_LABEL: Record<PriceList['kind'], string> = {
  pvp: 'Público (PVP)',
  local: 'Local',
  mayorista: 'Mayorista',
  otra: 'Otra',
};

export type PricedProduct = Pick<Product, 'id' | 'cost' | 'priceToStore' | 'suggestedRetail' | 'packSize' | 'boxPrice'>;
export type PricingList = Pick<PriceList, 'kind' | 'entries' | 'defaultMarkupPercent'>;

export interface PriceQuote {
  /** Precio por unidad base (mazo, tabaco o unidad). */
  unit: number;
  /** Precio por caja (el de volumen si se llegó a las cajas que pide). */
  box: number;
  /** Precio de lo que se pide: por unidad o por caja. */
  price: number;
  pack: SalePack;
  source: PriceSource;
  /** Se aplicó el precio «desde N cajas». */
  volume: boolean;
}

/** Costo + % redondeado a centavos. */
export function markupPrice(cost: number, percent: number): number {
  return round2(cost * (1 + percent / 100));
}

function entryUnit(product: PricedProduct, entry: PriceEntry): { unit: number; source: PriceSource } | null {
  if (entry.mode === 'markup' && entry.markupPercent !== undefined && Number.isFinite(entry.markupPercent)) {
    return { unit: markupPrice(product.cost, entry.markupPercent), source: 'margen' };
  }
  if (entry.mode === 'fixed') {
    if (entry.unit !== undefined && entry.unit > 0) return { unit: round2(entry.unit), source: 'lista' };
    // Solo con precio por caja: la unidad sale de dividirlo.
    if (entry.box !== undefined && entry.box > 0) return { unit: round2(entry.box / Math.max(1, product.packSize)), source: 'lista' };
  }
  return null;
}

/**
 * Precio de un producto en una lista. Sin entrada para el producto: el % sobre el costo de toda la
 * lista; si no hay, el PVP (en la lista de PVP) o el precio al local del producto. La caja es la de
 * la lista, o la caja propia del producto (solo con su precio al local), o unidad × unidades por caja.
 * «Desde N cajas» cambia el precio por caja cuando se piden al menos N cajas.
 */
export function priceFor(product: PricedProduct, list: PricingList | null | undefined, opts: { pack?: SalePack; qty?: number } = {}): PriceQuote {
  const entry = list?.entries[product.id];
  let unit: number | undefined;
  let source: PriceSource = 'producto';
  let box: number | undefined;
  if (entry) {
    const fromEntry = entryUnit(product, entry);
    if (fromEntry) {
      unit = fromEntry.unit;
      source = fromEntry.source;
    }
    if (entry.box !== undefined && entry.box > 0) box = round2(entry.box);
  }
  if (unit === undefined) {
    if (list?.defaultMarkupPercent !== undefined && Number.isFinite(list.defaultMarkupPercent)) {
      unit = markupPrice(product.cost, list.defaultMarkupPercent);
      source = 'margen_lista';
    } else if (list?.kind === 'pvp') {
      unit = round2(product.suggestedRetail);
      source = 'pvp';
    } else {
      unit = round2(product.priceToStore);
      source = 'producto';
      if (box === undefined && product.boxPrice && product.boxPrice > 0) box = round2(product.boxPrice);
    }
  }
  if (box === undefined) box = round2(unit * Math.max(1, product.packSize));
  const pack = opts.pack ?? 'unidad';
  const qty = opts.qty ?? 1;
  let volume = false;
  if (pack === 'caja' && entry?.volume && entry.volume.box > 0 && entry.volume.minBoxes > 0 && qty >= entry.volume.minBoxes) {
    box = round2(entry.volume.box);
    volume = true;
  }
  return { unit, box, price: pack === 'caja' ? box : unit, pack, source, volume };
}

/** Importe de una línea: cantidad (en su presentación) × precio. */
export function lineAmount(quote: Pick<PriceQuote, 'price'>, packQty: number): number {
  return round2(quote.price * packQty);
}

/**
 * Lo que se entrega (en unidades base) partido en cajas completas y unidades sueltas:
 * 60 mazos con cajas de 50 → 1 caja + 10 mazos. Lo que no viene por caja va por unidad.
 */
export function splitIntoPacks(p: Pick<Product, 'packSize'>, qty: number): { pack: SalePack; packQty: number; qty: number }[] {
  if (qty <= 0) return [];
  if (p.packSize <= 1) return [{ pack: 'unidad', packQty: qty, qty }];
  const boxes = Math.floor(qty / p.packSize);
  const rest = qty - boxes * p.packSize;
  const out: { pack: SalePack; packQty: number; qty: number }[] = [];
  if (boxes > 0) out.push({ pack: 'caja', packQty: boxes, qty: boxes * p.packSize });
  if (rest > 0) out.push({ pack: 'unidad', packQty: rest, qty: rest });
  return out;
}

/** Unidades base de una cantidad en su presentación. */
export function baseQty(p: Pick<Product, 'packSize'>, pack: SalePack, packQty: number): number {
  return pack === 'caja' ? packQty * Math.max(1, p.packSize) : packQty;
}
