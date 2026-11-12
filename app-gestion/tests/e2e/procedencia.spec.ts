// Ronda 4: un producto se guarda sin procedencia ni región. En la ficha sale «—» y en el catálogo
// se puede filtrar por «Sin procedencia». Cuba sigue rechazada (prueba aparte en catalogo y datos-reales).
import { expect, test } from '@playwright/test';
import { enterAs, go, toast } from './helpers';

test('nuevo producto sin procedencia ni región: se guarda, sale con «—» y se filtra por «Sin procedencia»', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/catalogo/nuevo');
  await page.getByRole('button', { name: /De mazo/ }).click();
  await page.getByLabel('Vitola', { exact: true }).fill('Lancero');
  await page.getByLabel('Largo (pulgadas)').fill('7.5');
  await page.getByLabel('Cepo (/64″)').fill('38');
  await page.getByLabel('Capa', { exact: true }).selectOption('habano');
  await page.getByLabel('Fortaleza').selectOption('media');
  // Procedencia y Región quedan en blanco.
  await expect(page.getByLabel('Procedencia')).toHaveValue('');
  await expect(page.getByLabel('Región')).toHaveValue('');
  await page.getByLabel('Precio al local por mazo').fill('20');
  await page.getByLabel('PVP sugerido por mazo').fill('35');
  await page.getByLabel('Costo por mazo (USD)').fill('8');
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await toast(page, /Producto creado/);
  await expect(page.getByRole('heading', { level: 1, name: /^Lancero/ })).toBeVisible();
  const procedencia = page.locator('dt', { hasText: /^Procedencia$/ }).locator('xpath=following-sibling::dd[1]');
  await expect(procedencia).toHaveText('—');

  // En el catálogo: aparece, sin «undefined», y con el filtro «Sin procedencia».
  await go(page, '/tabaco/catalogo');
  await page.getByLabel('Buscar en el catálogo').fill('lancero');
  const card = page.getByRole('link', { name: /^Ver Lancero/ }).first();
  await expect(card).toBeVisible();
  await expect(page.getByText(/undefined/)).toHaveCount(0);
  await page.getByLabel('Buscar en el catálogo').fill('');
  await page.getByRole('button', { name: 'Más filtros' }).click();
  const panel = page.getByRole('group', { name: 'Más filtros del catálogo' });
  const sin = panel.getByRole('button', { name: /^Sin procedencia/ });
  await expect(sin).toBeVisible();
  await sin.click();
  await expect(sin).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: /^Ver Lancero/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /^Ver Biscayne/ })).toHaveCount(0);
});
