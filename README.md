# Café El Mío — sitio web

Sitio de marca para Café El Mío, café cubano tostado y empacado en Miami. HTML, CSS y JavaScript sin frameworks ni paso de compilación. El pago se hace en la tienda Shopify (`cafe-el-mio.myshopify.com`).

- **Ver el sitio:** https://rengifojjrr.github.io/cafe-el-mio/
- **Páginas:** se generan con `python3 fuente/construir.py`. Cabecera, menú, bolsa, pie y las fichas de `cafes/` salen de ese archivo; edítalo ahí y vuelve a correrlo.
- **Productos:** `assets/js/catalogo.js` tiene los textos en español y las variantes de Shopify. Al cargar, el sitio actualiza precios y disponibilidad en vivo desde la tienda; si aparece un producto nuevo en Shopify, se muestra solo en la tienda.
- **Carrito:** se guarda en el navegador. «Pagar» abre el checkout de Shopify en español con todo lo elegido.
- **Créditos** de fotos (Wikimedia Commons) y videos (Mixkit): `creditos.html`.

Antes de pasarlo al dominio real (cafeelmio.com): quitar el `noindex` en `fuente/construir.py`, cambiar `SITIO_URL` y el `<base href>` de la página 404, y volver a generar.
