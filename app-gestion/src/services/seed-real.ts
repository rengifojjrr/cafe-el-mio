// La semilla cuando alguna línea tiene datos reales: esas líneas NUNCA se borran ni se vuelven a
// sembrar; solo se (re)cargan las de ejemplo, y las cuentas de «Entrar como…» de las reales se
// conservan. Se baja solo si hay datos reales (no pesa en la portada de la demo).
import type { DirectoryAccount, LineId, User } from '../data/types';
import { getCoreRepo, getLineRepo } from '../data';
import { DEFAULT_ECOSYSTEM_NAME, SEED_VERSION } from '../seed/version';
import { emitAll } from './bus';
import { seedInWorker } from './session';

/** La cuenta de Administración de una línea con datos reales, para «Entrar como…». */
export function realAdminAccount(line: LineId, admin: Pick<User, 'id' | 'name'>): DirectoryAccount {
  return {
    id: `${line}:admin`,
    role: 'admin',
    line,
    userId: admin.id,
    name: admin.name,
    label: `Administración de ${line === 'tabaco' ? 'Tabaco' : 'Café'}`,
    primary: true,
  };
}

export async function syncRealLines(real: readonly LineId[], reseed: LineId[], now: Date, name?: string): Promise<void> {
  if (reseed.length) await seedDemoLines(reseed, now, name);
  if (await keepRealLines(real, now)) emitAll();
}

/** Recarga los datos de ejemplo de algunas líneas (en un Web Worker si se puede). */
async function seedDemoLines(lines: LineId[], now: Date, keepName?: string): Promise<void> {
  const name = keepName ?? DEFAULT_ECOSYSTEM_NAME;
  if (typeof window !== 'undefined' && typeof Worker === 'function') {
    try {
      await seedInWorker(now, name, lines);
      emitAll();
      return;
    } catch (e) {
      console.warn('La semilla en segundo plano falló; se carga en la página.', e);
    }
  }
  const { seedLines } = await import('../seed');
  await seedLines(getCoreRepo(), { tabaco: getLineRepo('tabaco'), cafe: getLineRepo('cafe') }, lines, now, name);
  emitAll();
}

/**
 * Las líneas reales conservan sus cuentas: se quitan del directorio las que apuntan a usuarios
 * que ya no existen y, si falta, se vuelve a poner la de Administración. También se asegura que
 * existan la sesión y los ajustes del ecosistema. Devuelve true si cambió algo.
 */
async function keepRealLines(real: readonly LineId[], now: Date): Promise<boolean> {
  const core = getCoreRepo();
  const [directory, settings, session] = await Promise.all([core.directory.all(), core.settings.get('ecosystem'), core.session.get('session')]);
  let changed = false;
  if (!directory.some((a) => a.id === 'direccion')) {
    const { DIRECCION_ACCOUNT } = await import('../seed');
    await core.directory.put(DIRECCION_ACCOUNT);
    changed = true;
  }
  for (const line of real) {
    const users = await getLineRepo(line).users.all();
    const byId = new Map(users.map((u) => [u.id, u]));
    const mine = directory.filter((a) => a.line === line);
    for (const acc of mine) {
      if (!byId.get(acc.userId)?.active) {
        await core.directory.remove(acc.id);
        changed = true;
      }
    }
    const hasAdmin = mine.some((a) => a.role === 'admin' && byId.get(a.userId)?.active);
    const admin = users.find((u) => u.role === 'admin' && u.active);
    if (!hasAdmin && admin) {
      await core.directory.put(realAdminAccount(line, admin));
      changed = true;
    }
  }
  if (!settings || settings.seedVersion !== SEED_VERSION) {
    await core.settings.put({
      id: 'ecosystem',
      name: settings?.name ?? DEFAULT_ECOSYSTEM_NAME,
      theme: settings?.theme ?? 'dark',
      seededAt: settings?.seededAt ?? now.toISOString(),
      seedVersion: SEED_VERSION,
    });
    changed = true;
  }
  if (!session) {
    await core.session.put({ id: 'session', accountId: null, viewAsAccountId: null, directorLine: null });
    changed = true;
  }
  return changed;
}
