// Entrar al programa con el servidor: correo y contraseña e invitaciones. Lo de Administración
// (quién tiene acceso, invitar) está en acceso-admin.ts, que solo se baja en Usuarios.
// Fase 1: entran Administración y Dirección (vendedores y locales, en la fase 2).
import { getCoreRepo } from '../data';
import { PROGRAM_LINE } from '../lines/programa';
import { type Cuenta, anotarCuenta, entrar, rpc, salir, sesionActual } from '../servidor/cliente';
import { type Conexion, type Diferencias, conectar, conectado, resolver, sincronizar } from '../servidor/sincronizar';
import { ensureSeeded, enterAs, findAccount, leave } from './session';

export type { Diferencias };

export type Entrada = { tipo: 'adentro'; destino: string } | { tipo: 'decidir'; diferencias: Diferencias };

/** La cuenta de la app de una cuenta del servidor: Dirección, o la Administración de esa persona. */
async function cuentaAppDe(c: Cuenta): Promise<string> {
  if (c.rol === 'direccion') return 'direccion';
  const usuario = c.usuario_app ?? 't-usr_admin';
  const principal = (await getCoreRepo().directory.all()).find((a) => a.line === PROGRAM_LINE && a.userId === usuario);
  if (principal) return principal.id;
  const id = `${PROGRAM_LINE}:${usuario}`;
  // Si esa persona todavía no está en este teléfono, entra como la Administración principal.
  return (await findAccount(id)) ? id : `${PROGRAM_LINE}:admin`;
}

/** Lo que pasa después de que el servidor aceptó el correo y la contraseña. */
async function despuesDeEntrar(): Promise<Entrada> {
  let cuenta: Cuenta | null;
  try {
    cuenta = await rpc<Cuenta | null>('tabaco_soy');
  } catch (e) {
    await salir();
    throw e;
  }
  if (!cuenta) {
    await salir();
    throw new Error('Ese correo no tiene acceso al programa de Tabaco. Pídele una invitación a Administración.');
  }
  if (cuenta.rol !== 'admin' && cuenta.rol !== 'direccion') {
    await salir();
    throw new Error('Tu cuenta es de vendedor o de local: todavía no entra al servidor (llega en la próxima etapa).');
  }
  await ensureSeeded();
  anotarCuenta(cuenta, await cuentaAppDe(cuenta));
  if (!conectado()) {
    const c: Conexion = await conectar();
    if (c.tipo === 'decidir') return c;
  } else {
    void sincronizar();
  }
  return terminar();
}

async function terminar(): Promise<Entrada> {
  const s = sesionActual();
  if (!s?.cuenta) throw new Error('Tu sesión se cerró: vuelve a entrar.');
  // Después de bajar del servidor, la persona ya puede estar en este teléfono.
  anotarCuenta(s.cuenta, await cuentaAppDe(s.cuenta));
  const acc = await enterAs(sesionActual()!.cuentaApp!);
  return { tipo: 'adentro', destino: acc.role === 'direccion' ? '/direccion' : `/${acc.line}` };
}

/** Entra con correo y contraseña. */
export async function entrarConCorreo(correo: string, clave: string): Promise<Entrada> {
  await entrar(correo, clave);
  return despuesDeEntrar();
}

/** La primera vez, si este teléfono y el servidor tenían datos distintos: lo que eligió la persona. */
export async function decidirConexion(eleccion: 'servidor' | 'equipo'): Promise<Entrada> {
  await resolver(eleccion);
  return terminar();
}

/** Si ya había entrado en este teléfono: sigue a su pantalla. */
export async function seguir(): Promise<Entrada> {
  const s = sesionActual();
  if (!s?.cuenta) throw new Error('Entra con tu correo y tu contraseña.');
  if (!conectado()) return despuesDeEntrar();
  void sincronizar();
  return terminar();
}

/** Cierra la sesión: antes intenta subir lo pendiente. */
export async function cerrarSesion(): Promise<void> {
  await sincronizar().catch(() => undefined);
  await salir();
  await leave();
}

// ---------- Invitaciones (las abre quien todavía no tiene cuenta) ----------

export interface InvitacionServidor {
  estado: 'vigente' | 'vencida' | 'usada' | 'anulada' | 'no_existe';
  nombre?: string;
  rol?: 'admin' | 'direccion';
  correo?: string;
  vence_en?: string;
  /** `nueva`: crea su contraseña; `tabaco`: ya tenía cuenta del programa (pone una nueva); `otra`: ya tenía cuenta en el servidor (entra con la suya). */
  cuenta?: 'nueva' | 'tabaco' | 'otra';
}

export function verInvitacion(token: string): Promise<InvitacionServidor> {
  return rpc<InvitacionServidor>('tabaco_invitacion_ver', { p_token: token }, { anonimo: true });
}

/** Acepta la invitación poniendo una contraseña, y entra. */
export async function aceptarInvitacion(token: string, clave: string): Promise<Entrada> {
  const r = await rpc<{ correo: string }>('tabaco_invitacion_aceptar', { p_token: token, p_clave: clave }, { anonimo: true });
  await entrar(r.correo, clave);
  return despuesDeEntrar();
}

/** Quien ya tenía cuenta en el servidor: entra con su contraseña y la invitación se le enlaza. */
export async function enlazarInvitacion(token: string, correo: string, clave: string): Promise<Entrada> {
  await entrar(correo, clave);
  try {
    await rpc('tabaco_invitacion_enlazar', { p_token: token });
  } catch (e) {
    await salir();
    throw e;
  }
  return despuesDeEntrar();
}
