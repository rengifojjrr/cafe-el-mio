// Locales (tiendas): el vendedor los inscribe; administración los aprueba.
import { z } from 'zod';
import type { Contract, Photo, Store, StoreStatus, User } from '../data/types';
import { permitState, type PermitState } from '../domain/compliance';
import { DEFAULT_PERMIT_ISSUER, normalizeEin } from '../domain/fiscal';
import { pointInMarket } from '../domain/markets';
import { WAREHOUSE, storeLoc } from '../domain/ledger';
import { settlementBalance, storeEarning } from '../domain/money-rules';
import { can } from '../domain/permissions';
import { round2 } from '../lib/money';
import { addDays, addDaysToDate, daysBetween, toIsoDate } from '../lib/time';
import { type Ctx, ForbiddenError, NotFoundError, ValidationError, audit, guard, mutate, notify, nowIso } from './context';
import { loadInventory } from './inventory';
import { loadMarketIndex } from './markets';

export const STORE_STATUS_LABEL: Record<StoreStatus, string> = {
  prospecto: 'Prospecto',
  contrato_enviado: 'Contrato por firmar',
  firmado: 'Firmado · por aprobar',
  activo: 'Activo',
  pausado: 'Pausado',
  cerrado: 'Cerrado',
};

export interface StoreView {
  store: Store;
  sellerName: string;
  zoneName: string;
  permit: PermitState | null;
  consignmentUnits: number;
  /** Valor de lo que tiene en consignación, a precio al local. */
  consignmentValue: number;
  /** Lo liquidado que falta pagar. */
  balanceDue: number;
  /** Lo vendido que todavía no entró en una liquidación (igual se debe). */
  unsettled: number;
  /** Todo lo que debe el local: liquidado sin pagar + vendido sin liquidar. */
  owedTotal: number;
  overdue: boolean;
  lastVisitAt?: string;
  sales30: number;
  pendingOrders: number;
  contractStatus?: Contract['status'];
}

/** Locales que este actor puede ver. Vendedor: los suyos. Local: el propio. */
export async function scopedStores(ctx: Ctx): Promise<Store[]> {
  if (ctx.actor.role === 'admin') {
    guard(ctx, 'store.list');
    return ctx.repo.stores.all();
  }
  if (ctx.actor.role === 'seller') {
    guard(ctx, 'store.list');
    return ctx.repo.stores.where('sellerId', ctx.actor.userId);
  }
  if (ctx.actor.role === 'store' && ctx.actor.storeId) {
    const s = await ctx.repo.stores.get(ctx.actor.storeId);
    if (!s) return [];
    guard(ctx, 'store.read', { type: 'store', store: s });
    return [s];
  }
  throw new ForbiddenError();
}

export async function loadStoreForActor(ctx: Ctx, storeId: string): Promise<Store> {
  const s = await ctx.repo.stores.get(storeId);
  if (!s) throw new NotFoundError('el local');
  guard(ctx, 'store.read', { type: 'store', store: s });
  return s;
}

export async function listStores(ctx: Ctx): Promise<StoreView[]> {
  const stores = await scopedStores(ctx);
  const ids = new Set(stores.map((s) => s.id));
  const [snap, users, zones, visits, reports, settlements, reorders, contracts] = await Promise.all([
    loadInventory(ctx),
    ctx.repo.users.all(),
    ctx.repo.zones.all(),
    ctx.repo.visits.all(),
    ctx.repo.salesReports.all(),
    ctx.repo.settlements.all(),
    ctx.repo.reorders.all(),
    ctx.repo.contracts.all(),
  ]);
  const now = ctx.now();
  const usersById = new Map(users.map((u) => [u.id, u]));
  const zonesById = new Map(zones.map((z) => [z.id, z]));
  const since = addDays(now, -30);
  return stores
    .map((store) => {
      const held = snap.balances.byProduct(storeLoc(store.id));
      let units = 0;
      let value = 0;
      for (const [pid, q] of held) {
        if (q <= 0) continue;
        units += q;
        value += q * (snap.productsById.get(pid)?.priceToStore ?? 0);
      }
      const mySettlements = settlements.filter((s) => s.storeId === store.id);
      const balanceDue = round2(mySettlements.reduce((a, s) => a + settlementBalance(s), 0));
      const overdue = mySettlements.some((s) => settlementBalance(s) > 0 && daysBetween(s.dueOn, now) > 0);
      const unsettled = round2(reports.filter((r) => r.storeId === store.id && !r.settlementId).reduce((a, r) => a + r.total, 0));
      const lastVisit = visits.filter((v) => v.storeId === store.id).sort((a, b) => b.at.localeCompare(a.at))[0];
      const sales30 = round2(
        reports.filter((r) => r.storeId === store.id && r.at >= since).reduce((a, r) => a + r.total, 0),
      );
      const pendingOrders = reorders.filter((r) => r.storeId === store.id && (r.status === 'enviado' || r.status === 'confirmado' || r.status === 'preparado')).length;
      const contract = contracts.filter((c) => c.storeId === store.id && c.status !== 'anulado').sort((a, b) => b.version - a.version)[0];
      return {
        store,
        sellerName: usersById.get(store.sellerId)?.name ?? '—',
        zoneName: zonesById.get(store.zoneId)?.name ?? store.city,
        permit: ctx.config.requiresTobaccoPermit ? permitState(store, now) : null,
        consignmentUnits: units,
        consignmentValue: round2(value),
        balanceDue,
        unsettled,
        owedTotal: round2(balanceDue + unsettled),
        overdue,
        lastVisitAt: lastVisit?.at,
        sales30,
        pendingOrders,
        contractStatus: contract?.status,
      } satisfies StoreView;
    })
    .filter((v) => ids.has(v.store.id))
    .sort((a, b) => a.store.name.localeCompare(b.store.name, 'es'));
}

export interface ConsignmentLine {
  productId: string;
  name: string;
  sku: string;
  qty: number;
  priceToStore: number;
  suggestedRetail: number;
  storeEarning: number;
  value: number;
  /** Café: lote más próximo a vencer en el local. */
  nextExpiry?: string;
  expiringQty: number;
}

export async function storeConsignment(ctx: Ctx, storeId: string): Promise<ConsignmentLine[]> {
  await loadStoreForActor(ctx, storeId);
  const snap = await loadInventory(ctx);
  const now = ctx.now();
  const out: ConsignmentLine[] = [];
  for (const [pid, qty] of snap.balances.byProduct(storeLoc(storeId))) {
    if (qty <= 0) continue;
    const p = snap.productsById.get(pid);
    if (!p) continue;
    let nextExpiry: string | undefined;
    let expiringQty = 0;
    for (const l of snap.balances.lots(storeLoc(storeId), pid)) {
      const lot = snap.lotsById.get(l.lotId);
      if (!lot?.bestBefore) continue;
      if (!nextExpiry || lot.bestBefore < nextExpiry) nextExpiry = lot.bestBefore;
      if (daysBetween(now, lot.bestBefore) <= 21) expiringQty += l.qty;
    }
    out.push({
      productId: pid,
      name: p.name,
      sku: p.sku,
      qty,
      priceToStore: p.priceToStore,
      suggestedRetail: p.suggestedRetail,
      storeEarning: storeEarning(p),
      value: round2(qty * p.priceToStore),
      nextExpiry,
      expiringQty,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

const storeSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre de la tienda.').max(80),
  type: z.string().trim().min(2, 'Elige el tipo de tienda.'),
  address: z.string().trim().min(5, 'Escribe la dirección.'),
  city: z.string().trim().min(2, 'Escribe la ciudad.'),
  zoneId: z.string().min(1, 'Elige la zona.'),
  // El punto se revisa contra el área de su mercado (validateLocation).
  lat: z.number({ error: 'Ubica la tienda en el mapa.' }),
  lng: z.number({ error: 'Ubica la tienda en el mapa.' }),
  /** Mercado (Miami, Houston…). Si falta, el de la zona. */
  marketId: z.string().optional(),
  managerName: z.string().trim().min(3, 'Escribe el nombre del encargado.'),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9 ()+.-]{7,20}$/, 'Escribe un teléfono válido.'),
  email: z.union([z.literal(''), z.string().trim().email('Escribe un correo válido.')]),
  hours: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(500).default(''),
  sellerId: z.string().optional(),
  tobaccoPermit: z
    .object({
      number: z.string().trim(),
      expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha de vencimiento del permiso.'),
      /** Quién lo emite (Florida DBPR, Texas Comptroller…). */
      issuer: z.string().trim().max(60).optional(),
    })
    .optional(),
  /** Tax ID (EIN): vacío lo borra; sin enviar, se conserva. */
  taxId: z.string().trim().max(12).optional(),
  /** Certificado de reventa: null lo borra; sin enviar, se conserva. */
  resaleCert: z
    .object({
      number: z.string().trim().min(4, 'Escribe el número del certificado de reventa.').max(40),
      expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha de vencimiento del certificado.'),
    })
    .nullable()
    .optional(),
});
export type StoreInput = z.input<typeof storeSchema>;

function validatePermit(ctx: Ctx, data: z.output<typeof storeSchema>): void {
  if (!ctx.config.requiresTobaccoPermit) return;
  if (!data.tobaccoPermit || data.tobaccoPermit.number.length < 4) {
    throw new ValidationError('En tabaco hay que registrar el número del permiso de venta de tabaco del local.');
  }
}

/** Tax ID normalizado («12-3456789»), vacío para borrarlo o undefined para conservarlo. */
function parseTaxId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim() === '') return '';
  const ein = normalizeEin(raw);
  if (!ein) throw new ValidationError('El Tax ID (EIN) tiene 9 dígitos: NN-NNNNNNN.');
  return ein;
}

/** El mercado del local (el elegido, o el de su zona) y que el punto quede en su área. */
async function resolveLocation(ctx: Ctx, data: z.output<typeof storeSchema>): Promise<string> {
  const idx = await loadMarketIndex(ctx);
  const zone = idx.zonesById.get(data.zoneId);
  if (!zone) throw new ValidationError('Elige la zona.');
  const zoneMarket = idx.zoneMarket(zone);
  const marketId = data.marketId && idx.markets.some((m) => m.id === data.marketId) ? data.marketId : zoneMarket;
  if (marketId !== zoneMarket) throw new ValidationError('La zona elegida es de otro mercado.');
  const market = idx.markets.find((m) => m.id === marketId)!;
  if (!pointInMarket(market, data.lat, data.lng)) {
    throw new ValidationError(market.id === 'miami' ? 'El punto queda fuera del sur de Florida.' : `El punto queda lejos de ${market.name}.`);
  }
  return marketId;
}

function permitFrom(ctx: Ctx, data: z.output<typeof storeSchema>, prev?: Store): Store['tobaccoPermit'] {
  if (!ctx.config.requiresTobaccoPermit || !data.tobaccoPermit) return undefined;
  const issuer = data.tobaccoPermit.issuer || prev?.tobaccoPermit?.issuer || DEFAULT_PERMIT_ISSUER;
  return { number: data.tobaccoPermit.number, expiresOn: data.tobaccoPermit.expiresOn, issuer };
}

/** Aplica Tax ID y certificado de reventa: lo que no se envió se conserva. */
function withFiscal(store: Store, data: z.output<typeof storeSchema>): Store {
  const next = { ...store };
  const taxId = parseTaxId(data.taxId);
  if (taxId !== undefined) {
    if (taxId) next.taxId = taxId;
    else delete next.taxId;
  }
  if (data.resaleCert !== undefined) {
    if (data.resaleCert) next.resaleCert = { number: data.resaleCert.number, expiresOn: data.resaleCert.expiresOn };
    else delete next.resaleCert;
  }
  return next;
}

export async function registerStore(ctx: Ctx, input: StoreInput): Promise<Store> {
  guard(ctx, 'store.create');
  const data = storeSchema.parse(input);
  validatePermit(ctx, data);
  parseTaxId(data.taxId);
  const sellerId = ctx.actor.role === 'seller' ? ctx.actor.userId : data.sellerId;
  if (!sellerId) throw new ValidationError('Elige el vendedor responsable de la tienda.');
  return mutate(ctx, async () => {
    const seller = await ctx.repo.users.get(sellerId);
    if (!seller || seller.role !== 'seller') throw new ValidationError('El vendedor no existe en esta línea.');
    const marketId = await resolveLocation(ctx, data);
    const at = nowIso(ctx);
    const base: Store = {
      id: ctx.newId('loc'),
      name: data.name,
      type: data.type,
      address: data.address,
      city: data.city,
      zoneId: data.zoneId,
      lat: data.lat,
      lng: data.lng,
      managerName: data.managerName,
      phone: data.phone,
      email: data.email,
      hours: data.hours,
      sellerId,
      status: 'prospecto',
      tobaccoPermit: permitFrom(ctx, data),
      marketId,
      notes: data.notes,
      createdAt: at,
      createdBy: ctx.actor.userId,
      statusHistory: [{ status: 'prospecto', at, by: ctx.actor.userId }],
    };
    const store = withFiscal(base, data);
    await ctx.repo.stores.put(store);
    await audit(ctx, 'local.registrar', 'store', store.id, `Tienda registrada: ${store.name} (${store.city})`);
    await notify(ctx, 'admins', 'local_por_aprobar', `Tienda nueva: ${store.name}`, `${seller.name} la registró como prospecto en ${store.city}.`, `/${ctx.line}/locales/${store.id}`);
    return store;
  });
}

export async function updateStore(ctx: Ctx, storeId: string, input: StoreInput): Promise<Store> {
  const data = storeSchema.parse(input);
  validatePermit(ctx, data);
  parseTaxId(data.taxId);
  return mutate(ctx, async () => {
    const s = await ctx.repo.stores.get(storeId);
    if (!s) throw new NotFoundError('el local');
    guard(ctx, 'store.update', { type: 'store', store: s });
    const marketId = await resolveLocation(ctx, data);
    const next: Store = withFiscal({
      ...s,
      name: data.name,
      type: data.type,
      address: data.address,
      city: data.city,
      zoneId: data.zoneId,
      lat: data.lat,
      lng: data.lng,
      managerName: data.managerName,
      phone: data.phone,
      email: data.email,
      hours: data.hours,
      notes: data.notes,
      tobaccoPermit: permitFrom(ctx, data, s),
      marketId,
      sellerId: ctx.actor.role === 'admin' && data.sellerId ? data.sellerId : s.sellerId,
    }, data);
    await ctx.repo.stores.put(next);
    await audit(ctx, 'local.editar', 'store', s.id, `Datos de ${next.name} actualizados`);
    return next;
  });
}

const TRANSITIONS: Record<StoreStatus, StoreStatus[]> = {
  prospecto: ['cerrado'],
  contrato_enviado: ['cerrado'],
  firmado: ['activo', 'cerrado'],
  activo: ['pausado', 'cerrado'],
  pausado: ['activo', 'cerrado'],
  cerrado: ['prospecto'],
};

export function allowedTransitions(status: StoreStatus): StoreStatus[] {
  return TRANSITIONS[status];
}

/** Administración aprueba (activa), pausa, cierra o reabre un local. */
export async function setStoreStatus(ctx: Ctx, storeId: string, status: StoreStatus, note = ''): Promise<void> {
  guard(ctx, 'store.approve');
  await mutate(ctx, async () => {
    const s = await ctx.repo.stores.get(storeId);
    if (!s) throw new NotFoundError('el local');
    if (!TRANSITIONS[s.status].includes(status)) {
      throw new ValidationError(`Un local «${STORE_STATUS_LABEL[s.status]}» no puede pasar a «${STORE_STATUS_LABEL[status]}».`);
    }
    if (status === 'cerrado') {
      const snap = await loadInventory(ctx);
      const units = [...snap.balances.byProduct(storeLoc(s.id)).values()].reduce((a, b) => a + Math.max(0, b), 0);
      if (units > 0) throw new ValidationError(`${s.name} todavía tiene ${units} unidades en consignación. Regístralas como devolución antes de cerrarlo.`);
    }
    await applyStoreStatus(ctx, s, status, note);
  });
}

/** Cambia el estado y, al activar, crea la cuenta del local si no la tiene. Uso interno. */
export async function applyStoreStatus(ctx: Ctx, s: Store, status: StoreStatus, note = ''): Promise<void> {
  const at = nowIso(ctx);
  s.status = status;
  s.statusHistory.push({ status, at, by: ctx.actor.userId });
  if (status === 'activo' && !s.approvedAt) s.approvedAt = at;
  await ctx.repo.stores.put(s);
  if (status === 'activo') {
    const existing = await ctx.repo.users.where('storeId', s.id);
    if (existing.length === 0) {
      const user: User = {
        id: ctx.newId('usr'),
        role: 'store',
        name: s.managerName,
        email: s.email,
        phone: s.phone,
        zoneId: s.zoneId,
        storeId: s.id,
        active: true,
        createdAt: at,
      };
      await ctx.repo.users.put(user);
    }
    await notify(ctx, [s.sellerId], 'local_por_aprobar', `${s.name} quedó activo`, 'Ya puedes colocarle producto en consignación.', `/${ctx.line}/locales/${s.id}`);
  }
  await audit(ctx, `local.${status}`, 'store', s.id, `${s.name}: ${STORE_STATUS_LABEL[status]}${note ? ` (${note})` : ''}`);
}

export async function setFacadePhoto(ctx: Ctx, storeId: string, photo: Omit<Photo, 'id' | 'ownerType' | 'ownerId' | 'createdAt'>): Promise<void> {
  await mutate(ctx, async () => {
    const s = await ctx.repo.stores.get(storeId);
    if (!s) throw new NotFoundError('el local');
    guard(ctx, 'store.update', { type: 'store', store: s });
    const id = ctx.newId('pho');
    await ctx.repo.photos.put({ ...photo, id, ownerType: 'store', ownerId: storeId, createdAt: nowIso(ctx) });
    if (s.facadePhotoId) await ctx.repo.photos.remove(s.facadePhotoId);
    s.facadePhotoId = id;
    await ctx.repo.stores.put(s);
    await audit(ctx, 'local.foto', 'store', s.id, `Foto de fachada de ${s.name}`);
  });
}

export async function getStorePhoto(ctx: Ctx, storeId: string): Promise<Photo | undefined> {
  const s = await loadStoreForActor(ctx, storeId);
  return s.facadePhotoId ? ctx.repo.photos.get(s.facadePhotoId) : undefined;
}

/** Vendedores de la línea (para elegir responsable). Solo nombre y zona. */
export async function listSellers(ctx: Ctx): Promise<Pick<User, 'id' | 'name' | 'zoneId'>[]> {
  if (!can(ctx.actor, 'user.read', ctx.line) && ctx.actor.role !== 'seller') throw new ForbiddenError();
  const sellers = await ctx.repo.users.where('role', 'seller');
  const visible = ctx.actor.role === 'seller' ? sellers.filter((s) => s.id === ctx.actor.userId) : sellers;
  return visible.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, zoneId: s.zoneId }));
}

export async function listZones(ctx: Ctx) {
  guard(ctx, 'product.read');
  return ctx.repo.zones.all();
}

/** El almacén aparece en el mapa de todos los que ven mapa. */
export async function warehouseStockUnits(ctx: Ctx): Promise<number> {
  const snap = await loadInventory(ctx);
  return [...snap.balances.byProduct(WAREHOUSE).values()].reduce((a, b) => a + b, 0);
}

export interface StoreDebt {
  /** Liquidado y sin pagar. */
  settled: number;
  /** Vendido y todavía sin liquidar: se debe igual, pero aún no vence. */
  unsettled: number;
  total: number;
  overdue: number;
  /** Próximo vencimiento de lo liquidado. */
  nextDueOn?: string;
  /** Cuándo se liquida lo vendido que falta. */
  nextSettlementOn?: string;
}

/** Lo que debe un local, completo: lo liquidado sin pagar más lo vendido sin liquidar. */
export async function storeDebt(ctx: Ctx, storeId: string): Promise<StoreDebt> {
  const store = await loadStoreForActor(ctx, storeId);
  guard(ctx, 'settlement.read', { type: 'store', store });
  const [settlements, reports, settings] = await Promise.all([
    ctx.repo.settlements.where('storeId', storeId),
    ctx.repo.salesReports.where('storeId', storeId),
    ctx.repo.settings.get('settings'),
  ]);
  const now = ctx.now();
  const open = settlements.filter((s) => settlementBalance(s) > 0);
  const settled = round2(open.reduce((a, s) => a + settlementBalance(s), 0));
  const pending = reports.filter((r) => !r.settlementId);
  const unsettled = round2(pending.reduce((a, r) => a + r.total, 0));
  const overdue = round2(open.filter((s) => daysBetween(s.dueOn, now) > 0).reduce((a, s) => a + settlementBalance(s), 0));
  const last = [...settlements].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
  const base = last?.issuedAt ?? pending.map((r) => r.at).sort()[0];
  const every = settings?.settlementEveryDays ?? 15;
  return {
    settled,
    unsettled,
    total: round2(settled + unsettled),
    overdue,
    nextDueOn: open.map((s) => s.dueOn).sort()[0],
    nextSettlementOn: pending.length && base ? addDaysToDate(toIsoDate(base), every) : undefined,
  };
}
