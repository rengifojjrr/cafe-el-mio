// Datos de ejemplo de la línea Tabaco. TODO es inventado: marca provisional, locales,
// personas, teléfonos 555-01xx, correos @example.com y direcciones «de ejemplo».
// Ningún tabaco de origen Cuba (embargo de EE. UU.).
import { TABACO } from '../lines/config';
import { capaFromText, capaShade, composeName, familyIdFor, sizeText, variantLabelFor } from '../domain/products';
import { internalEan13 } from '../lib/barcode';
import type { LineSeedDef, ProductSeed, StoreSeed } from './engine';

const BRAND = 'GM Tabacos (marca provisional)';
let barcodeSeq = 1000;
const FAMILY_CODE: Record<string, string> = { Torpedo: 'TRP' };

const z = {
  hialeah: 't-zon_hialeah',
  habana: 't-zon_habana',
  doral: 't-zon_doral',
  westchester: 't-zon_westchester',
  kendall: 't-zon_kendall',
  gables: 't-zon_gables',
  beach: 't-zon_beach',
  lauderdale: 't-zon_lauderdale',
  houston: 't-zon_houston',
};

function cigar(
  key: string,
  sku: string,
  name: string,
  series: string,
  a: {
    vitola: string;
    lengthIn: number;
    ringGauge: number;
    wrapper: string;
    wrapperShade: string;
    binder: string;
    filler: string;
    originCountry: string;
    originRegion: string;
    strength: 'suave' | 'media' | 'fuerte';
  },
  money: { cost: number; price: number; pvp: number; commission: ProductSeed['sellerCommission']; pack: number; low: number },
  notes: string,
  pairing: string,
  rate: number,
  supply = 1,
): ProductSeed {
  // Premium: cada uno es su propia familia (el nombre ya dice la serie y la vitola).
  return {
    key,
    sku,
    name,
    brandLine: `${BRAND} · ${series}`,
    active: true,
    cost: money.cost,
    priceToStore: money.price,
    suggestedRetail: money.pvp,
    sellerCommission: money.commission,
    lowStockThreshold: money.low,
    packSize: money.pack,
    unitName: 'tabaco',
    notes,
    pairing,
    attrs: { ...a, capa: capaFromText(a.wrapper) ?? 'habano', brand: BRAND, edition: series },
    kind: 'premium',
    familyId: familyIdFor('tabaco', name, 'premium', BRAND),
    familyName: name,
    variantLabel: '',
    barcode: internalEan13((barcodeSeq += 1)),
    rate,
    supply,
  };
}

/**
 * De mazo (sin marca): la familia es la vitola y las variantes son la capa y la medida.
 * Se cuenta por mazo (25 tabacos) y la caja trae 50 mazos. Precios por mazo, inventados.
 */
function mazo(
  key: string,
  family: string,
  a: { vitola: string; lengthIn: number; ringGauge: number; capa: string; strength: 'suave' | 'media' | 'fuerte'; originRegion: string },
  money: { cost: number; price: number; pvp: number },
  notes: string,
  rate: number,
): ProductSeed {
  const attrs = { ...a, originCountry: 'Nicaragua', cigarsPerBundle: 25, wrapperShade: capaShade(a.capa) };
  const familyName = `${family} ${sizeText(attrs)}`;
  const variantLabel = variantLabelFor('tabaco', attrs, familyName);
  return {
    key,
    // Torpedo usa TRP: con las tres primeras letras chocaba con Toro (TB-MZ-TOR-MAD52 dos veces).
    sku: `TB-MZ-${FAMILY_CODE[family] ?? family.slice(0, 3).toUpperCase()}-${a.capa.slice(0, 3).toUpperCase()}${a.ringGauge}`,
    name: composeName(familyName, variantLabel),
    brandLine: 'De mazo (sin marca)',
    active: true,
    cost: money.cost,
    priceToStore: money.price,
    suggestedRetail: money.pvp,
    sellerCommission: { type: 'percent', value: 6 },
    lowStockThreshold: 60,
    packSize: 50,
    unitName: 'mazo',
    notes,
    pairing: 'Para el cliente de todos los días: café, cerveza o ron.',
    attrs,
    kind: 'mazo',
    familyId: familyIdFor('tabaco', familyName, 'mazo'),
    familyName,
    variantLabel,
    barcode: internalEan13((barcodeSeq += 1)),
    // La caja (50 mazos) sale un 4 % más barata que 50 mazos sueltos.
    boxPrice: Math.round(money.price * 50 * 0.96 * 100) / 100,
    rate,
  };
}

const products: ProductSeed[] = [
  cigar(
    'bis-rob',
    'TB-BIS-ROB50',
    'Biscayne Robusto',
    'Serie Biscayne',
    { vitola: 'Robusto', lengthIn: 5, ringGauge: 50, wrapper: 'Connecticut Shade (Ecuador)', wrapperShade: 'claro', binder: 'Nicaragua', filler: 'Nicaragua (Estelí)', originCountry: 'Nicaragua', originRegion: 'Estelí', strength: 'suave' },
    { cost: 2.4, price: 5.5, pvp: 9.5, commission: { type: 'percent', value: 8 }, pack: 20, low: 80 },
    'Cremoso y suave: cedro, almendra tostada y un final de vainilla.',
    'Café con leche por la mañana o un ron añejo ligero.',
    10,
  ),
  cigar(
    'bis-toro',
    'TB-BIS-TOR52',
    'Biscayne Toro',
    'Serie Biscayne',
    { vitola: 'Toro', lengthIn: 6, ringGauge: 52, wrapper: 'Connecticut Shade (Ecuador)', wrapperShade: 'claro', binder: 'Nicaragua', filler: 'Nicaragua (Estelí)', originCountry: 'Nicaragua', originRegion: 'Estelí', strength: 'suave' },
    { cost: 2.7, price: 6, pvp: 10.5, commission: { type: 'percent', value: 8 }, pack: 20, low: 60 },
    'Más largo y fresco que el robusto: nuez, heno dulce y crema.',
    'Café cubano con azúcar o un whisky de malta suave.',
    8,
  ),
  cigar(
    'bis-church',
    'TB-BIS-CHU48',
    'Biscayne Churchill',
    'Serie Biscayne',
    { vitola: 'Churchill', lengthIn: 7, ringGauge: 48, wrapper: 'Connecticut Shade (Ecuador)', wrapperShade: 'natural', binder: 'Nicaragua', filler: 'Nicaragua', originCountry: 'Nicaragua', originRegion: 'Estelí', strength: 'suave' },
    { cost: 3.1, price: 6.75, pvp: 12, commission: { type: 'percent', value: 8 }, pack: 20, low: 40 },
    'Para fumar sin apuro: madera clara, pan tostado y miel.',
    'Un vino tinto ligero o té negro.',
    4,
  ),
  cigar(
    'eve-cor',
    'TB-EVE-COR42',
    'Everglades Corona',
    'Serie Everglades',
    { vitola: 'Corona', lengthIn: 5.5, ringGauge: 42, wrapper: 'Sumatra (Ecuador)', wrapperShade: 'natural', binder: 'República Dominicana', filler: 'República Dominicana (Valle del Cibao)', originCountry: 'República Dominicana', originRegion: 'Valle del Cibao', strength: 'media' },
    { cost: 2.2, price: 5, pvp: 8.5, commission: { type: 'fixed', value: 0.4 }, pack: 25, low: 75 },
    'Clásico y equilibrado: cuero suave, especias dulces y cacao.',
    'Cortadito o un ron dominicano.',
    9,
  ),
  cigar(
    'eve-torp',
    'TB-EVE-TOR52',
    'Everglades Torpedo',
    'Serie Everglades',
    { vitola: 'Torpedo', lengthIn: 6.125, ringGauge: 52, wrapper: 'Sumatra (Ecuador)', wrapperShade: 'colorado', binder: 'República Dominicana', filler: 'República Dominicana y Nicaragua', originCountry: 'República Dominicana', originRegion: 'Santiago', strength: 'media' },
    { cost: 3.4, price: 7.5, pvp: 13, commission: { type: 'percent', value: 9 }, pack: 20, low: 70 },
    'La punta concentra el sabor: pimienta negra, café y frutos secos.',
    'Espresso doble o un bourbon.',
    7,
    0.7,
  ),
  cigar(
    'eve-gordo',
    'TB-EVE-GOR60',
    'Everglades Gordo',
    'Serie Everglades',
    { vitola: 'Gordo', lengthIn: 6, ringGauge: 60, wrapper: 'Habano (Ecuador)', wrapperShade: 'colorado', binder: 'República Dominicana', filler: 'República Dominicana', originCountry: 'República Dominicana', originRegion: 'Villa González', strength: 'media' },
    { cost: 3.6, price: 7.75, pvp: 13.5, commission: { type: 'percent', value: 8 }, pack: 20, low: 50 },
    'Humo abundante y fresco: madera de roble, canela y caramelo.',
    'Ron añejo o cerveza oscura.',
    5,
  ),
  cigar(
    'tam-lanc',
    'TB-TAM-LAN38',
    'Tamiami Lancero',
    'Serie Tamiami, hecho a mano en Miami',
    { vitola: 'Lancero', lengthIn: 7.5, ringGauge: 38, wrapper: 'Corojo (Honduras)', wrapperShade: 'colorado', binder: 'Nicaragua', filler: 'Nicaragua y República Dominicana', originCountry: 'Estados Unidos', originRegion: 'Miami, Florida (hecho a mano)', strength: 'media' },
    { cost: 4.2, price: 9, pvp: 16, commission: { type: 'percent', value: 10 }, pack: 10, low: 30 },
    'Delgado y elegante, torcido a mano en Miami: especias, cedro y un final dulce.',
    'Café cubano o un coñac.',
    3,
  ),
  cigar(
    'tam-rob',
    'TB-TAM-ROB50',
    'Tamiami Robusto Maduro',
    'Serie Tamiami, hecho a mano en Miami',
    { vitola: 'Robusto', lengthIn: 5, ringGauge: 50, wrapper: 'Maduro San Andrés (México)', wrapperShade: 'maduro', binder: 'Nicaragua', filler: 'Nicaragua', originCountry: 'Estados Unidos', originRegion: 'Miami, Florida (hecho a mano)', strength: 'fuerte' },
    { cost: 3.9, price: 8.5, pvp: 15, commission: { type: 'percent', value: 10 }, pack: 10, low: 30 },
    'Oscuro y dulce: chocolate amargo, melaza y tierra húmeda.',
    'Espresso, oporto o ron oscuro.',
    5,
  ),
  cigar(
    'cor-petit',
    'TB-COR-PET42',
    'Coral Petit Corona',
    'Serie Coral',
    { vitola: 'Petit corona', lengthIn: 4.5, ringGauge: 42, wrapper: 'Rosado (Honduras)', wrapperShade: 'rosado', binder: 'Honduras', filler: 'Honduras (Jamastrán)', originCountry: 'Honduras', originRegion: 'Danlí', strength: 'media' },
    { cost: 1.9, price: 4.25, pvp: 7.5, commission: { type: 'fixed', value: 0.35 }, pack: 25, low: 75 },
    'Corto, para un rato: pimienta roja, pan y un toque cítrico.',
    'Cafecito o una cerveza clara.',
    8,
  ),
  cigar(
    'cor-toro',
    'TB-COR-TOR54',
    'Coral Toro Maduro',
    'Serie Coral',
    { vitola: 'Toro', lengthIn: 6, ringGauge: 54, wrapper: 'Broadleaf Maduro (Connecticut, EE. UU.)', wrapperShade: 'oscuro', binder: 'Honduras', filler: 'Honduras (Jamastrán)', originCountry: 'Honduras', originRegion: 'Danlí', strength: 'fuerte' },
    { cost: 3.3, price: 7.25, pvp: 12.5, commission: { type: 'percent', value: 8 }, pack: 20, low: 50 },
    'Intenso y redondo: cacao, café tostado y especias.',
    'Whisky de centeno o espresso.',
    5,
  ),
  cigar(
    'bri-beli',
    'TB-BRI-BEL52',
    'Brickell Belicoso',
    'Serie Brickell',
    { vitola: 'Belicoso', lengthIn: 5.25, ringGauge: 52, wrapper: "Criollo '98 (Nicaragua)", wrapperShade: 'colorado', binder: 'Nicaragua (Jalapa)', filler: 'Nicaragua', originCountry: 'Nicaragua', originRegion: 'Jalapa', strength: 'fuerte' },
    { cost: 3.5, price: 7.75, pvp: 13.5, commission: { type: 'percent', value: 9 }, pack: 20, low: 50 },
    'Potente pero dulce: pimienta, cuero y frutas secas.',
    'Ron añejo o un café negro sin azúcar.',
    6,
  ),
  cigar(
    'bri-cand',
    'TB-BRI-CAN46',
    'Brickell Candela',
    'Serie Brickell',
    { vitola: 'Corona gorda', lengthIn: 5.625, ringGauge: 46, wrapper: 'Candela (Nicaragua)', wrapperShade: 'candela', binder: 'Nicaragua', filler: 'Nicaragua (Condega)', originCountry: 'Nicaragua', originRegion: 'Condega', strength: 'suave' },
    { cost: 2.6, price: 5.75, pvp: 10, commission: { type: 'percent', value: 8 }, pack: 20, low: 40 },
    'Capa verde de curado rápido: hierba fresca, té verde y azúcar.',
    'Limonada, mojito sin alcohol o un blanco seco.',
    6,
  ),
];

// De mazo: lo que más se vende en bodegas, gasolineras y licorerías. Todo inventado.
products.push(
  mazo('mz-toro-hab', 'Toro', { vitola: 'Toro', lengthIn: 6, ringGauge: 52, capa: 'habano', strength: 'media', originRegion: 'Estelí' }, { cost: 10.5, price: 25, pvp: 43.75 }, 'Parejo y rendidor: tierra, cedro y un dulzor suave.', 3),
  mazo('mz-toro-mad', 'Toro', { vitola: 'Toro', lengthIn: 6, ringGauge: 52, capa: 'maduro', strength: 'fuerte', originRegion: 'Estelí' }, { cost: 10.9, price: 26, pvp: 45 }, 'Oscuro y con cuerpo: cacao, café y melaza.', 3),
  mazo('mz-toro-con', 'Toro', { vitola: 'Toro', lengthIn: 6, ringGauge: 52, capa: 'connecticut', strength: 'suave', originRegion: 'Condega' }, { cost: 10.2, price: 24, pvp: 42.5 }, 'Suave y cremoso, para quien empieza.', 2),
  mazo('mz-rob-hab', 'Robusto', { vitola: 'Robusto', lengthIn: 5, ringGauge: 50, capa: 'habano', strength: 'media', originRegion: 'Estelí' }, { cost: 9.6, price: 23, pvp: 40 }, 'Corto y con sabor: madera y pimienta suave.', 2.5),
  mazo('mz-rob-mad', 'Robusto', { vitola: 'Robusto', lengthIn: 5, ringGauge: 50, capa: 'maduro', strength: 'fuerte', originRegion: 'Jalapa' }, { cost: 9.9, price: 24, pvp: 41.25 }, 'Fuerte y dulce al final.', 2),
  mazo('mz-torp-mad', 'Torpedo', { vitola: 'Torpedo', lengthIn: 6.125, ringGauge: 52, capa: 'maduro', strength: 'fuerte', originRegion: 'Estelí' }, { cost: 11.4, price: 27, pvp: 46.25 }, 'La punta concentra el humo: café tostado y especias.', 2),
  mazo('mz-torp-nat', 'Torpedo', { vitola: 'Torpedo', lengthIn: 6.125, ringGauge: 52, capa: 'natural', strength: 'media', originRegion: 'Condega' }, { cost: 11, price: 26, pvp: 45 }, 'Equilibrado, con un final de nuez.', 1.5),
  mazo('mz-chu-con', 'Churchill', { vitola: 'Churchill', lengthIn: 7, ringGauge: 48, capa: 'connecticut', strength: 'suave', originRegion: 'Condega' }, { cost: 11.2, price: 26, pvp: 45 }, 'Largo y suave, para la tarde.', 1.5),
  mazo('mz-chu-hab', 'Churchill', { vitola: 'Churchill', lengthIn: 7, ringGauge: 48, capa: 'habano', strength: 'media', originRegion: 'Estelí' }, { cost: 11.6, price: 27, pvp: 46.25 }, 'Mucho humo y buen tiro.', 1.5),
);

const ALL = products.filter((p) => p.kind === 'premium').map((p) => p.key);
const pickSet = (...keys: string[]) => keys;

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
  permitDays: number,
  extra: Partial<StoreSeed> = {},
): StoreSeed {
  const area = city === 'Fort Lauderdale' ? '954' : '305';
  return {
    key,
    name,
    type,
    zone: z[zone],
    city: `${city}, FL`,
    address: `${1000 + n * 37} Avenida Ejemplo (dirección de ejemplo)`,
    lat,
    lng,
    managerName: manager,
    phone: `(${area}) 555-01${String(n).padStart(2, '0')}`,
    email: `${key.replace(/^t-/, '')}@example.com`,
    hours: 'Lun–Sáb 10:00–20:00 · Dom 12:00–18:00',
    seller,
    activationDay,
    final,
    assortment,
    size,
    permit: { number: `TP-DEMO-${48200 + n * 13}`, expiresDay: permitDays },
    ...extra,
  };
}

/** Locales de Houston: ciudad en Texas y teléfono con código 713 (todo inventado). */
function texas(n: number): Partial<StoreSeed> {
  return { city: 'Houston, TX', phone: `(713) 555-01${String(n).padStart(2, '0')}` };
}

const stores: StoreSeed[] = [
  // Andrés Molina: Hialeah y Doral
  store('t-faro', 'Tabaquería El Faro', 'Tabaquería', 'hialeah', 'Hialeah', 25.8612, -80.2788, 'Osvaldo Pérez', 1, 'andres', -88, 'activo', pickSet('bis-rob', 'bis-toro', 'eve-cor', 'eve-torp', 'tam-lanc', 'cor-petit', 'bri-beli', 'bri-cand', 'mz-toro-hab', 'mz-toro-mad', 'mz-rob-hab'), 1.2, 260),
  store('t-humo', 'Licorería Humo y Ron', 'Licorería', 'hialeah', 'Hialeah', 25.848, -80.2851, 'Yamila Rodríguez', 2, 'andres', -80, 'activo', pickSet('bis-rob', 'eve-cor', 'eve-gordo', 'cor-petit', 'cor-toro', 'mz-toro-hab', 'mz-toro-mad'), 1.0, -10, {
    notes: 'El permiso de tabaco venció: pedir la renovación en la próxima visita.',
  }),
  store('t-esquina', 'Bodega La Esquina 49', 'Bodega', 'hialeah', 'Hialeah', 25.8705, -80.301, 'Reinaldo Suárez', 3, 'andres', null, 'contrato_enviado', [], 1, 300),
  store('t-brisa', 'Licorería Brisa Doral', 'Licorería', 'doral', 'Doral', 25.8113, -80.338, 'Patricia Gómez', 4, 'andres', -70, 'activo', pickSet('bis-toro', 'bis-church', 'eve-gordo', 'bri-beli', 'cor-toro'), 0.9, 410),
  store('t-pc', 'Puro y Café Doral', 'Lounge de puros', 'doral', 'Doral', 25.8268, -80.3509, 'Héctor Villalobos', 5, 'andres', -55, 'activo', pickSet('bis-rob', 'eve-torp', 'tam-rob', 'tam-lanc', 'bri-beli', 'bri-cand'), 1.1, 380),
  // Yanelis Cruz: Pequeña Habana y Coral Gables
  store('t-hoja', 'Lounge La Hoja Dorada', 'Lounge de puros', 'habana', 'Pequeña Habana, Miami', 25.7655, -80.219, 'Ismael Fonseca', 6, 'yanelis', -86, 'activo', ALL, 1.5, 330),
  store('t-ficha', 'Tabaquería Ficha Doble', 'Tabaquería', 'habana', 'Pequeña Habana, Miami', 25.7712, -80.2276, 'Mirtha Calzada', 7, 'yanelis', -75, 'activo', pickSet('bis-rob', 'eve-cor', 'cor-petit', 'tam-rob', 'eve-torp'), 0.8, 200, { overdue: true }),
  store('t-ocho', 'Bodega Ocho y Medio', 'Bodega', 'habana', 'Pequeña Habana, Miami', 25.766, -80.2085, 'Alberto Ríos', 8, 'yanelis', -50, 'activo', pickSet('eve-cor', 'cor-petit', 'bis-rob', 'mz-toro-hab', 'mz-toro-mad', 'mz-torp-mad', 'mz-rob-mad'), 0.7, 290),
  store('t-club', 'Club de Humo Coral', 'Lounge de puros', 'gables', 'Coral Gables', 25.7495, -80.26, 'Verónica Lago', 9, 'yanelis', -82, 'activo', pickSet('bis-church', 'eve-gordo', 'tam-lanc', 'tam-rob', 'cor-toro', 'bri-beli', 'eve-torp'), 1.3, 350),
  store('t-estanco', 'Estanco Gables', 'Tabaquería', 'gables', 'Coral Gables', 25.728, -80.268, 'Fernando Arce', 10, 'yanelis', null, 'firmado', [], 1, 395),
  // Rafael Ortega: Westchester y Kendall
  store('t-tamiami', 'Bodega Tamiami 107', 'Bodega', 'westchester', 'Westchester', 25.7495, -80.3242, 'Gisela Marín', 11, 'rafael', -78, 'activo', pickSet('bis-rob', 'eve-cor', 'cor-petit', 'bri-cand', 'mz-toro-hab', 'mz-toro-con', 'mz-chu-con', 'mz-rob-hab'), 0.9, 240),
  store('t-bird', 'Tabaquería Bird 87', 'Tabaquería', 'westchester', 'Westchester', 25.735, -80.311, 'Rolando Peña', 12, 'rafael', -66, 'activo', pickSet('bis-toro', 'eve-torp', 'cor-toro', 'bri-beli'), 1.0, 270, {
    final: 'pausado',
    pausedDay: -12,
    notes: 'Cerrado por remodelación; reabre a fin de mes.',
  }),
  store('t-sunset', 'Licorería Sunset 88', 'Licorería', 'kendall', 'Kendall', 25.6866, -80.3133, 'Marisela Duarte', 13, 'rafael', -84, 'activo', pickSet('bis-rob', 'bis-toro', 'eve-cor', 'eve-gordo', 'cor-petit', 'bri-cand', 'mz-toro-hab', 'mz-chu-hab'), 1.1, 310),
  store('t-pinos', 'Tabaquería Los Pinos', 'Tabaquería', 'kendall', 'Kendall', 25.6721, -80.3395, 'Ernesto Valle', 14, 'rafael', -60, 'activo', pickSet('tam-lanc', 'tam-rob', 'eve-torp', 'cor-toro'), 0.8, 420),
  // Lucía Paredes: Miami Beach y Fort Lauderdale
  store('t-ocean', 'Licorería Ocean Breeze', 'Licorería', 'beach', 'Miami Beach', 25.7905, -80.13, 'Daniel Sosa', 15, 'lucia', -72, 'activo', pickSet('bis-rob', 'bis-toro', 'bri-cand', 'eve-cor', 'cor-petit'), 1.2, 280),
  store('t-collins', 'Lounge Collins 41', 'Lounge de puros', 'beach', 'Miami Beach', 25.816, -80.1225, 'Carolina Méndez', 16, 'lucia', -45, 'activo', pickSet('bis-church', 'tam-lanc', 'eve-gordo', 'bri-beli', 'eve-torp'), 1.0, 360),
  store('t-rio', 'Tabaquería Río Nuevo', 'Tabaquería', 'lauderdale', 'Fort Lauderdale', 26.1188, -80.139, 'Javier Lozano', 17, 'lucia', -64, 'activo', pickSet('bis-rob', 'eve-cor', 'cor-toro', 'bri-beli', 'mz-toro-mad', 'mz-torp-nat'), 0.9, 230),
  store('t-puerto', 'Licorería Puerto Lauderdale', 'Licorería', 'lauderdale', 'Fort Lauderdale', 26.142, -80.126, 'Adriana Paz', 18, 'lucia', null, 'prospecto', [], 1, 330),
  // Tomás Garza: Houston, el mercado nuevo (permisos de Texas; ver seed/r3-red.ts)
  store('t-bayou', 'Tabaquería Bayou', 'Tabaquería', 'houston', 'Houston', 29.7445, -95.3802, 'Ramiro Treviño', 19, 'tomas', -44, 'activo', pickSet('bis-rob', 'bis-toro', 'eve-cor', 'eve-torp', 'bri-beli', 'mz-toro-hab', 'mz-toro-mad'), 1.0, 320, texas(19)),
  store('t-westheimer', 'Licorería Westheimer 22', 'Licorería', 'houston', 'Houston', 29.7372, -95.4235, 'Leticia Cantú', 20, 'tomas', -38, 'activo', pickSet('bis-rob', 'eve-cor', 'cor-petit', 'mz-toro-hab', 'mz-rob-hab', 'mz-chu-con'), 0.9, 290, texas(20)),
  store('t-montrose', 'Lounge Montrose', 'Lounge de puros', 'houston', 'Houston', 29.749, -95.391, 'Gerardo Salinas', 21, 'tomas', -30, 'activo', pickSet('bis-church', 'tam-lanc', 'tam-rob', 'eve-gordo', 'bri-beli', 'cor-toro'), 1.1, 350, texas(21)),
  store('t-magnolia', 'Bodega Magnolia', 'Bodega', 'houston', 'Houston', 29.733, -95.324, 'Alicia Zamora', 22, 'tomas', -21, 'activo', pickSet('eve-cor', 'cor-petit', 'mz-toro-hab', 'mz-toro-mad', 'mz-torp-mad'), 0.8, 300, texas(22)),
  store('t-heights', 'Tabaquería Heights', 'Tabaquería', 'houston', 'Houston', 29.79, -95.3985, 'Esteban Villarreal', 23, 'tomas', null, 'prospecto', [], 1, 330, texas(23)),
];

export const TABACO_SEED: LineSeedDef = {
  line: 'tabaco',
  config: TABACO,
  seed: 2611,
  settings: {
    companyName: TABACO.companyName,
    settlementEveryDays: 15,
    paymentTermsDays: 10,
    commissionPayableOn: 'cobro',
    defaultSellerCommission: TABACO.defaultCommission,
    defaultLowStock: 60,
    expiryWarningDays: 30,
    noRotationDays: 21,
    contractTermMonths: 12,
    terminationNoticeDays: 30,
  },
  warehouse: { name: 'Almacén Miami', address: 'Doral, FL (ubicación de ejemplo)', lat: 25.813, lng: -80.343 },
  zones: [
    { id: z.hialeah, name: 'Hialeah', lat: 25.8576, lng: -80.2781 },
    { id: z.habana, name: 'Pequeña Habana', lat: 25.7735, lng: -80.2155 },
    { id: z.doral, name: 'Doral', lat: 25.8195, lng: -80.3553 },
    { id: z.westchester, name: 'Westchester', lat: 25.7548, lng: -80.3273 },
    { id: z.kendall, name: 'Kendall', lat: 25.6793, lng: -80.3173 },
    { id: z.gables, name: 'Coral Gables', lat: 25.7215, lng: -80.2684 },
    { id: z.beach, name: 'Miami Beach', lat: 25.8106, lng: -80.125 },
    { id: z.lauderdale, name: 'Fort Lauderdale', lat: 26.1224, lng: -80.1373 },
    { id: z.houston, name: 'Houston', lat: 29.7604, lng: -95.3698, marketId: 'houston' },
  ],
  users: [
    { key: 'daniela', role: 'admin', name: 'Daniela Ferrer', email: 'oficina.tabaco@example.com', phone: '(305) 555-0190' },
    { key: 'andres', role: 'seller', name: 'Andrés Molina', email: 'andres.molina@example.com', phone: '(305) 555-0141', zone: z.hialeah },
    { key: 'yanelis', role: 'seller', name: 'Yanelis Cruz', email: 'yanelis.cruz@example.com', phone: '(305) 555-0142', zone: z.habana },
    { key: 'rafael', role: 'seller', name: 'Rafael Ortega', email: 'rafael.ortega@example.com', phone: '(305) 555-0143', zone: z.kendall },
    { key: 'lucia', role: 'seller', name: 'Lucía Paredes', email: 'lucia.paredes@example.com', phone: '(305) 555-0144', zone: z.beach },
    { key: 'tomas', role: 'seller', name: 'Tomás Garza', email: 'tomas.garza@example.com', phone: '(713) 555-0145', zone: z.houston },
  ],
  products,
  stores,
  restockDays: [-95, -55, -25],
  pendingArrivals: [
    {
      inDays: 8,
      status: 'transito',
      supplier: 'Fábrica asociada en Santiago (ejemplo)',
      originCountry: 'República Dominicana',
      items: [
        { product: 'eve-torp', qty: 500 },
        { product: 'eve-cor', qty: 300 },
        { product: 'eve-gordo', qty: 200 },
      ],
    },
    {
      inDays: 30,
      status: 'produccion',
      supplier: 'Taller asociado en Estelí (ejemplo)',
      originCountry: 'Nicaragua',
      items: [
        { product: 'bis-rob', qty: 600 },
        { product: 'bis-toro', qty: 400 },
        { product: 'bri-beli', qty: 300 },
        { product: 'bri-cand', qty: 250 },
      ],
    },
  ],
  supplierFor: (p) => {
    const c = String(p.attrs.originCountry);
    if (c === 'Nicaragua') return { supplier: 'Taller asociado en Estelí (ejemplo)', originCountry: 'Nicaragua' };
    if (c === 'República Dominicana') return { supplier: 'Fábrica asociada en Santiago (ejemplo)', originCountry: 'República Dominicana' };
    if (c === 'Honduras') return { supplier: 'Fábrica asociada en Danlí (ejemplo)', originCountry: 'Honduras' };
    return { supplier: 'Taller propio en Miami (producción local, ejemplo)', originCountry: 'Estados Unidos' };
  },
  primary: { admin: 'daniela', seller: 'andres', store: 't-faro' },
  pendingReorders: [
    { store: 't-faro', status: 'enviado', items: [{ product: 'bis-rob', packs: 2 }, { product: 'tam-lanc', packs: 1 }], note: 'Se acabaron los Biscayne Robusto el fin de semana.' },
    { store: 't-pc', status: 'confirmado', items: [{ product: 'eve-torp', packs: 2 }, { product: 'bri-beli', packs: 1 }], note: '' },
  ],
  messages: [
    {
      kind: 'admin_vendedor',
      between: ['andres', 'daniela'],
      lines: [
        { from: 0, text: 'Daniela, El Faro y Puro y Café están pidiendo Everglades Torpedo. ¿Cuándo llega el contenedor?', hoursAgo: 26 },
        { from: 1, text: 'Está en tránsito: llega en unos 8 días. Te aviso apenas lo recibamos.', hoursAgo: 25, product: 'eve-torp' },
        { from: 0, text: 'Perfecto. Esta semana firmo con La Esquina 49.', hoursAgo: 3 },
      ],
    },
    {
      kind: 'vendedor_local',
      between: ['andres', 't-faro'],
      store: 't-faro',
      lines: [
        { from: 1, text: 'Hola Andrés, los Biscayne Robusto se están acabando.', hoursAgo: 52 },
        { from: 0, text: 'Te paso el jueves con dos cajas.', hoursAgo: 50 },
        { from: 1, text: '¿Me confirmas la hora del jueves? También quiero probar el Tamiami Lancero.', hoursAgo: 27, product: 'tam-lanc' },
      ],
    },
    {
      kind: 'vendedor_local',
      between: ['yanelis', 't-hoja'],
      store: 't-hoja',
      lines: [
        { from: 1, text: '¿Nos pueden traer un exhibidor para el Brickell Belicoso?', hoursAgo: 30, product: 'bri-beli' },
        { from: 0, text: 'Sí, lo llevo en la visita del lunes.', hoursAgo: 29 },
      ],
    },
    {
      kind: 'admin_vendedor',
      between: ['rafael', 'daniela'],
      lines: [
        { from: 0, text: 'Bird 87 sigue cerrado por remodelación; reabren a fin de mes.', hoursAgo: 8 },
        { from: 1, text: 'De acuerdo, lo dejamos pausado hasta entonces.', hoursAgo: 7 },
      ],
    },
  ],
  announcements: [
    {
      title: 'Llega el Everglades Torpedo',
      body: 'El contenedor de República Dominicana llega en unos 8 días con 500 Everglades Torpedo, 300 Corona y 200 Gordo. Anoten los pedidos de sus locales para repartirlo bien.',
      audience: 'vendedores',
      daysAgo: 2,
    },
    {
      title: 'Permiso de tabaco y 21+',
      body: 'Sin permiso de venta de tabaco vigente no se consigna producto. Pidan el permiso actualizado en cada visita y recuerden a los locales: venta solo a mayores de 21 años, con identificación.',
      audience: 'todos',
      daysAgo: 10,
    },
  ],
  lowStockProduct: 'eve-torp',
};
