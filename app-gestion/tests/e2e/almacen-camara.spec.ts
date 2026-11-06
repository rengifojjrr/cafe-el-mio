// El lector con la cámara de verdad (una cámara falsa de Chrome que muestra un código de barras):
// prende la cámara, lee el código, y al cerrarse no deja ninguna pista de la cámara prendida.
// El video (Y4M) se arma aquí con nuestro encoder; no se guarda en el repositorio.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { internalEan13 } from '../../src/lib/barcode';
import { ean13Modules } from '../../src/lib/barcode-draw';
import { enterAs, go } from './helpers';

/** Un video Y4M de un cuadro: el EAN-13 inventado de «Toro 6 × 52 · Habano» en blanco y negro. */
function barcodeVideo(): string {
  const modules = ean13Modules(internalEan13(1013));
  const W = 640;
  const H = 480;
  const X = 4;
  const left = Math.floor((W - modules.length * X) / 2);
  const y = Buffer.alloc(W * H, 235);
  for (let row = 150; row < 330; row++) {
    for (let col = 0; col < W; col++) {
      const m = Math.floor((col - left) / X);
      if (m >= 0 && m < modules.length && modules[m]) y[row * W + col] = 16;
    }
  }
  const chroma = Buffer.alloc((W / 2) * (H / 2), 128);
  const file = join(tmpdir(), `gm-camara-${process.pid}.y4m`);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), Buffer.from('FRAME\n'), y, chroma, chroma]));
  return file;
}

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${barcodeVideo()}`] },
  permissions: ['camera'],
});

/** Guarda cada pista que entrega la cámara para revisar después que quedaron apagadas. */
async function trackCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __pistas: MediaStreamTrack[] };
    w.__pistas = [];
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) return;
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      const s = await original(c);
      w.__pistas.push(...s.getTracks());
      return s;
    };
  });
}

async function trackStates(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __pistas: MediaStreamTrack[] }).__pistas.map((t) => t.readyState));
}

test('el lector lee con la cámara y la apaga al cerrarse', async ({ page }) => {
  await trackCamera(page);
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/codigos');
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Toro 6 × 52 · Habano' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('dialog', { name: 'Escanear un código' })).toHaveCount(0);
  const states = await trackStates(page);
  expect(states.length).toBeGreaterThan(0);
  expect(states.every((s) => s === 'ended'), `pistas: ${states.join(', ')}`).toBe(true);
});

test('contando: cada lectura suma, la misma no se repite enseguida, y cerrar apaga la cámara', async ({ page }) => {
  await trackCamera(page);
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/almacen/contar');
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  const lector = page.getByRole('dialog', { name: 'Contar escaneando' });
  const shows = (text: string) => page.waitForFunction((t) => document.querySelector('[data-testid="lector-ultimo"]')?.textContent?.includes(t) ?? false, text, { timeout: 30_000 });
  await shows('Toro 6 × 52 · Habano: 1 mazo');
  const first = Date.now();
  // La cámara sigue viendo el mismo código: la siguiente lectura cuenta recién pasados 1.5 s.
  await shows('Toro 6 × 52 · Habano: 2 mazos');
  expect(Date.now() - first).toBeGreaterThan(1100);
  expect((await trackStates(page)).some((s) => s === 'live')).toBe(true);
  await lector.getByRole('button', { name: 'Cerrar' }).click();
  await expect(lector).toHaveCount(0);
  expect((await trackStates(page)).every((s) => s === 'ended')).toBe(true);
});
