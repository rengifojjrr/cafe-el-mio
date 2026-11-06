// Contar el almacén: se cuentan algunos productos (escaneando o buscándolos) y al guardar,
// cada diferencia con el libro queda como un ajuste con motivo «Conteo de almacén». Nunca deja
// un lote en negativo: lo que falta sale por lote (lo más viejo primero) y lo que sobra entra al
// lote más nuevo del producto.
import { z } from 'zod';
import type { Lot, Movement } from '../data/types';
import { WAREHOUSE, allocate, lotOrder } from '../domain/ledger';
import { unitsText } from '../domain/products';
import { toIsoDate } from '../lib/time';
import { type Ctx, ValidationError, audit, guard, mutate, nowIso } from './context';
import { loadInventory } from './inventory';

export const COUNT_REASON = 'Conteo de almacén';

export interface CountLine {
  productId: string;
  name: string;
  unitName: string;
  /** Lo que dice el libro (incluye lo apartado para entregas: sigue en el almacén). */
  expected: number;
  counted: number;
  diff: number;
  /** Apartado para entregas preparadas. */
  reserved: number;
}

/** Compara lo contado con el libro. Para la pantalla de revisión. */
export async function reviewCount(ctx: Ctx, counts: readonly { productId: string; counted: number }[]): Promise<CountLine[]> {
  guard(ctx, 'warehouse.count');
  const snap = await loadInventory(ctx);
  return counts.flatMap((c) => {
    const p = snap.productsById.get(c.productId);
    if (!p) return [];
    const expected = snap.balances.qty(WAREHOUSE, p.id);
    return [{ productId: p.id, name: p.name, unitName: p.unitName, expected, counted: c.counted, diff: c.counted - expected, reserved: snap.reserved.get(p.id) ?? 0 }];
  });
}

const countSchema = z.object({
  counts: z
    .array(
      z.object({
        productId: z.string().min(1),
        counted: z.number().int('El conteo es un número entero.').min(0, 'El conteo no puede ser negativo.'),
      }),
    )
    .min(1, 'Cuenta al menos un producto.')
    .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, 'Hay un producto repetido en el conteo.'),
  note: z.string().trim().max(300).default(''),
});

export interface CountResult {
  countId: string;
  lines: CountLine[];
  adjusted: number;
}

/** Guarda el conteo: un ajuste por cada diferencia, con su motivo, y una entrada en la auditoría. */
export async function saveWarehouseCount(ctx: Ctx, input: z.input<typeof countSchema>): Promise<CountResult> {
  guard(ctx, 'warehouse.count');
  const data = countSchema.parse(input);
  return mutate(ctx, async () => {
    const snap = await loadInventory(ctx);
    const at = nowIso(ctx);
    const countId = ctx.newId('cnt');
    const reason = data.note ? `${COUNT_REASON}: ${data.note}` : COUNT_REASON;
    const lines: CountLine[] = [];
    const mv = (m: Omit<Movement, 'id' | 'at' | 'type' | 'storeId' | 'refType' | 'refId' | 'reason' | 'actorId'>): Movement => ({
      ...m,
      id: ctx.newId('mov'),
      at,
      type: 'ajuste',
      storeId: null,
      refType: 'count',
      refId: countId,
      reason,
      actorId: ctx.actor.userId,
    });
    for (const c of data.counts) {
      const p = snap.productsById.get(c.productId);
      if (!p) throw new ValidationError('Uno de los productos del conteo ya no existe.');
      const expected = snap.balances.qty(WAREHOUSE, p.id);
      const diff = c.counted - expected;
      lines.push({ productId: p.id, name: p.name, unitName: p.unitName, expected, counted: c.counted, diff, reserved: snap.reserved.get(p.id) ?? 0 });
      if (diff < 0) {
        for (const part of allocate(snap.balances, snap.lotsById, WAREHOUSE, p.id, -diff, p.name)) {
          const m = mv({ productId: p.id, lotId: part.lotId, qty: part.qty, from: WAREHOUSE, to: { kind: 'adjustment' } });
          await ctx.repo.movements.put(m);
          snap.balances.apply(m);
        }
      } else if (diff > 0) {
        // Lo que sobra entra al lote más nuevo del producto; si nunca tuvo uno, se abre un lote del conteo.
        let lot = snap.lots.filter((l) => l.productId === p.id).sort((a, b) => lotOrder(b).localeCompare(lotOrder(a)))[0];
        if (!lot) {
          lot = { id: ctx.newId('lot'), productId: p.id, code: `CONTEO-${toIsoDate(ctx.now())}`, arrivalId: null, unitCost: p.cost, receivedAt: at } satisfies Lot;
          await ctx.repo.lots.put(lot);
          snap.lots.push(lot);
          snap.lotsById.set(lot.id, lot);
        }
        const m = mv({ productId: p.id, lotId: lot.id, qty: diff, from: { kind: 'adjustment' }, to: WAREHOUSE });
        await ctx.repo.movements.put(m);
        snap.balances.apply(m);
      }
    }
    const changed = lines.filter((l) => l.diff !== 0);
    const detail = changed
      .slice(0, 6)
      .map((l) => `${l.diff > 0 ? '+' : '−'}${unitsText({ unitName: l.unitName }, Math.abs(l.diff))} de ${l.name}`)
      .join(', ');
    await audit(
      ctx,
      'almacen.conteo',
      'count',
      countId,
      `${COUNT_REASON}: ${lines.length} producto${lines.length === 1 ? '' : 's'} contado${lines.length === 1 ? '' : 's'}, ${changed.length ? `${changed.length} con diferencia (${detail}${changed.length > 6 ? '…' : ''})` : 'todo cuadra'}`,
    );
    return { countId, lines, adjusted: changed.length };
  });
}
