// Datos de ejemplo de la línea Café. Lo único real es la marca Café El Mío con sus 9
// productos y sus precios públicos (usados como PVP sugerido). El precio al local y los
// costos son DE EJEMPLO. Locales, personas, teléfonos y direcciones son inventados.
import { familyIdFor } from '../domain/products';
import { internalEan13 } from '../lib/barcode';
import { CAFE } from '../lines/config';
import type { LineSeedDef, ProductSeed, StoreSeed } from './engine';

const z = {
  hialeah: 'c-zon_hialeah',
  habana: 'c-zon_habana',
  doral: 'c-zon_doral',
  westchester: 'c-zon_westchester',
  kendall: 'c-zon_kendall',
  gables: 'c-zon_gables',
  beach: 'c-zon_beach',
  lauderdale: 'c-zon_lauderdale',
};

const L1 = 'Línea 1 · Espresso';
const L2 = 'Línea 2 · Orígenes y muestras';

let barcodeSeq = 5000;

function coffee(
  key: string,
  sku: string,
  name: string,
  handle: string,
  attrs: { origin: string; roast: string; grind: string; weight: string; presentation: string; productionLine: string },
  money: { cost: number; price: number; pvp: number; commission: ProductSeed['sellerCommission']; pack: number; low: number },
  notes: string,
  pairing: string,
  rate: number,
  shelfLifeDays: number,
  supply = 1,
): ProductSeed {
  return {
    key,
    sku,
    name,
    brandLine: 'Café El Mío',
    active: true,
    cost: money.cost,
    priceToStore: money.price,
    suggestedRetail: money.pvp,
    sellerCommission: money.commission,
    lowStockThreshold: money.low,
    packSize: money.pack,
    unitName: 'unidad',
    notes,
    pairing,
    attrs: { ...attrs },
    // Cada producto de El Mío es su propia familia (sus nombres ya dicen el tipo y el peso).
    familyId: familyIdFor('cafe', name),
    familyName: name,
    variantLabel: '',
    barcode: internalEan13((barcodeSeq += 1)),
    brandPhoto: handle,
    rate,
    shelfLifeDays,
    supply,
  };
}

// PVP sugerido = precio público de la tienda El Mío (assets/js/catalogo.js). Precio al local y costo: de ejemplo.
const products: ProductSeed[] = [
  coffee(
    'elmio',
    'CF-ELMIO-10OZ',
    'Café Espresso El Mío',
    'cafe-espresso-el-mio-100-arabica',
    { origin: '100 % arábica, tostado y empacado en Miami', roast: 'oscuro', grind: 'Molido (espresso)', weight: '10 oz (283 g)', presentation: 'Paquete', productionLine: L1 },
    { cost: 2.35, price: 4.1, pvp: 5.99, commission: { type: 'percent', value: 6 }, pack: 12, low: 144 },
    'El café de la casa: fuerte, aromático y con ese amargor que pide azúcar.',
    'Cafecito, colada y cortadito en cafetera; también en máquina de espresso.',
    24,
    270,
  ),
  coffee(
    'caja24',
    'CF-ELMIO-C24',
    'El Mío, caja de 24',
    '12-packs-cafe-espresso-el-mio',
    { origin: '100 % arábica, tostado y empacado en Miami', roast: 'oscuro', grind: 'Molido (espresso)', weight: '24 × 10 oz (283 g)', presentation: 'Caja de 24 paquetes', productionLine: L1 },
    { cost: 56, price: 96, pvp: 132, commission: { type: 'fixed', value: 4 }, pack: 1, low: 6 },
    'Veinticuatro paquetes de El Mío para la casa, la oficina o el negocio.',
    'El mismo Café Espresso El Mío, para cafetera o máquina de espresso.',
    0.6,
    270,
  ),
  coffee(
    'colombia',
    'CF-COL-12OZ',
    'Colombia',
    'colombia',
    { origin: 'Medellín, Antioquia (Colombia)', roast: 'medio', grind: 'En grano o molido a elección', weight: '12 oz (340 g)', presentation: 'Bolsa', productionLine: L2 },
    { cost: 7.2, price: 12.5, pvp: 18.99, commission: { type: 'percent', value: 6 }, pack: 6, low: 24 },
    'Naranja deshidratada, frutos rojos y chocolate.',
    'Goteo con molido medio, prensa francesa con grueso o cafetera con espresso.',
    4,
    180,
  ),
  coffee(
    'costarica',
    'CF-CRI-12OZ',
    'Costa Rica',
    'costa-rica',
    { origin: 'Alajuela (Costa Rica)', roast: 'medio', grind: 'En grano o molido a elección', weight: '12 oz (340 g)', presentation: 'Bolsa', productionLine: L2 },
    { cost: 7.2, price: 12.5, pvp: 18.99, commission: { type: 'percent', value: 6 }, pack: 6, low: 24 },
    'Manzana dulce, pasas y miel.',
    'Brilla en goteo y en prensa francesa.',
    3,
    180,
  ),
  coffee(
    'peru',
    'CF-PER-CAP12',
    'Perú en cápsulas',
    'peru-coffee-pods',
    { origin: 'Piura y Amazonas (Perú)', roast: 'medio', grind: 'Cápsulas de una taza', weight: '12 cápsulas', presentation: 'Caja de 12 cápsulas', productionLine: L2 },
    { cost: 7, price: 12.25, pvp: 18.99, commission: { type: 'percent', value: 6 }, pack: 6, low: 24 },
    'Caramelo salado, dulzor sedoso y cítricos.',
    'Una cápsula por taza en cafetera de cápsulas.',
    3,
    365,
  ),
  coffee(
    'africano',
    'CF-AFR-12OZ',
    'Espresso Africano',
    'african-espresso',
    { origin: 'Kenia, Tanzania y Etiopía', roast: 'medio-oscuro', grind: 'En grano o molido a elección', weight: '12 oz (340 g)', presentation: 'Bolsa', productionLine: L1 },
    { cost: 7.4, price: 12.5, pvp: 18.99, commission: { type: 'percent', value: 6 }, pack: 6, low: 30 },
    'Mezcla de tueste medio-oscuro pensada para el espresso.',
    'Molido espresso para máquina o cafetera.',
    3,
    180,
    0.45,
  ),
  coffee(
    'fav',
    'CF-MUE-FAV',
    'Muestras: los favoritos',
    'best-sellers-sample-pack-6bean-cowboy-breakfast-peru-mexico-bali',
    { origin: 'Varios orígenes', roast: 'medio', grind: 'Molido medio', weight: '6 sobres de 2 oz', presentation: 'Paquete de muestras', productionLine: L2 },
    { cost: 9.8, price: 16.5, pvp: 24.99, commission: { type: 'percent', value: 6 }, pack: 6, low: 18 },
    'Seis sobres con los cafés más vendidos para descubrir el favorito.',
    'Cada sobre rinde una cafetera de goteo pequeña o una prensa francesa.',
    2,
    180,
  ),
  coffee(
    'sab',
    'CF-MUE-SAB',
    'Muestras: saborizados',
    'flavored-coffees-sample-pack',
    { origin: 'Café de especialidad saborizado', roast: 'medio', grind: 'Molido medio', weight: '6 sobres de 2 oz', presentation: 'Paquete de muestras', productionLine: L2 },
    { cost: 9.9, price: 16.5, pvp: 24.99, commission: { type: 'percent', value: 6 }, pack: 6, low: 12 },
    'Vainilla, avellana, canela, caramelo, moca y canela con avellana.',
    'Perfectos en cafetera de goteo. Con leche, mejor.',
    0.5,
    180,
  ),
  coffee(
    'matcha',
    'CF-MATCHA-1OZ',
    'Matcha',
    'matcha',
    { origin: 'Té matcha (origen por confirmar)', roast: 'no aplica', grind: 'Hoja suelta', weight: '1 oz', presentation: 'Hoja suelta, 1 oz', productionLine: L2 },
    { cost: 8.6, price: 14.5, pvp: 21.99, commission: { type: 'percent', value: 6 }, pack: 6, low: 12 },
    'Refinado y persistente, para la preparación tradicional.',
    'Agua caliente sin hervir y un batidor de bambú.',
    1,
    365,
  ),
];

function store(
  key: string,
  name: string,
  type: string,
  zone: keyof typeof z,
  city: string,
  lat: number,
  lng: number,
  manager: string,
  n: number,
  seller: string,
  activationDay: number | null,
  final: StoreSeed['final'],
  assortment: string[],
  size: number,
  extra: Partial<StoreSeed> = {},
): StoreSeed {
  const area = city === 'Fort Lauderdale' ? '954' : '305';
  return {
    key,
    name,
    type,
    zone: z[zone],
    city: `${city}, FL`,
    address: `${2000 + n * 41} Calle Muestra (dirección de ejemplo)`,
    lat,
    lng,
    managerName: manager,
    phone: `(${area}) 555-01${String(40 + n).padStart(2, '0')}`,
    email: `${key.replace(/^c-/, '')}@example.com`,
    hours: 'Todos los días 6:00–19:00',
    seller,
    activationDay,
    final,
    assortment,
    size,
    ...extra,
  };
}

const ORIGINS = ['colombia', 'costarica', 'peru', 'africano'];

const stores: StoreSeed[] = [
  // Carlos Benítez: Hialeah y Doral
  store('c-ventanita', 'Cafetería La Ventanita Azul', 'Cafetería', 'hialeah', 'Hialeah', 25.8556, -80.2722, 'Nilda Herrera', 1, 'carlos', -86, 'activo', ['elmio', 'caja24', 'colombia', 'africano', 'fav'], 1.3),
  store('c-dulce', 'Panadería Dulce Hogar', 'Panadería', 'hialeah', 'Hialeah', 25.865, -80.29, 'Raúl Benavides', 2, 'carlos', -78, 'activo', ['elmio', 'costarica', 'sab', 'matcha'], 1.0, { expiringLotOf: 'sab' }),
  store('c-palma', 'Mercado La Palma', 'Supermercado latino', 'hialeah', 'Hialeah', 25.842, -80.295, 'Susana Carvajal', 3, 'carlos', -70, 'activo', ['elmio', 'caja24', ...ORIGINS, 'fav'], 1.4),
  store('c-doralx', 'Cafetería Doral Express', 'Cafetería', 'doral', 'Doral', 25.805, -80.33, 'Iván Quintero', 4, 'carlos', -62, 'activo', ['elmio', 'africano', 'peru'], 0.9),
  store('c-sabor', 'Mercado Sabor Latino', 'Supermercado latino', 'doral', 'Doral', 25.832, -80.342, 'Lourdes Pineda', 5, 'carlos', null, 'contrato_enviado', [], 1),
  // Mariela Soto: Pequeña Habana, Coral Gables y Miami Beach
  store('c-colado', 'Cafetería El Colado', 'Cafetería', 'habana', 'Pequeña Habana, Miami', 25.7678, -80.224, 'Eduardo Cabrera', 6, 'mariela', -88, 'activo', ['elmio', 'caja24', 'colombia', 'costarica', 'matcha', 'fav'], 1.5),
  store('c-lazaro', 'Bodega San Lázaro 12', 'Bodega', 'habana', 'Pequeña Habana, Miami', 25.7745, -80.2125, 'Teresa Morales', 7, 'mariela', -74, 'activo', ['elmio', 'colombia', 'peru'], 0.8, { overdue: true }),
  store('c-305', 'Ventanita 3:05', 'Ventanita', 'habana', 'Pequeña Habana, Miami', 25.762, -80.231, 'Rubén Acosta', 8, 'mariela', -58, 'activo', ['elmio', 'africano', 'fav'], 1.0),
  store('c-gables', 'Cafetería Gables Corner', 'Cafetería', 'gables', 'Coral Gables', 25.742, -80.256, 'Claudia Ibarra', 9, 'mariela', -66, 'activo', ['elmio', 'colombia', 'costarica', 'peru', 'matcha'], 1.0),
  store('c-playa', 'Market Playa Norte', 'Supermercado latino', 'beach', 'Miami Beach', 25.786, -80.132, 'Gustavo Rey', 10, 'mariela', null, 'firmado', [], 1),
  // Tomás Herrera: Westchester, Kendall y Fort Lauderdale
  store('c-espiga', 'Panadería La Espiga', 'Panadería', 'westchester', 'Westchester', 25.76, -80.335, 'Amparo Delgado', 11, 'tomas', -80, 'activo', ['elmio', 'caja24', 'costarica', 'fav'], 1.1),
  store('c-tamx', 'Cafetería Tamiami Express', 'Cafetería', 'westchester', 'Westchester', 25.744, -80.318, 'Óscar Fuentes', 12, 'tomas', -52, 'activo', ['elmio', 'africano'], 0.9, {
    final: 'pausado',
    pausedDay: -9,
    notes: 'Cerró dos semanas por cambio de dueño.',
  }),
  store('c-kendall', 'Bodega Kendall Este', 'Bodega', 'kendall', 'Kendall', 25.695, -80.301, 'Mercedes Ochoa', 13, 'tomas', -68, 'activo', ['elmio', 'colombia'], 0.8),
  store('c-batey', 'Supermercado El Batey', 'Supermercado latino', 'kendall', 'Kendall', 25.68, -80.329, 'Felipe Navarro', 14, 'tomas', -84, 'activo', ['elmio', 'caja24', ...ORIGINS, 'fav', 'matcha'], 1.4),
  store('c-lauder', 'Bodega Latina Lauderdale', 'Bodega', 'lauderdale', 'Fort Lauderdale', 26.13, -80.145, 'Pilar Ortega', 15, 'tomas', null, 'prospecto', [], 1),
];

export const CAFE_SEED: LineSeedDef = {
  line: 'cafe',
  config: CAFE,
  seed: 1105,
  settings: {
    companyName: CAFE.companyName,
    settlementEveryDays: 14,
    paymentTermsDays: 7,
    commissionPayableOn: 'cobro',
    defaultSellerCommission: CAFE.defaultCommission,
    defaultLowStock: 48,
    expiryWarningDays: 30,
    noRotationDays: 21,
    contractTermMonths: 12,
    terminationNoticeDays: 30,
  },
  warehouse: { name: 'Almacén Miami', address: 'Miami, FL (ubicación de ejemplo)', lat: 25.8, lng: -80.35 },
  zones: [
    { id: z.hialeah, name: 'Hialeah', lat: 25.8576, lng: -80.2781 },
    { id: z.habana, name: 'Pequeña Habana', lat: 25.7735, lng: -80.2155 },
    { id: z.doral, name: 'Doral', lat: 25.8195, lng: -80.3553 },
    { id: z.westchester, name: 'Westchester', lat: 25.7548, lng: -80.3273 },
    { id: z.kendall, name: 'Kendall', lat: 25.6793, lng: -80.3173 },
    { id: z.gables, name: 'Coral Gables', lat: 25.7215, lng: -80.2684 },
    { id: z.beach, name: 'Miami Beach', lat: 25.8106, lng: -80.125 },
    { id: z.lauderdale, name: 'Fort Lauderdale', lat: 26.1224, lng: -80.1373 },
  ],
  users: [
    { key: 'marta', role: 'admin', name: 'Marta Iglesias', email: 'oficina.cafe@example.com', phone: '(305) 555-0191' },
    { key: 'carlos', role: 'seller', name: 'Carlos Benítez', email: 'carlos.benitez@example.com', phone: '(305) 555-0151', zone: z.hialeah },
    { key: 'mariela', role: 'seller', name: 'Mariela Soto', email: 'mariela.soto@example.com', phone: '(305) 555-0152', zone: z.habana },
    { key: 'tomas', role: 'seller', name: 'Tomás Herrera', email: 'tomas.herrera@example.com', phone: '(305) 555-0153', zone: z.kendall },
  ],
  products,
  stores,
  restockDays: [-95, -81, -67, -53, -39, -25, -11],
  pendingArrivals: [
    {
      inDays: 3,
      status: 'programado',
      supplier: 'Tostadora El Mío, Miami',
      originCountry: 'EE. UU. (tostado en Miami)',
      productionLine: L1,
      items: [
        { product: 'elmio', qty: 480 },
        { product: 'caja24', qty: 20 },
        { product: 'africano', qty: 60 },
      ],
    },
  ],
  supplierFor: (p) => ({ supplier: 'Tostadora El Mío, Miami', originCountry: 'EE. UU. (tostado en Miami)', productionLine: String(p.attrs.productionLine) }),
  primary: { admin: 'marta', seller: 'carlos', store: 'c-ventanita' },
  pendingReorders: [
    { store: 'c-ventanita', status: 'enviado', items: [{ product: 'elmio', packs: 2 }, { product: 'colombia', packs: 1 }], note: 'Para el fin de semana.' },
    { store: 'c-305', status: 'confirmado', items: [{ product: 'elmio', packs: 3 }, { product: 'africano', packs: 1 }], note: 'Se nos acaba el espresso.' },
  ],
  messages: [
    {
      kind: 'admin_vendedor',
      between: ['carlos', 'marta'],
      lines: [
        { from: 0, text: 'Marta, la Ventanita Azul vende unos 30 paquetes de El Mío por semana. ¿Le subimos el nivel?', hoursAgo: 20, product: 'elmio' },
        { from: 1, text: 'Sí. Y en 3 días sale la tanda de la Línea 1, así que hay de sobra.', hoursAgo: 19 },
      ],
    },
    {
      kind: 'vendedor_local',
      between: ['carlos', 'c-ventanita'],
      store: 'c-ventanita',
      lines: [
        { from: 1, text: 'Carlos, mandé un pedido por la app: 2 cajas de El Mío y 1 de Colombia.', hoursAgo: 5 },
        { from: 0, text: 'Visto, lo confirmo hoy.', hoursAgo: 4 },
      ],
    },
    {
      kind: 'vendedor_local',
      between: ['mariela', 'c-colado'],
      store: 'c-colado',
      lines: [
        { from: 1, text: '¿Tienen matcha? Me lo piden en las mañanas.', hoursAgo: 40, product: 'matcha' },
        { from: 0, text: 'Sí, te llevo seis de prueba en la próxima visita.', hoursAgo: 38 },
      ],
    },
  ],
  announcements: [
    {
      title: 'Tanda de tostado en 3 días',
      body: 'La Línea 1 tuesta El Mío y Espresso Africano en 3 días. Si sus locales necesitan reposición, confirmen los pedidos antes.',
      audience: 'vendedores',
      daysAgo: 1,
    },
    {
      title: 'Rotación del café',
      body: 'Revisen la fecha «consumir antes de» en cada visita. El café que vence en menos de 3 semanas se cambia sin costo.',
      audience: 'todos',
      daysAgo: 6,
    },
  ],
  lowStockProduct: 'africano',
};
