// Comisión progresiva: un % base, escalones (por locales activos o por lo vendido en el mes) y un tope
// que nunca se pasa. Funciones puras: las usan el servicio que crea comisiones, la semilla y el simulador.
//
// Cómo se calcula (docs/DECISIONES.md):
// - El % se fija al devengar la comisión, con las cifras del vendedor en el mes (America/New_York)
//   hasta ese momento, SIN contar la venta que se está devengando. Por eso el % que ve el vendedor en
//   su inicio es exactamente el que le toca a su próxima venta.
// - Las comisiones anteriores del mes no se recalculan: cada una guarda la regla con que nació. Llegar
//   a un escalón sube el % de lo que se vende después, no el de lo ya devengado (más fácil de auditar,
//   y lo ya mostrado o pagado no cambia).
// - Gana el escalón alcanzado con el % más alto; el resultado nunca baja del % base ni pasa del tope.
import type { CommissionRule, CommissionScheme, CommissionTier, CommissionTierMetric, IsoDateTime, Product, StoreStatus, User } from '../data/types';
import { fmtMoney0, round2 } from '../lib/money';
import { monthKey } from '../lib/time';

export type CommissionMetrics = Record<CommissionTierMetric, number>;

export const METRICS: readonly CommissionTierMetric[] = ['locales', 'cajas', 'unidades', 'ventas'] as const;

export const METRIC_LABEL: Record<CommissionTierMetric, string> = {
  locales: 'Locales activos',
  cajas: 'Cajas vendidas en el mes',
  unidades: 'Unidades vendidas en el mes',
  ventas: 'Ventas del mes (USD)',
};

export const EMPTY_METRICS: CommissionMetrics = { locales: 0, cajas: 0, unidades: 0, ventas: 0 };

export interface CommissionRate {
  percent: number;
  /** El escalón que da el % (null: rige el % base). */
  tierReached: CommissionTier | null;
  /** El siguiente escalón que sube el %: cuánto le falta y a qué % pasa (ya con el tope). */
  next?: { metric: CommissionTierMetric; missing: number; percent: number };
}

/** % de comisión que da un esquema con estas cifras. */
export function commissionRate(scheme: CommissionScheme, metrics: CommissionMetrics): CommissionRate {
  const cap = Math.max(0, scheme.capPercent);
  const capped = (p: number) => Math.min(p, cap);
  let best: CommissionTier | null = null;
  for (const t of scheme.tiers) {
    if ((metrics[t.metric] ?? 0) < t.min) continue;
    if (t.percent <= scheme.basePercent) continue;
    if (!best || t.percent > best.percent) best = t;
  }
  const percent = round2(capped(best ? best.percent : scheme.basePercent));
  let next: CommissionRate['next'];
  let nextRatio = Infinity;
  for (const t of scheme.tiers) {
    const have = metrics[t.metric] ?? 0;
    if (have >= t.min) continue;
    const p = round2(capped(t.percent));
    if (p <= percent) continue;
    const missing = round2(t.min - have);
    const ratio = t.min > 0 ? missing / t.min : 1;
    if (!next || p < next.percent || (p === next.percent && ratio < nextRatio)) {
      next = { metric: t.metric, missing, percent: p };
      nextRatio = ratio;
    }
  }
  return { percent, tierReached: best && percent > round2(capped(scheme.basePercent)) ? best : null, ...(next ? { next } : {}) };
}

/**
 * La regla de comisión de una venta. Orden de prioridad:
 * 1. Sin vendedor (venta directa): sin comisión.
 * 2. Producto con «comisión propia»: la del producto.
 * 3. Vendedor con comisión especial fija (la de antes): esa.
 * 4. Comisión progresiva (la del vendedor o, si no tiene, la de la línea): el % que da el esquema.
 * 5. Sin esquema: la del producto, como siempre.
 */
export function resolveCommissionRule(input: {
  product: Pick<Product, 'sellerCommission' | 'commissionCustom'>;
  seller: Pick<User, 'commissionOverride' | 'commissionScheme'> | null | undefined;
  lineScheme?: CommissionScheme | null;
  metrics: CommissionMetrics;
}): CommissionRule | null {
  const { product, seller } = input;
  if (!seller) return null;
  if (product.commissionCustom) return product.sellerCommission;
  if (seller.commissionOverride) return seller.commissionOverride;
  const scheme = seller.commissionScheme ?? input.lineScheme ?? null;
  if (scheme) return { type: 'percent', value: commissionRate(scheme, input.metrics).percent };
  return product.sellerCommission;
}

/** Estado de un local en un momento, según su historial (antes de registrarse: prospecto). */
export function statusAt(store: { status: StoreStatus; statusHistory?: { status: StoreStatus; at: string }[] }, at: IsoDateTime): StoreStatus {
  const history = store.statusHistory ?? [];
  if (history.length === 0) return store.status;
  let st: StoreStatus | null = null;
  for (const h of [...history].sort((a, b) => a.at.localeCompare(b.at))) {
    if (h.at <= at) st = h.status;
    else break;
  }
  return st ?? 'prospecto';
}

export interface MetricsInput {
  sellerId: string;
  at: IsoDateTime;
  stores: readonly { id: string; sellerId: string; createdBy: string; status: StoreStatus; statusHistory?: { status: StoreStatus; at: string }[] }[];
  /** Ventas en consignación (reportes). Se filtran adentro: solo las del vendedor, del mes y anteriores a `at`. */
  reports: readonly { sellerId: string; at: IsoDateTime; lines: readonly { productId: string; qty: number; unitPrice: number }[] }[];
  /** Ventas en firme (facturas), si hay. `subtotal` es sin impuesto. */
  invoices?: readonly { sellerId: string | null; issuedAt: IsoDateTime; subtotal: number; lines: readonly { productId: string; qty: number }[] }[];
  /** Unidades por caja de cada producto (para contar cajas). */
  packSize: (productId: string) => number;
}

/**
 * Cifras del vendedor en el mes de `at` hasta ese momento (sin contar lo de ese mismo instante).
 * Locales activos: los que están activos en ese momento y son suyos (a su nombre) o los registró él.
 */
export function monthToDateMetrics(input: MetricsInput): CommissionMetrics {
  const { sellerId, at } = input;
  const month = monthKey(at);
  let locales = 0;
  for (const s of input.stores) {
    if (s.sellerId !== sellerId && s.createdBy !== sellerId) continue;
    if (statusAt(s, at) === 'activo') locales += 1;
  }
  let cajas = 0;
  let unidades = 0;
  let ventas = 0;
  for (const r of input.reports) {
    if (r.sellerId !== sellerId || r.at >= at || monthKey(r.at) !== month) continue;
    for (const l of r.lines) {
      unidades += l.qty;
      cajas += l.qty / Math.max(1, input.packSize(l.productId));
      ventas += l.qty * l.unitPrice;
    }
  }
  for (const inv of input.invoices ?? []) {
    if (inv.sellerId !== sellerId || inv.issuedAt >= at || monthKey(inv.issuedAt) !== month) continue;
    ventas += inv.subtotal;
    for (const l of inv.lines) {
      unidades += l.qty;
      cajas += l.qty / Math.max(1, input.packSize(l.productId));
    }
  }
  return { locales, cajas: round2(cajas), unidades, ventas: round2(ventas) };
}

// ---------- Validación y textos ----------

/** Lo que está mal en un esquema, o null si se puede guardar. */
export function schemeProblem(s: CommissionScheme): string | null {
  const okPct = (n: number) => Number.isFinite(n) && n >= 0 && n <= 50;
  if (!okPct(s.basePercent)) return 'El % base va de 0 a 50.';
  if (!okPct(s.capPercent)) return 'El tope va de 0 a 50 %.';
  if (s.capPercent < s.basePercent) return 'El tope no puede ser menor que el % base.';
  if (s.tiers.length > 8) return 'Máximo 8 escalones.';
  const seen = new Set<string>();
  for (const t of s.tiers) {
    if (!METRICS.includes(t.metric)) return 'Elige qué mide cada escalón.';
    if (!Number.isFinite(t.min) || t.min <= 0) return 'Cada escalón necesita un «desde» mayor que cero.';
    if (t.metric === 'locales' && !Number.isInteger(t.min)) return 'Los locales se cuentan enteros.';
    if (!okPct(t.percent)) return 'El % de cada escalón va de 0 a 50.';
    if (t.percent <= s.basePercent) return 'Cada escalón tiene que dar más que el % base.';
    const key = `${t.metric}|${t.min}`;
    if (seen.has(key)) return 'Hay dos escalones iguales.';
    seen.add(key);
  }
  return null;
}

export function pctText(n: number): string {
  return `${round2(n).toLocaleString('es-US', { maximumFractionDigits: 2 })} %`;
}

/** «5 locales activos», «$4,000 en ventas», «12 cajas», «300 unidades». */
export function metricAmountText(metric: CommissionTierMetric, n: number): string {
  if (metric === 'ventas') return `${fmtMoney0(n)} en ventas`;
  const v = metric === 'locales' ? Math.round(n) : Math.ceil(n - 1e-9);
  const fmt = v.toLocaleString('es-US');
  if (metric === 'locales') return v === 1 ? '1 local activo' : `${fmt} locales activos`;
  if (metric === 'cajas') return v === 1 ? '1 caja' : `${fmt} cajas`;
  return v === 1 ? '1 unidad' : `${fmt} unidades`;
}

export function tierText(t: CommissionTier): string {
  const desde = t.metric === 'ventas' ? `Desde ${fmtMoney0(t.min)} vendidos en el mes` : `Desde ${metricAmountText(t.metric, t.min)}${t.metric === 'locales' ? '' : ' en el mes'}`;
  return `${desde}: ${pctText(t.percent)}`;
}

/** «Base 6 % · hasta 10 % · 3 escalones». */
export function describeScheme(s: CommissionScheme): string {
  const n = s.tiers.length;
  return `Base ${pctText(s.basePercent)} · tope ${pctText(s.capPercent)} · ${n === 0 ? 'sin escalones' : n === 1 ? '1 escalón' : `${n} escalones`}`;
}

/** «Vas en el 7 % · con 1 local activo más pasas al 8 %». */
export function progressText(rate: CommissionRate): string {
  const now = `Vas en el ${pctText(rate.percent)}`;
  if (!rate.next) return `${now} · es lo más alto de tu comisión`;
  return `${now} · con ${metricAmountText(rate.next.metric, rate.next.missing)} más pasas al ${pctText(rate.next.percent)}`;
}
