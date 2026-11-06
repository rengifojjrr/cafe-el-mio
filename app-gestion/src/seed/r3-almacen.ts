// Semilla de la ronda 3 (almacén): cajas con trazabilidad de importaciones pasadas (algunas ya
// entregadas a locales) e importaciones con lista de empaque: una en aduana, lista para
// confirmar bulto por bulto, y un contenedor grande a medio revisar. Todo inventado: fábricas
// «(ejemplo)», torcedores y empacadores con nombre e inicial. No toca el libro de movimientos.
import { DateTime } from 'luxon';
import type { Arrival, Bale, CaseUnit, Delivery, LineId, Lot, Movement, Product, User } from '../data/types';
import { Balances, WAREHOUSE } from '../domain/ledger';
import { itemsFromBales } from '../domain/receiving';
import { idFactory, seededRandom } from '../lib/ids';
import { ZONE, addDaysToDate } from '../lib/time';
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

/** Una importación con lista de empaque de los tabacos de mazo, con algunos bultos mixtos. */
function packedImport(
  t: SeedTables,
  now: Date,
  opts: { seed: number; bales: number; status: 'aduana' | 'confirmando'; etaDay: number; checked: number; history: [Arrival['status'], number][]; notes: string },
): Arrival {
  const rng = seededRandom(opts.seed);
  const id = idFactory();
  const arrivals = t.arrivals as Arrival[];
  const admin = (t.users as User[]).find((u) => u.role === 'admin')!;
  const mazo = (t.products as Product[]).filter((p) => p.kind === 'mazo' && p.active);
  const nowNy = DateTime.fromJSDate(now).setZone(ZONE);
  const day = (n: number, hour = 9) => nowNy.startOf('day').plus({ days: n }).set({ hour }).toUTC().toISO()!;
  const cost = (p: Product) => Math.round(p.cost * (0.98 + rng() * 0.04) * 100) / 100;
  const prefix = `t-arr_r3${opts.seed}`;
  const bales: Bale[] = [];
  for (let n = 1; n <= opts.bales; n++) {
    // Uno de cada cuatro bultos viene mixto (dos o tres productos); los demás, de un solo producto.
    const mixed = n % 4 === 0;
    const kinds = mixed ? 2 + Math.floor(rng() * 2) : 1;
    const start = (n * 7 + Math.floor(rng() * 3)) % mazo.length;
    const picked = Array.from({ length: kinds }, (_, k) => mazo[(start + k * 2) % mazo.length]!);
    const total = 40 + Math.floor(rng() * 16);
    const items = picked.map((p, k) => ({ productId: p.id, qty: k === kinds - 1 ? total - Math.floor(total / kinds) * (kinds - 1) : Math.floor(total / kinds), unitCost: cost(p) }));
    bales.push({ id: `${prefix}-${id('bul')}`, number: String(n), items, status: 'pendiente' });
  }
  // Los primeros bultos ya revisados: casi todos bien, alguno con falta, sobra o dañado.
  bales.slice(0, opts.checked).forEach((b, i) => {
    const counted = Object.fromEntries(b.items.map((it) => [it.productId, it.qty]));
    let status: Bale['status'] = 'bien';
    let note: string | undefined;
    if (i % 11 === 5) {
      const it = b.items[0]!;
      counted[it.productId] = it.qty - 2;
      status = 'falta';
      note = 'Faltan 2 mazos: el bulto venía con el amarre flojo.';
    } else if (i % 17 === 9) {
      const it = b.items[0]!;
      counted[it.productId] = it.qty + 1;
      status = 'sobra';
      note = 'Un mazo de más.';
    } else if (i === 20) {
      const it = b.items[0]!;
      counted[it.productId] = it.qty - 5;
      status = 'danado';
      note = 'Bulto mojado en una esquina: 5 mazos manchados, se apartaron.';
    }
    Object.assign(b, { counted, status, note, checkedAt: day(-1, 10 + Math.floor(i / 6)), checkedBy: admin.id });
  });
  const year = nowNy.plus({ days: opts.etaDay }).year;
  return {
    id: `${prefix}`,
    kind: 'import',
    code: `IMP-${year}-${String(arrivals.length + 1).padStart(3, '0')}`,
    status: opts.status,
    eta: nowNy.plus({ days: opts.etaDay }).toISODate()!,
    supplier: FACTORY_BY_COUNTRY.Nicaragua!,
    originCountry: 'Nicaragua',
    items: itemsFromBales(bales),
    bales,
    notes: opts.notes,
    createdAt: day(opts.history[0]![1]),
    statusHistory: opts.history.map(([status, d]) => ({ status, at: day(d) })),
  };
}

/** Agrega lo de la ronda 3 (almacén) a las tablas de una línea. */
export function addR3Almacen(line: LineId, tables: SeedTables, now: Date): SeedTables {
  if (line !== 'tabaco') return tables;
  const cases = seedCases(tables);
  const arrivals = [...(tables.arrivals as Arrival[])];
  const next = { ...tables, arrivals };
  // El contenedor grande que se está revisando (37 de 147 bultos) y uno chico en aduana, listo para la demo.
  arrivals.push(
    packedImport(next, now, {
      seed: 1,
      bales: 147,
      status: 'confirmando',
      etaDay: 0,
      checked: 37,
      history: [
        ['produccion', -45],
        ['transito', -21],
        ['aduana', -4],
        ['confirmando', -1],
      ],
      notes: 'Contenedor de Estelí en el almacén: se están revisando los bultos.',
    }),
  );
  arrivals.push(
    packedImport(next, now, {
      seed: 2,
      bales: 12,
      status: 'aduana',
      etaDay: 2,
      checked: 0,
      history: [
        ['produccion', -38],
        ['transito', -16],
        ['aduana', -1],
      ],
      notes: 'En aduana con su lista de empaque: al llegar se confirma bulto por bulto.',
    }),
  );
  return { ...next, cases: [...((tables.cases as CaseUnit[] | undefined) ?? []), ...cases] };
}
