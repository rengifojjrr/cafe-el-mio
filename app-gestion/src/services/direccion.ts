// Vista de Dirección: las dos líneas lado a lado, solo lectura. Cada cifra sale de la base
// de su propia línea; nunca se suman entre sí, salvo la «suma informativa».
import type { LineId } from '../data/types';
import { getLineRepo } from '../data';
import { Balances } from '../domain/ledger';
import { isOverdue, settlementBalance } from '../domain/money-rules';
import { ensure, type Actor } from '../domain/permissions';
import { round2 } from '../lib/money';
import { addDays, monthKey } from '../lib/time';
import { computePnl, type PnlMonth } from './analytics';

export interface LineOverview {
  line: LineId;
  sales30: number;
  margin30: number;
  marginPct30: number;
  receivable: number;
  overdue: number;
  commissionsPayable: number;
  inventoryCost: number;
  consignmentCost: number;
  activeStores: number;
  totalStores: number;
  consignmentUnits: number;
  pendingOrders: number;
  months: PnlMonth[];
}

export async function lineOverview(actor: Actor, line: LineId, now = new Date()): Promise<LineOverview> {
  ensure(actor, 'direccion.read', line);
  const repo = getLineRepo(line);
  const [reports, commissions, returns, settlements, stores, movements, lots, reorders] = await Promise.all([
    repo.salesReports.all(),
    repo.commissions.all(),
    repo.returns.all(),
    repo.settlements.all(),
    repo.stores.all(),
    repo.movements.all(),
    repo.lots.all(),
    repo.reorders.all(),
  ]);
  const since = addDays(now, -30);
  let sales30 = 0;
  let cogs30 = 0;
  for (const r of reports) {
    if (r.at < since) continue;
    for (const l of r.lines) {
      sales30 += l.qty * l.unitPrice;
      cogs30 += l.cost;
    }
  }
  const comm30 = commissions.filter((c) => c.accruedAt >= since).reduce((a, c) => a + c.amount, 0);
  const shrink30 = returns.filter((x) => x.kind === 'merma' && x.at >= since).reduce((a, x) => a + x.cost, 0);
  const margin30 = sales30 - cogs30 - comm30 - shrink30;
  const balances = Balances.from(movements);
  const lotsById = new Map(lots.map((l) => [l.id, l]));
  let inventoryCost = 0;
  let consignmentCost = 0;
  let consignmentUnits = 0;
  for (const e of balances.entries()) {
    if (e.qty <= 0) continue;
    const cost = e.qty * (lotsById.get(e.lotId)?.unitCost ?? 0);
    if (e.loc === 'warehouse') inventoryCost += cost;
    if (e.loc.startsWith('store:')) {
      consignmentCost += cost;
      consignmentUnits += e.qty;
    }
  }
  return {
    line,
    sales30: round2(sales30),
    margin30: round2(margin30),
    marginPct30: sales30 > 0 ? margin30 / sales30 : 0,
    receivable: round2(settlements.reduce((a, s) => a + settlementBalance(s), 0)),
    overdue: round2(settlements.filter((s) => isOverdue(s, now)).reduce((a, s) => a + settlementBalance(s), 0)),
    commissionsPayable: round2(commissions.filter((c) => c.status !== 'pagada').reduce((a, c) => a + c.amount, 0)),
    inventoryCost: round2(inventoryCost),
    consignmentCost: round2(consignmentCost),
    activeStores: stores.filter((s) => s.status === 'activo').length,
    totalStores: stores.length,
    consignmentUnits,
    pendingOrders: reorders.filter((r) => r.status === 'enviado' || r.status === 'confirmado' || r.status === 'preparado').length,
    months: computePnl(reports, commissions, returns, now, 4),
  };
}

export const MONTH_KEY = monthKey;
