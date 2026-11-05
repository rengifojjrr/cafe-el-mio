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

- **Pasar a servidor (Supabase)** para que varios usuarios compartan datos en tiempo real (plan en `SUPABASE.md`).
  Sin servidor, el contrato que se firma en el teléfono del vendedor no lo ven ni administración ni el local en
  sus teléfonos.
  Hoy cada navegador tiene su copia; exportar/importar JSON sirve para llevar la demo a otro teléfono.
- Lista real de vendedores, zonas y locales; fotos reales de los tabacos.
- Dominio propio (hoy GitHub Pages).

## Para comprobar en el teléfono (no se pudo desde el contenedor)

- Abrir el link publicado, instalarlo y recorrerlo: desde aquí la red no deja abrir `rengifojjrr.github.io`. La
  compilación publicada es la misma que pasó todas las pruebas contra `vite preview`.
- Que las teselas del mapa (CARTO) carguen bien con datos móviles; si fallan, la app cambia sola a OpenStreetMap.
- La búsqueda de direcciones (Nominatim) en el teléfono; si no encuentra, se toca el mapa.
- Subir un PDF desde el teléfono (Archivos, Drive o iCloud) y ubicar las firmas con el dedo.
- Ver un contrato en PDF sin conexión: hace falta haber abierto uno antes con conexión (el motor de pdf.js se
  descarga la primera vez).
