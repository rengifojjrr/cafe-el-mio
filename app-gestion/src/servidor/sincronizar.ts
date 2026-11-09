// La sincronización con el servidor. La app sigue guardando primero en el teléfono (funciona sin
// señal) y esto, por detrás:
//   · sube lo pendiente (las claves que dejó cada cambio en `pendientes`) con `tabaco_aplicar`,
//     por tandas y todo-o-nada; las fotos y los PDF van antes al depósito;
//   · baja lo que cambiaron los demás con `tabaco_traer`, desde el cursor de la vez anterior.
// Si dos personas cambian el mismo registro queda el último que llega al servidor. Lo que este
// teléfono tiene sin subir nunca se pisa con lo que baja: se sube después.
//
// La primera vez que un teléfono se conecta se comparan los dos lados (ver `conectar`): si el
// servidor está vacío, sube todo; si el teléfono no tiene nada propio, toma lo del servidor; si
// los dos tienen datos distintos, la persona decide (y antes puede bajarse una copia).
import type Dexie from 'dexie';
import { getLineRepo } from '../data';
import { LINE_TABLES } from '../data/repo';
import { PENDIENTES, alAnotarCambios, anotarCambios, clave, dexieDe, type Pendiente } from '../data/local/dexie';
import { PROGRAM_LINE } from '../lines/programa';
import { emitAll, emitChange } from '../services/bus';
import { type Cuenta, ErrorServidor, SesionVencida, SinConexion, bajarArchivo, borrarArchivos, rpc, sesionActual, subirArchivo } from './cliente';
import { SERVIDOR } from './config';
import { aDatos, campoArchivo, desdeDatos, estable, iguales, peso, rutaArchivo, tipoArchivo } from './registros';

const TABLAS = new Set<string>(LINE_TABLES);
const TANDA_BAJAR = 500;
const TANDA_SUBIR = 300;
const BYTES_POR_TANDA = 1_500_000;
/** Lo que se crea al arrancar en blanco: si un teléfono solo tiene esto, no tiene nada propio. */
const DE_ARRANQUE = new Set(['settings', 'warehouses', 'zones']);

export interface RegistroServidor {
  tabla: string;
  id: string;
  datos: Record<string, unknown>;
  borrado: boolean;
}
interface Tanda {
  hasta: number;
  mas: boolean;
  registros: RegistroServidor[];
}
type Cambio = { tabla: string; id: string; op: 'guardar'; datos: Record<string, unknown> } | { tabla: string; id: string; op: 'borrar' };

// ---------- El vínculo de este teléfono con el servidor ----------

interface Vinculo {
  /** El servidor con el que se conectó (si la app se muda a otro, se vuelve a conectar). */
  servidor: string;
  /** Hasta dónde bajó (el «hasta» de la última tanda). */
  cursor: number;
  desde: string;
  ultimo: string | null;
}

const CLAVE_VINCULO = 'tabaco-servidor-vinculo';
const CLAVE_RECHAZOS = 'tabaco-servidor-rechazos';

/** El vínculo de este teléfono con el servidor de ahora, o null si nunca se conectó a él. */
export function vinculo(): Vinculo | null {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_VINCULO) ?? 'null') as Vinculo | null;
    return v && v.servidor === SERVIDOR.url && typeof v.cursor === 'number' ? v : null;
  } catch {
    return null;
  }
}

function guardarVinculo(v: Vinculo): void {
  try {
    localStorage.setItem(CLAVE_VINCULO, JSON.stringify(v));
  } catch {
    // Sin almacenamiento: la próxima vez se vuelve a comparar todo.
  }
}

/** Para las pruebas: olvida el vínculo (el teléfono queda como nunca conectado). */
export function olvidarVinculo(): void {
  try {
    localStorage.removeItem(CLAVE_VINCULO);
    localStorage.removeItem(CLAVE_RECHAZOS);
  } catch {
    // nada
  }
  anotarCambios(false);
  estado = { ...ESTADO_INICIAL };
  avisar();
}

// ---------- El estado (lo que muestra la app) ----------

export type Fase = 'apagado' | 'al-dia' | 'trabajando' | 'sin-conexion' | 'sesion-vencida' | 'sin-acceso' | 'error';

/** Un registro que el servidor no aceptó (queda solo en este teléfono). */
export interface Rechazo {
  clave: string;
  mensaje: string;
  at: string;
}

export interface EstadoSync {
  fase: Fase;
  /** Registros con cambios por subir. */
  pendientes: number;
  ultimo: string | null;
  mensaje: string | null;
  progreso: string | null;
  rechazos: Rechazo[];
}

const ESTADO_INICIAL: EstadoSync = { fase: 'apagado', pendientes: 0, ultimo: null, mensaje: null, progreso: null, rechazos: [] };
let estado: EstadoSync = { ...ESTADO_INICIAL, rechazos: leerRechazos() };
const oyentes = new Set<() => void>();

export function estadoSync(): EstadoSync {
  return estado;
}

export function alCambiarEstado(fn: () => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

function avisar(): void {
  for (const fn of oyentes) fn();
}

function poner(parcial: Partial<EstadoSync>): void {
  estado = { ...estado, ...parcial };
  avisar();
}

function leerRechazos(): Rechazo[] {
  try {
    const r = JSON.parse(localStorage.getItem(CLAVE_RECHAZOS) ?? '[]') as Rechazo[];
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

function anotarRechazo(c: string, mensaje: string): void {
  const r = [{ clave: c, mensaje, at: new Date().toISOString() }, ...leerRechazos().filter((x) => x.clave !== c)].slice(0, 50);
  try {
    localStorage.setItem(CLAVE_RECHAZOS, JSON.stringify(r));
  } catch {
    // nada
  }
  poner({ rechazos: r });
}

function quitarRechazo(c: string): void {
  const antes = leerRechazos();
  const r = antes.filter((x) => x.clave !== c);
  if (r.length === antes.length) return;
  try {
    localStorage.setItem(CLAVE_RECHAZOS, JSON.stringify(r));
  } catch {
    // nada
  }
  poner({ rechazos: r });
}

/** Qué pasó, en palabras, y en qué fase queda la sincronización. */
function faseDeError(e: unknown): Partial<EstadoSync> {
  if (e instanceof SinConexion) return { fase: 'sin-conexion', mensaje: e.message };
  if (e instanceof SesionVencida) return { fase: 'sesion-vencida', mensaje: e.message };
  if (e instanceof SinAcceso) return { fase: 'sin-acceso', mensaje: e.message };
  if (e instanceof ErrorServidor && e.sinPermiso && /no tienes cuenta/i.test(e.message)) return { fase: 'sin-acceso', mensaje: 'Tu cuenta ya no tiene acceso al programa de Tabaco.' };
  return { fase: 'error', mensaje: e instanceof Error ? e.message : String(e) };
}

export class SinAcceso extends Error {
  constructor(message = 'Tu cuenta ya no tiene acceso al programa de Tabaco.') {
    super(message);
    this.name = 'SinAcceso';
  }
}

// ---------- Lo local ----------

function base(): Dexie {
  return dexieDe(getLineRepo(PROGRAM_LINE));
}

async function leerFila(db: Dexie, tabla: string, id: string): Promise<Record<string, unknown> | undefined> {
  if (tabla === 'audit') return (await db.table('audit').where('id').equals(id).first()) as Record<string, unknown> | undefined;
  return (await db.table(tabla).get(id)) as Record<string, unknown> | undefined;
}

/** Todo lo de la línea en este teléfono, como se subiría («tabla/id» → datos). */
async function leerLocal(db: Dexie): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const tabla of LINE_TABLES) {
    for (const fila of (await db.table(tabla).toArray()) as Record<string, unknown>[]) out.set(clave(tabla, String(fila.id)), aDatos(tabla, fila));
  }
  return out;
}

/** ¿Este teléfono tiene solo lo del arranque en blanco (nada cargado por nadie)? */
async function soloArranque(db: Dexie): Promise<boolean> {
  for (const tabla of LINE_TABLES) {
    if (DE_ARRANQUE.has(tabla)) continue;
    const n = await db.table(tabla).count();
    if (tabla === 'users' || tabla === 'audit' ? n > 1 : n > 0) return false;
  }
  return true;
}

async function contarPendientes(db: Dexie): Promise<number> {
  return (await db.table(PENDIENTES).orderBy('clave').uniqueKeys()).length;
}

async function marcarPendientes(db: Dexie, claves: string[]): Promise<void> {
  if (!claves.length) return;
  await db.table(PENDIENTES).bulkAdd(claves.map((c) => ({ clave: c })));
}

/** Corre `fn` sobre la lista, de a `n` a la vez. */
async function enParalelo<T>(lista: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const trabajar = async () => {
    while (i < lista.length) await fn(lista[i++]!);
  };
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, trabajar));
}

/**
 * Los archivos (fotos y PDF) de esos registros: los que ya están en el teléfono iguales se reusan;
 * el resto se baja del depósito. Un archivo que no está en el servidor se salta (el registro no
 * se guarda); un corte de señal detiene todo y se reintenta la próxima vez.
 */
async function archivosDe(db: Dexie, registros: RegistroServidor[]): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  const lista = registros.filter((r) => !r.borrado && campoArchivo(r.tabla));
  let hechos = 0;
  await enParalelo(lista, 4, async (r) => {
    const k = clave(r.tabla, r.id);
    const campo = campoArchivo(r.tabla)!;
    const local = await leerFila(db, r.tabla, r.id);
    if (local && local[campo] instanceof Blob && iguales(r.tabla, local, r.datos)) {
      out.set(k, local[campo] as Blob);
      return;
    }
    try {
      out.set(k, await bajarArchivo(typeof r.datos.archivo === 'string' ? r.datos.archivo : rutaArchivo(r.tabla, r.id), tipoArchivo(r.tabla, r.datos)));
    } catch (e) {
      if (e instanceof ErrorServidor && (e.status === 404 || e.status === 400)) return;
      throw e;
    }
    hechos += 1;
    if (lista.length > 3) poner({ progreso: `Bajando fotos y PDF: ${hechos} de ${lista.length}` });
  });
  return out;
}

/**
 * Guarda en el teléfono lo que bajó del servidor. Lo que este teléfono tiene sin subir no se toca
 * (se sube después y gana). Devuelve cuántos registros cambiaron.
 */
async function aplicar(db: Dexie, registros: RegistroServidor[]): Promise<number> {
  const pendientes = new Set(((await db.table(PENDIENTES).toArray()) as Pendiente[]).map((p) => p.clave));
  const validos = registros.filter((r) => TABLAS.has(r.tabla) && !pendientes.has(clave(r.tabla, r.id)));
  if (!validos.length) return 0;
  const archivos = await archivosDe(db, validos);
  let cambiados = 0;
  await db.transaction('rw', db.tables, async () => {
    for (const r of validos) {
      const t = db.table(r.tabla);
      if (r.tabla === 'audit') {
        // La auditoría solo se agrega.
        if (!r.borrado && !(await t.where('id').equals(r.id).first())) {
          await t.add(desdeDatos('audit', r.id, r.datos));
          cambiados += 1;
        }
        continue;
      }
      const local = (await t.get(r.id)) as Record<string, unknown> | undefined;
      if (r.borrado) {
        if (local) {
          await t.delete(r.id);
          cambiados += 1;
        }
        continue;
      }
      if (local && iguales(r.tabla, local, r.datos)) continue;
      const campo = campoArchivo(r.tabla);
      const archivo = campo ? archivos.get(clave(r.tabla, r.id)) : undefined;
      if (campo && !archivo) continue;
      await t.put(desdeDatos(r.tabla, r.id, r.datos, archivo));
      cambiados += 1;
    }
  });
  return cambiados;
}

/**
 * Deja el teléfono igual al servidor (lo de aquí se reemplaza). Si al servidor le faltaran los
 * ajustes de la línea, se quedan los de aquí: sin ajustes, la app creería que la línea no tiene
 * datos reales.
 */
async function adoptar(db: Dexie, servidor: Map<string, RegistroServidor>): Promise<void> {
  const archivos = await archivosDe(db, [...servidor.values()]);
  const filas = new Map<string, Record<string, unknown>[]>();
  for (const r of servidor.values()) {
    if (!TABLAS.has(r.tabla)) continue;
    const campo = campoArchivo(r.tabla);
    const archivo = campo ? archivos.get(clave(r.tabla, r.id)) : undefined;
    if (campo && !archivo) continue;
    const fila = desdeDatos(r.tabla, r.id, r.datos, archivo);
    if (r.tabla === 'settings') fila.dataMode = 'real';
    filas.set(r.tabla, [...(filas.get(r.tabla) ?? []), fila]);
  }
  await db.transaction('rw', db.tables, async () => {
    for (const tabla of LINE_TABLES) {
      const rows = filas.get(tabla);
      if (tabla === 'settings' && !rows?.length) continue;
      await db.table(tabla).clear();
      if (!rows?.length) continue;
      if (tabla === 'audit') await db.table(tabla).bulkAdd(rows);
      else await db.table(tabla).bulkPut(rows);
    }
    await db.table(PENDIENTES).clear();
  });
  emitAll();
}

// ---------- Bajar ----------

/** Todo lo vivo del servidor y el cursor para seguir desde ahí. */
async function bajarTodo(): Promise<{ servidor: Map<string, RegistroServidor>; cursor: number }> {
  const servidor = new Map<string, RegistroServidor>();
  let cursor = 0;
  for (;;) {
    const t: Tanda = await rpc<Tanda>('tabaco_traer', { p_desde: cursor, p_limite: TANDA_BAJAR });
    for (const r of t.registros) {
      const k = clave(r.tabla, r.id);
      if (r.borrado) servidor.delete(k);
      else servidor.set(k, r);
    }
    cursor = t.hasta;
    if (servidor.size > TANDA_BAJAR) poner({ progreso: `Bajando del servidor: ${servidor.size} registros` });
    if (!t.mas) break;
  }
  return { servidor, cursor };
}

async function bajar(db: Dexie): Promise<void> {
  const inicio = vinculo();
  if (!inicio) return;
  let v: Vinculo = inicio;
  let cambiados = 0;
  for (;;) {
    const t: Tanda = await rpc<Tanda>('tabaco_traer', { p_desde: v.cursor, p_limite: TANDA_BAJAR });
    if (t.registros.length) cambiados += await aplicar(db, t.registros);
    v = { ...v, cursor: t.hasta };
    guardarVinculo(v);
    if (!t.mas) break;
  }
  if (cambiados) emitChange(PROGRAM_LINE);
}

// ---------- Subir ----------

/** Un «no» del servidor por los datos de un registro (no por permisos, señal o falla del servidor). */
function esDeDatos(e: unknown): e is ErrorServidor {
  return e instanceof ErrorServidor && !e.sinPermiso && e.status < 500 && e.status !== 429;
}

/**
 * Sube los cambios en tandas que el servidor acepte (hasta 300 y ~1,5 MB). Si una tanda no entra
 * por un registro, se prueba uno por uno: el que no entra queda anotado (y solo en este teléfono)
 * y los demás suben.
 */
async function aplicarEnServidor(cambios: Cambio[], rechazados: Set<string>): Promise<void> {
  let tanda: Cambio[] = [];
  let bytes = 0;
  const enviar = async () => {
    if (!tanda.length) return;
    const lote = tanda;
    tanda = [];
    bytes = 0;
    try {
      await rpc<number>('tabaco_aplicar', { p_cambios: lote });
    } catch (e) {
      if (!esDeDatos(e)) throw e;
      for (const c of lote) {
        try {
          await rpc<number>('tabaco_aplicar', { p_cambios: [c] });
        } catch (e2) {
          if (!esDeDatos(e2)) throw e2;
          anotarRechazo(clave(c.tabla, c.id), e2.message);
          rechazados.add(clave(c.tabla, c.id));
        }
      }
    }
    for (const c of lote) {
      const k = clave(c.tabla, c.id);
      if (!rechazados.has(k)) quitarRechazo(k);
    }
  };
  for (const c of cambios) {
    const p = peso(c);
    if (tanda.length && (tanda.length >= TANDA_SUBIR || bytes + p > BYTES_POR_TANDA)) await enviar();
    tanda.push(c);
    bytes += p;
  }
  await enviar();
}

async function subir(db: Dexie): Promise<void> {
  for (;;) {
    const lote = (await db.table(PENDIENTES).orderBy('seq').limit(TANDA_SUBIR * 2).toArray()) as Pendiente[];
    if (!lote.length) return;
    const maxSeq = lote[lote.length - 1]!.seq!;
    const claves = [...new Set(lote.map((p) => p.clave))];
    const cambios: Cambio[] = [];
    const archivosBorrados: string[] = [];
    const rechazados = new Set<string>();
    for (const k of claves) {
      const corte = k.indexOf('/');
      const tabla = k.slice(0, corte);
      const id = k.slice(corte + 1);
      if (!TABLAS.has(tabla)) continue;
      const fila = await leerFila(db, tabla, id);
      if (!fila) {
        // La auditoría no se borra en el servidor (aunque aquí se haya vaciado la línea).
        if (tabla === 'audit') continue;
        cambios.push({ tabla, id, op: 'borrar' });
        if (campoArchivo(tabla)) archivosBorrados.push(rutaArchivo(tabla, id));
        continue;
      }
      const campo = campoArchivo(tabla);
      if (campo) {
        const archivo = fila[campo];
        try {
          if (!(archivo instanceof Blob)) throw new ErrorServidor('El registro no tiene su archivo.', 400);
          await subirArchivo(rutaArchivo(tabla, id), archivo);
        } catch (e) {
          // Un archivo que el depósito no acepta (tipo o tamaño): el registro no sube, queda anotado.
          if (!esDeDatos(e)) throw e;
          anotarRechazo(k, e.message);
          rechazados.add(k);
          continue;
        }
      }
      cambios.push({ tabla, id, op: 'guardar', datos: aDatos(tabla, fila) });
    }
    poner({ progreso: cambios.length > 20 ? `Subiendo ${cambios.length} cambios…` : null });
    await aplicarEnServidor(cambios, rechazados);
    await db.table(PENDIENTES).where('seq').belowOrEqual(maxSeq).delete();
    if (archivosBorrados.length) await borrarArchivos(archivosBorrados).catch(() => undefined);
    poner({ pendientes: await contarPendientes(db) });
  }
}

// ---------- El ciclo ----------

let corriendo: Promise<void> | null = null;
let otraVez = false;

/** Sube y baja ahora. Si ya está corriendo, se encadena otra vuelta al terminar. */
export function sincronizar(): Promise<void> {
  if (corriendo) {
    otraVez = true;
    return corriendo;
  }
  corriendo = ciclo().finally(() => {
    corriendo = null;
    if (otraVez) {
      otraVez = false;
      void sincronizar();
    }
  });
  return corriendo;
}

/** Espera a que no quede ninguna vuelta corriendo (ni encadenada). */
export async function enCalma(): Promise<void> {
  while (corriendo) await corriendo.catch(() => undefined);
}

async function ciclo(): Promise<void> {
  const s = sesionActual();
  if (!vinculo() || !s) {
    poner({ fase: 'apagado', progreso: null });
    return;
  }
  const db = base();
  poner({ fase: 'trabajando', mensaje: null });
  try {
    const soy = await rpc<Cuenta | null>('tabaco_soy');
    if (!soy) throw new SinAcceso();
    if (s.cuenta && soy.rol !== s.cuenta.rol) throw new SinAcceso('Tu acceso cambió: vuelve a entrar.');
    if (soy.rol === 'admin') await subir(db);
    await bajar(db);
    const ultimo = new Date().toISOString();
    const v = vinculo();
    if (v) guardarVinculo({ ...v, ultimo });
    poner({ fase: 'al-dia', ultimo, progreso: null, mensaje: null, pendientes: await contarPendientes(db) });
  } catch (e) {
    poner({ ...faseDeError(e), progreso: null, pendientes: await contarPendientes(db).catch(() => estado.pendientes) });
  }
}

// ---------- La primera conexión de este teléfono ----------

export interface Diferencias {
  /** Registros que este teléfono tiene y el servidor no. */
  soloAqui: number;
  /** Registros que están en los dos lados, distintos. */
  distintos: number;
  /** Registros que tiene el servidor y este teléfono no. */
  soloServidor: number;
  /** Solo Administración puede subir lo suyo. */
  puedeSubir: boolean;
}

export type Conexion = { tipo: 'lista' } | { tipo: 'decidir'; diferencias: Diferencias };

let porDecidir: { servidor: Map<string, RegistroServidor>; cursor: number; subir: string[] } | null = null;

function enlazar(cursor: number): void {
  guardarVinculo({ servidor: SERVIDOR.url, cursor, desde: new Date().toISOString(), ultimo: null });
  anotarCambios(true);
}

/**
 * Conecta este teléfono con el servidor por primera vez. Devuelve `decidir` si los dos lados
 * tienen datos distintos: la persona elige con `resolver`.
 */
export async function conectar(): Promise<Conexion> {
  const rol = sesionActual()?.cuenta?.rol;
  const db = base();
  poner({ fase: 'trabajando', progreso: 'Mirando lo que hay en el servidor…', mensaje: null });
  try {
    const { servidor, cursor } = await bajarTodo();
    const local = await leerLocal(db);
    if (servidor.size === 0) {
      // El servidor está vacío: este teléfono lo llena (si es de Administración).
      await db.table(PENDIENTES).clear();
      if (rol === 'admin') await marcarPendientes(db, [...local.keys()]);
      enlazar(cursor);
      void sincronizar();
      return { tipo: 'lista' };
    }
    const subirAqui: string[] = [];
    let soloAqui = 0;
    let distintos = 0;
    for (const [k, datos] of local) {
      const remoto = servidor.get(k);
      if (remoto && estable(remoto.datos) === estable(datos)) continue;
      subirAqui.push(k);
      // La auditoría propia no es una diferencia: solo se agrega.
      if (k.startsWith('audit/')) continue;
      if (remoto) distintos += 1;
      else soloAqui += 1;
    }
    const soloServidor = [...servidor.keys()].filter((k) => !local.has(k)).length;
    if (soloAqui + distintos === 0 || (await soloArranque(db))) {
      await adoptar(db, servidor);
      enlazar(cursor);
      poner({ fase: 'al-dia', progreso: null, ultimo: new Date().toISOString(), pendientes: 0 });
      return { tipo: 'lista' };
    }
    porDecidir = { servidor, cursor, subir: subirAqui };
    poner({ fase: 'apagado', progreso: null });
    return { tipo: 'decidir', diferencias: { soloAqui, distintos, soloServidor, puedeSubir: rol === 'admin' } };
  } catch (e) {
    poner({ ...faseDeError(e), progreso: null });
    throw e;
  }
}

/**
 * Lo que eligió la persona cuando los dos lados eran distintos:
 *   · `servidor`: este teléfono queda igual al servidor (lo de aquí se reemplaza);
 *   · `equipo` (solo Administración): lo del servidor que falta aquí se baja y lo de aquí sube
 *     (donde los dos tienen el mismo registro, gana el de este teléfono).
 */
export async function resolver(eleccion: 'servidor' | 'equipo'): Promise<void> {
  const d = porDecidir;
  if (!d) throw new Error('No hay nada por decidir.');
  const db = base();
  poner({ fase: 'trabajando', progreso: eleccion === 'servidor' ? 'Bajando lo del servidor…' : 'Juntando lo de los dos lados…', mensaje: null });
  try {
    if (eleccion === 'servidor') {
      await adoptar(db, d.servidor);
    } else {
      if (sesionActual()?.cuenta?.rol !== 'admin') throw new Error('Solo Administración puede subir lo de este teléfono.');
      const aqui = new Set((await leerLocal(db)).keys());
      await aplicar(
        db,
        [...d.servidor.values()].filter((r) => !aqui.has(clave(r.tabla, r.id))),
      );
      await db.table(PENDIENTES).clear();
      await marcarPendientes(db, d.subir);
      emitAll();
    }
    porDecidir = null;
    enlazar(d.cursor);
    await sincronizar();
  } catch (e) {
    poner({ ...faseDeError(e), progreso: null });
    throw e;
  }
}

/** ¿Este teléfono ya está conectado al servidor de ahora? */
export function conectado(): boolean {
  return vinculo() !== null;
}

// ---------- Cuándo sincroniza ----------

let timer: ReturnType<typeof setTimeout> | undefined;
let iniciado = false;

/** Sincroniza dentro de un momento (si ya había una programada, la corre más tarde). */
export function programar(ms = 2000): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void sincronizar();
  }, ms);
}

/**
 * Arranca la sincronización de fondo: un momento después de cada cambio, al volver la señal, al
 * volver a la app y cada minuto mientras está abierta. Solo si el teléfono ya está conectado.
 */
export function iniciar(): void {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;
  alAnotarCambios(() => programar(2000));
  window.addEventListener('online', () => programar(300));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') programar(300);
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && conectado() && sesionActual()) void sincronizar();
  }, 60_000);
  const v = vinculo();
  if (v) {
    anotarCambios(true);
    poner({ ultimo: v.ultimo });
    if (sesionActual()) programar(500);
  }
}
