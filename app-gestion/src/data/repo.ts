// Interfaces de repositorio. Las pantallas nunca las tocan: solo la capa de servicios.
// Hoy hay una implementación `local` (Dexie / IndexedDB). Ver docs/SUPABASE.md para
// la implementación `supabase` que la reemplaza sin rehacer pantallas.
import type {
  Announcement,
  AppNotification,
  Arrival,
  AuditEntry,
  Commission,
  CommissionPayout,
  Contract,
  Delivery,
  DirectoryAccount,
  EcosystemSettings,
  Entity,
  LineId,
  LineSettings,
  Lot,
  Message,
  Movement,
  Payment,
  Photo,
  Product,
  Reorder,
  ReturnRecord,
  SalesReport,
  SessionState,
  Settlement,
  Store,
  Thread,
  UnmetDemand,
  User,
  Visit,
  Warehouse,
  Zone,
} from './types';

export interface Table<T extends Entity> {
  get(id: string): Promise<T | undefined>;
  all(): Promise<T[]>;
  /** Busca por un campo indexado. */
  where(index: string, value: string | number): Promise<T[]>;
  put(item: T): Promise<void>;
  bulkPut(items: T[]): Promise<void>;
  remove(id: string): Promise<void>;
  count(): Promise<number>;
}

/** Auditoría: solo se le agrega. No hay ni actualizar ni borrar. */
export interface AppendOnlyLog<T> {
  append(entry: T): Promise<void>;
  bulkAppend(entries: T[]): Promise<void>;
  all(): Promise<T[]>;
  count(): Promise<number>;
}

export interface LineRepo {
  readonly line: LineId;
  readonly products: Table<Product>;
  readonly photos: Table<Photo>;
  readonly warehouses: Table<Warehouse>;
  readonly lots: Table<Lot>;
  readonly arrivals: Table<Arrival>;
  readonly movements: Table<Movement>;
  readonly stores: Table<Store>;
  readonly contracts: Table<Contract>;
  readonly deliveries: Table<Delivery>;
  readonly visits: Table<Visit>;
  readonly salesReports: Table<SalesReport>;
  readonly returns: Table<ReturnRecord>;
  readonly reorders: Table<Reorder>;
  readonly unmetDemand: Table<UnmetDemand>;
  readonly settlements: Table<Settlement>;
  readonly payments: Table<Payment>;
  readonly commissions: Table<Commission>;
  readonly payouts: Table<CommissionPayout>;
  readonly threads: Table<Thread>;
  readonly messages: Table<Message>;
  readonly announcements: Table<Announcement>;
  readonly notifications: Table<AppNotification>;
  readonly users: Table<User>;
  readonly zones: Table<Zone>;
  readonly settings: Table<LineSettings>;
  readonly audit: AppendOnlyLog<AuditEntry>;
  /** Todo o nada: si algo falla adentro, no queda nada a medias. */
  transaction<R>(fn: () => Promise<R>): Promise<R>;
  /** Vacía la base (para «Restablecer demo» e «Importar»). */
  clearAll(): Promise<void>;
  /** Volcado completo, para exportar. */
  dump(): Promise<Record<string, unknown[]>>;
  /** Carga un volcado (reemplaza todo). */
  load(data: Record<string, unknown[]>): Promise<void>;
}

export interface CoreRepo {
  readonly session: Table<SessionState>;
  readonly settings: Table<EcosystemSettings>;
  readonly directory: Table<DirectoryAccount>;
  transaction<R>(fn: () => Promise<R>): Promise<R>;
  clearAll(): Promise<void>;
  dump(): Promise<Record<string, unknown[]>>;
  load(data: Record<string, unknown[]>): Promise<void>;
}

export const LINE_TABLES = [
  'products',
  'photos',
  'warehouses',
  'lots',
  'arrivals',
  'movements',
  'stores',
  'contracts',
  'deliveries',
  'visits',
  'salesReports',
  'returns',
  'reorders',
  'unmetDemand',
  'settlements',
  'payments',
  'commissions',
  'payouts',
  'threads',
  'messages',
  'announcements',
  'notifications',
  'users',
  'zones',
  'settings',
  'audit',
] as const;

export const CORE_TABLES = ['session', 'settings', 'directory'] as const;
