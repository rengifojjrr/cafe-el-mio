# app-gestion — Ecosistema Grupo Miami (Tabaco y Café)

App web instalable (PWA) para la distribución en consignación y la contabilidad de las líneas Tabaco y Café. Demo con
datos de ejemplo: todo vive en el navegador (IndexedDB), sin servidor.

- **Link:** https://rengifojjrr.github.io/cafe-el-mio/gestion/
- **Código:** esta carpeta. **Publicado:** `../gestion/` (lo genera `npm run build`).
- **Documentación:** `../docs/` (decisiones, permisos, modelo, avance, guía de la demo, plan de Supabase).

## Correr en local

```bash
npm i --cache ./.npm-cache
npm run dev        # http://localhost:5173/cafe-el-mio/gestion/
```

`dev` y `build` copian antes las letras, el logo y las fotos de la marca desde `../assets/` a `public/marca/`
(`scripts/copiar-marca.mjs`; esa carpeta está en `.gitignore`).

## Comprobar

```bash
npm run lint
npm run typecheck
npm test                 # Vitest: dominio, permisos por rol, separación de líneas, servicios, tokens
npm run build            # genera ../gestion
npm run test:e2e         # Playwright contra vite preview (Chrome del sistema, 390×844 y 1280×800)
```

- `test:e2e` levanta `vite preview` solo (o usa `E2E_BASE_URL=…` para otro servidor). Con `CAPTURAS=1` guarda capturas
  en `../docs/capturas/`.
- Playwright usa `channel: 'chrome'`: el Chrome instalado (en el Mac, el de `/Applications`). No descarga navegadores.
- La primera vez que se abre la app, los datos de ejemplo se arman en un Web Worker (`src/seed/seed.worker.ts`) y la
  portada se muestra mientras tanto.

## Estructura

| Carpeta | Qué hay |
|---|---|
| `src/data/` | Tipos, interfaces de repositorio y la implementación `local` (Dexie: `eco-tabaco`, `eco-cafe`, `eco-core`). |
| `src/domain/` | Reglas puras: libro de movimientos, comisiones, liquidaciones, contrato, cumplimiento, permisos. |
| `src/services/` | Casos de uso con permisos (`can`), auditoría y avisos. Lo único que usan las pantallas. |
| `src/lines/` | La configuración de cada línea (campos, entrada de inventario, contrato, comisiones). |
| `src/seed/` | Datos de ejemplo y el simulador que arma tres meses de historia con las mismas reglas. |
| `src/features/` | Pantallas por área. |
| `src/ui/` | Componentes base, silueta del tabaco, mapa. |
| `src/styles/tokens.css` | **El único archivo con colores.** Una prueba falla si aparece un color en otro lado. |
| `tests/unit/`, `tests/e2e/` | Vitest y Playwright. |

## Qué falta (para otra sesión)

- Pasar a servidor: plan en `../docs/SUPABASE.md` (la interfaz `src/data/repo.ts` es lo único que cambia).
- Datos reales y decisiones del negocio: `../docs/PENDIENTES.md`.
- Avance y cómo probar cada etapa: `../docs/AVANCE.md`. Guía para enseñar la demo: `../docs/GUIA-DEMO.md`.

## Íconos

`public/icons/*.png` salen de `scripts/generar-iconos.mjs` (usa Chrome). Ya están generados; no hace falta correrlo.
