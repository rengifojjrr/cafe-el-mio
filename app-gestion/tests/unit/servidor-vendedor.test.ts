// Fase 2: cada vendedor entra con su cuenta y ve solo lo suyo. Contra el servidor de mentira (las
// mismas reglas que tabaco_5_vendedores.sql) y con los datos de ejemplo: lo que baja un vendedor
// (sus locales, sin costos), lo que sube (lo suyo; lo ajeno se rechaza y no frena lo demás), el
// costo que pone el servidor, un local que le asignan después, y otra persona en el mismo teléfono.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getLineRepo, setDbPrefix } from '../../src/data';
import { PENDIENTES, anotarCambios, dexieDe } from '../../src/data/local/dexie';
import type { Product, Store, User } from '../../src/data/types';
import { setProgramLines } from '../../src/lines/programa';
import { salir, usarFetch } from '../../src/servidor/cliente';
import { aDatos } from '../../src/servidor/registros';
import { enCalma, estadoSync, sincronizar, vinculo } from '../../src/servidor/sincronizar';
import { buildLine } from '../../src/seed';
import { aceptarInvitacion, entrarConCorreo } from '../../src/services/acceso';
import { invitar } from '../../src/services/acceso-admin';
import { reportSales } from '../../src/services/consignment';
import { lineCtx } from '../../src/services/context';
import { exigirInicioDeSesion } from '../../src/services/puerta';
import { allowDemoData, resolveActor, seedIfNeeded } from '../../src/services/session';
import { guardarPreciosDelLocal, listStores, storeConsignment } from '../../src/services/stores';
import { ServidorFalso } from '../servidor-falso';

const NOW = new Date('2026-11-19T15:00:00Z');

class Almacen implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}

interface Telefono {
  prefijo: string;
  almacen: Almacen;
}

let n = 0;
async function usar(t: Telefono): Promise<void> {
  await enCalma();
  (globalThis as { localStorage?: Storage }).localStorage = t.almacen;
  setDbPrefix(t.prefijo);
  anotarCambios(vinculo() !== null);
}

async function nuevo(nombre: string): Promise<Telefono> {
  const t = { prefijo: `pruebas-vendedor-${nombre}-${++n}-`, almacen: new Almacen() };
  await usar(t);
  await seedIfNeeded(NOW, { demo: false });
  return t;
}

const repo = () => getLineRepo('tabaco');
const pendientes = () => dexieDe(repo()).table(PENDIENTES).count();

/** El contexto de quien entró en este teléfono. */
async function yo() {
  const r = await resolveActor('tabaco');
  if (!r) throw new Error('No hay nadie adentro');
  return lineCtx('tabaco', r.actor, { now: () => NOW });
}

// El servidor, con los datos de ejemplo de Tabaco (como si Administración ya los hubiera cargado).
const servidor = new ServidorFalso();
const tablas = buildLine('tabaco', NOW);
const usuarios = tablas.users as User[];
const locales = tablas.stores as Store[];
const ADMIN = usuarios.find((u) => u.role === 'admin')!;
// Un vendedor con locales activos y otro que también tiene locales.
const conLocales = (u: User) => locales.filter((s) => s.sellerId === u.id && s.status === 'activo').length;
const VENDEDOR = usuarios.filter((u) => u.role === 'seller' && u.active).sort((a, b) => conLocales(b) - conLocales(a))[0]!;
const OTRO = usuarios.find((u) => u.role === 'seller' && u.active && u.id !== VENDEDOR.id && conLocales(u) > 0)!;
servidor.sembrar(
  Object.entries(tablas).flatMap(([tabla, filas]) =>
    tabla === 'photos' || tabla === 'templates' ? [] : (filas as Record<string, unknown>[]).map((fila) => ({ tabla, id: String(fila.id), datos: aDatos(tabla, fila) })),
  ),
);
const CLAVE = 'clave-segura-1';
servidor.agregarUsuario('admin@example.com', CLAVE, { rol: 'admin', usuario_app: ADMIN.id, tienda: null, nombre: 'Admin' });
servidor.agregarUsuario('vendedor@example.com', CLAVE, { rol: 'seller', usuario_app: VENDEDOR.id, tienda: null, nombre: VENDEDOR.name });

beforeAll(() => {
  allowDemoData(false);
  setProgramLines(null);
  exigirInicioDeSesion(true);
  usarFetch(servidor.fetch);
});

afterAll(async () => {
  await enCalma();
  usarFetch(null);
  anotarCambios(false);
  exigirInicioDeSesion(false);
  setProgramLines(['tabaco', 'cafe']);
  allowDemoData(true);
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('un vendedor con su cuenta', () => {
  let V: Telefono;

  it('entra como él y baja solo lo suyo: sus locales, el catálogo sin costos y nada de otros vendedores', async () => {
    V = await nuevo('v');
    const r = await entrarConCorreo('vendedor@example.com', CLAVE);
    expect(r).toEqual({ tipo: 'adentro', destino: '/tabaco' });
    await enCalma();
    const quien = await resolveActor('tabaco');
    expect(quien?.actor).toMatchObject({ role: 'seller', userId: VENDEDOR.id });

    const suyos = locales.filter((s) => s.sellerId === VENDEDOR.id).map((s) => s.id).sort();
    expect((await repo().stores.all()).map((s) => s.id).sort()).toEqual(suyos);
    const productos = await repo().products.all();
    expect(productos.length).toBeGreaterThan(5);
    expect(productos.every((p) => (p as Partial<Product>).cost === undefined)).toBe(true);
    expect((await repo().lots.all()).every((l) => (l as { unitCost?: number }).unitCost === undefined)).toBe(true);
    expect(await repo().audit.count()).toBe(0);
    expect(await repo().priceLists.count()).toBe(0);
    const gente = await repo().users.all();
    expect(gente.some((u) => u.id === OTRO.id)).toBe(false);
    expect(gente.find((u) => u.id === ADMIN.id)).toMatchObject({ email: '', phone: '' });
    // Sus comisiones, no las de otros; lo del almacén que fue a otros locales, sin decir a cuál.
    expect((await repo().commissions.all()).every((c) => c.sellerId === VENDEDOR.id)).toBe(true);
    const movs = await repo().movements.all();
    expect(movs.every((m) => m.storeId === null || suyos.includes(m.storeId))).toBe(true);
    expect((await listStores(await yo())).length).toBe(suyos.length);
    expect(await pendientes()).toBe(0);
  });

  it('sube lo suyo: una venta de su local llega al servidor con el costo de cada lote (que él no ve)', async () => {
    await usar(V);
    const ctx = await yo();
    const local = (await listStores(ctx)).find((v) => v.store.status === 'activo' && v.store.saleMode !== 'firme' && v.consignmentUnits > 0)!;
    const tiene = await storeConsignment(ctx, local.store.id);
    const venta = await reportSales(ctx, { storeId: local.store.id, items: [{ productId: tiene[0]!.productId, qty: 1 }] });
    // En el teléfono del vendedor, sin costo (nunca NaN).
    expect(venta.lines.every((l) => l.cost === 0)).toBe(true);
    await sincronizar();
    await enCalma();
    const enServidor = servidor.vivos().get(`salesReports/${venta.id}`) as { lines: { cost: number; lots: { unitCost: number }[] }[] };
    expect(enServidor.lines[0]!.cost).toBeGreaterThan(0);
    expect(enServidor.lines[0]!.lots[0]!.unitCost).toBeGreaterThan(0);
    // Le vuelve sin costo.
    expect((await repo().salesReports.get(venta.id))!.lines[0]!.cost).toBe(0);
    expect(estadoSync().rechazos).toHaveLength(0);
  });

  it('pone el precio de su local (nunca bajo el base); lo ajeno se rechaza, queda anotado y no frena lo demás', async () => {
    await usar(V);
    const ctx = await yo();
    const local = (await listStores(ctx))[0]!.store;
    const p = (await repo().products.all()).find((x) => x.active)!;
    await guardarPreciosDelLocal(ctx, local.id, { [p.id]: p.priceToStore + 3 });
    // Algo que un vendedor no puede cambiar (como si la app estuviera alterada): el catálogo.
    await repo().products.put({ ...p, priceToStore: 1 });
    await sincronizar();
    await enCalma();
    expect((servidor.vivos().get(`stores/${local.id}`) as { precios?: Record<string, number> }).precios?.[p.id]).toBe(p.priceToStore + 3);
    expect((servidor.vivos().get(`products/${p.id}`) as { priceToStore: number }).priceToStore).toBe(p.priceToStore);
    expect(estadoSync().rechazos.map((x) => x.clave)).toEqual([`products/${p.id}`]);
    expect(estadoSync().rechazos[0]!.mensaje).toMatch(/no guarda en «products»/);
  });

  it('un local que le asignan después le llega con su historia', async () => {
    const ajeno = locales.find((s) => s.sellerId === OTRO.id && s.status === 'activo')!;
    const historia = (tablas.visits as { storeId: string }[]).filter((v) => v.storeId === ajeno.id).length;
    expect(historia).toBeGreaterThan(0);
    await usar(V);
    await sincronizar();
    expect(await repo().stores.get(ajeno.id)).toBeUndefined();
    // Administración le pasa el local (desde otro teléfono).
    servidor.sembrar([{ tabla: 'stores', id: ajeno.id, datos: aDatos('stores', { ...ajeno, sellerId: VENDEDOR.id, sellerFijo: true }) }]);
    await sincronizar();
    await enCalma();
    expect(await repo().stores.get(ajeno.id)).toMatchObject({ sellerId: VENDEDOR.id });
    expect((await repo().visits.all()).filter((v) => v.storeId === ajeno.id)).toHaveLength(historia);
    // Y si se lo quitan, desaparece de su teléfono.
    servidor.sembrar([{ tabla: 'stores', id: ajeno.id, datos: aDatos('stores', { ...ajeno, sellerId: OTRO.id }) }]);
    await sincronizar();
    expect(await repo().stores.get(ajeno.id)).toBeUndefined();
  });

  it('otra persona en el mismo teléfono empieza de cero; con cambios sin subir de la otra, no entra', async () => {
    await usar(V);
    // Un cambio del vendedor sin subir (sin señal).
    servidor.sinSenal = true;
    const ctx = await yo();
    const local = (await listStores(ctx))[0]!.store;
    const p = (await repo().products.all()).find((x) => x.active)!;
    await guardarPreciosDelLocal(ctx, local.id, { [p.id]: p.priceToStore + 4 });
    await sincronizar();
    servidor.sinSenal = false;
    expect(await pendientes()).toBeGreaterThan(0);
    await salir();
    await expect(entrarConCorreo('admin@example.com', CLAVE)).rejects.toThrow(/de otra cuenta sin subir/);
    // Vuelve el vendedor, sube lo suyo y se va; ahora sí entra Administración, con todo y con costos.
    await entrarConCorreo('vendedor@example.com', CLAVE);
    await sincronizar();
    await enCalma();
    expect(await pendientes()).toBe(0);
    await salir();
    await entrarConCorreo('admin@example.com', CLAVE);
    await enCalma();
    expect((await resolveActor('tabaco'))?.actor.role).toBe('admin');
    expect(await repo().stores.count()).toBe(locales.length);
    expect((await repo().products.all()).every((x) => typeof x.cost === 'number')).toBe(true);
    expect(await repo().priceLists.count()).toBeGreaterThan(0);
  });

  it('Administración invita a un vendedor ligado a su usuario: con el link entra y ve solo lo suyo', async () => {
    const A = await nuevo('admin-invita');
    await entrarConCorreo('admin@example.com', CLAVE);
    await enCalma();
    const ctx = await yo();
    await expect(invitar(ctx, { nombre: 'Sin elegir', correo: 'x@example.com', rol: 'seller', dias: 7 })).rejects.toThrow(/Elige el vendedor/);
    const { link } = await invitar(ctx, { nombre: OTRO.name, correo: 'otro.vendedor@example.com', rol: 'seller', dias: 7, vendedorId: OTRO.id });
    await salir();
    await usar(A);
    const O = await nuevo('otro');
    await usar(O);
    const r = await aceptarInvitacion(link.split('/acceso/')[1]!, 'clave-del-vendedor');
    expect(r.tipo).toBe('adentro');
    await enCalma();
    expect((await resolveActor('tabaco'))?.actor).toMatchObject({ role: 'seller', userId: OTRO.id });
    const suyos = (await repo().stores.all()).map((s) => s.sellerId);
    expect(suyos.length).toBeGreaterThan(0);
    expect(suyos.every((id) => id === OTRO.id)).toBe(true);
  });
});
