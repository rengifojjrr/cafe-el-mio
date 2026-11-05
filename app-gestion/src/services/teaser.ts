// Datos no sensibles para la portada. Vive aparte para que la portada no cargue los servicios.
import type { LineId } from '../data/types';
import { getLineRepo } from '../data';

/** Datos no sensibles para la portada (cuántos locales, productos y vendedores tiene cada línea). */
export async function lineTeaser(line: LineId): Promise<{ products: number; activeStores: number; sellers: number; pendingOrders: number } | null> {
  const repo = getLineRepo(line);
  const [products, stores, users, reorders] = await Promise.all([repo.products.all(), repo.stores.all(), repo.users.all(), repo.reorders.all()]);
  // Todavía se están cargando los datos de ejemplo.
  if (products.length === 0) return null;
  return {
    products: products.filter((p) => p.active).length,
    activeStores: stores.filter((s) => s.status === 'activo').length,
    sellers: users.filter((u) => u.role === 'seller' && u.active).length,
    pendingOrders: reorders.filter((r) => r.status === 'enviado' || r.status === 'confirmado' || r.status === 'preparado').length,
  };
}
