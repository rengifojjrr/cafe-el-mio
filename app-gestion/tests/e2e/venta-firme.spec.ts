// Venta en firme (ronda 3): la venta rápida en el almacén y el pedido de un local que compra en firme,
// de punta a punta: pedido por teléfono → preparar → entrega con la firma del dueño → factura → pago.
import { expect, test } from '@playwright/test';
import { enterAs, go, sign, toast } from './helpers';

test('venta rápida: un mazo en tres toques, con su factura en PDF y el stock abajo', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/venta-rapida');
  await expect(page.getByRole('heading', { name: 'Venta rápida', level: 1 })).toBeVisible();

  // 1 · el local (los recientes van primero).
  await page.locator('[data-store]').first().click();
  // 2 · el producto: va un mazo.
  const tile = page.locator('[data-product]').first();
  await expect(tile).toBeVisible();
  const productId = (await tile.getAttribute('data-product'))!;
  const before = Number(await tile.getAttribute('data-available'));
  await tile.click();
  // 3 · cobrar (en efectivo, lo de siempre).
  await page.getByRole('button', { name: /^Cobrar \$/ }).click();

  await toast(page, /Venta F-\d{4} cobrada: 1 mazo/);
  const code = (await page.getByRole('status').innerText()).match(/F-\d{4}/)![0];
  await expect(page.getByText(`Venta ${code} registrada`)).toBeVisible();
  await expect(page.locator(`[data-product="${productId}"]`)).toHaveAttribute('data-available', String(before - 1));

  // La factura (o recibo) en PDF se arma en el teléfono y se descarga.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Factura en PDF' }).click();
  expect((await download).suggestedFilename()).toMatch(new RegExp(`^${code}-.+\\.pdf$`));
});

test('local en firme: pedido por teléfono → preparar → firma del dueño → factura → pago total', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/pedido-telefono');
  await page.getByPlaceholder(/Buscar local/).fill('Primo');
  await page.locator('[data-store]').filter({ hasText: 'Bodega El Primo' }).click();
  await expect(page.getByText(/En firme · a crédito, 15 días/).first()).toBeVisible();
  await page.getByLabel('Cantidad de Toro 6 × 52 · Habano').fill('10');
  await page.getByRole('button', { name: 'Crear pedido' }).click();
  await toast(page, /Pedido P-\d{4} anotado para Bodega El Primo/);
  const order = (await page.getByRole('status').innerText()).match(/P-\d{4}/)![0];

  // El almacén lo prepara.
  await go(page, '/tabaco/entregas');
  const card = page.getByRole('article').filter({ hasText: `Pedido por teléfono ${order}` });
  await expect(card.getByText('Venta en firme: al firmar sale la factura')).toBeVisible();
  await card.getByRole('button', { name: 'Aprobar y preparar' }).click();
  await toast(page, /Preparada/);

  // El dueño firma al recibir: nace la factura.
  await page.getByRole('tab', { name: /Listas para entregar/ }).click();
  const ready = page.getByRole('article').filter({ hasText: `Pedido por teléfono ${order}` });
  await ready.getByRole('button', { name: 'Recibir con firma' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Nombre del dueño o encargado del local')).toHaveValue('Ramón Quesada');
  await sign(page, dialog.locator('canvas'));
  await dialog.getByText('Recibí todo lo de esta lista, en buen estado').click();
  await dialog.getByRole('button', { name: 'Firmar y recibir' }).click();
  await toast(page, /Entregado y facturado a Bodega El Primo/);
  await page.getByRole('tab', { name: /Entregadas/ }).click();
  const delivered = page.getByRole('article').filter({ hasText: `Pedido por teléfono ${order}` });
  const pill = delivered.getByText(/^Factura F-\d{4}$/);
  await expect(pill).toBeVisible();
  const invoice = (await pill.innerText()).match(/F-\d{4}/)![0];

  // En Cobros: la factura por cobrar (10 mazos a $23 de la lista Mayorista) y el pago total.
  await go(page, '/tabaco/cobros');
  const row = page.locator(`[data-invoice="${invoice}"]`);
  await expect(row).toContainText('$230.00');
  await row.getByRole('button', { name: 'Registrar pago' }).click();
  const pay = page.getByRole('dialog', { name: 'Registrar pago' });
  await expect(pay.getByLabel('Monto pagado (USD)')).toHaveValue('230');
  await expect(pay.getByLabel('Cómo pagó')).toHaveValue('efectivo');
  await pay.getByRole('button', { name: 'Guardar pago' }).click();
  await toast(page, new RegExp(`Pago registrado en ${invoice}`));
  await page.getByRole('tab', { name: /Cobradas/ }).click();
  await expect(page.locator(`[data-invoice="${invoice}"]`).getByText('Pagada', { exact: true })).toBeVisible();
});
