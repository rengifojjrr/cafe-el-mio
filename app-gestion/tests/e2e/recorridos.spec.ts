// Recorridos de prospectos: un local se anota con lo que se sepa, sale en el recorrido de su zona y
// en la parada se anota la visita (qué dijo y lo que dio).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { capture, enterAs, go, toast } from './helpers';

/** Busca la parada en las pestañas de zona del recorrido. */
async function buscarParada(page: Page, name: string): Promise<Locator> {
  const card = page.getByRole('listitem', { name: new RegExp(`^Parada \\d+: ${name}$`) });
  const tabs = page.getByRole('tablist', { name: 'Zona del recorrido' }).getByRole('tab');
  await expect(tabs.first()).toBeVisible();
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    if (await card.isVisible().catch(() => false)) return card;
  }
  throw new Error(`No encontré la parada ${name}`);
}

test('un prospecto sin encargado, teléfono ni permiso se registra, sale en su recorrido y se anota la visita', async ({ page }, info) => {
  const name = `Prospecto Recorrido ${info.project.name}`;
  await enterAs(page, 'tabaco:seller');
  await go(page, '/tabaco/locales/nuevo');
  await page.getByLabel('Nombre de la tienda').fill(name);
  await page.getByLabel('Dirección').fill('456 Calle Prueba');
  await page.getByLabel('Ciudad').fill('Hialeah, FL');
  const map = page.getByRole('region', { name: /Mapa para ubicar la tienda/ });
  await map.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText(/Punto elegido:/)).toBeVisible();
  // Sin encargado, sin teléfono y sin permiso: se piden antes del contrato.
  await expect(page.getByLabel('Nombre del encargado')).not.toHaveAttribute('required', '');
  await page.getByRole('button', { name: 'Registrar tienda' }).last().click();
  await toast(page, /prospecto/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(page.getByTestId('falta-para-contrato')).toContainText('el nombre del encargado');

  // Desde el inicio: la tarjeta de recorridos lleva a la pantalla.
  await go(page, '/tabaco');
  await expect(page.getByTestId('tarjeta-recorridos')).toContainText(/locales? por visitar/);
  await page.getByTestId('tarjeta-recorridos').getByRole('link', { name: 'Abrir recorridos' }).click();
  await expect(page.getByRole('heading', { name: 'Recorridos', level: 1 })).toBeVisible();
  const card = await buscarParada(page, name);
  await expect(card.getByTestId('falta-recolectar')).toContainText('encargado, teléfono, correo, horario, permiso de tabaco');
  // Google Maps busca el local por su nombre y su dirección.
  await expect(card.getByRole('link', { name: 'Cómo llegar' })).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=Prospecto%20Recorrido%20\w+%2C%20456%20Calle%20Prueba%2C%20Hialeah%2C%20FL&travelmode=driving$/);
  await expect(page.getByRole('link', { name: /Google Maps/ }).first()).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
  await capture(page, info, 'H-recorridos');

  await card.getByRole('button', { name: 'Anotar visita' }).click();
  const hoja = page.getByRole('dialog', { name: `Visita a ${name}` });
  await hoja.getByRole('button', { name: 'Guardar visita' }).click();
  await expect(hoja.getByRole('alert')).toContainText('Elige qué pasó');
  await hoja.getByRole('radio', { name: 'Le interesa', exact: true }).click();
  await hoja.getByLabel('Nombre del encargado').fill('Encargada Recorrido');
  await hoja.getByLabel('Teléfono').fill('(305) 555-0188');
  await hoja.getByLabel('Nota').fill('Vende puros; quiere la lista de precios.');
  await hoja.getByRole('button', { name: 'Guardar visita' }).click();
  await toast(page, /anotada/);
  await expect(hoja).toHaveCount(0);
  await expect(card).toHaveCount(0);
  const hechos = page.locator('details', { hasText: 'Ya visitados' });
  await hechos.locator('summary').click();
  await expect(hechos).toContainText(name);
  await expect(hechos).toContainText('Le interesa');

  // En la ficha: lo que dio y la visita.
  await hechos.getByRole('listitem').filter({ hasText: name }).getByRole('link', { name: 'Ficha' }).click();
  await page.waitForURL((u) => u.hash.includes('/tabaco/locales/'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(page.getByText('Encargada Recorrido')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Visitas de recorrido' })).toContainText('Vende puros; quiere la lista de precios.');
  // Todavía falta el permiso para el contrato.
  await expect(page.getByTestId('falta-para-contrato')).toContainText('el permiso de venta de tabaco');
});
