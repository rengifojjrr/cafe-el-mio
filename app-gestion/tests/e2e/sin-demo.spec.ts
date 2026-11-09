// El programa de Tabaco sin datos de ejemplo: así lo abre cualquier navegador. Estas pruebas no
// llevan la marca de pruebas (DEMO_STORAGE) que usan las demás para trabajar sobre la demo.
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_STORAGE } from '../../playwright.config';
import { ServidorFalso } from '../servidor-falso';
import { enterAs, go, toast } from './helpers';
import { conServidorFalso, entrarConCorreo } from './servidor-helpers';

const XLSX = fileURLToPath(new URL('../fixtures/odoo-variantes.xlsx', import.meta.url));
const FLAG = DEMO_STORAGE.origins[0]!.localStorage[0]!.name;

async function databases(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ''));
}

/** El servidor del programa (de mentira) con la cuenta de Administración. */
async function servidorCon(page: Page): Promise<ServidorFalso> {
  const servidor = new ServidorFalso();
  servidor.agregarUsuario('admin@example.com', 'clave-segura-1', { rol: 'admin', usuario_app: 't-usr_admin', tienda: null, nombre: 'Administración' });
  await conServidorFalso(page.context(), servidor);
  return servidor;
}

test.describe('un navegador nuevo', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('arranca en cero y solo con Tabaco: sin demo, sin café, sin recorrido ni insignias', async ({ page }) => {
    await page.goto('./#/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Grupo Miami');
    // Las cifras de la portada: nada inventado. Y el café es otro programa: aquí no está.
    await expect(page.getByRole('article', { name: 'Línea Tabaco' }).locator('dd')).toHaveText(['0', '0', '0']);
    await expect(page.getByRole('article', { name: 'Línea Café' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Restablecer|Recorrido/ })).toHaveCount(0);
    await expect(page.getByText(/Datos de ejemplo|La demo/)).toHaveCount(0);

    // Se entra con correo y contraseña: no hay «Entrar como…» ni «Cambiar de rol».
    await expect(page.getByRole('button', { name: 'Entrar como…' })).toHaveCount(0);
    await servidorCon(page);
    await entrarConCorreo(page, 'admin@example.com', 'clave-segura-1');
    await page.waitForURL((url) => url.hash === '#/tabaco');
    await expect(page.getByTestId('cambiar-rol')).toHaveCount(0);
    await expect(page.getByText('Tabaco está en blanco, lista para tus datos.')).toBeVisible();
    await go(page, '/tabaco/catalogo');
    await expect(page.getByText('Aún no hay productos')).toBeVisible();
    await go(page, '/tabaco/almacen');
    await expect(page.getByRole('heading', { name: 'Almacén', level: 1 })).toBeVisible();
    await expect(page.getByText('(ubicación de ejemplo)')).toHaveCount(0);

    // «/cafe» no existe en este programa: vuelve a la portada.
    await go(page, '/cafe/catalogo');
    await page.waitForURL((url) => url.hash === '#/');
    // Las bases de datos son las del programa de Tabaco; nada del café ni de antes.
    const names = await databases(page);
    expect(names).toEqual(expect.arrayContaining(['tabaco-datos', 'tabaco-cuentas']));
    expect(names.filter((n) => n.includes('cafe') || n.startsWith('eco-'))).toEqual([]);
  });

  test('las bases de antes (las dos líneas juntas) se borran si solo tenían ejemplos', async ({ page }) => {
    // Una página vacía del mismo sitio, para dejar las bases como las tenía un navegador de antes.
    await page.route('**/vacio.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>vacío</title>' }));
    await page.goto('./vacio.html');
    await page.evaluate(async () => {
      const make = (name: string, settings?: Record<string, unknown>) =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open(name, 1);
          req.onupgradeneeded = () => {
            req.result.createObjectStore('settings', { keyPath: 'id' });
          };
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('settings', 'readwrite');
            if (settings) tx.objectStore('settings').put({ id: 'settings', ...settings });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        });
      await make('eco-tabaco', {});
      await make('eco-cafe', {});
      await make('eco-core');
    });
    expect((await databases(page)).filter((n) => n.startsWith('eco-')).sort()).toEqual(['eco-cafe', 'eco-core', 'eco-tabaco']);
    await page.goto('./#/');
    await expect(page.getByRole('article', { name: 'Línea Tabaco' }).locator('dd')).toHaveText(['0', '0', '0']);
    await expect.poll(async () => (await databases(page)).filter((n) => n.startsWith('eco-'))).toEqual([]);
  });
});

test.describe('con la demo de las pruebas', () => {
  // Con la marca, la app carga la demo (solo de Tabaco).
  test.use({ storageState: DEMO_STORAGE });

  test('al quitar la marca, lo de ejemplo se borra y queda en cero', async ({ page }) => {
    await page.goto('./#/');
    await expect(page.getByRole('article', { name: 'Línea Tabaco' }).locator('dd').first()).toHaveText('21');
    await page.evaluate((flag) => localStorage.removeItem(flag), FLAG);
    await page.reload();
    await expect(page.getByRole('article', { name: 'Línea Tabaco' }).locator('dd')).toHaveText(['0', '0', '0']);
    // Sin la marca de pruebas ya no hay «Entrar como…»: se entra con correo y contraseña.
    await expect(page.getByRole('button', { name: 'Entrar como…' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  });

  test('«Entrar como…» (solo en las pruebas): ninguna fila más ancha que la pantalla', async ({ page }) => {
    await page.goto('./#/');
    await page.getByRole('button', { name: 'Entrar como…' }).first().click();
    const picker = page.getByRole('dialog', { name: 'Entrar como…' });
    await expect(picker.locator('[data-account]').first()).toBeVisible();
    const rights = await picker.locator('[data-account]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
    expect(Math.max(...rights)).toBeLessThanOrEqual(page.viewportSize()!.width);
  });

  test('lo que ya era real no se toca', async ({ page }) => {
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

    // Sale la versión nueva: ya no hay marca de pruebas.
    await page.evaluate((flag) => localStorage.removeItem(flag), FLAG);
    await go(page, '/');
    await page.reload();
    await expect(page.getByRole('article', { name: 'Línea Tabaco' }).locator('dd').first()).toHaveText('18');
    // Al entrar con su cuenta, el servidor (vacío) recibe lo de este navegador.
    const servidor = await servidorCon(page);
    await entrarConCorreo(page, 'admin@example.com', 'clave-segura-1');
    await page.waitForURL((url) => url.hash === '#/tabaco');
    await go(page, '/tabaco/catalogo');
    await expect(page.getByTestId('resultados')).toContainText('18 productos');
    await expect.poll(() => [...servidor.vivos().keys()].filter((k) => k.startsWith('products/')).length, { timeout: 20_000 }).toBe(18);
  });
});
