// «Equipo» (Administración): quién cubre qué y cómo va, por vendedor, por zona y por ciudad, en
// cada mercado. Las cuentas salen de la lista de locales (ventas de 30 días, consignación, lo que
// deben) y de las visitas de los últimos 7 días.
import type { Market } from '../data/types';
import { type Equipo, armarEquipo } from '../domain/equipo';
import { type Ctx, guard } from './context';
import { loadMarketIndex } from './markets';
import { listStores } from './stores';

export interface VistaEquipo extends Equipo {
  markets: Market[];
  /** El mercado que se está viendo. */
  marketId: string;
}

const SIETE_DIAS = 7 * 86_400_000;

export async function verEquipo(ctx: Ctx, marketId?: string): Promise<VistaEquipo> {
  guard(ctx, 'user.read');
  const [locales, users, zones, visits, idx] = await Promise.all([listStores(ctx), ctx.repo.users.all(), ctx.repo.zones.all(), ctx.repo.visits.all(), loadMarketIndex(ctx)]);
  const mercado = idx.markets.some((m) => m.id === marketId) ? marketId! : (idx.markets[0]?.id ?? '');
  const enMercado = idx.markets.length < 2 ? () => true : (id: string) => id === mercado;
  const desde = ctx.now().getTime() - SIETE_DIAS;
  // Visitas de 7 días por vendedor: las de los locales y las de los prospectos.
  const visitas7 = new Map<string, number>();
  const sumar = (sellerId: string) => visitas7.set(sellerId, (visitas7.get(sellerId) ?? 0) + 1);
  for (const v of visits) if (Date.parse(v.at) >= desde) sumar(v.sellerId);
  for (const l of locales) for (const pv of l.store.prospectVisits ?? []) if (Date.parse(pv.at) >= desde) sumar(pv.by);
  const equipo = armarEquipo(
    locales.filter((l) => enMercado(idx.storeMarket(l.store))),
    // Los vendedores del mercado (los de Administración no cubren zonas, pero sirven para los nombres).
    users.filter((u) => u.role !== 'seller' || enMercado(idx.userMarket(u)) || zones.some((z) => z.sellerId === u.id && enMercado(idx.zoneMarket(z)))),
    zones.filter((z) => enMercado(idx.zoneMarket(z))),
    visitas7,
    ctx.now(),
  );
  return { ...equipo, markets: idx.markets, marketId: mercado };
}
