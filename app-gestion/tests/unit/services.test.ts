// Servicios con Dexie real (fake-indexeddb) y la semilla completa: cada rol intenta lo
// prohibido y falla; los flujos de consignación, cobro y comisiones dejan el libro cuadrado.
import { beforeAll, describe, expect, it } from 'vitest';
import type { LineId, Product, Store, User } from '../../src/data/types';
import type { CoreRepo, LineRepo } from '../../src/data/repo';
import { setDbPrefix } from '../../src/data';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import { ComplianceError } from '../../src/domain/compliance';
import { WAREHOUSE, findNegative, storeLoc } from '../../src/domain/ledger';
import { type Actor, ForbiddenError } from '../../src/domain/permissions';
import { round2 } from '../../src/lib/money';
import { seedEverything } from '../../src/seed';
import { listAudit } from '../../src/services/admin';
import { inventoryValuation, mapData, pnlByMonth, reports } from '../../src/services/analytics';
import { getProduct, listProducts, saveProduct, setProductActive } from '../../src/services/catalog';
import {
  confirmReorder,
  createReorder,
  listDeliveries,
  listReorders,
  prepareDelivery,
  receiveDelivery,
  recordVisit,
  reportSales,
  requestDelivery,
  storeSalesHistory,
} from '../../src/services/consignment';
import { type Ctx, ValidationError, lineCtx } from '../../src/services/context';
import { contractsForStore, issueContract, signContract } from '../../src/services/contracts';
import { lineOverview } from '../../src/services/direccion';
import { listLots, listMovements, loadInventory, stockSummary } from '../../src/services/inventory';
import { generateSettlement, listCommissions, listPayouts, listSettlements, payCommissions, recordPayment } from '../../src/services/money';
import { listStores, loadStoreForActor, registerStore, setStoreStatus, storeConsignment } from '../../src/services/stores';

const P = 'pruebas-servicios-';
const NOW = new Date('2026-11-05T15:00:00Z');
const SIGNATURE = `data:image/png;base64,${'A'.repeat(400)}`;

let repos: Record<LineId, LineRepo>;
let core: CoreRepo;

let tAdmin: Actor;
let andres: Actor;
let yanelis: Actor;
let faroUser: Actor;
let humoUser: Actor;
let cAdmin: Actor;
let faro: Store;
let humo: Store;
let hoja: Store;
let bisRob: Product;
let bisToro: Product;
let eveTorp: Product;

function actorOf(line: LineId, u: User, readOnly = false): Actor {
  return { accountId: `${line}:${u.id}`, userId: u.id, role: u.role, line, storeId: u.storeId, name: u.name, readOnly };
}

function ctx(line: LineId, actor: Actor): Ctx {
  return lineCtx(line, actor, { repo: repos[line], now: () => NOW });
}
const T = (actor: Actor) => ctx('tabaco', actor);

async function storeQty(storeId: string, productId: string): Promise<number> {
  const snap = await loadInventory(T(tAdmin));
  return snap.balances.qty(storeLoc(storeId), productId);
}

async function warehouseQty(productId: string): Promise<number> {
  const snap = await loadInventory(T(tAdmin));
  return snap.balances.qty(WAREHOUSE, productId);
}

beforeAll(async () => {
  repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  core = openCoreRepo(P);
  await seedEverything(core, repos, NOW);

  const users = await repos.tabaco.users.all();
  const stores = await repos.tabaco.stores.all();
  const byName = (n: string) => {
    const s = stores.find((x) => x.name === n);
    if (!s) throw new Error(`falta el local ${n}`);
    return s;
  };
  faro = byName('Tabaquería El Faro');
  humo = byName('Licorería Humo y Ron');
  hoja = byName('Lounge La Hoja Dorada');
  tAdmin = actorOf('tabaco', users.find((u) => u.role === 'admin')!);
  andres = actorOf('tabaco', users.find((u) => u.name === 'Andrés Molina')!);
  yanelis = actorOf('tabaco', users.find((u) => u.name === 'Yanelis Cruz')!);
  faroUser = actorOf('tabaco', users.find((u) => u.storeId === faro.id)!);
  humoUser = actorOf('tabaco', users.find((u) => u.storeId === humo.id)!);
  const products = await repos.tabaco.products.all();
  const bySku = (sku: string) => products.find((p) => p.sku === sku)!;
  bisRob = bySku('TB-BIS-ROB50');
  bisToro = bySku('TB-BIS-TOR52');
  eveTorp = bySku('TB-EVE-TOR52');
  const cafeUsers = await repos.cafe.users.all();
  cAdmin = actorOf('cafe', cafeUsers.find((u) => u.role === 'admin')!);
}, 60_000);

describe('la semilla quedó en las dos bases', () => {
  it('cada línea tiene sus datos y ningún id se repite entre líneas', async () => {
    expect(await repos.tabaco.stores.count()).toBe(23);
    expect(await repos.cafe.stores.count()).toBe(15);
    const tIds = new Set([...(await repos.tabaco.products.all()), ...(await repos.tabaco.stores.all())].map((x) => x.id));
    const cIds = [...(await repos.cafe.products.all()), ...(await repos.cafe.stores.all())].map((x) => x.id);
    expect(cIds.filter((id) => tIds.has(id))).toEqual([]);
    expect(findNegative(await repos.tabaco.movements.all())).toBeNull();
    expect(findNegative(await repos.cafe.movements.all())).toBeNull();
    expect((await core.directory.all()).length).toBe(7);
  });
});

describe('permisos por rol (en la capa de servicios)', () => {
  it('un vendedor solo lista sus locales y no lee los de otro', async () => {
    const mine = await listStores(T(andres));
    const expected = (await repos.tabaco.stores.all()).filter((s) => s.sellerId === andres.userId);
    expect(mine.length).toBe(expected.length);
    expect(mine.every((v) => v.store.sellerId === andres.userId)).toBe(true);
    await expect(loadStoreForActor(T(andres), hoja.id)).rejects.toThrow(ForbiddenError);
    await expect(storeConsignment(T(andres), hoja.id)).rejects.toThrow(ForbiddenError);
    await expect(contractsForStore(T(andres), hoja.id)).rejects.toThrow(ForbiddenError);
    await expect(storeSalesHistory(T(andres), hoja.id)).rejects.toThrow(ForbiddenError);
    const map = await mapData(T(andres));
    expect(map.stores.every((s) => s.store.sellerId === andres.userId)).toBe(true);
    expect(map.sellers.every((s) => s.id === andres.userId)).toBe(true);
  });

  it('un local no lee otro local', async () => {
    const mine = await listStores(T(faroUser));
    expect(mine.map((v) => v.store.id)).toEqual([faro.id]);
    await expect(storeConsignment(T(faroUser), hoja.id)).rejects.toThrow(ForbiddenError);
    await expect(contractsForStore(T(faroUser), hoja.id)).rejects.toThrow(ForbiddenError);
    await expect(storeSalesHistory(T(faroUser), hoja.id)).rejects.toThrow(ForbiddenError);
    await expect(loadStoreForActor(T(faroUser), hoja.id)).rejects.toThrow(ForbiddenError);
    expect(await listSettlements(T(faroUser), { storeId: hoja.id })).toEqual([]);
    const own = await listSettlements(T(faroUser));
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((s) => s.storeId === faro.id)).toBe(true);
    expect((await listDeliveries(T(faroUser))).every((d) => d.storeId === faro.id)).toBe(true);
    expect((await listReorders(T(faroUser))).every((r) => r.storeId === faro.id)).toBe(true);
    expect((await contractsForStore(T(faroUser), faro.id)).length).toBeGreaterThan(0);
  });

  it('vendedor y local no ven costos; administración sí', async () => {
    for (const actor of [andres, faroUser]) {
      const list = await listProducts(T(actor));
      expect(list.length).toBeGreaterThan(0);
      for (const v of list) {
        expect('cost' in v.product).toBe(false);
        expect('sampleCost' in v.product).toBe(false);
      }
      const one = await getProduct(T(actor), bisRob.id);
      expect('cost' in one.product).toBe(false);
      await expect(listLots(T(actor))).rejects.toThrow(ForbiddenError);
      await expect(listMovements(T(actor))).rejects.toThrow(ForbiddenError);
      await expect(inventoryValuation(T(actor))).rejects.toThrow(ForbiddenError);
      await expect(pnlByMonth(T(actor))).rejects.toThrow(ForbiddenError);
      await expect(reports(T(actor))).rejects.toThrow(ForbiddenError);
    }
    const adminList = await listProducts(T(tAdmin));
    expect(adminList.every((v) => 'cost' in v.product && typeof (v.product as Product).cost === 'number')).toBe(true);

    const sellerSales = await storeSalesHistory(T(andres), faro.id);
    expect(sellerSales.length).toBeGreaterThan(0);
    expect(sellerSales.every((r) => r.lines.every((l) => l.cost === 0 && l.lots.length === 0))).toBe(true);
    const adminSales = await storeSalesHistory(T(tAdmin), faro.id);
    expect(adminSales.some((r) => r.lines.some((l) => l.cost > 0))).toBe(true);
  });

  it('el local ve lo que gana por producto, pero no la comisión del vendedor', async () => {
    const forStore = await listProducts(T(faroUser));
    expect(forStore.every((v) => v.storeEarning >= 0 && v.sellerCommissionPerUnit === undefined)).toBe(true);
    const forSeller = await listProducts(T(andres));
    expect(forSeller.every((v) => typeof v.sellerCommissionPerUnit === 'number')).toBe(true);
    await expect(listCommissions(T(faroUser))).rejects.toThrow(ForbiddenError);
  });

  it('un vendedor no lee comisiones de otro vendedor ni paga comisiones', async () => {
    const mine = await listCommissions(T(andres));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c) => c.sellerId === andres.userId)).toBe(true);
    await expect(listCommissions(T(andres), { sellerId: yanelis.userId })).rejects.toThrow(ForbiddenError);
    await expect(payCommissions(T(andres), andres.userId, { method: 'zelle', reference: 'ZL-1' })).rejects.toThrow(ForbiddenError);
    expect((await listPayouts(T(andres))).every((p) => p.sellerId === andres.userId)).toBe(true);
    const forAdmin = await listCommissions(T(tAdmin), { sellerId: yanelis.userId });
    expect(forAdmin.length).toBeGreaterThan(0);
    expect(forAdmin.every((c) => c.sellerId === yanelis.userId)).toBe(true);
  });

  it('«ver como…» deja mirar pero no escribir', async () => {
    const view = { ...andres, readOnly: true };
    expect((await listStores(T(view))).length).toBeGreaterThan(0);
    await expect(
      registerStore(T(view), {
        name: 'Tienda de prueba',
        type: 'Tabaquería',
        address: '123 Calle de prueba',
        city: 'Hialeah, FL',
        zoneId: faro.zoneId,
        lat: 25.86,
        lng: -80.28,
        managerName: 'Encargado de prueba',
        phone: '(305) 555-0199',
        email: '',
        tobaccoPermit: { number: 'TP-PRUEBA-1', expiresOn: '2027-06-01' },
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(requestDelivery(T(view), { storeId: faro.id, items: [{ productId: bisRob.id, qty: 20 }] })).rejects.toThrow(ForbiddenError);
    const adminView = { ...tAdmin, readOnly: true };
    expect((await listProducts(T(adminView))).length).toBeGreaterThan(0);
    await expect(setProductActive(T(adminView), bisRob.id, false)).rejects.toThrow(ForbiddenError);
  });
});

describe('separación de líneas', () => {
  it('una cuenta de tabaco no lee ni escribe nada de café', async () => {
    const cross = ctx('cafe', tAdmin);
    await expect(listProducts(cross)).rejects.toThrow(/otra línea/);
    await expect(listStores(cross)).rejects.toThrow(ForbiddenError);
    await expect(stockSummary(cross)).rejects.toThrow(ForbiddenError);
    await expect(listSettlements(cross)).rejects.toThrow(ForbiddenError);
    const cafeStore = (await repos.cafe.stores.all())[0]!;
    await expect(storeConsignment(ctx('cafe', faroUser), cafeStore.id)).rejects.toThrow(ForbiddenError);
    await expect(
      saveProduct(cross, {
        sku: 'CF-INTRUSO',
        name: 'Intruso',
        brandLine: 'Prueba',
        cost: 1,
        priceToStore: 2,
        suggestedRetail: 3,
        sellerCommission: { type: 'percent', value: 5 },
        lowStockThreshold: 1,
        packSize: 1,
        unitName: 'unidad',
        attrs: {},
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('un producto creado en tabaco nunca aparece en café', async () => {
    const p = await saveProduct(T(tAdmin), {
      sku: 'TB-PRUEBA-001',
      name: 'Robusto de prueba',
      brandLine: 'Prueba',
      cost: 2,
      priceToStore: 5,
      suggestedRetail: 9,
      sellerCommission: { type: 'percent', value: 8 },
      lowStockThreshold: 10,
      packSize: 20,
      unitName: 'tabaco',
      attrs: {
        vitola: 'Robusto',
        lengthIn: 5,
        ringGauge: 50,
        wrapper: 'Connecticut Shade (Ecuador)',
        capa: 'connecticut',
        originCountry: 'Nicaragua',
        strength: 'suave',
      },
    });
    expect((await listProducts(T(tAdmin))).some((v) => v.product.id === p.id)).toBe(true);
    const cafeList = await listProducts(ctx('cafe', cAdmin));
    expect(cafeList.some((v) => v.product.id === p.id || v.product.sku === 'TB-PRUEBA-001')).toBe(false);
    expect(await repos.cafe.products.get(p.id)).toBeUndefined();
    expect((await repos.cafe.products.all()).some((x) => x.sku === 'TB-PRUEBA-001')).toBe(false);
    expect((await repos.cafe.audit.all()).some((a) => a.entityId === p.id)).toBe(false);
  });

  it('no se registra tabaco de origen Cuba', async () => {
    await expect(
      saveProduct(T(tAdmin), {
        sku: 'TB-PRUEBA-CUBA',
        name: 'No permitido',
        brandLine: 'Prueba',
        cost: 2,
        priceToStore: 5,
        suggestedRetail: 9,
        sellerCommission: { type: 'percent', value: 8 },
        lowStockThreshold: 10,
        packSize: 20,
        unitName: 'tabaco',
        attrs: { vitola: 'Robusto', lengthIn: 5, ringGauge: 50, capa: 'habano', originCountry: 'Cuba', strength: 'media' },
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('consignación de tabaco', () => {
  it('sin permiso de tabaco vigente no se consigna ni se pide', async () => {
    await expect(requestDelivery(T(andres), { storeId: humo.id, items: [{ productId: bisRob.id, qty: 20 }] })).rejects.toThrow(ComplianceError);
    await expect(requestDelivery(T(tAdmin), { storeId: humo.id, items: [{ productId: bisRob.id, qty: 20 }] })).rejects.toThrow(ComplianceError);
    await expect(createReorder(T(humoUser), { storeId: humo.id, items: [{ productId: bisRob.id, qty: 20 }] })).rejects.toThrow(/permiso/);
    expect((await repos.tabaco.deliveries.all()).some((d) => d.storeId === humo.id && d.status === 'solicitada')).toBe(false);
  });

  it('solicitar → preparar → entregar con firma mueve el stock y deja auditoría', async () => {
    const wh0 = await warehouseQty(bisRob.id);
    const st0 = await storeQty(faro.id, bisRob.id);
    const audit0 = await repos.tabaco.audit.count();
    const d = await requestDelivery(T(andres), { storeId: faro.id, items: [{ productId: bisRob.id, qty: 40 }] });
    expect(d.status).toBe('solicitada');
    await expect(prepareDelivery(T(andres), d.id)).rejects.toThrow(ForbiddenError);
    const prep = await prepareDelivery(T(tAdmin), d.id);
    expect(prep.prepared).toBe(40);
    expect(prep.short).toBe(0);
    expect(prep.delivery.status).toBe('preparada');
    const line = (await stockSummary(T(tAdmin))).lines.get(bisRob.id)!;
    expect(line.reserved).toBeGreaterThanOrEqual(40);
    expect(line.available).toBe(Math.max(0, line.warehouse - line.reserved));
    expect(await warehouseQty(bisRob.id)).toBe(wh0);

    const done = await receiveDelivery(T(andres), d.id, { name: 'Osvaldo Pérez', image: SIGNATURE });
    expect(done.status).toBe('entregada');
    expect(done.receivedSignature?.name).toBe('Osvaldo Pérez');
    expect(await warehouseQty(bisRob.id)).toBe(wh0 - 40);
    expect(await storeQty(faro.id, bisRob.id)).toBe(st0 + 40);
    expect(await repos.tabaco.audit.count()).toBeGreaterThanOrEqual(audit0 + 3);
    await expect(receiveDelivery(T(andres), d.id, { name: 'Osvaldo Pérez', image: SIGNATURE })).rejects.toThrow(ValidationError);
    expect(findNegative(await repos.tabaco.movements.all())).toBeNull();
  });

  it('preparar más de lo que hay: se prepara lo disponible y el resto queda como demanda no atendida', async () => {
    const before = (await stockSummary(T(tAdmin))).lines.get(eveTorp.id)!;
    const available = before.available;
    const d = await requestDelivery(T(andres), {
      storeId: faro.id,
      items: [
        { productId: eveTorp.id, qty: available + 25 },
        { productId: bisToro.id, qty: 20 },
      ],
    });
    const prep = await prepareDelivery(T(tAdmin), d.id);
    expect(prep.delivery.status).toBe('preparada');
    expect(prep.short).toBe(25);
    expect(prep.prepared).toBe(available + 20);
    expect(prep.delivery.items.find((i) => i.productId === eveTorp.id)?.preparedQty).toBe(available);
    const unmet = (await repos.tabaco.unmetDemand.all()).filter((u) => u.refId === d.id);
    expect(unmet).toHaveLength(1);
    expect(unmet[0]).toMatchObject({ productId: eveTorp.id, qty: 25, storeId: faro.id, source: 'entrega' });
  });

  it('si no hay nada, la entrega sigue pendiente y la falta se registra una sola vez', async () => {
    const line = (await stockSummary(T(tAdmin))).lines.get(eveTorp.id)!;
    expect(line.available).toBe(0);
    const d = await requestDelivery(T(andres), { storeId: faro.id, items: [{ productId: eveTorp.id, qty: 10 }] });
    const first = await prepareDelivery(T(tAdmin), d.id);
    expect(first.prepared).toBe(0);
    expect(first.delivery.status).toBe('solicitada');
    expect((await repos.tabaco.deliveries.get(d.id))?.status).toBe('solicitada');
    await prepareDelivery(T(tAdmin), d.id);
    const unmet = (await repos.tabaco.unmetDemand.all()).filter((u) => u.refId === d.id);
    expect(unmet).toHaveLength(1);
    expect(unmet[0]?.qty).toBe(10);
  });

  it('visita: contar más de lo colocado falla; contar menos genera venta y comisiones', async () => {
    const lines = await storeConsignment(T(andres), faro.id);
    const target = lines.find((l) => l.qty >= 3)!;
    expect(target).toBeDefined();
    await expect(recordVisit(T(andres), { storeId: faro.id, counts: [{ productId: target.productId, counted: target.qty + 1 }] })).rejects.toThrow(ValidationError);
    expect(await storeQty(faro.id, target.productId)).toBe(target.qty);
    await expect(recordVisit(T(yanelis), { storeId: faro.id, counts: [{ productId: target.productId, counted: 0 }] })).rejects.toThrow(ForbiddenError);

    const { visit, report } = await recordVisit(T(andres), { storeId: faro.id, counts: [{ productId: target.productId, counted: target.qty - 2 }] });
    expect(visit.counts[0]).toMatchObject({ expected: target.qty, counted: target.qty - 2 });
    expect(report).toBeDefined();
    expect(report!.lines).toEqual([expect.objectContaining({ productId: target.productId, qty: 2, unitPrice: target.priceToStore })]);
    expect(report!.total).toBe(round2(2 * target.priceToStore));
    const comms = await repos.tabaco.commissions.where('salesReportId', report!.id);
    expect(comms).toHaveLength(1);
    expect(comms[0]).toMatchObject({ sellerId: andres.userId, storeId: faro.id, qty: 2, status: 'devengada' });
    expect(comms[0]!.amount).toBeGreaterThan(0);
    expect(await storeQty(faro.id, target.productId)).toBe(target.qty - 2);
  });

  it('el local pide → el vendedor confirma → queda una entrega solicitada ligada al pedido', async () => {
    const r = await createReorder(T(faroUser), { storeId: faro.id, items: [{ productId: bisRob.id, qty: 20 }], note: 'Prueba' });
    expect(r.status).toBe('enviado');
    expect(r.sellerId).toBe(andres.userId);
    const notes = await repos.tabaco.notifications.where('userId', andres.userId);
    expect(notes.some((n) => n.kind === 'pedido_nuevo' && n.title.includes(faro.name))).toBe(true);
    expect((await listReorders(T(andres), { open: true })).some((x) => x.id === r.id)).toBe(true);

    await expect(confirmReorder(T(yanelis), r.id)).rejects.toThrow(ForbiddenError);
    await expect(confirmReorder(T(faroUser), r.id)).rejects.toThrow(ForbiddenError);
    const d = await confirmReorder(T(andres), r.id);
    expect(d).toMatchObject({ status: 'solicitada', reorderId: r.id, origin: 'pedido_local', storeId: faro.id });
    const saved = await repos.tabaco.reorders.get(r.id);
    expect(saved?.status).toBe('confirmado');
    expect(saved?.deliveryId).toBe(d.id);
    await expect(confirmReorder(T(andres), r.id)).rejects.toThrow(ValidationError);
  });
});

describe('registrar tienda → contrato y firma → colocar producto', () => {
  const input = (permit: boolean) => ({
    name: 'Tabaquería Prueba 77',
    type: 'Tabaquería',
    address: '7700 Avenida Ejemplo (dirección de ejemplo)',
    city: 'Hialeah, FL',
    zoneId: faro.zoneId,
    lat: 25.861,
    lng: -80.281,
    managerName: 'Encargada de Prueba',
    phone: '(305) 555-0177',
    email: 'prueba77@example.com',
    hours: 'Lun–Sáb 10:00–20:00',
    sellerId: yanelis.userId,
    tobaccoPermit: permit ? { number: 'TP-PRUEBA-77', expiresOn: '2027-08-01' } : undefined,
  });
  let storeId = '';

  it('el vendedor registra la tienda a su nombre; en tabaco el permiso es obligatorio', async () => {
    await expect(registerStore(T(andres), input(false))).rejects.toThrow(/permiso/);
    await expect(registerStore(T(faroUser), input(true))).rejects.toThrow(ForbiddenError);
    const s = await registerStore(T(andres), input(true));
    storeId = s.id;
    expect(s.status).toBe('prospecto');
    expect(s.sellerId).toBe(andres.userId);
    const adminNotes = await repos.tabaco.notifications.where('userId', tAdmin.userId);
    expect(adminNotes.some((n) => n.kind === 'local_por_aprobar' && n.title.includes('Prueba 77'))).toBe(true);
    expect((await listStores(T(andres))).some((v) => v.store.id === s.id)).toBe(true);
    expect((await listStores(T(yanelis))).some((v) => v.store.id === s.id)).toBe(false);
  });

  it('solo administración cambia el estado, y solo por pasos permitidos', async () => {
    await expect(setStoreStatus(T(andres), storeId, 'activo')).rejects.toThrow(ForbiddenError);
    await expect(setStoreStatus(T(tAdmin), storeId, 'activo')).rejects.toThrow(ValidationError);
    await expect(requestDelivery(T(andres), { storeId, items: [{ productId: bisRob.id, qty: 20 }] })).rejects.toThrow(/contrato/);
  });

  it('se emite el contrato con sus datos y volver a emitir anula el anterior', async () => {
    await expect(issueContract(T(yanelis), storeId)).rejects.toThrow(ForbiddenError);
    const v1 = await issueContract(T(andres), storeId);
    expect(v1).toMatchObject({ status: 'enviado', version: 1, templateVersion: 1 });
    expect(v1.body).toContain('Tabaquería Prueba 77');
    expect(v1.body).toContain('TP-PRUEBA-77');
    expect(v1.body).toContain('Andrés Molina');
    expect(v1.body).not.toContain('[falta:');
    expect(v1.annex.length).toBeGreaterThan(0);
    expect((await repos.tabaco.stores.get(storeId))?.status).toBe('contrato_enviado');
    const v2 = await issueContract(T(andres), storeId);
    expect(v2.version).toBe(2);
    expect((await repos.tabaco.contracts.get(v1.id))?.status).toBe('anulado');
  });

  it('firman encargado y vendedor, con consentimiento; queda firmado y avisa a administración', async () => {
    const [contract] = (await contractsForStore(T(andres), storeId)).filter((c) => c.status === 'enviado');
    expect(contract).toBeDefined();
    const sig = { local: { name: 'Encargada de Prueba', image: SIGNATURE }, empresa: { name: 'Andrés Molina', image: SIGNATURE } };
    await expect(signContract(T(andres), contract!.id, { ...sig, consent: false })).rejects.toThrow(/firmar electrónicamente/);
    await expect(signContract(T(andres), contract!.id, { ...sig, local: { name: 'Encargada de Prueba', image: '' }, consent: true })).rejects.toThrow();
    await expect(signContract(T(yanelis), contract!.id, { ...sig, consent: true })).rejects.toThrow(ForbiddenError);
    const signed = await signContract(T(andres), contract!.id, { ...sig, consent: true });
    expect(signed.status).toBe('firmado');
    expect(signed.signatures.map((s) => s.role).sort()).toEqual(['empresa', 'local']);
    expect(signed.signatures.every((s) => s.signedAt === NOW.toISOString() && s.deviceUserId === andres.userId)).toBe(true);
    expect((await repos.tabaco.stores.get(storeId))?.status).toBe('firmado');
    const adminNotes = await repos.tabaco.notifications.where('userId', tAdmin.userId);
    expect(adminNotes.some((n) => n.kind === 'contrato_firmado' && n.title.includes('Prueba 77'))).toBe(true);
    await expect(signContract(T(andres), contract!.id, { ...sig, consent: true })).rejects.toThrow(ValidationError);
  });

  it('colocar producto: administración aprueba el local al preparar y el local recibe con firma', async () => {
    const d = await requestDelivery(T(andres), { storeId, items: [{ productId: bisRob.id, qty: 20 }] });
    await expect(prepareDelivery(T(tAdmin), d.id)).rejects.toThrow(/aprobado/);
    const prep = await prepareDelivery(T(tAdmin), d.id, { approveStore: true });
    expect(prep.delivery.status).toBe('preparada');
    expect((await repos.tabaco.stores.get(storeId))?.status).toBe('activo');
    const accounts = await repos.tabaco.users.where('storeId', storeId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ role: 'store', name: 'Encargada de Prueba' });
    const storeActor = actorOf('tabaco', accounts[0]!);
    await receiveDelivery(T(storeActor), d.id, { name: 'Encargada de Prueba', image: SIGNATURE });
    expect(await storeQty(storeId, bisRob.id)).toBe(20);
    await expect(setStoreStatus(T(tAdmin), storeId, 'cerrado')).rejects.toThrow(/devolución/);
  });
});

describe('consignación de café', () => {
  it('no pide permiso de tabaco y entrega primero lo que vence antes (FEFO)', async () => {
    const C = (a: Actor) => ctx('cafe', a);
    const stores = await repos.cafe.stores.all();
    const store = stores.find((x) => x.status === 'activo' && !x.tobaccoPermit)!;
    const elmio = (await repos.cafe.products.all()).find((p) => p.sku === 'CF-ELMIO-10OZ')!;
    const snap0 = await loadInventory(C(cAdmin));
    const lots = snap0.balances
      .lots(WAREHOUSE, elmio.id)
      .map((l) => ({ ...l, bestBefore: snap0.lotsById.get(l.lotId)?.bestBefore ?? '9999' }))
      .sort((a, b) => a.bestBefore.localeCompare(b.bestBefore));
    expect(lots.length).toBeGreaterThan(1);
    const qty = Math.min(12, lots[0]!.qty);
    const d = await requestDelivery(C(cAdmin), { storeId: store.id, items: [{ productId: elmio.id, qty }] });
    await prepareDelivery(C(cAdmin), d.id);
    await receiveDelivery(C(cAdmin), d.id, { name: store.managerName, image: SIGNATURE });
    const out = (await repos.cafe.movements.where('storeId', store.id)).filter((m) => m.refId === d.id);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((m) => m.type === 'salida_consignacion' && m.lotId === lots[0]!.lotId)).toBe(true);
    expect(out.reduce((a, m) => a + m.qty, 0)).toBe(qty);
    expect(findNegative(await repos.cafe.movements.all())).toBeNull();
    // Nada de esto tocó la base de tabaco.
    expect((await repos.tabaco.deliveries.get(d.id))).toBeUndefined();
  });
});

describe('cobros y comisiones', () => {
  it('liquidar, registrar el pago y pagar comisiones', async () => {
    const sold = await reportSales(T(faroUser), { storeId: faro.id, items: [{ productId: bisRob.id, qty: 1 }] });
    expect(sold.source).toBe('local');
    await expect(generateSettlement(T(andres), faro.id)).rejects.toThrow(ForbiddenError);

    const s = await generateSettlement(T(tAdmin), faro.id);
    expect(s.amount).toBeGreaterThan(0);
    expect(s.salesReportIds).toContain(sold.id);
    expect(s.status).toBe('pendiente');
    const comms = await repos.tabaco.commissions.where('settlementId', s.id);
    expect(comms.length).toBeGreaterThan(0);
    expect(comms.every((c) => c.status === 'devengada')).toBe(true);
    await expect(generateSettlement(T(tAdmin), faro.id)).rejects.toThrow(ValidationError);

    await expect(recordPayment(T(andres), s.id, { amount: 1, method: 'efectivo' })).rejects.toThrow(ForbiddenError);
    await expect(recordPayment(T(tAdmin), s.id, { amount: round2(s.amount + 1), method: 'efectivo' })).rejects.toThrow(/saldo/);
    await expect(recordPayment(T(tAdmin), s.id, { amount: 1, method: 'zelle', reference: '' })).rejects.toThrow(/referencia/);

    await recordPayment(T(tAdmin), s.id, { amount: 1, method: 'cheque', reference: 'CHK 1001' });
    expect((await repos.tabaco.settlements.get(s.id))?.status).toBe('parcial');
    expect((await repos.tabaco.commissions.where('settlementId', s.id)).every((c) => c.status === 'devengada')).toBe(true);

    await recordPayment(T(tAdmin), s.id, { amount: round2(s.amount - 1), method: 'zelle', reference: 'ZL-123456' });
    const paid = await repos.tabaco.settlements.get(s.id);
    expect(paid?.status).toBe('pagada');
    expect(paid?.paid).toBe(s.amount);
    expect((await repos.tabaco.payments.where('settlementId', s.id)).length).toBe(2);
    const payable = await repos.tabaco.commissions.where('settlementId', s.id);
    expect(payable.every((c) => c.status === 'pagable' && c.payableAt)).toBe(true);

    const payout = await payCommissions(T(tAdmin), andres.userId, { method: 'zelle', reference: 'ZL-777' });
    expect(payout.amount).toBeGreaterThanOrEqual(round2(payable.reduce((a, c) => a + c.amount, 0)));
    const after = await repos.tabaco.commissions.where('settlementId', s.id);
    expect(after.every((c) => c.status === 'pagada' && c.payoutId === payout.id)).toBe(true);
    expect((await repos.tabaco.commissions.where('sellerId', andres.userId)).some((c) => c.status === 'pagable')).toBe(false);
    await expect(payCommissions(T(tAdmin), andres.userId, { method: 'efectivo' })).rejects.toThrow(ValidationError);
  });
});

describe('auditoría', () => {
  it('solo se le agrega: no hay ni actualizar ni borrar', async () => {
    const log = repos.tabaco.audit as unknown as Record<string, unknown>;
    for (const fn of ['append', 'bulkAppend', 'all', 'count']) expect(typeof log[fn]).toBe('function');
    for (const fn of ['put', 'bulkPut', 'remove', 'delete', 'update', 'clear', 'get', 'where']) expect(log[fn]).toBeUndefined();
  });

  it('cada cambio deja quién lo hizo y cuándo; solo administración la ve', async () => {
    const candela = (await repos.tabaco.products.all()).find((p) => p.sku === 'TB-BRI-CAN46')!;
    const before = await repos.tabaco.audit.count();
    await setProductActive(T(tAdmin), candela.id, false);
    await setProductActive(T(tAdmin), candela.id, true);
    expect(await repos.tabaco.audit.count()).toBe(before + 2);
    const all = await repos.tabaco.audit.all();
    const last = all[all.length - 1]!;
    expect(last).toMatchObject({ action: 'producto.activar', entityId: candela.id, actorId: tAdmin.userId, role: 'admin' });
    expect(new Date(last.at).getTime()).toBe(NOW.getTime());
    expect(all.every((e, i) => i === 0 || (e.seq ?? 0) > (all[i - 1]!.seq ?? 0))).toBe(true);
    await expect(listAudit(T(andres))).rejects.toThrow(ForbiddenError);
    const recent = await listAudit(T(tAdmin));
    expect(recent[0]?.action).toBe('producto.activar');
  });
});

describe('Dirección', () => {
  it('ve cada línea por separado y nadie más puede usar esa vista', async () => {
    setDbPrefix(P);
    try {
      const director: Actor = { accountId: 'direccion', userId: 'direccion', role: 'direccion', line: null, name: 'Dirección', readOnly: true };
      const t = await lineOverview(director, 'tabaco', NOW);
      const c = await lineOverview(director, 'cafe', NOW);
      expect(t.totalStores).toBe(await repos.tabaco.stores.count());
      expect(c.totalStores).toBe(await repos.cafe.stores.count());
      expect(t.activeStores).toBe((await repos.tabaco.stores.all()).filter((s) => s.status === 'activo').length);
      expect(t.sales30).toBeGreaterThan(0);
      expect(c.sales30).toBeGreaterThan(0);
      expect(t.months).toHaveLength(4);
      await expect(lineOverview(tAdmin, 'tabaco', NOW)).rejects.toThrow(ForbiddenError);
      await expect(lineOverview(andres, 'tabaco', NOW)).rejects.toThrow(ForbiddenError);
    } finally {
      setDbPrefix('');
    }
  });
});
