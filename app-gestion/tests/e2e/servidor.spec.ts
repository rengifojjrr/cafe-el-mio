// El programa con el servidor, en el navegador: entrar con correo y contraseña, la primera
// conexión, lo que sube y baja entre dos teléfonos, invitar a Dirección y cerrar sesión. Nada sale a
// internet: todo lo que va al servidor lo responde uno de mentira (tests/servidor-falso.ts).
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ServidorFalso } from '../servidor-falso';
import { go, toast } from './helpers';
import { alDia, arrancoEnBlanco, conServidorFalso, entrarConCorreo as entrar } from './servidor-helpers';

const XLSX = fileURLToPath(new URL('../fixtures/odoo-variantes.xlsx', import.meta.url));
const VACIO = { cookies: [], origins: [] };
const DUENA = 'duena@example.com';
const CLAVE = 'clave-segura-1';

async function telefono(browser: Browser, servidor: ServidorFalso, viewport = { width: 390, height: 844 }): Promise<Page> {
  const context = await browser.newContext({ storageState: VACIO, viewport, locale: 'es-US', timezoneId: 'America/New_York', serviceWorkers: 'block' });
  await conServidorFalso(context, servidor);
  return context.newPage();
}

test.describe('con el servidor', () => {
  test.use({ storageState: VACIO });

  test('se entra con correo y contraseña; lo cargado sube, otro teléfono lo ve, Dirección entra por invitación', async ({ browser }, info) => {
    test.skip(info.project.name !== 'telefono', 'Una vez basta: usa tres navegadores.');
    const servidor = new ServidorFalso();
    servidor.agregarUsuario(DUENA, CLAVE, { rol: 'admin', usuario_app: 't-usr_admin', tienda: null, nombre: 'Dueña' });

    // ---- Teléfono 1: la portada pide entrar; sin cuenta no se ve nada ----
    const uno = await telefono(browser, servidor);
    await uno.goto('./#/');
    await expect(uno.getByRole('heading', { level: 1 })).toContainText('Grupo Miami');
    await expect(uno.getByRole('button', { name: 'Entrar como…' })).toHaveCount(0);
    await expect(uno.getByRole('button', { name: 'Dirección', exact: true })).toHaveCount(0);
    await expect(uno.getByRole('button', { name: /Exportar copia/ })).toHaveCount(0);
    await go(uno, '/tabaco/catalogo');
    await expect(uno.getByRole('heading', { name: 'Entra con tu cuenta' })).toBeVisible();
    await expect(uno.getByTestId('cambiar-rol')).toHaveCount(0);

    await go(uno, '/');
    await entrar(uno, DUENA, 'equivocada');
    await expect(uno.getByRole('alert')).toContainText('El correo o la contraseña no coinciden.');
    await uno.getByRole('dialog', { name: 'Entrar' }).getByLabel('Contraseña').fill(CLAVE);
    await uno.getByRole('dialog', { name: 'Entrar' }).getByRole('button', { name: 'Entrar', exact: true }).click();
    await uno.waitForURL((url) => url.hash === '#/tabaco');
    await alDia(uno);
    // El servidor estaba vacío: este teléfono lo llenó con su arranque en blanco.
    expect(servidor.vivos().get('settings/settings')).toMatchObject({ dataMode: 'real' });

    // Carga productos: suben solos.
    await go(uno, '/tabaco/catalogo/importar');
    await uno.getByLabel('Elegir el archivo de productos').setInputFiles(XLSX);
    await uno.getByRole('button', { name: 'Ver vista previa' }).click();
    await uno.getByRole('button', { name: 'Crear', exact: true }).click();
    await toast(uno, /18 productos nuevos/);
    await expect.poll(() => [...servidor.vivos().keys()].filter((k) => k.startsWith('products/')).length, { timeout: 20_000 }).toBe(18);
    await alDia(uno);

    // Al volver a abrir la app en este teléfono no pide la contraseña: entra solo a lo suyo.
    const otraVez = await uno.context().newPage();
    await otraVez.goto('./#/');
    await otraVez.waitForURL((url) => url.hash === '#/tabaco');
    await expect(otraVez.getByRole('button', { name: 'Entrar', exact: true })).toHaveCount(0);
    // Y si después vuelve a la portada, se queda ahí (con «Seguir»).
    await go(otraVez, '/');
    await expect(otraVez.getByRole('button', { name: 'Seguir' })).toBeVisible();
    await otraVez.waitForTimeout(1500);
    expect(new URL(otraVez.url()).hash).toBe('#/');
    await otraVez.close();

    // ---- Teléfono 2: entra con la misma cuenta y ve lo mismo ----
    const dos = await telefono(browser, servidor, { width: 1280, height: 800 });
    await dos.goto('./#/');
    await entrar(dos, DUENA, CLAVE);
    await dos.waitForURL((url) => url.hash === '#/tabaco');
    await go(dos, '/tabaco/catalogo');
    await expect(dos.getByTestId('resultados')).toContainText('18 productos');

    // ---- Administración invita a una socia como Dirección ----
    await go(dos, '/tabaco/usuarios');
    const accesos = dos.getByRole('region', { name: 'Acceso con contraseña' }).or(dos.locator('section', { has: dos.getByRole('heading', { name: 'Acceso con contraseña' }) }));
    await expect(accesos.first()).toContainText(DUENA);
    await accesos.first().getByRole('button', { name: 'Invitar' }).click();
    const hoja = dos.getByRole('dialog', { name: 'Invitar al programa' });
    await hoja.getByLabel('Nombre').fill('Socia Prueba');
    await hoja.getByLabel('Correo').fill('socia@example.com');
    await hoja.getByLabel('Entra como').selectOption('direccion');
    await hoja.getByRole('button', { name: 'Crear invitación' }).click();
    const link = await hoja.getByLabel('Link de la invitación').inputValue();
    expect(link).toMatch(/^https:\/\/rengifojjrr\.github\.io\/cafe-el-mio\/gestion\/#\/acceso\/[0-9a-z]+$/);
    await hoja.getByRole('button', { name: 'Listo' }).click();
    await expect(accesos.first()).toContainText('Invitada');

    // ---- La socia abre el link en su teléfono, pone su contraseña y entra a Dirección ----
    const tres = await telefono(browser, servidor);
    await tres.goto(`./${link.slice(link.indexOf('#'))}`);
    await expect(tres.getByRole('heading', { name: 'Hola, Socia Prueba' })).toBeVisible();
    await tres.getByLabel('Crea tu contraseña').fill('clave-de-la-socia');
    await tres.getByLabel('Repítela').fill('clave-distinta');
    await tres.getByRole('button', { name: 'Guardar y entrar' }).click();
    await expect(tres.getByRole('alert')).toContainText('no son iguales');
    await tres.getByLabel('Repítela').fill('clave-de-la-socia');
    await tres.getByRole('button', { name: 'Guardar y entrar' }).click();
    // Mientras entra, nunca dice que la invitación «ya se usó» (la acaba de usar ella).
    const yaUsada = tres.getByRole('heading', { name: 'Esta invitación ya se usó' });
    const vistazo = tres.getByRole('heading', { name: /de un vistazo/ });
    await expect(yaUsada.or(vistazo)).toBeVisible();
    await expect(yaUsada).toHaveCount(0);
    await tres.waitForURL((url) => url.hash === '#/direccion');
    await expect(tres.getByRole('heading', { level: 1 })).toContainText('Tabaco, de un vistazo');
    // El link ya no sirve otra vez.
    await tres.goto(`./${link.slice(link.indexOf('#'))}`);
    await expect(tres.getByRole('heading', { name: 'Esta invitación ya se usó' })).toBeVisible();

    // ---- Cerrar sesión: vuelve a pedir la contraseña ----
    await go(uno, '/tabaco');
    await uno.getByTestId('estado-servidor').first().click();
    await uno.getByRole('dialog', { name: 'Servidor' }).getByRole('button', { name: 'Cerrar sesión' }).click();
    await uno.waitForURL((url) => url.hash === '#/');
    await expect(uno.getByRole('button', { name: 'Entrar', exact: true }).first()).toBeVisible();
    await go(uno, '/tabaco/catalogo');
    await expect(uno.getByRole('heading', { name: 'Entra con tu cuenta' })).toBeVisible();

    await Promise.all([uno.context().close(), dos.context().close(), tres.context().close()]);
  });

  test('un teléfono con datos propios pregunta antes de conectarse y deja bajar una copia', async ({ browser }, info) => {
    test.skip(info.project.name !== 'telefono', 'Una vez basta.');
    const servidor = new ServidorFalso();
    servidor.agregarUsuario(DUENA, CLAVE, { rol: 'admin', usuario_app: 't-usr_admin', tienda: null, nombre: 'Dueña' });
    // El servidor ya tiene algo (de otro teléfono).
    const otro = await telefono(browser, servidor);
    await otro.goto('./#/');
    await entrar(otro, DUENA, CLAVE);
    await otro.waitForURL((url) => url.hash === '#/tabaco');
    await alDia(otro);
    await otro.context().close();

    // Este teléfono cargó productos antes de conectarse (como la versión sin servidor).
    const page = await telefono(browser, servidor);
    await page.goto('./#/');
    await arrancoEnBlanco(page);
    await page.evaluate(async () => {
      const req = indexedDB.open('tabaco-datos');
      await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      const db = req.result;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('products', 'readwrite');
        tx.objectStore('products').put({ id: 't-prd_local', sku: 'LOCAL-1', name: 'Solo en este teléfono', brandLine: 'Prueba', active: true, cost: 1, priceToStore: 2, suggestedRetail: 3 });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    await expect(page.getByRole('article', { name: 'Línea Tabaco' }).locator('dd').first()).toHaveText('1');
    await entrar(page, DUENA, CLAVE);
    const decidir = page.getByTestId('decidir-conexion');
    await expect(decidir).toContainText('1 registro está solo en este teléfono');
    const descarga = page.waitForEvent('download');
    await decidir.getByRole('button', { name: 'Descargar copia de este teléfono' }).click();
    expect((await descarga).suggestedFilename()).toMatch(/^copia-de-este-telefono-\d{4}-\d{2}-\d{2}\.json$/);
    await decidir.getByRole('button', { name: 'Subir lo de este teléfono' }).click();
    await page.waitForURL((url) => url.hash === '#/tabaco');
    await expect.poll(() => servidor.vivos().get('products/t-prd_local')?.name, { timeout: 20_000 }).toBe('Solo en este teléfono');
    await page.context().close();
  });
});
