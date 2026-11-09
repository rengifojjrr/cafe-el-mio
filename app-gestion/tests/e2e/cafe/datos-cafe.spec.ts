// En espera, como el programa de café (docs/CAFE-EN-ESPERA.md): no corre con el de Tabaco.
// Cuando se active el café, se corre contra su propia compilación (ver ese documento).
import { expect, test, type Page } from '@playwright/test';
import { enterAs, go, toast } from '../helpers';

/** En el teléfono, nada más ancho que la pantalla. */
async function fitsPhone(page: Page, project: string): Promise<void> {
  if (project !== 'telefono') return;
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(w.scroll, 'la pantalla es más ancha que el teléfono').toBeLessThanOrEqual(w.client + 1);
}

test('café: importar con los atributos de la variante (molido y peso)', async ({ page }, info) => {
  const csv = [
    'Nombre,Nombre para mostrar,Referencia interna,Precio de venta,Coste,Cantidad a mano,Valores de atributo de variante',
    'Café de Prueba Casa,"[CF-E2E-1] Café de Prueba Casa (Molido fino, 10 oz)",CF-E2E-1,4.10,2.35,24,"Molido: Molido fino, Peso: 10 oz"',
    'Café de Prueba Casa,"[CF-E2E-2] Café de Prueba Casa (En grano, 2 lb)",CF-E2E-2,14.50,8.10,6,"Molido: En grano, Peso: 2 lb"',
  ].join('\n');
  await enterAs(page, 'cafe:admin');
  await go(page, '/cafe/catalogo/importar');
  await page.getByLabel('Elegir el archivo de productos').setInputFiles({ name: 'cafe-odoo.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.getByLabel('Atributos de variante')).toHaveValue('6');
  await expect(page.getByLabel('Referencia')).toHaveValue('2');
  await page.getByRole('button', { name: 'Ver vista previa' }).click();
  await expect(page.getByTestId('conteo-importar')).toHaveText('2 nuevos · 0 se actualizan · 0 con avisos · 0 con errores');
  await expect(page.getByText('Café de Prueba Casa · Molido fino · 10 oz')).toBeVisible();
  await fitsPhone(page, info.project.name);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await toast(page, /2 productos nuevos y 0 actualizados/);
  await page.getByRole('link', { name: 'Ver el catálogo' }).click();
  await page.getByLabel('Buscar en el catálogo').fill('prueba casa');
  await expect(page.getByText(/Café de Prueba Casa/).first()).toBeVisible();
  await expect(page.getByText(/En grano/).first()).toBeVisible();
});
