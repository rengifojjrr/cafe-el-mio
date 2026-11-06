// Consignación: visita con conteo, entregas (por preparar, listas, entregadas), nota de
// entrega imprimible, pedidos de los locales y la pantalla «Pedir más» del local.
import { CheckCircle2, ClipboardCheck, ClipboardList, MapPin, Printer, Send, ShoppingBag, Truck, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import type { Delivery, Reorder } from '../../data/types';
import { defaultOrderQty, mixedUnitsText, orderStep, packText, unitOf, unitsText } from '../../domain/products';
import { fmtMoney } from '../../lib/money';
import { fmtDate, fmtDateTime, fmtRelativeDays } from '../../lib/time';
import type { NewPhoto } from '../../lib/image';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { getPhoto, listProducts } from '../../services/catalog';
import { findByCode } from '../../services/codes';
import { REORDER_STATUS_LABEL, cancelReorder, confirmReorder, createReorder, listDeliveries, listReorders, recordVisit, type DeliveryView, type ReorderView } from '../../services/consignment';
import { getWarehouse } from '../../services/inventory';
import { loadStoreForActor, storeConsignment } from '../../services/stores';
import { Button, Card, EmptyState, ErrorBox, LinkButton, Loading, PageHeader, Pill, QtyStepper, Tabs, TextArea } from '../../ui/kit';
import { PhotoPicker, ProductThumb } from '../../ui/media';
import { ScanButton } from '../../ui/scanner';
import { askLocation } from '../../ui/signature';
import { useAction } from '../../ui/toast';
import { RoleGate } from '../common';
import { DeliveryCard, DeliveryEmpty } from './components';
import { DeliveryPdfView } from '../contracts/pdf-viewer';

// ---------- Visita con conteo ----------

export function VisitPage() {
  return (
    <RoleGate roles={['seller', 'admin']} message="Las visitas las registra el vendedor del local.">
      <Visit />
    </RoleGate>
  );
}

function Visit() {
  const { id = '' } = useParams();
  const { ctx, p, config, actor } = useLine();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const store = useAsync(() => loadStoreForActor(ctx, id), [ctx, id]);
  const lines = useAsync(() => storeConsignment(ctx, id), [ctx, id]);
  const [counted, setCounted] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [withGeo, setWithGeo] = useState(true);
  const [photo, setPhoto] = useState<NewPhoto | undefined>();
  const [scanned, setScanned] = useState(false);
  const [scanNote, setScanNote] = useState<string>();
  const data = lines.data ?? [];
  const value = (pid: string, expected: number) => counted[pid] ?? expected;
  // Contar escaneando: el conteo empieza en cero con la primera lectura y cada lectura suma uno
  // (nunca más de lo que hay en consignación).
  const onScan = async (code: string) => {
    const m = await findByCode(ctx, code);
    const productId = m.kind === 'product' ? m.product.id : m.kind === 'case' ? m.caseUnit.productId : null;
    const line = data.find((l) => l.productId === productId);
    if (!productId || !line) {
      setScanNote(m.kind === 'product' ? `${m.product.name} no está en consignación en este local.` : m.kind === 'none' ? `No conozco el código ${m.code}.` : 'Ese código no es de un producto de este local.');
      return;
    }
    const base = scanned ? counted : Object.fromEntries(data.map((l) => [l.productId, 0]));
    const now = base[productId] ?? 0;
    if (now >= line.qty) {
      setScanNote(`Ya contaste todo lo que había de ${line.name} (${line.qty}).`);
      if (!scanned) setCounted(base);
    } else {
      setCounted({ ...base, [productId]: now + 1 });
      setScanNote(`+1 · ${line.name}: ${now + 1} contados`);
    }
    setScanned(true);
  };
  const soldUnits = data.reduce((a, l) => a + (l.qty - value(l.productId, l.qty)), 0);
  const soldAmount = data.reduce((a, l) => a + (l.qty - value(l.productId, l.qty)) * l.priceToStore, 0);
  if (store.error) return <ErrorBox error={store.error} />;
  if (!store.data || (lines.loading && !lines.data)) return <Loading rows={4} />;
  const s = store.data;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const geo = withGeo ? await askLocation() : undefined;
          const r = await recordVisit(ctx, { storeId: s.id, counts: data.map((l) => ({ productId: l.productId, counted: value(l.productId, l.qty) })), notes, geo, photo });
          nav(p(`locales/${s.id}`));
          return r;
        }, (r) => (r.report ? `Visita registrada: ${soldUnits} vendidas (${fmtMoney(r.report.total)}).` : 'Visita registrada, sin ventas desde la última.'));
      }}
    >
      <PageHeader back={{ to: p(`locales/${s.id}`), label: s.name }} title="Registrar visita" subtitle="Cuenta lo que queda en el local. Lo que falta contra lo que había es venta reportada." />
      {data.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <ScanButton
            label="Contar escaneando"
            title="Contar escaneando"
            continuous
            disabled={actor.readOnly}
            hint="El conteo empieza en cero: cada lectura suma uno a lo que queda en el local."
            feedback={scanNote}
            onCode={onScan}
          />
          {scanned ? <p className="text-sm text-muted">Contando con el escáner: lo que no escaneaste cuenta como vendido.</p> : null}
        </div>
      ) : null}
      {data.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Este local no tiene producto en consignación">
          Puedes registrar la visita igual (con notas), o pedirle producto desde su ficha.
        </EmptyState>
      ) : (
        <ul className="grid gap-2">
          {data.map((l) => {
            const c = value(l.productId, l.qty);
            const sold = l.qty - c;
            return (
              <li key={l.productId} className="glass flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="font-semibold">{l.name}</p>
                  <p className="text-sm text-muted">
                    Había {l.qty} en consignación{l.nextExpiry ? ` · vence ${fmtDate(l.nextExpiry)}` : ''}
                  </p>
                  <p className={`mt-1 text-sm font-semibold ${sold > 0 ? 'text-ok' : 'text-muted'}`}>{sold > 0 ? `${sold} vendidas · ${fmtMoney(sold * l.priceToStore)}` : 'Sin ventas'}</p>
                </div>
                <div className="grid justify-items-end gap-1">
                  <span className="text-xs text-muted">Contados ahora</span>
                  <QtyStepper label={`${l.name}, contados`} value={c} max={l.qty} onChange={(n) => setCounted((st) => ({ ...st, [l.productId]: n }))} unit={config.unitName.many} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Card className="mt-4 grid gap-4 p-4">
        <TextArea label="Notas de la visita" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Lo que pidió el encargado, exhibición, competencia…" />
        <div className="flex flex-wrap items-center gap-3">
          <PhotoPicker label={photo ? 'Cambiar foto' : 'Foto de la exhibición (opcional)'} onPhoto={setPhoto} />
          {photo ? <span className="text-sm text-ok">Foto lista</span> : null}
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={withGeo} onChange={(e) => setWithGeo(e.target.checked)} />
          <MapPin className="h-4 w-4 text-accent" aria-hidden /> Guardar la ubicación de la visita (una sola vez; no hay seguimiento)
        </label>
      </Card>
      <div className="sticky bottom-[76px] z-20 mt-5 flex flex-wrap items-center justify-end gap-3 lg:bottom-4 lg:justify-start">
        <p className="glass px-4 py-2 text-sm font-semibold">
          {soldUnits} vendidas · <span className="glow tabular">{fmtMoney(soldAmount)}</span>
        </p>
        <Button type="submit" variant="primary" big icon={CheckCircle2} busy={busy} disabled={actor.readOnly}>
          Guardar visita
        </Button>
      </div>
    </form>
  );
}

// ---------- Entregas ----------

type DTab = Delivery['status'];

export function DeliveriesPage() {
  const { ctx, actor } = useLine();
  const { data, error, loading } = useAsync(() => listDeliveries(ctx), [ctx]);
  const initial: DTab = actor.role === 'admin' ? 'solicitada' : 'preparada';
  const [tab, setTab] = useState<DTab>(initial);
  const by = (s: DTab) => (data ?? []).filter((d) => d.status === s);
  const subtitle =
    actor.role === 'admin'
      ? 'El vendedor pide, administración aprueba y prepara, y el local firma la nota al recibir. Recién ahí baja el almacén.'
      : actor.role === 'seller'
        ? 'Lo que pediste para tus locales y lo que está listo para llevar.'
        : 'Lo que viene en camino a tu tienda y lo que ya recibiste.';
  return (
    <>
      <PageHeader title="Entregas en consignación" subtitle={subtitle} />
      <div className="mb-4">
        <Tabs<DTab>
          label="Entregas por estado"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'solicitada', label: 'Por preparar', count: by('solicitada').length },
            { value: 'preparada', label: 'Listas para entregar', count: by('preparada').length },
            { value: 'entregada', label: 'Entregadas', count: by('entregada').length },
            { value: 'rechazada', label: 'Rechazadas', count: by('rechazada').length },
          ]}
        />
      </div>
      {loading && !data ? <Loading rows={3} /> : null}
      {error ? <ErrorBox error={error} /> : null}
      {data && by(tab).length === 0 ? <DeliveryEmpty /> : null}
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {by(tab)
          .slice(0, 60)
          .map((d) => (
            <li key={d.id}>
              <DeliveryCard d={d} showStore={actor.role !== 'store'} />
            </li>
          ))}
      </ul>
    </>
  );
}

export function DeliveryNotePrintPage() {
  const { id = '' } = useParams();
  const { ctx, p, config, actor } = useLine();
  const fromHub = (useLocation().state as { from?: string } | null)?.from === 'contratos';
  const list = useAsync(() => listDeliveries(ctx), [ctx]);
  const wh = useAsync(() => getWarehouse(ctx), [ctx]);
  const d = list.data?.find((x) => x.id === id);
  if (list.loading && !list.data) return <Loading rows={3} />;
  if (list.error) return <ErrorBox error={list.error} />;
  if (!d) return <EmptyState icon={Truck} title="No encontré esa entrega" />;
  const back = fromHub || actor.role === 'store' ? { to: p('contratos'), label: actor.role === 'store' ? 'Mis contratos' : 'Contratos' } : { to: p('entregas'), label: 'Entregas' };
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap justify-between gap-2">
        <LinkButton to={back.to} variant="ghost">
          ‹ {back.label}
        </LinkButton>
        {d.templateId ? null : (
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>
            Imprimir o guardar como PDF
          </Button>
        )}
      </div>
      {d.templateId ? (
        <DeliveryNotePdf d={d} />
      ) : (
        <article className="print-sheet mx-auto max-w-[70ch] rounded-[20px] bg-papel px-6 py-8 text-papel-tinta">
          <h1 className="font-display text-3xl font-semibold">Nota de entrega {d.code}</h1>
          <p className="mt-1 text-sm text-papel-suave">
            {config.companyName} · desde {wh.data?.name ?? 'el almacén'} · mercancía en consignación: sigue siendo de la empresa hasta que se vende.
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-papel-suave">Local</dt>
              <dd className="font-semibold">{d.storeName}</dd>
            </div>
            <div>
              <dt className="text-papel-suave">Vendedor</dt>
              <dd className="font-semibold">{d.sellerName}</dd>
            </div>
            <div>
              <dt className="text-papel-suave">Solicitada</dt>
              <dd>{fmtDateTime(d.requestedAt)}</dd>
            </div>
            <div>
              <dt className="text-papel-suave">Entregada</dt>
              <dd>{d.deliveredAt ? fmtDateTime(d.deliveredAt) : '—'}</dd>
            </div>
          </dl>
          <table className="mt-6 w-full text-sm">
            <thead>
              <tr className="border-b border-papel-linea text-left">
                <th className="py-2">Producto</th>
                <th className="py-2 text-right">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {d.itemsView
                .filter((i) => (i.preparedQty ?? i.qty) > 0)
                .map((i) => (
                  <tr key={i.productId} className="border-b border-papel-linea">
                    <td className="py-2">{i.name}</td>
                    <td className="py-2 text-right tabular">{i.preparedQty ?? i.qty}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {d.receivedSignature ? (
            <div className="mt-8">
              <img src={d.receivedSignature.image} alt={`Firma de ${d.receivedSignature.name}`} className="h-16 w-auto" />
              <p className="border-t border-papel-tinta pt-1.5 text-sm">
                Recibió (dueño o encargado del local): <b>{d.receivedSignature.name}</b> · {fmtDateTime(d.receivedSignature.signedAt)}
              </p>
            </div>
          ) : null}
          <p className="mt-8 text-xs text-papel-suave">Firma de demostración registrada en la aplicación.</p>
        </article>
      )}
    </>
  );
}

/** Nota de entrega sobre la plantilla PDF que estaba activa al recibir. */
function DeliveryNotePdf({ d }: { d: DeliveryView }) {
  const { ctx } = useLine();
  const store = useAsync(() => loadStoreForActor(ctx, d.storeId), [ctx, d.storeId]);
  if (store.error) return <ErrorBox error={store.error} />;
  if (!store.data) return <Loading rows={3} />;
  return (
    <DeliveryPdfView
      delivery={d}
      storeName={d.storeName}
      sellerName={d.sellerName}
      address={`${store.data.address}, ${store.data.city}`}
      lines={d.itemsView.filter((i) => (i.preparedQty ?? i.qty) > 0).map((i) => ({ name: i.name, qty: i.preparedQty ?? i.qty }))}
    />
  );
}

// ---------- Pedidos de los locales ----------

type OTab = 'curso' | 'entregados' | 'cancelados';

export function OrdersPage() {
  const { ctx, actor, p } = useLine();
  const { data, error, loading } = useAsync(() => listReorders(ctx), [ctx]);
  const [tab, setTab] = useState<OTab>('curso');
  const groups: Record<OTab, ReorderView[]> = {
    curso: (data ?? []).filter((r) => r.status === 'enviado' || r.status === 'confirmado' || r.status === 'preparado'),
    entregados: (data ?? []).filter((r) => r.status === 'entregado'),
    cancelados: (data ?? []).filter((r) => r.status === 'cancelado'),
  };
  const subtitle =
    actor.role === 'store'
      ? 'Lo que le pediste a tu vendedor y en qué va.'
      : actor.role === 'seller'
        ? 'Lo que piden tus locales. Confírmalo para que el almacén lo prepare.'
        : 'Pedidos de los locales: el vendedor confirma, administración prepara y se entrega.';
  return (
    <>
      <PageHeader
        title={actor.role === 'store' ? 'Mis pedidos' : 'Pedidos de los locales'}
        subtitle={subtitle}
        actions={
          actor.role === 'store' && !actor.readOnly ? (
            <LinkButton to={p('pedir')} variant="primary" big icon={ShoppingBag}>
              Pedir más
            </LinkButton>
          ) : null
        }
      />
      <div className="mb-4">
        <Tabs<OTab>
          label="Pedidos por estado"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'curso', label: 'En curso', count: groups.curso.length },
            { value: 'entregados', label: 'Entregados', count: groups.entregados.length },
            { value: 'cancelados', label: 'Cancelados', count: groups.cancelados.length },
          ]}
        />
      </div>
      {loading && !data ? <Loading rows={3} /> : null}
      {error ? <ErrorBox error={error} /> : null}
      {data && groups[tab].length === 0 ? (
        <EmptyState icon={ClipboardList} title={tab === 'curso' ? 'No hay pedidos en curso' : 'Nada por aquí'} action={actor.role === 'store' && tab === 'curso' ? <LinkButton to={p('pedir')} variant="primary" icon={ShoppingBag}>Pedir más producto</LinkButton> : undefined}>
          {actor.role === 'store' && tab === 'curso' ? 'Toca «Pedir más producto» y le llega el aviso a tu vendedor.' : undefined}
        </EmptyState>
      ) : null}
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {groups[tab].slice(0, 60).map((r) => (
          <li key={r.id}>
            <OrderCard r={r} />
          </li>
        ))}
      </ul>
    </>
  );
}

const ORDER_STEPS: Reorder['status'][] = ['enviado', 'confirmado', 'preparado', 'entregado'];

function OrderCard({ r }: { r: ReorderView }) {
  const { ctx, actor, p } = useLine();
  const { run, busy } = useAction();
  const step = ORDER_STEPS.indexOf(r.status);
  const canConfirm = !actor.readOnly && r.status === 'enviado' && (actor.role === 'admin' || actor.role === 'seller');
  const canCancel = !actor.readOnly && r.status === 'enviado';
  const short = r.itemsView.some((i) => i.available < i.qty);
  return (
    <article className="glass p-4" aria-label={`Pedido ${r.code}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-ink">
            {r.code}
            {actor.role !== 'store' ? (
              <>
                {' '}
                ·{' '}
                <Link to={p(`locales/${r.storeId}`)} className="underline">
                  {r.storeName}
                </Link>
              </>
            ) : null}
          </p>
          <p className="text-sm text-muted">
            {fmtDateTime(r.createdAt)}
            {actor.role === 'admin' ? ` · ${r.sellerName}` : ''}
          </p>
        </div>
        <Pill tone={r.status === 'entregado' ? 'ok' : r.status === 'cancelado' ? 'danger' : r.status === 'enviado' ? 'warn' : 'accent'} dot>
          {REORDER_STATUS_LABEL[r.status]}
        </Pill>
      </div>
      {r.status !== 'cancelado' ? (
        <ol className="mt-3 grid grid-cols-4 gap-1" aria-label="Avance del pedido">
          {ORDER_STEPS.map((s, i) => (
            <li key={s} className="grid gap-1">
              <span className={`h-1.5 rounded-full ${i <= step ? 'bg-accent' : 'bg-surface-3'}`} />
              <span className={`text-[0.7rem] ${i <= step ? 'text-ink' : 'text-faint'}`}>{['Enviado', 'Confirmado', 'Preparado', 'Entregado'][i]}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <ul className="mt-3 grid gap-1 text-sm">
        {r.itemsView.map((i) => (
          <li key={i.productId} className="flex justify-between gap-2">
            <span className="truncate">{i.name}</span>
            <span className="tabular">
              <b>{i.qty}</b>
              {r.status === 'enviado' || r.status === 'confirmado' ? <span className={i.available < i.qty ? 'text-warn' : 'text-muted'}> · hay {i.available}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {r.note ? <p className="mt-2 text-sm text-muted">«{r.note}»</p> : null}
      {short && (r.status === 'enviado' || r.status === 'confirmado') ? <p className="mt-2 text-sm text-warn">Parte de esto no hay en almacén: lo que falte quedará como demanda no atendida.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {canConfirm ? (
          <Button variant="primary" icon={CheckCircle2} busy={busy} onClick={() => void run(() => confirmReorder(ctx, r.id), `${r.code} confirmado: pasa al almacén para preparar.`)}>
            Confirmar pedido
          </Button>
        ) : null}
        {canCancel ? (
          <Button variant="ghost" icon={XCircle} busy={busy} onClick={() => void run(() => cancelReorder(ctx, r.id, actor.role === 'store' ? 'Cancelado por el local' : 'Cancelado por el vendedor'), 'Pedido cancelado.')}>
            Cancelar
          </Button>
        ) : null}
        {r.deliveryId && actor.role !== 'store' ? (
          <Link to={p('entregas')} className="btn btn-ghost">
            <Truck aria-hidden /> Ver la entrega
          </Link>
        ) : null}
      </div>
    </article>
  );
}

// ---------- «Pedir más» (local) ----------

export function StoreOrderPage() {
  return (
    <RoleGate roles={['store']} message="Esta pantalla es la del local para pedir más producto. El vendedor pide desde la ficha de cada local.">
      <StoreOrder />
    </RoleGate>
  );
}

function StoreOrder() {
  const { ctx, actor, p, line } = useLine();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { run, busy } = useAction();
  const products = useAsync(() => listProducts(ctx), [ctx]);
  const preselect = params.get('producto');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const effective = useMemo(() => {
    if (!preselect || qty[preselect] !== undefined) return qty;
    const pr = products.data?.find((v) => v.product.id === preselect);
    return pr ? { ...qty, [preselect]: defaultOrderQty(pr.product) } : qty;
  }, [qty, preselect, products.data]);
  const items = Object.entries(effective)
    .filter(([, q]) => q > 0)
    .map(([productId, q]) => ({ productId, qty: q }));
  const units = items.reduce((a, i) => a + i.qty, 0);
  const unitsLabel = mixedUnitsText(items.flatMap((i) => {
    const v = products.data?.find((x) => x.product.id === i.productId);
    return v ? [{ product: v.product, qty: i.qty }] : [];
  }));
  const earning = items.reduce((a, i) => a + i.qty * (products.data?.find((v) => v.product.id === i.productId)?.storeEarning ?? 0), 0);
  const now = ctx.now();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!actor.storeId) return;
        void run(async () => {
          const r = await createReorder(ctx, { storeId: actor.storeId!, items, note });
          nav(p('pedidos'));
          return r;
        }, (r) => `Pedido ${r.code} enviado. Le llegó el aviso a tu vendedor.`);
      }}
    >
      <PageHeader title="Pedir más producto" subtitle="Elige cuánto quieres de cada producto. Tu vendedor lo confirma y el almacén lo prepara; firmas la nota al recibir." />
      {products.loading && !products.data ? <Loading rows={4} /> : null}
      {products.error ? <ErrorBox error={products.error} /> : null}
      <ul className="grid gap-2">
        {(products.data ?? []).map((v) => {
          const s = v.stock;
          return (
            <li key={v.product.id} className="glass flex flex-wrap items-center gap-3 p-3">
              <div className={line === 'tabaco' ? 'h-10 w-28 flex-none' : 'h-16 w-16 flex-none rounded-xl bg-surface-2 p-1'}>
                <ProductThumb product={v.product} loadPhoto={(id) => getPhoto(ctx, id)} />
              </div>
              <div className="min-w-0 flex-1 basis-40">
                <p className="font-semibold">{v.product.name}</p>
                <p className="text-sm text-muted">
                  Ganas <b className="text-ok">{fmtMoney(v.storeEarning)}</b> por {unitOf(v.product).one} · {packText(v.product).toLowerCase()}
                </p>
                <p className={`text-sm ${s.available > 0 ? 'text-muted' : 'text-warn'}`}>
                  {s.available > 0 ? `Hay ${unitsText(v.product, s.available)} en el almacén` : 'Sin disponibilidad ahora'}
                  {s.nextArrival ? ` · llegan ${s.nextArrival.qty} el ${fmtDate(s.nextArrival.eta)} (${fmtRelativeDays(s.nextArrival.eta, now)})` : ''}
                </p>
              </div>
              <QtyStepper label={v.product.name} pack={orderStep(v.product)} value={effective[v.product.id] ?? 0} onChange={(n) => setQty((st) => ({ ...st, [v.product.id]: n }))} unit={unitOf(v.product).many} />
            </li>
          );
        })}
      </ul>
      <Card className="mt-4 p-4">
        <TextArea label="Nota para tu vendedor (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: para el fin de semana" />
      </Card>
      <div className="sticky bottom-[76px] z-20 mt-5 flex flex-wrap items-center justify-end gap-3 lg:bottom-4 lg:justify-start">
        {units > 0 ? (
          <p className="glass px-4 py-2 text-sm font-semibold">
            {unitsLabel} · ganarías <span className="glow tabular">{fmtMoney(earning)}</span> al PVP sugerido
          </p>
        ) : null}
        <Button type="submit" variant="primary" big icon={Send} busy={busy} disabled={units === 0 || actor.readOnly}>
          Enviar pedido
        </Button>
      </div>
    </form>
  );
}
