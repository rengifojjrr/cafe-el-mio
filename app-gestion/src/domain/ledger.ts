// Libro de movimientos: el inventario sale de aquí y de ningún número editable a mano.
// Cada movimiento lleva una cantidad de un lote de un lugar a otro. El almacén y cada
// local son lugares con saldo; proveedor, vendido, merma y ajuste son externos.
import type { Delivery, Location, Lot, Movement } from '../data/types';

export class InsufficientStockError extends Error {
  constructor(
    message: string,
    readonly productId: string,
    readonly available: number,
    readonly requested: number,
  ) {
    super(message);
    this.name = 'InsufficientStockError';
  }
}

export function locKey(loc: Location): string {
  return loc.kind === 'store' ? `store:${loc.storeId}` : loc.kind;
}

export function isTracked(loc: Location): boolean {
  return loc.kind === 'warehouse' || loc.kind === 'store';
}

export const WAREHOUSE: Location = { kind: 'warehouse' };
export const storeLoc = (storeId: string): Location => ({ kind: 'store', storeId });

/** Saldo por lugar, producto y lote (índice anidado para que consultar sea barato). */
export class Balances {
  /** «lugar|producto» → (lote → cantidad) */
  private readonly map = new Map<string, Map<string, number>>();

  static from(movements: readonly Movement[]): Balances {
    const b = new Balances();
    for (const m of movements) b.apply(m);
    return b;
  }

  apply(m: Movement): void {
    if (isTracked(m.from)) this.add(locKey(m.from), m.productId, m.lotId, -m.qty);
    if (isTracked(m.to)) this.add(locKey(m.to), m.productId, m.lotId, m.qty);
  }

  private add(loc: string, productId: string, lotId: string, delta: number): void {
    const k = `${loc}|${productId}`;
    let lots = this.map.get(k);
    if (!lots) {
      lots = new Map();
      this.map.set(k, lots);
    }
    lots.set(lotId, (lots.get(lotId) ?? 0) + delta);
  }

  /** Saldo de un producto en un lugar (todos sus lotes, o uno). */
  qty(loc: Location, productId: string, lotId?: string): number {
    const lots = this.map.get(`${locKey(loc)}|${productId}`);
    if (!lots) return 0;
    if (lotId) return lots.get(lotId) ?? 0;
    let total = 0;
    for (const v of lots.values()) total += v;
    return total;
  }

  /** Lotes con saldo positivo de un producto en un lugar. */
  lots(loc: Location, productId: string): { lotId: string; qty: number }[] {
    const lots = this.map.get(`${locKey(loc)}|${productId}`);
    if (!lots) return [];
    const out: { lotId: string; qty: number }[] = [];
    for (const [lotId, qty] of lots) if (qty > 0) out.push({ lotId, qty });
    return out;
  }

  /** Todos los saldos de un lugar: producto → cantidad. */
  byProduct(loc: Location): Map<string, number> {
    const prefix = `${locKey(loc)}|`;
    const out = new Map<string, number>();
    for (const [k, lots] of this.map) {
      if (!k.startsWith(prefix)) continue;
      let total = 0;
      for (const v of lots.values()) total += v;
      out.set(k.slice(prefix.length), total);
    }
    return out;
  }

  /** Locales con saldo de un producto (para «en consignación en locales»). */
  storesHolding(productId: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const [k, lots] of this.map) {
      const sep = k.lastIndexOf('|');
      const loc = k.slice(0, sep);
      if (k.slice(sep + 1) !== productId || !loc.startsWith('store:')) continue;
      let total = 0;
      for (const v of lots.values()) total += v;
      if (total !== 0) out.set(loc.slice(6), total);
    }
    return out;
  }

  /** Todo lo que hay en locales, por producto. */
  consignmentTotals(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [k, lots] of this.map) {
      if (!k.startsWith('store:')) continue;
      const productId = k.slice(k.lastIndexOf('|') + 1);
      let total = 0;
      for (const v of lots.values()) total += v;
      out.set(productId, (out.get(productId) ?? 0) + total);
    }
    return out;
  }

  /** Recorre cada saldo (lugar, producto, lote, cantidad). */
  entries(): { loc: string; productId: string; lotId: string; qty: number }[] {
    const out: { loc: string; productId: string; lotId: string; qty: number }[] = [];
    for (const [k, lots] of this.map) {
      const sep = k.lastIndexOf('|');
      for (const [lotId, qty] of lots) out.push({ loc: k.slice(0, sep), productId: k.slice(sep + 1), lotId, qty });
    }
    return out;
  }
}

/** Orden de salida: primero lo que vence antes (café) y, si no, lo que llegó primero. */
export function lotOrder(lot: Lot | undefined): string {
  if (!lot) return '9999';
  return lot.bestBefore ?? lot.receivedAt;
}

/**
 * Reparte `qty` entre los lotes disponibles de un lugar en orden FEFO/FIFO.
 * Lanza InsufficientStockError si no alcanza: nunca deja saldo negativo.
 */
export function allocate(
  balances: Balances,
  lotsById: ReadonlyMap<string, Lot>,
  loc: Location,
  productId: string,
  qty: number,
  productName = 'el producto',
): { lotId: string; qty: number }[] {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('La cantidad tiene que ser un número entero mayor que cero.');
  const available = balances
    .lots(loc, productId)
    .sort((a, b) => lotOrder(lotsById.get(a.lotId)).localeCompare(lotOrder(lotsById.get(b.lotId))));
  const total = available.reduce((s, l) => s + l.qty, 0);
  if (total < qty) {
    const where = loc.kind === 'warehouse' ? 'en el almacén' : 'en el local';
    throw new InsufficientStockError(
      `No alcanza: hay ${total} de ${productName} ${where} y se piden ${qty}.`,
      productId,
      total,
      qty,
    );
  }
  const out: { lotId: string; qty: number }[] = [];
  let left = qty;
  for (const l of available) {
    if (left === 0) break;
    const take = Math.min(l.qty, left);
    out.push({ lotId: l.lotId, qty: take });
    left -= take;
  }
  return out;
}

/**
 * Reproduce el libro en orden de fecha y comprueba que ningún lugar con saldo
 * (almacén o local) quede negativo en ningún momento. Devuelve el primer error.
 */
export function findNegative(movements: readonly Movement[]): string | null {
  const sorted = [...movements].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const b = new Balances();
  for (const m of sorted) {
    b.apply(m);
    if (isTracked(m.from) && b.qty(m.from, m.productId, m.lotId) < 0) {
      return `Saldo negativo en ${locKey(m.from)} para ${m.productId} (lote ${m.lotId}) tras el movimiento ${m.id}.`;
    }
  }
  return null;
}

/** Lo que está preparado para una entrega y todavía no salió: se aparta del disponible. */
export function reservedByProduct(deliveries: readonly Delivery[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of deliveries) {
    if (d.status !== 'preparada') continue;
    for (const it of d.items) {
      const q = it.preparedQty ?? it.qty;
      out.set(it.productId, (out.get(it.productId) ?? 0) + q);
    }
  }
  return out;
}
