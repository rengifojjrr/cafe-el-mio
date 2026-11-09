// Las bases de datos de antes de separar Tabaco y Café: «eco-tabaco», «eco-cafe» y «eco-core» (las
// dos líneas juntas). El programa de Tabaco ya no las lee: usa las suyas («tabaco-…»).
// Al abrir, las que solo tenían la demo se borran. Si una tenía datos reales (alguien empezó en
// blanco y cargó lo suyo), se deja quieta: no se ve en el programa, pero no se pierde.
const OLD_LINES = ['eco-tabaco', 'eco-cafe'] as const;
const OLD_CORE = 'eco-core';

/** Borra las bases viejas que solo tenían ejemplos. Devuelve las que borró. */
export async function removeOldDatabases(): Promise<string[]> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return [];
  let existing: Set<string>;
  try {
    existing = new Set((await indexedDB.databases()).map((d) => d.name ?? ''));
  } catch {
    return [];
  }
  const removed: string[] = [];
  let keptReal = false;
  for (const name of OLD_LINES) {
    if (!existing.has(name)) continue;
    if (await hasRealData(name)) {
      keptReal = true;
      continue;
    }
    if (await deleteDb(name)) removed.push(name);
  }
  // La común se va solo si no quedó ninguna línea con datos reales (sin ella no se podría entrar).
  if (existing.has(OLD_CORE) && !keptReal && (await deleteDb(OLD_CORE))) removed.push(OLD_CORE);
  return removed;
}

/** ¿La base vieja de una línea tenía datos reales? Si no se puede leer, se supone que sí (no se borra). */
function hasRealData(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = indexedDB.open(name);
    // No debería pasar (la base existe), pero si no existía, no se crea vacía.
    req.onupgradeneeded = () => req.transaction?.abort();
    req.onerror = () => resolve(true);
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains('settings')) {
          db.close();
          resolve(false);
          return;
        }
        const get = db.transaction('settings', 'readonly').objectStore('settings').get('settings');
        get.onsuccess = () => {
          const s = get.result as { dataMode?: string } | undefined;
          db.close();
          resolve(s?.dataMode === 'real');
        };
        get.onerror = () => {
          db.close();
          resolve(true);
        };
      } catch {
        db.close();
        resolve(true);
      }
    };
  });
}

function deleteDb(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
    // Otra pestaña con la versión vieja la tiene abierta: se borra sola cuando esa pestaña se cierre.
    req.onblocked = () => resolve(false);
  });
}
