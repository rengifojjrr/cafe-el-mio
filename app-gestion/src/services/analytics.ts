// Contabilidad por línea (nunca mezclada), rentabilidad, reportes y datos del mapa.
import type { Product, Store } from '../data/types';
import { WAREHOUSE, storeLoc } from '../domain/ledger';
import { aging, settlementBalance } from '../domain/money-rules';
import { round2 } from '../lib/money';
import { addDays, daysBetween, monthKey } from '../lib/time';
import { type Ctx, guard, getSettings } from './context';
import { loadInventory } from './inventory';
import { scopedStores } from './stores';

export interface PnlMonth {
  month: string;
  revenue: number;
  cogs: number;
  commissions: number;
  shrink: number;
  grossMargin: number;
  units: number;
}

async function loadMoney(ctx: Ctx) {
  const [reports, commissions, returns, settlements, payments, stores, users, zones, reorders, unmet] = await Promise.all([
    ctx.repo.salesReports.all(),
    ctx.repo.commissions.all(),
    ctx.repo.returns.all(),
    ctx.repo.settlements.all(),
    ctx.repo.payments.all(),
    ctx.repo.stores.all(),
    ctx.repo.users.all(),
    ctx.repo.zones.all(),
    ctx.repo.reorders.all(),
    ctx.repo.unmetDemand.all(),
  ]);
  return { reports, commissions, returns, settlements, payments, stores, users, zones, reorders, unmet };
}

/** Estado de resultados por mes: ventas al precio al local, costo por lote, comisiones y mermas. */
export async function pnlByMonth(ctx: Ctx, months = 4): Promise<PnlMonth[]> {
  guard(ctx, 'accounting.read');
  const { reports, commissions, returns } = await loadMoney(ctx);
  return computePnl(reports, commissions, returns, ctx.now(), months);
}

export function computePnl(
  reports: Awaited<ReturnType<typeof loadMoney>>['reports'],
  commissions: Awaited<ReturnType<typeof loadMoney>>['commissions'],
  returns: Awaited<ReturnType<typeof loadMoney>>['returns'],
  now: Date,
  months: number,
): PnlMonth[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(15);
    d.setUTCMonth(d.getUTCMonth() - i);
    keys.push(monthKey(d));
  }
  const rows = new Map(keys.map((k) => [k, { month: k, revenue: 0, cogs: 0, commissions: 0, shrink: 0, grossMargin: 0, units: 0 }]));
  for (const r of reports) {
    const row = rows.get(monthKey(r.at));
    if (!row) continue;
    for (const l of r.lines) {
      row.revenue += l.qty * l.unitPrice;
      row.cogs += l.cost;
      row.units += l.qty;
    }
  }
  for (const c of commissions) {
    const row = rows.get(monthKey(c.accruedAt));
    if (row) row.commissions += c.amount;
  }
  for (const x of returns) {
    if (x.kind !== 'merma') continue;
    const row = rows.get(monthKey(x.at));
    if (row) row.shrink += x.cost;
  }
  return [...rows.values()].map((r) => ({
    ...r,
    revenue: round2(r.revenue),
    cogs: round2(r.cogs),
    commissions: round2(r.commissions),
    shrink: round2(r.shrink),
    grossMargin: round2(r.revenue - r.cogs - r.commissions - r.shrink),
  }));
}

export interface Valuation {
  warehouseUnits: number;
  warehouseCost: number;
  consignmentUnits: number;
  consignmentCost: number;
  consignmentAtStorePrice: number;
  byProduct: { productId: string; name: string; warehouse: number; consignment: number; cost: number }[];
  byStore: { storeId: string; name: string; units: number; cost: number }[];
}

/** Inventario valorado al costo de cada lote. Lo que está en locales sigue siendo de la empresa. */
export async function inventoryValuation(ctx: Ctx): Promise<Valuation> {
  guard(ctx, 'accounting.read');
  const [snap, stores] = await Promise.all([loadInventory(ctx), ctx.repo.stores.all()]);
  const storesById = new Map(stores.map((s) => [s.id, s]));
  const v: Valuation = {
    warehouseUnits: 0,
    warehouseCost: 0,
    consignmentUnits: 0,
    consignmentCost: 0,
    consignmentAtStorePrice: 0,
    byProduct: [],
    byStore: [],
  };
  const prod = new Map<string, { productId: string; name: string; warehouse: number; consignment: number; cost: number }>();
  const st = new Map<string, { storeId: string; name: string; units: number; cost: number }>();
  for (const e of snap.balances.entries()) {
    if (e.qty <= 0) continue;
    const lot = snap.lotsById.get(e.lotId);
    const p = snap.productsById.get(e.productId);
    const cost = e.qty * (lot?.unitCost ?? p?.cost ?? 0);
    const pr = prod.get(e.productId) ?? { productId: e.productId, name: p?.name ?? e.productId, warehouse: 0, consignment: 0, cost: 0 };
    pr.cost += cost;
    if (e.loc === 'warehouse') {
      v.warehouseUnits += e.qty;
      v.warehouseCost += cost;
      pr.warehouse += e.qty;
    } else if (e.loc.startsWith('store:')) {
      const storeId = e.loc.slice(6);
      v.consignmentUnits += e.qty;
      v.consignmentCost += cost;
      v.consignmentAtStorePrice += e.qty * (p?.priceToStore ?? 0);
      pr.consignment += e.qty;
      const s = st.get(storeId) ?? { storeId, name: storesById.get(storeId)?.name ?? storeId, units: 0, cost: 0 };
      s.units += e.qty;
      s.cost += cost;
      st.set(storeId, s);
    }
    prod.set(e.productId, pr);
  }
  v.warehouseCost = round2(v.warehouseCost);
  v.consignmentCost = round2(v.consignmentCost);
  v.consignmentAtStorePrice = round2(v.consignmentAtStorePrice);
  v.byProduct = [...prod.values()].map((x) => ({ ...x, cost: round2(x.cost) })).sort((a, b) => b.cost - a.cost);
  v.byStore = [...st.values()].map((x) => ({ ...x, cost: round2(x.cost) })).sort((a, b) => b.cost - a.cost);
  return v;
}

export interface BalanceSheet {
  receivable: number;
  unsettledSales: number;
  aging: ReturnType<typeof aging>;
  payableAccrued: number;
  payableReady: number;
  paidCommissions: number;
  collectedLast30: number;
}

/** Por cobrar a locales y por pagar a vendedores. */
export async function balances(ctx: Ctx): Promise<BalanceSheet> {
  guard(ctx, 'accounting.read');
  const { reports, commissions, settlements, payments } = await loadMoney(ctx);
  const now = ctx.now();
  const since = addDays(now, -30);
  return {
    receivable: round2(settlements.reduce((a, s) => a + settlementBalance(s), 0)),
    unsettledSales: round2(reports.filter((r) => !r.settlementId).reduce((a, r) => a + r.total, 0)),
    aging: aging(settlements, now),
    payableAccrued: round2(commissions.filter((c) => c.status === 'devengada').reduce((a, c) => a + c.amount, 0)),
    payableReady: round2(commissions.filter((c) => c.status === 'pagable').reduce((a, c) => a + c.amount, 0)),
    paidCommissions: round2(commissions.filter((c) => c.status === 'pagada').reduce((a, c) => a + c.amount, 0)),
    collectedLast30: round2(payments.filter((p) => p.at >= since).reduce((a, p) => a + p.amount, 0)),
  };
}

// ---------- Reportes ----------

export interface ProfitRow {
  key: string;
  label: string;
  units: number;
  revenue: number;
  cogs: number;
  commissions: number;
  margin: number;
  marginPct: number;
}

export interface ReportsData {
  periodDays: number;
  topSold: { productId: string; name: string; units: number; revenue: number }[];
  topRequested: { productId: string; name: string; units: number; orders: number }[];
  sellThrough: { productId: string; name: string; placed: number; sold: number; ratio: number; rotationDays: number | null }[];
  byProduct: ProfitRow[];
  byStore: ProfitRow[];
  bySeller: ProfitRow[];
  byZone: ProfitRow[];
  nonRotating: { storeId: string; name: string; units: number; daysSinceSale: number | null }[];
  stockouts: { productId: string; name: string; available: number; threshold: number; unmet: number }[];
  unmetDemand: { productId: string; name: string; units: number; stores: number }[];
}

export async function reports(ctx: Ctx, periodDays = 90): Promise<ReportsData> {
  guard(ctx, 'reports.read');
  const [snap, money, settings] = await Promise.all([loadInventory(ctx), loadMoney(ctx), getSettings(ctx)]);
  const now = ctx.now();
  const since = addDays(now, -periodDays);
  const pName = (id: string) => snap.productsById.get(id)?.name ?? id;
  const storesById = new Map(money.stores.map((s) => [s.id, s]));
  const usersById = new Map(money.users.map((u) => [u.id, u]));
  const zonesById = new Map(money.zones.map((z) => [z.id, z]));

  const recent = money.reports.filter((r) => r.at >= since);
  const commByReportProduct = new Map<string, number>();
  for (const c of money.commissions) {
    const k = `${c.salesReportId}|${c.productId}`;
    commByReportProduct.set(k, (commByReportProduct.get(k) ?? 0) + c.amount);
  }

  const profit = new Map<string, Map<string, ProfitRow>>();
  const bump = (dim: string, key: string, label: string, units: number, revenue: number, cogs: number, comm: number) => {
    let m = profit.get(dim);
    if (!m) {
      m = new Map();
      profit.set(dim, m);
    }
    const row = m.get(key) ?? { key, label, units: 0, revenue: 0, cogs: 0, commissions: 0, margin: 0, marginPct: 0 };
    row.units += units;
    row.revenue += revenue;
    row.cogs += cogs;
    row.commissions += comm;
    m.set(key, row);
  };
  for (const r of recent) {
    const store = storesById.get(r.storeId);
    const seller = usersById.get(r.sellerId);
    const zone = store ? zonesById.get(store.zoneId) : undefined;
    for (const l of r.lines) {
      const revenue = l.qty * l.unitPrice;
      const comm = commByReportProduct.get(`${r.id}|${l.productId}`) ?? 0;
      bump('product', l.productId, pName(l.productId), l.qty, revenue, l.cost, comm);
      bump('store', r.storeId, store?.name ?? r.storeId, l.qty, revenue, l.cost, comm);
      bump('seller', r.sellerId, seller?.name ?? r.sellerId, l.qty, revenue, l.cost, comm);
      bump('zone', zone?.id ?? 'sin-zona', zone?.name ?? 'Sin zona', l.qty, revenue, l.cost, comm);
    }
  }
  const finish = (dim: string): ProfitRow[] =>
    [...(profit.get(dim)?.values() ?? [])]
      .map((r) => {
        const margin = r.revenue - r.cogs - r.commissions;
        return {
          ...r,
          revenue: round2(r.revenue),
          cogs: round2(r.cogs),
          commissions: round2(r.commissions),
          margin: round2(margin),
          marginPct: r.revenue > 0 ? margin / r.revenue : 0,
        };
      })
      .sort((a, b) => b.margin - a.margin);

  const byProduct = finish('product');
  const topSold = [...byProduct]
    .sort((a, b) => b.units - a.units)
    .map((r) => ({ productId: r.key, name: r.label, units: r.units, revenue: r.revenue }));

  const requested = new Map<string, { units: number; orders: number }>();
  for (const o of money.reorders) {
    if (o.createdAt < since) continue;
    for (const it of o.items) {
      const cur = requested.get(it.productId) ?? { units: 0, orders: 0 };
      cur.units += it.qty;
      cur.orders += 1;
      requested.set(it.productId, cur);
    }
  }
  const topRequested = [...requested]
    .map(([productId, v]) => ({ productId, name: pName(productId), ...v }))
    .sort((a, b) => b.units - a.units);

  const placed = new Map<string, number>();
  const sold = new Map<string, number>();
  for (const m of snap.movements) {
    if (m.at < since) continue;
    if (m.type === 'salida_consignacion') placed.set(m.productId, (placed.get(m.productId) ?? 0) + m.qty);
    if (m.type === 'venta_reportada') sold.set(m.productId, (sold.get(m.productId) ?? 0) + m.qty);
  }
  const consign = snap.balances.consignmentTotals();
  const sellThrough = snap.products
    .filter((p) => p.active)
    .map((p) => {
      const pl = placed.get(p.id) ?? 0;
      const so = sold.get(p.id) ?? 0;
      const daily = so / periodDays;
      return {
        productId: p.id,
        name: p.name,
        placed: pl,
        sold: so,
        ratio: pl > 0 ? so / pl : 0,
        rotationDays: daily > 0 ? Math.round((consign.get(p.id) ?? 0) / daily) : null,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);

  const lastSale = new Map<string, string>();
  for (const r of money.reports) {
    const cur = lastSale.get(r.storeId);
    if (!cur || r.at > cur) lastSale.set(r.storeId, r.at);
  }
  const nonRotating = money.stores
    .filter((s) => s.status === 'activo')
    .map((s) => {
      const units = [...snap.balances.byProduct(storeLoc(s.id)).values()].reduce((a, b) => a + Math.max(0, b), 0);
      const last = lastSale.get(s.id);
      return { storeId: s.id, name: s.name, units, daysSinceSale: last ? daysBetween(last, now) : null };
    })
    .filter((x) => x.units > 0 && (x.daysSinceSale === null || x.daysSinceSale >= settings.noRotationDays))
    .sort((a, b) => (b.daysSinceSale ?? 999) - (a.daysSinceSale ?? 999));

  const unmetByProduct = new Map<string, { units: number; stores: Set<string> }>();
  for (const u of money.unmet) {
    const cur = unmetByProduct.get(u.productId) ?? { units: 0, stores: new Set<string>() };
    cur.units += u.qty;
    cur.stores.add(u.storeId);
    unmetByProduct.set(u.productId, cur);
  }
  const unmetDemand = [...unmetByProduct]
    .map(([productId, v]) => ({ productId, name: pName(productId), units: v.units, stores: v.stores.size }))
    .sort((a, b) => b.units - a.units);

  const stockouts = snap.products
    .filter((p: Product) => p.active)
    .map((p) => {
      const available = Math.max(0, snap.balances.qty(WAREHOUSE, p.id) - (snap.reserved.get(p.id) ?? 0));
      return { productId: p.id, name: p.name, available, threshold: p.lowStockThreshold, unmet: unmetByProduct.get(p.id)?.units ?? 0 };
    })
    .filter((x) => x.available <= x.threshold || x.unmet > 0)
    .sort((a, b) => a.available - b.available);

  return {
    periodDays,
    topSold,
    topRequested,
    sellThrough,
    byProduct,
    byStore: finish('store'),
    bySeller: finish('seller'),
    byZone: finish('zone'),
    nonRotating,
    stockouts,
    unmetDemand,
  };
}

// ---------- Mapa ----------

export interface MapStore {
  store: Store;
  sellerName: string;
  units: number;
  sales30: number;
  pendingOrder: boolean;
  lastVisitAt?: string;
  productIds: string[];
  balanceDue: number;
}

export interface MapData {
  warehouse: { name: string; lat: number; lng: number; units: number };
  stores: MapStore[];
  sellers: { id: string; name: string; lat: number; lng: number; at: string; storeName: string; storeId: string }[];
  maxSales: number;
}

export async function mapData(ctx: Ctx): Promise<MapData> {
  guard(ctx, 'map.read');
  const stores = await scopedStores(ctx);
  const [snap, users, visits, reports, reorders, deliveries, warehouse, settlements] = await Promise.all([
    loadInventory(ctx),
    ctx.repo.users.all(),
    ctx.repo.visits.all(),
    ctx.repo.salesReports.all(),
    ctx.repo.reorders.all(),
    ctx.repo.deliveries.all(),
    ctx.repo.warehouses.get('almacen'),
    ctx.repo.settlements.all(),
  ]);
  const now = ctx.now();
  const since = addDays(now, -30);
  const usersById = new Map(users.map((u) => [u.id, u]));
  const storesById = new Map(stores.map((s) => [s.id, s]));
  const out: MapStore[] = stores.map((s) => {
    const held = snap.balances.byProduct(storeLoc(s.id));
    const productIds = [...held].filter(([, q]) => q > 0).map(([p]) => p);
    const lastVisit = visits.filter((v) => v.storeId === s.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    return {
      store: s,
      sellerName: usersById.get(s.sellerId)?.name ?? '—',
      units: [...held.values()].reduce((a, b) => a + Math.max(0, b), 0),
      sales30: round2(reports.filter((r) => r.storeId === s.id && r.at >= since).reduce((a, r) => a + r.total, 0)),
      pendingOrder:
        reorders.some((r) => r.storeId === s.id && (r.status === 'enviado' || r.status === 'confirmado' || r.status === 'preparado')) ||
        deliveries.some((d) => d.storeId === s.id && (d.status === 'solicitada' || d.status === 'preparada')),
      lastVisitAt: lastVisit?.at,
      productIds,
      balanceDue: round2(settlements.filter((x) => x.storeId === s.id).reduce((a, x) => a + settlementBalance(x), 0)),
    };
  });
  // Cada vendedor, en el punto de su última visita.
  const sellerIds = ctx.actor.role === 'seller' ? [ctx.actor.userId] : users.filter((u) => u.role === 'seller').map((u) => u.id);
  const sellers: MapData['sellers'] = [];
  for (const id of sellerIds) {
    const v = visits
      .filter((x) => x.sellerId === id && storesById.has(x.storeId))
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!v) continue;
    const store = storesById.get(v.storeId)!;
    sellers.push({
      id,
      name: usersById.get(id)?.name ?? '—',
      lat: v.geo?.lat ?? store.lat,
      lng: v.geo?.lng ?? store.lng,
      at: v.at,
      storeName: store.name,
      storeId: store.id,
    });
  }
  return {
    warehouse: {
      name: warehouse?.name ?? 'Almacén',
      lat: warehouse?.lat ?? 25.81,
      lng: warehouse?.lng ?? -80.33,
      units: [...snap.balances.byProduct(WAREHOUSE).values()].reduce((a, b) => a + b, 0),
    },
    stores: out,
    sellers,
    maxSales: Math.max(1, ...out.map((s) => s.sales30)),
  };
}

/** La ruta del día del vendedor: sus locales activos que más necesitan visita, en orden de cercanía. */
export async function sellerRoute(ctx: Ctx): Promise<{ store: Store; reason: string; daysSinceVisit: number | null }[]> {
  guard(ctx, 'map.read');
  const stores = (await scopedStores(ctx)).filter((s) => s.status === 'activo' || s.status === 'firmado' || s.status === 'contrato_enviado');
  const [visits, reorders, deliveries, warehouse] = await Promise.all([
    ctx.repo.visits.all(),
    ctx.repo.reorders.all(),
    ctx.repo.deliveries.all(),
    ctx.repo.warehouses.get('almacen'),
  ]);
  const now = ctx.now();
  const scored = stores.map((s) => {
    const last = visits.filter((v) => v.storeId === s.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    const days = last ? daysBetween(last.at, now) : null;
    const order = reorders.some((r) => r.storeId === s.id && r.status === 'enviado');
    const ready = deliveries.some((d) => d.storeId === s.id && d.status === 'preparada');
    let score = days ?? 30;
    let reason = days === null ? 'Sin visitas todavía' : `Última visita hace ${days} días`;
    if (s.status === 'contrato_enviado') {
      score += 40;
      reason = 'Contrato por firmar';
    }
    if (order) {
      score += 30;
      reason = 'Tiene un pedido por confirmar';
    }
    if (ready) {
      score += 50;
      reason = 'Entrega lista para llevar';
    }
    return { store: s, reason, daysSinceVisit: days, score };
  });
  const top = scored.sort((a, b) => b.score - a.score).slice(0, 6);
  // Ordena por cercanía empezando en el almacén (vecino más cercano).
  const route: typeof top = [];
  let cur = { lat: warehouse?.lat ?? 25.81, lng: warehouse?.lng ?? -80.33 };
  const left = [...top];
  while (left.length) {
    let best = 0;
    let bestD = Infinity;
    left.forEach((x, i) => {
      const d = (x.store.lat - cur.lat) ** 2 + (x.store.lng - cur.lng) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const [next] = left.splice(best, 1);
    if (!next) break;
    route.push(next);
    cur = { lat: next.store.lat, lng: next.store.lng };
  }
  return route.map(({ store, reason, daysSinceVisit }) => ({ store, reason, daysSinceVisit }));
}

/** CSV con separador coma y comillas donde haga falta. */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}
