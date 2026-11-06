// Ronda 3 · venta en firme y precios: lo que se agrega a la semilla de cada línea. TODO es inventado.
// - Listas de precios «Público (PVP)», «Local» (la de los locales sin lista) y «Mayorista».
// - Locales que compran en firme (mayoreo): bodegas, gasolineras y licorerías de Miami-Dade en tabaco,
//   un supermercado y una cafetería en café; con Tax ID y certificado de reventa de ejemplo (uno vencido).
// - Tres meses de historia: pedidos (por teléfono, desde la app o pegados de un mensaje), entregas
//   firmadas, facturas, pagos (casi todo en efectivo), una factura vencida y ventas rápidas en el almacén.
// La mercancía del mayoreo sale de llegadas propias (lotes aparte): el libro de la consignación no
// cambia y ningún saldo queda negativo en ningún momento.
import { DateTime } from 'luxon';
import type {
  Arrival,
  AuditEntry,
  AppNotification,
  Commission,
  CommissionPayout,
  Delivery,
  Invoice,
  InvoiceLine,
  IsoDate,
  LineId,
  LineSettings,
  Lot,
  Movement,
  Payment,
  PaymentMethod,
  PriceEntry,
  PriceList,
  Product,
  Reorder,
  SalePack,
  Store,
  User,
} from '../data/types';
import { creditDaysFor, hasValidResaleCert, invoiceCommissions, invoiceDueOn, invoiceStatus, invoiceTotals } from '../domain/invoices';
import { WAREHOUSE } from '../domain/ledger';
import { baseQty, priceFor, splitIntoPacks } from '../domain/pricing';
import { idFactory, seededRandom } from '../lib/ids';
import { round2 } from '../lib/money';
import { ZONE, fmtDate } from '../lib/time';
import type { SeedTables } from './engine';
import { demoSignature } from './signature';

interface FirmStoreDef {
  key: string;
  name: string;
  type: string;
  zone: string;
  city: string;
  lat: number;
  lng: number;
  manager: string;
  seller: string;
  creditDays: number;
  list: 'local' | 'mayorista';
  /** Productos que compra (con cuánto suele pedir de cada uno, en su unidad o en cajas). */
  buys: { product: string; qty: [number, number]; pack: SalePack }[];
  /** Cada cuántos días pide. */
  every: number;
  firstDay: number;
  resale: 'vigente' | 'vencido';
  /** Deja de pagar las últimas facturas (una queda vencida). */
  stopsPaying?: boolean;
}

type ProductRef = (products: readonly Product[]) => Product | undefined;

const mazoRef =
  (vitola: string, capa: string): ProductRef =>
  (products) =>
    products.find((p) => p.kind === 'mazo' && p.attrs.vitola === vitola && p.attrs.capa === capa);
const skuRef =
  (sku: string): ProductRef =>
  (products) =>
    products.find((p) => p.sku === sku);

const REFS: Record<string, ProductRef> = {
  'toro-hab': mazoRef('Toro', 'habano'),
  'toro-mad': mazoRef('Toro', 'maduro'),
  'toro-con': mazoRef('Toro', 'connecticut'),
  'rob-hab': mazoRef('Robusto', 'habano'),
  'rob-mad': mazoRef('Robusto', 'maduro'),
  'torp-mad': mazoRef('Torpedo', 'maduro'),
  'torp-nat': mazoRef('Torpedo', 'natural'),
  'chu-con': mazoRef('Churchill', 'connecticut'),
  'chu-hab': mazoRef('Churchill', 'habano'),
  elmio: skuRef('CF-ELMIO-10OZ'),
  caja24: skuRef('CF-ELMIO-C24'),
  colombia: skuRef('CF-COL-12OZ'),
  costarica: skuRef('CF-CRI-12OZ'),
};

const TABACO_STORES: FirmStoreDef[] = [
  {
    key: 'primo',
    name: 'Bodega El Primo',
    type: 'Bodega',
    zone: 't-zon_hialeah',
    city: 'Hialeah, FL',
    lat: 25.8331,
    lng: -80.2811,
    manager: 'Ramón Quesada',
    seller: 'Andrés Molina',
    creditDays: 15,
    list: 'mayorista',
    buys: [
      { product: 'toro-hab', qty: [10, 25], pack: 'unidad' },
      { product: 'toro-mad', qty: [10, 20], pack: 'unidad' },
      { product: 'rob-hab', qty: [5, 15], pack: 'unidad' },
      { product: 'chu-hab', qty: [5, 10], pack: 'unidad' },
    ],
    every: 7,
    firstDay: -88,
    resale: 'vigente',
  },
  {
    key: 'doral41',
    name: 'Gasolinera Doral 41',
    type: 'Gasolinera',
    zone: 't-zon_doral',
    city: 'Doral, FL',
    lat: 25.8121,
    lng: -80.3365,
    manager: 'Yusleidy Paz',
    seller: 'Andrés Molina',
    creditDays: 0,
    list: 'local',
    buys: [
      { product: 'toro-hab', qty: [5, 15], pack: 'unidad' },
      { product: 'toro-con', qty: [5, 10], pack: 'unidad' },
      { product: 'rob-mad', qty: [5, 10], pack: 'unidad' },
    ],
    every: 7,
    firstDay: -86,
    resale: 'vigente',
  },
  {
    key: 'bendicion',
    name: 'Licorería La Bendición',
    type: 'Licorería',
    zone: 't-zon_westchester',
    city: 'Sweetwater, FL',
    lat: 25.7634,
    lng: -80.3731,
    manager: 'Orlando Fuentes',
    seller: 'Rafael Ortega',
    creditDays: 15,
    list: 'mayorista',
    buys: [
      { product: 'toro-mad', qty: [10, 20], pack: 'unidad' },
      { product: 'torp-mad', qty: [10, 20], pack: 'unidad' },
      { product: 'torp-nat', qty: [5, 10], pack: 'unidad' },
      { product: 'chu-con', qty: [5, 15], pack: 'unidad' },
    ],
    every: 10,
    firstDay: -84,
    resale: 'vigente',
    stopsPaying: true,
  },
  {
    key: 'flagler',
    name: 'Mini Market Flagler 57',
    type: 'Bodega',
    zone: 't-zon_habana',
    city: 'Pequeña Habana, Miami, FL',
    lat: 25.7731,
    lng: -80.2398,
    manager: 'Caridad Mesa',
    seller: 'Yanelis Cruz',
    creditDays: 0,
    list: 'local',
    buys: [
      { product: 'toro-hab', qty: [5, 10], pack: 'unidad' },
      { product: 'rob-hab', qty: [5, 10], pack: 'unidad' },
      { product: 'rob-mad', qty: [5, 10], pack: 'unidad' },
    ],
    every: 7,
    firstDay: -82,
    resale: 'vencido',
  },
  {
    key: 'medley',
    name: 'Cigar & Lotto Medley',
    type: 'Gasolinera',
    zone: 't-zon_doral',
    city: 'Medley, FL',
    lat: 25.8571,
    lng: -80.3354,
    manager: 'Jorge Iriarte',
    seller: 'Andrés Molina',
    creditDays: 15,
    list: 'mayorista',
    buys: [
      { product: 'toro-hab', qty: [1, 2], pack: 'caja' },
      { product: 'toro-mad', qty: [1, 1], pack: 'caja' },
      { product: 'torp-mad', qty: [10, 25], pack: 'unidad' },
      { product: 'chu-hab', qty: [10, 20], pack: 'unidad' },
    ],
    every: 10,
    firstDay: -80,
    resale: 'vigente',
  },
];

const CAFE_STORES: FirmStoreDef[] = [
  {
    key: 'cosecha',
    name: 'Supermercado La Cosecha',
    type: 'Supermercado latino',
    zone: 'c-zon_hialeah',
    city: 'Hialeah, FL',
    lat: 25.8466,
    lng: -80.3021,
    manager: 'Daisy Cordero',
    seller: 'Carlos Benítez',
    creditDays: 15,
    list: 'mayorista',
    buys: [
      { product: 'elmio', qty: [2, 5], pack: 'caja' },
      { product: 'caja24', qty: [1, 2], pack: 'unidad' },
      { product: 'colombia', qty: [1, 2], pack: 'caja' },
    ],
    every: 7,
    firstDay: -86,
    resale: 'vigente',
  },
  {
    key: 'pilon',
    name: 'Cafetería El Pilón',
    type: 'Cafetería',
    zone: 'c-zon_doral',
    city: 'Doral, FL',
    lat: 25.8019,
    lng: -80.3445,
    manager: 'Lázaro Villa',
    seller: 'Carlos Benítez',
    creditDays: 0,
    list: 'local',
    buys: [
      { product: 'elmio', qty: [1, 3], pack: 'caja' },
      { product: 'costarica', qty: [1, 1], pack: 'caja' },
    ],
    every: 7,
    firstDay: -84,
    resale: 'vigente',
  },
];

/** Ventas rápidas en el almacén: el dueño viene y se lleva lo suyo (también locales en consignación). */
const QUICK_SALES: Record<LineId, { store: string; days: number[]; buys: { product: string; qty: number; pack: SalePack }[]; pay: PaymentMethod | 'cuenta' }[]> = {
  tabaco: [
    { store: 'doral41', days: [-74, -60, -46, -32, -18, -4], buys: [{ product: 'toro-hab', qty: 5, pack: 'unidad' }], pay: 'efectivo' },
    { store: 'flagler', days: [-55, -27], buys: [{ product: 'rob-hab', qty: 3, pack: 'unidad' }], pay: 'tarjeta' },
    { store: 'medley', days: [-40], buys: [{ product: 'chu-con', qty: 10, pack: 'unidad' }], pay: 'cuenta' },
    { store: 'Bodega Ocho y Medio', days: [-38, -11], buys: [{ product: 'toro-mad', qty: 4, pack: 'unidad' }], pay: 'efectivo' },
    { store: 'Bodega Tamiami 107', days: [-23], buys: [{ product: 'toro-con', qty: 6, pack: 'unidad' }], pay: 'tarjeta' },
  ],
  cafe: [
    { store: 'pilon', days: [-65, -37, -9], buys: [{ product: 'elmio', qty: 1, pack: 'caja' }], pay: 'efectivo' },
    { store: 'Cafetería La Ventanita Azul', days: [-30], buys: [{ product: 'caja24', qty: 1, pack: 'unidad' }], pay: 'tarjeta' },
  ],
};

export function addFirmSales(line: LineId, tables: SeedTables, now: Date): SeedTables {
  const letter = line === 'tabaco' ? 't' : 'c';
  const rng = seededRandom(line === 'tabaco' ? 3_611 : 3_105);
  const rawId = idFactory();
  const id = (prefix: string) => `${letter}-${rawId(prefix)}`.replace(/_(\d{4})$/, '_f$1');
  const between = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
  const nowNy = DateTime.fromJSDate(now).setZone(ZONE);
  const today0 = nowNy.startOf('day');
  const at = (day: number, hour: number, minute = 0): string => today0.plus({ days: day }).set({ hour, minute }).toUTC().toISO()!;
  const dateOf = (day: number): IsoDate => today0.plus({ days: day }).toISODate()! as IsoDate;

  const products = tables.products as Product[];
  const users = tables.users as User[];
  const stores = tables.stores as Store[];
  const settings = (tables.settings as LineSettings[])[0]!;
  const lots = tables.lots as Lot[];
  const arrivals = tables.arrivals as Arrival[];
  const movements = tables.movements as Movement[];
  const deliveries = tables.deliveries as Delivery[];
  const reorders = tables.reorders as Reorder[];
  const payments = tables.payments as Payment[];
  const commissions = tables.commissions as Commission[];
  const payouts = tables.payouts as CommissionPayout[];
  const notifications = tables.notifications as AppNotification[];
  const audit = tables.audit as AuditEntry[];
  const admin = users.find((u) => u.role === 'admin')!;
  const prod = (key: string): Product => {
    const p = REFS[key]?.(products);
    if (!p) throw new Error(`Semilla (venta en firme): producto desconocido ${key}`);
    return p;
  };
  const log = (when: string, actor: User, action: string, entity: string, entityId: string, summary: string) => {
    audit.push({ id: id('aud'), at: when, actorId: actor.id, actorName: actor.name, role: actor.role, action, entity, entityId, summary });
  };

  // ---------- Listas de precios ----------
  const created = at(-110, 9);
  const lpr = (k: string) => `${letter}-lpr_${k}`;
  const mayoristaEntries: Record<string, PriceEntry> = {};
  if (line === 'tabaco') {
    // De mazo: un par de dólares menos por mazo, la caja más barata y desde 3 cajas, más todavía.
    for (const p of products.filter((x) => x.kind === 'mazo')) {
      const unit = p.priceToStore - 2;
      mayoristaEntries[p.id] = { mode: 'fixed', unit, box: (unit - 1) * p.packSize, volume: { minBoxes: 3, box: (unit - 2) * p.packSize } };
    }
    const bis = products.find((p) => p.sku === 'TB-BIS-ROB50');
    if (bis) mayoristaEntries[bis.id] = { mode: 'markup', markupPercent: 100 };
  } else {
    const elmio = prod('elmio');
    mayoristaEntries[elmio.id] = { mode: 'fixed', unit: 3.75, box: 43.2, volume: { minBoxes: 5, box: 42 } };
    mayoristaEntries[prod('caja24').id] = { mode: 'fixed', unit: 88 };
  }
  const priceLists: PriceList[] = [
    { id: lpr('pvp'), name: 'Público (PVP)', kind: 'pvp', entries: {}, active: true, createdAt: created, updatedAt: created },
    { id: lpr('local'), name: 'Local', kind: 'local', entries: {}, active: true, createdAt: created, updatedAt: created },
    { id: lpr('mayorista'), name: 'Mayorista', kind: 'mayorista', defaultMarkupPercent: line === 'tabaco' ? 95 : 55, entries: mayoristaEntries, active: true, createdAt: created, updatedAt: created },
  ];
  const listByKey = { local: priceLists[1]!, mayorista: priceLists[2]! };
  settings.defaultPriceListId = listByKey.local.id;
  for (const l of priceLists) log(created, admin, 'lista_precios.crear', 'priceList', l.id, `Lista nueva: ${l.name}`);

  // ---------- Locales que compran en firme ----------
  const defs = line === 'tabaco' ? TABACO_STORES : CAFE_STORES;
  const firmStores = new Map<string, Store>();
  const storeUser = new Map<string, User>();
  defs.forEach((d, i) => {
    const seller = users.find((u) => u.role === 'seller' && u.name === d.seller);
    if (!seller) throw new Error(`Semilla (venta en firme): vendedor desconocido ${d.seller}`);
    const n = i + 1;
    const approvedAt = at(-100 - n, 16);
    const store: Store = {
      id: id('loc'),
      name: d.name,
      type: d.type,
      address: `${7000 + n * 53} Avenida Ejemplo (dirección de ejemplo)`,
      city: d.city,
      zoneId: d.zone,
      lat: d.lat,
      lng: d.lng,
      managerName: d.manager,
      phone: `(305) 555-02${String(n + (line === 'tabaco' ? 0 : 40)).padStart(2, '0')}`,
      email: `${d.key}@example.com`,
      hours: 'Todos los días 7:00–22:00',
      sellerId: seller.id,
      status: 'activo',
      tobaccoPermit: line === 'tabaco' ? { number: `TP-DEMO-${61200 + n * 17}`, expiresOn: dateOf(180 + n * 37) } : undefined,
      saleMode: 'firme',
      creditDays: d.creditDays,
      priceListId: listByKey[d.list].id,
      taxId: `00-00012${String(n + (line === 'tabaco' ? 0 : 10)).padStart(2, '0')}`,
      resaleCert: { number: `RC-DEMO-${7700 + n + (line === 'tabaco' ? 0 : 50)}`, expiresOn: d.resale === 'vencido' ? dateOf(-140) : dateOf(200 + n * 23) },
      notes: d.resale === 'vencido' ? 'Compra en firme. El certificado de reventa venció: pedir el nuevo (sus facturas salen «sin certificado de reventa»).' : 'Compra en firme (mayoreo).',
      createdAt: at(-106 - n, 11),
      createdBy: admin.id,
      approvedAt,
      statusHistory: [
        { status: 'prospecto', at: at(-106 - n, 11), by: admin.id },
        { status: 'activo', at: approvedAt, by: admin.id },
      ],
    };
    stores.push(store);
    firmStores.set(d.key, store);
    const u: User = { id: id('usr'), role: 'store', name: d.manager, email: store.email, phone: store.phone, zoneId: store.zoneId, storeId: store.id, active: true, createdAt: approvedAt };
    users.push(u);
    storeUser.set(store.id, u);
    log(store.createdAt, admin, 'local.registrar', 'store', store.id, `Tienda registrada: ${store.name} (${store.city})`);
    log(approvedAt, admin, 'local.activo', 'store', store.id, `${store.name}: Activo (compra en firme, ${d.creditDays ? `a crédito ${d.creditDays} días` : 'de contado'})`);
  });
  const storeByKey = (key: string): Store => {
    const s = firmStores.get(key) ?? stores.find((x) => x.name === key);
    if (!s) throw new Error(`Semilla (venta en firme): local desconocido ${key}`);
    return s;
  };

  // ---------- Lo que va a pasar (para dimensionar las llegadas del mayoreo) ----------
  type Ev =
    | { kind: 'order'; day: number; store: Store; def: FirmStoreDef; items: { product: Product; pack: SalePack; packQty: number }[]; origin: NonNullable<Reorder['origin']> }
    | { kind: 'quick'; day: number; store: Store; items: { product: Product; pack: SalePack; packQty: number }[]; pay: PaymentMethod | 'cuenta' };
  const events: Ev[] = [];
  for (const d of defs) {
    const store = firmStores.get(d.key)!;
    for (let day = d.firstDay; day <= -3; day += d.every + between(-1, 1)) {
      const chosen = d.buys.filter((_, i) => i === 0 || rng() < 0.7);
      const items = chosen.map((b) => ({ product: prod(b.product), pack: b.pack, packQty: between(b.qty[0], b.qty[1]) }));
      // Lo de mazo se pide en números redondos (de 5 en 5).
      for (const it of items) if (it.product.unitName === 'mazo' && it.pack === 'unidad') it.packQty = Math.max(5, Math.round(it.packQty / 5) * 5);
      const r = rng();
      events.push({ kind: 'order', day, store, def: d, items, origin: r < 0.45 ? 'telefono' : r < 0.75 ? 'local' : 'pegado' });
    }
  }
  for (const q of QUICK_SALES[line]) {
    const store = storeByKey(q.store);
    for (const day of q.days) events.push({ kind: 'quick', day, store, items: q.buys.map((b) => ({ product: prod(b.product), pack: b.pack, packQty: b.qty })), pay: q.pay });
  }
  events.sort((a, b) => a.day - b.day || a.store.name.localeCompare(b.store.name, 'es'));

  // ---------- Llegadas del mayoreo: dos, con un 15 % de margen ----------
  const SPLIT = -50;
  const demand = [new Map<string, number>(), new Map<string, number>()];
  for (const e of events) {
    const half = e.day < SPLIT ? 0 : 1;
    for (const it of e.items) demand[half]!.set(it.product.id, (demand[half]!.get(it.product.id) ?? 0) + baseQty(it.product, it.pack, it.packQty));
  }
  const lotQty = new Map<string, number>();
  const firmLots = new Map<string, Lot[]>();
  [-98, SPLIT - 1].forEach((day, half) => {
    const need = demand[half]!;
    if (need.size === 0) return;
    const arrivalId = id('arr');
    const when = at(day, 8, 30);
    const year = today0.plus({ days: day }).year;
    const roast = line === 'cafe';
    const code = `${roast ? 'TOST' : 'IMP'}-${year}-${String(arrivals.length + 1).padStart(3, '0')}`;
    const items = [...need].map(([productId, qty]) => {
      const p = products.find((x) => x.id === productId)!;
      const step = Math.max(1, p.packSize);
      return { productId, qty: Math.ceil((qty * 1.15) / step) * step + step, unitCost: p.cost };
    });
    const history: Arrival['statusHistory'] = roast
      ? [
          { status: 'programado', at: at(day - 6, 9) },
          { status: 'tostado', at: at(day - 1, 15) },
          { status: 'recibida', at: when },
        ]
      : [
          { status: 'produccion', at: at(day - 45, 9) },
          { status: 'transito', at: at(day - 20, 9) },
          { status: 'aduana', at: at(day - 4, 9) },
          { status: 'recibida', at: when },
        ];
    arrivals.push({
      id: arrivalId,
      kind: roast ? 'roast' : 'import',
      code,
      status: 'recibida',
      eta: dateOf(day),
      supplier: roast ? 'Tostadora El Mío, Miami' : 'Taller asociado en Estelí (ejemplo)',
      originCountry: roast ? 'EE. UU. (tostado en Miami)' : 'Nicaragua',
      productionLine: roast ? 'Línea 1 · Espresso' : undefined,
      items,
      notes: 'Para el mayoreo (venta en firme).',
      createdAt: history[0]!.at,
      receivedAt: when,
      statusHistory: history,
    });
    items.forEach((it, i) => {
      const p = products.find((x) => x.id === it.productId)!;
      // Café: la misma vida útil que sus otros lotes.
      const sample = lots.find((l) => l.productId === p.id && l.bestBefore && l.producedOn);
      const shelf = sample ? Math.round(DateTime.fromISO(sample.bestBefore!).diff(DateTime.fromISO(sample.producedOn!), 'days').days) : 180;
      const lot: Lot = {
        id: id('lot'),
        productId: p.id,
        code: `${code}-${i + 1}`,
        arrivalId,
        unitCost: round2(p.cost * (0.98 + rng() * 0.04)),
        receivedAt: when,
        producedOn: roast ? dateOf(day - 1) : undefined,
        bestBefore: roast ? dateOf(day - 1 + shelf) : undefined,
        productionLine: roast ? String(p.attrs.productionLine ?? '') || undefined : undefined,
      };
      lots.push(lot);
      firmLots.set(p.id, [...(firmLots.get(p.id) ?? []), lot]);
      lotQty.set(lot.id, it.qty);
      movements.push({ id: id('mov'), at: when, type: 'entrada', productId: p.id, lotId: lot.id, qty: it.qty, from: { kind: 'supplier' }, to: WAREHOUSE, storeId: null, refType: 'arrival', refId: arrivalId, actorId: admin.id });
    });
    log(when, admin, 'llegada.recibir', 'arrival', arrivalId, `Recibida ${code}: ${items.reduce((a, x) => a + x.qty, 0)} unidades (mayoreo)`);
  });

  /** Saca del almacén, de los lotes del mayoreo y en orden de llegada (nunca más de lo que hay). */
  const take = (p: Product, qty: number): { lotId: string; qty: number; unitCost: number }[] => {
    const out: { lotId: string; qty: number; unitCost: number }[] = [];
    let left = qty;
    for (const lot of firmLots.get(p.id) ?? []) {
      if (left === 0) break;
      const have = lotQty.get(lot.id) ?? 0;
      const q = Math.min(have, left);
      if (q <= 0) continue;
      lotQty.set(lot.id, have - q);
      out.push({ lotId: lot.id, qty: q, unitCost: lot.unitCost });
      left -= q;
    }
    if (left > 0) throw new Error(`Semilla (venta en firme): no alcanza ${p.name}.`);
    return out;
  };

  // ---------- La historia ----------
  const codeNum = (list: { code: string }[], prefix: string) => Math.max(0, ...list.map((x) => Number(x.code.replace(`${prefix}-`, '')) || 0));
  let nextDelivery = codeNum(deliveries, 'E');
  let nextReorder = codeNum(reorders, 'P');
  const invoices: Invoice[] = [];
  const productsById = new Map(products.map((p) => [p.id, p]));
  const plannedPayments: { day: number; hour: number; invoice: Invoice; amount: number; method: PaymentMethod }[] = [];
  const unpaid = new Set<string>();

  const writeInvoice = (store: Store, items: { product: Product; pack: SalePack; packQty: number }[], when: string, day: number, origin: Invoice['origin'], sellerId: string | null, actor: User, refs: { deliveryId?: string; reorderId?: string }): Invoice => {
    const list = priceLists.find((l) => l.id === store.priceListId) ?? listByKey.local;
    const invoiceId = id('fac');
    const lines: InvoiceLine[] = items.map((it) => {
      const qty = baseQty(it.product, it.pack, it.packQty);
      const quote = priceFor(it.product, list, { pack: it.pack, qty: it.packQty });
      const parts = take(it.product, qty);
      for (const part of parts) {
        movements.push({ id: id('mov'), at: when, type: 'venta_firme', productId: it.product.id, lotId: part.lotId, qty: part.qty, from: WAREHOUSE, to: { kind: 'sold' }, storeId: store.id, refType: 'invoice', refId: invoiceId, actorId: actor.id });
      }
      return {
        productId: it.product.id,
        name: it.product.name,
        pack: it.pack,
        packQty: it.packQty,
        qty,
        unitPrice: quote.price,
        amount: round2(quote.price * it.packQty),
        cost: round2(parts.reduce((a, x) => a + x.qty * x.unitCost, 0)),
        lots: parts,
      };
    });
    const withoutResaleCert = !hasValidResaleCert(store, new Date(when));
    const creditDays = creditDaysFor(store, settings);
    const inv: Invoice = {
      id: invoiceId,
      code: `F-${String(invoices.length + 1).padStart(4, '0')}`,
      storeId: store.id,
      sellerId,
      origin,
      deliveryId: refs.deliveryId,
      reorderId: refs.reorderId,
      priceListId: list.id,
      lines,
      ...invoiceTotals(lines, settings.salesTaxPercent, withoutResaleCert),
      paid: 0,
      status: 'pendiente',
      issuedAt: when,
      dueOn: invoiceDueOn(dateOf(day), creditDays),
      creditDays,
      withoutResaleCert,
      note: '',
      createdBy: actor.id,
    };
    invoices.push(inv);
    const seller = sellerId ? users.find((u) => u.id === sellerId) : undefined;
    commissions.push(...invoiceCommissions(inv, productsById, seller, settings.commissionPayableOn, id));
    log(when, actor, 'factura.emitir', 'invoice', inv.id, `${inv.code} para ${store.name}: ${inv.total.toFixed(2)} USD`);
    return inv;
  };

  const pay = (inv: Invoice, amount: number, when: string, method: PaymentMethod) => {
    const p: Payment = {
      id: id('pag'),
      invoiceId: inv.id,
      storeId: inv.storeId,
      amount: round2(amount),
      method,
      reference: method === 'cheque' ? `CHK ${3000 + Math.floor(rng() * 6000)}` : method === 'zelle' ? `ZL-${Math.floor(rng() * 899999 + 100000)}` : '',
      at: when,
      recordedBy: admin.id,
    };
    payments.push(p);
    inv.paid = round2(inv.paid + p.amount);
    inv.status = invoiceStatus(inv.total, inv.paid);
    if (inv.status === 'pagada') {
      inv.paidAt = when;
      if (settings.commissionPayableOn === 'cobro') {
        for (const c of commissions) {
          if (c.invoiceId === inv.id && c.status === 'devengada') {
            c.status = 'pagable';
            c.payableAt = when;
          }
        }
      }
    }
    const store = stores.find((s) => s.id === inv.storeId);
    log(when, admin, 'pago.registrar', 'payment', p.id, `Pago de ${p.amount.toFixed(2)} USD (${method}) a ${inv.code} de ${store?.name ?? inv.storeId}`);
  };

  const cashLike = (): PaymentMethod => {
    const r = rng();
    return r < 0.78 ? 'efectivo' : r < 0.9 ? 'zelle' : 'cheque';
  };

  for (const e of events) {
    // Pagos que tocan antes de este día.
    for (const pp of plannedPayments.filter((x) => x.day < e.day)) pay(pp.invoice, pp.amount, at(pp.day, pp.hour, Math.floor(rng() * 50)), pp.method);
    for (let i = plannedPayments.length - 1; i >= 0; i--) if (plannedPayments[i]!.day < e.day) plannedPayments.splice(i, 1);

    if (e.kind === 'quick') {
      const when = at(e.day, between(9, 15), between(0, 55));
      const inv = writeInvoice(e.store, e.items, when, e.day, 'venta_rapida', null, admin, {});
      log(when, admin, 'venta_rapida.registrar', 'invoice', inv.id, `Venta rápida ${inv.code} a ${e.store.name}: ${inv.total.toFixed(2)} USD`);
      if (e.pay === 'cuenta') plannedPayments.push({ day: e.day + between(4, 9), hour: 11, invoice: inv, amount: inv.total, method: 'efectivo' });
      else pay(inv, inv.total, when, e.pay);
      continue;
    }

    const { store, def } = e;
    const seller = users.find((u) => u.id === store.sellerId)!;
    const su = storeUser.get(store.id)!;
    const createdAt = at(e.day, 9 + between(0, 2), between(0, 55));
    const confirmedAt = e.origin === 'local' ? at(e.day, 12, between(0, 50)) : createdAt;
    const preparedAt = at(e.day, 15, between(0, 50));
    const deliveredAt = at(e.day + 1, 10 + between(0, 3), between(0, 55));
    const baseItems = e.items.map((it) => ({ productId: it.product.id, qty: baseQty(it.product, it.pack, it.packQty) }));
    const reorder: Reorder = {
      id: id('ped'),
      code: `P-${String(++nextReorder).padStart(4, '0')}`,
      storeId: store.id,
      sellerId: seller.id,
      status: 'entregado',
      items: baseItems,
      note: e.origin === 'pegado' ? 'Pegado de un mensaje de WhatsApp.' : '',
      createdAt,
      createdBy: e.origin === 'local' ? su.id : admin.id,
      confirmedAt,
      origin: e.origin,
      history: [
        { status: 'enviado', at: createdAt, by: e.origin === 'local' ? su.id : admin.id },
        { status: 'confirmado', at: confirmedAt, by: e.origin === 'local' ? seller.id : admin.id },
        { status: 'preparado', at: preparedAt, by: admin.id },
        { status: 'entregado', at: deliveredAt, by: seller.id },
      ],
    };
    const how = e.origin === 'telefono' ? 'Pedido por teléfono' : e.origin === 'pegado' ? 'Pedido pegado de un mensaje' : 'Pedido del local';
    const delivery: Delivery = {
      id: id('ent'),
      code: `E-${String(++nextDelivery).padStart(4, '0')}`,
      storeId: store.id,
      sellerId: seller.id,
      status: 'entregada',
      items: baseItems.map((i) => ({ ...i, preparedQty: i.qty })),
      note: `${how} ${reorder.code}`,
      origin: 'pedido_local',
      reorderId: reorder.id,
      requestedAt: confirmedAt,
      requestedBy: e.origin === 'local' ? seller.id : admin.id,
      preparedAt,
      preparedBy: admin.id,
      deliveredAt,
      receivedSignature: { role: 'local', name: store.managerName, image: demoSignature(store.managerName), signedAt: deliveredAt, deviceUserId: seller.id },
    };
    reorder.deliveryId = delivery.id;
    // La factura sale con lo entregado: cajas completas a precio de caja y lo suelto por unidad.
    const invItems = e.items.flatMap((it) => splitIntoPacks(it.product, baseQty(it.product, it.pack, it.packQty)).map((part) => ({ product: it.product, pack: part.pack, packQty: part.packQty })));
    const inv = writeInvoice(store, invItems, deliveredAt, e.day + 1, 'entrega', seller.id, seller, { deliveryId: delivery.id, reorderId: reorder.id });
    delivery.invoiceId = inv.id;
    reorders.push(reorder);
    deliveries.push(delivery);
    log(createdAt, e.origin === 'local' ? su : admin, e.origin === 'local' ? 'pedido.crear' : e.origin === 'telefono' ? 'pedido.telefono' : 'pedido.pegado', 'reorder', reorder.id, `${how}: ${reorder.code} de ${store.name}`);
    log(preparedAt, admin, 'entrega.preparar', 'delivery', delivery.id, `${delivery.code} preparada para ${store.name}`);
    log(deliveredAt, seller, 'entrega.recibir', 'delivery', delivery.id, `${delivery.code} entregada en ${store.name}, recibió ${store.managerName}`);

    // Cobro: de contado al entregar; a crédito, dentro del plazo (a veces en dos partes). El local que
    // deja de pagar tiene UNA factura vencida (la última que ya pasó su fecha).
    const payDay = e.day + 1;
    const dueDay = payDay + def.creditDays;
    if (def.creditDays === 0) {
      if (rng() < 0.9 || payDay >= -2) pay(inv, inv.total, at(payDay, 16, between(0, 50)), cashLike());
      else plannedPayments.push({ day: payDay + 1, hour: 11, invoice: inv, amount: inv.total, method: 'efectivo' });
    } else if (def.stopsPaying && dueDay >= -14 && dueDay <= -3 && !unpaid.has(store.id)) {
      unpaid.add(store.id);
    } else {
      const lag = between(5, def.creditDays - 1);
      const method = rng() < 0.6 ? 'efectivo' : rng() < 0.6 ? 'cheque' : 'zelle';
      if (rng() < 0.25) {
        const half = round2(inv.total / 2);
        plannedPayments.push({ day: payDay + Math.max(2, lag - 4), hour: 11, invoice: inv, amount: half, method });
        plannedPayments.push({ day: payDay + lag, hour: 12, invoice: inv, amount: round2(inv.total - half), method });
      } else plannedPayments.push({ day: payDay + lag, hour: 11, invoice: inv, amount: inv.total, method });
    }
  }
  for (const pp of plannedPayments.filter((x) => x.day <= -1).sort((a, b) => a.day - b.day)) pay(pp.invoice, pp.amount, at(pp.day, pp.hour, Math.floor(rng() * 50)), pp.method);

  // Comisiones del mayoreo ya cobradas antes del pago a vendedores del día -31: se pagaron ese día.
  const payoutAt = at(-31, 16, 45);
  const bySeller = new Map<string, Commission[]>();
  for (const c of commissions) if (c.invoiceId && c.status === 'pagable' && (c.payableAt ?? '') <= payoutAt) bySeller.set(c.sellerId, [...(bySeller.get(c.sellerId) ?? []), c]);
  for (const [sellerId, list] of bySeller) {
    const po: CommissionPayout = {
      id: id('pgc'),
      sellerId,
      amount: round2(list.reduce((a, c) => a + c.amount, 0)),
      commissionIds: list.map((c) => c.id),
      method: 'zelle',
      reference: `ZL-${Math.floor(rng() * 899999 + 100000)}`,
      at: payoutAt,
      recordedBy: admin.id,
    };
    payouts.push(po);
    for (const c of list) {
      c.status = 'pagada';
      c.paidAt = payoutAt;
      c.payoutId = po.id;
    }
    log(payoutAt, admin, 'comision.pagar', 'payout', po.id, `Comisiones del mayoreo pagadas a ${users.find((u) => u.id === sellerId)?.name ?? sellerId}: ${po.amount.toFixed(2)} USD`);
  }

  // Avisos de hoy: la última factura de cada local en firme y la factura vencida.
  for (const [, store] of firmStores) {
    const last = invoices.filter((i) => i.storeId === store.id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
    const su = storeUser.get(store.id)!;
    if (last) notifications.push({ id: id('ntf'), userId: su.id, kind: 'factura_nueva', title: `Factura ${last.code}`, body: `${last.total.toFixed(2)} USD.`, link: `/${line}/cuentas`, at: last.issuedAt, read: last.status === 'pagada' });
  }
  const today = dateOf(0);
  for (const inv of invoices.filter((i) => i.status !== 'pagada' && i.dueOn < today)) {
    const store = stores.find((s) => s.id === inv.storeId)!;
    notifications.push({ id: id('ntf'), userId: admin.id, kind: 'pago_vencido', title: `Factura vencida: ${store.name}`, body: `${inv.code} venció el ${fmtDate(inv.dueOn)} y no está pagada.`, link: `/${line}/cobros`, at: at(-1, 8, 5), read: false });
  }

  return {
    ...tables,
    priceLists,
    invoices,
    audit: audit.sort((a, b) => a.at.localeCompare(b.at)),
  };
}
