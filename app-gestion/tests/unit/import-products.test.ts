// Importar productos desde el Excel o CSV de Odoo: columnas, nombres, familias y variantes,
// y la creación con su inventario inicial (sin duplicar al volver a importar).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Movement, Product } from '../../src/data/types';
import { getLineRepo, setDbPrefix } from '../../src/data';
import {
  type ColumnMap,
  type ImportOptions,
  buildImportPlan,
  defaultImportOptions,
  derivedSku,
  detectColumns,
  optionErrors,
  parseSize,
  parseTabacoName,
  parseVariantValues,
} from '../../src/domain/import-products';
import { WAREHOUSE, Balances, findNegative } from '../../src/domain/ledger';
import { type SheetTable, readCsvText, readXlsx } from '../../src/lib/sheets';
import type { Actor } from '../../src/domain/permissions';
import { previewImport, runImport } from '../../src/services/catalog-import';
import { saveProduct } from '../../src/services/catalog';
import { ForbiddenError, ValidationError, lineCtx } from '../../src/services/context';
import { startBlank } from '../../src/services/real-data';
import { findAccount, resetDemo } from '../../src/services/session';

const NOW = new Date('2026-11-05T15:00:00Z');
const FIXTURES = join(__dirname, '..', 'fixtures');

async function xlsxTable(): Promise<SheetTable> {
  const buf = readFileSync(join(FIXTURES, 'odoo-variantes.xlsx'));
  return readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

async function csvTable(): Promise<SheetTable> {
  return readCsvText(readFileSync(join(FIXTURES, 'odoo-variantes-completo.csv'), 'utf8'));
}

const tabacoOpts = (patch: Partial<ImportOptions> = {}): ImportOptions => ({ ...defaultImportOptions('tabaco'), ...patch });
const plan = (table: SheetTable, opts = tabacoOpts(), existing: Product[] = [], qty = new Map<string, number>()) =>
  buildImportPlan('tabaco', table, detectColumns(table.headers), opts, existing, qty);

describe('columnas de Odoo', () => {
  it('la exportación corta en español (la de la empresa)', () => {
    expect(detectColumns(['Nombre para mostrar', 'Cantidad real', 'Cantidad disponible', 'Categoría de producto/Nombre completo'])).toEqual({ name: 0, qty: 1, category: 3 });
  });

  it('la misma en inglés', () => {
    expect(detectColumns(['Display Name', 'Quantity On Hand', 'Available Quantity', 'Product Category/Complete Name'])).toEqual({ name: 0, qty: 1, category: 3 });
    expect(detectColumns(['Name', 'Free To Use Quantity', 'Product Category'])).toEqual({ name: 0, qty: 1, category: 2 });
  });

  it('la exportación completa de product.product, en español y en inglés', () => {
    const es = ['Nombre', 'Nombre para mostrar', 'Referencia interna', 'Código de barras', 'Precio de venta', 'Coste', 'Cantidad a mano', 'Cantidad disponible', 'Categoría del producto', 'Valores de atributo de variante'];
    expect(detectColumns(es)).toEqual({ name: 1, sku: 2, barcode: 3, price: 4, cost: 5, qty: 6, category: 8, variantValues: 9 });
    const en = ['Name', 'Display Name', 'Internal Reference', 'Barcode', 'Sales Price', 'Cost', 'Quantity On Hand', 'Free To Use Quantity', 'Product Category', 'Variant Values', 'Country of Origin'];
    expect(detectColumns(en)).toEqual({ name: 1, sku: 2, barcode: 3, price: 4, cost: 5, qty: 6, category: 8, variantValues: 9, origin: 10 });
    expect(detectColumns(['Name', 'Attribute Values']).variantValues).toBe(1);
  });

  it('otras hojas con encabezados parecidos', () => {
    expect(detectColumns(['Producto', 'SKU', 'Precio', 'Existencias', 'Costo unitario'])).toEqual({ name: 0, sku: 1, price: 2, qty: 3, cost: 4 });
    expect(detectColumns(['Código', 'Descripción del artículo', 'Cantidad en bodega'])).toEqual({ sku: 0, name: 1, qty: 2 });
  });
});

describe('el nombre de Odoo', () => {
  it('lee la medida con X o x, fracciones y decimales', () => {
    const len = (t: string) => parseSize(t)?.lengthIn;
    expect(parseSize('6x52 Toro')).toMatchObject({ lengthIn: 6, ringGauge: 52 });
    expect(parseSize('6X52')).toMatchObject({ lengthIn: 6, ringGauge: 52 });
    expect(len('6⅛x52 Torpedo')).toBe(6.125);
    expect(len('4½x60')).toBe(4.5);
    expect(len('7¼x58 Salomón')).toBe(7.25);
    expect(len('6½X54 Aleta')).toBe(6.5);
    expect(len('6 1/2x54')).toBe(6.5);
    expect(len('6.5x54')).toBe(6.5);
    expect(len('6,5 x 54')).toBe(6.5);
    expect(parseSize('6 × 52')?.ringGauge).toBe(52);
    expect(parseSize('Brisa Azul 5 Pack')).toBeNull();
    expect(parseSize('25x2')).toBeNull();
  });

  it('separa referencia, vitola, forma y capa', () => {
    expect(parseTabacoName('[ABC-101] 6x52 Toro')).toMatchObject({ ref: 'ABC-101', size: { lengthIn: 6, ringGauge: 52 }, vitola: 'Toro', capa: null, words: ['Toro'], branded: false });
    expect(parseTabacoName('[ABC-103] 6⅛x52 Torpedo Box Press Connecticut')).toMatchObject({ vitola: 'Torpedo', shape: 'Box Press', capa: 'connecticut', words: ['Torpedo', 'Box Press'] });
    expect(parseTabacoName('6½X54 Aleta Conneticut')).toMatchObject({ vitola: 'Aleta', capa: 'connecticut' });
    expect(parseTabacoName('7¼x58 Salomon').vitola).toBe('Salomón');
    expect(parseTabacoName('7x70 Big Cigars Maduro')).toMatchObject({ vitola: 'Big Cigars', capa: 'maduro', words: ['Big Cigars'] });
    expect(parseTabacoName('6x60 Super Gordo').vitola).toBe('Super Gordo');
    expect(parseTabacoName('4½x60')).toMatchObject({ vitola: '', words: [] });
    expect(parseTabacoName('6x64 Box Press')).toMatchObject({ shape: 'Box Press', words: ['Box Press'], branded: false });
  });

  it('reconoce los paquetes premium con marca', () => {
    expect(parseTabacoName('Brisa Azul Box Hab')).toMatchObject({ branded: true, brand: 'Brisa Azul', capa: 'habano', words: ['Brisa', 'Azul', 'Box'] });
    expect(parseTabacoName('Brisa Azul Box Mad').capa).toBe('maduro');
    expect(parseTabacoName('Brisa Azul 5 Pack')).toMatchObject({ branded: true, brand: 'Brisa Azul', capa: null });
    expect(parseTabacoName('Brisa Azul mazos 25')).toMatchObject({ branded: true, brand: 'Brisa Azul' });
    expect(parseTabacoName('Mazos Premium')).toMatchObject({ branded: true, brand: '' });
  });

  it('sin referencia, el SKU sale del nombre y siempre es el mismo', () => {
    expect(derivedSku('6x64 Box Press')).toBe('SIN-REF-6X64-BOX-PRESS');
    expect(derivedSku('6½x54 Toro')).toBe(derivedSku('6 1/2x54 Toro'));
    expect(derivedSku('6½x54 Toro')).not.toBe(derivedSku('6x54 Toro'));
    const long = derivedSku('7x70 Big Cigars Maduro Edición Especial de Aniversario');
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toBe(derivedSku('7x70 Big Cigars Maduro Edición Especial de Aniversario'));
  });

  it('lee los valores de la variante', () => {
    expect(parseVariantValues('Molido: Espresso, Peso: 10 oz')).toEqual([
      { name: 'Molido', value: 'Espresso' },
      { name: 'Peso', value: '10 oz' },
    ]);
    expect(parseVariantValues('Grano, 2 lb')).toEqual([
      { name: '', value: 'Grano' },
      { name: '', value: '2 lb' },
    ]);
  });
});

describe('vista previa del Excel corto (sin precios ni costos)', () => {
  it('cuenta lo que se crea, con avisos y sin errores', async () => {
    const p = plan(await xlsxTable());
    expect(p.rows).toHaveLength(18);
    expect(p.counts).toEqual({ nuevos: 18, actualizan: 0, conAvisos: 8, conErrores: 0 });
    expect(p.notices).toContain('La cantidad del archivo reemplaza la del almacén.');
    expect(p.notices.some((n) => n.startsWith('Falta el costo'))).toBe(true);
    expect(p.notices.some((n) => n.includes('no trae precios'))).toBe(true);
  });

  it('arma la familia «Toro 6 × 52» con sus variantes Habano, Maduro y Connecticut', async () => {
    const p = plan(await xlsxTable());
    const toro = p.rows.filter((r) => r.familyName === 'Toro 6 × 52');
    expect(toro.map((r) => r.sku)).toEqual(['ABC-101', 'ABC-102', 'ABC-107']);
    expect(new Set(toro.map((r) => r.familyId)).size).toBe(1);
    expect(toro.map((r) => r.variantLabel)).toEqual(['Habano', 'Maduro', 'Connecticut']);
    expect(toro.map((r) => r.name)).toEqual(['Toro 6 × 52 · Habano', 'Toro 6 × 52 · Maduro', 'Toro 6 × 52 · Connecticut']);
    for (const r of toro) {
      expect(r).toMatchObject({ kind: 'mazo', unitName: 'mazo', packSize: 50, brandLine: 'De mazo (sin marca)' });
      expect(r.attrs).toMatchObject({ vitola: 'Toro', lengthIn: 6, ringGauge: 52, cigarsPerBundle: 25, strength: 'media', originCountry: 'Nicaragua' });
    }
    expect(toro[0]!.qty).toBe(120);
    expect(toro[0]!.attrs.wrapperShade).toBe('colorado');
  });

  it('la forma va en la familia; la capa del nombre manda sobre la categoría (con aviso)', async () => {
    const p = plan(await xlsxTable());
    const torpedo = p.rows.find((r) => r.sku === 'ABC-103')!;
    expect(torpedo.familyName).toBe('Torpedo Box Press 6⅛ × 52');
    expect(torpedo.attrs).toMatchObject({ vitola: 'Torpedo', capa: 'connecticut', lengthIn: 6.125, ringGauge: 52 });
    expect(torpedo.warnings.join(' ')).toMatch(/El nombre dice Connecticut y la categoría Habano/);
    const aleta = p.rows.find((r) => r.sku === 'ABC-106')!;
    expect(aleta).toMatchObject({ familyName: 'Aleta 6½ × 54', name: 'Aleta 6½ × 54 · Connecticut' });
    expect(aleta.warnings).toContain('Sin categoría.');
    expect(p.rows.find((r) => r.sku === 'ABC-104')).toMatchObject({ familyName: '4½ × 60', attrs: expect.objectContaining({ vitola: '' }) });
    expect(p.rows.find((r) => r.sku === 'ABC-105')?.familyName).toBe('Salomón 7¼ × 58');
    // «Conneticut» en la categoría es Connecticut, sin aviso.
    expect(p.rows.find((r) => r.sku === 'ABC-107')?.warnings).toEqual([]);
  });

  it('las filas sin referencia quedan con un SKU del nombre y un aviso', async () => {
    const p = plan(await xlsxTable());
    const box = p.rows.find((r) => r.source === '6x64 Box Press')!;
    expect(box).toMatchObject({ sku: 'SIN-REF-6X64-BOX-PRESS', familyName: 'Box Press 6 × 64', status: 'nuevo' });
    expect(box.warnings[0]).toMatch(/Sin referencia/);
    const big = p.rows.find((r) => r.source === '7x70 Big Cigars Maduro')!;
    expect(big).toMatchObject({ sku: 'SIN-REF-7X70-BIG-CIGARS-MADURO', familyName: 'Big Cigars 7 × 70', name: 'Big Cigars 7 × 70 · Maduro' });
  });

  it('los premium son paquetes con marca, por unidad, y su familia es el nombre sin la capa', async () => {
    const p = plan(await xlsxTable());
    const boxes = p.rows.filter((r) => r.familyName === 'Brisa Azul Box');
    expect(boxes.map((r) => r.name)).toEqual(['Brisa Azul Box · Habano', 'Brisa Azul Box · Maduro']);
    expect(new Set(boxes.map((r) => r.familyId)).size).toBe(1);
    for (const r of boxes) expect(r).toMatchObject({ kind: 'premium', unitName: 'unidad', packSize: 1, brandLine: 'Brisa Azul', attrs: expect.objectContaining({ brand: 'Brisa Azul' }) });
    const pack = p.rows.find((r) => r.sku === 'ABC-203')!;
    expect(pack).toMatchObject({ kind: 'premium', name: 'Brisa Azul 5 Pack', qty: 20, priceToStore: 40, suggestedRetail: 70 });
    expect(pack.warnings).toContain('No dice la capa: queda Habano.');
    expect(p.rows.find((r) => r.source === 'Mazos Premium')).toMatchObject({ kind: 'premium', brandLine: 'Premium', sku: 'SIN-REF-MAZOS-PREMIUM' });
  });

  it('precios y costos por defecto: PVP = precio × 1.75 y costo en 0 marcado de ejemplo', async () => {
    const p = plan(await xlsxTable());
    const r = p.rows.find((x) => x.sku === 'ABC-101')!;
    expect(r).toMatchObject({ priceToStore: 25, suggestedRetail: 43.75, cost: 0, priceFromFile: false, costFromFile: false });
    const custom = plan(await xlsxTable(), tabacoOpts({ defaultPrice: 30, defaultCost: 12 }));
    expect(custom.rows[0]).toMatchObject({ priceToStore: 30, suggestedRetail: 52.5, cost: 12 });
  });

  it('las cantidades en cajas o en tabacos se pasan a mazos (hacia abajo, con aviso)', async () => {
    const enTabacos = plan(await xlsxTable(), tabacoOpts({ qtyUnit: 'tabaco' }));
    const r = enTabacos.rows.find((x) => x.sku === 'ABC-101')!;
    expect(r.qty).toBe(4);
    expect(r.warnings.join(' ')).toMatch(/120 tabacos son 4 mazos y sobran 20/);
    expect(enTabacos.rows.find((x) => x.sku === 'ABC-203')?.qty).toBe(20);
    const enCajas = plan(await xlsxTable(), tabacoOpts({ qtyUnit: 'caja' }));
    expect(enCajas.rows.find((x) => x.sku === 'ABC-101')?.qty).toBe(6000);
    expect(enCajas.rows.find((x) => x.sku === 'ABC-203')?.qty).toBe(20);
  });

  it('si dos productos del catálogo comparten el SKU, esa fila no se carga (no adivina cuál)', async () => {
    const twin = (id: string) => ({ id, sku: 'ABC-101', unitName: 'mazo', packSize: 50, name: id, attrs: {}, photoIds: [] }) as unknown as Product;
    const p = plan(await xlsxTable(), tabacoOpts(), [twin('uno'), twin('dos')]);
    expect(p.rows.find((r) => r.sku === 'ABC-101')).toMatchObject({ status: 'error', errors: [expect.stringMatching(/más de un producto con el SKU ABC-101/)] });
    expect(p.counts.conErrores).toBe(1);
  });

  it('con «Procedencia: Cuba» no se carga ninguna fila', async () => {
    const opts = tabacoOpts({ origin: 'Cuba' });
    const table = await xlsxTable();
    expect(optionErrors('tabaco', opts, detectColumns(table.headers)).join(' ')).toMatch(/Cuba/);
    const p = plan(table, opts);
    expect(p.counts.conErrores).toBe(18);
    expect(p.rows.every((r) => r.errors.some((e) => /Cuba/.test(e)))).toBe(true);
  });
});

describe('vista previa de la exportación completa (inglés, con precios y costos)', () => {
  it('usa la referencia, el código de barras, los precios y los valores de la variante', async () => {
    const p = plan(await csvTable());
    const toro = p.rows.find((r) => r.sku === 'GM-301')!;
    expect(toro).toMatchObject({ barcode: '2000000300016', familyName: 'Toro 6 × 52', name: 'Toro 6 × 52 · Maduro', priceToStore: 27.5, cost: 11.2, costFromFile: true, qty: 40 });
    expect(toro.suggestedRetail).toBeCloseTo(27.5 * 1.75, 1);
    expect(toro.warnings).toEqual([]);
    expect(p.rows.find((r) => r.sku === 'GM-303')).toMatchObject({ name: 'Robusto 5 × 50 · Connecticut', attrs: expect.objectContaining({ originCountry: 'Honduras' }), warnings: [] });
    const boxes = p.rows.filter((r) => r.familyName === 'Brisa Azul Box').map((r) => r.name);
    expect(boxes).toEqual(['Brisa Azul Box · Habano', 'Brisa Azul Box · Maduro']);
  });

  it('el origen Cuba es un error de esa fila; sin precio, se avisa', async () => {
    const p = plan(await csvTable());
    expect(p.rows.find((r) => r.sku === 'GM-305')).toMatchObject({ status: 'error', errors: [expect.stringMatching(/Cuba/)] });
    expect(p.rows.find((r) => r.sku === 'GM-306')?.warnings).toContain('Sin precio: queda en $25.00.');
    expect(p.counts).toEqual({ nuevos: 7, actualizan: 0, conAvisos: 1, conErrores: 1 });
  });
});

describe('café', () => {
  const csv = [
    'Nombre,Nombre para mostrar,Referencia interna,Precio de venta,Coste,Cantidad a mano,Valores de atributo de variante',
    'Café de la Casa de prueba,[CF-T1] Café de la Casa de prueba (Espresso; 10 oz),CF-T1,4.10,2.35,144,"Molido: Espresso, Peso: 10 oz"',
    'Café de la Casa de prueba,[CF-T2] Café de la Casa de prueba (En grano; 2 lb),CF-T2,14.50,8.10,24,"Molido: En grano, Peso: 2 lb, Tueste: Oscuro"',
  ].join('\n');

  it('la familia es el nombre sin los valores; la variante, el molido y el peso', async () => {
    const table = await readCsvText(csv);
    const p = buildImportPlan('cafe', table, detectColumns(table.headers), defaultImportOptions('cafe'), [], new Map());
    expect(p.counts.conErrores).toBe(0);
    const [a, b] = p.rows;
    expect(a).toMatchObject({ familyName: 'Café de la Casa de prueba', variantLabel: 'Espresso · 10 oz', name: 'Café de la Casa de prueba · Espresso · 10 oz', unitName: 'unidad', packSize: 12, qty: 144 });
    expect(a!.attrs).toMatchObject({ grind: 'Espresso', weight: '10 oz', roast: 'medio', productionLine: 'Línea 1 · Espresso' });
    expect(b!.attrs).toMatchObject({ grind: 'En grano', weight: '2 lb', roast: 'oscuro' });
    expect(a!.familyId).toBe(b!.familyId);
    expect(a!.kind).toBeUndefined();
  });

  it('sin columna de valores, los toma de los paréntesis del nombre', async () => {
    const table = await readCsvText('Display Name,Quantity On Hand\n[CF-T3] Café Molido de prueba (Grano; 2 lb),12\n');
    const p = buildImportPlan('cafe', table, detectColumns(table.headers), defaultImportOptions('cafe'), [], new Map());
    expect(p.rows[0]).toMatchObject({ sku: 'CF-T3', familyName: 'Café Molido de prueba', attrs: expect.objectContaining({ grind: 'Grano', weight: '2 lb' }) });
  });
});

// ---------- Creación en la base ----------

async function adminCtx(line: 'tabaco' | 'cafe', opts: { readOnly?: boolean; hoursLater?: number } = {}) {
  const acc = (await findAccount(`${line}:admin`))!;
  const actor: Actor = { accountId: acc.id, userId: acc.userId, role: 'admin', line, name: acc.name, readOnly: opts.readOnly ?? false };
  const at = new Date(NOW.getTime() + (opts.hoursLater ?? 0) * 3_600_000);
  return lineCtx(line, actor, { repo: getLineRepo(line), now: () => at });
}

function withQty(table: SheetTable, changes: Record<string, number>): SheetTable {
  return { headers: table.headers, rows: table.rows.map((r) => (changes[r[0]!] !== undefined ? [r[0]!, String(changes[r[0]!]), String(changes[r[0]!]), r[3]!] : r)) };
}

describe('crear los productos del archivo', () => {
  let table: SheetTable;
  let map: ColumnMap;

  beforeAll(async () => {
    setDbPrefix('pruebas-importar-');
    await resetDemo(NOW);
    await startBlank(await adminCtx('tabaco'), 'Tabaco');
    table = await xlsxTable();
    map = detectColumns(table.headers);
  });

  it('solo administración, sin «ver como»', async () => {
    const seller = (await findAccount('cafe:seller'))!;
    const sellerCtx = lineCtx('cafe', { accountId: seller.id, userId: seller.userId, role: 'seller', line: 'cafe', name: seller.name, readOnly: false }, { repo: getLineRepo('cafe') });
    await expect(runImport(sellerCtx, { table, map, options: defaultImportOptions('cafe'), fileName: 'x.xlsx' })).rejects.toThrow(ForbiddenError);
    await expect(runImport(await adminCtx('tabaco', { readOnly: true }), { table, map, options: tabacoOpts(), fileName: 'x.xlsx' })).rejects.toThrow(ForbiddenError);
  });

  it('con «Procedencia: Cuba» se rechaza y no se crea nada', async () => {
    const ctx = await adminCtx('tabaco');
    await expect(runImport(ctx, { table, map, options: tabacoOpts({ origin: 'República de Cuba' }), fileName: 'odoo.xlsx' })).rejects.toThrow(/Cuba/);
    expect(await getLineRepo('tabaco').products.count()).toBe(0);
  });

  it('crea las familias y variantes y el inventario inicial por lote', async () => {
    const ctx = await adminCtx('tabaco');
    const preview = await previewImport(ctx, { table, map, options: tabacoOpts(), fileName: 'odoo-variantes.xlsx' });
    expect(preview.counts.nuevos).toBe(18);
    const result = await runImport(ctx, { table, map, options: tabacoOpts(), fileName: 'odoo-variantes.xlsx' });
    expect(result).toMatchObject({ created: 18, updated: 0, skipped: 0, movements: 17 });

    const repo = getLineRepo('tabaco');
    const products = await repo.products.all();
    expect(products).toHaveLength(18);
    const toro = products.filter((p) => p.familyName === 'Toro 6 × 52');
    expect(toro.map((p) => p.name).sort()).toEqual(['Toro 6 × 52 · Connecticut', 'Toro 6 × 52 · Habano', 'Toro 6 × 52 · Maduro']);
    expect(new Set(toro.map((p) => p.familyId)).size).toBe(1);
    for (const p of products) {
      expect(p.sampleCost).toBe(true);
      expect(p.cost).toBe(0);
      expect(p.suggestedRetail).toBeGreaterThanOrEqual(p.priceToStore);
      expect(p.priceToStore).toBeGreaterThan(0);
    }

    const movements = (await repo.movements.all()) as Movement[];
    expect(movements).toHaveLength(17);
    for (const m of movements) expect(m).toMatchObject({ type: 'inventario_inicial', from: { kind: 'supplier' }, to: { kind: 'warehouse' }, refType: 'import', refId: result.importId });
    const lots = await repo.lots.all();
    expect(lots).toHaveLength(17);
    expect(lots.every((l) => l.unitCost === 0 && l.arrivalId === null && l.code.startsWith('INI-20261105-'))).toBe(true);
    expect(findNegative(movements)).toBeNull();
    const b = Balances.from(movements);
    const abc101 = products.find((p) => p.sku === 'ABC-101')!;
    expect(b.qty(WAREHOUSE, abc101.id)).toBe(120);
    const audit = await repo.audit.all();
    expect(audit.at(-1)).toMatchObject({ action: 'productos.importar' });
    expect(audit.at(-1)?.summary).toMatch(/18 productos nuevos/);
  });

  it('volver a importar no duplica: actualiza y deja el almacén con la cantidad del archivo', async () => {
    const ctx = await adminCtx('tabaco', { hoursLater: 1 });
    const repo = getLineRepo('tabaco');
    // Lo que cambió en la oficina después de la primera importación se respeta.
    const abc101 = (await repo.products.all()).find((p) => p.sku === 'ABC-101')!;
    await repo.products.put({ ...abc101, priceToStore: 30, suggestedRetail: 50, attrs: { ...abc101.attrs, strength: 'fuerte' } });

    const changed = withQty(table, { '[ABC-101] 6x52 Toro': 100, '[ABC-102] 6X52 Toro Maduro': 95, '[ABC-110] 7x48 Churchill': 5 });
    const preview = await previewImport(ctx, { table: changed, map, options: tabacoOpts(), fileName: 'odoo-2.xlsx' });
    expect(preview.counts).toMatchObject({ nuevos: 0, actualizan: 18, conErrores: 0 });
    expect(preview.rows.find((r) => r.sku === 'ABC-101')).toMatchObject({ currentQty: 120, qty: 100 });
    const result = await runImport(ctx, { table: changed, map, options: tabacoOpts(), fileName: 'odoo-2.xlsx' });
    expect(result).toMatchObject({ created: 0, updated: 18, movements: 3 });

    const products = await repo.products.all();
    expect(products).toHaveLength(18);
    const after101 = products.find((p) => p.sku === 'ABC-101')!;
    expect(after101).toMatchObject({ id: abc101.id, priceToStore: 30, suggestedRetail: 50, name: 'Toro 6 × 52 · Habano' });
    expect(after101.attrs.strength).toBe('fuerte');

    const movements = (await repo.movements.all()) as Movement[];
    const mine = movements.filter((m) => m.refId === result.importId);
    expect(mine.map((m) => m.type).sort()).toEqual(['ajuste', 'ajuste', 'inventario_inicial']);
    expect(findNegative(movements)).toBeNull();
    const b = Balances.from(movements);
    const qty = (sku: string) => b.qty(WAREHOUSE, products.find((p) => p.sku === sku)!.id);
    expect(qty('ABC-101')).toBe(100);
    expect(qty('ABC-102')).toBe(95);
    expect(qty('ABC-110')).toBe(5);
    expect(qty('ABC-103')).toBe(35);

    // Una tercera vez, igual: nada que mover.
    const again = await runImport(await adminCtx('tabaco', { hoursLater: 2 }), { table: changed, map, options: tabacoOpts(), fileName: 'odoo-2.xlsx' });
    expect(again).toMatchObject({ created: 0, updated: 18, movements: 0 });
    expect(await repo.products.count()).toBe(18);
  });

  it('una variante nueva le pone su capa a la que estaba sola en la familia', async () => {
    const ctx = await adminCtx('tabaco', { hoursLater: 3 });
    const head = ['Nombre para mostrar', 'Cantidad real'];
    await runImport(ctx, { table: { headers: head, rows: [['[XYZ-1] Coral Sur Box Hab', '2']] }, map: { name: 0, qty: 1 }, options: tabacoOpts(), fileName: 'a.csv' });
    const repo = getLineRepo('tabaco');
    expect((await repo.products.all()).find((p) => p.sku === 'XYZ-1')?.name).toBe('Coral Sur Box');
    await runImport(ctx, { table: { headers: head, rows: [['[XYZ-2] Coral Sur Box Mad', '1']] }, map: { name: 0, qty: 1 }, options: tabacoOpts(), fileName: 'b.csv' });
    const all = await repo.products.all();
    expect(all.find((p) => p.sku === 'XYZ-1')?.name).toBe('Coral Sur Box · Habano');
    expect(all.find((p) => p.sku === 'XYZ-2')?.name).toBe('Coral Sur Box · Maduro');
  });

  it('el producto importado se puede editar luego con las reglas del catálogo', async () => {
    const ctx = await adminCtx('tabaco');
    const repo = getLineRepo('tabaco');
    const p = (await repo.products.all()).find((x) => x.sku === 'ABC-102')!;
    const saved = await saveProduct(ctx, { ...p, cost: 11, familyName: p.familyName });
    expect(saved).toMatchObject({ id: p.id, name: 'Toro 6 × 52 · Maduro', sampleCost: false, cost: 11 });
  });

  it('en café, con el código de barras como llave, y sin tocar el almacén si no hay cantidades', async () => {
    const ctx = await adminCtx('cafe');
    const before = await getLineRepo('cafe').movements.count();
    const t = await readCsvText('Name,Barcode,Variant Values,Sales Price\nCafé de Prueba,2000000990011,"Grind: Espresso, Weight: 10 oz",4.5\n');
    const first = await runImport(ctx, { table: t, map: detectColumns(t.headers), options: defaultImportOptions('cafe'), fileName: 'cafe.csv' });
    expect(first).toMatchObject({ created: 1, movements: 0 });
    const t2 = await readCsvText('Name,Barcode,Variant Values,Sales Price\nCafé de Prueba Nuevo Nombre,2000000990011,"Grind: Espresso, Weight: 10 oz",4.75\n');
    const second = await runImport(ctx, { table: t2, map: detectColumns(t2.headers), options: defaultImportOptions('cafe'), fileName: 'cafe.csv' });
    expect(second).toMatchObject({ created: 0, updated: 1 });
    const mine = (await getLineRepo('cafe').products.all()).filter((p) => p.barcode === '2000000990011');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ priceToStore: 4.75, familyName: 'Café de Prueba Nuevo Nombre' });
    expect(await getLineRepo('cafe').movements.count()).toBe(before);
  });

  it('no deja crear nada si todas las filas tienen errores', async () => {
    const ctx = await adminCtx('tabaco');
    await expect(
      runImport(ctx, { table: { headers: ['Nombre'], rows: [['Toro Maduro sin medida']] }, map: { name: 0 }, options: tabacoOpts(), fileName: 'mal.csv' }),
    ).rejects.toThrow(ValidationError);
  });
});
