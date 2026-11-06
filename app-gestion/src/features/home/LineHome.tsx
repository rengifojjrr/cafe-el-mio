// Inicio de cada rol: el centro de mando de administración (mapa protagonista), el día del
// vendedor (ruta, pendientes y comisiones) y la tienda del local (consignación, lo que debe y pedir).
import {
  AlertTriangle,
  ClipboardCheck,
  ClipboardList,
  Coins,
  FileSignature,
  FileWarning,
  MessageCircle,
  Package,
  Plus,
  Receipt,
  ShoppingBag,
  Store as StoreIcon,
  Truck,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { permitState } from '../../domain/compliance';
import { fmtMoney } from '../../lib/money';
import { fmtAgo, fmtDate, ny } from '../../lib/time';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { balances, inventoryValuation, mapData, pnlByMonth, sellerRoute } from '../../services/analytics';
import { contractsForStore } from '../../services/contracts';
import { confirmReorder, listDeliveries, listReorders } from '../../services/consignment';
import { inventoryAlerts } from '../../services/inventory';
import { openThread } from '../../services/messages';
import { listCommissions, summarizeCommissions } from '../../services/money';
import { listStores, storeConsignment, storeDebt } from '../../services/stores';
import { documentAlerts, syncDocumentAlerts } from '../../services/fiscal';
import { MapView, type MapMarker } from '../../ui/map';
import { Button, Card, EmptyState, LinkButton, Loading, PageHeader, Pill, Section, Sheet, Stat, Tabs } from '../../ui/kit';
import { CommissionProgress } from '../red/commission';
import { useAction } from '../../ui/toast';
import { DeliveryCard, ReportSalesSheet } from '../consignment/components';
import { FirmStoreHome } from '../sales/store-home';
import { QuickActions } from '../sales/quick-actions';
import { StoreStatusPill } from '../common';
import { BackupNotice } from '../data/BackupNotice';

export function LineHome() {
  const { actor } = useLine();
  if (actor.role === 'seller') return <SellerHome />;
  if (actor.role === 'store') return <StoreHome />;
  return <AdminHome />;
}

function today(now: Date): string {
  const s = ny(now).toFormat("cccc d 'de' LLLL");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

// ---------- Administración: centro de mando ----------

function AdminHome() {
  const { ctx, p, config } = useLine();
  const nav = useNavigate();
  const map = useAsync(() => mapData(ctx), [ctx]);
  const pnl = useAsync(() => pnlByMonth(ctx, 2), [ctx]);
  const bal = useAsync(() => balances(ctx), [ctx]);
  const val = useAsync(() => inventoryValuation(ctx), [ctx]);
  const stores = useAsync(() => listStores(ctx), [ctx]);
  const deliveries = useAsync(() => listDeliveries(ctx, { status: 'solicitada' }), [ctx]);
  const orders = useAsync(() => listReorders(ctx, { open: true }), [ctx]);
  const alerts = useAsync(() => inventoryAlerts(ctx), [ctx]);
  const docs = useAsync(() => documentAlerts(ctx), [ctx]);
  // Avisos de documentos por vencer en la campana (una vez por documento y vencimiento).
  useEffect(() => {
    void syncDocumentAlerts(ctx).catch(() => undefined);
  }, [ctx]);
  const [marketPick, setMarketPick] = useState('');
  const markets = map.data?.markets ?? [];
  const market = marketPick || markets[0]?.id || '';
  const month = pnl.data?.[pnl.data.length - 1];
  const markers = useMemo<MapMarker[]>(() => {
    const d = map.data;
    if (!d) return [];
    // Con varios mercados, el mapa muestra uno a la vez (el almacén está en el primero).
    const multi = d.markets.length > 1;
    const inMarket = (id: string) => !multi || id === market;
    return [
      ...(inMarket(d.markets[0]?.id ?? '') ? [{ id: 'almacen', kind: 'warehouse' as const, lat: d.warehouse.lat, lng: d.warehouse.lng, title: `${d.warehouse.name}: ${d.warehouse.units} unidades` }] : []),
      ...d.stores.filter((s) => inMarket(s.marketId)).map((s) => ({
        id: s.store.id,
        kind: 'store' as const,
        lat: s.store.lat,
        lng: s.store.lng,
        status: s.store.status,
        weight: s.sales30 / d.maxSales,
        pulse: s.pendingOrder,
        title: `${s.store.name} · ${s.units} u. en consignación`,
      })),
      ...d.sellers.filter((s) => inMarket(s.marketId)).map((s) => ({ id: `v-${s.id}`, kind: 'seller' as const, lat: s.lat, lng: s.lng, label: initials(s.name), title: `${s.name}, última visita en ${s.storeName}` })),
    ];
  }, [map.data, market]);

  const pendingApproval = (stores.data ?? []).filter((s) => s.store.status === 'firmado');
  const overdue = (stores.data ?? []).filter((s) => s.overdue);
  const todo: { icon: typeof Truck; text: string; to: string; tone: 'warn' | 'danger' | 'info' | 'accent' }[] = [
    ...pendingApproval.map((s) => ({ icon: FileSignature, text: `${s.store.name} firmó: falta aprobarlo`, to: p(`locales/${s.store.id}`), tone: 'accent' as const })),
    ...(deliveries.data ?? []).map((d) => ({ icon: Truck, text: `Preparar ${d.code} para ${d.storeName}`, to: p('entregas'), tone: 'info' as const })),
    ...(orders.data ?? []).filter((o) => o.status === 'enviado').map((o) => ({ icon: ClipboardList, text: `${o.storeName} pidió ${o.code}: espera al vendedor`, to: p('pedidos'), tone: 'warn' as const })),
    ...overdue.map((s) => ({ icon: Receipt, text: `${s.store.name} tiene un pago vencido (${fmtMoney(s.balanceDue + s.invoiceBalance)})`, to: p('cobros'), tone: 'danger' as const })),
    ...(docs.data ?? []).map((d) => ({ icon: FileWarning, text: `${d.storeName}: ${d.text.charAt(0).toLowerCase()}${d.text.slice(1)}`, to: p(`locales/${d.storeId}`), tone: d.state === 'vencido' ? ('danger' as const) : ('warn' as const) })),
    ...(alerts.data ?? []).map((a) => ({ icon: AlertTriangle, text: `${a.productName}: ${a.detail}`, to: a.storeId ? p(`locales/${a.storeId}`) : p(`catalogo/${a.productId}`), tone: 'warn' as const })),
  ];

  return (
    <>
      <PageHeader title="Centro de mando" subtitle={`${today(ctx.now())} · ${config.name}: locales, vendedores y almacén en el mapa.`} />
      <BackupNotice className="mb-4" firstSteps />
      <QuickActions />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="relative">
          {markets.length > 1 ? (
            <div className="mb-2">
              <Tabs label="Mercado del mapa" value={market} onChange={setMarketPick} options={markets.map((m) => ({ value: m.id, label: m.name, count: (map.data?.stores ?? []).filter((s) => s.marketId === m.id).length }))} />
            </div>
          ) : null}
          <MapView
            label="Mapa de locales, vendedores y almacén"
            className="h-[56vh] min-h-[340px] lg:h-[62vh]"
            markers={markers}
            fitKey={`admin-${market}`}
            onMarkerClick={(id) => {
              if (id !== 'almacen' && !id.startsWith('v-')) nav(p(`locales/${id}`));
            }}
          />
          <div className="pointer-events-none absolute top-3 right-3 z-[500] hidden sm:block">
            <div className="glass pointer-events-auto grid gap-1 p-3 text-xs">
              {[
                ['var(--estado-activo)', 'Activo'],
                ['var(--estado-firmado)', 'Firmado, por aprobar'],
                ['var(--estado-contrato)', 'Contrato por firmar'],
                ['var(--estado-prospecto)', 'Prospecto'],
                ['var(--estado-pausado)', 'Pausado'],
              ].map(([c, l]) => (
                <span key={l} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} aria-hidden />
                  {l}
                </span>
              ))}
              <span className="mt-1 text-muted">Late: pedido pendiente · tamaño: ventas</span>
            </div>
          </div>
        </div>
        <div className="grid content-start gap-3">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
            <Stat label="Ventas del mes" value={month?.revenue ?? 0} format="money0" hint="Al precio al local" to={p('contabilidad')} />
            <Stat label="Margen bruto del mes" value={month?.grossMargin ?? 0} format="money0" hint={month && month.revenue ? `${Math.round((month.grossMargin / month.revenue) * 100)} % de las ventas` : undefined} to={p('contabilidad')} />
            <Stat label="Por cobrar" value={bal.data?.receivable ?? 0} format="money0" tone={bal.data && bal.data.aging['30+'].amount > 0 ? 'warn' : 'data'} hint={bal.data ? `${fmtMoney(bal.data.aging['30+'].amount)} con más de 30 días` : undefined} to={p('cobros')} />
            <Stat label="Comisiones por pagar" value={bal.data?.payableReady ?? 0} format="money0" hint="Ya cobradas a los locales" to={p('comisiones')} />
            <Stat label="Inventario al costo" value={(val.data?.warehouseCost ?? 0) + (val.data?.consignmentCost ?? 0)} format="money0" hint={val.data ? `${fmtMoney(val.data.consignmentCost)} en locales` : undefined} />
            <Stat label="Locales activos" value={(stores.data ?? []).filter((s) => s.store.status === 'activo').length} hint={`de ${stores.data?.length ?? 0}`} to={p('locales')} />
          </div>
        </div>
      </div>
      <Section title="Por hacer">
        {todo.length === 0 ? (
          <p className="text-muted">Nada pendiente. Todo al día.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {todo.slice(0, 12).map((t, i) => (
              <li key={i}>
                <Link to={t.to} className="glass flex min-h-14 items-center gap-3 px-4 py-3 hover:border-line-strong">
                  <span className={`grid h-9 w-9 flex-none place-items-center rounded-xl ${t.tone === 'danger' ? 'bg-danger-soft text-danger' : t.tone === 'warn' ? 'bg-warn-soft text-warn' : t.tone === 'info' ? 'bg-info-soft text-info' : 'bg-accent-soft text-accent'}`}>
                    <t.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-sm font-medium text-ink">{t.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

// ---------- Vendedor: el día ----------

function SellerHome() {
  const { ctx, actor, p, line } = useLine();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const route = useAsync(() => sellerRoute(ctx), [ctx]);
  const stores = useAsync(() => listStores(ctx), [ctx]);
  const orders = useAsync(() => listReorders(ctx, { open: true }), [ctx]);
  const ready = useAsync(() => listDeliveries(ctx, { status: 'preparada' }), [ctx]);
  const comm = useAsync(async () => summarizeCommissions(await listCommissions(ctx)), [ctx]);
  const alerts = useAsync(() => inventoryAlerts(ctx), [ctx]);
  // Certificados de reventa por vencer o vencidos en sus locales (el permiso ya sale abajo).
  const certs = useAsync(async () => (await documentAlerts(ctx)).filter((d) => d.kind === 'reventa'), [ctx]);
  const warehouse = useAsync(() => mapData(ctx), [ctx]);
  const [pick, setPick] = useState<'visita' | 'pedido' | null>(null);
  const now = ctx.now();
  const first = actor.name.split(' ')[0];
  const toConfirm = (orders.data ?? []).filter((o) => o.status === 'enviado');
  const toSign = (stores.data ?? []).filter((s) => s.store.status === 'contrato_enviado');
  const permits = line === 'tabaco' ? (stores.data ?? []).filter((s) => s.store.status === 'activo' && (s.permit === 'vencido' || s.permit === 'vence_pronto')) : [];
  const routeMarkers: MapMarker[] = (route.data ?? []).map((r, i) => ({
    id: r.store.id,
    kind: 'store',
    lat: r.store.lat,
    lng: r.store.lng,
    status: r.store.status,
    weight: 0.55,
    label: String(i + 1),
    title: `${i + 1}. ${r.store.name}: ${r.reason}`,
  }));
  const wh = warehouse.data?.warehouse;
  const routeLine: [number, number][] = wh ? [[wh.lat, wh.lng], ...(route.data ?? []).map((r) => [r.store.lat, r.store.lng] as [number, number])] : [];

  return (
    <>
      <PageHeader title={`Hola, ${first}`} subtitle={today(now)} />
      <div className="grid gap-2 sm:grid-cols-3">
        <LinkButton to={p('locales/nuevo')} variant="primary" big icon={Plus} className="w-full" aria-label="Registrar tienda">
          Registrar tienda
        </LinkButton>
        <Button big icon={ClipboardCheck} className="w-full" onClick={() => setPick('visita')} disabled={actor.readOnly}>
          Registrar visita
        </Button>
        <Button big icon={Package} className="w-full" onClick={() => setPick('pedido')} disabled={actor.readOnly}>
          Pedir producto
        </Button>
      </div>

      {toConfirm.length || (ready.data ?? []).length || toSign.length ? (
        <Section title="Pendientes">
          <div className="grid gap-3 lg:grid-cols-2">
            {toConfirm.map((o) => (
              <Card key={o.id} className="p-4">
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  <ClipboardList className="h-5 w-5 text-warn" aria-hidden /> {o.storeName} pidió más
                </p>
                <p className="mt-1 text-sm text-muted">
                  {o.code} · {fmtAgo(o.createdAt, now)} · {o.itemsView.map((i) => `${i.name} × ${i.qty}`).join(', ')}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" busy={busy} onClick={() => void run(() => confirmReorder(ctx, o.id), `${o.code} confirmado: pasa al almacén.`)} disabled={actor.readOnly}>
                    Confirmar pedido
                  </Button>
                  <LinkButton to={p('pedidos')} variant="ghost">
                    Ver pedidos
                  </LinkButton>
                </div>
              </Card>
            ))}
            {toSign.map((s) => (
              <Card key={s.store.id} className="p-4">
                <p className="flex items-center gap-2 font-bold">
                  <FileSignature className="h-5 w-5 text-accent" aria-hidden /> Contrato por firmar
                </p>
                <p className="mt-1 text-sm text-muted">{s.store.name} · {s.store.managerName}</p>
                <div className="mt-3">
                  <ContractLink storeId={s.store.id} />
                </div>
              </Card>
            ))}
            {(ready.data ?? []).map((d) => (
              <DeliveryCard key={d.id} d={d} showStore />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Tu ruta de hoy" actions={<LinkButton to={p('mapa')} variant="ghost">Ver mapa grande</LinkButton>}>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
          <MapView label="Mapa con la ruta del día" className="h-72 lg:h-[380px]" markers={[...(wh ? [{ id: 'almacen', kind: 'warehouse' as const, lat: wh.lat, lng: wh.lng, title: wh.name }] : []), ...routeMarkers]} route={routeLine} fitKey="ruta" onMarkerClick={(id) => id !== 'almacen' && nav(p(`locales/${id}`))} />
          {route.loading && !route.data ? <Loading rows={3} /> : null}
          <ol className="grid content-start gap-2">
            {(route.data ?? []).map((r, i) => (
              <li key={r.store.id}>
                <Link to={p(`locales/${r.store.id}`)} className="glass flex items-center gap-3 p-3 hover:border-line-strong">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-accent text-sm font-bold text-accent-ink tabular">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{r.store.name}</span>
                    <span className="block truncate text-sm text-muted">{r.reason}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <Section title="Tus comisiones" actions={<LinkButton to={p('comisiones')} variant="ghost">Ver detalle</LinkButton>}>
        <CommissionProgress />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Por cobrar" value={comm.data?.totals.pagable ?? 0} format="money" icon={Coins} hint="Los locales ya pagaron" />
          <Stat label="Devengadas" value={comm.data?.totals.devengada ?? 0} format="money" hint="Se cobran cuando el local paga" />
          <Stat label="Pagadas" value={comm.data?.totals.pagada ?? 0} format="money" tone="ink" />
        </div>
      </Section>

      {(alerts.data ?? []).length || permits.length || (certs.data ?? []).length ? (
        <Section title="Atención">
          <ul className="grid gap-2">
            {(alerts.data ?? []).map((a, i) => (
              <li key={i}>
                <Link to={a.storeId ? p(`locales/${a.storeId}`) : p(`catalogo/${a.productId}`)} className="glass flex items-start gap-3 p-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-warn" aria-hidden />
                  <span className="text-sm">
                    <b>{a.productName}</b> · {a.detail}
                  </span>
                </Link>
              </li>
            ))}
            {permits.map((s) => (
              <li key={s.store.id}>
                <Link to={p(`locales/${s.store.id}`)} className="glass flex items-start gap-3 p-3">
                  <AlertTriangle className={`mt-0.5 h-5 w-5 flex-none ${s.permit === 'vencido' ? 'text-danger' : 'text-warn'}`} aria-hidden />
                  <span className="text-sm">
                    <b>{s.store.name}</b> · {s.permit === 'vencido' ? 'permiso de tabaco vencido: no se le puede consignar' : `permiso de tabaco vence el ${fmtDate(s.store.tobaccoPermit!.expiresOn)}`}
                  </span>
                </Link>
              </li>
            ))}
            {(certs.data ?? []).map((d) => (
              <li key={`cert-${d.storeId}`}>
                <Link to={p(`locales/${d.storeId}`)} className="glass flex items-start gap-3 p-3">
                  <AlertTriangle className={`mt-0.5 h-5 w-5 flex-none ${d.state === 'vencido' ? 'text-danger' : 'text-warn'}`} aria-hidden />
                  <span className="text-sm">
                    <b>{d.storeName}</b> · {d.state === 'vencido' ? 'certificado de reventa vencido: pide el nuevo' : `certificado de reventa vence el ${fmtDate(d.expiresOn!)}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Sheet open={pick !== null} onClose={() => setPick(null)} title={pick === 'visita' ? '¿Qué local visitas?' : '¿Para qué local?'}>
        <ul className="grid gap-2">
          {(stores.data ?? [])
            .filter((s) => (pick === 'visita' ? s.store.status === 'activo' : s.store.status === 'activo' || s.store.status === 'firmado'))
            .map((s) => {
              const blocked = pick === 'pedido' && line === 'tabaco' && permitState(s.store, now) === 'vencido';
              return (
                <li key={s.store.id}>
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-4 text-left hover:border-accent disabled:opacity-50"
                    disabled={blocked}
                    onClick={() => {
                      setPick(null);
                      nav(pick === 'visita' ? p(`locales/${s.store.id}/visita`) : p(`locales/${s.store.id}`));
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{s.store.name}</span>
                      <span className="block truncate text-sm text-muted">{blocked ? 'Permiso vencido: no se puede consignar' : s.lastVisitAt ? `Visita ${fmtAgo(s.lastVisitAt, now)}` : 'Sin visitas'}</span>
                    </span>
                    <StoreStatusPill status={s.store.status} />
                  </button>
                </li>
              );
            })}
        </ul>
      </Sheet>
    </>
  );
}

function ContractLink({ storeId }: { storeId: string }) {
  const { ctx, p } = useLine();
  const c = useAsync(() => contractsForStore(ctx, storeId), [ctx, storeId]);
  const open = c.data?.find((x) => x.status === 'enviado');
  if (!open) return null;
  return (
    <LinkButton to={p(`contratos/${open.id}`)} variant="primary" icon={FileSignature}>
      Firmar ahora
    </LinkButton>
  );
}

// ---------- Local: mi tienda ----------

function StoreHome() {
  const { ctx, actor, p } = useLine();
  const nav = useNavigate();
  const { run } = useAction();
  const storeId = actor.storeId ?? '';
  const stores = useAsync(() => listStores(ctx), [ctx]);
  const lines = useAsync(() => storeConsignment(ctx, storeId), [ctx, storeId]);
  const debt = useAsync(() => storeDebt(ctx, storeId), [ctx, storeId]);
  const orders = useAsync(() => listReorders(ctx, { storeId, open: true }), [ctx, storeId]);
  const ready = useAsync(() => listDeliveries(ctx, { storeId, status: 'preparada' }), [ctx, storeId]);
  const contracts = useAsync(() => contractsForStore(ctx, storeId), [ctx, storeId]);
  const [sales, setSales] = useState(false);
  const view = stores.data?.[0];
  if (!view) return stores.loading ? <Loading rows={4} /> : <EmptyState icon={StoreIcon} title="No encontré tu tienda" />;
  // Ronda 3: el local que compra en firme ve sus facturas, no la consignación.
  if (view.store.saleMode === 'firme') return <FirmStoreHome view={view} />;
  const s = view.store;
  const units = (lines.data ?? []).reduce((a, l) => a + l.qty, 0);
  const potential = (lines.data ?? []).reduce((a, l) => a + l.qty * l.storeEarning, 0);
  // Lo que debe es todo lo vendido: lo liquidado sin pagar y lo que todavía no se liquidó.
  const owed = debt.data?.total ?? 0;
  const nextDue = debt.data?.nextDueOn;
  const overdue = (debt.data?.overdue ?? 0) > 0;
  const owedHint = overdue
    ? `${fmtMoney(debt.data!.overdue)} vencidos`
    : nextDue
      ? `Vence el ${fmtDate(nextDue)}`
      : debt.data?.nextSettlementOn
        ? `Se liquida el ${fmtDate(debt.data.nextSettlementOn)}`
        : 'Al día';
  const contract = contracts.data?.find((c) => c.status === 'firmado');

  const writeSeller = () =>
    void run(async () => {
      const t = await openThread(ctx, { kind: 'seller' });
      nav(p(`mensajes/${t.id}`));
    });

  return (
    <>
      <PageHeader title={s.name} subtitle={`Hola, ${actor.name.split(' ')[0]}. Tu vendedor es ${view.sellerName}.`} />
      <div className="grid gap-2 sm:grid-cols-3">
        <LinkButton to={p('pedir')} variant="primary" big icon={ShoppingBag} className="w-full">
          Pedir más producto
        </LinkButton>
        <Button big icon={ClipboardCheck} className="w-full" onClick={() => setSales(true)} disabled={actor.readOnly || units === 0}>
          Reportar ventas
        </Button>
        <Button big icon={MessageCircle} className="w-full" onClick={writeSeller} disabled={actor.readOnly}>
          Escribir a mi vendedor
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="En consignación" value={units} hint="Es de la empresa hasta que lo vendas" icon={Package} />
        <Stat label="Ganarías si lo vendes todo" value={potential} format="money" hint="Al PVP sugerido" icon={Wallet} />
        <Stat label="Lo que debes" value={owed} format="money" tone={overdue ? 'danger' : owed > 0 ? 'warn' : 'ok'} hint={owedHint} to={p('cuentas')} />
        <Stat label="Pedidos en curso" value={orders.data?.length ?? 0} icon={ClipboardList} to={p('pedidos')} />
      </div>

      {(ready.data ?? []).length ? (
        <Section title="Para recibir">
          <div className="grid gap-3 lg:grid-cols-2">
            {(ready.data ?? []).map((d) => (
              <DeliveryCard key={d.id} d={d} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Lo que tienes y lo que ganas por cada uno">
        {lines.data && lines.data.length === 0 ? (
          <EmptyState icon={Package} title="Todavía no tienes producto en consignación" action={<LinkButton to={p('pedir')} variant="primary" icon={ShoppingBag}>Pedir producto</LinkButton>} />
        ) : null}
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {(lines.data ?? []).map((l) => (
            <li key={l.productId} className="glass flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-semibold">{l.name}</p>
                <p className="text-sm text-muted">
                  Pagas {fmtMoney(l.priceToStore)} · PVP {fmtMoney(l.suggestedRetail)}
                </p>
                {l.expiringQty > 0 && l.nextExpiry ? (
                  <p className="mt-1">
                    <Pill tone="warn">{l.expiringQty} vencen el {fmtDate(l.nextExpiry)}</Pill>
                  </p>
                ) : null}
              </div>
              <div className="text-right">
                <p className="text-lg font-bold tabular">{l.qty} u.</p>
                <p className="text-sm font-semibold text-ok tabular">Ganas {fmtMoney(l.storeEarning)} c/u</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {(orders.data ?? []).length ? (
        <Section title="Tus pedidos" actions={<LinkButton to={p('pedidos')} variant="ghost">Ver todos</LinkButton>}>
          <ul className="grid gap-2">
            {(orders.data ?? []).map((o) => (
              <li key={o.id} className="glass flex flex-wrap items-center justify-between gap-2 p-3">
                <span>
                  <b>{o.code}</b> · {o.itemsView.map((i) => `${i.name} × ${i.qty}`).join(', ')}
                </span>
                <Pill tone={o.status === 'enviado' ? 'warn' : 'accent'}>{o.status === 'enviado' ? 'Esperando a tu vendedor' : o.status === 'confirmado' ? 'Confirmado · preparando' : 'Listo para entregar'}</Pill>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Tu contrato">
        {contract ? (
          <Link to={p(`contratos/${contract.id}`)} className="glass flex items-center gap-3 p-4 hover:border-line-strong">
            <FileSignature className="h-6 w-6 text-accent" aria-hidden />
            <span>
              <span className="block font-semibold">Contrato de consignación v{contract.version}</span>
              <span className="block text-sm text-muted">Firmado el {fmtDate(contract.signedAt!)} · liquidación cada {contract.settlementDays} días</span>
            </span>
          </Link>
        ) : (
          <p className="text-muted">Tu contrato todavía no está firmado.</p>
        )}
      </Section>
      <ReportSalesSheet open={sales} onClose={() => setSales(false)} store={s} lines={lines.data ?? []} />
    </>
  );
}
