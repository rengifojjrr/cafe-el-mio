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

## Pulido (E7)

- **Semilla en un Web Worker.** La primera visita simula tres meses de historia de las dos líneas. Hecho en la página
  trababa el hilo principal (Lighthouse móvil: rendimiento 64, 1,8 s de bloqueo). Ahora corre en un worker que
  escribe en las mismas bases IndexedDB y la portada se muestra al instante: rendimiento 93, bloqueo 60 ms. Si el
  navegador no tiene workers, se carga en la página como antes. Entrar, listar cuentas y resolver la sesión esperan
  a que termine esa primera carga.
- **Carga por partes.** La portada no carga zod, Recharts ni Leaflet: llegan al entrar a una línea o a la pantalla
  que los usa. Bundle inicial: 150 KB comprimido.
- **Transacciones.** Un servicio que usa a otro reutiliza la transacción abierta (`Dexie.currentTransaction`):
  IndexedDB cierra antes de tiempo una transacción anidada (lo encontró la prueba de punta a punta de «pedido del
  local», no las unitarias con IndexedDB simulado).
- **Cambiar de cuenta vuelve a montar la línea**, para que ninguna pantalla se quede con el estado que calculó con la
  cuenta anterior.
- **Dirección dentro de una línea** usa su propia identidad (`direccion`): no hereda la campana de nadie.
- **Lighthouse** (móvil, throttling simulado, contra `vite preview`): rendimiento 93, accesibilidad 100, buenas
  prácticas 100. No se pudo medir contra el link publicado porque la red de este contenedor no deja abrir
  `github.io`.

## Ronda 2 (ajustes después de probar la demo)

- **Tipografía:** los títulos pasan de Bodoni Moda a **Figtree** con peso alto (760) y letras un poco más juntas.
  Bodoni, con trazos muy finos, se leía mal en tamaños grandes sobre fondo oscuro. Figtree ya era la letra del
  texto y de la marca, así que la app queda con una sola familia.
- **Lo que debe un local = lo liquidado sin pagar + lo vendido sin liquidar.** Antes solo se mostraba lo liquidado,
  y el local veía «$0» aunque hubiera vendido. Lo vendido se debe desde que se vende; la liquidación solo fija
  cuándo vence. Se muestra el total con su desglose (y lo vencido aparte) en «Mis cuentas», en el inicio del
  local, en la lista y en la ficha de cada local.
- **La entrega la firma siempre el dueño o encargado del local**, nunca el vendedor: el nombre viene del encargado
  registrado, la firma dice «del dueño o encargado del local» y hay que marcar «Recibí todo lo de esta lista, en
  buen estado». Si la firma se hace en el teléfono del vendedor, él le pasa el teléfono.
- **Pedir desde un producto** abre una hoja con la cantidad (por caja), lo que gana el local y la disponibilidad, y
  envía el pedido ahí mismo, sin pasar por la lista de todos los productos. También hay un botón «Pedir» en cada
  tarjeta del catálogo para la cuenta del local.
- **Horario de la tienda:** se eligen los días y las horas de abrir y cerrar (con atajos) y se guarda como texto
  legible («Lun–Sáb 9 a. m.–8 p. m. · Dom cerrado»). Un horario viejo escrito a mano se muestra como «Antes
  decía…» hasta que se elija uno nuevo.
- **Lista de locales** con columnas fijas: el estado queda centrado y alineado en todas las filas.
- **Contratos con plantilla PDF.** Administración sube su PDF (o crea uno desde el texto de Ajustes) y ubica
  recuadros sobre las páginas: firma del local, firma del vendedor, nombre del local, encargado, vendedor, fecha,
  dirección y, en la nota de entrega, el detalle. Las posiciones se guardan en fracciones de la página, así que no
  dependen de la pantalla. Cada «Guardar plantilla» es una **versión nueva que no se edita**; el contrato y la nota
  guardan el id de la versión con que se emitieron, por eso lo ya firmado no cambia. Un contrato que estaba por
  firmar no pasa solo a la plantilla nueva: el vendedor toca «Preparar de nuevo» (no se crean versiones sin que
  alguien lo pida). Las reglas de firma no cambian: dos firmas, consentimiento y ubicación opcional.
- **El PDF firmado se arma al abrirlo** con pdf-lib, a partir de la plantilla (inmutable) y de las firmas
  guardadas, y se le agrega el anexo de precios. No se guarda el PDF final ni su huella: para la demo basta, para
  locales reales no (ver `PENDIENTES.md`). La nota de entrega usa la plantilla de entrega activa al recibir.
- **«Contratos»** reúne lo firmado (contratos y notas de entrega) y lo que falta por firmar. Cada rol ve lo suyo:
  administración todo, el vendedor lo de sus locales y el local lo propio («Mis contratos»). Las plantillas solo
  las ve administración.
- **pdf.js y pdf-lib se cargan al usarse**, no en la carga inicial. El motor de pdf.js que dibuja las páginas
  (1,3 MB) no va en la precarga del service worker: se guarda la primera vez que se abre un PDF.
- **Un PDF con páginas giradas se rechaza** al subirlo: se ve derecho en pantalla, pero sus coordenadas no, y las
  firmas quedarían fuera de su recuadro. Se pide guardarlo derecho.
- **Nada puede ser más ancho que el teléfono.** Si una pantalla se pasa del ancho, el navegador aleja la vista y
  los toques caen fuera de los botones. Pasaba en el catálogo (la silueta ensanchaba la tarjeta), en los gráficos
  (la tabla para lectores de pantalla) y en la lista de vendedores. Las listas en cuadrícula ahora tienen una
  columna que no crece más que la pantalla, y una prueba en el teléfono recorre las pantallas principales.

## Ronda 3 (lo que pidió el equipo de tabaco)

### Catálogo
- **Premium o de mazo.** En tabaco, lo primero al crear un producto es elegir el tipo. Lo de mazo no tiene marca: lo
  que importa es la medida y la capa. Capote, tripa, marca y línea solo aparecen en premium.
- **Familias y variantes.** Cada producto es una variante (su SKU, su código, su stock y su precio) de una familia.
  En lo de mazo, la familia es la vitola con su medida («Toro 6 × 52») y las variantes son las capas, como las
  nombran en el almacén. El nombre se compone solo («Toro 6 × 52 · Maduro») y nunca repite lo que ya dice la
  familia: nadie escribe «Toro Maduro» a mano para que se vea la capa. Si una familia premium pasa a tener varias
  variantes, las hermanas también llevan su capa en el nombre.
- **La unidad es de cada producto.** Lo de mazo se cuenta en mazos (25 tabacos por defecto) y la caja trae 50 mazos;
  el premium puede contarse en mazos o en tabacos sueltos; el café, en unidades. El libro de movimientos guarda la
  unidad del producto, así que las pantallas dicen «120 mazos · 3,000 tabacos» o «40 tabacos · 2 cajas». Los pedidos
  de mazo van de a un mazo (antes, de a una caja).
- **Capa** es una lista (Habano, Maduro, Connecticut, Natural, Corojo, Criollo, Sumatra, Rosado, Oscuro, Candela)
  y de ella sale el color de la silueta. El texto libre de antes («Connecticut Shade (Ecuador)») queda como «Detalle
  de la capa» en premium.
- **Filtros de un toque.** Una fila de chips con lo que más se usa (tipo, capa, fortaleza, con stock) y «Más filtros»
  (vitola, procedencia, marca). Dentro de un filtro se suman las opciones; entre filtros, se cruzan. Cada opción dice
  cuántos productos quedarían. Se guardan por persona en este navegador (`localStorage`); la búsqueda, por pestaña.
- **Volver sin perder el punto.** Antes, cada cambio de pantalla subía al principio, también al volver atrás. Ahora
  una pantalla nueva empieza arriba y al volver se recupera la posición de esa entrada del historial (si la página
  se recargó, por su ruta), reintentando mientras la lista carga. Vale para todas las secciones.
- **Ficha** con el tabaco grande sobre un fondo oscuro con textura (siempre oscuro, también en modo claro), sombra
  suave, la medida en mayúsculas espaciadas y los atributos en cuadrícula, inspirado en cómo presentan sus puros
  las marcas grandes, sin copiar textos, imágenes ni marcas. Las capas de la familia se cambian desde la ficha.
- **Comparar tamaños**: de 2 a 4 vitolas de pie, apoyadas en la misma base y a la misma escala (no a tamaño real:
  la pulgada de una pantalla no mide una pulgada).
- **«Ver en 3D»** sin three.js: un canvas dibuja el tabaco como superficie de revolución (largo, cepo, cabeza
  redonda o en punta, anilla, color de la capa) con luz simple. Pesa 2,5 KB comprimido y se baja al tocar el botón.
  Con «reducir movimiento» se ve la silueta.
- **Códigos de ejemplo** con prefijo GS1 200 (uso interno): no chocan con códigos de productos reales.

### Diseño
- **Títulos en Figtree seminegrita (620).** Se probaron dos: Figtree 620 y Fraunces 600 (una serif suave). Fraunces
  se ve elegante pero en el teléfono los títulos chicos de las tarjetas se leen peor y suma 36 KB de letra; Figtree
  ya es la letra del texto y de la marca.
- **Los avisos no tapan.** Un aviso abajo de la pantalla no atrapa el toque (solo su «x»): antes, durante 4 segundos,
  tapaba botones y casillas del final de un formulario en el teléfono.
- **Cifras alineadas.** Las tarjetas de cifras reservan dos líneas para la etiqueta: en una misma fila los números
  quedan a la misma altura.
