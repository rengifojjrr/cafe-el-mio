# Decisiones técnicas

Registro de lo que se decidió al construir el ecosistema de gestión (`app-gestion/` → `gestion/`).
Cada punto dice qué se decidió y por qué. Lo que falta decidir con el negocio está en `PENDIENTES.md`.

## Arquitectura

- **App estática sin servidor (PWA).** Vite + React 19 + TypeScript estricto + Tailwind CSS 4, publicada en
  GitHub Pages bajo `/cafe-el-mio/gestion/`. Se descartó Next.js porque el link tenía que funcionar sin cuentas de
  nube. Rutas con hash (`createHashRouter`): Pages no sabe de rutas y recargar no da 404.
- **Versiones:** Vite 8, React Router 7, Tailwind 4.3, Vitest 5, ESLint 10. TypeScript se quedó en **5.9**
  porque typescript-eslint todavía no soporta TypeScript 7 (pide `< 6.1`).
- **Capas:** `src/data/` (interfaces de repositorio + implementación `local` con Dexie), `src/domain/` (reglas
  puras: libro de movimientos, comisiones, liquidaciones, contrato, permisos), `src/services/` (casos de uso con
  permisos y auditoría) y `src/features/` (pantallas). Las pantallas nunca tocan Dexie.
- **Tres bases IndexedDB:** `eco-tabaco`, `eco-cafe` (una por línea, mismo esquema) y `eco-core` (sesión, nombre
  del ecosistema y directorio de cuentas de «Entrar como…»). Un registro de una línea nunca se escribe en la otra:
  cada servicio recibe el repositorio de su línea y `can()` rechaza a una cuenta de otra línea.
- **Un mismo motor, dos configuraciones** (`src/lines/config.ts`): campos del producto, entrada de inventario
  (importación o lotes de tostado), plantilla de contrato, comisión por defecto y tema. No hay pantallas duplicadas
  por línea.
- **Avisos de cambio:** cada escritura de un servicio emite un evento (`services/bus.ts`) y las pantallas vuelven a
  pedir sus datos. Más simple y predecible que `liveQuery` para una demo de este tamaño.
- **Service worker** con alcance `/cafe-el-mio/gestion/` (vite-plugin-pwa, `injectRegister: false` y registro
  manual solo en producción). Nunca se registra uno en la raíz de la web de marca.

## Datos y reglas de negocio

- **El inventario sale del libro de movimientos** (entrada, salida a consignación, venta reportada, devolución,
  merma, ajuste). Cada movimiento lleva un lote de un lugar a otro; el saldo de almacén y de cada local se calcula.
  `allocate()` reparte por lote (FEFO en café: primero lo que vence antes; FIFO en tabaco) y lanza error antes de
  dejar un saldo negativo.
- **La consignación baja el almacén al entregar**, no al preparar. Al preparar se aparta lo disponible (reserva) y
  lo que falta queda como **demanda no atendida**. Si no hay nada, la entrega sigue pendiente y la falta igual queda
  registrada.
- **Pedido del local → entrega.** Cuando el vendedor confirma un pedido, se crea una entrega «solicitada» ligada al
  pedido; el estado del pedido sigue al de la entrega. Un solo circuito para los dos orígenes.
- **Ganancia del local = PVP sugerido − precio al local.** No se guarda aparte: guardarla permitiría cifras que se
  contradicen. Es lo que el local ve como «lo que gana por cada producto».
- **Comisión del vendedor:** regla por producto (% del precio al local o monto fijo por unidad). Un vendedor puede
  tener una comisión especial que reemplaza la del producto (alta de vendedores con «zona y comisión»). Se devenga al
  reportarse la venta y, con la regla por defecto (`cobro`), se vuelve pagable cuando el local paga **por completo**
  la liquidación que la incluye. Con pagos parciales no se libera en proporción (más simple de explicar; ver
  pendientes).
- **Liquidación:** todo lo vendido y aún no liquidado de un local; vence a los N días de pago de la línea. La
  antigüedad (0–15, 16–30, más de 30 días) se cuenta desde la fecha de la liquidación; «vencida» es saldo > 0
  pasada la fecha de pago.
- **Estado de resultados por mes:** ventas a precio al local − costo por lote de lo vendido − comisiones devengadas
  − mermas. El inventario en consignación se valora al costo y sigue siendo de la empresa.
- **Café:** cada producto de El Mío es un SKU con su presentación base (12 oz para los de origen). Molido y tamaño
  quedan como atributos; las variantes de la tienda en línea no se replican.
- **Tabaco:** la unidad de inventario es el tabaco suelto; las cantidades se piden en cajas (presentación) pero se
  guardan en unidades. La silueta se dibuja a escala real (40 px por pulgada, cepo en 64avos).

## Contrato y firma

- **El contrato es entre la empresa de la línea y el local.** El vendedor firma como representante de la empresa;
  el encargado firma por el local. Las dos firmas se hacen en el teléfono del vendedor.
- Se guarda el **texto ya resuelto** (con las variables puestas), la versión del contrato del local y la versión de
  la plantilla. Volver a emitir anula el anterior sin firmar.
- La firma es **de demostración**: trazo (PNG), nombre, fecha y hora, ubicación si se autoriza, y el
  consentimiento a firmar electrónicamente escrito en el contrato. La versión imprimible sale de `window.print()`.
- En tabaco no se emite contrato sin permiso de venta de tabaco vigente, y sin permiso vigente **no se consigna**
  (ni se solicita, ni se prepara, ni se entrega).

## Permisos

- Se aplican en la capa de servicios con `can(actor, acción, línea, recurso)` (ver `PERMISOS.md`); las pantallas
  solo esconden lo que ya está prohibido. «Ver como…» crea un actor de **solo lectura**.
- **Limitación conocida:** en esta demo todo vive en el navegador, así que los permisos protegen la experiencia, no
  los datos (alguien con las herramientas del navegador puede leer IndexedDB). Se vuelven seguros de verdad con el
  servidor: RLS de Postgres por rol y por línea en Supabase (ver `SUPABASE.md`).

## Interpretaciones del encargo

- «El comprador ve las comisiones por cada producto»: el **local** ve lo que gana por cada producto (su ganancia de
  consignación) y el **vendedor** ve su comisión.
- «Contratos entre vendedor y tienda»: contrato entre la **empresa de la línea** y el local, firmado por el vendedor
  como su representante.

## Entorno de esta construcción

- Se construyó en un contenedor Linux en la nube (no en el Mac): Node 22, npm 10 y Chrome en
  `/opt/google/chrome/chrome`. Playwright usa `channel: 'chrome'`, que en el Mac encuentra el Chrome de
  `/Applications`.
- La red del contenedor no deja abrir `rengifojjrr.github.io`, así que la comprobación «en vivo» del link se hace
  desde el teléfono o el Mac (ver `AVANCE.md`).
