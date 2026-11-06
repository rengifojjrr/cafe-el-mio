// Comisión progresiva (R3-7): escalones, tope, prioridad de reglas, cifras del mes y la única
// puerta que usan los servicios para crear comisiones.
import { beforeAll, describe, expect, it } from 'vitest';
import type { CommissionScheme, Product, Store, User } from '../../src/data/types';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import type { LineRepo } from '../../src/data/repo';
import {
  type CommissionMetrics,
  EMPTY_METRICS,
  commissionRate,
  metricAmountText,
  monthToDateMetrics,
  progressText,
  resolveCommissionRule,
  schemeProblem,
  statusAt,
} from '../../src/domain/commission-scheme';
import { type Actor, ForbiddenError } from '../../src/domain/permissions';
import { seedEverything } from '../../src/seed';
import { TABACO_SCHEME } from '../../src/seed/r3-red';
import { listProducts } from '../../src/services/catalog';
import { commissionRuleFor, saveLineCommissionScheme, saveSellerCommissionScheme, sellerCommissionStatus } from '../../src/services/commission-scheme';
import { reportSales } from '../../src/services/consignment';
import { lineCtx } from '../../src/services/context';

const m = (p: Partial<CommissionMetrics>): CommissionMetrics => ({ ...EMPTY_METRICS, ...p });

const SCHEME: CommissionScheme = {
  basePercent: 4,
  capPercent: 9,
  tiers: [
    { metric: 'locales', min: 3, percent: 5 },
    { metric: 'locales', min: 6, percent: 6 },
    { metric: 'cajas', min: 20, percent: 7 },
    { metric: 'unidades', min: 500, percent: 6.5 },
    { metric: 'ventas', min: 5000, percent: 8 },
    { metric: 'ventas', min: 9000, percent: 12 },
  ],
};

describe('commissionRate: escalones y tope', () => {
  it('sin llegar a nada: el % base y el siguiente escalón más cercano', () => {
    const r = commissionRate(SCHEME, m({ locales: 1 }));
    expect(r.percent).toBe(4);
    expect(r.tierReached).toBeNull();
    expect(r.next).toEqual({ metric: 'locales', missing: 2, percent: 5 });
  });

  it('cada métrica sube por su cuenta', () => {
    expect(commissionRate(SCHEME, m({ locales: 3 })).percent).toBe(5);
    expect(commissionRate(SCHEME, m({ locales: 6 })).percent).toBe(6);
    expect(commissionRate(SCHEME, m({ cajas: 20 })).percent).toBe(7);
    expect(commissionRate(SCHEME, m({ cajas: 19.99 })).percent).toBe(4);
    expect(commissionRate(SCHEME, m({ unidades: 500 })).percent).toBe(6.5);
    expect(commissionRate(SCHEME, m({ ventas: 5000 })).percent).toBe(8);
  });

  it('gana el escalón alcanzado con el % más alto, sin importar el orden', () => {
    const r = commissionRate(SCHEME, m({ locales: 7, cajas: 25, unidades: 600 }));
    expect(r.percent).toBe(7);
    expect(r.tierReached).toEqual({ metric: 'cajas', min: 20, percent: 7 });
    const reversed = commissionRate({ ...SCHEME, tiers: [...SCHEME.tiers].reverse() }, m({ locales: 7, cajas: 25, unidades: 600 }));
    expect(reversed.percent).toBe(7);
  });

  it('el tope nunca se pasa, aunque un escalón dé más', () => {
    const r = commissionRate(SCHEME, m({ ventas: 10_000 }));
    expect(r.percent).toBe(9);
    expect(r.next).toBeUndefined();
    // Si el siguiente escalón queda recortado por el tope, se anuncia con el tope.
    expect(commissionRate(SCHEME, m({ ventas: 6000 })).next).toEqual({ metric: 'ventas', missing: 3000, percent: 9 });
  });

  it('el siguiente es el que menos sube; a igual %, el que menos falta en proporción', () => {
    const s: CommissionScheme = { basePercent: 5, capPercent: 10, tiers: [{ metric: 'locales', min: 10, percent: 7 }, { metric: 'ventas', min: 1000, percent: 7 }] };
    expect(commissionRate(s, m({ locales: 9, ventas: 100 })).next).toEqual({ metric: 'locales', missing: 1, percent: 7 });
    expect(commissionRate(s, m({ locales: 1, ventas: 900 })).next).toEqual({ metric: 'ventas', missing: 100, percent: 7 });
  });

  it('un escalón que no supera el % base no cuenta', () => {
    const s: CommissionScheme = { basePercent: 6, capPercent: 10, tiers: [{ metric: 'locales', min: 1, percent: 5 }] };
    const r = commissionRate(s, m({ locales: 4 }));
    expect(r.percent).toBe(6);
    expect(r.tierReached).toBeNull();
  });

  it('textos: «Vas en el N % · con X más pasas al M %»', () => {
    expect(progressText(commissionRate(SCHEME, m({ locales: 1 })))).toBe('Vas en el 4 % · con 2 locales activos más pasas al 5 %');
    expect(progressText(commissionRate(SCHEME, m({ locales: 2 })))).toBe('Vas en el 4 % · con 1 local activo más pasas al 5 %');
    expect(progressText(commissionRate(SCHEME, m({ ventas: 9500 })))).toBe('Vas en el 9 % · es lo más alto de tu comisión');
    expect(metricAmountText('ventas', 1250)).toBe('$1,250 en ventas');
    expect(metricAmountText('cajas', 2.3)).toBe('3 cajas');
  });

  it('validación: tope ≥ base, escalones mayores que el base y sin repetir', () => {
    expect(schemeProblem(SCHEME)).toBeNull();
    expect(schemeProblem({ ...SCHEME, capPercent: 3 })).toMatch(/tope/);
    expect(schemeProblem({ ...SCHEME, tiers: [{ metric: 'locales', min: 2, percent: 3 }] })).toMatch(/más que el % base/);
    expect(schemeProblem({ ...SCHEME, tiers: [{ metric: 'locales', min: 0, percent: 6 }] })).toMatch(/mayor que cero/);
    expect(schemeProblem({ ...SCHEME, tiers: [{ metric: 'locales', min: 2.5, percent: 6 }] })).toMatch(/enteros/);
    expect(schemeProblem({ ...SCHEME, tiers: [SCHEME.tiers[0]!, SCHEME.tiers[0]!] })).toMatch(/iguales/);
  });
});

describe('resolveCommissionRule: qué regla manda', () => {
  const product = { sellerCommission: { type: 'percent' as const, value: 10 } };
  const custom = { sellerCommission: { type: 'fixed' as const, value: 0.4 }, commissionCustom: true };
  const seller = {};
  it('sin vendedor (venta directa): sin comisión', () => {
    expect(resolveCommissionRule({ product, seller: null, lineScheme: SCHEME, metrics: m({}) })).toBeNull();
    expect(resolveCommissionRule({ product, seller: undefined, metrics: m({}) })).toBeNull();
  });
  it('con esquema: el % del esquema, no el del producto', () => {
    expect(resolveCommissionRule({ product, seller, lineScheme: SCHEME, metrics: m({ locales: 3 }) })).toEqual({ type: 'percent', value: 5 });
  });
  it('producto con comisión propia: la suya, aunque haya esquema', () => {
    expect(resolveCommissionRule({ product: custom, seller, lineScheme: SCHEME, metrics: m({ ventas: 99_999 }) })).toEqual({ type: 'fixed', value: 0.4 });
  });
  it('el esquema propio del vendedor reemplaza al de la línea', () => {
    const own: CommissionScheme = { basePercent: 7.5, capPercent: 10, tiers: [] };
    expect(resolveCommissionRule({ product, seller: { commissionScheme: own }, lineScheme: SCHEME, metrics: m({ locales: 6 }) })).toEqual({ type: 'percent', value: 7.5 });
  });
  it('la comisión especial fija del vendedor manda sobre el esquema (no sobre la comisión propia del producto)', () => {
    const flat = { commissionOverride: { type: 'percent' as const, value: 3 } };
    expect(resolveCommissionRule({ product, seller: flat, lineScheme: SCHEME, metrics: m({ locales: 6 }) })).toEqual({ type: 'percent', value: 3 });
    expect(resolveCommissionRule({ product: custom, seller: flat, lineScheme: SCHEME, metrics: m({}) })).toEqual({ type: 'fixed', value: 0.4 });
  });
  it('sin esquema: la del producto, como antes', () => {
    expect(resolveCommissionRule({ product, seller, lineScheme: null, metrics: m({}) })).toEqual({ type: 'percent', value: 10 });
  });
});

describe('monthToDateMetrics: lo que lleva el vendedor en el mes', () => {
  const store = (id: string, sellerId: string, createdBy: string, history: [Store['status'], string][]) => ({
    id,
    sellerId,
    createdBy,
    status: history[history.length - 1]![0],
    statusHistory: history.map(([status, at]) => ({ status, at })),
  });
  const stores = [
    store('a', 's1', 's1', [['prospecto', '2026-09-01T12:00:00.000Z'], ['activo', '2026-09-10T12:00:00.000Z']]),
    store('b', 's1', 'adm', [['prospecto', '2026-10-01T12:00:00.000Z'], ['activo', '2026-11-03T12:00:00.000Z']]),
    // La registró s1 y hoy es de otro vendedor: igual cuenta para s1.
    store('c', 's2', 's1', [['prospecto', '2026-08-01T12:00:00.000Z'], ['activo', '2026-08-05T12:00:00.000Z']]),
    store('d', 's1', 's1', [['prospecto', '2026-08-01T12:00:00.000Z'], ['activo', '2026-08-05T12:00:00.000Z'], ['pausado', '2026-10-20T12:00:00.000Z']]),
  ];
  const reports = [
    { sellerId: 's1', at: '2026-10-31T23:00:00.000Z', lines: [{ productId: 'p20', qty: 20, unitPrice: 5 }] }, // 31 oct en Miami
    { sellerId: 's1', at: '2026-11-02T15:00:00.000Z', lines: [{ productId: 'p20', qty: 10, unitPrice: 5 }, { productId: 'mazo', qty: 3, unitPrice: 25 }] },
    { sellerId: 's1', at: '2026-11-05T15:00:00.000Z', lines: [{ productId: 'p20', qty: 40, unitPrice: 5 }] },
    { sellerId: 's2', at: '2026-11-02T15:00:00.000Z', lines: [{ productId: 'p20', qty: 99, unitPrice: 5 }] },
  ];
  const packSize = (id: string) => (id === 'p20' ? 20 : 50);
  const at = '2026-11-05T15:00:00.000Z';

  it('cuenta locales activos en ese momento (suyos o registrados por él)', () => {
    expect(monthToDateMetrics({ sellerId: 's1', at, stores, reports, packSize }).locales).toBe(3);
    expect(monthToDateMetrics({ sellerId: 's1', at: '2026-11-01T12:00:00.000Z', stores, reports, packSize }).locales).toBe(2);
    expect(statusAt(stores[3]!, '2026-10-01T00:00:00.000Z')).toBe('activo');
    expect(statusAt(stores[0]!, '2026-01-01T00:00:00.000Z')).toBe('prospecto');
  });

  it('solo ventas del mes (en Miami) anteriores a ese instante, sin la venta que se devenga', () => {
    const r = monthToDateMetrics({ sellerId: 's1', at, stores, reports, packSize });
    expect(r.unidades).toBe(13);
    expect(r.ventas).toBe(125);
    expect(r.cajas).toBe(0.56);
  });

  it('suma las facturas en firme del vendedor (sin impuesto) y no las de venta directa', () => {
    const r = monthToDateMetrics({
      sellerId: 's1',
      at,
      stores,
      reports,
      packSize,
      invoices: [
        { sellerId: 's1', issuedAt: '2026-11-04T15:00:00.000Z', subtotal: 1000, lines: [{ productId: 'mazo', qty: 50 }] },
        { sellerId: null, issuedAt: '2026-11-04T15:00:00.000Z', subtotal: 777, lines: [{ productId: 'mazo', qty: 50 }] },
      ],
    });
    expect(r.ventas).toBe(1125);
    expect(r.unidades).toBe(63);
    expect(r.cajas).toBe(1.56);
  });
});

// ---------- Servicios, con la semilla ----------

const NOW = new Date('2026-11-05T15:00:00Z');
const P = 'pruebas-comision-';
let repo: LineRepo;
let users: User[];
let products: Product[];
const actorOf = (u: User): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco', storeId: u.storeId, name: u.name, readOnly: false });
const ctxOf = (u: User, at = NOW) => lineCtx('tabaco', actorOf(u), { repo, now: () => at });
const byName = (name: string) => users.find((u) => u.name === name)!;

beforeAll(async () => {
  const repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  await seedEverything(openCoreRepo(P), repos, NOW);
  repo = repos.tabaco;
  users = await repo.users.all();
  products = await repo.products.all();
});

describe('commissionRuleFor: la única puerta', () => {
  it('con la comisión progresiva de la línea: el % según lo que lleva el vendedor', async () => {
    const admin = users.find((u) => u.role === 'admin')!;
    const andres = byName('Andrés Molina');
    const robusto = products.find((p) => p.name === 'Biscayne Robusto')!;
    const status = await sellerCommissionStatus(ctxOf(admin), andres.id);
    expect(status?.source).toBe('linea');
    const rule = await commissionRuleFor(ctxOf(admin), { sellerId: andres.id, product: robusto, at: NOW });
    expect(rule).toEqual({ type: 'percent', value: commissionRate(TABACO_SCHEME, status!.metrics).percent });
  });

  it('producto con comisión propia: la suya; sin vendedor: nada', async () => {
    const admin = users.find((u) => u.role === 'admin')!;
    const andres = byName('Andrés Molina');
    const corona = products.find((p) => p.sku === 'TB-EVE-COR42')!;
    expect(corona.commissionCustom).toBe(true);
    expect(await commissionRuleFor(ctxOf(admin), { sellerId: andres.id, product: corona, at: NOW })).toEqual(corona.sellerCommission);
    expect(await commissionRuleFor(ctxOf(admin), { sellerId: null, product: corona, at: NOW })).toBeNull();
  });

  it('el vendedor de Houston tiene su propia comisión progresiva', async () => {
    const tomas = byName('Tomás Garza');
    const s = await sellerCommissionStatus(ctxOf(tomas));
    expect(s?.source).toBe('vendedor');
    expect(s?.rate?.percent).toBeGreaterThanOrEqual(8);
  });

  it('al reportar una venta, la comisión nace con el % del esquema (y la del producto propio, con la suya)', async () => {
    const storeUser = users.find((u) => u.role === 'store' && u.name === 'Osvaldo Pérez')!;
    const andres = byName('Andrés Molina');
    const ctx = ctxOf(storeUser);
    const before = await sellerCommissionStatus(ctxOf(andres));
    const robusto = (await listProducts(ctx)).find((v) => v.product.name === 'Biscayne Robusto')!.product;
    const report = await reportSales(ctx, { storeId: storeUser.storeId!, items: [{ productId: robusto.id, qty: 2 }] });
    const comms = await repo.commissions.where('salesReportId', report.id);
    expect(comms).toHaveLength(1);
    expect(comms[0]!.rule).toEqual({ type: 'percent', value: before!.rate!.percent });
    expect(comms[0]!.amount).toBeCloseTo((2 * robusto.priceToStore * before!.rate!.percent) / 100, 2);
    // Lo ya devengado no se recalcula: la venta suma a las cifras del mes para la próxima.
    const after = await sellerCommissionStatus(ctxOf(andres, new Date(NOW.getTime() + 60_000)));
    expect(after!.metrics.ventas).toBeCloseTo(before!.metrics.ventas + 2 * robusto.priceToStore, 2);
  });

  it('el catálogo del vendedor muestra la comisión de hoy', async () => {
    const andres = byName('Andrés Molina');
    const status = await sellerCommissionStatus(ctxOf(andres));
    const list = await listProducts(ctxOf(andres));
    const robusto = list.find((v) => v.product.name === 'Biscayne Robusto')!;
    expect(robusto.sellerCommissionRule).toEqual({ type: 'percent', value: status!.rate!.percent });
    const corona = list.find((v) => v.product.sku === 'TB-EVE-COR42')!;
    expect(corona.sellerCommissionRule).toEqual({ type: 'fixed', value: 0.4 });
  });

  it('solo administración cambia la comisión progresiva; null vuelve a la de cada producto', async () => {
    const admin = users.find((u) => u.role === 'admin')!;
    const andres = byName('Andrés Molina');
    await expect(saveLineCommissionScheme(ctxOf(andres), TABACO_SCHEME)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveSellerCommissionScheme(ctxOf(andres), andres.id, TABACO_SCHEME)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveLineCommissionScheme(ctxOf(admin), { basePercent: 9, capPercent: 5, tiers: [] })).rejects.toThrow(/tope/);
    await saveSellerCommissionScheme(ctxOf(admin), andres.id, { basePercent: 9.5, capPercent: 9.5, tiers: [] });
    expect((await sellerCommissionStatus(ctxOf(andres)))?.rate?.percent).toBe(9.5);
    await saveSellerCommissionScheme(ctxOf(admin), andres.id, null);
    await saveLineCommissionScheme(ctxOf(admin), null);
    const robusto = products.find((p) => p.name === 'Biscayne Robusto')!;
    expect(await commissionRuleFor(ctxOf(admin), { sellerId: andres.id, product: robusto, at: NOW })).toEqual(robusto.sellerCommission);
    expect(await sellerCommissionStatus(ctxOf(andres))).toMatchObject({ source: null, rate: null });
    await saveLineCommissionScheme(ctxOf(admin), TABACO_SCHEME);
  });

  it('un vendedor no ve la comisión de otro', async () => {
    const andres = byName('Andrés Molina');
    const yanelis = byName('Yanelis Cruz');
    // Para el vendedor, siempre es la suya: el id que pida se ignora.
    expect((await sellerCommissionStatus(ctxOf(andres), yanelis.id))?.sellerId).toBe(andres.id);
  });
});
