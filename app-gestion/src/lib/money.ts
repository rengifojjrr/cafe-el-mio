const usd = new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-US');
const pct = new Intl.NumberFormat('es-US', { style: 'percent', maximumFractionDigits: 0 });

/** Redondeo a centavos sin errores de coma flotante visibles. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sum(values: number[]): number {
  return round2(values.reduce((a, b) => a + b, 0));
}

export function fmtMoney(n: number): string {
  return usd.format(round2(n));
}

export function fmtMoney0(n: number): string {
  return usd0.format(Math.round(n));
}

export function fmtNumber(n: number): string {
  return num.format(n);
}

export function fmtPercent(fraction: number): string {
  return pct.format(Number.isFinite(fraction) ? fraction : 0);
}
