// Códigos de barras de las etiquetas: Code 128 (B y C) y EAN-13, comprobados símbolo por símbolo
// y leídos de vuelta con un lector escrito aparte, a partir de las barras dibujadas.
import { describe, expect, it } from 'vitest';
import { internalEan13 } from '../../src/lib/barcode';
import {
  CODE128,
  CODE128_PATTERNS,
  EAN_G,
  EAN_L,
  EAN_PARITY,
  EAN_R,
  barcodeKindFor,
  code128Modules,
  code128Values,
  code128Widths,
  darkRuns,
  ean13Modules,
} from '../../src/lib/barcode-draw';

/** Lee un Code 128 desde sus anchos: valores y texto (solo juegos B y C). */
function readCode128(widths: number[]): { values: number[]; text: string } {
  const values: number[] = [];
  let i = 0;
  while (i < widths.length) {
    const take = widths.length - i === 7 ? 7 : 6;
    const pattern = widths.slice(i, i + take).join('');
    const v = CODE128_PATTERNS.indexOf(pattern);
    if (v < 0) throw new Error(`Patrón desconocido ${pattern}`);
    values.push(v);
    i += take;
  }
  expect(values.at(-1)).toBe(CODE128.STOP);
  const data = values.slice(0, -1);
  let sum = data[0]!;
  for (let k = 1; k < data.length - 1; k++) sum += data[k]! * k;
  expect(sum % 103).toBe(data.at(-1));
  let set = data[0] === CODE128.START_C ? 'C' : 'B';
  let text = '';
  for (const v of data.slice(1, -1)) {
    if (v === CODE128.CODE_B) set = 'B';
    else if (v === CODE128.CODE_C) set = 'C';
    else text += set === 'C' ? String(v).padStart(2, '0') : String.fromCharCode(v + 32);
  }
  return { values: data, text };
}

/** Lee un EAN-13 desde sus 95 módulos. */
function readEan13(modules: boolean[]): string {
  const bits = modules.map((m) => (m ? '1' : '0')).join('');
  expect(bits.slice(0, 3)).toBe('101');
  expect(bits.slice(45, 50)).toBe('01010');
  expect(bits.slice(92)).toBe('101');
  let parity = '';
  let left = '';
  for (let k = 0; k < 6; k++) {
    const sym = bits.slice(3 + k * 7, 10 + k * 7);
    const l = EAN_L.indexOf(sym);
    const g = EAN_G.indexOf(sym);
    parity += l >= 0 ? 'L' : 'G';
    left += String(l >= 0 ? l : g);
  }
  let right = '';
  for (let k = 0; k < 6; k++) right += String(EAN_R.indexOf(bits.slice(50 + k * 7, 57 + k * 7)));
  return `${EAN_PARITY.indexOf(parity)}${left}${right}`;
}

describe('Code 128', () => {
  it('la tabla tiene 107 símbolos distintos, de 11 módulos y con paridad correcta', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.slice(0, 106).forEach((p, v) => {
      const w = [...p].map(Number);
      expect(w.reduce((a, b) => a + b, 0), `símbolo ${v}`).toBe(11);
      // Las barras suman par y los espacios impar.
      expect((w[0]! + w[2]! + w[4]!) % 2, `símbolo ${v}`).toBe(0);
    });
    expect(CODE128_PATTERNS[CODE128.STOP]).toBe('2331112');
    expect(CODE128_PATTERNS[CODE128.START_B]).toBe('211214');
    expect(CODE128_PATTERNS[CODE128.START_C]).toBe('211232');
  });

  it('texto en el juego B con su dígito de control', () => {
    // P=48, J=42, J=42, 1=17, 2=18, 3=19, C=35 → (104 + 48 + 84 + 126 + 68 + 90 + 114 + 245) mod 103 = 55
    expect(code128Values('PJJ123C')).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55]);
  });

  it('solo dígitos en el juego C (pares)', () => {
    // 12 34 56 → (105 + 12 + 68 + 168) mod 103 = 44
    expect(code128Values('123456')).toEqual([105, 12, 34, 56, 44]);
  });

  it('cambia a C en una tirada larga de dígitos y vuelve a B', () => {
    const v = code128Values('CIMP20260010001');
    expect(v[0]).toBe(CODE128.START_B);
    expect(v).toContain(CODE128.CODE_C);
    // C, I, M, P en B; 1 dígito suelto en B para que la tirada quede par; luego 5 pares en C.
    expect(v.length).toBe(1 + 4 + 1 + 1 + 5 + 1);
    expect(readCode128(code128Widths('CIMP20260010001')).text).toBe('CIMP20260010001');
  });

  it('un número impar al principio: C con los pares y B para el último', () => {
    const { values, text } = readCode128(code128Widths('12345AB'));
    expect(values[0]).toBe(CODE128.START_C);
    expect(values).toContain(CODE128.CODE_B);
    expect(text).toBe('12345AB');
  });

  it('se lee de vuelta desde las barras: SKU, número de caja y texto mezclado', () => {
    for (const s of ['TB-MZ-TOR-HAB52', 'C-IMP-2026-001-0001', 'TBBISROB50', '2000000010015', 'A', '42', '9', 'x-1 y/2']) {
      expect(readCode128(code128Widths(s)).text, s).toBe(s);
    }
  });

  it('módulos: empieza y termina con barra, 11 por símbolo más 13 del fin', () => {
    const m = code128Modules('PJJ123C');
    expect(m).toHaveLength(9 * 11 + 13);
    expect(m[0]).toBe(true);
    expect(m.at(-1)).toBe(true);
    // El fin termina con dos módulos de barra (…112: espacio de 1, barra de 2).
    expect(m.slice(-3)).toEqual([false, true, true]);
  });

  it('rechaza caracteres que no entran en el juego B', () => {
    expect(() => code128Values('añejo')).toThrow(/no se puede/);
    expect(() => code128Values('')).toThrow();
  });
});

describe('EAN-13', () => {
  it('codifica un EAN-13 conocido y se lee de vuelta', () => {
    const m = ean13Modules('4006381333931');
    expect(m).toHaveLength(95);
    expect(readEan13(m)).toBe('4006381333931');
    // Primer dígito 4 → paridad LGLLGG; el segundo dígito (0) va en L: 0001101.
    const bits = m.map((b) => (b ? '1' : '0')).join('');
    expect(bits.slice(3, 10)).toBe('0001101');
    // El tercero (0) va en G: 0100111.
    expect(bits.slice(10, 17)).toBe('0100111');
  });

  it('los códigos internos (prefijo 200) se dibujan y se leen igual', () => {
    for (const seq of [1, 1001, 1013, 1021, 987654]) {
      const code = internalEan13(seq);
      expect(readEan13(ean13Modules(code)), code).toBe(code);
    }
  });

  it('con 12 dígitos calcula el de control; con un control equivocado no dibuja', () => {
    expect(readEan13(ean13Modules('400638133393'))).toBe('4006381333931');
    expect(() => ean13Modules('4006381333932')).toThrow(/no es un EAN-13/);
    expect(() => ean13Modules('ABC')).toThrow();
  });

  it('las tablas L, G y R son coherentes: R es L invertido y G es R al revés', () => {
    for (let d = 0; d < 10; d++) {
      const inv = [...EAN_L[d]!].map((b) => (b === '1' ? '0' : '1')).join('');
      expect(EAN_R[d]).toBe(inv);
      expect(EAN_G[d]).toBe([...EAN_R[d]!].reverse().join(''));
    }
  });
});

describe('para dibujar', () => {
  it('agrupa las barras en tiradas', () => {
    expect(darkRuns([true, true, false, true, false, false, true])).toEqual([
      [0, 2],
      [3, 1],
      [6, 1],
    ]);
  });
  it('EAN-13 si el código es válido; si no, Code 128', () => {
    expect(barcodeKindFor(internalEan13(1013))).toBe('ean13');
    expect(barcodeKindFor('TB-MZ-TOR-HAB52')).toBe('code128');
    expect(barcodeKindFor('4006381333932')).toBe('code128');
  });
});
