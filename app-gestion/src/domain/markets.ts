// Mercados (Miami, Houston…): agrupan zonas, locales y vendedores. Funciones puras.
// Regla: si algo no dice su mercado, es del primero de la lista (Miami). Un local sin mercado
// toma el de su zona; un vendedor sin mercado, el de su zona.
import type { LineSettings, Market, Store, User, Zone } from '../data/types';
import { slug } from './products';

export const MIAMI: Market = { id: 'miami', name: 'Miami', lat: 25.79, lng: -80.27, zoom: 10 };
export const HOUSTON: Market = { id: 'houston', name: 'Houston', lat: 29.76, lng: -95.37, zoom: 10 };

/** Los mercados de la línea (si no hay ninguno guardado, Miami). */
export function marketsOf(settings: Pick<LineSettings, 'markets'> | null | undefined): Market[] {
  const list = settings?.markets?.filter((m) => m.id && m.name) ?? [];
  return list.length ? list : [MIAMI];
}

function known(markets: readonly Market[], id: string | undefined): string | undefined {
  return id && markets.some((m) => m.id === id) ? id : undefined;
}

export function zoneMarketId(zone: Pick<Zone, 'marketId'> | undefined, markets: readonly Market[]): string {
  return known(markets, zone?.marketId) ?? markets[0]?.id ?? MIAMI.id;
}

export function storeMarketId(store: Pick<Store, 'marketId' | 'zoneId'>, zonesById: ReadonlyMap<string, Pick<Zone, 'marketId'>>, markets: readonly Market[]): string {
  return known(markets, store.marketId) ?? zoneMarketId(zonesById.get(store.zoneId), markets);
}

export function userMarketId(user: Pick<User, 'marketId' | 'zoneId'>, zonesById: ReadonlyMap<string, Pick<Zone, 'marketId'>>, markets: readonly Market[]): string {
  return known(markets, user.marketId) ?? zoneMarketId(user.zoneId ? zonesById.get(user.zoneId) : undefined, markets);
}

export function marketName(markets: readonly Market[], id: string | undefined): string {
  return markets.find((m) => m.id === id)?.name ?? markets[0]?.name ?? MIAMI.name;
}

/** ¿Este punto queda dentro del área de trabajo del mercado? (unos 250 km alrededor de su centro) */
export function pointInMarket(market: Pick<Market, 'lat' | 'lng'>, lat: number, lng: number, maxDeg = 2.5): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat - market.lat) <= maxDeg && Math.abs(lng - market.lng) <= maxDeg;
}

/** Id nuevo y único a partir del nombre («Fort Worth» → «fort-worth»). */
export function newMarketId(name: string, taken: readonly string[]): string {
  const base = slug(name) || 'mercado';
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}
