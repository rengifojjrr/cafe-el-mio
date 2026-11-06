// Códigos de barras: dígito de control EAN-13 y validación. (Los dibujos de Code 128 y EAN
// para etiquetas van aparte, en el trozo que se baja al imprimir.)

/** Dígito de control EAN-13 para 12 dígitos. */
export function ean13CheckDigit(digits12: string): number {
  if (!/^\d{12}$/.test(digits12)) throw new Error('EAN-13: hacen falta 12 dígitos.');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** 12 dígitos → EAN-13 completo. */
export function makeEan13(digits12: string): string {
  return `${digits12}${ean13CheckDigit(digits12)}`;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/**
 * Códigos internos de ejemplo: prefijo 200–299 de GS1, reservado para uso interno (no choca con
 * los códigos de productos reales).
 */
export function internalEan13(seq: number): string {
  return makeEan13(`200${String(seq).padStart(9, '0')}`);
}

/** Limpia lo que devuelve un lector o lo que se escribe a mano (espacios, guiones). */
export function cleanCode(raw: string): string {
  return raw.trim().replace(/[\s-]+/g, '').toUpperCase();
}
