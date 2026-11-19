// Fase 2: el servidor no recalcula el monto de las comisiones que sube cada vendedor. El teléfono de
// Administración las compara con su venta y con las reglas posibles antes de pagarlas.
import { beforeAll, describe, expect, it } from 'vitest';
import { setDbPrefix } from '../../src/data';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import type { LineRepo } from '../../src/data/repo';
import type { Commission, CommissionScheme, Invoice, LineSettings, Product, SalesReport, User } from '../../src/data/types';
import type { Actor } from '../../src/domain/permissions';
import { comisionNoCuadra, reglasPosibles } from '../../src/domain/revisar-comisiones';
import { buildLine, seedEverything } from '../../src/seed';
import { lineCtx } from '../../src/services/context';
import { listCommissions } from '../../src/services/money';

const ESQUEMA: CommissionScheme = { basePercent: 4, capPercent: 9, tiers: [{ metric: 'locales', min: 5, percent: 6 }, { metric: 'ventas', min: 5000, percent: 12 }, { metric: 'cajas', min: 3, percent: 3 }] };

describe('reglas posibles', () => {
  const prod: Pick<Product, 'sellerCommission' | 'commissionCustom'> = { sellerCommission: { type: 'percent', value: 5 }, commissionCustom: false };
  it('con escalones: el % base y los de los escalones más altos, nunca por encima del tope', () => {
    expect(reglasPosibles(prod, {}, ESQUEMA)).toEqual([
      { type: 'percent', value: 4 },
      { type: 'percent', value: 6 },
      { type: 'percent', value: 9 },
    ]);
  });
  it('la comisión propia del producto, la especial del vendedor y la diferencia mandan', () => {
    expect(reglasPosibles({ ...prod, commissionCustom: true }, {}, ESQUEMA)).toEqual([{ type: 'percent', value: 5 }]);
    expect(reglasPosibles(prod, { commissionOverride: { type: 'fixed', value: 1 } }, ESQUEMA)).toEqual([{ type: 'fixed', value: 1 }]);
    expect(reglasPosibles({ ...prod, commissionCustom: true }, { commissionOverride: { type: 'diferencia', value: 0 } }, ESQUEMA)).toEqual([{ type: 'diferencia', value: 0 }]);
    expect(reglasPosibles(prod, {}, null)).toEqual([{ type: 'percent', value: 5 }]);
    expect(reglasPosibles(prod, null, ESQUEMA)).toEqual([]);
  });
});

describe('una comisión contra su venta', () => {
  const product = { sellerCommission: { type: 'percent' as const, value: 5 }, commissionCustom: false, priceToStore: 35 };
  const report: Pick<SalesReport, 'lines'> = { lines: [{ productId: 'p1', qty: 10, unitPrice: 40, basePrice: 35, cost: 0, lots: [] }] };
  const buena = { productId: 'p1', qty: 10, base: 400, amount: 50, rule: { type: 'diferencia' as const, value: 0 }, salesReportId: 'r1', invoiceId: undefined };
  const vendedor = { commissionOverride: { type: 'diferencia' as const, value: 0 } };

  it('la que sale del motor cuadra', () => {
    expect(comisionNoCuadra(buena, { report, product, seller: vendedor })).toBeNull();
  });
  it('un monto inflado, una regla inventada, otra cantidad o una venta que no existe: se marca', () => {
    expect(comisionNoCuadra({ ...buena, amount: 120 }, { report, product, seller: vendedor })).toMatch(/serían \$50/);
    expect(comisionNoCuadra({ ...buena, rule: { type: 'percent', value: 90 }, amount: 360 }, { report, product, seller: vendedor })).toMatch(/La regla no es/);
    expect(comisionNoCuadra({ ...buena, qty: 20, base: 800, amount: 100 }, { report, product, seller: vendedor })).toMatch(/no coinciden con la venta/);
    expect(comisionNoCuadra(buena, { report: undefined, product, seller: vendedor })).toMatch(/No encuentro la venta/);
  });
  it('en una factura en firme: el importe de la línea y el precio base del producto', () => {
    const invoice: Pick<Invoice, 'lines'> = { lines: [{ productId: 'p1', name: 'x', pack: 'unidad', packQty: 10, qty: 10, unitPrice: 40, amount: 400, cost: 0, lots: [] }] };
    const c = { ...buena, salesReportId: '', invoiceId: 'f1' };
    expect(comisionNoCuadra(c, { invoice, product, seller: vendedor })).toBeNull();
    expect(comisionNoCuadra({ ...c, amount: 80 }, { invoice, product, seller: vendedor })).toMatch(/precio base cambió/);
  });
});

describe('los datos de ejemplo', () => {
  it('ninguna comisión de la demo sale marcada (las arma el mismo motor que la app)', () => {
    const t = buildLine('tabaco', new Date());
    const comms = t.commissions as Commission[];
    const reports = new Map((t.salesReports as SalesReport[]).map((r) => [r.id, r]));
    const invoices = new Map((t.invoices as Invoice[]).map((r) => [r.id, r]));
    const products = new Map((t.products as Product[]).map((r) => [r.id, r]));
    const users = new Map((t.users as User[]).map((r) => [r.id, r]));
    const settings = (t.settings as LineSettings[])[0]!;
    const marcadas = comms.filter((c) =>
      comisionNoCuadra(c, { report: reports.get(c.salesReportId), invoice: c.invoiceId ? invoices.get(c.invoiceId) : undefined, product: products.get(c.productId), seller: users.get(c.sellerId), lineScheme: settings.commissionScheme ?? null }),
    );
    expect(comms.some((c) => c.invoiceId)).toBe(true);
    expect(marcadas).toEqual([]);
  });
});

describe('Administración ve las que no cuadran', () => {
  const P = 'pruebas-revisar-comisiones-';
  let repo: LineRepo;
  const actorOf = (u: Pick<User, 'id' | 'role' | 'name'>): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco', name: u.name, readOnly: false });
  beforeAll(async () => {
    setDbPrefix(P);
    const repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
    await seedEverything(openCoreRepo(P), repos, new Date());
    repo = repos.tabaco;
  });
  it('una comisión inflada sale con su motivo; el vendedor no ve esa marca', async () => {
    const users = await repo.users.all();
    const admin = users.find((u) => u.role === 'admin')!;
    const ctxA = lineCtx('tabaco', actorOf(admin), { repo });
    expect((await listCommissions(ctxA)).filter((x) => x.revisar)).toEqual([]);
    const c = (await repo.commissions.all()).find((x) => x.status === 'pagable' && x.salesReportId)!;
    await repo.commissions.put({ ...c, amount: c.amount + 500 });
    const lista = await listCommissions(ctxA);
    expect(lista.find((x) => x.id === c.id)?.revisar).toMatch(/serían/);
    expect(lista.filter((x) => x.revisar).map((x) => x.id)).toEqual([c.id]);
    const vendedor = users.find((u) => u.id === c.sellerId)!;
    expect((await listCommissions(lineCtx('tabaco', actorOf(vendedor), { repo }))).find((x) => x.id === c.id)?.revisar).toBeUndefined();
  });
});
