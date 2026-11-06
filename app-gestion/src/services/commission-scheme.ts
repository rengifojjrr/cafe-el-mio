// Comisión progresiva: la ÚNICA puerta para saber qué comisión le toca a una venta.
// `commissionRuleFor` (o, para varias líneas de una misma venta, `sellerCommissionContext` +
// `ruleFromContext`) la usan la consignación al reportar ventas y la venta en firme al facturar.
// El % se fija al devengar, con las cifras del vendedor en el mes hasta ese momento; lo ya
// devengado no se recalcula (ver domain/commission-scheme.ts).
import { z } from 'zod';
import type { CommissionRule, CommissionScheme, IsoDateTime, Product, User } from '../data/types';
import {
  type CommissionMetrics,
  type CommissionRate,
  EMPTY_METRICS,
  commissionRate,
  monthToDateMetrics,
  resolveCommissionRule,
  schemeProblem,
} from '../domain/commission-scheme';
import { type Ctx, NotFoundError, ValidationError, audit, getSettings, guard, mutate } from './context';

export interface SellerCommissionContext {
  seller: User | null;
  /** Esquema que rige: el del vendedor, el de la línea o ninguno. */
  scheme: CommissionScheme | null;
  schemeSource: 'vendedor' | 'linea' | null;
  lineScheme: CommissionScheme | null;
  metrics: CommissionMetrics;
  rate: CommissionRate | null;
}

/**
 * Lo que hace falta para la comisión de un vendedor en un momento: quién es, qué esquema rige y sus
 * cifras del mes hasta ese momento. Uso interno de los servicios (no revisa permisos: lo hace quien llama).
 */
export async function sellerCommissionContext(ctx: Ctx, sellerId: string | null | undefined, at: Date | IsoDateTime): Promise<SellerCommissionContext> {
  const settings = await getSettings(ctx);
  const lineScheme = settings.commissionScheme ?? null;
  const seller = sellerId ? ((await ctx.repo.users.get(sellerId)) ?? null) : null;
  if (!seller || seller.role !== 'seller') {
    return { seller: null, scheme: null, schemeSource: null, lineScheme, metrics: EMPTY_METRICS, rate: null };
  }
  const scheme = seller.commissionScheme ?? lineScheme;
  const schemeSource = seller.commissionScheme ? 'vendedor' : lineScheme ? 'linea' : null;
  if (!scheme) return { seller, scheme: null, schemeSource: null, lineScheme, metrics: EMPTY_METRICS, rate: null };
  const iso = typeof at === 'string' ? at : at.toISOString();
  const [stores, reports, invoices, products] = await Promise.all([
    ctx.repo.stores.all(),
    ctx.repo.salesReports.where('sellerId', seller.id),
    ctx.repo.invoices.where('sellerId', seller.id),
    ctx.repo.products.all(),
  ]);
  const pack = new Map(products.map((p) => [p.id, p.packSize]));
  const metrics = monthToDateMetrics({ sellerId: seller.id, at: iso, stores, reports, invoices, packSize: (id) => pack.get(id) ?? 1 });
  return { seller, scheme, schemeSource, lineScheme, metrics, rate: commissionRate(scheme, metrics) };
}

/** La regla de una línea de venta, con el contexto ya calculado (null: sin comisión). */
export function ruleFromContext(c: SellerCommissionContext, product: Pick<Product, 'sellerCommission' | 'commissionCustom'>): CommissionRule | null {
  return resolveCommissionRule({ product, seller: c.seller, lineScheme: c.lineScheme, metrics: c.metrics });
}

/**
 * La comisión que corresponde a una venta de `product` hecha por `sellerId` en el momento `at`.
 * Sin vendedor (venta directa): null, no hay comisión.
 */
export async function commissionRuleFor(ctx: Ctx, input: { sellerId: string | null | undefined; product: Pick<Product, 'sellerCommission' | 'commissionCustom'>; at: Date | IsoDateTime }): Promise<CommissionRule | null> {
  return ruleFromContext(await sellerCommissionContext(ctx, input.sellerId, input.at), input.product);
}

export interface SellerCommissionStatus {
  sellerId: string;
  source: 'vendedor' | 'linea' | null;
  scheme: CommissionScheme | null;
  metrics: CommissionMetrics;
  rate: CommissionRate | null;
  /** Tiene una comisión especial fija (la de antes), que manda sobre la progresiva. */
  flatOverride: CommissionRule | null;
}

/** Cómo va hoy la comisión progresiva de un vendedor (su inicio, Usuarios). */
export async function sellerCommissionStatus(ctx: Ctx, sellerId?: string): Promise<SellerCommissionStatus | null> {
  const id = ctx.actor.role === 'seller' ? ctx.actor.userId : sellerId;
  if (!id) return null;
  if (ctx.actor.role === 'seller') guard(ctx, 'commission.read', { type: 'seller', sellerId: id });
  else guard(ctx, 'commission.read');
  const c = await sellerCommissionContext(ctx, id, ctx.now());
  if (!c.seller) return null;
  return { sellerId: id, source: c.schemeSource, scheme: c.scheme, metrics: c.metrics, rate: c.rate, flatOverride: c.seller.commissionOverride ?? null };
}

const tierSchema = z.object({
  metric: z.enum(['locales', 'cajas', 'unidades', 'ventas']),
  min: z.number({ error: 'Escribe desde cuánto vale cada escalón.' }),
  percent: z.number({ error: 'Escribe el % de cada escalón.' }),
});

const schemeSchema = z.object({
  basePercent: z.number({ error: 'Escribe el % base.' }),
  capPercent: z.number({ error: 'Escribe el tope.' }),
  tiers: z.array(tierSchema),
});

function parseScheme(input: z.input<typeof schemeSchema>): CommissionScheme {
  const s = schemeSchema.parse(input);
  const scheme: CommissionScheme = {
    basePercent: s.basePercent,
    capPercent: s.capPercent,
    tiers: [...s.tiers].sort((a, b) => a.metric.localeCompare(b.metric) || a.min - b.min),
  };
  const problem = schemeProblem(scheme);
  if (problem) throw new ValidationError(problem);
  return scheme;
}

/** Comisión progresiva de la línea (null: se vuelve a la regla de cada producto). */
export async function saveLineCommissionScheme(ctx: Ctx, input: z.input<typeof schemeSchema> | null): Promise<void> {
  guard(ctx, 'commission.configure');
  const scheme = input ? parseScheme(input) : null;
  await mutate(ctx, async () => {
    const settings = await getSettings(ctx);
    const next = { ...settings };
    if (scheme) next.commissionScheme = scheme;
    else delete next.commissionScheme;
    await ctx.repo.settings.put(next);
    await audit(ctx, 'comision.esquema', 'settings', settings.id, scheme ? `Comisión progresiva de la línea: base ${scheme.basePercent} %, tope ${scheme.capPercent} %, ${scheme.tiers.length} escalones` : 'Sin comisión progresiva: rige la de cada producto');
  });
}

/** Comisión progresiva propia de un vendedor (null: usa la de la línea). */
export async function saveSellerCommissionScheme(ctx: Ctx, userId: string, input: z.input<typeof schemeSchema> | null): Promise<void> {
  guard(ctx, 'commission.configure');
  const scheme = input ? parseScheme(input) : null;
  await mutate(ctx, async () => {
    const u = await ctx.repo.users.get(userId);
    if (!u || u.role !== 'seller') throw new NotFoundError('el vendedor');
    const next: User = { ...u };
    if (scheme) next.commissionScheme = scheme;
    else delete next.commissionScheme;
    await ctx.repo.users.put(next);
    await audit(ctx, 'comision.esquema_vendedor', 'user', u.id, scheme ? `Comisión progresiva propia de ${u.name}: base ${scheme.basePercent} %, tope ${scheme.capPercent} %` : `${u.name} vuelve a la comisión progresiva de la línea`);
  });
}
