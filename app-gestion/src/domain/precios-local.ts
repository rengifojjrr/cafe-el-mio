// El precio de cada local. El vendedor le pone a cada local su precio, producto por producto; nunca
// menos que el precio base del producto (sin precio propio, el local paga el base). En consignación,
// lo que se le deja guarda su precio y su base de ese día (`Movement.unitPrice` y `basePrice`): lo que
// se vende después se cobra a ese precio, lo más viejo primero, aunque el precio cambie.
import type { Location, Movement, Product, Store } from '../data/types';
import { round2 } from '../lib/money';

/** Lo que paga este local por unidad de un producto: su precio propio o, si no tiene (o es menor), el base. */
export function precioDelLocal(store: Pick<Store, 'precios'> | undefined, p: Pick<Product, 'id' | 'priceToStore'>): number {
  const propio = store?.precios?.[p.id];
  return round2(propio !== undefined && Number.isFinite(propio) && propio >= p.priceToStore ? propio : p.priceToStore);
}

/** Unidades que el local tiene a un mismo precio y con un mismo precio base. */
export interface Capa {
  qty: number;
  unitPrice: number;
  basePrice: number;
}

const enLocal = (loc: Location, storeId: string) => loc.kind === 'store' && loc.storeId === storeId;

/**
 * Lo que el local tiene hoy de un producto, por capas, lo más viejo primero: cada entrada al local
 * (una entrega) agrega una capa a su precio; cada salida (venta, devolución, merma) se lleva lo más
 * viejo. Lo dejado antes de los precios por local no tiene precio guardado: vale `base` (el precio
 * base de hoy, como antes).
 */
export function capasDelLocal(movs: readonly Movement[], storeId: string, productId: string, base: number): Capa[] {
  const entra = (m: Movement) => (enLocal(m.to, storeId) ? 0 : 1);
  const propios = movs
    .filter((m) => m.productId === productId && (enLocal(m.to, storeId) || enLocal(m.from, storeId)))
    // En el mismo instante, lo que entra va antes que lo que sale (no se vende lo que no llegó).
    .sort((a, b) => a.at.localeCompare(b.at) || entra(a) - entra(b) || a.id.localeCompare(b.id));
  const capas: Capa[] = [];
  for (const m of propios) {
    const entra = enLocal(m.to, storeId);
    const sale = enLocal(m.from, storeId);
    if (entra && !sale) capas.push({ qty: m.qty, unitPrice: round2(m.unitPrice ?? base), basePrice: round2(m.basePrice ?? m.unitPrice ?? base) });
    else if (sale && !entra) consumir(capas, m.qty, base);
  }
  return capas;
}

/**
 * Saca `qty` de las capas, lo más viejo primero (cambia `capas`), y devuelve qué salió a qué precio,
 * juntando lo que tiene el mismo precio y la misma base. Si se pide más de lo que hay (no debería: el
 * libro no lo deja), lo que falta va al precio base de hoy.
 */
export function consumir(capas: Capa[], qty: number, base: number): Capa[] {
  const out: Capa[] = [];
  const agregar = (c: Capa) => {
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.unitPrice === c.unitPrice && ultimo.basePrice === c.basePrice) ultimo.qty += c.qty;
    else out.push({ ...c });
  };
  let falta = qty;
  while (falta > 0 && capas.length) {
    const c = capas[0]!;
    const toma = Math.min(c.qty, falta);
    agregar({ qty: toma, unitPrice: c.unitPrice, basePrice: c.basePrice });
    c.qty -= toma;
    falta -= toma;
    if (c.qty <= 0) capas.shift();
  }
  if (falta > 0) agregar({ qty: falta, unitPrice: round2(base), basePrice: round2(base) });
  return out;
}

/**
 * Reparte los lotes de lo vendido (costo, por lote, lo más viejo primero) entre las partes a cada
 * precio (también lo más viejo primero): cada parte se lleva sus unidades con su costo.
 */
export function repartirLotes<P extends { qty: number }>(
  partes: readonly P[],
  lotes: readonly { lotId: string; qty: number; unitCost: number }[],
): (P & { lots: { lotId: string; qty: number; unitCost: number }[]; cost: number })[] {
  const quedan = lotes.map((l) => ({ ...l }));
  return partes.map((parte) => {
    const lots: { lotId: string; qty: number; unitCost: number }[] = [];
    let falta = parte.qty;
    while (falta > 0 && quedan.length) {
      const l = quedan[0]!;
      const toma = Math.min(l.qty, falta);
      lots.push({ lotId: l.lotId, qty: toma, unitCost: l.unitCost });
      l.qty -= toma;
      falta -= toma;
      if (l.qty <= 0) quedan.shift();
    }
    return { ...parte, lots, cost: round2(lots.reduce((s, l) => s + l.qty * l.unitCost, 0)) };
  });
}

/** Valor de lo que el local tiene en consignación, a los precios a los que se le dejó. */
export function valorDeCapas(capas: readonly Capa[]): number {
  return round2(capas.reduce((s, c) => s + c.qty * c.unitPrice, 0));
}

/** Lo que valen las primeras `qty` unidades de las capas (lo más viejo primero), sin tocarlas. */
export function importeDeCapas(capas: readonly Pick<Capa, 'qty' | 'unitPrice'>[], qty: number, base: number): number {
  return valorDeCapas(consumir(capas.map((c) => ({ qty: c.qty, unitPrice: c.unitPrice, basePrice: c.unitPrice })), qty, base));
}
