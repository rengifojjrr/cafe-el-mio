// Ronda 3 · la red: comisión progresiva, mercados (Miami y Houston), repartos, datos fiscales,
// reporte para la contadora e invitaciones. Corre en el teléfono y en la computadora.
import { expect, test } from '@playwright/test';
import { capture, enterAs, go, toast } from './helpers';

test('el vendedor ve cómo va su comisión progresiva', async ({ page }, info) => {
  await enterAs(page, 'tabaco:seller');
  const line = page.getByRole('region', { name: 'Tu comisión progresiva' });
  await expect(line).toContainText(/Vas en el \d+(\.\d+)? %/);
  await expect(line).toContainText(/más pasas al \d+(\.\d+)? %|lo más alto/);
  await capture(page, info, 'R3-comision-vendedor');
});

test('Ajustes: el simulador da el % de la comisión progresiva', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/ajustes');
  const sim = page.getByRole('region', { name: 'Simulador de comisión' });
  await sim.scrollIntoViewIfNeeded();
  const result = sim.getByTestId('simulador-resultado');
  await sim.getByLabel('Locales activos', { exact: true }).fill('3');
  await expect(result).toHaveText('7 %');
  await sim.getByLabel('Locales activos', { exact: true }).fill('5');
  await expect(result).toHaveText('8 %');
  await sim.getByLabel('Ventas del mes (USD)', { exact: true }).fill('7500');
  await expect(result).toHaveText('9 %');
  await sim.getByLabel('Locales activos', { exact: true }).fill('8');
  await expect(result).toHaveText('10 %');
  await expect(sim).toContainText('Ya está en lo más alto');
});

test('mapa: cambiar a Houston muestra los locales de Houston', async ({ page }, info) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/mapa');
  await expect(page.getByLabel('Locales en el mapa: 18')).toBeVisible();
  await page.getByLabel('Mercado').selectOption('houston');
  await expect(page.getByLabel('Locales en el mapa: 5')).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon[title^="Tabaquería Bayou"]')).toHaveCount(1);
  await expect(page.locator('.leaflet-marker-icon[title^="Tabaquería El Faro"]')).toHaveCount(0);
  await capture(page, info, 'R3-mapa-houston');
});

test('repartos: armar con las entregas listas, ordenar y costear', async ({ page }, info) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/repartos');
  await page.getByRole('button', { name: 'Armar reparto' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Armar reparto' });
  await sheet.getByLabel('Chofer').fill('Chofer E2E');
  await sheet.getByRole('button', { name: /Armar reparto con 2 paradas/ }).click();
  await toast(page, /armado/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Reparto R-\d{4}/);
  const stops = page.getByRole('list', { name: 'Paradas en orden' }).getByRole('listitem');
  await expect(stops).toHaveCount(2);
  const first = (await stops.nth(0).locator('.font-semibold').first().innerText()).trim();
  const second = (await stops.nth(1).locator('.font-semibold').first().innerText()).trim();
  await page.getByRole('button', { name: `Bajar ${first}` }).click();
  await expect(stops.nth(0)).toContainText(second);
  await expect(stops.nth(1)).toContainText(first);
  await page.getByLabel('Kilómetros').fill('40');
  await page.getByLabel('Costo por km (USD)').fill('0.65');
  await page.getByLabel('Chofer (USD)').fill('50');
  await page.getByLabel('Peajes (USD)').fill('4.5');
  await page.getByRole('button', { name: 'Guardar costos' }).click();
  await toast(page, /Costos guardados: \$80\.50/);
  await expect(page.getByLabel('Costo total: $80.50')).toBeVisible();
  await capture(page, info, 'R3-reparto');
});

test('ficha del local: con Tax ID y certificado de reventa ya no sale «sin certificado»', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/locales/t-loc_0008');
  await expect(page.getByText('Sin certificado de reventa')).toBeVisible();
  await page.getByRole('button', { name: 'Editar datos fiscales' }).click();
  const sheet = page.getByRole('dialog', { name: 'Datos fiscales' });
  await sheet.getByLabel('Tax ID (EIN)').fill('00-0009999');
  await sheet.getByLabel('Número del certificado de reventa').fill('RC-E2E-0001');
  await sheet.getByRole('button', { name: 'Guardar datos fiscales' }).click();
  await toast(page, /Datos fiscales guardados/);
  await expect(page.getByText('RC-E2E-0001', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/sin certificado/i)).toHaveCount(0);
  await expect(page.getByText('00-0009999')).toBeVisible();
});

test('contabilidad: el reporte para la contadora se descarga en CSV', async ({ page }, info) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/contabilidad');
  await page.getByRole('link', { name: 'Reporte para la contadora' }).click();
  await expect(page.getByRole('heading', { name: 'Reporte para la contadora' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ventas por local para la contadora' })).toContainText('Tax ID');
  const csv = page.getByRole('button', { name: 'Descargar CSV' });
  await expect(csv).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Descargar PDF' })).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), csv.click()]);
  expect(download.suggestedFilename()).toMatch(/^tabaco-reporte-contadora-.*\.csv$/);
  await capture(page, info, 'R3-contadora');
});

test('nada de la ronda 3 se sale del ancho del teléfono', async ({ page }, info) => {
  test.skip(info.project.name !== 'telefono', 'Solo tiene sentido en el teléfono.');
  await enterAs(page, 'tabaco:admin');
  const wide: string[] = [];
  const check = async (what: string) => {
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.waitForTimeout(600);
    const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    if (w.scroll > w.client + 1) wide.push(`${what}: ${w.scroll}px de ${w.client}px`);
  };
  for (const hash of ['/tabaco/repartos', '/tabaco/contabilidad/contadora', '/tabaco/ajustes', '/tabaco/usuarios', '/tabaco/mapa', '/tabaco/reportes', '/tabaco/locales/t-loc_0008', '/tabaco/locales/nuevo']) {
    await go(page, hash);
    await check(hash);
  }
  await go(page, '/tabaco/repartos');
  await page.getByRole('link', { name: /Reparto R-/ }).first().click();
  await check('detalle de un reparto');
  await enterAs(page, 'tabaco:seller');
  await check('inicio del vendedor');
  expect(wide, 'pantallas más anchas que el teléfono').toEqual([]);
});

test('invitar a un vendedor: el link entra con su cuenta; de otro teléfono pide la nube', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/usuarios');
  const card = page.getByRole('listitem').filter({ hasText: 'Tomás Garza' }).first();
  await card.getByRole('button', { name: 'Invitar' }).click();
  const sheet = page.getByRole('dialog', { name: 'Invitar: Tomás Garza' });
  await sheet.getByRole('button', { name: 'Crear invitación' }).click();
  await toast(page, /Invitación creada/);
  await expect(sheet.getByRole('link', { name: 'Mandar por WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
  await expect(sheet.getByAltText(/Código QR de la invitación/)).toBeVisible();
  const link = await sheet.getByLabel('Link de la invitación').inputValue();
  expect(link).toContain('#/invitacion/');
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Te invitaron a Tabaco' })).toBeVisible();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hola, Tomás');

  // Una invitación creada en otro teléfono no está en este navegador.
  const token = Buffer.from(JSON.stringify({ v: 1, line: 'tabaco', accountId: 'tabaco:t-usr_0006', inv: 'inv_de_otro_telefono', exp: '2099-01-01T00:00:00.000Z' })).toString('base64url');
  await go(page, `/invitacion/${token}`);
  await expect(page.getByText(/Esta invitación necesita la nube/)).toBeVisible();
});
