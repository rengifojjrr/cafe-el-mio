// Ronda 5: un tabaco de mazo «Behike» se ve con su colita en la lista y en la ficha (distinto del
// Toro y del Torpedo), y la capa se elige entre cuatro: Habano, Maduro, Connecticut y Doble Capa.
// Un producto que ya tiene una capa que no se ofrece (Torpedo Natural) sigue igual al editarlo.
import { expect, type Page, test } from '@playwright/test';
import { enterAs, go, toast } from './helpers';

/** La tarjeta de una familia en la lista del catálogo y la silueta de su miniatura. */
function miniatura(page: Page, familia: RegExp) {
  return page.locator('div.glass', { has: page.getByRole('link', { name: familia }) }).first().locator('svg[data-cabeza]');
}

async function crearBehike(page: Page) {
  await go(page, '/tabaco/catalogo/nuevo');
  await page.getByRole('button', { name: /De mazo/ }).click();
  await page.getByLabel('Vitola', { exact: true }).fill('Toro');
  await page.getByLabel('Largo (pulgadas)').fill('6');
  await page.getByLabel('Cepo (/64″)').fill('52');
  await page.getByLabel('Familia (vitola y medida)').fill('Behike');
  await page.getByLabel('Capa', { exact: true }).selectOption('habano');
  await page.getByLabel('Fortaleza').selectOption('media');
  // La vista previa del formulario ya la dibuja con la colita.
  await expect(page.getByRole('img', { name: /con colita$/ })).toBeVisible();
  await page.getByLabel('Precio al local por mazo').fill('22');
  await page.getByLabel('PVP sugerido por mazo').fill('38');
  await page.getByLabel('Costo por mazo (USD)').fill('9');
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await toast(page, /Producto creado/);
  await expect(page.getByRole('heading', { level: 1, name: /^Behike/ })).toBeVisible();
}

test('el desplegable «Capa» ofrece exactamente Habano, Maduro, Connecticut y Doble Capa; «Cabeza» empieza en Automática', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/catalogo/nuevo');
  await page.getByRole('button', { name: /De mazo/ }).click();
  const capa = page.getByLabel('Capa', { exact: true });
  await expect(capa).toHaveValue('');
  // Sin contar «Elige una opción», que no se puede elegir.
  await expect(capa.locator('option:not([disabled])')).toHaveText(['Habano', 'Maduro', 'Connecticut', 'Doble Capa']);
  await expect(capa.locator('option', { hasText: /Corojo|Natural|Criollo|Sumatra|Rosado|Oscuro|Candela/ })).toHaveCount(0);
  const cabeza = page.getByLabel('Cabeza');
  await expect(cabeza).toHaveValue('');
  await expect(cabeza.locator('option')).toHaveText(['Automática', 'Redonda', 'Con colita', 'En punta']);
});

test('un Behike de mazo (Toro 6 × 52) lleva la colita en la ficha y en la lista; el Toro y el Torpedo no', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await crearBehike(page);

  // Ficha: la silueta grande dice «con colita» y la dibuja.
  const ficha = page.getByRole('img', { name: /con colita$/ }).first();
  await expect(ficha).toBeVisible();
  await expect(ficha).toHaveAttribute('data-cabeza', 'colita');
  await expect(ficha.locator('[data-parte="colita"]')).toHaveCount(1);

  // Lista: la miniatura del Behike tiene la colita; la del Toro es redonda y la del Torpedo, en punta.
  await go(page, '/tabaco/catalogo');
  const behike = miniatura(page, /^Ver Behike/);
  await expect(behike).toBeVisible();
  await expect(behike).toHaveAttribute('data-cabeza', 'colita');
  await expect(behike).toHaveAttribute('aria-label', /^Silueta a escala de Behike.*, con colita$/);
  await expect(behike.locator('[data-parte="colita"]')).toBeVisible();
  const toro = miniatura(page, /^Ver Toro 6 × 52$/);
  await expect(toro).toHaveAttribute('data-cabeza', 'redonda');
  await expect(toro).not.toHaveAttribute('aria-label', /con colita/);
  await expect(miniatura(page, /^Ver Torpedo 6⅛ × 52$/)).toHaveAttribute('data-cabeza', 'punta');
  // La colita se ve de verdad en la miniatura: sobresale de la cabeza, hacia arriba.
  const caja = await behike.boundingBox();
  const rabito = await behike.locator('[data-parte="colita"]').boundingBox();
  expect(caja && rabito).toBeTruthy();
  expect(rabito!.height).toBeGreaterThan(8);
});

test.describe('captura para el cliente', () => {
  test.use({ deviceScaleFactor: 2 });

  test('el Behike junto al Toro y al Torpedo de mazo, en el teléfono (390 px)', async ({ page }, info) => {
    test.skip(!process.env.CAPTURAS || info.project.name !== 'telefono', 'Solo con CAPTURAS=1, en el teléfono.');
    await enterAs(page, 'tabaco:admin');
    await crearBehike(page);
    await go(page, '/tabaco/catalogo');
    await page.getByRole('button', { name: /^Tipo: De mazo/ }).click();
    await page.getByRole('button', { name: 'Más filtros' }).click();
    const panel = page.getByRole('group', { name: 'Más filtros del catálogo' });
    await panel.getByRole('button', { name: /^Toro\s*\d/ }).click();
    await panel.getByRole('button', { name: /^Torpedo\s*\d/ }).click();
    await page.getByRole('button', { name: 'Más filtros' }).click();
    await expect(page.locator('div.glass', { has: page.getByRole('link', { name: /^Ver / }) })).toHaveCount(3);
    // En la captura de la página entera, la barra de abajo, el botón de cambiar de rol y el aviso
    // quedarían encima de las tarjetas: se esconden solo para la foto.
    await page.addStyleTag({ content: 'nav[aria-label="Menú"], [data-testid="cambiar-rol"], [role="status"] { visibility: hidden !important; }' });
    await page.waitForTimeout(400);
    await page.screenshot({ path: '../docs/capturas/ronda5-colita.png', fullPage: true });
  });
});

test('un producto viejo con capa Natural se edita sin perderla: sale «Natural (ya no se usa)»', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/catalogo');
  // En la tarjeta del Torpedo de mazo, la capa Natural (con su color, como siempre).
  const tarjeta = page.locator('div.glass', { has: page.getByRole('link', { name: /^Ver Torpedo 6⅛ × 52$/ }) }).first();
  await tarjeta.getByRole('link', { name: 'Natural', exact: true }).click();
  await expect(page.locator('dt', { hasText: /^Capa$/ }).locator('xpath=following-sibling::dd[1]')).toContainText('Natural');
  await page.getByRole('link', { name: 'Editar' }).click();
  const capa = page.getByLabel('Capa', { exact: true });
  await expect(capa).toHaveValue('natural');
  await expect(capa.locator('option:checked')).toHaveText('Natural (ya no se usa)');
  await expect(capa.locator('option:not([disabled])')).toHaveText(['Habano', 'Maduro', 'Connecticut', 'Doble Capa', 'Natural (ya no se usa)']);
  await page.getByLabel('PVP sugerido por mazo').fill('46');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await toast(page, /Cambios guardados/);
  await expect(page.locator('dt', { hasText: /^Capa$/ }).locator('xpath=following-sibling::dd[1]')).toContainText('Natural');
  await expect(page.getByRole('heading', { level: 1, name: /^Torpedo 6⅛ × 52/ })).toBeVisible();
});
