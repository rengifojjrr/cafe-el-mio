// Recorridos de prospectos: visitar locales que todavía no son clientes, dejarles la información y
// anotar la suya. Funciones puras.
//
// - Orden: el vecino más cercano, empezando donde está la persona (o en el centro del mercado).
// - Kilómetros: de ida (no hace falta volver al almacén), en línea recta por 1.3, como en Repartos.
// - Google Maps en el teléfono abre como mucho 3 paradas intermedias: la ruta va en tramos de 4
//   paradas (3 intermedias y el destino). El primer tramo sale de donde esté el teléfono; cada tramo
//   siguiente sale de la última parada del anterior.
import type { ProspectResult, Store } from '../data/types';
import { haversineKm, ROUTE_FACTOR, type Point } from './routes';

/** Ordena las paradas por cercanía (vecino más cercano) desde `desde`. */
export function porCercania<T extends Point>(desde: Point, paradas: readonly T[]): T[] {
  const left = [...paradas];
  const out: T[] = [];
  let cur = desde;
  while (left.length) {
    let best = 0;
    let bestKm = Infinity;
    left.forEach((p, i) => {
      const km = haversineKm(cur, p);
      if (km < bestKm) {
        bestKm = km;
        best = i;
      }
    });
    const [next] = left.splice(best, 1);
    out.push(next!);
    cur = next!;
  }
  return out;
}

/** Kilómetros estimados de ida: `desde` → paradas en orden, × 1.3. Con un decimal. */
export function kmDeIda(desde: Point, paradas: readonly Point[]): number {
  let km = 0;
  let cur = desde;
  for (const p of paradas) {
    km += haversineKm(cur, p);
    cur = p;
  }
  return Math.round(km * ROUTE_FACTOR * 10) / 10;
}

export interface ParadaMapa extends Point {
  /** Dirección completa («calle, ciudad»): Google la encuentra mejor que un punto suelto. */
  direccion?: string;
}

const lugar = (p: ParadaMapa) => (p.direccion?.trim() ? p.direccion.trim() : `${p.lat},${p.lng}`);

/** Un link de Google Maps para llegar a una sola parada. */
export function linkParada(p: ParadaMapa): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lugar(p))}&travelmode=driving`;
}

export interface TramoMapa {
  /** Número de la primera y la última parada del tramo (desde 1). */
  desde: number;
  hasta: number;
  url: string;
}

/** Links de Google Maps por tramos de hasta `porTramo` paradas (4: lo que abre el teléfono). */
export function tramosGoogleMaps(paradas: readonly ParadaMapa[], porTramo = 4): TramoMapa[] {
  const out: TramoMapa[] = [];
  for (let i = 0; i < paradas.length; i += porTramo) {
    const tramo = paradas.slice(i, i + porTramo);
    const destino = tramo[tramo.length - 1]!;
    const intermedias = tramo.slice(0, -1);
    const params = [`api=1`];
    if (i > 0) params.push(`origin=${encodeURIComponent(lugar(paradas[i - 1]!))}`);
    params.push(`destination=${encodeURIComponent(lugar(destino))}`);
    if (intermedias.length) params.push(`waypoints=${encodeURIComponent(intermedias.map(lugar).join('|'))}`);
    params.push('travelmode=driving');
    out.push({ desde: i + 1, hasta: i + tramo.length, url: `https://www.google.com/maps/dir/?${params.join('&')}` });
  }
  return out;
}

/** Lo que se anota de un prospecto en la visita. */
export type DatoProspecto = 'encargado' | 'telefono' | 'correo' | 'horario' | 'permiso';

export const DATO_PROSPECTO_LABEL: Record<DatoProspecto, string> = {
  encargado: 'encargado',
  telefono: 'teléfono',
  correo: 'correo',
  horario: 'horario',
  permiso: 'permiso de tabaco',
};

/** Lo que todavía falta anotar de un prospecto (el permiso, solo si la línea lo pide). */
export function faltaRecolectar(s: Pick<Store, 'managerName' | 'phone' | 'email' | 'hours' | 'tobaccoPermit'>, conPermiso: boolean): DatoProspecto[] {
  const falta: DatoProspecto[] = [];
  if (s.managerName.trim().length < 3) falta.push('encargado');
  if (!s.phone.trim()) falta.push('telefono');
  if (!s.email.trim()) falta.push('correo');
  if (!s.hours.trim()) falta.push('horario');
  if (conPermiso && !s.tobaccoPermit?.number.trim()) falta.push('permiso');
  return falta;
}

export const PROSPECT_RESULT_LABEL: Record<ProspectResult, string> = {
  interesado: 'Le interesa',
  lo_piensa: 'Lo va a pensar',
  no_interesa: 'No le interesa',
  sin_encargado: 'No estaba el encargado',
  cerrado: 'Estaba cerrado o ya no existe',
};

/** Después de estas, el local sale del recorrido; «no estaba el encargado» lo deja para volver. */
export function visitaTerminada(result: ProspectResult): boolean {
  return result !== 'sin_encargado';
}
