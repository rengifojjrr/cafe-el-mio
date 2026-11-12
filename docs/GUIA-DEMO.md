# Guía de uso (una página)

**Link:** https://rengifojjrr.github.io/cafe-el-mio/gestion/ · también el QR de la portada.
**Instalar:** Android/Chrome, en la portada «Instalar en el teléfono». iPhone/Safari: Compartir → «Agregar a pantalla de inicio».
**Entrar:** con tu correo y tu contraseña (portada → «Entrar»), una sola vez en cada teléfono o computadora: la sesión
queda guardada y, al abrir la app, entra sola. Para salir: el aviso del servidor (arriba) → «Cerrar sesión». En una
ventana de incógnito no se guarda. Para tener cuenta hace falta una invitación de Administración. «Entrar como…» y
«Cambiar de rol» quedan solo en las pruebas automáticas.

## Cómo empieza: solo Tabaco y en cero

Desde el 9 de noviembre de 2026 este es **el programa de Tabaco**. El café es otro programa (con su link y sus bases de
datos) y todavía no empieza: ver `CAFE-EN-ESPERA.md`. Cualquier navegador que abre el link arranca en cero, sin datos de
ejemplo y con bases de datos propias del programa («tabaco-cuentas» y «tabaco-datos»). Las bases de antes, con las dos
líneas juntas, se borran solas si solo tenían ejemplos.

1. **Entrar:** portada → «Entrar», con el correo y la contraseña. Entran Administración (carga y cambia todo) y Dirección
   (solo mira las cifras). Los vendedores y los locales se crean en Usuarios y en Locales; todavía no entran a la app
   desde sus teléfonos (llega en la próxima etapa).
2. **Catálogo:** «Importar» (el Excel o CSV que exporta Odoo). Si el archivo no trae precios ni costos, hay que ponerlos
   antes de vender.
3. **Ajustes:** revisar los valores de partida (comisión progresiva 7–10 %, costo por km de los repartos, frecuencia
   de liquidación, plantilla del contrato) y crear las listas de precios. La ubicación del almacén es un punto de
   partida en Doral: todavía no hay una pantalla para cambiarla.
4. **Copia:** el servidor copia todo cada madrugada y guarda 30 días; en Inicio se ve cuándo fue la última. Antes de
   que una importación reemplace datos, hace otra. «Bajar una copia» (en Inicio) guarda además una en el teléfono:
   conviene una al mes, guardada fuera del teléfono.

## El servidor: lo que conviene saber

Lo que se carga queda **en el servidor del programa y en cada teléfono donde se entró**. Así la app funciona sin señal:
guarda en el teléfono y sube cuando vuelve la señal. Arriba, en cada pantalla, el aviso del servidor dice cómo va:
«Al día», «3 por subir», «Sin señal» o «Vuelve a entrar». Al tocarlo: «Sincronizar ahora» y «Cerrar sesión».

1. **Invitar a alguien:** Usuarios → «Acceso con contraseña» → «Invitar» (nombre, correo, Dirección o
   Administración). Sale un link para mandar por WhatsApp: sirve una sola vez y vence en los días elegidos. Quien lo
   abre pone su contraseña y entra. Si alguien olvida su contraseña, se le invita otra vez.
2. **Quitar el acceso:** en la misma lista, «Quitar acceso». Ese teléfono deja de sincronizar y pide volver a entrar.
3. **La primera vez en cada teléfono:** si el teléfono ya tenía datos cargados (de antes del servidor) y el servidor
   también, la app pregunta qué hacer: «Subir lo de este teléfono» (en el teléfono donde se cargó todo) o «Usar lo
   del servidor». Antes deja bajar una copia. Si el servidor está vacío, el primer teléfono lo llena solo.
4. **Si dos personas cambian lo mismo**, queda el último cambio que llega al servidor.
5. **Instalar la app** en cada teléfono (portada → «Instalar en el teléfono»), sobre todo en iPhone: Safari borra los
   datos de un sitio que no se abre en 7 días si no está en la pantalla de inicio. Lo que ya subió no se pierde, pero
   lo que no había subido sí.
6. **«Importar copia» reemplaza todo**: en ese teléfono y, al sincronizar, en el servidor y en los teléfonos de todos.
   Sirve para recuperar los datos, nunca para juntar lo de dos personas. Antes de reemplazar, el servidor guarda una
   copia de lo que había.

## Recorridos de prospectos

Para salir a visitar locales que todavía no son clientes: **Recorridos** (la tarjeta «Recorridos» en Inicio, en el menú,
o Locales → «Recorridos»).

1. **Anotar los locales.** Locales → «Registrar tienda» con lo que se sepa: nombre, dirección y el punto en el mapa.
   El encargado, el teléfono, el horario y el permiso pueden quedar vacíos: se piden antes del contrato.
2. **El recorrido.** Los prospectos salen por zona y en orden de cercanía (desde el centro del mercado o, con
   «Ordenar desde donde estoy», desde el teléfono). «Abrir el recorrido en Google Maps» arma la ruta: Google Maps en el
   teléfono abre hasta 4 paradas por vez, así que una zona con más sale en tramos («Paradas 1 a 4», «5 a 8»…).
3. **En cada parada:** «Anotar visita» → qué pasó (le interesa, lo va a pensar, no le interesa, no estaba el
   encargado, estaba cerrado) y lo que dio el local. Lo que se deja vacío no borra lo anotado. Cada parada dice lo que
   falta («Falta: encargado, correo…»).
4. **Después:** la visita sale del recorrido (salvo «No estaba el encargado», que queda para volver) y queda en la
   ficha del local, en «Visitas de recorrido». Con los datos completos, en la ficha: «Preparar contrato».

## La demo de las pruebas automáticas

Las pruebas (Vitest y Playwright) siguen usando los datos de ejemplo de siempre; lo que sigue describe esa demo. Para
verla a mano (equipo técnico), en una ventana de incógnito: abrir la web de la marca
(`https://rengifojjrr.github.io/cafe-el-mio/`, el mismo sitio), escribir en la consola del navegador
`localStorage.setItem('pruebas:datos-de-ejemplo', '1')` y después abrir el link de la app. Una línea con datos reales
nunca se reemplaza por la demo.

### Recorrido de 5 pasos para enseñar

1. **Dirección** (portada → «Dirección»): Tabaco de un vistazo, en solo mirar: ventas, margen, lo que se debe,
   inventario y comisiones. «Abrir Tabaco como Administración» entra en solo mirar.
2. **Tabaco · Administración:** el centro de mando con el mapa (los locales con pedido pendiente laten). Catálogo →
   Everglades Torpedo: silueta a escala, stock bajo, «llegan 500 en 8 días».
3. **Tabaco · Vendedor (Andrés):** Mis locales → Bodega La Esquina 49 → «Firmar contrato»: firman el encargado y el
   vendedor en el teléfono. Licorería Humo y Ron: permiso vencido, «Pedir producto» bloqueado.
4. **Tabaco · Local:** lo que tiene en consignación y lo que gana por cada producto → «Pedir más». Después el
   vendedor confirma el pedido y Administración lo prepara en Entregas.
5. **Tabaco · Administración → Cobros:** Tabaquería Ficha Doble tiene liquidaciones vencidas; «Registrar pago»
   (solo el apunte). Con eso, las comisiones de su vendedora pasan a «por cobrar».

### Qué tocar para ver cada cosa

| Quiero ver | Cuenta | Dónde |
|---|---|---|
| Catálogo de tabaco con siluetas a escala | Tabaco · Administración | Catálogo |
| Importación en tránsito y en producción | Tabaco · Administración | Almacén → Importaciones |
| Registrar tienda (OpenStreetMap o tocar el mapa) | Vendedor | Inicio → «Registrar tienda» |
| Contrato con firma doble y PDF | Vendedor | Bodega La Esquina 49 |
| Aprobar un local firmado | Administración | Locales → Estanco Gables |
| Visita con conteo | Vendedor | Un local activo → «Registrar visita» |
| Pedido del local por confirmar | Vendedor | Inicio («Pendientes») o Pedidos |
| Pedir un producto en dos toques | Local | Catálogo → «Pedir» en la tarjeta, o la ficha → «Pedir este producto» |
| Lo que debe el local (incluye lo vendido sin liquidar) | Local | Inicio o Cuentas |
| Recibir una entrega (firma el dueño o encargado) | Local, o el vendedor pasándole el teléfono | Inicio («Para recibir») o Entregas |
| Horario de una tienda con días y horas | Vendedor | Registrar tienda o editar un local |
| Entrega por preparar | Administración | Entregas → «Por preparar» |
| Antigüedad de lo que se debe y pagos | Administración | Cobros |
| Comisiones por producto, local y mes | Vendedor | Comisiones |
| Estado de resultados, inventario valorado, CSV | Administración | Contabilidad |
| Lo más vendido, lo más pedido, rentabilidad | Administración | Rentabilidad |
| Mensajes y escalar a administración (24 h) | Tabaco · Local (El Faro) | Mensajes |
| Ajustes y plantilla de contrato | Administración | Ajustes |
| Subir un PDF de contrato o de nota de entrega y ubicar las firmas | Administración | Contratos → Plantillas |
| Todo lo firmado: contratos y notas de entrega (cada uno ve lo suyo) | Cualquiera | Contratos («Mis contratos» en el local) |
| Quién hizo qué | Administración | Auditoría |
| Mirar con los ojos de otro | Administración | «Ver como…» (arriba) |

## Ronda 3: lo que pidió el equipo de tabaco

Las cuentas y los locales de esta tabla son los de la demo de las pruebas. Con los datos de la empresa, lo mismo está
en el mismo lugar. «Empezar en blanco» (Ajustes → «Datos de Tabaco», escribiendo «Tabaco») sigue sirviendo para vaciar
una línea real y empezar de nuevo.

| Quiero ver | Cuenta | Dónde |
|---|---|---|
| Premium o de mazo, familias con sus capas como chips | Tabaco · cualquiera | Catálogo (buscar «toro») |
| Filtros de un toque (tipo, capa, fortaleza, con stock) y «Más filtros» | Cualquiera | Catálogo |
| Ficha con el tabaco grande, capas de la familia, «Ver en 3D» | Cualquiera | Catálogo → Toro 6 × 52 |
| Comparar tamaños (2 a 4, de pie y a escala) | Cualquiera | Catálogo → «Comparar» o la ficha → «Comparar con…» |
| Alta de producto: «¿Premium o de mazo?» y «Otra variante» | Tabaco · Administración | Catálogo → «Nuevo producto» o una ficha |
| Volver de una ficha a la lista en el mismo punto y con los filtros | Cualquiera | Catálogo (o Locales, Pedidos…) |
| Vaciar una línea, copia de seguridad, importar una copia | Administración | Ajustes → «Datos de Tabaco» |
| Importar productos desde Excel (Odoo) con vista previa | Administración | Catálogo → «Importar» |
| Fotos en lote por nombre de archivo (SKU o código) | Administración | Catálogo → «Fotos en lote» |
| Escanear (cámara, foto o a mano) y la ruta de una caja | Tabaco · Administración | Buscar código (`C-IMP-2026-001-0001`, `E-0001`) |
| Etiquetas con código de barras y QR (carta o 2 × 1″) | Administración | Catálogo o una ficha → «Imprimir etiquetas» |
| Recibir una importación bulto por bulto (12 bultos) | Tabaco · Administración | Almacén → Importaciones → IMP-2026-016 → «Confirmar bultos» |
| Barra de avance de un contenedor grande (37 de 147) | Tabaco · Administración | Almacén → Importaciones → IMP-2026-015 |
| Diferencias de la importación (PDF y CSV) | Tabaco · Administración | Una importación recibida |
| Contar el almacén escaneando | Administración | Almacén → «Contar» |
| Preparar una entrega con un lector de mano (USB o Bluetooth) | Tabaco · Administración | Entregas → «Preparar escaneando» → «Escanear»: la pistola cuenta sin tocar la pantalla |
| Local en firme: pedido → entrega firmada → factura → pago | Administración | Bodega El Primo (pedido por teléfono) → Entregas → Cobros |
| Venta rápida (tres toques para un mazo) y factura para compartir | Administración | Entregas, Cobros o Más → «Venta rápida» (o la ficha de un local) |
| Pegar un pedido de WhatsApp | Administración | Entregas o Más → Pedidos → «Pegar pedido» («10 toro maduro, 5 robusto habano, 2 cajas torpedo») |
| Listas de precios (fijo o % sobre costo, por caja y desde N cajas) | Administración | Ajustes → «Listas de precios» |
| El local en firme ve solo su precio | Otras cuentas → Ramón Quesada (Bodega El Primo) | Catálogo |
| Factura vencida / certificado de reventa vencido | Administración | Cobros (Licorería La Bendición) / Locales (Mini Market Flagler 57) |
| Invitar a un vendedor o a un local (link, QR, WhatsApp) | Administración | Usuarios → Tomás Garza → «Invitar», o un local |
| Tax ID, certificado de reventa y sus archivos; avisos de vencimiento | Administración | Un local → editar; Bodega Ocho y Medio no tiene certificado |
| Reporte para la contadora (CSV y PDF) | Administración | Contabilidad → «Reporte para la contadora» |
| Comisión progresiva: «Vas en el N % · con X locales más pasas al M %» | Tabaco · Vendedor | Inicio; Ajustes → comisión progresiva y simulador |
| Miami y Houston | Tabaco · Administración o Dirección | Mapa (cambiar de mercado), Rentabilidad, Dirección |
| Repartos: ruta del camión, paradas, costos | Tabaco · Administración | Repartos; el costo aparece en Rentabilidad |
