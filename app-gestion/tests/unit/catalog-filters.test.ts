// Filtros de un toque del catálogo: «o» dentro de un filtro, «y» entre filtros, cuántos quedan
// con cada opción, agrupar en familias y limpiar lo guardado.
import { describe, expect, it } from 'vitest';
import { type FilterItem, activeFilterCount, applyFilters, buildFacets, groupFamilies, sanitizeFilters, toggleFilter } from '../../src/domain/catalog-filters';

function item(id: string, familyName: string, attrs: Record<string, string | number>, kind: 'mazo' | 'premium', available = 10): FilterItem {
  return {
    product: { id, name: `${familyName} · ${attrs.capa}`, sku: id.toUpperCase(), brandLine: '', attrs, active: true, kind, familyId: `fam-${familyName}`, familyName, variantLabel: String(attrs.capa) },
    stock: { available, lowStock: available < 5 },
  };
}

const items = [
  item('a', 'Toro 6 × 52', { capa: 'habano', vitola: 'Toro', strength: 'media', originCountry: 'Nicaragua' }, 'mazo'),
  item('b', 'Toro 6 × 52', { capa: 'maduro', vitola: 'Toro', strength: 'fuerte', originCountry: 'Nicaragua' }, 'mazo', 0),
  item('c', 'Toro 6 × 52', { capa: 'connecticut', vitola: 'Toro', strength: 'suave', originCountry: 'Nicaragua' }, 'mazo'),
  item('d', 'Robusto 5 × 50', { capa: 'maduro', vitola: 'robusto', strength: 'fuerte', originCountry: 'Honduras' }, 'mazo', 3),
  item('e', 'Biscayne Churchill', { capa: 'connecticut', vitola: 'Churchill', strength: 'suave', originCountry: 'Nicaragua', brand: 'GM' }, 'premium'),
];

describe('filtros del catálogo', () => {
  it('«o» dentro de una clave, «y» entre claves, y la búsqueda sin tildes', () => {
    expect(applyFilters(items, { capa: ['maduro', 'habano'] }).map((i) => i.product.id)).toEqual(['a', 'b', 'd']);
    expect(applyFilters(items, { capa: ['maduro'], originCountry: ['Nicaragua'] }).map((i) => i.product.id)).toEqual(['b']);
    expect(applyFilters(items, { stock: ['con'] }).map((i) => i.product.id)).toEqual(['a', 'c', 'd', 'e']);
    expect(applyFilters(items, { low: ['si'] }).map((i) => i.product.id)).toEqual(['b', 'd']);
    expect(applyFilters(items, {}, 'TORO maduro').map((i) => i.product.id)).toEqual(['b']);
    // La vitola se compara con mayúscula inicial: «robusto» y «Robusto» son la misma.
    expect(applyFilters(items, { vitola: ['Robusto'] }).map((i) => i.product.id)).toEqual(['d']);
  });

  it('cada opción dice cuántos quedarían con los demás filtros puestos', () => {
    const facets = buildFacets(items, ['kind', 'capa', 'strength', 'brand', 'stock'], { kind: ['mazo'] });
    const capa = facets.find((f) => f.key === 'capa')!;
    expect(capa.options.map((o) => [o.label, o.count])).toEqual([
      ['Connecticut', 1],
      ['Habano', 1],
      ['Maduro', 2],
    ]);
    // El tipo no se cuenta a sí mismo: elegir «Premium» sumaría el premium.
    expect(facets.find((f) => f.key === 'kind')!.options.map((o) => [o.value, o.count])).toEqual([
      ['mazo', 4],
      ['premium', 1],
    ]);
    expect(facets.find((f) => f.key === 'strength')!.options.map((o) => o.value)).toEqual(['suave', 'media', 'fuerte']);
    // Con una sola marca no hay nada que elegir: no se muestra.
    expect(facets.find((f) => f.key === 'brand')).toBeUndefined();
    expect(facets.find((f) => f.key === 'stock')!.options[0]!.count).toBe(3);
  });

  it('agrupa las variantes por familia y ordena por nombre con números', () => {
    const fams = groupFamilies(items);
    expect(fams.map((f) => [f.name, f.variants.length])).toEqual([
      ['Biscayne Churchill', 1],
      ['Robusto 5 × 50', 1],
      ['Toro 6 × 52', 3],
    ]);
    expect(fams[2]!.variants.map((v) => v.product.variantLabel)).toEqual(['connecticut', 'habano', 'maduro']);
  });

  it('prender, apagar y limpiar lo guardado', () => {
    let f = toggleFilter({}, 'capa', 'maduro');
    f = toggleFilter(f, 'capa', 'habano');
    expect(activeFilterCount(f)).toBe(2);
    f = toggleFilter(f, 'capa', 'maduro');
    f = toggleFilter(f, 'capa', 'habano');
    expect(f).toEqual({});
    expect(sanitizeFilters({ capa: ['maduro', 3], x: 'no', y: [] })).toEqual({ capa: ['maduro'] });
    expect(sanitizeFilters(null)).toEqual({});
  });
});
