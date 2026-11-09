// Administración (con el servidor): quién entra al programa, invitar y quitar o devolver el acceso.
// Va aparte de acceso.ts para que la portada no baje lo de Administración.
import type { Ctx } from './context';
import { getLineRepo } from '../data';
import { PROGRAM_LINE } from '../lines/programa';
import { PUBLIC_URL } from '../lib/assets';
import { type Cuenta, rpc } from '../servidor/cliente';
import { saveUser } from './admin';

export interface CuentaConAcceso {
  usuario: string;
  nombre: string;
  rol: Cuenta['rol'];
  correo: string | null;
  activa: boolean;
  usuario_app: string | null;
  yo: boolean;
  ultima_entrada: string | null;
}

export interface InvitacionAbierta {
  id: string;
  nombre: string;
  correo: string;
  rol: 'admin' | 'direccion';
  creada_en: string;
  vence_en: string;
  estado: 'vigente' | 'vencida';
}

export function listarAccesos(): Promise<{ cuentas: CuentaConAcceso[]; invitaciones: InvitacionAbierta[] }> {
  return rpc('tabaco_cuentas');
}

export function linkDeAcceso(token: string): string {
  return `${PUBLIC_URL}#/acceso/${token}`;
}

/**
 * Invita a alguien con su correo. A Administración se le crea (o se le busca) su usuario en la
 * línea, para que lo que haga quede con su nombre.
 */
export async function invitar(ctx: Ctx, input: { nombre: string; correo: string; rol: 'admin' | 'direccion'; dias: number }): Promise<{ link: string; venceEn: string }> {
  const correo = input.correo.trim().toLowerCase();
  const nombre = input.nombre.trim();
  let usuarioApp: string | null = null;
  if (input.rol === 'admin') {
    const ya = (await getLineRepo(PROGRAM_LINE).users.all()).find((u) => u.role === 'admin' && u.email.trim().toLowerCase() === correo);
    usuarioApp = ya?.id ?? (await saveUser(ctx, { role: 'admin', name: nombre, email: correo, phone: '' })).id;
  }
  const r = await rpc<{ token: string; vence_en: string }>('tabaco_invitar', {
    p_correo: correo,
    p_nombre: nombre,
    p_rol: input.rol,
    p_usuario_app: usuarioApp,
    p_dias: input.dias,
  });
  return { link: linkDeAcceso(r.token), venceEn: r.vence_en };
}

export function cambiarAcceso(usuario: string, activa: boolean): Promise<void> {
  return rpc('tabaco_cuenta_activa', { p_usuario: usuario, p_activa: activa });
}

export function anularInvitacion(id: string): Promise<void> {
  return rpc('tabaco_invitacion_anular', { p_id: id });
}
