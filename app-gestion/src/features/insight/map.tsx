// Mapa «centro de mando» (administración) y «Mi ruta» (vendedor).
import { CalendarCheck, ClipboardList, Lock, Navigation, Route, Store as StoreIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { StoreStatus } from '../../data/types';
import { fmtNumber } from '../../lib/money';
import { fmtAgo } from '../../lib/time';
import { mapData, sellerRoute, type MapData, type MapStore } from '../../services/analytics';
import { listProducts } from '../../services/catalog';
import { STORE_STATUS_LABEL } from '../../services/stores';
import { useAsync, useMediaQuery, useBackState } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { Card, EmptyState, ErrorBox, KeyValue, LinkButton, Loading, Money, PageHeader, Pill, SelectInput, Sheet, Stat } from '../../ui/kit';
import { MapView, directionsUrl, type MapMarker } from '../../ui/map';
import { MarketSelect } from '../red/markets';

const STATUS_VAR: Record<StoreStatus, string> = {
  prospecto: 'var(--estado-prospecto)',
  contrato_enviado: 'var(--estado-contrato)',
  firmado: 'var(--estado-firmado)',
  activo: 'var(--estado-activo)',
  pausado: 'var(--estado-pausado)',
  cerrado: 'var(--estado-cerrado)',
};

const STATUS_ORDER: StoreStatus[] = ['activo', 'firmado', 'contrato_enviado', 'prospecto', 'pausado', 'cerrado'];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function MapPage() {
  const { actor } = useLine();
  if (actor.role === 'store') {
    return (
      <EmptyState icon={Lock} title="El mapa es del equipo de ventas">
        Tu vendedor usa el mapa para planear su ruta. Si necesitas producto, toca «Pedir».
      </EmptyState>
    );
  }
  if (actor.role === 'seller') return <SellerRoute />;
  return <CommandMap />;
}

export function StatusLegend({ statuses }: { statuses?: StoreStatus[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted" aria-label="Colores de los estados">
      {(statuses ?? STATUS_ORDER).map((st) => (
        <li key={st} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: STATUS_VAR[st] }} aria-hidden />
          {STORE_STATUS_LABEL[st]}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-accent" aria-hidden />
        Late: pedido pendiente
      </li>
    </ul>
  );
}

function CommandMap() {
  const { ctx, config } = useLine();
  const data = useAsync(() => mapData(ctx), [ctx]);
  const products = useAsync(() => listProducts(ctx), [ctx]);
  const [seller, setSeller] = useBackState(`mapa-vendedor:${ctx.actor.accountId}:${ctx.line}`, '');
  const [product, setProduct] = useBackState(`mapa-producto:${ctx.actor.accountId}:${ctx.line}`, '');
  const [status, setStatus] = useBackState<'' | StoreStatus>(`mapa-estado:${ctx.actor.accountId}:${ctx.line}`, '');
  const [selected, setSelected] = useState<string | null>(null);
  // Mercado: el primero (Miami) al abrir; cambiarlo vuelve a centrar el mapa. '*' es «Todos».
  const [marketPick, setMarketPick] = useState<string | null>(null);
  const wide = useMediaQuery('(min-width: 1024px)');

  const d = data.data;
  const markets = d?.markets ?? [];
  const market = marketPick === null ? (markets.length > 1 ? (markets[0]?.id ?? '') : '') : marketPick === '*' ? '' : marketPick;
  const sellers = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of d?.stores ?? []) m.set(s.store.sellerId, s.sellerName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [d]);
  const visible = useMemo(
    () =>
      (d?.stores ?? []).filter(
        (s) => (!market || s.marketId === market) && (!seller || s.store.sellerId === seller) && (!product || s.productIds.includes(product)) && (!status || s.store.status === status),
      ),
    [d, market, seller, product, status],
  );
  const markers = useMemo<MapMarker[]>(() => {
    if (!d) return [];
    const out: MapMarker[] = visible.map((s) => ({
      id: s.store.id,
      kind: 'store',
      lat: s.store.lat,
      lng: s.store.lng,
      title: `${s.store.name} · ${STORE_STATUS_LABEL[s.store.status]}`,
      status: s.store.status,
      weight: d.maxSales > 0 ? s.sales30 / d.maxSales : 0,
      pulse: s.pendingOrder,
      selected: s.store.id === selected,
    }));
    for (const sl of d.sellers) {
      if (seller && sl.id !== seller) continue;
      if (market && sl.marketId !== market) continue;
      out.push({ id: `seller:${sl.id}`, kind: 'seller', lat: sl.lat, lng: sl.lng, title: `${sl.name}: última visita en ${sl.storeName}`, label: initials(sl.name) });
    }
    // El almacén está en el primer mercado.
    if (!market || market === d.markets[0]?.id) {
      out.push({ id: 'warehouse', kind: 'warehouse', lat: d.warehouse.lat, lng: d.warehouse.lng, title: `${d.warehouse.name}: ${fmtNumber(d.warehouse.units)} unidades` });
    }
    return out;
  }, [d, visible, selected, seller, market]);

  if (data.error) return <ErrorBox error={data.error} />;
  const current = d?.stores.find((s) => s.store.id === selected) ?? null;
  const pending = visible.filter((s) => s.pendingOrder);
  const sales = visible.reduce((a, s) => a + s.sales30, 0);

  const card = current ? <StoreCard s={current} /> : null;

  return (
    <>
      <PageHeader title="Mapa" subtitle={`Locales de ${config.name} por estado y por ventas, vendedores en su última visita y el almacén. Toca un local para ver su tarjeta.`} />
      <div className={`mb-4 grid gap-2 sm:gap-3 ${markets.length > 1 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
        <MarketSelect
          markets={markets}
          value={marketPick === null ? market : marketPick === '*' ? '' : marketPick}
          onChange={(id) => {
            setMarketPick(id || '*');
            setSelected(null);
          }}
        />
        <SelectInput
          label="Vendedor"
          value={seller}
          onChange={(e) => setSeller(e.target.value)}
          options={[{ value: '', label: 'Todos' }, ...sellers.map(([id, name]) => ({ value: id, label: name }))]}
        />
        <SelectInput
          label="Producto"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          options={[{ value: '', label: 'Todos' }, ...(products.data ?? []).map((v) => ({ value: v.product.id, label: v.product.name }))]}
        />
        <SelectInput
          label="Estado"
          value={status}
          onChange={(e) => setStatus(e.target.value as '' | StoreStatus)}
          options={[{ value: '', label: 'Todos' }, ...STATUS_ORDER.map((st) => ({ value: st, label: STORE_STATUS_LABEL[st] }))]}
        />
      </div>

      {data.loading && !d ? (
        <Loading rows={3} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-3">
            <MapView
              markers={markers}
              onMarkerClick={(id) => {
                if (id === 'warehouse') return;
                // El vendedor aparece encima del local de su última visita: tocarlo abre ese local.
                if (id.startsWith('seller:')) {
                  const sl = d?.sellers.find((x) => `seller:${x.id}` === id);
                  if (sl) setSelected(sl.storeId);
                  return;
                }
                setSelected(id);
              }}
              className="h-[55vh] bg-surface-2! lg:h-[68vh]"
              fitKey={`${market}|${seller}|${product}|${status}`}
              label={`Mapa de locales de ${config.name}`}
            />
            <StatusLegend />
          </div>
          {wide ? (
            <aside className="grid content-start gap-3" aria-label="Detalle del mapa">
              {card ?? <MapSummary data={d} visible={visible} pending={pending} sales={sales} onPick={setSelected} />}
            </aside>
          ) : (
            <MapSummary data={d} visible={visible} pending={pending} sales={sales} onPick={setSelected} />
          )}
        </div>
      )}

      {!wide ? (
        <Sheet open={Boolean(current)} onClose={() => setSelected(null)} title={current?.store.name ?? 'Local'}>
          {card}
        </Sheet>
      ) : null}
    </>
  );
}

function MapSummary({ data, visible, pending, sales, onPick }: { data?: MapData; visible: MapStore[]; pending: MapStore[]; sales: number; onPick: (id: string) => void }) {
  if (!data) return null;
  return (
    <div className="grid content-start gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Locales en el mapa" value={visible.length} icon={StoreIcon} />
        <Stat label="Ventas 30 días" value={sales} format="money0" />
      </div>
      <Card className="p-4">
        <h2 className="flex items-center gap-2 font-bold">
          <ClipboardList className="h-5 w-5 text-accent" aria-hidden /> Con pedido pendiente
        </h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Ningún local con pedido o entrega pendiente.</p>
        ) : (
          <ul className="mt-2 grid gap-1">
            {pending.map((s) => (
              <li key={s.store.id}>
                <button type="button" className="flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-2 text-left hover:bg-accent-soft" onClick={() => onPick(s.store.id)}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{s.store.name}</span>
                    <span className="block truncate text-sm text-muted">{s.sellerName}</span>
                  </span>
                  <Pill tone="accent">Ver</Pill>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="font-bold">{data.warehouse.name}</h2>
        <p className="text-sm text-muted">{fmtNumber(data.warehouse.units)} unidades en el almacén</p>
      </Card>
    </div>
  );
}

function StoreCard({ s }: { s: MapStore }) {
  const { p, ctx } = useLine();
  const now = ctx.now();
  return (
    <Card className="p-4" aria-label={`Tarjeta de ${s.store.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">{s.store.name}</h2>
        <span className="inline-flex items-center gap-1.5 text-sm text-muted">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STATUS_VAR[s.store.status] }} aria-hidden />
          {STORE_STATUS_LABEL[s.store.status]}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-muted">
        {s.store.type} · {s.store.city} · {s.sellerName}
      </p>
      {s.pendingOrder ? (
        <p className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">Tiene un pedido o una entrega pendiente.</p>
      ) : null}
      <div className="mt-3">
        <KeyValue
          items={[
            ['En consignación', `${fmtNumber(s.units)} unidades`],
            ['Ventas 30 días', <Money key="v" value={s.sales30} />],
            ['Saldo por cobrar', s.balanceDue > 0 ? <Money key="b" value={s.balanceDue} /> : 'Al día'],
            ['Última visita', s.lastVisitAt ? fmtAgo(s.lastVisitAt, now) : 'Sin visitas'],
          ]}
        />
      </div>
      <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
        <a className="btn btn-secondary whitespace-nowrap" href={directionsUrl(s.store.lat, s.store.lng)} target="_blank" rel="noopener noreferrer">
          <Navigation aria-hidden /> Cómo llegar
        </a>
        <LinkButton to={p(`locales/${s.store.id}`)} variant="primary" icon={StoreIcon}>
          Ver local
        </LinkButton>
      </div>
    </Card>
  );
}

function SellerRoute() {
  const { ctx, p } = useLine();
  const route = useAsync(() => sellerRoute(ctx), [ctx]);
  const data = useAsync(() => mapData(ctx), [ctx]);
  if (route.error) return <ErrorBox error={route.error} />;
  const stops = route.data ?? [];
  const wh = data.data?.warehouse;
  const markers: MapMarker[] = [
    ...stops.map((s, i) => ({
      id: s.store.id,
      kind: 'store' as const,
      lat: s.store.lat,
      lng: s.store.lng,
      title: `${i + 1}. ${s.store.name}: ${s.reason}`,
      status: s.store.status,
      weight: 0.45,
      label: String(i + 1),
      pulse: /pedido|entrega/i.test(s.reason),
    })),
    ...(wh ? [{ id: 'warehouse', kind: 'warehouse' as const, lat: wh.lat, lng: wh.lng, title: wh.name }] : []),
  ];
  const line: [number, number][] = wh ? [[wh.lat, wh.lng], ...stops.map((s) => [s.store.lat, s.store.lng] as [number, number])] : [];

  return (
    <>
      <PageHeader title="Mi ruta de hoy" subtitle="Tus locales que más necesitan visita, en orden de cercanía desde el almacén." />
      {route.loading && !route.data ? (
        <Loading rows={3} />
      ) : stops.length === 0 ? (
        <EmptyState icon={Route} title="Hoy no hay paradas">
          Cuando tengas locales activos o con contrato por firmar, aquí aparece tu ruta del día.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <MapView
            markers={markers}
            route={line}
            className="h-[55vh] bg-surface-2! lg:h-[68vh]"
            fitKey={`${stops.map((s) => s.store.id).join(',')}|${wh ? 'almacen' : ''}`}
            label="Mapa de mi ruta del día"
          />
          <ol className="grid content-start gap-2" aria-label="Paradas de la ruta">
            {stops.map((s, i) => (
              <li key={s.store.id} className="glass p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-accent font-bold text-accent-ink tabular" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{s.store.name}</p>
                    <p className="text-sm text-muted">{s.reason}</p>
                    <p className="text-sm text-muted">{s.store.address}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <a className="btn btn-secondary" href={directionsUrl(s.store.lat, s.store.lng)} target="_blank" rel="noopener noreferrer">
                    <Navigation aria-hidden /> Cómo llegar
                  </a>
                  {s.store.status === 'activo' ? (
                    <LinkButton to={p(`locales/${s.store.id}/visita`)} variant="primary" icon={CalendarCheck}>
                      Registrar visita
                    </LinkButton>
                  ) : (
                    <LinkButton to={p(`locales/${s.store.id}`)} variant="primary" icon={StoreIcon}>
                      Ver local
                    </LinkButton>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
