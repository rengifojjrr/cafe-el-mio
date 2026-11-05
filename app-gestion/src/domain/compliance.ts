// Reglas de cumplimiento. Tabaco: venta entre empresas, solo a locales con permiso de
// venta de tabaco vigente (en Florida lo da el DBPR), que venden solo a mayores de 21.
import type { IsoDate, LineId, Store } from '../data/types';
import { daysBetween } from '../lib/time';

export type PermitState = 'vigente' | 'vence_pronto' | 'vencido' | 'sin_permiso';

export const PERMIT_LABEL: Record<PermitState, string> = {
  vigente: 'Permiso vigente',
  vence_pronto: 'Permiso por vencer',
  vencido: 'Permiso vencido',
  sin_permiso: 'Sin permiso de tabaco',
};

export function permitState(store: Pick<Store, 'tobaccoPermit'>, now: Date, warnDays = 30): PermitState {
  const p = store.tobaccoPermit;
  if (!p || !p.number.trim() || !p.expiresOn) return 'sin_permiso';
  const days = daysBetween(now, p.expiresOn as IsoDate);
  if (days < 0) return 'vencido';
  if (days <= warnDays) return 'vence_pronto';
  return 'vigente';
}

export class ComplianceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComplianceError';
  }
}

/**
 * ¿Se le puede colocar producto en consignación a este local?
 * - El local tiene que tener el contrato firmado (firmado o activo).
 * - En tabaco, además, el permiso de venta de tabaco tiene que estar vigente hoy.
 */
export function consignmentCheck(
  line: LineId,
  store: Pick<Store, 'status' | 'tobaccoPermit' | 'name'>,
  now: Date,
): { ok: true } | { ok: false; reason: string } {
  if (store.status === 'pausado' || store.status === 'cerrado') {
    return { ok: false, reason: `${store.name} está ${store.status}: no se le coloca producto.` };
  }
  if (store.status === 'prospecto' || store.status === 'contrato_enviado') {
    return { ok: false, reason: `${store.name} todavía no firmó el contrato de consignación.` };
  }
  if (line === 'tabaco') {
    const st = permitState(store, now);
    if (st === 'vencido' || st === 'sin_permiso') {
      return {
        ok: false,
        reason:
          st === 'vencido'
            ? `El permiso de venta de tabaco de ${store.name} está vencido. Sin permiso vigente no se le puede consignar tabaco.`
            : `${store.name} no tiene registrado su permiso de venta de tabaco. Sin permiso vigente no se le puede consignar tabaco.`,
      };
    }
  }
  return { ok: true };
}

export function assertCanConsign(line: LineId, store: Pick<Store, 'status' | 'tobaccoPermit' | 'name'>, now: Date): void {
  const r = consignmentCheck(line, store, now);
  if (!r.ok) throw new ComplianceError(r.reason);
}

/** En la semilla y en las pruebas: ningún tabaco de origen Cuba (embargo de EE. UU.). */
export function isCubanOrigin(country: string): boolean {
  return /cuba/i.test(country.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}
