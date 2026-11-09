// Cómo habla la app con el servidor: entrar y salir (correo y contraseña), llamar a las funciones
// `tabaco_*` y subir o bajar fotos y PDF del depósito. Sin librerías: unas pocas llamadas `fetch`.
//
// La sesión se guarda con un nombre propio («tabaco-servidor-sesion»): el mismo sitio tiene otras
// páginas y no se pisan. El token dura una hora y se renueva solo; si hay varias pestañas abiertas,
// lo renueva una sola (con un candado del navegador), porque el servidor anula un token de
// renovación que se usa dos veces.
import { SERVIDOR } from './config';

export interface Cuenta {
  rol: 'admin' | 'seller' | 'store' | 'direccion';
  usuario_app: string | null;
  tienda: string | null;
  nombre: string;
}

export interface SesionServidor {
  /** El servidor que dio esta sesión: si la app se muda a otro, la sesión ya no vale ahí. */
  servidor: string;
  access_token: string;
  refresh_token: string;
  /** Segundos desde 1970 en que vence el token. */
  expires_at: number;
  usuario: { id: string; correo: string };
  /** Lo que dijo el servidor de esta persona al entrar (sirve también sin señal). */
  cuenta?: Cuenta;
  /** La cuenta de la app con la que entra («tabaco:admin», «direccion»…). */
  cuentaApp?: string;
}

const CLAVE_SESION = 'tabaco-servidor-sesion';

/** El servidor respondió que no. `codigo` es el de Postgres o el de la autenticación. */
export class ErrorServidor extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codigo?: string,
    readonly pista?: string,
  ) {
    super(message);
    this.name = 'ErrorServidor';
  }
  /** Sin permiso para eso (no es un error de datos). */
  get sinPermiso(): boolean {
    return this.codigo === '42501' || this.status === 401 || this.status === 403;
  }
}

/** No se pudo hablar con el servidor (sin señal, o el servidor no responde). */
export class SinConexion extends Error {
  constructor() {
    super('Sin conexión con el servidor. Lo que hagas queda guardado en este teléfono y se sube cuando vuelva la señal.');
    this.name = 'SinConexion';
  }
}

/** El servidor ya no acepta esta sesión: hay que volver a entrar. */
export class SesionVencida extends Error {
  constructor() {
    super('Tu sesión se venció: vuelve a entrar con tu correo y tu contraseña.');
    this.name = 'SesionVencida';
  }
}

// ---------- Las llamadas (se pueden cambiar en las pruebas) ----------

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchFn: Fetch = (input, init) => fetch(input, init);

/** Solo para las pruebas: responde en lugar del servidor. `null` vuelve al de verdad. */
export function usarFetch(fn: Fetch | null): void {
  fetchFn = fn ?? ((input, init) => fetch(input, init));
}

// ---------- La sesión guardada ----------

const oyentes = new Set<() => void>();

/** Avisa cuando se entra, se sale o cambia la sesión (también desde otra pestaña). */
export function alCambiarSesion(fn: () => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

function avisar(): void {
  for (const fn of oyentes) fn();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === CLAVE_SESION) avisar();
  });
}

function esSesion(v: unknown): v is SesionServidor {
  const s = v as SesionServidor | null;
  return (
    !!s &&
    s.servidor === SERVIDOR.url &&
    typeof s.access_token === 'string' &&
    typeof s.refresh_token === 'string' &&
    typeof s.expires_at === 'number' &&
    typeof s.usuario?.id === 'string'
  );
}

let cacheRaw: string | null = null;
let cacheSesion: SesionServidor | null = null;

/** La sesión guardada en este teléfono, o null si nadie entró (o se salió). Mientras no cambie, es el mismo objeto. */
export function sesionActual(): SesionServidor | null {
  try {
    const raw = localStorage.getItem(CLAVE_SESION);
    if (raw === cacheRaw) return cacheSesion;
    cacheRaw = raw;
    const s: unknown = raw ? JSON.parse(raw) : null;
    cacheSesion = esSesion(s) ? s : null;
    return cacheSesion;
  } catch {
    return null;
  }
}

function guardarSesion(s: SesionServidor | null): void {
  try {
    if (s) localStorage.setItem(CLAVE_SESION, JSON.stringify(s));
    else localStorage.removeItem(CLAVE_SESION);
  } catch {
    // Sin almacenamiento (modo privado estricto): la sesión dura lo que la pestaña.
  }
  avisar();
}

/** Anota en la sesión lo que dijo el servidor de esta persona y con qué cuenta de la app entra. */
export function anotarCuenta(cuenta: Cuenta, cuentaApp: string): void {
  const s = sesionActual();
  if (s) guardarSesion({ ...s, cuenta, cuentaApp });
}

// ---------- Hablar con el servidor ----------

async function pedir(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { apikey: SERVIDOR.llave, ...((init.headers as Record<string, string> | undefined) ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetchFn(`${SERVIDOR.url}${path}`, { ...init, headers });
  } catch {
    throw new SinConexion();
  }
}

const TRADUCCIONES: [RegExp, string][] = [
  [/invalid login credentials|invalid_credentials/i, 'El correo o la contraseña no coinciden.'],
  [/email not confirmed|email_not_confirmed/i, 'Ese correo todavía no está confirmado.'],
  [/rate limit|too many|over_request_rate_limit/i, 'Demasiados intentos seguidos: espera un minuto y prueba otra vez.'],
  [/jwt expired/i, 'Tu sesión se venció: vuelve a entrar.'],
  [/permission denied/i, 'No tienes permiso para eso.'],
  [/payload too large|maximum allowed size|exceeded the maximum/i, 'El archivo es demasiado grande (hasta 10 MB).'],
  [/mime type .* is not supported|invalid_mime_type/i, 'Ese tipo de archivo no se puede subir (fotos o PDF).'],
];

function traducir(msg: string): string {
  for (const [re, es] of TRADUCCIONES) if (re.test(msg)) return es;
  return msg;
}

async function leerError(res: Response): Promise<ErrorServidor> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // Sin cuerpo: queda el número.
  }
  const crudo = String(body.message ?? body.msg ?? body.error_description ?? body.error ?? `El servidor respondió ${res.status}.`);
  const codigo = body.code ?? body.error_code;
  return new ErrorServidor(traducir(crudo), res.status, codigo === undefined ? undefined : String(codigo), typeof body.hint === 'string' ? body.hint : undefined);
}

function aSesion(j: Record<string, unknown>, antes?: SesionServidor | null): SesionServidor {
  const user = (j.user ?? {}) as { id?: string; email?: string };
  const expiresIn = typeof j.expires_in === 'number' ? j.expires_in : 3600;
  return {
    servidor: SERVIDOR.url,
    access_token: String(j.access_token),
    refresh_token: String(j.refresh_token),
    expires_at: typeof j.expires_at === 'number' ? j.expires_at : Math.floor(Date.now() / 1000) + expiresIn,
    usuario: { id: String(user.id ?? antes?.usuario.id ?? ''), correo: String(user.email ?? antes?.usuario.correo ?? '') },
    ...(antes?.cuenta ? { cuenta: antes.cuenta } : {}),
    ...(antes?.cuentaApp ? { cuentaApp: antes.cuentaApp } : {}),
  };
}

/** Entra con correo y contraseña. La sesión anterior (si había) se reemplaza. */
export async function entrar(correo: string, clave: string): Promise<SesionServidor> {
  const email = correo.trim().toLowerCase();
  if (!email || !clave) throw new ErrorServidor('Escribe tu correo y tu contraseña.', 400);
  const res = await pedir(
    '/auth/v1/token?grant_type=password',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: clave }) },
    null,
  );
  if (!res.ok) throw await leerError(res);
  const s = aSesion((await res.json()) as Record<string, unknown>);
  guardarSesion(s);
  return s;
}

/** Sale: avisa al servidor (si hay señal) y borra la sesión de este teléfono. */
export async function salir(): Promise<void> {
  const s = sesionActual();
  guardarSesion(null);
  if (!s) return;
  try {
    await pedir('/auth/v1/logout?scope=local', { method: 'POST' }, s.access_token);
  } catch {
    // Sin señal: el token vence solo en una hora.
  }
}

/** Corre `fn` con un candado entre pestañas (si el navegador lo tiene). */
async function conCandado<R>(fn: () => Promise<R>): Promise<R> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) return fn();
  return locks.request('tabaco-servidor-sesion', fn) as Promise<R>;
}

async function renovar(vista: SesionServidor): Promise<SesionServidor> {
  return conCandado(async () => {
    const actual = sesionActual();
    if (!actual) throw new SesionVencida();
    // Otra pestaña ya la renovó mientras esperábamos el candado.
    if (actual.refresh_token !== vista.refresh_token && actual.expires_at - 60 > Date.now() / 1000) return actual;
    const res = await pedir(
      '/auth/v1/token?grant_type=refresh_token',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: actual.refresh_token }) },
      null,
    );
    if (!res.ok) {
      // El servidor dijo que no a la renovación: la sesión terminó (contraseña cambiada, cuenta quitada…).
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        guardarSesion(null);
        throw new SesionVencida();
      }
      throw await leerError(res);
    }
    const nueva = aSesion((await res.json()) as Record<string, unknown>, actual);
    guardarSesion(nueva);
    return nueva;
  });
}

/** Un token que sirve ahora (lo renueva si le queda menos de un minuto). */
export async function tokenVigente(): Promise<string> {
  const s = sesionActual();
  if (!s) throw new SesionVencida();
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  return (await renovar(s)).access_token;
}

/** Llama a una función del servidor. `anonimo`: sin sesión (abrir y aceptar una invitación). */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}, opts: { anonimo?: boolean } = {}): Promise<T> {
  const init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) };
  let res = await pedir(`/rest/v1/rpc/${fn}`, init, opts.anonimo ? null : await tokenVigente());
  if (res.status === 401 && !opts.anonimo) {
    // El token venció en el camino: se renueva una vez y se vuelve a intentar.
    const s = sesionActual();
    if (!s) throw new SesionVencida();
    res = await pedir(`/rest/v1/rpc/${fn}`, init, (await renovar({ ...s, expires_at: 0 })).access_token);
  }
  if (!res.ok) throw await leerError(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

function rutaDeposito(ruta: string): string {
  return ruta.split('/').map(encodeURIComponent).join('/');
}

/** Sube (o reemplaza) un archivo del depósito del programa. */
export async function subirArchivo(ruta: string, blob: Blob): Promise<void> {
  const res = await pedir(
    `/storage/v1/object/${SERVIDOR.deposito}/${rutaDeposito(ruta)}`,
    { method: 'POST', headers: { 'content-type': blob.type || 'application/octet-stream', 'x-upsert': 'true', 'cache-control': '3600' }, body: blob },
    await tokenVigente(),
  );
  if (!res.ok) throw await leerError(res);
}

/** Baja un archivo del depósito del programa. */
export async function bajarArchivo(ruta: string, tipo?: string): Promise<Blob> {
  const res = await pedir(`/storage/v1/object/authenticated/${SERVIDOR.deposito}/${rutaDeposito(ruta)}`, { method: 'GET' }, await tokenVigente());
  if (!res.ok) throw await leerError(res);
  const blob = await res.blob();
  return tipo && blob.type !== tipo ? new Blob([blob], { type: tipo }) : blob;
}

/** Borra archivos del depósito (si ya no están, no pasa nada). */
export async function borrarArchivos(rutas: string[]): Promise<void> {
  if (!rutas.length) return;
  const res = await pedir(
    `/storage/v1/object/${SERVIDOR.deposito}`,
    { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: rutas }) },
    await tokenVigente(),
  );
  if (!res.ok && res.status !== 404) throw await leerError(res);
}
