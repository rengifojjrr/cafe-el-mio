// Simulador de la semilla: arma tres meses de historia de una línea con las MISMAS reglas
// del dominio (libro de movimientos, comisiones, liquidaciones). Si una regla se rompe,
// la semilla falla en vez de dejar datos imposibles.
import { DateTime } from 'luxon';
import type {
  Announcement,
  AppNotification,
  Arrival,
  ArrivalStatus,
  AuditEntry,
  Commission,
  CommissionPayout,
  Contract,
  Delivery,
  IsoDate,
  LineId,
  LineSettings,
  Lot,
  Message,
  Movement,
  Payment,
  PaymentMethod,
  Product,
  Reorder,
  ReturnRecord,
  SalesReport,
  Settlement,
  Signature,
  Store,
  StoreStatus,
  Thread,
  UnmetDemand,
  User,
  Visit,
  Warehouse,
  Zone,
} from '../data/types';
import { annexText, renderTemplate } from '../domain/contract';
import { consignmentCheck } from '../domain/compliance';
import { Balances, WAREHOUSE, allocate, storeLoc } from '../domain/ledger';
import { commissionAmount, effectiveRule, settlementLines, settlementStatus, storeEarning } from '../domain/money-rules';
import type { LineConfig } from '../lines/config';
import { idFactory, seededRandom } from '../lib/ids';
import { round2 } from '../lib/money';
import { ZONE, fmtDate } from '../lib/time';
import { demoSignature } from './signature';

export interface ProductSeed extends Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'photoIds' | 'sampleCost'> {
  key: string;
  /** Unidades por semana que vende un local mediano. */
  rate: number;
  /** Café: días entre tostado y «consumir antes de». */
  shelfLifeDays?: number;
  /** Factor de compras: <1 deja el producto con stock bajo al final. */
  supply?: number;
}

export interface StoreSeed {
  key: string;
  name: string;
  type: string;
  zone: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  managerName: string;
  phone: string;
  email: string;
  hours: string;
  seller: string;
  /** Día (negativo) en que quedó activo. null: nunca se activó. */
  activationDay: number | null;
  final: StoreStatus;
  pausedDay?: number;
  assortment: string[];
  size: number;
  permit?: { number: string; expiresDay: number };
  overdue?: boolean;
  expiringLotOf?: string;
  notes?: string;
}

export interface UserSeed {
  key: string;
  role: 'admin' | 'seller';
  name: string;
  email: string;
  phone: string;
  zone?: string;
  commissionOverride?: User['commissionOverride'];
}

export interface PendingArrivalSeed {
  inDays: number;
  status: ArrivalStatus;
  supplier: string;
  originCountry: string;
  productionLine?: string;
  items: { product: string; qty: number }[];
}

export interface LineSeedDef {
  line: LineId;
  config: LineConfig;
  seed: number;
  settings: Omit<LineSettings, 'id' | 'contractTemplate' | 'contractTemplateVersion' | 'warehouseName'>;
  warehouse: Omit<Warehouse, 'id'>;
  zones: (Zone & { key?: string })[];
  users: UserSeed[];
  products: ProductSeed[];
  stores: StoreSeed[];
  /** Llegadas recibidas en el pasado: [día, productos] (las cantidades salen de la demanda). */
  restockDays: number[];
  pendingArrivals: PendingArrivalSeed[];
  supplierFor: (p: ProductSeed) => { supplier: string; originCountry: string; productionLine?: string };
  primary: { admin: string; seller: string; store: string };
  pendingReorders: { store: string; status: 'enviado' | 'confirmado'; items: { product: string; packs: number }[]; note: string }[];
  messages: { kind: Thread['kind']; between: [string, string]; store?: string; lines: { from: 0 | 1; text: string; hoursAgo: number; product?: string }[] }[];
  announcements: { title: string; body: string; audience: Announcement['audience']; daysAgo: number }[];
  /** Producto cuyo stock bajo se enseña (llega en tránsito). */
  lowStockProduct: string;
}

export type SeedTables = Record<string, unknown[]>;

export function simulateLine(def: LineSeedDef, now: Date): SeedTables {
  const rng = seededRandom(def.seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
  const letter = def.line === 'tabaco' ? 't' : 'c';
  const rawId = idFactory();
  const id = (prefix: string) => `${letter}-${rawId(prefix)}`;
  const nowNy = DateTime.fromJSDate(now).setZone(ZONE);
  const today0 = nowNy.startOf('day');
  /** Instante de un día relativo (negativo = pasado) a una hora de Miami. */
  const at = (day: number, hour: number, minute = 0): string => today0.plus({ days: day }).set({ hour, minute }).toUTC().toISO()!;
  const dateOf = (day: number): IsoDate => today0.plus({ days: day }).toISODate()! as IsoDate;
  const ago = (hours: number): string => nowNy.minus({ hours }).toUTC().toISO()!;
  const nowIso = now.toISOString();

  // ---------- Tablas ----------
  const zones: Zone[] = def.zones.map(({ key: _k, ...z }) => z);
  const zoneIds = new Set(zones.map((z) => z.id));
  const users: User[] = [];
  const userByKey = new Map<string, User>();
  for (const u of def.users) {
    const user: User = {
      id: id('usr'),
      role: u.role,
      name: u.name,
      email: u.email,
      phone: u.phone,
      zoneId: u.zone,
      commissionOverride: u.commissionOverride,
      active: true,
      createdAt: at(-120, 9),
    };
    users.push(user);
    userByKey.set(u.key, user);
  }
  const admin = userByKey.get(def.primary.admin)!;

  const products: Product[] = [];
  const productByKey = new Map<string, Product>();
  const seedByProduct = new Map<string, ProductSeed>();
  for (const p of def.products) {
    const { key, rate: _r, shelfLifeDays: _s, supply: _sp, ...rest } = p;
    const product: Product = { ...rest, id: id('prd'), photoIds: [], sampleCost: true, createdAt: at(-120, 10), updatedAt: at(-120, 10) };
    products.push(product);
    productByKey.set(key, product);
    seedByProduct.set(product.id, p);
  }
  const prod = (key: string): Product => {
    const p = productByKey.get(key);
    if (!p) throw new Error(`Semilla: producto desconocido ${key}`);
    return p;
  };

  const settings: LineSettings = {
    id: 'settings',
    ...def.settings,
    warehouseName: def.warehouse.name,
    contractTemplate: def.config.contractTemplate,
    contractTemplateVersion: 1,
  };
  const warehouse: Warehouse = { id: 'almacen', ...def.warehouse };

  const lots: Lot[] = [];
  const lotsById = new Map<string, Lot>();
  const arrivals: Arrival[] = [];
  const movements: Movement[] = [];
  const balances = new Balances();
  const stores: Store[] = [];
  const storeByKey = new Map<string, Store>();
  const storeSeedById = new Map<string, StoreSeed>();
  const contracts: Contract[] = [];
  const deliveries: Delivery[] = [];
  const visits: Visit[] = [];
  const salesReports: SalesReport[] = [];
  const returns: ReturnRecord[] = [];
  const reorders: Reorder[] = [];
  const unmetDemand: UnmetDemand[] = [];
  const settlements: Settlement[] = [];
  const payments: Payment[] = [];
  const commissions: Commission[] = [];
  const payouts: CommissionPayout[] = [];
  const threads: Thread[] = [];
  const messages: Message[] = [];
  const announcements: Announcement[] = [];
  const notifications: AppNotification[] = [];
  const audit: AuditEntry[] = [];

  const log = (when: string, actor: User | null, action: string, entity: string, entityId: string, summary: string) => {
    audit.push({
      id: id('aud'),
      at: when,
      actorId: actor?.id ?? 'sistema',
      actorName: actor?.name ?? 'Sistema',
      role: actor?.role ?? 'sistema',
      action,
      entity,
      entityId,
      summary,
    });
  };
  const notifyUser = (userId: string, kind: AppNotification['kind'], title: string, body: string, link: string, when: string, read = false) => {
    notifications.push({ id: id('ntf'), userId, kind, title, body, link: `/${def.line}${link}`, at: when, read });
  };
  const move = (m: Omit<Movement, 'id'>) => {
    const mv: Movement = { ...m, id: id('mov') };
    movements.push(mv);
    balances.apply(mv);
  };

  // ---------- Demanda esperada (para dimensionar compras) ----------
  const weeklyDemand = new Map<string, number>();
  for (const s of def.stores) {
    if (s.activationDay === null) continue;
    for (const k of s.assortment) {
      const p = def.products.find((x) => x.key === k)!;
      weeklyDemand.set(k, (weeklyDemand.get(k) ?? 0) + p.rate * s.size);
    }
  }

  const receive = (day: number, items: { product: Product; qty: number }[], meta: { supplier: string; originCountry: string; productionLine?: string }, kind: Arrival['kind']) => {
    const year = today0.plus({ days: day }).year;
    const code = kind === 'roast' ? `TOST-${year}-${String(arrivals.length + 1).padStart(3, '0')}` : `IMP-${year}-${String(arrivals.length + 1).padStart(3, '0')}`;
    const arrivalId = id('arr');
    const when = at(day, 8, 10);
    const history: Arrival['statusHistory'] =
      kind === 'roast'
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
    const arrival: Arrival = {
      id: arrivalId,
      kind,
      code,
      status: 'recibida',
      eta: dateOf(day),
      supplier: meta.supplier,
      originCountry: meta.originCountry,
      productionLine: meta.productionLine,
      items: items.map((i) => ({ productId: i.product.id, qty: i.qty, unitCost: i.product.cost })),
      notes: '',
      createdAt: history[0]!.at,
      receivedAt: when,
      statusHistory: history,
    };
    arrivals.push(arrival);
    items.forEach((i, idx) => {
      const ps = seedByProduct.get(i.product.id)!;
      const lot: Lot = {
        id: id('lot'),
        productId: i.product.id,
        code: `${code}-${idx + 1}`,
        arrivalId,
        unitCost: round2(i.product.cost * (0.97 + rng() * 0.06)),
        receivedAt: when,
        producedOn: kind === 'roast' ? dateOf(day - 1) : undefined,
        bestBefore: kind === 'roast' ? dateOf(day - 1 + (ps.shelfLifeDays ?? 180)) : undefined,
        productionLine: meta.productionLine,
      };
      lots.push(lot);
      lotsById.set(lot.id, lot);
      move({ at: when, type: 'entrada', productId: i.product.id, lotId: lot.id, qty: i.qty, from: { kind: 'supplier' }, to: WAREHOUSE, storeId: null, refType: 'arrival', refId: arrivalId, actorId: admin.id });
    });
    log(when, admin, 'llegada.recibir', 'arrival', arrivalId, `Recibida ${code}: ${items.reduce((a, i) => a + i.qty, 0)} unidades`);
    return arrival;
  };

  // Compras del pasado: un pedido inicial grande y reposiciones periódicas.
  const firstDay = Math.min(...def.restockDays);
  const groups = new Map<string, ProductSeed[]>();
  for (const p of def.products) {
    const meta = def.supplierFor(p);
    const k = `${meta.supplier}|${meta.productionLine ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const restockAt = (i: number, day: number) => {
    const prevDay = def.restockDays[i - 1];
    for (const group of groups.values()) {
      const items = group
        .map((ps) => {
          const weekly = weeklyDemand.get(ps.key) ?? ps.rate;
          const weeks = i === 0 || prevDay === undefined ? 6.5 : ((day - prevDay) / 7) * 1.15;
          const raw = weekly * weeks * (ps.supply ?? 1) * (0.9 + rng() * 0.25);
          const pack = ps.packSize;
          return { product: prod(ps.key), qty: Math.max(pack * 2, Math.ceil(raw / pack) * pack) };
        })
        .filter((x) => x.qty > 0);
      if (items.length) receive(day, items, def.supplierFor(group[0]!), def.config.inbound);
    }
  };

  // Café: un lote viejo que se le entrega a un local y queda por vencer.
  const oldLotFor = new Map<string, Lot>();
  for (const s of def.stores) {
    if (!s.expiringLotOf) continue;
    const p = prod(s.expiringLotOf);
    const ps = seedByProduct.get(p.id)!;
    const shelf = ps.shelfLifeDays ?? 180;
    const producedDay = 9 - shelf;
    const lot: Lot = {
      id: id('lot'),
      productId: p.id,
      code: `TOST-${today0.plus({ days: producedDay }).year}-000-1`,
      arrivalId: null,
      unitCost: p.cost,
      receivedAt: at(firstDay - 2, 8),
      producedOn: dateOf(producedDay),
      bestBefore: dateOf(9),
      productionLine: String(p.attrs.productionLine ?? ''),
    };
    lots.push(lot);
    lotsById.set(lot.id, lot);
    move({ at: lot.receivedAt, type: 'entrada', productId: p.id, lotId: lot.id, qty: 12, from: { kind: 'supplier' }, to: WAREHOUSE, storeId: null, refType: 'seed', refId: 'inventario-inicial', actorId: admin.id });
    oldLotFor.set(s.key, lot);
  }

  // ---------- Locales ----------
  const sellerOf = (s: StoreSeed) => userByKey.get(s.seller)!;
  for (const s of def.stores) {
    if (!zoneIds.has(s.zone)) throw new Error(`Semilla: zona desconocida ${s.zone}`);
    const seller = sellerOf(s);
    const created = s.activationDay !== null ? s.activationDay - 9 : s.final === 'prospecto' ? -3 : s.final === 'contrato_enviado' ? -5 : -8;
    const store: Store = {
      id: id('loc'),
      name: s.name,
      type: s.type,
      address: s.address,
      city: s.city,
      zoneId: s.zone,
      lat: s.lat,
      lng: s.lng,
      managerName: s.managerName,
      phone: s.phone,
      email: s.email,
      hours: s.hours,
      sellerId: seller.id,
      status: 'prospecto',
      tobaccoPermit: s.permit ? { number: s.permit.number, expiresOn: dateOf(s.permit.expiresDay) } : undefined,
      notes: s.notes ?? '',
      createdAt: at(created, 11),
      createdBy: seller.id,
      statusHistory: [{ status: 'prospecto', at: at(created, 11), by: seller.id }],
    };
    stores.push(store);
    storeByKey.set(s.key, store);
    storeSeedById.set(store.id, s);
    log(store.createdAt, seller, 'local.registrar', 'store', store.id, `Tienda registrada: ${store.name} (${store.city})`);
  }

  const setStatus = (store: Store, status: StoreStatus, when: string, by: User) => {
    store.status = status;
    store.statusHistory.push({ status, at: when, by: by.id });
    if (status === 'activo' && !store.approvedAt) store.approvedAt = when;
  };

  const makeContract = (store: Store, day: number, signed: boolean): Contract => {
    const seller = users.find((u) => u.id === store.sellerId)!;
    const annex = products
      .filter((p) => p.active)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map((p) => ({ productId: p.id, name: p.name, sku: p.sku, priceToStore: p.priceToStore, suggestedRetail: p.suggestedRetail, storeEarning: storeEarning(p) }));
    const vars: Record<string, string> = {
      'contrato.version': '1',
      fecha: fmtDate(at(day, 10)),
      'empresa.nombre': settings.companyName,
      'empresa.representante': seller.name,
      'local.nombre': store.name,
      'local.tipo': store.type.toLowerCase(),
      'local.direccion': `${store.address}, ${store.city}`,
      'local.encargado': store.managerName,
      'local.telefono': store.phone,
      'local.correo': store.email || 'sin correo',
      'liquidacion.dias': String(settings.settlementEveryDays),
      'pago.dias': String(settings.paymentTermsDays),
      'vigencia.meses': String(settings.contractTermMonths),
      'aviso.dias': String(settings.terminationNoticeDays),
      'anexo.productos': annexText(annex, def.config.unitName.one),
    };
    if (store.tobaccoPermit) {
      vars['permiso.numero'] = store.tobaccoPermit.number;
      vars['permiso.vence'] = fmtDate(store.tobaccoPermit.expiresOn);
    }
    const { text, missing } = renderTemplate(settings.contractTemplate, vars);
    if (missing.length) throw new Error(`Semilla: faltan variables del contrato de ${store.name}: ${missing.join(', ')}`);
    const createdAt = at(day, 10);
    const contract: Contract = {
      id: id('ctr'),
      storeId: store.id,
      version: 1,
      templateVersion: 1,
      status: signed ? 'firmado' : 'enviado',
      body: text,
      annex,
      settlementDays: settings.settlementEveryDays,
      createdAt,
      createdBy: seller.id,
      signatures: [],
    };
    if (signed) {
      const signedAt = at(day, 10, 40);
      const geo = { lat: store.lat + (rng() - 0.5) * 0.0004, lng: store.lng + (rng() - 0.5) * 0.0004, accuracy: 12 + Math.round(rng() * 20) };
      const sig = (role: Signature['role'], name: string): Signature => ({ role, name, image: demoSignature(name), signedAt, geo, deviceUserId: seller.id });
      contract.signatures = [sig('local', store.managerName), sig('empresa', seller.name)];
      contract.signedAt = signedAt;
    }
    contracts.push(contract);
    log(createdAt, seller, 'contrato.emitir', 'contract', contract.id, `Contrato v1 de ${store.name} listo para firmar`);
    if (signed) log(contract.signedAt!, seller, 'contrato.firmar', 'contract', contract.id, `Contrato v1 de ${store.name} firmado por ${store.managerName} y ${seller.name}`);
    return contract;
  };

  const storeUsers = new Map<string, User>();
  const createStoreUser = (store: Store, when: string) => {
    const u: User = {
      id: id('usr'),
      role: 'store',
      name: store.managerName,
      email: store.email,
      phone: store.phone,
      zoneId: store.zoneId,
      storeId: store.id,
      active: true,
      createdAt: when,
    };
    users.push(u);
    storeUsers.set(store.id, u);
    return u;
  };

  // ---------- Entregas ----------
  const deliveryCode = () => `E-${String(deliveries.length + 1).padStart(4, '0')}`;
  const deliver = (
    store: Store,
    items: { productId: string; qty: number }[],
    day: number,
    minute: number,
    origin: Delivery['origin'],
    opts?: { reorder?: Reorder; forceLot?: Lot },
  ): Delivery | null => {
    const seller = users.find((u) => u.id === store.sellerId)!;
    const deliverDay = day + 1;
    if (deliverDay > -1) return null;
    const check = consignmentCheck(def.line, store, new Date(at(deliverDay, 10)));
    if (!check.ok) return null;
    const prepared: Delivery['items'] = [];
    const shortages: UnmetDemand[] = [];
    for (const it of items) {
      const available = balances.qty(WAREHOUSE, it.productId);
      const take = opts?.forceLot ? it.qty : Math.min(it.qty, available);
      prepared.push({ productId: it.productId, qty: it.qty, preparedQty: take });
      if (take < it.qty) {
        shortages.push({ id: id('dna'), productId: it.productId, storeId: store.id, qty: it.qty - take, at: at(day, 15), source: opts?.reorder ? 'pedido' : 'entrega', refId: opts?.reorder?.id ?? '' });
      }
    }
    const total = prepared.reduce((a, i) => a + (i.preparedQty ?? 0), 0);
    const dId = id('ent');
    for (const s of shortages) if (!s.refId) s.refId = dId;
    unmetDemand.push(...shortages);
    if (total === 0) return null;
    const deliveredAt = at(deliverDay, 10, minute % 60);
    const recipient = store.managerName;
    for (const it of prepared) {
      const qty = it.preparedQty ?? 0;
      if (qty <= 0) continue;
      const parts = opts?.forceLot ? [{ lotId: opts.forceLot.id, qty }] : allocate(balances, lotsById, WAREHOUSE, it.productId, qty);
      for (const part of parts) {
        move({ at: deliveredAt, type: 'salida_consignacion', productId: it.productId, lotId: part.lotId, qty: part.qty, from: WAREHOUSE, to: storeLoc(store.id), storeId: store.id, refType: 'delivery', refId: dId, actorId: seller.id });
      }
    }
    const d: Delivery = {
      id: dId,
      code: deliveryCode(),
      storeId: store.id,
      sellerId: store.sellerId,
      status: 'entregada',
      items: prepared,
      note: opts?.reorder ? `Pedido del local ${opts.reorder.code}` : '',
      origin,
      reorderId: opts?.reorder?.id,
      requestedAt: at(day, 9, minute % 60),
      requestedBy: opts?.reorder ? seller.id : origin === 'administracion' ? admin.id : seller.id,
      preparedAt: at(day, 15, minute % 60),
      preparedBy: admin.id,
      deliveredAt,
      receivedSignature: { role: 'local', name: recipient, image: demoSignature(recipient), signedAt: deliveredAt, deviceUserId: seller.id },
    };
    deliveries.push(d);
    log(deliveredAt, seller, 'entrega.recibir', 'delivery', d.id, `${d.code} entregada en ${store.name}: ${total} unidades, recibió ${recipient}`);
    return d;
  };

  // ---------- Ventas ----------
  const reportSale = (store: Store, sold: { productId: string; qty: number }[], when: string, source: SalesReport['source'], by: User): SalesReport | null => {
    const lines: SalesReport['lines'] = [];
    const reportId = id('vta');
    const seller = users.find((u) => u.id === store.sellerId)!;
    for (const s of sold) {
      if (s.qty <= 0) continue;
      const p = products.find((x) => x.id === s.productId)!;
      const parts = allocate(balances, lotsById, storeLoc(store.id), s.productId, s.qty, p.name);
      let cost = 0;
      const lotsUsed: SalesReport['lines'][number]['lots'] = [];
      for (const part of parts) {
        const unitCost = lotsById.get(part.lotId)?.unitCost ?? p.cost;
        cost += part.qty * unitCost;
        lotsUsed.push({ lotId: part.lotId, qty: part.qty, unitCost });
        move({ at: when, type: 'venta_reportada', productId: s.productId, lotId: part.lotId, qty: part.qty, from: storeLoc(store.id), to: { kind: 'sold' }, storeId: store.id, refType: 'sale', refId: reportId, actorId: by.id });
      }
      lines.push({ productId: s.productId, qty: s.qty, unitPrice: p.priceToStore, cost: round2(cost), lots: lotsUsed });
      const rule = effectiveRule(p, seller);
      commissions.push({
        id: id('com'),
        sellerId: seller.id,
        storeId: store.id,
        productId: p.id,
        salesReportId: reportId,
        settlementId: null,
        qty: s.qty,
        base: round2(s.qty * p.priceToStore),
        amount: commissionAmount(rule, s.qty, p.priceToStore),
        rule,
        status: 'devengada',
        accruedAt: when,
      });
    }
    if (lines.length === 0) return null;
    const report: SalesReport = {
      id: reportId,
      storeId: store.id,
      sellerId: seller.id,
      at: when,
      source,
      lines,
      total: round2(lines.reduce((a, l) => a + l.qty * l.unitPrice, 0)),
      settlementId: null,
      createdBy: by.id,
    };
    salesReports.push(report);
    return report;
  };

  const settle = (store: Store, day: number): Settlement | null => {
    const pending = salesReports.filter((r) => r.storeId === store.id && !r.settlementId);
    if (pending.length === 0) return null;
    const lines = settlementLines(pending);
    const sorted = [...pending].sort((a, b) => a.at.localeCompare(b.at));
    const s: Settlement = {
      id: id('liq'),
      code: `L-${String(settlements.length + 1).padStart(4, '0')}`,
      storeId: store.id,
      sellerId: store.sellerId,
      periodFrom: sorted[0]!.at,
      periodTo: sorted[sorted.length - 1]!.at,
      issuedAt: at(day, 9, 5),
      dueOn: dateOf(day + settings.paymentTermsDays),
      salesReportIds: pending.map((r) => r.id),
      lines,
      amount: round2(lines.reduce((a, l) => a + l.amount, 0)),
      paid: 0,
      status: 'pendiente',
    };
    settlements.push(s);
    for (const r of pending) r.settlementId = s.id;
    for (const c of commissions) if (pending.some((r) => r.id === c.salesReportId)) c.settlementId = s.id;
    log(s.issuedAt, admin, 'liquidacion.generar', 'settlement', s.id, `${s.code} para ${store.name}: ${s.amount.toFixed(2)} USD`);
    return s;
  };

  const pay = (s: Settlement, amount: number, day: number, method: PaymentMethod) => {
    const when = at(day, 11, Math.floor(rng() * 50));
    const p: Payment = {
      id: id('pag'),
      settlementId: s.id,
      storeId: s.storeId,
      amount: round2(amount),
      method,
      reference: method === 'efectivo' ? '' : method === 'cheque' ? `CHK ${1000 + Math.floor(rng() * 8999)}` : `${method === 'zelle' ? 'ZL' : 'TR'}-${Math.floor(rng() * 899999 + 100000)}`,
      at: when,
      recordedBy: admin.id,
    };
    payments.push(p);
    s.paid = round2(s.paid + p.amount);
    s.status = settlementStatus(s.amount, s.paid);
    if (s.status === 'pagada') {
      s.paidAt = when;
      for (const c of commissions) {
        if (c.settlementId === s.id && c.status === 'devengada') {
          c.status = 'pagable';
          c.payableAt = when;
        }
      }
    }
    log(when, admin, 'pago.registrar', 'payment', p.id, `Pago de ${p.amount.toFixed(2)} USD (${method}) a ${s.code}`);
  };

  const payoutAll = (day: number) => {
    const when = at(day, 16, 30);
    const bySeller = new Map<string, Commission[]>();
    for (const c of commissions) {
      if (c.status !== 'pagable' || (c.payableAt ?? '') > when) continue;
      bySeller.set(c.sellerId, [...(bySeller.get(c.sellerId) ?? []), c]);
    }
    for (const [sellerId, list] of bySeller) {
      const method: PaymentMethod = pick(['zelle', 'transferencia', 'cheque']);
      const po: CommissionPayout = {
        id: id('pgc'),
        sellerId,
        amount: round2(list.reduce((a, c) => a + c.amount, 0)),
        commissionIds: list.map((c) => c.id),
        method,
        reference: method === 'cheque' ? `CHK ${2000 + Math.floor(rng() * 7000)}` : `${method === 'zelle' ? 'ZL' : 'TR'}-${Math.floor(rng() * 899999 + 100000)}`,
        at: when,
        recordedBy: admin.id,
      };
      payouts.push(po);
      for (const c of list) {
        c.status = 'pagada';
        c.paidAt = when;
        c.payoutId = po.id;
      }
      const seller = users.find((u) => u.id === sellerId);
      log(when, admin, 'comision.pagar', 'payout', po.id, `Comisiones pagadas a ${seller?.name ?? sellerId}: ${po.amount.toFixed(2)} USD`);
    }
  };

  // ---------- La historia, día por día ----------
  interface StoreState {
    nextVisit: number;
    lastVisit: number;
    lastSettlement: number;
    offset: number;
  }
  const state = new Map<string, StoreState>();
  const payPlan: { day: number; settlement: Settlement; amount: number; method: PaymentMethod }[] = [];
  const payoutDays = [-61, -31];
  const parFor = (ps: ProductSeed, s: StoreSeed) => {
    const weekly = ps.rate * s.size;
    return Math.max(ps.packSize, Math.ceil((weekly * 3) / ps.packSize) * ps.packSize);
  };

  const activeDayStart = Math.min(...def.stores.filter((s) => s.activationDay !== null).map((s) => s.activationDay!));
  for (let day = Math.min(activeDayStart, firstDay); day <= -1; day++) {
    // Las llegadas se reciben en su día, antes que todo lo demás (08:10).
    const restockIndex = def.restockDays.indexOf(day);
    if (restockIndex >= 0) restockAt(restockIndex, day);
    // Activaciones: contrato firmado, local aprobado y primera entrega.
    for (const s of def.stores) {
      if (s.activationDay !== day) continue;
      const store = storeByKey.get(s.key)!;
      const seller = sellerOf(s);
      makeContract(store, day - 3, true);
      setStatus(store, 'contrato_enviado', at(day - 3, 10), seller);
      setStatus(store, 'firmado', at(day - 3, 10, 40), seller);
      setStatus(store, 'activo', at(day - 1, 16), admin);
      createStoreUser(store, at(day - 1, 16));
      log(at(day - 1, 16), admin, 'local.activo', 'store', store.id, `${store.name}: Activo`);
      const items = s.assortment.map((k) => {
        const ps = def.products.find((x) => x.key === k)!;
        return { productId: prod(k).id, qty: parFor(ps, s) };
      });
      const forced = oldLotFor.get(s.key);
      if (forced) {
        deliver(store, [{ productId: forced.productId, qty: 12 }], day - 1, 5, 'vendedor', { forceLot: forced });
      }
      deliver(store, items.filter((i) => !forced || i.productId !== forced.productId), day - 1, 10, 'vendedor');
      state.set(store.id, { nextVisit: day + 5 + Math.floor(rng() * 4), lastVisit: day, lastSettlement: day, offset: Math.floor(rng() * 40) });
    }

    // Visitas con conteo, reposición y algún reporte del propio local.
    for (const s of def.stores) {
      const store = storeByKey.get(s.key)!;
      const st = state.get(store.id);
      if (!st || store.status !== 'activo') continue;
      if (s.pausedDay !== undefined && day >= s.pausedDay) {
        if (day === s.pausedDay) {
          setStatus(store, 'pausado', at(day, 12), admin);
          log(at(day, 12), admin, 'local.pausado', 'store', store.id, `${store.name}: Pausado (cierre por remodelación)`);
        }
        continue;
      }
      // Reporte del local entre visitas (a veces).
      if (day === st.lastVisit + 3 && rng() < 0.35) {
        const su = storeUsers.get(store.id)!;
        const sold = s.assortment
          .map((k) => {
            const p = prod(k);
            const have = balances.qty(storeLoc(store.id), p.id);
            const ps = seedByProduct.get(p.id)!;
            return { productId: p.id, qty: Math.min(have, Math.round(((ps.rate * s.size * 3) / 7) * (0.4 + rng() * 0.5))) };
          })
          .filter((x) => x.qty > 0);
        if (sold.length) reportSale(store, sold, at(day, 19, st.offset % 60), 'local', su);
      }
      if (day !== st.nextVisit) continue;
      const seller = sellerOf(s);
      const days = day - st.lastVisit;
      const when = at(day, 13 + Math.floor(st.offset / 15), (st.offset * 7) % 60);
      const counts: Visit['counts'] = [];
      const sold: { productId: string; qty: number }[] = [];
      for (const k of s.assortment) {
        const p = prod(k);
        const ps = seedByProduct.get(p.id)!;
        const expected = balances.qty(storeLoc(store.id), p.id);
        const mean = ((ps.rate * s.size * days) / 7) * (0.6 + rng() * 0.8);
        const q = Math.min(expected, Math.max(0, Math.round(mean)));
        counts.push({ productId: p.id, expected, counted: expected - q });
        if (q > 0) sold.push({ productId: p.id, qty: q });
      }
      const report = sold.length ? reportSale(store, sold, when, 'conteo', seller) : null;
      const geoOk = rng() < 0.8;
      visits.push({
        id: id('vis'),
        storeId: store.id,
        sellerId: seller.id,
        at: when,
        geo: geoOk ? { lat: store.lat + (rng() - 0.5) * 0.0006, lng: store.lng + (rng() - 0.5) * 0.0006, accuracy: 8 + Math.round(rng() * 25) } : undefined,
        notes: pick(['', '', 'Todo en orden.', 'Pidió más exhibición en el mostrador.', 'El encargado pregunta por la próxima llegada.', 'Buen movimiento el fin de semana.']),
        counts,
        salesReportId: report?.id,
        photoIds: [],
      });
      // Reposición: lo que quedó por debajo del 40 % de su nivel.
      const need = s.assortment
        .map((k) => {
          const p = prod(k);
          const ps = seedByProduct.get(p.id)!;
          const have = balances.qty(storeLoc(store.id), p.id);
          const par = parFor(ps, s);
          if (have >= par * 0.4) return null;
          return { productId: p.id, qty: Math.ceil((par - have) / ps.packSize) * ps.packSize };
        })
        .filter((x): x is { productId: string; qty: number } => Boolean(x));
      if (need.length && day < -3) {
        if (rng() < 0.45) {
          // El local lo pidió desde su cuenta, el vendedor confirmó y el almacén preparó.
          const su = storeUsers.get(store.id)!;
          const r: Reorder = {
            id: id('ped'),
            code: `P-${String(reorders.length + 1).padStart(4, '0')}`,
            storeId: store.id,
            sellerId: seller.id,
            status: 'entregado',
            items: need,
            note: pick(['', 'Se acabó rápido esta semana.', 'Para el fin de semana largo.', 'Los clientes lo están pidiendo.']),
            createdAt: at(day, 18, 10),
            createdBy: su.id,
            confirmedAt: at(day, 18, 50),
            history: [
              { status: 'enviado', at: at(day, 18, 10), by: su.id },
              { status: 'confirmado', at: at(day, 18, 50), by: seller.id },
            ],
          };
          const d = deliver(store, need, day + 1, st.offset, 'pedido_local', { reorder: r });
          if (d) {
            r.deliveryId = d.id;
            r.history.push({ status: 'preparado', at: d.preparedAt!, by: admin.id }, { status: 'entregado', at: d.deliveredAt!, by: seller.id });
            reorders.push(r);
          }
        } else {
          deliver(store, need, day + 1, st.offset, 'vendedor');
        }
      }
      st.lastVisit = day;
      st.nextVisit = day + 6 + Math.floor(rng() * 4);
    }

    // Liquidaciones cada N días y pagos.
    for (const s of def.stores) {
      const store = storeByKey.get(s.key)!;
      const st = state.get(store.id);
      if (!st) continue;
      if (day - st.lastSettlement < settings.settlementEveryDays) continue;
      const settlement = settle(store, day);
      st.lastSettlement = day;
      if (!settlement) continue;
      if (s.overdue && day >= -45) continue; // este local deja de pagar
      const r = rng();
      const method: PaymentMethod = r < 0.35 ? 'zelle' : r < 0.6 ? 'efectivo' : r < 0.85 ? 'cheque' : 'transferencia';
      const lag = 2 + Math.floor(rng() * 7);
      if (rng() < 0.2) {
        const half = round2(settlement.amount / 2);
        payPlan.push({ day: day + 3, settlement, amount: half, method });
        payPlan.push({ day: day + lag + 4, settlement, amount: round2(settlement.amount - half), method });
      } else {
        payPlan.push({ day: day + lag, settlement, amount: settlement.amount, method });
      }
    }
    for (const p of payPlan.filter((x) => x.day === day)) pay(p.settlement, p.amount, day, p.method);
    if (payoutDays.includes(day)) payoutAll(day);
  }

  // ---------- Estado de hoy: casos para enseñar ----------
  for (const s of def.stores) {
    const store = storeByKey.get(s.key)!;
    const seller = sellerOf(s);
    if (s.activationDay !== null) continue;
    if (s.final === 'contrato_enviado') {
      makeContract(store, -1, false);
      setStatus(store, 'contrato_enviado', at(-1, 10), seller);
    } else if (s.final === 'firmado') {
      makeContract(store, -2, true);
      setStatus(store, 'contrato_enviado', at(-2, 10), seller);
      setStatus(store, 'firmado', at(-2, 10, 40), seller);
      notifyUser(admin.id, 'contrato_firmado', `Contrato firmado: ${store.name}`, 'Quedó «Firmado · por aprobar». Revísalo y aprueba el local.', `/locales/${store.id}`, at(-2, 10, 41));
    } else {
      notifyUser(admin.id, 'local_por_aprobar', `Tienda nueva: ${store.name}`, `${seller.name} la registró como prospecto en ${store.city}.`, `/locales/${store.id}`, store.createdAt, true);
    }
  }

  // Pedidos pendientes de hoy.
  for (const [i, pr] of def.pendingReorders.entries()) {
    const store = storeByKey.get(pr.store)!;
    const seller = users.find((u) => u.id === store.sellerId)!;
    const su = storeUsers.get(store.id);
    if (!su) throw new Error(`Semilla: el local ${store.name} no tiene cuenta para pedir.`);
    const items = pr.items.map((it) => {
      const p = prod(it.product);
      return { productId: p.id, qty: it.packs * p.packSize };
    });
    const created = ago(pr.status === 'enviado' ? 2 + i : 20 + i);
    const r: Reorder = {
      id: id('ped'),
      code: `P-${String(reorders.length + 1).padStart(4, '0')}`,
      storeId: store.id,
      sellerId: seller.id,
      status: pr.status,
      items,
      note: pr.note,
      createdAt: created,
      createdBy: su.id,
      history: [{ status: 'enviado', at: created, by: su.id }],
    };
    reorders.push(r);
    const units = items.reduce((a, x) => a + x.qty, 0);
    notifyUser(seller.id, 'pedido_nuevo', `Pedido nuevo de ${store.name}`, `${r.code} · ${units} unidades. Confírmalo para que el almacén lo prepare.`, '/pedidos', created, pr.status !== 'enviado');
    if (pr.status === 'confirmado') {
      const confirmed = ago(18 + i);
      r.confirmedAt = confirmed;
      r.history.push({ status: 'confirmado', at: confirmed, by: seller.id });
      const d: Delivery = {
        id: id('ent'),
        code: deliveryCode(),
        storeId: store.id,
        sellerId: seller.id,
        status: 'solicitada',
        items,
        note: `Pedido del local ${r.code}${pr.note ? `: ${pr.note}` : ''}`,
        origin: 'pedido_local',
        reorderId: r.id,
        requestedAt: confirmed,
        requestedBy: seller.id,
      };
      deliveries.push(d);
      r.deliveryId = d.id;
      notifyUser(admin.id, 'entrega_solicitada', `Entrega por preparar: ${store.name}`, `${d.code} · ${units} unidades (pedido del local).`, '/entregas', confirmed);
      notifyUser(su.id, 'pedido_confirmado', `Tu pedido ${r.code} fue confirmado`, 'El almacén lo está preparando.', '/pedidos', confirmed);
    }
    log(created, su, 'pedido.crear', 'reorder', r.id, `${store.name} pidió ${units} unidades (${r.code})`);
  }

  // Llegadas pendientes (en tránsito / en producción / tostado programado).
  for (const pa of def.pendingArrivals) {
    const year = today0.plus({ days: pa.inDays }).year;
    const roast = def.config.inbound === 'roast';
    const code = roast ? `TOST-${year}-${String(arrivals.length + 1).padStart(3, '0')}` : `IMP-${year}-${String(arrivals.length + 1).padStart(3, '0')}`;
    const history: Arrival['statusHistory'] = roast
      ? [{ status: 'programado', at: at(-2, 9) }]
      : pa.status === 'transito'
        ? [
            { status: 'produccion', at: at(-40, 9) },
            { status: 'transito', at: at(-6, 9) },
          ]
        : [{ status: 'produccion', at: at(-5, 9) }];
    arrivals.push({
      id: id('arr'),
      kind: roast ? 'roast' : 'import',
      code,
      status: pa.status,
      eta: dateOf(pa.inDays),
      supplier: pa.supplier,
      originCountry: pa.originCountry,
      productionLine: pa.productionLine,
      bestBefore: roast ? dateOf(pa.inDays + 180) : undefined,
      items: pa.items.map((i) => ({ productId: prod(i.product).id, qty: i.qty, unitCost: prod(i.product).cost })),
      notes: roast ? 'Tanda programada en la tostadora.' : pa.status === 'transito' ? 'Contenedor en camino al puerto de Miami.' : 'En producción en la fábrica.',
      createdAt: history[0]!.at,
      statusHistory: history,
    });
  }

  // Avisos de hoy para administración.
  const low = prod(def.lowStockProduct);
  const lowQty = balances.qty(WAREHOUSE, low.id);
  notifyUser(admin.id, 'stock_bajo', `Stock bajo: ${low.name}`, `Quedan ${lowQty} en el almacén.`, `/catalogo/${low.id}`, ago(5));
  for (const s of def.stores.filter((x) => x.overdue)) {
    const store = storeByKey.get(s.key)!;
    notifyUser(admin.id, 'pago_vencido', `Pago vencido: ${store.name}`, 'Tiene liquidaciones vencidas sin pagar.', `/cobros`, ago(7));
    notifyUser(store.sellerId, 'pago_vencido', `Pago vencido: ${store.name}`, 'Pásale a cobrar en tu próxima visita.', `/locales/${store.id}`, ago(7));
  }
  for (const s of def.stores.filter((x) => x.expiringLotOf)) {
    const store = storeByKey.get(s.key)!;
    notifyUser(store.sellerId, 'cafe_por_vencer', `Café por vencer en ${store.name}`, 'Hay un lote que vence en menos de 10 días. Cámbialo en la próxima visita.', `/locales/${store.id}`, ago(9));
  }
  const firstStore = storeByKey.get(def.primary.store)!;
  const primaryStoreUser = storeUsers.get(firstStore.id);
  const lastSettlement = settlements.filter((x) => x.storeId === firstStore.id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
  if (primaryStoreUser && lastSettlement) {
    notifyUser(primaryStoreUser.id, 'liquidacion_nueva', `Liquidación ${lastSettlement.code}`, `Por lo vendido: ${lastSettlement.amount.toFixed(2)} USD.`, '/cuentas', lastSettlement.issuedAt, lastSettlement.status === 'pagada');
  }

  // ---------- Mensajes y comunicados ----------
  const resolveUser = (key: string): User => {
    const u = userByKey.get(key);
    if (u) return u;
    const store = storeByKey.get(key);
    if (store) {
      const su = storeUsers.get(store.id);
      if (su) return su;
    }
    throw new Error(`Semilla: usuario desconocido ${key}`);
  };
  for (const t of def.messages) {
    const a = resolveUser(t.between[0]);
    const b = resolveUser(t.between[1]);
    const admins = users.filter((u) => u.role === 'admin');
    const participants = t.kind === 'admin_vendedor' ? [a.role === 'seller' ? a.id : b.id, ...admins.map((x) => x.id)] : [a.id, b.id];
    const store = t.store ? storeByKey.get(t.store) : undefined;
    const sellerId = a.role === 'seller' ? a.id : b.role === 'seller' ? b.id : undefined;
    const msgs = t.lines.map((l) => ({
      id: id('msg'),
      threadId: '',
      authorId: (l.from === 0 ? a : b).id,
      at: ago(l.hoursAgo),
      text: l.text,
      productId: l.product ? prod(l.product).id : undefined,
    }));
    const thread: Thread = {
      id: id('hil'),
      kind: t.kind,
      title: t.kind === 'admin_vendedor' ? `Administración · ${(a.role === 'seller' ? a : b).name}` : (store?.name ?? 'Conversación'),
      participantIds: [...new Set(participants)],
      storeId: store?.id,
      sellerId,
      createdAt: msgs[0]?.at ?? nowIso,
      lastMessageAt: msgs[msgs.length - 1]?.at ?? nowIso,
      readBy: {},
    };
    for (const m of msgs) m.threadId = thread.id;
    // Cada quien leyó hasta su último mensaje.
    for (const p of thread.participantIds) {
      const mine = msgs.filter((m) => m.authorId === p).map((m) => m.at).sort();
      if (mine.length) thread.readBy[p] = mine[mine.length - 1]!;
    }
    threads.push(thread);
    messages.push(...msgs);
  }
  for (const an of def.announcements) {
    announcements.push({ id: id('cmn'), title: an.title, body: an.body, audience: an.audience, at: at(-an.daysAgo, 9, 30), authorId: admin.id });
  }

  log(nowIso, null, 'semilla.cargar', 'line', def.line, 'Datos de ejemplo cargados');

  // ---------- Comprobaciones de la semilla ----------
  for (const e of balances.entries()) {
    if ((e.loc === 'warehouse' || e.loc.startsWith('store:')) && e.qty < 0) {
      throw new Error(`Semilla: saldo negativo en ${e.loc} (${e.productId}).`);
    }
  }

  return {
    products,
    photos: [],
    warehouses: [warehouse],
    lots,
    arrivals,
    movements,
    stores,
    contracts,
    deliveries,
    visits,
    salesReports,
    returns,
    reorders,
    unmetDemand,
    settlements,
    payments,
    commissions,
    payouts,
    threads,
    messages,
    announcements,
    notifications,
    users,
    zones,
    settings: [settings],
    audit: audit.sort((a, b) => a.at.localeCompare(b.at)),
  };
}
