# Café en espera

Desde el 9 de noviembre de 2026, Tabaco y Café son **dos programas separados**: cada uno con su link, sus bases de
datos y su gente. El que está publicado (`https://rengifojjrr.github.io/cafe-el-mio/gestion/`) es **solo de Tabaco**.
El de Café todavía no empieza: queda guardado aquí, en el mismo código, hasta que se active.

## Por qué no es una copia aparte

Tabaco y Café usan el mismo motor: catálogo, almacén, locales, consignación, venta en firme, cobros, comisiones,
contabilidad, contratos y escáner. Lo que cambia es la configuración de la línea (sus campos, sus estados, su
contrato) y su catálogo. Una copia congelada del programa se quedaría atrás con cada arreglo que se le hace al de
Tabaco y, al activar el café, habría que pasárselos uno por uno. Así, el café se activa con lo último.

La versión con las dos líneas juntas, tal como estaba antes de separarlas, también queda en la historia de git:
commit `088088b` de la rama `main`.

## Qué queda guardado

| Qué | Dónde |
|---|---|
| Configuración de la línea: campos (origen, tueste, molido, peso, presentación), estados de los lotes de tostado, contrato | `app-gestion/src/lines/config.ts` (`CAFE`) |
| Los 9 cafés de El Mío con lo real (nombre, fotos, descripción, PVP de la tienda) para arrancar sin precio | `app-gestion/src/seed/blank.ts` (`elMioProducts`) y `app-gestion/src/seed/cafe.ts` |
| Datos de ejemplo del café para las pruebas | `app-gestion/src/seed/cafe.ts` |
| Pantallas propias del café: lotes de tostado, «consumir antes de», café por vencer | dentro de las pantallas comunes (se ven solo en la línea Café) |
| Logo y fotos de El Mío | se copian de la web de la marca solo al compilar el café (`PROGRAMA=cafe npm run marca`) |
| Pruebas de punta a punta del café | `app-gestion/tests/e2e/cafe/` (no corren con el programa de Tabaco) |
| Pruebas unitarias del motor con las dos líneas | `app-gestion/tests/unit/` (siguen corriendo) |

## Cómo se activa (cuando llegue el momento)

1. **Link propio:** una carpeta nueva publicada (por ejemplo `cafe-gestion/`) o, mejor, un repositorio propio. Su
   `base` en `vite.config.ts` y el nombre de la app instalada cambian.
2. **Programa de café:** en `app-gestion/src/lines/programa.ts`, `PROGRAM_LINE = 'cafe'` para esa compilación. Sus
   bases de datos se llaman solas `cafe-cuentas` y `cafe-datos`: nunca ve las de Tabaco.
3. **Marca:** `PROGRAMA=cafe` al compilar, para copiar el logo y las fotos de El Mío.
4. **Pruebas:** correr `tests/e2e/cafe/` contra esa compilación (quitar la carpeta de `testIgnore` en una
   configuración de Playwright propia del café).
5. **Datos:** el programa de café arranca en blanco con los 9 cafés de El Mío desactivados hasta ponerles precio.

Lo correcto es hacerlo con el servidor: cada programa con su propio proyecto (Supabase), sus cuentas y sus
contraseñas. Ver `SUPABASE.md`.

## Ojo: mismo sitio, mismo almacenamiento

Todos los sitios `rengifojjrr.github.io/...` comparten el almacenamiento del navegador. Por eso cada programa usa
bases con su propio nombre (`tabaco-…`, `cafe-…`). La separación de verdad llega con el servidor, o con un dominio
propio para cada programa.
