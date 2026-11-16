// El equipo: quién cubre qué. Mercado → Zona: cada zona tiene un vendedor responsable y los
// locales de la zona son suyos, salvo los que se le asignaron a mano a otro (excepciones). La
// ciudad sale de la dirección de cada local: sirve para ver totales, no se asigna.
import type { Store, User, Zone } from '../data/types';
import { normalize } from './products';
import { visitaTerminada } from './recorridos';

/**
 * El vendedor de un local que se crea o se edita.
 *   · Si se eligió uno a mano y la zona tiene otro responsable: ese, como excepción (`fijo`).
 *   · Si no se eligió (o se eligió el responsable): el responsable de la zona.
 *   · Zona sin responsable: el elegido o, si no hay, el que ya tenía el local.
 */
export function vendedorDelLocal(
  zone: Pick<Zone, 'sellerId'> | undefined,
  elegido: string | undefined,
  actual?: Pick<Store, 'sellerId'>,
): { sellerId: string | undefined; fijo: boolean } {
  const responsable = zone?.sellerId || undefined;
  if (elegido) return { sellerId: elegido, fijo: Boolean(responsable && responsable !== elegido) };
  return { sellerId: responsable ?? actual?.sellerId, fijo: false };
}

/** ¿El local es una excepción (su vendedor no es el responsable de su zona)? */
export function esExcepcion(store: Pick<Store, 'sellerId' | 'zoneId'>, zonesById: ReadonlyMap<string, Pick<Zone, 'sellerId'>>): boolean {
  const responsable = zonesById.get(store.zoneId)?.sellerId;
  return Boolean(responsable && responsable !== store.sellerId);
}

// ---------- Ciudades ----------

/** «Sugar Land, TX», «sugar land» y «Sugar Land» son la misma ciudad. */
export function claveCiudad(city: string): string {
  return normalize(city.replace(/,\s*[A-Za-z]{2}\.?\s*$/, '')).replace(/[^a-z0-9 ]/g, '').trim();
}

/** El nombre para mostrar: sin el estado del final («Sugar Land, TX» → «Sugar Land»). */
export function nombreCiudad(city: string): string {
  return city.replace(/,\s*[A-Za-z]{2}\.?\s*$/, '').trim() || 'Sin ciudad';
}

// ---------- Totales ----------

/** Lo que el equipo necesita de cada local (sale de la lista de locales). */
export interface LocalResumen {
  store: Store;
  sales30: number;
  consignmentValue: number;
  owedTotal: number;
  overdue: boolean;
  lastVisitAt?: string;
}

export interface Totales {
  /** Locales activos (en consignación o en firme). */
  activos: number;
  /** Contrato enviado o firmado, esperando. */
  enCamino: number;
  prospectos: number;
  /** Prospectos que faltan por visitar (o que hay que volver a visitar). */
  porVisitar: number;
  /** Pausados o cerrados. */
  fuera: number;
  ventas30: number;
  consignacion: number;
  porCobrar: number;
  vencidos: number;
  /** Activos sin visita en 30 días. */
  sinVisita30: number;
  ultimaVisita?: string;
}

export function totalesVacios(): Totales {
  return { activos: 0, enCamino: 0, prospectos: 0, porVisitar: 0, fuera: 0, ventas30: 0, consignacion: 0, porCobrar: 0, vencidos: 0, sinVisita30: 0 };
}

/** La fecha más reciente de un local: la última visita o la última visita de prospecto. */
function ultimaDe(l: LocalResumen): string | undefined {
  const pv = l.store.prospectVisits?.[l.store.prospectVisits.length - 1]?.at;
  if (!pv) return l.lastVisitAt;
  if (!l.lastVisitAt) return pv;
  return pv > l.lastVisitAt ? pv : l.lastVisitAt;
}

export function sumar(t: Totales, l: LocalResumen, now: Date): Totales {
  const s = l.store;
  if (s.status === 'activo') t.activos += 1;
  else if (s.status === 'contrato_enviado' || s.status === 'firmado') t.enCamino += 1;
  else if (s.status === 'prospecto') {
    t.prospectos += 1;
    const u = s.prospectVisits?.[s.prospectVisits.length - 1];
    if (!u || !visitaTerminada(u.result)) t.porVisitar += 1;
  } else t.fuera += 1;
  t.ventas30 += l.sales30;
  t.consignacion += l.consignmentValue;
  t.porCobrar += l.owedTotal;
  if (l.overdue) t.vencidos += 1;
  const ultima = ultimaDe(l);
  if (s.status === 'activo' && (!l.lastVisitAt || now.getTime() - Date.parse(l.lastVisitAt) > 30 * 86_400_000)) t.sinVisita30 += 1;
  if (ultima && (!t.ultimaVisita || ultima > t.ultimaVisita)) t.ultimaVisita = ultima;
  return t;
}

export interface FilaVendedor {
  seller: User;
  zonas: Zone[];
  totales: Totales;
  /** Locales suyos en zonas de otro responsable. */
  excepciones: number;
  /** Visitas (a locales y a prospectos) de los últimos 7 días. */
  visitas7: number;
}

export interface FilaZona {
  zone: Zone;
  responsable?: User;
  totales: Totales;
  ciudades: string[];
  /** Locales de la zona con otro vendedor (asignados a mano). */
  excepciones: number;
  /** Vendedores con locales en la zona (el responsable y las excepciones). */
  vendedores: string[];
}

export interface FilaCiudad {
  ciudad: string;
  totales: Totales;
  zonas: string[];
  vendedores: string[];
}

export interface Equipo {
  vendedores: FilaVendedor[];
  zonas: FilaZona[];
  ciudades: FilaCiudad[];
  /** Locales cuyo vendedor ya no está activo (o no existe). */
  sinVendedorActivo: LocalResumen[];
  /** Zonas con locales y sin responsable. */
  zonasSinResponsable: number;
}

const unicos = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

/**
 * Arma el equipo: por vendedor, por zona y por ciudad. `visitas7` dice cuántas visitas hizo cada
 * vendedor en los últimos 7 días (de la tabla de visitas y de las visitas de prospecto).
 */
export function armarEquipo(
  locales: readonly LocalResumen[],
  users: readonly User[],
  zones: readonly Zone[],
  visitas7: ReadonlyMap<string, number>,
  now: Date,
): Equipo {
  const sellers = users.filter((u) => u.role === 'seller');
  const usersById = new Map(users.map((u) => [u.id, u]));
  const zonesById = new Map(zones.map((z) => [z.id, z]));
  const vendedores = new Map<string, FilaVendedor>(
    sellers.map((u) => [u.id, { seller: u, zonas: zones.filter((z) => z.sellerId === u.id), totales: totalesVacios(), excepciones: 0, visitas7: visitas7.get(u.id) ?? 0 }]),
  );
  const zonas = new Map<string, FilaZona>(
    zones.map((z) => [z.id, { zone: z, responsable: z.sellerId ? usersById.get(z.sellerId) : undefined, totales: totalesVacios(), ciudades: [], excepciones: 0, vendedores: [] }]),
  );
  const ciudades = new Map<string, { nombres: Map<string, number>; fila: FilaCiudad }>();
  const sinVendedorActivo: LocalResumen[] = [];
  for (const l of locales) {
    const s = l.store;
    const seller = usersById.get(s.sellerId);
    const excepcion = esExcepcion(s, zonesById);
    const fv = vendedores.get(s.sellerId);
    if (fv) {
      sumar(fv.totales, l, now);
      if (excepcion) fv.excepciones += 1;
    }
    if (!seller || !seller.active) sinVendedorActivo.push(l);
    const fz = zonas.get(s.zoneId);
    if (fz) {
      sumar(fz.totales, l, now);
      fz.ciudades.push(nombreCiudad(s.city));
      if (seller) fz.vendedores.push(seller.name);
      if (excepcion) fz.excepciones += 1;
    }
    const clave = claveCiudad(s.city) || 'sin-ciudad';
    let c = ciudades.get(clave);
    if (!c) {
      c = { nombres: new Map(), fila: { ciudad: '', totales: totalesVacios(), zonas: [], vendedores: [] } };
      ciudades.set(clave, c);
    }
    const nombre = nombreCiudad(s.city);
    c.nombres.set(nombre, (c.nombres.get(nombre) ?? 0) + 1);
    sumar(c.fila.totales, l, now);
    const z = zonesById.get(s.zoneId);
    if (z) c.fila.zonas.push(z.name);
    if (seller) c.fila.vendedores.push(seller.name);
  }
  const filasZona = [...zonas.values()].map((f) => ({ ...f, ciudades: unicos(f.ciudades), vendedores: unicos(f.vendedores) }));
  const filasCiudad = [...ciudades.values()].map(({ nombres, fila }) => ({
    ...fila,
    // El nombre que más se repite («Sugar Land» le gana a «sugar land»).
    ciudad: [...nombres.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))[0]![0],
    zonas: unicos(fila.zonas),
    vendedores: unicos(fila.vendedores),
  }));
  const cuantos = totalLocales;
  return {
    vendedores: [...vendedores.values()].sort((a, b) => Number(b.seller.active) - Number(a.seller.active) || a.seller.name.localeCompare(b.seller.name, 'es')),
    zonas: filasZona.sort((a, b) => cuantos(b.totales) - cuantos(a.totales) || a.zone.name.localeCompare(b.zone.name, 'es')),
    ciudades: filasCiudad.sort((a, b) => cuantos(b.totales) - cuantos(a.totales) || a.ciudad.localeCompare(b.ciudad, 'es')),
    sinVendedorActivo,
    zonasSinResponsable: filasZona.filter((f) => !f.responsable && cuantos(f.totales) > 0).length,
  };
}

/** Cuántos locales tiene una fila (de cualquier estado). */
export function totalLocales(t: Totales): number {
  return t.activos + t.enCamino + t.prospectos + t.fuera;
}

// ---------- Asignar zonas ----------

export interface CambioDeZona {
  zone: Zone;
  /** El responsable que tenía (si tenía). */
  de?: string;
  /** Locales que pasan al nuevo responsable (los asignados a mano a otro no se mueven). */
  locales: number;
}

/**
 * Lo que pasa si `sellerId` queda responsable exactamente de `zoneIds`: las zonas que gana (y de
 * quién eran, con cuántos locales pasan) y las que deja (quedan sin responsable; sus locales siguen
 * con quien los tiene hasta que la zona tenga otro).
 */
export function cambiosAlAsignar(
  zones: readonly Zone[],
  stores: readonly Pick<Store, 'zoneId' | 'sellerId' | 'sellerFijo'>[],
  sellerId: string,
  zoneIds: readonly string[],
): { gana: CambioDeZona[]; deja: Zone[] } {
  const quiere = new Set(zoneIds);
  const gana: CambioDeZona[] = [];
  const deja: Zone[] = [];
  for (const z of zones) {
    if (quiere.has(z.id) && z.sellerId !== sellerId) {
      const locales = stores.filter((s) => s.zoneId === z.id && !s.sellerFijo && s.sellerId !== sellerId).length;
      gana.push({ zone: z, de: z.sellerId || undefined, locales });
    } else if (!quiere.has(z.id) && z.sellerId === sellerId) deja.push(z);
  }
  return { gana, deja };
}
