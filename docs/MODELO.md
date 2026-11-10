# Modelo de datos

Tipos en `app-gestion/src/data/types.ts`; esquema Dexie en `src/data/local/dexie.ts`.

## Bases

| Base IndexedDB | Contenido |
|---|---|
| `eco-tabaco` | Todo lo de la línea Tabaco (tablas de abajo). |
| `eco-cafe` | Todo lo de la línea Café (mismo esquema, datos aparte). |
| `eco-core` | `session` (cuenta activa, «ver como», línea de Dirección), `settings` (nombre y tema del ecosistema, versión de la semilla) y `directory` (cuentas principales de «Entrar como…»). |

## Tablas de cada línea

| Tabla | Qué guarda | Índices |
|---|---|---|
| `products` | Catálogo: SKU, nombre, marca o línea, costo (solo admin), precio al local, PVP sugerido, regla de comisión del vendedor, umbral de stock bajo, presentación, notas, maridaje o preparación, `attrs` propios de la línea, fotos. | `sku` |
| `photos` | Fotos (Blob WebP ≤ 1600 px) de productos, fachadas, devoluciones y mensajes. Reemplaza a `product_photos` y `store_photos` del borrador. | `ownerId` |
| `warehouses` | El almacén de la línea («Almacén Miami», editable). | — |
| `lots` | Lotes: producto, costo por unidad, llegada de origen; en café, tostado, «consumir antes de» y línea de producción. | `productId`, `arrivalId` |
| `arrivals` | Llegadas con sus ítems. Tabaco: producción → tránsito → aduana → recibida. Café: programado → tostado → en almacén. | `status` |
| `movements` | **El libro.** Entrada, salida a consignación, venta reportada, devolución, merma y ajuste; cada uno con lote, cantidad, de dónde y a dónde. | `productId`, `storeId`, `at`, `type` |
| `stores` | Locales: datos, punto en el mapa, vendedor, zona, estado (prospecto → contrato enviado → firmado → activo → pausado/cerrado) e historial; en tabaco, permiso de venta; las visitas de recorrido mientras es prospecto (`prospectVisits`: qué pasó y una nota). Un prospecto puede no tener encargado, teléfono ni permiso: se piden antes del contrato. | `sellerId`, `status`, `zoneId` |
| `contracts` | Contrato por local y versión: texto resuelto, anexo de productos, firmas (trazo, nombre, fecha y hora, ubicación). | `storeId` |
| `deliveries` | Notas de entrega en consignación: solicitada → preparada → entregada (o rechazada), con lo preparado y la firma de quien recibe. | `storeId`, `sellerId`, `status` |
| `visits` | Visitas con conteo (esperado y contado por producto) y ubicación si la dan. | `storeId`, `sellerId`, `at` |
| `salesReports` | Ventas reportadas (por conteo o por el local): líneas con precio al local, costo por lote y liquidación a la que pertenecen. | `storeId`, `sellerId`, `at`, `settlementId` |
| `returns` | Devoluciones y mermas con motivo, fotos y costo. | `storeId` |
| `reorders` | Pedidos de los locales: enviado → confirmado → preparado → entregado (o cancelado). | `storeId`, `sellerId`, `status` |
| `unmetDemand` | Demanda no atendida: lo que se pidió y no había en almacén. | `productId`, `storeId` |
| `settlements` | Liquidaciones por local: periodo, líneas, monto, pagado, vencimiento y estado. | `storeId`, `status` |
| `payments` | Pagos registrados (efectivo, cheque, Zelle o transferencia, con referencia). Solo el apunte. | `settlementId`, `storeId` |
| `commissions` | Comisión por venta y producto: devengada → pagable → pagada. | `sellerId`, `storeId`, `status`, `salesReportId`, `settlementId` |
| `payouts` | Pagos de comisiones a vendedores. | `sellerId` |
| `threads`, `messages` | Conversaciones (admin ↔ vendedor, vendedor ↔ local, local → admin) y sus mensajes con foto o producto adjunto. | `kind`, `storeId` / `threadId`, `at` |
| `announcements` | Comunicados de administración (a vendedores, a locales o a todos). | `at` |
| `notifications` | La campana de cada usuario. | `userId`, `at` |
| `users` | Administración, vendedores (zona y comisión especial) y cuentas de los locales. | `role`, `storeId` |
| `zones` | Zonas con su centro. | — |
| `settings` | Ajustes de la línea: empresa, frecuencia de liquidación, plazo de pago, regla de comisiones, umbrales, plantilla de contrato y su versión. | — |
| `audit` | **Solo se agrega**: quién hizo qué y cuándo. El repositorio no tiene ni actualizar ni borrar. | `seq`, `at`, `actorId` |

## Reglas que se prueban

- Ningún lugar con saldo (almacén o local) queda negativo en ningún momento (`findNegative`).
- Un conteo no puede ser mayor que lo que hay en consignación: la consignación nunca pasa de lo colocado.
- Fechas en ISO (UTC) y se muestran en `America/New_York`; dinero en USD redondeado a centavos.
