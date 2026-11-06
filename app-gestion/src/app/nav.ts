import {
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  ClipboardList,
  Coins,
  FileSignature,
  Home,
  Map,
  MessageCircle,
  Package,
  Receipt,
  Route,
  ScrollText,
  Settings,
  ShoppingBag,
  Store,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '../data/types';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Va en la barra de abajo del teléfono. */
  bottom?: boolean;
  /** Etiqueta corta para la barra de abajo. */
  short?: string;
}

/** El menú de cada rol. Lo que no está aquí, el rol no lo ve (y el servicio tampoco lo deja). */
export const NAV: Record<Exclude<Role, 'direccion'>, NavItem[]> = {
  admin: [
    { path: '', label: 'Centro de mando', short: 'Inicio', icon: Home, bottom: true },
    { path: 'catalogo', label: 'Catálogo', icon: BookOpen },
    { path: 'almacen', label: 'Almacén', icon: Boxes },
    { path: 'locales', label: 'Locales', icon: Store, bottom: true },
    { path: 'entregas', label: 'Entregas', icon: Truck, bottom: true },
    { path: 'repartos', label: 'Repartos', icon: Route },
    { path: 'pedidos', label: 'Pedidos', icon: ClipboardList },
    { path: 'contratos', label: 'Contratos', icon: FileSignature },
    { path: 'cobros', label: 'Cobros', icon: Receipt, bottom: true },
    { path: 'comisiones', label: 'Comisiones', icon: Coins },
    { path: 'contabilidad', label: 'Contabilidad', icon: Wallet },
    { path: 'mapa', label: 'Mapa', icon: Map },
    { path: 'reportes', label: 'Rentabilidad', icon: BarChart3 },
    { path: 'mensajes', label: 'Mensajes', icon: MessageCircle },
    { path: 'usuarios', label: 'Usuarios', icon: Users },
    { path: 'ajustes', label: 'Ajustes', icon: Settings },
    { path: 'auditoria', label: 'Auditoría', icon: ScrollText },
  ],
  seller: [
    { path: '', label: 'Hoy', icon: Home, bottom: true },
    { path: 'locales', label: 'Mis locales', short: 'Locales', icon: Store, bottom: true },
    { path: 'catalogo', label: 'Catálogo', icon: BookOpen, bottom: true },
    { path: 'comisiones', label: 'Comisiones', icon: Coins, bottom: true },
    { path: 'pedidos', label: 'Pedidos', icon: ClipboardList },
    { path: 'entregas', label: 'Entregas', icon: Truck },
    { path: 'contratos', label: 'Contratos', icon: FileSignature },
    { path: 'mapa', label: 'Mi ruta', icon: Map },
    { path: 'mensajes', label: 'Mensajes', icon: MessageCircle },
    { path: 'avisos', label: 'Avisos', icon: Bell },
  ],
  store: [
    { path: '', label: 'Mi tienda', icon: Home, bottom: true },
    { path: 'pedir', label: 'Pedir', icon: ShoppingBag, bottom: true },
    { path: 'cuentas', label: 'Cuentas', icon: Receipt, bottom: true },
    { path: 'mensajes', label: 'Mensajes', icon: MessageCircle, bottom: true },
    { path: 'catalogo', label: 'Catálogo', icon: Package },
    { path: 'pedidos', label: 'Mis pedidos', icon: ClipboardList },
    { path: 'contratos', label: 'Mis contratos', icon: FileSignature },
    { path: 'avisos', label: 'Avisos', icon: Bell },
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administración',
  seller: 'Vendedor',
  store: 'Local',
  direccion: 'Dirección',
};
