// En espera, como el programa de café (docs/CAFE-EN-ESPERA.md): no corre con el de Tabaco.
// Cuando se active el café, se corre contra su propia compilación (ver ese documento).
// En el teléfono ninguna pantalla puede ser más ancha que la pantalla: si lo es, el navegador
// aleja la vista y los toques caen fuera de los botones (pasó con el catálogo y los gráficos).
import { expect, test, type Page } from '@playwright/test';
import { enterAs, go } from '../helpers';

const SCREENS: Record<string, string[]> = {
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
