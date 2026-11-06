// En el teléfono ninguna pantalla puede ser más ancha que la pantalla: si lo es, el navegador
// aleja la vista y los toques caen fuera de los botones (pasó con el catálogo y los gráficos).
import { expect, test, type Page } from '@playwright/test';
import { enterAs, go } from './helpers';

const SCREENS: Record<string, string[]> = {
  'tabaco:admin': [
    '/tabaco',
    '/tabaco/catalogo',
    '/tabaco/catalogo/t-prd_0001',
    '/tabaco/locales',
    '/tabaco/entregas',
    '/tabaco/cobros',
    '/tabaco/contabilidad',
    '/tabaco/rentabilidad',
    '/tabaco/usuarios',
    '/tabaco/contratos',
    '/tabaco/ajustes',
    // Ronda 3 · venta en firme y precios
    '/tabaco/venta-rapida',
    '/tabaco/pedido-telefono?local=t-loc_f0001',
    '/tabaco/pegar-pedido',
    '/tabaco/ajustes/precios',
    '/tabaco/locales/t-loc_f0001',
  ],
  'tabaco:seller': ['/tabaco', '/tabaco/locales', '/tabaco/pedidos', '/tabaco/comisiones', '/tabaco/contratos'],
  'tabaco:store': ['/tabaco', '/tabaco/catalogo', '/tabaco/cuentas', '/tabaco/entregas', '/tabaco/contratos'],
  'cafe:admin': ['/cafe', '/cafe/catalogo', '/cafe/almacen', '/cafe/contabilidad'],
  'cafe:store': ['/cafe', '/cafe/catalogo', '/cafe/cuentas'],
};

async function pageWidth(page: Page): Promise<{ scroll: number; client: number }> {
  return page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
}

for (const [account, screens] of Object.entries(SCREENS)) {
  test(`nada se sale del ancho del teléfono: ${account}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'telefono', 'Solo tiene sentido en el teléfono.');
    await enterAs(page, account);
    const wide: string[] = [];
    for (const hash of screens) {
      await go(page, hash);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      // Las listas y los gráficos se dibujan un momento después del título.
      await page.waitForTimeout(600);
      const w = await pageWidth(page);
      if (w.scroll > w.client + 1) wide.push(`${hash}: ${w.scroll}px de ${w.client}px`);
    }
    expect(wide, 'pantallas más anchas que el teléfono').toEqual([]);
  });
}
