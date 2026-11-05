// Reglas de dinero: ganancia del local, comisiones, liquidaciones y antigüedad de lo que se debe.
import { describe, expect, it } from 'vitest';
import type { Commission, SalesReport, Settlement } from '../../src/data/types';
import {
  aging,
  agingBucket,
  commissionAmount,
  commissionPerUnit,
  commissionStatusFor,
  commissionTotals,
  describeRule,
  effectiveRule,
  isOverdue,
  settlementBalance,
  settlementLines,
  settlementStatus,
  storeEarning,
} from '../../src/domain/money-rules';
import { round2, sum } from '../../src/lib/money';

const NOW = new Date('2026-11-05T15:00:00Z');
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();

function settlement(p: Partial<Settlement>): Settlement {
  return {
    id: 'liq',
    code: 'L-0001',
    storeId: 's1',
    sellerId: 'v1',
    periodFrom: daysAgo(30),
    periodTo: daysAgo(15),
    issuedAt: daysAgo(10),
    dueOn: '2026-11-15',
    salesReportIds: [],
    lines: [],
    amount: 100,
    paid: 0,
    status: 'pendiente',
    ...p,
  };
}

describe('redondeo', () => {
  it('round2 y sum no dejan errores de coma flotante', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
    expect(sum([0.1, 0.2, 0.3])).toBe(0.6);
  });
});

describe('ganancia del local', () => {
  it('es PVP sugerido − precio al local', () => {
    expect(storeEarning({ priceToStore: 5.5, suggestedRetail: 9.5 })).toBe(4);
    expect(storeEarning({ priceToStore: 6.66, suggestedRetail: 9.99 })).toBe(3.33);
    expect(storeEarning({ priceToStore: 4.1, suggestedRetail: 5.99 })).toBe(1.89);
  });
  it('nunca es negativa', () => {
    expect(storeEarning({ priceToStore: 10, suggestedRetail: 8 })).toBe(0);
  });
});

describe('comisión del vendedor', () => {
  it('porcentaje del precio al local, redondeado a centavos', () => {
    expect(commissionAmount({ type: 'percent', value: 8 }, 3, 5.5)).toBe(1.32);
    expect(commissionAmount({ type: 'percent', value: 6 }, 7, 4.1)).toBe(1.72);
    expect(commissionAmount({ type: 'percent', value: 10 }, 1, 9)).toBe(0.9);
  });
  it('monto fijo por unidad', () => {
    expect(commissionAmount({ type: 'fixed', value: 0.4 }, 25, 5)).toBe(10);
    expect(commissionAmount({ type: 'fixed', value: 0.35 }, 3, 4.25)).toBe(1.05);
  });
  it('sin unidades no hay comisión', () => {
    expect(commissionAmount({ type: 'percent', value: 8 }, 0, 5.5)).toBe(0);
    expect(commissionAmount({ type: 'fixed', value: 1 }, -2, 5)).toBe(0);
  });
  it('por unidad, para el catálogo del vendedor', () => {
    expect(commissionPerUnit({ type: 'percent', value: 8 }, 5.5)).toBe(0.44);
    expect(commissionPerUnit({ type: 'fixed', value: 4 }, 96)).toBe(4);
  });
  it('la comisión especial del vendedor gana sobre la del producto', () => {
    const product = { sellerCommission: { type: 'percent' as const, value: 8 } };
    expect(effectiveRule(product, { commissionOverride: { type: 'fixed', value: 0.5 } })).toEqual({ type: 'fixed', value: 0.5 });
    expect(effectiveRule(product, { commissionOverride: undefined })).toEqual({ type: 'percent', value: 8 });
    expect(effectiveRule(product)).toEqual({ type: 'percent', value: 8 });
  });
  it('describe la regla en palabras', () => {
    expect(describeRule({ type: 'percent', value: 8 })).toContain('8');
    expect(describeRule({ type: 'percent', value: 8 })).toContain('precio al local');
    expect(describeRule({ type: 'fixed', value: 0.4 })).toContain('por unidad');
  });
});

describe('liquidación', () => {
  const report = (id: string, lines: SalesReport['lines']): SalesReport => ({
    id,
    storeId: 's1',
    sellerId: 'v1',
    at: daysAgo(5),
    source: 'conteo',
    lines,
    total: round2(lines.reduce((a, l) => a + l.qty * l.unitPrice, 0)),
    settlementId: null,
    createdBy: 'v1',
  });
  const line = (productId: string, qty: number, unitPrice: number) => ({ productId, qty, unitPrice, cost: 0, lots: [] });

  it('agrupa por producto y precio, y ordena por monto', () => {
    const lines = settlementLines([
      report('r1', [line('a', 2, 5.5), line('b', 1, 7.25)]),
      report('r2', [line('a', 3, 5.5), line('a', 1, 6)]),
    ]);
    expect(lines).toEqual([
      { productId: 'a', qty: 5, unitPrice: 5.5, amount: 27.5 },
      { productId: 'b', qty: 1, unitPrice: 7.25, amount: 7.25 },
      { productId: 'a', qty: 1, unitPrice: 6, amount: 6 },
    ]);
    expect(sum(lines.map((l) => l.amount))).toBe(40.75);
  });

  it('el monto queda en centavos exactos', () => {
    const lines = settlementLines([report('r1', [line('c', 3, 0.1), line('c', 7, 0.1)])]);
    expect(lines[0]!.amount).toBe(1);
  });

  it('estado según lo pagado', () => {
    expect(settlementStatus(100, 0)).toBe('pendiente');
    expect(settlementStatus(100, 40)).toBe('parcial');
    expect(settlementStatus(100, 100)).toBe('pagada');
    expect(settlementStatus(100, 100.004)).toBe('pagada');
    expect(settlementStatus(100, 99.99)).toBe('parcial');
  });

  it('saldo nunca negativo', () => {
    expect(settlementBalance({ amount: 100, paid: 40 })).toBe(60);
    expect(settlementBalance({ amount: 100, paid: 120 })).toBe(0);
  });
});

describe('antigüedad de lo que se debe', () => {
  it('cuenta los días desde la liquidación: 0–15, 16–30, más de 30', () => {
    expect(agingBucket(daysAgo(0), NOW)).toBe('0-15');
    expect(agingBucket(daysAgo(15), NOW)).toBe('0-15');
    expect(agingBucket(daysAgo(16), NOW)).toBe('16-30');
    expect(agingBucket(daysAgo(30), NOW)).toBe('16-30');
    expect(agingBucket(daysAgo(31), NOW)).toBe('30+');
    expect(agingBucket(daysAgo(90), NOW)).toBe('30+');
  });

  it('vencida: saldo pendiente y ya pasó la fecha de pago', () => {
    expect(isOverdue({ amount: 100, paid: 0, dueOn: '2026-11-04' }, NOW)).toBe(true);
    expect(isOverdue({ amount: 100, paid: 0, dueOn: '2026-11-05' }, NOW)).toBe(false);
    expect(isOverdue({ amount: 100, paid: 0, dueOn: '2026-11-20' }, NOW)).toBe(false);
    expect(isOverdue({ amount: 100, paid: 100, dueOn: '2026-10-01' }, NOW)).toBe(false);
  });

  it('suma saldos por tramo y deja fuera lo pagado', () => {
    const totals = aging(
      [
        settlement({ id: 'a', issuedAt: daysAgo(3), amount: 50, paid: 10 }),
        settlement({ id: 'b', issuedAt: daysAgo(20), amount: 80, paid: 0 }),
        settlement({ id: 'c', issuedAt: daysAgo(45), amount: 30.5, paid: 0 }),
        settlement({ id: 'd', issuedAt: daysAgo(45), amount: 70, paid: 70, status: 'pagada' }),
        settlement({ id: 'e', issuedAt: daysAgo(40), amount: 19.25, paid: 0 }),
      ],
      NOW,
    );
    expect(totals['0-15']).toEqual({ amount: 40, count: 1 });
    expect(totals['16-30']).toEqual({ amount: 80, count: 1 });
    expect(totals['30+']).toEqual({ amount: 49.75, count: 2 });
  });
});

describe('estado de las comisiones', () => {
  const settlements = new Map<string, Pick<Settlement, 'status'>>([
    ['pagada', { status: 'pagada' }],
    ['parcial', { status: 'parcial' }],
    ['pendiente', { status: 'pendiente' }],
  ]);

  it("regla 'venta': pagable apenas se reporta la venta", () => {
    expect(commissionStatusFor({ status: 'devengada', settlementId: null }, 'venta', settlements)).toBe('pagable');
    expect(commissionStatusFor({ status: 'devengada', settlementId: 'pendiente' }, 'venta', settlements)).toBe('pagable');
  });

  it("regla 'cobro': pagable solo cuando el local pagó por completo la liquidación", () => {
    expect(commissionStatusFor({ status: 'devengada', settlementId: null }, 'cobro', settlements)).toBe('devengada');
    expect(commissionStatusFor({ status: 'devengada', settlementId: 'pendiente' }, 'cobro', settlements)).toBe('devengada');
    expect(commissionStatusFor({ status: 'devengada', settlementId: 'parcial' }, 'cobro', settlements)).toBe('devengada');
    expect(commissionStatusFor({ status: 'devengada', settlementId: 'pagada' }, 'cobro', settlements)).toBe('pagable');
  });

  it('una comisión pagada sigue pagada', () => {
    expect(commissionStatusFor({ status: 'pagada', settlementId: null }, 'cobro', settlements)).toBe('pagada');
    expect(commissionStatusFor({ status: 'pagada', settlementId: 'pendiente' }, 'venta', settlements)).toBe('pagada');
  });

  it('totales por estado', () => {
    const c = (status: Commission['status'], amount: number): Commission => ({
      id: `${status}${amount}`,
      sellerId: 'v1',
      storeId: 's1',
      productId: 'p',
      salesReportId: 'r',
      settlementId: null,
      qty: 1,
      base: 10,
      amount,
      rule: { type: 'percent', value: 8 },
      status,
      accruedAt: daysAgo(1),
    });
    expect(commissionTotals([c('devengada', 1.1), c('devengada', 2.2), c('pagable', 0.35), c('pagada', 4)])).toEqual({
      devengada: 3.3,
      pagable: 0.35,
      pagada: 4,
      total: 7.65,
    });
  });
});
