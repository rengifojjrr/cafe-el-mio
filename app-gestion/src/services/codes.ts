// Buscar por código: un código de barras o SKU (producto), el número propio de una caja
// (trazabilidad) y, para administración, el código de una entrega, una factura o una importación.
// Los códigos se comparan limpios (sin espacios ni guiones, en mayúsculas): el lector y quien
// escribe a mano pueden traerlos con o sin guiones.
import type { Arrival, CaseUnit, Delivery, Invoice, Product } from '../data/types';
import { can } from '../domain/permissions';
import { cleanCode, isValidEan13 } from '../lib/barcode';
import { type ProductView, type PublicProduct, getProduct, toPublicProduct } from './catalog';
import { type Ctx, NotFoundError, ValidationError, audit, guard, mutate, nowIso } from './context';

export type CodeMatch =
  | { kind: 'product'; code: string; product: Product | PublicProduct; by: 'barcode' | 'sku' }
  | { kind: 'case'; code: string; caseUnit: CaseUnit; product?: Product | PublicProduct }
  | { kind: 'delivery'; code: string; delivery: Delivery }
  | { kind: 'invoice'; code: string; invoice: Invoice }
  | { kind: 'arrival'; code: string; arrival: Arrival }
  | { kind: 'none'; code: string };

/** Mismo código aunque uno traiga guiones o espacios y el otro no. */
export function sameCode(a: string | undefined, b: string): boolean {
  return Boolean(a) && cleanCode(a!) === b;
}

/** El producto que tiene este código (de barras o SKU), si hay. */
export function productForCode(products: readonly Product[], code: string): { product: Product; by: 'barcode' | 'sku' } | undefined {
  const byBarcode = products.find((p) => sameCode(p.barcode, code));
  if (byBarcode) return { product: byBarcode, by: 'barcode' };
  const bySku = products.find((p) => sameCode(p.sku, code));
  return bySku ? { product: bySku, by: 'sku' } : undefined;
}

async function caseForCode(ctx: Ctx, code: string): Promise<CaseUnit | undefined> {
  const exact = await ctx.repo.cases.where('code', code);
  if (exact[0]) return exact[0];
  return (await ctx.repo.cases.all()).find((c) => sameCode(c.code, code));
}

/**
 * Busca un código. Los demás roles reciben el producto sin costo, y de una caja solo su
 * producto y de dónde viene (no a qué local fue). Entregas, facturas e importaciones: solo
 * administración.
 */
export async function findByCode(ctx: Ctx, raw: string): Promise<CodeMatch> {
  guard(ctx, 'product.read');
  const code = cleanCode(raw);
  if (!code) return { kind: 'none', code };
  const showCost = can(ctx.actor, 'product.readCost', ctx.line);
  const trace = can(ctx.actor, 'case.read', ctx.line);
  const view = (p: Product) => (showCost ? p : toPublicProduct(p));
  const all = await ctx.repo.products.all();
  const visible = showCost ? all : all.filter((p) => p.active);
  const found = productForCode(visible, code);
  if (found) return { kind: 'product', code, product: view(found.product), by: found.by };
  const caseUnit = await caseForCode(ctx, code);
  if (caseUnit) {
    const p = await ctx.repo.products.get(caseUnit.productId);
    const unit: CaseUnit = trace ? caseUnit : { ...caseUnit, deliveryId: undefined, invoiceId: undefined, storeId: undefined };
    return { kind: 'case', code, caseUnit: unit, product: p ? view(p) : undefined };
  }
  if (trace) {
    const delivery = (await ctx.repo.deliveries.all()).find((d) => sameCode(d.code, code));
    if (delivery) return { kind: 'delivery', code, delivery };
    const invoice = (await ctx.repo.invoices.all()).find((i) => sameCode(i.code, code));
    if (invoice) return { kind: 'invoice', code, invoice };
    const arrival = (await ctx.repo.arrivals.all()).find((a) => sameCode(a.code, code));
    if (arrival) return { kind: 'arrival', code, arrival };
  }
  return { kind: 'none', code };
}

// ---------- Trazabilidad de una caja ----------

export interface CaseTrace {
  caseUnit: CaseUnit;
  product?: Product;
  arrival?: Arrival;
  delivery?: Delivery;
  storeName?: string;
  invoice?: Invoice;
}

/** De qué importación y bulto viene una caja, quién la torció y empacó, y a dónde fue. */
export async function traceCase(ctx: Ctx, caseId: string): Promise<CaseTrace> {
  guard(ctx, 'case.read');
  const caseUnit = await ctx.repo.cases.get(caseId);
  if (!caseUnit) throw new NotFoundError('la caja');
  const [product, arrival, delivery, invoice] = await Promise.all([
    ctx.repo.products.get(caseUnit.productId),
    caseUnit.arrivalId ? ctx.repo.arrivals.get(caseUnit.arrivalId) : Promise.resolve(undefined),
    caseUnit.deliveryId ? ctx.repo.deliveries.get(caseUnit.deliveryId) : Promise.resolve(undefined),
    caseUnit.invoiceId ? ctx.repo.invoices.get(caseUnit.invoiceId) : Promise.resolve(undefined),
  ]);
  const storeId = caseUnit.storeId ?? delivery?.storeId ?? invoice?.storeId;
  const store = storeId ? await ctx.repo.stores.get(storeId) : undefined;
  return { caseUnit, product, arrival, delivery, storeName: store?.name, invoice };
}

// ---------- «Buscar código» (administración) ----------

export interface DeliveryLookup {
  delivery: Delivery;
  storeName: string;
  sellerName: string;
  items: { productId: string; name: string; unitName: string; qty: number; preparedQty?: number }[];
  cases: CaseUnit[];
}

export type CodeLookup =
  | { kind: 'product'; code: string; by: 'barcode' | 'sku'; view: ProductView }
  | { kind: 'case'; code: string; trace: CaseTrace }
  | { kind: 'delivery'; code: string; info: DeliveryLookup }
  | { kind: 'invoice'; code: string; invoice: Invoice; storeName: string }
  | { kind: 'arrival'; code: string; arrival: Arrival }
  | { kind: 'none'; code: string };

/** Todo lo que se sabe de un código, para la pantalla «Buscar código». */
export async function lookupCode(ctx: Ctx, raw: string): Promise<CodeLookup> {
  guard(ctx, 'case.read');
  const m = await findByCode(ctx, raw);
  switch (m.kind) {
    case 'product':
      return { kind: 'product', code: m.code, by: m.by, view: await getProduct(ctx, m.product.id) };
    case 'case':
      return { kind: 'case', code: m.code, trace: await traceCase(ctx, m.caseUnit.id) };
    case 'delivery': {
      const d = m.delivery;
      const [store, seller, products, cases] = await Promise.all([
        ctx.repo.stores.get(d.storeId),
        ctx.repo.users.get(d.sellerId),
        ctx.repo.products.all(),
        ctx.repo.cases.where('deliveryId', d.id),
      ]);
      const byId = new Map(products.map((p) => [p.id, p]));
      return {
        kind: 'delivery',
        code: m.code,
        info: {
          delivery: d,
          storeName: store?.name ?? '—',
          sellerName: seller?.name ?? '—',
          items: d.items.map((i) => ({ productId: i.productId, name: byId.get(i.productId)?.name ?? i.productId, unitName: byId.get(i.productId)?.unitName ?? 'unidad', qty: i.qty, preparedQty: i.preparedQty })),
          cases,
        },
      };
    }
    case 'invoice': {
      const store = await ctx.repo.stores.get(m.invoice.storeId);
      return { kind: 'invoice', code: m.code, invoice: m.invoice, storeName: store?.name ?? '—' };
    }
    case 'arrival':
      return { kind: 'arrival', code: m.code, arrival: m.arrival };
    case 'none':
      return m;
  }
}

// ---------- Asignar un código a un producto ----------

/**
 * Guarda el código de barras de un producto (por ejemplo, el que trae la caja de fábrica).
 * Un código es de un solo producto: no puede repetir el código ni el SKU de otro, ni el
 * número de una caja.
 */
export async function assignBarcode(ctx: Ctx, productId: string, raw: string): Promise<Product> {
  guard(ctx, 'code.assign');
  const code = cleanCode(raw);
  if (!/^[0-9A-Z]{3,32}$/.test(code)) throw new ValidationError('El código tiene que tener de 3 a 32 letras o números.');
  if (/^\d{13}$/.test(code) && !isValidEan13(code)) {
    throw new ValidationError('Ese código de 13 dígitos no es un EAN-13 válido: el último dígito no cuadra. Revisa que esté bien escrito.');
  }
  return mutate(ctx, async () => {
    const all = await ctx.repo.products.all();
    const p = all.find((x) => x.id === productId);
    if (!p) throw new NotFoundError('el producto');
    const other = all.find((x) => x.id !== p.id && (sameCode(x.barcode, code) || sameCode(x.sku, code)));
    if (other) throw new ValidationError(`El código ${code} ya es de ${other.name}.`);
    if (await caseForCode(ctx, code)) throw new ValidationError(`${code} es el número de una caja, no puede ser el código de un producto.`);
    const prev = p.barcode;
    const updated: Product = { ...p, barcode: code, updatedAt: nowIso(ctx) };
    await ctx.repo.products.put(updated);
    await audit(ctx, 'producto.codigo', 'product', p.id, `${p.name}: código ${code}${prev && prev !== code ? ` (antes ${prev})` : ''}`);
    return updated;
  });
}
