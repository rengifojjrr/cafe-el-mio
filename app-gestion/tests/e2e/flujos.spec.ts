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
  await expect(page.getByText(/Queda así: Lun–Sáb 9 a\. m\.–8 p\. m\./)).toBeVisible();
  await page.getByLabel('Número del permiso').fill('TP-E2E-1234');
  await page.getByRole('button', { name: 'Registrar tienda' }).last().click();
  await toast(page, /prospecto/);
  // En el teléfono el aviso tapa la casilla del consentimiento y se queda con el toque: se cierra.
  await page.getByRole('status').getByRole('button', { name: 'Cerrar aviso' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

  await page.getByRole('button', { name: 'Preparar contrato' }).click();
  await expect(page.getByRole('heading', { name: 'Contrato de consignación', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText('Plantilla de ejemplo: la revisa un abogado').first()).toBeVisible();
  const pads = page.locator('canvas');
  await sign(page, pads.nth(0));
  await sign(page, pads.nth(1));
  // En el teléfono el aviso de «prospecto» puede quedar encima de la casilla: se espera a que se vaya.
  await expect(page.getByRole('status').getByText(/prospecto/)).toBeHidden({ timeout: 10_000 });
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
  await expect(page.getByRole('dialog').getByLabel('Nombre del dueño o encargado del local')).toHaveValue('Encargado de Prueba');
  await sign(page, page.getByRole('dialog').locator('canvas'));
  await page.getByText('Recibí todo lo de esta lista, en buen estado').click();
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
  await page.getByText('Recibí todo lo de esta lista, en buen estado').click();
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
  // El botón dice la unidad del producto: «un tabaco» (premium) o «un mazo» (de mazo).
  const minus = page.getByRole('button', { name: /^Quitar (un tabaco|un mazo|una unidad) de .*, contados$/ }).first();
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

test('liquidar y registrar el pago (tabaco)', async ({ page }, info) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/cobros');
  await page.getByRole('button', { name: 'Liquidar ahora' }).and(page.locator(':not([disabled])')).first().click();
  await toast(page, /Liquidación L-\d{4} generada/);
  const code = (await page.getByRole('status').innerText()).match(/L-\d{4}/)?.[0];
  expect(code).toBeTruthy();
  const row = page.getByRole('listitem').filter({ hasText: code! }).filter({ has: page.getByRole('button', { name: 'Registrar pago' }) });
  await row.getByRole('button', { name: 'Registrar pago' }).click();
  const dialog = page.getByRole('dialog', { name: 'Registrar pago' });
  await dialog.getByLabel('Cómo pagó').selectOption('zelle');
  await dialog.getByLabel('Referencia').fill('ZL-E2E-0001');
  await capture(page, info, 'E4-registrar-pago');
  await dialog.getByRole('button', { name: 'Guardar pago' }).click();
  await toast(page, new RegExp(`Pago registrado en ${code}`));
  await page.getByRole('tab', { name: /Pagadas/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: code! }).first()).toBeVisible();
});

test('recorrido guiado: 7 pasos de Tabaco, cambiando de cuenta solo', async ({ page }) => {
  await page.goto('./#/');
  await page.getByRole('button', { name: 'Recorrido guiado' }).first().click();
  await page.getByRole('dialog', { name: 'Recorrido guiado' }).getByRole('button').filter({ hasText: /Tabaco/ }).click();
  const panel = page.getByTestId('recorrido');
  for (let i = 1; i <= 7; i++) {
    await expect(panel).toContainText(`paso ${i} de 7`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    if (i < 7) await panel.getByRole('button', { name: /Siguiente/ }).click();
  }
  await panel.getByRole('button', { name: 'Terminar', exact: true }).click();
  await expect(panel).toBeHidden();
});

test('Dirección: las dos líneas lado a lado y una línea en solo mirar', async ({ page }, info) => {
  await enterAs(page, 'direccion');
  await expect(page.getByText('Suma informativa').first()).toBeVisible();
  await capture(page, info, 'E5-direccion-recorrido');
  await page.getByRole('button', { name: /Abrir Tabaco como Administración/ }).click();
  await expect(page.getByText(/Solo mirar/).first()).toBeVisible();
  await go(page, '/tabaco/catalogo');
  await expect(page.getByRole('heading', { name: 'Catálogo' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nuevo producto' })).toHaveCount(0);
});

test('restablecer la demo vuelve a cargar los datos de ejemplo', async ({ page }) => {
  await page.goto('./#/');
  await page.getByRole('button', { name: 'Restablecer demo' }).click();
  await page.getByRole('button', { name: 'Sí, restablecer' }).click();
  await toast(page, /datos de ejemplo cargados/);
  // 21 productos de tabaco desde la ronda 3 (12 premium y 9 de mazo).
  await expect(page.getByRole('article', { name: 'Línea Tabaco' }).getByText('21')).toBeVisible();
});

test('el local pide desde la ficha del producto: cuánto y listo', async ({ page }) => {
  await enterAs(page, 'tabaco:store');
  await go(page, '/tabaco/catalogo/t-prd_0001');
  await page.getByRole('button', { name: 'Pedir este producto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Pedir Biscayne Robusto' });
  await expect(dialog.getByText('¿Cuánto quieres?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Agregar una caja de Biscayne Robusto' }).click();
  await dialog.getByRole('button', { name: 'Enviar pedido' }).click();
  await toast(page, /Pedido P-\d{4} enviado: 40 tabacos/);
  await expect(page).toHaveURL(/catalogo\/t-prd_0001/);
});

test('lo que debe el local incluye lo vendido sin liquidar', async ({ page }) => {
  const money = (t: string) => Number(t.replace(/[^0-9.]/g, ''));
  await enterAs(page, 'tabaco:store');
  await go(page, '/tabaco/cuentas');
  const total = page.getByText(/debe$/).locator('xpath=following-sibling::p[1]');
  const before = money(await total.innerText());
  await go(page, '/tabaco');
  await page.getByRole('button', { name: 'Reportar ventas' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /^Agregar una unidad de Biscayne Robusto$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Reportar ventas \(/ }).click();
  await toast(page, /Ventas reportadas/);
  await go(page, '/tabaco/cuentas');
  await expect.poll(async () => money(await total.innerText())).toBeCloseTo(before + 5.5, 2);
});
