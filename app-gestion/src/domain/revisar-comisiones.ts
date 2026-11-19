// Revisión de comisiones antes de pagarlas.
//
// La comisión la calcula el teléfono de quien hace la venta (el motor —escalones del mes, diferencia
// sobre el precio base, comisión propia del producto— vive en la app, no en el servidor). Con la
// fase 2 cada vendedor sube sus ventas y sus comisiones con su cuenta: el servidor revisa que sean
// suyas, de su local y no pagadas, pero no recalcula el monto. Por eso el teléfono de Administración,
// que tiene todos los datos, compara cada comisión con su venta y con las reglas que el motor le
// puede dar a ese vendedor con ese producto, y marca las que no cuadran.
//
// Solo marca, no bloquea: si Administración cambió una regla o un precio base después de la venta,
// la comisión (bien hecha) también sale marcada, y la decisión es de quien paga.
import type { Commission, CommissionRule, CommissionScheme, Invoice, Product, SalesReport, User } from '../data/types';
import { fmtMoney, round2 } from '../lib/money';
import { commissionOnAmount } from './invoices';
import { commissionAmount } from './money-rules';

/** Las reglas que el motor (resolveCommissionRule) le puede dar a este vendedor con este producto, con cualquier cifra del mes. */
export function reglasPosibles(
  product: Pick<Product, 'sellerCommission' | 'commissionCustom'>,
  seller: Pick<User, 'commissionOverride' | 'commissionScheme'> | null | undefined,
  lineScheme: CommissionScheme | null | undefined,
): CommissionRule[] {
  if (!seller) return [];
  if (seller.commissionOverride?.type === 'diferencia') return [seller.commissionOverride];
  if (product.commissionCustom) return [product.sellerCommission];
  if (seller.commissionOverride) return [seller.commissionOverride];
  const scheme = seller.commissionScheme ?? lineScheme ?? null;
  if (!scheme) return [product.sellerCommission];
  // commissionRate: el % base o el de un escalón más alto, nunca por encima del tope.
  const cap = Math.max(0, scheme.capPercent);
  const pcts = new Set([round2(Math.min(scheme.basePercent, cap)), ...scheme.tiers.filter((t) => t.percent > scheme.basePercent).map((t) => round2(Math.min(t.percent, cap)))]);
  return [...pcts].map((value) => ({ type: 'percent' as const, value }));
}

function mismaRegla(a: CommissionRule, b: CommissionRule): boolean {
  if (a.type !== b.type) return false;
  return a.type === 'diferencia' || Math.abs(a.value - b.value) < 0.005;
}

const casi = (a: number, b: number) => Math.abs(a - b) < 0.015;

export interface DatosDeRevision {
  report?: Pick<SalesReport, 'lines'>;
  invoice?: Pick<Invoice, 'lines'>;
  product?: Pick<Product, 'sellerCommission' | 'commissionCustom' | 'priceToStore'>;
  seller?: Pick<User, 'commissionOverride' | 'commissionScheme'> | null;
  lineScheme?: CommissionScheme | null;
}

/** Por qué una comisión no cuadra con su venta (null si cuadra). */
export function comisionNoCuadra(c: Pick<Commission, 'productId' | 'qty' | 'base' | 'amount' | 'rule' | 'invoiceId' | 'salesReportId'>, d: DatosDeRevision): string | null {
  if (!d.product) return 'El producto de esta comisión ya no está en el catálogo.';
  if (!reglasPosibles(d.product, d.seller, d.lineScheme).some((r) => mismaRegla(r, c.rule))) {
    return 'La regla no es la de este vendedor ni la del producto (o se cambió después de la venta).';
  }
  if (c.invoiceId) {
    if (!d.invoice) return 'No encuentro la factura de esta comisión.';
    const l = d.invoice.lines.find((x) => x.productId === c.productId && x.qty === c.qty && casi(x.amount, c.base));
    if (!l) return 'La cantidad o el importe no coinciden con la factura.';
    const esperado = commissionOnAmount(c.rule, l.qty, l.amount, d.product.priceToStore);
    return casi(esperado, c.amount) ? null : `Con la factura y su regla serían ${fmtMoney(esperado)}${c.rule.type === 'diferencia' ? ' (o el precio base cambió después)' : ''}.`;
  }
  if (!d.report) return 'No encuentro la venta de esta comisión.';
  const l = d.report.lines.find((x) => x.productId === c.productId && x.qty === c.qty && casi(round2(x.qty * x.unitPrice), c.base));
  if (!l) return 'La cantidad o el precio no coinciden con la venta.';
  const esperado = commissionAmount(c.rule, l.qty, l.unitPrice, l.basePrice);
  return casi(esperado, c.amount) ? null : `Con la venta y su regla serían ${fmtMoney(esperado)}.`;
}
