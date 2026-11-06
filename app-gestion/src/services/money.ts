// Liquidaciones, cobros y comisiones. Aquí no se mueve dinero: solo se registra el apunte
// (efectivo, cheque, Zelle o transferencia, con su referencia).
import { z } from 'zod';
import type { Commission, CommissionPayout, Payment, PaymentMethod, SalesReport, Settlement, Store } from '../data/types';
import {
  type AgingBucket,
  aging,
  agingBucket,
  commissionTotals,
  isOverdue,
  settlementBalance,
  settlementLines,
  settlementStatus,
} from '../domain/money-rules';
import { round2 } from '../lib/money';
import { addDaysToDate, daysBetween, monthKey, toIsoDate } from '../lib/time';
import { type Ctx, NotFoundError, ValidationError, audit, getSettings, guard, mutate, notify, nowIso } from './context';
import { scopedStores } from './stores';

export const PAYMENT_METHODS = ['efectivo', 'cheque', 'zelle', 'transferencia', 'tarjeta'] as const satisfies readonly PaymentMethod[];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  cheque: 'Cheque',
  zelle: 'Zelle',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta (cobrada aparte)',
};

export const SETTLEMENT_STATUS_LABEL: Record<Settlement['status'], string> = {
  pendiente: 'Pendiente',
  parcial: 'Pago parcial',
  pagada: 'Pagada',
};

export interface SettlementView extends Settlement {
  storeName: string;
  balance: number;
  overdue: boolean;
  bucket: AgingBucket;
  daysOld: number;
  payments: Payment[];
}

export async function listSettlements(ctx: Ctx, filter?: { storeId?: string; open?: boolean }): Promise<SettlementView[]> {
  guard(ctx, 'settlement.read');
  const stores = await scopedStores(ctx);
  const storesById = new Map(stores.map((s) => [s.id, s]));
  const [all, payments] = await Promise.all([ctx.repo.settlements.all(), ctx.repo.payments.all()]);
  const now = ctx.now();
  return all
    .filter((s) => storesById.has(s.storeId))
    .filter((s) => !filter?.storeId || s.storeId === filter.storeId)
    .filter((s) => !filter?.open || settlementBalance(s) > 0)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    .map((s) => ({
      ...s,
      storeName: storesById.get(s.storeId)?.name ?? '—',
      balance: settlementBalance(s),
      overdue: isOverdue(s, now),
      bucket: agingBucket(s.issuedAt, now),
      daysOld: daysBetween(s.issuedAt, now),
      payments: payments.filter((p) => p.settlementId === s.id).sort((a, b) => b.at.localeCompare(a.at)),
    }));
}

export interface StoreAccount {
  store: Store;
  unsettledSales: number;
  unsettledReports: number;
  balance: number;
  overdue: number;
  lastSettlementAt?: string;
  nextSettlementOn?: string;
  aging: Record<AgingBucket, { amount: number; count: number }>;
}

/** Estado de cuenta por local: lo vendido sin liquidar, lo que debe y su antigüedad. */
export async function storeAccounts(ctx: Ctx): Promise<StoreAccount[]> {
  guard(ctx, 'settlement.read');
  const stores = await scopedStores(ctx);
  const [settlements, reports, settings] = await Promise.all([ctx.repo.settlements.all(), ctx.repo.salesReports.all(), getSettings(ctx)]);
  const now = ctx.now();
  return stores
    .filter((s) => s.status !== 'prospecto' && s.status !== 'contrato_enviado')
    .map((store) => {
      const mine = settlements.filter((s) => s.storeId === store.id);
      const unsettled = reports.filter((r) => r.storeId === store.id && !r.settlementId);
      const last = mine.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
      const base = last?.issuedAt ?? unsettled.map((r) => r.at).sort()[0];
      return {
        store,
        unsettledSales: round2(unsettled.reduce((a, r) => a + r.total, 0)),
        unsettledReports: unsettled.length,
        balance: round2(mine.reduce((a, s) => a + settlementBalance(s), 0)),
        overdue: round2(mine.filter((s) => isOverdue(s, now)).reduce((a, s) => a + settlementBalance(s), 0)),
        lastSettlementAt: last?.issuedAt,
        nextSettlementOn: base ? addDaysToDate(toIsoDate(base), settings.settlementEveryDays) : undefined,
        aging: aging(mine, now),
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
}

/** Liquida todo lo vendido y aún no liquidado de un local. */
export async function generateSettlement(ctx: Ctx, storeId: string): Promise<Settlement> {
  guard(ctx, 'settlement.create');
  return mutate(ctx, async () => {
    const store = await ctx.repo.stores.get(storeId);
    if (!store) throw new NotFoundError('el local');
    const reports = (await ctx.repo.salesReports.where('storeId', storeId)).filter((r) => !r.settlementId);
    if (reports.length === 0) throw new ValidationError(`${store.name} no tiene ventas sin liquidar.`);
    return createSettlement(ctx, store, reports);
  });
}

async function createSettlement(ctx: Ctx, store: Store, reports: SalesReport[]): Promise<Settlement> {
  const settings = await getSettings(ctx);
  const count = await ctx.repo.settlements.count();
  const lines = settlementLines(reports);
  const at = nowIso(ctx);
  const sorted = [...reports].sort((a, b) => a.at.localeCompare(b.at));
  const settlement: Settlement = {
    id: ctx.newId('liq'),
    code: `L-${String(count + 1).padStart(4, '0')}`,
    storeId: store.id,
    sellerId: store.sellerId,
    periodFrom: sorted[0]!.at,
    periodTo: sorted[sorted.length - 1]!.at,
    issuedAt: at,
    dueOn: addDaysToDate(toIsoDate(ctx.now()), settings.paymentTermsDays),
    salesReportIds: reports.map((r) => r.id),
    lines,
    amount: round2(lines.reduce((a, l) => a + l.amount, 0)),
    paid: 0,
    status: 'pendiente',
  };
  await ctx.repo.settlements.put(settlement);
  for (const r of reports) {
    r.settlementId = settlement.id;
    await ctx.repo.salesReports.put(r);
    const comms = await ctx.repo.commissions.where('salesReportId', r.id);
    for (const c of comms) {
      c.settlementId = settlement.id;
      await ctx.repo.commissions.put(c);
    }
  }
  await audit(ctx, 'liquidacion.generar', 'settlement', settlement.id, `${settlement.code} para ${store.name}: ${settlement.amount.toFixed(2)} USD`);
  const storeUsers = await ctx.repo.users.where('storeId', store.id);
  await notify(
    ctx,
    storeUsers.map((u) => u.id),
    'liquidacion_nueva',
    `Nueva liquidación ${settlement.code}`,
    `Debes ${settlement.amount.toFixed(2)} USD por lo vendido. Vence el ${settlement.dueOn}.`,
    `/${ctx.line}/cuentas`,
  );
  return settlement;
}

/** Genera las liquidaciones que tocan según la frecuencia de la línea (cada N días). */
export async function generateDueSettlements(ctx: Ctx): Promise<number> {
  guard(ctx, 'settlement.create');
  const accounts = await storeAccounts(ctx);
  const today = toIsoDate(ctx.now());
  let n = 0;
  for (const a of accounts) {
    if (a.unsettledReports === 0) continue;
    if (a.nextSettlementOn && a.nextSettlementOn > today) continue;
    await generateSettlement(ctx, a.store.id);
    n += 1;
  }
  return n;
}

const paymentSchema = z.object({
  amount: z.number({ error: 'Escribe el monto.' }).positive('El monto tiene que ser mayor que cero.'),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(60).default(''),
});

/** Registra un pago (solo el apunte). Si con él queda pagada, las comisiones pasan a pagables. */
export async function recordPayment(ctx: Ctx, settlementId: string, input: z.input<typeof paymentSchema>): Promise<Payment> {
  guard(ctx, 'payment.record');
  const data = paymentSchema.parse(input);
  if (data.method !== 'efectivo' && data.reference.length < 2) {
    throw new ValidationError('Escribe la referencia (número de cheque o de confirmación).');
  }
  return mutate(ctx, async () => {
    const s = await ctx.repo.settlements.get(settlementId);
    if (!s) throw new NotFoundError('la liquidación');
    const balance = settlementBalance(s);
    if (data.amount > balance + 0.001) throw new ValidationError(`El pago no puede pasar del saldo (${balance.toFixed(2)} USD).`);
    const at = nowIso(ctx);
    const payment: Payment = {
      id: ctx.newId('pag'),
      settlementId,
      storeId: s.storeId,
      amount: round2(data.amount),
      method: data.method,
      reference: data.reference,
      at,
      recordedBy: ctx.actor.userId,
    };
    await ctx.repo.payments.put(payment);
    s.paid = round2(s.paid + payment.amount);
    s.status = settlementStatus(s.amount, s.paid);
    if (s.status === 'pagada') s.paidAt = at;
    await ctx.repo.settlements.put(s);
    const settings = await getSettings(ctx);
    let freed = 0;
    if (s.status === 'pagada' && settings.commissionPayableOn === 'cobro') {
      const comms = await ctx.repo.commissions.where('settlementId', s.id);
      for (const c of comms) {
        if (c.status !== 'devengada') continue;
        c.status = 'pagable';
        c.payableAt = at;
        freed += c.amount;
        await ctx.repo.commissions.put(c);
      }
    }
    const store = await ctx.repo.stores.get(s.storeId);
    await audit(ctx, 'pago.registrar', 'payment', payment.id, `Pago de ${payment.amount.toFixed(2)} USD (${PAYMENT_METHOD_LABEL[payment.method]}) a ${s.code} de ${store?.name ?? s.storeId}`);
    const storeUsers = await ctx.repo.users.where('storeId', s.storeId);
    await notify(ctx, storeUsers.map((u) => u.id), 'pago_registrado', `Pago registrado: ${s.code}`, `${payment.amount.toFixed(2)} USD por ${PAYMENT_METHOD_LABEL[payment.method]}.`, `/${ctx.line}/cuentas`);
    if (freed > 0) {
      await notify(ctx, [s.sellerId], 'pago_registrado', `${store?.name ?? 'Un local'} pagó`, `Tienes ${round2(freed).toFixed(2)} USD en comisiones listas para cobrar.`, `/${ctx.line}/comisiones`);
    }
    return payment;
  });
}

// ---------- Comisiones ----------

export interface CommissionView extends Commission {
  storeName: string;
  productName: string;
  sellerName: string;
  month: string;
}

export async function listCommissions(ctx: Ctx, filter?: { sellerId?: string }): Promise<CommissionView[]> {
  const sellerId = ctx.actor.role === 'seller' ? ctx.actor.userId : filter?.sellerId;
  if (ctx.actor.role === 'seller') guard(ctx, 'commission.read', { type: 'seller', sellerId: ctx.actor.userId });
  else guard(ctx, 'commission.read');
  if (ctx.actor.role === 'seller' && filter?.sellerId && filter.sellerId !== ctx.actor.userId) {
    guard(ctx, 'commission.read', { type: 'seller', sellerId: filter.sellerId });
  }
  const [all, stores, products, users] = await Promise.all([
    sellerId ? ctx.repo.commissions.where('sellerId', sellerId) : ctx.repo.commissions.all(),
    ctx.repo.stores.all(),
    ctx.repo.products.all(),
    ctx.repo.users.all(),
  ]);
  const sName = new Map(stores.map((s) => [s.id, s.name]));
  const pName = new Map(products.map((p) => [p.id, p.name]));
  const uName = new Map(users.map((u) => [u.id, u.name]));
  return all
    .sort((a, b) => b.accruedAt.localeCompare(a.accruedAt))
    .map((c) => ({
      ...c,
      storeName: sName.get(c.storeId) ?? '—',
      productName: pName.get(c.productId) ?? '—',
      sellerName: uName.get(c.sellerId) ?? '—',
      month: monthKey(c.accruedAt),
    }));
}

export interface CommissionSummary {
  totals: ReturnType<typeof commissionTotals>;
  byProduct: { key: string; label: string; amount: number; qty: number }[];
  byStore: { key: string; label: string; amount: number; qty: number }[];
  byMonth: { key: string; devengada: number; pagable: number; pagada: number; total: number }[];
  bySeller: { key: string; label: string; devengada: number; pagable: number; pagada: number }[];
}

export function summarizeCommissions(list: readonly CommissionView[]): CommissionSummary {
  const group = (keyOf: (c: CommissionView) => string, labelOf: (c: CommissionView) => string) => {
    const m = new Map<string, { key: string; label: string; amount: number; qty: number }>();
    for (const c of list) {
      const k = keyOf(c);
      const cur = m.get(k) ?? { key: k, label: labelOf(c), amount: 0, qty: 0 };
      cur.amount = round2(cur.amount + c.amount);
      cur.qty += c.qty;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  };
  const months = new Map<string, { key: string; devengada: number; pagable: number; pagada: number; total: number }>();
  const sellers = new Map<string, { key: string; label: string; devengada: number; pagable: number; pagada: number }>();
  for (const c of list) {
    const m = months.get(c.month) ?? { key: c.month, devengada: 0, pagable: 0, pagada: 0, total: 0 };
    m[c.status] = round2(m[c.status] + c.amount);
    m.total = round2(m.total + c.amount);
    months.set(c.month, m);
    const s = sellers.get(c.sellerId) ?? { key: c.sellerId, label: c.sellerName, devengada: 0, pagable: 0, pagada: 0 };
    s[c.status] = round2(s[c.status] + c.amount);
    sellers.set(c.sellerId, s);
  }
  return {
    totals: commissionTotals(list),
    byProduct: group((c) => c.productId, (c) => c.productName),
    byStore: group((c) => c.storeId, (c) => c.storeName),
    byMonth: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)),
    bySeller: [...sellers.values()].sort((a, b) => b.pagable - a.pagable),
  };
}

const payoutSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(60).default(''),
});

/** Administración marca como pagadas todas las comisiones pagables de un vendedor. */
export async function payCommissions(ctx: Ctx, sellerId: string, input: z.input<typeof payoutSchema>): Promise<CommissionPayout> {
  guard(ctx, 'commission.pay');
  const data = payoutSchema.parse(input);
  if (data.method !== 'efectivo' && data.reference.length < 2) throw new ValidationError('Escribe la referencia del pago.');
  return mutate(ctx, async () => {
    const list = (await ctx.repo.commissions.where('sellerId', sellerId)).filter((c) => c.status === 'pagable');
    if (list.length === 0) throw new ValidationError('Este vendedor no tiene comisiones pagables.');
    const at = nowIso(ctx);
    const payout: CommissionPayout = {
      id: ctx.newId('pgc'),
      sellerId,
      amount: round2(list.reduce((a, c) => a + c.amount, 0)),
      commissionIds: list.map((c) => c.id),
      method: data.method,
      reference: data.reference,
      at,
      recordedBy: ctx.actor.userId,
    };
    await ctx.repo.payouts.put(payout);
    for (const c of list) {
      c.status = 'pagada';
      c.paidAt = at;
      c.payoutId = payout.id;
      await ctx.repo.commissions.put(c);
    }
    const seller = await ctx.repo.users.get(sellerId);
    await audit(ctx, 'comision.pagar', 'payout', payout.id, `Comisiones pagadas a ${seller?.name ?? sellerId}: ${payout.amount.toFixed(2)} USD (${PAYMENT_METHOD_LABEL[payout.method]})`);
    await notify(ctx, [sellerId], 'comision_pagada', 'Te pagaron comisiones', `${payout.amount.toFixed(2)} USD por ${PAYMENT_METHOD_LABEL[payout.method]}.`, `/${ctx.line}/comisiones`);
    return payout;
  });
}

export async function listPayouts(ctx: Ctx, sellerId?: string): Promise<CommissionPayout[]> {
  if (ctx.actor.role === 'seller') guard(ctx, 'commission.read', { type: 'seller', sellerId: ctx.actor.userId });
  else guard(ctx, 'commission.read');
  const id = ctx.actor.role === 'seller' ? ctx.actor.userId : sellerId;
  const list = id ? await ctx.repo.payouts.where('sellerId', id) : await ctx.repo.payouts.all();
  return list.sort((a, b) => b.at.localeCompare(a.at));
}
