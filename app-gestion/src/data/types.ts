// Modelo de datos del ecosistema. Cada línea (tabaco, café) guarda estas entidades
// en su propia base IndexedDB; nada de aquí se comparte entre líneas.

export type LineId = 'tabaco' | 'cafe';
export const LINES: readonly LineId[] = ['tabaco', 'cafe'] as const;

export type Role = 'admin' | 'seller' | 'store' | 'direccion';

/** Fecha y hora en ISO (UTC). Se muestra siempre en America/New_York. */
export type IsoDateTime = string;
/** Fecha sin hora, YYYY-MM-DD, interpretada en America/New_York. */
export type IsoDate = string;

export interface Entity {
  id: string;
}

// ---------- Catálogo ----------
export type CommissionRule = { type: 'percent'; value: number } | { type: 'fixed'; value: number };

/** Tabaco: premium (con marca, capote y tripa) o de mazo (sin marca). */
export type ProductKind = 'premium' | 'mazo';

export interface Product extends Entity {
  sku: string;
  name: string;
  brandLine: string;
  active: boolean;
  /** Costo por unidad. Solo lo ve administración. */
  cost: number;
  /** Lo que el local le paga a la empresa por cada unidad vendida. */
  priceToStore: number;
  /** Precio de venta al público sugerido. La ganancia del local es PVP − precio al local. */
  suggestedRetail: number;
  sellerCommission: CommissionRule;
  /** Comisión propia: este producto paga siempre su regla, aunque haya comisión progresiva. */
  commissionCustom?: boolean;
  lowStockThreshold: number;
  /** Unidades por caja (presentación). */
  packSize: number;
  unitName: string;
  notes: string;
  pairing: string;
  /** Campos propios de la línea (vitola, capa… o tueste, molido…). */
  attrs: Record<string, string | number>;
  photoIds: string[];
  /** Tabaco: premium o de mazo. */
  kind?: ProductKind;
  /** Familia (por ejemplo «Toro»): sus variantes salen en una sola tarjeta del catálogo. */
  familyId?: string;
  familyName?: string;
  /** Lo que distingue a la variante dentro de su familia (por ejemplo «Maduro · 6 × 52»). */
  variantLabel?: string;
  /** Código de barras (EAN-13, EAN-8, UPC-A o Code 128). Si no hay, la etiqueta usa el SKU. */
  barcode?: string;
  /** Precio al local por caja, si no es unidades por caja × precio por unidad. */
  boxPrice?: number;
  /** Foto de la marca (solo café): nombre de archivo en public/marca/productos. */
  brandPhoto?: string;
  sampleCost: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Photo extends Entity {
  /** `document`: foto o PDF de un permiso, Tax ID o certificado; `bale`: foto de un bulto con diferencias. */
  ownerType: 'product' | 'store' | 'return' | 'message' | 'visit' | 'document' | 'bale';
  ownerId: string;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  createdAt: IsoDateTime;
}

// ---------- Almacén ----------
export interface Warehouse extends Entity {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface Lot extends Entity {
  productId: string;
  code: string;
  arrivalId: string | null;
  unitCost: number;
  receivedAt: IsoDateTime;
  /** Café: fecha de tostado (o envasado). */
  producedOn?: IsoDate;
  /** Café: consumir antes de. */
  bestBefore?: IsoDate;
  productionLine?: string;
}

export type ArrivalStatus =
  | 'produccion'
  | 'transito'
  | 'aduana'
  /** Confirmando bultos (entre «En aduana» y «Recibida»). */
  | 'confirmando'
  | 'recibida'
  | 'programado'
  | 'tostado'
  | 'cancelada';

export interface ArrivalItem {
  productId: string;
  qty: number;
  unitCost: number;
}

export type BaleStatus = 'pendiente' | 'bien' | 'falta' | 'sobra' | 'danado';

export interface BaleItem {
  productId: string;
  /** Lo que dice la lista de empaque (en la unidad del producto: mazos, tabacos…). */
  qty: number;
  unitCost: number;
}

/** Un bulto de la lista de empaque de una importación. Puede traer varios productos. */
export interface Bale {
  id: string;
  number: string;
  items: BaleItem[];
  status: BaleStatus;
  /** Lo contado por producto (si falta, se toma lo esperado). */
  counted?: Record<string, number>;
  note?: string;
  photoIds?: string[];
  checkedAt?: IsoDateTime;
  checkedBy?: string;
}

export interface Arrival extends Entity {
  kind: 'import' | 'roast';
  code: string;
  status: ArrivalStatus;
  /** Fecha estimada de llegada (importación) o fecha de tostado (café). */
  eta: IsoDate;
  supplier: string;
  originCountry: string;
  productionLine?: string;
  /** Café: consumir antes de, para el lote. */
  bestBefore?: IsoDate;
  items: ArrivalItem[];
  /** Importación: lista de empaque por bulto (si se cargó). */
  bales?: Bale[];
  notes: string;
  createdAt: IsoDateTime;
  receivedAt?: IsoDateTime;
  statusHistory: { status: ArrivalStatus; at: IsoDateTime }[];
}

/** Dónde está la mercancía: el almacén, un local (en consignación) o fuera (vendida, perdida…). */
export type Location =
  | { kind: 'warehouse' }
  | { kind: 'store'; storeId: string }
  | { kind: 'supplier' }
  | { kind: 'sold' }
  | { kind: 'loss' }
  | { kind: 'adjustment' };

export type MovementType =
  | 'entrada'
  | 'salida_consignacion'
  | 'venta_reportada'
  | 'devolucion'
  | 'merma'
  | 'ajuste'
  /** Venta en firme (mayoreo): del almacén a vendido. */
  | 'venta_firme'
  /** Inventario inicial cargado al importar productos. */
  | 'inventario_inicial';

export interface Movement extends Entity {
  at: IsoDateTime;
  type: MovementType;
  productId: string;
  lotId: string;
  qty: number;
  from: Location;
  to: Location;
  /** Para buscar rápido los movimientos de un local. */
  storeId: string | null;
  refType: 'arrival' | 'delivery' | 'sale' | 'return' | 'shrink' | 'adjust' | 'seed' | 'invoice' | 'import' | 'count';
  refId: string;
  reason?: string;
  actorId: string;
}

// ---------- Locales ----------
export type StoreStatus = 'prospecto' | 'contrato_enviado' | 'firmado' | 'activo' | 'pausado' | 'cerrado';

export interface TobaccoPermit {
  number: string;
  expiresOn: IsoDate;
  /** Quién lo emite (Florida: DBPR; Texas: Comptroller). */
  issuer?: string;
}

/** Consignación (lo de siempre) o compra en firme como mayorista. */
export type SaleMode = 'consignacion' | 'firme';

export interface ResaleCertificate {
  number: string;
  expiresOn: IsoDate;
}

export type StoreDocumentKind = 'permiso' | 'taxId' | 'reventa';

export interface Store extends Entity {
  name: string;
  type: string;
  address: string;
  city: string;
  zoneId: string;
  lat: number;
  lng: number;
  managerName: string;
  phone: string;
  email: string;
  hours: string;
  facadePhotoId?: string;
  sellerId: string;
  status: StoreStatus;
  tobaccoPermit?: TobaccoPermit;
  /** Si falta, consignación. */
  saleMode?: SaleMode;
  /** En firme: días de crédito (0 = de contado). */
  creditDays?: number;
  /** Lista de precios del local (si falta, la de la línea por defecto). */
  priceListId?: string;
  /** Mercado (Miami, Houston…). Si falta, el primero de la línea. */
  marketId?: string;
  /** Tax ID (EIN) del local. */
  taxId?: string;
  /** Certificado de reventa (Florida: Annual Resale Certificate). */
  resaleCert?: ResaleCertificate;
  /** Foto o PDF de cada documento (id en `photos`). */
  documents?: Partial<Record<StoreDocumentKind, string>>;
  notes: string;
  createdAt: IsoDateTime;
  createdBy: string;
  approvedAt?: IsoDateTime;
  statusHistory: { status: StoreStatus; at: IsoDateTime; by: string }[];
}

export interface Signature {
  role: 'local' | 'empresa';
  name: string;
  /** Trazo de la firma como imagen (data URL: PNG de la firma en pantalla, SVG en la semilla). */
  image: string;
  signedAt: IsoDateTime;
  geo?: { lat: number; lng: number; accuracy: number };
  /** Usuario de la app en cuyo teléfono se firmó. */
  deviceUserId: string;
}

export interface ContractAnnexItem {
  productId: string;
  name: string;
  sku: string;
  /** Unidad del producto (mazo, tabaco…). Si falta, la de la línea. */
  unitName?: string;
  priceToStore: number;
  suggestedRetail: number;
  storeEarning: number;
}

export interface Contract extends Entity {
  storeId: string;
  /** Versión del contrato de este local (1, 2…). */
  version: number;
  templateVersion: number;
  status: 'enviado' | 'firmado' | 'anulado';
  /** Texto completo ya con las variables puestas: lo que se firma. */
  body: string;
  annex: ContractAnnexItem[];
  settlementDays: number;
  createdAt: IsoDateTime;
  createdBy: string;
  signedAt?: IsoDateTime;
  signatures: Signature[];
  /** Plantilla PDF con la que se emitió (si no hay, es el texto de Ajustes). */
  templateId?: string;
}

// ---------- Plantillas PDF de documentos ----------
export type TemplateKind = 'consignacion' | 'entrega';

export type TemplateFieldType =
  | 'firma_local'
  | 'firma_vendedor'
  | 'nombre_local'
  | 'encargado'
  | 'vendedor'
  | 'fecha'
  | 'direccion_local'
  | 'detalle_entrega';

/** Un recuadro sobre una página del PDF. x, y, w, h son fracciones (0 a 1) de la página, origen arriba a la izquierda. */
export interface TemplateField {
  id: string;
  type: TemplateFieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Plantilla PDF: no se edita nunca; guardar crea una versión nueva y la deja activa. */
export interface ContractTemplate extends Entity {
  kind: TemplateKind;
  name: string;
  pdf: Blob;
  /** Tamaño de cada página en puntos PDF. */
  pageSizes: { w: number; h: number }[];
  fields: TemplateField[];
  version: number;
  active: boolean;
  createdAt: IsoDateTime;
  createdBy: string;
}

// ---------- Entregas en consignación ----------
export type DeliveryStatus = 'solicitada' | 'preparada' | 'entregada' | 'rechazada';

export interface DeliveryItem {
  productId: string;
  qty: number;
  /** Lo que se pudo preparar (puede ser menos que qty si no había). */
  preparedQty?: number;
}

export interface Delivery extends Entity {
  code: string;
  storeId: string;
  sellerId: string;
  status: DeliveryStatus;
  items: DeliveryItem[];
  note: string;
  origin: 'vendedor' | 'pedido_local' | 'administracion';
  reorderId?: string;
  requestedAt: IsoDateTime;
  requestedBy: string;
  preparedAt?: IsoDateTime;
  preparedBy?: string;
  deliveredAt?: IsoDateTime;
  receivedSignature?: Signature;
  rejectedReason?: string;
  /** Plantilla PDF de nota de entrega activa cuando se recibió (si había). */
  templateId?: string;
  /** Venta en firme: factura que nació al recibir. */
  invoiceId?: string;
  /** Reparto (ruta del camión) en el que va. */
  routeId?: string;
}

// ---------- Visitas, ventas, devoluciones ----------
export interface VisitCount {
  productId: string;
  expected: number;
  counted: number;
}

export interface Visit extends Entity {
  storeId: string;
  sellerId: string;
  at: IsoDateTime;
  geo?: { lat: number; lng: number; accuracy: number };
  notes: string;
  counts: VisitCount[];
  salesReportId?: string;
  photoIds: string[];
}

export interface SaleLine {
  productId: string;
  qty: number;
  unitPrice: number;
  /** Costo por lote de lo vendido (COGS). */
  cost: number;
  lots: { lotId: string; qty: number; unitCost: number }[];
}

export interface SalesReport extends Entity {
  storeId: string;
  sellerId: string;
  at: IsoDateTime;
  source: 'conteo' | 'local';
  lines: SaleLine[];
  total: number;
  settlementId: string | null;
  createdBy: string;
}

export interface ReturnRecord extends Entity {
  storeId: string | null;
  kind: 'devolucion' | 'merma';
  at: IsoDateTime;
  items: { productId: string; qty: number }[];
  reason: string;
  photoIds: string[];
  createdBy: string;
  cost: number;
}

// ---------- Pedidos de los locales ----------
export type ReorderStatus = 'enviado' | 'confirmado' | 'preparado' | 'entregado' | 'cancelado';

export interface Reorder extends Entity {
  code: string;
  storeId: string;
  sellerId: string;
  status: ReorderStatus;
  items: { productId: string; qty: number }[];
  note: string;
  createdAt: IsoDateTime;
  createdBy: string;
  confirmedAt?: IsoDateTime;
  deliveryId?: string;
  /** Cómo llegó: lo pidió el local o el vendedor, por teléfono o pegado de un mensaje. */
  origin?: 'local' | 'vendedor' | 'telefono' | 'pegado';
  history: { status: ReorderStatus; at: IsoDateTime; by: string }[];
}

export interface UnmetDemand extends Entity {
  productId: string;
  storeId: string;
  qty: number;
  at: IsoDateTime;
  source: 'pedido' | 'entrega';
  refId: string;
}

// ---------- Cobros y comisiones ----------
export type SettlementStatus = 'pendiente' | 'parcial' | 'pagada';

export interface Settlement extends Entity {
  code: string;
  storeId: string;
  sellerId: string;
  periodFrom: IsoDateTime;
  periodTo: IsoDateTime;
  issuedAt: IsoDateTime;
  dueOn: IsoDate;
  salesReportIds: string[];
  lines: { productId: string; qty: number; unitPrice: number; amount: number }[];
  amount: number;
  paid: number;
  status: SettlementStatus;
  paidAt?: IsoDateTime;
}

/** `tarjeta`: cobrada aparte, en el datáfono del local o de la empresa (aquí solo se apunta). */
export type PaymentMethod = 'efectivo' | 'cheque' | 'zelle' | 'transferencia' | 'tarjeta';

export interface Payment extends Entity {
  /** Pago de una liquidación (consignación)… */
  settlementId?: string;
  /** …o de una factura (venta en firme). */
  invoiceId?: string;
  storeId: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  at: IsoDateTime;
  recordedBy: string;
}

export type CommissionStatus = 'devengada' | 'pagable' | 'pagada';

export interface Commission extends Entity {
  sellerId: string;
  storeId: string;
  productId: string;
  /** Venta reportada en consignación (vacío en una venta en firme). */
  salesReportId: string;
  settlementId: string | null;
  /** Venta en firme: la factura que la generó (se vuelve pagable cuando la factura queda pagada). */
  invoiceId?: string;
  qty: number;
  base: number;
  amount: number;
  rule: CommissionRule;
  status: CommissionStatus;
  accruedAt: IsoDateTime;
  payableAt?: IsoDateTime;
  paidAt?: IsoDateTime;
  payoutId?: string;
}

export interface CommissionPayout extends Entity {
  sellerId: string;
  amount: number;
  commissionIds: string[];
  method: PaymentMethod;
  reference: string;
  at: IsoDateTime;
  recordedBy: string;
}

// ---------- Mensajes y avisos ----------
export type ThreadKind = 'admin_vendedor' | 'vendedor_local' | 'local_admin';

export interface Thread extends Entity {
  kind: ThreadKind;
  title: string;
  participantIds: string[];
  storeId?: string;
  sellerId?: string;
  createdAt: IsoDateTime;
  lastMessageAt: IsoDateTime;
  /** Último leído por usuario. */
  readBy: Record<string, IsoDateTime>;
}

export interface Message extends Entity {
  threadId: string;
  authorId: string;
  at: IsoDateTime;
  text: string;
  photoId?: string;
  productId?: string;
}

export interface Announcement extends Entity {
  title: string;
  body: string;
  audience: 'vendedores' | 'locales' | 'todos';
  at: IsoDateTime;
  authorId: string;
}

export type NotificationKind =
  | 'local_por_aprobar'
  | 'contrato_firmado'
  | 'pedido_nuevo'
  | 'pedido_confirmado'
  | 'entrega_solicitada'
  | 'entrega_preparada'
  | 'entrega_recibida'
  | 'stock_bajo'
  | 'llegada_recibida'
  | 'pago_vencido'
  | 'pago_registrado'
  | 'liquidacion_nueva'
  | 'comision_pagada'
  | 'mensaje'
  | 'comunicado'
  | 'cafe_por_vencer'
  | 'factura_nueva'
  | 'documento_por_vencer'
  | 'copia_pendiente';

export interface AppNotification extends Entity {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  at: IsoDateTime;
  read: boolean;
}

// ---------- Usuarios, ajustes, auditoría ----------
export interface User extends Entity {
  role: Exclude<Role, 'direccion'>;
  name: string;
  email: string;
  phone: string;
  zoneId?: string;
  storeId?: string;
  /** Vendedor: comisión especial que reemplaza la de cada producto (si se pone). */
  commissionOverride?: CommissionRule;
  /** Vendedor: comisión progresiva propia (si falta, la de Ajustes). */
  commissionScheme?: CommissionScheme;
  /** Vendedor: mercado donde trabaja. */
  marketId?: string;
  active: boolean;
  createdAt: IsoDateTime;
}

export interface Zone extends Entity {
  name: string;
  lat: number;
  lng: number;
  marketId?: string;
}

/** Mercado (Miami, Houston…): agrupa zonas, locales y vendedores. */
export interface Market {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zoom: number;
}

export type CommissionTierMetric = 'locales' | 'cajas' | 'unidades' | 'ventas';

/** Escalón: desde `min` (locales activos, cajas, unidades o dólares del mes) se pasa a `percent`. */
export interface CommissionTier {
  metric: CommissionTierMetric;
  min: number;
  percent: number;
}

/** Comisión progresiva: un % base, escalones y un tope que nunca se pasa. */
export interface CommissionScheme {
  basePercent: number;
  capPercent: number;
  tiers: CommissionTier[];
}

export interface LineSettings extends Entity {
  companyName: string;
  warehouseName: string;
  settlementEveryDays: number;
  paymentTermsDays: number;
  commissionPayableOn: 'venta' | 'cobro';
  defaultSellerCommission: CommissionRule;
  defaultLowStock: number;
  expiryWarningDays: number;
  noRotationDays: number;
  contractTemplate: string;
  contractTemplateVersion: number;
  contractTermMonths: number;
  terminationNoticeDays: number;
  /** Datos de ejemplo o datos reales de la empresa (solo en este navegador). Si falta, ejemplo. */
  dataMode?: 'demo' | 'real';
  /** Última copia exportada (para el aviso de copia de seguridad). */
  lastExportAt?: IsoDateTime;
  markets?: Market[];
  /** % de impuesto de venta. Vacío o 0: la app no calcula impuestos. */
  salesTaxPercent?: number;
  /** Comisión progresiva de la línea (si falta, la regla de cada producto). */
  commissionScheme?: CommissionScheme;
  /** Lista de precios de los locales que no tienen una propia. */
  defaultPriceListId?: string;
  /** Repartos: costo estimado por kilómetro (USD). */
  routeCostPerKm?: number;
}

export interface AuditEntry {
  seq?: number;
  id: string;
  at: IsoDateTime;
  actorId: string;
  actorName: string;
  role: Role | 'sistema';
  action: string;
  entity: string;
  entityId: string;
  summary: string;
}

// ---------- Común (eco-core) ----------
export interface DirectoryAccount extends Entity {
  role: Role;
  line: LineId | null;
  userId: string;
  name: string;
  label: string;
  /** Las cuentas principales salen primero en «Entrar como…». */
  primary: boolean;
  storeId?: string;
}

export interface SessionState extends Entity {
  accountId: string | null;
  /** Administración o Dirección mirando con los ojos de otra cuenta (solo mirar). */
  viewAsAccountId: string | null;
  /** Dirección entrando a una línea como «ver como Administración». */
  directorLine: LineId | null;
}

export interface EcosystemSettings extends Entity {
  name: string;
  theme: 'dark' | 'light';
  seededAt: IsoDateTime;
  seedVersion: number;
}

// ---------- Ronda 3: venta en firme, precios, trazabilidad, repartos, invitaciones ----------
export type PriceListKind = 'pvp' | 'local' | 'mayorista' | 'otra';

/** Precio de un producto en una lista: escrito o como % sobre el costo. */
export interface PriceEntry {
  mode: 'fixed' | 'markup';
  /** Por unidad base (mazo, tabaco o unidad). */
  unit?: number;
  /** Por caja (si falta: unidad × unidades por caja). */
  box?: number;
  markupPercent?: number;
  /** Desde N cajas, precio por caja. */
  volume?: { minBoxes: number; box: number };
}

export interface PriceList extends Entity {
  name: string;
  kind: PriceListKind;
  /** Para productos sin precio en la lista: % sobre el costo (si falta, el precio al local del producto). */
  defaultMarkupPercent?: number;
  entries: Record<string, PriceEntry>;
  active: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Por unidad base (mazo, tabaco o unidad) o por caja. */
export type SalePack = 'unidad' | 'caja';

export interface InvoiceLine {
  productId: string;
  /** Nombre al facturar (no cambia si el producto se renombra). */
  name: string;
  pack: SalePack;
  packQty: number;
  /** Unidades base que salen del almacén. */
  qty: number;
  /** Precio por unidad o por caja, según `pack`. */
  unitPrice: number;
  amount: number;
  /** Costo por lote (COGS). */
  cost: number;
  lots: { lotId: string; qty: number; unitCost: number }[];
}

export type InvoiceOrigin = 'entrega' | 'venta_rapida';

/** Factura de una venta en firme (mayoreo). Los pagos se apuntan en `payments` con `invoiceId`. */
export interface Invoice extends Entity {
  code: string;
  storeId: string;
  /** Sin vendedor (venta directa): no hay comisión. */
  sellerId: string | null;
  origin: InvoiceOrigin;
  deliveryId?: string;
  reorderId?: string;
  priceListId?: string;
  lines: InvoiceLine[];
  subtotal: number;
  taxPercent: number;
  tax: number;
  total: number;
  paid: number;
  status: SettlementStatus;
  issuedAt: IsoDateTime;
  dueOn: IsoDate;
  creditDays: number;
  /** El local no tenía certificado de reventa vigente al facturar. */
  withoutResaleCert: boolean;
  note: string;
  createdBy: string;
  paidAt?: IsoDateTime;
}

/** Trazabilidad: una caja con su número propio, de qué importación y bulto viene y a dónde fue. */
export interface CaseUnit extends Entity {
  code: string;
  productId: string;
  arrivalId: string | null;
  baleNumber?: string;
  factory: string;
  roller: string;
  packer: string;
  packedOn?: IsoDate;
  deliveryId?: string;
  invoiceId?: string;
  storeId?: string;
  createdAt: IsoDateTime;
}

export type RouteStatus = 'borrador' | 'en_ruta' | 'terminado';

/** Reparto: la ruta del día de un camión, con sus paradas en orden y sus costos. */
export interface DeliveryRoute extends Entity {
  code: string;
  date: IsoDate;
  driver: string;
  vehicle: string;
  stops: { deliveryId: string; storeId: string }[];
  km: number;
  costPerKm: number;
  driverCost: number;
  tolls: number;
  status: RouteStatus;
  createdAt: IsoDateTime;
  createdBy: string;
}

/** Invitación a un vendedor o a un local. Sin servidor solo elige la cuenta en este navegador. */
export interface Invitation extends Entity {
  accountId: string;
  userId: string;
  role: 'seller' | 'store';
  storeId?: string;
  priceListId?: string;
  expiresAt: IsoDateTime;
  createdAt: IsoDateTime;
  createdBy: string;
  revokedAt?: IsoDateTime;
  /** Última vez que alguien entró con ella (en este navegador). */
  acceptedAt?: IsoDateTime;
}
