// Datos reales: empezar en blanco, importar los productos desde el Excel de Odoo y volver a
// los datos de ejemplo con «Restablecer demo».
import { expect, test, type Page } from '@playwright/test';
import { enterAs, go, toast } from './helpers';

async function shot(page: Page, name: string): Promise<void> {
  if (!process.env.SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });
}

test('Tabaco empieza en blanco, importa el Excel de Odoo y «Restablecer demo» vuelve a los ejemplos', async ({ page }, info) => {
  const tag = info.project.name;
  await enterAs(page, 'tabaco:admin');
  // La cabecera dice de dónde son los datos (en el teléfono, corto).
  await expect(page.locator('header [data-modo="ejemplo"]')).toBeVisible();

  // Ajustes → Empezar en blanco (escribiendo «Tabaco»).
  await go(page, '/tabaco/ajustes');
  await expect(page.getByRole('heading', { name: 'Datos de Tabaco' })).toBeVisible();
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
  await shot(page, `catalogo-vacio-${tag}`);

  // En la portada: Tabaco sin recorrido (Café sí lo tiene).
  await go(page, '/');
  await expect(page.getByRole('article', { name: 'Línea Tabaco' }).getByText(/Datos reales/)).toBeVisible();
  await expect(page.getByRole('article', { name: 'Línea Tabaco' }).getByRole('button', { name: 'Recorrido de 7 pasos' })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Línea Café' }).getByRole('button', { name: 'Recorrido de 7 pasos' })).toBeVisible();
  await shot(page, `portada-real-${tag}`);

  // Restablecer demo: con datos reales hay que escribir «borrar».
  await page.getByRole('button', { name: 'Restablecer demo' }).click();
  const reset = page.getByRole('dialog', { name: 'Restablecer la demo' });
  await expect(reset.getByText('Tabaco tiene datos reales de tu empresa.')).toBeVisible();
  await expect(reset.getByRole('button', { name: 'Sí, restablecer' })).toBeDisabled();
  await reset.getByLabel('Para confirmar, escribe borrar').fill('borrar');
  await reset.getByRole('button', { name: 'Sí, restablecer' }).click();
  await toast(page, /datos de ejemplo cargados/);
  await expect(page.getByRole('article', { name: 'Línea Tabaco' }).getByText('Datos de ejemplo')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Línea Tabaco' }).getByRole('button', { name: 'Recorrido de 7 pasos' })).toBeVisible();
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/catalogo');
  await expect(page.getByText('Biscayne Robusto').first()).toBeVisible();
});
