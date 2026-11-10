// Prospectos con lo que se sepa: en un recorrido se anota el local aunque falten el encargado, el
// teléfono o el permiso. Eso se pide antes del contrato (o antes de activarlo si compra en firme).
// Y los recorridos: los prospectos por zona, en orden, con Google Maps por tramos y la visita anotada.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Store, User } from '../../src/data/types';
import { setDbPrefix } from '../../src/data';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import type { LineRepo } from '../../src/data/repo';
import { type Actor, ForbiddenError } from '../../src/domain/permissions';
import { faltaRecolectar, kmDeIda, linkParada, porCercania, tramosGoogleMaps } from '../../src/domain/recorridos';
import { seedEverything } from '../../src/seed';
import { saveZone } from '../../src/services/admin';
import { lineCtx } from '../../src/services/context';
import { issueContract } from '../../src/services/contracts';
import { anotarVisitaProspecto, recorridos } from '../../src/services/recorridos';
import { faltaParaFormalizar, registerStore, setStoreStatus, updateStore, type StoreInput } from '../../src/services/stores';

const NOW = new Date('2026-11-10T15:00:00Z');
const P = 'pruebas-prospectos-';
let repo: LineRepo;
let users: User[];
const actorOf = (u: User): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco', storeId: u.storeId, name: u.name, readOnly: false });
const ctxOf = (u: User) => lineCtx('tabaco', actorOf(u), { repo, now: () => NOW });
const admin = () => users.find((u) => u.role === 'admin')!;
const tomas = () => users.find((u) => u.name === 'Tomás Garza')!;

const SOLO_LO_BASICO: StoreInput = {
  name: 'Lounge Prueba Recorrido',
  type: 'Lounge de puros',
  address: '10 Calle Prueba (dirección de ejemplo)',
  city: 'Houston, TX',
  zoneId: 't-zon_houston',
  lat: 29.75,
  lng: -95.36,
  managerName: '',
  phone: '',
  email: '',
  tobaccoPermit: { number: '', expiresOn: '2027-06-01', issuer: 'Texas Comptroller' },
};

const inputDe = (s: Store, cambios: Partial<StoreInput> = {}): StoreInput => ({
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
  tobaccoPermit: s.tobaccoPermit ? { ...s.tobaccoPermit } : { number: '', expiresOn: '2027-06-01' },
  ...cambios,
});

beforeAll(async () => {
  setDbPrefix(P);
  const repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  await seedEverything(openCoreRepo(P), repos, NOW);
  repo = repos.tabaco;
  users = await repo.users.all();
});

describe('un prospecto se guarda con lo que se sepa', () => {
  it('sin encargado, sin teléfono y sin permiso: queda como prospecto, sin permiso', async () => {
    const s = await registerStore(ctxOf(tomas()), SOLO_LO_BASICO);
    expect(s.status).toBe('prospecto');
    expect(s.managerName).toBe('');
    expect(s.phone).toBe('');
    expect(s.tobaccoPermit).toBeUndefined();
    expect(faltaParaFormalizar(ctxOf(tomas()), s)).toBe('el nombre del encargado');
  });

  it('lo que sí se escribe se revisa igual: teléfono o permiso mal escritos no pasan', async () => {
    await expect(registerStore(ctxOf(tomas()), { ...SOLO_LO_BASICO, phone: 'llamar' })).rejects.toThrow(/teléfono válido/);
    await expect(registerStore(ctxOf(tomas()), { ...SOLO_LO_BASICO, tobaccoPermit: { number: 'AB', expiresOn: '2027-06-01' } })).rejects.toThrow(/número del permiso/);
    await expect(registerStore(ctxOf(tomas()), { ...SOLO_LO_BASICO, email: 'no-es-correo' })).rejects.toThrow(/correo válido/);
  });

  it('el contrato pide encargado, teléfono y permiso; completados, se emite', async () => {
    const s = await registerStore(ctxOf(tomas()), { ...SOLO_LO_BASICO, name: 'Tabaquería Prueba Contrato' });
    await expect(issueContract(ctxOf(tomas()), s.id)).rejects.toThrow(/encargado del local antes de emitir el contrato/);
    let next = await updateStore(ctxOf(tomas()), s.id, inputDe(s, { managerName: 'Encargada Prueba' }));
    await expect(issueContract(ctxOf(tomas()), s.id)).rejects.toThrow(/teléfono del local antes de emitir el contrato/);
    next = await updateStore(ctxOf(tomas()), s.id, inputDe(next, { phone: '(713) 555-0142' }));
    expect(faltaParaFormalizar(ctxOf(tomas()), next)).toBe('el permiso de venta de tabaco');
    await expect(issueContract(ctxOf(tomas()), s.id)).rejects.toThrow(/permiso de venta de tabaco del local antes de emitir el contrato/);
    next = await updateStore(ctxOf(tomas()), s.id, inputDe(next, { tobaccoPermit: { number: 'TP-TX-0142', expiresOn: '2027-06-01', issuer: 'Texas Comptroller' } }));
    expect(faltaParaFormalizar(ctxOf(tomas()), next)).toBeNull();
    const c = await issueContract(ctxOf(tomas()), s.id);
    expect(c.status).toBe('enviado');
    expect((await repo.stores.get(s.id))?.status).toBe('contrato_enviado');
  });

  it('un local que ya pasó de prospecto no se queda sin encargado, teléfono ni permiso', async () => {
    const activo = (await repo.stores.all()).find((s) => s.status === 'activo' && s.marketId === 'houston')!;
    await expect(updateStore(ctxOf(admin()), activo.id, inputDe(activo, { managerName: '' }))).rejects.toThrow(/nombre del encargado/);
    await expect(updateStore(ctxOf(admin()), activo.id, inputDe(activo, { phone: '' }))).rejects.toThrow(/teléfono válido/);
    await expect(updateStore(ctxOf(admin()), activo.id, inputDe(activo, { tobaccoPermit: { number: '', expiresOn: '2027-06-01' } }))).rejects.toThrow(/número del permiso/);
  });

  it('compra en firme: no se activa sin lo que pediría el contrato', async () => {
    const s = await registerStore(ctxOf(admin()), {
      ...SOLO_LO_BASICO,
      name: 'Licorería Prueba en Firme',
      sellerId: tomas().id,
      terms: { saleMode: 'firme', creditDays: 0 },
    });
    expect(s.saleMode).toBe('firme');
    await expect(setStoreStatus(ctxOf(admin()), s.id, 'activo')).rejects.toThrow(/Antes de activarlo, completa el nombre del encargado/);
    await updateStore(ctxOf(admin()), s.id, inputDe(s, { managerName: 'Encargado Firme', phone: '(713) 555-0177', tobaccoPermit: { number: 'TP-TX-0177', expiresOn: '2027-06-01' } }));
    await setStoreStatus(ctxOf(admin()), s.id, 'activo');
    expect((await repo.stores.get(s.id))?.status).toBe('activo');
  });
});

// ---------- Recorridos ----------

describe('recorridos: orden, kilómetros y Google Maps', () => {
  const A = { lat: 29.79, lng: -95.398, direccion: '1 Calle A, Houston, TX' };
  const B = { lat: 29.803, lng: -95.4, direccion: '2 Calle B, Houston, TX' };
  const C = { lat: 29.785, lng: -95.42, direccion: '3 Calle C, Houston, TX' };
  const CENTRO = { lat: 29.76, lng: -95.37 };

  it('vecino más cercano desde el inicio', () => {
    expect(porCercania(CENTRO, [C, B, A]).map((p) => p.direccion)).toEqual([A.direccion, B.direccion, C.direccion]);
    expect(porCercania({ lat: 29.785, lng: -95.421 }, [A, B, C])[0]).toBe(C);
    expect(porCercania(CENTRO, [])).toEqual([]);
  });

  it('kilómetros de ida, por 1.3 y con un decimal', () => {
    expect(kmDeIda(CENTRO, [])).toBe(0);
    const km = kmDeIda(CENTRO, [A, B, C]);
    expect(km).toBeGreaterThan(6);
    expect(km).toBeLessThan(12);
    expect(Math.round(km * 10)).toBe(km * 10);
  });

  it('tramos de 4 paradas: el primero sale de donde está el teléfono, el siguiente de la última parada', () => {
    const cinco = [A, B, C, { ...A, direccion: '4 Calle D, Houston, TX' }, { ...B, direccion: '5 Calle E, Houston, TX' }];
    const t = tramosGoogleMaps(cinco);
    expect(t.map((x) => [x.desde, x.hasta])).toEqual([
      [1, 4],
      [5, 5],
    ]);
    const uno = new URL(t[0]!.url);
    expect(uno.origin + uno.pathname).toBe('https://www.google.com/maps/dir/');
    expect(uno.searchParams.get('api')).toBe('1');
    expect(uno.searchParams.get('origin')).toBeNull();
    expect(uno.searchParams.get('destination')).toBe('4 Calle D, Houston, TX');
    expect(uno.searchParams.get('waypoints')).toBe('1 Calle A, Houston, TX|2 Calle B, Houston, TX|3 Calle C, Houston, TX');
    expect(uno.searchParams.get('travelmode')).toBe('driving');
    const dos = new URL(t[1]!.url);
    expect(dos.searchParams.get('origin')).toBe('4 Calle D, Houston, TX');
    expect(dos.searchParams.get('destination')).toBe('5 Calle E, Houston, TX');
    expect(dos.searchParams.get('waypoints')).toBeNull();
    // Sin dirección, el punto.
    expect(new URL(linkParada({ lat: 29.8, lng: -95.4 })).searchParams.get('destination')).toBe('29.8,-95.4');
  });

  it('lo que falta anotar', () => {
    const vacio = { managerName: '', phone: '', email: '', hours: '', tobaccoPermit: undefined };
    expect(faltaRecolectar(vacio, true)).toEqual(['encargado', 'telefono', 'correo', 'horario', 'permiso']);
    expect(faltaRecolectar(vacio, false)).not.toContain('permiso');
    expect(faltaRecolectar({ managerName: 'Ana Prueba', phone: '(713) 555-0100', email: 'a@example.com', hours: 'Lun–Sáb', tobaccoPermit: { number: 'TP-1234', expiresOn: '2027-01-01' } }, true)).toEqual([]);
  });
});

describe('recorridos en la app', () => {
  let heights = '';
  let galleria = '';
  const ids: Record<string, string> = {};
  const prospecto = (name: string, zoneId: string, lat: number, lng: number): StoreInput => ({ ...SOLO_LO_BASICO, name, zoneId, lat, lng, address: `${name} 100 (dirección de ejemplo)` });

  beforeAll(async () => {
    heights = (await saveZone(ctxOf(admin()), { name: 'Prueba Heights', lat: 29.8, lng: -95.4, marketId: 'houston' })).id;
    galleria = (await saveZone(ctxOf(admin()), { name: 'Prueba Galleria', lat: 29.74, lng: -95.46, marketId: 'houston' })).id;
    for (const [name, zone, lat, lng] of [
      ['Parada C', heights, 29.785, -95.42],
      ['Parada A', heights, 29.79, -95.398],
      ['Parada B', heights, 29.803, -95.4],
      ['Parada G1', galleria, 29.74, -95.46],
    ] as const) {
      ids[name] = (await registerStore(ctxOf(tomas()), prospecto(name, zone, lat, lng))).id;
    }
  });

  const zona = async (zoneId: string, desde?: { lat: number; lng: number }) => (await recorridos(ctxOf(tomas()), { desde })).recorridos.find((r) => r.zoneId === zoneId)!;

  it('por zona, en orden desde el centro del mercado, con lo que falta y los tramos', async () => {
    const r = await zona(heights);
    expect(r.zona).toBe('Prueba Heights');
    expect(r.marketId).toBe('houston');
    expect(r.paradas.map((x) => x.store.name)).toEqual(['Parada A', 'Parada B', 'Parada C']);
    expect(r.paradas[0]!.falta).toEqual(['encargado', 'telefono', 'correo', 'horario', 'permiso']);
    expect(r.tramos).toHaveLength(1);
    // Google Maps busca el local por su nombre y su dirección.
    expect(new URL(r.tramos[0]!.url).searchParams.get('destination')).toBe('Parada C, Parada C 100 (dirección de ejemplo), Houston, TX');
    expect(new URL(r.paradas[0]!.comoLlegar).searchParams.get('destination')).toBe('Parada A, Parada A 100 (dirección de ejemplo), Houston, TX');
    expect(r.km).toBeGreaterThan(0);
    expect(r.hechas).toEqual([]);
    // Desde donde está la persona (al lado de C), C va primero.
    expect((await zona(heights, { lat: 29.785, lng: -95.421 })).paradas[0]!.store.name).toBe('Parada C');
  });

  it('anotar la visita: lo que dio queda en el local; vacío no borra; «no estaba» lo deja para volver', async () => {
    await expect(anotarVisitaProspecto(ctxOf(tomas()), ids['Parada A']!, { result: 'interesado', managerName: 'Lu' })).rejects.toThrow(/3 letras/);
    await expect(anotarVisitaProspecto(ctxOf(tomas()), ids['Parada A']!, { result: 'interesado', permitNumber: 'TP-TX-9001' })).rejects.toThrow(/vencimiento/);
    await expect(anotarVisitaProspecto(ctxOf(tomas()), ids['Parada A']!, { result: 'interesado', phone: 'llamar' })).rejects.toThrow(/teléfono válido/);

    await anotarVisitaProspecto(ctxOf(tomas()), ids['Parada A']!, { result: 'sin_encargado', phone: '(713) 555-0161', note: 'Volver el martes en la tarde' });
    let r = await zona(heights);
    const a = r.paradas.find((x) => x.store.name === 'Parada A')!;
    expect(a.store.phone).toBe('(713) 555-0161');
    expect(a.ultima).toMatchObject({ result: 'sin_encargado', note: 'Volver el martes en la tarde', by: tomas().id });
    expect(a.falta).not.toContain('telefono');

    const s = await anotarVisitaProspecto(ctxOf(tomas()), ids['Parada A']!, {
      result: 'interesado',
      managerName: 'Encargado Prueba A',
      phone: '',
      email: 'a@example.com',
      hours: 'Lun–Sáb 10:00–20:00',
      permitNumber: 'TP-TX-9001',
      permitExpires: '2027-09-30',
    });
    expect(s.phone).toBe('(713) 555-0161');
    expect(s.tobaccoPermit).toEqual({ number: 'TP-TX-9001', expiresOn: '2027-09-30', issuer: 'Texas Comptroller' });
    expect(s.prospectVisits?.map((v) => v.result)).toEqual(['sin_encargado', 'interesado']);
    expect(faltaParaFormalizar(ctxOf(tomas()), s)).toBeNull();
    r = await zona(heights);
    expect(r.paradas.map((x) => x.store.name).sort()).toEqual(['Parada B', 'Parada C']);
    expect(r.hechas.map((x) => x.store.name)).toEqual(['Parada A']);
    const audits = await repo.audit.all();
    expect(audits.some((x) => x.action === 'local.visita_prospecto' && x.summary.includes('Parada A: Le interesa'))).toBe(true);
  });

  it('el vendedor ve y anota solo lo suyo; un local que ya no es prospecto no sale ni se anota así', async () => {
    const andres = users.find((u) => u.name === 'Andrés Molina')!;
    const deAndres = await recorridos(ctxOf(andres));
    expect(deAndres.recorridos.some((r) => r.zoneId === heights)).toBe(false);
    await expect(anotarVisitaProspecto(ctxOf(andres), ids['Parada B']!, { result: 'lo_piensa' })).rejects.toBeInstanceOf(ForbiddenError);
    // Administración ve todos.
    expect((await recorridos(ctxOf(admin()))).recorridos.find((r) => r.zoneId === galleria)?.paradas.map((x) => x.store.name)).toEqual(['Parada G1']);
    await setStoreStatus(ctxOf(admin()), ids['Parada G1']!, 'cerrado');
    expect((await recorridos(ctxOf(admin()))).recorridos.some((r) => r.zoneId === galleria)).toBe(false);
    await expect(anotarVisitaProspecto(ctxOf(admin()), ids['Parada G1']!, { result: 'lo_piensa' })).rejects.toThrow(/ya no es prospecto/);
  });
});
