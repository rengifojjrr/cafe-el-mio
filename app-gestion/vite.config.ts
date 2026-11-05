import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// La app se publica en GitHub Pages bajo /cafe-el-mio/gestion/.
// El service worker vive en esa carpeta, así que su alcance nunca llega a la web de marca.
const BASE = '/cafe-el-mio/gestion/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      base: BASE,
      scope: BASE,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        id: BASE,
        name: 'Grupo Miami · Tabaco & Café',
        short_name: 'Grupo Miami',
        description: 'Distribución en consignación y contabilidad de las líneas Tabaco y Café (demo).',
        lang: 'es',
        dir: 'ltr',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'any',
        background_color: '#0B0D10',
        theme_color: '#0B0D10',
        categories: ['business', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,webp,png,svg}'],
        // El worker de pdf.js pesa más de 1 MB: no va en la precarga, se guarda la primera vez que se usa.
        globIgnores: ['**/pdf.worker*'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/assets/pdf.worker'),
            handler: 'CacheFirst',
            options: { cacheName: 'pdf-worker', expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 60 } },
          },
          {
            // El mapa usa solo OpenStreetMap (CARTO empezó a pedir clave). 7 días, como pide su política de uso.
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'teselas-osm', expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 7 } },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: '../gestion',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    sourcemap: false,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
