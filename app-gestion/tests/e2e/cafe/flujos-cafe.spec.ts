// En espera, como el programa de café (docs/CAFE-EN-ESPERA.md): no corre con el de Tabaco.
// Cuando se active el café, se corre contra su propia compilación (ver ese documento).
import { expect, test } from '@playwright/test';
import { capture, enterAs, go, sign, toast } from '../helpers';

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
