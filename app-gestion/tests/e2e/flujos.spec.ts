// Flujos completos, como los recorre la gente: vendedor, local y administración.
import { expect, test } from '@playwright/test';
import { capture, enterAs, go, sign, toast } from './helpers';

test('portada: las dos líneas, el QR y «Entrar como…»', async ({ page }, info) => {
  await page.goto('./#/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Grupo Miami');
  await expect(page.getByRole('article', { name: 'Línea Tabaco' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Línea Café' })).toBeVisible();
  await expect(page.getByAltText(/Código QR/)).toBeVisible();
  await capture(page, info, 'E3-portada');
});

test('registrar tienda → contrato y firma → colocar producto (tabaco)', async ({ page }, info) => {
  const name = `Tabaquería Prueba ${info.project.name}`;
  await enterAs(page, 'tabaco:seller');
  await go(page, '/tabaco/locales/nuevo');
  await page.getByLabel('Nombre de la tienda').fill(name);
  await page.getByLabel('Dirección').fill('123 Calle Prueba');
  await page.getByLabel('Ciudad').fill('Hialeah, FL');
  const map = page.getByRole('region', { name: /Mapa para ubicar la tienda/ });
  await map.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText(/Punto elegido:/)).toBeVisible();
  await page.getByLabel('Nombre del encargado').fill('Encargado de Prueba');
  await page.getByLabel('Teléfono').fill('(305) 555-0177');
  await page.getByLabel('Número del permiso').fill('TP-E2E-1234');
  await page.getByRole('button', { name: 'Registrar tienda' }).last().click();
  await toast(page, /prospecto/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

  await page.getByRole('button', { name: 'Preparar contrato' }).click();
  await expect(page.getByRole('heading', { name: 'Contrato de consignación', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText('Plantilla de ejemplo: la revisa un abogado').first()).toBeVisible();
  const pads = page.locator('canvas');
  await sign(page, pads.nth(0));
  await sign(page, pads.nth(1));
  await page.getByText('Las dos partes aceptan firmar electrónicamente').click();
  await capture(page, info, 'E2-contrato-firma');
  await page.getByRole('button', { name: 'Firmar contrato' }).click();
  await toast(page, /Contrato firmado/);
  await expect(page.getByText(/Firmado el/).first()).toBeVisible();

  await page.getByRole('link', { name: name }).first().click();
  await page.getByRole('button', { name: 'Pedir producto' }).click();
  await page.getByRole('button', { name: 'Agregar una caja de Biscayne Churchill' }).click();
  await page.getByRole('button', { name: /Enviar pedido/ }).click();
  await toast(page, /Pedido enviado a administración/);

  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/entregas');
  const card = page.getByRole('article').filter({ hasText: name });
  await card.getByRole('button', { name: 'Aprobar y preparar' }).click();
  await toast(page, /Preparada/);

  await enterAs(page, 'tabaco:seller');
  await go(page, '/tabaco/entregas');
  await page.getByRole('article').filter({ hasText: name }).getByRole('button', { name: 'Recibir con firma' }).click();
  await sign(page, page.getByRole('dialog').locator('canvas'));
  await page.getByRole('button', { name: 'Firmar y recibir' }).click();
  await toast(page, /Entregado/);

  await go(page, '/tabaco/locales');
  await page.getByRole('link', { name: new RegExp(name) }).first().click();
  await expect(page.getByText('20 u.').first()).toBeVisible();
  await capture(page, info, 'E3-local-con-consignacion');
});

test('el local pide → el vendedor confirma → administración entrega (café)', async ({ page }, info) => {
  await enterAs(page, 'cafe:store');
  await go(page, '/cafe/pedir');
  await page.getByRole('button', { name: 'Agregar una caja de Café Espresso El Mío' }).click();
  await capture(page, info, 'E3-local-pide');
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await toast(page, /enviado/);
  const code = (await page.getByRole('status').innerText()).match(/P-\d{4}/)?.[0];
  expect(code).toBeTruthy();

  await enterAs(page, 'cafe:seller');
  await go(page, '/cafe/pedidos');
  await page.getByRole('article', { name: `Pedido ${code}` }).getByRole('button', { name: 'Confirmar pedido' }).click();
  await toast(page, /confirmado/);

  await enterAs(page, 'cafe:admin');
  await go(page, '/cafe/entregas');
  await page.getByRole('article').filter({ hasText: `Pedido del local ${code}` }).getByRole('button', { name: 'Aprobar y preparar' }).click();
  await toast(page, /Preparada/);

  await enterAs(page, 'cafe:store');
  await go(page, '/cafe');
  await page.getByRole('button', { name: 'Recibir con firma' }).first().click();
  await sign(page, page.getByRole('dialog').locator('canvas'));
  await page.getByRole('button', { name: 'Firmar y recibir' }).click();
  await toast(page, /Entregado/);
  await go(page, '/cafe/pedidos');
  await page.getByRole('tab', { name: /Entregados/ }).click();
  await expect(page.getByRole('article', { name: `Pedido ${code}` })).toBeVisible();
});

test('registrar una visita con conteo (tabaco)', async ({ page }, info) => {
  await enterAs(page, 'tabaco:seller');
  await go(page, '/tabaco/locales/t-loc_0001/visita');
  await expect(page.getByRole('heading', { name: 'Registrar visita' })).toBeVisible();
  const minus = page.getByRole('button', { name: /^Quitar una unidad de .*, contados$/ }).first();
  await minus.click();
  await minus.click();
  await expect(page.getByText(/2 vendidas ·/).first()).toBeVisible();
  await capture(page, info, 'E3-visita-conteo');
  await page.getByRole('button', { name: 'Guardar visita' }).click();
  await toast(page, /Visita registrada: 2 vendidas/);
});

test('tabaco sin permiso vigente: no se puede pedir producto', async ({ page }) => {
  await enterAs(page, 'tabaco:seller');
  await go(page, '/tabaco/locales/t-loc_0002');
  await expect(page.getByRole('alert').filter({ hasText: /permiso de venta de tabaco/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pedir producto' })).toBeDisabled();
});
