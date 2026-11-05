import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

/** Abre la portada (la primera vez se cargan los datos de ejemplo) y entra con una cuenta. */
export async function enterAs(page: Page, account: string): Promise<void> {
  if (!page.url().includes('/cafe-el-mio/gestion/')) {
    await page.goto('./#/');
  }
  const fab = page.getByTestId('cambiar-rol');
  if (await fab.isVisible().catch(() => false)) {
    await fab.click();
  } else {
    await page.goto('./#/');
    await page.getByRole('button', { name: 'Entrar como…' }).first().click();
  }
  const btn = page.locator(`[data-account="${account}"]`);
  await btn.click();
  const target = account === 'direccion' ? '#/direccion' : `#/${account.split(':')[0]}`;
  await page.waitForURL((url) => url.hash === target.slice(1) || url.hash === target);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
}

export async function go(page: Page, hash: string): Promise<void> {
  await page.goto(`./#${hash}`);
}

/** Dibuja una firma en el recuadro (canvas) que corresponde a la etiqueta. */
export async function sign(page: Page, canvas: Locator): Promise<void> {
  await canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No encontré el recuadro de la firma');
  const y = box.y + box.height * 0.55;
  await page.mouse.move(box.x + 20, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + 20 + i * ((box.width - 60) / 12), y + (i % 2 ? -18 : 14), { steps: 3 });
  }
  await page.mouse.up();
}

/** Guarda una captura en docs/capturas cuando se corre con CAPTURAS=1. */
export async function capture(page: Page, info: TestInfo, name: string): Promise<void> {
  if (!process.env.CAPTURAS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `../docs/capturas/${name}-${info.project.name === 'telefono' ? '390' : '1280'}.png` });
}

export async function toast(page: Page, text: RegExp | string): Promise<void> {
  await expect(page.getByRole('status').getByText(text).first()).toBeVisible();
}
