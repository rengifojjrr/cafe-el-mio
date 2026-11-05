// Plantillas de contrato de consignación por línea. Administración puede editarlas en Ajustes.
// Son de ejemplo: las revisa un abogado antes de usarlas con locales reales.

const COMMON_TAIL = `## Liquidación y pago
Cada {{liquidacion.dias}} días la Empresa liquida lo vendido: unidades vendidas × precio al local. El Local paga cada liquidación dentro de los {{pago.dias}} días siguientes, en efectivo, cheque, Zelle o transferencia. La Empresa entrega un comprobante de cada pago.

## Conteos y visitas
El representante de la Empresa visita el Local, cuenta la mercancía en consignación y registra la diferencia con lo colocado como venta. El Local también puede reportar sus ventas desde su cuenta en la aplicación.

## Daños, robo y mermas
El Local cuida la mercancía como si fuera propia. Los productos dañados, robados o perdidos dentro del Local se liquidan como vendidos, salvo defecto de fábrica comprobado.

## Devoluciones
El Local puede devolver producto sin vender y en buen estado en cualquier visita. La devolución queda registrada en la aplicación con su motivo.

## Vigencia y terminación
Este contrato dura {{vigencia.meses}} meses desde la firma y se renueva solo por periodos iguales. Cualquiera de las partes puede terminarlo con {{aviso.dias}} días de aviso por escrito. Al terminar, el Local devuelve la mercancía sin vender y se hace una liquidación final.

## Firma electrónica
Las partes aceptan firmar este contrato electrónicamente en la aplicación de la Empresa y le dan a esa firma el mismo valor que a una firma en papel. La aplicación guarda el trazo de cada firma, el nombre de quien firma, la fecha y la hora, y la ubicación si quien firma la autoriza.

## Anexo A: productos en consignación
{{anexo.productos}}

Los precios del anexo pueden actualizarse por escrito; cada cambio genera una nueva versión de este contrato.`;

export const TABACO_CONTRACT = `# Contrato de consignación de productos de tabaco
> Plantilla de ejemplo: la revisa un abogado antes de usarla con locales reales.

Versión {{contrato.version}} · Emitido el {{fecha}}

## Partes
De una parte, {{empresa.nombre}} (la «Empresa»), representada en este acto por su vendedor {{empresa.representante}}. De la otra, {{local.nombre}}, {{local.tipo}} ubicado en {{local.direccion}} (el «Local»), representado por su encargado {{local.encargado}} (teléfono {{local.telefono}}, correo {{local.correo}}).

## Objeto
La Empresa entrega al Local productos de tabaco en consignación para que el Local los venda en su establecimiento. Es una venta entre empresas: la Empresa no vende al consumidor final.

## La mercancía es de la Empresa hasta que se vende
Todo producto en consignación sigue siendo propiedad de la Empresa hasta que el Local lo vende. El Local no puede darlo en garantía, venderlo a otro distribuidor ni sacarlo de su establecimiento.

## Precios y ganancia del Local
Por cada unidad vendida el Local paga a la Empresa el precio al local del Anexo A. El Local fija su precio de venta; el PVP sugerido es una referencia. La diferencia entre lo que cobra y el precio al local es su ganancia.

## Permisos y venta solo a mayores de 21 años
El Local declara tener vigente su permiso de venta de productos de tabaco número {{permiso.numero}}, con vencimiento el {{permiso.vence}}, otorgado por la autoridad de Florida que corresponda (DBPR). El Local se compromete a renovarlo a tiempo y a avisar a la Empresa de cualquier suspensión. Sin permiso vigente la Empresa no consigna producto y puede retirar la mercancía.

El Local vende productos de tabaco solo a personas de 21 años o más, comprobando su identidad con un documento oficial con foto, y cumple las leyes federales, estatales y locales sobre la venta y exhibición de tabaco.

${COMMON_TAIL}`;

export const CAFE_CONTRACT = `# Contrato de consignación de café
> Plantilla de ejemplo: la revisa un abogado antes de usarla con locales reales.

Versión {{contrato.version}} · Emitido el {{fecha}}

## Partes
De una parte, {{empresa.nombre}} (la «Empresa»), representada en este acto por su vendedor {{empresa.representante}}. De la otra, {{local.nombre}}, {{local.tipo}} ubicado en {{local.direccion}} (el «Local»), representado por su encargado {{local.encargado}} (teléfono {{local.telefono}}, correo {{local.correo}}).

## Objeto
La Empresa entrega al Local café y productos de la marca en consignación para que el Local los venda en su establecimiento.

## La mercancía es de la Empresa hasta que se vende
Todo producto en consignación sigue siendo propiedad de la Empresa hasta que el Local lo vende. El Local no puede darlo en garantía, venderlo a otro distribuidor ni sacarlo de su establecimiento.

## Precios y ganancia del Local
Por cada unidad vendida el Local paga a la Empresa el precio al local del Anexo A. El Local fija su precio de venta; el PVP sugerido es una referencia. La diferencia entre lo que cobra y el precio al local es su ganancia.

## Frescura y permisos
El Local guarda el café en lugar fresco y seco, lejos del sol, y no vende producto después de la fecha «consumir antes de». La Empresa retira y repone sin costo el café que esté por vencer en sus visitas. El Local mantiene vigentes los permisos sanitarios y de comercio que le exija su actividad.

${COMMON_TAIL}`;
