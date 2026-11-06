// Ronda 3 · almacén: el escáner (leer de una foto, escribir a mano y asignar un código), las
// etiquetas, la trazabilidad de una caja, contar el almacén, preparar escaneando y recibir una
// importación bulto por bulto (con su lista de empaque y las diferencias).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Arrival, Product } from '../../src/data/types';
import { internalEan13 } from '../../src/lib/barcode';
import { buildLine } from '../../src/seed';
import { enterAs, go, toast } from './helpers';

/** EAN-13 inventado (prefijo 200) de «Toro 6 × 52 · Habano», dibujado con nuestro encoder. */
const FOTO = { name: 'codigo-ejemplo.png', mimeType: 'image/png', buffer: readFileSync(new URL('../fixtures/codigo-ejemplo.png', import.meta.url)) };

/** La semilla es determinista: los mismos datos que arma la app al abrirla hoy. */
function seed() {
  const t = buildLine('tabaco', new Date());
  return { arrivals: t.arrivals as Arrival[], products: t.products as Product[] };
}

/** El número que muestra una cifra: «Disponible en almacén: 1,234» → 1234. */
async function statValue(page: Page, label: string): Promise<number> {
  const el = page.getByLabel(new RegExp(`^${label}: `)).first();
  await expect(el).toBeVisible();
  const text = (await el.getAttribute('aria-label')) ?? '';
  return Number(text.slice(label.length + 2).replace(/[^0-9-]/g, ''));
}

test('buscar código: leer de una foto, escribir uno que no existe y asignarlo', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/codigos');
  await expect(page.getByRole('heading', { name: 'Buscar código', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  const lector = page.getByRole('dialog', { name: 'Escanear un código' });
  await expect(lector.getByRole('button', { name: 'Leer de una foto' })).toBeVisible();
  await lector.getByLabel('Leer de una foto').setInputFiles(FOTO);
  await expect(page.getByRole('heading', { name: 'Toro 6 × 52 · Habano' })).toBeVisible();
  await expect(page.getByText('Producto · por su código de barras')).toBeVisible();
  await expect(page.getByText('Disponible en almacén')).toBeVisible();
  // La cámara se apagó al cerrarse el lector.
  await expect(page.getByRole('dialog', { name: 'Escanear un código' })).toHaveCount(0);
  expect(await page.evaluate(() => Array.from(document.querySelectorAll('video')).some((v) => v.srcObject))).toBe(false);

  // Un código que no existe, escrito a mano en el lector.
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await page.getByRole('dialog', { name: 'Escanear un código' }).getByTestId('codigo-manual').fill('gm-prueba-77');
  await page.getByRole('dialog', { name: 'Escanear un código' }).getByRole('button', { name: 'Usar este código' }).click();
  await expect(page.getByText('No conozco el código GMPRUEBA77')).toBeVisible();
  await page.getByRole('button', { name: 'Asignar este código a un producto' }).click();
  const asignar = page.getByRole('dialog', { name: 'Asignar este código a un producto' });
  await asignar.getByPlaceholder(/Buscar por nombre/).fill('churchill');
  await asignar.getByRole('button', { name: 'Asignar a Churchill 7 × 48 · Connecticut' }).click();
  await toast(page, /Churchill 7 × 48 · Connecticut ahora tiene el código GMPRUEBA77/);
  await expect(page.getByRole('heading', { name: 'Churchill 7 × 48 · Connecticut' })).toBeVisible();
});

test('buscar código: una caja con todo su camino', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/codigos');
  await page.getByLabel('Código', { exact: true }).fill('C-IMP-2026-001-0001');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  const caja = page.getByRole('region', { name: 'Caja C-IMP-2026-001-0001' });
  await expect(caja.getByText('Caja con trazabilidad')).toBeVisible();
  await expect(caja.getByText(/Torcedor: /)).toBeVisible();
  await expect(caja.getByText('Importación IMP-2026-001')).toBeVisible();
  await expect(caja.getByText(/Entrega E-\d{4}/)).toBeVisible();
  await caja.getByRole('button', { name: 'Imprimir la etiqueta de la caja' }).click();
  await expect(caja.getByTestId('pdf-etiquetas')).toHaveAttribute('href', /^blob:/);
});

test('imprimir etiquetas: todas las variantes de una familia en un PDF', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/catalogo');
  await page.getByRole('button', { name: 'Imprimir etiquetas' }).click();
  const hoja = page.getByRole('dialog', { name: 'Imprimir etiquetas' });
  await hoja.getByPlaceholder(/Buscar por nombre/).fill('toro 6 × 52');
  await hoja.getByRole('button', { name: 'Todas las de esta familia' }).click();
  await hoja.getByRole('tab', { name: 'Térmica 2″ × 1″' }).click();
  await hoja.getByRole('button', { name: 'Crear PDF (3 etiquetas)' }).click();
  await toast(page, /PDF listo: 3 etiquetas/);
  await expect(hoja.getByTestId('pdf-etiquetas')).toHaveAttribute('href', /^blob:/);
});

test('contar el almacén: escanear, revisar contra el libro y guardar el ajuste', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/almacen');
  await page.getByRole('link', { name: 'Contar' }).click();
  await expect(page.getByRole('heading', { name: 'Contar el almacén', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  const lector = page.getByRole('dialog', { name: 'Contar escaneando' });
  await lector.getByLabel('Leer de una foto').setInputFiles(FOTO);
  await expect(lector.getByTestId('lector-ultimo')).toContainText('+1 · Toro 6 × 52 · Habano: 1 mazo');
  // Otro producto, escribiendo su SKU sin guiones.
  await lector.getByTestId('codigo-manual').fill('tbmzrobhab50');
  await lector.getByRole('button', { name: 'Usar este código' }).click();
  await expect(lector.getByTestId('lector-ultimo')).toContainText('Robusto 5 × 50 · Habano: 1 mazo');
  await lector.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('spinbutton', { name: 'Cantidad de Contados de Toro 6 × 52 · Habano' }).fill('7');
  // Se puede dejar y seguir después: el conteo sigue ahí al volver.
  await go(page, '/tabaco/almacen');
  await go(page, '/tabaco/almacen/contar');
  await expect(page.getByRole('spinbutton', { name: 'Cantidad de Contados de Toro 6 × 52 · Habano' })).toHaveValue('7');
  await page.getByRole('button', { name: 'Revisar y guardar' }).click();
  const revisar = page.getByRole('dialog', { name: 'Revisar el conteo' });
  await expect(revisar.getByText('Contado: 7 mazos')).toBeVisible();
  await revisar.getByRole('button', { name: 'Guardar conteo' }).click();
  await toast(page, /Conteo guardado: 2 ajustes en el libro/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Almacén Miami');
  await page.getByRole('tab', { name: 'Libro de movimientos' }).click();
  await expect(page.getByRole('cell', { name: 'Ajuste' }).first()).toBeVisible();
  // t-prd_0013 es «Toro 6 × 52 · Habano» en la semilla.
  await go(page, '/tabaco/catalogo/t-prd_0013');
  await expect(page.getByRole('heading', { name: 'Toro 6 × 52 · Habano', level: 1 })).toBeVisible();
  expect(await statValue(page, 'Disponible en almacén')).toBe(7);
});

test('preparar una entrega escaneando', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/entregas');
  const card = page.getByRole('article').filter({ hasText: 'Puro y Café Doral' }).first();
  await card.getByRole('button', { name: 'Preparar escaneando' }).click();
  const hoja = page.getByRole('dialog', { name: /Preparar E-\d{4} escaneando/ });
  await hoja.getByRole('button', { name: 'Escanear', exact: true }).click();
  const lector = page.getByRole('dialog', { name: /Juntar E-\d{4}/ });
  // Brickell Belicoso: código interno de ejemplo.
  await lector.getByTestId('codigo-manual').fill(internalEan13(1011));
  await lector.getByRole('button', { name: 'Usar este código' }).click();
  await expect(lector.getByTestId('lector-ultimo')).toContainText('Brickell Belicoso: 1 de 20');
  await lector.getByRole('button', { name: 'Cerrar' }).click();
  await expect(hoja.getByText('1 de 20', { exact: true })).toBeVisible();
  await hoja.getByRole('button', { name: 'Preparar con lo juntado' }).click();
  await toast(page, /Preparada con 1 u\./);
});

test('recibir una importación bulto por bulto: todos «Bien» menos uno con falta', async ({ page }) => {
  const { arrivals, products } = seed();
  const a = arrivals.find((x) => x.status === 'aduana' && x.bales?.length)!;
  const first = a.bales!.find((b) => b.number === '1')!;
  const product = products.find((p) => p.id === first.items[0]!.productId)!;
  const total = a.items.find((i) => i.productId === product.id)!.qty;
  await enterAs(page, 'tabaco:admin');
  await go(page, `/tabaco/catalogo/${product.id}`);
  const before = await statValue(page, 'Disponible en almacén');

  await go(page, '/tabaco/almacen?tab=llegadas');
  const card = page.getByRole('listitem', { name: `Importación ${a.code}` });
  await expect(card.getByText('En aduana', { exact: true })).toBeVisible();
  await expect(card.getByText(/· 12 bultos/)).toBeVisible();
  await card.getByRole('button', { name: 'Confirmar bultos' }).click();
  await expect(page.getByRole('heading', { name: a.code, level: 1 })).toBeVisible();
  await expect(page.getByText('0 de 12 bultos revisados', { exact: true })).toBeVisible();

  // Bulto 1: vinieron 3 mazos menos de lo que dice la lista.
  await page.getByRole('button', { name: 'Contar el bulto 1', exact: true }).click();
  const bulto = page.getByRole('dialog', { name: 'Bulto 1' });
  const menos = bulto.getByRole('button', { name: `Quitar una unidad de Contados de ${product.name}` });
  for (let i = 0; i < 3; i++) await menos.click();
  await expect(bulto.getByText('Faltan 3 mazos')).toBeVisible();
  await bulto.getByLabel('Nota (opcional)').fill('Faltan 3 mazos, el bulto venía abierto');
  await bulto.getByRole('button', { name: 'Guardar conteo' }).click();
  await toast(page, 'Bulto 1: falta.');
  await expect(page.getByText('1 de 12 bultos revisados', { exact: true })).toBeVisible();

  // Los demás, «Bien» de un toque.
  for (let n = 2; n <= 12; n++) {
    await page.getByRole('button', { name: `Bulto ${n}: bien`, exact: true }).click();
    await expect(page.getByText(`${n} de 12 bultos revisados`, { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Recibir en almacén' }).click();
  const recibir = page.getByRole('dialog', { name: `Recibir ${a.code}` });
  await expect(recibir.getByText(`faltan 3`)).toBeVisible();
  await recibir.getByRole('button', { name: 'Recibir en almacén' }).click();
  await toast(page, new RegExp(`${a.code} recibida`));
  await expect(page.getByText('Recibida', { exact: true }).first()).toBeVisible();

  // Entró lo contado, y las diferencias quedan para reclamar (CSV y PDF).
  const fila = page.getByRole('list', { name: 'Lo que trae' }).getByRole('listitem', { name: product.name });
  await expect(fila.getByTestId('entro')).toHaveText(`Entró al almacén: ${total - 3} mazos`);
  const dif = page.getByRole('region', { name: 'Diferencias de la importación' });
  await expect(dif.getByText('Faltan 3 mazos').first()).toBeVisible();
  await expect(dif.getByText('«Faltan 3 mazos, el bulto venía abierto»')).toBeVisible();
  const csv = dif.getByTestId('diferencias-csv');
  await expect(csv).toHaveAttribute('href', /^blob:/);
  const csvText = await page.evaluate(async (u) => (await fetch(u)).text(), (await csv.getAttribute('href'))!);
  expect(csvText).toContain('Faltan 3 mazos, el bulto venía abierto');
  expect(csvText).toContain(`Diferencias de la importación ${a.code}`);
  await dif.getByRole('button', { name: 'Ver en PDF' }).click();
  await expect(dif.getByTestId('diferencias-pdf')).toHaveAttribute('href', /^blob:/);

  await go(page, `/tabaco/catalogo/${product.id}`);
  await expect.poll(() => statValue(page, 'Disponible en almacén')).toBe(before + total - 3);
});

test('cargar una lista de empaque desde un CSV: columnas, productos y un bulto mixto', async ({ page }) => {
  const { arrivals } = seed();
  const a = arrivals.find((x) => x.status === 'produccion' && !x.bales?.length)!;
  await enterAs(page, 'tabaco:admin');
  await go(page, `/tabaco/almacen/llegadas/${a.id}`);
  await page.getByRole('button', { name: 'Cargar lista de empaque' }).click();
  const hoja = page.getByRole('dialog', { name: 'Lista de empaque' });
  const csv = [
    'Bulto,Medida o vitola,Capa,Mazos,Tabacos por mazo,Costo',
    '1,52 torpedo,maduro,50,25,11.40',
    '2,6x52 Toro,Habano,30,25,10.50',
    ',6x52 Toro,Maduro,20,25,10.90',
    '3,Lancero,Natural,40,25,9',
    'Total,,,140,,',
  ].join('\n');
  await hoja.getByTestId('lista-empaque-archivo').setInputFiles({ name: 'lista-de-empaque.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(hoja.getByText('lista-de-empaque.csv')).toBeVisible();
  await expect(hoja.getByLabel('Mazos (cantidad)')).toHaveValue('3');
  await hoja.getByRole('button', { name: 'Seguir' }).click();
  await expect(hoja.getByText('«Lancero Natural»', { exact: true })).toBeVisible();
  await hoja.getByLabel('Producto para «Lancero Natural»').selectOption({ label: 'Churchill 7 × 48 · Habano' });
  await hoja.getByRole('button', { name: 'Seguir' }).click();
  await expect(hoja.getByText(/3 bultos · 140 en total/)).toBeVisible();
  await hoja.getByRole('button', { name: 'Guardar lista de empaque' }).click();
  await toast(page, 'Lista de empaque guardada: 3 bultos.');
  await expect(page.getByText('3 bultos · 140 en total · 1 mixto')).toBeVisible();
});

test('nada de lo nuevo del almacén se sale del ancho del teléfono', async ({ page }, info) => {
  test.skip(info.project.name !== 'telefono', 'Solo tiene sentido en el teléfono.');
  const { arrivals } = seed();
  const confirming = arrivals.find((x) => x.status === 'confirmando')!;
  const customs = arrivals.find((x) => x.status === 'aduana' && x.bales?.length)!;
  await enterAs(page, 'tabaco:admin');
  const wide: string[] = [];
  for (const hash of [
    '/tabaco/codigos',
    `/tabaco/codigos?c=${internalEan13(1013)}`,
    '/tabaco/codigos?c=CIMP20260010001',
    '/tabaco/codigos?c=E0001',
    '/tabaco/almacen?tab=llegadas',
    '/tabaco/almacen/contar',
    `/tabaco/almacen/llegadas/${confirming.id}`,
    `/tabaco/almacen/llegadas/${customs.id}`,
  ]) {
    await go(page, hash);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.waitForTimeout(600);
    const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    if (w.scroll > w.client + 1) wide.push(`${hash}: ${w.scroll}px de ${w.client}px`);
  }
  expect(wide, 'pantallas más anchas que el teléfono').toEqual([]);
});
