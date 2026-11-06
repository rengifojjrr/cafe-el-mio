// Recibir una importación: el detalle de una llegada con sus cajas registradas.
import type { Arrival, CaseUnit, Product } from '../data/types';
import { type Ctx, NotFoundError, guard } from './context';

export interface ArrivalDetail {
  arrival: Arrival;
  /** Productos con costo (solo administración). */
  products: Map<string, Product>;
  cases: CaseUnit[];
  /** Nombre del local al que fue cada caja entregada. */
  storeNames: Map<string, string>;
}

export async function arrivalDetail(ctx: Ctx, arrivalId: string): Promise<ArrivalDetail> {
  guard(ctx, 'product.readCost');
  const arrival = await ctx.repo.arrivals.get(arrivalId);
  if (!arrival) throw new NotFoundError('la llegada');
  const [products, cases, stores] = await Promise.all([ctx.repo.products.all(), ctx.repo.cases.where('arrivalId', arrival.id), ctx.repo.stores.all()]);
  return {
    arrival,
    products: new Map(products.map((p) => [p.id, p])),
    cases: cases.sort((a, b) => a.code.localeCompare(b.code)),
    storeNames: new Map(stores.map((s) => [s.id, s.name])),
  };
}
