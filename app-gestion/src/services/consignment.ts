// Consignación: entregas (solicitud → preparación → entrega firmada), visitas con conteo,
// ventas reportadas, devoluciones y mermas, y pedidos de los locales.
import { z } from 'zod';
import type {
  Commission,
  Delivery,
  Movement,
  Reorder,
  ReturnRecord,
  SaleLine,
  SalesReport,
  Signature,
  Store,
  UnmetDemand,
  Visit,
} from '../data/types';
import { assertCanSupply, supplyCheck } from '../domain/compliance';
import { WAREHOUSE, allocate, storeLoc } from '../domain/ledger';
import { commissionAmount, effectiveRule } from '../domain/money-rules';
import { splitIntoPacks } from '../domain/pricing';
import type { NewPhoto } from '../lib/image';
import { round2 } from '../lib/money';
import { type Ctx, NotFoundError, ValidationError, audit, getSettings, guard, mutate, notify, nowIso } from './context';
import { type InventorySnapshot, loadInventory } from './inventory';
import { writeFirmInvoice } from './invoices';
import { STORE_STATUS_LABEL, applyStoreStatus, scopedStores } from './stores';
import { findActive } from './templates';

const itemsSchema = z
  .array(
    z.object({
      productId: z.string().min(1),
      qty: z.number().int('Las cantidades son números enteros.').positive('Cada cantidad tiene que ser mayor que cero.'),
    }),
  )
  .min(1, 'Agrega al menos un producto.')
  .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, 'Hay un producto repetido.');

export const DELIVERY_STATUS_LABEL: Record<Delivery['status'], string> = {
  solicitada: 'Solicitada',
  preparada: 'Lista para entregar',
  entregada: 'Entregada',
  rechazada: 'Rechazada',
};

export const REORDER_STATUS_LABEL: Record<Reorder['status'], string> = {
  enviado: 'Enviado al vendedor',
  confirmado: 'Confirmado · en preparación',
  preparado: 'Listo para entregar',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

async function storeOrThrow(ctx: Ctx, storeId: string): Promise<Store> {
  const s = await ctx.repo.stores.get(storeId);
  if (!s) throw new NotFoundError('el local');
  return s;
}

async function nextCode(prefix: string, count: Promise<number>): Promise<string> {
  return `${prefix}-${String((await count) + 1).padStart(4, '0')}`;
}

// ---------- Entregas ----------

export interface DeliveryView extends Delivery {
  storeName: string;
  sellerName: string;
  itemsView: { productId: string; name: string; qty: number; preparedQty?: number; available?: number }[];
  /** El local compra en firme: al recibir nace la factura en vez de la consignación. */
  firm: boolean;
  /** Factura que nació al recibir (venta en firme). */
  invoiceCode?: string;
}

export async function listDeliveries(ctx: Ctx, filter?: { storeId?: string; status?: Delivery['status'] }): Promise<DeliveryView[]> {
  const stores = await scopedStores(ctx);
  const storesById = new Map(stores.map((s) => [s.id, s]));
  const [all, users, snap, invoices] = await Promise.all([ctx.repo.deliveries.all(), ctx.repo.users.all(), loadInventory(ctx), ctx.repo.invoices.all()]);
  const usersById = new Map(users.map((u) => [u.id, u]));
  const invoiceCode = new Map(invoices.map((i) => [i.id, i.code]));
  const isAdmin = ctx.actor.role === 'admin';
  return all
    .filter((d) => storesById.has(d.storeId))
    .filter((d) => !filter?.storeId || d.storeId === filter.storeId)
    .filter((d) => !filter?.status || d.status === filter.status)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .map((d) => ({
      ...d,
      storeName: storesById.get(d.storeId)?.name ?? '—',
      sellerName: usersById.get(d.sellerId)?.name ?? '—',
      firm: d.invoiceId ? true : d.status !== 'entregada' && storesById.get(d.storeId)?.saleMode === 'firme',
      invoiceCode: d.invoiceId ? invoiceCode.get(d.invoiceId) : undefined,
      itemsView: d.items.map((i) => ({
        productId: i.productId,
        name: snap.productsById.get(i.productId)?.name ?? i.productId,
        qty: i.qty,
        preparedQty: i.preparedQty,
        available: isAdmin ? Math.max(0, snap.balances.qty(WAREHOUSE, i.productId) - (snap.reserved.get(i.productId) ?? 0)) : undefined,
      })),
    }));
}

/** El vendedor (o administración) pide producto en consignación para un local. */
export async function requestDelivery(
  ctx: Ctx,
  input: { storeId: string; items: { productId: string; qty: number }[]; note?: string },
  opts?: { origin?: Delivery['origin']; reorderId?: string },
): Promise<Delivery> {
  const items = itemsSchema.parse(input.items);
  return mutate(ctx, async () => await writeDeliveryRequest(ctx, { ...input, items }, opts));
}

/**
 * Crea la entrega «solicitada». Escribe dentro de la transacción de quien la llama: nunca abre
 * otra (IndexedDB cierra una transacción anidada antes de tiempo).
 */
async function writeDeliveryRequest(
  ctx: Ctx,
  input: { storeId: string; items: { productId: string; qty: number }[]; note?: string },
  opts?: { origin?: Delivery['origin']; reorderId?: string },
): Promise<Delivery> {
  const store = await storeOrThrow(ctx, input.storeId);
  guard(ctx, 'delivery.request', { type: 'store', store });
  assertCanSupply(ctx.line, store, ctx.now());
  const products = await ctx.repo.products.all();
  for (const it of input.items) {
    const p = products.find((x) => x.id === it.productId);
    if (!p || !p.active) throw new ValidationError('Uno de los productos no está activo en el catálogo.');
  }
  const at = nowIso(ctx);
  const delivery: Delivery = {
    id: ctx.newId('ent'),
    code: await nextCode('E', ctx.repo.deliveries.count()),
    storeId: store.id,
    sellerId: store.sellerId,
    status: 'solicitada',
    items: input.items,
    note: input.note?.trim() ?? '',
    origin: opts?.origin ?? (ctx.actor.role === 'admin' ? 'administracion' : 'vendedor'),
    reorderId: opts?.reorderId,
    requestedAt: at,
    requestedBy: ctx.actor.userId,
  };
  await ctx.repo.deliveries.put(delivery);
  const units = input.items.reduce((s, i) => s + i.qty, 0);
  await audit(ctx, 'entrega.solicitar', 'delivery', delivery.id, `${delivery.code}: ${units} unidades para ${store.name}`);
  await notify(ctx, 'admins', 'entrega_solicitada', `Entrega por preparar: ${store.name}`, `${delivery.code} · ${units} unidades.`, `/${ctx.line}/entregas`);
  return delivery;
}

/**
 * Administración aprueba y prepara. Se aparta lo que hay en el almacén; lo que falta
 * queda como demanda no atendida. Si el local está firmado pero no aprobado, `approveStore`
 * lo aprueba en el mismo paso.
 */
export async function prepareDelivery(
  ctx: Ctx,
  deliveryId: string,
  opts?: { approveStore?: boolean },
): Promise<{ delivery: Delivery; prepared: number; short: number }> {
  guard(ctx, 'delivery.prepare');
  return mutate(ctx, async () => {
    const d = await ctx.repo.deliveries.get(deliveryId);
    if (!d) throw new NotFoundError('la entrega');
    if (d.status !== 'solicitada') throw new ValidationError(`La entrega ${d.code} ya está «${DELIVERY_STATUS_LABEL[d.status]}».`);
    const store = await storeOrThrow(ctx, d.storeId);
    if (store.status === 'firmado') {
      if (!opts?.approveStore) throw new ValidationError(`${store.name} firmó pero todavía no está aprobado. Apruébalo para preparar la entrega.`);
      await applyStoreStatus(ctx, store, 'activo', 'aprobado al preparar la entrega');
    } else if (store.status !== 'activo') {
      throw new ValidationError(`${store.name} está «${STORE_STATUS_LABEL[store.status]}»: no se le prepara entrega.`);
    }
    assertCanSupply(ctx.line, store, ctx.now());
    const snap = await loadInventory(ctx);
    const existingShort = await ctx.repo.unmetDemand.all();
    const refId = d.reorderId ?? d.id;
    let prepared = 0;
    let short = 0;
    const shortages: UnmetDemand[] = [];
    for (const it of d.items) {
      const available = Math.max(0, snap.balances.qty(WAREHOUSE, it.productId) - (snap.reserved.get(it.productId) ?? 0));
      const take = Math.min(it.qty, available);
      prepared += take;
      if (take < it.qty) {
        short += it.qty - take;
        const already = existingShort.some((u) => u.refId === refId && u.productId === it.productId);
        if (!already) {
          shortages.push({
            id: ctx.newId('dna'),
            productId: it.productId,
            storeId: d.storeId,
            qty: it.qty - take,
            at: nowIso(ctx),
            source: d.reorderId ? 'pedido' : 'entrega',
            refId,
          });
        }
      }
      it.preparedQty = take;
    }
    if (shortages.length) await ctx.repo.unmetDemand.bulkPut(shortages);
    if (prepared === 0) {
      // No hay nada: queda como demanda no atendida y la entrega sigue pendiente.
      for (const it of d.items) delete it.preparedQty;
      await ctx.repo.deliveries.put(d);
      await audit(ctx, 'entrega.sin_stock', 'delivery', d.id, `${d.code}: nada disponible; ${short} unidades a demanda no atendida`);
      return { delivery: d, prepared, short };
    }
    d.status = 'preparada';
    d.preparedAt = nowIso(ctx);
    d.preparedBy = ctx.actor.userId;
    await ctx.repo.deliveries.put(d);
    if (d.reorderId) await setReorderStatus(ctx, d.reorderId, 'preparado');
    await audit(ctx, 'entrega.preparar', 'delivery', d.id, `${d.code} preparada: ${prepared} unidades${short ? ` (faltaron ${short})` : ''}`);
    const storeUsers = await ctx.repo.users.where('storeId', store.id);
    await notify(
      ctx,
      [d.sellerId, ...storeUsers.map((u) => u.id)],
      'entrega_preparada',
      `Entrega lista: ${store.name}`,
      `${d.code} · ${prepared} unidades${short ? `; faltaron ${short} que no había en almacén` : ''}.`,
      `/${ctx.line}/entregas`,
    );
    return { delivery: d, prepared, short };
  });
}

export async function rejectDelivery(ctx: Ctx, deliveryId: string, reason: string): Promise<void> {
  guard(ctx, 'delivery.prepare');
  if (reason.trim().length < 3) throw new ValidationError('Escribe el motivo.');
  await mutate(ctx, async () => {
    const d = await ctx.repo.deliveries.get(deliveryId);
    if (!d) throw new NotFoundError('la entrega');
    if (d.status === 'entregada') throw new ValidationError('Esta entrega ya se entregó.');
    d.status = 'rechazada';
    d.rejectedReason = reason.trim();
    await ctx.repo.deliveries.put(d);
    if (d.reorderId) await setReorderStatus(ctx, d.reorderId, 'cancelado');
    await audit(ctx, 'entrega.rechazar', 'delivery', d.id, `${d.code} rechazada: ${reason}`);
    await notify(ctx, [d.sellerId], 'entrega_preparada', `Entrega ${d.code} rechazada`, reason, `/${ctx.line}/entregas`);
  });
}

const signatureSchema = z.object({
  name: z.string().trim().min(3, 'Escribe el nombre de quien recibe.'),
  image: z.string().startsWith('data:image/png', 'Falta la firma de quien recibe.').min(200, 'La firma está vacía.'),
  geo: z.object({ lat: z.number(), lng: z.number(), accuracy: z.number() }).optional(),
});

/**
 * El local firma la nota de entrega al recibir. En consignación, recién aquí baja el almacén y sube la
 * consignación del local (lote por lote). Si el local compra en firme, la mercancía pasa a ser suya:
 * sale del almacén a «vendido» y nace la factura con los precios de su lista.
 */
export async function receiveDelivery(ctx: Ctx, deliveryId: string, signature: z.input<typeof signatureSchema>): Promise<Delivery> {
  const sig = signatureSchema.parse(signature);
  return mutate(ctx, async () => {
    const d = await ctx.repo.deliveries.get(deliveryId);
    if (!d) throw new NotFoundError('la entrega');
    const store = await storeOrThrow(ctx, d.storeId);
    guard(ctx, 'delivery.receive', { type: 'store', store });
    if (d.status !== 'preparada') throw new ValidationError(`La entrega ${d.code} no está lista para entregar.`);
    assertCanSupply(ctx.line, store, ctx.now());
    const snap = await loadInventory(ctx);
    const at = nowIso(ctx);
    if (store.saleMode === 'firme') {
      const items = d.items.flatMap((it) => {
        const p = snap.productsById.get(it.productId);
        return p ? splitIntoPacks(p, it.preparedQty ?? 0).map((part) => ({ productId: it.productId, pack: part.pack, packQty: part.packQty })) : [];
      });
      const invoice = await writeFirmInvoice(ctx, { store, items, origin: 'entrega', sellerId: store.sellerId || d.sellerId, deliveryId: d.id, reorderId: d.reorderId, snap });
      d.invoiceId = invoice.id;
    } else {
      for (const it of d.items) {
        const qty = it.preparedQty ?? 0;
        if (qty <= 0) continue;
        const product = snap.productsById.get(it.productId);
        const parts = allocate(snap.balances, snap.lotsById, WAREHOUSE, it.productId, qty, product?.name);
        for (const part of parts) {
          const mv: Movement = {
            id: ctx.newId('mov'),
            at,
            type: 'salida_consignacion',
            productId: it.productId,
            lotId: part.lotId,
            qty: part.qty,
            from: WAREHOUSE,
            to: storeLoc(store.id),
            storeId: store.id,
            refType: 'delivery',
            refId: d.id,
            actorId: ctx.actor.userId,
          };
          await ctx.repo.movements.put(mv);
          snap.balances.apply(mv);
        }
      }
    }
    const received: Signature = { role: 'local', name: sig.name, image: sig.image, signedAt: at, geo: sig.geo, deviceUserId: ctx.actor.userId };
    d.status = 'entregada';
    d.deliveredAt = at;
    d.receivedSignature = received;
    // La nota de entrega se arma sobre la plantilla PDF activa, si administración dejó una.
    d.templateId = (await findActive(ctx, 'entrega'))?.id;
    await ctx.repo.deliveries.put(d);
    if (d.reorderId) await setReorderStatus(ctx, d.reorderId, 'entregado');
    const units = d.items.reduce((s, i) => s + (i.preparedQty ?? 0), 0);
    await audit(ctx, 'entrega.recibir', 'delivery', d.id, `${d.code} entregada en ${store.name}: ${units} unidades, recibió ${sig.name}`);
    await notify(ctx, 'admins', 'entrega_recibida', `Entregado en ${store.name}`, `${d.code} · ${units} unidades. Firmó ${sig.name}.`, `/${ctx.line}/entregas`);
    return d;
  });
}

// ---------- Ventas, visitas y conteos ----------

/** Crea un reporte de ventas: baja la consignación (lote a lote) y devenga comisiones. Uso interno. */
async function createSalesReport(
  ctx: Ctx,
  snap: InventorySnapshot,
  store: Store,
  items: { productId: string; qty: number }[],
  source: SalesReport['source'],
  at: string,
): Promise<SalesReport> {
  const settings = await getSettings(ctx);
  const seller = await ctx.repo.users.get(store.sellerId);
  const reportId = ctx.newId('vta');
  const lines: SaleLine[] = [];
  const commissions: Commission[] = [];
  for (const it of items) {
    if (it.qty <= 0) continue;
    const p = snap.productsById.get(it.productId);
    if (!p) throw new ValidationError('Producto desconocido.');
    const parts = allocate(snap.balances, snap.lotsById, storeLoc(store.id), it.productId, it.qty, p.name);
    let cost = 0;
    const lots: SaleLine['lots'] = [];
    for (const part of parts) {
      const unitCost = snap.lotsById.get(part.lotId)?.unitCost ?? p.cost;
      cost += part.qty * unitCost;
      lots.push({ lotId: part.lotId, qty: part.qty, unitCost });
      const mv: Movement = {
        id: ctx.newId('mov'),
        at,
        type: 'venta_reportada',
        productId: it.productId,
        lotId: part.lotId,
        qty: part.qty,
        from: storeLoc(store.id),
        to: { kind: 'sold' },
        storeId: store.id,
        refType: 'sale',
        refId: reportId,
        actorId: ctx.actor.userId,
      };
      await ctx.repo.movements.put(mv);
      snap.balances.apply(mv);
    }
    lines.push({ productId: it.productId, qty: it.qty, unitPrice: p.priceToStore, cost: round2(cost), lots });
    const rule = effectiveRule(p, seller);
    commissions.push({
      id: ctx.newId('com'),
      sellerId: store.sellerId,
      storeId: store.id,
      productId: p.id,
      salesReportId: reportId,
      settlementId: null,
      qty: it.qty,
      base: round2(it.qty * p.priceToStore),
      amount: commissionAmount(rule, it.qty, p.priceToStore),
      rule,
      status: settings.commissionPayableOn === 'venta' ? 'pagable' : 'devengada',
      accruedAt: at,
      payableAt: settings.commissionPayableOn === 'venta' ? at : undefined,
    });
  }
  if (lines.length === 0) throw new ValidationError('No hay ventas para reportar.');
  const report: SalesReport = {
    id: reportId,
    storeId: store.id,
    sellerId: store.sellerId,
    at,
    source,
    lines,
    total: round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)),
    settlementId: null,
    createdBy: ctx.actor.userId,
  };
  await ctx.repo.salesReports.put(report);
  await ctx.repo.commissions.bulkPut(commissions);
  return report;
}

const countSchema = z.object({
  photo: z.custom<NewPhoto>().optional(),
  storeId: z.string().min(1),
  counts: z.array(z.object({ productId: z.string().min(1), counted: z.number().int('El conteo es un número entero.').min(0, 'El conteo no puede ser negativo.') })),
  notes: z.string().trim().max(500).default(''),
  geo: z.object({ lat: z.number(), lng: z.number(), accuracy: z.number() }).optional(),
});

/**
 * Visita con conteo: lo que falta contra lo que había en consignación es venta reportada.
 * Un conteo nunca puede ser mayor que lo colocado (la consignación no crece por contar).
 */
export async function recordVisit(ctx: Ctx, input: z.input<typeof countSchema>): Promise<{ visit: Visit; report?: SalesReport }> {
  const data = countSchema.parse(input);
  return mutate(ctx, async () => {
    const store = await storeOrThrow(ctx, data.storeId);
    guard(ctx, 'visit.create', { type: 'store', store });
    const snap = await loadInventory(ctx);
    const at = nowIso(ctx);
    const counts: Visit['counts'] = [];
    const sold: { productId: string; qty: number }[] = [];
    for (const c of data.counts) {
      const expected = snap.balances.qty(storeLoc(store.id), c.productId);
      if (c.counted > expected) {
        const name = snap.productsById.get(c.productId)?.name ?? 'un producto';
        throw new ValidationError(`Contaste ${c.counted} de ${name}, pero en consignación hay ${expected}. Revisa el conteo.`);
      }
      counts.push({ productId: c.productId, expected, counted: c.counted });
      if (expected - c.counted > 0) sold.push({ productId: c.productId, qty: expected - c.counted });
    }
    let report: SalesReport | undefined;
    if (sold.length) report = await createSalesReport(ctx, snap, store, sold, 'conteo', at);
    const visitId = ctx.newId('vis');
    const visitPhotos: string[] = [];
    if (data.photo) {
      const photoId = ctx.newId('pho');
      await ctx.repo.photos.put({ ...data.photo, id: photoId, ownerType: 'visit', ownerId: visitId, createdAt: at });
      visitPhotos.push(photoId);
    }
    const visit: Visit = {
      id: visitId,
      storeId: store.id,
      sellerId: store.sellerId,
      at,
      geo: data.geo,
      notes: data.notes,
      counts,
      salesReportId: report?.id,
      photoIds: visitPhotos,
    };
    await ctx.repo.visits.put(visit);
    const units = sold.reduce((s, x) => s + x.qty, 0);
    await audit(ctx, 'visita.registrar', 'visit', visit.id, `Visita a ${store.name}: ${units ? `${units} vendidas por conteo` : 'sin ventas'}`);
    return { visit, report };
  });
}

/** El local (o su vendedor) reporta ventas sin esperar la visita. */
export async function reportSales(ctx: Ctx, input: { storeId: string; items: { productId: string; qty: number }[] }): Promise<SalesReport> {
  const items = itemsSchema.parse(input.items);
  return mutate(ctx, async () => {
    const store = await storeOrThrow(ctx, input.storeId);
    guard(ctx, 'sale.report', { type: 'store', store });
    const snap = await loadInventory(ctx);
    const report = await createSalesReport(ctx, snap, store, items, ctx.actor.role === 'store' ? 'local' : 'conteo', nowIso(ctx));
    const units = items.reduce((s, i) => s + i.qty, 0);
    await audit(ctx, 'venta.reportar', 'sale', report.id, `${store.name} reportó ${units} unidades vendidas`);
    if (ctx.actor.role === 'store') {
      await notify(ctx, [store.sellerId], 'mensaje', `${store.name} reportó ventas`, `${units} unidades vendidas.`, `/${ctx.line}/locales/${store.id}`);
    }
    return report;
  });
}

const returnSchema = z.object({
  storeId: z.string().min(1),
  kind: z.enum(['devolucion', 'merma']),
  items: itemsSchema,
  reason: z.string().trim().min(3, 'Escribe el motivo.'),
  photoIds: z.array(z.string()).default([]),
  photo: z.custom<NewPhoto>().optional(),
});

/** Devolución (del local al almacén, por lote) o merma en el local (daño, vencido…). */
export async function recordReturn(ctx: Ctx, input: z.input<typeof returnSchema>): Promise<ReturnRecord> {
  const data = returnSchema.parse(input);
  return mutate(ctx, async () => {
    const store = await storeOrThrow(ctx, data.storeId);
    guard(ctx, 'return.create', { type: 'store', store });
    const snap = await loadInventory(ctx);
    const at = nowIso(ctx);
    const id = ctx.newId('ret');
    let cost = 0;
    for (const it of data.items) {
      const p = snap.productsById.get(it.productId);
      const parts = allocate(snap.balances, snap.lotsById, storeLoc(store.id), it.productId, it.qty, p?.name);
      for (const part of parts) {
        cost += part.qty * (snap.lotsById.get(part.lotId)?.unitCost ?? 0);
        const mv: Movement = {
          id: ctx.newId('mov'),
          at,
          type: data.kind === 'devolucion' ? 'devolucion' : 'merma',
          productId: it.productId,
          lotId: part.lotId,
          qty: part.qty,
          from: storeLoc(store.id),
          to: data.kind === 'devolucion' ? WAREHOUSE : { kind: 'loss' },
          storeId: store.id,
          refType: data.kind === 'devolucion' ? 'return' : 'shrink',
          refId: id,
          reason: data.reason,
          actorId: ctx.actor.userId,
        };
        await ctx.repo.movements.put(mv);
        snap.balances.apply(mv);
      }
    }
    const photoIds = [...data.photoIds];
    if (data.photo) {
      const photoId = ctx.newId('pho');
      await ctx.repo.photos.put({ ...data.photo, id: photoId, ownerType: 'return', ownerId: id, createdAt: at });
      photoIds.push(photoId);
    }
    const rec: ReturnRecord = {
      id,
      storeId: store.id,
      kind: data.kind,
      at,
      items: data.items,
      reason: data.reason,
      photoIds,
      createdBy: ctx.actor.userId,
      cost: round2(cost),
    };
    await ctx.repo.returns.put(rec);
    const units = data.items.reduce((s, i) => s + i.qty, 0);
    await audit(ctx, data.kind === 'devolucion' ? 'devolucion.registrar' : 'merma.registrar', 'return', id, `${data.kind === 'devolucion' ? 'Devolución' : 'Merma'} de ${units} en ${store.name}: ${data.reason}`);
    return rec;
  });
}

export async function storeSalesHistory(ctx: Ctx, storeId: string): Promise<SalesReport[]> {
  const store = await storeOrThrow(ctx, storeId);
  guard(ctx, 'store.read', { type: 'store', store });
  const list = await ctx.repo.salesReports.where('storeId', storeId);
  const isAdmin = ctx.actor.role === 'admin';
  return list
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((r) => (isAdmin ? r : { ...r, lines: r.lines.map((l) => ({ ...l, cost: 0, lots: [] })) }));
}

export async function storeVisits(ctx: Ctx, storeId: string): Promise<Visit[]> {
  const store = await storeOrThrow(ctx, storeId);
  guard(ctx, 'visit.read', { type: 'store', store });
  const list = await ctx.repo.visits.where('storeId', storeId);
  return list.sort((a, b) => b.at.localeCompare(a.at));
}

export async function storeReturns(ctx: Ctx, storeId: string): Promise<ReturnRecord[]> {
  const store = await storeOrThrow(ctx, storeId);
  guard(ctx, 'store.read', { type: 'store', store });
  const list = await ctx.repo.returns.where('storeId', storeId);
  return list.sort((a, b) => b.at.localeCompare(a.at)).map((r) => (ctx.actor.role === 'admin' ? r : { ...r, cost: 0 }));
}

// ---------- Pedidos de los locales ----------

export interface ReorderView extends Reorder {
  storeName: string;
  sellerName: string;
  itemsView: { productId: string; name: string; qty: number; available: number }[];
}

export async function listReorders(ctx: Ctx, filter?: { storeId?: string; open?: boolean }): Promise<ReorderView[]> {
  guard(ctx, 'reorder.read');
  const stores = await scopedStores(ctx);
  const storesById = new Map(stores.map((s) => [s.id, s]));
  const [all, users, snap] = await Promise.all([ctx.repo.reorders.all(), ctx.repo.users.all(), loadInventory(ctx)]);
  const usersById = new Map(users.map((u) => [u.id, u]));
  return all
    .filter((r) => storesById.has(r.storeId))
    .filter((r) => !filter?.storeId || r.storeId === filter.storeId)
    .filter((r) => !filter?.open || r.status === 'enviado' || r.status === 'confirmado' || r.status === 'preparado')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => ({
      ...r,
      storeName: storesById.get(r.storeId)?.name ?? '—',
      sellerName: usersById.get(r.sellerId)?.name ?? '—',
      itemsView: r.items.map((i) => ({
        productId: i.productId,
        name: snap.productsById.get(i.productId)?.name ?? i.productId,
        qty: i.qty,
        available: Math.max(0, snap.balances.qty(WAREHOUSE, i.productId) - (snap.reserved.get(i.productId) ?? 0)),
      })),
    }));
}

async function setReorderStatus(ctx: Ctx, reorderId: string, status: Reorder['status']): Promise<void> {
  const r = await ctx.repo.reorders.get(reorderId);
  if (!r) return;
  r.status = status;
  r.history.push({ status, at: nowIso(ctx), by: ctx.actor.userId });
  await ctx.repo.reorders.put(r);
}

/** El local pide más producto. Le llega el aviso a su vendedor. */
export async function createReorder(ctx: Ctx, input: { storeId: string; items: { productId: string; qty: number }[]; note?: string }): Promise<Reorder> {
  const items = itemsSchema.parse(input.items);
  return mutate(ctx, async () => {
    const store = await storeOrThrow(ctx, input.storeId);
    guard(ctx, 'reorder.create', { type: 'store', store });
    const check = supplyCheck(ctx.line, store, ctx.now());
    if (!check.ok) throw new ValidationError(check.reason);
    const at = nowIso(ctx);
    const reorder: Reorder = {
      id: ctx.newId('ped'),
      code: await nextCode('P', ctx.repo.reorders.count()),
      storeId: store.id,
      sellerId: store.sellerId,
      status: 'enviado',
      items,
      note: input.note?.trim() ?? '',
      createdAt: at,
      createdBy: ctx.actor.userId,
      origin: ctx.actor.role === 'store' ? 'local' : 'vendedor',
      history: [{ status: 'enviado', at, by: ctx.actor.userId }],
    };
    await ctx.repo.reorders.put(reorder);
    const units = items.reduce((s, i) => s + i.qty, 0);
    await audit(ctx, 'pedido.crear', 'reorder', reorder.id, `${store.name} pidió ${units} unidades (${reorder.code})`);
    await notify(ctx, [store.sellerId], 'pedido_nuevo', `Pedido nuevo de ${store.name}`, `${reorder.code} · ${units} unidades. Confírmalo para que el almacén lo prepare.`, `/${ctx.line}/pedidos`);
    return reorder;
  });
}

export const REORDER_ORIGIN_LABEL: Record<NonNullable<Reorder['origin']>, string> = {
  local: 'Lo pidió el local',
  vendedor: 'Lo pidió el vendedor',
  telefono: 'Por teléfono',
  pegado: 'Pegado de un mensaje',
};

/**
 * Administración anota el pedido de un local que llamó por teléfono (o que se pegó de un mensaje de
 * WhatsApp). Queda confirmado y pasa al almacén como entrega por preparar; sigue el camino de siempre
 * (preparar → entregar con firma; el local que compra en firme recibe su factura al firmar).
 */
export async function createPhoneOrder(
  ctx: Ctx,
  input: { storeId: string; items: { productId: string; qty: number }[]; note?: string },
  origin: 'telefono' | 'pegado' = 'telefono',
): Promise<{ reorder: Reorder; delivery: Delivery }> {
  guard(ctx, 'order.phone');
  const items = itemsSchema.parse(input.items);
  return mutate(ctx, async () => {
    const store = await storeOrThrow(ctx, input.storeId);
    const check = supplyCheck(ctx.line, store, ctx.now());
    if (!check.ok) throw new ValidationError(check.reason);
    const at = nowIso(ctx);
    const note = input.note?.trim() ?? '';
    const reorder: Reorder = {
      id: ctx.newId('ped'),
      code: await nextCode('P', ctx.repo.reorders.count()),
      storeId: store.id,
      sellerId: store.sellerId,
      status: 'confirmado',
      items,
      note,
      createdAt: at,
      createdBy: ctx.actor.userId,
      confirmedAt: at,
      origin,
      history: [
        { status: 'enviado', at, by: ctx.actor.userId },
        { status: 'confirmado', at, by: ctx.actor.userId },
      ],
    };
    await ctx.repo.reorders.put(reorder);
    const how = origin === 'telefono' ? 'Pedido por teléfono' : 'Pedido pegado de un mensaje';
    const delivery = await writeDeliveryRequest(ctx, { storeId: store.id, items, note: `${how} ${reorder.code}${note ? `: ${note}` : ''}` }, { origin: 'pedido_local', reorderId: reorder.id });
    reorder.deliveryId = delivery.id;
    await ctx.repo.reorders.put(reorder);
    const units = items.reduce((a, i) => a + i.qty, 0);
    await audit(ctx, origin === 'telefono' ? 'pedido.telefono' : 'pedido.pegado', 'reorder', reorder.id, `${how}: ${reorder.code} de ${store.name}, ${units} unidades`);
    const storeUsers = await ctx.repo.users.where('storeId', store.id);
    await notify(
      ctx,
      [store.sellerId, ...storeUsers.map((u) => u.id)],
      'pedido_confirmado',
      `Pedido ${reorder.code} anotado`,
      `La oficina anotó el pedido de ${store.name} (${how.toLowerCase()}). El almacén lo está preparando.`,
      `/${ctx.line}/pedidos`,
    );
    return { reorder, delivery };
  });
}

/** El vendedor confirma el pedido: pasa a administración como entrega por preparar. */
export async function confirmReorder(ctx: Ctx, reorderId: string): Promise<Delivery> {
  const r = await ctx.repo.reorders.get(reorderId);
  if (!r) throw new NotFoundError('el pedido');
  const store = await storeOrThrow(ctx, r.storeId);
  guard(ctx, 'reorder.confirm', { type: 'store', store });
  if (r.status !== 'enviado') throw new ValidationError(`El pedido ${r.code} ya está «${REORDER_STATUS_LABEL[r.status]}».`);
  return mutate(ctx, async () => {
    const delivery = await writeDeliveryRequest(ctx, { storeId: r.storeId, items: r.items, note: `Pedido del local ${r.code}${r.note ? `: ${r.note}` : ''}` }, { origin: 'pedido_local', reorderId: r.id });
    const fresh = await ctx.repo.reorders.get(reorderId);
    if (!fresh) throw new NotFoundError('el pedido');
    fresh.status = 'confirmado';
    fresh.confirmedAt = nowIso(ctx);
    fresh.deliveryId = delivery.id;
    fresh.history.push({ status: 'confirmado', at: fresh.confirmedAt, by: ctx.actor.userId });
    await ctx.repo.reorders.put(fresh);
    await audit(ctx, 'pedido.confirmar', 'reorder', fresh.id, `${fresh.code} confirmado por el vendedor`);
    const storeUsers = await ctx.repo.users.where('storeId', store.id);
    await notify(ctx, storeUsers.map((u) => u.id), 'pedido_confirmado', `Tu pedido ${fresh.code} fue confirmado`, 'El almacén lo está preparando.', `/${ctx.line}/pedidos`);
    return delivery;
  });
}

export async function cancelReorder(ctx: Ctx, reorderId: string, reason: string): Promise<void> {
  await mutate(ctx, async () => {
    const r = await ctx.repo.reorders.get(reorderId);
    if (!r) throw new NotFoundError('el pedido');
    const store = await storeOrThrow(ctx, r.storeId);
    guard(ctx, ctx.actor.role === 'store' ? 'reorder.create' : 'reorder.confirm', { type: 'store', store });
    if (r.status !== 'enviado') throw new ValidationError('Solo se cancela un pedido que todavía no se confirmó.');
    r.status = 'cancelado';
    r.history.push({ status: 'cancelado', at: nowIso(ctx), by: ctx.actor.userId });
    r.note = [r.note, `Cancelado: ${reason}`].filter(Boolean).join(' · ');
    await ctx.repo.reorders.put(r);
    await audit(ctx, 'pedido.cancelar', 'reorder', r.id, `${r.code} cancelado: ${reason}`);
  });
}
