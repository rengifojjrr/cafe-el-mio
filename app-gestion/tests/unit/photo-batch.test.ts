// Fotos en lote: el nombre del archivo dice de qué producto es (SKU o código de barras) y en
// qué lugar va; cada producto lleva hasta 3 fotos y se pueden ordenar.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Product } from '../../src/data/types';
import { getLineRepo, setDbPrefix } from '../../src/data';
import { baseName, groupPhotoMatches, matchPhotoFiles, moveItem, photoKey } from '../../src/domain/photo-match';
import type { Actor } from '../../src/domain/permissions';
import { centerSquare } from '../../src/lib/image';
import { addProductPhotos, reorderProductPhotos } from '../../src/services/catalog';
import { ForbiddenError, ValidationError, lineCtx } from '../../src/services/context';
import { findAccount, resetDemo } from '../../src/services/session';

const products = [
  { id: 'p1', sku: 'ABC-101', barcode: '2000000010014', photoIds: [] },
  { id: 'p2', sku: 'ABC-101-2', photoIds: [] },
  { id: 'p3', sku: 'SIN-REF-6X64-BOX-PRESS', photoIds: ['vieja-1', 'vieja-2'] },
];

describe('reconocer las fotos por el nombre del archivo', () => {
  it('SKU o código de barras, sin importar mayúsculas, espacios ni la extensión', () => {
    expect(baseName('ABC-101 (2).JPG')).toBe('ABC-101 (2)');
    expect(photoKey('Sin-Ref 6x64')).toBe('sin-ref6x64');
    const r = matchPhotoFiles(
      ['ABC-101.jpg', 'abc-101-3.JPG', 'ABC-101 (2).png', 'ABC-101-2.jpg', '2000000010014.webp', 'sin-ref-6x64-box press.jpeg', 'Foto del almacén.jpg', 'ABC-999.jpg', 'ABC-101_2.heic'],
      products,
    );
    expect(r.matched).toEqual([
      { fileIndex: 0, fileName: 'ABC-101.jpg', productId: 'p1', order: 1 },
      { fileIndex: 1, fileName: 'abc-101-3.JPG', productId: 'p1', order: 3 },
      { fileIndex: 2, fileName: 'ABC-101 (2).png', productId: 'p1', order: 2 },
      // Un SKU que termina en «-2» se respeta: es otro producto.
      { fileIndex: 3, fileName: 'ABC-101-2.jpg', productId: 'p2', order: 1 },
      { fileIndex: 4, fileName: '2000000010014.webp', productId: 'p1', order: 1 },
      { fileIndex: 5, fileName: 'sin-ref-6x64-box press.jpeg', productId: 'p3', order: 1 },
      { fileIndex: 8, fileName: 'ABC-101_2.heic', productId: 'p1', order: 2 },
    ]);
    expect(r.unmatched.map((u) => u.fileName)).toEqual(['Foto del almacén.jpg', 'ABC-999.jpg']);
  });

  it('acepta espacios en lugar de guiones, salvo que dos productos se confundan', () => {
    const r = matchPhotoFiles(['ABC 101.jpg', 'ABC 101 (2).jpg', 'abc 101 3.png'], products);
    expect(r.matched.map((m) => [m.productId, m.order])).toEqual([
      ['p1', 1],
      ['p1', 2],
      ['p1', 3],
    ]);
    const twins = [
      { id: 'a', sku: 'GM-10', photoIds: [] },
      { id: 'b', sku: 'GM10', photoIds: [] },
    ];
    // Sin espacios, «GM 10» es exactamente «GM10»; «gm_10» se parece a los dos y no se adivina.
    const twinsMatch = matchPhotoFiles(['GM 10.jpg', 'gm_10.jpg', 'GM-10.jpg'], twins);
    expect(twinsMatch.matched.map((m) => m.productId)).toEqual(['b', 'a']);
    expect(twinsMatch.unmatched.map((u) => u.fileName)).toEqual(['gm_10.jpg']);
  });

  it('si dos productos tienen el mismo SKU, no adivina', () => {
    const dup = [
      { id: 'toro', sku: 'TB-MZ-TOR-MAD52', photoIds: [] },
      { id: 'torpedo', sku: 'TB-MZ-TOR-MAD52', photoIds: [] },
    ];
    const r = matchPhotoFiles(['TB-MZ-TOR-MAD52.jpg', 'tb-mz-tor-mad52-2.jpg'], dup);
    expect(r.matched).toEqual([]);
    expect(r.unmatched.map((u) => u.reason)).toEqual(['ambiguo', 'sin-producto']);
  });

  it('hasta 3 fotos por producto: las que ya tiene se conservan y las nuevas van en orden', () => {
    const r = matchPhotoFiles(['ABC-101-3.jpg', 'ABC-101.jpg', 'ABC-101 (2).jpg', 'ABC-101-4.jpg', 'SIN-REF-6X64-BOX-PRESS.jpg', 'SIN-REF-6X64-BOX-PRESS-2.jpg'], products);
    const groups = groupPhotoMatches(r.matched, products);
    const p1 = groups.find((g) => g.productId === 'p1')!;
    expect(p1.existing).toEqual([]);
    expect(p1.accepted.map((m) => m.fileName)).toEqual(['ABC-101.jpg', 'ABC-101 (2).jpg', 'ABC-101-3.jpg']);
    expect(p1.overflow.map((m) => m.fileName)).toEqual(['ABC-101-4.jpg']);
    const p3 = groups.find((g) => g.productId === 'p3')!;
    expect(p3.existing).toEqual(['vieja-1', 'vieja-2']);
    expect(p3.accepted.map((m) => m.fileName)).toEqual(['SIN-REF-6X64-BOX-PRESS.jpg']);
    expect(p3.overflow).toHaveLength(1);
  });

  it('mover y recortar al centro', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(centerSquare(4000, 3000)).toEqual({ sx: 500, sy: 0, side: 3000 });
    expect(centerSquare(3000, 4001)).toEqual({ sx: 0, sy: 500, side: 3000 });
  });
});

describe('guardar las fotos del lote y ordenarlas', () => {
  const NOW = new Date('2026-11-05T15:00:00Z');
  let product: Product;
  const photo = (n: number) => ({ photo: { blob: new Blob([new Uint8Array([n])], { type: 'image/webp' }), mime: 'image/webp', width: 10, height: 10 } });

  async function ctxFor(accountId: string, readOnly = false) {
    const acc = (await findAccount(accountId))!;
    const actor: Actor = { accountId: acc.id, userId: acc.userId, role: acc.role, line: acc.line, storeId: acc.storeId, name: acc.name, readOnly };
    return lineCtx('tabaco', actor, { repo: getLineRepo('tabaco'), now: () => NOW });
  }

  beforeAll(async () => {
    setDbPrefix('pruebas-fotos-lote-');
    await resetDemo(NOW);
    product = (await getLineRepo('tabaco').products.all()).find((p) => p.photoIds.length === 0)!;
  });

  it('agrega las nuevas en el orden pedido y conserva las que ya tenía', async () => {
    const ctx = await ctxFor('tabaco:admin');
    const first = await addProductPhotos(ctx, product.id, [photo(1), photo(2)]);
    expect(first).toHaveLength(2);
    const order = await addProductPhotos(ctx, product.id, [photo(3), { existingId: first[1]! }, { existingId: first[0]! }]);
    expect(order).toHaveLength(3);
    expect(order.slice(1)).toEqual([first[1], first[0]]);
    const saved = (await getLineRepo('tabaco').products.get(product.id))!;
    expect(saved.photoIds).toEqual(order);
    const photos = await getLineRepo('tabaco').photos.where('ownerId', product.id);
    expect(photos).toHaveLength(3);
    expect(photos.every((p) => p.ownerType === 'product')).toBe(true);
  });

  it('nunca pasa de 3 fotos (y si se rechaza, no queda nada a medias)', async () => {
    const ctx = await ctxFor('tabaco:admin');
    await expect(addProductPhotos(ctx, product.id, [photo(4)])).rejects.toThrow(ValidationError);
    expect(await getLineRepo('tabaco').photos.where('ownerId', product.id)).toHaveLength(3);
    expect((await getLineRepo('tabaco').products.get(product.id))!.photoIds).toHaveLength(3);
  });

  it('ordenar las fotos de la ficha: solo las mismas fotos, solo administración', async () => {
    const ctx = await ctxFor('tabaco:admin');
    const before = (await getLineRepo('tabaco').products.get(product.id))!.photoIds;
    const reversed = [...before].reverse();
    await reorderProductPhotos(ctx, product.id, reversed);
    expect((await getLineRepo('tabaco').products.get(product.id))!.photoIds).toEqual(reversed);
    await expect(reorderProductPhotos(ctx, product.id, reversed.slice(1))).rejects.toThrow(ValidationError);
    await expect(reorderProductPhotos(ctx, product.id, [reversed[0]!, reversed[0]!, reversed[1]!])).rejects.toThrow(ValidationError);
    await expect(reorderProductPhotos(await ctxFor('tabaco:seller'), product.id, before)).rejects.toThrow(ForbiddenError);
    await expect(reorderProductPhotos(await ctxFor('tabaco:admin', true), product.id, before)).rejects.toThrow(ForbiddenError);
    await expect(addProductPhotos(await ctxFor('tabaco:seller'), product.id, [photo(9)])).rejects.toThrow(ForbiddenError);
    const audit = await getLineRepo('tabaco').audit.all();
    expect(audit.some((a) => a.action === 'producto.fotos.lote')).toBe(true);
    expect(audit.some((a) => a.action === 'producto.fotos.orden')).toBe(true);
  });
});
