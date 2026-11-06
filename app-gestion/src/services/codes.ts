// Buscar por código: un código de barras o SKU (producto), o el número propio de una caja (trazabilidad).
import type { CaseUnit } from '../data/types';
import { can } from '../domain/permissions';
import { cleanCode } from '../lib/barcode';
import { type PublicProduct, toPublicProduct } from './catalog';
import { type Ctx, guard } from './context';
import type { Product } from '../data/types';

export type CodeMatch =
  | { kind: 'product'; code: string; product: Product | PublicProduct; by: 'barcode' | 'sku' }
  | { kind: 'case'; code: string; caseUnit: CaseUnit; product?: Product | PublicProduct }
  | { kind: 'none'; code: string };

/** Busca un código. Los demás roles reciben el producto sin costo. */
export async function findByCode(ctx: Ctx, raw: string): Promise<CodeMatch> {
  guard(ctx, 'product.read');
  const code = cleanCode(raw);
  if (!code) return { kind: 'none', code };
  const showCost = can(ctx.actor, 'product.readCost', ctx.line);
  const view = (p: Product) => (showCost ? p : toPublicProduct(p));
  const byBarcode = await ctx.repo.products.where('barcode', code);
  if (byBarcode[0]) return { kind: 'product', code, product: view(byBarcode[0]), by: 'barcode' };
  const all = await ctx.repo.products.all();
  const bySku = all.find((p) => p.sku.toUpperCase() === code || (p.barcode ?? '').toUpperCase() === code);
  if (bySku) return { kind: 'product', code, product: view(bySku), by: bySku.barcode?.toUpperCase() === code ? 'barcode' : 'sku' };
  const cases = await ctx.repo.cases.where('code', code);
  if (cases[0]) {
    const p = await ctx.repo.products.get(cases[0].productId);
    return { kind: 'case', code, caseUnit: cases[0], product: p ? view(p) : undefined };
  }
  return { kind: 'none', code };
}
