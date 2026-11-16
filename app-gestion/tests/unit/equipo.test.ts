// El equipo: Mercado → Zona. Cada zona tiene un vendedor responsable y un vendedor puede tener
// varias. La zona decide de quién es cada local; asignado a mano a otro es una excepción. La ciudad
// sale de la dirección del local y sirve para ver totales.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Store, User, Zone } from '../../src/data/types';
import { setDbPrefix } from '../../src/data';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import type { LineRepo } from '../../src/data/repo';
import { cambiosAlAsignar, claveCiudad, esExcepcion, nombreCiudad, totalLocales, vendedorDelLocal } from '../../src/domain/equipo';
import type { Actor } from '../../src/domain/permissions';
import { seedEverything } from '../../src/seed';
import { asignarResponsable, saveUser } from '../../src/services/admin';
import { lineCtx } from '../../src/services/context';
import { verEquipo } from '../../src/services/equipo';
import { registerStore, updateStore, type StoreInput } from '../../src/services/stores';

const NOW = new Date('2026-11-16T15:00:00Z');

describe('la regla de la zona', () => {
  it('el local es del responsable de la zona; uno elegido a mano que no lo es queda como excepción', () => {
    expect(vendedorDelLocal({ sellerId: 'ana' }, undefined)).toEqual({ sellerId: 'ana', fijo: false });
    expect(vendedorDelLocal({ sellerId: 'ana' }, 'ana')).toEqual({ sellerId: 'ana', fijo: false });
    expect(vendedorDelLocal({ sellerId: 'ana' }, 'beto')).toEqual({ sellerId: 'beto', fijo: true });
    // Zona sin responsable: el elegido, o el que ya tenía el local.
    expect(vendedorDelLocal({}, 'beto')).toEqual({ sellerId: 'beto', fijo: false });
    expect(vendedorDelLocal({}, undefined, { sellerId: 'beto' })).toEqual({ sellerId: 'beto', fijo: false });
    expect(vendedorDelLocal(undefined, undefined)).toEqual({ sellerId: undefined, fijo: false });
    const zonas = new Map([['z1', { sellerId: 'ana' }], ['z2', {}]]);
    expect(esExcepcion({ sellerId: 'beto', zoneId: 'z1' }, zonas)).toBe(true);
    expect(esExcepcion({ sellerId: 'ana', zoneId: 'z1' }, zonas)).toBe(false);
    expect(esExcepcion({ sellerId: 'beto', zoneId: 'z2' }, zonas)).toBe(false);
  });

  it('asignar zonas: las que gana (de quién eran y cuántos locales pasan) y las que deja', () => {
    const zones: Zone[] = [
      { id: 'z1', name: 'Galleria', lat: 0, lng: 0, sellerId: 'ana' },
      { id: 'z2', name: 'Heights', lat: 0, lng: 0 },
      { id: 'z3', name: 'Katy', lat: 0, lng: 0, sellerId: 'beto' },
    ];
    const stores = [
      { zoneId: 'z1', sellerId: 'ana' },
      { zoneId: 'z1', sellerId: 'ana' },
      { zoneId: 'z1', sellerId: 'carla', sellerFijo: true },
      { zoneId: 'z2', sellerId: 'ana' },
    ];
    const { gana, deja } = cambiosAlAsignar(zones, stores, 'beto', ['z1', 'z2']);
    expect(gana.map((c) => [c.zone.id, c.de, c.locales])).toEqual([
      ['z1', 'ana', 2],
      ['z2', undefined, 1],
    ]);
    expect(deja.map((z) => z.id)).toEqual(['z3']);
  });

  it('la ciudad, sin el estado y sin importar mayúsculas ni tildes', () => {
    expect(claveCiudad('Sugar Land, TX')).toBe(claveCiudad('sugar land'));
    expect(claveCiudad('Hialeah, FL')).toBe('hialeah');
    expect(claveCiudad('Pequeña Habana')).toBe('pequena habana');
    expect(nombreCiudad('Sugar Land, TX')).toBe('Sugar Land');
    expect(nombreCiudad('')).toBe('Sin ciudad');
  });
});

// ---------- Con los datos de ejemplo ----------

const P = 'pruebas-equipo-';
let repo: LineRepo;
let users: User[];
const actorOf = (u: User): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco', storeId: u.storeId, name: u.name, readOnly: false });
const ctxOf = (u: User) => lineCtx('tabaco', actorOf(u), { repo, now: () => NOW });
const admin = () => users.find((u) => u.role === 'admin')!;
const vendedor = (nombre: string) => users.find((u) => u.name.startsWith(nombre))!;
const localesDe = async (zoneId: string) => (await repo.stores.all()).filter((s) => s.zoneId === zoneId);

beforeAll(async () => {
  setDbPrefix(P);
  const repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  await seedEverything(openCoreRepo(P), repos, NOW);
  repo = repos.tabaco;
  users = await repo.users.all();
});

describe('el equipo con los datos de ejemplo', () => {
  it('cada zona tiene su responsable y un vendedor cubre varias; ningún local es excepción', async () => {
    const zones = await repo.zones.all();
    const zona = (id: string) => zones.find((z) => z.id === id)!;
    expect(zona('t-zon_hialeah').sellerId).toBe(vendedor('Andrés').id);
    expect(zona('t-zon_doral').sellerId).toBe(vendedor('Andrés').id);
    expect(zona('t-zon_habana').sellerId).toBe(vendedor('Yanelis').id);
    expect(zona('t-zon_gables').sellerId).toBe(vendedor('Yanelis').id);
    const stores = await repo.stores.all();
    const porZona = new Map(zones.map((z) => [z.id, z]));
    expect(stores.filter((s) => esExcepcion(s, porZona))).toEqual([]);
  });

  it('«Equipo» en Miami: por vendedor, por zona y por ciudad, y las cuentas cuadran', async () => {
    const e = await verEquipo(ctxOf(admin()), 'miami');
    expect(e.marketId).toBe('miami');
    const andres = e.vendedores.find((v) => v.seller.name.startsWith('Andrés'))!;
    expect(andres.zonas.map((z) => z.name).sort()).toEqual(['Doral', 'Hialeah']);
    expect(e.vendedores.some((v) => v.seller.name.startsWith('Tomás'))).toBe(false);
    const stores = (await repo.stores.all()).filter((s) => s.zoneId !== 't-zon_houston');
    const suma = (filas: { totales: Parameters<typeof totalLocales>[0] }[]) => filas.reduce((a, f) => a + totalLocales(f.totales), 0);
    expect(suma(e.vendedores)).toBe(stores.length);
    expect(suma(e.zonas)).toBe(stores.length);
    expect(suma(e.ciudades)).toBe(stores.length);
    const hialeah = e.ciudades.find((c) => c.ciudad === 'Hialeah')!;
    expect(hialeah.vendedores).toEqual(['Andrés Molina']);
    expect(hialeah.zonas).toEqual(['Hialeah']);
    expect(e.zonasSinResponsable).toBe(0);
    const houston = await verEquipo(ctxOf(admin()), 'houston');
    expect(houston.vendedores.map((v) => v.seller.name)).toEqual(['Tomás Garza']);
  });

  it('un vendedor nuevo con varias zonas: las gana y sus locales pasan; el de antes conserva las demás', async () => {
    const doral = await localesDe('t-zon_doral');
    expect(doral.length).toBeGreaterThan(0);
    const nuevo = await saveUser(ctxOf(admin()), { role: 'seller', name: 'Vendedora Nueva', email: '', phone: '', zoneIds: ['t-zon_doral', 't-zon_westchester'] });
    expect(nuevo.zoneId).toBe('t-zon_doral');
    const zones = await repo.zones.all();
    expect(zones.find((z) => z.id === 't-zon_doral')?.sellerId).toBe(nuevo.id);
    expect(zones.find((z) => z.id === 't-zon_westchester')?.sellerId).toBe(nuevo.id);
    expect(zones.find((z) => z.id === 't-zon_hialeah')?.sellerId).toBe(vendedor('Andrés').id);
    expect((await localesDe('t-zon_doral')).every((s) => s.sellerId === nuevo.id)).toBe(true);
    expect((await localesDe('t-zon_hialeah')).every((s) => s.sellerId === vendedor('Andrés').id)).toBe(true);
    users = await repo.users.all();
  });

  it('un vendedor tiene que tener al menos una zona, todas de su mercado', async () => {
    await expect(saveUser(ctxOf(admin()), { role: 'seller', name: 'Sin Zona', email: '', phone: '', zoneIds: [] })).rejects.toThrow(/al menos una zona/);
    await expect(saveUser(ctxOf(admin()), { role: 'seller', name: 'Dos Mercados', email: '', phone: '', zoneIds: ['t-zon_doral', 't-zon_houston'] })).rejects.toThrow(/mismo mercado/);
    await expect(asignarResponsable(ctxOf(admin()), 't-zon_houston', vendedor('Andrés').id)).rejects.toThrow(/otro mercado/);
  });

  it('cambiar el responsable de una zona mueve sus locales, salvo los asignados a mano a otro', async () => {
    const yanelis = vendedor('Yanelis');
    const rafael = vendedor('Rafael');
    const kendall = await localesDe('t-zon_kendall');
    // Uno de Kendall se asigna a mano a Yanelis: es una excepción y no se mueve.
    const fijo = kendall[0]!;
    const editado = await updateStore(ctxOf(admin()), fijo.id, entrada(fijo, { sellerId: yanelis.id }));
    expect(editado).toMatchObject({ sellerId: yanelis.id, sellerFijo: true });
    const vendedorNuevo = users.find((u) => u.name === 'Vendedora Nueva')!;
    const r = await asignarResponsable(ctxOf(admin()), 't-zon_kendall', vendedorNuevo.id);
    expect(r.movidos).toBe(kendall.length - 1);
    const despues = await localesDe('t-zon_kendall');
    expect(despues.find((s) => s.id === fijo.id)?.sellerId).toBe(yanelis.id);
    expect(despues.filter((s) => s.id !== fijo.id).every((s) => s.sellerId === vendedorNuevo.id)).toBe(true);
    // «Equipo» lo muestra como excepción.
    const e = await verEquipo(ctxOf(admin()), 'miami');
    expect(e.zonas.find((z) => z.zone.id === 't-zon_kendall')).toMatchObject({ excepciones: 1 });
    expect(e.vendedores.find((v) => v.seller.id === yanelis.id)).toMatchObject({ excepciones: 1 });
    // Rafael ya no es responsable de ninguna zona: las dos pasaron a la vendedora nueva.
    expect((await repo.zones.all()).some((z) => z.sellerId === rafael.id)).toBe(false);
    // Volver a dejar al dueño a mano como responsable: el local deja de ser excepción.
    await asignarResponsable(ctxOf(admin()), 't-zon_kendall', yanelis.id);
    expect((await repo.stores.get(fijo.id))?.sellerFijo).toBeUndefined();
  });

  it('un local nuevo: del responsable de la zona; si la zona no tiene, hay que elegir', async () => {
    const yanelis = vendedor('Yanelis');
    const s = await registerStore(ctxOf(admin()), base('t-zon_habana', 'Prueba Habana'));
    expect(s).toMatchObject({ sellerId: yanelis.id });
    expect(s.sellerFijo).toBeUndefined();
    const aMano = await registerStore(ctxOf(admin()), { ...base('t-zon_habana', 'Prueba Habana 2'), sellerId: vendedor('Andrés').id });
    expect(aMano).toMatchObject({ sellerId: vendedor('Andrés').id, sellerFijo: true });
    await asignarResponsable(ctxOf(admin()), 't-zon_beach', null);
    await expect(registerStore(ctxOf(admin()), base('t-zon_beach', 'Prueba Beach'))).rejects.toThrow(/no tiene vendedor responsable/);
    // El vendedor que registra en una zona de otro: es suyo, como excepción.
    const deAndres = await registerStore(ctxOf(vendedor('Andrés')), base('t-zon_habana', 'Prueba Habana 3'));
    expect(deAndres).toMatchObject({ sellerId: vendedor('Andrés').id, sellerFijo: true });
  });

  it('mover un local a otra zona: sigue al nuevo responsable, salvo que esté asignado a mano', async () => {
    const yanelis = vendedor('Yanelis');
    const andres = vendedor('Andrés');
    const local = (await localesDe('t-zon_hialeah'))[0]!;
    const movido = await updateStore(ctxOf(admin()), local.id, entrada(local, { zoneId: 't-zon_habana', city: 'Miami, FL', lat: 25.7712, lng: -80.2276 }));
    expect(movido.sellerId).toBe(yanelis.id);
    expect(movido.sellerFijo).toBeUndefined();
    const aMano = await updateStore(ctxOf(admin()), local.id, entrada(movido, { sellerId: andres.id }));
    expect(aMano).toMatchObject({ sellerId: andres.id, sellerFijo: true });
    // Elegir otra vez «el de la zona» lo devuelve a la regla.
    const regla = await updateStore(ctxOf(admin()), local.id, entrada(aMano, { sellerId: '' }));
    expect(regla.sellerId).toBe(yanelis.id);
    expect(regla.sellerFijo).toBeUndefined();
  });
});

function base(zoneId: string, name: string): StoreInput {
  const punto = zoneId === 't-zon_beach' ? { lat: 25.79, lng: -80.13 } : { lat: 25.7712, lng: -80.2276 };
  return { name, type: 'Tabaquería', address: '10 Calle Prueba (dirección de ejemplo)', city: 'Miami, FL', zoneId, ...punto, managerName: '', phone: '', email: '', hours: '', notes: '' };
}

function entrada(s: Store, cambios: Partial<StoreInput>): StoreInput {
  return {
    name: s.name,
    type: s.type,
    address: s.address,
    city: s.city,
    zoneId: s.zoneId,
    lat: s.lat,
    lng: s.lng,
    managerName: s.managerName,
    phone: s.phone,
    email: s.email,
    hours: s.hours,
    notes: s.notes,
    tobaccoPermit: s.tobaccoPermit ? { number: s.tobaccoPermit.number, expiresOn: s.tobaccoPermit.expiresOn, issuer: s.tobaccoPermit.issuer } : undefined,
    ...cambios,
  };
}
