// Una llegada (importación o tanda de tostado): lo que trae, sus cajas con trazabilidad (opcional)
// y, en una importación, la lista de empaque y la confirmación bulto por bulto.
import { Boxes, CalendarClock, ClipboardCheck, FileSpreadsheet, Keyboard, Pencil, Plus, Printer, ScanBarcode } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import type { Arrival, CaseUnit, Product } from '../../data/types';
import { unitsText } from '../../domain/products';
import { receivedFromBales } from '../../domain/receiving';
import { arrivalStatusLabel } from '../../lines/config';
import type { LabelFormat } from '../../lib/labels-pdf';
import { fmtMoney } from '../../lib/money';
import { fmtDate, fmtRelativeDays, toIsoDate } from '../../lib/time';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { registerCases } from '../../services/cases';
import { BEFORE_CONFIRMING, arrivalDetail, startBaleCheck, type ArrivalDetail } from '../../services/receiving';
import { Button, Card, EmptyState, ErrorBox, Loading, NumberInput, PageHeader, Pill, Section, SelectInput, Sheet, Tabs, TextInput } from '../../ui/kit';
import { ScanButton } from '../../ui/scanner';
import { useAction } from '../../ui/toast';
import { RoleGate } from '../common';
import { buildLabelsUrl, FORMAT_OPTIONS, PdfReady } from '../labels/LabelsSheet';
import { caseLabel } from '../labels/specs';
import { ConfirmSection, DifferencesSection } from './bales';
import { PackingListSheet } from './packing';

export function ArrivalPage() {
  return (
    <RoleGate roles={['admin']} message="Las importaciones y los tostados los lleva administración.">
      <ArrivalScreen />
    </RoleGate>
  );
}

function ArrivalScreen() {
  const { id = '' } = useParams();
  const { ctx, p, line } = useLine();
  const detail = useAsync(() => arrivalDetail(ctx, id), [ctx, id]);
  if (detail.error) return <ErrorBox error={detail.error} />;
  if (!detail.data) return <Loading rows={4} />;
  const d = detail.data;
  const a = d.arrival;
  const done = a.status === 'recibida';
  return (
    <>
      <PageHeader
        back={{ to: `${p('almacen')}?tab=llegadas`, label: 'Almacén' }}
        title={a.code}
        subtitle={`${a.supplier}${a.originCountry ? ` · ${a.originCountry}` : ''}${a.productionLine ? ` · ${a.productionLine}` : ''}`}
        actions={
          <Pill tone={done ? 'ok' : a.status === 'confirmando' ? 'accent' : 'info'} dot>
            {arrivalStatusLabel(line, a.status)}
          </Pill>
        }
      />
      {/* Mientras se confirman los bultos, el avance va primero y lo que trae, después. */}
      {a.kind === 'import' && a.status === 'confirmando' ? <ConfirmSection d={d} /> : null}
      <div className={a.status === 'confirmando' ? 'mt-7' : ''}>
        <Summary d={d} />
      </div>
      {a.kind === 'import' ? <PackingSection d={d} /> : null}
      {d.report && d.report.checked > 0 ? <DifferencesSection d={d} report={d.report} /> : null}
      {a.kind === 'import' ? <CasesSection d={d} /> : null}
    </>
  );
}

function Summary({ d }: { d: ArrivalDetail }) {
  const { ctx } = useLine();
  const a = d.arrival;
  const done = a.status === 'recibida';
  const cost = a.items.reduce((s, i) => s + i.qty * i.unitCost, 0);
  // Con lista de empaque, al recibir entra lo contado (puede ser distinto de la lista).
  const received = done && a.bales?.length ? new Map(receivedFromBales(a.bales).map((r) => [r.productId, r.qty])) : null;
  return (
    <Card className="p-4 sm:p-5">
      <p className="flex flex-wrap items-center gap-2 text-ink">
        <CalendarClock className="h-5 w-5 text-accent" aria-hidden />
        {done ? `Recibida el ${fmtDate(a.receivedAt ?? a.eta)}` : `${a.kind === 'roast' ? 'Tueste' : 'Llega'} el ${fmtDate(a.eta)}, ${fmtRelativeDays(a.eta, ctx.now())}`}
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Lo que trae">
        {a.items.map((i) => {
          const pr = d.products.get(i.productId);
          const got = received?.get(i.productId);
          return (
            <li key={i.productId} className="grid min-w-0 gap-0.5 rounded-xl bg-surface-2 px-3 py-2" aria-label={pr?.name ?? i.productId}>
              <span className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="min-w-0 break-words">{pr?.name ?? i.productId}</span>
                <span className="font-semibold whitespace-nowrap tabular">{pr ? unitsText(pr, i.qty) : i.qty}</span>
              </span>
              {got !== undefined ? (
                <span className={`text-sm ${got === i.qty ? 'text-ok' : 'text-warn'}`} data-testid="entro">
                  Entró al almacén: {pr ? unitsText(pr, got) : got}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-muted">
        Costo según {a.bales?.length ? 'la lista de empaque' : 'lo registrado'}: <b className="text-ink">{fmtMoney(cost)}</b>
        {a.notes ? ` · ${a.notes}` : ''}
      </p>
    </Card>
  );
}

// ---------- Lista de empaque ----------

function PackingSection({ d }: { d: ArrivalDetail }) {
  const { ctx, actor } = useLine();
  const { run, busy } = useAction();
  const [sheet, setSheet] = useState<'archivo' | 'mano' | 'editar' | null>(null);
  const a = d.arrival;
  const bales = a.bales ?? [];
  const editable = !actor.readOnly && BEFORE_CONFIRMING.includes(a.status);
  if (a.status === 'confirmando') return null;
  if (!bales.length) {
    if (!editable) return null;
    return (
      <Section title="Lista de empaque">
        <EmptyState
          icon={FileSpreadsheet}
          title="Sin lista de empaque"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" icon={FileSpreadsheet} onClick={() => setSheet('archivo')}>
                Cargar lista de empaque
              </Button>
              <Button icon={Keyboard} onClick={() => setSheet('mano')}>
                Escribirla a mano
              </Button>
            </div>
          }
        >
          Con la lista de la fábrica (bulto, vitola, capa, mazos y costo) se confirma bulto por bulto al llegar. Sin lista, se recibe todo de una vez.
        </EmptyState>
        {sheet ? <PackingListSheet arrival={a} products={d.products} start={sheet} onClose={() => setSheet(null)} /> : null}
      </Section>
    );
  }
  const units = bales.reduce((s, b) => s + b.items.reduce((t, i) => t + i.qty, 0), 0);
  const mixed = bales.filter((b) => b.items.length > 1).length;
  return (
    <Section
      title="Lista de empaque"
      actions={
        editable ? (
          <Button icon={Pencil} onClick={() => setSheet('editar')}>
            Cambiar la lista
          </Button>
        ) : null
      }
    >
      <Card className="grid gap-3 p-4">
        <p className="font-semibold text-ink">
          {bales.length} bulto{bales.length === 1 ? '' : 's'} · {units} en total{mixed ? ` · ${mixed} mixto${mixed === 1 ? '' : 's'}` : ''}
        </p>
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {bales.slice(0, 6).map((b) => (
            <li key={b.id} className="min-w-0 break-words text-muted">
              <b className="text-ink">Bulto {b.number}:</b> {b.items.map((i) => `${d.products.get(i.productId)?.name ?? i.productId} × ${i.qty}`).join(', ')}
            </li>
          ))}
          {bales.length > 6 ? <li className="text-muted">y {bales.length - 6} bultos más</li> : null}
        </ul>
        {editable ? (
          a.status === 'aduana' ? (
            <Button variant="primary" big icon={ClipboardCheck} busy={busy} onClick={() => void run(() => startBaleCheck(ctx, a.id), `${a.code}: a confirmar bulto por bulto.`)}>
              Confirmar bultos
            </Button>
          ) : (
            <p className="text-sm text-muted">Cuando la importación esté en aduana, toca «Confirmar bultos» para revisarla bulto por bulto al llegar.</p>
          )
        ) : null}
      </Card>
      {sheet ? <PackingListSheet arrival={a} products={d.products} start={sheet} onClose={() => setSheet(null)} /> : null}
    </Section>
  );
}

// ---------- Cajas con trazabilidad ----------

function CasesSection({ d }: { d: ArrivalDetail }) {
  const { line, actor } = useLine();
  const { run, busy } = useAction();
  const [register, setRegister] = useState(false);
  const [format, setFormat] = useState<LabelFormat>('termica');
  const [url, setUrl] = useState<string | null>(null);
  const a = d.arrival;
  const byProduct = useMemo(() => {
    const m = new Map<string, CaseUnit[]>();
    for (const c of d.cases) m.set(c.productId, [...(m.get(c.productId) ?? []), c]);
    return [...m];
  }, [d.cases]);
  const printAll = () =>
    void run(async () => {
      setUrl(await buildLabelsUrl(d.cases.map((c) => caseLabel(line, c, d.products.get(c.productId), a.code)), format, `Cajas de ${a.code}`));
    }, `Etiquetas de ${d.cases.length} cajas listas.`);
  return (
    <Section
      title={`Cajas con trazabilidad (${d.cases.length})`}
      actions={
        !actor.readOnly && a.status !== 'cancelada' ? (
          <Button icon={Plus} onClick={() => setRegister(true)}>
            Registrar cajas
          </Button>
        ) : null
      }
    >
      <p className="mb-3 max-w-[70ch] text-sm text-muted">
        Opcional: cada caja lleva su número propio, el bulto, la fábrica, quién la torció y quién la empacó. Al preparar una entrega, escanear la caja la liga al local; «Buscar código» muestra todo el camino.
      </p>
      {d.cases.length === 0 ? (
        <EmptyState icon={Boxes} title="Sin cajas registradas">
          Registra las cajas al recibir, con número automático o escaneando sus etiquetas.
        </EmptyState>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {byProduct.map(([productId, list]) => {
              const pr = d.products.get(productId);
              const out = list.filter((c) => c.deliveryId).length;
              return (
                <li key={productId} className="glass min-w-0 p-4">
                  <p className="font-bold break-words text-ink">{pr?.name ?? productId}</p>
                  <p className="text-sm text-muted">
                    {list.length} caja{list.length === 1 ? '' : 's'} · {out} entregada{out === 1 ? '' : 's'}
                  </p>
                  <ul className="mt-2 grid gap-1 text-sm">
                    {list.slice(0, 8).map((c) => (
                      <li key={c.id} className="flex min-w-0 flex-wrap justify-between gap-x-3">
                        <span className="font-semibold break-all">{c.code}</span>
                        <span className="text-muted">{c.storeId ? (d.storeNames.get(c.storeId) ?? 'Entregada') : 'En almacén'}</span>
                      </li>
                    ))}
                    {list.length > 8 ? <li className="text-muted">y {list.length - 8} más</li> : null}
                  </ul>
                </li>
              );
            })}
          </ul>
          <Card className="mt-3 grid gap-3 p-4">
            <Tabs<LabelFormat>
              label="Formato de las etiquetas de cajas"
              value={format}
              onChange={(f) => {
                setFormat(f);
                setUrl(null);
              }}
              options={FORMAT_OPTIONS}
            />
            {url ? <PdfReady url={url} name={`cajas-${a.code}.pdf`} /> : null}
            <Button icon={Printer} busy={busy} onClick={printAll}>
              Imprimir etiquetas de las cajas ({d.cases.length})
            </Button>
          </Card>
        </>
      )}
      {register ? <RegisterCasesSheet arrival={a} products={d.products} onClose={() => setRegister(false)} /> : null}
    </Section>
  );
}

function RegisterCasesSheet({ arrival, products, onClose }: { arrival: Arrival; products: Map<string, Product>; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const items = arrival.items.map((i) => products.get(i.productId)).filter((p): p is Product => Boolean(p));
  const [productId, setProductId] = useState(items[0]?.id ?? '');
  const [bale, setBale] = useState('');
  const [count, setCount] = useState<number | ''>(1);
  const [codes, setCodes] = useState<string[]>([]);
  const [factory, setFactory] = useState(arrival.supplier);
  const [roller, setRoller] = useState('');
  const [packer, setPacker] = useState('');
  const [packedOn, setPackedOn] = useState(toIsoDate(ctx.now()));
  const [note, setNote] = useState<string>();
  const total = (count === '' ? 0 : count) + codes.length;
  return (
    <Sheet open onClose={onClose} title={`Registrar cajas de ${arrival.code}`}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const made = await registerCases(ctx, { arrivalId: arrival.id, productId, baleNumber: bale || undefined, count: count === '' ? 0 : count, codes, factory, roller, packer, packedOn: packedOn || undefined });
            onClose();
            return made;
          }, (made) => `${made.length} caja${made.length === 1 ? '' : 's'} registrada${made.length === 1 ? '' : 's'}: ${made[0]!.code}${made.length > 1 ? ` a ${made.at(-1)!.code}` : ''}.`);
        }}
      >
        <SelectInput label="Producto" value={productId} onChange={(e) => setProductId(e.target.value)} options={items.map((p) => ({ value: p.id, label: p.name }))} />
        {arrival.bales?.length ? (
          <SelectInput label="Bulto" value={bale} onChange={(e) => setBale(e.target.value)} options={[{ value: '', label: 'Sin bulto' }, ...arrival.bales.map((b) => ({ value: b.number, label: `Bulto ${b.number}` }))]} />
        ) : (
          <TextInput label="Bulto (opcional)" value={bale} onChange={(e) => setBale(e.target.value)} placeholder="12" inputMode="numeric" />
        )}
        <NumberInput label="Cajas con número automático" min={0} max={500} step={1} value={count} onValue={setCount} hint={`Quedan como C-${arrival.code}-0001, -0002…`} />
        <div className="grid gap-2">
          <ScanButton
            label="Escanear etiquetas de cajas"
            title="Etiquetas de cajas"
            continuous
            feedback={note}
            hint="Si las cajas ya traen su número en una etiqueta, escanéalas: se registran con ese número."
            onCode={(code) => {
              if (codes.includes(code)) {
                setNote(`${code} ya está en la lista.`);
                return;
              }
              setCodes((s) => [...s, code]);
              setNote(`Caja ${code} agregada (${codes.length + 1}).`);
            }}
          />
          {codes.length ? <p className="text-sm break-all text-muted">Escaneadas: {codes.join(', ')}</p> : null}
        </div>
        <TextInput label="Fábrica" value={factory} onChange={(e) => setFactory(e.target.value)} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextInput label="Torcedor" value={roller} onChange={(e) => setRoller(e.target.value)} placeholder="Ana R." />
          <TextInput label="Empacador" value={packer} onChange={(e) => setPacker(e.target.value)} placeholder="Rosa E." />
        </div>
        <TextInput label="Fecha de empaque" type="date" value={packedOn} onChange={(e) => setPackedOn(e.target.value)} />
        <Button type="submit" variant="primary" big icon={ScanBarcode} busy={busy} disabled={!productId || total === 0}>
          Registrar {total} caja{total === 1 ? '' : 's'}
        </Button>
      </form>
    </Sheet>
  );
}

