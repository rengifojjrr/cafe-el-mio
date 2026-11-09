// Para las pruebas del navegador con el servidor: todo lo que va al servidor lo responde uno de
// mentira (tests/servidor-falso.ts). Nada sale a internet.
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { SERVIDOR } from '../../src/servidor/config';
import type { ServidorFalso } from '../servidor-falso';

export async function conServidorFalso(context: BrowserContext, servidor: ServidorFalso): Promise<void> {
  await context.route(`${SERVIDOR.url}/**`, async (route) => {
    const req = route.request();
    const headers = req.headers();
    const buf = req.postDataBuffer();
    const tipo = headers['content-type'] ?? '';
    const body = buf ? (tipo.includes('json') || tipo.startsWith('text/') ? buf.toString('utf8') : new Uint8Array(buf)) : null;
    try {
      const r = await servidor.responder({ method: req.method(), url: req.url(), headers, body });
      await route.fulfill({ status: r.status, headers: r.headers, body: typeof r.body === 'string' ? r.body : Buffer.from(r.body) });
    } catch {
      await route.abort('internetdisconnected');
    }
  });
}

/** Entra desde la portada con correo y contraseña. */
export async function entrarConCorreo(page: Page, correo: string, clave: string): Promise<void> {
  await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
  const hoja = page.getByRole('dialog', { name: 'Entrar' });
  await hoja.getByLabel('Correo').fill(correo);
  await hoja.getByLabel('Contraseña').fill(clave);
  await hoja.getByRole('button', { name: 'Entrar', exact: true }).click();
}

export async function alDia(page: Page): Promise<void> {
  await expect(page.getByTestId('estado-servidor').first()).toHaveAttribute('data-fase', 'al-dia', { timeout: 20_000 });
}

/** Espera a que la app termine de arrancar en blanco (la línea ya es de datos reales). */
export async function arrancoEnBlanco(page: Page): Promise<void> {
  // `waitForFunction` no espera una promesa: se pregunta con `expect.poll`.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const req = indexedDB.open('tabaco-datos');
              req.onerror = () => resolve(false);
              req.onsuccess = () => {
                const db = req.result;
                try {
                  const g = db.transaction('settings').objectStore('settings').get('settings');
                  g.onsuccess = () => {
                    db.close();
                    resolve((g.result as { dataMode?: string } | undefined)?.dataMode === 'real');
                  };
                  g.onerror = () => {
                    db.close();
                    resolve(false);
                  };
                } catch {
                  db.close();
                  resolve(false);
                }
              };
            }),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
}
