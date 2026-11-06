// Recibir una importación bulto por bulto: la lista de empaque (de un Excel o CSV, o escrita a
// mano), el paso «Confirmar bultos» entre «En aduana» y «Recibida», el conteo de cada bulto y
// las diferencias. Al recibir (inventory.receiveArrival) entra lo contado.
import { z } from 'zod';
import type { Arrival, ArrivalStatus, Bale, CaseUnit, Product } from '../data/types';
import { unitsText } from '../domain/products';
import { BALE_STATUS_LABEL, arrivalDifferences, baleStatusFor, groupIntoBales, itemsFromBales, type DiffReport } from '../domain/receiving';
import type { NewPhoto } from '../lib/image';
import { type Ctx, NotFoundError, ValidationError, audit, guard, mutate, nowIso } from './context';

export interface ArrivalDetail {
  arrival: Arrival;
  /** Productos con costo (solo administración). */
  products: Map<string, Product>;
  cases: CaseUnit[];
  /** Nombre del local al que fue cada caja entregada. */
  storeNames: Map<string, string>;
  /** Diferencias de los bultos revisados (si hay lista de empaque). */
  report: DiffReport | null;
}

export async function arrivalDetail(ctx: Ctx, arrivalId: string): Promise<ArrivalDetail> {
  guard(ctx, 'product.readCost');
  const arrival = await ctx.repo.arrivals.get(arrivalId);
  if (!arrival) throw new NotFoundError('la llegada');
  const [products, cases, stores] = await Promise.all([ctx.repo.products.all(), ctx.repo.cases.where('arrivalId', arrival.id), ctx.repo.stores.all()]);
  return {
    arrival,
    products: new Map(products.map((p) => [p.id, p])),
    cases: cases.sort((a, b) => a.code.localeCompare(b.code)),
    storeNames: new Map(stores.map((s) => [s.id, s.name])),
    report: arrival.bales?.length ? arrivalDifferences(arrival.bales) : null,
  };
}

/** Antes de «Confirmar bultos» la lista se puede cambiar. */
export const BEFORE_CONFIRMING: readonly ArrivalStatus[] = ['produccion', 'transito', 'aduana'];

async function importOrThrow(ctx: Ctx, arrivalId: string): Promise<Arrival> {
  const a = await ctx.repo.arrivals.get(arrivalId);
  if (!a) throw new NotFoundError('la importación');
  if (a.kind !== 'import') throw new ValidationError('Los bultos son de las importaciones (no de los tostados).');
  return a;
}

const packingSchema = z.object({
  bales: z
    .array(
      z.object({
        number: z.string().trim().min(1, 'Cada bulto necesita su número.').max(20, 'El número de bulto es muy largo.'),
        items: z
          .array(
            z.object({
              productId: z.string().min(1, 'Elige el producto de cada línea.'),
              qty: z.number().int('Los mazos son números enteros.').positive('Cada línea necesita al menos 1.').max(100_000),
              unitCost: z.number().nonnegative('El costo no puede ser negativo.').optional(),
            }),
          )
          .min(1, 'Cada bulto necesita al menos un producto.'),
      }),
    )
    .min(1, 'Agrega al menos un bulto.')
    .max(2000, 'Son demasiados bultos (máximo 2,000).')
    .refine((bales) => new Set(bales.map((b) => b.number.trim().toUpperCase())).size === bales.length, 'Hay dos bultos con el mismo número.'),
});

export type PackingListInput = z.input<typeof packingSchema>;

/**
 * Guarda la lista de empaque de una importación (reemplaza la que hubiera) y vuelve a calcular
 * lo que trae por producto. No se cambia si ya se empezó a confirmar bultos.
 */
export async function savePackingList(ctx: Ctx, arrivalId: string, input: PackingListInput): Promise<Arrival> {
  guard(ctx, 'arrival.confirm');
  const data = packingSchema.parse(input);
  return mutate(ctx, async () => {
    const a = await importOrThrow(ctx, arrivalId);
    if (a.status === 'recibida' || a.status === 'cancelada') throw new ValidationError(`${a.code} ya está ${a.status === 'recibida' ? 'recibida' : 'cancelada'}.`);
    if (a.status === 'confirmando' && (a.bales ?? []).some((b) => b.status !== 'pendiente')) {
      throw new ValidationError('Ya empezaste a confirmar bultos: la lista de empaque no se cambia a mitad de camino.');
    }
    const products = new Map((await ctx.repo.products.all()).map((p) => [p.id, p]));
    const lines = data.bales.flatMap((b) =>
      b.items.map((it) => {
        const p = products.get(it.productId);
        if (!p) throw new ValidationError('Uno de los productos de la lista ya no existe.');
        return { bale: b.number, productId: p.id, qty: it.qty, unitCost: it.unitCost ?? p.cost };
      }),
    );
    const bales: Bale[] = groupIntoBales(lines).map((b) => ({ id: ctx.newId('bul'), number: b.number, items: b.items, status: 'pendiente' }));
    a.bales = bales;
    a.items = itemsFromBales(bales);
    await ctx.repo.arrivals.put(a);
    const units = a.items.reduce((s, i) => s + i.qty, 0);
    const mixed = bales.filter((b) => b.items.length > 1).length;
    await audit(ctx, 'llegada.lista_empaque', 'arrival', a.id, `Lista de empaque de ${a.code}: ${bales.length} bulto${bales.length === 1 ? '' : 's'}${mixed ? ` (${mixed} mixto${mixed === 1 ? '' : 's'})` : ''}, ${units} en total de ${a.items.length} productos`);
    return a;
  });
}

/** Paso «Confirmar bultos»: la importación ya llegó y se revisa bulto por bulto. */
export async function startBaleCheck(ctx: Ctx, arrivalId: string): Promise<Arrival> {
  guard(ctx, 'arrival.confirm');
  return mutate(ctx, async () => {
    const a = await importOrThrow(ctx, arrivalId);
    if (!a.bales?.length) throw new ValidationError('Para confirmar bultos primero carga la lista de empaque.');
    if (!BEFORE_CONFIRMING.includes(a.status)) throw new ValidationError(`${a.code} ya no está por confirmar.`);
    const at = nowIso(ctx);
    a.status = 'confirmando';
    a.statusHistory.push({ status: 'confirmando', at });
    await ctx.repo.arrivals.put(a);
    await audit(ctx, 'llegada.estado', 'arrival', a.id, `${a.code} pasa a «Confirmando bultos» (${a.bales.length} bultos)`);
    return a;
  });
}

const checkSchema = z.object({
  /** «Bien»: lo contado es lo de la lista. */
  bien: z.boolean().default(false),
  counted: z.record(z.string(), z.number().int('Lo contado es un número entero.').min(0, 'Lo contado no puede ser negativo.').max(100_000)).default({}),
  damaged: z.boolean().default(false),
  note: z.string().trim().max(500, 'La nota es muy larga.').default(''),
  photo: z.custom<NewPhoto>().optional(),
});

export type BaleCheckInput = z.input<typeof checkSchema>;

/**
 * Revisa un bulto: «Bien» de un toque, o lo contado de cada producto (falta o sobra sale solo),
 * o «Dañado» con nota y foto. Se puede volver a revisar mientras la importación no se reciba.
 */
export async function checkBale(ctx: Ctx, arrivalId: string, baleId: string, input: BaleCheckInput): Promise<Bale> {
  guard(ctx, 'arrival.confirm');
  const data = checkSchema.parse(input);
  return mutate(ctx, async () => {
    const a = await importOrThrow(ctx, arrivalId);
    if (a.status !== 'confirmando') throw new ValidationError(`${a.code} no está en «Confirmando bultos».`);
    const bale = a.bales?.find((b) => b.id === baleId);
    if (!bale) throw new NotFoundError('el bulto');
    for (const pid of Object.keys(data.counted)) {
      if (!bale.items.some((i) => i.productId === pid)) throw new ValidationError(`Ese producto no viene en el bulto ${bale.number}. Anótalo en la nota.`);
    }
    const counted = Object.fromEntries(bale.items.map((i) => [i.productId, data.bien ? i.qty : (data.counted[i.productId] ?? i.qty)]));
    const status = data.bien && !data.damaged ? 'bien' : baleStatusFor(bale, counted, data.damaged);
    if (status === 'danado' && !data.note) throw new ValidationError('Escribe qué le pasó al bulto (por ejemplo: mojado, roto, mazos aplastados).');
    const at = nowIso(ctx);
    if (data.photo) {
      const photoId = ctx.newId('pho');
      await ctx.repo.photos.put({ ...data.photo, id: photoId, ownerType: 'bale', ownerId: `${a.id}:${bale.id}`, createdAt: at });
      bale.photoIds = [...(bale.photoIds ?? []), photoId];
    }
    bale.counted = counted;
    bale.status = status;
    bale.note = data.note || undefined;
    bale.checkedAt = at;
    bale.checkedBy = ctx.actor.userId;
    await ctx.repo.arrivals.put(a);
    const products = new Map((await ctx.repo.products.all()).map((p) => [p.id, p]));
    const diffs = bale.items
      .filter((i) => counted[i.productId] !== i.qty)
      .map((i) => {
        const p = products.get(i.productId);
        const d = (counted[i.productId] ?? 0) - i.qty;
        return `${d > 0 ? 'sobra' : 'falta'}${Math.abs(d) === 1 ? '' : 'n'} ${p ? unitsText(p, Math.abs(d)) : Math.abs(d)} de ${p?.name ?? i.productId}`;
      });
    await audit(ctx, 'bulto.revisar', 'arrival', a.id, `Bulto ${bale.number} de ${a.code}: ${BALE_STATUS_LABEL[status]}${diffs.length ? ` (${diffs.join('; ')})` : ''}${bale.note ? ` · ${bale.note}` : ''}`);
    return bale;
  });
}
