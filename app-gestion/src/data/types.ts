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
  lowStockThreshold: number;
  /** Unidades por caja (presentación). */
  packSize: number;
  unitName: string;
  notes: string;
  pairing: string;
  /** Campos propios de la línea (vitola, capa… o tueste, molido…). */
  attrs: Record<string, string | number>;
  photoIds: string[];
  /** Foto de la marca (solo café): nombre de archivo en public/marca/productos. */
  brandPhoto?: string;
  sampleCost: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Photo extends Entity {
  ownerType: 'product' | 'store' | 'return' | 'message' | 'visit';
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
  | 'recibida'
  | 'programado'
  | 'tostado'
  | 'cancelada';

export interface ArrivalItem {
  productId: string;
  qty: number;
  unitCost: number;
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
  | 'ajuste';

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
  refType: 'arrival' | 'delivery' | 'sale' | 'return' | 'shrink' | 'adjust' | 'seed';
  refId: string;
  reason?: string;
  actorId: string;
}

// ---------- Locales ----------
export type StoreStatus = 'prospecto' | 'contrato_enviado' | 'firmado' | 'activo' | 'pausado' | 'cerrado';

export interface TobaccoPermit {
  number: string;
  expiresOn: IsoDate;
}

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

export type PaymentMethod = 'efectivo' | 'cheque' | 'zelle' | 'transferencia';

export interface Payment extends Entity {
  settlementId: string;
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
  salesReportId: string;
  settlementId: string | null;
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
  | 'cafe_por_vencer';

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
  active: boolean;
  createdAt: IsoDateTime;
}

export interface Zone extends Entity {
  name: string;
  lat: number;
  lng: number;
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
