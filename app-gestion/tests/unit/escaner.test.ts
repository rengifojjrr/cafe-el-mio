// Ronda 3 · escáner, etiquetas y trazabilidad: buscar por código (código de barras, SKU, caja,
// entrega), asignar un código sin repetir, cajas al recibir y al preparar, contar el almacén y
// las etiquetas en PDF.
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CaseUnit, Delivery, LineId, Product, Store, User } from '../../src/data/types';
import type { LineRepo } from '../../src/data/repo';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import { WAREHOUSE, findNegative } from '../../src/domain/ledger';
import { type Action, type Actor, ForbiddenError, can, isWrite } from '../../src/domain/permissions';
import { cleanCode, internalEan13 } from '../../src/lib/barcode';
import { labelsPdf } from '../../src/lib/labels-pdf';
import { seedEverything } from '../../src/seed';
import { listAudit } from '../../src/services/admin';
import { listCases, registerCases } from '../../src/services/cases';
import { assignBarcode, findByCode, lookupCode, traceCase } from '../../src/services/codes';
import { prepareDelivery, rejectDelivery, requestDelivery } from '../../src/services/consignment';
import { type Ctx, lineCtx } from '../../src/services/context';
import { loadInventory } from '../../src/services/inventory';
import { saveWarehouseCount } from '../../src/services/warehouse-count';

const P = 'pruebas-escaner-';
const NOW = new Date('2026-11-05T15:00:00Z');
let repo: LineRepo;
let users: User[];
let admin: Actor;
let seller: Actor;
let products: Product[];

const actorOf = (u: User, readOnly = false): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco' as LineId, storeId: u.storeId, name: u.name, readOnly });
const T = (a: Actor): Ctx => lineCtx('tabaco', a, { repo, now: () => NOW });
const bySku = (sku: string) => products.find((p) => p.sku === sku)!;

async function warehouseQty(productId: string): Promise<number> {
  return (await loadInventory(T(admin))).balances.qty(WAREHOUSE, productId);
}

beforeAll(async () => {
  const repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  await seedEverything(openCoreRepo(P), repos, NOW);
  repo = repos.tabaco;
  users = await repo.users.all();
  admin = actorOf(users.find((u) => u.role === 'admin')!);
  seller = actorOf(users.find((u) => u.name === 'Andrés Molina')!);
  products = await repo.products.all();
}, 60_000);

describe('permisos de la ronda 3 (almacén)', () => {
  const R3: Action[] = ['code.assign', 'case.write', 'arrival.confirm', 'warehouse.count', 'case.read', 'label.print'];
  it('son de administración; vendedor y local no; «ver como…» solo lee', () => {
    const store = actorOf(users.find((u) => u.role === 'store')!);
    for (const a of R3) {
      expect(can(admin, a, 'tabaco'), a).toBe(true);
      expect(can(admin, a, 'cafe'), `${a} en la otra línea`).toBe(false);
      expect(can(seller, a, 'tabaco'), a).toBe(false);
      expect(can(store, a, 'tabaco'), a).toBe(false);
    }
    const ro = { ...admin, readOnly: true };
    expect(['code.assign', 'case.write', 'arrival.confirm', 'warehouse.count'].every((a) => isWrite(a as Action) && !can(ro, a as Action, 'tabaco'))).toBe(true);
    expect(can(ro, 'case.read', 'tabaco')).toBe(true);
    expect(can(ro, 'label.print', 'tabaco')).toBe(true);
  });
});

describe('buscar por código', () => {
  it('encuentra un producto por su código de barras, con o sin espacios', async () => {
    const toro = bySku('TB-MZ-TOR-HAB52');
    expect(toro.barcode).toBe(internalEan13(1013));
    const m = await findByCode(T(admin), toro.barcode!);
    expect(m.kind).toBe('product');
    if (m.kind === 'product') {
      expect(m.product.id).toBe(toro.id);
      expect(m.by).toBe('barcode');
    }
    const spaced = `${toro.barcode!.slice(0, 1)} ${toro.barcode!.slice(1, 7)} ${toro.barcode!.slice(7)}`;
    expect((await findByCode(T(admin), spaced)).kind).toBe('product');
  });

  it('encuentra por SKU aunque se escriba sin guiones o en minúsculas', async () => {
    const toro = bySku('TB-MZ-TOR-HAB52');
    for (const typed of ['TB-MZ-TOR-HAB52', 'tbmztorhab52', 'tb mz tor hab52']) {
      const m = await findByCode(T(admin), typed);
      expect(m.kind, typed).toBe('product');
      if (m.kind === 'product') expect(m.by).toBe('sku');
    }
    expect(cleanCode('tb-mz-tor-hab52')).toBe('TBMZTORHAB52');
    expect((await findByCode(T(admin), 'TBMZTORHAB52')).kind === 'product' && toro.id).toBeTruthy();
  });

  it('el vendedor recibe el producto sin costo', async () => {
    const m = await findByCode(T(seller), bySku('TB-BIS-ROB50').barcode!);
    expect(m.kind).toBe('product');
    if (m.kind === 'product') expect('cost' in m.product).toBe(false);
  });

  it('una caja de una importación pasada: de dónde viene y a qué local fue', async () => {
    const cases = await repo.cases.all();
    expect(cases.length).toBeGreaterThan(20);
    const delivered = cases.find((c) => c.deliveryId)!;
    expect(delivered).toBeTruthy();
    const m = await findByCode(T(admin), delivered.code.toLowerCase());
    expect(m.kind).toBe('case');
    const trace = await traceCase(T(admin), delivered.id);
    expect(trace.arrival?.code).toBeTruthy();
    expect(trace.delivery?.id).toBe(delivered.deliveryId);
    expect(trace.storeName).toBeTruthy();
    expect(trace.caseUnit.factory).toMatch(/\(ejemplo\)/);
    expect(trace.caseUnit.roller).toBeTruthy();
    // El vendedor ve el producto de la caja, pero no a qué local fue.
    const sm = await findByCode(T(seller), delivered.code);
    expect(sm.kind).toBe('case');
    if (sm.kind === 'case') {
      expect(sm.caseUnit.deliveryId).toBeUndefined();
      expect(sm.caseUnit.storeId).toBeUndefined();
    }
    await expect(traceCase(T(seller), delivered.id)).rejects.toThrow(ForbiddenError);
    // Las cajas que siguen en el almacén no pasan de lo que queda del lote.
    for (const c of cases.filter((x) => !x.deliveryId)) expect(c.arrivalId).toBeTruthy();
  });

  it('administración encuentra una entrega por su código; el vendedor no', async () => {
    const d = (await repo.deliveries.all()).find((x) => x.status === 'entregada')!;
    const m = await lookupCode(T(admin), d.code);
    expect(m.kind).toBe('delivery');
    if (m.kind === 'delivery') expect(m.info.storeName).toBeTruthy();
    expect((await findByCode(T(seller), d.code)).kind).toBe('none');
    await expect(lookupCode(T(seller), d.code)).rejects.toThrow(ForbiddenError);
  });

  it('la etiqueta de un bulto lleva a su importación (solo administración)', async () => {
    const a = (await repo.arrivals.all()).find((x) => x.status === 'aduana' && x.bales?.length)!;
    const m = await findByCode(T(admin), `B-${a.code}-7`);
    expect(m).toMatchObject({ kind: 'arrival', baleNumber: '7' });
    if (m.kind === 'arrival') expect(m.arrival.id).toBe(a.id);
    expect((await findByCode(T(admin), a.code.toLowerCase())).kind).toBe('arrival');
    expect((await findByCode(T(seller), `B-${a.code}-7`)).kind).toBe('none');
  });

  it('un código que no existe', async () => {
    expect(await findByCode(T(admin), '2009999999994')).toEqual({ kind: 'none', code: '2009999999994' });
    expect((await findByCode(T(admin), '   ')).kind).toBe('none');
  });
});

describe('asignar un código a un producto', () => {
  it('guarda el código y lo deja en la auditoría', async () => {
    const p = bySku('TB-COR-PET42');
    const code = '7501234567893'; // EAN-13 válido, inventado
    const saved = await assignBarcode(T(admin), p.id, code);
    expect(saved.barcode).toBe(code);
    const m = await findByCode(T(admin), code);
    expect(m.kind === 'product' && m.product.id).toBe(p.id);
    const audit = await listAudit(T(admin));
    expect(audit.some((a) => a.action === 'producto.codigo' && a.entityId === p.id)).toBe(true);
  });

  it('no repite el código ni el SKU de otro producto, ni el número de una caja', async () => {
    const p = bySku('TB-COR-PET42');
    const other = bySku('TB-BIS-ROB50');
    await expect(assignBarcode(T(admin), p.id, other.barcode!)).rejects.toThrow(/ya es de Biscayne Robusto/);
    await expect(assignBarcode(T(admin), p.id, 'tb-bis-rob50')).rejects.toThrow(/ya es de/);
    const c = (await repo.cases.all())[0]!;
    await expect(assignBarcode(T(admin), p.id, c.code)).rejects.toThrow(/número de una caja/);
  });

  it('rechaza un EAN-13 con el dígito de control equivocado o un código muy corto', async () => {
    const p = bySku('TB-COR-PET42');
    await expect(assignBarcode(T(admin), p.id, '7501234567890')).rejects.toThrow(/no es un EAN-13 válido/);
    await expect(assignBarcode(T(admin), p.id, 'A1')).rejects.toThrow(/de 3 a 32/);
  });

  it('solo administración, y no en modo «ver como…»', async () => {
    const p = bySku('TB-COR-PET42');
    await expect(assignBarcode(T(seller), p.id, 'NUEVO123')).rejects.toThrow(ForbiddenError);
    await expect(assignBarcode(T({ ...admin, readOnly: true }), p.id, 'NUEVO123')).rejects.toThrow(ForbiddenError);
  });
});

describe('cajas con trazabilidad', () => {
  it('se registran con número automático o con el de su etiqueta, sin repetir', async () => {
    const arrival = (await repo.arrivals.all()).find((a) => a.status === 'recibida' && a.kind === 'import')!;
    const item = arrival.items[0]!;
    const before = (await listCases(T(admin), { arrivalId: arrival.id })).length;
    const made = await registerCases(T(admin), { arrivalId: arrival.id, productId: item.productId, count: 2, factory: 'Fábrica Las Lomas (ejemplo)', roller: 'Ana R.', packer: 'Rosa E.', packedOn: '2026-09-01' });
    expect(made).toHaveLength(2);
    expect(made[0]!.code).toBe(`C-${arrival.code}-${String(before + 1).padStart(4, '0')}`);
    const scanned = await registerCases(T(admin), { arrivalId: arrival.id, productId: item.productId, codes: ['ETQ-0001', 'etq 0002'], factory: 'Fábrica Las Lomas (ejemplo)' });
    expect(scanned.map((c) => c.code)).toEqual(['ETQ0001', 'ETQ0002']);
    await expect(registerCases(T(admin), { arrivalId: arrival.id, productId: item.productId, codes: ['ETQ0001'], factory: 'Fábrica Las Lomas (ejemplo)' })).rejects.toThrow(/ya está registrado/);
    await expect(registerCases(T(seller), { arrivalId: arrival.id, productId: item.productId, count: 1, factory: 'X (ejemplo)' })).rejects.toThrow(ForbiddenError);
    const other = products.find((p) => !arrival.items.some((i) => i.productId === p.id))!;
    await expect(registerCases(T(admin), { arrivalId: arrival.id, productId: other.id, count: 1, factory: 'X (ejemplo)' })).rejects.toThrow(/no viene en/);
  });

  it('al preparar escaneando: se prepara lo juntado y las cajas quedan con la entrega y el local', async () => {
    const stores = await repo.stores.all();
    const faro: Store = stores.find((s) => s.name === 'Tabaquería El Faro')!;
    const robusto = bySku('TB-BIS-ROB50');
    const pack = robusto.packSize;
    // Una caja que sigue en el almacén.
    const inWarehouse = (await repo.cases.all()).filter((c: CaseUnit) => c.productId === robusto.id && !c.deliveryId);
    expect(inWarehouse.length).toBeGreaterThan(0);
    const d: Delivery = await requestDelivery(T(admin), { storeId: faro.id, items: [{ productId: robusto.id, qty: pack * 3 }] });
    const r = await prepareDelivery(T(admin), d.id, { picked: { [robusto.id]: pack * 2 }, caseIds: [inWarehouse[0]!.id] });
    expect(r.prepared).toBe(pack * 2);
    expect(r.short).toBe(pack);
    const c = await repo.cases.get(inWarehouse[0]!.id);
    expect(c?.deliveryId).toBe(d.id);
    expect(c?.storeId).toBe(faro.id);
    // Rechazar la entrega suelta la caja.
    await rejectDelivery(T(admin), d.id, 'Prueba de rechazo');
    expect((await repo.cases.get(inWarehouse[0]!.id))?.deliveryId).toBeUndefined();
  });

  it('no deja ligar más cajas de las que entran en lo preparado', async () => {
    const stores = await repo.stores.all();
    const faro = stores.find((s) => s.name === 'Tabaquería El Faro')!;
    const robusto = bySku('TB-BIS-ROB50');
    const cases = (await repo.cases.all()).filter((c) => c.productId === robusto.id && !c.deliveryId);
    const extra = await registerCases(T(admin), { arrivalId: cases[0]!.arrivalId!, productId: robusto.id, count: 1, factory: 'Fábrica Las Lomas (ejemplo)' });
    const d = await requestDelivery(T(admin), { storeId: faro.id, items: [{ productId: robusto.id, qty: robusto.packSize }] });
    await expect(prepareDelivery(T(admin), d.id, { picked: { [robusto.id]: robusto.packSize }, caseIds: [cases[0]!.id, extra[0]!.id] })).rejects.toThrow(/más cajas/);
    // Nada quedó a medias: la entrega sigue por preparar.
    expect((await repo.deliveries.get(d.id))?.status).toBe('solicitada');
  });
});

describe('contar el almacén', () => {
  it('cada diferencia queda como ajuste «Conteo de almacén» y el almacén queda como se contó', async () => {
    const toro = bySku('TB-MZ-TOR-MAD52');
    const rob = bySku('TB-MZ-ROB-HAB50');
    const bis = bySku('TB-BIS-TOR52');
    const [a, b, c] = [await warehouseQty(toro.id), await warehouseQty(rob.id), await warehouseQty(bis.id)];
    expect(a).toBeGreaterThan(3);
    const r = await saveWarehouseCount(T(admin), {
      counts: [
        { productId: toro.id, counted: a - 3 },
        { productId: rob.id, counted: b + 2 },
        { productId: bis.id, counted: c },
      ],
    });
    expect(r.adjusted).toBe(2);
    expect(await warehouseQty(toro.id)).toBe(a - 3);
    expect(await warehouseQty(rob.id)).toBe(b + 2);
    expect(await warehouseQty(bis.id)).toBe(c);
    const moves = (await repo.movements.all()).filter((m) => m.refId === r.countId);
    expect(moves.length).toBeGreaterThanOrEqual(2);
    for (const m of moves) {
      expect(m.type).toBe('ajuste');
      expect(m.refType).toBe('count');
      expect(m.reason).toBe('Conteo de almacén');
    }
    expect(findNegative(await repo.movements.all())).toBeNull();
    const audit = await listAudit(T(admin));
    expect(audit.some((x) => x.action === 'almacen.conteo' && x.summary.includes('2 con diferencia'))).toBe(true);
  });

  it('contar cero deja el producto en cero sin pasar a negativo', async () => {
    const chu = bySku('TB-MZ-CHU-CON48');
    await saveWarehouseCount(T(admin), { counts: [{ productId: chu.id, counted: 0 }] });
    expect(await warehouseQty(chu.id)).toBe(0);
    expect(findNegative(await repo.movements.all())).toBeNull();
  });

  it('valida el conteo y solo lo guarda administración', async () => {
    const chu = bySku('TB-MZ-CHU-CON48');
    await expect(saveWarehouseCount(T(admin), { counts: [{ productId: chu.id, counted: -1 }] })).rejects.toThrow();
    await expect(saveWarehouseCount(T(admin), { counts: [] })).rejects.toThrow();
    await expect(saveWarehouseCount(T(seller), { counts: [{ productId: chu.id, counted: 1 }] })).rejects.toThrow(ForbiddenError);
  });
});

describe('etiquetas en PDF', () => {
  const spec = (code: string) => ({ title: 'Toro 6 × 52 · Maduro', lines: ['Toro · 6 × 52', 'Capa Maduro'], code, qr: 'https://ejemplo.test/#/tabaco/catalogo/t-prd_0014', copies: 1 });

  it('hoja carta: 30 etiquetas por página', async () => {
    const bytes = await labelsPdf([{ ...spec(internalEan13(1014)), copies: 31 }], 'carta');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    const { width, height } = doc.getPage(0).getSize();
    expect([width, height]).toEqual([612, 792]);
  });

  it('térmica: una etiqueta de 2″ × 1″ por página, también con Code 128 y medidas en fracción', async () => {
    const bytes = await labelsPdf([{ ...spec('TB-MZ-TOR-MAD52'), lines: ['Torpedo · 6⅛ × 52'], copies: 2 }, spec('C-IMP-2026-001-0001')], 'termica');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    const { width, height } = doc.getPage(0).getSize();
    expect([width, height]).toEqual([144, 72]);
  });

  it('sin etiquetas no arma nada', async () => {
    await expect(labelsPdf([{ ...spec('X1'), copies: 0 }], 'carta')).rejects.toThrow(/al menos una/);
  });
});
