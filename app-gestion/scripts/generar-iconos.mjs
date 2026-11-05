// Genera los íconos PNG de la PWA a partir de un diseño en HTML/SVG (usa el Chrome del sistema).
// Se corre una sola vez; los PNG quedan en public/icons/ y van al repositorio.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const fuente = await readFile(join(raiz, 'public/marca/fonts/bodoni-moda.woff2'));
const font = `data:font/woff2;base64,${fuente.toString('base64')}`;

function html(size, maskable) {
  const pad = maskable ? size * 0.14 : 0;
  const r = maskable ? 0 : size * 0.22;
  return `<!doctype html><html><head><style>
  @font-face{font-family:B;src:url(${font}) format('woff2');font-weight:400 900}
  html,body{margin:0;width:${size}px;height:${size}px;background:transparent}
  .i{width:${size}px;height:${size}px;border-radius:${r}px;background:radial-gradient(circle at 80% 10%,#2a2112 0,#0b0d10 60%);position:relative;overflow:hidden}
  .w{position:absolute;inset:${pad}px;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .gm{font-family:B,serif;font-weight:700;color:#f1ede6;font-size:${(size - pad * 2) * 0.42}px;letter-spacing:-0.03em;line-height:1}
  .bar{display:flex;gap:${size * 0.02}px;margin-top:${size * 0.05}px}
  .bar span{display:block;height:${size * 0.045}px;width:${(size - pad * 2) * 0.24}px;border-radius:99px}
  </style></head><body><div class="i"><div class="w"><div class="gm">GM</div><div class="bar"><span style="background:#d9a441"></span><span style="background:#f7b11b"></span></div></div></div></body></html>`;
}

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size, maskable));
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.screenshot({ path: join(raiz, 'public/icons', name), omitBackground: !maskable });
  console.log('icono', name);
}
await browser.close();
