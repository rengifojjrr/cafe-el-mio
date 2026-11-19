# Permisos por rol

Se aplican en `src/domain/permissions.ts` (`can` y `ensure`) y los usan **todos** los servicios de `src/services/`.
Las pantallas solo esconden lo que el servicio ya rechaza. Las pruebas de `tests/unit/permisos*.test.ts` intentan lo
prohibido y comprueban que falla.

## Reglas generales

1. **Línea:** una cuenta de Tabaco nunca lee ni escribe Café, ni al revés (`can` exige `actor.line === línea`).
2. **Solo mirar:** con «Ver como…» (Administración) o con Dirección dentro de una línea, el actor es de solo lectura:
   toda acción de escritura se rechaza.
3. **Dueño del recurso:** un vendedor solo toca sus locales (`store.sellerId === actor.userId`); un local, solo el
   suyo (`store.id === actor.storeId`).
4. **Costos:** solo Administración. Para los demás roles el campo `cost` no viaja en el producto, y los costos por lote
   de ventas y devoluciones se ponen en cero. Con el servidor, a un vendedor ni siquiera le llegan (los quita
   `tabaco_traer`) y el costo de lo que vende lo pone el servidor.

## Matriz

| Acción | Administración | Vendedor | Local | Dirección |
|---|---|---|---|---|
| Ver catálogo (`product.read`) | ✔ | ✔ (con su comisión) | ✔ (su precio y lo que gana; nunca el precio base) | — |
| Ver costos (`product.readCost`) | ✔ | — | — | — |
| Editar catálogo, fotos (`product.write`) | ✔ | — | — | — |
| Ver stock y llegadas (`inventory.read`) | ✔ | ✔ | ✔ | — |
| Llegadas, ajustes, mermas de almacén (`inventory.write`) | ✔ | — | — | — |
| Listar locales (`store.list`) | todos | los suyos | — | — |
| Ver un local (`store.read`) | ✔ | si es suyo | si es el suyo | — |
| Registrar tienda (`store.create`) | ✔ | ✔ (queda a su nombre) | — | — |
| Editar tienda (`store.update`) | ✔ | si es suya | — | — |
| Precios de cada local, con el base al lado (verlos: `store.read`; ponerlos, nunca menos que el base: `store.update`) | ✔ | si es suyo | — | — |
| Ver los recorridos de prospectos (`store.list`) | todos | los suyos | — | — |
| Anotar la visita a un prospecto (`store.update`) | ✔ | si es suyo | — | — |
| Aprobar, pausar, cerrar (`store.approve`) | ✔ | — | — | — |
| Ver contrato (`contract.read`) | ✔ | si es suyo | el suyo | — |
| Emitir y firmar contrato (`contract.issue`, `contract.sign`) | ✔ | si es suyo | — | — |
| Pedir producto en consignación (`delivery.request`) | ✔ | si es suyo | — | — |
| Aprobar y preparar entregas (`delivery.prepare`) | ✔ | — | — | — |
| Recibir entrega con firma (`delivery.receive`) | ✔ | si es suyo | el suyo | — |
| Registrar visita y conteo (`visit.create`) | ✔ | si es suyo | — | — |
| Reportar ventas (`sale.report`) | ✔ | si es suyo | el suyo | — |
| Devoluciones y mermas en el local (`return.create`) | ✔ | si es suyo | — | — |
| Pedir más (`reorder.create`) | ✔ | si es suyo | el suyo | — |
| Confirmar pedido del local (`reorder.confirm`) | ✔ | si es suyo | — | — |
| Ver liquidaciones (`settlement.read`) | todas | de sus locales | las suyas | — |
| Generar liquidación, registrar pago | ✔ | — | — | — |
| Ver comisiones (`commission.read`) | todas | las suyas | — | — |
| Pagar comisiones (`commission.pay`), con las que no cuadran marcadas («Comisiones por revisar») | ✔ | — | — | — |
| Contabilidad y reportes | ✔ | — | — | — |
| Mapa (`map.read`) | todos los locales | su ruta y sus locales | — | — |
| Mensajes (`message.read/send`) | todos los hilos (escribe donde participa) | sus hilos | sus hilos | — |
| Comunicados (`announcement.create`) | ✔ | — | — | — |
| Usuarios, ajustes y auditoría | ✔ | — | — | — |
| Equipo: zonas con responsable, por vendedor, zona y ciudad (`user.read`; cambiar responsable: `user.manage`) | ✔ | — | — | — |
| Clientes: personas y almacén (mostrador), con su historial (`invoice.read`; crear y cambiar una persona: `sale.quick`) | ✔ | — | — | — |
| Regla de precio por medida (`settings.manage`); aplicarla y deshacerla (`product.write`) | ✔ | — | — | — |
| Vista de las dos líneas (`direccion.read`) | — | — | — | ✔ (solo lectura) |

## Notas

- El local escribe a Administración solo si su vendedor no contestó en 24 horas (`escalationStatus`).
- Dirección puede abrir una línea «como Administración», siempre en solo lectura.
- **Con el servidor, las reglas del vendedor se repiten allí** (`supabase/migrations/tabaco_5_vendedores.sql`): qué le
  baja (`tabaco.para_vendedor`: solo lo suyo y sin costos) y qué le acepta (`tabaco.revisar_vendedor`). Es lo que los hace
  seguros de verdad: la app solo esconde. Ver «Vendedores» en `SUPABASE.md`. Dirección mira y no guarda; las cuentas de
  los locales todavía no entran al servidor.
- **Comisiones por revisar:** el servidor no recalcula el monto de las comisiones que sube un vendedor; Administración
  ve las que no cuadran con su venta antes de pagarlas (Comisiones).
