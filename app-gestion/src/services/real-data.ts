// Datos reales de la empresa: «Empezar en blanco», la copia de seguridad de cada línea
// (exportar e importar un JSON solo con lo de esa línea) y el aviso de copia pendiente.
// Todo vive en este navegador: la copia es lo único que lo protege de un borrado.
import { z } from 'zod';
import type { AuditEntry, ContractTemplate, DirectoryAccount, LineId, LineSettings, Photo, Product, User } from '../data/types';
import { getCoreRepo } from '../data';
import { LINE_TABLES } from '../data/repo';
import { isCubanOrigin } from '../domain/compliance';
import { normalize } from '../domain/products';
import { daysBetween, fmtDate, toIsoDate } from '../lib/time';
import { emitAll } from './bus';
import { type Ctx, NotFoundError, ValidationError, audit, getSettings, guard, mutate, nowIso } from './context';
import { type DataMode, blobToDataUrl, dataUrlToBlob, realAdminAccount } from './session';

const BACKUP_APP = 'grupo-miami-ecosistema';
const BACKUP_KIND = 'linea';
const BACKUP_VERSION = 1;

/** Nombre de la única cuenta que queda al empezar en blanco (se puede cambiar en Usuarios). */
export const BLANK_ADMIN_NAME = 'Administración';

/** Días sin exportar a partir de los cuales se avisa. */
export const BACKUP_EVERY_DAYS = 7;

const LINE_NAME: Record<LineId, string> = { tabaco: 'Tabaco', cafe: 'Café' };

// ---------- Empezar en blanco ----------

/**
 * Vacía la línea para cargar los datos reales de la empresa. Quedan los ajustes (marcados como
 * datos reales), el almacén, las zonas y UNA cuenta de Administración (la de quien lo hace,
 * renombrada «Administración»). La auditoría de la línea también se vacía y empieza con
 * «Empezó en blanco con datos reales». La otra línea no se toca.
 */
export async function startBlank(ctx: Ctx, confirmation: string): Promise<void> {
  guard(ctx, 'data.reset');
  if (normalize(confirmation) !== normalize(ctx.config.name)) {
    throw new ValidationError(`Para confirmar, escribe «${ctx.config.name}».`);
  }
  const repo = ctx.repo;
  const [settings, warehouse, users, zones] = await Promise.all([getSettings(ctx), repo.warehouses.get('almacen'), repo.users.all(), repo.zones.all()]);
  if (!warehouse) throw new NotFoundError('el almacén');
  const me = users.find((u) => u.id === ctx.actor.userId && u.role === 'admin') ?? users.find((u) => u.role === 'admin');
  if (!me) throw new NotFoundError('la cuenta de Administración');
  const admin: User = { id: me.id, role: 'admin', name: BLANK_ADMIN_NAME, email: '', phone: '', active: true, createdAt: me.createdAt };
  // Las listas de precios se vacían: la lista por defecto ya no existe. La copia empieza de cero.
  const { lastExportAt: _lastExport, defaultPriceListId: _priceList, ...rest } = settings;
  const nextSettings: LineSettings = { ...rest, dataMode: 'real' };
  const first: AuditEntry = {
    id: ctx.newId('aud'),
    at: nowIso(ctx),
    actorId: admin.id,
    actorName: admin.name,
    role: 'admin',
    action: 'datos.empezar_en_blanco',
    entity: 'settings',
    entityId: 'settings',
    summary: 'Empezó en blanco con datos reales',
  };
  // Todo o nada: `load` vacía cada tabla de la línea y deja solo esto.
  await repo.load({ settings: [nextSettings], warehouses: [warehouse], users: [admin], zones, audit: [first] });
  // En «Entrar como…» esta línea queda solo con su cuenta de Administración.
  const core = getCoreRepo();
  await core.transaction(async () => {
    for (const acc of await core.directory.all()) {
      if (acc.line === ctx.line) await core.directory.remove(acc.id);
    }
    await core.directory.put(realAdminAccount(ctx.line, admin));
  });
  emitAll();
}

// ---------- Copia de seguridad ----------

export interface BackupStatus {
  mode: DataMode;
  lastExportAt?: string;
  /** Días desde la última copia (null si nunca se exportó). */
  daysSince: number | null;
  /** Hay que avisar: datos reales y 7 días o más sin copia (o nunca, si ya hay algo cargado). */
  due: boolean;
}

export async function backupStatus(ctx: Ctx): Promise<BackupStatus> {
  guard(ctx, 'settings.read');
  const s = await getSettings(ctx);
  const mode: DataMode = s.dataMode === 'real' ? 'real' : 'demo';
  const daysSince = s.lastExportAt ? daysBetween(s.lastExportAt, ctx.now()) : null;
  let due = false;
  if (mode === 'real') {
    if (daysSince !== null) due = daysSince >= BACKUP_EVERY_DAYS;
    else due = (await ctx.repo.products.count()) > 0 || (await ctx.repo.stores.count()) > 0;
  }
  return { mode, lastExportAt: s.lastExportAt, daysSince, due };
}

/**
 * Copia de seguridad de la línea: un JSON con todas sus tablas (fotos y PDF como data URL)
 * y sus cuentas de «Entrar como…». Anota la fecha para el aviso de copia pendiente.
 */
export async function exportLine(ctx: Ctx): Promise<{ fileName: string; json: string }> {
  guard(ctx, 'data.export');
  const at = nowIso(ctx);
  const tables = await ctx.repo.dump();
  tables.photos = await Promise.all((tables.photos as Photo[]).map(async (p) => ({ ...p, blob: await blobToDataUrl(p.blob) })));
  tables.templates = await Promise.all(((tables.templates ?? []) as ContractTemplate[]).map(async (t) => ({ ...t, pdf: await blobToDataUrl(t.pdf) })));
  // La copia ya dice cuándo se hizo: al importarla no salta el aviso de copia pendiente.
  tables.settings = (tables.settings as LineSettings[]).map((s) => ({ ...s, lastExportAt: at }));
  const directory = (await getCoreRepo().directory.all()).filter((a) => a.line === ctx.line);
  const json = JSON.stringify({ app: BACKUP_APP, kind: BACKUP_KIND, version: BACKUP_VERSION, line: ctx.line, exportedAt: at, directory, tables });
  await mutate(ctx, async () => {
    const s = await getSettings(ctx);
    await ctx.repo.settings.put({ ...s, lastExportAt: at });
    await audit(ctx, 'datos.exportar', 'settings', 'settings', `Exportó una copia de ${ctx.config.name}`);
  });
  return { fileName: `copia-${ctx.line}-${toIsoDate(ctx.now())}.json`, json };
}

const rowSchema = z.record(z.string(), z.unknown());
const backupSchema = z.object({
  app: z.literal(BACKUP_APP, { error: 'Este archivo no es una copia de esta app.' }),
  kind: z.literal(BACKUP_KIND, { error: 'Este archivo es el respaldo de toda la demo: se importa desde la portada.' }),
  version: z.literal(BACKUP_VERSION, { error: 'La copia es de otra versión de la app.' }),
  line: z.enum(['tabaco', 'cafe'], { error: 'La copia no dice de qué línea es.' }),
  exportedAt: z.string(),
  directory: z.array(rowSchema),
  tables: z.record(z.string(), z.array(rowSchema)),
});

export interface LineBackupSummary {
  line: LineId;
  exportedAt: string;
  mode: DataMode;
  products: number;
  stores: number;
  users: number;
}

interface CheckedBackup {
  summary: LineBackupSummary;
  tables: Record<string, Record<string, unknown>[]>;
  directory: DirectoryAccount[];
}

/** Valida la copia: el archivo es información, no instrucciones. No escribe nada. */
function checkBackup(ctx: Ctx, json: string): CheckedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ValidationError('El archivo no es un JSON válido.');
  }
  const r = backupSchema.safeParse(parsed);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? 'El archivo no es una copia de esta app.');
  const data = r.data;
  if (data.line !== ctx.line) {
    throw new ValidationError(`Esta copia es de ${LINE_NAME[data.line]}: impórtala desde la línea ${LINE_NAME[data.line]}.`);
  }
  const known = new Set<string>(LINE_TABLES);
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of Object.entries(data.tables)) {
    if (!known.has(name)) continue;
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id) throw new ValidationError('La copia tiene registros sin identificador.');
    }
    tables[name] = rows;
  }
  const settings = tables.settings ?? [];
  if (settings.length !== 1 || settings[0]?.id !== 'settings') throw new ValidationError('A la copia le faltan los ajustes de la línea.');
  const users = (tables.users ?? []) as unknown as User[];
  if (!users.some((u) => u.role === 'admin' && u.active)) throw new ValidationError('La copia no tiene una cuenta de Administración activa.');
  if (ctx.line === 'tabaco') {
    const cuban = ((tables.products ?? []) as unknown as Product[]).find((p) => isCubanOrigin(String(p.attrs?.originCountry ?? '')));
    if (cuban) throw new ValidationError(`La copia trae tabaco de origen Cuba (${String(cuban.name)}): no se registra (embargo de EE. UU.).`);
  }
  const userIds = new Set(users.filter((u) => u.active).map((u) => u.id));
  const directory = data.directory.filter(
    (a): a is Record<string, unknown> & DirectoryAccount =>
      typeof a.id === 'string' &&
      typeof a.userId === 'string' &&
      a.line === ctx.line &&
      (a.role === 'admin' || a.role === 'seller' || a.role === 'store') &&
      userIds.has(a.userId),
  );
  const mode: DataMode = (settings[0] as Partial<LineSettings>).dataMode === 'real' ? 'real' : 'demo';
  return {
    summary: {
      line: data.line,
      exportedAt: data.exportedAt,
      mode,
      products: tables.products?.length ?? 0,
      stores: tables.stores?.length ?? 0,
      users: users.length,
    },
    tables,
    directory,
  };
}

/** Lo que trae una copia, para confirmar antes de reemplazar. */
export async function previewLineBackup(ctx: Ctx, json: string): Promise<LineBackupSummary> {
  guard(ctx, 'data.import');
  return checkBackup(ctx, json).summary;
}

/** Reemplaza TODO lo de la línea por la copia (y sus cuentas de «Entrar como…»). */
export async function importLine(ctx: Ctx, json: string): Promise<LineBackupSummary> {
  guard(ctx, 'data.import');
  const { summary, tables, directory } = checkBackup(ctx, json);
  const rows: Record<string, unknown[]> = { ...tables };
  rows.photos = (tables.photos ?? []).map((p) => ({ ...p, blob: dataUrlToBlob(String(p.blob)) }));
  rows.templates = (tables.templates ?? []).map((t) => ({ ...t, pdf: dataUrlToBlob(String(t.pdf)) }));
  await ctx.repo.load(rows);
  const users = (tables.users ?? []) as unknown as User[];
  const core = getCoreRepo();
  await core.transaction(async () => {
    for (const acc of await core.directory.all()) {
      if (acc.line === ctx.line) await core.directory.remove(acc.id);
    }
    for (const acc of directory) {
      const { id, role, line, userId, name, label, primary, storeId } = acc;
      await core.directory.put({ id, role, line, userId, name, label, primary: primary !== false, ...(storeId ? { storeId } : {}) });
    }
    if (!directory.some((a) => a.role === 'admin')) {
      const admin = users.find((u) => u.role === 'admin' && u.active);
      if (admin) await core.directory.put(realAdminAccount(ctx.line, admin));
    }
    // Si la cuenta con la que se entró no está en la copia, se sigue como Administración.
    const session = await core.session.get('session');
    const accountId = session?.accountId;
    if (session && accountId?.startsWith(`${ctx.line}:`)) {
      const userId = accountId.slice(ctx.line.length + 1);
      const stillThere = (await core.directory.get(accountId)) ?? users.find((u) => u.id === userId && u.active);
      if (!stillThere) await core.session.put({ ...session, accountId: `${ctx.line}:admin`, viewAsAccountId: null });
    }
  });
  await audit(ctx, 'datos.importar', 'settings', 'settings', `Importó una copia de ${ctx.config.name} del ${fmtDate(summary.exportedAt)}`);
  emitAll();
  return summary;
}
