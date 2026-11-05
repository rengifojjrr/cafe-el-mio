// Libro de movimientos: saldos por lugar/producto/lote, reparto FEFO/FIFO y la regla de oro:
// ningún lugar con saldo (almacén o local) queda negativo, y la consignación nunca pasa de lo colocado.
import { describe, expect, it } from 'vitest';
import type { Delivery, Location, Lot, Movement, MovementType } from '../../src/data/types';
import {
  Balances,
  InsufficientStockError,
  WAREHOUSE,
  allocate,
  findNegative,
  isTracked,
  locKey,
  lotOrder,
  reservedByProduct,
  storeLoc,
} from '../../src/domain/ledger';
import { seededRandom } from '../../src/lib/ids';

let seq = 0;
function mv(p: Partial<Movement> & { type: MovementType; productId: string; lotId: string; qty: number; from: Location; to: Location }): Movement {
  seq += 1;
  return {
    id: `m${String(seq).padStart(5, '0')}`,
    at: p.at ?? `2026-10-01T12:${String(seq % 60).padStart(2, '0')}:00.000Z`,
    storeId: p.to.kind === 'store' ? p.to.storeId : p.from.kind === 'store' ? p.from.storeId : null,
    refType: 'seed',
    refId: 'prueba',
    actorId: 'u-prueba',
    ...p,
  };
}

function lot(id: string, productId: string, receivedAt: string, bestBefore?: string): Lot {
  return { id, productId, code: id.toUpperCase(), arrivalId: null, unitCost: 1, receivedAt, bestBefore };
}

const SUPPLIER: Location = { kind: 'supplier' };
const SOLD: Location = { kind: 'sold' };
const LOSS: Location = { kind: 'loss' };

describe('lugares del libro', () => {
  it('locKey distingue cada local y solo el almacén y los locales llevan saldo', () => {
    expect(locKey(WAREHOUSE)).toBe('warehouse');
    expect(locKey(storeLoc('s1'))).toBe('store:s1');
    expect(isTracked(WAREHOUSE)).toBe(true);
    expect(isTracked(storeLoc('s1'))).toBe(true);
    expect(isTracked(SUPPLIER)).toBe(false);
    expect(isTracked(SOLD)).toBe(false);
    expect(isTracked(LOSS)).toBe(false);
    expect(isTracked({ kind: 'adjustment' })).toBe(false);
  });
});

describe('Balances', () => {
  const movements = [
    mv({ type: 'entrada', productId: 'p1', lotId: 'L1', qty: 100, from: SUPPLIER, to: WAREHOUSE }),
    mv({ type: 'entrada', productId: 'p1', lotId: 'L2', qty: 50, from: SUPPLIER, to: WAREHOUSE }),
    mv({ type: 'entrada', productId: 'p2', lotId: 'L3', qty: 10, from: SUPPLIER, to: WAREHOUSE }),
    mv({ type: 'salida_consignacion', productId: 'p1', lotId: 'L1', qty: 30, from: WAREHOUSE, to: storeLoc('s1') }),
    mv({ type: 'salida_consignacion', productId: 'p1', lotId: 'L2', qty: 5, from: WAREHOUSE, to: storeLoc('s2') }),
    mv({ type: 'venta_reportada', productId: 'p1', lotId: 'L1', qty: 10, from: storeLoc('s1'), to: SOLD }),
    mv({ type: 'devolucion', productId: 'p1', lotId: 'L1', qty: 2, from: storeLoc('s1'), to: WAREHOUSE }),
    mv({ type: 'merma', productId: 'p2', lotId: 'L3', qty: 1, from: WAREHOUSE, to: LOSS }),
  ];
  const b = Balances.from(movements);

  it('suma por lugar, producto y lote', () => {
    expect(b.qty(WAREHOUSE, 'p1')).toBe(100 + 50 - 30 - 5 + 2);
    expect(b.qty(WAREHOUSE, 'p1', 'L1')).toBe(100 - 30 + 2);
    expect(b.qty(WAREHOUSE, 'p1', 'L2')).toBe(45);
    expect(b.qty(WAREHOUSE, 'p2')).toBe(9);
    expect(b.qty(storeLoc('s1'), 'p1')).toBe(30 - 10 - 2);
    expect(b.qty(storeLoc('s2'), 'p1')).toBe(5);
    expect(b.qty(storeLoc('s3'), 'p1')).toBe(0);
    expect(b.qty(WAREHOUSE, 'nada')).toBe(0);
  });

  it('lista lotes con saldo positivo, saldos por producto y totales en consignación', () => {
    expect(b.lots(WAREHOUSE, 'p1').sort((x, y) => x.lotId.localeCompare(y.lotId))).toEqual([
      { lotId: 'L1', qty: 72 },
      { lotId: 'L2', qty: 45 },
    ]);
    expect(b.byProduct(WAREHOUSE)).toEqual(
      new Map([
        ['p1', 117],
        ['p2', 9],
      ]),
    );
    expect(b.consignmentTotals().get('p1')).toBe(18 + 5);
    expect(b.consignmentTotals().get('p2')).toBeUndefined();
    expect(b.storesHolding('p1')).toEqual(
      new Map([
        ['s1', 18],
        ['s2', 5],
      ]),
    );
  });

  it('los lugares externos (proveedor, vendido, merma) no llevan saldo', () => {
    expect(b.entries().every((e) => e.loc === 'warehouse' || e.loc.startsWith('store:'))).toBe(true);
  });

  it('apply después de from da lo mismo que volver a calcular', () => {
    const extra = mv({ type: 'venta_reportada', productId: 'p1', lotId: 'L2', qty: 3, from: storeLoc('s2'), to: SOLD });
    const incremental = Balances.from(movements);
    incremental.apply(extra);
    const full = Balances.from([...movements, extra]);
    expect(incremental.entries().sort((x, y) => `${x.loc}${x.productId}${x.lotId}`.localeCompare(`${y.loc}${y.productId}${y.lotId}`))).toEqual(
      full.entries().sort((x, y) => `${x.loc}${x.productId}${x.lotId}`.localeCompare(`${y.loc}${y.productId}${y.lotId}`)),
    );
  });
});

describe('allocate', () => {
  it('FEFO: con «consumir antes de» sale primero lo que vence antes (café)', () => {
    const lots = new Map([
      ['A', lot('A', 'cafe', '2026-09-01T12:00:00Z', '2027-03-01')],
      ['B', lot('B', 'cafe', '2026-10-01T12:00:00Z', '2026-12-01')],
    ]);
    const b = Balances.from([
      mv({ type: 'entrada', productId: 'cafe', lotId: 'A', qty: 20, from: SUPPLIER, to: WAREHOUSE }),
      mv({ type: 'entrada', productId: 'cafe', lotId: 'B', qty: 20, from: SUPPLIER, to: WAREHOUSE }),
    ]);
    expect(allocate(b, lots, WAREHOUSE, 'cafe', 5)).toEqual([{ lotId: 'B', qty: 5 }]);
    expect(lotOrder(lots.get('B'))).toBe('2026-12-01');
  });

  it('FIFO: sin vencimiento sale primero lo que llegó antes (tabaco)', () => {
    const lots = new Map([
      ['new', lot('new', 'puro', '2026-10-20T12:00:00Z')],
      ['old', lot('old', 'puro', '2026-08-20T12:00:00Z')],
    ]);
    const b = Balances.from([
      mv({ type: 'entrada', productId: 'puro', lotId: 'new', qty: 10, from: SUPPLIER, to: WAREHOUSE }),
      mv({ type: 'entrada', productId: 'puro', lotId: 'old', qty: 10, from: SUPPLIER, to: WAREHOUSE }),
    ]);
    expect(allocate(b, lots, WAREHOUSE, 'puro', 4)).toEqual([{ lotId: 'old', qty: 4 }]);
  });

  it('reparte entre varios lotes cuando uno no alcanza', () => {
    const lots = new Map([
      ['L1', lot('L1', 'p', '2026-01-01T12:00:00Z')],
      ['L2', lot('L2', 'p', '2026-02-01T12:00:00Z')],
      ['L3', lot('L3', 'p', '2026-03-01T12:00:00Z')],
    ]);
    const b = Balances.from([
      mv({ type: 'entrada', productId: 'p', lotId: 'L1', qty: 5, from: SUPPLIER, to: WAREHOUSE }),
      mv({ type: 'entrada', productId: 'p', lotId: 'L2', qty: 10, from: SUPPLIER, to: WAREHOUSE }),
      mv({ type: 'entrada', productId: 'p', lotId: 'L3', qty: 10, from: SUPPLIER, to: WAREHOUSE }),
    ]);
    const parts = allocate(b, lots, WAREHOUSE, 'p', 12);
    expect(parts).toEqual([
      { lotId: 'L1', qty: 5 },
      { lotId: 'L2', qty: 7 },
    ]);
    expect(parts.reduce((s, x) => s + x.qty, 0)).toBe(12);
  });

  it('ignora lotes vacíos y pide en el lugar correcto', () => {
    const lots = new Map([
      ['L1', lot('L1', 'p', '2026-01-01T12:00:00Z')],
      ['L2', lot('L2', 'p', '2026-02-01T12:00:00Z')],
    ]);
    const b = Balances.from([
      mv({ type: 'entrada', productId: 'p', lotId: 'L1', qty: 3, from: SUPPLIER, to: WAREHOUSE }),
      mv({ type: 'entrada', productId: 'p', lotId: 'L2', qty: 3, from: SUPPLIER, to: WAREHOUSE }),
      mv({ type: 'salida_consignacion', productId: 'p', lotId: 'L1', qty: 3, from: WAREHOUSE, to: storeLoc('s1') }),
    ]);
    expect(allocate(b, lots, WAREHOUSE, 'p', 2)).toEqual([{ lotId: 'L2', qty: 2 }]);
    expect(allocate(b, lots, storeLoc('s1'), 'p', 3)).toEqual([{ lotId: 'L1', qty: 3 }]);
  });

  it('si no alcanza lanza InsufficientStockError y no toca los saldos', () => {
    const lots = new Map([['L1', lot('L1', 'p', '2026-01-01T12:00:00Z')]]);
    const b = Balances.from([mv({ type: 'entrada', productId: 'p', lotId: 'L1', qty: 4, from: SUPPLIER, to: WAREHOUSE })]);
    let err: unknown;
    try {
      allocate(b, lots, WAREHOUSE, 'p', 5, 'Robusto');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InsufficientStockError);
    const ise = err as InsufficientStockError;
    expect(ise.available).toBe(4);
    expect(ise.requested).toBe(5);
    expect(ise.productId).toBe('p');
    expect(ise.message).toContain('Robusto');
    expect(b.qty(WAREHOUSE, 'p')).toBe(4);
    expect(() => allocate(b, lots, storeLoc('s9'), 'p', 1)).toThrow(InsufficientStockError);
  });

  it('rechaza cantidades que no son enteros positivos', () => {
    const b = new Balances();
    const lots = new Map<string, Lot>();
    expect(() => allocate(b, lots, WAREHOUSE, 'p', 0)).toThrow();
    expect(() => allocate(b, lots, WAREHOUSE, 'p', -1)).toThrow();
    expect(() => allocate(b, lots, WAREHOUSE, 'p', 1.5)).toThrow();
  });
});

describe('findNegative', () => {
  it('detecta una venta con fecha anterior a la entrega que la cubre', () => {
    const list = [
      mv({ type: 'entrada', productId: 'p', lotId: 'L1', qty: 10, from: SUPPLIER, to: WAREHOUSE, at: '2026-10-01T08:00:00.000Z' }),
      mv({ type: 'salida_consignacion', productId: 'p', lotId: 'L1', qty: 5, from: WAREHOUSE, to: storeLoc('s1'), at: '2026-10-02T10:00:00.000Z' }),
      mv({ type: 'venta_reportada', productId: 'p', lotId: 'L1', qty: 2, from: storeLoc('s1'), to: SOLD, at: '2026-10-02T09:00:00.000Z' }),
    ];
    const msg = findNegative(list);
    expect(msg).not.toBeNull();
    expect(msg).toContain('store:s1');
  });

  it('con las fechas en orden no hay saldos negativos', () => {
    const list = [
      mv({ type: 'entrada', productId: 'p', lotId: 'L1', qty: 10, from: SUPPLIER, to: WAREHOUSE, at: '2026-10-01T08:00:00.000Z' }),
      mv({ type: 'salida_consignacion', productId: 'p', lotId: 'L1', qty: 5, from: WAREHOUSE, to: storeLoc('s1'), at: '2026-10-02T10:00:00.000Z' }),
      mv({ type: 'venta_reportada', productId: 'p', lotId: 'L1', qty: 5, from: storeLoc('s1'), to: SOLD, at: '2026-10-03T09:00:00.000Z' }),
    ];
    expect(findNegative(list)).toBeNull();
  });

  it('detecta una salida del almacén antes de que llegue la mercancía', () => {
    const list = [
      mv({ type: 'salida_consignacion', productId: 'p', lotId: 'L1', qty: 1, from: WAREHOUSE, to: storeLoc('s1'), at: '2026-10-01T07:00:00.000Z' }),
      mv({ type: 'entrada', productId: 'p', lotId: 'L1', qty: 10, from: SUPPLIER, to: WAREHOUSE, at: '2026-10-01T08:00:00.000Z' }),
    ];
    expect(findNegative(list)).toContain('warehouse');
  });
});

describe('reservedByProduct', () => {
  it('aparta solo lo preparado y todavía no entregado', () => {
    const base: Omit<Delivery, 'id' | 'status' | 'items'> = {
      code: 'E',
      storeId: 's1',
      sellerId: 'v1',
      note: '',
      origin: 'vendedor',
      requestedAt: '2026-10-01T10:00:00Z',
      requestedBy: 'v1',
    };
    const deliveries: Delivery[] = [
      { ...base, id: 'd1', status: 'preparada', items: [{ productId: 'p', qty: 10, preparedQty: 6 }] },
      { ...base, id: 'd2', status: 'preparada', items: [{ productId: 'p', qty: 4 }] },
      { ...base, id: 'd3', status: 'solicitada', items: [{ productId: 'p', qty: 50 }] },
      { ...base, id: 'd4', status: 'entregada', items: [{ productId: 'p', qty: 9, preparedQty: 9 }] },
    ];
    expect(reservedByProduct(deliveries).get('p')).toBe(10);
  });
});

describe('propiedad: cientos de operaciones al azar nunca dejan saldos negativos', () => {
  it('recibir, consignar, vender, devolver y mermar con reparto por lote', () => {
    const rnd = seededRandom(20261105);
    const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
    const products = ['p1', 'p2', 'p3'];
    const stores = ['s1', 's2', 's3', 's4'];
    const lots = new Map<string, Lot>();
    const b = new Balances();
    const movements: Movement[] = [];
    const placed = new Map<string, number>();
    const removed = new Map<string, number>();
    let t = Date.parse('2026-08-01T12:00:00Z');
    let lotN = 0;
    let rejected = 0;
    const push = (m: Omit<Movement, 'id' | 'at' | 'storeId' | 'refType' | 'refId' | 'actorId'>) => {
      t += 60_000;
      const full = mv({ ...m, at: new Date(t).toISOString() });
      movements.push(full);
      b.apply(full);
    };
    const key = (s: string, p: string) => `${s}|${p}`;

    for (let i = 0; i < 800; i++) {
      const op = rnd();
      const p = products[int(0, products.length - 1)]!;
      const s = stores[int(0, stores.length - 1)]!;
      try {
        if (op < 0.2) {
          lotN += 1;
          const id = `lot${lotN}`;
          const withExpiry = rnd() < 0.5;
          lots.set(id, lot(id, p, new Date(t).toISOString(), withExpiry ? new Date(t + int(10, 300) * 86_400_000).toISOString().slice(0, 10) : undefined));
          push({ type: 'entrada', productId: p, lotId: id, qty: int(1, 60), from: SUPPLIER, to: WAREHOUSE });
        } else if (op < 0.5) {
          const qty = int(1, 40);
          for (const part of allocate(b, lots, WAREHOUSE, p, qty)) {
            push({ type: 'salida_consignacion', productId: p, lotId: part.lotId, qty: part.qty, from: WAREHOUSE, to: storeLoc(s) });
          }
          placed.set(key(s, p), (placed.get(key(s, p)) ?? 0) + qty);
        } else if (op < 0.8) {
          const qty = int(1, 25);
          for (const part of allocate(b, lots, storeLoc(s), p, qty)) {
            push({ type: 'venta_reportada', productId: p, lotId: part.lotId, qty: part.qty, from: storeLoc(s), to: SOLD });
          }
          removed.set(key(s, p), (removed.get(key(s, p)) ?? 0) + qty);
        } else if (op < 0.92) {
          const qty = int(1, 10);
          for (const part of allocate(b, lots, storeLoc(s), p, qty)) {
            push({ type: 'devolucion', productId: p, lotId: part.lotId, qty: part.qty, from: storeLoc(s), to: WAREHOUSE });
          }
          removed.set(key(s, p), (removed.get(key(s, p)) ?? 0) + qty);
        } else {
          const where = rnd() < 0.5 ? WAREHOUSE : storeLoc(s);
          const qty = int(1, 5);
          for (const part of allocate(b, lots, where, p, qty)) {
            push({ type: 'merma', productId: p, lotId: part.lotId, qty: part.qty, from: where, to: LOSS });
          }
          if (where.kind === 'store') removed.set(key(s, p), (removed.get(key(s, p)) ?? 0) + qty);
        }
      } catch (e) {
        expect(e).toBeInstanceOf(InsufficientStockError);
        rejected += 1;
      }
      for (const e of b.entries()) expect(e.qty).toBeGreaterThanOrEqual(0);
    }

    // Hubo de todo: operaciones aceptadas y rechazadas.
    expect(movements.length).toBeGreaterThan(300);
    expect(rejected).toBeGreaterThan(10);
    // Lo que hay en cada local = lo colocado − lo que salió, y nunca más de lo colocado.
    for (const s of stores) {
      for (const p of products) {
        const inStore = b.qty(storeLoc(s), p);
        expect(inStore).toBe((placed.get(key(s, p)) ?? 0) - (removed.get(key(s, p)) ?? 0));
        expect(inStore).toBeLessThanOrEqual(placed.get(key(s, p)) ?? 0);
        expect(inStore).toBeGreaterThanOrEqual(0);
      }
    }
    expect(findNegative(movements)).toBeNull();
  });
});
