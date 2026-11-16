// «Equipo»: Mercado → Zona. Un vendedor cubre varias zonas, cada zona tiene un responsable y sus
// locales se le asignan solos. Se ve por vendedor, por zona y por ciudad.
import { expect, test } from '@playwright/test';
import { enterAs, go, toast } from './helpers';

test('el equipo por vendedor, zona y ciudad; cambiar el responsable de una zona mueve sus locales', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/equipo');
  await expect(page.getByRole('heading', { level: 1, name: 'Equipo' })).toBeVisible();
  // Miami: Andrés cubre Hialeah y Doral.
  const andres = page.getByRole('listitem', { name: 'Vendedor Andrés Molina' });
  await expect(andres.getByText(/Doral/)).toBeVisible();
  await expect(andres.getByText(/Hialeah/)).toBeVisible();
  await expect(andres.getByText('Visitas en 7 días')).toBeVisible();
  const locales = async (nombre: string) => Number((await page.getByRole('listitem', { name: `Vendedor ${nombre}` }).getByText(/\d+ locales?$/).first().textContent())?.match(/(\d+) locales?$/)?.[1]);
  const andresAntes = await locales('Andrés Molina');
  const yanelisAntes = await locales('Yanelis Cruz');

  // Por zona: Doral pasa a Yanelis y sus locales con ella.
  await page.getByRole('tab', { name: /^Zonas/ }).click();
  const doral = page.getByRole('listitem', { name: 'Zona Doral' });
  await expect(doral.getByLabel('Responsable').locator('option:checked')).toHaveText('Andrés Molina');
  const enDoral = Number((await doral.getByText(/^\d+ locales?/).first().textContent())?.match(/^(\d+)/)?.[1]);
  expect(enDoral).toBeGreaterThan(0);
  await doral.getByLabel('Responsable').selectOption({ label: 'Yanelis Cruz' });
  await toast(page, /Doral: responsable cambiado/);
  await page.getByRole('tab', { name: /^Vendedores/ }).click();
  await expect(page.getByRole('listitem', { name: 'Vendedor Yanelis Cruz' }).getByText(/Doral/)).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Vendedor Andrés Molina' }).getByText(/Doral/)).toHaveCount(0);
  await expect.poll(() => locales('Andrés Molina')).toBe(andresAntes - enDoral);
  await expect.poll(() => locales('Yanelis Cruz')).toBe(yanelisAntes + enDoral);

  // Por ciudad.
  await page.getByRole('tab', { name: /^Ciudades/ }).click();
  await expect(page.getByRole('listitem', { name: 'Ciudad Hialeah' })).toContainText('Andrés Molina');

  // Houston, por separado.
  await page.getByRole('tab', { name: 'Houston' }).click();
  await page.getByRole('tab', { name: /^Vendedores/ }).click();
  await expect(page.getByRole('listitem', { name: 'Vendedor Tomás Garza' })).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Vendedor Andrés Molina' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Miami' }).click();
});

test('alta de vendedor con varias zonas: avisa qué pasa antes de guardar y sus locales se le asignan', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/usuarios');
  await page.getByRole('button', { name: 'Alta de vendedor' }).click();
  const hoja = page.getByRole('dialog', { name: 'Alta de vendedor' });
  await hoja.getByLabel('Nombre completo').fill('Vendedora de Prueba');
  await hoja.getByRole('checkbox', { name: /^Kendall/ }).check();
  await hoja.getByRole('checkbox', { name: /^Westchester/ }).check();
  const cambios = hoja.getByTestId('cambios-zonas');
  await expect(cambios).toContainText(/Kendall deja de ser de Rafael Ortega · pasan? \d+ locales?/);
  await expect(cambios).toContainText(/Westchester deja de ser de Rafael Ortega/);
  await hoja.getByRole('button', { name: 'Dar de alta' }).click();
  await toast(page, /Vendedor dado de alta/);
  // En la lista de zonas, Kendall y Westchester ya son suyas.
  await expect(page.getByRole('button', { name: /Kendall\s*Vendedora de Prueba/ })).toBeVisible();

  await go(page, '/tabaco/equipo');
  const nueva = page.getByRole('listitem', { name: 'Vendedor Vendedora de Prueba' });
  await expect(nueva.getByText(/Kendall/)).toBeVisible();
  await expect(nueva.getByText(/Westchester/)).toBeVisible();
  await expect(nueva.getByText(/^Sin zonas/)).toHaveCount(0);
  // Rafael se quedó sin zonas (y sin los locales que tenía en ellas).
  await expect(page.getByRole('listitem', { name: 'Vendedor Rafael Ortega' }).getByText(/Sin zonas/)).toBeVisible();
});

test('un local nuevo es del responsable de su zona sin elegirlo', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/locales/nuevo');
  await page.getByLabel('Zona', { exact: true }).selectOption({ label: 'Hialeah' });
  await expect(page.getByLabel('Vendedor responsable')).toHaveValue('');
  await expect(page.getByLabel('Vendedor responsable').locator('option:checked')).toHaveText('El de la zona: Andrés Molina');
});
