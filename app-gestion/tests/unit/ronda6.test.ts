// Ronda 6: pedidos y ventas a nombre de personas, la venta de mostrador («Almacén») y el precio por
// mazo según la medida (regla de Ajustes, con «Aplicar» y «Deshacer»).
import { beforeAll, describe, expect, it } from 'vitest';
import type { Product, User } from '../../src/data/types';
import { setDbPrefix } from '../../src/data';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import type { LineRepo } from '../../src/data/repo';
import { ID_MOSTRADOR, claveNombre } from '../../src/domain/clientes';
import { ComplianceError } from '../../src/domain/compliance';
import { WAREHOUSE, Balances } from '../../src/domain/ledger';
import type { Actor } from '../../src/domain/permissions';
import { cambiosDeRegla, leerLargo, leerMedidas, medidaDe, precioPorRegla, type ReglaPrecioMazo } from '../../src/domain/precio-medida';
import { seedEverything } from '../../src/seed';
import { mapData, pnlByMonth, reports } from '../../src/services/analytics';
import { saveProduct } from '../../src/services/catalog';
import { asegurarMostrador, buscarPersonas, crearPersona, listarClientes } from '../../src/services/clientes';
import { createPhoneOrder, prepareDelivery, receiveDelivery } from '../../src/services/consignment';
import { type Ctx, ValidationError, lineCtx } from '../../src/services/context';
import { listInvoices, quickSale, quickSaleStores } from '../../src/services/invoices';
import { aplicarReglaPrecio, deshacerAjustePrecio, guardarReglaPrecio, vistaPreviaRegla } from '../../src/services/precio-medida';
import { listStores } from '../../src/services/stores';

const NOW = new Date('2026-11-19T15:00:00Z');
const FIRMA = `data:image/png;base64,${'A'.repeat(400)}`;
const P = 'pruebas-ronda6-';
let repo: LineRepo;
let users: User[];
const actorOf = (u: User): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco', storeId: u.storeId, name: u.name, readOnly: false });
let reloj = NOW.getTime();
const T = (u: User): Ctx => lineCtx('tabaco', actorOf(u), { repo, now: () => new Date((reloj += 1000)) });
const admin = () => users.find((u) => u.role === 'admin')!;
const vendedor = () => users.find((u) => u.role === 'seller')!;

/** Un producto activo con stock en el almacén. */
async function conStock(minimo: number): Promise<Product> {
  const b = Balances.from(await repo.movements.all());
  return (await repo.products.all()).find((p) => p.active && p.kind === 'mazo' && b.qty(WAREHOUSE, p.id) >= minimo)!;
}

beforeAll(async () => {
  setDbPrefix(P);
  const repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  await seedEverything(openCoreRepo(P), repos, NOW);
  repo = repos.tabaco;
  users = await repo.users.all();
});

describe('la regla de precio por medida', () => {
  const regla: ReglaPrecioMazo = { precio: 35, especiales: [{ medidas: leerMedidas('6½ × 64, 7 × 70'), precio: 40 }] };

  it('lee el largo escrito de varias formas', () => {
    expect(leerLargo('6½')).toBe(6.5);
    expect(leerLargo('6 1/2')).toBe(6.5);
    expect(leerLargo('6-1/2')).toBe(6.5);
    expect(leerLargo('6.5')).toBe(6.5);
    expect(leerLargo('6,5')).toBe(6.5);
    expect(leerLargo('7')).toBe(7);
    expect(leerLargo('siete')).toBeNaN();
  });

  it('lee las medidas de un texto, sin repetir', () => {
    expect(leerMedidas('6½ × 64, 7 × 70')).toEqual([
      { largo: 6.5, cepo: 64 },
      { largo: 7, cepo: 70 },
    ]);
    expect(leerMedidas('6 1/2x64; 7x70')).toEqual([
      { largo: 6.5, cepo: 64 },
      { largo: 7, cepo: 70 },
    ]);
    expect(leerMedidas('6.5 x 64 y 6,5X64 y 7X70')).toEqual([
      { largo: 6.5, cepo: 64 },
      { largo: 7, cepo: 70 },
    ]);
    expect(leerMedidas('Toro')).toEqual([]);
  });

  it('6½ × 64 y 7 × 70 van a 40; cualquier otra medida (o sin medida), a 35', () => {
    expect(precioPorRegla(regla, { largo: 6.5, cepo: 64 })).toBe(40);
    expect(precioPorRegla(regla, { largo: 7, cepo: 70 })).toBe(40);
    expect(precioPorRegla(regla, { largo: 6, cepo: 52 })).toBe(35);
    expect(precioPorRegla(regla, { largo: 7, cepo: 64 })).toBe(35);
    expect(precioPorRegla(regla, null)).toBe(35);
    // La medida como la guarda la app (largo en pulgadas y cepo).
    expect(precioPorRegla(regla, medidaDe({ lengthIn: 6.5, ringGauge: 64 }))).toBe(40);
    expect(precioPorRegla(regla, medidaDe({ lengthIn: '7', ringGauge: '70' }))).toBe(40);
  });

  it('«Aplicar» no toca lo premium ni lo puesto a mano, y no cambia lo que ya tiene el precio de la regla', () => {
    const base = { kind: 'mazo' as const, priceToStore: 30 };
    const { cambios, aMano } = cambiosDeRegla(regla, [
      { ...base, id: 'a', name: 'A', attrs: { lengthIn: 7, ringGauge: 70 } },
      { ...base, id: 'b', name: 'B', attrs: { lengthIn: 6, ringGauge: 52 }, priceToStore: 35 },
      { ...base, id: 'c', name: 'C', attrs: { lengthIn: 7, ringGauge: 70 }, precioManual: true },
      { ...base, id: 'd', name: 'D', attrs: { lengthIn: 7, ringGauge: 70 }, kind: 'premium' },
    ]);
    expect(cambios.map((c) => [c.productId, c.antes, c.despues])).toEqual([['a', 30, 40]]);
    expect(aMano).toBe(1);
  });
});

describe('clientes: personas y almacén', () => {
  it('«ana perez» es «Ana Pérez»: se sugiere y no se duplica', async () => {
    expect(claveNombre('  ANA   Pérez ')).toBe(claveNombre('ana perez'));
    const a = await crearPersona(T(admin()), { nombre: 'Ana Pérez', telefono: '305-555-0100' });
    expect(a.nueva).toBe(true);
    expect(a.persona).toMatchObject({ clase: 'persona', name: 'Ana Pérez', phone: '305-555-0100', sellerId: '', saleMode: 'firme', status: 'activo' });
    const otra = await crearPersona(T(admin()), { nombre: 'ana  perez' });
    expect(otra.nueva).toBe(false);
    expect(otra.persona.id).toBe(a.persona.id);
    const s = await buscarPersonas(T(admin()), 'ANA PEREZ');
    expect(s.exacta?.id).toBe(a.persona.id);
    expect((await buscarPersonas(T(admin()), 'pér')).sugerencias.map((x) => x.id)).toContain(a.persona.id);
    // Los vendedores no ven a las personas.
    await expect(buscarPersonas(T(vendedor()), 'ana')).rejects.toThrow();
  });

  it('venta rápida a una persona nueva: pide la edad, sale su factura y queda en «Clientes» con su compra', async () => {
    const { persona } = await crearPersona(T(admin()), { nombre: 'Rafael Núñez' });
    const p = await conStock(2);
    const venta = { storeId: persona.id, items: [{ productId: p.id, pack: 'unidad' as const, packQty: 1 }], payment: { method: 'efectivo' as const, reference: '' } };
    await expect(quickSale(T(admin()), venta)).rejects.toThrow(ComplianceError);
    const r = await quickSale(T(admin()), { ...venta, edadComprobada: true });
    expect(r.invoice).toMatchObject({ storeId: persona.id, edadComprobada: true, sellerId: null, status: 'pagada' });
    const c = await listarClientes(T(admin()));
    const fila = c.porClase.persona.find((x) => x.store.id === persona.id)!;
    expect(fila).toMatchObject({ compras: 1, clase: 'persona' });
    expect(fila.total).toBeCloseTo(r.invoice.total, 2);
    // La factura dice a quién: una persona.
    expect((await listInvoices(T(admin()), { storeId: persona.id }))[0]).toMatchObject({ clase: 'persona', storeName: 'Rafael Núñez' });
  });

  it('el almacén (mostrador) es un cliente fijo: el mismo siempre, con nota y sin vender a cuenta', async () => {
    const m1 = await asegurarMostrador(T(admin()));
    const m2 = await asegurarMostrador(T(admin()));
    expect(m1.id).toBe(ID_MOSTRADOR);
    expect(m2.id).toBe(ID_MOSTRADOR);
    expect(m1).toMatchObject({ clase: 'almacen', sellerId: '' });
    const p = await conStock(2);
    const venta = { storeId: m1.id, items: [{ productId: p.id, pack: 'unidad' as const, packQty: 1 }], edadComprobada: true };
    await expect(quickSale(T(admin()), { ...venta, payment: { method: 'cuenta' as const, reference: '' } })).rejects.toThrow(ValidationError);
    const r = await quickSale(T(admin()), { ...venta, payment: { method: 'efectivo' as const, reference: '' }, note: 'Pepe' });
    expect(r.invoice).toMatchObject({ storeId: ID_MOSTRADOR, note: 'Pepe', edadComprobada: true });
  });

  it('las personas y el mostrador no salen en Locales, el mapa ni la lista de locales de la venta rápida', async () => {
    const ids = new Set((await repo.stores.all()).filter((s) => s.clase).map((s) => s.id));
    expect(ids.size).toBeGreaterThan(0);
    const locales = await listStores(T(admin()));
    expect(locales.some((v) => ids.has(v.store.id))).toBe(false);
    expect((await mapData(T(admin()))).stores.some((s) => ids.has(s.store.id))).toBe(false);
    expect((await quickSaleStores(T(admin()))).some((s) => ids.has(s.store.id))).toBe(false);
  });

  it('pedido a nombre de una persona ya existente: se anota la edad y se comprueba al entregar', async () => {
    const { persona } = await crearPersona(T(admin()), { nombre: 'Ana Pérez' });
    const p = await conStock(3);
    await expect(createPhoneOrder(T(admin()), { storeId: persona.id, items: [{ productId: p.id, qty: 2 }] })).rejects.toThrow(ValidationError);
    const { reorder, delivery } = await createPhoneOrder(T(admin()), { storeId: persona.id, items: [{ productId: p.id, qty: 2 }], edadComprobada: true });
    expect(reorder).toMatchObject({ storeId: persona.id, sellerId: '', edadComprobada: true });
    await prepareDelivery(T(admin()), delivery.id);
    await expect(receiveDelivery(T(admin()), delivery.id, { name: 'Ana Pérez', image: FIRMA })).rejects.toThrow(ValidationError);
    const d = await receiveDelivery(T(admin()), delivery.id, { name: 'Ana Pérez', image: FIRMA, edadComprobada: true });
    const factura = (await repo.invoices.get(d.invoiceId!))!;
    expect(factura).toMatchObject({ storeId: persona.id, edadComprobada: true, origin: 'entrega' });
    // Sin vendedor: sin comisión.
    expect((await repo.commissions.all()).some((c) => c.invoiceId === factura.id)).toBe(false);
  });

  it('los reportes separan Locales, Personas y Almacén', async () => {
    const months = await pnlByMonth(T(admin()), 1);
    const m = months[months.length - 1]!;
    expect(m.revenueFirmPersonas).toBeGreaterThan(0);
    expect(m.revenueFirmAlmacen).toBeGreaterThan(0);
    expect(m.revenueFirmLocales + m.revenueFirmPersonas + m.revenueFirmAlmacen).toBeCloseTo(m.revenueFirm, 2);
    const r = await reports(T(admin()), 30);
    const porClase = new Map(r.byClase.map((x) => [x.key, x]));
    expect(porClase.get('persona')?.revenue).toBeGreaterThan(0);
    expect(porClase.get('almacen')?.revenue).toBeGreaterThan(0);
    expect(porClase.get('local')?.revenue).toBeGreaterThan(0);
    const c = await listarClientes(T(admin()));
    expect(c.totales.persona.compras).toBeGreaterThanOrEqual(2);
    expect(c.totales.almacen.compras).toBeGreaterThanOrEqual(1);
    // El filtro por cliente funciona igual para los tres.
    for (const fila of [c.porClase.local.find((x) => x.compras > 0)!, c.porClase.persona[0]!, c.porClase.almacen[0]!]) {
      const facturas = await listInvoices(T(admin()), { storeId: fila.store.id });
      expect(facturas.length).toBe(fila.compras);
    }
  });
});

describe('la regla de precio con los datos de ejemplo', () => {
  const base = {
    sku: 'T-ZZZ7X70',
    brandLine: 'De mazo (sin marca)',
    active: true,
    cost: 10,
    suggestedRetail: 90,
    sellerCommission: { type: 'percent' as const, value: 8 },
    lowStockThreshold: 10,
    packSize: 50,
    unitName: 'mazo',
    kind: 'mazo' as const,
    attrs: { vitola: 'Gran Corona', lengthIn: 7, ringGauge: 70, capa: 'maduro', originCountry: 'Nicaragua', strength: 'media', cigarsPerBundle: 25 },
  };

  it('un mazo 7 × 70 nuevo sale a 40 con la regla; a mano manda; «Aplicar» y «Deshacer»', async () => {
    await expect(guardarReglaPrecio(T(admin()), { precio: 35, medidas: 'gran corona' })).rejects.toThrow(/No entendí las medidas/);
    const regla = await guardarReglaPrecio(T(admin()), { precio: 35, medidas: '6 1/2x64, 7x70', precioMedidas: 40 });
    expect(regla.especiales[0]!.medidas).toHaveLength(2);
    // Lo que daría la regla, como lo pone el formulario: sin precio a mano.
    const sigue = await saveProduct(T(admin()), { ...base, name: 'Gran Corona', familyName: 'Gran Corona', priceToStore: 40 });
    expect(sigue.priceToStore).toBe(40);
    expect(sigue.precioManual).toBeUndefined();
    const aMano = await saveProduct(T(admin()), { ...base, sku: 'T-ZZZ7X70B', name: 'Gran Corona B', familyName: 'Gran Corona B', priceToStore: 42 });
    expect(aMano.precioManual).toBe(true);

    // Un mazo guardado antes con otro precio: «Aplicar» lo cambia (el de a mano no).
    const viejo = (await repo.products.all()).find((p) => p.kind === 'mazo' && !p.precioManual && p.priceToStore !== precioPorRegla(regla, medidaDe(p.attrs)))!;
    const antes = viejo.priceToStore;
    const vista = await vistaPreviaRegla(T(admin()));
    expect(vista.cambios.some((c) => c.productId === viejo.id)).toBe(true);
    expect(vista.cambios.some((c) => c.productId === aMano.id)).toBe(false);
    expect(vista.aMano).toBeGreaterThanOrEqual(1);
    const n = await aplicarReglaPrecio(T(admin()), [viejo.id]);
    expect(n).toBe(1);
    expect((await repo.products.get(viejo.id))!.priceToStore).toBe(precioPorRegla(regla, medidaDe(viejo.attrs)));
    expect((await repo.products.get(aMano.id))!.priceToStore).toBe(42);
    const des = await deshacerAjustePrecio(T(admin()));
    expect(des).toEqual({ vueltos: 1, cambiadosDespues: 0 });
    expect((await repo.products.get(viejo.id))!.priceToStore).toBe(antes);
    await expect(deshacerAjustePrecio(T(admin()))).rejects.toThrow(/No hay nada que deshacer/);
  });
});
