// Ronda 3 · recibir una importación bulto por bulto: leer la lista de empaque (columnas y
// productos), armar los bultos, confirmar cada uno, recibir lo contado (nunca en negativo) y las
// diferencias para reclamar a la fábrica. El flujo de antes (sin lista) sigue igual.
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Arrival, Bale, LineId, Product, User } from '../../src/data/types';
import type { LineRepo } from '../../src/data/repo';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import { WAREHOUSE, findNegative } from '../../src/domain/ledger';
import { type Actor, ForbiddenError } from '../../src/domain/permissions';
import {
  arrivalDifferences,
  baleStatusFor,
  detectPackingColumns,
  differencesCsv,
  groupIntoBales,
  itemsFromBales,
  matchPackingProduct,
  parseDescription,
  parsePackingList,
  receivedFromBales,
} from '../../src/domain/receiving';
import { differencesPdf } from '../../src/lib/differences-pdf';
import { seedEverything } from '../../src/seed';
import { listAudit } from '../../src/services/admin';
import { type Ctx, lineCtx } from '../../src/services/context';
import { loadInventory, nextArrivalFor, receiveArrival, setArrivalStatus } from '../../src/services/inventory';
import { checkBale, savePackingList, startBaleCheck } from '../../src/services/receiving';

const P = 'pruebas-recepcion-';
const NOW = new Date('2026-11-05T15:00:00Z');
let repo: LineRepo;
let cafeRepo: LineRepo;
let admin: Actor;
let seller: Actor;
let products: Product[];

const actorOf = (line: LineId, u: User, readOnly = false): Actor => ({ accountId: `${line}:${u.id}`, userId: u.id, role: u.role, line, storeId: u.storeId, name: u.name, readOnly });
const T = (a: Actor): Ctx => lineCtx('tabaco', a, { repo, now: () => NOW });
const bySku = (sku: string) => products.find((p) => p.sku === sku)!;

beforeAll(async () => {
  const repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  await seedEverything(openCoreRepo(P), repos, NOW);
  repo = repos.tabaco;
  cafeRepo = repos.cafe;
  const users = await repo.users.all();
  admin = actorOf('tabaco', users.find((u) => u.role === 'admin')!);
  seller = actorOf('tabaco', users.find((u) => u.name === 'Andrés Molina')!);
  products = await repo.products.all();
}, 60_000);

describe('columnas de la lista de empaque', () => {
  it('reconoce los encabezados de la fábrica en español', () => {
    const cols = detectPackingColumns(['Bulto', 'Medida o vitola', 'Capa', 'Mazos', 'Tabacos por mazo', 'Costo']);
    expect(cols).toEqual({ bale: 0, vitola: 1, capa: 2, qty: 3, perBundle: 4, cost: 5 });
  });
  it('y otras formas: en inglés, con número de bulto, cantidad entre paréntesis y costo total', () => {
    expect(detectPackingColumns(['Bale', 'Size', 'Wrapper', 'Qty', 'Cigars per bundle', 'Unit cost', 'Total'])).toEqual({ bale: 0, vitola: 1, capa: 2, qty: 3, perBundle: 4, cost: 5, costTotal: 6 });
    expect(detectPackingColumns(['No. Bulto', 'Código', 'Descripción', 'Cantidad (mazos)', 'Costo total USD'])).toEqual({ bale: 0, code: 1, name: 2, qty: 3, costTotal: 4 });
  });
});

describe('reconocer cada producto', () => {
  it('lee vitola, medida y capa de un texto libre', () => {
    const v = ['Toro', 'Torpedo', 'Robusto', 'Churchill', 'Petit corona', 'Corona'];
    expect(parseDescription('52 torpedo maduro', v)).toEqual({ ring: 52, vitola: 'torpedo', capa: 'maduro' });
    expect(parseDescription('6x52 Toro Habano', v)).toEqual({ length: 6, ring: 52, vitola: 'toro', capa: 'habano' });
    expect(parseDescription('6 1/8 × 52 TORPEDO natural', v)).toMatchObject({ length: 6.125, ring: 52, vitola: 'torpedo', capa: 'natural' });
    expect(parseDescription('Petit Corona 4½ x 42', v)).toMatchObject({ length: 4.5, ring: 42, vitola: 'petit corona' });
  });

  it('«52 torpedo maduro» y «6x52 Toro Habano» son los de mazo; «toro» no se confunde con «torpedo»', () => {
    expect(matchPackingProduct(products, { text: '52 torpedo maduro' }).productId).toBe(products.find((p) => p.name === 'Torpedo 6⅛ × 52 · Maduro')!.id);
    expect(matchPackingProduct(products, { text: '6x52 Toro Habano' }).productId).toBe(bySku('TB-MZ-TOR-HAB52').id);
    expect(matchPackingProduct(products, { text: 'Robusto maduro' }).productId).toBe(bySku('TB-MZ-ROB-MAD50').id);
  });

  it('por código de barras o SKU, con o sin guiones', () => {
    const chu = bySku('TB-MZ-CHU-CON48');
    expect(matchPackingProduct(products, { code: 'tb mz chu con48', text: '' })).toMatchObject({ productId: chu.id, how: 'codigo' });
    expect(matchPackingProduct(products, { code: chu.barcode!, text: 'cualquier cosa' })).toMatchObject({ productId: chu.id, how: 'codigo' });
  });

  it('lo que no reconoce (o con un solo dato) queda para elegir a mano', () => {
    expect(matchPackingProduct(products, { text: 'Lancero natural' }).productId).toBeNull();
    expect(matchPackingProduct(products, { text: 'maduro' }).productId).toBeNull();
    expect(matchPackingProduct(products, { text: 'maduro' }).candidates.length).toBeGreaterThan(1);
  });

  it('arma las líneas: el bulto vacío es el de arriba (mixto), salta totales y filas sin mazos', () => {
    const table = {
      headers: ['Bulto', 'Medida o vitola', 'Capa', 'Mazos', 'Tabacos por mazo', 'Costo'],
      rows: [
        ['1', '52 torpedo', 'maduro', '50', '25', '11.40'],
        ['2', '6x52 Toro', 'Habano', '45', '25', '10.50'],
        ['', '6x52 Toro', 'Maduro', '5', '25', '10,90'],
        ['Bulto 3', '5 x 50 robusto', 'habano', '48', '25', ''],
        ['4', 'Lancero', 'Natural', '40', '25', '9'],
        ['5', 'Toro', 'Habano', '', '25', ''],
        ['Total', '', '', '188', '', ''],
      ],
    };
    const r = parsePackingList(table, detectPackingColumns(table.headers), products);
    expect(r.lines.map((l) => [l.bale, l.qty])).toEqual([
      ['1', 50],
      ['2', 45],
      ['2', 5],
      ['3', 48],
      ['4', 40],
    ]);
    expect(r.lines[2]!.unitCost).toBe(10.9);
    expect(r.lines[3]!.unitCost).toBeUndefined();
    expect(r.lines[4]!.productId).toBeNull();
    expect(r.lines.slice(0, 4).every((l) => l.productId)).toBe(true);
    expect(r.skipped.map((s) => s.reason)).toEqual(['Sin cantidad de mazos', 'Fila de totales']);
  });

  it('con costo total por fila, saca el costo por mazo', () => {
    const table = { headers: ['Bulto', 'SKU', 'Mazos', 'Total'], rows: [['7', 'TB-MZ-CHU-HAB48', '40', '464']] };
    const r = parsePackingList(table, detectPackingColumns(table.headers), products);
    expect(r.lines[0]).toMatchObject({ bale: '7', qty: 40, unitCost: 11.6, how: 'codigo' });
  });
});

describe('bultos', () => {
  const lines = [
    { bale: '1', productId: 'a', qty: 50, unitCost: 10 },
    { bale: '2', productId: 'a', qty: 20, unitCost: 11 },
    { bale: '2', productId: 'b', qty: 25, unitCost: 8 },
    { bale: '2', productId: 'a', qty: 5, unitCost: 12 },
  ];
  it('agrupa por bulto, suma el mismo producto y promedia su costo', () => {
    const bales = groupIntoBales(lines);
    expect(bales).toHaveLength(2);
    expect(bales[1]!.items).toEqual([
      { productId: 'a', qty: 25, unitCost: 11.2 },
      { productId: 'b', qty: 25, unitCost: 8 },
    ]);
    const items = itemsFromBales(bales);
    expect(items).toEqual([
      { productId: 'a', qty: 75, unitCost: 10.4 },
      { productId: 'b', qty: 25, unitCost: 8 },
    ]);
  });

  it('el estado sale de lo contado; entra lo contado con el costo de sus bultos', () => {
    const [b1, b2] = groupIntoBales(lines).map((b, i) => ({ ...b, id: `b${i}`, status: 'pendiente' as const }));
    expect(baleStatusFor(b2!, { a: 25, b: 25 })).toBe('bien');
    expect(baleStatusFor(b2!, { a: 22, b: 26 })).toBe('falta');
    expect(baleStatusFor(b2!, { a: 25, b: 26 })).toBe('sobra');
    expect(baleStatusFor(b2!, { a: 25, b: 25 }, true)).toBe('danado');
    const checked: Bale[] = [
      { ...b1!, status: 'bien', counted: { a: 50 } },
      { ...b2!, status: 'falta', counted: { a: 22, b: 25 }, note: 'Faltan 3' },
    ];
    const got = receivedFromBales(checked);
    expect(got.find((g) => g.productId === 'a')).toEqual({ productId: 'a', expected: 75, qty: 72, unitCost: Math.round(((50 * 10 + 22 * 11.2) / 72) * 10000) / 10000 });
    const r = arrivalDifferences(checked);
    expect(r).toMatchObject({ checked: 2, total: 2, withIssues: 1, expected: 100, counted: 97, diff: -3, value: -33.6 });
    expect(r.rows.map((x) => [x.bale, x.productId, x.diff])).toEqual([
      ['2', 'a', -3],
      ['2', 'b', 0],
    ]);
  });
});

describe('confirmar bultos y recibir (servicios)', () => {
  let arrival: Arrival;
  const qty = async (productId: string) => (await loadInventory(T(admin))).balances.qty(WAREHOUSE, productId);

  it('la semilla trae una importación en aduana con lista de empaque (con bultos mixtos) y un contenedor a medio revisar', async () => {
    const all = await repo.arrivals.all();
    arrival = all.find((a) => a.status === 'aduana' && a.bales?.length)!;
    expect(arrival.bales).toHaveLength(12);
    expect(arrival.bales!.some((b) => b.items.length > 1)).toBe(true);
    expect(arrival.items).toEqual(itemsFromBales(arrival.bales!));
    const big = all.find((a) => a.status === 'confirmando')!;
    expect(big.bales).toHaveLength(147);
    expect(big.bales!.filter((b) => b.status !== 'pendiente')).toHaveLength(37);
    // Para los locales sigue «llegando»: cuenta para «llega en N días».
    expect(nextArrivalFor(all, big.items[0]!.productId, NOW)?.arrivalId).toBe(big.id);
  });

  it('con lista de empaque no se recibe sin confirmar los bultos', async () => {
    await expect(receiveArrival(T(admin), arrival.id)).rejects.toThrow(/Confirmar bultos/);
    await expect(startBaleCheck(T(seller), arrival.id)).rejects.toThrow(ForbiddenError);
    const a = await startBaleCheck(T(admin), arrival.id);
    expect(a.status).toBe('confirmando');
    expect(nextArrivalFor(await repo.arrivals.all(), a.items[0]!.productId, NOW)).toBeTruthy();
    await expect(receiveArrival(T(admin), arrival.id)).rejects.toThrow(/Faltan 12 bultos/);
  });

  it('cada bulto: «Bien», con falta (y nota) o dañado (pide nota); recibe lo contado, nunca en negativo', async () => {
    const bales = (await repo.arrivals.get(arrival.id))!.bales!;
    const short = bales.find((b) => b.items.length === 1)!;
    const item = short.items[0]!;
    const before = new Map<string, number>();
    for (const it of arrival.items) before.set(it.productId, await qty(it.productId));
    await expect(checkBale(T(admin), arrival.id, short.id, { damaged: true })).rejects.toThrow(/qué le pasó/);
    await expect(checkBale(T(admin), arrival.id, short.id, { counted: { 'otro-producto': 3 } })).rejects.toThrow(/no viene en el bulto/);
    const b = await checkBale(T(admin), arrival.id, short.id, { counted: { [item.productId]: item.qty - 3 }, note: 'Faltan 3 mazos, el bulto venía abierto' });
    expect(b.status).toBe('falta');
    await expect(savePackingList(T(admin), arrival.id, { bales: [{ number: '1', items: [{ productId: item.productId, qty: 1 }] }] })).rejects.toThrow(/mitad de camino/);
    for (const x of bales.filter((x) => x.id !== short.id)) await checkBale(T(admin), arrival.id, x.id, { bien: true });
    await receiveArrival(T(admin), arrival.id);
    const after = (await repo.arrivals.get(arrival.id))!;
    expect(after.status).toBe('recibida');
    for (const it of arrival.items) {
      const expected = it.productId === item.productId ? it.qty - 3 : it.qty;
      expect(await qty(it.productId), it.productId).toBe(before.get(it.productId)! + expected);
    }
    const lots = (await repo.lots.all()).filter((l) => l.arrivalId === arrival.id);
    expect(lots).toHaveLength(arrival.items.length);
    const moves = (await repo.movements.all()).filter((m) => m.refId === arrival.id && m.type === 'entrada');
    expect(moves.find((m) => m.productId === item.productId)?.reason).toBe(`Lista de empaque: ${arrival.items.find((i) => i.productId === item.productId)!.qty} · contado: ${arrival.items.find((i) => i.productId === item.productId)!.qty - 3}`);
    expect(findNegative(await repo.movements.all())).toBeNull();
    const r = arrivalDifferences(after.bales!);
    expect(r.diff).toBe(-3);
    expect(r.value).toBeCloseTo(-3 * item.unitCost, 2);
    const audit = await listAudit(T(admin));
    expect(audit.some((x) => x.action === 'bulto.revisar' && x.summary.includes('Faltan 3 mazos'))).toBe(true);
    expect(audit.some((x) => x.action === 'llegada.recibir' && x.entityId === arrival.id && x.summary.includes('faltaron 3'))).toBe(true);
  });

  it('cargar una lista a mano en otra importación recalcula lo que trae', async () => {
    const pending = (await repo.arrivals.all()).find((a) => a.status === 'transito')!;
    const toro = bySku('TB-MZ-TOR-HAB52');
    const a = await savePackingList(T(admin), pending.id, {
      bales: [
        { number: '1', items: [{ productId: toro.id, qty: 50, unitCost: 10 }] },
        { number: '2', items: [{ productId: toro.id, qty: 30, unitCost: 11 }, { productId: toro.id, qty: 10, unitCost: 11 }] },
      ],
    });
    expect(a.bales).toHaveLength(2);
    expect(a.bales![1]!.items).toEqual([{ productId: toro.id, qty: 40, unitCost: 11 }]);
    expect(a.items).toEqual([{ productId: toro.id, qty: 90, unitCost: 10.4444 }]);
    await expect(savePackingList(T(admin), pending.id, { bales: [{ number: '1', items: [{ productId: toro.id, qty: 1 }] }, { number: ' 1 ', items: [{ productId: toro.id, qty: 1 }] }] })).rejects.toThrow(/mismo número/);
    await expect(savePackingList(T(seller), pending.id, { bales: [{ number: '1', items: [{ productId: toro.id, qty: 1 }] }] })).rejects.toThrow(ForbiddenError);
    // Pasar a «Confirmando» a mano también pide la lista: sin ella, error claro.
    const other = (await repo.arrivals.all()).find((a) => a.status === 'produccion')!;
    await expect(setArrivalStatus(T(admin), other.id, 'confirmando')).rejects.toThrow(/lista de empaque/);
  });

  it('sin lista de empaque se recibe como antes (importación y tostado de café)', async () => {
    const other = (await repo.arrivals.all()).find((a) => a.status === 'produccion' && !a.bales?.length)!;
    const it = other.items[0]!;
    const before = await qty(it.productId);
    await receiveArrival(T(admin), other.id);
    expect(await qty(it.productId)).toBe(before + it.qty);
    const cafeUsers = await cafeRepo.users.all();
    const cAdmin = actorOf('cafe', cafeUsers.find((u) => u.role === 'admin')!);
    const C = lineCtx('cafe', cAdmin, { repo: cafeRepo, now: () => NOW });
    const roast = (await cafeRepo.arrivals.all()).find((a) => a.status !== 'recibida')!;
    await receiveArrival(C, roast.id);
    const lots = (await cafeRepo.lots.all()).filter((l) => l.arrivalId === roast.id);
    expect(lots.length).toBe(roast.items.length);
    expect(lots.every((l) => l.bestBefore)).toBe(true);
  });

  it('diferencias en CSV (con tildes para Excel) y en PDF', async () => {
    const a = (await repo.arrivals.get(arrival.id))!;
    const r = arrivalDifferences(a.bales!);
    const byId = new Map(products.map((p) => [p.id, p]));
    const info = (id: string) => ({ name: byId.get(id)!.name, sku: byId.get(id)!.sku, unitName: byId.get(id)!.unitName });
    const csv = differencesCsv(r, info, { code: a.code, supplier: a.supplier });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(`Diferencias de la importación ${a.code}`);
    expect(csv).toContain('Faltan 3 mazos, el bulto venía abierto');
    expect(csv).toMatch(/,-3,/);
    const pdf = await differencesPdf({ code: a.code, supplier: a.supplier, origin: a.originCountry, dateText: 'Recibida hoy', generatedText: 'Generado hoy', report: r, info });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
