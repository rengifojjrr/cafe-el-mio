// Venta en firme: cuentas de la factura (subtotal, impuesto, total, saldo y vencimiento) y las
// comisiones que genera. Funciones puras: las usan los servicios y la semilla.
import type { Commission, CommissionRule, Invoice, InvoiceLine, IsoDate, LineSettings, Product, Store, User } from '../data/types';
import { round2 } from '../lib/money';
import { addDaysToDate, daysBetween } from '../lib/time';
import { effectiveRule, settlementStatus } from './money-rules';

/** ¿El local tiene certificado de reventa vigente hoy? */
export function hasValidResaleCert(store: Pick<Store, 'resaleCert'>, now: Date): boolean {
  const c = store.resaleCert;
  if (!c || !c.number.trim() || !c.expiresOn) return false;
  return daysBetween(now, c.expiresOn as IsoDate) >= 0;
}

/**
 * Subtotal, impuesto y total. El impuesto de venta solo se calcula si Ajustes tiene un % y el
 * local no tiene certificado de reventa vigente: lo que se compra para revender no lo paga.
 */
export function invoiceTotals(
  lines: readonly Pick<InvoiceLine, 'amount'>[],
  salesTaxPercent: number | undefined,
  withoutResaleCert: boolean,
): { subtotal: number; taxPercent: number; tax: number; total: number } {
  const subtotal = round2(lines.reduce((a, l) => a + l.amount, 0));
  const pct = salesTaxPercent && salesTaxPercent > 0 && withoutResaleCert ? salesTaxPercent : 0;
  const tax = round2((subtotal * pct) / 100);
  return { subtotal, taxPercent: pct, tax, total: round2(subtotal + tax) };
}

export function invoiceBalance(inv: Pick<Invoice, 'total' | 'paid'>): number {
  return Math.max(0, round2(inv.total - inv.paid));
}

export function invoiceStatus(total: number, paid: number): Invoice['status'] {
  return settlementStatus(total, paid);
}

/** Vencida: queda saldo y ya pasó el día de pago. */
export function isInvoiceOverdue(inv: Pick<Invoice, 'total' | 'paid' | 'dueOn'>, now: Date): boolean {
  return invoiceBalance(inv) > 0 && daysBetween(inv.dueOn as IsoDate, now) > 0;
}

/** Vence el día de la entrega más los días de crédito del local (0 = de contado). */
export function invoiceDueOn(issuedOn: IsoDate, creditDays: number): IsoDate {
  return addDaysToDate(issuedOn, Math.max(0, Math.round(creditDays)));
}

/**
 * Días de crédito de una venta en firme: los del local si compra en firme (0 = de contado); a un
 * local en consignación que compra en el almacén «a cuenta», el plazo de pago de la línea.
 */
export function creditDaysFor(store: Pick<Store, 'saleMode' | 'creditDays'>, settings: Pick<LineSettings, 'paymentTermsDays'>): number {
  if (store.saleMode === 'firme') return Math.max(0, store.creditDays ?? 0);
  return Math.max(0, store.creditDays ?? settings.paymentTermsDays);
}

export function creditText(store: Pick<Store, 'saleMode' | 'creditDays'>): string {
  if (store.saleMode !== 'firme') return 'Consignación';
  const d = store.creditDays ?? 0;
  return d > 0 ? `En firme · a crédito, ${d} días` : 'En firme · de contado';
}

/**
 * La regla de comisión de una línea de factura. UN solo lugar: hoy es la del vendedor (si tiene una
 * especial) o la del producto; la comisión progresiva la reemplaza aquí.
 */
export function invoiceCommissionRule(product: Pick<Product, 'sellerCommission'>, seller?: Pick<User, 'commissionOverride'>): CommissionRule {
  return effectiveRule(product, seller);
}

/** Comisión sobre el importe de una línea (sin impuesto): % del importe o fijo por unidad base. */
export function commissionOnAmount(rule: CommissionRule, qty: number, amount: number): number {
  if (qty <= 0 || amount <= 0) return 0;
  return rule.type === 'percent' ? round2((amount * rule.value) / 100) : round2(qty * rule.value);
}

/**
 * Comisiones de una factura con vendedor: una por línea. Sin vendedor (venta directa) no hay
 * comisión. Con la regla «al cobrar», quedan devengadas hasta que la factura se paga entera.
 */
export function invoiceCommissions(
  invoice: Pick<Invoice, 'id' | 'storeId' | 'sellerId' | 'lines' | 'issuedAt'>,
  productsById: ReadonlyMap<string, Pick<Product, 'id' | 'sellerCommission'>>,
  seller: Pick<User, 'id' | 'commissionOverride'> | undefined,
  payableOn: LineSettings['commissionPayableOn'],
  newId: (prefix: string) => string,
  ruleOf: (product: Pick<Product, 'sellerCommission'>, seller?: Pick<User, 'commissionOverride'>) => CommissionRule = invoiceCommissionRule,
): Commission[] {
  if (!invoice.sellerId || !seller) return [];
  const out: Commission[] = [];
  for (const l of invoice.lines) {
    const p = productsById.get(l.productId);
    if (!p || l.qty <= 0) continue;
    const rule = ruleOf(p, seller);
    out.push({
      id: newId('com'),
      sellerId: invoice.sellerId,
      storeId: invoice.storeId,
      productId: l.productId,
      salesReportId: '',
      settlementId: null,
      invoiceId: invoice.id,
      qty: l.qty,
      base: l.amount,
      amount: commissionOnAmount(rule, l.qty, l.amount),
      rule,
      status: payableOn === 'venta' ? 'pagable' : 'devengada',
      accruedAt: invoice.issuedAt,
      payableAt: payableOn === 'venta' ? invoice.issuedAt : undefined,
    });
  }
  return out;
}
