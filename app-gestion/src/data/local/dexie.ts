// Implementación `local` de los repositorios: la base IndexedDB de la línea («tabaco-datos») y la del
// programa («tabaco-cuentas»). Lo de una línea nunca se escribe en otra.
//
// Con el servidor conectado, cada cambio de la línea deja además su clave («tabla/id») en la tabla
// `pendientes`, en el mismo todo-o-nada que el cambio: así nada se escapa de la subida, aunque el
// teléfono se apague en el medio. La sincronización (src/servidor) sube lo que está ahí.
import Dexie, { type Table as DexieTable } from 'dexie';
import { DB_NAMESPACE, PROGRAM_LINE } from '../../lines/programa';
import type { AuditEntry, Entity, LineId } from '../types';
import type { AppendOnlyLog, CoreRepo, LineRepo, Table } from '../repo';
import { CORE_TABLES, LINE_TABLES } from '../repo';

/** Esquema de la versión 1 (no se toca: los navegadores que ya tienen datos suben a la 2). */
type V1Table = Exclude<(typeof LINE_TABLES)[number], 'templates' | 'priceLists' | 'invoices' | 'cases' | 'routes' | 'invitations'>;
const LINE_SCHEMA: Record<V1Table, string> = {
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

// ---------- Cambios pendientes de subir al servidor ----------

/** La tabla de la base de la línea con las claves («tabla/id») de lo que falta subir. */
export const PENDIENTES = 'pendientes';

export interface Pendiente {
  seq?: number;
  /** «tabla/id» del registro que cambió (se sube como esté en ese momento: guardado o borrado). */
  clave: string;
}

let anotar = false;
const oyentes = new Set<() => void>();

/** Solo con el servidor conectado se anotan los cambios (las pruebas y la demo no anotan nada). */
export function anotarCambios(on: boolean): void {
  anotar = on;
}

export function anotandoCambios(): boolean {
  return anotar;
}

/** Avisa cada vez que se anota algo (la sincronización espera un momento y sube). */
export function alAnotarCambios(fn: () => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

export function clave(tabla: string, id: string): string {
  return `${tabla}/${id}`;
}

async function anotarClaves(db: Dexie, claves: string[]): Promise<void> {
  if (!claves.length) return;
  await db.table(PENDIENTES).bulkAdd(claves.map((c) => ({ clave: c })));
  for (const fn of oyentes) fn();
}

/** El cambio y su anotación van juntos: si uno falla, no queda ninguno. */
function conAnotacion<R>(db: Dexie, tabla: string, fn: () => Promise<R>): Promise<R> {
  const tx = Dexie.currentTransaction;
  if (tx && tx.db === db && tx.storeNames.includes(PENDIENTES)) return fn();
  return db.transaction('rw', [tabla, PENDIENTES], async () => await fn());
}

/** Las claves de todo lo que hay en la línea (para anotar un vaciado o una carga completa). */
async function todasLasClaves(db: Dexie): Promise<string[]> {
  const out: string[] = [];
  for (const name of LINE_TABLES) {
    const keys = name === 'audit' ? await db.table(name).orderBy('id').keys() : await db.table(name).toCollection().primaryKeys();
    for (const k of keys) out.push(clave(name, String(k)));
  }
  return out;
}

class DexieTableAdapter<T extends Entity> implements Table<T> {
  /** `sube`: los cambios de esta tabla se anotan para el servidor (las de la línea, no las del programa). */
  constructor(
    private readonly t: DexieTable<T, string>,
    private readonly sube = false,
  ) {}
  get(id: string) {
    return this.t.get(id);
  }
  all() {
    return this.t.toArray();
  }
  where(index: string, value: string | number) {
    return this.t.where(index).equals(value).toArray();
  }
  private conCola(ids: string[], fn: () => Promise<unknown>): Promise<void> {
    if (!this.sube || !anotar) return fn().then(() => undefined);
    const db = this.t.db;
    return conAnotacion(db, this.t.name, async () => {
      await fn();
      await anotarClaves(
        db,
        ids.map((id) => clave(this.t.name, id)),
      );
    });
  }
  async put(item: T) {
    await this.conCola([item.id], () => this.t.put(item));
  }
  async bulkPut(items: T[]) {
    await this.conCola(
      items.map((i) => i.id),
      () => this.t.bulkPut(items),
    );
  }
  async remove(id: string) {
    await this.conCola([id], () => this.t.delete(id));
  }
  count() {
    return this.t.count();
  }
}

class AuditAdapter implements AppendOnlyLog<AuditEntry> {
  constructor(private readonly t: DexieTable<AuditEntry, number>) {}
  private conCola(ids: string[], fn: () => Promise<unknown>): Promise<void> {
    if (!anotar) return fn().then(() => undefined);
    const db = this.t.db;
    return conAnotacion(db, this.t.name, async () => {
      await fn();
      await anotarClaves(
        db,
        ids.map((id) => clave('audit', id)),
      );
    });
  }
  async append(entry: AuditEntry) {
    const { seq: _ignored, ...rest } = entry;
    await this.conCola([entry.id], () => this.t.add(rest as AuditEntry));
  }
  async bulkAppend(entries: AuditEntry[]) {
    await this.conCola(
      entries.map((e) => e.id),
      () => this.t.bulkAdd(entries.map(({ seq: _ignored, ...rest }) => rest as AuditEntry)),
    );
  }
  all() {
    return this.t.orderBy('seq').toArray();
  }
  count() {
    return this.t.count();
  }
}

/** La base Dexie detrás de un repositorio de línea (solo para la sincronización). */
const bases = new WeakMap<object, Dexie>();
export function dexieDe(repo: LineRepo): Dexie {
  const db = bases.get(repo);
  if (!db) throw new Error('Ese repositorio no es de la base local.');
  return db;
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

/**
 * Bases de datos de este programa: «tabaco-datos» (la línea) y «tabaco-cuentas» (sesión, «Entrar
 * como…» y ajustes del programa). Antes se llamaban «eco-tabaco», «eco-cafe» y «eco-core» (las dos
 * líneas juntas); con nombres nuevos, el programa de Tabaco arranca en cero en cualquier navegador.
 * Las pruebas del motor, que usan las dos líneas, guardan la otra en «tabaco-datos-cafe».
 */
export function lineDbName(line: LineId, prefix = ''): string {
  return line === PROGRAM_LINE ? `${prefix}${DB_NAMESPACE}-datos` : `${prefix}${DB_NAMESPACE}-datos-${line}`;
}

export function coreDbName(prefix = ''): string {
  return `${prefix}${DB_NAMESPACE}-cuentas`;
}

export function openLineRepo(line: LineId, prefix = ''): LineRepo {
  const db = new Dexie(lineDbName(line, prefix));
  db.version(1).stores(LINE_SCHEMA);
  // Versión 2: plantillas PDF. Dexie conserva las tablas de la versión 1 con sus datos.
  db.version(2).stores({ templates: 'id, kind' });
  // Versión 3 (ronda 3): índices para buscar por código de barras y por familia, pagos de facturas,
  // y las tablas de listas de precios, facturas en firme, cajas con trazabilidad, repartos e invitaciones.
  db.version(3).stores({
    products: 'id, sku, barcode, familyId',
    payments: 'id, settlementId, storeId, invoiceId',
    priceLists: 'id',
    invoices: 'id, storeId, sellerId, status',
    cases: 'id, code, productId, arrivalId, deliveryId',
    routes: 'id, date, status',
    invitations: 'id, accountId',
  });
  // Versión 4: lo que falta subir al servidor (solo se usa con el servidor conectado).
  db.version(4).stores({ [PENDIENTES]: '++seq, clave' });
  const table = <T extends Entity>(name: string) => new DexieTableAdapter<T>(db.table(name), true);
  const datos = () => db.tables.filter((t) => t.name !== PENDIENTES);
  const repo: LineRepo = {
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
    priceLists: table('priceLists'),
    invoices: table('invoices'),
    cases: table('cases'),
    routes: table('routes'),
    invitations: table('invitations'),
    audit: new AuditAdapter(db.table('audit')),
    transaction: (fn) => runInTransaction(db, fn),
    clearAll: async () => {
      await db.transaction('rw', db.tables, async () => {
        // Con el servidor conectado, vaciar también se sube (cada registro, como borrado).
        const antes = anotar ? await todasLasClaves(db) : [];
        await Promise.all(datos().map((t) => t.clear()));
        await anotarClaves(db, antes);
      });
    },
    dump: async () => {
      const out: Record<string, unknown[]> = {};
      for (const name of LINE_TABLES) out[name] = await db.table(name).toArray();
      return out;
    },
    load: async (data) => {
      await db.transaction('rw', db.tables, async () => {
        const antes = anotar ? await todasLasClaves(db) : [];
        for (const name of LINE_TABLES) {
          await db.table(name).clear();
          const rows = data[name];
          if (Array.isArray(rows) && rows.length) await db.table(name).bulkPut(rows);
        }
        if (anotar) {
          const despues = LINE_TABLES.flatMap((name) => (Array.isArray(data[name]) ? data[name] : []).map((r) => clave(name, String((r as { id?: unknown }).id))));
          await anotarClaves(db, [...new Set([...antes, ...despues])]);
        }
      });
    },
  };
  bases.set(repo, db);
  return repo;
}

export function openCoreRepo(prefix = ''): CoreRepo {
  const db = new Dexie(coreDbName(prefix));
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
