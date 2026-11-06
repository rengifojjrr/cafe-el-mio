// Repartos (R3-7): km estimados, costo de la ruta, reparto del costo por unidades entregadas y el
// circuito borrador → en ruta → terminado, con su costo en Rentabilidad.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Delivery, DeliveryRoute, User } from '../../src/data/types';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import type { LineRepo } from '../../src/data/repo';
import { type Actor, ForbiddenError } from '../../src/domain/permissions';
import { ROUTE_FACTOR, allocateRouteCost, deliveredUnits, estimateRouteKm, haversineKm, routePath, routeTotalCost } from '../../src/domain/routes';
import { seedEverything } from '../../src/seed';
import { pnlByMonth, reports } from '../../src/services/analytics';
import { lineCtx } from '../../src/services/context';
import { createRoute, deleteRoute, distributionShares, getRoute, listRoutes, moveRouteStop, readyDeliveries, saveRouteCosts, setRouteStatus, setRouteStops } from '../../src/services/routes';

describe('km y costo', () => {
  const doral = { lat: 25.813, lng: -80.343 };
  const hialeah = { lat: 25.8612, lng: -80.2788 };
  const beach = { lat: 25.7905, lng: -80.13 };

  it('haversine: Doral → Hialeah son unos 8 km en línea recta', () => {
    const km = haversineKm(doral, hialeah);
    expect(km).toBeGreaterThan(7.5);
    expect(km).toBeLessThan(8.6);
    expect(haversineKm(doral, doral)).toBe(0);
  });

  it('estimado: ida y vuelta por las paradas en orden, × 1.3', () => {
    const legs = haversineKm(doral, hialeah) + haversineKm(hialeah, beach) + haversineKm(beach, doral);
    expect(estimateRouteKm(doral, [hialeah, beach])).toBeCloseTo(Math.round(legs * ROUTE_FACTOR * 10) / 10, 5);
    expect(estimateRouteKm(doral, [])).toBe(0);
    expect(routePath(doral, [hialeah])).toEqual([
      [doral.lat, doral.lng],
      [hialeah.lat, hialeah.lng],
      [doral.lat, doral.lng],
    ]);
  });

  it('costo total = km × costo por km + chofer + peajes', () => {
    expect(routeTotalCost({ km: 40, costPerKm: 0.65, driverCost: 50, tolls: 4.5 })).toBe(80.5);
    expect(routeTotalCost({ km: -3, costPerKm: 1, driverCost: 0, tolls: 0 })).toBe(0);
  });
});

describe('reparto del costo por unidades entregadas', () => {
  const d = (id: string, storeId: string, status: Delivery['status'], items: [string, number][]): Delivery =>
    ({ id, storeId, sellerId: `v-${storeId}`, status, items: items.map(([productId, q]) => ({ productId, qty: q, preparedQty: q })) }) as Delivery;
  const deliveries = new Map([
    ['e1', d('e1', 's1', 'entregada', [['p1', 30], ['p2', 10]])],
    ['e2', d('e2', 's2', 'entregada', [['p1', 60]])],
    ['e3', d('e3', 's3', 'preparada', [['p1', 500]])],
  ]);
  const route = (stops: string[], cost: Partial<DeliveryRoute> = {}): DeliveryRoute =>
    ({ id: 'r1', date: '2026-11-02', stops: stops.map((x) => ({ deliveryId: x, storeId: deliveries.get(x)!.storeId })), km: 100, costPerKm: 1, driverCost: 0, tolls: 0, ...cost }) as DeliveryRoute;

  it('cada parada y producto se lleva su parte según unidades', () => {
    const { shares, unallocated } = allocateRouteCost(route(['e1', 'e2']), deliveries);
    expect(unallocated).toBe(0);
    const by = (store: string, product: string) => shares.find((s) => s.storeId === store && s.productId === product)!;
    expect(by('s1', 'p1').cost).toBe(30);
    expect(by('s1', 'p2').cost).toBe(10);
    expect(by('s2', 'p1').cost).toBe(60);
    expect(by('s2', 'p1').sellerId).toBe('v-s2');
  });

  it('lo que no se entregó no lleva costo; los centavos del redondeo cuadran el total', () => {
    const { shares } = allocateRouteCost(route(['e1', 'e2', 'e3'], { km: 10, costPerKm: 1, driverCost: 0.01 }), deliveries);
    expect(shares.some((s) => s.storeId === 's3')).toBe(false);
    expect(Math.round(shares.reduce((a, s) => a + s.cost, 0) * 100) / 100).toBe(10.01);
  });

  it('una ruta que no entregó nada deja su costo sin repartir', () => {
    const r = allocateRouteCost(route(['e3']), deliveries);
    expect(r.shares).toEqual([]);
    expect(r.unallocated).toBe(100);
    expect(deliveredUnits(deliveries.get('e3')!)).toBe(0);
    expect(deliveredUnits(deliveries.get('e1')!)).toBe(40);
  });
});

// ---------- Servicios, con la semilla ----------

const NOW = new Date('2026-11-05T15:00:00Z');
const P = 'pruebas-repartos-';
let repo: LineRepo;
let users: User[];
const actorOf = (u: User): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco', storeId: u.storeId, name: u.name, readOnly: false });
const ctxOf = (u: User) => lineCtx('tabaco', actorOf(u), { repo, now: () => NOW });
let admin: User;

beforeAll(async () => {
  const repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  await seedEverything(openCoreRepo(P), repos, NOW);
  repo = repos.tabaco;
  users = await repo.users.all();
  admin = users.find((u) => u.role === 'admin')!;
});

describe('repartos en la app', () => {
  it('la semilla trae repartos terminados y el borrador de hoy; quedan entregas listas sin reparto', async () => {
    const list = await listRoutes(ctxOf(admin));
    expect(list.filter((r) => r.status === 'terminado').length).toBeGreaterThan(10);
    const draft = list.find((r) => r.status === 'borrador')!;
    expect(draft.stops.length).toBe(2);
    expect(draft.km).toBe(draft.estimatedKm);
    const ready = await readyDeliveries(ctxOf(admin));
    expect(ready.length).toBe(2);
    for (const r of ready) expect(draft.stops.some((s) => s.deliveryId === r.id)).toBe(false);
  });

  it('armar, ordenar, costear y terminar: el costo entra en Rentabilidad', async () => {
    const ctx = ctxOf(admin);
    const ready = await readyDeliveries(ctx);
    const route = await createRoute(ctx, { driver: 'Chofer de prueba', vehicle: 'Van de prueba', deliveryIds: ready.map((d) => d.id) });
    expect(route.status).toBe('borrador');
    expect(route.code).toMatch(/^R-\d{4}$/);
    for (const d of ready) expect((await repo.deliveries.get(d.id))?.routeId).toBe(route.id);
    expect(await readyDeliveries(ctx)).toHaveLength(0);
    // Mismas entregas en otro reparto: no.
    await expect(createRoute(ctx, { deliveryIds: [ready[0]!.id] })).rejects.toThrow(/otro reparto/);

    const before = (await getRoute(ctx, route.id)).stopsView.map((s) => s.deliveryId);
    const moved = await moveRouteStop(ctx, route.id, before[0]!, 1);
    expect(moved.stops.map((s) => s.deliveryId)).toEqual([before[1], before[0]]);
    // Los km seguían siendo el estimado: se vuelven a estimar (aquí el recorrido inverso mide lo mismo).
    const view = await getRoute(ctx, route.id);
    expect(view.km).toBe(view.estimatedKm);

    const saved = await saveRouteCosts(ctx, route.id, { km: 40, costPerKm: 0.65, driverCost: 50, tolls: 4.5 });
    expect(routeTotalCost(saved)).toBe(80.5);
    // Corregidos a mano, los km se respetan al reordenar.
    await moveRouteStop(ctx, route.id, before[0]!, -1);
    expect((await getRoute(ctx, route.id)).km).toBe(40);

    await expect(setRouteStatus(ctx, route.id, 'terminado')).rejects.toThrow(/no pasa/);
    await setRouteStatus(ctx, route.id, 'en_ruta');
    await setRouteStatus(ctx, route.id, 'terminado');
    await expect(saveRouteCosts(ctx, route.id, { km: 1, costPerKm: 1, driverCost: 0, tolls: 0 })).rejects.toThrow(/terminado/);
    // Todavía no se entregó nada en esas paradas: el costo queda sin repartir.
    const dist = await distributionShares(ctx, '2026-11-01');
    expect(dist.unallocated).toBeGreaterThanOrEqual(80.5);
  });

  it('Rentabilidad y el estado de resultados cuentan el costo de distribución', async () => {
    const ctx = ctxOf(admin);
    const r = await reports(ctx, 90);
    const total = r.byProduct.reduce((a, x) => a + x.distribution, 0);
    expect(total).toBeGreaterThan(0);
    for (const x of r.byStore) expect(x.margin).toBeCloseTo(x.revenue - x.cogs - x.commissions - x.distribution, 1);
    const sumStores = r.byStore.reduce((a, x) => a + x.distribution, 0);
    expect(sumStores).toBeCloseTo(total, 1);
    const pnl = await pnlByMonth(ctx, 4);
    expect(pnl.some((m) => m.distribution > 0)).toBe(true);
    for (const m of pnl) expect(m.grossMargin).toBeCloseTo(m.revenue - m.cogs - m.commissions - m.shrink - m.distribution, 1);
  });

  it('quitar paradas y borrar un borrador devuelve las entregas a «listas»', async () => {
    const ctx = ctxOf(admin);
    const draft = (await listRoutes(ctx)).find((r) => r.status === 'borrador')!;
    const [first, second] = draft.stops;
    await setRouteStops(ctx, draft.id, [first!.deliveryId]);
    expect((await repo.deliveries.get(second!.deliveryId))?.routeId).toBeUndefined();
    expect((await readyDeliveries(ctx)).map((d) => d.id)).toContain(second!.deliveryId);
    await expect(setRouteStops(ctx, draft.id, [])).rejects.toThrow(/al menos una parada/);
    await deleteRoute(ctx, draft.id);
    expect(await repo.routes.get(draft.id)).toBeUndefined();
    expect((await readyDeliveries(ctx)).map((d) => d.id)).toEqual(expect.arrayContaining([first!.deliveryId, second!.deliveryId]));
  });

  it('solo administración ve y arma repartos', async () => {
    const andres = users.find((u) => u.name === 'Andrés Molina')!;
    await expect(listRoutes(ctxOf(andres))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createRoute(ctxOf(andres), { deliveryIds: ['x'] })).rejects.toBeInstanceOf(ForbiddenError);
    const ro = lineCtx('tabaco', { ...actorOf(admin), readOnly: true }, { repo, now: () => NOW });
    await expect(createRoute(ro, { deliveryIds: ['x'] })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
