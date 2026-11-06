// Datos fiscales de los locales y el «Reporte para la contadora» (R3-6).
import { beforeAll, describe, expect, it } from 'vitest';
import type { Store, User } from '../../src/data/types';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import type { LineRepo } from '../../src/data/repo';
import {
  buildAccountantRows,
  docAlertNotice,
  expiryState,
  isValidEin,
  normalizeEin,
  periodRange,
  resaleCertValidAt,
  storeDocWarnings,
} from '../../src/domain/fiscal';
import { type Actor, ForbiddenError } from '../../src/domain/permissions';
import { seedEverything } from '../../src/seed';
import { lineCtx } from '../../src/services/context';
import { accountantReport, documentAlerts, getStoreDocument, removeStoreDocument, saveStoreFiscal, syncDocumentAlerts, uploadStoreDocument } from '../../src/services/fiscal';
import { registerStore, updateStore } from '../../src/services/stores';

const NOW = new Date('2026-11-05T15:00:00Z');

describe('Tax ID (EIN)', () => {
  it('acepta NN-NNNNNNN o 9 dígitos y lo deja con guion', () => {
    expect(normalizeEin('12-3456789')).toBe('12-3456789');
    expect(normalizeEin(' 123456789 ')).toBe('12-3456789');
    expect(isValidEin('00-0001234')).toBe(true);
  });
  it('rechaza lo demás', () => {
    for (const bad of ['', '12-345678', '1-23456789', '12345678', '12-34567890', 'AB-1234567', '123-456789', '12 3456789']) {
      expect(isValidEin(bad), bad).toBe(false);
    }
  });
});

describe('vencimientos', () => {
  it('vigente, vence pronto (30 días), vencido o falta', () => {
    expect(expiryState('2027-01-30', NOW)).toBe('vigente');
    expect(expiryState('2026-12-05', NOW)).toBe('vence_pronto');
    expect(expiryState('2026-11-05', NOW)).toBe('vence_pronto');
    expect(expiryState('2026-11-04', NOW)).toBe('vencido');
    expect(expiryState(undefined, NOW)).toBe('falta');
    expect(expiryState('2026-11-20', NOW, 10)).toBe('vigente');
  });

  it('avisos del local: permiso de tabaco y certificado de reventa', () => {
    const store = { tobaccoPermit: { number: 'TP-1', expiresOn: '2026-11-20' }, resaleCert: { number: 'RC-1', expiresOn: '2026-10-01' } };
    const w = storeDocWarnings(store, NOW, { requiresPermit: true });
    expect(w.map((x) => [x.kind, x.state])).toEqual([
      ['permiso', 'vence_pronto'],
      ['reventa', 'vencido'],
    ]);
    expect(w[0]!.text).toBe('Permiso de tabaco vence en 15 días');
    expect(storeDocWarnings({ tobaccoPermit: store.tobaccoPermit }, NOW, { requiresPermit: false }).map((x) => x.state)).toEqual(['falta']);
    expect(storeDocWarnings({ resaleCert: { number: 'RC-2', expiresOn: '2027-11-01' } }, NOW, { requiresPermit: false })).toEqual([]);
    expect(docAlertNotice(w[1]!, 'Bodega X', (d) => d)).toEqual({ title: 'Certificado de reventa vencido: Bodega X', body: 'Venció el 2026-10-01. Pide el documento nuevo.' });
  });

  it('certificado vigente en la fecha de cada venta', () => {
    const s = { resaleCert: { number: 'RC-1', expiresOn: '2026-10-15' } };
    expect(resaleCertValidAt(s, '2026-10-15T23:00:00.000Z')).toBe(true); // 15 oct en Miami
    expect(resaleCertValidAt(s, '2026-10-16T05:00:00.000Z')).toBe(false); // 16 oct en Miami
    expect(resaleCertValidAt({}, NOW)).toBe(false);
  });
});

describe('reporte para la contadora (filas)', () => {
  const stores = [
    { id: 'a', name: 'Bodega A', taxId: '00-0000001', tobaccoPermit: { number: 'TP-A', expiresOn: '2027-01-01', issuer: 'Texas Comptroller' }, resaleCert: { number: 'RC-A', expiresOn: '2027-01-01' } },
    { id: 'b', name: 'Bodega B', tobaccoPermit: { number: 'TP-B', expiresOn: '2027-01-01' }, resaleCert: { number: 'RC-B', expiresOn: '2026-10-10' } },
    { id: 'c', name: 'Sin ventas', resaleCert: { number: 'RC-C', expiresOn: '2027-01-01' } },
  ] as Pick<Store, 'id' | 'name' | 'taxId' | 'tobaccoPermit' | 'resaleCert'>[];
  const reports = [
    { storeId: 'a', at: '2026-10-05T15:00:00.000Z', total: 100, settlementId: 'L1' },
    { storeId: 'a', at: '2026-10-20T15:00:00.000Z', total: 50, settlementId: null },
    { storeId: 'b', at: '2026-10-05T15:00:00.000Z', total: 80, settlementId: 'L2' },
    { storeId: 'b', at: '2026-10-25T15:00:00.000Z', total: 20, settlementId: null },
    { storeId: 'a', at: '2026-11-01T03:00:00.000Z', total: 999, settlementId: null }, // 31 oct en Miami: entra
    { storeId: 'a', at: '2026-11-01T05:00:00.000Z', total: 1, settlementId: null }, // 1 nov en Miami: no entra
  ];
  const invoices = [
    { storeId: 'a', issuedAt: '2026-10-10T15:00:00.000Z', subtotal: 300, tax: 21, total: 321, withoutResaleCert: false },
    { storeId: 'b', issuedAt: '2026-10-12T15:00:00.000Z', subtotal: 200, tax: 0, total: 200, withoutResaleCert: true },
    { storeId: 'b', issuedAt: '2026-09-30T15:00:00.000Z', subtotal: 5000, tax: 0, total: 5000, withoutResaleCert: true },
  ];
  const { rows, totals } = buildAccountantRows({ from: '2026-10-01', to: '2026-10-31', stores, marketOf: (id) => (id === 'a' ? 'Houston' : 'Miami'), reports, invoices, defaultIssuer: 'Florida DBPR' });

  it('un local por fila, solo los que vendieron en el periodo, con sus datos fiscales', () => {
    expect(rows.map((r) => r.storeId)).toEqual(['a', 'b']);
    const a = rows[0]!;
    expect(a).toMatchObject({ marketName: 'Houston', taxId: '00-0000001', permitNumber: 'TP-A', permitIssuer: 'Texas Comptroller', resaleCertNumber: 'RC-A', resaleCertStatus: 'si' });
    expect(rows[1]).toMatchObject({ taxId: '', permitIssuer: 'Florida DBPR', resaleCertStatus: 'parcial' });
  });

  it('consignación (vendida y liquidada) y en firme por separado, con totales', () => {
    const a = rows[0]!;
    expect(a.consignmentSold).toBe(1149);
    expect(a.consignmentSettled).toBe(100);
    expect(a.firmSubtotal).toBe(300);
    expect(a.firmTax).toBe(21);
    expect(a.firmTotal).toBe(321);
    expect(a.invoices).toBe(1);
    expect(a.total).toBe(1449);
    expect(totals).toMatchObject({ consignmentSold: 1249, consignmentSettled: 180, firmSubtotal: 500, firmTax: 21, invoices: 2, total: 1749 });
  });

  it('marca lo vendido sin certificado vigente (consignación por fecha, facturas por su marca)', () => {
    expect(rows[0]!.withoutCert).toBe(0);
    // B: su certificado venció el 10 oct → la venta del 25 oct (20) y la factura marcada (200).
    expect(rows[1]!.withoutCert).toBe(220);
    expect(totals.withoutCert).toBe(220);
  });

  it('periodos: mes, trimestre y año', () => {
    expect(periodRange('mes', '2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('trimestre', '2026-11-05')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodRange('trimestre', '2026-05-01')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(periodRange('anio', '2026-11-05')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

// ---------- Servicios ----------

const P = 'pruebas-fiscal-';
let repo: LineRepo;
let users: User[];
let stores: Store[];
const actorOf = (u: User): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco', storeId: u.storeId, name: u.name, readOnly: false });
const ctxOf = (u: User) => lineCtx('tabaco', actorOf(u), { repo, now: () => NOW });
const admin = () => users.find((u) => u.role === 'admin')!;
const store = (name: string) => stores.find((s) => s.name === name)!;

beforeAll(async () => {
  const repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  await seedEverything(openCoreRepo(P), repos, NOW);
  repo = repos.tabaco;
  users = await repo.users.all();
  stores = await repo.stores.all();
});

describe('datos fiscales en la app', () => {
  it('la semilla: EIN de ejemplo, permisos de Texas en Houston y casos para enseñar', () => {
    expect(store('Tabaquería Bayou').tobaccoPermit?.issuer).toBe('Texas Comptroller');
    expect(store('Tabaquería El Faro').tobaccoPermit?.issuer).toBe('Florida DBPR');
    expect(store('Tabaquería El Faro').taxId).toMatch(/^00-\d{7}$/);
    expect(store('Bodega Ocho y Medio').resaleCert).toBeUndefined();
  });

  it('guardar Tax ID y certificado (y validar el EIN)', async () => {
    const ocho = store('Bodega Ocho y Medio');
    await expect(saveStoreFiscal(ctxOf(admin()), ocho.id, { taxId: '12-34', resaleCert: null })).rejects.toThrow(/NN-NNNNNNN/);
    const saved = await saveStoreFiscal(ctxOf(admin()), ocho.id, { taxId: '009999999', resaleCert: { number: 'RC-PRUEBA-1', expiresOn: '2027-12-31' }, permitIssuer: 'Florida DBPR' });
    expect(saved.taxId).toBe('00-9999999');
    expect(saved.resaleCert).toEqual({ number: 'RC-PRUEBA-1', expiresOn: '2027-12-31' });
    expect(storeDocWarnings(saved, NOW, { requiresPermit: true }).filter((w) => w.kind === 'reventa')).toEqual([]);
    // Vacío lo borra.
    const cleared = await saveStoreFiscal(ctxOf(admin()), ocho.id, { taxId: '', resaleCert: null });
    expect(cleared.taxId).toBeUndefined();
    expect(cleared.resaleCert).toBeUndefined();
  });

  it('el vendedor edita los datos de sus locales, no los de otros; el local no edita', async () => {
    const andres = users.find((u) => u.name === 'Andrés Molina')!;
    const faroUser = users.find((u) => u.role === 'store' && u.storeId === store('Tabaquería El Faro').id)!;
    await saveStoreFiscal(ctxOf(andres), store('Tabaquería El Faro').id, { taxId: '00-0004444', resaleCert: { number: 'RC-AND-1', expiresOn: '2027-06-30' } });
    await expect(saveStoreFiscal(ctxOf(andres), store('Lounge La Hoja Dorada').id, { taxId: '', resaleCert: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveStoreFiscal(ctxOf(faroUser), store('Tabaquería El Faro').id, { taxId: '', resaleCert: null })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('foto o PDF de cada documento: se guarda, se reemplaza y se quita', async () => {
    const faro = store('Tabaquería El Faro');
    const pdf = new Blob(['%PDF-1.4 prueba'], { type: 'application/pdf' });
    const id1 = await uploadStoreDocument(ctxOf(admin()), faro.id, 'reventa', { blob: pdf, mime: 'application/pdf', width: 0, height: 0 });
    const id2 = await uploadStoreDocument(ctxOf(admin()), faro.id, 'reventa', { blob: pdf, mime: 'application/pdf', width: 0, height: 0 });
    expect(await repo.photos.get(id1)).toBeUndefined();
    const doc = await getStoreDocument(ctxOf(admin()), faro.id, 'reventa');
    expect(doc?.id).toBe(id2);
    expect(doc?.ownerType).toBe('document');
    expect(doc?.mime).toBe('application/pdf');
    await expect(uploadStoreDocument(ctxOf(admin()), faro.id, 'taxId', { blob: new Blob(['x']), mime: 'text/plain', width: 0, height: 0 })).rejects.toThrow(/foto o un PDF/);
    await removeStoreDocument(ctxOf(admin()), faro.id, 'reventa');
    expect(await getStoreDocument(ctxOf(admin()), faro.id, 'reventa')).toBeUndefined();
  });

  it('al registrar o editar: Tax ID opcional, pero si viene tiene que ser válido', async () => {
    const andres = users.find((u) => u.name === 'Andrés Molina')!;
    const base = {
      name: 'Tienda Fiscal de Prueba',
      type: 'Bodega',
      address: '1 Calle Prueba (dirección de ejemplo)',
      city: 'Hialeah, FL',
      zoneId: 't-zon_hialeah',
      lat: 25.86,
      lng: -80.28,
      managerName: 'Encargada Prueba',
      phone: '(305) 555-0188',
      email: '',
      tobaccoPermit: { number: 'TP-PRUEBA-9', expiresOn: '2027-06-01' },
    };
    await expect(registerStore(ctxOf(andres), { ...base, taxId: '99' })).rejects.toThrow(/NN-NNNNNNN/);
    const s = await registerStore(ctxOf(andres), { ...base, taxId: '001234567', resaleCert: { number: 'RC-REG-1', expiresOn: '2027-12-31' } });
    expect(s.taxId).toBe('00-1234567');
    expect(s.tobaccoPermit?.issuer).toBe('Florida DBPR');
    expect(s.marketId).toBe('miami');
    // Editar sin mandar los datos fiscales no los borra.
    const u = await updateStore(ctxOf(andres), s.id, { ...base, notes: 'nota' });
    expect(u.taxId).toBe('00-1234567');
    expect(u.resaleCert?.number).toBe('RC-REG-1');
  });

  it('avisos de documentos: en «Por hacer» y en la campana, sin repetirse', async () => {
    const alerts = await documentAlerts(ctxOf(admin()));
    expect(alerts.map((a) => a.storeName)).toEqual(expect.arrayContaining(['Licorería Sunset 88', 'Tabaquería Los Pinos', 'Bodega Tamiami 107']));
    // La semilla ya dejó los avisos: sincronizar no crea nada nuevo…
    expect(await syncDocumentAlerts(ctxOf(admin()))).toBe(0);
    // …hasta que un documento cambia su vencimiento.
    const brisa = store('Licorería Brisa Doral');
    await saveStoreFiscal(ctxOf(admin()), brisa.id, { taxId: brisa.taxId ?? '', resaleCert: { number: 'RC-BRISA', expiresOn: '2026-11-20' } });
    const created = await syncDocumentAlerts(ctxOf(admin()));
    expect(created).toBeGreaterThanOrEqual(2); // administración y el vendedor del local
    expect(await syncDocumentAlerts(ctxOf(admin()))).toBe(0);
    const n = (await repo.notifications.all()).filter((x) => x.kind === 'documento_por_vencer' && x.title.includes('Brisa'));
    expect(n.map((x) => x.userId)).toEqual(expect.arrayContaining([brisa.sellerId]));
  });

  it('el reporte del mes: solo administración; consignación y firme separados', async () => {
    const andres = users.find((u) => u.name === 'Andrés Molina')!;
    await expect(accountantReport(ctxOf(andres), { from: '2026-10-01', to: '2026-10-31' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(accountantReport(ctxOf(admin()), { from: '2026-10-31', to: '2026-10-01' })).rejects.toThrow(/antes/);
    const r = await accountantReport(ctxOf(admin()), { from: '2026-10-01', to: '2026-10-31' });
    expect(r.rows.length).toBeGreaterThan(10);
    expect(r.totals.consignmentSold).toBeGreaterThan(0);
    expect(r.totals.total).toBeCloseTo(r.totals.consignmentSold + r.totals.firmSubtotal, 2);
    expect(r.rows.some((x) => x.marketName === 'Houston')).toBe(true);
    // Bodega Ocho y Medio no tiene certificado (en la semilla): todo lo suyo sale «sin certificado»,
    // lo de consignación y lo que compró en firme (por ejemplo, en una venta rápida).
    const ocho = r.rows.find((x) => x.storeName === 'Bodega Ocho y Medio');
    if (ocho) expect(ocho.withoutCert).toBeCloseTo(ocho.consignmentSold + ocho.firmSubtotal, 2);
  });
});
