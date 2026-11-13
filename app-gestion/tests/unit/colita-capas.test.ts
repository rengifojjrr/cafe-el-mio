// Ronda 5: los Behike con su colita y solo cuatro capas (Habano, Maduro, Connecticut, Doble Capa).
// Lo que no cambia: los productos con una capa que ya no se ofrece se ven, se filtran, se editan y
// se exportan como siempre.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Product } from '../../src/data/types';
import { getLineRepo, setDbPrefix } from '../../src/data';
import { headShape, headTaper, pointLength } from '../../src/domain/cabeza';
import { applyFilters, buildFacets } from '../../src/domain/catalog-filters';
import { buildImportPlan, capaFromWords, defaultImportOptions, detectColumns, parseTabacoName } from '../../src/domain/import-products';
import { parsePastedOrder } from '../../src/domain/paste-order';
import type { Actor } from '../../src/domain/permissions';
import { CAPAS_ANTIGUAS, CAPAS_OFRECIDAS, CAPAS_RECONOCIDAS, capaFromText, capaLabel, capaShade, esCapaAntigua } from '../../src/domain/products';
import { matchPackingProduct } from '../../src/domain/receiving';
import { labelLines } from '../../src/features/labels/specs';
import { readCsvText } from '../../src/lib/sheets';
import { lineConfig } from '../../src/lines/config';
import { buildLine } from '../../src/seed';
import { type ProductInput, listProducts, saveProduct } from '../../src/services/catalog';
import { previewImport, runImport } from '../../src/services/catalog-import';
import { lineCtx } from '../../src/services/context';
import { exportLine, startBlank } from '../../src/services/real-data';
import { findAccount, resetDemo } from '../../src/services/session';
import { CigarSilhouette } from '../../src/ui/brand';

const NOW = new Date('2026-11-13T15:00:00Z');

async function adminCtx() {
  const acc = (await findAccount('tabaco:admin'))!;
  const actor: Actor = { accountId: acc.id, userId: acc.userId, role: 'admin', line: 'tabaco', name: acc.name, readOnly: false };
  return lineCtx('tabaco', actor, { repo: getLineRepo('tabaco'), now: () => NOW });
}

const behike = (attrs: Record<string, string | number> = {}, familyName = 'Behike') => ({
  name: `${familyName} · Habano · 6 × 52`,
  familyName,
  attrs: { vitola: 'Toro Aleta', lengthIn: 6, ringGauge: 52, capa: 'habano', ...attrs },
});

describe('la cabeza: redonda, en punta o con colita', () => {
  it('un Behike de mazo lleva colita, se escriba como se escriba', () => {
    expect(headShape(behike())).toBe('colita');
    expect(headShape(behike({}, 'BEHIKE'))).toBe('colita');
    expect(headShape(behike({}, 'behíke'))).toBe('colita');
    // En el nombre o en la vitola también; y «colita», «rabito» o «pigtail».
    expect(headShape({ name: 'Línea Behike 56', attrs: { vitola: 'Toro' } })).toBe('colita');
    expect(headShape({ name: 'Toro', attrs: { vitola: 'Toro con Colita' } })).toBe('colita');
    expect(headShape({ name: 'Robusto Rabito', attrs: { vitola: 'Robusto' } })).toBe('colita');
    expect(headShape({ name: 'Corona', attrs: { vitola: 'Pigtail Corona' } })).toBe('colita');
  });

  it('Toro: redonda. Torpedo, pirámide, figurado y salomón: en punta; el belicoso, más corta', () => {
    expect(headShape({ name: 'Toro 6 × 52 · Maduro', familyName: 'Toro 6 × 52', attrs: { vitola: 'Toro' } })).toBe('redonda');
    expect(headShape({ name: 'Torpedo 6⅛ × 52 · Maduro', familyName: 'Torpedo 6⅛ × 52', attrs: { vitola: 'Torpedo' } })).toBe('punta');
    for (const v of ['Pirámide', 'PIRAMIDE', 'Figurado', 'Salomón', 'Belicoso']) expect(headShape({ attrs: { vitola: v } })).toBe('punta');
    expect(pointLength('Torpedo')).toBe(0.95);
    expect(pointLength('Belicoso')).toBe(0.6);
    expect(pointLength('Toro')).toBe(0);
    expect(headShape({ attrs: {} })).toBe('redonda');
  });

  it('el campo «Cabeza» manda sobre la regla; vacío es automática', () => {
    expect(headShape(behike({ cabeza: 'redonda' }))).toBe('redonda');
    expect(headShape(behike({ cabeza: 'punta' }))).toBe('punta');
    expect(headShape({ attrs: { vitola: 'Toro', cabeza: 'colita' } })).toBe('colita');
    expect(headShape({ attrs: { vitola: 'Torpedo', cabeza: 'redonda' } })).toBe('redonda');
    expect(headShape(behike({ cabeza: '' }))).toBe('colita');
    // Un Toro forzado «En punta» se dibuja con la punta de un torpedo; uno de punta, con la suya.
    expect(headTaper('punta', 'Toro')).toBe(0.95);
    expect(headTaper('punta', 'Belicoso')).toBe(0.6);
    expect(headTaper('colita', 'Torpedo')).toBe(0);
  });

  it('la silueta dibuja la colita y lo dice («con colita»); el Toro y el Torpedo no', () => {
    const svg = (head: 'redonda' | 'punta' | 'colita', vitola: string) =>
      renderToStaticMarkup(createElement(CigarSilhouette, { lengthIn: 6, ringGauge: 52, shade: 'colorado', vitola, head, ruler: false, title: 'Silueta a escala de Behike' }));
    const conColita = svg('colita', 'Toro');
    expect(conColita).toContain('aria-label="Silueta a escala de Behike, con colita"');
    expect(conColita).toContain('data-cabeza="colita"');
    expect(conColita).toContain('data-parte="colita"');
    const toro = svg('redonda', 'Toro');
    expect(toro).not.toContain('con colita');
    expect(toro).not.toContain('data-parte="colita"');
    expect(svg('punta', 'Torpedo')).toContain('data-cabeza="punta"');
    // Sin decir la cabeza, la regla con la vitola sola (la portada dibuja un Churchill).
    expect(renderToStaticMarkup(createElement(CigarSilhouette, { lengthIn: 7, ringGauge: 50, shade: 'colorado', vitola: 'Churchill' }))).toContain('data-cabeza="redonda"');
  });
});

describe('las capas: cuatro que se ofrecen, las antiguas se reconocen', () => {
  it('el formulario ofrece Habano, Maduro, Connecticut y Doble Capa, en ese orden', () => {
    const capa = lineConfig('tabaco').productFields.find((f) => f.key === 'capa')!;
    expect(capa.kind).toBe('select');
    if (capa.kind !== 'select') return;
    expect(capa.options).toEqual([
      { value: 'habano', label: 'Habano' },
      { value: 'maduro', label: 'Maduro' },
      { value: 'connecticut', label: 'Connecticut' },
      { value: 'doble_capa', label: 'Doble Capa' },
    ]);
    expect(capa.required).toBe(true);
    expect(capa.legacy?.map((o) => o.value)).toEqual(['natural', 'corojo', 'criollo', 'sumatra', 'rosado', 'oscuro', 'candela']);
    expect(CAPAS_OFRECIDAS.map((c) => c.label)).toEqual(['Habano', 'Maduro', 'Connecticut', 'Doble Capa']);
    expect(CAPAS_RECONOCIDAS).toHaveLength(CAPAS_OFRECIDAS.length + CAPAS_ANTIGUAS.length);
  });

  it('el campo «Cabeza»: Automática, Redonda, Con colita, En punta (automática por defecto)', () => {
    const cabeza = lineConfig('tabaco').productFields.find((f) => f.key === 'cabeza')!;
    expect(cabeza.kind === 'select' && cabeza.options.map((o) => o.label)).toEqual(['Automática', 'Redonda', 'Con colita', 'En punta']);
    expect(cabeza.kind === 'select' && cabeza.options[0]!.value).toBe('');
    expect('required' in cabeza && cabeza.required).toBeFalsy();
  });

  it('Doble Capa se dibuja con el tono maduro; las antiguas, con el suyo de siempre', () => {
    expect(capaLabel('doble_capa')).toBe('Doble Capa');
    expect(capaShade('doble_capa')).toBe('maduro');
    expect(capaLabel('corojo')).toBe('Corojo');
    expect(capaShade('corojo')).toBe('colorado');
    expect(capaLabel('oscuro')).toBe('Oscuro (Broadleaf)');
    expect(capaShade('candela')).toBe('candela');
    expect(esCapaAntigua('natural')).toBe(true);
    expect(esCapaAntigua('doble_capa')).toBe(false);
  });

  it('«doble capa», «doble», «double wrapper» y «double» son Doble Capa; «Doble Corona» no', () => {
    for (const t of ['doble capa', 'Doble Capa', 'DOBLE', 'doble', 'double wrapper', 'Double', 'Toro 6x52 doble capa', 'doble_capa']) {
      expect(capaFromText(t), t).toBe('doble_capa');
      expect(capaFromWords(t), t).toBe('doble_capa');
    }
    expect(capaFromText('Doble Corona Maduro')).toBe('maduro');
    expect(capaFromText('Double Toro Habano')).toBe('habano');
    expect(capaFromText('Doble Corona')).toBeNull();
    expect(capaFromWords('Double Corona Connecticut')).toBe('connecticut');
    // Las antiguas se siguen leyendo.
    expect(capaFromText('Corojo')).toBe('corojo');
    expect(capaFromText('Broadleaf')).toBe('oscuro');
    expect(capaFromWords('Robusto Natural')).toBe('natural');
  });
});

describe('«doble capa» al pegar un pedido y en la recepción', () => {
  const tabaco = buildLine('tabaco', NOW).products as Product[];
  const toroMad = tabaco.find((p) => p.name === 'Toro 6 × 52 · Maduro')!;
  const toroDoble: Product = {
    ...toroMad,
    id: 'prd-toro-doble',
    sku: 'TB-TORO-DOBLE',
    barcode: undefined,
    name: 'Toro 6 × 52 · Doble Capa',
    variantLabel: 'Doble Capa',
    attrs: { ...toroMad.attrs, capa: 'doble_capa', wrapperShade: 'maduro' },
  };
  const products = [...tabaco, toroDoble];

  it('«toro doble capa», «toro double wrapper» y «toro doble» van al Toro Doble Capa; «toro maduro», al Maduro', () => {
    const r = parsePastedOrder('10 toro doble capa\n5 toro double wrapper\n3 toro doble\n2 toro maduro', products);
    expect(r.lines.map((l) => [l.productId, l.qty, l.status])).toEqual([
      [toroDoble.id, 10, 'ok'],
      [toroDoble.id, 5, 'ok'],
      [toroDoble.id, 3, 'ok'],
      [toroMad.id, 2, 'ok'],
    ]);
  });

  it('la recepción reconoce «Doble Capa» en la descripción del bulto', () => {
    expect(matchPackingProduct(products, { text: 'Toro 6x52 Doble Capa' }).productId).toBe(toroDoble.id);
    expect(matchPackingProduct(products, { text: 'Toro 6x52 Maduro' }).productId).toBe(toroMad.id);
  });
});

describe('importar con Doble Capa y con capas que ya no se ofrecen', () => {
  it('el nombre del Excel: «Doble Capa» es la capa; «Doble Corona» sigue siendo la vitola', () => {
    expect(parseTabacoName('Toro Doble Capa 6x52')).toMatchObject({ capa: 'doble_capa', vitola: 'Toro', words: ['Toro'] });
    expect(parseTabacoName('Double Wrapper Toro 6x52')).toMatchObject({ capa: 'doble_capa', vitola: 'Toro' });
    expect(parseTabacoName('Toro Double 6x52')).toMatchObject({ capa: 'doble_capa', vitola: 'Toro' });
    expect(parseTabacoName('Robusto Doble-Capa 5x50')).toMatchObject({ capa: 'doble_capa', vitola: 'Robusto', words: ['Robusto'] });
    expect(parseTabacoName('Doble Corona 7x49 Maduro')).toMatchObject({ capa: 'maduro', vitola: 'Doble Corona' });
    expect(parseTabacoName('Double Corona 7x49')).toMatchObject({ capa: null, vitola: 'Doble Corona' });
    expect(parseTabacoName('Double Toro 6x60 Habano')).toMatchObject({ capa: 'habano', vitola: 'Doble Toro' });
  });

  it('los nuevos con capa antigua entran con esa capa y el resumen lo avisa en una línea', async () => {
    const table = await readCsvText(
      'Display Name,Quantity On Hand\n' +
        '[R5-1] Toro Doble Capa 6x52,10\n' +
        '[R5-2] Robusto Corojo 5x50,4\n' +
        '[R5-3] Churchill Natural 7x48,2\n' +
        '[R5-4] Lancero Corojo 7.5x38,1\n' +
        '[R5-5] Torpedo Maduro 6.125x52,3\n',
    );
    const plan = buildImportPlan('tabaco', table, detectColumns(table.headers), defaultImportOptions('tabaco'), [], new Map());
    expect(plan.counts).toMatchObject({ nuevos: 5, conErrores: 0 });
    expect(plan.rows.map((r) => r.attrs.capa)).toEqual(['doble_capa', 'corojo', 'natural', 'corojo', 'maduro']);
    expect(plan.rows[0]!.attrs.wrapperShade).toBe('maduro');
    expect(plan.notices).toContain('3 productos con una capa que ya no se ofrece: Corojo, Natural.');
    // Uno solo: en singular. Ninguno: no se dice nada.
    const uno = await readCsvText('Display Name,Quantity On Hand\n[R5-9] Robusto Sumatra 5x50,1\n');
    expect(buildImportPlan('tabaco', uno, detectColumns(uno.headers), defaultImportOptions('tabaco'), [], new Map()).notices).toContain('1 producto con una capa que ya no se ofrece: Sumatra.');
    const ninguno = await readCsvText('Display Name,Quantity On Hand\n[R5-8] Robusto Habano 5x50,1\n');
    expect(buildImportPlan('tabaco', ninguno, detectColumns(ninguno.headers), defaultImportOptions('tabaco'), [], new Map()).notices.join(' ')).not.toMatch(/ya no se ofrece/);
  });

  it('y se crean así, sin cambiarles la capa', async () => {
    setDbPrefix('pruebas-ronda5-importar-');
    await resetDemo(NOW);
    const ctx = await adminCtx();
    await startBlank(ctx, 'Tabaco');
    const table = await readCsvText('Display Name,Quantity On Hand\n[R5-1] Toro Doble Capa 6x52,10\n[R5-2] Robusto Corojo 5x50,4\n');
    const input = { table, map: detectColumns(table.headers), options: defaultImportOptions('tabaco'), fileName: 'r5.csv' };
    const preview = await previewImport(ctx, input);
    expect(preview.notices).toContain('1 producto con una capa que ya no se ofrece: Corojo.');
    const result = await runImport(ctx, input);
    expect(result.created).toBe(2);
    const bySku = new Map((await getLineRepo('tabaco').products.all()).map((p) => [p.sku, p]));
    expect(bySku.get('R5-1')!.attrs).toMatchObject({ capa: 'doble_capa', wrapperShade: 'maduro' });
    expect(bySku.get('R5-2')!.attrs).toMatchObject({ capa: 'corojo', wrapperShade: 'colorado' });
    expect(bySku.get('R5-2')!.name).toBe('Robusto 5 × 50 · Corojo');
  });
});

describe('un producto con una capa que ya no se ofrece sigue igual', () => {
  beforeAll(async () => {
    setDbPrefix('pruebas-ronda5-antigua-');
    await resetDemo(NOW);
  });

  const torpedoNatural = async () => (await getLineRepo('tabaco').products.all()).find((p) => p.name === 'Torpedo 6⅛ × 52 · Natural')!;

  it('se ve con su nombre y su color (lista, ficha y etiqueta)', async () => {
    const ctx = await adminCtx();
    const p = await torpedoNatural();
    expect(p.attrs).toMatchObject({ capa: 'natural', wrapperShade: 'natural' });
    const view = (await listProducts(ctx)).find((v) => v.product.id === p.id)!;
    expect(view.product.variantLabel).toContain('Natural');
    expect(capaLabel(view.product.attrs.capa)).toBe('Natural');
    expect(labelLines('tabaco', p)).toEqual(['Torpedo · 6⅛ × 52', 'Capa Natural']);
  });

  it('se filtra: el filtro de capa ofrece solo las que tiene algún producto, también las antiguas', async () => {
    const ctx = await adminCtx();
    const views = await listProducts(ctx);
    const capas = buildFacets(views, ['capa'], {}).find((f) => f.key === 'capa')!.options;
    const presentes = new Set(views.map((v) => String(v.product.attrs.capa)));
    expect(capas.map((o) => o.value).sort()).toEqual([...presentes].sort());
    expect(capas.find((o) => o.value === 'natural')?.label).toBe('Natural');
    expect(capas.some((o) => o.value === 'doble_capa')).toBe(false);
    const naturales = applyFilters(views, { capa: ['natural'] });
    expect(naturales.map((v) => v.product.name)).toContain('Torpedo 6⅛ × 52 · Natural');
    expect(naturales.every((v) => v.product.attrs.capa === 'natural')).toBe(true);
  });

  it('se edita sin perderla', async () => {
    const ctx = await adminCtx();
    const p = await torpedoNatural();
    const input: ProductInput = {
      id: p.id,
      sku: p.sku,
      name: p.familyName ?? p.name,
      familyName: p.familyName,
      kind: p.kind,
      brandLine: p.brandLine,
      cost: p.cost,
      priceToStore: p.priceToStore + 1,
      suggestedRetail: p.suggestedRetail + 1,
      sellerCommission: p.sellerCommission,
      lowStockThreshold: p.lowStockThreshold,
      packSize: p.packSize,
      unitName: p.unitName,
      attrs: { ...p.attrs },
    };
    const saved = await saveProduct(ctx, input);
    expect(saved.priceToStore).toBe(p.priceToStore + 1);
    expect(saved.attrs).toMatchObject({ capa: 'natural', wrapperShade: 'natural' });
    expect(saved.name).toBe('Torpedo 6⅛ × 52 · Natural');
  });

  it('se exporta con su capa (copia de la línea)', async () => {
    const ctx = await adminCtx();
    const p = await torpedoNatural();
    const { json } = await exportLine(ctx);
    const copia = JSON.parse(json) as { tables: { products: Product[] } };
    expect(copia.tables.products.find((x) => x.id === p.id)?.attrs).toMatchObject({ capa: 'natural', wrapperShade: 'natural' });
  });

  it('un Doble Capa nuevo se guarda y aparece en el filtro', async () => {
    const ctx = await adminCtx();
    const nuevo = await saveProduct(ctx, {
      sku: 'TB-BEHIKE-DC',
      name: 'Behike',
      familyName: 'Behike',
      kind: 'mazo',
      brandLine: 'De mazo (sin marca)',
      cost: 9,
      priceToStore: 22,
      suggestedRetail: 38,
      sellerCommission: { type: 'percent', value: 8 },
      lowStockThreshold: 10,
      packSize: 50,
      unitName: 'mazo',
      attrs: { vitola: 'Toro Aleta', lengthIn: 6, ringGauge: 52, capa: 'doble_capa', strength: 'media', cigarsPerBundle: 25 },
    });
    expect(nuevo.attrs.wrapperShade).toBe('maduro');
    expect(nuevo.name).toBe('Behike · Doble Capa · 6 × 52');
    expect(headShape(nuevo)).toBe('colita');
    const views = await listProducts(ctx);
    expect(buildFacets(views, ['capa'], {}).find((f) => f.key === 'capa')!.options.find((o) => o.value === 'doble_capa')?.label).toBe('Doble Capa');
  });
});
