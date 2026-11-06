// Repartos: kilómetros estimados, costo de la ruta y cómo se reparte ese costo. Funciones puras.
//
// - Kilómetros estimados: la suma de las distancias en línea recta (haversine) entre paradas,
//   saliendo del almacén y volviendo a él, por 1.3 (las calles no van en línea recta). Se puede
//   corregir a mano.
// - Costo de la ruta: km × costo por km + chofer + peajes.
// - Reparto del costo (Rentabilidad): por unidades entregadas. Cada parada se lleva la parte que le
//   toca según las unidades que se le entregaron, y dentro de la parada, cada producto según sus
//   unidades (un mazo cuenta como una unidad, igual que un tabaco suelto o un paquete de café).
//   Solo cuentan las entregas ya entregadas; si una ruta no entregó nada, su costo queda sin repartir.
import type { Delivery, DeliveryRoute, IsoDate } from '../data/types';
import { round2 } from '../lib/money';

export const ROUTE_FACTOR = 1.3;
/** Costo por km si la línea no tiene uno en Ajustes. */
export const DEFAULT_COST_PER_KM = 0.85;

export interface Point {
  lat: number;
  lng: number;
}

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distancia en línea recta (km) entre dos puntos. */
export function haversineKm(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Kilómetros estimados de la ruta: almacén → paradas en orden → almacén, × 1.3. Con un decimal. */
export function estimateRouteKm(start: Point, stops: readonly Point[]): number {
  if (stops.length === 0) return 0;
  const path = [start, ...stops, start];
  let km = 0;
  for (let i = 1; i < path.length; i++) km += haversineKm(path[i - 1]!, path[i]!);
  return Math.round(km * ROUTE_FACTOR * 10) / 10;
}

/** La línea del mapa: del almacén a cada parada en orden y de vuelta. */
export function routePath(start: Point, stops: readonly Point[]): [number, number][] {
  if (stops.length === 0) return [];
  return [start, ...stops, start].map((p) => [p.lat, p.lng] as [number, number]);
}

export function routeTotalCost(r: Pick<DeliveryRoute, 'km' | 'costPerKm' | 'driverCost' | 'tolls'>): number {
  return round2(Math.max(0, r.km) * Math.max(0, r.costPerKm) + Math.max(0, r.driverCost) + Math.max(0, r.tolls));
}

export interface CostShare {
  routeId: string;
  date: IsoDate;
  deliveryId: string;
  storeId: string;
  sellerId: string;
  productId: string;
  units: number;
  cost: number;
}

type DeliveryForCost = Pick<Delivery, 'id' | 'storeId' | 'sellerId' | 'status' | 'items'>;

/** Unidades que se entregaron en una entrega (0 si todavía no se entregó). */
export function deliveredUnits(d: Pick<Delivery, 'status' | 'items'>): number {
  if (d.status !== 'entregada') return 0;
  return d.items.reduce((a, i) => a + Math.max(0, i.preparedQty ?? 0), 0);
}

/**
 * Reparte el costo de una ruta entre sus paradas y productos, por unidades entregadas.
 * Los centavos que sobran del redondeo van a la parte más grande, para que la suma dé el total.
 */
export function allocateRouteCost(
  route: Pick<DeliveryRoute, 'id' | 'date' | 'stops' | 'km' | 'costPerKm' | 'driverCost' | 'tolls'>,
  deliveriesById: ReadonlyMap<string, DeliveryForCost>,
): { shares: CostShare[]; unallocated: number } {
  const total = routeTotalCost(route);
  const parts: Omit<CostShare, 'cost'>[] = [];
  for (const stop of route.stops) {
    const d = deliveriesById.get(stop.deliveryId);
    if (!d || d.status !== 'entregada') continue;
    for (const it of d.items) {
      const units = Math.max(0, it.preparedQty ?? 0);
      if (units <= 0) continue;
      parts.push({ routeId: route.id, date: route.date, deliveryId: d.id, storeId: d.storeId, sellerId: d.sellerId, productId: it.productId, units });
    }
  }
  const units = parts.reduce((a, p) => a + p.units, 0);
  if (units === 0 || total === 0) return { shares: [], unallocated: units === 0 ? total : 0 };
  const shares: CostShare[] = parts.map((p) => ({ ...p, cost: round2((total * p.units) / units) }));
  const diff = round2(total - shares.reduce((a, s) => a + s.cost, 0));
  if (diff !== 0) {
    const biggest = shares.reduce((a, s) => (s.units > a.units ? s : a), shares[0]!);
    biggest.cost = round2(biggest.cost + diff);
  }
  return { shares, unallocated: 0 };
}
