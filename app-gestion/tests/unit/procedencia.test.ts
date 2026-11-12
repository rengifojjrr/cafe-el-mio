// Ronda 4: la procedencia y la región del tabaco son opcionales al crear un producto. Lo que no
// cambia: si la procedencia viene llena y es Cuba, se rechaza (embargo de EE. UU.).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getLineRepo, setDbPrefix } from '../../src/data';
import { SIN_PROCEDENCIA, applyFilters, buildFacets, facetLabel } from '../../src/domain/catalog-filters';
import { type ImportOptions, defaultImportOptions, detectColumns } from '../../src/domain/import-products';
import type { Actor } from '../../src/domain/permissions';
import { readXlsx } from '../../src/lib/sheets';
import { type ProductInput, listProducts, saveProduct } from '../../src/services/catalog';
import { previewImport, runImport } from '../../src/services/catalog-import';
import { requestDelivery } from '../../src/services/consignment';
import { ValidationError, lineCtx } from '../../src/services/context';
import { startBlank } from '../../src/services/real-data';
import { findAccount, resetDemo } from '../../src/services/session';

const NOW = new Date('2026-11-12T15:00:00Z');

async function adminCtx() {
  const acc = (await findAccount('tabaco:admin'))!;
  const actor: Actor = { accountId: acc.id, userId: acc.userId, role: 'admin', line: 'tabaco', name: acc.name, readOnly: false };
  return lineCtx('tabaco', actor, { repo: getLineRepo('tabaco'), now: () => NOW });
}

const producto = (sku: string, attrs: Record<string, string | number> = {}): ProductInput => ({
  sku,
  name: `Toro de prueba ${sku}`,
  brandLine: 'De mazo (sin marca)',
  kind: 'mazo',
  cost: 2,
  priceToStore: 5,
  suggestedRetail: 9,
  sellerCommission: { type: 'percent', value: 8 },
  lowStockThreshold: 10,
  packSize: 50,
  unitName: 'mazo',
  attrs: { vitola: 'Toro', lengthIn: 6.125, ringGauge: 52, capa: 'maduro', strength: 'media', cigarsPerBundle: 25, ...attrs },
});

describe('un producto sin procedencia ni región', () => {
  beforeAll(async () => {
    setDbPrefix('pruebas-procedencia-');
    await resetDemo(NOW);
  });

  it('se crea por el servicio, sin los campos o con los campos en blanco, y se ve en el catálogo', async () => {
    const ctx = await adminCtx();
    const sin = await saveProduct(ctx, producto('TB-SIN-ORIGEN-1'));
    expect(sin.attrs.originCountry).toBeUndefined();
    const vacio = await saveProduct(ctx, producto('TB-SIN-ORIGEN-2', { originCountry: '', originRegion: '' }));
    expect(vacio.attrs.originCountry).toBe('');
    const ids = (await listProducts(ctx)).map((v) => v.product.id);
    expect(ids).toContain(sin.id);
    expect(ids).toContain(vacio.id);
    // Y se edita igual (sigue sin procedencia).
    const editado = await saveProduct(ctx, { ...producto('TB-SIN-ORIGEN-1'), id: sin.id, priceToStore: 6 });
    expect(editado.priceToStore).toBe(6);
    expect(editado.attrs.originCountry).toBeUndefined();
  });

  it('con procedencia llena, como antes; con Cuba, rechazado', async () => {
    const ctx = await adminCtx();
    const nic = await saveProduct(ctx, producto('TB-CON-ORIGEN', { originCountry: 'Nicaragua', originRegion: 'Estelí' }));
    expect(nic.attrs).toMatchObject({ originCountry: 'Nicaragua', originRegion: 'Estelí' });
    await expect(saveProduct(ctx, producto('TB-CUBA', { originCountry: 'Cuba' }))).rejects.toThrow(ValidationError);
    await expect(saveProduct(ctx, producto('TB-CUBA-2', { originCountry: 'Pinar del Río, Cuba' }))).rejects.toThrow(/Cuba/);
    expect((await getLineRepo('tabaco').products.all()).some((p) => p.sku.startsWith('TB-CUBA'))).toBe(false);
  });

  it('el filtro de procedencia ofrece «Sin procedencia», al final, y filtra bien', async () => {
    const ctx = await adminCtx();
    const views = await listProducts(ctx);
    const facet = buildFacets(views, ['originCountry'], {}).find((f) => f.key === 'originCountry')!;
    expect(facet.options.at(-1)).toMatchObject({ value: SIN_PROCEDENCIA, label: 'Sin procedencia' });
    expect(facet.options.every((o) => o.label.trim() !== '' && !o.label.includes('undefined'))).toBe(true);
    expect(facetLabel('originCountry', SIN_PROCEDENCIA)).toBe('Sin procedencia');
    const sinProcedencia = applyFilters(views, { originCountry: [SIN_PROCEDENCIA] }).map((v) => v.product.sku);
    expect(sinProcedencia).toEqual(expect.arrayContaining(['TB-SIN-ORIGEN-1', 'TB-SIN-ORIGEN-2']));
    expect(sinProcedencia).not.toContain('TB-CON-ORIGEN');
    expect(applyFilters(views, { originCountry: ['Nicaragua'] }).map((v) => v.product.sku)).not.toContain('TB-SIN-ORIGEN-1');
  });

  it('se pide para un local (entrega) como cualquier otro', async () => {
    const ctx = await adminCtx();
    const p = (await getLineRepo('tabaco').products.all()).find((x) => x.sku === 'TB-SIN-ORIGEN-1')!;
    const faro = (await getLineRepo('tabaco').stores.all()).find((s) => s.name === 'Tabaquería El Faro')!;
    const d = await requestDelivery(ctx, { storeId: faro.id, items: [{ productId: p.id, qty: 2 }] });
    expect(d.items.map((i) => i.productId)).toContain(p.id);
  });
});

describe('importar sin procedencia', () => {
  beforeAll(async () => {
    setDbPrefix('pruebas-procedencia-importar-');
    await resetDemo(NOW);
    await startBlank(await adminCtx(), 'Tabaco');
  });

  it('con la procedencia por defecto en blanco: sin error ni aviso, y los productos quedan sin procedencia', async () => {
    const ctx = await adminCtx();
    const buf = readFileSync(join(__dirname, '..', 'fixtures', 'odoo-variantes.xlsx'));
    const table = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const map = detectColumns(table.headers);
    const options: ImportOptions = { ...defaultImportOptions('tabaco'), origin: '' };
    const plan = await previewImport(ctx, { table, map, options, fileName: 'odoo-variantes.xlsx' });
    expect(plan.counts.conErrores).toBe(0);
    expect(plan.notices.some((n) => /procedencia/i.test(n))).toBe(false);
    expect(plan.rows.flatMap((r) => [...r.warnings, ...r.errors]).some((w) => /procedencia/i.test(w))).toBe(false);
    const result = await runImport(ctx, { table, map, options, fileName: 'odoo-variantes.xlsx' });
    expect(result.created).toBe(18);
    const products = await getLineRepo('tabaco').products.all();
    expect(products.every((p) => String(p.attrs.originCountry ?? '') === '')).toBe(true);
  });

  it('la procedencia por defecto puede seguir siendo «Nicaragua», y Cuba sigue rechazada', async () => {
    const ctx = await adminCtx();
    const buf = readFileSync(join(__dirname, '..', 'fixtures', 'odoo-variantes.xlsx'));
    const table = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const map = detectColumns(table.headers);
    expect(defaultImportOptions('tabaco').origin).toBe('Nicaragua');
    await expect(previewImport(ctx, { table, map, options: { ...defaultImportOptions('tabaco'), origin: 'Cuba' }, fileName: 'x.xlsx' })).rejects.toThrow(/Cuba/);
  });
});
