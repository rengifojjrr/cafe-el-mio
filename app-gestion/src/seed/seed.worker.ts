/// <reference lib="webworker" />
// Carga los datos de ejemplo fuera del hilo principal: la simulación de tres meses y la
// escritura en IndexedDB no traban la pantalla. Escribe en las mismas bases (mismo origen).
import type { LineId } from '../data/types';
import { LINES } from '../data/types';
import { openCoreRepo, openLineRepo } from '../data/local/dexie';
import { seedEverything, seedLines } from './index';

interface SeedRequest {
  now: string;
  name: string;
  prefix: string;
  /** Solo estas líneas: las de datos reales no se tocan. Si falta, las dos. */
  lines?: LineId[];
}

self.onmessage = async (e: MessageEvent<SeedRequest>) => {
  const { now, name, prefix, lines } = e.data;
  try {
    const core = openCoreRepo(prefix);
    // Solo se abren las bases de las líneas pedidas (el programa de Tabaco no crea la del café).
    const wanted = lines ?? LINES;
    const repos = Object.fromEntries(wanted.map((l) => [l, openLineRepo(l, prefix)])) as Partial<Record<LineId, ReturnType<typeof openLineRepo>>>;
    if (lines && lines.length < LINES.length) {
      await seedLines(core, repos, lines, new Date(now), name);
    } else {
      await Promise.all([core.clearAll(), ...wanted.map((l) => repos[l]!.clearAll())]);
      await seedEverything(core, repos, new Date(now), name, wanted);
    }
    self.postMessage({ ok: true });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
