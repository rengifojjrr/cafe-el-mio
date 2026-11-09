// En espera, como el programa de café (docs/CAFE-EN-ESPERA.md): no corre con el de Tabaco.
// Cuando se active el café, se corre contra su propia compilación (ver ese documento).
import { expect, test } from '@playwright/test';
import { enterAs, go, toast } from '../helpers';

test.describe('un navegador nuevo del programa de café', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('arranca con los 9 cafés de El Mío desactivados y sin precio', async ({ page }) => {
    await page.goto('./#/');
    // Los 9 cafés de El Mío, desactivados y sin precio hasta que se lo pongan.
    await enterAs(page, 'cafe:admin');
    await expect(page.getByText('Café está en blanco, lista para tus datos.')).toBeVisible();
    await go(page, '/cafe/catalogo');
    await expect(page.getByText('Todo está desactivado')).toBeVisible();
    await page.getByRole('button', { name: 'Ver los 9 desactivados' }).click();
    await expect(page.getByTestId('resultados')).toContainText('9 productos');
    await expect(page.getByText('Sin precio').first()).toBeVisible();
    await page.getByRole('link', { name: /Café Espresso El Mío/ }).first().click({ position: { x: 24, y: 24 } });
    await expect(page.getByRole('heading', { name: 'Café Espresso El Mío', level: 1 })).toBeVisible();
    await expect(page.getByText(/Le falta el precio al local/)).toBeVisible();
    await page.getByRole('button', { name: 'Activar' }).click();
    await toast(page, /todavía no tiene precio al local/);
  });
});
