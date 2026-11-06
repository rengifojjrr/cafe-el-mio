// «Pegar pedido»: del mensaje de WhatsApp a las líneas del pedido, sin adivinar de más.
import { describe, expect, it } from 'vitest';
import type { Product } from '../../src/data/types';
import { parsePastedOrder, pastedBaseQty } from '../../src/domain/paste-order';
import { buildLine } from '../../src/seed';

const NOW = new Date('2026-11-05T15:00:00Z');
const tabaco = buildLine('tabaco', NOW).products as Product[];
const cafe = buildLine('cafe', NOW).products as Product[];

function find(list: Product[], name: string): Product {
  const p = list.find((x) => x.name === name);
  if (!p) throw new Error(`No está ${name}: ${list.map((x) => x.name).join(' | ')}`);
  return p;
}

const toroMad = find(tabaco, 'Toro 6 × 52 · Maduro');
const toroHab = find(tabaco, 'Toro 6 × 52 · Habano');
const toroCon = find(tabaco, 'Toro 6 × 52 · Connecticut');
const robHab = find(tabaco, 'Robusto 5 × 50 · Habano');
const robMad = find(tabaco, 'Robusto 5 × 50 · Maduro');
const torpMad = find(tabaco, 'Torpedo 6⅛ × 52 · Maduro');
const torpNat = find(tabaco, 'Torpedo 6⅛ × 52 · Natural');
const chuCon = find(tabaco, 'Churchill 7 × 48 · Connecticut');
const chuHab = find(tabaco, 'Churchill 7 × 48 · Habano');
const bisRob = find(tabaco, 'Biscayne Robusto');
const eveTorp = find(tabaco, 'Everglades Torpedo');
const elmio = find(cafe, 'Café Espresso El Mío');
const caja24 = find(cafe, 'El Mío, caja de 24');
const peru = find(cafe, 'Perú en cápsulas');

const T = (text: string, preferred?: string[]) => parsePastedOrder(text, tabaco, { preferred });

describe('pegar pedido: el mensaje de siempre', () => {
  it('«10 toro maduro, 5 robusto habano, 2 cajas torpedo»: dos claras y una para elegir', () => {
    const r = T('10 toro maduro, 5 robusto habano, 2 cajas torpedo');
    expect(r.lines).toHaveLength(3);
    const [a, b, c] = r.lines;
    expect(a).toMatchObject({ productId: toroMad.id, qty: 10, pack: 'unidad', status: 'ok', packGuessed: true });
    expect(b).toMatchObject({ productId: robHab.id, qty: 5, pack: 'unidad', status: 'ok' });
    expect(c).toMatchObject({ productId: null, qty: 2, pack: 'caja', status: 'ambiguo', packGuessed: false });
    expect(c!.candidates).toEqual(expect.arrayContaining([torpMad.id, torpNat.id]));
    expect(pastedBaseQty(a!, toroMad)).toBe(10);
  });

  it('renglones, «y», el número después del producto y los saludos fuera', () => {
    const r = T('Hola Daniela!\ntoro maduro 10\nrobusto habano 5 y churchill connecticut 3\nGracias 🙏');
    expect(r.lines.map((l) => [l.productId, l.qty])).toEqual([
      [toroMad.id, 10],
      [robHab.id, 5],
      [chuCon.id, 3],
    ]);
    expect(r.lines.every((l) => l.status === 'ok')).toBe(true);
    expect(r.ignored.join(' ')).toMatch(/Hola/);
    expect(r.ignored.join(' ')).toMatch(/Gracias/);
  });

  it('varios en un mismo renglón, sin comas', () => {
    const r = T('10 toro maduro 5 robusto habano');
    expect(r.lines.map((l) => [l.productId, l.qty])).toEqual([
      [toroMad.id, 10],
      [robHab.id, 5],
    ]);
    const r2 = T('toro maduro 10 robusto habano 5');
    expect(r2.lines.map((l) => [l.productId, l.qty])).toEqual([
      [toroMad.id, 10],
      [robHab.id, 5],
    ]);
  });
});

describe('cajas y mazos', () => {
  it('«cj», «caja(s)», «mz», «mazo(s)»', () => {
    const r = T('3 cj toro habano; 12 mz robusto maduro; 1 caja churchill habano; 2 mazos toro connecticut');
    expect(r.lines.map((l) => [l.productId, l.qty, l.pack])).toEqual([
      [toroHab.id, 3, 'caja'],
      [robMad.id, 12, 'unidad'],
      [chuHab.id, 1, 'caja'],
      [toroCon.id, 2, 'unidad'],
    ]);
    expect(pastedBaseQty(r.lines[0]!, toroHab)).toBe(150);
    expect(pastedBaseQty(r.lines[2]!, chuHab)).toBe(50);
  });

  it('número pegado a la presentación y palabras de número', () => {
    const r = T('2cj toro maduro\nuna caja de torpedo maduro\ndiez mazos robusto habano');
    expect(r.lines.map((l) => [l.productId, l.qty, l.pack])).toEqual([
      [toroMad.id, 2, 'caja'],
      [torpMad.id, 1, 'caja'],
      [robHab.id, 10, 'unidad'],
    ]);
  });

  it('media caja de mazos son 25 mazos', () => {
    const [l] = T('media caja de toro habano').lines;
    expect(l).toMatchObject({ productId: toroHab.id, qty: 25, pack: 'unidad' });
  });

  it('lo premium sin decir la presentación va por caja; con «tabacos», por tabaco', () => {
    const [a] = T('2 biscayne robusto').lines;
    expect(a).toMatchObject({ productId: bisRob.id, qty: 2, pack: 'caja', packGuessed: true });
    expect(pastedBaseQty(a!, bisRob)).toBe(40);
    const [b] = T('40 tabacos biscayne robusto').lines;
    expect(b).toMatchObject({ productId: bisRob.id, qty: 40, pack: 'unidad', packGuessed: false });
  });

  it('«mazos» deja fuera lo premium aunque se parezca', () => {
    const [l] = T('5 mazos torpedo').lines;
    expect(l!.status).toBe('ambiguo');
    expect(l!.candidates).toEqual(expect.arrayContaining([torpMad.id, torpNat.id]));
    expect(l!.candidates).not.toContain(eveTorp.id);
  });
});

describe('códigos y medidas', () => {
  it('SKU y código de barras, con «x3»', () => {
    const r = T(`2 ${robMad.sku}\n${toroMad.barcode} x3\n${chuHab.sku.toLowerCase()} 4`);
    expect(r.lines.map((l) => [l.productId, l.qty, l.status])).toEqual([
      [robMad.id, 2, 'ok'],
      [toroMad.id, 3, 'ok'],
      [chuHab.id, 4, 'ok'],
    ]);
  });

  it('un SKU repetido en dos productos no se adivina: se pregunta', () => {
    const twins = [
      { ...toroMad, sku: 'TB-DOBLE-1' },
      { ...torpMad, sku: 'TB-DOBLE-1' },
    ];
    const [l] = parsePastedOrder('3 tb-doble-1', twins).lines;
    expect(l).toMatchObject({ status: 'ambiguo', productId: null, qty: 3 });
    expect(l!.candidates).toEqual(expect.arrayContaining([toroMad.id, torpMad.id]));
  });

  it('la medida «6x52» desempata', () => {
    const [a] = T('4 6x52 maduro').lines;
    expect(a).toMatchObject({ productId: toroMad.id, qty: 4, status: 'ok' });
    const [b] = T('2 toro 6 x 52 habano').lines;
    expect(b).toMatchObject({ productId: toroHab.id, qty: 2, status: 'ok' });
    const [c] = T('3 6 1/8 x 52 natural').lines;
    expect(c).toMatchObject({ productId: torpNat.id, qty: 3, status: 'ok' });
  });
});

describe('cómo se escribe de verdad', () => {
  it('mayúsculas, tildes, plurales y singulares', () => {
    const r = T('5 ROBUSTOS HABANOS, 3 Tóros Madúros, 1 churchills habano');
    expect(r.lines.map((l) => l.productId)).toEqual([robHab.id, toroMad.id, chuHab.id]);
  });

  it('errores de dedo: «conneticut», «churchil», «torpdo»', () => {
    const r = T('8 toro conneticut\n2 churchil habano\n6 torpdo maduro');
    expect(r.lines.map((l) => [l.productId, l.status])).toEqual([
      [toroCon.id, 'ok'],
      [chuHab.id, 'ok'],
      [torpMad.id, 'ok'],
    ]);
  });

  it('sin cantidad: se propone 1 y se marca', () => {
    const [l] = T('toro maduro').lines;
    expect(l).toMatchObject({ productId: toroMad.id, qty: 1, qtyGuessed: true });
  });
});

describe('cuando hay dudas', () => {
  it('«10 toro» es ambiguo: se muestran los candidatos y no se elige ninguno', () => {
    const [l] = T('10 toro').lines;
    expect(l!.status).toBe('ambiguo');
    expect(l!.productId).toBeNull();
    expect(l!.candidates).toEqual(expect.arrayContaining([toroHab.id, toroMad.id, toroCon.id]));
  });

  it('lo que el local compra seguido desempata', () => {
    const [l] = T('10 torpedo', [torpMad.id]).lines;
    expect(l).toMatchObject({ productId: torpMad.id, status: 'ok' });
  });

  it('un producto que no está queda como desconocido, con su cantidad', () => {
    const r = T('6 marlboro rojo, 2 toro maduro');
    expect(r.lines[0]).toMatchObject({ status: 'desconocido', productId: null, qty: 6, candidates: [] });
    expect(r.lines[1]).toMatchObject({ productId: toroMad.id, status: 'ok' });
  });

  it('un mensaje sin pedido no da líneas', () => {
    const r = T('Hola, buenos días. Gracias!');
    expect(r.lines).toEqual([]);
    expect(r.ignored.length).toBeGreaterThan(0);
  });
});

describe('café', () => {
  const C = (text: string) => parsePastedOrder(text, cafe);
  it('«café el mío» por caja, la caja de 24 y las cápsulas', () => {
    const r = C('2 cajas de café el mío\n1 caja de 24\n3 Perú en cápsulas');
    expect(r.lines.map((l) => [l.productId, l.qty, l.pack])).toEqual([
      [elmio.id, 2, 'caja'],
      [caja24.id, 1, 'unidad'],
      [peru.id, 3, 'caja'],
    ]);
    expect(pastedBaseQty(r.lines[0]!, elmio)).toBe(24);
  });
});
