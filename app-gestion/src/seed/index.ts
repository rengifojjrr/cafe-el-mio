// Carga los datos de ejemplo de las dos líneas y el directorio común de cuentas.
import type { DirectoryAccount, EcosystemSettings, LineId, Store, User } from '../data/types';
import type { CoreRepo, LineRepo } from '../data/repo';
import { CAFE_SEED } from './cafe';
import { type LineSeedDef, type SeedTables, simulateLine } from './engine';
import { addFirmSales } from './r3-ventas';
import { TABACO_SEED } from './tabaco';

import { DEFAULT_ECOSYSTEM_NAME, SEED_VERSION } from './version';

export { DEFAULT_ECOSYSTEM_NAME, SEED_VERSION };

export const SEEDS: Record<LineId, LineSeedDef> = { tabaco: TABACO_SEED, cafe: CAFE_SEED };

export function buildLine(line: LineId, now: Date): SeedTables {
  let tables = simulateLine(SEEDS[line], now);
  // Ronda 3 · venta en firme y precios: listas de precios, locales en firme y su historia.
  tables = addFirmSales(line, tables, now);
  return tables;
}

/** Las cuentas principales de «Entrar como…»: una por rol de cada línea, más Dirección. */
export function primaryAccounts(tables: Record<LineId, SeedTables>): DirectoryAccount[] {
  const out: DirectoryAccount[] = [
    { id: 'direccion', role: 'direccion', line: null, userId: 'direccion', name: 'Socios del grupo', label: 'Dirección', primary: true },
  ];
  for (const line of ['tabaco', 'cafe'] as const) {
    const def = SEEDS[line];
    const users = tables[line].users as User[];
    const stores = tables[line].stores as Store[];
    const adminName = def.users.find((u) => u.key === def.primary.admin)!.name;
    const sellerName = def.users.find((u) => u.key === def.primary.seller)!.name;
    const admin = users.find((u) => u.role === 'admin' && u.name === adminName)!;
    const seller = users.find((u) => u.role === 'seller' && u.name === sellerName)!;
    const storeName = def.stores.find((s) => s.key === def.primary.store)!.name;
    const store = stores.find((s) => s.name === storeName)!;
    const storeUser = users.find((u) => u.storeId === store.id)!;
    const lineName = line === 'tabaco' ? 'Tabaco' : 'Café';
    out.push(
      { id: `${line}:admin`, role: 'admin', line, userId: admin.id, name: admin.name, label: `Administración de ${lineName}`, primary: true },
      { id: `${line}:seller`, role: 'seller', line, userId: seller.id, name: seller.name, label: `Vendedor de ${lineName}`, primary: true },
      { id: `${line}:store`, role: 'store', line, userId: storeUser.id, storeId: store.id, name: storeUser.name, label: `Local · ${store.name}`, primary: true },
    );
  }
  return out;
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
