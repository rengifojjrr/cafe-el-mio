// ¿Estas son las pruebas automáticas con los datos de ejemplo? Fuera de las pruebas, siempre no.

/**
 * La app ya no trae datos de ejemplo. Solo las pruebas automáticas los cargan, y lo piden con esta
 * marca en el navegador (Playwright la pone en cada prueba) o con `allowDemoData` (Vitest).
 */
export const DEMO_FLAG = 'pruebas:datos-de-ejemplo';

let demoOverride: boolean | null = null;

/** Para las pruebas unitarias: con `true`, la app se comporta como antes y carga los ejemplos. */
export function allowDemoData(allow: boolean | null): void {
  demoOverride = allow;
}

/** ¿Estas pruebas piden los datos de ejemplo? Fuera de las pruebas, siempre no. */
export function demoRequested(): boolean {
  if (demoOverride !== null) return demoOverride;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEMO_FLAG) === '1';
  } catch {
    return false;
  }
}
