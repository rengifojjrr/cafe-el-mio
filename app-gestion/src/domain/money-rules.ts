// Reglas de dinero: comisiones, liquidaciones y antigüedad de lo que se debe.
// Funciones puras: las usan los servicios y la semilla, y las prueba Vitest.
import type {
  Commission,
  CommissionRule,
  IsoDate,
  IsoDateTime,
  Product,
  SalesReport,
  Settlement,
  SettlementStatus,
  User,
} from '../data/types';
import { round2 } from '../lib/money';
import { daysBetween } from '../lib/time';

/** La ganancia del local por unidad: PVP sugerido − precio al local (nunca negativa). */
export function storeEarning(p: Pick<Product, 'priceToStore' | 'suggestedRetail'>): number {
  return Math.max(0, round2(p.suggestedRetail - p.priceToStore));
}

/** Regla de comisión que aplica: la especial del vendedor si la tiene; si no, la del producto. */
export function effectiveRule(product: Pick<Product, 'sellerCommission'>, seller?: Pick<User, 'commissionOverride'>): CommissionRule {
  return seller?.commissionOverride ?? product.sellerCommission;
}

/** Comisión del vendedor por una venta: % del precio al local, o fija por unidad. */
export function commissionAmount(rule: CommissionRule, qty: number, unitPrice: number): number {
  if (qty <= 0) return 0;
  if (rule.type === 'percent') return round2((qty * unitPrice * rule.value) / 100);
  return round2(qty * rule.value);
}

export function describeRule(rule: CommissionRule): string {
  return rule.type === 'percent'
    ? `${rule.value.toLocaleString('es-US')} % del precio al local`
    : `${rule.value.toLocaleString('es-US', { style: 'currency', currency: 'USD' })} por unidad`;
}

/** Comisión por unidad, para mostrarla en el catálogo del vendedor. */
export function commissionPerUnit(rule: CommissionRule, priceToStore: number): number {
  return commissionAmount(rule, 1, priceToStore);
}

/** Agrupa las ventas de varios reportes en líneas de liquidación (producto × precio). */
export function settlementLines(reports: readonly SalesReport[]): Settlement['lines'] {
  const map = new Map<string, { productId: string; qty: number; unitPrice: number; amount: number }>();
  for (const r of reports) {
    for (const l of r.lines) {
      const key = `${l.productId}|${l.unitPrice}`;
      const cur = map.get(key) ?? { productId: l.productId, qty: 0, unitPrice: l.unitPrice, amount: 0 };
      cur.qty += l.qty;
      cur.amount = round2(cur.amount + l.qty * l.unitPrice);
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export function settlementStatus(amount: number, paid: number): SettlementStatus {
  if (paid <= 0) return 'pendiente';
  if (round2(amount - paid) <= 0) return 'pagada';
  return 'parcial';
}

export function settlementBalance(s: Pick<Settlement, 'amount' | 'paid'>): number {
  return Math.max(0, round2(s.amount - s.paid));
}

export type AgingBucket = '0-15' | '16-30' | '30+';
export const AGING_LABEL: Record<AgingBucket, string> = {
  '0-15': '0 a 15 días',
  '16-30': '16 a 30 días',
  '30+': 'Más de 30 días',
};

/** Antigüedad de lo que se debe, contada desde la fecha de la liquidación. */
export function agingBucket(issuedAt: IsoDateTime, now: Date): AgingBucket {
  const days = daysBetween(issuedAt, now);
  if (days <= 15) return '0-15';
  if (days <= 30) return '16-30';
  return '30+';
}

export function isOverdue(s: Pick<Settlement, 'amount' | 'paid' | 'dueOn'>, now: Date): boolean {
  return settlementBalance(s) > 0 && daysBetween(s.dueOn as IsoDate, now) > 0;
}

export function aging(
  settlements: readonly Pick<Settlement, 'amount' | 'paid' | 'issuedAt'>[],
  now: Date,
): Record<AgingBucket, { amount: number; count: number }> {
  const out: Record<AgingBucket, { amount: number; count: number }> = {
    '0-15': { amount: 0, count: 0 },
    '16-30': { amount: 0, count: 0 },
    '30+': { amount: 0, count: 0 },
  };
  for (const s of settlements) {
    const bal = settlementBalance(s);
    if (bal <= 0) continue;
    const b = out[agingBucket(s.issuedAt, now)];
    b.amount = round2(b.amount + bal);
    b.count += 1;
  }
  return out;
}

/**
 * Estado de una comisión según la regla de la línea:
 * - 'venta': se puede pagar en cuanto se reporta la venta;
 * - 'cobro': se puede pagar cuando el local pagó por completo la liquidación que la incluye.
 */
export function commissionStatusFor(
  c: Pick<Commission, 'status' | 'settlementId'>,
  payableOn: 'venta' | 'cobro',
  settlementsById: ReadonlyMap<string, Pick<Settlement, 'status'>>,
): Commission['status'] {
  if (c.status === 'pagada') return 'pagada';
  if (payableOn === 'venta') return 'pagable';
  if (!c.settlementId) return 'devengada';
  return settlementsById.get(c.settlementId)?.status === 'pagada' ? 'pagable' : 'devengada';
}

export function commissionTotals(list: readonly Commission[]): Record<Commission['status'], number> & { total: number } {
  const out = { devengada: 0, pagable: 0, pagada: 0, total: 0 };
  for (const c of list) {
    out[c.status] = round2(out[c.status] + c.amount);
    out.total = round2(out.total + c.amount);
  }
  return out;
}
