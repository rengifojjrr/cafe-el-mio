// Los clientes: un local (como siempre), una persona o el almacén (la venta de mostrador, a quien
// viene a buscar sin decir su nombre). Las personas y el mostrador se guardan junto a los locales,
// marcados con `clase`: así las facturas, los pagos, las entregas, los PDF y la contabilidad siguen
// funcionando igual. Las pantallas de locales (mapa, equipo, recorridos, contratos) solo muestran
// locales.
import type { Store } from '../data/types';
import { normalize } from './products';

export type ClaseCliente = 'local' | 'persona' | 'almacen';

export const CLASE_LABEL: Record<ClaseCliente, string> = {
  local: 'Local',
  persona: 'Persona',
  almacen: 'Almacén',
};

/** En plural, para los totales y los filtros. */
export const CLASE_PLURAL: Record<ClaseCliente, string> = {
  local: 'Locales',
  persona: 'Personas',
  almacen: 'Almacén',
};

export const CLASES: readonly ClaseCliente[] = ['local', 'persona', 'almacen'];

/** El id fijo del cliente «Almacén (mostrador)»: el mismo en todos los teléfonos. */
export const ID_MOSTRADOR = 'cli_mostrador';
export const NOMBRE_MOSTRADOR = 'Almacén (mostrador)';

export function claseDe(s: Pick<Store, 'clase'> | undefined | null): ClaseCliente {
  return s?.clase ?? 'local';
}

/** Un local de verdad (no una persona ni el mostrador). */
export function esLocal(s: Pick<Store, 'clase'> | undefined | null): boolean {
  return claseDe(s) === 'local';
}

/** Para no duplicar personas: «ana perez», «Ana  Pérez» y «ANA PÉREZ» son la misma. */
export function claveNombre(nombre: string): string {
  return normalize(nombre).replace(/[^a-z0-9ñ ]+/g, '').replace(/\s+/g, ' ').trim();
}

/** El nombre como se guarda: sin espacios de más. */
export function limpiarNombre(nombre: string): string {
  return nombre.replace(/\s+/g, ' ').trim();
}
