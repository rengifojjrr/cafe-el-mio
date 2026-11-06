// Modo real: «Empezar en blanco», la semilla que nunca borra datos reales y la copia de
// seguridad de cada línea (exportar e importar).
import { beforeAll, describe, expect, it } from 'vitest';
import type { LineId, LineSettings, Product } from '../../src/data/types';
import { getCoreRepo, getLineRepo, setDbPrefix } from '../../src/data';
import { LINE_TABLES } from '../../src/data/repo';
import type { Actor } from '../../src/domain/permissions';
import { SEED_VERSION } from '../../src/seed/version';
import { addProductPhoto, saveProduct } from '../../src/services/catalog';
import { ForbiddenError, ValidationError, lineCtx } from '../../src/services/context';
import { backupStatus, exportLine, importLine, previewLineBackup, startBlank } from '../../src/services/real-data';
import { exportState, findAccount, getLineDataMode, listAccounts, resetDemo, seedIfNeeded } from '../../src/services/session';

const NOW = new Date('2026-11-05T15:00:00Z');

async function actorFor(accountId: string, readOnly = false): Promise<Actor> {
  const acc = await findAccount(accountId);
  if (!acc) throw new Error(`No existe ${accountId}`);
  return { accountId: acc.id, userId: acc.userId, role: acc.role, line: acc.line, storeId: acc.storeId, name: acc.name, readOnly };
}

async function ctxFor(line: LineId, accountId: string, opts: { readOnly?: boolean; now?: Date } = {}) {
  return lineCtx(line, await actorFor(accountId, opts.readOnly), { repo: getLineRepo(line), now: () => opts.now ?? NOW });
}

async function counts(line: LineId): Promise<Record<string, number>> {
  const dump = await getLineRepo(line).dump();
  return Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length]));
}

const toro = (sku: string): Parameters<typeof saveProduct>[1] => ({
  sku,
  name: 'Toro',
  familyName: 'Toro 6 × 52',
  brandLine: 'De mazo (sin marca)',
  cost: 10,
  priceToStore: 25,
  suggestedRetail: 43.75,
  sellerCommission: { type: 'percent', value: 6 },
  lowStockThreshold: 10,
  packSize: 50,
  unitName: 'mazo',
  kind: 'mazo',
  attrs: { vitola: 'Toro', lengthIn: 6, ringGauge: 52, capa: 'maduro', strength: 'media', originCountry: 'Nicaragua', cigarsPerBundle: 25 },
});

beforeAll(async () => {
  setDbPrefix('pruebas-datos-reales-');
  await resetDemo(NOW);
});

describe('empezar en blanco', () => {
  it('solo Administración de esa línea, sin «ver como» y escribiendo el nombre de la línea', async () => {
    await expect(startBlank(await ctxFor('tabaco', 'tabaco:seller'), 'Tabaco')).rejects.toThrow(ForbiddenError);
    await expect(startBlank(await ctxFor('tabaco', 'tabaco:admin', { readOnly: true }), 'Tabaco')).rejects.toThrow(ForbiddenError);
    const cafeAdmin = await actorFor('cafe:admin');
    await expect(startBlank(lineCtx('tabaco', cafeAdmin, { repo: getLineRepo('tabaco') }), 'Tabaco')).rejects.toThrow(ForbiddenError);
    await expect(startBlank(await ctxFor('tabaco', 'tabaco:admin'), 'Café')).rejects.toThrow(ValidationError);
    expect(await getLineDataMode('tabaco')).toBe('demo');
    expect(await getLineRepo('tabaco').products.count()).toBe(21);
  });

  it('vacía Tabaco y deja los ajustes, el almacén, las zonas y una cuenta «Administración»; Café no se toca', async () => {
    const cafeBefore = await counts('cafe');
    const adminBefore = await findAccount('tabaco:admin');
    const zonesBefore = await getLineRepo('tabaco').zones.count();
    await startBlank(await ctxFor('tabaco', 'tabaco:admin'), ' tabaco ');

    const after = await counts('tabaco');
    const kept: Record<string, number> = { settings: 1, warehouses: 1, users: 1, zones: zonesBefore, audit: 1 };
    for (const table of LINE_TABLES) expect(after[table] ?? 0, table).toBe(kept[table] ?? 0);
    const repo = getLineRepo('tabaco');
    const [admin] = await repo.users.all();
    expect(admin).toMatchObject({ id: adminBefore!.userId, role: 'admin', name: 'Administración', active: true });
    const settings = (await repo.settings.get('settings')) as LineSettings;
    expect(settings.dataMode).toBe('real');
    expect(settings.lastExportAt).toBeUndefined();
    expect((await repo.audit.all()).map((a) => a.summary)).toEqual(['Empezó en blanco con datos reales']);
    expect(await getLineDataMode('tabaco')).toBe('real');
    expect(await getLineDataMode('cafe')).toBe('demo');

    // Café: idéntico.
    expect(await counts('cafe')).toEqual(cafeBefore);

    // «Entrar como…»: de Tabaco solo queda Administración.
    expect(await findAccount('tabaco:seller')).toBeNull();
    expect(await findAccount('tabaco:store')).toBeNull();
    const { primary, others } = await listAccounts();
    expect(primary.filter((a) => a.line === 'tabaco').map((a) => a.id)).toEqual(['tabaco:admin']);
    expect(primary.find((a) => a.id === 'tabaco:admin')?.name).toBe('Administración');
    expect(others.tabaco).toEqual([]);
    expect(primary.filter((a) => a.line === 'cafe')).toHaveLength(3);
  });
});

describe('la semilla nunca borra una línea con datos reales', () => {
  it('con el catálogo vacío, la línea real se queda como está', async () => {
    expect(await getLineRepo('tabaco').products.count()).toBe(0);
    await seedIfNeeded(NOW, { demo: true });
    expect(await getLineRepo('tabaco').products.count()).toBe(0);
    expect(await getLineDataMode('tabaco')).toBe('real');
    expect(await getLineRepo('tabaco').users.count()).toBe(1);
  });

  it('si cambia la versión de la semilla, solo se recarga la línea de ejemplo y las cuentas reales se conservan', async () => {
    const ctx = await ctxFor('tabaco', 'tabaco:admin');
    const real = await saveProduct(ctx, toro('ABC-101'));
    const core = getCoreRepo();
    const eco = (await core.settings.get('ecosystem'))!;
    await core.settings.put({ ...eco, seedVersion: SEED_VERSION - 1 });
    // Café (de ejemplo) cambió: la semilla lo vuelve a dejar como estaba.
    const cafeProducts = await getLineRepo('cafe').products.all();
    await getLineRepo('cafe').products.remove(cafeProducts[0]!.id);

    await seedIfNeeded(NOW, { demo: true });

    const tabaco = await getLineRepo('tabaco').products.all();
    expect(tabaco.map((p) => p.id)).toEqual([real.id]);
    expect(await getLineDataMode('tabaco')).toBe('real');
    expect(await getLineRepo('cafe').products.count()).toBe(cafeProducts.length);
    expect((await core.settings.get('ecosystem'))?.seedVersion).toBe(SEED_VERSION);
    expect(await findAccount('tabaco:admin')).not.toBeNull();
    expect(await findAccount('tabaco:seller')).toBeNull();
    expect(await findAccount('cafe:seller')).not.toBeNull();
    expect(await findAccount('direccion')).not.toBeNull();
  });

  it('si el directorio perdió la cuenta de Administración de la línea real, se repone', async () => {
    const core = getCoreRepo();
    const admin = (await getLineRepo('tabaco').users.all())[0]!;
    await core.directory.remove('tabaco:admin');
    await seedIfNeeded(NOW, { demo: true });
    expect(await core.directory.get('tabaco:admin')).toMatchObject({ role: 'admin', line: 'tabaco', userId: admin.id, primary: true });
  });
});

describe('copia de seguridad de la línea', () => {
  it('avisa con datos reales si nunca se exportó (y ya hay algo) o si pasaron 7 días', async () => {
    const ctx = await ctxFor('tabaco', 'tabaco:admin');
    const s = await backupStatus(ctx);
    expect(s).toMatchObject({ mode: 'real', daysSince: null, due: true });
    const cafe = await backupStatus(await ctxFor('cafe', 'cafe:admin'));
    expect(cafe.due).toBe(false);
  });

  it('exporta solo las tablas de la línea y sus cuentas, y anota la fecha', async () => {
    const ctx = await ctxFor('tabaco', 'tabaco:admin');
    const product = (await getLineRepo('tabaco').products.all())[0]!;
    await addProductPhoto(ctx, product.id, { blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' }), mime: 'image/webp', width: 2, height: 2 });
    const { fileName, json } = await exportLine(ctx);
    expect(fileName).toBe('copia-tabaco-2026-11-05.json');
    const file = JSON.parse(json) as { line: string; kind: string; directory: { line: string }[]; tables: Record<string, Record<string, unknown>[]> };
    expect(file.line).toBe('tabaco');
    expect(file.kind).toBe('linea');
    expect(file.directory.length).toBeGreaterThan(0);
    expect(file.directory.every((a) => a.line === 'tabaco')).toBe(true);
    expect(file.tables.products).toHaveLength(1);
    expect(String(file.tables.photos?.[0]?.blob)).toMatch(/^data:image\/webp;base64,/);
    expect(file.tables.settings?.[0]?.lastExportAt).toBe(NOW.toISOString());
    expect((await getLineRepo('tabaco').settings.get('settings'))?.lastExportAt).toBe(NOW.toISOString());
    expect(await backupStatus(ctx)).toMatchObject({ daysSince: 0, due: false });
    const later = await ctxFor('tabaco', 'tabaco:admin', { now: new Date('2026-11-12T16:00:00Z') });
    expect(await backupStatus(later)).toMatchObject({ daysSince: 7, due: true });
  });

  it('importar la copia reemplaza solo esa línea (después de confirmar lo que trae)', async () => {
    const ctx = await ctxFor('tabaco', 'tabaco:admin');
    const { json } = await exportLine(ctx);
    const cafeBefore = await counts('cafe');
    await saveProduct(ctx, toro('ABC-102'));
    expect(await getLineRepo('tabaco').products.count()).toBe(2);
    const summary = await previewLineBackup(ctx, json);
    expect(summary).toMatchObject({ line: 'tabaco', mode: 'real', products: 1, stores: 0, users: 1 });
    await importLine(ctx, json);
    const products = (await getLineRepo('tabaco').products.all()) as Product[];
    expect(products.map((p) => p.sku)).toEqual(['ABC-101']);
    const photos = await getLineRepo('tabaco').photos.all();
    expect(photos).toHaveLength(1);
    expect(photos[0]!.blob.size).toBe(4);
    expect(await getLineDataMode('tabaco')).toBe('real');
    expect(await findAccount('tabaco:admin')).not.toBeNull();
    expect(await counts('cafe')).toEqual(cafeBefore);
  });

  it('rechaza la copia de la otra línea, el respaldo completo, un JSON roto y el tabaco de Cuba', async () => {
    const ctx = await ctxFor('tabaco', 'tabaco:admin');
    const cafe = await exportLine(await ctxFor('cafe', 'cafe:admin'));
    await expect(importLine(ctx, cafe.json)).rejects.toThrow(/Café/);
    await expect(importLine(ctx, await exportState())).rejects.toThrow(/portada/);
    await expect(importLine(ctx, 'no es json')).rejects.toThrow(/JSON/);
    const { json } = await exportLine(ctx);
    const file = JSON.parse(json) as { tables: { products: Product[] } };
    file.tables.products[0]!.attrs.originCountry = 'Pinar del Río, Cuba';
    await expect(importLine(ctx, JSON.stringify(file))).rejects.toThrow(/Cuba/);
    expect(await getLineRepo('tabaco').products.count()).toBe(1);
    const seller = await ctxFor('cafe', 'cafe:seller');
    await expect(importLine(seller, cafe.json)).rejects.toThrow(ForbiddenError);
    await expect(exportLine(seller)).rejects.toThrow(ForbiddenError);
  });

  it('el respaldo completo de la portada también cuenta como copia de la línea real', async () => {
    const repo = getLineRepo('tabaco');
    const s = (await repo.settings.get('settings'))!;
    await repo.settings.put({ ...s, lastExportAt: '2026-10-01T12:00:00.000Z' });
    const cafeBefore = (await getLineRepo('cafe').settings.get('settings'))?.lastExportAt;
    await exportState();
    expect((await repo.settings.get('settings'))?.lastExportAt).not.toBe('2026-10-01T12:00:00.000Z');
    // Café tiene datos de ejemplo: el respaldo completo no le cambia nada.
    expect((await getLineRepo('cafe').settings.get('settings'))?.lastExportAt).toBe(cafeBefore);
  });
});

describe('restablecer la demo', () => {
  it('vuelve a poner las dos líneas con datos de ejemplo', async () => {
    await resetDemo(NOW);
    expect(await getLineDataMode('tabaco')).toBe('demo');
    expect(await getLineRepo('tabaco').products.count()).toBe(21);
    expect(await findAccount('tabaco:seller')).not.toBeNull();
  });

  it('sin datos reales, una versión vieja de la semilla recarga todo como siempre', async () => {
    const core = getCoreRepo();
    const eco = (await core.settings.get('ecosystem'))!;
    await core.settings.put({ ...eco, seedVersion: SEED_VERSION - 1 });
    const first = (await getLineRepo('tabaco').products.all())[0]!;
    await getLineRepo('tabaco').products.remove(first.id);
    await seedIfNeeded(NOW, { demo: true });
    expect(await getLineRepo('tabaco').products.count()).toBe(21);
    expect((await core.settings.get('ecosystem'))?.seedVersion).toBe(SEED_VERSION);
  });
});
