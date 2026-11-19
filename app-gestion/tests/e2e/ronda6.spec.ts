// Ronda 6: en «Venta rápida» y en «Pedidos» el cliente puede ser un local, una persona o el almacén
// (la venta de mostrador). Y el precio por mazo de un tabaco de mazo sale de su medida, con la regla
// de Ajustes.
import { expect, type Page, test } from '@playwright/test';
import { capture, enterAs, go, toast } from './helpers';

/** Toca el primer producto con existencias de la venta rápida. */
async function agregarProducto(page: Page) {
  const tile = page.locator('[data-product]:not([disabled])').first();
  await expect(tile).toBeVisible();
  await tile.click();
}

test('venta rápida a nombre de una persona nueva: se crea en un toque, pide la edad y queda en Clientes', async ({ page }, info) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/venta-rapida');
  const tipo = page.getByRole('tablist', { name: 'Tipo de cliente' });
  await expect(tipo.getByRole('tab')).toHaveText(['Local', 'Persona', 'Almacén']);
  await tipo.getByRole('tab', { name: 'Persona' }).click();
  await page.getByLabel('Nombre de la persona').fill('Lucía Fernández');
  await page.getByLabel('Teléfono (opcional)').fill('305 555 0142');
  await capture(page, info, 'ronda6-personas');
  await page.getByRole('button', { name: 'Crear «Lucía Fernández»' }).click();
  await toast(page, 'Cliente nuevo: Lucía Fernández.');
  await expect(page.locator('[data-cliente="persona"]')).toContainText('Lucía Fernández');

  await agregarProducto(page);
  const cobrar = page.getByRole('button', { name: /^Cobrar \$/ });
  // Tabaco a una persona: sin comprobar la edad no se cobra.
  await expect(cobrar).toBeDisabled();
  await page.getByRole('checkbox', { name: /tiene 21 años o más/ }).check();
  await cobrar.click();
  await toast(page, /Venta F-\d{4} cobrada: 1 mazo/);
  await expect(page.getByText(/edad comprobada \(21\+\)/)).toBeVisible();

  await go(page, '/tabaco/clientes');
  await page.getByRole('tab', { name: /^Personas/ }).click();
  const fila = page.getByRole('list', { name: 'Personas' }).getByRole('button', { name: 'Ver Lucía Fernández' });
  await expect(fila).toContainText('1 compra');
  await fila.click();
  const ficha = page.getByRole('dialog', { name: 'Lucía Fernández' });
  await expect(ficha.getByRole('list', { name: 'Historial de compras' }).getByRole('button')).toHaveCount(1);
});

test('pedido a nombre de una persona que ya existe: se sugiere al escribir y no se duplica', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  // La persona compró antes.
  await go(page, '/tabaco/venta-rapida');
  await page.getByRole('tablist', { name: 'Tipo de cliente' }).getByRole('tab', { name: 'Persona' }).click();
  await page.getByLabel('Nombre de la persona').fill('Ana Pérez');
  await page.getByRole('button', { name: 'Crear «Ana Pérez»' }).click();
  await toast(page, 'Cliente nuevo: Ana Pérez.');

  await go(page, '/tabaco/pedido-telefono');
  await page.getByRole('tablist', { name: 'Tipo de cliente' }).getByRole('tab', { name: 'Persona' }).click();
  // Escrito de otra forma: es la misma persona.
  await page.getByLabel('Nombre de la persona').fill('ana perez');
  const sugerida = page.getByRole('list', { name: 'Personas' }).getByRole('button', { name: /Ana Pérez/ });
  await expect(sugerida).toBeVisible();
  await expect(page.getByRole('button', { name: /^Crear «/ })).toHaveCount(0);
  await sugerida.click();
  await expect(page.locator('[data-cliente="persona"]')).toContainText('Ana Pérez');

  await page.getByRole('button', { name: /^Agregar / }).first().click();
  const crear = page.getByRole('button', { name: 'Crear pedido' });
  await expect(crear).toBeDisabled();
  await page.getByRole('checkbox', { name: /Tiene 21 años o más/ }).check();
  await crear.click();
  await toast(page, /Pedido P-\d{4} anotado para Ana Pérez/);

  // Sigue habiendo una sola Ana Pérez.
  await go(page, '/tabaco/clientes');
  await page.getByRole('tab', { name: /^Personas/ }).click();
  await expect(page.getByRole('list', { name: 'Personas' }).getByRole('button', { name: /^Ver Ana Pérez/ })).toHaveCount(1);
});

test('venta de mostrador «Almacén»: un toque, nota opcional y sin «A cuenta»', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/venta-rapida');
  await page.getByRole('tablist', { name: 'Tipo de cliente' }).getByRole('tab', { name: 'Almacén' }).click();
  await expect(page.locator('[data-cliente="almacen"]')).toContainText('Almacén (mostrador)');
  await agregarProducto(page);
  await expect(page.getByRole('button', { name: 'A cuenta' })).toHaveCount(0);
  await page.getByLabel('Nota (opcional)').fill('Lo lleva Pepe');
  await page.getByRole('checkbox', { name: /tiene 21 años o más/ }).check();
  await page.getByRole('button', { name: /^Cobrar \$/ }).click();
  await toast(page, /Venta F-\d{4} cobrada/);

  await go(page, '/tabaco/clientes');
  await page.getByRole('tab', { name: /^Almacén/ }).click();
  await expect(page.getByRole('button', { name: 'Ver Almacén (mostrador)' })).toContainText('1 compra');
  // Los totales separan Locales, Personas y Almacén.
  await expect(page.getByTestId('totales-clientes').getByRole('region')).toHaveCount(3);
});

test('un tabaco de mazo 7 × 70 nuevo sale a 40 $ con la regla de Ajustes; a mano manda', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/ajustes');
  const regla = page.getByRole('region', { name: 'Regla de precio por medida' });
  await regla.getByLabel('Precio por mazo (USD)').fill('35');
  await regla.getByLabel('Medidas que van aparte').fill('6 1/2x64, 7x70');
  await expect(regla.getByText('Entiendo: 6½ × 64 · 7 × 70')).toBeVisible();
  await regla.getByLabel('Precio de esas medidas (USD)').fill('40');
  await regla.getByRole('button', { name: 'Guardar regla' }).click();
  await toast(page, 'Regla de precio guardada.');

  await go(page, '/tabaco/catalogo/nuevo');
  await page.getByRole('button', { name: /De mazo/ }).click();
  await page.getByLabel('Vitola', { exact: true }).fill('Gran Corona');
  await page.getByLabel('Largo (pulgadas)').fill('7');
  await page.getByLabel('Cepo (/64″)').fill('70');
  const precio = page.getByLabel('Precio base por mazo');
  await expect(precio).toHaveValue('40');
  await expect(page.getByTestId('precio-regla')).toHaveText(/Sale de la regla de Ajustes \(7 × 70\): \$40\.00/);
  // Otra medida: 35.
  await page.getByLabel('Cepo (/64″)').fill('52');
  await expect(precio).toHaveValue('35');
  await page.getByLabel('Cepo (/64″)').fill('70');
  await expect(precio).toHaveValue('40');
  // A mano manda (y se puede volver a la regla).
  await precio.fill('42');
  await expect(page.getByTestId('precio-regla')).toContainText('A mano: manda sobre la regla, que diría $40.00');
  await page.getByRole('button', { name: 'Usar la regla' }).click();
  await expect(precio).toHaveValue('40');

  await page.getByLabel('Capa', { exact: true }).selectOption('maduro');
  await page.getByLabel('Fortaleza').selectOption('media');
  await page.getByLabel('PVP sugerido por mazo').fill('70');
  await page.getByLabel('Costo por mazo (USD)').fill('12');
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await toast(page, /Producto creado/);
  await expect(page.getByRole('heading', { level: 1, name: /^Gran Corona/ })).toBeVisible();
  await expect(page.getByText('$40.00').first()).toBeVisible();
});
