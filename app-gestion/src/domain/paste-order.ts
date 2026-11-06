// «Pegar pedido»: lee un mensaje de WhatsApp («10 toro maduro, 5 robusto habano, 2 cajas torpedo»)
// y propone las líneas del pedido para revisarlas. Sin inteligencia artificial: números, palabras de
// cantidad y presentación, códigos, medidas y palabras parecidas (plurales, tildes y errores de dedo).
// Función pura: la usa la pantalla «Pegar pedido» y la prueban las pruebas unitarias.
import type { Product, SalePack } from '../data/types';
import { capaFromText, capaLabel, normalize } from './products';

export type PasteProduct = Pick<Product, 'id' | 'name' | 'sku' | 'unitName' | 'packSize' | 'attrs'> &
  Partial<Pick<Product, 'barcode' | 'familyName' | 'variantLabel' | 'kind' | 'active'>>;

export type PasteStatus = 'ok' | 'ambiguo' | 'desconocido';

export interface PasteLine {
  /** El pedazo del mensaje de donde salió la línea. */
  raw: string;
  /** Cantidad en su presentación (cajas o la unidad del producto). */
  qty: number;
  pack: SalePack;
  /** El mensaje no dijo «caja» ni «mazo»: se propone la presentación de siempre del producto. */
  packGuessed: boolean;
  /** El mensaje no dijo cuántos: se propone 1. */
  qtyGuessed: boolean;
  /** El producto, si no hay dudas. En una línea ambigua hay que elegirlo entre los candidatos. */
  productId: string | null;
  status: PasteStatus;
  /** Productos posibles, del más parecido al menos (en una línea ambigua, para elegir). */
  candidates: string[];
}

export interface PasteResult {
  lines: PasteLine[];
  /** Pedazos sin cantidad ni producto: saludos, gracias, firmas. */
  ignored: string[];
}

// ---------- Palabras ----------

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  quince: 15,
  veinte: 20,
  veinticinco: 25,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  cien: 100,
  media: 0.5,
  medio: 0.5,
};

const BOX_WORDS = new Set(['caja', 'cajas', 'cj', 'cjs', 'cja', 'cjas', 'cajita', 'cajitas', 'box', 'boxes', 'bx']);
/** Palabras que piden mazos (lo de mazo). */
const BUNDLE_WORDS = new Set(['mazo', 'mazos', 'mz', 'mzs', 'mzo', 'mzos', 'bundle', 'bundles']);
/** Palabras que piden la unidad suelta del producto (tabacos, paquetes, unidades). */
const UNIT_WORDS = new Set([
  'unidad',
  'unidades',
  'und',
  'unds',
  'ud',
  'uds',
  'u',
  'tabaco',
  'tabacos',
  'puro',
  'puros',
  'pieza',
  'piezas',
  'pz',
  'pzs',
  'pc',
  'pcs',
  'paquete',
  'paquetes',
  'paq',
  'bolsa',
  'bolsas',
]);

/** Palabras que no dicen qué producto es. */
const STOP = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'lo',
  'al',
  'a',
  'en',
  'con',
  'por',
  'para',
  'mas',
  'y',
  'e',
  'o',
  'favor',
  'porfa',
  'porfavor',
  'pf',
  'pls',
  'please',
  'me',
  'mandas',
  'manda',
  'mandame',
  'mandar',
  'envia',
  'enviame',
  'enviar',
  'envie',
  'trae',
  'traeme',
  'traer',
  'quiero',
  'queremos',
  'quisiera',
  'necesito',
  'necesitamos',
  'ponme',
  'pon',
  'anota',
  'anotame',
  'apunta',
  'apuntame',
  'hola',
  'buenas',
  'buenos',
  'dias',
  'tardes',
  'noches',
  'gracias',
  'saludos',
  'bendiciones',
  'mi',
  'amigo',
  'hermano',
  'otra',
  'otro',
  'otras',
  'otros',
  'vez',
  'tambien',
  'este',
  'esta',
  'es',
  'son',
  'que',
  'si',
  'pedido',
  'semana',
  'hoy',
  'manana',
  'cada',
  'mas',
  'ok',
  'okay',
  'listo',
  'nada',
  'eso',
  'todo',
  'seria',
  'serian',
]);

/** Plural → singular, sin tocar palabras cortas. */
function singulars(w: string): string[] {
  const out = [w];
  if (w.length > 4 && w.endsWith('es')) out.push(w.slice(0, -2));
  if (w.length > 3 && w.endsWith('s')) out.push(w.slice(0, -1));
  return out;
}

/** Distancia de edición con transposición (dos letras cambiadas de lugar cuentan como un error). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[m]![n]!;
}

/** Qué tan bien una palabra del mensaje se parece a una palabra del producto (0 = nada). */
function wordMatch(w: string, t: string): number {
  if (w === t) return 1;
  const ws = singulars(w);
  const ts = singulars(t);
  if (ws.some((x) => ts.includes(x))) return 0.95;
  if (w.length >= 3 && t.startsWith(w)) return 0.8;
  const allowed = w.length >= 8 ? 2 : w.length >= 5 ? 1 : 0;
  if (allowed > 0) {
    for (const x of ws) if (editDistance(x, t) <= allowed) return 0.7;
  }
  return 0;
}

// ---------- Índice de productos ----------

interface Indexed {
  p: PasteProduct;
  /** Palabras del nombre (familia y variante): las que cuentan para «lo nombró completo». */
  nameTokens: string[];
  /** Todas las palabras con las que se lo puede nombrar (nombre, vitola, capa y sus sinónimos). */
  tokens: string[];
  capa: string | null;
  len: number | null;
  ring: number | null;
  sku: string;
  barcode: string;
}

/** Frases del nombre con número que se leen juntas: «caja de 24» es una sola palabra («cajade24»). */
const GLUE = /\b(caja|paquete|bolsa|sobre|capsula)s? de (\d+)\b/g;

function glue(text: string, known?: ReadonlySet<string>): string {
  return text.replace(GLUE, (m, w: string, n: string) => (!known || known.has(`${w}de${n}`) ? ` ${w}de${n} ` : m));
}

function wordsOf(text: string): string[] {
  return normalize(text)
    .replace(/[×]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w));
}

function indexProduct(p: PasteProduct): Indexed {
  const nameText = glue(normalize([p.familyName ?? p.name, p.variantLabel ?? '', p.name].join(' ')));
  const nameTokens = [...new Set(wordsOf(nameText).filter((w) => !/^\d+$/.test(w)))];
  const capa = p.attrs.capa ? String(p.attrs.capa) : null;
  const extra = [String(p.attrs.vitola ?? ''), capa ?? '', capa ? capaLabel(capa) : ''].flatMap(wordsOf);
  const tokens = [...new Set([...nameTokens, ...extra.filter((w) => !/^\d+$/.test(w))])];
  const len = Number(p.attrs.lengthIn);
  const ring = Number(p.attrs.ringGauge);
  return {
    p,
    nameTokens,
    tokens,
    capa,
    len: Number.isFinite(len) && len > 0 ? len : null,
    ring: Number.isFinite(ring) && ring > 0 ? ring : null,
    sku: p.sku.toLowerCase().replace(/[^a-z0-9]/g, ''),
    barcode: (p.barcode ?? '').toLowerCase(),
  };
}

// ---------- Lectura del mensaje ----------

type Token =
  | { kind: 'qty'; n: number }
  | { kind: 'pack'; pack: 'caja' | 'mazo' | 'unidad' }
  | { kind: 'size'; len: number; ring: number }
  | { kind: 'code'; code: string }
  | { kind: 'word'; w: string };

interface Item {
  qty?: number;
  qtyTrailing: boolean;
  pack?: 'caja' | 'mazo' | 'unidad';
  words: string[];
  sizes: { len: number; ring: number }[];
  codes: string[];
  raw: string[];
}

const newItem = (): Item => ({ qtyTrailing: false, words: [], sizes: [], codes: [], raw: [] });
const hasProduct = (it: Item) => it.words.length > 0 || it.sizes.length > 0 || it.codes.length > 0;

/** Parte el mensaje en pedazos: renglones, comas, punto y coma, viñetas, « y », « + ». */
function segments(text: string): string[] {
  return text
    .replace(/×/g, 'x')
    .split(/\r?\n|[,;•·|]|\.\s+|\s+y\s+|\s+e\s+|\s+\+\s+|\s+&\s+|\s+-\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Una medida creíble de tabaco: de 3 a 10 pulgadas y cepo de 26 a 80. */
function sizeToken(m: string, len: number, ring: number): string {
  return len >= 3 && len <= 10 && ring >= 26 && ring <= 80 ? ` s${len}x${ring} ` : m;
}

function tokenize(segment: string, glued: ReadonlySet<string>): Token[] {
  let s = glue(normalize(segment).replace(/×/g, 'x'), glued);
  // Medidas: «6x52», «6 x 52», «6.5x52», «6 1/8 x 52».
  s = s.replace(/(\d+)\s+(\d)\/(\d)\s*x\s*(\d{2})\b/g, (m, a: string, b: string, c: string, r: string) => sizeToken(m, Number(a) + Number(b) / Number(c), Number(r)));
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:x|por)\s*(\d{2})\b/g, (m, a: string, r: string) => sizeToken(m, Number(a), Number(r)));
  // Multiplicador: «x3», «x 3», «3x».
  s = s.replace(/(^|\s)x\s*(\d{1,4})\b/g, '$1 $2 ');
  s = s.replace(/\b(\d{1,4})\s*x(?=\s|$)/g, ' $1 ');
  // Un número pegado a la presentación: «2cj», «10mz».
  s = s.replace(/\b(\d{1,4})(cajas?|cjs?|cjas?|mazos?|mzs?|mzos?|u|und|uds?)\b/g, '$1 $2');
  const out: Token[] = [];
  for (const raw of s.match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g) ?? []) {
    const size = /^s(\d+(?:\.\d+)?)x(\d{2})$/.exec(raw);
    if (size) {
      out.push({ kind: 'size', len: Number(size[1]), ring: Number(size[2]) });
      continue;
    }
    if (/^\d{1,4}$/.test(raw)) {
      out.push({ kind: 'qty', n: Number(raw) });
      continue;
    }
    if (/^\d{6,14}$/.test(raw) || /^(?=.*\d)(?=.*[a-z])[a-z0-9]+(?:-[a-z0-9]+)+$/.test(raw)) {
      out.push({ kind: 'code', code: raw });
      continue;
    }
    if (NUMBER_WORDS[raw] !== undefined) {
      out.push({ kind: 'qty', n: NUMBER_WORDS[raw]! });
      continue;
    }
    if (BOX_WORDS.has(raw)) {
      out.push({ kind: 'pack', pack: 'caja' });
      continue;
    }
    if (BUNDLE_WORDS.has(raw)) {
      out.push({ kind: 'pack', pack: 'mazo' });
      continue;
    }
    if (UNIT_WORDS.has(raw)) {
      out.push({ kind: 'pack', pack: 'unidad' });
      continue;
    }
    if (STOP.has(raw)) continue;
    out.push({ kind: 'word', w: raw });
  }
  return out;
}

/** Junta los tokens en líneas: «10 toro maduro 5 robusto» son dos; «toro maduro 10» lleva el número al final. */
function group(tokens: Token[]): Item[] {
  const items: Item[] = [];
  let cur = newItem();
  const push = () => {
    if (cur.qty !== undefined || hasProduct(cur)) items.push(cur);
    cur = newItem();
  };
  for (const t of tokens) {
    if (t.kind === 'qty') {
      if (cur.qty !== undefined && (hasProduct(cur) || cur.qtyTrailing)) push();
      else if (cur.qty === undefined && hasProduct(cur)) {
        cur.qty = t.n;
        cur.qtyTrailing = true;
        cur.raw.push(String(t.n));
        continue;
      }
      cur.qty = t.n;
      cur.raw.push(String(t.n));
      continue;
    }
    if (t.kind === 'pack') {
      if (cur.qtyTrailing && cur.pack) push();
      cur.pack = cur.pack ?? t.pack;
      cur.raw.push(t.pack === 'caja' ? 'caja' : t.pack === 'mazo' ? 'mazo' : 'unidad');
      continue;
    }
    if (cur.qtyTrailing) push();
    if (t.kind === 'word') {
      cur.words.push(t.w);
      cur.raw.push(t.w);
    } else if (t.kind === 'size') {
      cur.sizes.push({ len: t.len, ring: t.ring });
      cur.raw.push(`${t.len}x${t.ring}`);
    } else {
      cur.codes.push(t.code);
      cur.raw.push(t.code);
    }
  }
  push();
  return items;
}

// ---------- Elegir el producto ----------

interface Scored {
  id: string;
  score: number;
}

function scoreProducts(item: Item, index: readonly Indexed[], relevant: (w: string) => boolean, preferred: ReadonlySet<string>): Scored[] {
  // Un código (SKU o código de barras) manda: no hay que adivinar (si dos productos comparten el
  // SKU, se pregunta cuál).
  for (const code of item.codes) {
    const clean = code.replace(/[^a-z0-9]/g, '');
    const byBarcode = index.filter((x) => x.barcode === code);
    const hits = byBarcode.length ? byBarcode : index.filter((x) => x.sku === clean);
    if (hits.length) return hits.map((h) => ({ id: h.p.id, score: 100 }));
  }
  const words = item.words.filter(relevant);
  const out: Scored[] = [];
  for (const x of index) {
    let matched = 0;
    let unmatched = 0;
    const covered = new Set<string>();
    for (const w of words) {
      let best = 0;
      let bestToken = '';
      for (const t of x.tokens) {
        const q = wordMatch(w, t);
        if (q > best) {
          best = q;
          bestToken = t;
        }
      }
      // Sinónimos de capa: «colorado» es habano, «broadleaf» es oscuro.
      const capa = capaFromText(w);
      if (best < 1 && capa && x.capa === capa) {
        best = 1;
        bestToken = x.nameTokens.find((t) => wordMatch(t, capa) > 0) ?? capa;
      }
      if (best > 0) {
        matched += best;
        covered.add(bestToken);
      } else unmatched += 1;
    }
    // Medida: igual cuenta mucho; a ⅛″ o a ½″ con el mismo cepo, algo menos.
    for (const s of item.sizes) {
      const diff = x.len === null ? Infinity : Math.abs(x.len - s.len);
      if (x.ring === s.ring && diff < 0.02) matched += 1.2;
      else if (x.ring === s.ring && diff <= 0.13) matched += 0.6;
      else if (x.ring === s.ring && diff <= 0.5) matched += 0.3;
      else unmatched += 1;
    }
    if (matched <= 0) continue;
    const named = x.nameTokens.filter((t) => covered.has(t)).length;
    const coverage = x.nameTokens.length ? named / x.nameTokens.length : 0;
    let score = matched - 0.75 * unmatched + 1.2 * coverage;
    if (coverage === 1 && unmatched === 0) score += 0.5;
    if (preferred.has(x.p.id)) score += 0.4;
    if (item.pack === 'mazo' && x.p.unitName !== 'mazo') score -= 1.5;
    out.push({ id: x.p.id, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Diferencia mínima con el segundo para no tener que preguntar. */
const CLEAR_MARGIN = 0.35;

function resolvePack(item: Item, p: PasteProduct | undefined): { pack: SalePack; qty: number; packGuessed: boolean } {
  let qty = item.qty ?? 1;
  if (!p) return { pack: item.pack === 'caja' ? 'caja' : 'unidad', qty, packGuessed: item.pack === undefined };
  const byBundle = p.unitName === 'mazo';
  let pack: SalePack;
  if (item.pack === 'caja') pack = 'caja';
  else if (item.pack === 'mazo' || item.pack === 'unidad') pack = 'unidad';
  // Sin decirlo: lo de mazo va por mazo; lo demás, por caja (como se pide siempre).
  else pack = byBundle || p.packSize <= 1 ? 'unidad' : 'caja';
  // «Media caja» de 50 mazos son 25 mazos.
  if (!Number.isInteger(qty)) {
    if (pack === 'caja' && Number.isInteger(qty * p.packSize)) {
      qty = qty * p.packSize;
      pack = 'unidad';
    } else qty = Math.max(1, Math.round(qty));
  }
  return { pack, qty, packGuessed: item.pack === undefined };
}

/**
 * Lee el mensaje y propone las líneas. `preferred`: lo que el local compra seguido (desempata).
 * Una línea es «ok» con un solo producto claro, «ambigua» si hay varios parecidos (se elige entre
 * los candidatos) y «desconocida» si dice cuántos pero ningún producto se parece.
 */
export function parsePastedOrder(text: string, products: readonly PasteProduct[], opts: { preferred?: readonly string[] } = {}): PasteResult {
  const index = products.filter((p) => p.active !== false).map(indexProduct);
  const byId = new Map(index.map((x) => [x.p.id, x.p]));
  const glued = new Set(index.flatMap((x) => x.nameTokens.filter((t) => /de\d+$/.test(t))));
  const preferred = new Set(opts.preferred ?? []);
  const known = new Set(index.flatMap((x) => x.tokens));
  const relevant = (w: string) => {
    if (known.has(w) || capaFromText(w)) return true;
    for (const t of known) if (wordMatch(w, t) > 0) return true;
    return false;
  };
  const lines: PasteLine[] = [];
  const ignored: string[] = [];
  for (const seg of segments(text)) {
    const items = group(tokenize(seg, glued));
    if (items.length === 0) {
      ignored.push(seg);
      continue;
    }
    for (const it of items) {
      const raw = items.length === 1 ? seg : it.raw.join(' ');
      const scored = scoreProducts(it, index, relevant, preferred);
      if (scored.length === 0) {
        if (it.qty === undefined) {
          ignored.push(raw);
          continue;
        }
        const r = resolvePack(it, undefined);
        lines.push({ raw, qty: r.qty, pack: r.pack, packGuessed: r.packGuessed, qtyGuessed: false, productId: null, status: 'desconocido', candidates: [] });
        continue;
      }
      const [best, second] = scored;
      const clear = !second || best!.score - second.score >= CLEAR_MARGIN;
      const close = scored.filter((s) => best!.score - s.score < CLEAR_MARGIN + 0.5).slice(0, 5);
      const productId = clear ? best!.id : null;
      const r = resolvePack(it, byId.get(productId ?? best!.id));
      lines.push({
        raw,
        qty: r.qty,
        pack: r.pack,
        packGuessed: r.packGuessed,
        qtyGuessed: it.qty === undefined,
        productId,
        status: clear ? 'ok' : 'ambiguo',
        candidates: clear ? scored.slice(1, 4).map((s) => s.id) : close.map((s) => s.id),
      });
    }
  }
  return { lines, ignored };
}

/** Unidades base de una línea ya revisada. */
export function pastedBaseQty(line: Pick<PasteLine, 'qty' | 'pack'>, p: Pick<Product, 'packSize'>): number {
  return line.pack === 'caja' ? line.qty * Math.max(1, p.packSize) : line.qty;
}
