// Trazabilidad por caja (opcional): al recibir una importación se registran cajas con su número
// propio, el bulto, la fábrica, quién la torció y quién la empacó. Al preparar una entrega, las
// cajas que se escanean quedan ligadas a la entrega y al local (la factura la pone la venta en firme).
import { z } from 'zod';
import type { CaseUnit, Delivery } from '../data/types';
import { cleanCode } from '../lib/barcode';
import { sameCode } from './codes';
import { type Ctx, NotFoundError, ValidationError, audit, guard, mutate, nowIso } from './context';

export async function listCases(ctx: Ctx, filter?: { arrivalId?: string; productId?: string; deliveryId?: string }): Promise<CaseUnit[]> {
  guard(ctx, 'case.read');
  let list: CaseUnit[];
  if (filter?.arrivalId) list = await ctx.repo.cases.where('arrivalId', filter.arrivalId);
  else if (filter?.deliveryId) list = await ctx.repo.cases.where('deliveryId', filter.deliveryId);
  else list = await ctx.repo.cases.all();
  if (filter?.productId) list = list.filter((c) => c.productId === filter.productId);
  return list.sort((a, b) => a.code.localeCompare(b.code));
}

/** Número de caja automático: «C-IMP-2026-004-0001». */
export function caseCode(arrivalCode: string, seq: number): string {
  return `C-${arrivalCode}-${String(seq).padStart(4, '0')}`;
}

const registerSchema = z
  .object({
    arrivalId: z.string().min(1),
    productId: z.string().min(1, 'Elige el producto.'),
    baleNumber: z.string().trim().max(20).optional(),
    /** Cuántas cajas con número automático… */
    count: z.number().int().min(0).max(500, 'Son demasiadas cajas de una vez (máximo 500).').default(0),
    /** …o los números leídos de sus etiquetas. */
    codes: z.array(z.string()).max(500).default([]),
    factory: z.string().trim().min(2, 'Escribe la fábrica.').max(80),
    roller: z.string().trim().max(60).default(''),
    packer: z.string().trim().max(60).default(''),
    packedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha de empaque no es válida.')
      .optional(),
  })
  .refine((v) => v.count > 0 || v.codes.length > 0, 'Escribe cuántas cajas o escanea sus etiquetas.');

export type RegisterCasesInput = z.input<typeof registerSchema>;

/** Registra cajas de una importación (con número automático o el de su etiqueta). */
export async function registerCases(ctx: Ctx, input: RegisterCasesInput): Promise<CaseUnit[]> {
  guard(ctx, 'case.write');
  const data = registerSchema.parse(input);
  return mutate(ctx, async () => {
    const arrival = await ctx.repo.arrivals.get(data.arrivalId);
    if (!arrival) throw new NotFoundError('la importación');
    if (arrival.status === 'cancelada') throw new ValidationError('Esa importación está cancelada.');
    const product = await ctx.repo.products.get(data.productId);
    if (!product) throw new NotFoundError('el producto');
    const inArrival = arrival.items.some((i) => i.productId === product.id) || (arrival.bales ?? []).some((b) => b.items.some((i) => i.productId === product.id));
    if (!inArrival) throw new ValidationError(`${product.name} no viene en ${arrival.code}.`);
    if (data.baleNumber && arrival.bales?.length && !arrival.bales.some((b) => b.number === data.baleNumber)) {
      throw new ValidationError(`${arrival.code} no tiene un bulto ${data.baleNumber}.`);
    }
    const [allCases, products] = await Promise.all([ctx.repo.cases.all(), ctx.repo.products.all()]);
    const used = new Set<string>();
    const taken = (clean: string) => used.has(clean) || allCases.some((c) => sameCode(c.code, clean)) || products.some((p) => sameCode(p.barcode, clean) || sameCode(p.sku, clean));
    const codes: string[] = [];
    for (const raw of data.codes) {
      const code = cleanCode(raw);
      if (!/^[0-9A-Z]{3,40}$/.test(code)) throw new ValidationError(`«${raw}» no parece el número de una caja.`);
      if (taken(code)) throw new ValidationError(`El número ${code} ya está registrado.`);
      used.add(code);
      codes.push(code);
    }
    let seq = allCases.filter((c) => c.arrivalId === arrival.id).length;
    for (let i = 0; i < data.count; i++) {
      let code: string;
      do {
        seq += 1;
        code = caseCode(arrival.code, seq);
      } while (taken(cleanCode(code)));
      used.add(cleanCode(code));
      codes.push(code);
    }
    const at = nowIso(ctx);
    const created: CaseUnit[] = codes.map((code) => ({
      id: ctx.newId('caj'),
      code,
      productId: product.id,
      arrivalId: arrival.id,
      baleNumber: data.baleNumber || undefined,
      factory: data.factory,
      roller: data.roller,
      packer: data.packer,
      packedOn: data.packedOn,
      createdAt: at,
    }));
    await ctx.repo.cases.bulkPut(created);
    await audit(
      ctx,
      'caja.registrar',
      'arrival',
      arrival.id,
      `${created.length} caja${created.length === 1 ? '' : 's'} de ${product.name} en ${arrival.code}${data.baleNumber ? ` (bulto ${data.baleNumber})` : ''}: ${created[0]!.code}${created.length > 1 ? ` a ${created.at(-1)!.code}` : ''}`,
    );
    return created;
  });
}

/**
 * Liga cajas a una entrega que se está preparando. Escribe dentro de la transacción de quien
 * llama. Cada caja tiene que ser de un producto de la entrega, no haber salido en otra, y no
 * pueden ser más cajas de las que entran en lo preparado.
 */
export async function attachCases(ctx: Ctx, delivery: Delivery, caseIds: readonly string[], packSizeOf: (productId: string) => number): Promise<CaseUnit[]> {
  guard(ctx, 'case.write');
  const unique = [...new Set(caseIds)];
  const out: CaseUnit[] = [];
  const perProduct = new Map<string, number>();
  for (const id of unique) {
    const c = await ctx.repo.cases.get(id);
    if (!c) throw new NotFoundError('una de las cajas');
    const item = delivery.items.find((i) => i.productId === c.productId);
    if (!item) throw new ValidationError(`La caja ${c.code} es de un producto que no va en ${delivery.code}.`);
    if (c.deliveryId && c.deliveryId !== delivery.id) throw new ValidationError(`La caja ${c.code} ya salió en otra entrega.`);
    const n = (perProduct.get(c.productId) ?? 0) + 1;
    perProduct.set(c.productId, n);
    if (n * packSizeOf(c.productId) > (item.preparedQty ?? 0)) {
      throw new ValidationError(`Hay más cajas escaneadas de las que entran en lo preparado (${c.code}).`);
    }
    const updated: CaseUnit = { ...c, deliveryId: delivery.id, storeId: delivery.storeId };
    await ctx.repo.cases.put(updated);
    out.push(updated);
  }
  if (out.length) {
    await audit(ctx, 'caja.entrega', 'delivery', delivery.id, `${out.length} caja${out.length === 1 ? '' : 's'} en ${delivery.code}: ${out.map((c) => c.code).join(', ')}`);
  }
  return out;
}

/** Suelta las cajas de una entrega rechazada (vuelven a estar en el almacén). Dentro de la transacción de quien llama. */
export async function detachCases(ctx: Ctx, deliveryId: string): Promise<number> {
  const list = await ctx.repo.cases.where('deliveryId', deliveryId);
  for (const c of list) {
    const { deliveryId: _d, storeId: _s, ...rest } = c;
    await ctx.repo.cases.put(rest);
  }
  return list.length;
}
