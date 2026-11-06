// «Contratos»: administración sube un PDF y ubica las firmas; el vendedor firma sobre ese PDF;
// la nota de entrega sale en la plantilla PDF; cada rol ve solo sus documentos firmados.
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { enterAs, go, sign, toast } from './helpers';

/** Un PDF de una página como el que subiría administración (se arma aquí: el repo no guarda PDF de prueba). */
async function samplePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Contrato de prueba (PDF subido en la prueba)', { x: 56, y: 720, size: 16, font });
  page.drawText('Texto de ejemplo. Las firmas van donde administracion las ubique.', { x: 56, y: 690, size: 11, font });
  return Buffer.from(await doc.save());
}

/**
 * Toca la primera página del editor en un punto dado en fracciones del ancho y del alto. Antes deja
 * ese punto en el medio de la pantalla: arriba y abajo quedan la barra de recuadros y la de guardar.
 */
async function tapPage(page: Page, fx: number, fy: number): Promise<void> {
  const overlay = page.getByTestId('pagina-1');
  await overlay.evaluate((el, f) => {
    const r = el.getBoundingClientRect();
    window.scrollBy(0, r.top + r.height * f - window.innerHeight / 2);
  }, fy);
  const box = await overlay.boundingBox();
  if (!box) throw new Error('No encontré la página del PDF');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

test('administración sube un PDF, ubica las firmas y el vendedor firma sobre ese PDF', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/contratos');
  await expect(page.getByRole('heading', { level: 1, name: 'Contratos', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^Plantillas/ }).click();
  await expect(page.getByTestId('plantilla-activa-consignacion')).toContainText('Usa el texto de Ajustes');

  await page.getByTestId('subir-consignacion').setInputFiles({ name: 'contrato-prueba.pdf', mimeType: 'application/pdf', buffer: await samplePdf() });
  await expect(page.getByRole('heading', { level: 1, name: 'Ubicar firmas' })).toBeVisible();
  await expect(page.getByTestId('pagina-1')).toBeVisible();
  const save = page.getByRole('button', { name: 'Guardar plantilla' });
  await expect(save).toBeDisabled();
  await expect(page.getByText('Falta: Firma del local y Firma del vendedor.')).toBeVisible();

  const tools = page.getByRole('radiogroup', { name: 'Qué recuadro poner' });
  await tools.getByRole('radio', { name: 'Firma del local', exact: true }).click();
  await tapPage(page, 0.3, 0.55);
  await tools.getByRole('radio', { name: 'Firma del vendedor', exact: true }).click();
  await tapPage(page, 0.3, 0.7);
  await tools.getByRole('radio', { name: 'Fecha', exact: true }).click();
  await tapPage(page, 0.3, 0.4);
  // Un recuadro de más se quita con el botón.
  await tools.getByRole('radio', { name: 'Dirección del local', exact: true }).click();
  await tapPage(page, 0.3, 0.25);
  await expect(page.locator('[data-field="direccion_local"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Quitar recuadro' }).click();
  await expect(page.locator('[data-field="direccion_local"]')).toHaveCount(0);
  await expect(page.locator('[data-field="firma_local"]')).toHaveCount(1);
  await expect(page.locator('[data-field="firma_vendedor"]')).toHaveCount(1);
  await expect(page.locator('[data-field="fecha"]')).toHaveCount(1);

  await expect(save).toBeEnabled();
  await save.click();
  await toast(page, /Plantilla guardada como versión nueva/);
  await expect(page.getByTestId('plantilla-activa-consignacion')).toContainText('Usa el PDF «contrato-prueba» · versión 1');

  // El vendedor encuentra el contrato pendiente en «Contratos» y lo prepara de nuevo para que tome el PDF.
  await enterAs(page, 'tabaco:seller');
  await go(page, '/tabaco/contratos');
  await expect(page.getByRole('tab', { name: /^Plantillas/ })).toHaveCount(0);
  await page.getByRole('tab', { name: /^Por firmar/ }).click();
  await page.locator('[data-document="contrato"]').filter({ hasText: 'Bodega La Esquina 49' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Contrato de consignación', exact: true })).toBeVisible();
  await expect(page.getByText(/Hay una plantilla de contrato más nueva/)).toBeVisible();
  await page.getByRole('button', { name: 'Preparar de nuevo' }).click();
  await toast(page, /Nueva versión lista para firmar/);
  await expect(page.getByRole('link', { name: 'Descargar PDF' })).toBeVisible();
  await expect(page.getByText('Plantilla de ejemplo: la revisa un abogado').first()).toBeVisible();

  await sign(page, page.getByRole('img', { name: 'Firma del encargado', exact: true }));
  await sign(page, page.getByRole('img', { name: 'Firma del vendedor', exact: true }));
  await page.getByText('Las dos partes aceptan firmar electrónicamente').click();
  await page.getByRole('button', { name: 'Firmar contrato' }).click();
  await toast(page, /Contrato firmado/);
  await expect(page.getByText(/Firmado el/).first()).toBeVisible();
  // El PDF firmado: la página de la plantilla con las firmas y el anexo de precios.
  // Plantilla (1 página) + anexo de precios (una o más páginas, según cuántos productos haya).
  await expect(page.getByRole('img', { name: /^Contrato de consignación de Bodega La Esquina 49, página 2 de \d+$/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Descargar PDF' })).toHaveAttribute('download', /contrato-bodega-la-esquina-49-v\d+\.pdf/);

  // Administración lo ve entre los firmados, marcado como PDF.
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/contratos');
  const firmado = page.locator('[data-document="contrato"]').filter({ hasText: 'Bodega La Esquina 49' }).first();
  await expect(firmado).toContainText('PDF');
  await expect(firmado).toContainText('Firmaron');
});

test('la nota de entrega sale en la plantilla PDF con la firma de quien recibe', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/contratos');
  await page.getByRole('tab', { name: /^Plantillas/ }).click();
  const card = page.getByLabel('Plantilla: Nota de entrega');
  await card.getByRole('button', { name: 'Crear PDF básico' }).click();
  await expect(page.getByTestId('pagina-1')).toBeVisible();
  await expect(page.locator('[data-field="firma_local"]')).toHaveCount(1);
  await expect(page.locator('[data-field="detalle_entrega"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Guardar plantilla' }).click();
  await toast(page, /Plantilla guardada/);
  await expect(page.getByTestId('plantilla-activa-entrega')).toContainText('Usa el PDF «Nota de entrega básica»');

  await card.getByRole('button', { name: 'Ver ejemplo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ejemplo con firmas' });
  await expect(dialog.getByRole('img', { name: 'Ejemplo con firmas, página 1 de 1' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar' }).click();

  // Administración prepara la entrega de Puro y Café Doral y la recibe pasándole el teléfono al encargado.
  await go(page, '/tabaco/entregas');
  await page.getByRole('article').filter({ hasText: 'Puro y Café Doral' }).first().getByRole('button', { name: 'Aprobar y preparar' }).click();
  await toast(page, /Preparada/);
  await page.getByRole('tab', { name: /^Listas para entregar/ }).click();
  await page.getByRole('article').filter({ hasText: 'Puro y Café Doral' }).first().getByRole('button', { name: 'Recibir con firma' }).click();
  const receive = page.getByRole('dialog');
  await sign(page, receive.locator('canvas'));
  await receive.getByRole('checkbox').first().check();
  await receive.locator('button[type="submit"]').click();
  await toast(page, /Entregad/);

  await go(page, '/tabaco/contratos');
  const nota = page.locator('[data-document="entrega"]').filter({ hasText: 'Puro y Café Doral' }).first();
  await expect(nota).toContainText('PDF');
  await nota.click();
  await expect(page.getByRole('link', { name: 'Descargar PDF' })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Nota de entrega E-\d+, página 1 de 1$/ })).toBeVisible();
});

test('el local ve sus contratos y notas firmadas, sin plantillas ni documentos de otros', async ({ page }) => {
  await enterAs(page, 'tabaco:store');
  await go(page, '/tabaco/contratos');
  await expect(page.getByRole('heading', { level: 1, name: 'Mis contratos' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Plantillas/ })).toHaveCount(0);
  await expect(page.locator('[data-document="contrato"]').first()).toBeVisible();
  await expect(page.locator('[data-document="entrega"]').first()).toBeVisible();
  await expect(page.getByText('Bodega La Esquina 49')).toHaveCount(0);
  await page.locator('[data-document="entrega"]').first().click();
  await expect(page.getByText('Recibió (dueño o encargado del local)')).toBeVisible();
  await expect(page.getByRole('link', { name: '‹ Mis contratos', exact: true })).toBeVisible();
});
