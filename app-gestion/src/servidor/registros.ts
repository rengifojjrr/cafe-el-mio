// Cómo viaja un registro de la app al servidor y de vuelta.
//
// En el servidor cada registro es una fila de `tabaco.registros` (tabla, id, datos). Los datos van
// sin el id (ya está en la fila) y sin archivos: la foto de `photos` y el PDF de `templates` viajan
// aparte, al depósito, y en los datos queda su ruta («photos/<id>»). La auditoría no lleva su número
// local (`seq`): cada teléfono numera la suya.

export type CampoArchivo = 'blob' | 'pdf';

const CON_ARCHIVO: Record<string, CampoArchivo> = { photos: 'blob', templates: 'pdf' };

/** El campo con el archivo de esa tabla, o null si la tabla no tiene archivos. */
export function campoArchivo(tabla: string): CampoArchivo | null {
  return CON_ARCHIVO[tabla] ?? null;
}

/** Dónde vive en el depósito el archivo de un registro. */
export function rutaArchivo(tabla: string, id: string): string {
  return `${tabla}/${id}`;
}

/** El tipo del archivo (para guardarlo bien al bajarlo). */
export function tipoArchivo(tabla: string, datos: Record<string, unknown>): string | undefined {
  if (tabla === 'templates') return 'application/pdf';
  return typeof datos.mime === 'string' ? datos.mime : undefined;
}

/** Lo que se sube de un registro local. */
export function aDatos(tabla: string, fila: Record<string, unknown>): Record<string, unknown> {
  const { id, seq: _seq, ...resto } = fila;
  const campo = campoArchivo(tabla);
  if (!campo) return resto;
  const { [campo]: _archivo, ...sinArchivo } = resto;
  return { ...sinArchivo, archivo: rutaArchivo(tabla, String(id)) };
}

/** El registro local que sale de una fila del servidor (con su archivo, si tiene). */
export function desdeDatos(tabla: string, id: string, datos: Record<string, unknown>, archivo?: Blob): Record<string, unknown> {
  const { archivo: _ruta, id: _id, seq: _seq, ...resto } = datos;
  const fila: Record<string, unknown> = { ...resto, id };
  const campo = campoArchivo(tabla);
  if (campo && archivo) fila[campo] = archivo;
  return fila;
}

/**
 * JSON con las claves ordenadas y sin lo `undefined`: dos registros con lo mismo dan el mismo
 * texto, aunque el servidor devuelva las claves en otro orden.
 */
export function estable(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => estable(x)).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${estable(o[k])}`).join(',')}}`;
}

/** ¿El registro local ya tiene exactamente lo que dice el servidor? */
export function iguales(tabla: string, local: Record<string, unknown>, datos: Record<string, unknown>): boolean {
  return estable(aDatos(tabla, local)) === estable(datos);
}

/** Lo que pesa un cambio al viajar (para armar tandas que el servidor acepte). */
export function peso(v: unknown): number {
  return JSON.stringify(v)?.length ?? 0;
}
