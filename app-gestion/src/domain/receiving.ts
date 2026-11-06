// Recibir una importación bulto por bulto. Reglas puras: leer la lista de empaque (columnas,
// reconocer cada producto por código o por vitola, medida y capa), armar los bultos, el estado
// de cada bulto al contarlo, lo que entra al almacén y las diferencias para reclamar a la fábrica.
import type { ArrivalItem, Bale, BaleStatus, Product } from '../data/types';
import { cleanCode } from '../lib/barcode';
import { headerKey, parseNumber, type SheetTable } from '../lib/sheets';
import { capaFromText, capaLabel, normalize } from './products';

// ---------- Columnas de la lista de empaque ----------

export type PackingRole = 'bale' | 'qty' | 'vitola' | 'capa' | 'code' | 'name' | 'perBundle' | 'cost' | 'costTotal';

export const PACKING_ROLES: { role: PackingRole; label: string; hint?: string }[] = [
  { role: 'bale', label: 'Bulto', hint: 'Si una fila no lo trae, es del mismo bulto que la de arriba (bulto mixto).' },
  { role: 'qty', label: 'Mazos (cantidad)' },
  { role: 'vitola', label: 'Medida o vitola' },
  { role: 'capa', label: 'Capa' },
  { role: 'code', label: 'Código o SKU' },
  { role: 'name', label: 'Producto o descripción' },
  { role: 'perBundle', label: 'Tabacos por mazo' },
  { role: 'cost', label: 'Costo por mazo' },
  { role: 'costTotal', label: 'Costo total de la fila' },
];

export type PackingColumns = Partial<Record<PackingRole, number>>;

/** En orden: el primero que calza se queda con la columna (por eso «tabacos por mazo» va antes que «mazos»). */
const HEADER_RULES: [PackingRole, RegExp][] = [
  ['perBundle', /(tabacos?|puros?|cigars?|unidades) (x|por|per|en el|in) (mazo|bundle)|^por mazo$|^(tab )?x mazo$/],
  ['costTotal', /(costo|cost|precio|valor|importe|monto).*total|total.*(costo|cost|usd)|^total$|^importe$|^subtotal$|^monto$/],
  ['bale', /^(no |num |numero |n |nro )?(de )?(bulto|bultos|fardo|paca|bale)( no| num| numero| n| nro)?$/],
  ['qty', /^(cantidad|cant|qty|unidades|bundles|mazos)\b/],
  ['vitola', /(medida|vitola|tamano|size|formato)/],
  ['capa', /^(capa|wrapper|color de capa|color)\b/],
  ['code', /^(sku|codigo|cod|barcode|ean|upc|item|referencia|ref)\b/],
  ['name', /^(producto|descripcion|description|articulo|nombre|detalle)\b/],
  ['cost', /^(costo|cost|precio|valor|unit cost)\b/],
];

/** Adivina qué columna es cada cosa mirando los encabezados. */
export function detectPackingColumns(headers: readonly string[]): PackingColumns {
  const out: PackingColumns = {};
  const used = new Set<number>();
  for (const [role, re] of HEADER_RULES) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(headerKey(h)));
    if (i >= 0 && out[role] === undefined) {
      out[role] = i;
      used.add(i);
    }
  }
  return out;
}

// ---------- Reconocer el producto ----------

export type MatchProduct = Pick<Product, 'id' | 'name' | 'sku' | 'active' | 'unitName' | 'attrs'> & Partial<Pick<Product, 'barcode' | 'familyName' | 'kind'>>;

/** Lo que dice una línea: «52 torpedo maduro», «6x52 Toro Habano», «6 1/8 x 52». */
export interface ParsedDescription {
  vitola?: string;
  capa?: string;
  length?: number;
  ring?: number;
}

const FRACTION_CHARS: Record<string, number> = { '⅛': 0.125, '¼': 0.25, '⅜': 0.375, '½': 0.5, '⅝': 0.625, '¾': 0.75, '⅞': 0.875 };

function parseLength(raw: string): number | undefined {
  let t = raw.trim().replace(',', '.');
  let extra = 0;
  const frac = t.match(/([⅛¼⅜½⅝¾⅞])$/);
  if (frac) {
    extra = FRACTION_CHARS[frac[1]!] ?? 0;
    t = t.slice(0, -1).trim();
  }
  const slash = t.match(/^(\d+)\s+(\d)\/(\d)$/);
  if (slash) return Number(slash[1]) + Number(slash[2]) / Number(slash[3]);
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n + extra : undefined;
}

export function parseDescription(text: string, vitolas: readonly string[]): ParsedDescription {
  const t = normalize(text);
  const out: ParsedDescription = {};
  const size = t.match(/(\d+(?:[.,]\d+)?(?:\s+\d\/\d)?[⅛¼⅜½⅝¾⅞]?)\s*[x×*]\s*(\d{2})/);
  let rest = t;
  if (size) {
    out.length = parseLength(size[1]!);
    out.ring = Number(size[2]);
    rest = t.replace(size[0], ' ');
  }
  if (out.ring === undefined) {
    const ring = rest.match(/(?:^|\D)([3-8]\d)(?:\D|$)/);
    if (ring) out.ring = Number(ring[1]);
  }
  // La vitola más larga que aparece como palabra («toro» no calza dentro de «torpedo»).
  const found = [...vitolas]
    .map((v) => normalize(v))
    .filter((v) => v && new RegExp(`(^|[^a-z])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t))
    .sort((a, b) => b.length - a.length)[0];
  if (found) out.vitola = found;
  const capa = capaFromText(t);
  if (capa) out.capa = capa;
  return out;
}

export interface MatchResult {
  productId: string | null;
  how: 'codigo' | 'medida' | null;
  /** Los que podrían ser, el mejor primero (para elegir a mano). */
  candidates: string[];
}

/** Reconoce el producto de una línea: por código (de barras o SKU) o por vitola, medida y capa. */
export function matchPackingProduct(products: readonly MatchProduct[], line: { code?: string; text: string; perBundle?: number }): MatchResult {
  const code = line.code ? cleanCode(line.code) : '';
  if (code) {
    const byCode = products.find((p) => (p.barcode && cleanCode(p.barcode) === code) || cleanCode(p.sku) === code);
    if (byCode) return { productId: byCode.id, how: 'codigo', candidates: [byCode.id] };
  }
  const exactName = products.find((p) => normalize(p.name) === normalize(line.text));
  if (exactName) return { productId: exactName.id, how: 'medida', candidates: [exactName.id] };
  const vitolas = [...new Set(products.map((p) => String(p.attrs.vitola ?? '')).filter(Boolean))];
  const d = parseDescription(line.text, vitolas);
  const signals = [d.vitola, d.capa, d.length, d.ring].filter((x) => x !== undefined).length;
  if (signals === 0) return { productId: null, how: null, candidates: [] };
  const scored = products
    .map((p) => {
      const a = p.attrs;
      let score = 0;
      if (d.vitola !== undefined) {
        if (normalize(String(a.vitola ?? '')) !== d.vitola) return null;
        score += 3;
      }
      if (d.capa !== undefined) {
        const capa = String(a.capa ?? '') || capaFromText(String(a.wrapper ?? '')) || '';
        if (capa !== d.capa) return null;
        score += 3;
      }
      if (d.ring !== undefined) {
        if (Number(a.ringGauge) !== d.ring) return null;
        score += 2;
      }
      if (d.length !== undefined) {
        if (Math.abs(Number(a.lengthIn) - d.length) > 0.02) return null;
        score += 2;
      }
      if (line.perBundle && p.unitName === 'mazo' && Number(a.cigarsPerBundle ?? 25) !== line.perBundle) score -= 1;
      if (p.unitName === 'mazo') score += 1;
      if (p.active) score += 0.5;
      return { id: p.id, score };
    })
    .filter((x): x is { id: string; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  // Hace falta al menos dos datos (por ejemplo vitola y capa) y que no haya empate.
  if (best && signals >= 2 && (!second || best.score > second.score)) return { productId: best.id, how: 'medida', candidates: scored.map((s) => s.id) };
  return { productId: null, how: null, candidates: scored.map((s) => s.id) };
}

// ---------- Leer la lista de empaque ----------

export interface PackingLine {
  /** Fila del archivo (contando los encabezados como la 1). */
  row: number;
  bale: string;
  /** Lo que se usó para reconocer el producto («52 torpedo maduro»). */
  text: string;
  code: string;
  qty: number;
  perBundle?: number;
  unitCost?: number;
  productId: string | null;
  how: 'codigo' | 'medida' | 'mano' | null;
  candidates: string[];
}

export interface PackingParse {
  lines: PackingLine[];
  skipped: { row: number; reason: string }[];
}

/** Convierte la hoja en líneas (bulto, producto, mazos, costo). El bulto vacío es el de la fila de arriba. */
export function parsePackingList(table: SheetTable, cols: PackingColumns, products: readonly MatchProduct[]): PackingParse {
  const lines: PackingLine[] = [];
  const skipped: PackingParse['skipped'] = [];
  const cell = (r: string[], role: PackingRole) => (cols[role] === undefined ? '' : (r[cols[role]!] ?? '').trim());
  let bale = '';
  table.rows.forEach((r, i) => {
    const row = i + 2;
    if (r.every((c) => !c.trim())) return;
    const baleCell = cell(r, 'bale');
    if (baleCell) bale = baleCell.replace(/^(bulto|fardo|paca)\s*/i, '').trim();
    const text = [cell(r, 'vitola'), cell(r, 'capa'), cell(r, 'name')].filter(Boolean).join(' ');
    const code = cell(r, 'code');
    const qtyText = cell(r, 'qty');
    if (/total/i.test(`${baleCell} ${text}`) && !code) {
      skipped.push({ row, reason: 'Fila de totales' });
      return;
    }
    const qty = parseNumber(qtyText);
    if (!qtyText || !Number.isFinite(qty)) {
      skipped.push({ row, reason: 'Sin cantidad de mazos' });
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      skipped.push({ row, reason: `Cantidad no válida (${qtyText})` });
      return;
    }
    if (!bale) {
      skipped.push({ row, reason: 'Sin número de bulto' });
      return;
    }
    const perBundle = parseNumber(cell(r, 'perBundle'));
    const unit = parseNumber(cell(r, 'cost'));
    const total = parseNumber(cell(r, 'costTotal'));
    const unitCost = Number.isFinite(unit) && unit >= 0 ? unit : Number.isFinite(total) && total >= 0 ? Math.round((total / qty) * 10000) / 10000 : undefined;
    const m = matchPackingProduct(products, { code, text: text || code, perBundle: Number.isFinite(perBundle) ? perBundle : undefined });
    lines.push({ row, bale, text: text || code, code, qty, perBundle: Number.isFinite(perBundle) ? perBundle : undefined, unitCost, productId: m.productId, how: m.how, candidates: m.candidates });
  });
  return { lines, skipped };
}

// ---------- Bultos ----------

export interface BaleDraft {
  number: string;
  items: { productId: string; qty: number; unitCost: number }[];
}

/** Agrupa líneas en bultos (en el orden en que aparecen); el mismo producto dos veces en un bulto se suma. */
export function groupIntoBales(lines: readonly { bale: string; productId: string; qty: number; unitCost: number }[]): BaleDraft[] {
  const out: BaleDraft[] = [];
  const byNumber = new Map<string, BaleDraft>();
  for (const l of lines) {
    const key = l.bale.trim();
    let b = byNumber.get(key);
    if (!b) {
      b = { number: key, items: [] };
      byNumber.set(key, b);
      out.push(b);
    }
    const same = b.items.find((i) => i.productId === l.productId);
    if (same) {
      const qty = same.qty + l.qty;
      same.unitCost = roundCost((same.unitCost * same.qty + l.unitCost * l.qty) / qty);
      same.qty = qty;
    } else b.items.push({ productId: l.productId, qty: l.qty, unitCost: l.unitCost });
  }
  return out;
}

function roundCost(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Lo que dice la lista de empaque por producto (mazos y costo promedio): los ítems de la llegada. */
export function itemsFromBales(bales: readonly Pick<Bale, 'items'>[]): ArrivalItem[] {
  const map = new Map<string, { qty: number; cost: number }>();
  for (const b of bales) {
    for (const it of b.items) {
      const cur = map.get(it.productId) ?? { qty: 0, cost: 0 };
      cur.qty += it.qty;
      cur.cost += it.qty * it.unitCost;
      map.set(it.productId, cur);
    }
  }
  return [...map].map(([productId, v]) => ({ productId, qty: v.qty, unitCost: roundCost(v.qty ? v.cost / v.qty : 0) }));
}

/** Lo contado de un producto en un bulto (si no se contó, lo que dice la lista). */
export function countedOf(b: Pick<Bale, 'items' | 'counted'>, productId: string): number {
  const c = b.counted?.[productId];
  if (c !== undefined) return c;
  return b.items.filter((i) => i.productId === productId).reduce((s, i) => s + i.qty, 0);
}

/** Estado del bulto según lo contado: bien, falta o sobra (dañado lo marca la persona). */
export function baleStatusFor(b: Pick<Bale, 'items'>, counted: Record<string, number>, damaged = false): BaleStatus {
  if (damaged) return 'danado';
  let less = false;
  let more = false;
  for (const it of b.items) {
    const c = counted[it.productId] ?? it.qty;
    if (c < it.qty) less = true;
    if (c > it.qty) more = true;
  }
  return less ? 'falta' : more ? 'sobra' : 'bien';
}

export const BALE_STATUS_LABEL: Record<BaleStatus, string> = {
  pendiente: 'Por revisar',
  bien: 'Bien',
  falta: 'Falta',
  sobra: 'Sobra',
  danado: 'Dañado',
};

export interface ReceivedLine {
  productId: string;
  expected: number;
  /** Lo que entra al almacén (lo contado). */
  qty: number;
  /** Costo por unidad: el de los bultos, promediado por lo contado. */
  unitCost: number;
}

/** Lo que entra al almacén: lo contado de cada producto, con el costo de sus bultos. */
export function receivedFromBales(bales: readonly Bale[]): ReceivedLine[] {
  const map = new Map<string, { expected: number; qty: number; cost: number; listCost: number }>();
  for (const b of bales) {
    for (const it of b.items) {
      const cur = map.get(it.productId) ?? { expected: 0, qty: 0, cost: 0, listCost: 0 };
      const counted = countedOf(b, it.productId);
      cur.expected += it.qty;
      cur.qty += counted;
      cur.cost += counted * it.unitCost;
      cur.listCost += it.qty * it.unitCost;
      map.set(it.productId, cur);
    }
  }
  return [...map].map(([productId, v]) => ({
    productId,
    expected: v.expected,
    qty: v.qty,
    unitCost: roundCost(v.qty ? v.cost / v.qty : v.expected ? v.listCost / v.expected : 0),
  }));
}

// ---------- Diferencias (para reclamar a la fábrica) ----------

export interface DiffRow {
  bale: string;
  productId: string;
  expected: number;
  counted: number;
  diff: number;
  unitCost: number;
  /** Diferencia en dólares (al costo del bulto): negativa si falta. */
  value: number;
  status: BaleStatus;
  note?: string;
  photoIds?: string[];
}

export interface DiffReport {
  /** Por bulto y producto, solo los bultos con algo que reclamar (falta, sobra o dañado). */
  rows: DiffRow[];
  byProduct: { productId: string; expected: number; counted: number; diff: number; value: number }[];
  checked: number;
  total: number;
  withIssues: number;
  expected: number;
  counted: number;
  diff: number;
  value: number;
}

export function arrivalDifferences(bales: readonly Bale[]): DiffReport {
  const rows: DiffRow[] = [];
  const byProduct = new Map<string, { expected: number; counted: number; value: number }>();
  let checked = 0;
  let withIssues = 0;
  for (const b of bales) {
    if (b.status === 'pendiente') continue;
    checked += 1;
    const issue = b.status !== 'bien';
    if (issue) withIssues += 1;
    for (const it of b.items) {
      const counted = countedOf(b, it.productId);
      const diff = counted - it.qty;
      const value = Math.round(diff * it.unitCost * 100) / 100;
      const cur = byProduct.get(it.productId) ?? { expected: 0, counted: 0, value: 0 };
      cur.expected += it.qty;
      cur.counted += counted;
      cur.value = Math.round((cur.value + value) * 100) / 100;
      byProduct.set(it.productId, cur);
      if (issue) rows.push({ bale: b.number, productId: it.productId, expected: it.qty, counted, diff, unitCost: it.unitCost, value, status: b.status, note: b.note, photoIds: b.photoIds });
    }
  }
  const list = [...byProduct].map(([productId, v]) => ({ productId, expected: v.expected, counted: v.counted, diff: v.counted - v.expected, value: v.value }));
  const sum = (f: (x: (typeof list)[number]) => number) => list.reduce((s, x) => s + f(x), 0);
  return {
    rows,
    byProduct: list,
    checked,
    total: bales.length,
    withIssues,
    expected: sum((x) => x.expected),
    counted: sum((x) => x.counted),
    diff: sum((x) => x.diff),
    value: Math.round(sum((x) => x.value) * 100) / 100,
  };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV para la fábrica (con BOM para que Excel lea las tildes). */
export function differencesCsv(
  report: DiffReport,
  info: (productId: string) => { name: string; sku: string; unitName: string },
  meta: { code: string; supplier: string },
): string {
  const money = (n: number) => n.toFixed(2);
  const lines: (string | number)[][] = [
    [`Diferencias de la importación ${meta.code}`],
    [`Proveedor: ${meta.supplier}`],
    [`Bultos revisados: ${report.checked} de ${report.total}; con diferencias: ${report.withIssues}`],
    [],
    ['Bulto', 'Producto', 'SKU', 'Unidad', 'Lista de empaque', 'Contado', 'Diferencia', 'Costo por unidad (USD)', 'Diferencia (USD)', 'Estado', 'Nota'],
    ...report.rows.map((r) => {
      const p = info(r.productId);
      return [r.bale, p.name, p.sku, p.unitName, r.expected, r.counted, r.diff, money(r.unitCost), money(r.value), BALE_STATUS_LABEL[r.status], r.note ?? ''];
    }),
    [],
    ['Por producto'],
    ['Producto', 'SKU', 'Unidad', 'Lista de empaque', 'Contado', 'Diferencia', 'Diferencia (USD)'],
    ...report.byProduct.map((x) => {
      const p = info(x.productId);
      return [p.name, p.sku, p.unitName, x.expected, x.counted, x.diff, money(x.value)];
    }),
    [],
    ['Total', '', '', report.expected, report.counted, report.diff, money(report.value)],
  ];
  return `\uFEFF${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** Texto corto de lo que dice una descripción reconocida («Torpedo · 52 · Maduro»). */
export function describeParsed(d: ParsedDescription): string {
  return [d.vitola, d.length && d.ring ? `${d.length} × ${d.ring}` : d.ring, d.capa ? capaLabel(d.capa) : ''].filter(Boolean).join(' · ');
}
