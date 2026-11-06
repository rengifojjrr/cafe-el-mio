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
  Invitation,
  IsoDate,
  LineId,
  LineSettings,
  Product,
  SalesReport,
  Store,
  User,
  Zone,
} from '../data/types';
import { monthToDateMetrics, resolveCommissionRule } from '../domain/commission-scheme';
import { docAlertNotice, storeDocWarnings } from '../domain/fiscal';
import { HOUSTON, MIAMI } from '../domain/markets';
import { commissionAmount } from '../domain/money-rules';
import { round2 } from '../lib/money';
import { ZONE, fmtDate } from '../lib/time';
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
  const invitations = seedInvitations(c);
  return { ...t, invitations, audit: (t.audit as AuditEntry[]).sort((a, b) => a.at.localeCompare(b.at)) };
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
