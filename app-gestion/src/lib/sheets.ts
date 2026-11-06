// Leer hojas de cálculo (Excel .xlsx o CSV) como una tabla de texto: encabezados y filas.
// Las librerías (read-excel-file y papaparse) se bajan solo cuando alguien importa un archivo.

export interface SheetTable {
  headers: string[];
  rows: string[][];
}

export class SheetError extends Error {}

/** Un valor de celda como texto: números sin notación científica, fechas como AAAA-MM-DD. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return String(v).replace(/\u00a0/g, ' ').trim();
}

/** Primera fila con algo = encabezados; quita filas vacías y deja todas del mismo largo. */
export function toTable(raw: readonly (readonly unknown[])[]): SheetTable {
  const rows = raw.map((r) => r.map(cellText)).filter((r) => r.some((c) => c !== ''));
  if (rows.length === 0) throw new SheetError('El archivo está vacío.');
  const headers = rows[0]!.map((h, i) => h || `Columna ${i + 1}`);
  const body = rows.slice(1).map((r) => headers.map((_, i) => r[i] ?? ''));
  return { headers, rows: body };
}

export async function readCsvText(text: string): Promise<SheetTable> {
  const { default: Papa } = await import('papaparse');
  const clean = text.replace(/^\uFEFF/, '');
  const parsed = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t', '|'] });
  if (parsed.errors.length && parsed.data.length === 0) throw new SheetError('No pude leer el CSV: revisa que sea texto separado por comas o punto y coma.');
  return toTable(parsed.data);
}

export async function readXlsx(input: Blob | ArrayBuffer): Promise<SheetTable> {
  const { readSheet } = await import('read-excel-file/universal');
  try {
    return toTable(await readSheet(input));
  } catch (e) {
    if (e instanceof SheetError) throw e;
    throw new SheetError('No pude leer ese Excel. Guárdalo como .xlsx (o como CSV) y vuelve a intentarlo.');
  }
}

/** Lee un archivo elegido por la persona: .xlsx, .csv o .txt. Un .xls viejo pide guardarlo como .xlsx. */
export async function readSheetFile(file: File): Promise<SheetTable> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) throw new SheetError('Ese es un Excel viejo (.xls). Ábrelo y guárdalo como .xlsx o como CSV.');
  if (name.endsWith('.xlsx')) return readXlsx(file);
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type.startsWith('text/')) return readCsvText(await file.text());
  throw new SheetError('Elige un archivo .xlsx o .csv.');
}

/** Encabezado normalizado para compararlo con los nombres conocidos (sin tildes, minúsculas). */
export function headerKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Número escrito en una celda: «1,234.50», «1.234,50», «$25», «25 USD». NaN si no es un número. */
export function parseNumber(text: string): number {
  let t = text.replace(/[^\d.,-]/g, '');
  if (!t) return Number.NaN;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}
