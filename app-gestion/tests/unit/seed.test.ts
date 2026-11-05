import { describe, expect, it } from 'vitest';
import type { Arrival, Delivery, Lot, Movement, Product, Reorder, Settlement, Store } from '../../src/data/types';
import { isCubanOrigin, permitState } from '../../src/domain/compliance';
import { Balances, WAREHOUSE, findNegative, storeLoc } from '../../src/domain/ledger';
import { isOverdue } from '../../src/domain/money-rules';
import { buildLine } from '../../src/seed';

const NOW = new Date('2026-11-05T15:00:00Z');
const tabaco = buildLine('tabaco', NOW);
const cafe = buildLine('cafe', NOW);

describe('semilla de ejemplo', () => {
  for (const [line, t] of [
    ['tabaco', tabaco],
    ['cafe', cafe],
  ] as const) {
    it(`${line}: tres meses de historia y ningún saldo negativo en ningún momento`, () => {
      const movements = t.movements as Movement[];
      expect(movements.length).toBeGreaterThan(500);
      expect(findNegative(movements)).toBeNull();
      const first = movements.map((m) => m.at).sort()[0]!;
      expect(new Date(first).getTime()).toBeLessThan(NOW.getTime() - 85 * 86_400_000);
      for (const m of movements) expect(new Date(m.at).getTime()).toBeLessThanOrEqual(NOW.getTime());
    });

    it(`${line}: casos para enseñar`, () => {
      const stores = t.stores as Store[];
      const settlements = t.settlements as Settlement[];
      const reorders = t.reorders as Reorder[];
      const deliveries = t.deliveries as Delivery[];
      expect(stores.some((s) => s.status === 'contrato_enviado')).toBe(true);
      expect(reorders.filter((r) => r.status === 'enviado' || r.status === 'confirmado')).toHaveLength(2);
      expect(deliveries.filter((d) => d.status === 'solicitada')).toHaveLength(1);
      expect(settlements.some((s) => isOverdue(s, NOW))).toBe(true);
      expect((t.arrivals as Arrival[]).some((a) => a.status !== 'recibida')).toBe(true);
      const products = t.products as Product[];
      const b = Balances.from(t.movements as Movement[]);
      const low = products.filter((p) => b.qty(WAREHOUSE, p.id) <= p.lowStockThreshold);
      expect(low.length).toBeGreaterThan(0);
      expect((t.threads as unknown[]).length).toBeGreaterThan(1);
    });
  }

  it('tabaco: 12 productos, 4 vendedores, 18 locales, un permiso vencido y nada de Cuba', () => {
    const products = tabaco.products as Product[];
    expect(products).toHaveLength(12);
    for (const p of products) expect(isCubanOrigin(String(p.attrs.originCountry))).toBe(false);
    const stores = tabaco.stores as Store[];
    expect(stores).toHaveLength(18);
    expect((tabaco.users as { role: string }[]).filter((u) => u.role === 'seller')).toHaveLength(4);
    expect(stores.filter((s) => s.status === 'activo' && permitState(s, NOW) === 'vencido')).toHaveLength(1);
  });

  it('café: 9 productos de El Mío, 3 vendedores, 15 locales y café por vencer en un local', () => {
    expect(cafe.products as Product[]).toHaveLength(9);
    expect(cafe.stores as Store[]).toHaveLength(15);
    expect((cafe.users as { role: string }[]).filter((u) => u.role === 'seller')).toHaveLength(3);
    const b = Balances.from(cafe.movements as Movement[]);
    const lots = new Map((cafe.lots as Lot[]).map((l) => [l.id, l]));
    const soon = new Date(NOW.getTime() + 21 * 86_400_000).toISOString().slice(0, 10);
    const expiringInStore = (cafe.stores as Store[]).some((s) =>
      (cafe.products as Product[]).some((p) => b.lots(storeLoc(s.id), p.id).some((l) => (lots.get(l.lotId)?.bestBefore ?? '9999') <= soon)),
    );
    expect(expiringInStore).toBe(true);
  });

  it('es determinista: la misma fecha da los mismos datos', () => {
    const again = buildLine('tabaco', NOW);
    expect((again.movements as Movement[]).length).toBe((tabaco.movements as Movement[]).length);
    expect(JSON.stringify(again.settlements)).toBe(JSON.stringify(tabaco.settlements));
  });
});
