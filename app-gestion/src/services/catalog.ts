// Catálogo de la línea. Los costos solo los ve administración: para los demás roles
// el campo ni siquiera viaja en el objeto.
import { z } from 'zod';
import type { CommissionRule, Photo, Product, User } from '../data/types';
import { commissionPerUnit, effectiveRule, storeEarning } from '../domain/money-rules';
import { can } from '../domain/permissions';
import { type Ctx, NotFoundError, ValidationError, audit, getSettings, guard, mutate, nowIso } from './context';
import { type StockLine, loadInventory, stockLines } from './inventory';

/** Producto tal como lo ve un rol que no es administración: sin costo. */
export type PublicProduct = Omit<Product, 'cost' | 'sampleCost'>;

export function toPublicProduct(p: Product): PublicProduct {
  const { cost: _cost, sampleCost: _sample, ...rest } = p;
  return rest;
}

export interface ProductView {
  product: Product | PublicProduct;
  stock: StockLine;
  storeEarning: number;
  /** Lo que gana el vendedor por unidad (vendedor: la suya; administración: la del producto). */
  sellerCommissionPerUnit?: number;
  sellerCommissionRule?: CommissionRule;
}

export function hasCost(p: Product | PublicProduct): p is Product {
  return 'cost' in p;
}

async function viewerSeller(ctx: Ctx): Promise<User | undefined> {
  if (ctx.actor.role !== 'seller') return undefined;
  return ctx.repo.users.get(ctx.actor.userId);
}

export async function listProducts(ctx: Ctx, opts?: { includeInactive?: boolean }): Promise<ProductView[]> {
  guard(ctx, 'product.read');
  const [snap, settings, seller] = await Promise.all([loadInventory(ctx), getSettings(ctx), viewerSeller(ctx)]);
  const lines = stockLines(snap, ctx.now(), settings.expiryWarningDays);
  const isAdmin = can(ctx.actor, 'product.readCost', ctx.line);
  const showInactive = isAdmin && opts?.includeInactive;
  return snap.products
    .filter((p) => p.active || showInactive)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((p) => toView(ctx, p, lines.get(p.id)!, isAdmin, seller));
}

function toView(ctx: Ctx, p: Product, stock: StockLine, isAdmin: boolean, seller?: User): ProductView {
  const view: ProductView = {
    product: isAdmin ? p : toPublicProduct(p),
    stock,
    storeEarning: storeEarning(p),
  };
  if (ctx.actor.role === 'seller' || isAdmin) {
    const rule = effectiveRule(p, seller);
    view.sellerCommissionRule = rule;
    view.sellerCommissionPerUnit = commissionPerUnit(rule, p.priceToStore);
  }
  return view;
}

export async function getProduct(ctx: Ctx, id: string): Promise<ProductView> {
  guard(ctx, 'product.read');
  const [snap, settings, seller] = await Promise.all([loadInventory(ctx), getSettings(ctx), viewerSeller(ctx)]);
  const p = snap.productsById.get(id);
  if (!p) throw new NotFoundError('el producto');
  const isAdmin = can(ctx.actor, 'product.readCost', ctx.line);
  if (!p.active && !isAdmin) throw new NotFoundError('el producto');
  const lines = stockLines(snap, ctx.now(), settings.expiryWarningDays);
  return toView(ctx, p, lines.get(p.id)!, isAdmin, seller);
}

const ruleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent'), value: z.number().min(0).max(50, 'La comisión no puede pasar del 50 %.') }),
  z.object({ type: z.literal('fixed'), value: z.number().min(0) }),
]);

const productSchema = z
  .object({
    id: z.string().optional(),
    sku: z.string().trim().min(3, 'El SKU tiene que tener al menos 3 caracteres.').max(24),
    name: z.string().trim().min(2, 'Escribe el nombre.').max(80),
    brandLine: z.string().trim().min(2, 'Escribe la marca o línea.').max(60),
    active: z.boolean().default(true),
    cost: z.number({ error: 'Escribe el costo.' }).nonnegative('El costo no puede ser negativo.'),
    priceToStore: z.number({ error: 'Escribe el precio al local.' }).positive('El precio al local tiene que ser mayor que cero.'),
    suggestedRetail: z.number({ error: 'Escribe el PVP sugerido.' }).positive('El PVP tiene que ser mayor que cero.'),
    sellerCommission: ruleSchema,
    lowStockThreshold: z.number().int().min(0),
    packSize: z.number().int().min(1),
    unitName: z.string().trim().min(1),
    notes: z.string().trim().max(600).default(''),
    pairing: z.string().trim().max(300).default(''),
    attrs: z.record(z.string(), z.union([z.string(), z.number()])),
  })
  .refine((p) => p.suggestedRetail >= p.priceToStore, {
    message: 'El PVP sugerido no puede ser menor que el precio al local: el local perdería en cada venta.',
    path: ['suggestedRetail'],
  });

export type ProductInput = z.input<typeof productSchema>;

export async function saveProduct(ctx: Ctx, input: ProductInput): Promise<Product> {
  guard(ctx, 'product.write');
  const data = productSchema.parse(input);
  for (const f of ctx.config.productFields) {
    if ('required' in f && f.required) {
      const v = data.attrs[f.key];
      if (v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) {
        throw new ValidationError(`Falta «${f.label}».`);
      }
    }
  }
  if (ctx.line === 'tabaco' && /cuba/i.test(String(data.attrs.originCountry ?? ''))) {
    throw new ValidationError('No se registra tabaco de origen Cuba (embargo de EE. UU.).');
  }
  return mutate(ctx, async () => {
    const all = await ctx.repo.products.all();
    if (all.some((p) => p.sku.toLowerCase() === data.sku.toLowerCase() && p.id !== data.id)) {
      throw new ValidationError(`Ya hay un producto con el SKU ${data.sku}.`);
    }
    const at = nowIso(ctx);
    const prev = data.id ? all.find((p) => p.id === data.id) : undefined;
    if (data.id && !prev) throw new NotFoundError('el producto');
    const product: Product = {
      id: prev?.id ?? ctx.newId('prd'),
      sku: data.sku,
      name: data.name,
      brandLine: data.brandLine,
      active: data.active,
      cost: data.cost,
      priceToStore: data.priceToStore,
      suggestedRetail: data.suggestedRetail,
      sellerCommission: data.sellerCommission,
      lowStockThreshold: data.lowStockThreshold,
      packSize: data.packSize,
      unitName: data.unitName,
      notes: data.notes,
      pairing: data.pairing,
      attrs: data.attrs,
      photoIds: prev?.photoIds ?? [],
      brandPhoto: prev?.brandPhoto,
      sampleCost: prev ? prev.sampleCost && prev.cost === data.cost : false,
      createdAt: prev?.createdAt ?? at,
      updatedAt: at,
    };
    await ctx.repo.products.put(product);
    await audit(ctx, prev ? 'producto.editar' : 'producto.crear', 'product', product.id, `${prev ? 'Editado' : 'Nuevo'}: ${product.name} (${product.sku})`);
    return product;
  });
}

export async function setProductActive(ctx: Ctx, id: string, active: boolean): Promise<void> {
  guard(ctx, 'product.write');
  await mutate(ctx, async () => {
    const p = await ctx.repo.products.get(id);
    if (!p) throw new NotFoundError('el producto');
    p.active = active;
    p.updatedAt = nowIso(ctx);
    await ctx.repo.products.put(p);
    await audit(ctx, active ? 'producto.activar' : 'producto.desactivar', 'product', p.id, `${p.name} ${active ? 'activo' : 'inactivo'}`);
  });
}

/** Guarda una foto (ya comprimida a WebP en el navegador) y la asocia al producto. */
export async function addProductPhoto(ctx: Ctx, productId: string, photo: Omit<Photo, 'id' | 'ownerType' | 'ownerId' | 'createdAt'>): Promise<string> {
  guard(ctx, 'product.write');
  return mutate(ctx, async () => {
    const p = await ctx.repo.products.get(productId);
    if (!p) throw new NotFoundError('el producto');
    const id = ctx.newId('pho');
    await ctx.repo.photos.put({ ...photo, id, ownerType: 'product', ownerId: productId, createdAt: nowIso(ctx) });
    p.photoIds = [id, ...p.photoIds].slice(0, 6);
    p.updatedAt = nowIso(ctx);
    await ctx.repo.products.put(p);
    await audit(ctx, 'producto.foto', 'product', p.id, `Foto nueva para ${p.name}`);
    return id;
  });
}

export async function removeProductPhoto(ctx: Ctx, productId: string, photoId: string): Promise<void> {
  guard(ctx, 'product.write');
  await mutate(ctx, async () => {
    const p = await ctx.repo.products.get(productId);
    if (!p) throw new NotFoundError('el producto');
    p.photoIds = p.photoIds.filter((id) => id !== photoId);
    await ctx.repo.products.put(p);
    await ctx.repo.photos.remove(photoId);
    await audit(ctx, 'producto.foto.quitar', 'product', p.id, `Foto quitada de ${p.name}`);
  });
}

export async function getPhoto(ctx: Ctx, photoId: string): Promise<Photo | undefined> {
  guard(ctx, 'product.read');
  return ctx.repo.photos.get(photoId);
}
