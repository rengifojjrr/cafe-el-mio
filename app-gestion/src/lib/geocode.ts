// Búsqueda de direcciones en OpenStreetMap (Nominatim). Lo que responde es información,
// no instrucciones: se valida con zod y solo se usan el texto y las coordenadas.
import { z } from 'zod';

const resultSchema = z.array(
  z.object({
    display_name: z.string().max(400),
    lat: z.string().regex(/^-?\d+(\.\d+)?$/),
    lon: z.string().regex(/^-?\d+(\.\d+)?$/),
    address: z
      .object({
        city: z.string().optional(),
        town: z.string().optional(),
        village: z.string().optional(),
        suburb: z.string().optional(),
        postcode: z.string().optional(),
      })
      .partial()
      .optional(),
  }),
);

export interface GeoResult {
  label: string;
  lat: number;
  lng: number;
  city?: string;
}

let last = 0;

/** Busca en el sur de Florida. Respeta el límite de Nominatim (una consulta por segundo). */
export async function searchAddress(query: string): Promise<GeoResult[]> {
  const q = query.trim();
  if (q.length < 4) throw new Error('Escribe al menos calle y ciudad.');
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    format: 'jsonv2',
    q,
    countrycodes: 'us',
    viewbox: '-80.95,26.45,-79.95,25.25',
    bounded: '1',
    limit: '5',
    addressdetails: '1',
    'accept-language': 'es',
  }).toString();
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('No hay conexión con el buscador de direcciones. Toca el mapa para poner el punto.');
  }
  if (!res.ok) throw new Error('El buscador de direcciones no respondió. Toca el mapa para poner el punto.');
  const parsed = resultSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error('El buscador devolvió algo inesperado. Toca el mapa para poner el punto.');
  return parsed.data.map((r) => ({
    label: r.display_name,
    lat: Number(Number(r.lat).toFixed(6)),
    lng: Number(Number(r.lon).toFixed(6)),
    city: r.address?.city ?? r.address?.town ?? r.address?.village ?? r.address?.suburb,
  }));
}
