// Carga los datos de ejemplo de las dos líneas y el directorio común de cuentas.
import type { DirectoryAccount, EcosystemSettings, LineId, Store, User } from '../data/types';
import type { CoreRepo, LineRepo } from '../data/repo';
import { CAFE_SEED } from './cafe';
import { type LineSeedDef, type SeedTables, simulateLine } from './engine';
import { applyRonda3Red } from './r3-red';
import { addR3Almacen } from './r3-almacen';
import { TABACO_SEED } from './tabaco';

import { DEFAULT_ECOSYSTEM_NAME, SEED_VERSION } from './version';

export { DEFAULT_ECOSYSTEM_NAME, SEED_VERSION };

export const SEEDS: Record<LineId, LineSeedDef> = { tabaco: TABACO_SEED, cafe: CAFE_SEED };

export function buildLine(line: LineId, now: Date): SeedTables {
  const tables = simulateLine(SEEDS[line], now);
  // Ronda 3 · mercados, datos fiscales, comisión progresiva, repartos e invitaciones.
  const red = applyRonda3Red(SEEDS[line], tables, now);
  // Ronda 3 · almacén: importaciones con lista de empaque (bultos) y cajas con trazabilidad.
  return addR3Almacen(line, red, now);
}

/** La cuenta de Dirección (no es de ninguna línea). */
export const DIRECCION_ACCOUNT: DirectoryAccount = {
  id: 'direccion',
  role: 'direccion',
  line: null,
  userId: 'direccion',
  name: 'Socios del grupo',
  label: 'Dirección',
  primary: true,
};

/** Las cuentas principales de una línea: Administración, un vendedor y un local. */
export function lineAccounts(line: LineId, tables: SeedTables): DirectoryAccount[] {
  const def = SEEDS[line];
  const users = tables.users as User[];
  const stores = tables.stores as Store[];
  const adminName = def.users.find((u) => u.key === def.primary.admin)!.name;
  const sellerName = def.users.find((u) => u.key === def.primary.seller)!.name;
  const admin = users.find((u) => u.role === 'admin' && u.name === adminName)!;
  const seller = users.find((u) => u.role === 'seller' && u.name === sellerName)!;
  const storeName = def.stores.find((s) => s.key === def.primary.store)!.name;
  const store = stores.find((s) => s.name === storeName)!;
  const storeUser = users.find((u) => u.storeId === store.id)!;
  const lineName = line === 'tabaco' ? 'Tabaco' : 'Café';
  return [
    { id: `${line}:admin`, role: 'admin', line, userId: admin.id, name: admin.name, label: `Administración de ${lineName}`, primary: true },
    { id: `${line}:seller`, role: 'seller', line, userId: seller.id, name: seller.name, label: `Vendedor de ${lineName}`, primary: true },
    { id: `${line}:store`, role: 'store', line, userId: storeUser.id, storeId: store.id, name: storeUser.name, label: `Local · ${store.name}`, primary: true },
  ];
}

/** Las cuentas principales de «Entrar como…»: una por rol de cada línea, más Dirección. */
export function primaryAccounts(tables: Record<LineId, SeedTables>): DirectoryAccount[] {
  return [DIRECCION_ACCOUNT, ...lineAccounts('tabaco', tables.tabaco), ...lineAccounts('cafe', tables.cafe)];
}

export async function seedEverything(core: CoreRepo, repos: Record<LineId, LineRepo>, now: Date, name = DEFAULT_ECOSYSTEM_NAME): Promise<void> {
  const tables: Record<LineId, SeedTables> = { tabaco: buildLine('tabaco', now), cafe: buildLine('cafe', now) };
  await repos.tabaco.load(tables.tabaco);
  await repos.cafe.load(tables.cafe);
  const settings: EcosystemSettings = { id: 'ecosystem', name, theme: 'dark', seededAt: now.toISOString(), seedVersion: SEED_VERSION };
  await core.load({
    session: [{ id: 'session', accountId: null, viewAsAccountId: null, directorLine: null }],
    settings: [settings],
    directory: primaryAccounts(tables),
  });
}

/**
 * Vuelve a cargar los datos de ejemplo SOLO de estas líneas. Las otras (las que tienen datos
 * reales) no se tocan y conservan sus cuentas de «Entrar como…». La sesión también se conserva.
 */
export async function seedLines(core: CoreRepo, repos: Record<LineId, LineRepo>, lines: readonly LineId[], now: Date, name?: string): Promise<void> {
  const [prevDirectory, prevSettings, session] = await Promise.all([core.directory.all(), core.settings.get('ecosystem'), core.session.get('session')]);
  const fresh: DirectoryAccount[] = [];
  for (const line of lines) {
    const tables = buildLine(line, now);
    await repos[line].load(tables);
    fresh.push(...lineAccounts(line, tables));
  }
  const kept = prevDirectory.filter((a) => a.line !== null && !lines.includes(a.line));
  const settings: EcosystemSettings = {
    id: 'ecosystem',
    name: name ?? prevSettings?.name ?? DEFAULT_ECOSYSTEM_NAME,
    theme: prevSettings?.theme ?? 'dark',
    seededAt: now.toISOString(),
    seedVersion: SEED_VERSION,
  };
  await core.load({
    session: [session ?? { id: 'session', accountId: null, viewAsAccountId: null, directorLine: null }],
    settings: [settings],
    directory: [DIRECCION_ACCOUNT, ...kept, ...fresh],
  });
}
