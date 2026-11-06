// Mercados (Miami, Houston…): la lista editable de Ajustes y a qué mercado pertenece cada cosa.
import { z } from 'zod';
import type { Market, Store, User, Zone } from '../data/types';
import { marketsOf, newMarketId, storeMarketId, userMarketId, zoneMarketId } from '../domain/markets';
import { type Ctx, ValidationError, audit, getSettings, guard, mutate } from './context';

export interface MarketIndex {
  markets: Market[];
  zonesById: Map<string, Zone>;
  storeMarket: (s: Pick<Store, 'marketId' | 'zoneId'>) => string;
  userMarket: (u: Pick<User, 'marketId' | 'zoneId'>) => string;
  zoneMarket: (z: Pick<Zone, 'marketId'> | undefined) => string;
}

/** Mercados de la línea y cómo saber el de cada local, vendedor o zona. Uso interno (sin permisos). */
export async function loadMarketIndex(ctx: Ctx): Promise<MarketIndex> {
  const [settings, zones] = await Promise.all([getSettings(ctx), ctx.repo.zones.all()]);
  const markets = marketsOf(settings);
  const zonesById = new Map(zones.map((z) => [z.id, z]));
  return {
    markets,
    zonesById,
    storeMarket: (s) => storeMarketId(s, zonesById, markets),
    userMarket: (u) => userMarketId(u, zonesById, markets),
    zoneMarket: (z) => zoneMarketId(z, markets),
  };
}

/** Los mercados de la línea (todos los roles de la línea pueden ver sus nombres). */
export async function listMarkets(ctx: Ctx): Promise<Market[]> {
  guard(ctx, 'product.read');
  return marketsOf(await getSettings(ctx));
}

const marketSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, 'Escribe el nombre del mercado.').max(40),
  lat: z.number({ error: 'Escribe la latitud del centro.' }).min(-60, 'Latitud fuera de rango.').max(70, 'Latitud fuera de rango.'),
  lng: z.number({ error: 'Escribe la longitud del centro.' }).min(-170, 'Longitud fuera de rango.').max(-30, 'Longitud fuera de rango.'),
  zoom: z.number().int().min(4, 'El acercamiento va de 4 a 14.').max(14, 'El acercamiento va de 4 a 14.').default(10),
});

/**
 * Guarda la lista de mercados. El primero es el de siempre: lo que no dice su mercado es de él.
 * No se puede quitar un mercado que todavía tiene zonas, locales o vendedores.
 */
export async function saveMarkets(ctx: Ctx, input: z.input<typeof marketSchema>[]): Promise<Market[]> {
  guard(ctx, 'market.manage');
  const parsed = input.map((m) => marketSchema.parse(m));
  if (parsed.length === 0) throw new ValidationError('Tiene que quedar al menos un mercado.');
  const names = new Set<string>();
  for (const m of parsed) {
    const key = m.name.toLowerCase();
    if (names.has(key)) throw new ValidationError(`Hay dos mercados con el nombre ${m.name}.`);
    names.add(key);
  }
  return mutate(ctx, async () => {
    const settings = await getSettings(ctx);
    const before = marketsOf(settings);
    const taken: string[] = [];
    const markets: Market[] = parsed.map((m) => {
      const id = m.id && before.some((b) => b.id === m.id) ? m.id : newMarketId(m.name, [...taken, ...before.map((b) => b.id)]);
      taken.push(id);
      return { id, name: m.name, lat: m.lat, lng: m.lng, zoom: m.zoom };
    });
    const removed = before.filter((b) => !markets.some((m) => m.id === b.id));
    if (removed.length) {
      const idx = await loadMarketIndex(ctx);
      const [stores, users] = await Promise.all([ctx.repo.stores.all(), ctx.repo.users.all()]);
      for (const r of removed) {
        const used =
          [...idx.zonesById.values()].some((z) => idx.zoneMarket(z) === r.id) ||
          stores.some((s) => idx.storeMarket(s) === r.id) ||
          users.some((u) => u.role === 'seller' && idx.userMarket(u) === r.id);
        if (used) throw new ValidationError(`${r.name} todavía tiene zonas, locales o vendedores. Muévelos a otro mercado antes de quitarlo.`);
      }
    }
    await ctx.repo.settings.put({ ...settings, markets });
    await audit(ctx, 'mercados.guardar', 'settings', settings.id, `Mercados: ${markets.map((m) => m.name).join(', ')}`);
    return markets;
  });
}
