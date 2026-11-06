// Venta en firme (mayoreo): la factura que nace al recibir la entrega de un local que compra en firme,
// o en la «Venta rápida» del almacén; sus pagos (solo el apunte: la app no cobra ni mueve dinero) y las
// comisiones que genera. La mercancía sale del almacén a «vendido» lote por lote, con su costo.
import { z } from 'zod';
import type { Commission, Invoice, InvoiceLine, InvoiceOrigin, Movement, Payment, PaymentMethod, Product, SalePack, Store } from '../data/types';
import { ComplianceError, firmSaleCheck, supplyCheck } from '../domain/compliance';
import { creditDaysFor, creditText, hasValidResaleCert, invoiceBalance, invoiceCommissions, invoiceDueOn, invoiceStatus, invoiceTotals, isInvoiceOverdue } from '../domain/invoices';
import { WAREHOUSE, allocate } from '../domain/ledger';
import { type AgingBucket, agingBucket } from '../domain/money-rules';
import { baseQty, priceFor } from '../domain/pricing';
import { countText, unitNames, unitsText } from '../domain/products';
import { fmtMoney, round2 } from '../lib/money';
import { addDays, daysBetween, fmtDate, toIsoDate } from '../lib/time';
import { type Ctx, NotFoundError, ValidationError, audit, getSettings, guard, mutate, notify, nowIso } from './context';
import { type InventorySnapshot, loadInventory } from './inventory';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, needsReference } from './money';

export { needsReference };
import { type StorePriceRow, computeStorePrices, storeList } from './prices';
import { scopedStores } from './stores';

export const INVOICE_ORIGIN_LABEL: Record<InvoiceOrigin, string> = {
  entrega: 'Entrega firmada',
  venta_rapida: 'Venta rápida en el almacén',
};

/** «1 caja (50 mazos)», «2 cajas (40 tabacos)» o «10 mazos». */
export function packQtyText(p: Pick<Product, 'unitName' | 'packSize'>, pack: SalePack, packQty: number): string {
  if (pack === 'unidad') return unitsText(p, packQty);
  return `${countText(packQty, unitNames('caja'))} (${unitsText(p, packQty * p.packSize)})`;
}

export interface InvoiceItem {
  productId: string;
  pack: SalePack;
  packQty: number;
}

async function nextInvoiceCode(ctx: Ctx): Promise<string> {
  return `F-${String((await ctx.repo.invoices.count()) + 1).padStart(4, '0')}`;
}

/**
 * Comisiones de una factura en firme: una por línea, si tiene vendedor (la venta directa no lleva).
 * La regla sale de un solo lugar (`invoiceCommissionRule`, en domain/invoices.ts).
 */
export async function accrueInvoiceCommissions(ctx: Ctx, invoice: Invoice): Promise<Commission[]> {
  if (!invoice.sellerId) return [];
  const [seller, settings, products] = await Promise.all([ctx.repo.users.get(invoice.sellerId), getSettings(ctx), ctx.repo.products.all()]);
  const list = invoiceCommissions(invoice, new Map(products.map((p) => [p.id, p])), seller, settings.commissionPayableOn, ctx.newId);
  if (list.length) await ctx.repo.commissions.bulkPut(list);
  return list;
}

/**
 * Escribe una venta en firme dentro de la transacción de quien llama (nunca abre otra): precios de la
 * lista del local, salida del almacén por lote (FEFO en café, FIFO en tabaco) a «vendido», costo por
 * lote, la factura con su vencimiento, comisiones si hay vendedor, auditoría y aviso al local. Uso interno.
 */
export async function writeFirmInvoice(
  ctx: Ctx,
  args: {
    store: Store;
    items: readonly InvoiceItem[];
    origin: InvoiceOrigin;
    sellerId: string | null;
    deliveryId?: string;
    reorderId?: string;
    note?: string;
    /** Venta rápida: no se toca lo apartado para las entregas ya preparadas. */
    respectReserved?: boolean;
    snap?: InventorySnapshot;
  },
): Promise<Invoice> {
  const { store } = args;
  const [settings, snap] = await Promise.all([getSettings(ctx), args.snap ? Promise.resolve(args.snap) : loadInventory(ctx)]);
  const list = await storeList(ctx, store, settings);
  const now = ctx.now();
  const at = nowIso(ctx);
  const id = ctx.newId('fac');
  const need = new Map<string, number>();
  for (const it of args.items) {
    const p = snap.productsById.get(it.productId);
    if (!p) throw new ValidationError('Uno de los productos no existe en el catálogo.');
    need.set(p.id, (need.get(p.id) ?? 0) + baseQty(p, it.pack, it.packQty));
  }
  if (args.respectReserved) {
    for (const [pid, qty] of need) {
      const p = snap.productsById.get(pid)!;
      const available = Math.max(0, snap.balances.qty(WAREHOUSE, pid) - (snap.reserved.get(pid) ?? 0));
      if (qty > available) {
        throw new ValidationError(
          available > 0
            ? `No alcanza ${p.name}: hay ${unitsText(p, available)} en el almacén y se piden ${unitsText(p, qty)}.`
            : `No hay ${p.name} en el almacén: no se puede vender.`,
        );
      }
    }
  }
  const lines: InvoiceLine[] = [];
  for (const it of args.items) {
    const p = snap.productsById.get(it.productId)!;
    const qty = baseQty(p, it.pack, it.packQty);
    const quote = priceFor(p, list, { pack: it.pack, qty: it.packQty });
    const parts = allocate(snap.balances, snap.lotsById, WAREHOUSE, p.id, qty, p.name);
    let cost = 0;
    const lots: InvoiceLine['lots'] = [];
    for (const part of parts) {
      const unitCost = snap.lotsById.get(part.lotId)?.unitCost ?? p.cost;
      cost += part.qty * unitCost;
      lots.push({ lotId: part.lotId, qty: part.qty, unitCost });
      const mv: Movement = {
        id: ctx.newId('mov'),
        at,
        type: 'venta_firme',
        productId: p.id,
        lotId: part.lotId,
        qty: part.qty,
        from: WAREHOUSE,
        to: { kind: 'sold' },
        storeId: store.id,
        refType: 'invoice',
        refId: id,
        actorId: ctx.actor.userId,
      };
      await ctx.repo.movements.put(mv);
      snap.balances.apply(mv);
    }
    lines.push({ productId: p.id, name: p.name, pack: it.pack, packQty: it.packQty, qty, unitPrice: quote.price, amount: round2(quote.price * it.packQty), cost: round2(cost), lots });
  }
  if (lines.length === 0) throw new ValidationError('Agrega al menos un producto.');
  const withoutResaleCert = !hasValidResaleCert(store, now);
  const totals = invoiceTotals(lines, settings.salesTaxPercent, withoutResaleCert);
  const creditDays = creditDaysFor(store, settings);
  const invoice: Invoice = {
    id,
    code: await nextInvoiceCode(ctx),
    storeId: store.id,
    sellerId: args.sellerId,
    origin: args.origin,
    deliveryId: args.deliveryId,
    reorderId: args.reorderId,
    priceListId: list?.id,
    lines,
    ...totals,
    paid: 0,
    status: 'pendiente',
    issuedAt: at,
    dueOn: invoiceDueOn(toIsoDate(now), creditDays),
    creditDays,
    withoutResaleCert,
    note: args.note?.trim() ?? '',
    createdBy: ctx.actor.userId,
  };
  await ctx.repo.invoices.put(invoice);
  await accrueInvoiceCommissions(ctx, invoice);
  await audit(ctx, 'factura.emitir', 'invoice', invoice.id, `${invoice.code} para ${store.name}: ${invoice.total.toFixed(2)} USD (${INVOICE_ORIGIN_LABEL[invoice.origin].toLowerCase()})`);
  const storeUsers = await ctx.repo.users.where('storeId', store.id);
  await notify(
    ctx,
    storeUsers.map((u) => u.id),
    'factura_nueva',
    `Factura ${invoice.code}`,
    `${fmtMoney(invoice.total)}. ${creditDays > 0 ? `Vence el ${fmtDate(invoice.dueOn)}.` : 'De contado.'}`,
    `/${ctx.line}/cuentas`,
  );
  return invoice;
}

const paymentSchema = z.object({
  amount: z.number({ error: 'Escribe el monto.' }).positive('El monto tiene que ser mayor que cero.'),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(60).default(''),
});

/** Apunta un pago de una factura dentro de la transacción de quien llama. Uso interno. */
async function writeInvoicePayment(ctx: Ctx, inv: Invoice, data: z.output<typeof paymentSchema>): Promise<Payment> {
  const balance = invoiceBalance(inv);
  if (balance <= 0) throw new ValidationError(`La factura ${inv.code} ya está pagada.`);
  if (data.amount > balance + 0.001) throw new ValidationError(`El pago no puede pasar del saldo (${balance.toFixed(2)} USD).`);
  const at = nowIso(ctx);
  const payment: Payment = {
    id: ctx.newId('pag'),
    invoiceId: inv.id,
    storeId: inv.storeId,
    amount: round2(data.amount),
    method: data.method,
    reference: data.reference,
    at,
    recordedBy: ctx.actor.userId,
  };
  await ctx.repo.payments.put(payment);
  inv.paid = round2(inv.paid + payment.amount);
  inv.status = invoiceStatus(inv.total, inv.paid);
  if (inv.status === 'pagada') inv.paidAt = at;
  await ctx.repo.invoices.put(inv);
  const settings = await getSettings(ctx);
  let freed = 0;
  if (inv.status === 'pagada' && settings.commissionPayableOn === 'cobro') {
    const comms = (await ctx.repo.commissions.where('storeId', inv.storeId)).filter((c) => c.invoiceId === inv.id && c.status === 'devengada');
    for (const c of comms) {
      c.status = 'pagable';
      c.payableAt = at;
      freed += c.amount;
      await ctx.repo.commissions.put(c);
    }
  }
  const store = await ctx.repo.stores.get(inv.storeId);
  await audit(ctx, 'pago.registrar', 'payment', payment.id, `Pago de ${payment.amount.toFixed(2)} USD (${PAYMENT_METHOD_LABEL[payment.method]}) a ${inv.code} de ${store?.name ?? inv.storeId}`);
  const storeUsers = await ctx.repo.users.where('storeId', inv.storeId);
  await notify(ctx, storeUsers.map((u) => u.id), 'pago_registrado', `Pago registrado: ${inv.code}`, `${payment.amount.toFixed(2)} USD por ${PAYMENT_METHOD_LABEL[payment.method]}.`, `/${ctx.line}/cuentas`);
  if (freed > 0 && inv.sellerId) {
    await notify(ctx, [inv.sellerId], 'pago_registrado', `${store?.name ?? 'Un local'} pagó ${inv.code}`, `Tienes ${round2(freed).toFixed(2)} USD en comisiones listas para cobrar.`, `/${ctx.line}/comisiones`);
  }
  return payment;
}

/** Registra un pago de una factura (solo el apunte). Se puede pagar en partes. */
export async function recordInvoicePayment(ctx: Ctx, invoiceId: string, input: z.input<typeof paymentSchema>): Promise<Payment> {
  guard(ctx, 'payment.record');
  const data = paymentSchema.parse(input);
  if (needsReference(data.method) && data.reference.length < 2) throw new ValidationError('Escribe la referencia (número de cheque o de confirmación).');
  return mutate(ctx, async () => {
    const inv = await ctx.repo.invoices.get(invoiceId);
    if (!inv) throw new NotFoundError('la factura');
    return writeInvoicePayment(ctx, inv, data);
  });
}

// ---------- Venta rápida ----------

export type QuickPayment = PaymentMethod | 'cuenta';

const quickSaleSchema = z.object({
  storeId: z.string().min(1, 'Elige el local.'),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        pack: z.enum(['unidad', 'caja']),
        packQty: z.number().int('Las cantidades son números enteros.').positive('Cada cantidad tiene que ser mayor que cero.'),
      }),
    )
    .min(1, 'Agrega al menos un producto.')
    .refine((items) => new Set(items.map((i) => `${i.productId}|${i.pack}`)).size === items.length, 'Hay un producto repetido.'),
  payment: z.object({
    method: z.union([z.enum(PAYMENT_METHODS), z.literal('cuenta')]),
    reference: z.string().trim().max(60).default(''),
  }),
  note: z.string().trim().max(200).default(''),
});

/**
 * «Venta rápida»: el dueño de un local registrado viene al almacén y se lleva lo suyo. Es venta en
 * firme aunque el local trabaje en consignación: baja el stock, nace la factura y, si paga ahí, el
 * pago. «A cuenta» la deja pendiente con los días de crédito del local. Sin vendedor: sin comisión.
 */
export async function quickSale(ctx: Ctx, input: z.input<typeof quickSaleSchema>): Promise<{ invoice: Invoice; payment?: Payment }> {
  guard(ctx, 'sale.quick');
  const data = quickSaleSchema.parse(input);
  const method = data.payment.method;
  if (method !== 'cuenta' && needsReference(method) && data.payment.reference.length < 2) {
    throw new ValidationError('Escribe la referencia del pago (número de confirmación o de cheque).');
  }
  return mutate(ctx, async () => {
    const store = await ctx.repo.stores.get(data.storeId);
    if (!store) throw new NotFoundError('el local');
    const check = firmSaleCheck(ctx.line, store, ctx.now());
    if (!check.ok) throw new ComplianceError(check.reason);
    for (const it of data.items) {
      const p = await ctx.repo.products.get(it.productId);
      if (!p || !p.active) throw new ValidationError('Uno de los productos no está activo en el catálogo.');
    }
    const invoice = await writeFirmInvoice(ctx, { store, items: data.items, origin: 'venta_rapida', sellerId: null, note: data.note, respectReserved: true });
    const payment = method === 'cuenta' ? undefined : await writeInvoicePayment(ctx, invoice, { amount: invoice.total, method, reference: data.payment.reference });
    await audit(ctx, 'venta_rapida.registrar', 'invoice', invoice.id, `Venta rápida ${invoice.code} a ${store.name}: ${invoice.total.toFixed(2)} USD, ${method === 'cuenta' ? 'a cuenta' : PAYMENT_METHOD_LABEL[method].toLowerCase()}`);
    return { invoice, payment };
  });
}

export interface QuickStore {
  store: Store;
  /** Cómo compra: «En firme · de contado», «Consignación»… */
  terms: string;
  /** Por qué no se le puede vender (permiso vencido, pausado…). */
  blocked?: string;
  lastAt?: string;
  count: number;
}

/**
 * Locales para la venta rápida (o para anotar un pedido por teléfono): los recientes y frecuentes
 * primero; los que no pueden comprar, al final y con el motivo.
 */
export async function quickSaleStores(ctx: Ctx, purpose: 'venta' | 'pedido' = 'venta'): Promise<QuickStore[]> {
  guard(ctx, purpose === 'venta' ? 'sale.quick' : 'order.phone');
  const [stores, invoices, deliveries] = await Promise.all([ctx.repo.stores.all(), ctx.repo.invoices.all(), ctx.repo.deliveries.all()]);
  const now = ctx.now();
  const since = addDays(now, -90);
  const activity = new Map<string, { lastAt: string; count: number }>();
  const bump = (storeId: string, at: string) => {
    if (at < since) return;
    const cur = activity.get(storeId) ?? { lastAt: '', count: 0 };
    cur.count += 1;
    if (at > cur.lastAt) cur.lastAt = at;
    activity.set(storeId, cur);
  };
  for (const i of invoices) bump(i.storeId, i.issuedAt);
  for (const d of deliveries) if (d.status === 'entregada' && d.deliveredAt) bump(d.storeId, d.deliveredAt);
  return stores
    .filter((s) => s.status !== 'cerrado')
    .map((s) => {
      // En la venta rápida se vende en firme; un pedido sigue el camino de cómo compra el local.
      const check = purpose === 'venta' ? firmSaleCheck(ctx.line, s, now) : supplyCheck(ctx.line, s, now);
      const a = activity.get(s.id);
      return { store: s, terms: creditText(s), blocked: check.ok ? undefined : check.reason, lastAt: a?.lastAt, count: a?.count ?? 0 };
    })
    .sort(
      (a, b) =>
        Number(Boolean(a.blocked)) - Number(Boolean(b.blocked)) ||
        (b.lastAt ?? '').slice(0, 10).localeCompare((a.lastAt ?? '').slice(0, 10)) ||
        b.count - a.count ||
        a.store.name.localeCompare(b.store.name, 'es'),
    );
}

export interface QuickProduct {
  product: Product;
  /** Disponible en almacén (sin lo apartado para entregas preparadas). */
  available: number;
  price: StorePriceRow;
  /** Unidades vendidas en firme en los últimos 90 días (todas las tiendas). */
  sold90: number;
  /** Última vez que este local lo compró en firme. */
  lastForStore?: string;
}

/** Productos para vender: lo que el local compra seguido y lo que más sale primero; con sus precios. */
export async function quickSaleProducts(ctx: Ctx, storeId: string | null, purpose: 'venta' | 'pedido' = 'venta'): Promise<{ products: QuickProduct[]; listName: string }> {
  guard(ctx, purpose === 'venta' ? 'sale.quick' : 'order.phone');
  const [snap, invoices, settings, store] = await Promise.all([
    loadInventory(ctx),
    ctx.repo.invoices.all(),
    getSettings(ctx),
    storeId ? ctx.repo.stores.get(storeId) : Promise.resolve(undefined),
  ]);
  const list = await storeList(ctx, store, settings);
  const prices = computeStorePrices(store ?? { id: '', saleMode: 'firme' }, snap.products, list);
  const since = addDays(ctx.now(), -90);
  const sold = new Map<string, number>();
  const last = new Map<string, string>();
  for (const inv of invoices) {
    for (const l of inv.lines) {
      if (inv.issuedAt >= since) sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.qty);
      if (store && inv.storeId === store.id && inv.issuedAt > (last.get(l.productId) ?? '')) last.set(l.productId, inv.issuedAt);
    }
  }
  const products = snap.products
    .filter((p) => p.active)
    .map((p) => ({
      product: p,
      available: Math.max(0, snap.balances.qty(WAREHOUSE, p.id) - (snap.reserved.get(p.id) ?? 0)),
      price: prices.prices[p.id]!,
      sold90: sold.get(p.id) ?? 0,
      lastForStore: last.get(p.id),
    }))
    .sort(
      (a, b) =>
        Number(a.available === 0) - Number(b.available === 0) ||
        (b.lastForStore ?? '').localeCompare(a.lastForStore ?? '') ||
        b.sold90 - a.sold90 ||
        a.product.name.localeCompare(b.product.name, 'es'),
    );
  return { products, listName: prices.listName };
}

// ---------- Lecturas ----------

export interface InvoiceView extends Invoice {
  /** Cada línea con su cantidad en palabras: «1 caja (50 mazos)», «10 mazos». */
  qtyTexts: string[];
  storeName: string;
  sellerName: string;
  balance: number;
  overdue: boolean;
  bucket: AgingBucket;
  daysOld: number;
  payments: Payment[];
}

/** Facturas que el actor puede ver: todas (administración), las de sus locales (vendedor) o las suyas (local). */
export async function listInvoices(ctx: Ctx, filter?: { storeId?: string; open?: boolean }): Promise<InvoiceView[]> {
  guard(ctx, 'invoice.read');
  const stores = await scopedStores(ctx);
  const storesById = new Map(stores.map((s) => [s.id, s]));
  const [all, payments, users, products] = await Promise.all([
    filter?.storeId ? ctx.repo.invoices.where('storeId', filter.storeId) : ctx.repo.invoices.all(),
    ctx.repo.payments.all(),
    ctx.repo.users.all(),
    ctx.repo.products.all(),
  ]);
  const usersById = new Map(users.map((u) => [u.id, u]));
  const productsById = new Map(products.map((p) => [p.id, p]));
  const now = ctx.now();
  const isAdmin = ctx.actor.role === 'admin';
  return all
    .filter((i) => storesById.has(i.storeId))
    .filter((i) => !filter?.open || invoiceBalance(i) > 0)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    .map((i) => ({
      ...i,
      lines: isAdmin ? i.lines : i.lines.map((l) => ({ ...l, cost: 0, lots: [] })),
      qtyTexts: i.lines.map((l) => {
        const p = productsById.get(l.productId);
        return p ? packQtyText(p, l.pack, l.packQty) : String(l.qty);
      }),
      storeName: storesById.get(i.storeId)?.name ?? '—',
      sellerName: i.sellerId ? (usersById.get(i.sellerId)?.name ?? '—') : 'Venta directa',
      balance: invoiceBalance(i),
      overdue: isInvoiceOverdue(i, now),
      bucket: agingBucket(i.issuedAt, now),
      daysOld: daysBetween(i.issuedAt, now),
      payments: payments.filter((p) => p.invoiceId === i.id).sort((a, b) => b.at.localeCompare(a.at)),
    }));
}

export async function getInvoice(ctx: Ctx, invoiceId: string): Promise<InvoiceView> {
  const inv = await ctx.repo.invoices.get(invoiceId);
  if (!inv) throw new NotFoundError('la factura');
  const found = (await listInvoices(ctx, { storeId: inv.storeId })).find((i) => i.id === invoiceId);
  if (!found) throw new NotFoundError('la factura');
  return found;
}

export interface InvoiceDocument {
  invoice: InvoiceView;
  store: Pick<Store, 'name' | 'address' | 'city' | 'managerName' | 'phone' | 'email' | 'taxId' | 'resaleCert'>;
  companyName: string;
  warehouseName: string;
  lines: { name: string; qtyText: string; unitPrice: number; priceText: string; amount: number }[];
  /** «Pagada en efectivo», «A cuenta: vence el 20 nov 2026»… */
  paymentText: string;
  terms: string;
}

/** Lo que va en la factura o recibo en PDF. */
export async function invoiceDocument(ctx: Ctx, invoiceId: string): Promise<InvoiceDocument> {
  const invoice = await getInvoice(ctx, invoiceId);
  const [store, settings, products] = await Promise.all([ctx.repo.stores.get(invoice.storeId), getSettings(ctx), ctx.repo.products.all()]);
  if (!store) throw new NotFoundError('el local');
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = invoice.lines.map((l) => {
    const p = byId.get(l.productId);
    const qtyText = p ? packQtyText(p, l.pack, l.packQty) : `${l.packQty}`;
    const per = l.pack === 'caja' ? 'caja' : p ? unitNames(p.unitName).one : 'unidad';
    return { name: l.name, qtyText, unitPrice: l.unitPrice, priceText: `${fmtMoney(l.unitPrice)} por ${per}`, amount: l.amount };
  });
  const last = invoice.payments[0];
  const paymentText =
    invoice.balance <= 0
      ? `Pagada${last ? `: ${PAYMENT_METHOD_LABEL[last.method].toLowerCase()}` : ''}`
      : invoice.paid > 0
        ? `Pago parcial: quedan ${fmtMoney(invoice.balance)} · vence el ${fmtDate(invoice.dueOn)}`
        : invoice.creditDays > 0
          ? `A cuenta: vence el ${fmtDate(invoice.dueOn)}`
          : 'Por cobrar (de contado)';
  return {
    invoice,
    store: { name: store.name, address: store.address, city: store.city, managerName: store.managerName, phone: store.phone, email: store.email, taxId: store.taxId, resaleCert: store.resaleCert },
    companyName: settings.companyName,
    warehouseName: settings.warehouseName,
    lines,
    paymentText,
    terms: creditText(store),
  };
}
