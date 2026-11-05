// Almacén, llegadas (importaciones o lotes de tostado) y el libro de movimientos.
import { z } from 'zod';
import type { Arrival, ArrivalStatus, Delivery, IsoDate, Lot, Movement, Product, Warehouse } from '../data/types';
import { Balances, InsufficientStockError, WAREHOUSE, allocate, reservedByProduct } from '../domain/ledger';
import { round2 } from '../lib/money';
import { addDaysToDate, daysBetween, toIsoDate } from '../lib/time';
import { type Ctx, NotFoundError, ValidationError, audit, getSettings, guard, mutate, notify, nowIso } from './context';

export interface InventorySnapshot {
  products: Product[];
  productsById: Map<string, Product>;
  lots: Lot[];
  lotsById: Map<string, Lot>;
  movements: Movement[];
  balances: Balances;
  deliveries: Delivery[];
  reserved: Map<string, number>;
  arrivals: Arrival[];
}

/** Lee lo necesario para calcular stock. Uso interno de los servicios. */
export async function loadInventory(ctx: Ctx): Promise<InventorySnapshot> {
  const [products, lots, movements, deliveries, arrivals] = await Promise.all([
    ctx.repo.products.all(),
    ctx.repo.lots.all(),
    ctx.repo.movements.all(),
    ctx.repo.deliveries.all(),
    ctx.repo.arrivals.all(),
  ]);
  return {
    products,
    productsById: new Map(products.map((p) => [p.id, p])),
    lots,
    lotsById: new Map(lots.map((l) => [l.id, l])),
    movements,
    balances: Balances.from(movements),
    deliveries,
    reserved: reservedByProduct(deliveries),
    arrivals,
  };
}

export interface NextArrival {
  arrivalId: string;
  code: string;
  qty: number;
  eta: IsoDate;
  status: ArrivalStatus;
  inDays: number;
}

export interface StockLine {
  productId: string;
  warehouse: number;
  reserved: number;
  available: number;
  consignment: number;
  storesHolding: number;
  nextArrival?: NextArrival;
  lowStock: boolean;
  /** Café: unidades en almacén que vencen dentro del aviso. */
  expiringSoon: number;
}

export function pendingArrivals(arrivals: readonly Arrival[]): Arrival[] {
  return arrivals
    .filter((a) => a.status !== 'recibida' && a.status !== 'cancelada')
    .sort((a, b) => a.eta.localeCompare(b.eta));
}

export function nextArrivalFor(arrivals: readonly Arrival[], productId: string, now: Date): NextArrival | undefined {
  for (const a of pendingArrivals(arrivals)) {
    const item = a.items.find((i) => i.productId === productId);
    if (item) {
      return { arrivalId: a.id, code: a.code, qty: item.qty, eta: a.eta, status: a.status, inDays: daysBetween(now, a.eta) };
    }
  }
  return undefined;
}

export function stockLines(snap: InventorySnapshot, now: Date, expiryWarningDays: number): Map<string, StockLine> {
  const consign = snap.balances.consignmentTotals();
  const today = toIsoDate(now);
  const limit = addDaysToDate(today, expiryWarningDays);
  const out = new Map<string, StockLine>();
  for (const p of snap.products) {
    const warehouse = snap.balances.qty(WAREHOUSE, p.id);
    const reserved = snap.reserved.get(p.id) ?? 0;
    const available = Math.max(0, warehouse - reserved);
    let expiringSoon = 0;
    for (const l of snap.balances.lots(WAREHOUSE, p.id)) {
      const lot = snap.lotsById.get(l.lotId);
      if (lot?.bestBefore && lot.bestBefore <= limit) expiringSoon += l.qty;
    }
    out.set(p.id, {
      productId: p.id,
      warehouse,
      reserved,
      available,
      consignment: consign.get(p.id) ?? 0,
      storesHolding: [...snap.balances.storesHolding(p.id).values()].filter((q) => q > 0).length,
      nextArrival: nextArrivalFor(snap.arrivals, p.id, now),
      lowStock: p.active && available <= p.lowStockThreshold,
      expiringSoon,
    });
  }
  return out;
}

// ---------- Lecturas ----------

export async function getWarehouse(ctx: Ctx): Promise<Warehouse> {
  guard(ctx, 'inventory.read');
  const w = await ctx.repo.warehouses.get('almacen');
  if (!w) throw new NotFoundError('el almacén');
  return w;
}

export async function stockSummary(ctx: Ctx): Promise<{ products: Product[]; lines: Map<string, StockLine> }> {
  guard(ctx, 'inventory.read');
  const [snap, settings] = await Promise.all([loadInventory(ctx), getSettings(ctx)]);
  return { products: snap.products, lines: stockLines(snap, ctx.now(), settings.expiryWarningDays) };
}

export interface LotLine {
  lot: Lot;
  product: Product;
  warehouse: number;
  inStores: number;
  daysToExpiry?: number;
}

/** Lotes con saldo (en almacén o en locales). Solo administración: lleva costos. */
export async function listLots(ctx: Ctx): Promise<LotLine[]> {
  guard(ctx, 'inventory.write');
  const snap = await loadInventory(ctx);
  const now = ctx.now();
  const out: LotLine[] = [];
  for (const lot of snap.lots) {
    const product = snap.productsById.get(lot.productId);
    if (!product) continue;
    const warehouse = snap.balances.qty(WAREHOUSE, lot.productId, lot.id);
    let inStores = 0;
    for (const e of snap.balances.entries()) {
      if (e.lotId === lot.id && e.loc.startsWith('store:')) inStores += e.qty;
    }
    if (warehouse <= 0 && inStores <= 0) continue;
    out.push({
      lot,
      product,
      warehouse,
      inStores,
      daysToExpiry: lot.bestBefore ? daysBetween(now, lot.bestBefore) : undefined,
    });
  }
  return out.sort((a, b) => (a.lot.bestBefore ?? a.lot.receivedAt).localeCompare(b.lot.bestBefore ?? b.lot.receivedAt));
}

export interface MovementView extends Movement {
  productName: string;
  lotCode: string;
  storeName?: string;
}

export async function listMovements(ctx: Ctx, filter?: { productId?: string; storeId?: string; limit?: number }): Promise<MovementView[]> {
  guard(ctx, 'inventory.write');
  const [snap, stores] = await Promise.all([loadInventory(ctx), ctx.repo.stores.all()]);
  const storesById = new Map(stores.map((s) => [s.id, s]));
  let list = snap.movements;
  if (filter?.productId) list = list.filter((m) => m.productId === filter.productId);
  if (filter?.storeId) list = list.filter((m) => m.storeId === filter.storeId);
  return list
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, filter?.limit ?? 200)
    .map((m) => ({
      ...m,
      productName: snap.productsById.get(m.productId)?.name ?? m.productId,
      lotCode: snap.lotsById.get(m.lotId)?.code ?? m.lotId,
      storeName: m.storeId ? storesById.get(m.storeId)?.name : undefined,
    }));
}

export async function listArrivals(ctx: Ctx): Promise<Arrival[]> {
  guard(ctx, 'inventory.read');
  const list = await ctx.repo.arrivals.all();
  const pending = pendingArrivals(list);
  const done = list.filter((a) => a.status === 'recibida' || a.status === 'cancelada').sort((a, b) => b.eta.localeCompare(a.eta));
  return [...pending, ...done];
}

export interface InventoryAlert {
  kind: 'stock_bajo' | 'por_vencer_almacen' | 'por_vencer_local' | 'vencido_local';
  productId: string;
  productName: string;
  storeId?: string;
  storeName?: string;
  qty: number;
  detail: string;
}

/** Avisos de stock bajo y de café por vencer (en almacén o en un local). */
export async function inventoryAlerts(ctx: Ctx): Promise<InventoryAlert[]> {
  guard(ctx, 'inventory.read');
  const [snap, settings, stores] = await Promise.all([loadInventory(ctx), getSettings(ctx), ctx.repo.stores.all()]);
  const now = ctx.now();
  const lines = stockLines(snap, now, settings.expiryWarningDays);
  const out: InventoryAlert[] = [];
  for (const p of snap.products) {
    const l = lines.get(p.id);
    if (!l || !p.active) continue;
    if (l.lowStock) {
      const next = l.nextArrival ? ` Llegan ${l.nextArrival.qty} ${l.nextArrival.inDays >= 0 ? `en ${l.nextArrival.inDays} días` : 'pronto'}.` : ' No hay llegada programada.';
      out.push({
        kind: 'stock_bajo',
        productId: p.id,
        productName: p.name,
        qty: l.available,
        detail: `Quedan ${l.available} disponibles (aviso en ${p.lowStockThreshold}).${next}`,
      });
    }
    if (l.expiringSoon > 0) {
      out.push({
        kind: 'por_vencer_almacen',
        productId: p.id,
        productName: p.name,
        qty: l.expiringSoon,
        detail: `${l.expiringSoon} en el almacén vencen en menos de ${settings.expiryWarningDays} días.`,
      });
    }
  }
  // Café por vencer en locales: lo ve administración y el vendedor del local.
  const today = toIsoDate(now);
  const limit = addDaysToDate(today, Math.min(settings.expiryWarningDays, 21));
  const storesById = new Map(stores.map((s) => [s.id, s]));
  for (const e of snap.balances.entries()) {
    if (!e.loc.startsWith('store:') || e.qty <= 0) continue;
    const lot = snap.lotsById.get(e.lotId);
    if (!lot?.bestBefore || lot.bestBefore > limit) continue;
    const storeId = e.loc.slice(6);
    const store = storesById.get(storeId);
    if (!store) continue;
    if (ctx.actor.role === 'seller' && store.sellerId !== ctx.actor.userId) continue;
    if (ctx.actor.role === 'store' && store.id !== ctx.actor.storeId) continue;
    const product = snap.productsById.get(e.productId);
    const days = daysBetween(now, lot.bestBefore);
    out.push({
      kind: days < 0 ? 'vencido_local' : 'por_vencer_local',
      productId: e.productId,
      productName: product?.name ?? e.productId,
      storeId,
      storeName: store.name,
      qty: e.qty,
      detail:
        days < 0
          ? `${e.qty} en ${store.name} vencieron hace ${-days} días (lote ${lot.code}). Retíralos en la próxima visita.`
          : `${e.qty} en ${store.name} vencen ${days === 0 ? 'hoy' : `en ${days} días`} (lote ${lot.code}). Cámbialos en la próxima visita.`,
    });
  }
  if (ctx.actor.role !== 'admin') return out.filter((a) => a.kind !== 'stock_bajo' && a.kind !== 'por_vencer_almacen');
  return out;
}

// ---------- Escrituras (administración) ----------

const arrivalSchema = z.object({
  supplier: z.string().trim().min(2, 'Escribe el proveedor o la línea de producción.'),
  originCountry: z.string().trim().default(''),
  eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige una fecha.'),
  productionLine: z.string().optional(),
  bestBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().default(''),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        qty: z.number().int('Las cantidades son números enteros.').positive('Cada cantidad tiene que ser mayor que cero.'),
        unitCost: z.number().nonnegative(),
      }),
    )
    .min(1, 'Agrega al menos un producto.'),
});
export type ArrivalInput = z.input<typeof arrivalSchema>;

export async function createArrival(ctx: Ctx, input: ArrivalInput): Promise<Arrival> {
  guard(ctx, 'inventory.write');
  const data = arrivalSchema.parse(input);
  if (ctx.config.inbound === 'import' && /cuba/i.test(data.originCountry)) {
    throw new ValidationError('No se importa tabaco de origen Cuba (embargo de EE. UU.).');
  }
  return mutate(ctx, async () => {
    const count = await ctx.repo.arrivals.count();
    const year = ctx.now().getFullYear();
    const roast = ctx.config.inbound === 'roast';
    const at = nowIso(ctx);
    const status: ArrivalStatus = roast ? 'programado' : 'produccion';
    const arrival: Arrival = {
      id: ctx.newId('arr'),
      kind: roast ? 'roast' : 'import',
      code: roast ? `TOST-${year}-${String(count + 1).padStart(3, '0')}` : `IMP-${year}-${String(count + 1).padStart(3, '0')}`,
      status,
      eta: data.eta,
      supplier: data.supplier,
      originCountry: data.originCountry,
      productionLine: data.productionLine,
      bestBefore: data.bestBefore,
      items: data.items,
      notes: data.notes,
      createdAt: at,
      statusHistory: [{ status, at }],
    };
    await ctx.repo.arrivals.put(arrival);
    await audit(ctx, 'llegada.crear', 'arrival', arrival.id, `Nueva ${roast ? 'tanda de tostado' : 'importación'} ${arrival.code}`);
    return arrival;
  });
}

export async function setArrivalStatus(ctx: Ctx, arrivalId: string, status: ArrivalStatus, eta?: IsoDate): Promise<void> {
  guard(ctx, 'inventory.write');
  if (status === 'recibida') return receiveArrival(ctx, arrivalId);
  await mutate(ctx, async () => {
    const a = await ctx.repo.arrivals.get(arrivalId);
    if (!a) throw new NotFoundError('la llegada');
    if (a.status === 'recibida') throw new ValidationError('Esta llegada ya se recibió.');
    a.status = status;
    if (eta) a.eta = eta;
    a.statusHistory.push({ status, at: nowIso(ctx) });
    await ctx.repo.arrivals.put(a);
    await audit(ctx, 'llegada.estado', 'arrival', a.id, `${a.code} pasa a «${status}»`);
  });
}

/** Recibir una llegada crea un lote por producto y suma al almacén con un movimiento de entrada. */
export async function receiveArrival(ctx: Ctx, arrivalId: string): Promise<void> {
  guard(ctx, 'inventory.write');
  await mutate(ctx, async () => {
    const a = await ctx.repo.arrivals.get(arrivalId);
    if (!a) throw new NotFoundError('la llegada');
    if (a.status === 'recibida') throw new ValidationError('Esta llegada ya se recibió.');
    if (a.status === 'cancelada') throw new ValidationError('Esta llegada está cancelada.');
    const at = nowIso(ctx);
    const today = toIsoDate(ctx.now());
    for (const [i, item] of a.items.entries()) {
      const lot: Lot = {
        id: ctx.newId('lot'),
        productId: item.productId,
        code: `${a.code}-${i + 1}`,
        arrivalId: a.id,
        unitCost: item.unitCost,
        receivedAt: at,
        producedOn: a.kind === 'roast' ? (a.eta <= today ? a.eta : today) : undefined,
        bestBefore: a.kind === 'roast' ? (a.bestBefore ?? addDaysToDate(today, 180)) : undefined,
        productionLine: a.productionLine,
      };
      await ctx.repo.lots.put(lot);
      const mv: Movement = {
        id: ctx.newId('mov'),
        at,
        type: 'entrada',
        productId: item.productId,
        lotId: lot.id,
        qty: item.qty,
        from: { kind: 'supplier' },
        to: WAREHOUSE,
        storeId: null,
        refType: 'arrival',
        refId: a.id,
        actorId: ctx.actor.userId,
      };
      await ctx.repo.movements.put(mv);
    }
    a.status = 'recibida';
    a.receivedAt = at;
    a.statusHistory.push({ status: 'recibida', at });
    await ctx.repo.arrivals.put(a);
    const units = a.items.reduce((s, i) => s + i.qty, 0);
    await audit(ctx, 'llegada.recibir', 'arrival', a.id, `Recibida ${a.code}: ${units} unidades al almacén`);
    const sellers = await ctx.repo.users.where('role', 'seller');
    await notify(
      ctx,
      [...sellers.map((s) => s.id), ...(await ctx.repo.users.where('role', 'admin')).map((u) => u.id)],
      'llegada_recibida',
      `Llegó ${a.code}`,
      `${units} unidades nuevas en el almacén.`,
      `/${ctx.line}/catalogo`,
    );
  });
}

const adjustSchema = z.object({
  productId: z.string().min(1),
  lotId: z.string().min(1),
  delta: z.number().int().refine((n) => n !== 0, 'El ajuste no puede ser cero.'),
  reason: z.string().trim().min(3, 'Explica el motivo del ajuste.'),
});

/** Ajuste de inventario del almacén (por conteo físico). Nunca deja saldo negativo. */
export async function adjustWarehouse(ctx: Ctx, input: z.input<typeof adjustSchema>): Promise<void> {
  guard(ctx, 'inventory.write');
  const data = adjustSchema.parse(input);
  await mutate(ctx, async () => {
    const snap = await loadInventory(ctx);
    const current = snap.balances.qty(WAREHOUSE, data.productId, data.lotId);
    if (current + data.delta < 0) {
      throw new InsufficientStockError(`El lote tiene ${current}; no se pueden quitar ${-data.delta}.`, data.productId, current, -data.delta);
    }
    const mv: Movement = {
      id: ctx.newId('mov'),
      at: nowIso(ctx),
      type: 'ajuste',
      productId: data.productId,
      lotId: data.lotId,
      qty: Math.abs(data.delta),
      from: data.delta > 0 ? { kind: 'adjustment' } : WAREHOUSE,
      to: data.delta > 0 ? WAREHOUSE : { kind: 'adjustment' },
      storeId: null,
      refType: 'adjust',
      refId: ctx.newId('adj'),
      reason: data.reason,
      actorId: ctx.actor.userId,
    };
    await ctx.repo.movements.put(mv);
    await audit(ctx, 'almacen.ajuste', 'movement', mv.id, `Ajuste de ${data.delta > 0 ? '+' : ''}${data.delta}: ${data.reason}`);
  });
}

/** Merma en el almacén (rotura, humedad…). */
export async function warehouseShrink(ctx: Ctx, input: { productId: string; qty: number; reason: string }): Promise<void> {
  guard(ctx, 'inventory.write');
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new ValidationError('La cantidad tiene que ser mayor que cero.');
  if (input.reason.trim().length < 3) throw new ValidationError('Explica el motivo de la merma.');
  await mutate(ctx, async () => {
    const snap = await loadInventory(ctx);
    const product = snap.productsById.get(input.productId);
    const parts = allocate(snap.balances, snap.lotsById, WAREHOUSE, input.productId, input.qty, product?.name);
    const at = nowIso(ctx);
    const refId = ctx.newId('ret');
    let cost = 0;
    for (const part of parts) {
      cost += part.qty * (snap.lotsById.get(part.lotId)?.unitCost ?? 0);
      await ctx.repo.movements.put({
        id: ctx.newId('mov'),
        at,
        type: 'merma',
        productId: input.productId,
        lotId: part.lotId,
        qty: part.qty,
        from: WAREHOUSE,
        to: { kind: 'loss' },
        storeId: null,
        refType: 'shrink',
        refId,
        reason: input.reason,
        actorId: ctx.actor.userId,
      });
    }
    await ctx.repo.returns.put({
      id: refId,
      storeId: null,
      kind: 'merma',
      at,
      items: [{ productId: input.productId, qty: input.qty }],
      reason: input.reason,
      photoIds: [],
      createdBy: ctx.actor.userId,
      cost: round2(cost),
    });
    await audit(ctx, 'almacen.merma', 'return', refId, `Merma de ${input.qty} × ${product?.name ?? input.productId}: ${input.reason}`);
  });
}

export async function renameWarehouse(ctx: Ctx, name: string): Promise<void> {
  guard(ctx, 'settings.manage');
  if (name.trim().length < 3) throw new ValidationError('El nombre es muy corto.');
  await mutate(ctx, async () => {
    const w = await ctx.repo.warehouses.get('almacen');
    if (!w) throw new NotFoundError('el almacén');
    w.name = name.trim();
    await ctx.repo.warehouses.put(w);
    const s = await getSettings(ctx);
    s.warehouseName = w.name;
    await ctx.repo.settings.put(s);
    await audit(ctx, 'almacen.renombrar', 'warehouse', w.id, `Almacén ahora se llama «${w.name}»`);
  });
}
