// Almacenamiento persistente: pedirle al navegador que no borre las bases de esta app cuando
// le falte espacio. Sin servidor, los datos reales viven solo aquí.

/** null: el navegador no dice (no tiene la API). */
export type PersistState = boolean | null;

export async function isStoragePersisted(): Promise<PersistState> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

/** Pide guardar de forma persistente. Devuelve lo que contestó el navegador. */
export async function requestPersistentStorage(): Promise<PersistState> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

/** iPhone o iPad (Safari borra los datos de un sitio tras 7 días sin usarlo si no está instalado). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** ¿Se abrió como app instalada (pantalla de inicio)? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
