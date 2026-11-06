// Repartos (administración): armar la ruta del día de un camión con las entregas listas, ordenar
// las paradas, verlas en el mapa y anotar lo que costó.
import { ArrowDown, ArrowUp, Calculator, CheckCircle2, Plus, Route as RouteIcon, Save, Trash2, Truck, Undo2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import type { RouteStatus } from '../../data/types';
import { routePath, routeTotalCost } from '../../domain/routes';
import { fmtMoney, fmtNumber } from '../../lib/money';
import { addDaysToDate, fmtDate, fmtDateTime, toIsoDate } from '../../lib/time';
import { DELIVERY_STATUS_LABEL } from '../../services/consignment';
import {
  ROUTE_STATUS_LABEL,
  createRoute,
  deleteRoute,
  getRoute,
  listRoutes,
  moveRouteStop,
  readyDeliveries,
  saveRouteCosts,
  setRouteStatus,
  setRouteStops,
  type ReadyDelivery,
  type RouteView,
} from '../../services/routes';
import { Button, Card, EmptyState, ErrorBox, LinkButton, Loading, NumberInput, PageHeader, Pill, Section, Sheet, Tabs, TextInput } from '../../ui/kit';
import { MapView, type MapMarker } from '../../ui/map';
import { useAction } from '../../ui/toast';
import { AdminOnly } from '../money/shared';

const STATUS_TONE: Record<RouteStatus, 'info' | 'accent' | 'ok'> = { borrador: 'info', en_ruta: 'accent', terminado: 'ok' };

export function RoutesPage() {
  const { actor } = useLine();
  if (actor.role !== 'admin') return <AdminOnly what="los repartos" />;
  return <RoutesList />;
}

function RoutesList() {
  const { ctx, p, actor } = useLine();
  const routes = useAsync(() => listRoutes(ctx), [ctx]);
  const ready = useAsync(() => readyDeliveries(ctx), [ctx]);
  const [tab, setTab] = useState<'abiertos' | 'terminados'>('abiertos');
  const [more, setMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const list = routes.data ?? [];
  const open = list.filter((r) => r.status !== 'terminado');
  const done = list.filter((r) => r.status === 'terminado');
  const shown = tab === 'abiertos' ? open : more ? done : done.slice(0, 15);
  const last30 = done.filter((r) => r.date >= addDaysToDate(toIsoDate(ctx.now()), -30));

  return (
    <>
      <PageHeader
        title="Repartos"
        subtitle="La ruta del día de cada camión: las entregas listas en orden, el mapa y lo que cuesta (km, chofer y peajes)."
        actions={
          !actor.readOnly ? (
            <Button variant="primary" big icon={Plus} onClick={() => setCreating(true)} disabled={!ready.data?.length}>
              Armar reparto
            </Button>
          ) : undefined
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="glass p-4">
          <p className="text-sm text-muted">Listas para salir</p>
          <p className="glow text-2xl font-bold tabular">{ready.data?.length ?? 0}</p>
        </div>
        <div className="glass p-4">
          <p className="text-sm text-muted">Repartos abiertos</p>
          <p className="text-2xl font-bold tabular">{open.length}</p>
        </div>
        <div className="glass p-4">
          <p className="text-sm text-muted">Costo últimos 30 días</p>
          <p className="text-2xl font-bold tabular">{fmtMoney(last30.reduce((a, r) => a + r.total, 0))}</p>
        </div>
        <div className="glass p-4">
          <p className="text-sm text-muted">Km últimos 30 días</p>
          <p className="text-2xl font-bold tabular">{fmtNumber(Math.round(last30.reduce((a, r) => a + r.km, 0)))}</p>
        </div>
      </div>

      {(ready.data ?? []).length ? (
        <Section title="Listas para salir (sin reparto)">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(ready.data ?? []).map((d) => (
              <li key={d.id} className="glass flex items-center gap-3 p-3">
                <Truck className="h-5 w-5 flex-none text-accent" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{d.storeName}</span>
                  <span className="block truncate text-sm text-muted">
                    {d.code} · {fmtNumber(d.units)} u.
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section
        title="Repartos"
        actions={
          <Tabs
            label="Ver repartos"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'abiertos', label: 'Abiertos', count: open.length },
              { value: 'terminados', label: 'Terminados', count: done.length },
            ]}
          />
        }
      >
        {routes.error ? <ErrorBox error={routes.error} /> : null}
        {routes.loading && !routes.data ? <Loading rows={3} /> : null}
        {routes.data && shown.length === 0 ? (
          <EmptyState icon={RouteIcon} title={tab === 'abiertos' ? 'No hay repartos abiertos' : 'Todavía no hay repartos terminados'}>
            {tab === 'abiertos' ? 'Toca «Armar reparto» para juntar las entregas listas en la ruta de un camión.' : 'Cuando un reparto se marque terminado, aparece aquí con su costo.'}
          </EmptyState>
        ) : null}
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {shown.map((r) => (
            <li key={r.id}>
              <Link to={p(`repartos/${r.id}`)} className="glass flex min-h-14 flex-wrap items-center gap-3 p-4 hover:border-line-strong" aria-label={`Reparto ${r.code}`}>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">
                    {r.code} · {fmtDate(r.date)}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {r.stops.length} parada{r.stops.length === 1 ? '' : 's'} · {fmtNumber(r.km)} km{r.driver ? ` · ${r.driver}` : ''}
                  </span>
                </span>
                <span className="text-right">
                  <Pill tone={STATUS_TONE[r.status]}>{ROUTE_STATUS_LABEL[r.status]}</Pill>
                  <span className="mt-1 block font-bold tabular">{fmtMoney(r.total)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {tab === 'terminados' && done.length > 15 && !more ? (
          <Button variant="ghost" className="mt-2" onClick={() => setMore(true)}>
            Ver los {done.length} repartos
          </Button>
        ) : null}
      </Section>
      <NewRouteSheet open={creating} onClose={() => setCreating(false)} ready={ready.data ?? []} />
    </>
  );
}

function NewRouteSheet({ open, onClose, ready }: { open: boolean; onClose: () => void; ready: ReadyDelivery[] }) {
  const { ctx, p } = useLine();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const [date, setDate] = useState(toIsoDate(ctx.now()));
  const [driver, setDriver] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [off, setOff] = useState<Set<string>>(new Set());
  const chosen = ready.filter((d) => !off.has(d.id));
  return (
    <Sheet open={open} onClose={onClose} title="Armar reparto">
      <form
        className="grid grid-cols-[minmax(0,1fr)] gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await createRoute(ctx, { date, driver, vehicle, deliveryIds: chosen.map((d) => d.id) });
            onClose();
            nav(p(`repartos/${r.id}`));
            return r;
          }, (r) => `${r.code} armado: ordena las paradas y anota los costos.`);
        }}
      >
        <TextInput label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput label="Chofer" value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Nombre" autoComplete="off" />
          <TextInput label="Vehículo" value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Camión 1" autoComplete="off" />
        </div>
        <fieldset className="grid gap-2">
          <legend className="field-label mb-1.5">Entregas listas para salir</legend>
          {ready.map((d) => (
            <label key={d.id} className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3 py-2">
              <input
                type="checkbox"
                className="h-5 w-5 flex-none accent-[var(--accent)]"
                checked={!off.has(d.id)}
                onChange={(e) =>
                  setOff((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.delete(d.id);
                    else n.add(d.id);
                    return n;
                  })
                }
              />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{d.storeName}</span>
                <span className="block truncate text-sm text-muted">
                  {d.code} · {fmtNumber(d.units)} u. · {d.address}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <Button type="submit" variant="primary" icon={RouteIcon} busy={busy} disabled={chosen.length === 0}>
          Armar reparto con {chosen.length} parada{chosen.length === 1 ? '' : 's'}
        </Button>
      </form>
    </Sheet>
  );
}

// ---------- Detalle ----------

export function RouteDetailPage() {
  const { actor } = useLine();
  if (actor.role !== 'admin') return <AdminOnly what="los repartos" />;
  return <RouteDetail />;
}

function RouteDetail() {
  const { id = '' } = useParams();
  const { ctx } = useLine();
  const data = useAsync(() => getRoute(ctx, id), [ctx, id]);
  if (data.error) return <ErrorBox error={data.error} />;
  if (!data.data) return <Loading rows={4} />;
  // La clave hace que el formulario de costos tome los valores guardados después de cada cambio.
  return <RouteDetailView key={`${data.data.id}|${data.data.km}|${data.data.costPerKm}|${data.data.driverCost}|${data.data.tolls}|${data.data.status}`} r={data.data} />;
}

function RouteDetailView({ r }: { r: RouteView }) {
  const { ctx, p, actor } = useLine();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const editable = r.status !== 'terminado' && !actor.readOnly;
  const [adding, setAdding] = useState(false);
  const [km, setKm] = useState<number | ''>(r.km);
  const [costPerKm, setCostPerKm] = useState<number | ''>(r.costPerKm);
  const [driverCost, setDriverCost] = useState<number | ''>(r.driverCost);
  const [tolls, setTolls] = useState<number | ''>(r.tolls);
  const [driver, setDriver] = useState(r.driver);
  const [vehicle, setVehicle] = useState(r.vehicle);
  const n = (v: number | '') => (v === '' ? 0 : v);
  const liveTotal = routeTotalCost({ km: n(km), costPerKm: n(costPerKm), driverCost: n(driverCost), tolls: n(tolls) });

  const markers = useMemo<MapMarker[]>(
    () => [
      { id: 'almacen', kind: 'warehouse', lat: r.warehouse.lat, lng: r.warehouse.lng, title: r.warehouse.name },
      ...r.stopsView.map((s, i) => ({ id: s.deliveryId, kind: 'store' as const, lat: s.lat, lng: s.lng, status: 'activo' as const, weight: 0.5, label: String(i + 1), title: `${i + 1}. ${s.storeName}` })),
    ],
    [r],
  );
  const path = useMemo(() => routePath(r.warehouse, r.stopsView), [r]);
  const far = r.estimatedKm > 800;

  const status = (to: RouteStatus, msg: string) => void run(() => setRouteStatus(ctx, r.id, to), msg);

  return (
    <>
      <PageHeader
        back={{ to: p('repartos'), label: 'Repartos' }}
        title={`Reparto ${r.code}`}
        subtitle={`${fmtDate(r.date)}${r.driver ? ` · ${r.driver}` : ''}${r.vehicle ? ` · ${r.vehicle}` : ''}`}
        actions={<Pill tone={STATUS_TONE[r.status]}>{ROUTE_STATUS_LABEL[r.status]}</Pill>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid content-start gap-3">
          <MapView markers={markers} route={path} className="h-72 lg:h-[420px]" fitKey={`${r.id}|${r.stops.map((s) => s.deliveryId).join(',')}`} label={`Mapa del reparto ${r.code}`} />
          <p className="text-sm text-muted">Sale de {r.warehouse.name} y vuelve. La línea une las paradas en orden (en línea recta).</p>
        </div>
        <Card className="grid content-start gap-3 p-4" aria-label="Paradas">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">Paradas</h2>
            {editable ? (
              <Button icon={Plus} onClick={() => setAdding(true)}>
                Agregar
              </Button>
            ) : null}
          </div>
          <ol className="grid grid-cols-1 gap-2" aria-label="Paradas en orden">
            {r.stopsView.map((s, i) => (
              <li key={s.deliveryId} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-accent text-sm font-bold text-accent-ink tabular" aria-hidden>
                  {i + 1}
                </span>
                <span className="min-w-[9rem] flex-1">
                  <span className="block font-semibold">{s.storeName}</span>
                  <span className="block text-xs text-muted">
                    {s.deliveryCode} · {fmtNumber(s.units)} u. · {DELIVERY_STATUS_LABEL[s.deliveryStatus]}
                    {s.cost > 0 ? ` · ${fmtMoney(s.cost)}` : ''}
                  </span>
                </span>
                {editable ? (
                  <span className="ml-auto flex flex-none">
                    <Button variant="ghost" icon={ArrowUp} disabled={i === 0 || busy} onClick={() => void run(() => moveRouteStop(ctx, r.id, s.deliveryId, -1))} aria-label={`Subir ${s.storeName}`} />
                    <Button variant="ghost" icon={ArrowDown} disabled={i === r.stopsView.length - 1 || busy} onClick={() => void run(() => moveRouteStop(ctx, r.id, s.deliveryId, 1))} aria-label={`Bajar ${s.storeName}`} />
                    {r.stopsView.length > 1 ? (
                      <Button
                        variant="ghost"
                        icon={X}
                        disabled={busy}
                        onClick={() => void run(() => setRouteStops(ctx, r.id, r.stops.filter((x) => x.deliveryId !== s.deliveryId).map((x) => x.deliveryId)), `${s.storeName} salió del reparto.`)}
                        aria-label={`Quitar ${s.storeName} del reparto`}
                      />
                    ) : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted">{fmtNumber(r.units)} unidades en total.</p>
        </Card>
      </div>

      <Section title="Costos">
        <form
          className="grid grid-cols-[minmax(0,1fr)] gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => saveRouteCosts(ctx, r.id, { km: km === '' ? Number.NaN : km, costPerKm: costPerKm === '' ? Number.NaN : costPerKm, driverCost: driverCost === '' ? Number.NaN : driverCost, tolls: tolls === '' ? Number.NaN : tolls, driver, vehicle }),
              (saved) => `Costos guardados: ${fmtMoney(routeTotalCost(saved))} en total.`,
            );
          }}
        >
          <fieldset disabled={!editable} className="m-0 grid min-w-0 grid-cols-1 gap-4 border-0 p-0 sm:grid-cols-2">
            <div className="grid gap-2">
              <NumberInput label="Kilómetros" value={km} onValue={setKm} min={0} step={0.1} hint={`Estimado: ${fmtNumber(r.estimatedKm)} km (línea recta × 1.3).`} />
              {editable && km !== r.estimatedKm ? (
                <Button variant="ghost" icon={Calculator} onClick={() => setKm(r.estimatedKm)}>
                  Usar el estimado
                </Button>
              ) : null}
            </div>
            <NumberInput label="Costo por km (USD)" value={costPerKm} onValue={setCostPerKm} min={0} step={0.05} hint="Combustible y desgaste. El de siempre se cambia en Ajustes." />
            <NumberInput label="Chofer (USD)" value={driverCost} onValue={setDriverCost} min={0} step={1} />
            <NumberInput label="Peajes (USD)" value={tolls} onValue={setTolls} min={0} step={0.25} />
            <TextInput label="Chofer" value={driver} onChange={(e) => setDriver(e.target.value)} autoComplete="off" />
            <TextInput label="Vehículo" value={vehicle} onChange={(e) => setVehicle(e.target.value)} autoComplete="off" />
          </fieldset>
          {far ? <p className="text-sm text-warn">Hay paradas muy lejos del almacén ({fmtNumber(r.estimatedKm)} km estimados): revisa los km o arma ese reparto aparte.</p> : null}
          <div className="glass flex flex-wrap items-center justify-between gap-3 p-4">
            <span>
              <span className="block text-sm text-muted">Costo total</span>
              <span className="glow block text-2xl font-bold tabular" aria-label={`Costo total: ${fmtMoney(liveTotal)}`}>
                {fmtMoney(liveTotal)}
              </span>
              <span className="block text-xs text-muted">
                {fmtNumber(n(km))} km × {fmtMoney(n(costPerKm))} + chofer {fmtMoney(n(driverCost))} + peajes {fmtMoney(n(tolls))}
              </span>
            </span>
            {editable ? (
              <Button type="submit" variant="primary" icon={Save} busy={busy}>
                Guardar costos
              </Button>
            ) : null}
          </div>
        </form>
        <p className="mt-2 text-sm text-muted">Al terminar el reparto, su costo entra en Rentabilidad repartido por las unidades que se entregaron en cada parada.</p>
      </Section>

      {!actor.readOnly ? (
        <Section title="Estado">
          <div className="flex flex-wrap gap-2">
            {r.status === 'borrador' ? (
              <>
                <Button variant="primary" icon={Truck} busy={busy} onClick={() => status('en_ruta', `${r.code} salió a ruta.`)}>
                  Salir a ruta
                </Button>
                <Button
                  variant="danger"
                  icon={Trash2}
                  busy={busy}
                  onClick={() =>
                    void run(async () => {
                      await deleteRoute(ctx, r.id);
                      nav(p('repartos'));
                    }, `${r.code} borrado: sus entregas vuelven a estar listas.`)
                  }
                >
                  Borrar reparto
                </Button>
              </>
            ) : null}
            {r.status === 'en_ruta' ? (
              <>
                <Button variant="primary" icon={CheckCircle2} busy={busy} onClick={() => status('terminado', `${r.code} terminado.`)}>
                  Terminar reparto
                </Button>
                <Button icon={Undo2} busy={busy} onClick={() => status('borrador', `${r.code} volvió a borrador.`)}>
                  Volver a borrador
                </Button>
              </>
            ) : null}
            {r.status === 'terminado' ? <p className="text-muted">Terminado. Creado el {fmtDateTime(r.createdAt)}.</p> : null}
          </div>
        </Section>
      ) : null}
      <AddStopsSheet open={adding} onClose={() => setAdding(false)} route={r} />
      <div className="mt-6">
        <LinkButton to={p('entregas')} variant="ghost">
          Ver entregas
        </LinkButton>
      </div>
    </>
  );
}

function AddStopsSheet({ open, onClose, route }: { open: boolean; onClose: () => void; route: RouteView }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const ready = useAsync(() => (open ? readyDeliveries(ctx) : Promise.resolve([] as ReadyDelivery[])), [ctx, open]);
  return (
    <Sheet open={open} onClose={onClose} title="Agregar paradas">
      {(ready.data ?? []).length === 0 ? (
        <p className="text-muted">No hay otras entregas listas para salir.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {(ready.data ?? []).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{d.storeName}</span>
                <span className="block truncate text-sm text-muted">
                  {d.code} · {fmtNumber(d.units)} u.
                </span>
              </span>
              <Button
                icon={Plus}
                busy={busy}
                onClick={() => void run(() => setRouteStops(ctx, route.id, [...route.stops.map((s) => s.deliveryId), d.id]), `${d.storeName} entra al final del reparto.`).then(onClose)}
              >
                Agregar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
