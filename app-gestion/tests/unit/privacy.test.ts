// Cada rol ve en el catálogo solo la consignación que le corresponde, y lo que debe un local
// incluye lo vendido que todavía no se liquidó.
import { beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../../src/data/types';
import { openCoreRepo, openLineRepo } from '../../src/data/local/dexie';
import type { LineRepo } from '../../src/data/repo';
import type { Actor } from '../../src/domain/permissions';
import { seedEverything } from '../../src/seed';
import { getProduct, listProducts } from '../../src/services/catalog';
import { reportSales } from '../../src/services/consignment';
import { lineCtx } from '../../src/services/context';
import { storeDebt } from '../../src/services/stores';

const NOW = new Date('2026-11-05T15:00:00Z');
const P = 'pruebas-privacidad-';
let repo: LineRepo;
let users: User[];

const actorOf = (u: User): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco', storeId: u.storeId, name: u.name, readOnly: false });
const ctxOf = (u: User) => lineCtx('tabaco', actorOf(u), { repo, now: () => NOW });

beforeAll(async () => {
  const repos = { tabaco: openLineRepo('tabaco', P), cafe: openLineRepo('cafe', P) };
  await seedEverything(openCoreRepo(P), repos, NOW);
  repo = repos.tabaco;
  users = await repo.users.all();
});

describe('consignación visible por rol', () => {
  it('el local solo ve lo que tiene él; administración ve el total', async () => {
    const admin = users.find((u) => u.role === 'admin')!;
    const store = users.find((u) => u.role === 'store' && u.name === 'Osvaldo Pérez')!;
    const all = await listProducts(ctxOf(admin));
    const mine = await listProducts(ctxOf(store));
    for (const v of mine) {
      const total = all.find((a) => a.product.id === v.product.id)!;
      expect(v.stock.storesHolding).toBeLessThanOrEqual(1);
      expect(v.stock.consignment).toBeLessThanOrEqual(total.stock.consignment);
    }
    const robusto = all.find((v) => v.product.name === 'Biscayne Robusto')!;
    expect(robusto.stock.storesHolding).toBeGreaterThan(1);
    const own = await getProduct(ctxOf(store), robusto.product.id);
    expect(own.stock.storesHolding).toBeLessThanOrEqual(1);
    expect(own.stock.consignment).toBeLessThan(robusto.stock.consignment);
  });

  it('el vendedor ve la consignación de sus locales, no la de otros vendedores', async () => {
    const admin = users.find((u) => u.role === 'admin')!;
    const seller = users.find((u) => u.name === 'Andrés Molina')!;
    const all = await listProducts(ctxOf(admin));
    const his = await listProducts(ctxOf(seller));
    const total = (list: typeof all) => list.reduce((a, v) => a + v.stock.consignment, 0);
    expect(total(his)).toBeLessThan(total(all));
  });
});

describe('lo que debe un local', () => {
  it('suma lo vendido sin liquidar a lo liquidado sin pagar', async () => {
    const store = users.find((u) => u.role === 'store' && u.name === 'Osvaldo Pérez')!;
    const ctx = ctxOf(store);
    const before = await storeDebt(ctx, store.storeId!);
    expect(before.total).toBeCloseTo(before.settled + before.unsettled, 2);
    const robusto = (await listProducts(ctx)).find((v) => v.product.name === 'Biscayne Robusto')!;
    await reportSales(ctx, { storeId: store.storeId!, items: [{ productId: robusto.product.id, qty: 2 }] });
    const after = await storeDebt(ctx, store.storeId!);
    expect(after.unsettled).toBeCloseTo(before.unsettled + 2 * robusto.product.priceToStore, 2);
    expect(after.total).toBeCloseTo(before.total + 2 * robusto.product.priceToStore, 2);
  });
});
