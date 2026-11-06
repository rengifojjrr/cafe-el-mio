// Filtros de un toque del catálogo y agrupación en familias. Funciones puras: las usa la
// pantalla del catálogo y se prueban sin navegador.
import type { Product, ProductKind } from '../data/types';
import { capaLabel, familyKey, familyNameOf, normalize, searchText } from './products';

/** Lo mínimo que hace falta de cada producto para filtrar (vale para ProductView). */
export interface FilterItem {
  product: Pick<Product, 'id' | 'name' | 'sku' | 'brandLine' | 'attrs' | 'active'> &
    Partial<Pick<Product, 'kind' | 'familyId' | 'familyName' | 'variantLabel' | 'barcode'>>;
  stock: { available: number; lowStock: boolean };
}

/** Por cada clave, los valores elegidos (dentro de una clave: «o»; entre claves: «y»). */
export type CatalogFilters = Record<string, string[]>;

export const STRENGTH_LABEL: Record<string, string> = { suave: 'Suave', media: 'Media', fuerte: 'Fuerte' };
const KIND_LABEL: Record<ProductKind, string> = { premium: 'Premium', mazo: 'De mazo' };
const STRENGTH_ORDER = ['suave', 'media', 'fuerte'];

export const FILTER_TITLE: Record<string, string> = {
  kind: 'Tipo',
  capa: 'Capa',
  vitola: 'Vitola',
  strength: 'Fortaleza',
  originCountry: 'Procedencia',
  brand: 'Marca',
  roast: 'Tueste',
  grind: 'Molido',
  weight: 'Peso',
  stock: 'Existencias',
};

/** El valor de un producto para una clave de filtro (o vacío si no aplica). */
export function facetValue(item: FilterItem, key: string): string {
  const p = item.product;
  if (key === 'kind') return p.kind ?? '';
  if (key === 'stock') return item.stock.available > 0 ? 'con' : 'sin';
  if (key === 'brand') return p.kind === 'premium' ? String(p.attrs.brand ?? '').trim() : '';
  if (key === 'vitola') return titleCase(String(p.attrs.vitola ?? ''));
  return String(p.attrs[key] ?? '').trim();
}

export function facetLabel(key: string, value: string): string {
  if (key === 'kind') return KIND_LABEL[value as ProductKind] ?? value;
  if (key === 'capa') return capaLabel(value);
  if (key === 'strength') return STRENGTH_LABEL[value] ?? value;
  if (key === 'stock') return value === 'con' ? 'Con stock' : 'Sin stock';
  return value;
}

function titleCase(text: string): string {
  const t = text.trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : '';
}

export interface FacetOption {
  value: string;
  label: string;
  /** Cuántos productos quedarían si se elige (con los demás filtros como están). */
  count: number;
}

export interface Facet {
  key: string;
  title: string;
  options: FacetOption[];
}

function matchesQuery(item: FilterItem, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = searchText(item.product);
  return words.every((w) => text.includes(w));
}

function matchesFilters(item: FilterItem, filters: CatalogFilters, skipKey?: string): boolean {
  for (const [key, values] of Object.entries(filters)) {
    if (key === skipKey || values.length === 0) continue;
    if (key === 'stock') {
      if (values.includes('con') && item.stock.available <= 0) return false;
      continue;
    }
    if (key === 'low') {
      if (!item.stock.lowStock) return false;
      continue;
    }
    if (!values.includes(facetValue(item, key))) return false;
  }
  return true;
}

export function queryWords(q: string): string[] {
  return normalize(q).split(' ').filter(Boolean);
}

/** Lo que queda con la búsqueda y los filtros. */
export function applyFilters<T extends FilterItem>(items: readonly T[], filters: CatalogFilters, q = ''): T[] {
  const words = queryWords(q);
  return items.filter((i) => matchesQuery(i, words) && matchesFilters(i, filters));
}

/**
 * Las opciones de cada filtro, solo con valores que existen, y cuántos productos quedarían
 * al elegir cada una (contando los demás filtros, como en las tiendas en línea).
 */
export function buildFacets(items: readonly FilterItem[], keys: readonly string[], filters: CatalogFilters, q = ''): Facet[] {
  const words = queryWords(q);
  const base = items.filter((i) => matchesQuery(i, words));
  const out: Facet[] = [];
  for (const key of keys) {
    if (key === 'stock') {
      const count = base.filter((i) => matchesFilters(i, filters, 'stock') && i.stock.available > 0).length;
      out.push({ key, title: FILTER_TITLE[key] ?? key, options: [{ value: 'con', label: 'Con stock', count }] });
      continue;
    }
    const counts = new Map<string, number>();
    for (const item of base) {
      const v = facetValue(item, key);
      if (!v) continue;
      if (!counts.has(v)) counts.set(v, 0);
      if (matchesFilters(item, filters, key)) counts.set(v, counts.get(v)! + 1);
    }
    if (counts.size < 2 && !(filters[key]?.length)) continue; // Un solo valor no filtra nada.
    const options = [...counts]
      .map(([value, count]) => ({ value, label: facetLabel(key, value), count }))
      .sort((a, b) =>
        key === 'strength'
          ? STRENGTH_ORDER.indexOf(a.value) - STRENGTH_ORDER.indexOf(b.value)
          : key === 'kind'
            ? a.value.localeCompare(b.value)
            : a.label.localeCompare(b.label, 'es'),
      );
    out.push({ key, title: FILTER_TITLE[key] ?? key, options });
  }
  return out;
}

export function toggleFilter(filters: CatalogFilters, key: string, value: string): CatalogFilters {
  const current = filters[key] ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  const out = { ...filters, [key]: next };
  if (next.length === 0) delete out[key];
  return out;
}

export function activeFilterCount(filters: CatalogFilters): number {
  return Object.values(filters).reduce((a, v) => a + v.length, 0);
}

export interface Family<T extends FilterItem> {
  key: string;
  name: string;
  variants: T[];
}

/** Agrupa las variantes por familia, en el orden del nombre; las variantes por capa y medida. */
export function groupFamilies<T extends FilterItem>(items: readonly T[]): Family<T>[] {
  const map = new Map<string, Family<T>>();
  for (const item of items) {
    const key = familyKey(item.product);
    let fam = map.get(key);
    if (!fam) {
      fam = { key, name: familyNameOf(item.product), variants: [] };
      map.set(key, fam);
    }
    fam.variants.push(item);
  }
  for (const fam of map.values()) {
    fam.variants.sort((a, b) => (a.product.variantLabel ?? a.product.name).localeCompare(b.product.variantLabel ?? b.product.name, 'es'));
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
}

/** Para guardar los filtros de cada persona (y limpiar lo que ya no existe). */
export function sanitizeFilters(raw: unknown): CatalogFilters {
  if (!raw || typeof raw !== 'object') return {};
  const out: CatalogFilters = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      const vals = v.filter((x): x is string => typeof x === 'string');
      if (vals.length) out[k] = vals;
    }
  }
  return out;
}
