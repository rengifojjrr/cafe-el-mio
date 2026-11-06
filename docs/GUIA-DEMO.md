# Guía de uso (una página)

**Link:** https://rengifojjrr.github.io/cafe-el-mio/gestion/ · también el QR de la portada.
**Instalar:** Android/Chrome, en la portada «Instalar en el teléfono». iPhone/Safari: Compartir → «Agregar a pantalla de inicio».
**Cambiar de cuenta:** el botón flotante «Cambiar de rol» (abajo a la derecha) o «Entrar como…» en la portada. Todavía
no hay contraseñas: cualquiera con ese navegador entra con cualquier cuenta.

## Cómo empieza: sin datos de ejemplo

Desde el 6 de noviembre de 2026 la app ya no trae datos de ejemplo. Cada navegador que abre el link arranca con Tabaco
y Café en blanco, ya como datos reales. El que tenía la demo de antes la pierde al abrir la versión nueva; lo que ya era
real (una línea que empezó en blanco) no se toca.

1. **Entrar:** «Entrar como…» tiene tres cuentas: Dirección, Administración de Tabaco y Administración de Café. Los
   vendedores y los locales se crean en Usuarios y en Locales.
2. **Tabaco:** Catálogo → «Importar» (el Excel o CSV que exporta Odoo). Si el archivo no trae precios ni costos, hay que
   ponerlos antes de vender.
3. **Café:** los 9 cafés de El Mío ya están, con sus fotos, su descripción y el PVP de la tienda, pero sin precio al
   local ni costo y desactivados: Inicio → «Ponerles precio» → cada café → «Editar» → precio al local, costo y «Activo».
   Sin precio al local no se pueden activar.
4. **Ajustes de cada línea:** revisar los valores de partida (comisión progresiva de Tabaco 7–10 %, costo por km de
   los repartos, frecuencia de liquidación, plantilla del contrato) y crear las listas de precios. La ubicación del
   almacén es un punto de partida en Doral: todavía no hay una pantalla para cambiarla.
5. **Copia:** los datos viven solo en ese navegador. Exportar la copia de cada línea (Ajustes → «Exportar copia») o de
   todo (portada → «Exportar copia (JSON)») y guardarla fuera del teléfono. Una copia de la demo de antes ya no se carga.

## La demo de las pruebas automáticas

Las pruebas (Vitest y Playwright) siguen usando los datos de ejemplo de siempre; lo que sigue describe esa demo. Para
verla a mano (equipo técnico), en una ventana de incógnito: abrir la web de la marca
(`https://rengifojjrr.github.io/cafe-el-mio/`, el mismo sitio), escribir en la consola del navegador
`localStorage.setItem('pruebas:datos-de-ejemplo', '1')` y después abrir el link de la app. Una línea con datos reales
nunca se reemplaza por la demo.

### Recorrido de 5 pasos para enseñar

1. **Dirección** (portada → «Dirección»): las dos líneas lado a lado, cada una con sus colores y sus cifras. La suma va
   aparte, marcada como informativa. «Abrir Tabaco como Administración» entra en solo mirar.
2. **Tabaco · Administración:** el centro de mando con el mapa (los locales con pedido pendiente laten). Catálogo →
   Everglades Torpedo: silueta a escala, stock bajo, «llegan 500 en 8 días».
3. **Tabaco · Vendedor (Andrés):** Mis locales → Bodega La Esquina 49 → «Firmar contrato»: firman el encargado y el
   vendedor en el teléfono. Licorería Humo y Ron: permiso vencido, «Pedir producto» bloqueado.
4. **Café · Local (Ventanita Azul):** lo que tiene en consignación y lo que gana por cada producto → «Pedir más».
   Después Café · Vendedor confirma el pedido y Café · Administración lo prepara en Entregas.
5. **Tabaco · Administración → Cobros:** Tabaquería Ficha Doble tiene liquidaciones vencidas; «Registrar pago»
   (solo el apunte). Con eso, las comisiones de su vendedora pasan a «por cobrar».

### Qué tocar para ver cada cosa

| Quiero ver | Cuenta | Dónde |
|---|---|---|
| Catálogo de tabaco con siluetas a escala | Tabaco · Administración | Catálogo |
| Los 9 productos de El Mío | Café · cualquiera | Catálogo |
| Importación en tránsito y en producción | Tabaco · Administración | Almacén → Importaciones |
| Lotes de tostado y tanda programada | Café · Administración | Almacén → Lotes de tostado |
| Café por vencer en un local | Café · Vendedor | Inicio («Atención») o Locales → Panadería Dulce Hogar |
| Registrar tienda (OpenStreetMap o tocar el mapa) | Vendedor | Inicio → «Registrar tienda» |
| Contrato con firma doble y PDF | Vendedor | Bodega La Esquina 49 (tabaco) o Mercado Sabor Latino (café) |
| Aprobar un local firmado | Administración | Locales → Estanco Gables (tabaco) o Market Playa Norte (café) |
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
