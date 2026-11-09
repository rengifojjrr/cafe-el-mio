// La puerta del programa: con el servidor, solo entra quien entró con su correo y su contraseña, y
// solo con su propia cuenta. Las pruebas con datos de ejemplo siguen con «Entrar como…».
import { sesionActual } from '../servidor/cliente';
import { demoRequested } from './demo';

let exigir = true;

/** Solo para las pruebas unitarias del motor (que entran como cualquier cuenta). */
export function exigirInicioDeSesion(on: boolean): void {
  exigir = on;
}

/** ¿Se entra con correo y contraseña? Sí, salvo en las pruebas con datos de ejemplo. */
export function conServidor(): boolean {
  return exigir && !demoRequested();
}

/** ¿Se puede usar ahora esa cuenta de la app? Con el servidor, solo la de quien entró. */
export function cuentaPermitida(accountId: string | null | undefined): boolean {
  if (!conServidor()) return true;
  if (!accountId) return false;
  const s = sesionActual();
  return !!s?.cuentaApp && s.cuentaApp === accountId;
}
