// Cumplimiento: permiso de venta de tabaco vigente para consignar tabaco; café sin permiso.
import { describe, expect, it } from 'vitest';
import type { Store, StoreStatus } from '../../src/data/types';
import { ComplianceError, assertCanConsign, consignmentCheck, isCubanOrigin, permitState } from '../../src/domain/compliance';

const NOW = new Date('2026-11-05T15:00:00Z');

const store = (status: StoreStatus, expiresOn?: string, number = 'TP-DEMO-12345'): Pick<Store, 'status' | 'tobaccoPermit' | 'name'> => ({
  name: 'Tabaquería de prueba',
  status,
  tobaccoPermit: expiresOn ? { number, expiresOn } : undefined,
});

describe('permiso de venta de tabaco', () => {
  it('sin permiso, o con el número vacío', () => {
    expect(permitState({ tobaccoPermit: undefined }, NOW)).toBe('sin_permiso');
    expect(permitState({ tobaccoPermit: { number: '  ', expiresOn: '2027-01-01' } }, NOW)).toBe('sin_permiso');
    expect(permitState({ tobaccoPermit: { number: 'TP-1', expiresOn: '' } }, NOW)).toBe('sin_permiso');
  });
  it('vigente, por vencer y vencido', () => {
    expect(permitState(store('activo', '2027-03-01'), NOW)).toBe('vigente');
    expect(permitState(store('activo', '2026-11-20'), NOW)).toBe('vence_pronto');
    expect(permitState(store('activo', '2026-12-05'), NOW)).toBe('vence_pronto');
    expect(permitState(store('activo', '2026-11-05'), NOW)).toBe('vence_pronto');
    expect(permitState(store('activo', '2026-11-04'), NOW)).toBe('vencido');
    expect(permitState(store('activo', '2025-01-01'), NOW)).toBe('vencido');
  });
  it('el aviso de «por vencer» se puede ajustar', () => {
    expect(permitState(store('activo', '2026-11-20'), NOW, 10)).toBe('vigente');
    expect(permitState(store('activo', '2026-11-12'), NOW, 10)).toBe('vence_pronto');
  });
});

describe('¿se le puede consignar?', () => {
  it('tabaco a un local activo con permiso vigente: sí', () => {
    expect(consignmentCheck('tabaco', store('activo', '2027-06-01'), NOW)).toEqual({ ok: true });
    expect(consignmentCheck('tabaco', store('firmado', '2027-06-01'), NOW)).toEqual({ ok: true });
  });
  it('tabaco con el permiso vencido: no', () => {
    const r = consignmentCheck('tabaco', store('activo', '2026-10-26'), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/vencido/);
  });
  it('tabaco sin permiso registrado: no', () => {
    const r = consignmentCheck('tabaco', store('activo'), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/permiso/);
  });
  it('sin contrato firmado: no (ni tabaco ni café)', () => {
    for (const line of ['tabaco', 'cafe'] as const) {
      for (const status of ['prospecto', 'contrato_enviado'] as const) {
        const r = consignmentCheck(line, store(status, '2027-06-01'), NOW);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/contrato/);
      }
    }
  });
  it('café no necesita permiso de tabaco', () => {
    expect(consignmentCheck('cafe', store('activo'), NOW)).toEqual({ ok: true });
    expect(consignmentCheck('cafe', store('activo', '2020-01-01'), NOW)).toEqual({ ok: true });
  });
  it('un local pausado o cerrado no recibe producto', () => {
    for (const line of ['tabaco', 'cafe'] as const) {
      expect(consignmentCheck(line, store('pausado', '2027-06-01'), NOW).ok).toBe(false);
      expect(consignmentCheck(line, store('cerrado', '2027-06-01'), NOW).ok).toBe(false);
    }
  });
  it('assertCanConsign lanza ComplianceError', () => {
    expect(() => assertCanConsign('tabaco', store('activo', '2026-10-01'), NOW)).toThrow(ComplianceError);
    expect(() => assertCanConsign('tabaco', store('activo', '2027-10-01'), NOW)).not.toThrow();
    expect(() => assertCanConsign('cafe', store('activo'), NOW)).not.toThrow();
  });
});

describe('origen del tabaco', () => {
  it('detecta Cuba aunque tenga tildes o mayúsculas', () => {
    expect(isCubanOrigin('Cuba')).toBe(true);
    expect(isCubanOrigin('CUBA')).toBe(true);
    expect(isCubanOrigin('Cúba')).toBe(true);
    expect(isCubanOrigin('Pinar del Río, Cuba')).toBe(true);
  });
  it('no confunde otros orígenes', () => {
    for (const c of ['Nicaragua', 'República Dominicana', 'Honduras', 'Estados Unidos', 'Miami, Florida (hecho a mano)']) {
      expect(isCubanOrigin(c)).toBe(false);
    }
  });
});
