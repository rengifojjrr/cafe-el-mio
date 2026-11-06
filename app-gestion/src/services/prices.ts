// Listas de precios («Público (PVP)», «Local», «Mayorista» y las que se creen) y lo que paga cada
// local. Las listas llevan precios sobre el costo: las ve y las cambia solo administración. El local,
// su vendedor y administración ven el precio que le toca a ese local, nunca el costo.
import { z } from 'zod';
import type { LineSettings, PriceEntry, PriceList, Product, SaleMode, Store } from '../data/types';
import { PRICE_LIST_KIND_LABEL, type PriceSource, priceFor } from '../domain/pricing';
import { round2 } from '../lib/money';
import { type Ctx, NotFoundError, ValidationError, audit, getSettings, guard, mutate, nowIso } from './context';
import { loadStoreForActor } from './stores';

/**
 * La lista de un local: la suya (si sigue activa), la de la línea para los locales sin lista, la
 * «Local» o ninguna (entonces paga el precio al local de cada producto).
 */
export function resolveList(store: Pick<Store, 'priceListId'> | undefined, lists: readonly PriceList[], settings: Pick<LineSettings, 'defaultPriceListId'>): PriceList | undefined {
  const active = lists.filter((l) => l.active);
  const byId = (id?: string) => (id ? active.find((l) => l.id === id) : undefined);
  return byId(store?.priceListId) ?? byId(settings.defaultPriceListId) ?? active.find((l) => l.kind === 'local');
}

/** La lista de un local, leída de la base. Uso interno de los servicios. */
export async function storeList(ctx: Ctx, store: Pick<Store, 'priceListId'> | undefined, settings?: LineSettings): Promise<PriceList | undefined> {
  const [lists, s] = await Promise.all([ctx.repo.priceLists.all(), settings ? Promise.resolve(settings) : getSettings(ctx)]);
  return resolveList(store, lists, s);
}

export interface StorePriceRow {
  /** Por mazo, tabaco o unidad. */
  unit: number;
  /** Por caja (sin el precio de volumen). */
  box: number;
  /** Desde N cajas, precio por caja. */
  volume?: { minBoxes: number; box: number };
  source: PriceSource;
}

export interface StorePrices {
  storeId: string;
  saleMode: SaleMode;
  listId?: string;
  listName: string;
  prices: Record<string, StorePriceRow>;
}

export function computeStorePrices(store: Pick<Store, 'id' | 'saleMode'>, products: readonly Product[], list: PriceList | undefined): StorePrices {
  const prices: Record<string, StorePriceRow> = {};
  for (const p of products) {
    const q = priceFor(p, list);
    const v = list?.entries[p.id]?.volume;
    prices[p.id] = { unit: q.unit, box: q.box, source: q.source, volume: v && v.box > 0 && v.minBoxes > 1 ? { minBoxes: v.minBoxes, box: v.box } : undefined };
  }
  return { storeId: store.id, saleMode: store.saleMode ?? 'consignacion', listId: list?.id, listName: list?.name ?? 'Precio al local', prices };
}

/** Lo que paga un local por cada producto en una venta en firme. Para el local, su vendedor y administración. */
export async function storePrices(ctx: Ctx, storeId: string): Promise<StorePrices> {
  const store = await loadStoreForActor(ctx, storeId);
  const [products, settings] = await Promise.all([ctx.repo.products.all(), getSettings(ctx)]);
  const list = await storeList(ctx, store, settings);
  return computeStorePrices(store, products, list);
}

// ---------- Administración de las listas ----------

export interface PriceListView extends PriceList {
  /** Locales que la usan (por tenerla asignada o por ser la de la línea). */
  stores: number;
  isDefault: boolean;
  entriesCount: number;
}

export async function listPriceLists(ctx: Ctx): Promise<PriceListView[]> {
  guard(ctx, 'pricelist.read');
  const [lists, stores, settings] = await Promise.all([ctx.repo.priceLists.all(), ctx.repo.stores.all(), getSettings(ctx)]);
  const def = resolveList(undefined, lists, settings);
  const order: Record<PriceList['kind'], number> = { pvp: 0, local: 1, mayorista: 2, otra: 3 };
  return lists
    .map((l) => ({
      ...l,
      isDefault: def?.id === l.id,
      entriesCount: Object.keys(l.entries).length,
      stores: stores.filter((s) => s.status !== 'cerrado' && resolveList(s, lists, settings)?.id === l.id).length,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, 'es'));
}

/** Opciones para elegir la lista de un local (administración). */
export async function priceListOptions(ctx: Ctx): Promise<{ id: string; name: string; isDefault: boolean }[]> {
  return (await listPriceLists(ctx)).filter((l) => l.active).map((l) => ({ id: l.id, name: l.name, isDefault: l.isDefault }));
}

const listSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, 'Escribe el nombre de la lista.').max(40),
  kind: z.enum(['pvp', 'local', 'mayorista', 'otra']),
  defaultMarkupPercent: z.number().min(0, 'El % sobre el costo no puede ser negativo.').max(1000).optional(),
  active: z.boolean().default(true),
});

export async function savePriceList(ctx: Ctx, input: z.input<typeof listSchema>): Promise<PriceList> {
  guard(ctx, 'pricelist.manage');
  const data = listSchema.parse(input);
  return mutate(ctx, async () => {
    const all = await ctx.repo.priceLists.all();
    if (all.some((l) => l.id !== data.id && l.name.toLowerCase() === data.name.toLowerCase())) throw new ValidationError(`Ya hay una lista que se llama «${data.name}».`);
    const prev = data.id ? all.find((l) => l.id === data.id) : undefined;
    if (data.id && !prev) throw new NotFoundError('la lista de precios');
    const settings = await getSettings(ctx);
    if (prev && !data.active && resolveList(undefined, all, settings)?.id === prev.id) {
      throw new ValidationError('Esa es la lista de los locales sin lista propia. Elige otra en Ajustes antes de desactivarla.');
    }
    const at = nowIso(ctx);
    const list: PriceList = {
      id: prev?.id ?? ctx.newId('lpr'),
      name: data.name,
      kind: data.kind,
      defaultMarkupPercent: data.defaultMarkupPercent,
      entries: prev?.entries ?? {},
      active: data.active,
      createdAt: prev?.createdAt ?? at,
      updatedAt: at,
    };
    await ctx.repo.priceLists.put(list);
    await audit(ctx, prev ? 'lista_precios.editar' : 'lista_precios.crear', 'priceList', list.id, `${prev ? 'Lista editada' : 'Lista nueva'}: ${list.name} (${PRICE_LIST_KIND_LABEL[list.kind]})`);
    return list;
  });
}

const entrySchema = z
  .object({
    mode: z.enum(['fixed', 'markup']),
    unit: z.number().positive('El precio tiene que ser mayor que cero.').optional(),
    box: z.number().positive('El precio por caja tiene que ser mayor que cero.').optional(),
    markupPercent: z.number().min(0, 'El % sobre el costo no puede ser negativo.').max(1000).optional(),
    volume: z
      .object({
        minBoxes: z.number().int('Las cajas son un número entero.').min(2, 'El precio por volumen es desde 2 cajas.'),
        box: z.number().positive('Escribe el precio por caja con volumen.'),
      })
      .optional(),
  })
  .refine((e) => (e.mode === 'markup' ? e.markupPercent !== undefined : e.unit !== undefined || e.box !== undefined), {
    message: 'Escribe el precio (por unidad o por caja) o el % sobre el costo.',
  });

/** Pone (o quita, con `null`) el precio de un producto en una lista. */
export async function setPriceEntry(ctx: Ctx, listId: string, productId: string, input: z.input<typeof entrySchema> | null): Promise<PriceList> {
  guard(ctx, 'pricelist.manage');
  const entry = input ? entrySchema.parse(input) : null;
  return mutate(ctx, async () => {
    const list = await ctx.repo.priceLists.get(listId);
    if (!list) throw new NotFoundError('la lista de precios');
    const p = await ctx.repo.products.get(productId);
    if (!p) throw new NotFoundError('el producto');
    const entries = { ...list.entries };
    if (entry) {
      const clean: PriceEntry =
        entry.mode === 'markup'
          ? { mode: 'markup', markupPercent: entry.markupPercent, box: entry.box ? round2(entry.box) : undefined, volume: entry.volume }
          : { mode: 'fixed', unit: entry.unit ? round2(entry.unit) : undefined, box: entry.box ? round2(entry.box) : undefined, volume: entry.volume };
      entries[productId] = JSON.parse(JSON.stringify(clean)) as PriceEntry;
    } else delete entries[productId];
    const next: PriceList = { ...list, entries, updatedAt: nowIso(ctx) };
    await ctx.repo.priceLists.put(next);
    const q = priceFor(p, next);
    await audit(ctx, 'lista_precios.precio', 'priceList', list.id, `${list.name} · ${p.name}: ${entry ? `${q.unit.toFixed(2)} por unidad, ${q.box.toFixed(2)} por caja` : 'vuelve al precio de la lista'}`);
    return next;
  });
}

export interface PriceRow {
  product: Product;
  entry?: PriceEntry;
  unit: number;
  box: number;
  source: PriceSource;
  /** Margen sobre el precio por unidad (precio − costo) / precio. */
  margin: number;
}

/** Cada producto con su precio en la lista (administración: con costo y margen). */
export async function priceListRows(ctx: Ctx, listId: string): Promise<PriceRow[]> {
  guard(ctx, 'pricelist.read');
  const [list, products] = await Promise.all([ctx.repo.priceLists.get(listId), ctx.repo.products.all()]);
  if (!list) throw new NotFoundError('la lista de precios');
  return products
    .filter((p) => p.active)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((p) => {
      const q = priceFor(p, list);
      return { product: p, entry: list.entries[p.id], unit: q.unit, box: q.box, source: q.source, margin: q.unit > 0 ? (q.unit - p.cost) / q.unit : 0 };
    });
}

const firmSettingsSchema = z.object({
  salesTaxPercent: z.number().min(0, 'El impuesto no puede ser negativo.').max(20, 'Revisa el %: es muy alto.').optional(),
  defaultPriceListId: z.string().optional(),
});

/** Ajustes de la venta en firme: % de impuesto de venta y lista de los locales sin lista propia. */
export async function saveFirmSettings(ctx: Ctx, input: z.input<typeof firmSettingsSchema>): Promise<LineSettings> {
  guard(ctx, 'settings.manage');
  const data = firmSettingsSchema.parse(input);
  return mutate(ctx, async () => {
    const prev = await getSettings(ctx);
    if (data.defaultPriceListId) {
      const l = await ctx.repo.priceLists.get(data.defaultPriceListId);
      if (!l || !l.active) throw new ValidationError('Elige una lista de precios activa.');
    }
    const next: LineSettings = { ...prev, salesTaxPercent: data.salesTaxPercent || undefined, defaultPriceListId: data.defaultPriceListId || undefined };
    await ctx.repo.settings.put(next);
    await audit(ctx, 'ajustes.venta_firme', 'settings', next.id, `Venta en firme: impuesto ${next.salesTaxPercent ? `${next.salesTaxPercent} %` : 'sin calcular'}`);
    return next;
  });
}
