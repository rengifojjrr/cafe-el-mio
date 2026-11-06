// Un mismo motor, dos configuraciones. Todo lo que cambia entre Tabaco y Café vive aquí:
// los campos del producto, de dónde entra el inventario, la plantilla de contrato,
// las reglas de comisión por defecto y el tema de color.
import type { ArrivalStatus, CommissionRule, LineId, ProductKind } from '../data/types';
import { CAPAS } from '../domain/products';
import { CAFE_CONTRACT, TABACO_CONTRACT } from './contract-templates';

/** `kinds`: el campo solo aparece en esos tipos de tabaco (capote y tripa, solo en premium). */
type FieldBase = { key: string; label: string; required?: boolean; kinds?: ProductKind[] };

export type FieldDef =
  | (FieldBase & { kind: 'text'; placeholder?: string; hint?: string; suggestions?: string[] })
  | (FieldBase & { kind: 'number'; unit?: string; step?: number; min?: number; hint?: string })
  | (FieldBase & { kind: 'select'; options: { value: string; label: string }[] });

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
  /** Filtros de un toque arriba del catálogo («kind» es premium o de mazo; «stock», con existencias). */
  filterFields: string[];
  /** Campos que distinguen las variantes de una familia (en tabaco, la capa y la medida). */
  variantFields: string[];
  /** Tabaco: se pregunta primero «¿Premium o de mazo?». */
  hasKinds: boolean;
  /** Unidad en que se cuenta por defecto (mazo en tabaco de mazo, unidad en café). */
  defaultUnit: string;
  unitName: { one: string; many: string };
  packName: string;
  notesLabel: string;
  pairingLabel: string;
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

export const VITOLAS = ['Robusto', 'Toro', 'Torpedo', 'Churchill', 'Corona', 'Gordo', 'Lancero', 'Belicoso', 'Petit corona', 'Corona gorda', 'Lonsdale', 'Perfecto'];

export const KIND_LABEL: Record<ProductKind, string> = { premium: 'Premium', mazo: 'De mazo' };

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
    { value: 'confirmando', label: 'Confirmando bultos' },
    { value: 'recibida', label: 'Recibida' },
  ],
  productFields: [
    { key: 'vitola', label: 'Vitola', kind: 'text', placeholder: 'Toro, Robusto, Torpedo…', suggestions: VITOLAS, required: true },
    { key: 'lengthIn', label: 'Largo', kind: 'number', unit: 'pulgadas', step: 0.125, min: 3, hint: 'En pulgadas: 6.125 es 6⅛″. Los mm se calculan solos.', required: true },
    { key: 'ringGauge', label: 'Cepo', kind: 'number', unit: '/64″', step: 1, min: 20, hint: 'Grosor en 64avos de pulgada (52 = 52/64″).', required: true },
    { key: 'capa', label: 'Capa', kind: 'select', options: CAPAS.map((c) => ({ value: c.value, label: c.label })), required: true },
    { key: 'strength', label: 'Fortaleza', kind: 'select', options: STRENGTHS, required: true },
    { key: 'originCountry', label: 'Procedencia', kind: 'text', placeholder: 'Nicaragua', required: true },
    { key: 'originRegion', label: 'Región', kind: 'text', placeholder: 'Estelí' },
    { key: 'brand', label: 'Marca', kind: 'text', placeholder: 'GM Tabacos', kinds: ['premium'], required: true },
    { key: 'edition', label: 'Línea o edición', kind: 'text', placeholder: 'Serie Biscayne', kinds: ['premium'] },
    { key: 'wrapper', label: 'Detalle de la capa', kind: 'text', placeholder: 'Connecticut Shade (Ecuador)', kinds: ['premium'] },
    { key: 'binder', label: 'Capote', kind: 'text', placeholder: 'Nicaragua', kinds: ['premium'] },
    { key: 'filler', label: 'Tripa', kind: 'text', placeholder: 'Nicaragua (Estelí, Jalapa)', kinds: ['premium'] },
  ],
  summaryFields: ['capa', 'strength', 'originCountry'],
  filterFields: ['capa', 'vitola', 'strength', 'originCountry', 'kind', 'brand', 'stock'],
  variantFields: ['capa', 'lengthIn', 'ringGauge'],
  hasKinds: true,
  defaultUnit: 'mazo',
  unitName: { one: 'tabaco', many: 'tabacos' },
  packName: 'caja',
  notesLabel: 'Notas de cata',
  pairingLabel: 'Maridaje',
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
  filterFields: ['roast', 'grind', 'weight', 'stock'],
  variantFields: ['grind', 'weight'],
  hasKinds: false,
  defaultUnit: 'unidad',
  unitName: { one: 'unidad', many: 'unidades' },
  packName: 'caja',
  notesLabel: 'Notas',
  pairingLabel: 'Cómo prepararlo',
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
