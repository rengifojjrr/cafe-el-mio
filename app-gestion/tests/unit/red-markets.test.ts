// Mercados (R3-7): Miami y Houston, a qué mercado pertenece cada cosa y los filtros.
import { beforeAll, describe, expect, it } from 'vitest';
import type { DeliveryRoute, Invitation, Market, Store, User } from '../../src/data/types';
import { setDbPrefix } from '../../src/data';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import type { LineRepo } from '../../src/data/repo';
import { MIAMI, marketsOf, newMarketId, pointInMarket, storeMarketId, userMarketId, zoneMarketId } from '../../src/domain/markets';
import { type Actor, ForbiddenError } from '../../src/domain/permissions';
import { buildLine, seedEverything } from '../../src/seed';
import { saveUser, saveZone } from '../../src/services/admin';
import { mapData, reports } from '../../src/services/analytics';
import { lineCtx } from '../../src/services/context';
import { lineOverview } from '../../src/services/direccion';
import { listMarkets, saveMarkets } from '../../src/services/markets';
import { registerStore } from '../../src/services/stores';

const NOW = new Date('2026-11-05T15:00:00Z');
const HOU: Market = { id: 'houston', name: 'Houston', lat: 29.76, lng: -95.37, zoom: 10 };

describe('a qué mercado pertenece cada cosa', () => {
  const markets = [MIAMI, HOU];
  const zones = new Map([
    ['z-mia', { marketId: 'miami' }],
    ['z-hou', { marketId: 'houston' }],
    ['z-vieja', {}],
  ]);
  it('sin mercados guardados: Miami', () => {
    expect(marketsOf(undefined)).toEqual([MIAMI]);
    expect(marketsOf({ markets: [] })).toEqual([MIAMI]);
    expect(marketsOf({ markets })).toEqual(markets);
  });
  it('zona sin mercado (o con uno que ya no existe): el primero', () => {
    expect(zoneMarketId({}, markets)).toBe('miami');
    expect(zoneMarketId({ marketId: 'dallas' }, markets)).toBe('miami');
    expect(zoneMarketId({ marketId: 'houston' }, markets)).toBe('houston');
  });
  it('local y vendedor: el suyo; si no, el de su zona', () => {
    expect(storeMarketId({ zoneId: 'z-hou' }, zones, markets)).toBe('houston');
    expect(storeMarketId({ zoneId: 'z-vieja' }, zones, markets)).toBe('miami');
    expect(storeMarketId({ zoneId: 'z-mia', marketId: 'houston' }, zones, markets)).toBe('houston');
    expect(userMarketId({ zoneId: 'z-hou' }, zones, markets)).toBe('houston');
    expect(userMarketId({}, zones, markets)).toBe('miami');
  });
  it('el punto tiene que quedar en el área del mercado', () => {
    expect(pointInMarket(HOU, 29.74, -95.38)).toBe(true);
    expect(pointInMarket(HOU, 25.8, -80.3)).toBe(false);
    expect(pointInMarket(MIAMI, 26.12, -80.14)).toBe(true);
  });
  it('id nuevo a partir del nombre, sin repetir', () => {
    expect(newMarketId('Fort Worth', [])).toBe('fort-worth');
    expect(newMarketId('Houston', ['houston'])).toBe('houston-2');
  });
});

describe('semilla de la ronda 3', () => {
  const t = buildLine('tabaco', NOW);
  const c = buildLine('cafe', NOW);
  it('tabaco: Miami y Houston; lo de antes es de Miami', () => {
    const stores = t.stores as Store[];
    expect(marketsOf((t.settings as { markets?: Market[] }[])[0]).map((m) => m.id)).toEqual(['miami', 'houston']);
    const houston = stores.filter((s) => s.marketId === 'houston');
    expect(houston).toHaveLength(5);
    for (const s of houston) {
      expect(s.city).toBe('Houston, TX');
      expect(s.address).toContain('(dirección de ejemplo)');
      expect(s.phone).toMatch(/^\(713\) 555-01\d\d$/);
      expect(s.tobaccoPermit?.issuer).toBe('Texas Comptroller');
      expect(pointInMarket(HOU, s.lat, s.lng)).toBe(true);
    }
    expect(stores.filter((s) => s.marketId === 'miami')).toHaveLength(18);
    const sellers = (t.users as User[]).filter((u) => u.role === 'seller');
    expect(sellers.filter((u) => u.marketId === 'houston').map((u) => u.name)).toEqual(['Tomás Garza']);
    expect(marketsOf((c.settings as { markets?: Market[] }[])[0]).map((m) => m.id)).toEqual(['miami']);
  });
  it('repartos terminados con costo, el borrador de hoy y entregas listas', () => {
    const routes = t.routes as DeliveryRoute[];
    const done = routes.filter((r) => r.status === 'terminado');
    expect(done.length).toBeGreaterThan(20);
    for (const r of done) {
      expect(r.km).toBeGreaterThan(0);
      expect(r.driverCost).toBeGreaterThan(0);
    }
    expect(routes.filter((r) => r.status === 'borrador')).toHaveLength(1);
    expect((c.routes as DeliveryRoute[]).length).toBeGreaterThan(10);
  });
  it('invitaciones de ejemplo: una vigente, una vencida y una revocada', () => {
    const inv = t.invitations as Invitation[];
    expect(inv).toHaveLength(3);
    expect(inv.filter((i) => i.revokedAt)).toHaveLength(1);
  });
});

// ---------- Servicios ----------

const P = 'pruebas-mercados-';
let repo: LineRepo;
let users: User[];
const actorOf = (u: User): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco', storeId: u.storeId, name: u.name, readOnly: false });
const ctxOf = (u: User) => lineCtx('tabaco', actorOf(u), { repo, now: () => NOW });
const admin = () => users.find((u) => u.role === 'admin')!;

beforeAll(async () => {
  // Dirección lee con getLineRepo: misma base que las pruebas.
  setDbPrefix(P);
  const repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  await seedEverything(openCoreRepo(P), repos, NOW);
  repo = repos.tabaco;
  users = await repo.users.all();
});

describe('mercados en la app', () => {
  it('el mapa dice el mercado de cada local; el filtro de Rentabilidad deja solo ese mercado', async () => {
    const map = await mapData(ctxOf(admin()));
    expect(map.markets.map((m) => m.id)).toEqual(['miami', 'houston']);
    expect(map.stores.filter((s) => s.marketId === 'houston')).toHaveLength(5);
    const all = await reports(ctxOf(admin()), 90);
    const hou = await reports(ctxOf(admin()), 90, { marketId: 'houston' });
    const mia = await reports(ctxOf(admin()), 90, { marketId: 'miami' });
    expect(hou.marketId).toBe('houston');
    const names = new Set(hou.byStore.map((r) => r.label));
    expect([...names].every((n) => ['Tabaquería Bayou', 'Licorería Westheimer 22', 'Lounge Montrose', 'Bodega Magnolia'].includes(n))).toBe(true);
    const rev = (r: typeof all) => r.byProduct.reduce((a, x) => a + x.revenue, 0);
    expect(rev(hou) + rev(mia)).toBeCloseTo(rev(all), 1);
    // Houston no tiene repartos (sale de Miami por transporte aparte): sin costo de distribución.
    expect(hou.byStore.reduce((a, x) => a + x.distribution, 0)).toBe(0);
  });

  it('Dirección: las cifras de un mercado (el almacén es de toda la línea)', async () => {
    const dir: Actor = { accountId: 'direccion', userId: 'direccion', role: 'direccion', line: null, name: 'Dirección', readOnly: true };
    const all = await lineOverview(dir, 'tabaco', NOW);
    const hou = await lineOverview(dir, 'tabaco', NOW, { marketId: 'houston' });
    const mia = await lineOverview(dir, 'tabaco', NOW, { marketId: 'miami' });
    expect(all.totalStores).toBe(23);
    expect(hou.totalStores).toBe(5);
    expect(hou.activeStores).toBe(4);
    expect(hou.sales30).toBeGreaterThan(0);
    expect(hou.sales30 + mia.sales30).toBeCloseTo(all.sales30, 1);
    expect(hou.inventoryCost).toBe(0);
    expect(all.inventoryCost).toBeGreaterThan(0);
  });

  it('registrar un local en Houston: zona de Houston y punto en Houston', async () => {
    const tomas = users.find((u) => u.name === 'Tomás Garza')!;
    const base = {
      name: 'Tabaquería Prueba Houston',
      type: 'Tabaquería',
      address: '10 Calle Prueba (dirección de ejemplo)',
      city: 'Houston, TX',
      zoneId: 't-zon_houston',
      lat: 29.75,
      lng: -95.36,
      managerName: 'Encargado Prueba',
      phone: '(713) 555-0199',
      email: '',
      tobaccoPermit: { number: 'TP-TX-0001', expiresOn: '2027-06-01', issuer: 'Texas Comptroller' },
    };
    const s = await registerStore(ctxOf(tomas), base);
    expect(s.marketId).toBe('houston');
    expect(s.tobaccoPermit?.issuer).toBe('Texas Comptroller');
    await expect(registerStore(ctxOf(tomas), { ...base, lat: 25.8, lng: -80.3 })).rejects.toThrow(/lejos de Houston/);
    await expect(registerStore(ctxOf(tomas), { ...base, zoneId: 't-zon_hialeah' })).rejects.toThrow(/sur de Florida/);
    await expect(registerStore(ctxOf(tomas), { ...base, marketId: 'miami' })).rejects.toThrow(/otro mercado/);
  });

  it('zonas y vendedores con su mercado', async () => {
    const z = await saveZone(ctxOf(admin()), { name: 'Houston Norte', lat: 29.9, lng: -95.4, marketId: 'houston' });
    expect(z.marketId).toBe('houston');
    await expect(saveZone(ctxOf(admin()), { name: 'Mal puesta', lat: 25.8, lng: -80.3, marketId: 'houston' })).rejects.toThrow(/lejos de Houston/);
    const tomas = users.find((u) => u.name === 'Tomás Garza')!;
    await expect(saveUser(ctxOf(admin()), { id: tomas.id, role: 'seller', name: tomas.name, email: tomas.email, phone: tomas.phone, zoneId: 't-zon_hialeah', marketId: 'houston' })).rejects.toThrow(/otro mercado/);
    const saved = await saveUser(ctxOf(admin()), { id: tomas.id, role: 'seller', name: tomas.name, email: tomas.email, phone: tomas.phone, zoneId: z.id, marketId: 'houston' });
    expect(saved.marketId).toBe('houston');
    // Guardar el vendedor no le borra su comisión progresiva propia.
    expect(saved.commissionScheme).toBeDefined();
  });

  it('la lista de mercados: se agrega, se renombra, y no se quita uno con locales', async () => {
    const before = await listMarkets(ctxOf(admin()));
    await expect(saveMarkets(ctxOf(admin()), [before[0]!])).rejects.toThrow(/todavía tiene/);
    const next = await saveMarkets(ctxOf(admin()), [...before, { name: 'Dallas', lat: 32.78, lng: -96.8, zoom: 10 }]);
    expect(next.map((m) => m.id)).toEqual(['miami', 'houston', 'dallas']);
    const renamed = await saveMarkets(ctxOf(admin()), next.map((m) => (m.id === 'dallas' ? { ...m, name: 'Dallas–Fort Worth' } : m)));
    expect(renamed.find((m) => m.id === 'dallas')?.name).toBe('Dallas–Fort Worth');
    // Sin nada adentro, se puede quitar.
    expect((await saveMarkets(ctxOf(admin()), renamed.filter((m) => m.id !== 'dallas'))).map((m) => m.id)).toEqual(['miami', 'houston']);
    const andres = users.find((u) => u.name === 'Andrés Molina')!;
    await expect(saveMarkets(ctxOf(andres), before)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
