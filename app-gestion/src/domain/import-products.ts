// Importar productos desde Excel o CSV (por ejemplo, la exportación de Odoo).
// Funciones puras: reconocer las columnas, leer cada fila (nombre → familia, variante, medida,
// capa…) y armar el plan de lo que se crea o se actualiza. El servicio lo escribe.
//
// Tabaco, formato de Odoo: «[REF] <medida> <vitola y forma> <capa>», por ejemplo
// «[ABC-103] 6⅛x52 Torpedo Box Press Connecticut». Categoría «All / Tabaco / Habano».
// Premium: paquetes con marca («Brisa Azul Box Hab», «Brisa Azul 5 Pack»).
// Café: los valores de la variante vienen aparte («Molido: Espresso, Peso: 10 oz»).
import type { LineId, Product, ProductKind } from '../data/types';
import { cleanCode, isValidEan13 } from '../lib/barcode';
import { fmtMoney, round2 } from '../lib/money';
import { headerKey, parseNumber, type SheetTable } from '../lib/sheets';
import { isCubanOrigin } from './compliance';
import { capaLabel, capaShade, composeName, countText, familyIdFor, normalize, sizeText, slug, unitNames, variantLabelFor } from './products';

// ---------- Columnas ----------

export type ImportField = 'name' | 'sku' | 'barcode' | 'price' | 'cost' | 'qty' | 'category' | 'variantValues' | 'origin';

export const IMPORT_FIELDS: { key: ImportField; label: string }[] = [
  { key: 'name', label: 'Nombre/descripción' },
  { key: 'sku', label: 'Referencia' },
  { key: 'barcode', label: 'Código de barras' },
  { key: 'price', label: 'Precio' },
  { key: 'cost', label: 'Costo' },
  { key: 'qty', label: 'Cantidad' },
  { key: 'category', label: 'Categoría' },
  { key: 'variantValues', label: 'Atributos de variante' },
  { key: 'origin', label: 'Procedencia' },
];

/** Índice de la columna de cada campo. Sin el campo: no está en el archivo. */
export type ColumnMap = Partial<Record<ImportField, number>>;

/** Encabezados conocidos (ya normalizados con headerKey), en orden de preferencia. */
const SYNONYMS: Record<ImportField, string[]> = {
  name: ['nombre para mostrar', 'display name', 'nombre', 'name', 'nombre del producto', 'product name', 'producto', 'product', 'variante de producto', 'product variant', 'descripcion', 'description', 'articulo'],
  sku: ['referencia interna', 'internal reference', 'referencia', 'reference', 'ref', 'sku', 'codigo interno', 'codigo', 'code', 'default code', 'item code'],
  barcode: ['codigo de barras', 'barcode', 'ean', 'ean13', 'ean 13', 'upc', 'gtin', 'codigo ean'],
  price: ['precio de venta', 'sales price', 'precio al local', 'precio', 'price', 'precio de lista', 'list price', 'precio unitario', 'unit price', 'precio mayorista', 'wholesale price'],
  cost: ['coste', 'cost', 'costo', 'costo unitario', 'unit cost', 'precio de coste', 'precio de costo', 'standard price'],
  qty: [
    'cantidad a mano',
    'quantity on hand',
    'on hand quantity',
    'cantidad real',
    'cantidad disponible',
    'available quantity',
    'free to use quantity',
    'cantidad libre para usar',
    'cantidad',
    'quantity',
    'qty',
    'stock',
    'existencias',
    'inventario',
    'unidades',
  ],
  category: [
    'categoria de producto nombre completo',
    'categoria del producto nombre completo',
    'product category complete name',
    'product category display name',
    'categoria del producto',
    'categoria de producto',
    'product category',
    'categoria',
    'category',
  ],
  variantValues: ['valores de atributo de variante', 'valores de variante', 'variant values', 'attribute values', 'valores de atributos', 'product attribute values', 'variantes', 'atributos', 'attributes'],
  origin: ['pais de origen', 'country of origin', 'procedencia', 'origen', 'origin'],
};

/** Si no hay un encabezado exacto: palabras que lo delatan (en este orden, para no confundirlos). */
const KEYWORDS: [ImportField, string[]][] = [
  ['category', ['categoria', 'category']],
  ['variantValues', ['atributo', 'atributos', 'attribute', 'variant values', 'valores de variante']],
  ['barcode', ['barras', 'barcode', 'ean', 'upc', 'gtin']],
  ['sku', ['referencia', 'reference', 'sku', 'ref']],
  ['cost', ['coste', 'costo', 'cost']],
  ['price', ['precio', 'price']],
  ['qty', ['cantidad', 'quantity', 'qty', 'stock', 'existencias']],
  ['origin', ['origen', 'origin', 'procedencia']],
  ['name', ['nombre', 'name', 'producto', 'product', 'descripcion', 'description']],
];

/** Reconoce las columnas de Odoo (en español o inglés, exportación completa o corta) y otras parecidas. */
export function detectColumns(headers: readonly string[]): ColumnMap {
  const keys = headers.map(headerKey);
  const used = new Set<number>();
  const map: ColumnMap = {};
  const take = (field: ImportField, i: number) => {
    map[field] = i;
    used.add(i);
  };
  for (const { key: field } of IMPORT_FIELDS) {
    for (const syn of SYNONYMS[field]) {
      const i = keys.findIndex((k, idx) => !used.has(idx) && k === syn);
      if (i >= 0) {
        take(field, i);
        break;
      }
    }
  }
  for (const [field, words] of KEYWORDS) {
    if (map[field] !== undefined) continue;
    for (const w of words) {
      const i = keys.findIndex((k, idx) => !used.has(idx) && ` ${k} `.includes(` ${w} `));
      if (i >= 0) {
        take(field, i);
        break;
      }
    }
  }
  return map;
}

// ---------- Medidas, capa y vitola en el nombre ----------

const FRACTION: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

/** 6x52, 6X52, 6 × 52, 6⅛x52, 4½x60, 6 1/2x54, 6.5x54, 6,5x54, 6"x52. */
const SIZE_RE = /(?<![\d.,/])(\d{1,2})(?:\s*([½¼¾⅛⅜⅝⅞])|[\s-]+(\d)\/(\d{1,2})|[.,](\d{1,3}))?\s*["″”]?\s*[xX×]\s*(\d{2})(?!\d)/;

export interface ParsedSize {
  lengthIn: number;
  ringGauge: number;
  /** El texto que se reconoció, para quitarlo del nombre. */
  match: string;
}

export function parseSize(text: string): ParsedSize | null {
  const m = SIZE_RE.exec(text);
  if (!m) return null;
  const whole = Number(m[1]);
  let frac = 0;
  if (m[2]) frac = FRACTION[m[2]] ?? 0;
  else if (m[3] && m[4]) frac = Number(m[3]) / Number(m[4]);
  else if (m[5]) frac = Number(`0.${m[5]}`);
  const lengthIn = Math.round((whole + frac) * 1000) / 1000;
  const ringGauge = Number(m[6]);
  if (lengthIn < 2 || lengthIn > 12 || ringGauge < 20 || ringGauge > 80 || frac >= 1) return null;
  return { lengthIn, ringGauge, match: m[0] };
}

/** Palabras de la capa (en el nombre o la categoría). «Conneticut» (mal escrito) es Connecticut. */
const CAPA_WORDS: Record<string, string> = {
  habano: 'habano',
  hab: 'habano',
  maduro: 'maduro',
  mad: 'maduro',
  connecticut: 'connecticut',
  conneticut: 'connecticut',
  conecticut: 'connecticut',
  connecticutt: 'connecticut',
  natural: 'natural',
  corojo: 'corojo',
  criollo: 'criollo',
  sumatra: 'sumatra',
  rosado: 'rosado',
  candela: 'candela',
  oscuro: 'oscuro',
  broadleaf: 'oscuro',
};

/** La capa de un texto libre por palabras sueltas («Box Mad» → maduro). La última manda. */
export function capaFromWords(text: string): string | null {
  let found: string | null = null;
  for (const w of normalize(text).split(/[^a-z0-9]+/)) {
    const c = CAPA_WORDS[w];
    if (c) found = c;
  }
  return found;
}

/** Vitolas (la primera que aparece queda en attrs.vitola). Primero las de dos palabras. */
const VITOLAS: [string[], string][] = [
  [['super', 'gordo'], 'Super Gordo'],
  [['gran', 'toro'], 'Gran Toro'],
  [['doble', 'toro'], 'Doble Toro'],
  [['double', 'toro'], 'Doble Toro'],
  [['doble', 'corona'], 'Doble Corona'],
  [['double', 'corona'], 'Doble Corona'],
  [['big', 'cigars'], 'Big Cigars'],
  [['big', 'cigar'], 'Big Cigars'],
  [['petit', 'corona'], 'Petit Corona'],
  [['corona', 'gorda'], 'Corona Gorda'],
  [['gran', 'corona'], 'Gran Corona'],
  [['toro'], 'Toro'],
  [['robusto'], 'Robusto'],
  [['gordo'], 'Gordo'],
  [['churchill'], 'Churchill'],
  [['torpedo'], 'Torpedo'],
  [['lancero'], 'Lancero'],
  [['piramide'], 'Pirámide'],
  [['pyramid'], 'Pirámide'],
  [['salomon'], 'Salomón'],
  [['coronita'], 'Coronita'],
  [['corona'], 'Corona'],
  [['nub'], 'Nub'],
  [['aleta'], 'Aleta'],
  [['sublime'], 'Sublime'],
  [['belicoso'], 'Belicoso'],
  [['perfecto'], 'Perfecto'],
  [['lonsdale'], 'Lonsdale'],
  [['panetela'], 'Panetela'],
  [['figurado'], 'Figurado'],
  [['rothschild'], 'Rothschild'],
  [['presidente'], 'Presidente'],
  [['diadema'], 'Diadema'],
  [['gigante'], 'Gigante'],
];

/** Señales de un paquete con marca (premium): «Box» (que no sea «Box Press»), «Pack», «mazos 25», «Premium». */
const PACK_WORDS = new Set(['box', 'pack', 'packs', 'mazo', 'mazos', 'premium', 'tubo', 'tubos', 'lata']);

export interface TabacoName {
  /** Lo que estaba entre corchetes al principio: «[ABC-101]». */
  ref?: string;
  size?: { lengthIn: number; ringGauge: number };
  /** Primera vitola reconocida (Toro, Salomón…), o vacío. */
  vitola: string;
  /** «Box Press» si el nombre lo dice. */
  shape: string;
  /** Capa que dice el nombre (null si no dice). */
  capa: string | null;
  /** Palabras de la familia (sin la medida ni la capa), con la vitola y la forma bien escritas. */
  words: string[];
  /** Parece un paquete con marca (premium). */
  branded: boolean;
  /** Las palabras antes de «Box», «Pack», la vitola o la medida: la marca, si es premium. */
  brand: string;
}

/** Quita «[REF]» del principio. */
export function splitRef(text: string): { ref?: string; rest: string } {
  const m = /^\s*\[([^\]]*)\]\s*(.*)$/s.exec(text);
  if (!m) return { rest: text.trim() };
  const ref = (m[1] ?? '').trim();
  return { ref: ref || undefined, rest: (m[2] ?? '').trim() };
}

export function parseTabacoName(text: string): TabacoName {
  const { ref, rest } = splitRef(text);
  const size = parseSize(rest);
  const body = size ? rest.replace(size.match, ' ') : rest;
  const raw = body.split(/\s+/).map((w) => w.replace(/^[,;:()-]+|[,;:()-]+$/g, '')).filter(Boolean);
  const norm = raw.map((w) => normalize(w).replace(/[^a-z0-9]/g, ''));
  const words: string[] = [];
  let vitola = '';
  let shape = '';
  let capa: string | null = null;
  let branded = false;
  let premiumWord = false;
  let brandDone = false;
  const brand: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const n = norm[i]!;
    // Capa (y «Shade» que la acompaña): no va en la familia.
    if (CAPA_WORDS[n]) {
      capa = CAPA_WORDS[n]!;
      brandDone = true;
      if (norm[i + 1] === 'shade') i += 1;
      continue;
    }
    if ((n === 'box' && norm[i + 1] === 'press') || n === 'boxpress') {
      shape = 'Box Press';
      words.push('Box Press');
      brandDone = true;
      if (n === 'box') i += 1;
      continue;
    }
    const v = VITOLAS.find(([parts]) => parts.every((p, k) => norm[i + k] === p));
    if (v) {
      if (!vitola) vitola = v[1];
      words.push(v[1]);
      brandDone = true;
      i += v[0].length - 1;
      continue;
    }
    if (PACK_WORDS.has(n) || /^\d+$/.test(n)) {
      if (PACK_WORDS.has(n)) branded = true;
      if (n === 'premium') premiumWord = true;
      brandDone = true;
    }
    if (!brandDone) brand.push(raw[i]!);
    words.push(raw[i]!);
  }
  // «Premium», o un paquete («Box», «Pack», «mazos 25») sin medida: es un premium con marca.
  const isBranded = premiumWord || (branded && !size);
  return {
    ref,
    size: size ? { lengthIn: size.lengthIn, ringGauge: size.ringGauge } : undefined,
    vitola,
    shape,
    capa,
    words,
    branded: isBranded,
    brand: isBranded ? brand.join(' ') : '',
  };
}

/** Último tramo de la categoría: «All / Tabaco / Habano» → «Habano». */
export function lastCategory(path: string): string {
  return (
    path
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean)
      .at(-1) ?? ''
  );
}

// ---------- Atributos de variante ----------

export interface VariantValue {
  /** Nombre del atributo («Molido»), o vacío si vino solo el valor. */
  name: string;
  value: string;
}

/** «Molido: Espresso, Peso: 10 oz» → pares. También acepta «;» o saltos de línea. */
export function parseVariantValues(text: string): VariantValue[] {
  return text
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf(':');
      return i > 0 ? { name: part.slice(0, i).trim(), value: part.slice(i + 1).trim() } : { name: '', value: part };
    })
    .filter((v) => v.value);
}

type AttrKind = 'capa' | 'vitola' | 'size' | 'strength' | 'origin' | 'grind' | 'weight' | 'roast' | 'presentation';

const ATTR_NAMES: Record<string, AttrKind> = {
  capa: 'capa',
  wrapper: 'capa',
  envoltura: 'capa',
  vitola: 'vitola',
  shape: 'vitola',
  formato: 'vitola',
  medida: 'size',
  medidas: 'size',
  size: 'size',
  tamano: 'size',
  fortaleza: 'strength',
  strength: 'strength',
  intensidad: 'strength',
  origen: 'origin',
  origin: 'origin',
  pais: 'origin',
  procedencia: 'origin',
  molido: 'grind',
  molienda: 'grind',
  grind: 'grind',
  'tipo de molido': 'grind',
  peso: 'weight',
  weight: 'weight',
  contenido: 'weight',
  tueste: 'roast',
  tostado: 'roast',
  roast: 'roast',
  presentacion: 'presentation',
  presentation: 'presentation',
  empaque: 'presentation',
  envase: 'presentation',
};

const STRENGTH: Record<string, string> = { suave: 'suave', mild: 'suave', light: 'suave', media: 'media', medio: 'media', medium: 'media', fuerte: 'fuerte', full: 'fuerte', strong: 'fuerte' };
const ROAST: Record<string, string> = {
  claro: 'claro',
  light: 'claro',
  medio: 'medio',
  medium: 'medio',
  'medio oscuro': 'medio-oscuro',
  'medio-oscuro': 'medio-oscuro',
  'medium dark': 'medio-oscuro',
  oscuro: 'oscuro',
  dark: 'oscuro',
};
const WEIGHT_RE = /\b\d+(?:[.,]\d+)?\s*(?:oz|onzas?|lb|lbs|libras?|g|gr|gramos?|kg|kilos?)\b/i;
const GRIND_WORDS = ['grano', 'entero', 'whole', 'bean', 'molido', 'ground', 'espresso', 'fino', 'grueso', 'goteo', 'drip', 'prensa', 'capsula', 'capsulas', 'pods'];

function roastOf(value: string): string | null {
  return ROAST[normalize(value).replace(/\s+/g, ' ')] ?? null;
}

/** Qué es un valor suelto, sin nombre de atributo («10 oz», «Maduro», «Espresso»). */
function guessKind(line: LineId, value: string): AttrKind | null {
  const n = normalize(value);
  if (line === 'tabaco') {
    if (parseSize(value)) return 'size';
    if (capaFromWords(value)) return 'capa';
    if (STRENGTH[n]) return 'strength';
    if (VITOLAS.some(([parts]) => parts.join(' ') === n)) return 'vitola';
    return null;
  }
  if (WEIGHT_RE.test(value)) return 'weight';
  if (roastOf(value)) return 'roast';
  if (GRIND_WORDS.some((w) => n.split(/[^a-z]+/).includes(w))) return 'grind';
  return null;
}

// ---------- Opciones ----------

export type QtyUnit = 'mazo' | 'caja' | 'tabaco' | 'unidad';

export interface ImportOptions {
  /** En qué vienen las cantidades: mazos, cajas o tabacos (de mazo); unidades o cajas (café). */
  qtyUnit: QtyUnit;
  /** Precio al local si el archivo no lo trae: por mazo (tabaco de mazo) o por unidad (café). */
  defaultPrice: number;
  /** Tabaco premium: precio por unidad (cada paquete o caja) si el archivo no lo trae. */
  defaultPremiumPrice: number;
  /** Costo si el archivo no lo trae. null: no se sabe (queda en 0 y marcado como de ejemplo). */
  defaultCost: number | null;
  cigarsPerBundle: number;
  bundlesPerBox: number;
  /** Café: unidades por caja. */
  unitsPerBox: number;
  /** Procedencia (tabaco) u origen (café) cuando el archivo no la trae. */
  origin: string;
  strength: string;
  roast: string;
  productionLine: string;
  presentation: string;
  /** PVP sugerido = precio al local × este factor. */
  pvpFactor: number;
}

export function defaultImportOptions(line: LineId): ImportOptions {
  return {
    qtyUnit: line === 'tabaco' ? 'mazo' : 'unidad',
    defaultPrice: line === 'tabaco' ? 25 : 5,
    defaultPremiumPrice: 40,
    defaultCost: null,
    cigarsPerBundle: 25,
    bundlesPerBox: 50,
    unitsPerBox: 12,
    origin: line === 'tabaco' ? 'Nicaragua' : '',
    strength: 'media',
    roast: 'medio',
    productionLine: 'Línea 1 · Espresso',
    presentation: 'Paquete',
    pvpFactor: 1.75,
  };
}

/** Problemas de las opciones (para el formulario y el servicio). */
export function optionErrors(line: LineId, o: ImportOptions, map: ColumnMap): string[] {
  const out: string[] = [];
  if (map.name === undefined) out.push('Elige la columna del nombre.');
  const whole = (n: number) => Number.isInteger(n) && n >= 1;
  if (line === 'tabaco') {
    if (!whole(o.cigarsPerBundle)) out.push('Los tabacos por mazo son un número entero mayor que cero.');
    if (!whole(o.bundlesPerBox)) out.push('Los mazos por caja son un número entero mayor que cero.');
    if (map.price === undefined && !(o.defaultPremiumPrice > 0)) out.push('Escribe el precio por unidad premium.');
    if (isCubanOrigin(o.origin)) out.push('No se registra tabaco de origen Cuba (embargo de EE. UU.).');
  } else if (!whole(o.unitsPerBox)) out.push('Las unidades por caja son un número entero mayor que cero.');
  if (map.price === undefined && !(o.defaultPrice > 0)) out.push(line === 'tabaco' ? 'Escribe el precio por mazo.' : 'Escribe el precio por unidad.');
  if (o.defaultCost !== null && !(o.defaultCost >= 0)) out.push('El costo no puede ser negativo.');
  if (!(o.pvpFactor >= 1)) out.push('El PVP no puede ser menor que el precio al local.');
  return out;
}

// ---------- El plan ----------

export type RowStatus = 'nuevo' | 'actualiza' | 'error';

export interface ImportRow {
  /** Fila de la hoja (la 1 es la de encabezados). */
  rowNumber: number;
  /** El nombre como venía en el archivo. */
  source: string;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  sku: string;
  barcode?: string;
  kind?: ProductKind;
  familyName: string;
  familyId: string;
  /** Lo que distingue a la variante en su familia (ya con las reglas del catálogo). */
  variantLabel: string;
  name: string;
  brandLine: string;
  attrs: Record<string, string | number>;
  /** Atributos que salieron de las opciones (procedencia, fortaleza…): al actualizar no pisan lo que ya hay. */
  defaultedAttrs: string[];
  unitName: string;
  packSize: number;
  /** Cantidad para el almacén, en la unidad del producto. null: el archivo no trae cantidades. */
  qty: number | null;
  priceToStore: number;
  suggestedRetail: number;
  cost: number;
  /** El precio y el costo vinieron en el archivo (si no, se usaron los de las opciones). */
  priceFromFile: boolean;
  costFromFile: boolean;
  /** Producto que ya existe (por SKU o por código de barras). */
  existingId?: string;
  /** Lo que hay hoy en el almacén (si ya existe). */
  currentQty?: number;
}

export interface ImportPlan {
  rows: ImportRow[];
  counts: { nuevos: number; actualizan: number; conAvisos: number; conErrores: number };
  /** Avisos de todo el archivo (no trae precios, ni costos…). */
  notices: string[];
}

function hash4(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

/**
 * SKU para una fila sin referencia, sacado del nombre: «6x64 Box Press» → «SIN-REF-6X64-BOX-PRESS».
 * Siempre el mismo para el mismo nombre (volver a importar actualiza el mismo producto).
 */
export function derivedSku(name: string): string {
  const size = parseSize(name);
  const canonical = size ? name.replace(size.match, ` ${size.lengthIn}x${size.ringGauge} `) : name;
  const base = `SIN-REF-${slug(canonical).toUpperCase()}`;
  if (base.length <= 40) return base;
  return `${base.slice(0, 35).replace(/-+$/, '')}-${hash4(canonical)}`;
}

function titleCase(text: string): string {
  return text.replace(/\p{L}[\p{L}'’]*/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

interface Parsed {
  familyName: string;
  kind?: ProductKind;
  brandLine: string;
  /** Marca (premium): entra en el id de la familia. */
  brand: string;
  attrs: Record<string, string | number>;
  /** Atributos que salieron de las opciones (no del archivo): al actualizar no pisan lo que ya hay. */
  defaulted: string[];
  unitName: string;
  packSize: number;
}

/** Lo que hace falta para leer una fila: el nombre sin referencia, los atributos y la categoría. */
interface RowInput {
  text: string;
  found: Partial<Record<AttrKind, string>>;
  category: string;
  origin: string;
  originFromFile: boolean;
  hasCategoryColumn: boolean;
  opts: ImportOptions;
  warnings: string[];
  errors: string[];
}

function parseTabacoRow(r: RowInput): Parsed | null {
  const n = parseTabacoName(r.text);
  const size = n.size ?? (r.found.size ? (parseSize(r.found.size) ?? undefined) : undefined);
  const catKey = normalize(r.category);
  const premium = catKey === 'premium' || n.branded;
  if (!premium && !size) {
    r.errors.push('No encontré la medida (por ejemplo 6x52): no se puede armar la familia.');
    return null;
  }
  // Capa: la del nombre manda; si la categoría dice otra, se avisa.
  const fromName = n.capa ?? (r.found.capa ? capaFromWords(r.found.capa) : null);
  const fromCategory = catKey === 'premium' ? null : capaFromWords(r.category);
  if (fromName && fromCategory && fromName !== fromCategory) {
    r.warnings.push(`El nombre dice ${capaLabel(fromName)} y la categoría ${r.category}: queda ${capaLabel(fromName)}.`);
  }
  if (r.hasCategoryColumn && !r.category) r.warnings.push('Sin categoría.');
  else if (r.category && catKey !== 'premium' && !fromCategory && !isCubanOrigin(r.category)) r.warnings.push(`La categoría «${r.category}» no dice la capa.`);
  let capa = fromName ?? fromCategory;
  if (!capa) {
    capa = 'habano';
    r.warnings.push('No dice la capa: queda Habano.');
  }
  const valueVitola = r.found.vitola ? (VITOLAS.find(([p]) => p.join(' ') === normalize(r.found.vitola!))?.[1] ?? titleCase(r.found.vitola)) : '';
  const vitola = n.vitola || valueVitola;
  const words = n.vitola || !vitola ? n.words : [vitola, ...n.words];
  const strengthFromFile = r.found.strength ? STRENGTH[normalize(r.found.strength)] : undefined;
  const sizeAttrs: Record<string, number> = size ? { lengthIn: size.lengthIn, ringGauge: size.ringGauge } : {};
  const familyName = [...words, size ? sizeText(sizeAttrs) : ''].filter(Boolean).join(' ');
  const attrs: Record<string, string | number> = {
    vitola,
    ...sizeAttrs,
    capa,
    wrapperShade: capaShade(capa),
    strength: strengthFromFile ?? r.opts.strength,
    originCountry: r.origin,
  };
  const defaulted = [...(strengthFromFile ? [] : ['strength']), ...(r.originFromFile ? [] : ['originCountry'])];
  if (premium) {
    if (n.brand) attrs.brand = n.brand;
    return { familyName, kind: 'premium', brandLine: n.brand || 'Premium', brand: n.brand, attrs, defaulted, unitName: 'unidad', packSize: 1 };
  }
  attrs.cigarsPerBundle = r.opts.cigarsPerBundle;
  return { familyName, kind: 'mazo', brandLine: 'De mazo (sin marca)', brand: '', attrs, defaulted: [...defaulted, 'cigarsPerBundle'], unitName: 'mazo', packSize: r.opts.bundlesPerBox };
}

function parseCafeRow(r: RowInput): Parsed {
  let roast = r.opts.roast;
  const defaulted = ['productionLine'];
  if (r.found.roast) {
    const known = roastOf(r.found.roast);
    if (known) roast = known;
    else r.warnings.push(`No reconocí el tueste «${r.found.roast}»: queda ${r.opts.roast}.`);
  }
  if (!r.found.roast) defaulted.push('roast');
  if (!r.found.presentation) defaulted.push('presentation');
  if (!r.originFromFile) defaulted.push('origin');
  const attrs: Record<string, string | number> = {
    origin: r.origin,
    roast,
    grind: r.found.grind ?? '',
    weight: r.found.weight ?? WEIGHT_RE.exec(r.text)?.[0] ?? '',
    presentation: r.found.presentation ?? r.opts.presentation,
    productionLine: r.opts.productionLine,
  };
  return { familyName: r.text, brandLine: 'Café El Mío', brand: '', attrs, defaulted, unitName: 'unidad', packSize: r.opts.unitsPerBox };
}

/** La cantidad del archivo en la unidad del producto (mazos o unidades). */
function toProductQty(raw: string, p: { unitName: string; packSize: number; kind?: ProductKind }, opts: ImportOptions, warnings: string[]): number {
  const q = parseNumber(raw);
  const unit = unitNames(p.unitName);
  if (!raw || Number.isNaN(q)) {
    warnings.push('Sin cantidad: queda en 0.');
    return 0;
  }
  if (q < 0) {
    warnings.push(`Cantidad negativa en el archivo (${q}): queda en 0.`);
    return 0;
  }
  if (p.unitName === 'mazo' && opts.qtyUnit === 'tabaco') {
    const qty = Math.floor(q / opts.cigarsPerBundle);
    const left = Math.round(q - qty * opts.cigarsPerBundle);
    if (left > 0) warnings.push(`${countText(q, unitNames('tabaco'))} son ${countText(qty, unit)} y sobran ${left}: se redondeó hacia abajo.`);
    return qty;
  }
  // «Cajas»: la caja del producto (50 mazos, 12 unidades). Premium siempre viene por unidad.
  const per = opts.qtyUnit === 'caja' && p.kind !== 'premium' ? p.packSize : 1;
  const exact = q * per;
  const qty = Math.floor(exact + 1e-9);
  if (exact - qty > 1e-9) warnings.push(`La cantidad ${q} no es entera: queda en ${countText(qty, unit)}.`);
  return qty;
}

/**
 * Arma el plan: para cada fila, qué producto queda (familia, variante, SKU, unidad, cantidad y
 * precios), si es nuevo o actualiza uno que ya existe, y sus avisos o errores.
 */
export function buildImportPlan(
  line: LineId,
  table: SheetTable,
  map: ColumnMap,
  opts: ImportOptions,
  existing: readonly Product[],
  warehouseQty: ReadonlyMap<string, number>,
): ImportPlan {
  const cell = (row: readonly string[], f: ImportField) => {
    const i = map[f];
    return i === undefined || i < 0 ? '' : (row[i] ?? '').trim();
  };
  // null: dos productos del catálogo comparten ese SKU o código; no se adivina cuál actualizar.
  const index = (pairs: [string, Product][]) => {
    const m = new Map<string, Product | null>();
    for (const [k, p] of pairs) m.set(k, m.has(k) && m.get(k)?.id !== p.id ? null : p);
    return m;
  };
  const bySku = index(existing.map((p) => [p.sku.toLowerCase(), p]));
  const byBarcode = index(existing.filter((p) => p.barcode).map((p) => [p.barcode!.toUpperCase(), p]));
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  const rows: ImportRow[] = [];

  table.rows.forEach((cells, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const source = cell(cells, 'name');
    const { ref, rest } = splitRef(source);
    let text = rest;

    // Valores de la variante: en su columna o entre paréntesis al final del nombre («Café (Espresso, 10 oz)»).
    let values = parseVariantValues(cell(cells, 'variantValues'));
    const paren = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(text);
    if (paren) {
      const inside = parseVariantValues(paren[2] ?? '');
      if (values.length || (inside.length && inside.every((v) => (v.name ? ATTR_NAMES[normalize(v.name)] : guessKind(line, v.value))))) {
        text = (paren[1] ?? '').trim();
        if (!values.length) values = inside;
      }
    }
    if (!text) errors.push(source ? 'El nombre solo tiene la referencia.' : 'Sin nombre.');
    const found: Partial<Record<AttrKind, string>> = {};
    for (const v of values) {
      const kind = v.name ? ATTR_NAMES[normalize(v.name)] : guessKind(line, v.value);
      if (kind) found[kind] = v.value;
      else warnings.push(`No reconocí el atributo «${v.name ? `${v.name}: ` : ''}${v.value}».`);
    }

    const category = lastCategory(cell(cells, 'category'));
    const fileOrigin = cell(cells, 'origin') || found.origin || '';
    const origin = fileOrigin || opts.origin;
    if (line === 'tabaco' && (isCubanOrigin(origin) || isCubanOrigin(category))) {
      errors.push('Tabaco de origen Cuba: no se registra (embargo de EE. UU.).');
    }
    const input: RowInput = { text, found, category, origin, originFromFile: Boolean(fileOrigin), hasCategoryColumn: map.category !== undefined, opts, warnings, errors };
    const parsed = text ? (line === 'tabaco' ? parseTabacoRow(input) : parseCafeRow(input)) : null;

    // SKU: la columna de referencia, «[REF]» del nombre o uno sacado del nombre (siempre el mismo).
    let sku = cell(cells, 'sku') || ref || '';
    if (!sku && text) {
      sku = derivedSku(text);
      warnings.unshift(`Sin referencia: queda con el SKU ${sku}.`);
    }
    if (sku.length > 40) errors.push('La referencia tiene más de 40 caracteres.');
    // Como lo guarda y lo busca el lector: sin espacios ni guiones.
    const rawCode = cell(cells, 'barcode');
    let barcode: string | undefined = cleanCode(rawCode) || undefined;
    if (barcode && (/E\+/i.test(rawCode) || !/^[0-9A-Z]{4,32}$/.test(barcode))) {
      warnings.push(`El código de barras «${rawCode}» no sirve (¿Excel lo cortó?): no se guardó.`);
      barcode = undefined;
    } else if (barcode && /^\d{13}$/.test(barcode) && !isValidEan13(barcode)) {
      warnings.push(`El código de barras ${barcode} no es un EAN-13 válido: revisa el último dígito.`);
    }

    // ¿Ya existe? Por SKU o por código de barras: volver a importar nunca duplica.
    const skuKey = sku.toLowerCase();
    const skuHit = sku ? bySku.get(skuKey) : undefined;
    const codeHit = barcode ? byBarcode.get(barcode) : undefined;
    if (skuHit === null) errors.push(`Hay más de un producto con el SKU ${sku} en el catálogo: corrígelo antes de importar.`);
    if (codeHit === null) errors.push(`Hay más de un producto con el código ${barcode} en el catálogo: corrígelo antes de importar.`);
    const matchSku = skuHit ?? undefined;
    const matchCode = codeHit ?? undefined;
    if (matchSku && matchCode && matchSku.id !== matchCode.id) {
      errors.push(`El SKU ${sku} es de «${matchSku.name}» y el código ${barcode} de «${matchCode.name}».`);
    }
    const match = matchSku ?? matchCode;
    if (sku && seenSku.has(skuKey)) errors.push(`Repetido en el archivo: el mismo SKU que la fila ${seenSku.get(skuKey)}.`);
    else if (sku) seenSku.set(skuKey, rowNumber);
    if (barcode && seenBarcode.has(barcode)) errors.push(`Repetido en el archivo: el mismo código de barras que la fila ${seenBarcode.get(barcode)}.`);
    else if (barcode) seenBarcode.set(barcode, rowNumber);

    let unitName = parsed?.unitName ?? '';
    let packSize = parsed?.packSize ?? 1;
    if (match && parsed && match.unitName !== parsed.unitName) {
      errors.push(`Ya existe y se cuenta en ${unitNames(match.unitName).many}; el archivo lo trae en ${unitNames(parsed.unitName).many}. Cámbialo a mano.`);
    } else if (match) {
      unitName = match.unitName;
      packSize = match.packSize;
    }

    // Precio al local, PVP y costo. Al actualizar, lo que el archivo no trae se queda como está.
    const filePrice = parseNumber(cell(cells, 'price'));
    const priceFromFile = filePrice > 0;
    const fallback = parsed?.kind === 'premium' ? opts.defaultPremiumPrice : opts.defaultPrice;
    const priceToStore = round2(priceFromFile ? filePrice : match ? match.priceToStore : fallback);
    let suggestedRetail = round2(priceToStore * opts.pvpFactor);
    if (match && match.suggestedRetail >= priceToStore) suggestedRetail = match.suggestedRetail;
    if (!priceFromFile && map.price !== undefined) warnings.push(match ? 'Sin precio en el archivo: se deja el de hoy.' : `Sin precio: queda en ${fmtMoney(priceToStore)}.`);
    if (!(priceToStore > 0)) errors.push('Falta el precio al local.');
    const fileCost = parseNumber(cell(cells, 'cost'));
    const costFromFile = fileCost > 0;
    const cost = round2(costFromFile ? fileCost : match ? match.cost : (opts.defaultCost ?? 0));
    if (!costFromFile && map.cost !== undefined && (!match || match.sampleCost)) {
      warnings.push(opts.defaultCost && !match ? `Falta el costo: queda en ${fmtMoney(cost)} (de ejemplo).` : 'Falta el costo.');
    }
    if (costFromFile && cost > priceToStore) warnings.push(`El costo (${fmtMoney(cost)}) es mayor que el precio al local.`);

    const qty = map.qty !== undefined && parsed ? toProductQty(cell(cells, 'qty'), { unitName, packSize, kind: parsed.kind }, opts, warnings) : null;
    const familyName = parsed?.familyName ?? text;
    rows.push({
      rowNumber,
      source,
      status: errors.length ? 'error' : match ? 'actualiza' : 'nuevo',
      errors,
      warnings: errors.length ? [] : warnings,
      sku,
      barcode,
      kind: parsed?.kind,
      familyName,
      familyId: parsed ? familyIdFor(line, familyName, parsed.kind, parsed.kind === 'premium' ? parsed.brand : undefined) : '',
      variantLabel: '',
      name: familyName,
      brandLine: parsed?.brandLine ?? '',
      attrs: parsed?.attrs ?? {},
      defaultedAttrs: parsed?.defaulted ?? [],
      unitName,
      packSize,
      qty,
      priceToStore,
      suggestedRetail,
      cost,
      priceFromFile,
      costFromFile,
      existingId: match?.id,
      currentQty: match ? (warehouseQty.get(match.id) ?? 0) : undefined,
    });
  });

  // Variantes con las reglas del catálogo: de mazo siempre dice su capa; lo demás, si la familia tiene más de una.
  const ok = rows.filter((r) => r.status !== 'error');
  const updating = new Set(ok.map((r) => r.existingId).filter(Boolean));
  for (const r of ok) {
    const members = ok.filter((o) => o.familyId === r.familyId).length + existing.filter((p) => p.familyId === r.familyId && !updating.has(p.id)).length;
    const labelled = r.kind === 'mazo' || members > 1;
    r.variantLabel = labelled ? variantLabelFor(line, r.attrs, r.familyName) : '';
    r.name = composeName(r.familyName, r.variantLabel);
  }

  const notices: string[] = [];
  if (map.qty !== undefined) notices.push('La cantidad del archivo reemplaza la del almacén.');
  else notices.push('El archivo no trae cantidades: el almacén no se toca.');
  if (map.price === undefined) {
    notices.push(
      line === 'tabaco'
        ? `El archivo no trae precios: de mazo quedan a ${fmtMoney(opts.defaultPrice)} por mazo y premium a ${fmtMoney(opts.defaultPremiumPrice)} por unidad (los que ya existen no cambian). Cámbialos luego en cada producto.`
        : `El archivo no trae precios: quedan a ${fmtMoney(opts.defaultPrice)} por unidad (los que ya existen no cambian). Cámbialos luego en cada producto.`,
    );
  }
  if (map.cost === undefined) notices.push(`Falta el costo: el archivo no lo trae. Los nuevos quedan en ${fmtMoney(opts.defaultCost ?? 0)}, marcado como de ejemplo, hasta que lo pongas.`);
  if (map.origin === undefined && opts.origin) notices.push(`${line === 'tabaco' ? 'Procedencia' : 'Origen'}: ${opts.origin} para los nuevos.`);

  return {
    rows,
    counts: {
      nuevos: rows.filter((r) => r.status === 'nuevo').length,
      actualizan: rows.filter((r) => r.status === 'actualiza').length,
      conAvisos: rows.filter((r) => r.status !== 'error' && r.warnings.length > 0).length,
      conErrores: rows.filter((r) => r.status === 'error').length,
    },
    notices,
  };
}

/** «12 nuevos · 3 se actualizan · 4 con avisos · 1 con errores». */
export function countsText(c: ImportPlan['counts']): string {
  return `${c.nuevos} ${c.nuevos === 1 ? 'nuevo' : 'nuevos'} · ${c.actualizan} se ${c.actualizan === 1 ? 'actualiza' : 'actualizan'} · ${c.conAvisos} con avisos · ${c.conErrores} con errores`;
}

/**
 * Mismas reglas que al guardar un producto: el nombre es familia + variante, y en una familia de
 * más de una variante (o de mazo) cada una dice su capa y su medida. Devuelve los que cambian.
 */
export function relabelFamilies(line: LineId, products: readonly Product[], familyIds: ReadonlySet<string>, at: string): Product[] {
  const changed: Product[] = [];
  for (const fid of familyIds) {
    const members = products.filter((p) => (p.familyId ?? p.id) === fid);
    for (const p of members) {
      if (!p.familyName) continue;
      const labelled = p.kind === 'mazo' || members.length > 1;
      const label = labelled ? variantLabelFor(line, p.attrs, p.familyName) : '';
      const name = composeName(p.familyName, label);
      if (label !== (p.variantLabel ?? '') || name !== p.name) changed.push({ ...p, variantLabel: label, name, updatedAt: at });
    }
  }
  return changed;
}
