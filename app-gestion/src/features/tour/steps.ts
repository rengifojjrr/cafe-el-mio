// Recorrido guiado: 7 pasos por línea. Cada paso entra con la cuenta que toca y abre la pantalla.
import type { LineId } from '../../data/types';

export interface TourStep {
  account: string;
  path: string;
  title: string;
  body: string;
}

export const TOUR: Record<LineId, TourStep[]> = {
  tabaco: [
    {
      account: 'tabaco:admin',
      path: '/tabaco',
      title: 'Centro de mando',
      body: 'Administración ve el mapa con todos los locales, lo que hay por hacer y las cifras clave de Tabaco. Los locales con un pedido pendiente laten.',
    },
    {
      account: 'tabaco:admin',
      path: '/tabaco/catalogo',
      title: 'Catálogo con silueta a escala',
      body: 'Cada tabaco muestra su vitola dibujada a escala (largo × cepo) con el color de su capa. Abre el Everglades Torpedo: tiene stock bajo y su próxima llegada.',
    },
    {
      account: 'tabaco:admin',
      path: '/tabaco/almacen',
      title: 'Almacén e importaciones',
      body: 'El inventario sale del libro de movimientos. Las importaciones pasan por producción, tránsito, aduana y recibida; recibir suma al almacén por lote.',
    },
    {
      account: 'tabaco:seller',
      path: '/tabaco',
      title: 'El día del vendedor',
      body: 'Andrés ve su ruta del día, un pedido por confirmar y un contrato por firmar. Desde aquí registra tiendas, visitas y pide producto.',
    },
    {
      account: 'tabaco:seller',
      path: '/tabaco/locales',
      title: 'Permiso de tabaco',
      body: 'Licorería Humo y Ron tiene el permiso vencido: la app no deja consignarle tabaco hasta que lo renueve. Bodega La Esquina 49 tiene el contrato listo para firmar en el teléfono.',
    },
    {
      account: 'tabaco:store',
      path: '/tabaco',
      title: 'La cuenta del local',
      body: 'El Faro ve lo que tiene en consignación, lo que gana por cada tabaco, lo que debe y su contrato. Con «Pedir más» le llega el aviso a su vendedor.',
    },
    {
      account: 'tabaco:admin',
      path: '/tabaco/cobros',
      title: 'Cobros y comisiones',
      body: 'Liquidaciones por local con su antigüedad (0–15, 16–30, más de 30 días). Ficha Doble tiene un pago vencido. Los pagos solo se registran: aquí no se mueve dinero.',
    },
  ],
  cafe: [
    {
      account: 'cafe:admin',
      path: '/cafe',
      title: 'Centro de mando de Café',
      body: 'La misma app, con la marca El Mío y sus propios datos: nada de Tabaco aparece aquí.',
    },
    {
      account: 'cafe:admin',
      path: '/cafe/catalogo',
      title: 'Los 9 productos de El Mío',
      body: 'Con sus fotos y precios públicos como PVP sugerido. El precio al local y los costos son de ejemplo.',
    },
    {
      account: 'cafe:admin',
      path: '/cafe/almacen',
      title: 'Lotes de tostado',
      body: 'El café entra por tandas de tostado: línea de producción, fecha de tostado y «consumir antes de». Hay una tanda programada para dentro de 3 días.',
    },
    {
      account: 'cafe:seller',
      path: '/cafe',
      title: 'Café por vencer',
      body: 'Carlos ve que en Panadería Dulce Hogar hay un lote que vence pronto: lo cambia en su visita. También tiene el pedido de la Ventanita Azul por confirmar.',
    },
    {
      account: 'cafe:seller',
      path: '/cafe/comisiones',
      title: 'Comisiones del vendedor',
      body: 'Por producto, por local y por mes: devengadas, por cobrar y pagadas. Se vuelven pagables cuando el local paga.',
    },
    {
      account: 'cafe:store',
      path: '/cafe/pedir',
      title: 'El local pide más',
      body: 'La Ventanita Azul pide desde su teléfono, con la disponibilidad y la próxima llegada a la vista.',
    },
    {
      account: 'direccion',
      path: '/direccion',
      title: 'Dirección',
      body: 'Los socios ven las dos líneas lado a lado, sin mezclar las cuentas. La suma aparece aparte y marcada como informativa.',
    },
  ],
};
