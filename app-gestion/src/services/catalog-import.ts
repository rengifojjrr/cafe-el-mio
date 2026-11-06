// Importar productos desde Excel o CSV: vista previa y creación. Todo en una transacción:
// productos (con sus familias y variantes), lotes de inventario inicial y ajustes del almacén.
// Volver a importar el mismo archivo nunca duplica: busca por SKU o código de barras.
import type { Lot, Movement, Product } from '../data/types';
import { isCubanOrigin } from '../domain/compliance';
import { type ColumnMap, type ImportOptions, type ImportPlan, buildImportPlan, optionErrors, relabelFamilies } from '../domain/import-products';
import { WAREHOUSE, allocate } from '../domain/ledger';
import type { SheetTable } from '../lib/sheets';
import { toIsoDate } from '../lib/time';
import { type Ctx, ValidationError, audit, getSettings, guard, mutate, nowIso } from './context';
import { type InventorySnapshot, loadInventory } from './inventory';

export interface ImportRequest {
  table: SheetTable;
  map: ColumnMap;
  options: ImportOptions;
  fileName: string;
}

export interface ImportResult {
  importId: string;
  created: number;
  updated: number;
  skipped: number;
  /** Movimientos escritos en el libro (inventario inicial y ajustes). */
  movements: number;
}

function warehouseQtys(snap: InventorySnapshot): Map<string, number> {
  return new Map(snap.products.map((p) => [p.id, snap.balances.qty(WAREHOUSE, p.id)]));
}

function checkRequest(ctx: Ctx, req: ImportRequest): void {
  const problems = optionErrors(ctx.line, req.options, req.map);
  if (problems.length) throw new ValidationError(problems[0]!);
  if (!req.table.rows.length) throw new ValidationError('El archivo no tiene filas de productos.');
}

/** Lo que pasaría al importar (no escribe nada). */
export async function previewImport(ctx: Ctx, req: ImportRequest): Promise<ImportPlan> {
  guard(ctx, 'product.import');
  checkRequest(ctx, req);
  const snap = await loadInventory(ctx);
  return buildImportPlan(ctx.line, req.table, req.map, req.options, snap.products, warehouseQtys(snap));
}

/** Crea y actualiza los productos del archivo y deja el almacén con las cantidades del archivo. */
export async function runImport(ctx: Ctx, req: ImportRequest): Promise<ImportResult> {
  guard(ctx, 'product.import');
  checkRequest(ctx, req);
  return mutate(ctx, async () => {
    // El plan se vuelve a armar aquí, con lo que hay ahora en la base: la vista previa es solo para mirar.
    const [snap, settings] = await Promise.all([loadInventory(ctx), getSettings(ctx)]);
    const plan = buildImportPlan(ctx.line, req.table, req.map, req.options, snap.products, warehouseQtys(snap));
    const rows = plan.rows.filter((r) => r.status !== 'error');
    if (!rows.length) throw new ValidationError('No hay filas para crear: revisa los errores de la vista previa.');
    const at = nowIso(ctx);
    const importId = ctx.newId('imp');
    const byId = new Map(snap.products.map((p) => [p.id, p]));
    const families = new Set<string>();
    const written: { row: (typeof rows)[number]; id: string }[] = [];

    for (const row of rows) {
      const prev = row.existingId ? byId.get(row.existingId) : undefined;
      const attrs = { ...(prev?.attrs ?? {}), ...row.attrs };
      // Lo que salió de las opciones (procedencia, fortaleza…) no pisa lo que ya tenía el producto.
      if (prev) for (const key of row.defaultedAttrs) if (prev.attrs[key] !== undefined && prev.attrs[key] !== '') attrs[key] = prev.attrs[key]!;
      if (ctx.line === 'tabaco' && isCubanOrigin(String(attrs.originCountry ?? ''))) {
        throw new ValidationError(`${row.name}: no se registra tabaco de origen Cuba (embargo de EE. UU.).`);
      }
      const product: Product = {
        id: prev?.id ?? ctx.newId('prd'),
        sku: row.sku,
        name: row.name,
        brandLine: row.brandLine,
        active: prev?.active ?? true,
        cost: row.cost,
        priceToStore: row.priceToStore,
        suggestedRetail: row.suggestedRetail,
        sellerCommission: prev?.sellerCommission ?? settings.defaultSellerCommission,
        lowStockThreshold: prev?.lowStockThreshold ?? settings.defaultLowStock,
        packSize: row.packSize,
        unitName: row.unitName,
        notes: prev?.notes ?? '',
        pairing: prev?.pairing ?? '',
        attrs,
        photoIds: prev?.photoIds ?? [],
        kind: row.kind,
        familyId: row.familyId,
        familyName: row.familyName,
        variantLabel: row.variantLabel,
        barcode: row.barcode ?? prev?.barcode,
        boxPrice: prev?.boxPrice,
        brandPhoto: prev?.brandPhoto,
        // Sin costo en el archivo: queda «de ejemplo» hasta que alguien lo ponga.
        sampleCost: row.costFromFile ? false : (prev?.sampleCost ?? true),
        createdAt: prev?.createdAt ?? at,
        updatedAt: at,
      };
      if (prev?.familyId) families.add(prev.familyId);
      families.add(product.familyId!);
      byId.set(product.id, product);
      written.push({ row, id: product.id });
    }

    // Familias y variantes con las mismas reglas que al guardar un producto (también las hermanas que ya estaban).
    const toPut = new Map(written.map((w) => [w.id, byId.get(w.id)!]));
    for (const p of relabelFamilies(ctx.line, [...byId.values()], families, at)) {
      byId.set(p.id, p);
      toPut.set(p.id, p);
    }
    await ctx.repo.products.bulkPut([...toPut.values()]);

    // Almacén: la cantidad del archivo reemplaza la que hay (nunca deja saldo negativo).
    const withHistory = new Set(snap.movements.map((m) => m.productId));
    const lotPrefix = `INI-${toIsoDate(ctx.now()).replace(/-/g, '')}`;
    let lotSeq = snap.lots.filter((l) => l.code.startsWith(lotPrefix)).length;
    const lots: Lot[] = [];
    const movements: Movement[] = [];
    const move = (m: Omit<Movement, 'id' | 'at' | 'storeId' | 'refType' | 'refId' | 'actorId'>) =>
      movements.push({ ...m, id: ctx.newId('mov'), at, storeId: null, refType: 'import', refId: importId, actorId: ctx.actor.userId });
    const newLot = (product: Product): Lot => {
      lotSeq += 1;
      const lot: Lot = { id: ctx.newId('lot'), productId: product.id, code: `${lotPrefix}-${String(lotSeq).padStart(3, '0')}`, arrivalId: null, unitCost: product.cost, receivedAt: at };
      lots.push(lot);
      return lot;
    };
    const reason = `La cantidad de «${req.fileName}» reemplaza la del almacén.`;
    for (const { row, id } of written) {
      if (row.qty === null) continue;
      const product = byId.get(id)!;
      const current = snap.balances.qty(WAREHOUSE, id);
      const diff = row.qty - current;
      if (diff === 0) continue;
      if (!withHistory.has(id) && diff > 0) {
        move({ type: 'inventario_inicial', productId: id, lotId: newLot(product).id, qty: diff, from: { kind: 'supplier' }, to: WAREHOUSE, reason: `Inventario inicial importado de «${req.fileName}».` });
      } else if (diff > 0) {
        const last = snap.lots.filter((l) => l.productId === id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0] ?? newLot(product);
        move({ type: 'ajuste', productId: id, lotId: last.id, qty: diff, from: { kind: 'adjustment' }, to: WAREHOUSE, reason });
      } else {
        for (const part of allocate(snap.balances, snap.lotsById, WAREHOUSE, id, -diff, product.name)) {
          move({ type: 'ajuste', productId: id, lotId: part.lotId, qty: part.qty, from: WAREHOUSE, to: { kind: 'adjustment' }, reason });
        }
      }
    }
    if (lots.length) await ctx.repo.lots.bulkPut(lots);
    if (movements.length) await ctx.repo.movements.bulkPut(movements);

    const created = written.filter((w) => w.row.status === 'nuevo').length;
    const updated = written.length - created;
    const skipped = plan.rows.length - written.length;
    await audit(
      ctx,
      'productos.importar',
      'product',
      importId,
      `Importó «${req.fileName}»: ${created} ${created === 1 ? 'producto nuevo' : 'productos nuevos'}, ${updated} ${updated === 1 ? 'actualizado' : 'actualizados'}` +
        `${skipped ? `, ${skipped} ${skipped === 1 ? 'fila con errores no se cargó' : 'filas con errores no se cargaron'}` : ''}` +
        `${movements.length ? `; ${movements.length} ${movements.length === 1 ? 'movimiento' : 'movimientos'} en el almacén` : ''}.`,
    );
    return { importId, created, updated, skipped, movements: movements.length };
  });
}
