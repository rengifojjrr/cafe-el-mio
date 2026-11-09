# Pendientes (para decidir con el negocio)

Datos que faltan o que se pusieron de ejemplo. Nada de esto bloquea la demo.

## Nombres y marca

- **Nombre del ecosistema:** provisional «Grupo Miami · Tabaco & Café» (se edita en la portada).
- **Marca de tabaco:** provisional «GM Tabacos (marca provisional)» con series Biscayne, Everglades, Tamiami, Coral y
  Brickell. Los 12 tabacos son inventados.
- **Razón social** de cada empresa (aparece en el contrato): hoy «GM Tabacos (razón social de ejemplo)» y «Café El Mío
  (razón social pendiente)».
- **Matcha:** origen por confirmar (la ficha de la tienda no lo dice).

## Dinero

- **Costos reales** de cada producto (hoy son de ejemplo y están marcados así).
- **Precio al local** de los 9 productos de El Mío (hoy es de ejemplo; el PVP sugerido es el precio público de la
  tienda).
- **Comisiones** de vendedores por producto (hoy 6–10 % o monto fijo, de ejemplo).
- **Frecuencia de liquidación y plazo de pago** (hoy tabaco cada 15 días con 10 de plazo; café cada 14 con 7).
- ¿La comisión se libera con pagos parciales en proporción o solo con la liquidación pagada completa? (hoy: completa).

## Legal

- **Abogado para el contrato** de consignación de cada línea (las plantillas son de ejemplo).
- **Tabaco:** confirmar con el abogado los permisos que necesita **el distribuidor** (no solo el local) para vender
  tabaco a comercios en Florida, los impuestos que aplican y si la consignación de productos de tabaco tiene alguna
  restricción. La app solo exige el permiso del local y la regla de 21+.
- Política de firma electrónica (hoy: firma de demostración con consentimiento escrito en el contrato).
- **Firma con valor legal.** Hoy la imagen del trazo se pega en el PDF: no hay certificado, ni sello de tiempo, ni
  prueba de que el PDF no se cambió después. Para locales reales hace falta un servicio de firma (por ejemplo
  Dropbox Sign o DocuSign) o, como mínimo, guardar en el servidor el PDF firmado con su huella (hash).

## Producto

- **Servidor (Supabase), fase 2:** que entren los vendedores y los locales, cada uno con lo suyo y sin costos
  (`SUPABASE.md`). Hasta entonces, el contrato que se firma en el teléfono del vendedor no llega al servidor.
- **Mudanza al proyecto propio** cuando el cliente pague (`MUDANZA.md`). Hasta entonces: plan gratis, sin copias de
  seguridad automáticas (copia semanal a mano) y el proyecto se pausa si pasa una semana sin uso.
- **Recuperar la contraseña por correo:** hoy se hace con otra invitación. Con el proyecto propio se puede activar la
  recuperación por correo con su propio remitente.
- Lista real de vendedores, zonas y locales; fotos reales de los tabacos.
- Dominio propio (hoy GitHub Pages).

## Para comprobar en el teléfono (no se pudo desde el contenedor)

- Abrir el link publicado, instalarlo y recorrerlo: desde aquí la red no deja abrir `rengifojjrr.github.io`. La
  compilación publicada es la misma que pasó todas las pruebas contra `vite preview`.
- Que las teselas del mapa carguen bien con datos móviles. (5/11: CARTO empezó a pedir clave y se veía «API KEY
  REQUIRED»; el mapa usa ahora OpenStreetMap, sin clave, oscurecido con un filtro en modo oscuro.)
- La búsqueda de direcciones (Nominatim) en el teléfono; si no encuentra, se toca el mapa.
- Subir un PDF desde el teléfono (Archivos, Drive o iCloud) y ubicar las firmas con el dedo.
- Ver un contrato en PDF sin conexión: hace falta haber abierto uno antes con conexión (el motor de pdf.js se
  descarga la primera vez).

## Ronda 3 (lo que quedó y por qué)

### Datos reales sin servidor
- **Resuelto en parte (9/11):** Administración y Dirección ya comparten los datos por el servidor. Los vendedores y los
  locales todavía no (fase 2).
- **Riesgo de perder datos:** Safari puede borrar los datos de un sitio que no se abre en 7 días si no está instalado
  en la pantalla de inicio; Chrome suele negar el almacenamiento persistente hasta instalar la app. Por eso el aviso de
  copia a los 7 días. La copia JSON lleva datos reales de la empresa: guardarla en un lugar privado.
- **Contraseñas (resuelto 9/11):** con datos reales se entra con correo y contraseña. Los datos siguen guardados en
  cada teléfono donde se entró (para funcionar sin señal): un teléfono perdido con la sesión abierta los muestra.
  Quitarle el acceso a esa cuenta corta la sincronización, no lo que ya estaba en el teléfono.
- **Banco y tienda en línea:** conectar el banco a la contabilidad necesita servidor, seguridad y el permiso del
  banco; la tienda al público necesita la licencia federal, control de edad (21+) y pagos. Quedan para después del
  servidor.

### Importar desde Odoo
- Probado con la exportación corta real de la empresa (fuera del repositorio): 79 filas, 0 errores, 51 familias.
  **No trae precios ni costos**: quedan a $25 por mazo (premium a $40) y costo 0 «de ejemplo» hasta cargarlos.
- **Confirmar con el equipo:** que las cantidades de Odoo son mazos (no cajas) y en qué unidad cuentan los paquetes
  premium (5 Pack, 10 Pack, Box). Hoy: mazos, y cada paquete o caja premium como una unidad.
- Los premium importados toman el stock bajo por defecto (60) y casi todos salen «Stock bajo»; a lo importado le
  pueden faltar campos (vitola en premium) que el formulario pide al editar.
- Los 10 000 códigos «hechos a mano»: la app identifica por variante (código de barras o SKU) y, si se quiere, por
  caja (trazabilidad). Un código distinto por cada mazo no está.

### Escáner, etiquetas y recepción
- Probado con la cámara falsa de Chrome y con fotos; **falta probarlo en un iPhone y un Android reales** (y la
  linterna). Las etiquetas no se imprimieron todavía en hojas Avery 5160 ni en una térmica real.
- La lista de empaque en Excel se probó con CSV; las reglas para reconocer productos («52 torpedo maduro») necesitan un
  archivo real de la fábrica. Un contenedor de 147 bultos dibuja todas las filas a la vez.
- El borrador de «Contar» vive solo en ese navegador.
- El lector de mano (USB o Bluetooth) se probó simulando sus teclas: se reconoce una lectura cuando entre tecla y
  tecla pasan menos de 60 ms. Falta probar un lector real; uno Bluetooth lento puede necesitar más margen.

### Venta en firme
- No hay devoluciones ni notas de crédito de una factura, ni anular facturas, ni límite de crédito o bloqueo de un
  local con facturas vencidas.
- La factura es de demostración (no es una factura fiscal). Compartir por WhatsApp sin poder adjuntar manda solo el
  texto: el PDF se adjunta a mano.
- «Pegar pedido» no entiende «2 cajas y 5 mazos de toro» en una línea, puede leer un precio («a $25») como cantidad y
  no entiende decimales con coma en las medidas. Más adelante, el bot de WhatsApp con notas de voz y fotos de la lista.
- **Impuestos:** confirmar con la contadora la regla del certificado de reventa y los impuestos al tabaco que paga el
  distribuidor (Florida y Texas).

### Red
- Houston no tiene almacén propio: sus entregas no entran en repartos. Hace falta un punto de salida en Houston.
- La comisión progresiva no recalcula lo ya devengado en el mes cuando se sube de escalón; en los repartos un mazo
  cuenta como una unidad para repartir el costo.
- La lista de locales no filtra por mercado; los avisos de documentos por vencer se crean al abrir el inicio de
  Administración (no hay un proceso en segundo plano).

### Diseño
- Las webs de referencia (Plasencia y CAO) no se pudieron abrir desde el entorno donde se construyó (la red las
  bloquea): la ficha sigue lo que el equipo dijo que le gustó, sin copiar textos, imágenes ni marcas.

## Sin datos de ejemplo (6 de noviembre de 2026)

- **La ubicación del almacén** quedó en el punto de partida (Doral) y no hay pantalla para cambiarla: el mapa y los km de
  los repartos salen de ahí. Hace falta «Dirección del almacén» en Ajustes, con la misma búsqueda que usa «Registrar
  tienda».
- **Los valores de partida de Ajustes** son números para empezar, no de la empresa: comisión progresiva de Tabaco
  (7 %, 8 % y 10 % con tope de 10 %), costo por km de los repartos ($0.65 Tabaco, $0.60 Café), frecuencia de
  liquidación y la plantilla del contrato (que sigue diciendo que la revisa un abogado antes de usarla).
- **El importador de Odoo todavía inventa precios** cuando el archivo no los trae ($25 por mazo, $40 premium, costo 0
  provisional). Es el mismo tipo de número que se acaba de quitar. Lo coherente: que entren sin precio y desactivados,
  como los cafés de El Mío. Queda para decidir con el equipo.
- **Vendedores y locales no tienen nada que ver** hasta que Administración los cree, y todavía no entran desde sus
  teléfonos (fase 2 del servidor, `SUPABASE.md`).
- Quien escriba la marca `pruebas:datos-de-ejemplo` en su navegador ve la demo, pero solo en líneas que no son reales:
  no puede tapar ni borrar datos de la empresa.

## Tabaco y Café separados (9 de noviembre de 2026)

- **El link de Tabaco sigue dentro del sitio de Café El Mío** (`rengifojjrr.github.io/cafe-el-mio/gestion/`). Para que
  estén separados de verdad, Tabaco debería tener su propio repositorio y su propio link (y más adelante su dominio).
  Crear el repositorio lo hace el dueño de la cuenta de GitHub; mudarlo cambia el link y quien lo instaló lo instala de
  nuevo.
- **El café está en espera**, no borrado: para activarlo hace falta su link, su compilación y correr sus pruebas
  (`CAFE-EN-ESPERA.md`). Lo correcto es activarlo ya con el servidor, cada programa con su proyecto.
- Si en algún navegador quedaron bases viejas con datos reales (`eco-tabaco` o `eco-cafe`), no se ven en el programa:
  recuperarlas es trabajo de un técnico (exportarlas desde las herramientas del navegador).

## Con el servidor (9 de noviembre de 2026)

- **Probar con dos teléfonos de verdad**: entrar, cargar en uno y ver en el otro, sin señal y de vuelta. Está probado
  con un servidor de mentira con las mismas reglas y con pruebas SQL en el de verdad, no en dos teléfonos.
- **Dominio propio:** las páginas de `rengifojjrr.github.io` comparten el almacenamiento del navegador, también la
  sesión guardada del programa. Con un dominio propio solo el programa la ve.
- **La copia semanal sigue siendo a mano** mientras el servidor esté en el plan gratis.
- **Fotos de un tipo raro** (por ejemplo HEIC de un iPhone si no se convirtió) no suben al depósito: quedan anotadas
  como rechazadas en ese teléfono. La app convierte las fotos a WebP al cargarlas; los PDF suben tal cual (hasta 10 MB).
