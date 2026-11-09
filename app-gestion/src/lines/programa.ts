// Qué atiende este programa. Tabaco y Café son dos programas separados: cada uno con su link, sus
// bases de datos y su gente. Este es el de Tabaco. El café queda en espera en el mismo código (su
// configuración, su catálogo y sus pantallas), sin mostrarse ni guardarse aquí: ver
// docs/CAFE-EN-ESPERA.md para activarlo como programa aparte.
import type { LineId } from '../data/types';

/** La línea de este programa. */
export const PROGRAM_LINE: LineId = 'tabaco';

/**
 * Prefijo de las bases de datos del navegador de este programa («tabaco-cuentas», «tabaco-datos»).
 * Todos los sitios de github.io de la misma cuenta comparten el almacenamiento del navegador: el
 * programa de café, cuando se active, usará las suyas («cafe-…») y nunca verá estas.
 */
export const DB_NAMESPACE = PROGRAM_LINE;

let lines: readonly LineId[] = [PROGRAM_LINE];

/** Las líneas que este programa muestra y guarda (en la app, solo Tabaco). */
export function programLines(): readonly LineId[] {
  return lines;
}

/** Solo para las pruebas del motor, que trabajan con las dos líneas a la vez. `null` vuelve a lo normal. */
export function setProgramLines(next: readonly LineId[] | null): void {
  lines = next ?? [PROGRAM_LINE];
}

/** ¿Esta línea es de este programa? (Una dirección «/cafe» en el programa de Tabaco no lo es.) */
export function isProgramLine(line: string | null | undefined): line is LineId {
  return line !== null && line !== undefined && (lines as readonly string[]).includes(line);
}
