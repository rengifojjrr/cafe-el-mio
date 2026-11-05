// Fotos subidas desde el teléfono: se comprimen en el navegador a WebP de 1600 px como máximo.
// Safari viejo no codifica WebP en canvas: en ese caso se usa JPEG.
import type { Photo } from '../data/types';

export type NewPhoto = Omit<Photo, 'id' | 'ownerType' | 'ownerId' | 'createdAt'>;

export async function compressImage(file: Blob, max = 1600, quality = 0.82): Promise<NewPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no pudo procesar la foto.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const toBlob = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
  let blob = await toBlob('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
  if (!blob) throw new Error('No se pudo comprimir la foto.');
  return { blob, mime: blob.type, width, height };
}

const urls = new Map<string, string>();

/** URL de objeto para mostrar un Blob guardado (se reutiliza por id). */
export function photoUrl(id: string, blob: Blob): string {
  const cached = urls.get(id);
  if (cached) return cached;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}
