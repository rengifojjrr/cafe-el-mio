/// <reference lib="webworker" />
// Carga los datos de ejemplo fuera del hilo principal: la simulación de tres meses y la
// escritura en IndexedDB no traban la pantalla. Escribe en las mismas bases (mismo origen).
import { openCoreRepo, openLineRepo } from '../data/local/dexie';
import { seedEverything } from './index';

interface SeedRequest {
  now: string;
  name: string;
  prefix: string;
}

self.onmessage = async (e: MessageEvent<SeedRequest>) => {
  const { now, name, prefix } = e.data;
  try {
    const core = openCoreRepo(prefix);
    const repos = { tabaco: openLineRepo('tabaco', prefix), cafe: openLineRepo('cafe', prefix) };
    await Promise.all([core.clearAll(), repos.tabaco.clearAll(), repos.cafe.clearAll()]);
    await seedEverything(core, repos, new Date(now), name);
    self.postMessage({ ok: true });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
