// Comisión progresiva de partida de Tabaco (la que trae una línea nueva y la de la semilla de
// ejemplo). Son valores para empezar: Administración los ajusta en Ajustes → comisión progresiva.
import type { CommissionScheme } from '../data/types';

/** Comisión progresiva de Tabaco: base 7 %, escalones por locales activos y por lo vendido en el mes, tope 10 %. */
export const TABACO_SCHEME: CommissionScheme = {
  basePercent: 7,
  capPercent: 10,
  tiers: [
    { metric: 'locales', min: 5, percent: 8 },
    { metric: 'locales', min: 8, percent: 10 },
    { metric: 'ventas', min: 4000, percent: 8 },
    { metric: 'ventas', min: 7000, percent: 9 },
  ],
};

/** Tomás Garza abre Houston: su propia comisión, que premia sumar locales. */
export const HOUSTON_SELLER_SCHEME: CommissionScheme = {
  basePercent: 8,
  capPercent: 10,
  tiers: [
    { metric: 'locales', min: 6, percent: 9 },
    { metric: 'locales', min: 10, percent: 10 },
    { metric: 'ventas', min: 3000, percent: 9 },
  ],
};
