// Lo común del ecosistema (eco-core): la sesión, «Entrar como…», el nombre del ecosistema,
// restablecer la demo y exportar o importar su estado.
import type { DirectoryAccount, EcosystemSettings, LineId, Photo, SessionState, User } from '../data/types';
import { LINES } from '../data/types';
import { getCoreRepo, getDbPrefix, getLineRepo } from '../data';
import type { Actor } from '../domain/permissions';
import { DEFAULT_ECOSYSTEM_NAME, SEED_VERSION } from '../seed/version';
import { emitAll, emitChange } from './bus';

const EXPORT_APP = 'grupo-miami-ecosistema';
const EXPORT_VERSION = 1;

let seeding: Promise<void> | null = null;

/**
 * Si no hay datos (o son de una versión vieja de la semilla), carga los de ejemplo.
 * Devuelve siempre la misma promesa: quien necesita datos (entrar, listar cuentas, la sesión)
 * espera a que termine la primera carga.
 */
export function ensureSeeded(now = new Date()): Promise<void> {
  if (!seeding) {
    seeding = (async () => {
      const core = getCoreRepo();
      const settings = await core.settings.get('ecosystem');
      const hasData = (await getLineRepo('tabaco').products.count()) > 0 && (await getLineRepo('cafe').products.count()) > 0;
      if (!settings || settings.seedVersion !== SEED_VERSION || !hasData) {
        await resetDemo(now, settings?.name);
      }
    })();
    seeding.catch(() => {
      seeding = null;
    });
  }
  return seeding;
}

/** Borra todo y vuelve a cargar los datos de ejemplo (fechas relativas a hoy). */
export async function resetDemo(now = new Date(), keepName?: string): Promise<void> {
  const name = keepName ?? DEFAULT_ECOSYSTEM_NAME;
  if (typeof window !== 'undefined' && typeof Worker === 'function') {
    try {
      await seedInWorker(now, name);
      emitAll();
      return;
    } catch (e) {
      console.warn('La semilla en segundo plano falló; se carga en la página.', e);
    }
  }
  const core = getCoreRepo();
  const repos = { tabaco: getLineRepo('tabaco'), cafe: getLineRepo('cafe') };
  // La semilla (datos y simulador) solo se descarga cuando hace falta.
  const { seedEverything } = await import('../seed');
  await Promise.all([core.clearAll(), repos.tabaco.clearAll(), repos.cafe.clearAll()]);
  await seedEverything(core, repos, now, name);
  emitAll();
}

/** Corre la simulación de la semilla en un Web Worker: la pantalla no se traba. */
function seedInWorker(now: Date, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../seed/seed.worker.ts', import.meta.url), { type: 'module' });
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('La carga de datos de ejemplo tardó demasiado.'));
    }, 60_000);
    worker.onmessage = (e: MessageEvent<{ ok: boolean; error?: string }>) => {
      window.clearTimeout(timer);
      worker.terminate();
      if (e.data.ok) resolve();
      else reject(new Error(e.data.error ?? 'No se pudieron cargar los datos de ejemplo.'));
    };
    worker.onerror = (e) => {
      window.clearTimeout(timer);
      worker.terminate();
      reject(new Error(e.message || 'No se pudieron cargar los datos de ejemplo.'));
    };
    worker.postMessage({ now: now.toISOString(), name, prefix: getDbPrefix() });
  });
}

export async function getEcosystem(): Promise<EcosystemSettings> {
  const s = await getCoreRepo().settings.get('ecosystem');
  return s ?? { id: 'ecosystem', name: DEFAULT_ECOSYSTEM_NAME, theme: 'dark', seededAt: new Date().toISOString(), seedVersion: SEED_VERSION };
}

export async function saveEcosystem(patch: Partial<Pick<EcosystemSettings, 'name' | 'theme'>>): Promise<void> {
  const core = getCoreRepo();
  const cur = await getEcosystem();
  const name = patch.name?.trim();
  if (patch.name !== undefined && (!name || name.length < 3)) throw new Error('El nombre del ecosistema es muy corto.');
  await core.settings.put({ ...cur, ...(name ? { name } : {}), ...(patch.theme ? { theme: patch.theme } : {}) });
  emitChange('core');
}

export async function getSession(): Promise<SessionState> {
  const s = await getCoreRepo().session.get('session');
  return s ?? { id: 'session', accountId: null, viewAsAccountId: null, directorLine: null };
}

async function saveSession(s: SessionState): Promise<void> {
  await getCoreRepo().session.put(s);
  emitChange('core');
}

export interface AccountOption extends DirectoryAccount {
  zoneName?: string;
}

/** Cuentas para «Entrar como…»: las principales y, aparte, el resto de vendedores y locales. */
export async function listAccounts(): Promise<{ primary: AccountOption[]; others: Record<LineId, AccountOption[]> }> {
  await ensureSeeded();
  const primary = (await getCoreRepo().directory.all()).sort((a, b) => order(a) - order(b));
  const primaryUserIds = new Set(primary.map((p) => `${p.line}:${p.userId}`));
  const others: Record<LineId, AccountOption[]> = { tabaco: [], cafe: [] };
  for (const line of LINES) {
    const repo = getLineRepo(line);
    const [users, stores] = await Promise.all([repo.users.all(), repo.stores.all()]);
    const storesById = new Map(stores.map((s) => [s.id, s]));
    for (const u of users) {
      if (!u.active || primaryUserIds.has(`${line}:${u.id}`)) continue;
      const store = u.storeId ? storesById.get(u.storeId) : undefined;
      others[line].push({
        id: `${line}:${u.id}`,
        role: u.role,
        line,
        userId: u.id,
        storeId: u.storeId,
        name: u.name,
        label: u.role === 'admin' ? 'Administración' : u.role === 'seller' ? 'Vendedor' : `Local · ${store?.name ?? ''}`,
        primary: false,
      });
    }
    others[line].sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label, 'es'));
  }
  return { primary, others };
}

function order(a: Pick<DirectoryAccount, 'role' | 'line'>): number {
  const line = a.line === null ? 0 : a.line === 'tabaco' ? 10 : 20;
  const role = { direccion: 0, admin: 1, seller: 2, store: 3 }[a.role];
  return line + role;
}

/** Busca una cuenta por id: «direccion», «tabaco:admin» o «tabaco:<idDeUsuario>». */
export async function findAccount(accountId: string): Promise<DirectoryAccount | null> {
  const direct = await getCoreRepo().directory.get(accountId);
  if (direct) return direct;
  const [line, userId] = accountId.split(':');
  if ((line !== 'tabaco' && line !== 'cafe') || !userId) return null;
  const u: User | undefined = await getLineRepo(line).users.get(userId);
  if (!u || !u.active) return null;
  return { id: accountId, role: u.role, line, userId: u.id, storeId: u.storeId, name: u.name, label: u.role, primary: false };
}

export async function enterAs(accountId: string): Promise<DirectoryAccount> {
  await ensureSeeded();
  const acc = await findAccount(accountId);
  if (!acc) throw new Error('Esa cuenta no existe.');
  await saveSession({ id: 'session', accountId: acc.id, viewAsAccountId: null, directorLine: null });
  return acc;
}

export async function leave(): Promise<void> {
  await saveSession({ id: 'session', accountId: null, viewAsAccountId: null, directorLine: null });
}

/** Administración (o Dirección) mira la línea con los ojos de otra cuenta: solo mirar. */
export async function viewAs(accountId: string | null): Promise<void> {
  const s = await getSession();
  if (!s.accountId) throw new Error('Primero entra con una cuenta.');
  const me = await findAccount(s.accountId);
  if (accountId) {
    const target = await findAccount(accountId);
    if (!target || !target.line) throw new Error('Esa cuenta no existe.');
    const allowed = (me?.role === 'admin' && me.line === target.line) || (me?.role === 'direccion' && s.directorLine === target.line);
    if (!allowed) throw new Error('Solo administración de esa línea puede mirar con los ojos de otra cuenta.');
  }
  await saveSession({ ...s, viewAsAccountId: accountId });
}

/** Dirección abre una línea como «ver como Administración» (solo lectura). */
export async function directorOpenLine(line: LineId | null): Promise<void> {
  const s = await getSession();
  const me = s.accountId ? await findAccount(s.accountId) : null;
  if (me?.role !== 'direccion') throw new Error('Solo Dirección puede abrir una línea así.');
  await saveSession({ ...s, directorLine: line, viewAsAccountId: null });
}

function actorFrom(acc: DirectoryAccount, readOnly: boolean): Actor {
  return { accountId: acc.id, userId: acc.userId, role: acc.role, line: acc.line, storeId: acc.storeId, name: acc.name, readOnly };
}

/**
 * El actor con el que se usan los servicios de una línea, o null si la sesión no tiene
 * acceso a esa línea (entonces la pantalla vuelve a la portada).
 */
export async function resolveActor(line: LineId): Promise<{ actor: Actor; account: DirectoryAccount; viewing: DirectoryAccount | null } | null> {
  await ensureSeeded();
  const s = await getSession();
  if (!s.accountId) return null;
  const acc = await findAccount(s.accountId);
  if (!acc) return null;
  if (acc.role === 'direccion') {
    if (s.directorLine !== line) return null;
    // Dirección mira como Administración, pero con su propia identidad: no hereda la campana
    // ni los mensajes de ninguna persona de administración.
    const asAdmin: DirectoryAccount = {
      id: `${line}:direccion`,
      role: 'admin',
      line,
      userId: 'direccion',
      name: 'Dirección',
      label: 'Dirección',
      primary: false,
    };
    if (s.viewAsAccountId) {
      const target = await findAccount(s.viewAsAccountId);
      if (target && target.line === line) return { actor: actorFrom(target, true), account: acc, viewing: target };
    }
    return { actor: actorFrom(asAdmin, true), account: acc, viewing: asAdmin };
  }
  if (acc.line !== line) return null;
  if (s.viewAsAccountId) {
    const target = await findAccount(s.viewAsAccountId);
    if (target && target.line === line && acc.role === 'admin') {
      return { actor: actorFrom(target, true), account: acc, viewing: target };
    }
  }
  return { actor: actorFrom(acc, false), account: acc, viewing: null };
}

// ---------- Exportar / importar ----------

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

function dataUrlToBlob(url: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new Error('Foto inválida en el archivo.');
  const mime = m[1] ?? 'application/octet-stream';
  const data = m[2] ? atob(m[3] ?? '') : decodeURIComponent(m[3] ?? '');
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportState(): Promise<string> {
  const core = await getCoreRepo().dump();
  const lines: Record<string, Record<string, unknown[]>> = {};
  for (const line of LINES) {
    const dump = await getLineRepo(line).dump();
    dump.photos = await Promise.all(
      (dump.photos as Photo[]).map(async (p) => ({ ...p, blob: await blobToDataUrl(p.blob) })),
    );
    lines[line] = dump;
  }
  return JSON.stringify({ app: EXPORT_APP, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), core, lines });
}

/** Esquema del respaldo; zod se carga solo cuando alguien importa un archivo. */
async function importSchema() {
  const { z } = await import('zod');
  const tableSchema = z.array(z.record(z.string(), z.unknown()));
  return z.object({
    app: z.literal(EXPORT_APP, { error: 'Este archivo no es un respaldo de esta app.' }),
    version: z.literal(EXPORT_VERSION, { error: 'El respaldo es de otra versión de la app.' }),
    exportedAt: z.string(),
    core: z.object({ session: tableSchema, settings: tableSchema, directory: tableSchema }),
    lines: z.object({ tabaco: z.record(z.string(), tableSchema), cafe: z.record(z.string(), tableSchema) }),
  });
}

/** Carga un respaldo JSON. El archivo es información, no instrucciones: se valida antes de usarlo. */
export async function importState(json: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  const data = (await importSchema()).parse(parsed);
  for (const line of LINES) {
    const tables = data.lines[line];
    for (const row of [...(tables.products ?? []), ...(tables.stores ?? [])]) {
      if (typeof row.id !== 'string') throw new Error('El respaldo tiene registros sin identificador.');
    }
  }
  for (const line of LINES) {
    const tables = { ...data.lines[line] };
    tables.photos = (tables.photos ?? []).map((p) => ({ ...p, blob: dataUrlToBlob(String(p.blob)) }));
    await getLineRepo(line).load(tables);
  }
  await getCoreRepo().load({ ...data.core, session: [{ id: 'session', accountId: null, viewAsAccountId: null, directorLine: null }] });
  emitAll();
}
