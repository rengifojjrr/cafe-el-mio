// Datos reales: empezar en blanco, importar los productos desde el Excel de Odoo y volver a
// los datos de ejemplo con «Restablecer demo».
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { enterAs, go, toast } from './helpers';

const XLSX = fileURLToPath(new URL('../fixtures/odoo-variantes.xlsx', import.meta.url));

async function shot(page: Page, name: string): Promise<void> {
  if (!process.env.SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });
}

/** En el teléfono, nada más ancho que la pantalla (como en telefono.spec.ts). */
async function fitsPhone(page: Page, project: string): Promise<void> {
  if (project !== 'telefono') return;
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(w.scroll, 'la pantalla es más ancha que el teléfono').toBeLessThanOrEqual(w.client + 1);
}

test('Tabaco empieza en blanco, importa el Excel de Odoo y «Restablecer demo» vuelve a los ejemplos', async ({ page }, info) => {
  const tag = info.project.name;
  await enterAs(page, 'tabaco:admin');
  // La cabecera dice de dónde son los datos (en el teléfono, corto).
  await expect(page.locator('header [data-modo="ejemplo"]')).toBeVisible();

  // Ajustes → Empezar en blanco (escribiendo «Tabaco»).
  await go(page, '/tabaco/ajustes');
  await expect(page.getByRole('heading', { name: 'Datos de Tabaco' })).toBeVisible();
  await fitsPhone(page, tag);
  await shot(page, `ajustes-demo-${tag}`);
  await page.getByRole('button', { name: 'Empezar en blanco' }).click();
  const sheet = page.getByRole('dialog', { name: 'Empezar en blanco' });
  const confirm = sheet.getByRole('button', { name: 'Empezar en blanco' });
  await expect(confirm).toBeDisabled();
  await sheet.getByLabel('Para confirmar, escribe Tabaco').fill('Tabaco');
  await confirm.click();
  await toast(page, /quedó en blanco/);
  await expect(page.locator('header [data-modo="real"]')).toBeVisible();
  await expect(page.locator('header [data-modo="real"]')).toContainText('Datos reales');
  await shot(page, `ajustes-real-${tag}`);

  // El catálogo queda vacío.
  await go(page, '/tabaco/catalogo');
  await expect(page.getByRole('heading', { name: 'Catálogo', level: 1 })).toBeVisible();
  await expect(page.getByText('Aún no hay productos')).toBeVisible();
  await expect(page.locator('header [data-modo="real"]')).toBeVisible();

  // En la portada: Tabaco sin recorrido (Café sí lo tiene).
  await go(page, '/');
  const tabacoCard = page.getByRole('article', { name: 'Línea Tabaco' });
  await expect(tabacoCard.getByText(/Datos reales/)).toBeVisible();
  await expect(tabacoCard.getByRole('button', { name: 'Recorrido de 7 pasos' })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Línea Café' }).getByRole('button', { name: 'Recorrido de 7 pasos' })).toBeVisible();
  await shot(page, `portada-real-${tag}`);

  // Catálogo → Importar el Excel de Odoo (inventado).
  await go(page, '/tabaco/catalogo');
  await page.getByRole('link', { name: 'Importar' }).click();
  await expect(page.getByRole('heading', { name: 'Importar productos', level: 1 })).toBeVisible();
  await page.getByLabel('Elegir el archivo de productos').setInputFiles(XLSX);
  await expect(page.getByText('Columnas de «odoo-variantes.xlsx»')).toBeVisible();
  await expect(page.getByLabel('Nombre/descripción')).toHaveValue('0');
  await expect(page.getByLabel('Cantidad', { exact: true })).toHaveValue('1');
  await fitsPhone(page, tag);
  await shot(page, `importar-columnas-${tag}`);
  await page.getByRole('button', { name: 'Ver vista previa' }).click();
  await expect(page.getByTestId('conteo-importar')).toHaveText('18 nuevos · 0 se actualizan · 8 con avisos · 0 con errores');
  await expect(page.getByText('La cantidad del archivo reemplaza la del almacén.')).toBeVisible();
  await expect(page.getByText('Sin referencia: queda con el SKU SIN-REF-6X64-BOX-PRESS.')).toBeVisible();
  await expect(page.getByText(/El nombre dice Connecticut y la categoría Habano/)).toBeVisible();
  await fitsPhone(page, tag);
  await shot(page, `importar-vista-previa-${tag}`);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await toast(page, /18 productos nuevos y 0 actualizados/);
  await page.getByRole('link', { name: 'Ver el catálogo' }).click();

  // Buscar «toro»: las tres variantes de la familia «Toro 6 × 52».
  await page.getByLabel('Buscar en el catálogo').fill('toro');
  await expect(page.getByText(/Toro 6 × 52/).first()).toBeVisible();
  for (const capa of ['Habano', 'Maduro', 'Connecticut']) await expect(page.getByText(new RegExp(capa)).first()).toBeVisible();
  await expect(page.getByText(/Salomón/)).toHaveCount(0);
  await shot(page, `catalogo-toro-${tag}`);

  // Restablecer demo: con datos reales hay que escribir «borrar».
  await go(page, '/');
  await page.getByRole('button', { name: 'Restablecer demo' }).click();
  const reset = page.getByRole('dialog', { name: 'Restablecer la demo' });
  await expect(reset.getByText('Tabaco tiene datos reales de tu empresa.')).toBeVisible();
  await expect(reset.getByRole('button', { name: 'Sí, restablecer' })).toBeDisabled();
  await reset.getByLabel('Para confirmar, escribe borrar').fill('borrar');
  await reset.getByRole('button', { name: 'Sí, restablecer' }).click();
  await toast(page, /datos de ejemplo cargados/);
  await expect(tabacoCard.getByText('Datos de ejemplo')).toBeVisible();
  await expect(tabacoCard.getByRole('button', { name: 'Recorrido de 7 pasos' })).toBeVisible();
  await enterAs(page, 'tabaco:admin');
  await expect(page.locator('header [data-modo="ejemplo"]')).toBeVisible();
  await go(page, '/tabaco/catalogo');
  await expect(page.getByText('Biscayne Robusto').first()).toBeVisible();
});
