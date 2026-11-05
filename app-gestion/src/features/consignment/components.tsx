// Piezas de consignación que se usan en varias pantallas: tarjeta de entrega con sus acciones,
// pedir producto para un local, recibir con firma, reportar ventas y devoluciones o mermas.
import { CheckCircle2, FileText, MapPin, PackageCheck, Printer, Send, Truck, Undo2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { Store } from '../../data/types';
import { consignmentCheck } from '../../domain/compliance';
import type { NewPhoto } from '../../lib/image';
import { fmtMoney } from '../../lib/money';
import { fmtDate, fmtDateTime, fmtRelativeDays } from '../../lib/time';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { listProducts } from '../../services/catalog';
import {
  DELIVERY_STATUS_LABEL,
  prepareDelivery,
  receiveDelivery,
  recordReturn,
  rejectDelivery,
  reportSales,
  requestDelivery,
  type DeliveryView,
} from '../../services/consignment';
import { loadStoreForActor, type ConsignmentLine } from '../../services/stores';
import { Button, Pill, QtyStepper, Sheet, Tabs, TextArea, TextInput } from '../../ui/kit';
import { PhotoPicker } from '../../ui/media';
import { SignatureField, askLocation } from '../../ui/signature';
import { useAction } from '../../ui/toast';

const ORIGIN_LABEL: Record<DeliveryView['origin'], string> = {
  vendedor: 'Pedida por el vendedor',
  pedido_local: 'Pedido del local',
  administracion: 'Enviada por administración',
};

export function DeliveryCard({ d, showStore }: { d: DeliveryView; showStore?: boolean }) {
  const { ctx, actor, p } = useLine();
  const { run, busy } = useAction();
  const [receive, setReceive] = useState(false);
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState('');
  const isAdmin = actor.role === 'admin';
  const canReceive = !actor.readOnly && d.status === 'preparada' && (isAdmin || actor.role === 'seller' || actor.role === 'store');
  const units = d.items.reduce((a, i) => a + (i.preparedQty ?? i.qty), 0);
  const tone = d.status === 'entregada' ? 'ok' : d.status === 'preparada' ? 'accent' : d.status === 'rechazada' ? 'danger' : 'warn';

  const prepare = () =>
    void run(
      async () => {
        const store = await loadStoreForActor(ctx, d.storeId);
        return prepareDelivery(ctx, d.id, { approveStore: store.status === 'firmado' });
      },
      (r) => (r.prepared === 0 ? `No había nada de esto en almacén: quedó como demanda no atendida (${r.short} u.).` : r.short ? `Preparada con ${r.prepared} u.; faltaron ${r.short} (demanda no atendida).` : `Preparada: ${r.prepared} u. listas para entregar.`),
    );

  return (
    <article className="glass p-4" aria-label={`Entrega ${d.code}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-ink">
            {d.code}
            {showStore ? (
              <>
                {' '}
                ·{' '}
                <Link to={p(`locales/${d.storeId}`)} className="underline">
                  {d.storeName}
                </Link>
              </>
            ) : null}
          </p>
          <p className="text-sm text-muted">
            {ORIGIN_LABEL[d.origin]} · {d.sellerName} · {fmtDate(d.requestedAt)}
          </p>
        </div>
        <Pill tone={tone} dot>
          {DELIVERY_STATUS_LABEL[d.status]}
        </Pill>
      </div>
      <ul className="mt-2 grid gap-1 text-sm">
        {d.itemsView.map((i) => (
          <li key={i.productId} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{i.name}</span>
            <span className="tabular text-muted">
              {i.preparedQty !== undefined && i.preparedQty !== i.qty ? (
                <>
                  <span className="font-semibold text-ink">{i.preparedQty}</span> de {i.qty}
                </>
              ) : (
                <span className="font-semibold text-ink">{i.qty}</span>
              )}
              {isAdmin && d.status === 'solicitada' && i.available !== undefined ? <span className={i.available < i.qty ? ' text-warn' : ''}> · hay {i.available}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {d.note ? <p className="mt-2 text-sm text-muted">«{d.note}»</p> : null}
      {d.status === 'entregada' && d.receivedSignature ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-papel px-3 py-2 text-papel-tinta">
          <img src={d.receivedSignature.image} alt={`Firma de ${d.receivedSignature.name}`} className="h-10 w-auto" />
          <p className="text-sm">
            Recibió <b>{d.receivedSignature.name}</b> · {fmtDateTime(d.receivedSignature.signedAt)}
          </p>
        </div>
      ) : null}
      {d.status === 'rechazada' && d.rejectedReason ? <p className="mt-2 text-sm text-danger">Rechazada: {d.rejectedReason}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {isAdmin && !actor.readOnly && d.status === 'solicitada' ? (
          <>
            <Button variant="primary" icon={PackageCheck} busy={busy} onClick={prepare}>
              Aprobar y preparar
            </Button>
            <Button variant="ghost" icon={XCircle} onClick={() => setReject(true)}>
              Rechazar
            </Button>
          </>
        ) : null}
        {canReceive ? (
          <Button variant="primary" icon={CheckCircle2} onClick={() => setReceive(true)}>
            Recibir con firma
          </Button>
        ) : null}
        {d.status === 'entregada' ? (
          <Link to={p(`entregas/${d.id}/imprimir`)} className="btn btn-ghost">
            <Printer aria-hidden /> Nota de entrega
          </Link>
        ) : null}
      </div>
      {receive ? <ReceiveSheet d={d} units={units} onClose={() => setReceive(false)} /> : null}
      <Sheet open={reject} onClose={() => setReject(false)} title={`Rechazar ${d.code}`}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await rejectDelivery(ctx, d.id, reason);
              setReject(false);
            }, 'Entrega rechazada.');
          }}
        >
          <TextInput label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por ejemplo: el local tiene pagos vencidos" />
          <Button type="submit" variant="danger" busy={busy}>
            Rechazar entrega
          </Button>
        </form>
      </Sheet>
    </article>
  );
}

function ReceiveSheet({ d, units, onClose }: { d: DeliveryView; units: number; onClose: () => void }) {
  const { ctx, actor } = useLine();
  const { run, busy } = useAction();
  const store = useAsync(() => loadStoreForActor(ctx, d.storeId), [ctx, d.storeId]);
  const [name, setName] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [withGeo, setWithGeo] = useState(true);
  const who = name ?? store.data?.managerName ?? '';
  return (
    <Sheet open onClose={onClose} title={`Recibir ${d.code}`}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const geo = withGeo ? await askLocation() : undefined;
            await receiveDelivery(ctx, d.id, { name: who, image: sig ?? '', geo });
            onClose();
          }, `Entregado: ${units} unidades en consignación en ${d.storeName}.`);
        }}
      >
        <p className="text-muted">
          {actor.role === 'store' ? 'Revisa lo que llegó y firma la nota de entrega.' : 'El encargado del local revisa lo que llega y firma en tu teléfono.'} Al firmar, sube lo que el local tiene en consignación y baja el almacén.
        </p>
        <ul className="grid gap-1 rounded-xl bg-surface-2 p-3 text-sm">
          {d.itemsView
            .filter((i) => (i.preparedQty ?? 0) > 0)
            .map((i) => (
              <li key={i.productId} className="flex justify-between">
                <span>{i.name}</span>
                <span className="font-semibold tabular">{i.preparedQty}</span>
              </li>
            ))}
        </ul>
        <TextInput label="Nombre de quien recibe" value={who} onChange={(e) => setName(e.target.value)} />
        <SignatureField label="Firma de quien recibe" onChange={setSig} />
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={withGeo} onChange={(e) => setWithGeo(e.target.checked)} />
          <MapPin className="h-4 w-4 text-accent" aria-hidden /> Guardar la ubicación de la entrega (si el teléfono la da)
        </label>
        <Button type="submit" variant="primary" big icon={CheckCircle2} busy={busy} disabled={!sig || who.trim().length < 3}>
          Firmar y recibir
        </Button>
      </form>
    </Sheet>
  );
}

/** El vendedor (o administración) pide producto en consignación para un local. */
export function RequestDeliverySheet({ open, onClose, store }: { open: boolean; onClose: () => void; store: Store }) {
  const { ctx, line, config } = useLine();
  const { run, busy } = useAction();
  const products = useAsync(() => (open ? listProducts(ctx) : Promise.resolve([])), [ctx, open]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const check = consignmentCheck(line, store, ctx.now());
  const items = Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([productId, q]) => ({ productId, qty: q }));
  const total = items.reduce((a, i) => a + i.qty, 0);
  return (
    <Sheet open={open} onClose={onClose} title={`Pedir producto para ${store.name}`} wide>
      {!check.ok ? (
        <p className="rounded-xl bg-danger-soft p-3 text-danger" role="alert">
          {check.reason}
        </p>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await requestDelivery(ctx, { storeId: store.id, items, note });
              setQty({});
              setNote('');
              onClose();
            }, `Pedido enviado a administración: ${total} ${config.unitName.many}.`);
          }}
        >
          <p className="text-muted">Administración lo aprueba y lo prepara. Cuando esté listo, el local firma la nota de entrega al recibir.</p>
          <ul className="grid gap-2">
            {(products.data ?? []).map((v) => (
              <li key={v.product.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="font-semibold">{v.product.name}</p>
                  <p className="text-sm text-muted">
                    Hay {v.stock.available} · {fmtMoney(v.product.priceToStore)} al local
                    {v.stock.available === 0 && v.stock.nextArrival ? ` · llegan ${v.stock.nextArrival.qty} ${fmtRelativeDays(v.stock.nextArrival.eta, ctx.now())}` : ''}
                  </p>
                </div>
                <QtyStepper label={v.product.name} pack={v.product.packSize} value={qty[v.product.id] ?? 0} onChange={(n) => setQty((s) => ({ ...s, [v.product.id]: n }))} unit={config.unitName.many} />
              </li>
            ))}
          </ul>
          <TextArea label="Nota para administración (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" variant="primary" big icon={Send} busy={busy} disabled={total === 0}>
            Enviar pedido ({total} u.)
          </Button>
        </form>
      )}
    </Sheet>
  );
}

/** Ventas que reporta el local (o su vendedor) sin esperar el conteo. */
export function ReportSalesSheet({ open, onClose, store, lines }: { open: boolean; onClose: () => void; store: Store; lines: ConsignmentLine[] }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [qty, setQty] = useState<Record<string, number>>({});
  const items = Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([productId, q]) => ({ productId, qty: q }));
  const total = useMemo(() => items.reduce((a, i) => a + i.qty * (lines.find((l) => l.productId === i.productId)?.priceToStore ?? 0), 0), [items, lines]);
  return (
    <Sheet open={open} onClose={onClose} title="Reportar ventas">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await reportSales(ctx, { storeId: store.id, items });
            setQty({});
            onClose();
          }, 'Ventas reportadas. Entran en la próxima liquidación.');
        }}
      >
        <p className="text-muted">Lo vendido baja de la consignación y entra en la próxima liquidación al precio al local.</p>
        {lines.length === 0 ? <p className="text-muted">No hay producto en consignación.</p> : null}
        <ul className="grid gap-2">
          {lines.map((l) => (
            <li key={l.productId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-3">
              <div className="min-w-0 flex-1 basis-40">
                <p className="font-semibold">{l.name}</p>
                <p className="text-sm text-muted">Tiene {l.qty} en consignación</p>
              </div>
              <QtyStepper label={l.name} value={qty[l.productId] ?? 0} max={l.qty} onChange={(n) => setQty((s) => ({ ...s, [l.productId]: n }))} />
            </li>
          ))}
        </ul>
        <Button type="submit" variant="primary" big icon={FileText} busy={busy} disabled={items.length === 0}>
          Reportar ventas ({fmtMoney(total)} al precio al local)
        </Button>
      </form>
    </Sheet>
  );
}

/** Devolución al almacén o merma en el local, con motivo y foto. */
export function ReturnSheet({ open, onClose, store, lines }: { open: boolean; onClose: () => void; store: Store; lines: ConsignmentLine[] }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [kind, setKind] = useState<'devolucion' | 'merma'>('devolucion');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState<NewPhoto | undefined>();
  const items = Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([productId, q]) => ({ productId, qty: q }));
  return (
    <Sheet open={open} onClose={onClose} title="Devolución o merma">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await recordReturn(ctx, { storeId: store.id, kind, items, reason, photo });
            setQty({});
            setReason('');
            setPhoto(undefined);
            onClose();
          }, kind === 'devolucion' ? 'Devolución registrada: volvió al almacén.' : 'Merma registrada.');
        }}
      >
        <Tabs<'devolucion' | 'merma'>
          label="Tipo"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'devolucion', label: 'Devolución al almacén' },
            { value: 'merma', label: 'Merma (daño, vencido)' },
          ]}
        />
        <p className="text-sm text-muted">{kind === 'devolucion' ? 'El producto vuelve al almacén por el mismo lote.' : 'El producto sale del inventario y su costo cuenta como merma.'}</p>
        <ul className="grid gap-2">
          {lines.map((l) => (
            <li key={l.productId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-3">
              <div className="min-w-0 flex-1 basis-40">
                <p className="font-semibold">{l.name}</p>
                <p className="text-sm text-muted">
                  Tiene {l.qty}
                  {l.nextExpiry ? ` · vence ${fmtDate(l.nextExpiry)}` : ''}
                </p>
              </div>
              <QtyStepper label={l.name} value={qty[l.productId] ?? 0} max={l.qty} onChange={(n) => setQty((s) => ({ ...s, [l.productId]: n }))} />
            </li>
          ))}
        </ul>
        <TextInput label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'devolucion' ? 'No rota en este local' : 'Caja dañada, café vencido…'} />
        <div className="flex flex-wrap items-center gap-2">
          <PhotoPicker label={photo ? 'Cambiar foto' : 'Foto (opcional)'} onPhoto={setPhoto} />
          {photo ? <span className="text-sm text-ok">Foto lista</span> : null}
        </div>
        <Button type="submit" variant={kind === 'merma' ? 'danger' : 'primary'} big icon={kind === 'merma' ? XCircle : Undo2} busy={busy} disabled={items.length === 0}>
          Registrar {kind === 'devolucion' ? 'devolución' : 'merma'}
        </Button>
      </form>
    </Sheet>
  );
}

export function DeliveryEmpty() {
  return (
    <div className="glass flex items-center gap-3 p-4 text-muted">
      <Truck className="h-5 w-5" aria-hidden /> No hay entregas en esta lista.
    </div>
  );
}
