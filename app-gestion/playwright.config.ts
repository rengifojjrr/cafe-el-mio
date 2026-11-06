import { defineConfig } from '@playwright/test';

// Pruebas de punta a punta contra `vite preview` (la app ya compilada en ../gestion),
// con el Chrome del sistema: no se descargan navegadores.
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4173/cafe-el-mio/gestion/';

// La app ya no trae datos de ejemplo. Las pruebas sí los usan: esta marca en el navegador de cada
// prueba le pide a la app que los cargue (DEMO_FLAG en src/services/session.ts). Las pruebas del
// arranque en blanco (sin-demo.spec.ts) la quitan.
export const DEMO_STORAGE = {
  cookies: [],
  origins: [{ origin: new URL(BASE).origin, localStorage: [{ name: 'pruebas:datos-de-ejemplo', value: '1' }] }],
};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    channel: 'chrome',
    serviceWorkers: 'block',
    permissions: ['geolocation'],
    geolocation: { latitude: 25.861, longitude: -80.279 },
    locale: 'es-US',
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
    storageState: DEMO_STORAGE,
  },
  projects: [
    { name: 'telefono', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: 'computadora', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run preview', url: BASE, reuseExistingServer: true, timeout: 60_000 },
});
