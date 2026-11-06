// Repartos (administración): la ruta del día de un camión con las entregas listas para salir, sus
// paradas en orden, el mapa y lo que costó (km × costo por km + chofer + peajes).
// borrador → en ruta → terminado. El costo de los repartos terminados entra en Rentabilidad,
// repartido por unidades entregadas (ver domain/routes.ts).
import { z } from 'zod';
import type { Delivery, DeliveryRoute, DeliveryStatus, IsoDate, RouteStatus } from '../data/types';
import { type CostShare, DEFAULT_COST_PER_KM, allocateRouteCost, estimateRouteKm, routeTotalCost } from '../domain/routes';
import { round2 } from '../lib/money';
import { toIsoDate } from '../lib/time';
import { type Ctx, NotFoundError, ValidationError, audit, getSettings, guard, mutate, nowIso } from './context';

export const ROUTE_STATUS_LABEL: Record<RouteStatus, string> = {
  borrador: 'Borrador',
  en_ruta: 'En ruta',
  terminado: 'Terminado',
};

export interface RouteStopView {
  deliveryId: string;
  deliveryCode: string;
  deliveryStatus: DeliveryStatus;
  storeId: string;
  storeName: string;
  address: string;
  lat: number;
  lng: number;
  units: number;
  /** Parte del costo de la ruta que le toca a esta parada (por unidades entregadas). */
  cost: number;
}

export interface RouteView extends DeliveryRoute {
  stopsView: RouteStopView[];
  total: number;
  /** Km estimados con el orden de hoy (puede diferir de `km` si se corrigió a mano). */
  estimatedKm: number;
  units: number;
  warehouse: { name: string; lat: number; lng: number };
}

async function warehousePoint(ctx: Ctx) {
  const w = await ctx.repo.warehouses.get('almacen');
  return { name: w?.name ?? 'Almacén', lat: w?.lat ?? 25.81, lng: w?.lng ?? -80.33 };
}

function deliveryUnits(d: Pick<Delivery, 'items' | 'status'>): number {
  return d.items.reduce((a, i) => a + (d.status === 'preparada' || d.status === 'entregada' ? (i.preparedQty ?? 0) : i.qty), 0);
}

async function buildViews(ctx: Ctx, routes: DeliveryRoute[]): Promise<RouteView[]> {
  const [deliveries, stores, wh] = await Promise.all([ctx.repo.deliveries.all(), ctx.repo.stores.all(), warehousePoint(ctx)]);
  const dById = new Map(deliveries.map((d) => [d.id, d]));
  const sById = new Map(stores.map((s) => [s.id, s]));
  return routes.map((r) => {
    const costByDelivery = new Map<string, number>();
    for (const sh of allocateRouteCost(r, dById).shares) costByDelivery.set(sh.deliveryId, round2((costByDelivery.get(sh.deliveryId) ?? 0) + sh.cost));
    const stopsView: RouteStopView[] = r.stops.map((st) => {
      const d = dById.get(st.deliveryId);
      const s = sById.get(st.storeId);
      return {
        deliveryId: st.deliveryId,
        deliveryCode: d?.code ?? '—',
        deliveryStatus: d?.status ?? 'rechazada',
        storeId: st.storeId,
        storeName: s?.name ?? '—',
        address: s ? `${s.address}, ${s.city}` : '',
        lat: s?.lat ?? wh.lat,
        lng: s?.lng ?? wh.lng,
        units: d ? deliveryUnits(d) : 0,
        cost: costByDelivery.get(st.deliveryId) ?? 0,
      };
    });
    return {
      ...r,
      stopsView,
      total: routeTotalCost(r),
      estimatedKm: estimateRouteKm(wh, stopsView),
      units: stopsView.reduce((a, s) => a + s.units, 0),
      warehouse: wh,
    };
  });
}

export async function listRoutes(ctx: Ctx): Promise<RouteView[]> {
  guard(ctx, 'route.read');
  const all = await ctx.repo.routes.all();
  return buildViews(ctx, all.sort((a, b) => b.date.localeCompare(a.date) || b.code.localeCompare(a.code)));
}

export async function getRoute(ctx: Ctx, routeId: string): Promise<RouteView> {
  guard(ctx, 'route.read');
  const r = await ctx.repo.routes.get(routeId);
  if (!r) throw new NotFoundError('el reparto');
  return (await buildViews(ctx, [r]))[0]!;
}

export interface ReadyDelivery {
  id: string;
  code: string;
  storeId: string;
  storeName: string;
  address: string;
  units: number;
  preparedAt?: string;
}

/** Entregas listas para salir que todavía no van en un reparto abierto. */
export async function readyDeliveries(ctx: Ctx): Promise<ReadyDelivery[]> {
  guard(ctx, 'route.read');
  const [deliveries, stores, routes] = await Promise.all([ctx.repo.deliveries.where('status', 'preparada'), ctx.repo.stores.all(), ctx.repo.routes.all()]);
  const open = new Set(routes.filter((r) => r.status !== 'terminado').flatMap((r) => r.stops.map((s) => s.deliveryId)));
  const sById = new Map(stores.map((s) => [s.id, s]));
  return deliveries
    .filter((d) => !open.has(d.id))
    .map((d) => {
      const s = sById.get(d.storeId);
      return { id: d.id, code: d.code, storeId: d.storeId, storeName: s?.name ?? '—', address: s ? `${s.address}, ${s.city}` : '', units: deliveryUnits(d), preparedAt: d.preparedAt };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

async function routeOrThrow(ctx: Ctx, routeId: string): Promise<DeliveryRoute> {
  const r = await ctx.repo.routes.get(routeId);
  if (!r) throw new NotFoundError('el reparto');
  return r;
}

/** Km estimados para estas paradas, en este orden. */
async function estimateFor(ctx: Ctx, stops: DeliveryRoute['stops']): Promise<number> {
  const wh = await warehousePoint(ctx);
  const stores = await ctx.repo.stores.all();
  const sById = new Map(stores.map((s) => [s.id, s]));
  return estimateRouteKm(
    wh,
    stops.map((st) => sById.get(st.storeId) ?? wh),
  );
}

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  driver: z.string().trim().max(60).default(''),
  vehicle: z.string().trim().max(60).default(''),
  deliveryIds: z.array(z.string().min(1)).min(1, 'Elige al menos una entrega lista para salir.'),
});

/** Arma un reparto (borrador) con entregas listas para salir, en el orden en que se eligieron. */
export async function createRoute(ctx: Ctx, input: z.input<typeof createSchema>): Promise<DeliveryRoute> {
  guard(ctx, 'route.manage');
  const data = createSchema.parse(input);
  return mutate(ctx, async () => {
    const ready = new Map((await readyDeliveries(ctx)).map((d) => [d.id, d]));
    const stops: DeliveryRoute['stops'] = [];
    for (const id of new Set(data.deliveryIds)) {
      const d = ready.get(id);
      if (!d) throw new ValidationError('Una de las entregas ya no está lista para salir o ya va en otro reparto.');
      stops.push({ deliveryId: d.id, storeId: d.storeId });
    }
    const settings = await getSettings(ctx);
    const count = await ctx.repo.routes.count();
    const route: DeliveryRoute = {
      id: ctx.newId('rep'),
      code: `R-${String(count + 1).padStart(4, '0')}`,
      date: (data.date ?? toIsoDate(ctx.now())) as IsoDate,
      driver: data.driver,
      vehicle: data.vehicle,
      stops,
      km: await estimateFor(ctx, stops),
      costPerKm: settings.routeCostPerKm ?? DEFAULT_COST_PER_KM,
      driverCost: 0,
      tolls: 0,
      status: 'borrador',
      createdAt: nowIso(ctx),
      createdBy: ctx.actor.userId,
    };
    await ctx.repo.routes.put(route);
    for (const st of stops) {
      const d = await ctx.repo.deliveries.get(st.deliveryId);
      if (d) await ctx.repo.deliveries.put({ ...d, routeId: route.id });
    }
    await audit(ctx, 'reparto.crear', 'route', route.id, `${route.code} para el ${route.date}: ${stops.length} paradas`);
    return route;
  });
}

function assertEditable(r: DeliveryRoute): void {
  if (r.status === 'terminado') throw new ValidationError(`${r.code} ya está terminado: no se cambia.`);
}

/**
 * Cambia las paradas (agregar, quitar u ordenar). Si los km seguían siendo el estimado, se vuelven a
 * estimar con el orden nuevo; si alguien los corrigió a mano, se respetan.
 */
export async function setRouteStops(ctx: Ctx, routeId: string, deliveryIds: string[]): Promise<DeliveryRoute> {
  guard(ctx, 'route.manage');
  if (deliveryIds.length === 0) throw new ValidationError('Un reparto necesita al menos una parada.');
  return mutate(ctx, async () => {
    const r = await routeOrThrow(ctx, routeId);
    assertEditable(r);
    const current = new Map(r.stops.map((s) => [s.deliveryId, s]));
    const ready = new Map((await readyDeliveries(ctx)).map((d) => [d.id, d]));
    const stops: DeliveryRoute['stops'] = [];
    for (const id of new Set(deliveryIds)) {
      const keep = current.get(id);
      if (keep) stops.push(keep);
      else {
        const d = ready.get(id);
        if (!d) throw new ValidationError('Una de las entregas ya no está lista para salir o ya va en otro reparto.');
        stops.push({ deliveryId: d.id, storeId: d.storeId });
      }
    }
    const wasEstimate = r.km === (await estimateFor(ctx, r.stops));
    const next: DeliveryRoute = { ...r, stops, km: wasEstimate ? await estimateFor(ctx, stops) : r.km };
    await ctx.repo.routes.put(next);
    const kept = new Set(stops.map((s) => s.deliveryId));
    for (const s of r.stops) {
      if (kept.has(s.deliveryId)) continue;
      const d = await ctx.repo.deliveries.get(s.deliveryId);
      if (d?.routeId === r.id) {
        const { routeId: _drop, ...rest } = d;
        await ctx.repo.deliveries.put(rest);
      }
    }
    for (const s of stops) {
      const d = await ctx.repo.deliveries.get(s.deliveryId);
      if (d && d.routeId !== r.id) await ctx.repo.deliveries.put({ ...d, routeId: r.id });
    }
    await audit(ctx, 'reparto.paradas', 'route', r.id, `${r.code}: ${stops.length} paradas en el orden nuevo`);
    return next;
  });
}

/** Sube (-1) o baja (+1) una parada. */
export async function moveRouteStop(ctx: Ctx, routeId: string, deliveryId: string, dir: -1 | 1): Promise<DeliveryRoute> {
  const r = await ctx.repo.routes.get(routeId);
  if (!r) throw new NotFoundError('el reparto');
  const ids = r.stops.map((s) => s.deliveryId);
  const i = ids.indexOf(deliveryId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return r;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  return setRouteStops(ctx, routeId, ids);
}

const costSchema = z.object({
  km: z.number({ error: 'Escribe los kilómetros.' }).min(0, 'Los kilómetros no pueden ser negativos.').max(5000, 'Revisa los kilómetros.'),
  costPerKm: z.number({ error: 'Escribe el costo por kilómetro.' }).min(0, 'El costo no puede ser negativo.').max(20, 'Revisa el costo por kilómetro.'),
  driverCost: z.number({ error: 'Escribe lo del chofer (0 si no aplica).' }).min(0, 'El costo no puede ser negativo.'),
  tolls: z.number({ error: 'Escribe los peajes (0 si no hubo).' }).min(0, 'Los peajes no pueden ser negativos.'),
  driver: z.string().trim().max(60).optional(),
  vehicle: z.string().trim().max(60).optional(),
});

/** Guarda los costos del reparto. Solo se apuntan: la app no paga nada. */
export async function saveRouteCosts(ctx: Ctx, routeId: string, input: z.input<typeof costSchema>): Promise<DeliveryRoute> {
  guard(ctx, 'route.manage');
  const data = costSchema.parse(input);
  return mutate(ctx, async () => {
    const r = await routeOrThrow(ctx, routeId);
    assertEditable(r);
    const next: DeliveryRoute = {
      ...r,
      km: Math.round(data.km * 10) / 10,
      costPerKm: round2(data.costPerKm),
      driverCost: round2(data.driverCost),
      tolls: round2(data.tolls),
      driver: data.driver ?? r.driver,
      vehicle: data.vehicle ?? r.vehicle,
    };
    await ctx.repo.routes.put(next);
    await audit(ctx, 'reparto.costos', 'route', r.id, `${r.code}: ${next.km} km, costo total ${routeTotalCost(next).toFixed(2)} USD`);
    return next;
  });
}

const NEXT_STATUS: Record<RouteStatus, RouteStatus[]> = {
  borrador: ['en_ruta'],
  en_ruta: ['terminado', 'borrador'],
  terminado: [],
};

export async function setRouteStatus(ctx: Ctx, routeId: string, status: RouteStatus): Promise<DeliveryRoute> {
  guard(ctx, 'route.manage');
  return mutate(ctx, async () => {
    const r = await routeOrThrow(ctx, routeId);
    if (!NEXT_STATUS[r.status].includes(status)) throw new ValidationError(`Un reparto «${ROUTE_STATUS_LABEL[r.status]}» no pasa a «${ROUTE_STATUS_LABEL[status]}».`);
    const next = { ...r, status };
    await ctx.repo.routes.put(next);
    await audit(ctx, 'reparto.estado', 'route', r.id, `${r.code}: ${ROUTE_STATUS_LABEL[status]}`);
    return next;
  });
}

/** Borra un reparto en borrador: sus entregas vuelven a quedar listas para salir. */
export async function deleteRoute(ctx: Ctx, routeId: string): Promise<void> {
  guard(ctx, 'route.manage');
  await mutate(ctx, async () => {
    const r = await routeOrThrow(ctx, routeId);
    if (r.status !== 'borrador') throw new ValidationError('Solo se borra un reparto en borrador.');
    for (const s of r.stops) {
      const d = await ctx.repo.deliveries.get(s.deliveryId);
      if (d?.routeId === r.id) {
        const { routeId: _drop, ...rest } = d;
        await ctx.repo.deliveries.put(rest);
      }
    }
    await ctx.repo.routes.remove(r.id);
    await audit(ctx, 'reparto.borrar', 'route', r.id, `${r.code} borrado`);
  });
}

/**
 * Costo de distribución repartido por entrega y producto: el de los repartos terminados,
 * desde `since` (fecha del reparto). Uso interno de Rentabilidad y Contabilidad (sin permisos).
 */
export async function distributionShares(ctx: Ctx, since?: IsoDate): Promise<{ shares: CostShare[]; unallocated: number }> {
  const [routes, deliveries] = await Promise.all([ctx.repo.routes.all(), ctx.repo.deliveries.all()]);
  const dById = new Map(deliveries.map((d) => [d.id, d]));
  const shares: CostShare[] = [];
  let unallocated = 0;
  for (const r of routes) {
    if (r.status !== 'terminado' || (since && r.date < since)) continue;
    const a = allocateRouteCost(r, dById);
    shares.push(...a.shares);
    unallocated = round2(unallocated + a.unallocated);
  }
  return { shares, unallocated };
}

/** Costo por km que se propone en cada reparto nuevo (Ajustes). */
export async function saveRouteCostPerKm(ctx: Ctx, value: number): Promise<void> {
  guard(ctx, 'settings.manage');
  if (!Number.isFinite(value) || value < 0 || value > 20) throw new ValidationError('El costo por km va de 0 a 20 USD.');
  await mutate(ctx, async () => {
    const settings = await getSettings(ctx);
    await ctx.repo.settings.put({ ...settings, routeCostPerKm: round2(value) });
    await audit(ctx, 'ajustes.repartos', 'settings', settings.id, `Repartos: ${round2(value).toFixed(2)} USD por km`);
  });
}
