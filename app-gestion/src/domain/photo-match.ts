// Fotos en lote: cada archivo se reconoce por su nombre (sin la extensión, sin importar
// mayúsculas ni espacios) = SKU o código de barras del producto. «SKU-2», «SKU_3» o
// «SKU (2)» son la segunda y la tercera foto. Cada producto lleva hasta 3 fotos.

export const MAX_PRODUCT_PHOTOS = 3;

export interface PhotoTarget {
  id: string;
  sku: string;
  barcode?: string;
  photoIds: string[];
}

export interface PhotoMatch {
  fileIndex: number;
  fileName: string;
  productId: string;
  /** 1 para «SKU.jpg», 2 para «SKU-2.jpg», 3 para «SKU (3).jpg». */
  order: number;
}

export interface PhotoMatchResult {
  matched: PhotoMatch[];
  /** `ambiguo`: dos productos tienen ese SKU o código (no se adivina). */
  unmatched: { fileIndex: number; fileName: string; reason: 'sin-producto' | 'ambiguo' }[];
}

/** Nombre sin la extensión: «ABC-101 (2).JPG» → «ABC-101 (2)». */
export function baseName(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{2,5}$/i, '');
}

/** Para comparar: sin mayúsculas ni espacios. */
export function photoKey(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, '');
}

/** Más suelto: solo letras y números («ABC 101» = «ABC-101»). */
function looseKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** «SKU (2)», «SKU-2», «SKU_3» o «SKU 2» → el SKU y el lugar de la foto. */
function numbered(base: string): { stem: string; order: number } | null {
  const m = /^(.+?)\s*\((\d{1,2})\)$/.exec(base) ?? /^(.+?)[-_\s](\d{1,2})$/.exec(base);
  return m ? { stem: m[1]!.trim(), order: Math.max(1, Number(m[2])) } : null;
}

export function matchPhotoFiles(fileNames: readonly string[], products: readonly PhotoTarget[]): PhotoMatchResult {
  // null: dos productos comparten ese código (o se parecen demasiado): no se adivina.
  const exact = new Map<string, string | null>();
  const loose = new Map<string, string | null>();
  const put = (map: Map<string, string | null>, key: string, id: string) => map.set(key, map.has(key) && map.get(key) !== id ? null : id);
  for (const p of products) {
    for (const code of [p.barcode, p.sku]) {
      if (!code) continue;
      put(exact, photoKey(code), p.id);
      put(loose, looseKey(code), p.id);
    }
  }
  const byExact = (text: string) => exact.get(photoKey(text)) ?? undefined;
  const byLoose = (text: string) => loose.get(looseKey(text)) ?? undefined;
  const matched: PhotoMatch[] = [];
  const unmatched: PhotoMatchResult['unmatched'] = [];
  fileNames.forEach((fileName, fileIndex) => {
    const base = baseName(fileName).trim();
    if (exact.get(photoKey(base)) === null) {
      unmatched.push({ fileIndex, fileName, reason: 'ambiguo' });
      return;
    }
    // 1) El nombre exacto manda (un SKU puede terminar en «-2»); 2) «SKU-2»; 3) parecido («ABC 101»).
    const direct = byExact(base);
    const n = direct ? null : numbered(base);
    const viaNumber = n ? (byExact(n.stem) ?? byLoose(n.stem)) : undefined;
    const productId = direct ?? viaNumber ?? byLoose(base);
    if (productId) matched.push({ fileIndex, fileName, productId, order: !direct && viaNumber && n ? n.order : 1 });
    else unmatched.push({ fileIndex, fileName, reason: 'sin-producto' });
  });
  return { matched, unmatched };
}

export interface PhotoGroup {
  productId: string;
  /** Las que ya tiene (se conservan siempre). */
  existing: string[];
  /** Las nuevas que entran, en orden (1, 2, 3…). */
  accepted: PhotoMatch[];
  /** Las nuevas que no entran: el producto llegaría a más de 3 fotos. */
  overflow: PhotoMatch[];
}

/** Agrupa por producto: las que ya tiene van primero y las nuevas se agregan hasta llegar a 3. */
export function groupPhotoMatches(matched: readonly PhotoMatch[], products: readonly PhotoTarget[], max = MAX_PRODUCT_PHOTOS): PhotoGroup[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const groups = new Map<string, PhotoMatch[]>();
  for (const m of matched) groups.set(m.productId, [...(groups.get(m.productId) ?? []), m]);
  return [...groups].map(([productId, files]) => {
    const existing = byId.get(productId)?.photoIds ?? [];
    const sorted = [...files].sort((a, b) => a.order - b.order || a.fileName.localeCompare(b.fileName, 'es'));
    const room = Math.max(0, max - existing.length);
    return { productId, existing: [...existing], accepted: sorted.slice(0, room), overflow: sorted.slice(room) };
  });
}

/** Mueve un elemento de una lista (para ordenar fotos con «subir» y «bajar»). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
