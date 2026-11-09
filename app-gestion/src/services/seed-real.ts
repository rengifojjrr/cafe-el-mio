// El arranque de las líneas. Lo normal: toda línea que no tiene datos reales se vacía y queda en
// blanco, ya como datos reales (sin nada inventado; en Café, los 9 cafés de El Mío sin precio).
// Las líneas reales NUNCA se borran ni se vuelven a sembrar y conservan sus cuentas de «Entrar
// como…». Solo las pruebas automáticas (re)cargan datos de ejemplo.
import type { DirectoryAccount, LineId, User } from '../data/types';
import { programLines } from '../lines/programa';
import { getCoreRepo, getLineRepo } from '../data';
import { DEFAULT_ECOSYSTEM_NAME, SEED_VERSION } from '../seed/version';
import { emitAll } from './bus';
import { findAccount, seedInWorker } from './session';

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

/**
 * Deja en blanco las líneas que no son reales (un navegador nuevo, o uno con la demo de antes) y
 * cuida las reales. Lo de ejemplo de esas líneas se borra entero; la otra línea no se toca.
 */
export async function startLinesBlank(blank: readonly LineId[], real: readonly LineId[], now: Date, name?: string): Promise<void> {
  if (blank.length) await blankLines(blank, now, name);
  if ((await keepRealLines([...real, ...blank], now, name)) || blank.length) emitAll();
}

async function blankLines(lines: readonly LineId[], now: Date, name?: string): Promise<void> {
  const { buildBlankLine } = await import('../seed/blank');
  const admins = new Map<LineId, User>();
  for (const line of lines) {
    const tables = buildBlankLine(line, now);
    // `load` vacía cada tabla de la línea y deja solo esto (todo o nada).
    await getLineRepo(line).load(tables);
    admins.set(line, (tables.users as User[])[0]!);
  }
  const core = getCoreRepo();
  await core.transaction(async () => {
    // «Entrar como…»: de esas líneas queda solo su Administración.
    for (const acc of await core.directory.all()) {
      if (acc.line !== null && lines.includes(acc.line)) await core.directory.remove(acc.id);
    }
    for (const [line, admin] of admins) await core.directory.put(realAdminAccount(line, admin));
    const eco = await core.settings.get('ecosystem');
    await core.settings.put({
      id: 'ecosystem',
      name: name ?? eco?.name ?? DEFAULT_ECOSYSTEM_NAME,
      theme: eco?.theme ?? 'dark',
      seededAt: now.toISOString(),
      seedVersion: SEED_VERSION,
    });
  });
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
  await seedLines(getCoreRepo(), Object.fromEntries(lines.map((l) => [l, getLineRepo(l)])), lines, now, name);
  emitAll();
}

/**
 * Las líneas reales conservan sus cuentas: se quitan del directorio las que apuntan a usuarios
 * que ya no existen y, si falta, se vuelve a poner la de Administración. También se asegura que
 * existan la sesión y los ajustes del ecosistema. Devuelve true si cambió algo.
 */
async function keepRealLines(real: readonly LineId[], now: Date, name?: string): Promise<boolean> {
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
      name: settings?.name ?? name ?? DEFAULT_ECOSYSTEM_NAME,
      theme: settings?.theme ?? 'dark',
      seededAt: settings?.seededAt ?? now.toISOString(),
      seedVersion: SEED_VERSION,
    });
    changed = true;
  }
  if (!session) {
    await core.session.put({ id: 'session', accountId: null, viewAsAccountId: null, directorLine: null });
    changed = true;
  } else if (real.length === programLines().length) {
    // Si la cuenta con la que se entró (o la que se miraba) ya no existe, se vuelve a la portada.
    const gone = async (id: string | null) => id !== null && !(await findAccount(id));
    if ((await gone(session.accountId)) || (await gone(session.viewAsAccountId))) {
      await core.session.put({ id: 'session', accountId: null, viewAsAccountId: null, directorLine: null });
      changed = true;
    }
  }
  return changed;
}
