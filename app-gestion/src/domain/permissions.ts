// Permisos por rol. Se aplican en la capa de servicios (can + ensure), nunca solo
// escondiendo botones. Ver docs/PERMISOS.md.
import type { LineId, Role, Store, Thread } from '../data/types';

export interface Actor {
  accountId: string;
  userId: string;
  role: Role;
  /** Línea a la que pertenece la cuenta. Dirección no tiene línea. */
  line: LineId | null;
  /** Para la cuenta de un local: su tienda. */
  storeId?: string;
  name: string;
  /** «Ver como…»: puede mirar pero no cambiar nada. */
  readOnly: boolean;
}

export type Action =
  | 'product.read'
  | 'product.readCost'
  | 'product.write'
  | 'inventory.read'
  | 'inventory.write'
  | 'store.list'
  | 'store.read'
  | 'store.create'
  | 'store.update'
  | 'store.approve'
  | 'contract.read'
  | 'contract.issue'
  | 'contract.sign'
  | 'delivery.read'
  | 'delivery.request'
  | 'delivery.prepare'
  | 'delivery.receive'
  | 'visit.create'
  | 'visit.read'
  | 'sale.report'
  | 'return.create'
  | 'reorder.create'
  | 'reorder.confirm'
  | 'reorder.read'
  | 'settlement.read'
  | 'settlement.create'
  | 'payment.record'
  | 'commission.read'
  | 'commission.pay'
  | 'accounting.read'
  | 'reports.read'
  | 'map.read'
  | 'message.read'
  | 'message.send'
  | 'announcement.create'
  | 'announcement.read'
  | 'user.read'
  | 'user.manage'
  | 'settings.read'
  | 'settings.manage'
  | 'audit.read'
  | 'direccion.read'
  // Ronda 3 · fiscal, comisiones, mercados y repartos
  | 'invitation.read'
  | 'invitation.create'
  | 'fiscal.report'
  | 'commission.configure'
  | 'market.manage'
  | 'route.read'
  | 'route.manage'
  // Ronda 3 · datos reales e importación
  /** Empezar en blanco: vaciar la línea para cargar los datos reales. */
  | 'data.reset'
  /** Exportar la copia de seguridad de la línea (anota la fecha de la última copia). */
  | 'data.export'
  /** Importar una copia de la línea (reemplaza todo lo de la línea). */
  | 'data.import'
  /** Importar productos desde Excel o CSV (crea productos y su inventario inicial). */
  | 'product.import'
  // Ronda 3 · escáner, etiquetas, trazabilidad y recepción
  | R3AlmacenAction;

// Ronda 3 · escáner, etiquetas, trazabilidad y recepción (todo de administración).
// Asignar códigos, registrar cajas, confirmar bultos y contar el almacén escriben; ver la
// trazabilidad de una caja e imprimir etiquetas solo leen.
const R3_ALMACEN_WRITE = ['code.assign', 'case.write', 'arrival.confirm', 'warehouse.count'] as const;
const R3_ALMACEN_READ = ['case.read', 'label.print'] as const;
export type R3AlmacenAction = (typeof R3_ALMACEN_WRITE)[number] | (typeof R3_ALMACEN_READ)[number];
const R3_ALMACEN_TEXT: Record<R3AlmacenAction, string> = {
  'code.assign': 'asignar códigos de barras',
  'case.write': 'registrar cajas',
  'arrival.confirm': 'confirmar bultos de una importación',
  'warehouse.count': 'contar el almacén',
  'case.read': 'ver de dónde viene y a dónde fue una caja',
  'label.print': 'imprimir etiquetas',
};

export type Resource =
  | { type: 'store'; store: Pick<Store, 'id' | 'sellerId'> }
  | { type: 'seller'; sellerId: string }
  | { type: 'thread'; thread: Pick<Thread, 'participantIds'> };

const WRITE: ReadonlySet<Action> = new Set<Action>([
  'product.write',
  'inventory.write',
  'store.create',
  'store.update',
  'store.approve',
  'contract.issue',
  'contract.sign',
  'delivery.request',
  'delivery.prepare',
  'delivery.receive',
  'visit.create',
  'sale.report',
  'return.create',
  'reorder.create',
  'reorder.confirm',
  'settlement.create',
  'payment.record',
  'commission.pay',
  'message.send',
  'announcement.create',
  'user.manage',
  'settings.manage',
  // Ronda 3 · fiscal, comisiones, mercados y repartos
  'invitation.create',
  'commission.configure',
  'market.manage',
  'route.manage',
  // Ronda 3 · datos reales e importación
  'data.reset',
  'data.export',
  'data.import',
  'product.import',
  // Ronda 3 · escáner, etiquetas, trazabilidad y recepción
  ...R3_ALMACEN_WRITE,
]);

export function isWrite(action: Action): boolean {
  return WRITE.has(action);
}

const ADMIN_ONLY: ReadonlySet<Action> = new Set<Action>([
  'product.readCost',
  'product.write',
  'inventory.write',
  'store.approve',
  'delivery.prepare',
  'settlement.create',
  'payment.record',
  'commission.pay',
  'accounting.read',
  'reports.read',
  'announcement.create',
  'user.read',
  'user.manage',
  'settings.read',
  'settings.manage',
  'audit.read',
  // Ronda 3 · fiscal, comisiones, mercados y repartos
  'fiscal.report',
  'commission.configure',
  'market.manage',
  'route.read',
  'route.manage',
  // Ronda 3 · datos reales e importación
  'data.reset',
  'data.export',
  'data.import',
  'product.import',
  // Ronda 3 · escáner, etiquetas, trazabilidad y recepción
  ...R3_ALMACEN_WRITE,
  ...R3_ALMACEN_READ,
]);

/** Lo que cada rol puede hacer sin mirar el recurso. */
const ROLE_ACTIONS: Record<Exclude<Role, 'admin'>, ReadonlySet<Action>> = {
  seller: new Set<Action>([
    'product.read',
    'inventory.read',
    'store.list',
    'store.read',
    'store.create',
    'store.update',
    'contract.read',
    'contract.issue',
    'contract.sign',
    'delivery.read',
    'delivery.request',
    'delivery.receive',
    'visit.create',
    'visit.read',
    'sale.report',
    'return.create',
    'reorder.create',
    'reorder.confirm',
    'reorder.read',
    'settlement.read',
    'commission.read',
    'map.read',
    'message.read',
    'message.send',
    'announcement.read',
    // Ronda 3: el vendedor invita a sus locales (el servicio pide el local como recurso).
    'invitation.read',
    'invitation.create',
  ]),
  store: new Set<Action>([
    'product.read',
    'inventory.read',
    'store.read',
    'contract.read',
    'delivery.read',
    'delivery.receive',
    'visit.read',
    'sale.report',
    'reorder.create',
    'reorder.read',
    'settlement.read',
    'message.read',
    'message.send',
    'announcement.read',
  ]),
  direccion: new Set<Action>(['direccion.read']),
};

/**
 * ¿Puede este actor hacer esta acción sobre este recurso?
 * `line` es la línea de los datos: una cuenta de tabaco nunca toca café, ni al revés.
 */
export function can(actor: Actor, action: Action, line: LineId | null, res?: Resource): boolean {
  if (actor.readOnly && isWrite(action)) return false;

  if (actor.role === 'direccion') return action === 'direccion.read';
  if (action === 'direccion.read') return false;

  // Separación de líneas: la cuenta tiene que ser de la misma línea que los datos.
  if (line !== null && actor.line !== line) return false;

  if (actor.role === 'admin') return true;
  if (ADMIN_ONLY.has(action)) return false;
  if (!ROLE_ACTIONS[actor.role].has(action)) return false;

  if (!res) return true;
  switch (res.type) {
    case 'store':
      if (actor.role === 'seller') return res.store.sellerId === actor.userId;
      return res.store.id === actor.storeId;
    case 'seller':
      return actor.role === 'seller' && res.sellerId === actor.userId;
    case 'thread':
      return res.thread.participantIds.includes(actor.userId);
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'No tienes permiso para hacer esto.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

const ACTION_TEXT: Partial<Record<Action, string>> = {
  'product.readCost': 'ver costos',
  'product.write': 'cambiar el catálogo',
  'inventory.write': 'mover inventario del almacén',
  'store.read': 'ver este local',
  'store.approve': 'aprobar locales',
  'delivery.prepare': 'preparar entregas',
  'settlement.create': 'generar liquidaciones',
  'payment.record': 'registrar pagos',
  'commission.read': 'ver estas comisiones',
  'commission.pay': 'pagar comisiones',
  'accounting.read': 'ver la contabilidad',
  'user.manage': 'dar de alta usuarios',
  'settings.manage': 'cambiar los ajustes',
  'audit.read': 'ver la auditoría',
  // Ronda 3 · fiscal, comisiones, mercados y repartos
  'invitation.read': 'ver estas invitaciones',
  'invitation.create': 'invitar a esta cuenta',
  'fiscal.report': 'ver el reporte para la contadora',
  'commission.configure': 'cambiar la comisión progresiva',
  'market.manage': 'cambiar los mercados',
  'route.read': 'ver los repartos',
  'route.manage': 'armar repartos',
  // Ronda 3 · datos reales e importación
  'data.reset': 'empezar en blanco',
  'data.export': 'exportar los datos de la línea',
  'data.import': 'importar una copia de la línea',
  'product.import': 'importar productos',
  // Ronda 3 · escáner, etiquetas, trazabilidad y recepción
  ...R3_ALMACEN_TEXT,
};

export function ensure(actor: Actor, action: Action, line: LineId | null, res?: Resource): void {
  if (can(actor, action, line, res)) return;
  if (actor.readOnly && isWrite(action)) {
    throw new ForbiddenError('Estás en modo «ver como…»: aquí solo se mira, no se cambia nada.');
  }
  if (line !== null && actor.line !== line && actor.role !== 'direccion') {
    throw new ForbiddenError('Esta cuenta es de la otra línea: las cuentas de Tabaco y de Café no se cruzan.');
  }
  throw new ForbiddenError(`No tienes permiso para ${ACTION_TEXT[action] ?? 'hacer esto'}.`);
}
