/** Ruta pública de un archivo de la marca copiado por scripts/copiar-marca.mjs. */
export function marca(file: string): string {
  return `${import.meta.env.BASE_URL}marca/${file}`;
}

/** Foto de producto de Café El Mío: versión chica para listas, grande para la ficha. */
export function brandProductPhoto(handle: string, size: 'sm' | 'lg' = 'sm'): string {
  return marca(`productos/${handle}${size === 'sm' ? '-sm' : ''}.webp`);
}

export const PUBLIC_URL = 'https://rengifojjrr.github.io/cafe-el-mio/gestion/';
