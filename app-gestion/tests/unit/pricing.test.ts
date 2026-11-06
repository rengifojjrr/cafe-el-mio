// Listas de precios y cuentas de la factura en firme: funciones puras.
import { describe, expect, it } from 'vitest';
import type { PriceList } from '../../src/data/types';
import { creditDaysFor, hasValidResaleCert, invoiceBalance, invoiceCommissions, invoiceDueOn, invoiceStatus, invoiceTotals, isInvoiceOverdue } from '../../src/domain/invoices';
import { baseQty, markupPrice, priceFor, splitIntoPacks } from '../../src/domain/pricing';

const mazo = { id: 'p-mazo', cost: 10.5, priceToStore: 25, suggestedRetail: 43.75, packSize: 50, boxPrice: 1200 };
const premium = { id: 'p-prem', cost: 2.4, priceToStore: 5.5, suggestedRetail: 9.5, packSize: 20 };

function list(over: Partial<PriceList> = {}): PriceList {
  return { id: 'l', name: 'Lista', kind: 'otra', entries: {}, active: true, createdAt: '', updatedAt: '', ...over };
}

describe('precio de un producto en una lista', () => {
  it('precio escrito: por mazo y por caja (unidad × 50 si la lista no dice la caja)', () => {
    const l = list({ entries: { 'p-mazo': { mode: 'fixed', unit: 23 } } });
    expect(priceFor(mazo, l)).toMatchObject({ unit: 23, box: 1150, price: 23, source: 'lista', volume: false });
    expect(priceFor(mazo, l, { pack: 'caja', qty: 1 })).toMatchObject({ price: 1150 });
  });

  it('precio escrito con caja propia', () => {
    const l = list({ entries: { 'p-mazo': { mode: 'fixed', unit: 23, box: 1100 } } });
    expect(priceFor(mazo, l, { pack: 'caja' })).toMatchObject({ unit: 23, box: 1100, price: 1100 });
  });

  it('solo con precio por caja: la unidad sale de dividirla', () => {
    const l = list({ entries: { 'p-mazo': { mode: 'fixed', box: 1125 } } });
    expect(priceFor(mazo, l)).toMatchObject({ unit: 22.5, box: 1125 });
  });

  it('% sobre el costo, redondeado a centavos', () => {
    const l = list({ entries: { 'p-prem': { mode: 'markup', markupPercent: 112.5 } } });
    // 2.40 × 2.125 = 5.10
    expect(priceFor(premium, l)).toMatchObject({ unit: 5.1, box: 102, source: 'margen' });
    expect(markupPrice(10.33, 33.3)).toBe(13.77);
    expect(markupPrice(3.333, 10)).toBe(3.67);
  });

  it('desde N cajas: el precio por caja baja al llegar a las cajas', () => {
    const l = list({ entries: { 'p-mazo': { mode: 'fixed', unit: 23, box: 1100, volume: { minBoxes: 3, box: 1050 } } } });
    expect(priceFor(mazo, l, { pack: 'caja', qty: 2 })).toMatchObject({ price: 1100, volume: false });
    expect(priceFor(mazo, l, { pack: 'caja', qty: 3 })).toMatchObject({ price: 1050, volume: true });
    // Por mazo no aplica.
    expect(priceFor(mazo, l, { pack: 'unidad', qty: 300 })).toMatchObject({ price: 23, volume: false });
  });

  it('producto que no está en la lista: % de toda la lista, PVP o precio al local (con su caja)', () => {
    expect(priceFor(mazo, list({ defaultMarkupPercent: 100 }))).toMatchObject({ unit: 21, box: 1050, source: 'margen_lista' });
    expect(priceFor(mazo, list({ kind: 'pvp' }))).toMatchObject({ unit: 43.75, box: 2187.5, source: 'pvp' });
    expect(priceFor(mazo, list({ kind: 'local' }))).toMatchObject({ unit: 25, box: 1200, source: 'producto' });
    expect(priceFor(premium, list({ kind: 'local' }))).toMatchObject({ unit: 5.5, box: 110, source: 'producto' });
    expect(priceFor(mazo, null)).toMatchObject({ unit: 25, box: 1200, source: 'producto' });
  });

  it('entrada incompleta: se usa lo de la lista', () => {
    const l = list({ defaultMarkupPercent: 50, entries: { 'p-mazo': { mode: 'markup' } } });
    expect(priceFor(mazo, l)).toMatchObject({ unit: 15.75, source: 'margen_lista' });
  });
});

describe('cajas y unidades', () => {
  it('lo entregado se parte en cajas completas y mazos sueltos', () => {
    expect(splitIntoPacks(mazo, 60)).toEqual([
      { pack: 'caja', packQty: 1, qty: 50 },
      { pack: 'unidad', packQty: 10, qty: 10 },
    ]);
    expect(splitIntoPacks(mazo, 10)).toEqual([{ pack: 'unidad', packQty: 10, qty: 10 }]);
    expect(splitIntoPacks(premium, 40)).toEqual([{ pack: 'caja', packQty: 2, qty: 40 }]);
    expect(splitIntoPacks({ packSize: 1 }, 3)).toEqual([{ pack: 'unidad', packQty: 3, qty: 3 }]);
    expect(baseQty(mazo, 'caja', 2)).toBe(100);
    expect(baseQty(mazo, 'unidad', 7)).toBe(7);
  });
});

describe('cuentas de la factura', () => {
  const NOW = new Date('2026-11-05T15:00:00Z');
  it('impuesto solo con % en Ajustes y sin certificado de reventa vigente', () => {
    const lines = [{ amount: 250 }, { amount: 1150 }];
    expect(invoiceTotals(lines, undefined, true)).toEqual({ subtotal: 1400, taxPercent: 0, tax: 0, total: 1400 });
    expect(invoiceTotals(lines, 7, false)).toEqual({ subtotal: 1400, taxPercent: 0, tax: 0, total: 1400 });
    expect(invoiceTotals(lines, 7, true)).toEqual({ subtotal: 1400, taxPercent: 7, tax: 98, total: 1498 });
    expect(invoiceTotals([{ amount: 33.33 }], 7, true)).toMatchObject({ tax: 2.33, total: 35.66 });
  });

  it('saldo, estado, vencimiento y crédito', () => {
    expect(invoiceBalance({ total: 100, paid: 40 })).toBe(60);
    expect(invoiceStatus(100, 0)).toBe('pendiente');
    expect(invoiceStatus(100, 40)).toBe('parcial');
    expect(invoiceStatus(100, 100)).toBe('pagada');
    expect(invoiceDueOn('2026-11-01', 15)).toBe('2026-11-16');
    expect(isInvoiceOverdue({ total: 100, paid: 0, dueOn: '2026-11-04' }, NOW)).toBe(true);
    expect(isInvoiceOverdue({ total: 100, paid: 0, dueOn: '2026-11-05' }, NOW)).toBe(false);
    expect(isInvoiceOverdue({ total: 100, paid: 100, dueOn: '2026-10-01' }, NOW)).toBe(false);
    expect(creditDaysFor({ saleMode: 'firme', creditDays: 15 }, { paymentTermsDays: 10 })).toBe(15);
    expect(creditDaysFor({ saleMode: 'firme' }, { paymentTermsDays: 10 })).toBe(0);
    expect(creditDaysFor({}, { paymentTermsDays: 10 })).toBe(10);
  });

  it('certificado de reventa vigente o no', () => {
    expect(hasValidResaleCert({ resaleCert: { number: 'RC-1', expiresOn: '2026-12-31' } }, NOW)).toBe(true);
    expect(hasValidResaleCert({ resaleCert: { number: 'RC-1', expiresOn: '2026-11-05' } }, NOW)).toBe(true);
    expect(hasValidResaleCert({ resaleCert: { number: 'RC-1', expiresOn: '2026-11-04' } }, NOW)).toBe(false);
    expect(hasValidResaleCert({}, NOW)).toBe(false);
  });

  it('comisiones de una factura: con vendedor sí, venta directa no', () => {
    let n = 0;
    const newId = (p: string) => `${p}_${++n}`;
    const products = new Map([
      ['p-mazo', { id: 'p-mazo', sellerCommission: { type: 'percent' as const, value: 6 } }],
      ['p-prem', { id: 'p-prem', sellerCommission: { type: 'fixed' as const, value: 0.4 } }],
    ]);
    const inv = {
      id: 'f1',
      storeId: 's1',
      sellerId: 'v1',
      issuedAt: '2026-11-01T15:00:00.000Z',
      lines: [
        { productId: 'p-mazo', name: '', pack: 'caja' as const, packQty: 1, qty: 50, unitPrice: 1150, amount: 1150, cost: 0, lots: [] },
        { productId: 'p-prem', name: '', pack: 'caja' as const, packQty: 2, qty: 40, unitPrice: 110, amount: 220, cost: 0, lots: [] },
      ],
    };
    const list = invoiceCommissions(inv, products, { id: 'v1' }, 'cobro', newId);
    expect(list.map((c) => [c.productId, c.amount, c.status, c.invoiceId])).toEqual([
      ['p-mazo', 69, 'devengada', 'f1'],
      ['p-prem', 16, 'devengada', 'f1'],
    ]);
    expect(invoiceCommissions({ ...inv, sellerId: null }, products, { id: 'v1' }, 'cobro', newId)).toEqual([]);
    // Comisión especial del vendedor.
    const special = invoiceCommissions(inv, products, { id: 'v1', commissionOverride: { type: 'percent', value: 10 } }, 'venta', newId);
    expect(special.map((c) => [c.amount, c.status])).toEqual([
      [115, 'pagable'],
      [22, 'pagable'],
    ]);
  });
});
