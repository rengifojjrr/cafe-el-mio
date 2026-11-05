// Un mismo motor, dos configuraciones. Todo lo que cambia entre Tabaco y Café vive aquí:
// los campos del producto, de dónde entra el inventario, la plantilla de contrato,
// las reglas de comisión por defecto y el tema de color.
import type { ArrivalStatus, CommissionRule, LineId } from '../data/types';
import { CAFE_CONTRACT, TABACO_CONTRACT } from './contract-templates';

export type FieldDef =
  | { key: string; label: string; kind: 'text'; placeholder?: string; hint?: string; required?: boolean }
  | { key: string; label: string; kind: 'number'; unit?: string; step?: number; min?: number; hint?: string; required?: boolean }
  | { key: string; label: string; kind: 'select'; options: { value: string; label: string }[]; required?: boolean };

export interface LineConfig {
  id: LineId;
  name: string;
  companyName: string;
  tagline: string;
  /** Importación (tabaco) o lotes de tostado (café). */
  inbound: 'import' | 'roast';
  inboundLabel: string;
  inboundStatuses: { value: ArrivalStatus; label: string }[];
  productFields: FieldDef[];
  /** Campos que se muestran como resumen en las tarjetas del catálogo. */
  summaryFields: string[];
  unitName: { one: string; many: string };
  packName: string;
  storeTypes: string[];
  requiresTobaccoPermit: boolean;
  defaultCommission: CommissionRule;
  contractTemplate: string;
  skuPrefix: string;
}

export const WRAPPER_SHADES = [
  { value: 'claro', label: 'Claro' },
  { value: 'natural', label: 'Natural' },
  { value: 'colorado', label: 'Colorado' },
  { value: 'rosado', label: 'Rosado' },
  { value: 'maduro', label: 'Maduro' },
  { value: 'oscuro', label: 'Oscuro' },
  { value: 'candela', label: 'Candela' },
];

export const STRENGTHS = [
  { value: 'suave', label: 'Suave' },
  { value: 'media', label: 'Media' },
  { value: 'fuerte', label: 'Fuerte' },
];

export const TABACO: LineConfig = {
  id: 'tabaco',
  name: 'Tabaco',
  companyName: 'GM Tabacos (razón social de ejemplo)',
  tagline: 'Puros hechos a mano, en consignación con tabaquerías y licorerías.',
  inbound: 'import',
  inboundLabel: 'Importaciones',
  inboundStatuses: [
    { value: 'produccion', label: 'En producción' },
    { value: 'transito', label: 'En tránsito' },
    { value: 'aduana', label: 'En aduana' },
    { value: 'recibida', label: 'Recibida' },
  ],
  productFields: [
    { key: 'vitola', label: 'Vitola', kind: 'text', placeholder: 'Robusto, Toro, Churchill…', required: true },
    { key: 'lengthIn', label: 'Largo', kind: 'number', unit: 'pulgadas', step: 0.125, min: 3, hint: 'En pulgadas: 6.125 es 6⅛″. Los mm se calculan solos.', required: true },
    { key: 'ringGauge', label: 'Cepo', kind: 'number', unit: '/64″', step: 1, min: 20, hint: 'Grosor en 64avos de pulgada (50 = 50/64″).', required: true },
    { key: 'wrapper', label: 'Capa', kind: 'text', placeholder: 'Connecticut Shade (Ecuador)', required: true },
    { key: 'wrapperShade', label: 'Color de la capa', kind: 'select', options: WRAPPER_SHADES, required: true },
    { key: 'binder', label: 'Capote', kind: 'text', placeholder: 'Nicaragua' },
    { key: 'filler', label: 'Tripa', kind: 'text', placeholder: 'Nicaragua (Estelí, Jalapa)' },
    { key: 'originCountry', label: 'País de procedencia', kind: 'text', placeholder: 'Nicaragua', required: true },
    { key: 'originRegion', label: 'Región', kind: 'text', placeholder: 'Estelí' },
    { key: 'strength', label: 'Fortaleza', kind: 'select', options: STRENGTHS, required: true },
  ],
  summaryFields: ['vitola', 'strength', 'originCountry'],
  unitName: { one: 'tabaco', many: 'tabacos' },
  packName: 'caja',
  storeTypes: ['Tabaquería', 'Licorería', 'Bodega', 'Lounge de puros', 'Gasolinera', 'Supermercado'],
  requiresTobaccoPermit: true,
  defaultCommission: { type: 'percent', value: 8 },
  contractTemplate: TABACO_CONTRACT,
  skuPrefix: 'TB',
};

export const CAFE: LineConfig = {
  id: 'cafe',
  name: 'Café',
  companyName: 'Café El Mío (razón social pendiente)',
  tagline: 'Café El Mío tostado en Miami, en consignación con cafeterías y bodegas.',
  inbound: 'roast',
  inboundLabel: 'Lotes de tostado',
  inboundStatuses: [
    { value: 'programado', label: 'Programado' },
    { value: 'tostado', label: 'Tostado' },
    { value: 'recibida', label: 'En almacén' },
  ],
  productFields: [
    { key: 'origin', label: 'Origen', kind: 'text', placeholder: 'Medellín, Antioquia (Colombia)', required: true },
    {
      key: 'roast',
      label: 'Tueste',
      kind: 'select',
      options: [
        { value: 'claro', label: 'Claro' },
        { value: 'medio', label: 'Medio' },
        { value: 'medio-oscuro', label: 'Medio-oscuro' },
        { value: 'oscuro', label: 'Oscuro' },
        { value: 'no aplica', label: 'No aplica (té)' },
      ],
      required: true,
    },
    { key: 'grind', label: 'Molido', kind: 'text', placeholder: 'Molido espresso, en grano…', required: true },
    { key: 'weight', label: 'Peso', kind: 'text', placeholder: '10 oz (283 g)', required: true },
    { key: 'presentation', label: 'Presentación', kind: 'text', placeholder: 'Paquete, caja, cápsulas…', required: true },
    {
      key: 'productionLine',
      label: 'Línea de producción',
      kind: 'select',
      options: [
        { value: 'Línea 1 · Espresso', label: 'Línea 1 · Espresso' },
        { value: 'Línea 2 · Orígenes y muestras', label: 'Línea 2 · Orígenes y muestras' },
      ],
      required: true,
    },
  ],
  summaryFields: ['roast', 'weight', 'productionLine'],
  unitName: { one: 'unidad', many: 'unidades' },
  packName: 'caja',
  storeTypes: ['Cafetería', 'Bodega', 'Supermercado latino', 'Panadería', 'Ventanita', 'Restaurante'],
  requiresTobaccoPermit: false,
  defaultCommission: { type: 'percent', value: 6 },
  contractTemplate: CAFE_CONTRACT,
  skuPrefix: 'CF',
};

export const LINE_CONFIG: Record<LineId, LineConfig> = { tabaco: TABACO, cafe: CAFE };

export function lineConfig(line: LineId): LineConfig {
  return LINE_CONFIG[line];
}

export function isLineId(v: string | undefined): v is LineId {
  return v === 'tabaco' || v === 'cafe';
}

export function arrivalStatusLabel(line: LineId, status: ArrivalStatus): string {
  return LINE_CONFIG[line].inboundStatuses.find((s) => s.value === status)?.label ?? status;
}
