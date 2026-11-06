// Familias y variantes, unidades (mazo, caja, tabaco), códigos de barras y lectura de hojas.
import { describe, expect, it } from 'vitest';
import type { Product } from '../../src/data/types';
import {
  capaFromText,
  composeName,
  familyIdFor,
  fmtInches,
  mixedUnitsText,
  orderStep,
  packText,
  searchText,
  stockText,
  variantLabelFor,
} from '../../src/domain/products';
import { ean13CheckDigit, internalEan13, isValidEan13, makeEan13 } from '../../src/lib/barcode';
import { parseNumber, readCsvText, toTable } from '../../src/lib/sheets';

const mazo = { unitName: 'mazo', packSize: 50, attrs: { cigarsPerBundle: 25 } } as Pick<Product, 'unitName' | 'packSize' | 'attrs'>;
const premium = { unitName: 'tabaco', packSize: 20, attrs: {} } as Pick<Product, 'unitName' | 'packSize' | 'attrs'>;

describe('variantes', () => {
  it('el nombre se arma con la familia, la capa y la medida', () => {
    const attrs = { capa: 'maduro', lengthIn: 6, ringGauge: 52 };
    expect(variantLabelFor('tabaco', attrs)).toBe('Maduro · 6 × 52');
    expect(composeName('Toro', variantLabelFor('tabaco', attrs))).toBe('Toro · Maduro · 6 × 52');
    expect(composeName('Biscayne Robusto', '')).toBe('Biscayne Robusto');
    // La medida que ya está en la familia no se repite.
    expect(variantLabelFor('tabaco', attrs, 'Toro 6x52')).toBe('Maduro');
    expect(composeName('Toro 6 × 52', 'Maduro · 6 × 52')).toBe('Toro 6 × 52 · Maduro');
    expect(variantLabelFor('cafe', { grind: 'Molido espresso', weight: '10 oz' })).toBe('Molido espresso · 10 oz');
  });

  it('la misma familia da siempre el mismo id; buscar «toro» la encuentra', () => {
    expect(familyIdFor('tabaco', 'Toro', 'mazo')).toBe(familyIdFor('tabaco', ' toro ', 'mazo'));
    expect(familyIdFor('tabaco', 'Toro', 'mazo')).not.toBe(familyIdFor('tabaco', 'Toro', 'premium', 'GM'));
    const text = searchText({ name: 'Toro · Maduro · 6 × 52', sku: 'TB-1', brandLine: '', attrs: { capa: 'maduro' }, familyName: 'Toro' });
    expect(text).toContain('toro');
    expect(text).toContain('maduro');
  });

  it('reconoce la capa en un texto libre', () => {
    expect(capaFromText('Maduro San Andrés (México)')).toBe('maduro');
    expect(capaFromText('Connecticut Shade (Ecuador)')).toBe('connecticut');
    expect(capaFromText('Broadleaf Maduro (Connecticut, EE. UU.)')).toBe('oscuro');
    expect(capaFromText('HABANO')).toBe('habano');
    expect(capaFromText('')).toBeNull();
    expect(fmtInches(6.125)).toBe('6⅛');
  });
});

describe('unidades', () => {
  it('el stock se enseña en mazos y tabacos; se pide de a un mazo', () => {
    expect(stockText(mazo, 120)).toBe('120 mazos · 3,000 tabacos');
    expect(stockText(premium, 40)).toBe('40 tabacos · 2 cajas');
    expect(orderStep(mazo)).toBe(1);
    expect(orderStep(premium)).toBe(20);
    expect(packText(mazo)).toBe('Caja de 50 mazos (1,250 tabacos)');
    expect(mixedUnitsText([{ product: mazo, qty: 10 }, { product: premium, qty: 40 }, { product: mazo, qty: 5 }])).toBe('15 mazos y 40 tabacos');
  });
});

describe('códigos de barras', () => {
  it('EAN-13 con su dígito de control', () => {
    expect(ean13CheckDigit('750103131130')).toBe(9);
    expect(isValidEan13(makeEan13('200000001001'))).toBe(true);
    expect(makeEan13('200000001001')).toBe('2000000010014');
    expect(isValidEan13('2000000010010')).toBe(false);
    expect(internalEan13(1)).toMatch(/^200\d{10}$/);
  });
});

describe('hojas de cálculo', () => {
  it('CSV con punto y coma, tildes y filas vacías', async () => {
    const t = await readCsvText('﻿Nombre;Precio de venta;Coste\nToro;25,00;10,50\n\n;;\nRobusto;23;9.6\n');
    expect(t.headers).toEqual(['Nombre', 'Precio de venta', 'Coste']);
    expect(t.rows).toEqual([
      ['Toro', '25,00', '10,50'],
      ['Robusto', '23', '9.6'],
    ]);
  });

  it('números escritos de varias formas', () => {
    expect(parseNumber('1,234.50')).toBe(1234.5);
    expect(parseNumber('1.234,50')).toBe(1234.5);
    expect(parseNumber('$25')).toBe(25);
    expect(parseNumber('')).toBeNaN();
    expect(toTable([['A', 'B'], [1, 2.5]]).rows).toEqual([['1', '2.5']]);
  });
});
