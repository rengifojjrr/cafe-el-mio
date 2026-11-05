// Piezas compartidas por las pantallas de catálogo, almacén, locales y consignación.
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Location, MovementType, Role, StoreStatus } from '../data/types';
import { PERMIT_LABEL, type PermitState } from '../domain/compliance';
import type { FieldDef } from '../lines/config';
import { STORE_STATUS_LABEL } from '../services/stores';
import { useLine } from '../app/line-context';
import { fmtLength, fmtRing } from '../ui/brand';
import { EmptyState, LinkButton, Pill } from '../ui/kit';

/** Muestra el contenido solo a ciertos roles (el servicio igual rechaza a los demás). */
export function RoleGate({ roles, children, message }: { roles: Role[]; children: ReactNode; message?: string }) {
  const { actor, p } = useLine();
  if (roles.includes(actor.role)) return <>{children}</>;
  return (
    <EmptyState icon={Lock} title="Esta pantalla no es para tu rol" action={<LinkButton to={p()}>Ir al inicio</LinkButton>}>
      {message ?? 'Cada rol ve su menú y solo sus datos.'}
    </EmptyState>
  );
}

const STATUS_TONE: Record<StoreStatus, 'ok' | 'warn' | 'danger' | 'info' | 'accent' | undefined> = {
  prospecto: 'info',
  contrato_enviado: 'warn',
  firmado: 'accent',
  activo: 'ok',
  pausado: undefined,
  cerrado: 'danger',
};

export function StoreStatusPill({ status }: { status: StoreStatus }) {
  return (
    <Pill tone={STATUS_TONE[status]} dot>
      {STORE_STATUS_LABEL[status]}
    </Pill>
  );
}

export function PermitPill({ state }: { state: PermitState | null }) {
  if (!state) return null;
  const tone = state === 'vigente' ? 'ok' : state === 'vence_pronto' ? 'warn' : 'danger';
  return <Pill tone={tone}>{PERMIT_LABEL[state]}</Pill>;
}

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  entrada: 'Entrada',
  salida_consignacion: 'Salida a consignación',
  venta_reportada: 'Venta reportada',
  devolucion: 'Devolución',
  merma: 'Merma',
  ajuste: 'Ajuste',
};

export function locationLabel(loc: Location, warehouseName: string, storeName?: string): string {
  switch (loc.kind) {
    case 'warehouse':
      return warehouseName;
    case 'store':
      return storeName ?? 'Local';
    case 'supplier':
      return 'Proveedor';
    case 'sold':
      return 'Vendido';
    case 'loss':
      return 'Pérdida';
    case 'adjustment':
      return 'Ajuste';
  }
}

/** Valor legible de un atributo del producto según su definición en la línea. */
export function attrText(field: FieldDef, value: string | number | undefined): string {
  if (value === undefined || value === '') return '—';
  if (field.key === 'lengthIn') return fmtLength(Number(value));
  if (field.key === 'ringGauge') return fmtRing(Number(value));
  if (field.kind === 'select') return field.options.find((o) => o.value === String(value))?.label ?? String(value);
  if (field.kind === 'number' && field.unit) return `${value} ${field.unit}`;
  return String(value);
}

/** «2 cajas (40 tabacos)» o «12 unidades». */
export function qtyText(qty: number, packSize: number, unit: { one: string; many: string }): string {
  const units = `${qty} ${qty === 1 ? unit.one : unit.many}`;
  if (packSize > 1 && qty > 0 && qty % packSize === 0) {
    const boxes = qty / packSize;
    return `${boxes} caja${boxes === 1 ? '' : 's'} (${units})`;
  }
  return units;
}
