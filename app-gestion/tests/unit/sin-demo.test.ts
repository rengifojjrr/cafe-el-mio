// La app sin datos de ejemplo: un navegador nuevo arranca con las dos líneas en blanco (ya como
// datos reales), uno que tenía la demo de antes la pierde sin tocar lo real, los cafés de El Mío
// quedan solo con lo real y desactivados, y una copia de ejemplo ya no se carga.
import { afterEach, describe, expect, it } from 'vitest';
import type { LineId, LineSettings, Product, Warehouse } from '../../src/data/types';
import { getCoreRepo, getLineRepo, setDbPrefix } from '../../src/data';
import { LINE_TABLES } from '../../src/data/repo';
import type { Actor } from '../../src/domain/permissions';
import { buildLine } from '../../src/seed';
import { CAFE_SEED } from '../../src/seed/cafe';
import { TABACO_SEED } from '../../src/seed/tabaco';
import { saveProduct, setProductActive } from '../../src/services/catalog';
import { ValidationError, lineCtx } from '../../src/services/context';
import { exportLine, importLine, previewLineBackup, startBlank } from '../../src/services/real-data';
import {
  allowDemoData,
  enterAs,
  exportState,
  findAccount,
  getLineDataMode,
  getSession,
  importState,
  listAccounts,
  resetDemo,
  seedIfNeeded,
} from '../../src/services/session';

const NOW = new Date('2026-11-06T15:00:00Z');

async function ctxFor(line: LineId, accountId: string) {
  const acc = await findAccount(accountId);
  if (!acc) throw new Error(`No existe ${accountId}`);
  const actor: Actor = { accountId: acc.id, userId: acc.userId, role: acc.role, line: acc.line, storeId: acc.storeId, name: acc.name, readOnly: false };
  return lineCtx(line, actor, { repo: getLineRepo(line), now: () => NOW });
}

async function counts(line: LineId): Promise<Record<string, number>> {
  const dump = await getLineRepo(line).dump();
  return Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length]));
}

/** Lo único que puede tener una línea recién arrancada en blanco. */
function blankCounts(line: LineId): Record<string, number> {
  const zones = (line === 'tabaco' ? TABACO_SEED : CAFE_SEED).zones.length;
  return { settings: 1, warehouses: 1, zones, users: 1, audit: 1, products: line === 'cafe' ? 9 : 0 };
}

async function expectBlank(line: LineId): Promise<void> {
  const after = await counts(line);
  const kept = blankCounts(line);
  for (const table of LINE_TABLES) expect(after[table] ?? 0, `${line}.${table}`).toBe(kept[table] ?? 0);
  expect(await getLineDataMode(line)).toBe('real');
  const [admin] = await getLineRepo(line).users.all();
  expect(admin).toMatchObject({ role: 'admin', name: 'Administración', email: '', phone: '', active: true });
}

afterEach(() => allowDemoData(true));

describe('un navegador nuevo', () => {
  it('arranca con Tabaco y Café en blanco, ya como datos reales, y solo las cuentas de Administración y Dirección', async () => {
    setDbPrefix('pruebas-sin-demo-nuevo-');
    await seedIfNeeded(NOW, { demo: false });
    await expectBlank('tabaco');
    await expectBlank('cafe');

    const core = getCoreRepo();
    expect((await core.directory.all()).map((a) => a.id).sort()).toEqual(['cafe:admin', 'direccion', 'tabaco:admin']);
    const { others } = await listAccounts();
    expect(others).toEqual({ tabaco: [], cafe: [] });
    expect(await getSession()).toMatchObject({ accountId: null });
    expect(await core.settings.get('ecosystem')).toMatchObject({ name: 'Grupo Miami · Tabaco & Café' });

    // El almacén conserva su nombre y su punto, pero no la dirección de ejemplo.
    const wh = (await getLineRepo('tabaco').warehouses.get('almacen')) as Warehouse;
    expect(wh).toMatchObject({ name: 'Almacén Miami', address: '' });

    // Abrir de nuevo no cambia nada.
    const before = await counts('tabaco');
    await seedIfNeeded(NOW, { demo: false });
    expect(await counts('tabaco')).toEqual(before);
  });

  it('los ajustes de partida son los de siempre, sin la lista de precios de ejemplo', async () => {
    for (const line of ['tabaco', 'cafe'] as const) {
      const blank = (await getLineRepo(line).settings.get('settings')) as LineSettings;
      const demo = structuredClone((buildLine(line, NOW).settings as LineSettings[])[0]!);
      delete demo.defaultPriceListId;
      expect(blank, line).toEqual({ ...demo, dataMode: 'real' });
    }
  });

  it('Café trae los 9 cafés de El Mío solo con lo real: sin costo, sin precio al local, sin código de ejemplo y desactivados', async () => {
    const products = (await getLineRepo('cafe').products.all()) as Product[];
    const bySku = new Map(products.map((p) => [p.sku, p]));
    expect(products).toHaveLength(CAFE_SEED.products.length);
    for (const seed of CAFE_SEED.products) {
      const p = bySku.get(seed.sku)!;
      expect(p, seed.sku).toMatchObject({
        name: seed.name,
        brandLine: 'Café El Mío',
        brandPhoto: seed.brandPhoto,
        suggestedRetail: seed.suggestedRetail,
        notes: seed.notes,
        attrs: seed.attrs,
        active: false,
        cost: 0,
        priceToStore: 0,
        sampleCost: true,
      });
      expect(p.barcode, seed.sku).toBeUndefined();
      expect(p.boxPrice, seed.sku).toBeUndefined();
    }
    // Sin movimientos: no hay stock.
    expect(await getLineRepo('cafe').movements.count()).toBe(0);
  });

  it('un café sin precio al local no se activa; con precio, sí', async () => {
    const ctx = await ctxFor('cafe', 'cafe:admin');
    const elmio = ((await getLineRepo('cafe').products.all()) as Product[]).find((p) => p.sku === 'CF-ELMIO-10OZ')!;
    await expect(setProductActive(ctx, elmio.id, true)).rejects.toThrow(ValidationError);
    await expect(setProductActive(ctx, elmio.id, true)).rejects.toThrow(/todavía no tiene precio al local/);
    const { id, sku, name, brandLine, suggestedRetail, sellerCommission, lowStockThreshold, packSize, unitName, notes, pairing, attrs } = elmio;
    await saveProduct(ctx, { id, sku, name, brandLine, suggestedRetail, sellerCommission, lowStockThreshold, packSize, unitName, notes, pairing, attrs, cost: 2.5, priceToStore: 4.25, active: false });
    await setProductActive(ctx, elmio.id, true);
    expect(await getLineRepo('cafe').products.get(elmio.id)).toMatchObject({ active: true, priceToStore: 4.25, cost: 2.5 });
  });
});

describe('un navegador que tenía la demo de antes', () => {
  it('la pierde entera al abrir la versión nueva; lo que ya era real no se toca', async () => {
    setDbPrefix('pruebas-sin-demo-viejo-');
    await resetDemo(NOW);
    // Tabaco ya tenía datos reales (empezó en blanco y cargó un producto).
    await startBlank(await ctxFor('tabaco', 'tabaco:admin'), 'Tabaco');
    const real = await saveProduct(await ctxFor('tabaco', 'tabaco:admin'), {
      sku: 'ABC-201',
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
    const tabacoBefore = await getLineRepo('tabaco').dump();
    // Café seguía con la demo y alguien había entrado como su vendedor.
    expect(await getLineDataMode('cafe')).toBe('demo');
    expect((await getLineRepo('cafe').stores.count()) > 0).toBe(true);
    await enterAs('cafe:seller');

    await seedIfNeeded(NOW, { demo: false });

    expect(await getLineRepo('tabaco').dump()).toEqual(tabacoBefore);
    expect((await getLineRepo('tabaco').products.all()).map((p) => p.id)).toEqual([real.id]);
    await expectBlank('cafe');
    expect(await findAccount('cafe:seller')).toBeNull();
    expect(await findAccount('cafe:store')).toBeNull();
    expect(await findAccount('cafe:admin')).not.toBeNull();
    expect(await findAccount('tabaco:admin')).not.toBeNull();
    expect(await findAccount('direccion')).not.toBeNull();
    // Su cuenta ya no existe: vuelve a la portada.
    expect(await getSession()).toMatchObject({ accountId: null, viewAsAccountId: null });
  });

  it('«Empezar en blanco» en Café deja los 9 cafés de El Mío sin precio, como una línea nueva', async () => {
    await resetDemo(NOW);
    await startBlank(await ctxFor('cafe', 'cafe:admin'), 'Café');
    const products = (await getLineRepo('cafe').products.all()) as Product[];
    expect(products).toHaveLength(9);
    expect(products.every((p) => !p.active && p.cost === 0 && p.priceToStore === 0)).toBe(true);
    expect((await getLineRepo('cafe').audit.all()).map((a) => a.summary)).toEqual([
      'Empezó en blanco con datos reales: quedan los 9 cafés de El Mío, sin precio al local ni costo y desactivados',
    ]);
  });
});

describe('las copias de la demo de antes', () => {
  it('la copia de una línea de ejemplo no se carga', async () => {
    setDbPrefix('pruebas-sin-demo-copias-');
    await resetDemo(NOW);
    const ctx = await ctxFor('tabaco', 'tabaco:admin');
    const { json } = await exportLine(ctx);
    allowDemoData(false);
    await expect(previewLineBackup(ctx, json)).rejects.toThrow(/datos de ejemplo de antes/);
    await expect(importLine(ctx, json)).rejects.toThrow(ValidationError);
    // Nada cambió.
    expect(await getLineDataMode('tabaco')).toBe('demo');
  });

  it('el respaldo completo carga lo real y deja en blanco lo que era de ejemplo', async () => {
    await resetDemo(NOW);
    await startBlank(await ctxFor('tabaco', 'tabaco:admin'), 'Tabaco');
    const json = await exportState();
    allowDemoData(false);
    const { blanked } = await importState(json);
    expect(blanked).toEqual(['cafe']);
    expect(await getLineDataMode('tabaco')).toBe('real');
    await expectBlank('cafe');
    expect((await getCoreRepo().directory.all()).map((a) => a.id).sort()).toEqual(['cafe:admin', 'direccion', 'tabaco:admin']);
  });
});
