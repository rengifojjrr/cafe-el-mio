// Permisos del dominio: matriz por rol, separación de líneas, «solo mirar» y dueño del recurso.
import { describe, expect, it } from 'vitest';
import { type Action, type Actor, ForbiddenError, can, ensure, isWrite } from '../../src/domain/permissions';

const admin: Actor = { accountId: 'tabaco:admin', userId: 'u-admin', role: 'admin', line: 'tabaco', name: 'Admin', readOnly: false };
const seller: Actor = { accountId: 'tabaco:seller', userId: 'u-seller', role: 'seller', line: 'tabaco', name: 'Vendedor', readOnly: false };
const store: Actor = { accountId: 'tabaco:store', userId: 'u-store', role: 'store', line: 'tabaco', storeId: 's-mio', name: 'Local', readOnly: false };
const direccion: Actor = { accountId: 'direccion', userId: 'direccion', role: 'direccion', line: null, name: 'Dirección', readOnly: true };

const myStore = { type: 'store' as const, store: { id: 's-mio', sellerId: 'u-seller' } };
const otherStore = { type: 'store' as const, store: { id: 's-otro', sellerId: 'u-otro-vendedor' } };

const ADMIN_ONLY: Action[] = [
  'product.readCost',
  'product.write',
  'inventory.write',
  'store.approve',
  'delivery.prepare',
  'settlement.create',
  'payment.record',
  'commission.pay',
  'accounting.read',
  'reports.read',
  'announcement.create',
  'user.read',
  'user.manage',
  'settings.read',
  'settings.manage',
  'audit.read',
];

describe('Administración', () => {
  it('puede todo lo de su línea', () => {
    for (const a of [...ADMIN_ONLY, 'product.read', 'store.list', 'store.read', 'contract.sign', 'map.read', 'message.send'] as Action[]) {
      expect(can(admin, a, 'tabaco'), a).toBe(true);
    }
    expect(can(admin, 'store.read', 'tabaco', otherStore)).toBe(true);
  });
  it('no puede nada de la otra línea', () => {
    for (const a of ['product.read', 'product.write', 'store.list', 'settings.read'] as Action[]) {
      expect(can(admin, a, 'cafe'), a).toBe(false);
    }
  });
  it('no tiene la vista de Dirección', () => {
    expect(can(admin, 'direccion.read', 'tabaco')).toBe(false);
  });
});

describe('Vendedor', () => {
  it('trabaja sus locales', () => {
    for (const a of ['store.read', 'store.update', 'contract.issue', 'contract.sign', 'delivery.request', 'delivery.receive', 'visit.create', 'sale.report', 'return.create', 'reorder.confirm'] as Action[]) {
      expect(can(seller, a, 'tabaco', myStore), a).toBe(true);
      expect(can(seller, a, 'tabaco', otherStore), `${a} en local ajeno`).toBe(false);
    }
    for (const a of ['product.read', 'store.list', 'store.create', 'map.read', 'commission.read', 'announcement.read'] as Action[]) {
      expect(can(seller, a, 'tabaco'), a).toBe(true);
    }
  });
  it('no ve costos, ni contabilidad, ni administra', () => {
    for (const a of ADMIN_ONLY) expect(can(seller, a, 'tabaco'), a).toBe(false);
  });
  it('solo ve sus comisiones', () => {
    expect(can(seller, 'commission.read', 'tabaco', { type: 'seller', sellerId: 'u-seller' })).toBe(true);
    expect(can(seller, 'commission.read', 'tabaco', { type: 'seller', sellerId: 'u-otro-vendedor' })).toBe(false);
  });
  it('lee y escribe solo en los hilos donde participa', () => {
    expect(can(seller, 'message.send', 'tabaco', { type: 'thread', thread: { participantIds: ['u-seller', 'u-admin'] } })).toBe(true);
    expect(can(seller, 'message.read', 'tabaco', { type: 'thread', thread: { participantIds: ['u-otro-vendedor', 'u-admin'] } })).toBe(false);
  });
  it('una cuenta de tabaco no toca café', () => {
    expect(can(seller, 'product.read', 'cafe')).toBe(false);
    expect(can(seller, 'store.read', 'cafe', myStore)).toBe(false);
  });
});

describe('Local', () => {
  it('ve lo suyo, pide más, recibe y reporta ventas', () => {
    for (const a of ['store.read', 'contract.read', 'delivery.read', 'delivery.receive', 'sale.report', 'reorder.create', 'settlement.read'] as Action[]) {
      expect(can(store, a, 'tabaco', myStore), a).toBe(true);
      expect(can(store, a, 'tabaco', otherStore), `${a} en otro local`).toBe(false);
    }
    expect(can(store, 'product.read', 'tabaco')).toBe(true);
    expect(can(store, 'message.send', 'tabaco')).toBe(true);
  });
  it('no inscribe tiendas, no confirma pedidos, no ve comisiones ni el mapa', () => {
    for (const a of ['store.list', 'store.create', 'store.update', 'visit.create', 'reorder.confirm', 'contract.sign', 'contract.issue', 'delivery.request', 'return.create', 'commission.read', 'map.read', ...ADMIN_ONLY] as Action[]) {
      expect(can(store, a, 'tabaco', myStore), a).toBe(false);
    }
  });
});

describe('Dirección', () => {
  it('solo tiene la vista de las dos líneas', () => {
    expect(can(direccion, 'direccion.read', 'tabaco')).toBe(true);
    expect(can(direccion, 'direccion.read', 'cafe')).toBe(true);
    expect(can(direccion, 'direccion.read', null)).toBe(true);
    for (const a of ['product.read', 'store.list', 'accounting.read', 'audit.read'] as Action[]) {
      expect(can(direccion, a, 'tabaco'), a).toBe(false);
    }
  });
});

describe('«Ver como…»: solo mirar', () => {
  const sellerView = { ...seller, readOnly: true };
  const adminView = { ...admin, readOnly: true };
  it('deja leer', () => {
    expect(can(sellerView, 'product.read', 'tabaco')).toBe(true);
    expect(can(sellerView, 'store.read', 'tabaco', myStore)).toBe(true);
    expect(can(adminView, 'accounting.read', 'tabaco')).toBe(true);
  });
  it('no deja escribir nada', () => {
    for (const a of ['store.create', 'visit.create', 'message.send', 'delivery.request'] as Action[]) {
      expect(can(sellerView, a, 'tabaco', myStore), a).toBe(false);
    }
    for (const a of ['product.write', 'payment.record', 'settings.manage', 'commission.pay'] as Action[]) {
      expect(can(adminView, a, 'tabaco'), a).toBe(false);
    }
  });
  it('isWrite separa lecturas de escrituras', () => {
    expect(isWrite('product.write')).toBe(true);
    expect(isWrite('message.send')).toBe(true);
    expect(isWrite('product.read')).toBe(false);
    expect(isWrite('direccion.read')).toBe(false);
  });
});

describe('ensure', () => {
  it('lanza ForbiddenError con un motivo claro', () => {
    expect(() => ensure(seller, 'payment.record', 'tabaco')).toThrow(ForbiddenError);
    expect(() => ensure(seller, 'payment.record', 'tabaco')).toThrow(/registrar pagos/);
    expect(() => ensure({ ...seller, readOnly: true }, 'store.create', 'tabaco')).toThrow(/ver como/);
    expect(() => ensure(seller, 'product.read', 'cafe')).toThrow(/otra línea/);
    expect(() => ensure(admin, 'product.write', 'tabaco')).not.toThrow();
  });
});
