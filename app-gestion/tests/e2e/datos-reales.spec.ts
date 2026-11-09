// Datos reales: empezar en blanco, importar los productos desde el Excel de Odoo y la copia de
// seguridad de la línea. (El arranque sin datos de ejemplo se prueba en sin-demo.spec.ts.)
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

test('Tabaco empieza en blanco, importa el Excel de Odoo y guarda y recupera su copia', async ({ page }, info) => {
  const tag = info.project.name;
  await enterAs(page, 'tabaco:admin');

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
  // En Ajustes, el panel de datos dice que son reales y que viven solo en este navegador.
  await expect(page.locator('[aria-label="Datos de Tabaco"] [data-modo="real"]')).toContainText('Datos reales · solo en este navegador');
  await shot(page, `ajustes-real-${tag}`);

  // El inicio propone empezar por el catálogo; el catálogo queda vacío.
  await go(page, '/tabaco');
  await expect(page.getByText('Tabaco está en blanco, lista para tus datos.')).toBeVisible();
  await go(page, '/tabaco/catalogo');
  await expect(page.getByRole('heading', { name: 'Catálogo', level: 1 })).toBeVisible();
  await expect(page.getByText('Aún no hay productos')).toBeVisible();

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

  // Copia de seguridad: el inicio avisa (nunca se exportó), se exporta y se vuelve a importar.
  await go(page, '/tabaco');
  const notice = page.getByTestId('aviso-copia');
  await expect(notice).toContainText('Todavía no hay una copia de seguridad de Tabaco.');
  const [download] = await Promise.all([page.waitForEvent('download'), notice.getByRole('button', { name: 'Exportar ahora' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^copia-tabaco-\d{4}-\d{2}-\d{2}\.json$/);
  await toast(page, /Copia descargada/);
  await expect(notice).toHaveCount(0);
  await go(page, '/tabaco/ajustes');
  await page.getByLabel('Elegir copia de Tabaco').setInputFiles(await download.path());
  const restore = page.getByRole('dialog', { name: 'Importar copia de Tabaco' });
  await expect(restore).toContainText('18 productos');
  await restore.getByRole('button', { name: 'Sí, reemplazar' }).click();
  await toast(page, /Tabaco quedó como en la copia/);
  await go(page, '/tabaco/catalogo');
  await page.getByLabel('Buscar en el catálogo').fill('');
  await expect(page.getByTestId('resultados')).toContainText('18 productos');
});

/** Una foto de prueba (PNG) dibujada en el navegador. */
async function testPng(page: Page, w: number, h: number, hue: number): Promise<Buffer> {
  const b64 = await page.evaluate(
    ({ w, h, hue }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      g.fillStyle = `hsl(${hue} 60% 45%)`;
      g.fillRect(0, 0, w, h);
      g.fillStyle = `hsl(${hue} 60% 75%)`;
      g.fillRect(w / 4, h / 4, w / 2, h / 2);
      return c.toDataURL('image/png').split(',')[1]!;
    },
    { w, h, hue },
  );
  return Buffer.from(b64, 'base64');
}

test('fotos en lote: por el nombre del archivo, hasta 3, ordenadas y recortadas', async ({ page }, info) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/catalogo');
  await page.getByRole('link', { name: 'Fotos en lote' }).click();
  await expect(page.getByRole('heading', { name: 'Fotos en lote', level: 1 })).toBeVisible();
  await page.getByLabel('Elegir las fotos de los productos').setInputFiles([
    { name: 'TB-BIS-ROB50.png', mimeType: 'image/png', buffer: await testPng(page, 640, 480, 30) },
    { name: 'tb-bis-rob50 (2).png', mimeType: 'image/png', buffer: await testPng(page, 480, 640, 200) },
    { name: 'NO-EXISTE-1.png', mimeType: 'image/png', buffer: await testPng(page, 200, 200, 120) },
  ]);
  await expect(page.getByTestId('resumen-fotos')).toHaveText('2 fotos van a 1 producto · 1 sin producto');
  await expect(page.getByRole('heading', { name: 'Biscayne Robusto' })).toBeVisible();
  await expect(page.getByText('NO-EXISTE-1.png')).toBeVisible();
  await page.getByLabel('Recortar cuadradas (al centro)').check();
  // La segunda pasa a ser la principal.
  await page.getByRole('button', { name: 'Subir: tb-bis-rob50 (2).png' }).click();
  await fitsPhone(page, info.project.name);
  await shot(page, `fotos-lote-${info.project.name}`);
  await page.getByRole('button', { name: 'Guardar 2 fotos' }).click();
  await toast(page, /Listo: 2 fotos en 1 producto/);

  await go(page, '/tabaco/catalogo/t-prd_0001');
  await expect(page.getByRole('heading', { name: 'Biscayne Robusto', level: 1 })).toBeVisible();
  await expect(page.getByAltText('Foto del producto')).toHaveCount(2);
  // Las fotos se recortaron cuadradas y se guardaron en WebP (o JPEG si el navegador no puede).
  const sizes = await page.getByAltText('Foto del producto').evaluateAll((imgs) => imgs.map((i) => [(i as HTMLImageElement).naturalWidth, (i as HTMLImageElement).naturalHeight]));
  expect(sizes).toEqual([
    [480, 480],
    [480, 480],
  ]);
  await page.getByRole('button', { name: 'Ordenar' }).click();
  const order = page.getByRole('dialog', { name: 'Ordenar fotos' });
  await order.getByRole('button', { name: 'Bajar: Era la principal' }).click();
  await order.getByRole('button', { name: 'Guardar orden' }).click();
  await toast(page, 'Orden de las fotos guardado.');
});
