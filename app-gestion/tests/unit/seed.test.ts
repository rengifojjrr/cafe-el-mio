import { describe, expect, it } from 'vitest';
import type { Arrival, Commission, Delivery, Invoice, Lot, Movement, Payment, PriceList, Product, Reorder, Settlement, Store } from '../../src/data/types';
import { isCubanOrigin, permitState } from '../../src/domain/compliance';
import { hasValidResaleCert, invoiceBalance, isInvoiceOverdue } from '../../src/domain/invoices';
import { Balances, WAREHOUSE, findNegative, storeLoc } from '../../src/domain/ledger';
import { isOverdue } from '../../src/domain/money-rules';
import { buildLine } from '../../src/seed';

const NOW = new Date('2026-11-05T15:00:00Z');
const tabaco = buildLine('tabaco', NOW);
const cafe = buildLine('cafe', NOW);

describe('semilla de ejemplo', () => {
  for (const [line, t] of [
    ['tabaco', tabaco],
    ['cafe', cafe],
  ] as const) {
    it(`${line}: tres meses de historia y ningún saldo negativo en ningún momento`, () => {
      const movements = t.movements as Movement[];
      expect(movements.length).toBeGreaterThan(500);
      expect(findNegative(movements)).toBeNull();
      const first = movements.map((m) => m.at).sort()[0]!;
      expect(new Date(first).getTime()).toBeLessThan(NOW.getTime() - 85 * 86_400_000);
      for (const m of movements) expect(new Date(m.at).getTime()).toBeLessThanOrEqual(NOW.getTime());
    });

    it(`${line}: casos para enseñar`, () => {
      const stores = t.stores as Store[];
      const settlements = t.settlements as Settlement[];
      const reorders = t.reorders as Reorder[];
      const deliveries = t.deliveries as Delivery[];
      expect(stores.some((s) => s.status === 'contrato_enviado')).toBe(true);
      expect(reorders.filter((r) => r.status === 'enviado' || r.status === 'confirmado')).toHaveLength(2);
      expect(deliveries.filter((d) => d.status === 'solicitada')).toHaveLength(1);
      expect(settlements.some((s) => isOverdue(s, NOW))).toBe(true);
      expect((t.arrivals as Arrival[]).some((a) => a.status !== 'recibida')).toBe(true);
      const products = t.products as Product[];
      const b = Balances.from(t.movements as Movement[]);
      const low = products.filter((p) => b.qty(WAREHOUSE, p.id) <= p.lowStockThreshold);
      expect(low.length).toBeGreaterThan(0);
      expect((t.threads as unknown[]).length).toBeGreaterThan(1);
    });
  }

  it('tabaco: 12 premium y 9 de mazo en 4 familias, 4 vendedores, 23 locales (5 en firme), un permiso vencido y nada de Cuba', () => {
    const products = tabaco.products as Product[];
    expect(products).toHaveLength(21);
    expect(products.filter((p) => p.kind === 'premium')).toHaveLength(12);
    const mazo = products.filter((p) => p.kind === 'mazo');
    expect(mazo).toHaveLength(9);
    expect(new Set(mazo.map((p) => p.familyId)).size).toBe(4);
    for (const p of mazo) {
      expect(p.unitName).toBe('mazo');
      expect(p.attrs.cigarsPerBundle).toBe(25);
      expect(p.packSize).toBe(50);
      // El nombre lleva la capa sin escribirla a mano: «Toro 6 × 52 · Maduro».
      expect(p.name).toBe(`${p.familyName} · ${p.variantLabel}`);
      expect(p.variantLabel).not.toContain('×');
    }
    // Ningún código de barras repetido.
    const codes = products.map((p) => p.barcode).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
    for (const p of products) expect(isCubanOrigin(String(p.attrs.originCountry))).toBe(false);
    const stores = tabaco.stores as Store[];
    expect(stores).toHaveLength(23);
    expect(stores.filter((s) => s.saleMode === 'firme')).toHaveLength(5);
    expect((tabaco.users as { role: string }[]).filter((u) => u.role === 'seller')).toHaveLength(4);
    expect(stores.filter((s) => s.status === 'activo' && permitState(s, NOW) === 'vencido')).toHaveLength(1);
  });

  it('café: 9 productos de El Mío, 3 vendedores, 17 locales (2 en firme) y café por vencer en un local', () => {
    expect(cafe.products as Product[]).toHaveLength(9);
    expect(cafe.stores as Store[]).toHaveLength(17);
    expect((cafe.stores as Store[]).filter((s) => s.saleMode === 'firme')).toHaveLength(2);
    expect((cafe.users as { role: string }[]).filter((u) => u.role === 'seller')).toHaveLength(3);
    const b = Balances.from(cafe.movements as Movement[]);
    const lots = new Map((cafe.lots as Lot[]).map((l) => [l.id, l]));
    const soon = new Date(NOW.getTime() + 21 * 86_400_000).toISOString().slice(0, 10);
    const expiringInStore = (cafe.stores as Store[]).some((s) =>
      (cafe.products as Product[]).some((p) => b.lots(storeLoc(s.id), p.id).some((l) => (lots.get(l.lotId)?.bestBefore ?? '9999') <= soon)),
    );
    expect(expiringInStore).toBe(true);
  });

  it('venta en firme: listas de precios, locales con permiso y Tax ID de ejemplo, facturas, pagos y una vencida', () => {
    for (const t of [tabaco, cafe]) {
      const lists = t.priceLists as PriceList[];
      expect(lists.map((l) => l.name)).toEqual(['Público (PVP)', 'Local', 'Mayorista']);
      const firm = (t.stores as Store[]).filter((s) => s.saleMode === 'firme');
      for (const s of firm) {
        expect(s.status).toBe('activo');
        expect(s.taxId).toMatch(/^00-00012\d\d$/);
        expect(s.resaleCert?.number).toBeTruthy();
        expect(lists.some((l) => l.id === s.priceListId)).toBe(true);
      }
      const invoices = t.invoices as Invoice[];
      expect(invoices.length).toBeGreaterThan(20);
      expect(new Set(invoices.map((i) => i.code)).size).toBe(invoices.length);
      expect(invoices.some((i) => i.origin === 'venta_rapida' && i.sellerId === null)).toBe(true);
      // Pagos: casi todo en efectivo; cada factura pagada cuadra con sus pagos.
      const payments = (t.payments as Payment[]).filter((p) => p.invoiceId);
      expect(payments.filter((p) => p.method === 'efectivo').length).toBeGreaterThan(payments.length / 2);
      for (const i of invoices) {
        const paid = payments.filter((p) => p.invoiceId === i.id).reduce((a, p) => a + p.amount, 0);
        expect(paid).toBeCloseTo(i.paid, 2);
        expect(i.subtotal).toBeCloseTo(i.lines.reduce((a, l) => a + l.amount, 0), 2);
      }
      // Lo vendido en firme salió del almacén lote por lote.
      const sold = (t.movements as Movement[]).filter((m) => m.type === 'venta_firme');
      expect(sold.reduce((a, m) => a + m.qty, 0)).toBe(invoices.reduce((a, i) => a + i.lines.reduce((b, l) => b + l.qty, 0), 0));
      // Comisiones solo en facturas con vendedor.
      const com = (t.commissions as Commission[]).filter((c) => c.invoiceId);
      expect(com.length).toBeGreaterThan(0);
      for (const c of com) expect(invoices.find((i) => i.id === c.invoiceId)?.sellerId).toBeTruthy();
    }
    const tStores = (tabaco.stores as Store[]).filter((s) => s.saleMode === 'firme');
    for (const s of tStores) expect(permitState(s, NOW)).toBe('vigente');
    expect(tStores.filter((s) => !hasValidResaleCert(s, NOW))).toHaveLength(1);
    const tInvoices = tabaco.invoices as Invoice[];
    expect(tInvoices.filter((i) => isInvoiceOverdue(i, NOW))).toHaveLength(1);
    expect(tInvoices.filter((i) => invoiceBalance(i) > 0 && !isInvoiceOverdue(i, NOW)).length).toBeGreaterThan(0);
    const expired = tStores.find((s) => !hasValidResaleCert(s, NOW))!;
    expect(tInvoices.filter((i) => i.storeId === expired.id).every((i) => i.withoutResaleCert)).toBe(true);
  });

  it('es determinista: la misma fecha da los mismos datos', () => {
    const again = buildLine('tabaco', NOW);
    expect((again.movements as Movement[]).length).toBe((tabaco.movements as Movement[]).length);
    expect(JSON.stringify(again.settlements)).toBe(JSON.stringify(tabaco.settlements));
    expect(JSON.stringify(again.invoices)).toBe(JSON.stringify(tabaco.invoices));
  });
});
