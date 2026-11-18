// La comisión por diferencia: la empresa le pone a cada producto su precio base; el vendedor le
// pone a cada local su precio (nunca menos que el base); la empresa le cobra al local ese precio y
// el vendedor gana la diferencia. En consignación, cada entrega queda al precio y con el base de ese
// día: lo que se vende después se cobra así, lo más viejo primero.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Movement, Product, Store, User } from '../../src/data/types';
import { setDbPrefix } from '../../src/data';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import type { LineRepo } from '../../src/data/repo';
import { resolveCommissionRule } from '../../src/domain/commission-scheme';
import { commissionOnAmount } from '../../src/domain/invoices';
import { Balances, WAREHOUSE, storeLoc } from '../../src/domain/ledger';
import { commissionAmount, commissionPerUnit, describeRule } from '../../src/domain/money-rules';
import type { Actor } from '../../src/domain/permissions';
import { capasDelLocal, consumir, precioDelLocal, repartirLotes } from '../../src/domain/precios-local';
import { priceForStore } from '../../src/domain/pricing';
import { seedEverything } from '../../src/seed';
import { saveUser } from '../../src/services/admin';
import { prepareDelivery, receiveDelivery, reportSales, requestDelivery } from '../../src/services/consignment';
import { type Ctx, ValidationError, lineCtx } from '../../src/services/context';
import { getProduct, listProducts } from '../../src/services/catalog';
import { previewContract } from '../../src/services/contracts';
import { guardarPreciosDelLocal, listStores, preciosDelLocal, storeConsignment } from '../../src/services/stores';

const NOW = new Date('2026-11-18T15:00:00Z');
const FIRMA = `data:image/png;base64,${'A'.repeat(400)}`;

const mov = (at: string, qty: number, dentro: boolean, precio?: { unitPrice: number; basePrice: number }): Movement => ({
  id: `m-${at}`,
  at,
  type: dentro ? 'salida_consignacion' : 'venta_reportada',
  productId: 'p1',
  lotId: 'l1',
  qty,
  from: dentro ? WAREHOUSE : storeLoc('s1'),
  to: dentro ? storeLoc('s1') : { kind: 'sold' },
  storeId: 's1',
  refType: dentro ? 'delivery' : 'sale',
  refId: 'x',
  actorId: 'a',
  ...precio,
});

describe('las reglas', () => {
  it('el precio del local: el suyo si no es menor que el base; si no tiene, el base', () => {
    const p = { id: 'p1', priceToStore: 35 };
    expect(precioDelLocal({ precios: { p1: 45 } }, p)).toBe(45);
    expect(precioDelLocal({ precios: { p1: 30 } }, p)).toBe(35);
    expect(precioDelLocal({}, p)).toBe(35);
    expect(precioDelLocal(undefined, p)).toBe(35);
  });

  it('las capas: cada entrega a su precio, lo más viejo sale primero; lo dejado sin precio va al base de hoy', () => {
    const movs = [
      mov('2026-11-01', 5, true), // dejado antes de los precios por local
      mov('2026-11-02', 10, true, { unitPrice: 45, basePrice: 35 }),
      mov('2026-11-03', 3, false), // se vendieron 3 de los viejos
      mov('2026-11-04', 10, true, { unitPrice: 50, basePrice: 36 }),
    ];
    const capas = capasDelLocal(movs, 's1', 'p1', 37);
    expect(capas).toEqual([
      { qty: 2, unitPrice: 37, basePrice: 37 },
      { qty: 10, unitPrice: 45, basePrice: 35 },
      { qty: 10, unitPrice: 50, basePrice: 36 },
    ]);
    expect(consumir(capas, 14, 37)).toEqual([
      { qty: 2, unitPrice: 37, basePrice: 37 },
      { qty: 10, unitPrice: 45, basePrice: 35 },
      { qty: 2, unitPrice: 50, basePrice: 36 },
    ]);
    expect(capas).toEqual([{ qty: 8, unitPrice: 50, basePrice: 36 }]);
    // Los lotes (el costo) se reparten en el mismo orden.
    const partes = repartirLotes([{ qty: 3 }, { qty: 2 }], [{ lotId: 'a', qty: 4, unitCost: 10 }, { lotId: 'b', qty: 1, unitCost: 12 }]);
    expect(partes.map((p) => [p.lots, p.cost])).toEqual([
      [[{ lotId: 'a', qty: 3, unitCost: 10 }], 30],
      [[{ lotId: 'a', qty: 1, unitCost: 10 }, { lotId: 'b', qty: 1, unitCost: 12 }], 22],
    ]);
  });

  it('con la diferencia, manda la diferencia también en los productos con comisión propia', () => {
    const metrics = { activeStores: 0, newStores: 0, boxes: 0, units: 0, sales: 0 } as unknown as Parameters<typeof resolveCommissionRule>[0]['metrics'];
    const propio = { sellerCommission: { type: 'fixed' as const, value: 2 }, commissionCustom: true };
    const diferencia = { type: 'diferencia' as const, value: 0 };
    expect(resolveCommissionRule({ product: propio, seller: { commissionOverride: diferencia }, metrics })).toEqual(diferencia);
    // Un especial de % o monto sigue debajo de la comisión propia, como antes.
    expect(resolveCommissionRule({ product: propio, seller: { commissionOverride: { type: 'percent', value: 9 } }, metrics })).toEqual(propio.sellerCommission);
  });

  it('la comisión por diferencia: lo cobrado por encima del base, nunca negativa', () => {
    const regla = { type: 'diferencia' as const, value: 0 };
    expect(commissionAmount(regla, 3, 45, 35)).toBe(30);
    expect(commissionAmount(regla, 3, 35, 35)).toBe(0);
    expect(commissionAmount(regla, 3, 30, 35)).toBe(0);
    // Venta en firme: sobre el importe de la línea.
    expect(commissionOnAmount(regla, 10, 450, 35)).toBe(100);
    expect(commissionPerUnit(regla, 35, 45)).toBe(10);
    expect(describeRule(regla)).toBe('la diferencia sobre el precio base');
    // Las otras reglas, como siempre.
    expect(commissionAmount({ type: 'percent', value: 10 }, 2, 45, 35)).toBe(9);
    expect(commissionAmount({ type: 'fixed', value: 1.5 }, 2, 45, 35)).toBe(3);
  });

  it('venta en firme: el precio del local manda sobre la lista; la caja es unidad × unidades por caja', () => {
    const p = { id: 'p1', cost: 20, priceToStore: 35, suggestedRetail: 60, packSize: 10, boxPrice: 300 };
    expect(priceForStore(p, { precios: { p1: 45 } }, null, { pack: 'caja' })).toMatchObject({ unit: 45, box: 450, price: 450, source: 'local' });
    expect(priceForStore(p, { precios: { p1: 30 } }, null)).toMatchObject({ unit: 35, source: 'producto' });
    expect(priceForStore(p, undefined, null, { pack: 'caja' })).toMatchObject({ box: 300 });
  });
});

// ---------- Con los datos de ejemplo ----------

const P = 'pruebas-diferencia-';
let repo: LineRepo;
let users: User[];
const actorOf = (u: User): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco', storeId: u.storeId, name: u.name, readOnly: false });
// El reloj avanza un segundo en cada lectura: cada entrega y cada venta tienen su momento, como en la vida real.
let reloj = NOW.getTime();
const T = (u: User): Ctx => lineCtx('tabaco', actorOf(u), { repo, now: () => new Date((reloj += 1000)) });
const admin = () => users.find((u) => u.role === 'admin')!;
const balances = async () => Balances.from(await repo.movements.all());

/** El vendedor del local, con «la diferencia» (sus zonas, como estaban). */
async function conDiferencia(store: Store): Promise<User> {
  const seller = users.find((u) => u.id === store.sellerId)!;
  const zoneIds = (await repo.zones.all()).filter((z) => z.sellerId === seller.id).map((z) => z.id);
  return saveUser(T(admin()), { id: seller.id, role: 'seller', name: seller.name, email: seller.email, phone: seller.phone, zoneIds, commissionOverride: { type: 'diferencia', value: 0 } });
}

/** Un producto de mazo con stock suficiente en el almacén. */
async function conStock(minimo: number): Promise<Product> {
  const b = await balances();
  const products = await repo.products.all();
  return products.find((p) => p.kind === 'mazo' && p.active && b.qty(WAREHOUSE, p.id) >= minimo)!;
}

async function entregar(store: Store, productId: string, qty: number) {
  const d = await requestDelivery(T(admin()), { storeId: store.id, items: [{ productId, qty }] });
  await prepareDelivery(T(admin()), d.id);
  return receiveDelivery(T(admin()), d.id, { name: 'Encargado de prueba', image: FIRMA });
}

beforeAll(async () => {
  setDbPrefix(P);
  const repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  await seedEverything(openCoreRepo(P), repos, NOW);
  repo = repos.tabaco;
  users = await repo.users.all();
});

describe('con los datos de ejemplo', () => {
  it('el precio de un local nunca es menor que el base; sin precio, paga el base', async () => {
    const faro = (await repo.stores.all()).find((s) => s.name === 'Tabaquería El Faro')!;
    const p = await conStock(1);
    await expect(guardarPreciosDelLocal(T(admin()), faro.id, { [p.id]: p.priceToStore - 1 })).rejects.toThrow(ValidationError);
    await expect(guardarPreciosDelLocal(T(admin()), faro.id, { [p.id]: p.priceToStore - 1 })).rejects.toThrow(/menor que el precio base/);
    const s = await guardarPreciosDelLocal(T(admin()), faro.id, { [p.id]: p.priceToStore + 10 });
    expect(s.precios?.[p.id]).toBe(p.priceToStore + 10);
    const sinPrecio = await guardarPreciosDelLocal(T(admin()), faro.id, { [p.id]: null });
    expect(sinPrecio.precios).toBeUndefined();
    // Otro vendedor no le pone precios a un local que no es suyo.
    const otro = users.find((u) => u.role === 'seller' && u.id !== faro.sellerId)!;
    await expect(guardarPreciosDelLocal(T(otro), faro.id, { [p.id]: p.priceToStore + 1 })).rejects.toThrow();
  });

  it('consignación: cada entrega a su precio; la venta cobra lo más viejo primero y el vendedor gana la diferencia', async () => {
    const faro = (await repo.stores.all()).find((s) => s.name === 'Tabaquería El Faro')!;
    const seller = await conDiferencia(faro);
    expect(seller.commissionOverride).toEqual({ type: 'diferencia', value: 0 });
    const p = await conStock(20);
    const base = p.priceToStore;
    const viejos = (await balances()).qty(storeLoc(faro.id), p.id);

    await guardarPreciosDelLocal(T(admin()), faro.id, { [p.id]: base + 10 });
    await entregar(faro, p.id, 10);
    await guardarPreciosDelLocal(T(admin()), faro.id, { [p.id]: base + 15 });
    await entregar(faro, p.id, 10);
    const entregas = (await repo.movements.all()).filter((m) => m.type === 'salida_consignacion' && m.storeId === faro.id && m.productId === p.id && m.unitPrice !== undefined);
    expect(new Set(entregas.map((m) => `${m.unitPrice}/${m.basePrice}`))).toEqual(new Set([`${base + 10}/${base}`, `${base + 15}/${base}`]));

    // Se venden los viejos (al base: sin diferencia), los 10 a base+10 y 5 de los de base+15.
    const report = await reportSales(T(admin()), { storeId: faro.id, items: [{ productId: p.id, qty: viejos + 15 }] });
    const lineas = report.lines.filter((l) => l.productId === p.id);
    expect(lineas.map((l) => [l.qty, l.unitPrice])).toEqual([...(viejos ? [[viejos, base]] : []), [10, base + 10], [5, base + 15]]);
    expect(report.total).toBeCloseTo(viejos * base + 10 * (base + 10) + 5 * (base + 15), 2);
    const comisiones = (await repo.commissions.all()).filter((c) => c.salesReportId === report.id);
    expect(comisiones.every((c) => c.sellerId === seller.id && c.rule.type === 'diferencia')).toBe(true);
    expect(comisiones.reduce((a, c) => a + c.amount, 0)).toBeCloseTo(10 * 10 + 5 * 15, 2);
    // Lo que queda en el local vale a su precio (los 5 a base+15).
    const view = (await listStores(T(admin()))).find((v) => v.store.id === faro.id)!;
    const otros = view.consignmentValue - 5 * (base + 15);
    expect(otros).toBeGreaterThanOrEqual(-0.001);
  });

  it('venta en firme con vendedor: la factura al precio del local y la comisión es la diferencia', async () => {
    const firme = (await repo.stores.all()).find((s) => s.saleMode === 'firme' && s.status === 'activo' && s.sellerId)!;
    expect(firme).toBeDefined();
    const seller = await conDiferencia(firme);
    const p = await conStock(10);
    await guardarPreciosDelLocal(T(admin()), firme.id, { [p.id]: p.priceToStore + 7 });
    const d = await entregar(firme, p.id, 4);
    const factura = (await repo.invoices.get(d.invoiceId!))!;
    const linea = factura.lines.find((l) => l.productId === p.id)!;
    expect(linea).toMatchObject({ pack: 'unidad', qty: 4, unitPrice: p.priceToStore + 7 });
    const comision = (await repo.commissions.all()).find((c) => c.invoiceId === factura.id && c.productId === p.id)!;
    expect(comision).toMatchObject({ sellerId: seller.id, rule: { type: 'diferencia' } });
    expect(comision.amount).toBeCloseTo(4 * 7, 2);
  });

  it('el local ve su precio y nunca el base; su vendedor y Administración ven los dos; lo que tiene, por capas', async () => {
    const faro = (await repo.stores.all()).find((s) => s.name === 'Tabaquería El Faro')!;
    const local = users.find((u) => u.role === 'store' && u.storeId === faro.id)!;
    const seller = users.find((u) => u.id === faro.sellerId)!;
    const p = await conStock(10);
    const base = p.priceToStore;
    // Su vendedor le pone el precio.
    await guardarPreciosDelLocal(T(seller), faro.id, { [p.id]: base + 4 });

    // El local: su precio en el catálogo (lista y ficha) y lo que gana con él.
    const ficha = await getProduct(T(local), p.id);
    expect(ficha.product.priceToStore).toBe(base + 4);
    expect(ficha.storeEarning).toBeCloseTo(p.suggestedRetail - (base + 4), 2);
    expect((await listProducts(T(local))).find((v) => v.product.id === p.id)!.product.priceToStore).toBe(base + 4);
    // Su vendedor ve el base.
    expect((await getProduct(T(seller), p.id)).product.priceToStore).toBe(base);

    // La tarjeta de precios: el local no la ve, otro vendedor tampoco.
    await expect(preciosDelLocal(T(local), faro.id)).rejects.toThrow();
    const otro = users.find((u) => u.role === 'seller' && u.id !== faro.sellerId)!;
    await expect(preciosDelLocal(T(otro), faro.id)).rejects.toThrow();
    const precios = await preciosDelLocal(T(seller), faro.id);
    expect(precios.filas.find((f) => f.productId === p.id)).toMatchObject({ base, pvp: p.suggestedRetail, precio: base + 4 });
    expect(precios.diferencia).toBe(true);

    // Lo que tiene en consignación, por capas: lo nuevo a su precio; la próxima venta, lo más viejo.
    await entregar(faro, p.id, 3);
    const linea = (await storeConsignment(T(local), faro.id)).find((x) => x.productId === p.id)!;
    expect(linea.capas.at(-1)).toEqual({ qty: 3, unitPrice: base + 4 });
    expect(linea.capas.reduce((a, c) => a + c.qty, 0)).toBe(linea.qty);
    expect(linea.value).toBeCloseTo(linea.capas.reduce((a, c) => a + c.qty * c.unitPrice, 0), 2);
    expect(linea.priceToStore).toBe(linea.capas[0]!.unitPrice);

    // El contrato nuevo lleva en su anexo el precio del local.
    const contrato = await previewContract(T(admin()), faro.id);
    expect(contrato.annex.find((a) => a.productId === p.id)!.priceToStore).toBe(base + 4);
  });
});
