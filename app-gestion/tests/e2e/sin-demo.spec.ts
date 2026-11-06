// Sin datos de ejemplo: así abre la app cualquier navegador. Estas pruebas no llevan la marca de
// pruebas (DEMO_STORAGE) que usan todas las demás para trabajar sobre la demo.
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { DEMO_STORAGE } from '../../playwright.config';
import { enterAs, go, toast } from './helpers';

const XLSX = fileURLToPath(new URL('../fixtures/odoo-variantes.xlsx', import.meta.url));
const FLAG = DEMO_STORAGE.origins[0]!.localStorage[0]!.name;

test.describe('un navegador nuevo', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('las dos líneas arrancan en blanco: sin demo, sin recorrido y sin insignias', async ({ page }) => {
    await page.goto('./#/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Grupo Miami');
    // Las cifras de la portada: nada inventado.
    await expect(page.getByRole('article', { name: 'Línea Tabaco' }).locator('dd')).toHaveText(['0', '0', '0']);
    await expect(page.getByRole('article', { name: 'Línea Café' }).locator('dd')).toHaveText(['0', '0', '0']);
    await expect(page.getByRole('button', { name: /Restablecer|Recorrido/ })).toHaveCount(0);
    await expect(page.getByText(/Datos de ejemplo|La demo/)).toHaveCount(0);

    // «Entrar como…»: Dirección y la Administración de cada línea, nada más.
    await page.getByRole('button', { name: 'Entrar como…' }).first().click();
    const picker = page.getByRole('dialog', { name: 'Entrar como…' });
    await expect(picker.locator('[data-account]')).toHaveCount(3);
    // Ninguna fila más ancha que la pantalla (el texto largo se corta con «…» dentro de la fila).
    const rights = await picker.locator('[data-account]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
    expect(Math.max(...rights)).toBeLessThanOrEqual(page.viewportSize()!.width);
    await picker.locator('[data-account="tabaco:admin"]').click();
    await page.waitForURL((url) => url.hash === '#/tabaco');
    await expect(page.getByText('Tabaco está en blanco, lista para tus datos.')).toBeVisible();
    await go(page, '/tabaco/catalogo');
    await expect(page.getByText('Aún no hay productos')).toBeVisible();
    await go(page, '/tabaco/almacen');
    await expect(page.getByRole('heading', { name: 'Almacén', level: 1 })).toBeVisible();
    await expect(page.getByText('(ubicación de ejemplo)')).toHaveCount(0);

    // Café: los 9 cafés de El Mío, desactivados y sin precio hasta que se lo pongan.
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

test.describe('un navegador que tenía la demo de antes', () => {
  // Empieza como un navegador de antes: con la marca, la app carga la demo.
  test.use({ storageState: DEMO_STORAGE });

  test('la pierde al abrir la versión nueva y lo real no se toca', async ({ page }) => {
    // Tabaco ya tenía datos reales: empezó en blanco e importó sus productos.
    await enterAs(page, 'tabaco:admin');
    await go(page, '/tabaco/ajustes');
    await page.getByRole('button', { name: 'Empezar en blanco' }).click();
    const sheet = page.getByRole('dialog', { name: 'Empezar en blanco' });
    await sheet.getByLabel('Para confirmar, escribe Tabaco').fill('Tabaco');
    await sheet.getByRole('button', { name: 'Empezar en blanco' }).click();
    await toast(page, /quedó en blanco/);
    await go(page, '/tabaco/catalogo/importar');
    await page.getByLabel('Elegir el archivo de productos').setInputFiles(XLSX);
    await page.getByRole('button', { name: 'Ver vista previa' }).click();
    await page.getByRole('button', { name: 'Crear', exact: true }).click();
    await toast(page, /18 productos nuevos/);
    // Café sigue con la demo de antes (sus locales y vendedores inventados).
    await go(page, '/');
    await expect(page.getByRole('article', { name: 'Línea Café' }).locator('dd').nth(1)).not.toHaveText('0');

    // Sale la versión nueva: ya no hay marca de pruebas.
    await page.evaluate((flag) => localStorage.removeItem(flag), FLAG);
    await page.reload();

    await expect(page.getByRole('article', { name: 'Línea Café' }).locator('dd')).toHaveText(['0', '0', '0']);
    await expect(page.getByRole('article', { name: 'Línea Tabaco' }).locator('dd').first()).toHaveText('18');
    await page.getByRole('button', { name: 'Entrar como…' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Entrar como…' }).locator('[data-account]')).toHaveCount(3);
    await page.getByRole('dialog', { name: 'Entrar como…' }).locator('[data-account="tabaco:admin"]').click();
    await page.waitForURL((url) => url.hash === '#/tabaco');
    await go(page, '/tabaco/catalogo');
    await expect(page.getByTestId('resultados')).toContainText('18 productos');
  });
});
