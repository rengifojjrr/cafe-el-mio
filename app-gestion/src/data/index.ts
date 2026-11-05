// Elige la implementación de datos con una variable: VITE_DATA_BACKEND=local (hoy)
// o supabase (plan en docs/SUPABASE.md). Las pantallas no se enteran del cambio.
import type { LineId } from './types';
import type { CoreRepo, LineRepo } from './repo';
import { openCoreRepo, openLineRepo } from './local/dexie';

type Backend = 'local' | 'supabase';

function backend(): Backend {
  const v = (import.meta.env?.VITE_DATA_BACKEND as string | undefined) ?? 'local';
  return v === 'supabase' ? 'supabase' : 'local';
}

const lineRepos = new Map<string, LineRepo>();
const coreRepos = new Map<string, CoreRepo>();

/** Prefijo de los nombres de base (solo lo cambian las pruebas). */
let dbPrefix = '';
export function setDbPrefix(prefix: string): void {
  dbPrefix = prefix;
  lineRepos.clear();
  coreRepos.clear();
}

export function getLineRepo(line: LineId): LineRepo {
  const key = `${dbPrefix}${line}`;
  let repo = lineRepos.get(key);
  if (!repo) {
    if (backend() === 'supabase') throw new Error('El servidor (Supabase) todavía no está conectado: ver docs/SUPABASE.md.');
    repo = openLineRepo(line, dbPrefix);
    lineRepos.set(key, repo);
  }
  return repo;
}

export function getCoreRepo(): CoreRepo {
  let repo = coreRepos.get(dbPrefix);
  if (!repo) {
    if (backend() === 'supabase') throw new Error('El servidor (Supabase) todavía no está conectado: ver docs/SUPABASE.md.');
    repo = openCoreRepo(dbPrefix);
    coreRepos.set(dbPrefix, repo);
  }
  return repo;
}
