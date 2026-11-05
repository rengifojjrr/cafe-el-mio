# Avance por etapas

Una línea por etapa: qué quedó y cómo se prueba. Las capturas están en `docs/capturas/`.

| Etapa | Qué quedó | Cómo se prueba |
|---|---|---|
| **E0 · Arranque** | Proyecto Vite + React 19 + TS estricto + Tailwind 4 en `app-gestion/`; tokens de color en un solo archivo; letras de la marca; PWA con alcance `/cafe-el-mio/gestion/` e íconos; rutas con hash; portada del ecosistema con las dos líneas, QR, «Entrar como…», recorrido, restablecer y exportar/importar; capas `data` (Dexie: `eco-tabaco`, `eco-cafe`, `eco-core`), `domain` y `services` completas con permisos y auditoría; semilla con 3 meses de historia por línea; script de la marca. | `npm run dev` y abrir `/cafe-el-mio/gestion/`. `npm test` (semilla sin saldos negativos, casos para enseñar, tokens). Capturas `E0-portada-*.png`. |
