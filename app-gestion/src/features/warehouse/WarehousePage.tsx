// Almacén de la línea: existencias calculadas del libro, llegadas (importaciones o lotes de
// tostado), lotes con costo y vencimiento, y el libro de movimientos.
import { AlertTriangle, ArrowRight, Boxes, CalendarClock, CheckCircle2, ClipboardCheck, Flame, FolderOpen, PackageCheck, Plus, Scale, Ship, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { Arrival, ArrivalStatus, Product } from '../../data/types';
import { mixedUnitsText } from '../../domain/products';
import { arrivalStatusLabel } from '../../lines/config';
import { fmtMoney } from '../../lib/money';
import { addDaysToDate, fmtDate, fmtDateTime, fmtRelativeDays, toIsoDate } from '../../lib/time';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import {
  adjustWarehouse,
  createArrival,
  getWarehouse,
  inventoryAlerts,
  listArrivals,
  listLots,
  listMovements,
  receiveArrival,
  setArrivalStatus,
  stockSummary,
  warehouseShrink,
} from '../../services/inventory';
import { Button, Card, EmptyState, ErrorBox, LinkButton, Loading, NumberInput, PageHeader, Pill, SelectInput, Sheet, Stat, Tabs, TextArea, TextInput } from '../../ui/kit';
import { startBaleCheck } from '../../services/receiving';
import { useAction } from '../../ui/toast';
import { MOVEMENT_LABEL, RoleGate, locationLabel } from '../common';

type Tab = 'existencias' | 'llegadas' | 'lotes' | 'movimientos';
const TABS: Tab[] = ['existencias', 'llegadas', 'lotes', 'movimientos'];

export function WarehousePage() {
  return (
    <RoleGate roles={['admin']} message="El almacén lo lleva administración. La disponibilidad y la próxima llegada están en el catálogo.">
      <Warehouse />
    </RoleGate>
  );
}

function Warehouse() {
  const { ctx, config, actor, p } = useLine();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'existencias'));
  const wh = useAsync(() => getWarehouse(ctx), [ctx]);
  const stock = useAsync(() => stockSummary(ctx), [ctx]);
  const alerts = useAsync(() => inventoryAlerts(ctx), [ctx]);
  const arrivals = useAsync(() => listArrivals(ctx), [ctx]);
  const totals = useMemo(() => {
    let wh = 0;
    let cons = 0;
    let low = 0;
    for (const l of stock.data?.lines.values() ?? []) {
      wh += l.warehouse;
      cons += l.consignment;
      if (l.lowStock) low += 1;
    }
    return { wh, cons, low };
  }, [stock.data]);
  const pending = (arrivals.data ?? []).filter((a) => a.status !== 'recibida' && a.status !== 'cancelada');

  return (
    <>
      <PageHeader
        title={wh.data?.name ?? 'Almacén'}
        subtitle={`${wh.data?.address ?? ''} · Las existencias salen del libro de movimientos; nadie las edita a mano.`}
        actions={
          !actor.readOnly ? (
            <LinkButton to={p('almacen/contar')} icon={ClipboardCheck}>
              Contar
            </LinkButton>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="En almacén" value={totals.wh} icon={Boxes} hint={config.unitName.many} />
        <Stat label="En consignación" value={totals.cons} hint="Siguen siendo de la empresa" />
        <Stat label="Productos con stock bajo" value={totals.low} tone={totals.low ? 'warn' : 'ok'} />
        <Stat label={config.inbound === 'import' ? 'Importaciones en camino' : 'Tandas por recibir'} value={pending.length} icon={config.inbound === 'import' ? Ship : Flame} />
      </div>

      {alerts.data && alerts.data.length > 0 ? (
        <Card className="mt-4 p-4" aria-label="Avisos del almacén">
          <h2 className="mb-2 flex items-center gap-2 font-bold">
            <AlertTriangle className="h-5 w-5 text-warn" aria-hidden /> Avisos
          </h2>
          <ul className="grid gap-1.5">
            {alerts.data.map((a, i) => (
              <li key={`${a.kind}-${a.productId}-${a.storeId ?? i}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <Pill tone={a.kind === 'stock_bajo' ? 'warn' : a.kind === 'vencido_local' ? 'danger' : 'info'}>
                  {a.kind === 'stock_bajo' ? 'Stock bajo' : a.kind === 'por_vencer_almacen' ? 'Por vencer en almacén' : a.kind === 'vencido_local' ? 'Vencido en local' : 'Por vencer en local'}
                </Pill>
                <span className="font-semibold">{a.productName}</span>
                <span className="text-muted">{a.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-6 mb-4">
        <Tabs<Tab>
          label="Secciones del almacén"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'existencias', label: 'Existencias' },
            { value: 'llegadas', label: config.inboundLabel, count: pending.length },
            { value: 'lotes', label: 'Lotes' },
            { value: 'movimientos', label: 'Libro de movimientos' },
          ]}
        />
      </div>
      {tab === 'existencias' ? <StockTab /> : null}
      {tab === 'llegadas' ? <ArrivalsTab arrivals={arrivals.data} loading={arrivals.loading} products={stock.data?.products ?? []} /> : null}
      {tab === 'lotes' ? <LotsTab /> : null}
      {tab === 'movimientos' ? <MovementsTab products={stock.data?.products ?? []} warehouseName={wh.data?.name ?? 'Almacén'} /> : null}
    </>
  );
}

function StockTab() {
  const { ctx, actor } = useLine();
  const { data, error, loading } = useAsync(() => stockSummary(ctx), [ctx]);
  const [adjust, setAdjust] = useState<Product | null>(null);
  const [shrink, setShrink] = useState<Product | null>(null);
  if (loading && !data) return <Loading rows={4} />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const now = ctx.now();
  const canWrite = !actor.readOnly;
  return (
    <>
      <ul className="grid gap-2">
        {data.products
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name, 'es'))
          .map((p) => {
            const l = data.lines.get(p.id)!;
            return (
              <li key={p.id} className="glass grid gap-3 p-4 md:grid-cols-[1.4fr_repeat(4,minmax(0,0.6fr))_230px] md:items-center">
                <div className="min-w-0">
                  <p className="font-bold text-ink">{p.name}</p>
                  <p className="text-sm text-muted">
                    {p.sku}
                    {l.lowStock ? (
                      <span className="ml-2">
                        <Pill tone="warn">Stock bajo</Pill>
                      </span>
                    ) : null}
                    {!p.active ? (
                      <span className="ml-2">
                        <Pill>Inactivo</Pill>
                      </span>
                    ) : null}
                  </p>
                </div>
                <Cell label="Almacén" value={l.warehouse} />
                <Cell label="Apartado" value={l.reserved} />
                <Cell label="Disponible" value={l.available} strong tone={l.available <= p.lowStockThreshold ? 'warn' : undefined} />
                <Cell label="En locales" value={l.consignment} />
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  {l.nextArrival ? (
                    <span className="text-sm text-muted">
                      +{l.nextArrival.qty} {fmtRelativeDays(l.nextArrival.eta, now)}
                    </span>
                  ) : null}
                  {canWrite ? (
                    <>
                      <Button variant="ghost" icon={Scale} onClick={() => setAdjust(p)} aria-label={`Ajustar ${p.name}`} />
                      <Button variant="ghost" icon={Trash2} onClick={() => setShrink(p)} aria-label={`Registrar merma de ${p.name}`} />
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
      </ul>
      <AdjustSheet product={adjust} onClose={() => setAdjust(null)} />
      <ShrinkSheet product={shrink} onClose={() => setShrink(null)} />
    </>
  );
}

function Cell({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-2 md:block md:text-right">
      <span className="text-sm text-muted md:block">{label}</span>
      <span className={`tabular ${strong ? 'text-lg font-bold' : 'font-semibold'} ${tone === 'warn' ? 'text-warn' : 'text-ink'}`}>{value}</span>
    </div>
  );
}

function AdjustSheet({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const lots = useAsync(() => (product ? listLots(ctx) : Promise.resolve([])), [ctx, product?.id]);
  const [lotId, setLotId] = useState('');
  const [delta, setDelta] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const mine = (lots.data ?? []).filter((l) => l.product.id === product?.id && l.warehouse > 0);
  return (
    <Sheet open={product !== null} onClose={onClose} title={`Ajustar ${product?.name ?? ''}`}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!product) return;
          void run(async () => {
            await adjustWarehouse(ctx, { productId: product.id, lotId: lotId || mine[0]?.lot.id || '', delta: delta === '' ? 0 : delta, reason });
            setDelta('');
            setReason('');
            onClose();
          }, 'Ajuste registrado en el libro.');
        }}
      >
        <p className="text-sm text-muted">Para corregir después de un conteo físico. Queda como un movimiento de ajuste con su motivo; nunca deja el lote en negativo.</p>
        <SelectInput
          label="Lote"
          value={lotId || mine[0]?.lot.id || ''}
          onChange={(e) => setLotId(e.target.value)}
          options={mine.map((l) => ({ value: l.lot.id, label: `${l.lot.code} · ${l.warehouse} en almacén` }))}
          placeholder={mine.length ? undefined : 'No hay lotes con existencias'}
        />
        <NumberInput label="Cantidad (+ suma, − resta)" step={1} value={delta} onValue={setDelta} />
        <TextInput label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Conteo físico del viernes" />
        <Button type="submit" variant="primary" icon={Scale} busy={busy} disabled={!mine.length}>
          Registrar ajuste
        </Button>
      </form>
    </Sheet>
  );
}

function ShrinkSheet({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [qty, setQty] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  return (
    <Sheet open={product !== null} onClose={onClose} title={`Merma: ${product?.name ?? ''}`}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!product) return;
          void run(async () => {
            await warehouseShrink(ctx, { productId: product.id, qty: qty === '' ? 0 : qty, reason });
            setQty('');
            setReason('');
            onClose();
          }, 'Merma registrada.');
        }}
      >
        <p className="text-sm text-muted">Producto dañado o perdido en el almacén. Sale del inventario y su costo entra como merma en la contabilidad.</p>
        <NumberInput label="Unidades" min={1} step={1} value={qty} onValue={setQty} />
        <TextInput label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Caja mojada, humedad, rotura…" />
        <Button type="submit" variant="danger" icon={Trash2} busy={busy}>
          Registrar merma
        </Button>
      </form>
    </Sheet>
  );
}

// ---------- Llegadas ----------

function nextStatus(a: Arrival): ArrivalStatus | null {
  // Con lista de empaque, entre «En aduana» y «Recibida» se confirman los bultos.
  const flow: ArrivalStatus[] =
    a.kind === 'import' ? (a.bales?.length ? ['produccion', 'transito', 'aduana', 'confirmando', 'recibida'] : ['produccion', 'transito', 'aduana', 'recibida']) : ['programado', 'tostado', 'recibida'];
  const i = flow.indexOf(a.status);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1]! : null;
}

function ArrivalsTab({ arrivals, loading, products }: { arrivals?: Arrival[]; loading: boolean; products: Product[] }) {
  const { ctx, line, config, actor, p } = useLine();
  const nav = useNavigate();
  const byId = new Map(products.map((x) => [x.id, x]));
  const { run, busy } = useAction();
  const [create, setCreate] = useState(false);
  const names = new Map(products.map((p) => [p.id, p.name]));
  if (loading && !arrivals) return <Loading rows={3} />;
  const now = ctx.now();
  const canWrite = !actor.readOnly;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[60ch] text-sm text-muted">
          {config.inbound === 'import'
            ? 'Las importaciones pasan por producción, tránsito y aduana. Al recibirlas, cada producto entra al almacén como un lote con su costo.'
            : 'El café entra por tandas de tostado. Al recibir la tanda, cada producto entra como un lote con su fecha de tostado y «consumir antes de».'}
        </p>
        {canWrite ? (
          <Button variant="primary" icon={Plus} onClick={() => setCreate(true)}>
            {config.inbound === 'import' ? 'Nueva importación' : 'Programar tostado'}
          </Button>
        ) : null}
      </div>
      {!arrivals?.length ? <EmptyState icon={Ship} title="No hay llegadas registradas" /> : null}
      <ul className="grid gap-3">
        {(arrivals ?? []).map((a) => {
          const next = nextStatus(a);
          const done = a.status === 'recibida';
          const units = a.items.reduce((s, i) => s + i.qty, 0);
          const bales = a.bales ?? [];
          const checked = bales.filter((b) => b.status !== 'pendiente').length;
          const unitsLabel = mixedUnitsText(a.items.flatMap((i) => (byId.get(i.productId) ? [{ product: byId.get(i.productId)!, qty: i.qty }] : [])));
          return (
            <li key={a.id} className="glass p-4" aria-label={`Importación ${a.code}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-ink">
                    {a.code} <span className="font-normal text-muted">· {a.supplier}</span>
                  </p>
                  <p className="text-sm text-muted">
                    {a.productionLine ? `${a.productionLine} · ` : ''}
                    {a.originCountry} · {unitsLabel}
                    {bales.length ? ` · ${bales.length} bultos` : ''}
                  </p>
                  {a.status === 'confirmando' && bales.length ? (
                    <p className="mt-1 text-sm font-semibold text-accent">
                      {checked} de {bales.length} bultos revisados
                    </p>
                  ) : null}
                </div>
                <Pill tone={done ? 'ok' : a.status === 'aduana' || a.status === 'tostado' || a.status === 'confirmando' ? 'accent' : 'info'} dot>
                  {arrivalStatusLabel(line, a.status)}
                </Pill>
              </div>
              <p className="mt-2 flex items-center gap-2 text-ink">
                <CalendarClock className="h-4 w-4 text-accent" aria-hidden />
                {done ? `Recibida el ${fmtDate(a.receivedAt ?? a.eta)}` : `${a.kind === 'roast' ? 'Tueste' : 'Llega'} el ${fmtDate(a.eta)}, ${fmtRelativeDays(a.eta, now)}`}
                {a.bestBefore && !done ? <span className="text-sm text-muted">· consumir antes de {fmtDate(a.bestBefore)}</span> : null}
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {a.items.map((i) => (
                  <li key={i.productId} className="pill">
                    {names.get(i.productId) ?? i.productId} × {i.qty}
                  </li>
                ))}
              </ul>
              <ol className="mt-3 flex flex-wrap items-center gap-1 text-xs text-muted" aria-label="Historial de estados">
                {a.statusHistory.map((h, i) => (
                  <li key={`${h.status}-${h.at}`} className="flex items-center gap-1">
                    {i > 0 ? <ArrowRight className="h-3 w-3" aria-hidden /> : null}
                    {arrivalStatusLabel(line, h.status)} {fmtDate(h.at)}
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex flex-wrap gap-2">
                <LinkButton to={p(`almacen/llegadas/${a.id}`)} variant="ghost" icon={FolderOpen} aria-label={`Abrir ${a.code}`}>
                  Abrir
                </LinkButton>
                {!done && canWrite && bales.length ? (
                  // Con lista de empaque se recibe después de confirmar los bultos, en su pantalla.
                  a.status === 'confirmando' ? (
                    <LinkButton to={p(`almacen/llegadas/${a.id}`)} variant="primary" icon={ClipboardCheck}>
                      Seguir con los bultos
                    </LinkButton>
                  ) : next === 'confirmando' ? (
                    <Button
                      variant="primary"
                      icon={ClipboardCheck}
                      busy={busy}
                      onClick={() =>
                        void run(async () => {
                          await startBaleCheck(ctx, a.id);
                          nav(p(`almacen/llegadas/${a.id}`));
                        }, `${a.code}: a confirmar bulto por bulto.`)
                      }
                    >
                      Confirmar bultos
                    </Button>
                  ) : next ? (
                    <Button icon={ArrowRight} busy={busy} onClick={() => void run(() => setArrivalStatus(ctx, a.id, next), `${a.code}: ${arrivalStatusLabel(line, next)}.`)}>
                      Pasar a «{arrivalStatusLabel(line, next)}»
                    </Button>
                  ) : null
                ) : !done && canWrite ? (
                  <>
                    {next && next !== 'recibida' ? (
                      <Button icon={ArrowRight} busy={busy} onClick={() => void run(() => setArrivalStatus(ctx, a.id, next), `${a.code}: ${arrivalStatusLabel(line, next)}.`)}>
                        Pasar a «{arrivalStatusLabel(line, next)}»
                      </Button>
                    ) : null}
                    <Button variant="primary" icon={PackageCheck} busy={busy} onClick={() => void run(() => receiveArrival(ctx, a.id), `${a.code} recibida: ${units} unidades al almacén.`)}>
                      Recibir en almacén
                    </Button>
                  </>
                ) : null}
              </div>
              {done ? (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-ok">
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Sumó al almacén por lote.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ArrivalSheet open={create} onClose={() => setCreate(false)} products={products.filter((p) => p.active)} />
    </>
  );
}

function ArrivalSheet({ open, onClose, products }: { open: boolean; onClose: () => void; products: Product[] }) {
  const { ctx, config } = useLine();
  const { run, busy } = useAction();
  const today = toIsoDate(ctx.now());
  const roast = config.inbound === 'roast';
  const [supplier, setSupplier] = useState(roast ? 'Tostadora El Mío, Miami' : '');
  const [origin, setOrigin] = useState(roast ? 'EE. UU. (tostado en Miami)' : '');
  const [eta, setEta] = useState(addDaysToDate(today, roast ? 3 : 30));
  const [line, setLine] = useState('Línea 1 · Espresso');
  const [best, setBest] = useState(addDaysToDate(today, roast ? 183 : 0));
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState<Record<string, number | ''>>({});
  const items = products.filter((p) => (qty[p.id] ?? 0) !== '' && Number(qty[p.id] ?? 0) > 0).map((p) => ({ productId: p.id, qty: Number(qty[p.id]), unitCost: p.cost }));
  return (
    <Sheet open={open} onClose={onClose} title={roast ? 'Programar tostado' : 'Nueva importación'} wide>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await createArrival(ctx, { supplier, originCountry: origin, eta, notes, items, productionLine: roast ? line : undefined, bestBefore: roast ? best : undefined });
            setQty({});
            onClose();
          }, roast ? 'Tostado programado.' : 'Importación registrada.');
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label={roast ? 'Tostadora' : 'Proveedor o fábrica'} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          <TextInput label="País de origen" value={origin} onChange={(e) => setOrigin(e.target.value)} hint={roast ? undefined : 'Nunca Cuba (embargo de EE. UU.).'} />
          <TextInput label={roast ? 'Fecha de tostado' : 'Llegada estimada'} type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
          {roast ? (
            <>
              <SelectInput
                label="Línea de producción"
                value={line}
                onChange={(e) => setLine(e.target.value)}
                options={[
                  { value: 'Línea 1 · Espresso', label: 'Línea 1 · Espresso' },
                  { value: 'Línea 2 · Orígenes y muestras', label: 'Línea 2 · Orígenes y muestras' },
                ]}
              />
              <TextInput label="Consumir antes de" type="date" value={best} onChange={(e) => setBest(e.target.value)} />
            </>
          ) : null}
        </div>
        <fieldset className="grid gap-2">
          <legend className="field-label mb-1">Cantidades</legend>
          {products.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              <span className="hidden text-sm text-muted sm:inline">{fmtMoney(p.cost)} c/u</span>
              <input
                className="input tabular w-28 text-right"
                type="number"
                min={0}
                step={p.packSize}
                inputMode="numeric"
                aria-label={`Unidades de ${p.name}`}
                value={qty[p.id] ?? ''}
                onChange={(e) => setQty((s) => ({ ...s, [p.id]: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </div>
          ))}
        </fieldset>
        <TextArea label="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button type="submit" variant="primary" icon={roast ? Flame : Ship} busy={busy} disabled={items.length === 0}>
          {roast ? 'Programar' : 'Registrar importación'} ({items.reduce((s, i) => s + i.qty, 0)} unidades)
        </Button>
      </form>
    </Sheet>
  );
}

function LotsTab() {
  const { ctx, line } = useLine();
  const { data, error, loading } = useAsync(() => listLots(ctx), [ctx]);
  if (loading && !data) return <Loading rows={3} />;
  if (error) return <ErrorBox error={error} />;
  if (!data?.length) return <EmptyState icon={Boxes} title="No hay lotes con existencias" />;
  return (
    <Card className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Lote</th>
            <th>Producto</th>
            <th>Recibido</th>
            {line === 'cafe' ? (
              <>
                <th>Tostado</th>
                <th>Consumir antes de</th>
              </>
            ) : null}
            <th className="num">Costo</th>
            <th className="num">Almacén</th>
            <th className="num">En locales</th>
          </tr>
        </thead>
        <tbody>
          {data.map((l) => (
            <tr key={l.lot.id}>
              <td className="font-semibold whitespace-nowrap">{l.lot.code}</td>
              <td>{l.product.name}</td>
              <td className="whitespace-nowrap">{fmtDate(l.lot.receivedAt)}</td>
              {line === 'cafe' ? (
                <>
                  <td className="whitespace-nowrap">{l.lot.producedOn ? fmtDate(l.lot.producedOn) : '—'}</td>
                  <td className="whitespace-nowrap">
                    {l.lot.bestBefore ? fmtDate(l.lot.bestBefore) : '—'}{' '}
                    {l.daysToExpiry !== undefined && l.daysToExpiry <= 30 ? <Pill tone={l.daysToExpiry < 0 ? 'danger' : 'warn'}>{l.daysToExpiry < 0 ? 'Vencido' : `${l.daysToExpiry} días`}</Pill> : null}
                  </td>
                </>
              ) : null}
              <td className="num">{fmtMoney(l.lot.unitCost)}</td>
              <td className="num">{l.warehouse}</td>
              <td className="num">{l.inStores}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function MovementsTab({ products, warehouseName }: { products: Product[]; warehouseName: string }) {
  const { ctx } = useLine();
  const [productId, setProductId] = useState('');
  const { data, error, loading } = useAsync(() => listMovements(ctx, { productId: productId || undefined, limit: 150 }), [ctx, productId]);
  return (
    <>
      <div className="mb-3 max-w-sm">
        <SelectInput label="Producto" value={productId} onChange={(e) => setProductId(e.target.value)} options={[{ value: '', label: 'Todos los productos' }, ...products.map((p) => ({ value: p.id, label: p.name }))]} />
      </div>
      {loading && !data ? <Loading rows={4} /> : null}
      {error ? <ErrorBox error={error} /> : null}
      {data ? (
        <Card className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Movimiento</th>
                <th>Producto</th>
                <th>Lote</th>
                <th>De</th>
                <th>A</th>
                <th className="num">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap text-muted">{fmtDateTime(m.at)}</td>
                  <td className="whitespace-nowrap">{MOVEMENT_LABEL[m.type]}</td>
                  <td>{m.productName}</td>
                  <td className="whitespace-nowrap text-muted">{m.lotCode}</td>
                  <td>{locationLabel(m.from, warehouseName, m.storeName)}</td>
                  <td>{locationLabel(m.to, warehouseName, m.storeName)}</td>
                  <td className="num font-semibold">{m.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      <p className="mt-2 text-sm text-muted">Se muestran los últimos 150 movimientos. El libro no se edita: las correcciones son ajustes con motivo.</p>
    </>
  );
}

// Ronda 3: «Contar», el detalle de una llegada y «Buscar código» van en este mismo trozo, así la
// carga inicial no suma una ruta perezosa por cada pantalla.
export { ArrivalPage } from './arrival';
export { CountPage } from './count';
export { CodesPage } from '../codes/pages';
