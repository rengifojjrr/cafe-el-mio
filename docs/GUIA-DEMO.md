# Guía de la demo (una página)

**Link:** https://rengifojjrr.github.io/cafe-el-mio/gestion/ · también el QR de la portada.
**Instalar:** Android/Chrome, en la portada «Instalar en el teléfono». iPhone/Safari: Compartir → «Agregar a pantalla de inicio».
**Cambiar de cuenta:** el botón flotante «Cambiar de rol» (abajo a la derecha) o «Entrar como…» en la portada.
**Recorrido guiado:** en la portada, «Recorrido guiado» → Tabaco o Café: 7 pasos que cambian de cuenta solos.

## Recorrido de 5 pasos para enseñar

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

## Qué tocar para ver cada cosa

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

## Para llevar la demo a otro teléfono

Portada → «Exportar (JSON)» y, en el otro teléfono, «Importar (JSON)». «Restablecer demo» vuelve a los datos de
ejemplo con fechas de hoy. Todo vive en el navegador: lo que hace una persona no lo ve otra en otro teléfono.

## Ronda 3: lo que pidió el equipo de tabaco

**Para empezar con sus datos:** Tabaco · Administración → Ajustes → «Empezar en blanco» (se escribe «Tabaco») →
Catálogo → «Importar» (el Excel o CSV que exporta Odoo). Arriba se ve «Datos reales · solo en este navegador».
Antes de enseñar la demo otra vez: portada → «Restablecer demo» (con datos reales pide escribir «borrar»).

| Quiero ver | Cuenta | Dónde |
|---|---|---|
| Premium o de mazo, familias con sus capas como chips | Tabaco · cualquiera | Catálogo (buscar «toro») |
| Filtros de un toque (tipo, capa, fortaleza, con stock) y «Más filtros» | Cualquiera | Catálogo |
| Ficha con el tabaco grande, capas de la familia, «Ver en 3D» | Cualquiera | Catálogo → Toro 6 × 52 |
| Comparar tamaños (2 a 4, de pie y a escala) | Cualquiera | Catálogo → «Comparar» o la ficha → «Comparar con…» |
| Alta de producto: «¿Premium o de mazo?» y «Otra variante» | Tabaco · Administración | Catálogo → «Nuevo producto» o una ficha |
| Volver de una ficha a la lista en el mismo punto y con los filtros | Cualquiera | Catálogo (o Locales, Pedidos…) |
| Empezar en blanco, copia de seguridad, importar una copia | Administración | Ajustes → «Datos de Tabaco» |
| Importar productos desde Excel (Odoo) con vista previa | Administración | Catálogo → «Importar» |
| Fotos en lote por nombre de archivo (SKU o código) | Administración | Catálogo → «Fotos en lote» |
| Escanear (cámara, foto o a mano) y la ruta de una caja | Tabaco · Administración | Buscar código (`C-IMP-2026-001-0001`, `E-0001`) |
| Etiquetas con código de barras y QR (carta o 2 × 1″) | Administración | Catálogo o una ficha → «Imprimir etiquetas» |
| Recibir una importación bulto por bulto (12 bultos) | Tabaco · Administración | Almacén → Importaciones → IMP-2026-016 → «Confirmar bultos» |
| Barra de avance de un contenedor grande (37 de 147) | Tabaco · Administración | Almacén → Importaciones → IMP-2026-015 |
| Diferencias de la importación (PDF y CSV) | Tabaco · Administración | Una importación recibida |
| Contar el almacén escaneando | Administración | Almacén → «Contar» |
| Local en firme: pedido → entrega firmada → factura → pago | Administración | Bodega El Primo (pedido por teléfono) → Entregas → Cobros |
| Venta rápida (tres toques para un mazo) y factura para compartir | Administración | Inicio o Entregas → «Venta rápida» |
| Pegar un pedido de WhatsApp | Administración | Pedidos → «Pegar pedido» («10 toro maduro, 5 robusto habano, 2 cajas torpedo») |
| Listas de precios (fijo o % sobre costo, por caja y desde N cajas) | Administración | Ajustes → «Listas de precios» |
| El local en firme ve solo su precio | Otras cuentas → Ramón Quesada (Bodega El Primo) | Catálogo |
| Factura vencida / certificado de reventa vencido | Administración | Cobros (Licorería La Bendición) / Locales (Mini Market Flagler 57) |
| Invitar a un vendedor o a un local (link, QR, WhatsApp) | Administración | Usuarios → Tomás Garza → «Invitar», o un local |
| Tax ID, certificado de reventa y sus archivos; avisos de vencimiento | Administración | Un local → editar; Bodega Ocho y Medio no tiene certificado |
| Reporte para la contadora (CSV y PDF) | Administración | Contabilidad → «Reporte para la contadora» |
| Comisión progresiva: «Vas en el N % · con X locales más pasas al M %» | Tabaco · Vendedor | Inicio; Ajustes → comisión progresiva y simulador |
| Miami y Houston | Tabaco · Administración o Dirección | Mapa (cambiar de mercado), Rentabilidad, Dirección |
| Repartos: ruta del camión, paradas, costos | Tabaco · Administración | Repartos; el costo aparece en Rentabilidad |
