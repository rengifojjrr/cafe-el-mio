// Administración → «Buscar código»: se escanea o se escribe cualquier código y aparece lo que es.
// Un producto (por código de barras o SKU) con sus existencias; una caja con su camino completo
// (importación, bulto, fábrica, torcedor, empacador, fecha y a qué entrega, local o factura fue);
// una entrega, una factura o una importación. Si no es nada, se puede asignar a un producto.
import { Box, Boxes, Factory, FileText, Link2, PackageSearch, Printer, ScanBarcode, Search, Ship, Store, Tag, Truck, User } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { stockText, unitsText } from '../../domain/products';
import { arrivalStatusLabel } from '../../lines/config';
import { cleanCode } from '../../lib/barcode';
import { fmtMoney } from '../../lib/money';
import { fmtDate, fmtDateTime, fmtRelativeDays } from '../../lib/time';
import { type CaseTrace, type CodeLookup, lookupCode } from '../../services/codes';
import { DELIVERY_STATUS_LABEL } from '../../services/consignment';
import { Button, Card, EmptyState, ErrorBox, LinkButton, Loading, PageHeader, Pill, TextInput } from '../../ui/kit';
import { ScanButton } from '../../ui/scanner';
import { useAction } from '../../ui/toast';
import { RoleGate } from '../common';
import { buildLabelsUrl, LabelsSheet, PdfReady } from '../labels/LabelsSheet';
import { caseLabel } from '../labels/specs';
import { AssignCodeSheet } from './AssignCodeSheet';

export function CodesPage() {
  return (
    <RoleGate roles={['admin']} message="«Buscar código» es de administración. Para pedir o contar, el escáner está en cada pantalla.">
      <Codes />
    </RoleGate>
  );
}

function Codes() {
  const { ctx, actor } = useLine();
  const [params, setParams] = useSearchParams();
  const q = params.get('c') ?? '';
  const [typed, setTyped] = useState('');
  const [assign, setAssign] = useState<string | null>(null);
  const result = useAsync(() => (q ? lookupCode(ctx, q) : Promise.resolve(null)), [ctx, q]);
  const search = (raw: string) => {
    const code = cleanCode(raw);
    if (!code) return;
    setParams({ c: code });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    search(typed);
    setTyped('');
  };
  const canWrite = !actor.readOnly;
  return (
    <>
      <PageHeader title="Buscar código" subtitle="Escanea o escribe un código de barras, un SKU, el número de una caja, de una entrega o de una factura." />
      <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={submit}>
          <TextInput label="Código" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="2000000010138, TB-MZ-TOR-HAB52, C-IMP-…" autoComplete="off" autoCapitalize="characters" />
          <Button type="submit" icon={Search} disabled={!typed.trim()}>
            Buscar
          </Button>
        </form>
        <ScanButton variant="primary" label="Escanear" title="Escanear un código" onCode={(code) => search(code)} />
      </Card>
      <div className="mt-5">
        {!q ? (
          <EmptyState icon={ScanBarcode} title="Escanea cualquier código">
            Con la cámara, desde una foto o escribiéndolo. Sirve para un producto, una caja con trazabilidad, una entrega, una factura o una importación.
          </EmptyState>
        ) : null}
        {q && result.loading && !result.data ? <Loading rows={2} /> : null}
        {result.error ? <ErrorBox error={result.error} /> : null}
        {result.data ? <Result r={result.data} onAssign={canWrite ? () => setAssign(result.data!.code) : undefined} /> : null}
      </div>
      <AssignCodeSheet code={assign} onClose={() => setAssign(null)} onAssigned={() => result.reload()} />
    </>
  );
}

function Result({ r, onAssign }: { r: CodeLookup; onAssign?: () => void }) {
  switch (r.kind) {
    case 'product':
      return <ProductResult r={r} />;
    case 'case':
      return <CaseResult trace={r.trace} />;
    case 'delivery':
      return <DeliveryResult r={r} />;
    case 'invoice':
      return <InvoiceResult r={r} />;
    case 'arrival':
      return <ArrivalResult r={r} />;
    case 'none':
      return (
        <EmptyState
          icon={PackageSearch}
          title={`No conozco el código ${r.code}`}
          action={
            onAssign ? (
              <Button variant="primary" icon={Link2} onClick={onAssign}>
                Asignar este código a un producto
              </Button>
            ) : undefined
          }
        >
          No es de ningún producto, caja, entrega, factura ni importación de esta línea.
        </EmptyState>
      );
  }
}

function Kind({ icon: Icon, children }: { icon: typeof Box; children: ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-accent">
      <Icon className="h-4 w-4" aria-hidden /> {children}
    </p>
  );
}

function ProductResult({ r }: { r: Extract<CodeLookup, { kind: 'product' }> }) {
  const { ctx, p, line } = useLine();
  const [labels, setLabels] = useState(false);
  const pr = r.view.product;
  const s = r.view.stock;
  const now = ctx.now();
  return (
    <Card className="p-4 sm:p-5" aria-label={`Producto ${pr.name}`}>
      <Kind icon={Tag}>Producto · {r.by === 'barcode' ? 'por su código de barras' : 'por su SKU'}</Kind>
      <h2 className="text-xl font-bold text-ink">{pr.name}</h2>
      <p className="text-sm break-all text-muted">
        SKU {pr.sku}
        {pr.barcode ? ` · código ${pr.barcode}` : ''}
      </p>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-sm text-muted">Disponible en almacén</dt>
          <dd className={`text-lg font-bold tabular ${s.available > 0 ? 'text-ink' : 'text-warn'}`}>{stockText(pr, s.available)}</dd>
          {s.reserved ? <dd className="text-sm text-muted">{unitsText(pr, s.reserved)} apartados para entregas</dd> : null}
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-sm text-muted">En consignación</dt>
          <dd className="text-lg font-bold tabular text-ink">{unitsText(pr, s.consignment)}</dd>
          <dd className="text-sm text-muted">en {s.storesHolding} locales</dd>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3 sm:col-span-2">
          <dt className="text-sm text-muted">Próxima llegada</dt>
          <dd className="font-semibold text-ink">
            {s.nextArrival ? `${unitsText(pr, s.nextArrival.qty)} en ${s.nextArrival.code} (${arrivalStatusLabel(line, s.nextArrival.status)}), ${fmtRelativeDays(s.nextArrival.eta, now)}` : 'No hay una llegada programada'}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <LinkButton to={p(`catalogo/${pr.id}`)} icon={Box}>
          Ver la ficha
        </LinkButton>
        <Button icon={Printer} onClick={() => setLabels(true)}>
          Imprimir etiquetas
        </Button>
      </div>
      <LabelsSheet open={labels} onClose={() => setLabels(false)} initialIds={[pr.id]} />
    </Card>
  );
}

function Step({ icon: Icon, title, children }: { icon: typeof Box; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="relative grid grid-cols-[2.5rem_1fr] gap-3 pb-4 last:pb-0">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 pt-1">
        <p className="font-semibold text-ink">{title}</p>
        {children ? <div className="text-sm text-muted">{children}</div> : null}
      </div>
    </li>
  );
}

function CaseResult({ trace }: { trace: CaseTrace }) {
  const { line, p } = useLine();
  const { run, busy } = useAction();
  const [url, setUrl] = useState<string | null>(null);
  const c = trace.caseUnit;
  const a = trace.arrival;
  const d = trace.delivery;
  return (
    <Card className="p-4 sm:p-5" aria-label={`Caja ${c.code}`}>
      <Kind icon={Boxes}>Caja con trazabilidad</Kind>
      <h2 className="text-xl font-bold text-ink">{trace.product?.name ?? 'Producto desconocido'}</h2>
      <p className="text-sm break-all text-muted">
        Caja {c.code}
        {trace.product ? ` · ${unitsText(trace.product, trace.product.packSize)}` : ''}
      </p>
      <ol className="mt-4" aria-label="Camino de la caja">
        <Step icon={Factory} title={c.factory}>
          {[c.roller ? `Torcedor: ${c.roller}` : '', c.packer ? `Empacador: ${c.packer}` : '', c.packedOn ? `Empacada el ${fmtDate(c.packedOn)}` : ''].filter(Boolean).join(' · ') || 'Sin datos de quién la hizo.'}
        </Step>
        <Step icon={Ship} title={a ? `Importación ${a.code}` : 'Sin importación'}>
          {a ? (
            <>
              {a.supplier} · {a.originCountry}
              {c.baleNumber ? ` · bulto ${c.baleNumber}` : ''} · {a.status === 'recibida' ? `recibida el ${fmtDate(a.receivedAt ?? a.eta)}` : arrivalStatusLabel(line, a.status).toLowerCase()}
            </>
          ) : null}
        </Step>
        {d ? (
          <Step icon={Truck} title={`Entrega ${d.code} · ${DELIVERY_STATUS_LABEL[d.status]}`}>
            {trace.storeName ? (
              <>
                A <b className="text-ink">{trace.storeName}</b>
              </>
            ) : null}
            {d.deliveredAt ? ` · entregada el ${fmtDateTime(d.deliveredAt)}` : d.preparedAt ? ` · preparada el ${fmtDateTime(d.preparedAt)}` : ''}
            {d.receivedSignature ? ` · firmó ${d.receivedSignature.name}` : ''}
          </Step>
        ) : (
          <Step icon={Boxes} title="Está en el almacén">
            Todavía no salió en ninguna entrega.
          </Step>
        )}
        {trace.invoice ? (
          <Step icon={FileText} title={`Factura ${trace.invoice.code}`}>
            {fmtMoney(trace.invoice.total)} · {fmtDate(trace.invoice.issuedAt)}
            {trace.storeName ? ` · ${trace.storeName}` : ''}
          </Step>
        ) : null}
      </ol>
      <div className="mt-2 grid gap-2">
        {url ? <PdfReady url={url} name={`caja-${cleanCode(c.code)}.pdf`} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button icon={Printer} busy={busy} onClick={() => void run(async () => setUrl(await buildLabelsUrl([caseLabel(line, c, trace.product, a?.code)], 'termica', `Caja ${c.code}`)), 'Etiqueta lista.')}>
            Imprimir la etiqueta de la caja
          </Button>
          {trace.product ? (
            <LinkButton to={p(`catalogo/${trace.product.id}`)} variant="ghost" icon={Box}>
              Ver el producto
            </LinkButton>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function DeliveryResult({ r }: { r: Extract<CodeLookup, { kind: 'delivery' }> }) {
  const { p } = useLine();
  const { delivery: d, storeName, sellerName, items, cases } = r.info;
  return (
    <Card className="p-4 sm:p-5" aria-label={`Entrega ${d.code}`}>
      <Kind icon={Truck}>Entrega en consignación</Kind>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-xl font-bold text-ink">
          {d.code} · {storeName}
        </h2>
        <Pill tone={d.status === 'entregada' ? 'ok' : d.status === 'rechazada' ? 'danger' : 'accent'} dot>
          {DELIVERY_STATUS_LABEL[d.status]}
        </Pill>
      </div>
      <p className="text-sm text-muted">
        <User className="mr-1 inline h-4 w-4" aria-hidden />
        {sellerName} · pedida el {fmtDate(d.requestedAt)}
        {d.deliveredAt ? ` · entregada el ${fmtDate(d.deliveredAt)}` : ''}
      </p>
      <ul className="mt-3 grid gap-1 text-sm">
        {items.map((i) => (
          <li key={i.productId} className="flex justify-between gap-3">
            <span className="min-w-0 break-words">{i.name}</span>
            <span className="font-semibold tabular">{unitsText({ unitName: i.unitName }, i.preparedQty ?? i.qty)}</span>
          </li>
        ))}
      </ul>
      {cases.length ? (
        <p className="mt-3 text-sm text-muted">
          <Boxes className="mr-1 inline h-4 w-4" aria-hidden />
          Cajas: {cases.map((c) => c.code).join(', ')}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <LinkButton to={p(`locales/${d.storeId}`)} icon={Store}>
          Ver el local
        </LinkButton>
        <LinkButton to={p('entregas')} variant="ghost" icon={Truck}>
          Ver entregas
        </LinkButton>
      </div>
    </Card>
  );
}

function InvoiceResult({ r }: { r: Extract<CodeLookup, { kind: 'invoice' }> }) {
  const i = r.invoice;
  return (
    <Card className="p-4 sm:p-5" aria-label={`Factura ${i.code}`}>
      <Kind icon={FileText}>Factura</Kind>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-xl font-bold text-ink">
          {i.code} · {r.storeName}
        </h2>
        <Pill tone={i.status === 'pagada' ? 'ok' : i.status === 'parcial' ? 'warn' : 'info'} dot>
          {i.status === 'pagada' ? 'Pagada' : i.status === 'parcial' ? 'Pago parcial' : 'Por cobrar'}
        </Pill>
      </div>
      <p className="mt-1 text-sm text-muted">
        {fmtDate(i.issuedAt)} · vence el {fmtDate(i.dueOn)} · total <b className="text-ink">{fmtMoney(i.total)}</b>, pagado {fmtMoney(i.paid)}
      </p>
      <ul className="mt-3 grid gap-1 text-sm">
        {i.lines.map((l) => (
          <li key={`${l.productId}-${l.pack}`} className="flex justify-between gap-3">
            <span className="min-w-0 break-words">{l.name}</span>
            <span className="tabular">{fmtMoney(l.amount)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ArrivalResult({ r }: { r: Extract<CodeLookup, { kind: 'arrival' }> }) {
  const { line, p } = useLine();
  const a = r.arrival;
  const bale = r.baleNumber ? a.bales?.find((b) => b.number === r.baleNumber) : undefined;
  return (
    <Card className="p-4 sm:p-5" aria-label={`Importación ${a.code}`}>
      <Kind icon={Ship}>{bale ? `Bulto de una importación · ${bale.status === 'pendiente' ? 'por revisar' : 'revisado'}` : a.kind === 'roast' ? 'Tanda de tostado' : 'Importación'}</Kind>
      <h2 className="text-xl font-bold text-ink">
        {bale ? `Bulto ${bale.number} · ` : ''}
        {a.code} · {a.supplier}
      </h2>
      <p className="text-sm text-muted">
        {arrivalStatusLabel(line, a.status)} · {a.status === 'recibida' ? `recibida el ${fmtDate(a.receivedAt ?? a.eta)}` : `llega el ${fmtDate(a.eta)}`}
        {a.bales?.length ? ` · ${a.bales.length} bultos` : ''}
      </p>
      <div className="mt-4">
        <LinkButton to={p(`almacen/llegadas/${a.id}`)} icon={Ship}>
          Abrir la importación
        </LinkButton>
      </div>
    </Card>
  );
}
