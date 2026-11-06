// Semilla de la ronda 3 (R3-6 y R3-7): mercados (Miami y Houston), datos fiscales de los locales,
// comisión progresiva, repartos con sus costos e invitaciones. Trabaja sobre las tablas que ya armó
// el simulador (engine.ts) y no agrega movimientos: el libro queda igual.
// Todo es inventado: EIN «00-…», certificados «RC-DEMO-…», choferes y placas de ejemplo.
import { DateTime } from 'luxon';
import type {
  AppNotification,
  AuditEntry,
  Commission,
  CommissionPayout,
  CommissionScheme,
  Delivery,
  DeliveryRoute,
  Invitation,
  IsoDate,
  LineId,
  LineSettings,
  Movement,
  Product,
  SalesReport,
  Store,
  User,
  Warehouse,
  Zone,
} from '../data/types';
import { monthToDateMetrics, resolveCommissionRule } from '../domain/commission-scheme';
import { docAlertNotice, storeDocWarnings } from '../domain/fiscal';
import { Balances, WAREHOUSE, reservedByProduct } from '../domain/ledger';
import { HOUSTON, MIAMI } from '../domain/markets';
import { commissionAmount } from '../domain/money-rules';
import { orderStep } from '../domain/products';
import { estimateRouteKm, haversineKm } from '../domain/routes';
import { seededRandom } from '../lib/ids';
import { round2 } from '../lib/money';
import { ZONE, fmtDate, toIsoDate } from '../lib/time';
import type { LineSeedDef, SeedTables } from './engine';

/** Lo común a cada parte: las tablas, fechas relativas a hoy, ids nuevos y la auditoría. */
interface Seed {
  def: LineSeedDef;
  t: SeedTables;
  now: Date;
  line: LineId;
  letter: string;
  settings: LineSettings;
  stores: Store[];
  users: User[];
  admin: User;
  storeByKey: Map<string, Store>;
  sellerByKey: Map<string, User>;
  productByKey: Map<string, Product>;
  dateOf: (day: number) => IsoDate;
  ago: (hours: number) => string;
  id: (prefix: string) => string;
  log: (at: string, action: string, entity: string, entityId: string, summary: string, actor?: User) => void;
}

function context(def: LineSeedDef, t: SeedTables, now: Date): Seed {
  const line: LineId = def.line;
  const today0 = DateTime.fromJSDate(now).setZone(ZONE).startOf('day');
  const letter = line === 'tabaco' ? 't' : 'c';
  let seq = 0;
  const id = (prefix: string) => `${letter}-${prefix}_r3${String((seq += 1)).padStart(4, '0')}`;
  const stores = t.stores as Store[];
  const users = t.users as User[];
  const products = t.products as Product[];
  const admin = users.find((u) => u.role === 'admin')!;
  const audit = t.audit as AuditEntry[];
  return {
    def,
    t,
    now,
    line,
    letter,
    settings: (t.settings as LineSettings[])[0]!,
    stores,
    users,
    admin,
    // El simulador crea locales, usuarios y productos en el orden de su definición.
    storeByKey: new Map(def.stores.map((sd, i) => [sd.key, stores[i]!])),
    sellerByKey: new Map(def.users.map((ud, i) => [ud.key, users[i]!])),
    productByKey: new Map(def.products.map((pd, i) => [pd.key, products[i]!])),
    dateOf: (day) => today0.plus({ days: day }).toISODate()! as IsoDate,
    ago: (hours) => DateTime.fromJSDate(now).minus({ hours }).toUTC().toISO()!,
    id,
    log: (at, action, entity, entityId, summary, actor = admin) => {
      audit.push({ id: id('aud'), at, actorId: actor.id, actorName: actor.name, role: actor.role, action, entity, entityId, summary });
    },
  };
}

export function applyRonda3Red(def: LineSeedDef, t: SeedTables, now: Date): SeedTables {
  const c = context(def, t, now);
  seedMarkets(c);
  seedFiscal(c);
  seedCommissions(c);
  const routes = seedRoutes(c);
  const invitations = seedInvitations(c);
  return { ...t, routes, invitations, audit: (t.audit as AuditEntry[]).sort((a, b) => a.at.localeCompare(b.at)) };
}

// ---------- Mercados: Miami (todo lo de antes) y, en tabaco, Houston ----------
function seedMarkets({ line, settings, t, stores, users }: Seed): void {
  settings.markets = line === 'tabaco' ? [MIAMI, HOUSTON] : [MIAMI];
  settings.routeCostPerKm = line === 'tabaco' ? 0.65 : 0.6;
  const zones = t.zones as Zone[];
  for (const z of zones) z.marketId ??= MIAMI.id;
  const zoneMarket = new Map(zones.map((z) => [z.id, z.marketId ?? MIAMI.id]));
  for (const s of stores) s.marketId = zoneMarket.get(s.zoneId) ?? MIAMI.id;
  for (const u of users) if (u.role === 'seller') u.marketId = (u.zoneId && zoneMarket.get(u.zoneId)) || MIAMI.id;
}

// ---------- Datos fiscales y avisos de documentos por vencer ----------
function seedFiscal({ def, t, now, line, letter, stores, admin, storeByKey, dateOf, ago, id }: Seed): void {
  stores.forEach((s, i) => {
    if (s.tobaccoPermit) s.tobaccoPermit.issuer = s.marketId === HOUSTON.id ? 'Texas Comptroller' : 'Florida DBPR';
    if (s.status === 'prospecto') return;
    s.taxId = `00-${String(1200 + i * 7 + (line === 'tabaco' ? 0 : 500)).padStart(7, '0')}`;
    s.resaleCert = { number: `RC-DEMO-${letter.toUpperCase()}${String(4100 + i * 3).padStart(5, '0')}`, expiresOn: dateOf(140 + ((i * 23) % 200)) };
  });
  const tweak = (key: string, fn: (s: Store) => void) => {
    const s = storeByKey.get(key);
    if (s) fn(s);
  };
  if (line === 'tabaco') {
    tweak('t-ocho', (s) => delete s.resaleCert); // sin certificado de reventa
    tweak('t-sunset', (s) => {
      if (s.resaleCert) s.resaleCert.expiresOn = dateOf(19); // vence pronto
    });
    tweak('t-pinos', (s) => {
      if (s.resaleCert) s.resaleCert.expiresOn = dateOf(-12); // vencido
    });
    tweak('t-tamiami', (s) => {
      if (s.tobaccoPermit) s.tobaccoPermit.expiresOn = dateOf(17); // permiso por vencer
    });
  } else {
    tweak('c-305', (s) => delete s.resaleCert);
    tweak('c-kendall', (s) => {
      if (s.resaleCert) s.resaleCert.expiresOn = dateOf(24);
    });
  }
  // Los mismos textos que crea el servicio, para no repetirlos.
  const notifications = t.notifications as AppNotification[];
  for (const s of stores) {
    if (s.status !== 'activo' && s.status !== 'firmado' && s.status !== 'pausado') continue;
    for (const w of storeDocWarnings(s, now, { requiresPermit: def.config.requiresTobaccoPermit })) {
      if (w.state === 'falta') continue;
      const { title, body } = docAlertNotice(w, s.name, fmtDate);
      for (const userId of [admin.id, s.sellerId]) {
        notifications.push({ id: id('ntf'), userId, kind: 'documento_por_vencer', title, body, link: `/${line}/locales/${s.id}`, at: ago(3), read: false });
      }
    }
  }
}

// ---------- Invitaciones (tabaco): una vigente, una vencida y una revocada ----------
function seedInvitations({ line, users, admin, storeByKey, sellerByKey, ago, id }: Seed): Invitation[] {
  const invitations: Invitation[] = [];
  if (line !== 'tabaco') return invitations;
  const tomas = sellerByKey.get('tomas');
  const lucia = sellerByKey.get('lucia');
  const faro = storeByKey.get('t-faro');
  const faroUser = faro ? users.find((u) => u.storeId === faro.id) : undefined;
  if (tomas) {
    invitations.push({ id: id('inv'), accountId: `tabaco:${tomas.id}`, userId: tomas.id, role: 'seller', expiresAt: ago(-24 * 6), createdAt: ago(24), createdBy: admin.id });
  }
  if (lucia) {
    invitations.push({ id: id('inv'), accountId: `tabaco:${lucia.id}`, userId: lucia.id, role: 'seller', expiresAt: ago(24 * 5), createdAt: ago(24 * 12), createdBy: admin.id });
  }
  if (faro && faroUser) {
    // El local principal entra por «Entrar como…» (tabaco:store): la invitación se revocó.
    invitations.push({ id: id('inv'), accountId: 'tabaco:store', userId: faroUser.id, role: 'store', storeId: faro.id, expiresAt: ago(24 * 3), createdAt: ago(24 * 10), createdBy: admin.id, revokedAt: ago(24 * 9) });
  }
  return invitations;
}

// ---------- Comisión progresiva (tabaco) ----------

/** Comisión progresiva de Tabaco: base 7 %, escalones por locales activos y por lo vendido en el mes, tope 10 %. */
export const TABACO_SCHEME: CommissionScheme = {
  basePercent: 7,
  capPercent: 10,
  tiers: [
    { metric: 'locales', min: 5, percent: 8 },
    { metric: 'locales', min: 8, percent: 10 },
    { metric: 'ventas', min: 4000, percent: 8 },
    { metric: 'ventas', min: 7000, percent: 9 },
  ],
};

/** Tomás Garza abre Houston: su propia comisión, que premia sumar locales. */
export const HOUSTON_SELLER_SCHEME: CommissionScheme = {
  basePercent: 8,
  capPercent: 10,
  tiers: [
    { metric: 'locales', min: 6, percent: 9 },
    { metric: 'locales', min: 10, percent: 10 },
    { metric: 'ventas', min: 3000, percent: 9 },
  ],
};

/** Productos con comisión propia (los de monto fijo por unidad). */
const CUSTOM_COMMISSION_SKUS = ['TB-EVE-COR42', 'TB-COR-PET42'];

/**
 * Rige la comisión progresiva y se recalcula la historia como si hubiera regido siempre: cada venta
 * con las cifras del vendedor en el mes antes de ella (la misma regla que usa la app al devengar).
 * Los pagos de comisiones se rehacen con los montos nuevos.
 */
function seedCommissions({ line, t, settings, stores, users, sellerByKey }: Seed): void {
  if (line !== 'tabaco') return;
  const products = t.products as Product[];
  const reports = t.salesReports as SalesReport[];
  const commissions = t.commissions as Commission[];
  const audit = t.audit as AuditEntry[];
  settings.commissionScheme = TABACO_SCHEME;
  for (const p of products) if (CUSTOM_COMMISSION_SKUS.includes(p.sku)) p.commissionCustom = true;
  const tomas = sellerByKey.get('tomas');
  if (tomas) tomas.commissionScheme = HOUSTON_SELLER_SCHEME;
  const productsById = new Map(products.map((p) => [p.id, p]));
  const usersById = new Map(users.map((u) => [u.id, u]));
  const pack = (pid: string) => productsById.get(pid)?.packSize ?? 1;
  const bySeller = new Map<string, SalesReport[]>();
  for (const r of reports) bySeller.set(r.sellerId, [...(bySeller.get(r.sellerId) ?? []), r]);
  const metricsByReport = new Map<string, ReturnType<typeof monthToDateMetrics>>();
  for (const r of reports) {
    metricsByReport.set(r.id, monthToDateMetrics({ sellerId: r.sellerId, at: r.at, stores, reports: bySeller.get(r.sellerId) ?? [], packSize: pack }));
  }
  for (const c of commissions) {
    const p = productsById.get(c.productId);
    const metrics = metricsByReport.get(c.salesReportId);
    if (!p || !metrics) continue;
    const rule = resolveCommissionRule({ product: p, seller: usersById.get(c.sellerId), lineScheme: TABACO_SCHEME, metrics });
    if (!rule) continue;
    c.rule = rule;
    c.amount = commissionAmount(rule, c.qty, c.qty > 0 ? c.base / c.qty : 0);
  }
  const commById = new Map(commissions.map((c) => [c.id, c]));
  for (const po of t.payouts as CommissionPayout[]) {
    po.amount = round2(po.commissionIds.reduce((a, cid) => a + (commById.get(cid)?.amount ?? 0), 0));
    const entry = audit.find((e) => e.action === 'comision.pagar' && e.entityId === po.id);
    const seller = usersById.get(po.sellerId);
    if (entry) entry.summary = `Comisiones pagadas a ${seller?.name ?? po.sellerId}: ${po.amount.toFixed(2)} USD`;
  }
}

// ---------- Repartos ----------

const DRIVERS = ['Manuel Soto (chofer de ejemplo)', 'Joaquín Rivas (chofer de ejemplo)'];
const VEHICLES = ['Camión 1 (placa de ejemplo)', 'Van 2 (placa de ejemplo)'];

/**
 * Repartos terminados (Miami): una ruta por día de entregas, con km, chofer y peajes. En tabaco,
 * además, entregas listas para salir hoy y el reparto del día en borrador con dos de ellas.
 */
function seedRoutes(c: Seed): DeliveryRoute[] {
  const { def, t, line, settings, stores, users, admin, storeByKey, productByKey, dateOf, ago, id, log } = c;
  const rng = seededRandom(def.seed + 303);
  const deliveries = t.deliveries as Delivery[];
  const notifications = t.notifications as AppNotification[];
  const warehouse = (t.warehouses as Warehouse[])[0]!;
  const storesById = new Map(stores.map((s) => [s.id, s]));
  const routes: DeliveryRoute[] = [];
  const costPerKm = settings.routeCostPerKm ?? 0.65;
  const byDay = new Map<IsoDate, Delivery[]>();
  for (const d of deliveries) {
    if (d.status !== 'entregada' || !d.deliveredAt) continue;
    const s = storesById.get(d.storeId);
    if (!s || s.marketId !== MIAMI.id) continue; // Houston: sale del almacén de Miami por transporte aparte
    const day = toIsoDate(d.deliveredAt);
    byDay.set(day, [...(byDay.get(day) ?? []), d]);
  }
  const nearestOrder = (list: Delivery[]) => {
    const left = [...list];
    const out: Delivery[] = [];
    let cur = { lat: warehouse.lat, lng: warehouse.lng };
    while (left.length) {
      let best = 0;
      left.forEach((d, i) => {
        const s = storesById.get(d.storeId)!;
        if (haversineKm(cur, s) < haversineKm(cur, storesById.get(left[best]!.storeId)!)) best = i;
      });
      const [next] = left.splice(best, 1);
      out.push(next!);
      cur = storesById.get(next!.storeId)!;
    }
    return out;
  };
  for (const [day, list] of [...byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ordered = nearestOrder(list);
    const stops = ordered.map((d) => ({ deliveryId: d.id, storeId: d.storeId }));
    const n = routes.length;
    const route: DeliveryRoute = {
      id: id('rep'),
      code: `R-${String(n + 1).padStart(4, '0')}`,
      date: day,
      driver: DRIVERS[n % DRIVERS.length]!,
      vehicle: VEHICLES[n % VEHICLES.length]!,
      stops,
      km: estimateRouteKm(warehouse, stops.map((s) => storesById.get(s.storeId)!)),
      costPerKm,
      driverCost: 25 + 6 * stops.length,
      tolls: [0, 2.25, 4.5][Math.floor(rng() * 3)]!,
      status: 'terminado',
      createdAt: DateTime.fromISO(day, { zone: ZONE }).set({ hour: 7, minute: 40 }).toUTC().toISO()!,
      createdBy: admin.id,
    };
    routes.push(route);
    for (const d of ordered) d.routeId = route.id;
  }
  if (line !== 'tabaco') return routes;

  // Hoy: entregas listas para salir (lo preparado se aparta del almacén, sin moverlo todavía).
  const balances = Balances.from(t.movements as Movement[]);
  const reserved = reservedByProduct(deliveries);
  const available = (pid: string) => balances.qty(WAREHOUSE, pid) - (reserved.get(pid) ?? 0);
  const ready: Delivery[] = [];
  for (const key of ['t-brisa', 't-club', 't-sunset', 't-ocean']) {
    const s = storeByKey.get(key);
    const sd = def.stores.find((x) => x.key === key);
    if (!s || !sd || s.status !== 'activo') continue;
    const items: Delivery['items'] = [];
    for (const pk of sd.assortment) {
      const p = productByKey.get(pk);
      if (!p) continue;
      const qty = orderStep(p);
      if (available(p.id) < qty) continue;
      items.push({ productId: p.id, qty, preparedQty: qty });
      reserved.set(p.id, (reserved.get(p.id) ?? 0) + qty);
      if (items.length === 2) break;
    }
    if (items.length === 0) continue;
    const seller = users.find((u) => u.id === s.sellerId)!;
    const d: Delivery = {
      id: id('ent'),
      code: `E-${String(deliveries.length + 1).padStart(4, '0')}`,
      storeId: s.id,
      sellerId: s.sellerId,
      status: 'preparada',
      items,
      note: '',
      origin: 'vendedor',
      requestedAt: ago(22 + ready.length),
      requestedBy: seller.id,
      preparedAt: ago(2 + ready.length * 0.25),
      preparedBy: admin.id,
    };
    deliveries.push(d);
    ready.push(d);
    const units = items.reduce((a, i) => a + i.qty, 0);
    log(d.requestedAt, 'entrega.solicitar', 'delivery', d.id, `${d.code}: ${units} unidades para ${s.name}`, seller);
    log(d.preparedAt!, 'entrega.preparar', 'delivery', d.id, `${d.code} preparada: ${units} unidades`);
    notifications.push({ id: id('ntf'), userId: seller.id, kind: 'entrega_preparada', title: `Entrega lista: ${s.name}`, body: `${d.code} · ${units} unidades.`, link: `/${line}/entregas`, at: d.preparedAt!, read: false });
  }
  // El reparto de hoy en borrador lleva dos; las otras quedan listas para armar otro.
  const draftStops = ready.slice(0, 2);
  if (draftStops.length) {
    const stops = draftStops.map((d) => ({ deliveryId: d.id, storeId: d.storeId }));
    const draft: DeliveryRoute = {
      id: id('rep'),
      code: `R-${String(routes.length + 1).padStart(4, '0')}`,
      date: dateOf(0),
      driver: DRIVERS[0]!,
      vehicle: VEHICLES[0]!,
      stops,
      km: estimateRouteKm(warehouse, stops.map((s) => storesById.get(s.storeId)!)),
      costPerKm,
      driverCost: 0,
      tolls: 0,
      status: 'borrador',
      createdAt: ago(1),
      createdBy: admin.id,
    };
    routes.push(draft);
    for (const d of draftStops) d.routeId = draft.id;
    log(draft.createdAt, 'reparto.crear', 'route', draft.id, `${draft.code} para el ${draft.date}: ${stops.length} paradas`);
  }
  return routes;
}
