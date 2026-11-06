// Semilla de la ronda 3 (almacén): cajas con trazabilidad de importaciones pasadas (algunas ya
// entregadas a locales). Todo inventado: fábricas «(ejemplo)», torcedores y empacadores con
// nombre e inicial. Se aplica sobre las tablas que arma el simulador, sin tocar el libro.
import type { Arrival, CaseUnit, Delivery, LineId, Lot, Movement, Product } from '../data/types';
import { Balances, WAREHOUSE } from '../domain/ledger';
import { idFactory, seededRandom } from '../lib/ids';
import { addDaysToDate } from '../lib/time';
import type { SeedTables } from './engine';

const FACTORY_BY_COUNTRY: Record<string, string> = {
  Nicaragua: 'Fábrica Las Lomas, Estelí (ejemplo)',
  'República Dominicana': 'Fábrica Las Palmas, Santiago (ejemplo)',
  Honduras: 'Fábrica El Paraíso, Danlí (ejemplo)',
  'Estados Unidos': 'Taller de Miami (ejemplo)',
};
const ROLLERS = ['Ana R.', 'Luis M.', 'Carmen T.', 'José P.', 'Marta G.', 'Ramón D.'];
const PACKERS = ['Rosa E.', 'Pedro V.', 'Lidia S.'];

/** Cajas de importaciones ya recibidas: unas siguen en el almacén y otras salieron en entregas. */
function seedCases(t: SeedTables): CaseUnit[] {
  const rng = seededRandom(4207);
  const id = idFactory();
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
  const arrivals = (t.arrivals as Arrival[]).filter((a) => a.kind === 'import' && a.status === 'recibida');
  const lots = t.lots as Lot[];
  const movements = t.movements as Movement[];
  const products = new Map((t.products as Product[]).map((p) => [p.id, p]));
  const deliveries = new Map((t.deliveries as Delivery[]).map((d) => [d.id, d]));
  const balances = Balances.from(movements);
  // Lo que salió de cada lote en cada entrega.
  const outByLot = new Map<string, Map<string, number>>();
  for (const m of movements) {
    if (m.type !== 'salida_consignacion' || m.refType !== 'delivery') continue;
    const byDelivery = outByLot.get(m.lotId) ?? new Map<string, number>();
    byDelivery.set(m.refId, (byDelivery.get(m.refId) ?? 0) + m.qty);
    outByLot.set(m.lotId, byDelivery);
  }
  const cases: CaseUnit[] = [];
  for (const a of arrivals) {
    let seq = 0;
    for (const item of a.items) {
      const product = products.get(item.productId);
      const lot = lots.find((l) => l.arrivalId === a.id && l.productId === item.productId);
      if (!product || !lot) continue;
      const pack = Math.max(1, product.packSize);
      const base = {
        productId: product.id,
        arrivalId: a.id,
        factory: FACTORY_BY_COUNTRY[a.originCountry] ?? `${a.supplier}`,
        packedOn: addDaysToDate(a.eta, -25 - Math.floor(rng() * 10)),
        createdAt: a.receivedAt ?? a.createdAt,
      };
      const make = (extra: Partial<CaseUnit>): CaseUnit => {
        seq += 1;
        return {
          ...base,
          id: `t-${id('caj')}`,
          code: `C-${a.code}-${String(seq).padStart(4, '0')}`,
          baleNumber: String(1 + Math.floor(rng() * 140)),
          roller: pick(ROLLERS),
          packer: pick(PACKERS),
          ...extra,
        };
      };
      // Cajas que salieron enteras en una entrega (hasta tres entregas por lote).
      const out = [...(outByLot.get(lot.id) ?? new Map<string, number>())].filter(([, qty]) => qty >= pack).slice(0, 3);
      for (const [deliveryId, qty] of out) {
        const d = deliveries.get(deliveryId);
        if (!d) continue;
        for (let k = 0; k < Math.min(2, Math.floor(qty / pack)); k++) cases.push(make({ deliveryId, storeId: d.storeId }));
      }
      // Cajas que siguen en el almacén (sin pasar de lo que queda del lote).
      const left = Math.min(3, Math.floor(balances.qty(WAREHOUSE, product.id, lot.id) / pack));
      for (let k = 0; k < left; k++) cases.push(make({}));
    }
  }
  return cases;
}

/** Agrega lo de la ronda 3 (almacén) a las tablas de una línea. */
export function addR3Almacen(line: LineId, tables: SeedTables, _now: Date): SeedTables {
  if (line !== 'tabaco') return tables;
  return { ...tables, cases: [...((tables.cases as CaseUnit[] | undefined) ?? []), ...seedCases(tables)] };
}
