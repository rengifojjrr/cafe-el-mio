// Con el servidor y datos largos como los de verdad (correos largos, zonas y locales con nombres
// largos, un vendedor responsable de muchas zonas): ninguna pantalla del menú de Administración
// puede ser más ancha que el teléfono (Chrome aleja la vista y los toques caen fuera) ni quedarse
// en «No se pudo cargar». La prueba de solo demo (telefono.spec.ts) no ve lo que solo existe con el
// servidor, como la lista de accesos con correo y última entrada.
import { expect, test, type Page } from '@playwright/test';
import { NAV } from '../../src/app/nav';
import type { Store, User, Zone } from '../../src/data/types';
import { buildLine } from '../../src/seed';
import { aDatos } from '../../src/servidor/registros';
import { ServidorFalso } from '../servidor-falso';
import { go } from './helpers';
import { alDia, conServidorFalso, entrarConCorreo } from './servidor-helpers';

const VACIO = { cookies: [], origins: [] };
const CORREO = 'administracion.de.la.empresa.tabacalera@example.com';
const CLAVE = 'clave-segura-1';

const ZONAS_LARGAS = ['Este: Pasadena, Deer Park y La Porte', 'Humble, Atascocita y Kingwood', 'Norte de Houston (Airline y Shepherd)', 'Clear Lake y League City', 'Richmond y Rosenberg'];

/** Los datos de ejemplo, alargados como los de verdad. */
function datosLargos(): { filas: { tabla: string; id: string; datos: Record<string, unknown> }[]; admin: string; local: string } {
  const t = buildLine('tabaco', new Date());
  const zones = t.zones as Zone[];
  zones.forEach((z, i) => {
    if (ZONAS_LARGAS[i]) z.name = ZONAS_LARGAS[i]!;
  });
  const users = t.users as User[];
  const vendedor = users.find((u) => u.role === 'seller')!;
  vendedor.name = 'Juan Camilo Restrepo de la Torre';
  vendedor.email = 'juan.camilo.restrepo.vendedor@example.com';
  // Responsable de todas las zonas de su mercado (como en el teléfono del dueño).
  for (const z of zones) if ((z.marketId ?? 'miami') === (vendedor.marketId ?? 'miami')) z.sellerId = vendedor.id;
  const stores = t.stores as Store[];
  stores[0]!.name = 'Smoke Shop & Cigar Lounge on Westheimer Road (Galleria area)';
  stores[0]!.address = '12345 Westheimer Road Suite 1000 (dirección de ejemplo, larga)';
  stores[0]!.managerName = 'María Fernanda Gutiérrez Villalobos';
  const settings = (t.settings as Record<string, unknown>[])[0]!;
  settings.dataMode = 'real';
  const filas = Object.entries(t).flatMap(([tabla, rows]) =>
    (rows as Record<string, unknown>[]).map((fila) => ({ tabla, id: String(fila.id), datos: aDatos(tabla, fila) })),
  );
  return { filas: filas.filter((f) => f.tabla !== 'photos' && f.tabla !== 'templates'), admin: users.find((u) => u.role === 'admin')!.id, local: stores[0]!.id };
}

async function ancho(page: Page): Promise<{ scroll: number; client: number; culpables: string }> {
  return page.evaluate(() => {
    const client = document.documentElement.clientWidth;
    // Los elementos que se salen y que no tienen adentro otro que se salga: esos son los culpables.
    const fuera = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => el.getBoundingClientRect().right > client + 1);
    const hojas = fuera.filter((el) => !el.closest('.leaflet-pane') && !fuera.some((otro) => otro !== el && el.contains(otro) && !otro.closest('.leaflet-pane')));
    const culpables = hojas
      .slice(0, 3)
      .map((el) => `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"> «${(el.textContent ?? '').trim().slice(0, 50)}» hasta ${Math.round(el.getBoundingClientRect().right)}px`)
      .join(' | ');
    return { scroll: document.documentElement.scrollWidth, client, culpables };
  });
}

test.use({ storageState: VACIO });

test('con el servidor y datos largos, ninguna pantalla de Administración se sale del teléfono ni falla', async ({ browser }, info) => {
  test.skip(info.project.name !== 'telefono', 'Solo tiene sentido en el teléfono.');
  test.setTimeout(240_000);
  const servidor = new ServidorFalso();
  const { filas, admin, local } = datosLargos();
  servidor.sembrar(filas);
  servidor.agregarUsuario(CORREO, CLAVE, { rol: 'admin', usuario_app: admin, tienda: null, nombre: 'Administración' });
  const otro = servidor.agregarUsuario('info@tobacconationalcompany-de-prueba.com', 'otra-clave-1', { rol: 'admin', usuario_app: null, tienda: null, nombre: 'Admin' });
  servidor.usuarioPorId(otro)!.ultimaEntrada = new Date(Date.now() - 86_400_000).toISOString();
  servidor.agregarUsuario('socio.de.la.empresa.con.correo.largo@example.com', 'clave-del-socio', { rol: 'direccion', usuario_app: null, tienda: null, nombre: 'Socio' });

  const context = await browser.newContext({ storageState: VACIO, viewport: { width: 390, height: 844 }, locale: 'es-US', timezoneId: 'America/New_York', serviceWorkers: 'block', isMobile: true, hasTouch: true });
  await conServidorFalso(context, servidor);
  const page = await context.newPage();
  await page.goto('./#/');
  await entrarConCorreo(page, CORREO, CLAVE);
  await page.waitForURL((url) => url.hash === '#/tabaco');
  await alDia(page);

  const pantallas = [
    ...NAV.admin.map((n) => `/tabaco${n.path ? `/${n.path}` : ''}`),
    `/tabaco/locales/${local}`,
    '/tabaco/catalogo/nuevo',
    '/tabaco/locales/nuevo',
  ];
  const anchas: string[] = [];
  const fallas: string[] = [];
  for (const hash of pantallas) {
    await go(page, hash);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    // Las listas, los gráficos y los mapas se dibujan un momento después del título.
    await page.waitForTimeout(700);
    const w = await ancho(page);
    if (w.scroll > w.client + 1) anchas.push(`${hash}: ${w.scroll}px de ${w.client}px — ${w.culpables}`);
    if (await page.getByText('No se pudo cargar.').count()) fallas.push(`${hash}: ${await page.getByRole('alert').first().innerText()}`);
  }
  // «Equipo» por zona y por ciudad, y la hoja del servidor.
  await go(page, '/tabaco/equipo');
  for (const vista of [/^Zonas/, /^Ciudades/]) {
    await page.getByRole('tab', { name: vista }).click();
    await page.waitForTimeout(400);
    const w = await ancho(page);
    if (w.scroll > w.client + 1) anchas.push(`/tabaco/equipo (${vista.source}): ${w.scroll}px de ${w.client}px — ${w.culpables}`);
  }
  await page.getByTestId('estado-servidor').first().click();
  await page.waitForTimeout(400);
  const w = await ancho(page);
  if (w.scroll > w.client + 1) anchas.push(`hoja del servidor: ${w.scroll}px de ${w.client}px — ${w.culpables}`);
  expect(anchas, 'pantallas más anchas que el teléfono').toEqual([]);
  expect(fallas, 'pantallas que no cargan').toEqual([]);
  await context.close();
});
