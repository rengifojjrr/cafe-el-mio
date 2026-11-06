// Venta en firme con Dexie real (fake-indexeddb) y la semilla completa: factura al recibir, pagos,
// lo que debe el local, venta rápida, pedido por teléfono o pegado, listas de precios y permisos.
import { beforeAll, describe, expect, it } from 'vitest';
import type { LineId, Product, Store, User } from '../../src/data/types';
import type { CoreRepo, LineRepo } from '../../src/data/repo';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import { ComplianceError } from '../../src/domain/compliance';
import { WAREHOUSE, findNegative } from '../../src/domain/ledger';
import { type Actor, ForbiddenError } from '../../src/domain/permissions';
import { seedEverything } from '../../src/seed';
import { pnlByMonth } from '../../src/services/analytics';
import { listProducts } from '../../src/services/catalog';
import { createPhoneOrder, createReorder, confirmReorder, listDeliveries, prepareDelivery, receiveDelivery } from '../../src/services/consignment';
import { type Ctx, ValidationError, lineCtx } from '../../src/services/context';
import { listInvoices, quickSale, quickSaleProducts, quickSaleStores, recordInvoicePayment } from '../../src/services/invoices';
import { loadInventory } from '../../src/services/inventory';
import { listCommissions, storeAccounts } from '../../src/services/money';
import { listPriceLists, saveFirmSettings, savePriceList, setPriceEntry, storePrices } from '../../src/services/prices';
import { storeDebt, updateStore } from '../../src/services/stores';

const P = 'pruebas-firme-';
const NOW = new Date('2026-11-05T15:00:00Z');
const SIGNATURE = `data:image/png;base64,${'A'.repeat(400)}`;

let repos: Record<LineId, LineRepo>;
let core: CoreRepo;
let users: User[];
let stores: Store[];
let products: Product[];

const actorOf = (u: User, readOnly = false): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco', storeId: u.storeId, name: u.name, readOnly });
const T = (a: Actor): Ctx => lineCtx('tabaco', a, { repo: repos.tabaco, now: () => NOW });
const store = (name: string) => stores.find((s) => s.name === name)!;
const userOf = (s: Store) => users.find((u) => u.storeId === s.id)!;
const mazo = (vitola: string, capa: string) => products.find((p) => p.kind === 'mazo' && p.attrs.vitola === vitola && p.attrs.capa === capa)!;

let admin: Actor;
let andres: Actor;
let yanelis: Actor;

async function warehouse(productId: string): Promise<number> {
  const snap = await loadInventory(T(admin));
  return snap.balances.qty(WAREHOUSE, productId);
}

/** Pedido por teléfono → preparar → el dueño firma al recibir. Devuelve la factura. */
async function phoneOrderDelivered(s: Store, items: { productId: string; qty: number }[]) {
  const { reorder, delivery } = await createPhoneOrder(T(admin), { storeId: s.id, items, note: 'Llamó el dueño' });
  await prepareDelivery(T(admin), delivery.id);
  const received = await receiveDelivery(T(actorOf(userOf(s))), delivery.id, { name: s.managerName, image: SIGNATURE });
  const invoice = (await listInvoices(T(admin), { storeId: s.id })).find((i) => i.id === received.invoiceId)!;
  return { reorder, delivery: received, invoice };
}

beforeAll(async () => {
  repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  core = openCoreRepo(P);
  await seedEverything(core, repos, NOW);
  users = await repos.tabaco.users.all();
  stores = await repos.tabaco.stores.all();
  products = await repos.tabaco.products.all();
  admin = actorOf(users.find((u) => u.role === 'admin')!);
  andres = actorOf(users.find((u) => u.name === 'Andrés Molina')!);
  yanelis = actorOf(users.find((u) => u.name === 'Yanelis Cruz')!);
});

describe('factura en firme al recibir la entrega', () => {
  it('precios de la lista del local, cajas y sueltos, salida por lote, costo, vencimiento y comisiones', async () => {
    const primo = store('Bodega El Primo');
    const toroHab = mazo('Toro', 'habano');
    const before = await warehouse(toroHab.id);
    // 60 mazos: 1 caja (precio de caja de la lista Mayorista) + 10 mazos sueltos.
    const { reorder, delivery, invoice } = await phoneOrderDelivered(primo, [{ productId: toroHab.id, qty: 60 }]);
    expect(reorder).toMatchObject({ origin: 'telefono', status: 'confirmado' });
    expect(delivery.status).toBe('entregada');
    expect(invoice).toMatchObject({ origin: 'entrega', storeId: primo.id, sellerId: primo.sellerId, creditDays: 15, dueOn: '2026-11-20', withoutResaleCert: false, taxPercent: 0, tax: 0, status: 'pendiente', paid: 0 });
    expect(invoice.code).toMatch(/^F-\d{4}$/);
    expect(invoice.lines.map((l) => [l.pack, l.packQty, l.qty, l.unitPrice, l.amount])).toEqual([
      ['caja', 1, 50, 1100, 1100],
      ['unidad', 10, 10, 23, 230],
    ]);
    expect(invoice.subtotal).toBe(1330);
    expect(invoice.total).toBe(1330);
    // Bajó el almacén y salió a «vendido» por lote, con su costo.
    expect(await warehouse(toroHab.id)).toBe(before - 60);
    const moves = (await repos.tabaco.movements.all()).filter((m) => m.refId === invoice.id);
    expect(moves.every((m) => m.type === 'venta_firme' && m.to.kind === 'sold' && m.from.kind === 'warehouse')).toBe(true);
    expect(moves.reduce((a, m) => a + m.qty, 0)).toBe(60);
    const lotsCost = invoice.lines.flatMap((l) => l.lots).reduce((a, l) => a + l.qty * l.unitCost, 0);
    expect(invoice.lines.reduce((a, l) => a + l.cost, 0)).toBeCloseTo(lotsCost, 2);
    expect(invoice.lines[0]!.cost).toBeGreaterThan(0);
    // La entrega queda ligada a su factura y el pedido, entregado.
    const view = (await listDeliveries(T(admin), { storeId: primo.id })).find((d) => d.id === delivery.id)!;
    expect(view).toMatchObject({ firm: true, invoiceCode: invoice.code });
    expect((await repos.tabaco.reorders.get(reorder.id))?.status).toBe('entregado');
    // Comisión del vendedor del local: el % de su escalón (comisión progresiva) sobre el importe de
    // cada línea, el mismo % para las dos, sin pasar el tope, devengada hasta que se pague.
    const comms = (await repos.tabaco.commissions.all()).filter((c) => c.invoiceId === invoice.id).sort((a, b) => b.amount - a.amount);
    expect(comms.map((c) => [c.status, c.sellerId])).toEqual([
      ['devengada', primo.sellerId],
      ['devengada', primo.sellerId],
    ]);
    const pct = comms[0]!.rule.value;
    expect(comms.every((c) => c.rule.type === 'percent' && c.rule.value === pct)).toBe(true);
    expect(pct).toBeGreaterThan(0);
    expect(comms.map((c) => c.amount)).toEqual([Math.round(1100 * pct) / 100, Math.round(230 * pct) / 100]);
    expect(findNegative(await repos.tabaco.movements.all())).toBeNull();
  });

  it('pagos parciales y total: saldo, estado y comisiones pagables al quedar pagada', async () => {
    const primo = store('Bodega El Primo');
    const { invoice } = await phoneOrderDelivered(primo, [{ productId: mazo('Toro', 'maduro').id, qty: 20 }]);
    expect(invoice.total).toBe(480);
    await recordInvoicePayment(T(admin), invoice.id, { amount: 200, method: 'efectivo' });
    let now = (await listInvoices(T(admin), { storeId: primo.id })).find((i) => i.id === invoice.id)!;
    expect(now).toMatchObject({ paid: 200, balance: 280, status: 'parcial' });
    await expect(recordInvoicePayment(T(admin), invoice.id, { amount: 300, method: 'efectivo' })).rejects.toThrow(/saldo/);
    await expect(recordInvoicePayment(T(admin), invoice.id, { amount: 10, method: 'zelle' })).rejects.toThrow(/referencia/);
    // La tarjeta se cobra aparte: no lleva referencia (y nunca el número de la tarjeta).
    await recordInvoicePayment(T(admin), invoice.id, { amount: 280, method: 'tarjeta' });
    now = (await listInvoices(T(admin), { storeId: primo.id })).find((i) => i.id === invoice.id)!;
    expect(now).toMatchObject({ paid: 480, balance: 0, status: 'pagada' });
    expect(now.payments.map((p) => p.method).sort()).toEqual(['efectivo', 'tarjeta']);
    const comms = (await repos.tabaco.commissions.all()).filter((c) => c.invoiceId === invoice.id);
    expect(comms.every((c) => c.status === 'pagable' && c.payableAt)).toBe(true);
    // El vendedor la ve entre sus comisiones; los pagos solo los registra administración.
    const his = await listCommissions(T(andres));
    expect(his.some((c) => c.invoiceId === invoice.id)).toBe(true);
    await expect(recordInvoicePayment(T(andres), invoice.id, { amount: 1, method: 'efectivo' })).rejects.toThrow(ForbiddenError);
  });

  it('sin certificado de reventa vigente la factura lo dice y, con % en Ajustes, lleva impuesto', async () => {
    const flagler = store('Mini Market Flagler 57');
    const primo = store('Bodega El Primo');
    await saveFirmSettings(T(admin), { salesTaxPercent: 7, defaultPriceListId: (await listPriceLists(T(admin))).find((l) => l.name === 'Local')!.id });
    const { invoice } = await phoneOrderDelivered(flagler, [{ productId: mazo('Robusto', 'habano').id, qty: 10 }]);
    expect(invoice).toMatchObject({ withoutResaleCert: true, creditDays: 0, dueOn: '2026-11-05', subtotal: 230, taxPercent: 7, tax: 16.1, total: 246.1 });
    const other = await phoneOrderDelivered(primo, [{ productId: mazo('Robusto', 'habano').id, qty: 10 }]);
    expect(other.invoice).toMatchObject({ withoutResaleCert: false, tax: 0, total: other.invoice.subtotal });
    await saveFirmSettings(T(admin), { salesTaxPercent: 0, defaultPriceListId: (await listPriceLists(T(admin))).find((l) => l.name === 'Local')!.id });
  });

  it('lo que debe el local incluye sus facturas; el local y su vendedor las ven, otro vendedor no', async () => {
    const bendicion = store('Licorería La Bendición');
    const ctxStore = T(actorOf(userOf(bendicion)));
    const debt = await storeDebt(ctxStore, bendicion.id);
    const mine = await listInvoices(ctxStore);
    const open = mine.filter((i) => i.balance > 0);
    expect(open.length).toBeGreaterThan(0);
    expect(debt.invoices).toBeCloseTo(open.reduce((a, i) => a + i.balance, 0), 2);
    expect(debt.total).toBeCloseTo(debt.settled + debt.unsettled + debt.invoices, 2);
    expect(debt.overdue).toBeGreaterThan(0);
    expect(mine.every((i) => i.storeId === bendicion.id)).toBe(true);
    // Sin costos para el local.
    expect(mine.flatMap((i) => i.lines).every((l) => l.cost === 0 && l.lots.length === 0)).toBe(true);
    const rafael = actorOf(users.find((u) => u.name === 'Rafael Ortega')!);
    expect((await listInvoices(T(rafael))).some((i) => i.storeId === bendicion.id)).toBe(true);
    expect((await listInvoices(T(yanelis))).some((i) => i.storeId === bendicion.id)).toBe(false);
    const accounts = await storeAccounts(T(admin));
    const acc = accounts.find((a) => a.store.id === bendicion.id)!;
    expect(acc.invoiceBalance).toBeCloseTo(debt.invoices, 2);
    expect(acc.invoiceOverdue).toBeGreaterThan(0);
  });

  it('el local en firme pide desde su cuenta → el vendedor confirma → entrega → factura', async () => {
    const doral = store('Gasolinera Doral 41');
    const r = await createReorder(T(actorOf(userOf(doral))), { storeId: doral.id, items: [{ productId: mazo('Toro', 'connecticut').id, qty: 10 }] });
    expect(r.origin).toBe('local');
    const d = await confirmReorder(T(andres), r.id);
    await prepareDelivery(T(admin), d.id);
    const received = await receiveDelivery(T(andres), d.id, { name: doral.managerName, image: SIGNATURE });
    expect(received.invoiceId).toBeTruthy();
    const inv = (await repos.tabaco.invoices.get(received.invoiceId!))!;
    // Lista «Local»: el precio al local del producto.
    expect(inv.lines[0]).toMatchObject({ pack: 'unidad', packQty: 10, unitPrice: 24, amount: 240 });
    expect(inv.dueOn).toBe('2026-11-05');
  });
});

describe('venta rápida en el almacén', () => {
  it('un mazo: baja el stock, factura pagada, sin vendedor ni comisión', async () => {
    const doral = store('Gasolinera Doral 41');
    const toroHab = mazo('Toro', 'habano');
    const before = await warehouse(toroHab.id);
    const comBefore = (await repos.tabaco.commissions.all()).length;
    const { invoice, payment } = await quickSale(T(admin), { storeId: doral.id, items: [{ productId: toroHab.id, pack: 'unidad', packQty: 1 }], payment: { method: 'efectivo' } });
    expect(invoice).toMatchObject({ origin: 'venta_rapida', sellerId: null, status: 'pagada', paid: 25, total: 25 });
    expect(payment).toMatchObject({ method: 'efectivo', amount: 25, invoiceId: invoice.id });
    expect(await warehouse(toroHab.id)).toBe(before - 1);
    expect((await repos.tabaco.commissions.all()).length).toBe(comBefore);
  });

  it('también a un local en consignación (llevarse en el almacén es venta en firme), y «a cuenta» queda pendiente', async () => {
    const faro = store('Tabaquería El Faro');
    const { invoice, payment } = await quickSale(T(admin), { storeId: faro.id, items: [{ productId: mazo('Toro', 'maduro').id, pack: 'caja', packQty: 1 }], payment: { method: 'cuenta' } });
    expect(payment).toBeUndefined();
    // Sin lista propia: la «Local» (precio al local y la caja del producto).
    expect(invoice).toMatchObject({ status: 'pendiente', creditDays: 10, dueOn: '2026-11-15' });
    expect(invoice.lines[0]).toMatchObject({ pack: 'caja', packQty: 1, qty: 50 });
    expect(invoice.lines[0]!.unitPrice).toBe(mazo('Toro', 'maduro').boxPrice);
  });

  it('nunca más de lo que hay (sin tocar lo apartado) y con un mensaje claro', async () => {
    const doral = store('Gasolinera Doral 41');
    const p = mazo('Churchill', 'connecticut');
    const snap = await loadInventory(T(admin));
    const available = snap.balances.qty(WAREHOUSE, p.id) - (snap.reserved.get(p.id) ?? 0);
    await expect(quickSale(T(admin), { storeId: doral.id, items: [{ productId: p.id, pack: 'unidad', packQty: available + 1 }], payment: { method: 'efectivo' } })).rejects.toThrow(
      new RegExp(`No alcanza ${p.name}: hay ${available} mazos`),
    );
    expect(await warehouse(p.id)).toBe(snap.balances.qty(WAREHOUSE, p.id));
  });

  it('sin permiso de tabaco vigente no se vende; solo administración registra ventas rápidas', async () => {
    const humo = store('Licorería Humo y Ron');
    const item = [{ productId: mazo('Toro', 'habano').id, pack: 'unidad' as const, packQty: 1 }];
    await expect(quickSale(T(admin), { storeId: humo.id, items: item, payment: { method: 'efectivo' } })).rejects.toThrow(ComplianceError);
    await expect(quickSale(T(andres), { storeId: store('Bodega El Primo').id, items: item, payment: { method: 'efectivo' } })).rejects.toThrow(ForbiddenError);
    await expect(quickSale(T(actorOf(users.find((u) => u.role === 'admin')!, true)), { storeId: store('Bodega El Primo').id, items: item, payment: { method: 'efectivo' } })).rejects.toThrow(ForbiddenError);
    const list = await quickSaleStores(T(admin));
    expect(list.find((x) => x.store.id === humo.id)?.blocked).toMatch(/permiso/);
    expect(list.at(-1)?.blocked).toBeTruthy();
    expect(list[0]?.blocked).toBeUndefined();
  });

  it('los productos salen con el precio del local y lo que más compra primero', async () => {
    const primo = store('Bodega El Primo');
    const { products: list, listName } = await quickSaleProducts(T(admin), primo.id);
    expect(listName).toBe('Mayorista');
    expect(list[0]!.lastForStore).toBeTruthy();
    const toro = list.find((x) => x.product.id === mazo('Toro', 'habano').id)!;
    expect(toro.price).toMatchObject({ unit: 23, box: 1100, volume: { minBoxes: 3, box: 1050 } });
  });
});

describe('pedido por teléfono y pegado', () => {
  it('administración lo anota confirmado; vendedor y local no pueden', async () => {
    const primo = store('Bodega El Primo');
    const item = [{ productId: mazo('Robusto', 'maduro').id, qty: 5 }];
    const { reorder, delivery } = await createPhoneOrder(T(admin), { storeId: primo.id, items: item }, 'pegado');
    expect(reorder).toMatchObject({ origin: 'pegado', status: 'confirmado', createdBy: admin.userId, deliveryId: delivery.id });
    expect(delivery).toMatchObject({ status: 'solicitada', reorderId: reorder.id, origin: 'pedido_local' });
    expect(delivery.note).toMatch(/Pedido pegado de un mensaje P-\d{4}/);
    await expect(createPhoneOrder(T(andres), { storeId: primo.id, items: item })).rejects.toThrow(ForbiddenError);
    await expect(createPhoneOrder(T(actorOf(userOf(primo))), { storeId: primo.id, items: item })).rejects.toThrow(ForbiddenError);
    // Sin permiso vigente tampoco se toma el pedido.
    await expect(createPhoneOrder(T(admin), { storeId: store('Licorería Humo y Ron').id, items: item })).rejects.toThrow(ValidationError);
  });
});

describe('listas de precios y condiciones del local', () => {
  it('solo administración las ve y las cambia; el precio del local lo ven él y su vendedor', async () => {
    const primo = store('Bodega El Primo');
    await expect(listPriceLists(T(andres))).rejects.toThrow(ForbiddenError);
    await expect(savePriceList(T(andres), { name: 'Especial', kind: 'otra' })).rejects.toThrow(ForbiddenError);
    const special = await savePriceList(T(admin), { name: 'Especial Doral', kind: 'otra', defaultMarkupPercent: 80 });
    await setPriceEntry(T(admin), special.id, mazo('Toro', 'habano').id, { mode: 'fixed', unit: 22, volume: { minBoxes: 2, box: 1000 } });
    const prices = await storePrices(T(andres), primo.id);
    expect(prices.listName).toBe('Mayorista');
    expect(JSON.stringify(prices)).not.toMatch(/cost/);
    await expect(storePrices(T(yanelis), primo.id)).rejects.toThrow(ForbiddenError);
    const own = await storePrices(T(actorOf(userOf(primo))), primo.id);
    expect(own.prices[mazo('Toro', 'habano').id]).toMatchObject({ unit: 23 });
  });

  it('el local en firme ve en el catálogo SU precio; el de consignación sigue viendo PVP y lo que gana', async () => {
    const primo = store('Bodega El Primo');
    const faro = store('Tabaquería El Faro');
    const firmView = await listProducts(T(actorOf(userOf(primo))));
    const toro = firmView.find((v) => v.product.id === mazo('Toro', 'habano').id)!;
    expect(toro.storePrice).toEqual({ unit: 23, box: 1100, listName: 'Mayorista', volume: { minBoxes: 3, box: 1050 } });
    const consignView = await listProducts(T(actorOf(userOf(faro))));
    expect(consignView.every((v) => v.storePrice === undefined)).toBe(true);
    expect((await listProducts(T(andres))).every((v) => v.storePrice === undefined)).toBe(true);
  });

  it('cómo compra el local lo cambia administración; con producto en consignación no pasa a firme', async () => {
    const faro = store('Tabaquería El Faro');
    const input = {
      name: faro.name,
      type: faro.type,
      address: faro.address,
      city: faro.city,
      zoneId: faro.zoneId,
      lat: faro.lat,
      lng: faro.lng,
      managerName: faro.managerName,
      phone: faro.phone,
      email: faro.email,
      hours: faro.hours,
      notes: faro.notes,
      tobaccoPermit: faro.tobaccoPermit,
    };
    await expect(updateStore(T(admin), faro.id, { ...input, terms: { saleMode: 'firme', creditDays: 15 } })).rejects.toThrow(/consignación/);
    // El vendedor no cambia las condiciones (se ignoran).
    const bySeller = await updateStore(T(andres), faro.id, { ...input, terms: { saleMode: 'firme', creditDays: 30 } });
    expect(bySeller.saleMode).toBeUndefined();
    const doral = store('Gasolinera Doral 41');
    const mayorista = (await listPriceLists(T(admin))).find((l) => l.name === 'Mayorista')!;
    const next = await updateStore(T(admin), doral.id, {
      ...input,
      name: doral.name,
      address: doral.address,
      city: doral.city,
      zoneId: doral.zoneId,
      lat: doral.lat,
      lng: doral.lng,
      managerName: doral.managerName,
      phone: doral.phone,
      email: doral.email,
      tobaccoPermit: doral.tobaccoPermit,
      terms: { saleMode: 'firme', creditDays: 7, priceListId: mayorista.id },
    });
    expect(next).toMatchObject({ saleMode: 'firme', creditDays: 7, priceListId: mayorista.id });
  });
});

describe('contabilidad', () => {
  it('separa ventas en firme y en consignación, y el total las suma', async () => {
    const months = await pnlByMonth(T(admin), 4);
    const last = months.at(-1)!;
    expect(months.some((m) => m.revenueFirm > 0 && m.revenueConsignment > 0)).toBe(true);
    for (const m of months) {
      expect(m.revenue).toBeCloseTo(m.revenueFirm + m.revenueConsignment, 2);
      expect(m.cogs).toBeCloseTo(m.cogsFirm + m.cogsConsignment, 2);
      // El costo de distribución (repartos) también se descuenta del margen bruto.
      expect(m.grossMargin).toBeCloseTo(m.marginFirm + m.marginConsignment - m.shrink - m.distribution, 2);
    }
    expect(last.commissionsFirm).toBeGreaterThan(0);
  });
});
