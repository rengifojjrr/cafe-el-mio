// La comisión por diferencia: el vendedor le pone a su local su precio (nunca menos que el precio
// base) y la cuenta del local ve ESE precio, nunca el base.
import { expect, test } from '@playwright/test';
import { enterAs, go, toast } from './helpers';

const dinero = (t: string) => Number(t.replace(/[^0-9.]/g, ''));

test('el vendedor le pone precio a su local; el local ve su precio y no el base', async ({ page }) => {
  await enterAs(page, 'tabaco:seller');
  await go(page, '/tabaco/locales/t-loc_0001');
  await expect(page.getByRole('heading', { level: 1, name: 'Tabaquería El Faro' })).toBeVisible();
  const tarjeta = page.getByRole('region', { name: 'Precios de este local' });
  await expect(tarjeta.getByText('Paga el precio base de cada producto.')).toBeVisible();
  await tarjeta.getByRole('button', { name: 'Ponerle precios' }).click();

  const hoja = page.getByRole('dialog', { name: 'Precios de Tabaquería El Faro' });
  await hoja.getByLabel('Buscar producto').fill('biscayne robusto');
  const campo = hoja.getByLabel('Precio de Biscayne Robusto', { exact: true });
  const fila = hoja.getByRole('listitem').filter({ has: page.getByLabel('Precio de Biscayne Robusto', { exact: true }) });
  const base = dinero((await fila.getByText(/^Base \$/).innerText()).replace(/ por .*/, ''));
  expect(base).toBeGreaterThan(0);

  // Menos que el base: no se puede guardar.
  await campo.fill(String(base - 1));
  await expect(fila.getByText(/Menor que el base/)).toBeVisible();
  await expect(hoja.getByRole('button', { name: /^Guardar/ })).toBeDisabled();

  // Más que el PVP sugerido: se avisa (el local perdería al PVP), pero no se prohíbe.
  await campo.fill('99');
  await expect(fila.getByText(/Más que el PVP sugerido/)).toBeVisible();
  await expect(hoja.getByRole('button', { name: 'Guardar 1 precio' })).toBeEnabled();

  // Dos dólares por encima del base: se ve la diferencia y se guarda.
  await campo.fill((base + 2).toFixed(2));
  await expect(fila.getByText(/\$2\.00 por tabaco/)).toBeVisible();
  await expect(fila.getByText(/Más que el PVP sugerido/)).toHaveCount(0);
  await hoja.getByRole('button', { name: 'Guardar 1 precio' }).click();
  await toast(page, 'Precio guardado.');
  await expect(tarjeta.getByText(/^1 producto tiene precio propio/)).toBeVisible();
  await expect(tarjeta.getByRole('list', { name: 'Precios propios' })).toContainText('Biscayne Robusto');

  // El local ve lo que paga (su precio) y no el base.
  await enterAs(page, 'tabaco:store');
  await go(page, '/tabaco/catalogo/t-prd_0001');
  await expect(page.getByRole('heading', { level: 1, name: 'Biscayne Robusto' })).toBeVisible();
  const pagas = page.getByText('Pagas', { exact: true });
  await expect(pagas).toBeVisible();
  expect(dinero(await pagas.locator('xpath=following-sibling::dd[1]').innerText())).toBeCloseTo(base + 2, 2);
  await expect(page.getByText('Precio base', { exact: true })).toHaveCount(0);
});
