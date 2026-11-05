// Implementación `local` de los repositorios: una base IndexedDB por línea
// (eco-tabaco, eco-cafe) y una común (eco-core). Lo de una línea nunca se escribe en la otra.
import Dexie, { type Table as DexieTable } from 'dexie';
import type { AuditEntry, Entity, LineId } from '../types';
import type { AppendOnlyLog, CoreRepo, LineRepo, Table } from '../repo';
import { CORE_TABLES, LINE_TABLES } from '../repo';

/** Esquema de la versión 1 (no se toca: los navegadores que ya tienen datos suben a la 2). */
const LINE_SCHEMA: Record<Exclude<(typeof LINE_TABLES)[number], 'templates'>, string> = {
  products: 'id, sku',
  photos: 'id, ownerId',
  warehouses: 'id',
  lots: 'id, productId, arrivalId',
  arrivals: 'id, status',
  movements: 'id, productId, storeId, at, type',
  stores: 'id, sellerId, status, zoneId',
  contracts: 'id, storeId',
  deliveries: 'id, storeId, sellerId, status',
  visits: 'id, storeId, sellerId, at',
  salesReports: 'id, storeId, sellerId, at, settlementId',
  returns: 'id, storeId',
  reorders: 'id, storeId, sellerId, status',
  unmetDemand: 'id, productId, storeId',
  settlements: 'id, storeId, status',
  payments: 'id, settlementId, storeId',
  commissions: 'id, sellerId, storeId, status, salesReportId, settlementId',
  payouts: 'id, sellerId',
  threads: 'id, kind, storeId',
  messages: 'id, threadId, at',
  announcements: 'id, at',
  notifications: 'id, userId, at',
  users: 'id, role, storeId',
  zones: 'id',
  settings: 'id',
  audit: '++seq, id, at, actorId',
};

const CORE_SCHEMA: Record<(typeof CORE_TABLES)[number], string> = {
  session: 'id',
  settings: 'id',
  directory: 'id, line, role',
};

class DexieTableAdapter<T extends Entity> implements Table<T> {
  constructor(private readonly t: DexieTable<T, string>) {}
  get(id: string) {
    return this.t.get(id);
  }
  all() {
    return this.t.toArray();
  }
  where(index: string, value: string | number) {
    return this.t.where(index).equals(value).toArray();
  }
  async put(item: T) {
    await this.t.put(item);
  }
  async bulkPut(items: T[]) {
    await this.t.bulkPut(items);
  }
  async remove(id: string) {
    await this.t.delete(id);
  }
  count() {
    return this.t.count();
  }
}

class AuditAdapter implements AppendOnlyLog<AuditEntry> {
  constructor(private readonly t: DexieTable<AuditEntry, number>) {}
  async append(entry: AuditEntry) {
    const { seq: _ignored, ...rest } = entry;
    await this.t.add(rest as AuditEntry);
  }
  async bulkAppend(entries: AuditEntry[]) {
    await this.t.bulkAdd(entries.map(({ seq: _ignored, ...rest }) => rest as AuditEntry));
  }
  all() {
    return this.t.orderBy('seq').toArray();
  }
  count() {
    return this.t.count();
  }
}

/**
 * Todo o nada. Si ya hay una transacción abierta (un servicio que usa a otro), se reutiliza:
 * IndexedDB cierra antes de tiempo una transacción anidada. La función se envuelve en un
 * `async` para que Dexie mantenga viva la transacción a través de cada `await`.
 */
function runInTransaction<R>(db: Dexie, fn: () => Promise<R>): Promise<R> {
  if (Dexie.currentTransaction) return fn();
  return db.transaction('rw', db.tables, async () => await fn());
}

export function lineDbName(line: LineId, prefix = ''): string {
  return `${prefix}eco-${line}`;
}

export function openLineRepo(line: LineId, prefix = ''): LineRepo {
  const db = new Dexie(lineDbName(line, prefix));
  db.version(1).stores(LINE_SCHEMA);
  // Versión 2: plantillas PDF. Dexie conserva las tablas de la versión 1 con sus datos.
  db.version(2).stores({ templates: 'id, kind' });
  const table = <T extends Entity>(name: string) => new DexieTableAdapter<T>(db.table(name));
  return {
    line,
    products: table('products'),
    photos: table('photos'),
    warehouses: table('warehouses'),
    lots: table('lots'),
    arrivals: table('arrivals'),
    movements: table('movements'),
    stores: table('stores'),
    contracts: table('contracts'),
    deliveries: table('deliveries'),
    visits: table('visits'),
    salesReports: table('salesReports'),
    returns: table('returns'),
    reorders: table('reorders'),
    unmetDemand: table('unmetDemand'),
    settlements: table('settlements'),
    payments: table('payments'),
    commissions: table('commissions'),
    payouts: table('payouts'),
    threads: table('threads'),
    messages: table('messages'),
    announcements: table('announcements'),
    notifications: table('notifications'),
    users: table('users'),
    zones: table('zones'),
    settings: table('settings'),
    templates: table('templates'),
    audit: new AuditAdapter(db.table('audit')),
    transaction: (fn) => runInTransaction(db, fn),
    clearAll: async () => {
      await db.transaction('rw', db.tables, async () => {
        await Promise.all(db.tables.map((t) => t.clear()));
      });
    },
    dump: async () => {
      const out: Record<string, unknown[]> = {};
      for (const name of LINE_TABLES) out[name] = await db.table(name).toArray();
      return out;
    },
    load: async (data) => {
      await db.transaction('rw', db.tables, async () => {
        for (const name of LINE_TABLES) {
          await db.table(name).clear();
          const rows = data[name];
          if (Array.isArray(rows) && rows.length) await db.table(name).bulkPut(rows);
        }
      });
    },
  };
}

export function openCoreRepo(prefix = ''): CoreRepo {
  const db = new Dexie(`${prefix}eco-core`);
  db.version(1).stores(CORE_SCHEMA);
  const table = <T extends Entity>(name: string) => new DexieTableAdapter<T>(db.table(name));
  return {
    session: table('session'),
    settings: table('settings'),
    directory: table('directory'),
    transaction: (fn) => runInTransaction(db, fn),
    clearAll: async () => {
      await db.transaction('rw', db.tables, async () => {
        await Promise.all(db.tables.map((t) => t.clear()));
      });
    },
    dump: async () => {
      const out: Record<string, unknown[]> = {};
      for (const name of CORE_TABLES) out[name] = await db.table(name).toArray();
      return out;
    },
    load: async (data) => {
      await db.transaction('rw', db.tables, async () => {
        for (const name of CORE_TABLES) {
          await db.table(name).clear();
          const rows = data[name];
          if (Array.isArray(rows) && rows.length) await db.table(name).bulkPut(rows);
        }
      });
    },
  };
}
