// Dibujo de códigos de barras para las etiquetas: Code 128 (juegos B y C) y EAN-13.
// Devuelven los módulos (barra = true, espacio = false) para dibujarlos como rectángulos
// vectoriales. No dependen de nada: van en el trozo que se baja al imprimir.
import { isValidEan13, makeEan13 } from './barcode';

// ---------- Code 128 ----------

/**
 * Anchos de cada símbolo (barra, espacio, barra, espacio, barra, espacio), 11 módulos cada uno.
 * Valores 0–102 son datos o cambios de juego; 103–105 son los inicios A, B y C; 106 es el fin.
 */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

export const CODE128 = { CODE_C: 99, CODE_B: 100, START_B: 104, START_C: 105, STOP: 106 } as const;

export class BarcodeError extends Error {}

function digitRun(text: string, from: number): number {
  let n = 0;
  while (from + n < text.length && text.charCodeAt(from + n) >= 48 && text.charCodeAt(from + n) <= 57) n++;
  return n;
}

function valueB(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c < 32 || c > 126) throw new BarcodeError(`El carácter «${ch}» no se puede poner en un Code 128.`);
  return c - 32;
}

/**
 * Valores del Code 128: inicio, datos, dígito de control (sin el fin). Usa el juego C (pares
 * de dígitos) en las tiradas de dígitos donde ahorra símbolos, y el juego B para lo demás.
 */
export function code128Values(text: string): number[] {
  if (!text) throw new BarcodeError('El código está vacío.');
  const out: number[] = [];
  let set: 'B' | 'C';
  let i = 0;
  const lead = digitRun(text, 0);
  if (lead >= 4 || (lead === 2 && text.length === 2)) {
    set = 'C';
    out.push(CODE128.START_C);
  } else {
    set = 'B';
    out.push(CODE128.START_B);
  }
  while (i < text.length) {
    const run = digitRun(text, i);
    if (set === 'C') {
      if (run >= 2) {
        out.push(Number(text.slice(i, i + 2)));
        i += 2;
        continue;
      }
      set = 'B';
      out.push(CODE128.CODE_B);
      continue;
    }
    // En B: pasar a C solo si la tirada de dígitos ahorra símbolos (4 al final, 6 en el medio).
    const atEnd = i + run === text.length;
    if (run >= (atEnd ? 4 : 6)) {
      if (run % 2 === 1) {
        out.push(valueB(text[i]!));
        i += 1;
      }
      set = 'C';
      out.push(CODE128.CODE_C);
      continue;
    }
    out.push(valueB(text[i]!));
    i += 1;
  }
  let sum = out[0]!;
  for (let k = 1; k < out.length; k++) sum += out[k]! * k;
  out.push(sum % 103);
  return out;
}

/** Anchos de barras y espacios de todo el código, con el fin incluido (empieza con barra). */
export function code128Widths(text: string): number[] {
  const values = [...code128Values(text), CODE128.STOP];
  return values.flatMap((v) => [...CODE128_PATTERNS[v]!].map(Number));
}

/** Módulos del Code 128 (sin zona de silencio). */
export function code128Modules(text: string): boolean[] {
  return widthsToModules(code128Widths(text));
}

function widthsToModules(widths: readonly number[]): boolean[] {
  const out: boolean[] = [];
  widths.forEach((w, i) => {
    for (let k = 0; k < w; k++) out.push(i % 2 === 0);
  });
  return out;
}

// ---------- EAN-13 ----------

export const EAN_L: readonly string[] = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
export const EAN_G: readonly string[] = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
export const EAN_R: readonly string[] = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
/** Paridad de los 6 dígitos de la izquierda según el primer dígito. */
export const EAN_PARITY: readonly string[] = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** 13 dígitos (o 12, y se calcula el de control) → 95 módulos. */
export function ean13Modules(code: string): boolean[] {
  const full = /^\d{12}$/.test(code) ? makeEan13(code) : code;
  if (!isValidEan13(full)) throw new BarcodeError(`«${code}» no es un EAN-13 válido.`);
  const d = [...full].map(Number);
  const parity = EAN_PARITY[d[0]!]!;
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[d[i]!];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += EAN_R[d[i]!];
  bits += '101';
  return [...bits].map((b) => b === '1');
}

/** Módulos donde van las barras de guarda (más largas): inicio, centro y fin. */
export function ean13GuardModules(): Set<number> {
  return new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
}

// ---------- Para dibujar ----------

/** Tiradas de módulos oscuros: [inicio, ancho] en módulos, para dibujar menos rectángulos. */
export function darkRuns(modules: readonly boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  modules.forEach((m, i) => {
    if (m && start < 0) start = i;
    if (!m && start >= 0) {
      out.push([start, i - start]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, modules.length - start]);
  return out;
}

export type BarcodeKind = 'ean13' | 'code128';

/** EAN-13 si el código es un EAN-13 válido; si no, Code 128. */
export function barcodeKindFor(code: string): BarcodeKind {
  return isValidEan13(code) ? 'ean13' : 'code128';
}
