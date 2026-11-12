// Recorridos de prospectos: los locales que todavía son prospecto, por zona y en orden de cercanía,
// con lo que falta anotar de cada uno. En cada parada se anota la visita: qué dijo y lo que dio
// (encargado, teléfono, correo, horario, permiso).
import { z } from 'zod';
import type { Market, ProspectResult, ProspectVisit, Store } from '../data/types';
import { DEFAULT_PERMIT_ISSUER } from '../domain/fiscal';
import { PROSPECT_RESULT_LABEL, type DatoProspecto, type TramoMapa, faltaRecolectar, kmDeIda, linkParada, porCercania, tramosGoogleMaps, visitaTerminada } from '../domain/recorridos';
import { haversineKm, type Point } from '../domain/routes';
import { type Ctx, NotFoundError, ValidationError, audit, guard, mutate, nowIso } from './context';
import { loadMarketIndex } from './markets';
import { scopedStores } from './stores';

export interface ParadaRecorrido {
  store: Store;
  falta: DatoProspecto[];
  ultima?: ProspectVisit;
  /** Km desde la parada anterior (o desde el inicio), en línea recta. */
  kmDesdeAnterior: number;
  /** Link de Google Maps para llegar solo a esta parada. */
  comoLlegar: string;
}

export interface Recorrido {
  zoneId: string;
  zona: string;
  marketId: string;
  /** Las que faltan, en orden. */
  paradas: ParadaRecorrido[];
  /** Las ya visitadas (salvo «no estaba el encargado», que se vuelve a visitar). */
  hechas: ParadaRecorrido[];
  /** Km estimados de ida para las que faltan. */
  km: number;
  tramos: TramoMapa[];
}

export interface Recorridos {
  markets: Market[];
  recorridos: Recorrido[];
  /** De dónde se ordenó: donde está la persona o el centro del mercado. */
  desde: 'ubicacion' | 'centro';
}

/**
 * Lo que se le pasa a Google Maps: el nombre del local y su dirección. Con el nombre encuentra el
 * negocio, aunque la dirección no traiga el número de la calle (pasa con locales sacados del mapa).
 */
const destino = (s: Store) => `${s.name}, ${s.address}, ${s.city}`;

/**
 * Los prospectos por zona. Vendedor: los suyos; Administración: todos. Si llega `desde` (donde está
 * el teléfono), cada recorrido se ordena desde ahí; si no, desde el centro del mercado.
 */
export async function recorridos(ctx: Ctx, opts: { desde?: Point } = {}): Promise<Recorridos> {
  guard(ctx, 'store.list');
  const [stores, idx] = await Promise.all([scopedStores(ctx), loadMarketIndex(ctx)]);
  const conPermiso = ctx.config.requiresTobaccoPermit;
  const porZona = new Map<string, Store[]>();
  for (const s of stores) {
    if (s.status !== 'prospecto') continue;
    const list = porZona.get(s.zoneId) ?? [];
    list.push(s);
    porZona.set(s.zoneId, list);
  }
  const out: Recorrido[] = [];
  for (const [zoneId, list] of porZona) {
    const zone = idx.zonesById.get(zoneId);
    const marketId = zone ? idx.zoneMarket(zone) : idx.storeMarket(list[0]!);
    const market = idx.markets.find((m) => m.id === marketId);
    const inicio: Point = opts.desde ?? (market ? { lat: market.lat, lng: market.lng } : zone ? { lat: zone.lat, lng: zone.lng } : list[0]!);
    const parada = (s: Store, anterior: Point): ParadaRecorrido => {
      const visits = s.prospectVisits ?? [];
      return {
        store: s,
        falta: faltaRecolectar(s, conPermiso),
        ultima: visits[visits.length - 1],
        kmDesdeAnterior: Math.round(haversineKm(anterior, s) * 10) / 10,
        comoLlegar: linkParada({ lat: s.lat, lng: s.lng, direccion: destino(s) }),
      };
    };
    const terminada = (s: Store) => {
      const u = s.prospectVisits?.[s.prospectVisits.length - 1];
      return !!u && visitaTerminada(u.result);
    };
    const pendientes = porCercania(inicio, list.filter((s) => !terminada(s)));
    const paradas: ParadaRecorrido[] = [];
    let anterior = inicio;
    for (const s of pendientes) {
      paradas.push(parada(s, anterior));
      anterior = s;
    }
    const hechas = list
      .filter(terminada)
      .sort((a, b) => (b.prospectVisits?.at(-1)?.at ?? '').localeCompare(a.prospectVisits?.at(-1)?.at ?? ''))
      .map((s) => parada(s, s));
    out.push({
      zoneId,
      zona: zone?.name ?? 'Sin zona',
      marketId,
      paradas,
      hechas,
      km: kmDeIda(inicio, pendientes),
      tramos: tramosGoogleMaps(pendientes.map((s) => ({ lat: s.lat, lng: s.lng, direccion: destino(s) }))),
    });
  }
  // Primero los que tienen más por visitar; a igual cantidad, por nombre de la zona.
  out.sort((a, b) => b.paradas.length - a.paradas.length || a.zona.localeCompare(b.zona, 'es'));
  return { markets: idx.markets, recorridos: out, desde: opts.desde ? 'ubicacion' : 'centro' };
}

/** Para el inicio: cuántos prospectos faltan por visitar y en cuántas zonas. */
export async function resumenRecorridos(ctx: Ctx): Promise<{ pendientes: number; zonas: number }> {
  guard(ctx, 'store.list');
  const pendientes = (await scopedStores(ctx)).filter((s) => {
    if (s.status !== 'prospecto') return false;
    const u = s.prospectVisits?.[s.prospectVisits.length - 1];
    return !u || !visitaTerminada(u.result);
  });
  return { pendientes: pendientes.length, zonas: new Set(pendientes.map((s) => s.zoneId)).size };
}

const RESULTADOS = ['interesado', 'lo_piensa', 'no_interesa', 'sin_encargado', 'cerrado'] as const satisfies readonly ProspectResult[];

const visitaSchema = z.object({
  result: z.enum(RESULTADOS, { error: 'Elige qué pasó en la visita.' }),
  note: z.string().trim().max(300, 'La nota es de 300 caracteres como mucho.').default(''),
  managerName: z.string().trim().max(80).default(''),
  phone: z
    .string()
    .trim()
    .default('')
    .refine((v) => v === '' || /^[0-9 ()+.-]{7,20}$/.test(v), 'Escribe un teléfono válido.'),
  email: z.union([z.literal(''), z.string().trim().email('Escribe un correo válido.')]).default(''),
  hours: z.string().trim().max(120).default(''),
  permitNumber: z
    .string()
    .trim()
    .max(40)
    .default('')
    .refine((v) => v === '' || v.length >= 4, 'El número del permiso tiene 4 caracteres o más.'),
  permitExpires: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha de vencimiento del permiso.')]).default(''),
});
export type VisitaProspectoInput = z.input<typeof visitaSchema>;

/**
 * Anota la visita a un prospecto: qué pasó y lo que dio. Lo que se deja vacío no borra lo que ya
 * estaba anotado. Solo para prospectos (después, las visitas son las de consignación).
 */
export async function anotarVisitaProspecto(ctx: Ctx, storeId: string, input: VisitaProspectoInput): Promise<Store> {
  const data = visitaSchema.parse(input);
  return mutate(ctx, async () => {
    const s = await ctx.repo.stores.get(storeId);
    if (!s) throw new NotFoundError('el local');
    guard(ctx, 'store.update', { type: 'store', store: s });
    if (s.status !== 'prospecto') throw new ValidationError(`${s.name} ya no es prospecto: anota la visita desde su ficha.`);
    if (data.managerName && data.managerName.length < 3) throw new ValidationError('Escribe el nombre del encargado (3 letras o más).');
    if (data.managerName) s.managerName = data.managerName;
    if (data.phone) s.phone = data.phone;
    if (data.email) s.email = data.email;
    if (data.hours) s.hours = data.hours;
    if (ctx.config.requiresTobaccoPermit && data.permitNumber) {
      if (!data.permitExpires) throw new ValidationError('Elige la fecha de vencimiento del permiso.');
      const issuer = s.tobaccoPermit?.issuer || (s.marketId === 'houston' ? 'Texas Comptroller' : DEFAULT_PERMIT_ISSUER);
      s.tobaccoPermit = { number: data.permitNumber, expiresOn: data.permitExpires, issuer };
    }
    const visit: ProspectVisit = { at: nowIso(ctx), by: ctx.actor.userId, result: data.result, note: data.note };
    s.prospectVisits = [...(s.prospectVisits ?? []), visit];
    await ctx.repo.stores.put(s);
    await audit(ctx, 'local.visita_prospecto', 'store', s.id, `Visita a ${s.name}: ${PROSPECT_RESULT_LABEL[data.result]}${data.note ? ` (${data.note})` : ''}`);
    return s;
  });
}
