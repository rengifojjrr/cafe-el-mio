// En espera, como el programa de café (docs/CAFE-EN-ESPERA.md): no corre con el de Tabaco.
// Cuando se active el café, se corre contra su propia compilación (ver ese documento).
import { expect, test } from '@playwright/test';
import type { Arrival } from '../../../src/data/types';
import { buildLine } from '../../../src/seed';
import { enterAs, go, toast } from '../helpers';

test('un tostado de café se abre y se recibe como antes, sin lista de empaque', async ({ page }) => {
  const roast = (buildLine('cafe', new Date()).arrivals as Arrival[]).find((x) => x.status !== 'recibida')!;
  await enterAs(page, 'cafe:admin');
  await go(page, `/cafe/almacen/llegadas/${roast.id}`);
  await expect(page.getByRole('heading', { name: roast.code, level: 1 })).toBeVisible();
  await expect(page.getByText('Lista de empaque')).toHaveCount(0);
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(w.scroll).toBeLessThanOrEqual(w.client + 1);
  await go(page, '/cafe/almacen?tab=llegadas');
  await page.getByRole('listitem', { name: `Importación ${roast.code}` }).getByRole('button', { name: 'Recibir en almacén' }).click();
  await toast(page, new RegExp(`${roast.code} recibida`));
});
