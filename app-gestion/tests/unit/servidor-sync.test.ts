// La conexión con el servidor, de punta a punta pero sin internet: un servidor de mentira que
// responde como el de verdad (tests/servidor-falso.ts) y varios «teléfonos», cada uno con su base
// local y su almacenamiento. Se prueba: entrar, la primera conexión (vacío, en blanco y con datos
// distintos), subir y bajar cambios con fotos, borrar, quién gana, sin señal, token vencido,
// cuenta quitada, lo que el servidor rechaza, la bajada por tandas y las invitaciones.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getLineRepo, setDbPrefix } from '../../src/data';
import { PENDIENTES, anotarCambios, dexieDe } from '../../src/data/local/dexie';
import type { Photo, Product } from '../../src/data/types';
import { setProgramLines } from '../../src/lines/programa';
import { sesionActual, usarFetch } from '../../src/servidor/cliente';
import { enCalma, estadoSync, sincronizar, vinculo } from '../../src/servidor/sincronizar';
import { aceptarInvitacion, decidirConexion, entrarConCorreo, verInvitacion } from '../../src/services/acceso';
import { invitar } from '../../src/services/acceso-admin';
import { lineCtx } from '../../src/services/context';
import { exigirInicioDeSesion } from '../../src/services/puerta';
import { allowDemoData, enterAs, resolveActor, seedIfNeeded } from '../../src/services/session';
import { ServidorFalso } from '../servidor-falso';

const NOW = new Date('2026-11-09T15:00:00Z');

/** El almacenamiento del navegador de un teléfono. */
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
function telefono(nombre: string): Telefono {
  return { prefijo: `pruebas-servidor-${nombre}-${++n}-`, almacen: new Almacen() };
}

/** Pasa a usar ese teléfono: su base, su almacenamiento y si anota cambios (si está conectado). */
async function usar(t: Telefono): Promise<void> {
  await enCalma();
  (globalThis as { localStorage?: Storage }).localStorage = t.almacen;
  setDbPrefix(t.prefijo);
  anotarCambios(vinculo() !== null);
}

/** Un teléfono nuevo, ya abierto (la app arranca en blanco) y en uso. */
async function nuevo(nombre: string): Promise<Telefono> {
  const t = telefono(nombre);
  await usar(t);
  await seedIfNeeded(NOW, { demo: false });
  return t;
}

const repo = () => getLineRepo('tabaco');
const pendientes = () => dexieDe(repo()).table(PENDIENTES).count();

function producto(id: string, name: string): Product {
  return { id, sku: id, name, brandLine: 'Prueba', active: true, cost: 2, priceToStore: 5, suggestedRetail: 9 } as unknown as Product;
}

function foto(id: string, ownerId: string, bytes: number[]): Photo {
  return { id, ownerType: 'product', ownerId, blob: new Blob([new Uint8Array(bytes)], { type: 'image/webp' }), mime: 'image/webp', width: 10, height: 10, createdAt: NOW.toISOString() };
}

async function bytesDe(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

const servidor = new ServidorFalso();
const DUENA = 'duena@example.com';
const CLAVE = 'clave-segura-1';
servidor.agregarUsuario(DUENA, CLAVE, { rol: 'admin', usuario_app: 't-usr_admin', tienda: null, nombre: 'Dueña' });
servidor.agregarUsuario('socio@example.com', 'clave-del-socio', { rol: 'direccion', usuario_app: null, tienda: null, nombre: 'Socio' });

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

describe('servidor', () => {
  let A: Telefono;
  let B: Telefono;

  it('sin entrar, no se entra a ninguna cuenta', async () => {
    await nuevo('sin-sesion');
    await expect(enterAs('tabaco:admin')).rejects.toThrow(/correo y tu contraseña/);
    expect(await resolveActor('tabaco')).toBeNull();
  });

  it('un correo o una contraseña equivocados no entran', async () => {
    await nuevo('clave-mala');
    await expect(entrarConCorreo(DUENA, 'otra')).rejects.toThrow('El correo o la contraseña no coinciden.');
    expect(sesionActual()).toBeNull();
  });

  it('el primer teléfono llena el servidor vacío, con sus fotos', async () => {
    A = await nuevo('a');
    // Lo que ya estaba cargado en este teléfono antes de conectarse.
    await repo().products.put(producto('t-prd_1', 'Robusto'));
    await repo().photos.put(foto('t-pho_1', 't-prd_1', [1, 2, 3]));
    const r = await entrarConCorreo(DUENA, CLAVE);
    expect(r).toEqual({ tipo: 'adentro', destino: '/tabaco' });
    await sincronizar();
    await enCalma();
    const vivos = servidor.vivos();
    expect(vivos.get('products/t-prd_1')).toMatchObject({ name: 'Robusto' });
    expect(vivos.get('products/t-prd_1')).not.toHaveProperty('id');
    expect(vivos.get('photos/t-pho_1')).toMatchObject({ archivo: 'photos/t-pho_1', mime: 'image/webp' });
    expect(vivos.get('photos/t-pho_1')).not.toHaveProperty('blob');
    expect([...servidor.archivos.get('photos/t-pho_1')!.bytes]).toEqual([1, 2, 3]);
    expect(vivos.get('settings/settings')).toMatchObject({ dataMode: 'real' });
    expect(vivos.get('audit/t-aud_inicio')).toBeTruthy();
    expect(await pendientes()).toBe(0);
    expect(estadoSync().fase).toBe('al-dia');
    // Ya entró: la puerta deja pasar solo a su cuenta.
    expect((await resolveActor('tabaco'))?.actor.role).toBe('admin');
    await expect(enterAs('direccion')).rejects.toThrow(/correo y tu contraseña/);
  });

  it('un teléfono nuevo toma lo del servidor sin preguntar, con las fotos', async () => {
    B = await nuevo('b');
    const r = await entrarConCorreo(DUENA, CLAVE);
    expect(r.tipo).toBe('adentro');
    await enCalma();
    expect(await repo().products.get('t-prd_1')).toMatchObject({ name: 'Robusto' });
    const f = await repo().photos.get('t-pho_1');
    expect(f).toBeTruthy();
    expect(f).not.toHaveProperty('archivo');
    expect(await bytesDe(f!.blob)).toEqual([1, 2, 3]);
    expect(await pendientes()).toBe(0);
  });

  it('un cambio sube y llega al otro teléfono; lo que baja no vuelve a subir', async () => {
    await usar(A);
    await repo().products.put(producto('t-prd_1', 'Robusto Especial'));
    await repo().products.put(producto('t-prd_2', 'Corona'));
    expect(await pendientes()).toBe(2);
    await sincronizar();
    expect(servidor.vivos().get('products/t-prd_1')).toMatchObject({ name: 'Robusto Especial' });

    await usar(B);
    const antes = servidor.llamadas.filter((l) => l.includes('tabaco_aplicar')).length;
    await sincronizar();
    expect(await repo().products.get('t-prd_1')).toMatchObject({ name: 'Robusto Especial' });
    expect(await repo().products.get('t-prd_2')).toMatchObject({ name: 'Corona' });
    // B no tenía nada propio: no subió nada.
    expect(servidor.llamadas.filter((l) => l.includes('tabaco_aplicar')).length).toBe(antes);
    expect(await pendientes()).toBe(0);
  });

  it('borrar en un teléfono borra en el otro; la foto se queda en el depósito (por si vuelve de una copia)', async () => {
    await usar(B);
    await repo().photos.remove('t-pho_1');
    await repo().products.remove('t-prd_2');
    await sincronizar();
    expect(servidor.vivos().has('products/t-prd_2')).toBe(false);
    expect(servidor.vivos().has('photos/t-pho_1')).toBe(false);
    expect(servidor.archivos.has('photos/t-pho_1')).toBe(true);
    await usar(A);
    await sincronizar();
    expect(await repo().products.get('t-prd_2')).toBeUndefined();
    expect(await repo().photos.get('t-pho_1')).toBeUndefined();
  });

  it('si los dos cambian lo mismo, gana el último que llega al servidor; lo que no subió nunca se pisa', async () => {
    await usar(A);
    await repo().products.put(producto('t-prd_1', 'Versión de A'));
    // A no tiene señal: su cambio queda pendiente.
    servidor.sinSenal = true;
    await sincronizar();
    expect(estadoSync().fase).toBe('sin-conexion');
    expect(await pendientes()).toBe(1);
    servidor.sinSenal = false;

    await usar(B);
    await repo().products.put(producto('t-prd_1', 'Versión de B'));
    await sincronizar();
    expect(servidor.vivos().get('products/t-prd_1')).toMatchObject({ name: 'Versión de B' });

    // Vuelve la señal en A: su cambio pendiente no se pisa con lo que baja; sube y gana.
    await usar(A);
    await sincronizar();
    expect(await repo().products.get('t-prd_1')).toMatchObject({ name: 'Versión de A' });
    expect(servidor.vivos().get('products/t-prd_1')).toMatchObject({ name: 'Versión de A' });
    await usar(B);
    await sincronizar();
    expect(await repo().products.get('t-prd_1')).toMatchObject({ name: 'Versión de A' });
  });

  it('un teléfono con datos propios pregunta; «Subir lo de este teléfono» junta los dos lados', async () => {
    await nuevo('c');
    await repo().products.put(producto('t-prd_c', 'Solo en C'));
    const r = await entrarConCorreo(DUENA, CLAVE);
    expect(r.tipo).toBe('decidir');
    if (r.tipo !== 'decidir') return;
    expect(r.diferencias).toMatchObject({ soloAqui: 1, puedeSubir: true });
    expect(r.diferencias.soloServidor).toBeGreaterThan(0);
    // Mientras decide, nada entra.
    expect(await resolveActor('tabaco')).toBeNull();
    const fin = await decidirConexion('equipo');
    expect(fin).toEqual({ tipo: 'adentro', destino: '/tabaco' });
    await enCalma();
    expect(servidor.vivos().get('products/t-prd_c')).toMatchObject({ name: 'Solo en C' });
    expect(await repo().products.get('t-prd_1')).toMatchObject({ name: 'Versión de A' });
  });

  it('«Usar lo del servidor» deja el teléfono igual al servidor', async () => {
    await nuevo('d');
    await repo().products.put(producto('t-prd_d', 'Solo en D'));
    const r = await entrarConCorreo(DUENA, CLAVE);
    expect(r.tipo).toBe('decidir');
    await decidirConexion('servidor');
    await enCalma();
    expect(await repo().products.get('t-prd_d')).toBeUndefined();
    expect(servidor.vivos().has('products/t-prd_d')).toBe(false);
    expect((await repo().products.all()).map((p) => p.id).sort()).toEqual(['t-prd_1', 't-prd_c']);
    expect(await pendientes()).toBe(0);
  });

  it('Dirección baja todo pero no sube nada', async () => {
    await nuevo('socio');
    const r = await entrarConCorreo('socio@example.com', 'clave-del-socio');
    expect(r).toEqual({ tipo: 'adentro', destino: '/direccion' });
    await enCalma();
    expect(await repo().products.get('t-prd_c')).toBeTruthy();
    const antes = servidor.vivos().get('products/t-prd_1');
    await repo().products.put(producto('t-prd_1', 'Dirección no cambia esto'));
    await sincronizar();
    expect(servidor.vivos().get('products/t-prd_1')).toEqual(antes);
    expect(estadoSync().fase).toBe('al-dia');
  });

  it('con el token vencido se renueva solo y sigue', async () => {
    await usar(A);
    servidor.vencerAccesos();
    await repo().products.put(producto('t-prd_1', 'Después de renovar'));
    await sincronizar();
    expect(estadoSync().fase).toBe('al-dia');
    expect(servidor.vivos().get('products/t-prd_1')).toMatchObject({ name: 'Después de renovar' });
  });

  it('lo que el servidor no acepta queda anotado y no frena lo demás', async () => {
    await usar(A);
    servidor.maxDatos = 2000;
    await repo().products.put(producto('t-prd_grande', 'x'.repeat(5000)));
    await repo().products.put(producto('t-prd_chico', 'Chico'));
    await repo().photos.put({ ...foto('t-pho_raro', 't-prd_chico', [9]), blob: new Blob([new Uint8Array([9])], { type: 'image/heic' }), mime: 'image/heic' });
    await sincronizar();
    servidor.maxDatos = 1_000_000;
    expect(servidor.vivos().get('products/t-prd_chico')).toMatchObject({ name: 'Chico' });
    expect(servidor.vivos().has('products/t-prd_grande')).toBe(false);
    expect(servidor.vivos().has('photos/t-pho_raro')).toBe(false);
    expect(estadoSync().rechazos.map((r) => r.clave).sort()).toEqual(['photos/t-pho_raro', 'products/t-prd_grande']);
    expect(await pendientes()).toBe(0);
    // Corregido y guardado otra vez, sube y deja de estar anotado.
    await repo().products.put(producto('t-prd_grande', 'Ya no tan grande'));
    await sincronizar();
    expect(estadoSync().rechazos.map((r) => r.clave)).toEqual(['photos/t-pho_raro']);
  });

  it('la bajada viene por tandas y no pierde nada', async () => {
    await usar(A);
    await repo().products.bulkPut(Array.from({ length: 1300 }, (_, i) => producto(`t-prd_m${i}`, `Masivo ${i}`)));
    await sincronizar();
    await usar(B);
    const antes = servidor.llamadas.filter((l) => l.includes('tabaco_traer')).length;
    await sincronizar();
    expect((await repo().products.all()).filter((p) => p.id.startsWith('t-prd_m'))).toHaveLength(1300);
    // 1300 registros subidos en 5 transacciones (300, 300, 300, 300 y 100). Una tanda de hasta 500
    // nunca parte una transacción: bajan en 4 (300, 300, 300 y 400).
    expect(servidor.llamadas.filter((l) => l.includes('tabaco_traer')).length - antes).toBe(4);
  });

  it('vaciar la línea en un teléfono conectado borra en el servidor, salvo la auditoría', async () => {
    await usar(B);
    const auditoria = [...servidor.vivos().keys()].filter((k) => k.startsWith('audit/')).length;
    await repo().clearAll();
    await sincronizar();
    expect([...servidor.vivos().keys()].filter((k) => k.startsWith('products/'))).toEqual([]);
    expect([...servidor.vivos().keys()].filter((k) => k.startsWith('audit/')).length).toBe(auditoria);
  });

  it('si le quitan el acceso, el teléfono deja de sincronizar', async () => {
    await usar(A);
    servidor.usuarios.get(DUENA)!.cuenta!.activa = false;
    await sincronizar();
    expect(estadoSync().fase).toBe('sin-acceso');
    servidor.usuarios.get(DUENA)!.cuenta!.activa = true;
    await sincronizar();
    expect(estadoSync().fase).toBe('al-dia');
  });
});

describe('invitaciones del servidor', () => {
  it('Administración invita a Dirección; con el link pone su contraseña y entra', async () => {
    const A2 = await nuevo('admin-invita');
    expect((await entrarConCorreo(DUENA, CLAVE)).tipo).toBe('adentro');
    await enCalma();
    const ctx = lineCtx('tabaco', { accountId: 'tabaco:admin', userId: 't-usr_admin', role: 'admin', line: 'tabaco', name: 'Dueña', readOnly: false });
    const { link } = await invitar(ctx, { nombre: 'Socia Nueva', correo: 'Socia@Example.com', rol: 'direccion', dias: 7 });
    expect(link).toMatch(/#\/acceso\/[0-9a-z]+$/);
    const token = link.split('/acceso/')[1]!;

    // La socia abre el link en su teléfono (sin sesión).
    await nuevo('socia');
    expect(await verInvitacion(token)).toMatchObject({ estado: 'vigente', nombre: 'Socia Nueva', rol: 'direccion', correo: 'socia@example.com', cuenta: 'nueva' });
    await expect(aceptarInvitacion(token, 'corta')).rejects.toThrow(/8 caracteres/);
    const r = await aceptarInvitacion(token, 'clave-de-la-socia');
    expect(r).toEqual({ tipo: 'adentro', destino: '/direccion' });
    expect(sesionActual()?.cuenta).toMatchObject({ rol: 'direccion', nombre: 'Socia Nueva' });
    expect((await verInvitacion(token)).estado).toBe('usada');

    // A Administración se le crea su usuario en la línea (para que lo que haga quede con su nombre).
    await usar(A2);
    const inv = await invitar(ctx, { nombre: 'Admin Dos', correo: 'admin2@example.com', rol: 'admin', dias: 3 });
    const nuevoUsuario = (await repo().users.all()).find((u) => u.email === 'admin2@example.com');
    expect(nuevoUsuario).toMatchObject({ role: 'admin', name: 'Admin Dos' });
    await sincronizar();
    await nuevo('admin2');
    const r2 = await aceptarInvitacion(inv.link.split('/acceso/')[1]!, 'clave-admin-dos');
    expect(r2).toEqual({ tipo: 'adentro', destino: '/tabaco' });
    await enCalma();
    expect(sesionActual()?.cuentaApp).toBe(`tabaco:${nuevoUsuario!.id}`);
    expect((await resolveActor('tabaco'))?.actor).toMatchObject({ userId: nuevoUsuario!.id, role: 'admin', readOnly: false });
  });

  it('quien ya tenía cuenta en el servidor no puede ponerle otra contraseña con un link', async () => {
    await nuevo('ajena');
    servidor.agregarUsuario('ajena@example.com', 'clave-de-otra-app', null);
    await usar(await nuevo('admin-invita-2'));
    expect((await entrarConCorreo(DUENA, CLAVE)).tipo).toBe('adentro');
    await enCalma();
    const ctx = lineCtx('tabaco', { accountId: 'tabaco:admin', userId: 't-usr_admin', role: 'admin', line: 'tabaco', name: 'Dueña', readOnly: false });
    const { link } = await invitar(ctx, { nombre: 'Ajena', correo: 'ajena@example.com', rol: 'direccion', dias: 7 });
    const token = link.split('/acceso/')[1]!;
    await nuevo('ajena-2');
    expect((await verInvitacion(token)).cuenta).toBe('otra');
    await expect(aceptarInvitacion(token, 'una-clave-nueva')).rejects.toThrow(/contraseña de siempre/);
    expect(servidor.usuarios.get('ajena@example.com')!.clave).toBe('clave-de-otra-app');
  });
});
