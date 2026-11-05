import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createHashRouter, RouterProvider, useRouteError } from 'react-router';
import { Portada } from '../features/home/Portada';
import { Loading } from '../ui/kit';
import { ToastProvider } from '../ui/toast';
import { RootLayout } from './RootLayout';

function page<T extends Record<string, ComponentType>>(loader: () => Promise<T>, name: keyof T): ReactNode {
  const C = lazy(() => loader().then((m) => ({ default: m[name] as ComponentType })));
  return (
    <Suspense fallback={<Loading rows={3} />}>
      <C />
    </Suspense>
  );
}

const home = () => import('../features/home/LineHome');
const catalog = () => import('../features/catalog/pages');
const warehouse = () => import('../features/warehouse/WarehousePage');
const stores = () => import('../features/stores/pages');
const contracts = () => import('../features/contracts/pages');
const contractsHub = () => import('../features/contracts/hub');
const consignment = () => import('../features/consignment/pages');
const money = () => import('../features/money/pages');
const insight = () => import('../features/insight/pages');
const comms = () => import('../features/comms/pages');
const admin = () => import('../features/admin/pages');
const direccion = () => import('../features/direccion/DireccionPage');
const LineLayoutLazy = lazy(() => import('./LineLayout').then((m) => ({ default: m.LineLayout })));

function RouteError() {
  const err = useRouteError() as Error | undefined;
  return (
    <div className="mx-auto max-w-lg p-6">
      <div className="glass p-6" role="alert">
        <h1 className="font-display text-2xl font-semibold">Algo salió mal</h1>
        <p className="mt-2 text-muted">{err?.message ?? 'Error desconocido.'}</p>
        <a className="btn btn-primary mt-4" href="#/">
          Volver a la portada
        </a>
      </div>
    </div>
  );
}

const router = createHashRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Portada /> },
      { path: '/direccion', element: page(direccion, 'DireccionPage') },
      {
        path: '/:line',
        element: (
          <Suspense fallback={<div className="mx-auto max-w-5xl p-6"><Loading rows={4} /></div>}>
            <LineLayoutLazy />
          </Suspense>
        ),
        errorElement: <RouteError />,
        children: [
          { index: true, element: page(home, 'LineHome') },
          { path: 'catalogo', element: page(catalog, 'CatalogPage') },
          { path: 'catalogo/nuevo', element: page(catalog, 'ProductFormPage') },
          { path: 'catalogo/:id', element: page(catalog, 'ProductDetailPage') },
          { path: 'catalogo/:id/editar', element: page(catalog, 'ProductFormPage') },
          { path: 'almacen', element: page(warehouse, 'WarehousePage') },
          { path: 'locales', element: page(stores, 'StoresPage') },
          { path: 'locales/nuevo', element: page(stores, 'StoreFormPage') },
          { path: 'locales/:id', element: page(stores, 'StoreDetailPage') },
          { path: 'locales/:id/editar', element: page(stores, 'StoreFormPage') },
          { path: 'locales/:id/visita', element: page(consignment, 'VisitPage') },
          { path: 'contratos', element: page(contractsHub, 'ContractsHubPage') },
          { path: 'contratos/:id', element: page(contracts, 'ContractPage') },
          { path: 'contratos/:id/imprimir', element: page(contracts, 'ContractPrintPage') },
          { path: 'entregas', element: page(consignment, 'DeliveriesPage') },
          { path: 'entregas/:id/imprimir', element: page(consignment, 'DeliveryNotePrintPage') },
          { path: 'pedidos', element: page(consignment, 'OrdersPage') },
          { path: 'pedir', element: page(consignment, 'StoreOrderPage') },
          { path: 'cobros', element: page(money, 'CollectionsPage') },
          { path: 'cuentas', element: page(money, 'StoreAccountsPage') },
          { path: 'comisiones', element: page(money, 'CommissionsPage') },
          { path: 'contabilidad', element: page(money, 'AccountingPage') },
          { path: 'mapa', element: page(insight, 'MapPage') },
          { path: 'reportes', element: page(insight, 'ReportsPage') },
          { path: 'mensajes', element: page(comms, 'MessagesPage') },
          { path: 'mensajes/:id', element: page(comms, 'ThreadPage') },
          { path: 'avisos', element: page(comms, 'NotificationsPage') },
          { path: 'usuarios', element: page(admin, 'UsersPage') },
          { path: 'ajustes', element: page(admin, 'SettingsPage') },
          { path: 'auditoria', element: page(admin, 'AuditPage') },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  );
}
