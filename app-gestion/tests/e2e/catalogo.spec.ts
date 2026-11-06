// Catálogo de la ronda 3: familias con sus capas, filtros de un toque que se recuerdan,
// volver sin perder el punto, la ficha con sus variantes y el 3D, el comparador y el alta de mazo.
import { expect, test } from '@playwright/test';
import { enterAs, go, toast } from './helpers';

test('filtros de un toque: de mazo y maduro, con el número de resultados, y se recuerdan', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/catalogo');
  const results = page.getByTestId('resultados');
  await expect(results).toContainText('21 productos en 16 familias');
  await page.getByRole('button', { name: /^Tipo: De mazo/ }).click();
  await expect(results).toContainText('9 productos en 4 familias');
  await page.getByRole('button', { name: /^Capa: Maduro/ }).click();
  // Cada familia trae un solo maduro: no se repite «en 3 familias».
  await expect(results).toContainText('3 productos con estos filtros');
  // La capa, la fortaleza y la procedencia se ven en la tarjeta, sin entrar a la ficha.
  const card = page.getByRole('listitem').filter({ hasText: 'Toro 6 × 52' });
  await expect(card.getByRole('link', { name: 'Maduro' })).toBeVisible();
  await expect(card).toContainText('Fortaleza fuerte');
  await expect(card).toContainText('Nicaragua');
  // Al volver a abrir el catálogo, los filtros siguen puestos para esta persona.
  await page.reload();
  await expect(results).toContainText('3 productos con estos filtros');
  await page.getByRole('button', { name: /^Quitar \(2\)/ }).click();
  await expect(results).toContainText('21 productos en 16 familias');
});

test('buscar «toro» trae sus variantes y volver de una ficha deja la lista donde estaba', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/catalogo');
  await page.getByLabel('Buscar en el catálogo').fill('toro');
  const toro = page.getByRole('listitem').filter({ hasText: 'Toro 6 × 52' }).first();
  for (const capa of ['Habano', 'Maduro', 'Connecticut']) await expect(toro.getByRole('link', { name: capa })).toBeVisible();
  await page.getByLabel('Buscar en el catálogo').fill('');
  await page.getByRole('button', { name: /^Tipo: De mazo/ }).click();
  await page.evaluate(() => window.scrollTo({ top: 700 }));
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.scrollY);
  await page.getByRole('link', { name: /^Ver Torpedo/ }).click({ position: { x: 40, y: 24 } });
  await expect(page).toHaveURL(/catalogo\/t-prd_/);
  await page.goBack();
  await expect(page.getByRole('button', { name: /^Tipo: De mazo/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 60);
});

test('la ficha cambia de capa sin volver a la lista y enseña el tabaco en 3D', async ({ page }) => {
  await enterAs(page, 'tabaco:seller');
  await go(page, '/tabaco/catalogo');
  await page.getByLabel('Buscar en el catálogo').fill('toro maduro');
  await page.getByRole('listitem').filter({ hasText: 'Toro 6 × 52' }).getByRole('link', { name: 'Maduro' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Toro 6 × 52' })).toBeVisible();
  const capas = page.getByRole('region', { name: /Presentación de/ });
  await capas.getByRole('link', { name: 'Habano' }).click();
  await expect(capas.getByRole('link', { name: 'Habano' })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText('Mazo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ver en 3D' }).click();
  await expect(page.getByRole('img', { name: /en 3D: 6 pulgadas de largo, cepo 52/ })).toBeVisible();
});

test('comparar tamaños: dos vitolas de pie, a la misma escala y con sus medidas', async ({ page }) => {
  await enterAs(page, 'tabaco:store');
  await go(page, '/tabaco/catalogo');
  await page.getByRole('link', { name: 'Comparar' }).click();
  await page.getByLabel('Buscar vitolas').fill('churchill');
  await page.getByRole('button', { name: '7 × 48' }).first().click();
  await page.getByLabel('Buscar vitolas').fill('lancero');
  await page.getByRole('button', { name: /7½ × 38/ }).first().click();
  const side = page.getByRole('region', { name: 'Tabacos lado a lado' });
  await expect(side.locator('figure')).toHaveCount(2);
  await expect(side).toContainText('178 × 19.0 mm');
  await expect(side).toContainText('191 × 15.1 mm');
  await expect(page.getByText('2 de 4')).toBeVisible();
});

test('nuevo producto de mazo: primero «¿Premium o de mazo?» y el nombre se arma solo', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/catalogo/nuevo');
  await expect(page.getByRole('heading', { name: '¿Premium o de mazo?' })).toBeVisible();
  await page.getByRole('button', { name: /De mazo/ }).click();
  // Capote y tripa solo van en premium.
  await expect(page.getByLabel('Capote')).toHaveCount(0);
  await page.getByLabel('Vitola', { exact: true }).fill('Robusto');
  await page.getByLabel('Largo (pulgadas)').fill('5');
  await page.getByLabel('Cepo (/64″)').fill('54');
  await page.getByLabel('Capa', { exact: true }).selectOption('maduro');
  await page.getByLabel('Fortaleza').selectOption('fuerte');
  await page.getByLabel('Procedencia').fill('Nicaragua');
  await expect(page.getByText('Robusto 5 × 54 · Maduro')).toBeVisible();
  await page.getByLabel('Precio al local por mazo').fill('24');
  await page.getByLabel('PVP sugerido por mazo').fill('42');
  await page.getByLabel('Costo por mazo (USD)').fill('10');
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await toast(page, /Producto creado/);
  await expect(page.getByRole('heading', { level: 1, name: 'Robusto 5 × 54' })).toBeVisible();
  await expect(page.getByText(/^Maduro · SKU TB-ROBUSTO554-MAD/)).toBeVisible();
});
