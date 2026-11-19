// Fase 2: un vendedor entra con su correo y su contraseña y ve solo lo suyo: sus locales, el
// catálogo sin costos y sus comisiones. Contra el servidor de mentira (las mismas reglas que
// tabaco_5_vendedores.sql) y con los datos de ejemplo.
import { expect, test } from '@playwright/test';
import type { Store, User } from '../../src/data/types';
import { buildLine } from '../../src/seed';
import { aDatos } from '../../src/servidor/registros';
import { ServidorFalso } from '../servidor-falso';
import { go } from './helpers';
import { alDia, conServidorFalso, entrarConCorreo } from './servidor-helpers';

const VACIO = { cookies: [], origins: [] };
const CLAVE = 'clave-del-vendedor';

test.use({ storageState: VACIO });

test('un vendedor entra con su cuenta y ve solo sus locales, sin costos', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const t = buildLine('tabaco', new Date());
  const users = t.users as User[];
  const stores = t.stores as Store[];
  const vendedor = users.find((u) => u.role === 'seller' && u.active && stores.some((s) => s.sellerId === u.id && s.status === 'activo'))!;
  const suyos = stores.filter((s) => s.sellerId === vendedor.id);
  const ajeno = stores.find((s) => s.sellerId !== vendedor.id && s.status === 'activo')!;
  const settings = (t.settings as Record<string, unknown>[])[0]!;
  settings.dataMode = 'real';
  const servidor = new ServidorFalso();
  servidor.sembrar(
    Object.entries(t).flatMap(([tabla, filas]) =>
      tabla === 'photos' || tabla === 'templates' ? [] : (filas as Record<string, unknown>[]).map((fila) => ({ tabla, id: String(fila.id), datos: aDatos(tabla, fila) })),
    ),
  );
  servidor.agregarUsuario('vendedor@example.com', CLAVE, { rol: 'seller', usuario_app: vendedor.id, tienda: null, nombre: vendedor.name });

  const movil = info.project.name === 'telefono';
  const context = await browser.newContext({ storageState: VACIO, viewport: movil ? { width: 390, height: 844 } : { width: 1280, height: 800 }, locale: 'es-US', timezoneId: 'America/New_York', serviceWorkers: 'block', isMobile: movil, hasTouch: movil });
  await conServidorFalso(context, servidor);
  const page = await context.newPage();
  await page.goto('./#/');
  await entrarConCorreo(page, 'vendedor@example.com', CLAVE);
  await page.waitForURL((url) => url.hash === '#/tabaco');
  await alDia(page);

  // Sus locales, y ningún local de otro vendedor.
  await go(page, '/tabaco/locales');
  await expect(page.getByRole('heading', { level: 1, name: 'Mis locales' })).toBeVisible();
  await expect(page.getByText(suyos[0]!.name).first()).toBeVisible();
  await expect(page.getByText(ajeno.name)).toHaveCount(0);
  // El local de otro no se abre ni con el link.
  await go(page, `/tabaco/locales/${ajeno.id}`);
  await expect(page.getByText(/No se pudo cargar|No existe|no es tuyo|no encontr/i).first()).toBeVisible();

  // Lo que de verdad importa: lo ajeno ni siquiera llegó al teléfono (la pantalla ya filtra por su
  // cuenta, así que verla vacía no prueba nada). Ningún local de otro, ningún costo.
  const enElTelefono = await page.evaluate(async () => {
    const leer = (db: IDBDatabase, tabla: string) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const all = db.transaction(tabla).objectStore(tabla).getAll();
        all.onsuccess = () => resolve(all.result as Record<string, unknown>[]);
        all.onerror = () => reject(all.error);
      });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('tabaco-datos');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const [products, stores, lots] = await Promise.all([leer(db, 'products'), leer(db, 'stores'), leer(db, 'lots')]);
    db.close();
    return {
      productos: products.length,
      conCosto: products.filter((p) => p.cost !== undefined || p.sampleCost !== undefined).length + lots.filter((l) => l.unitCost !== undefined).length,
      vendedores: [...new Set(stores.map((x) => String(x.sellerId)))],
    };
  });
  expect(enElTelefono.productos).toBeGreaterThan(0);
  expect(enElTelefono.conCosto).toBe(0);
  expect(enElTelefono.vendedores).toEqual([vendedor.id]);
  await go(page, '/tabaco/catalogo');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByText(/^Costo/)).toHaveCount(0);

  // Sus comisiones.
  await go(page, '/tabaco/comisiones');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await context.close();
});
