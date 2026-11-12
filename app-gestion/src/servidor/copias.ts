// La copia de seguridad automática del servidor: el servidor copia todo cada madrugada (y antes de
// vaciar una tabla) y guarda 30 días. La app solo pregunta cuándo fue la última.
import { rpc } from './cliente';

export interface CopiasServidor {
  ultima: { hecha_en: string; motivo: string; registros: number } | null;
  guardadas: number;
  desde: string | null;
}

export function copiasDelServidor(): Promise<CopiasServidor> {
  return rpc<CopiasServidor>('tabaco_copias');
}

/** La tarea corre cada madrugada: más de 36 horas sin copia quiere decir que algo falla. */
export const HORAS_SIN_COPIA = 36;

export function copiaAlDia(c: CopiasServidor, now: Date): boolean {
  if (!c.ultima) return false;
  return now.getTime() - new Date(c.ultima.hecha_en).getTime() < HORAS_SIN_COPIA * 3_600_000;
}
