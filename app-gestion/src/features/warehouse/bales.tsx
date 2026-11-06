// «Confirmar bultos»: la lista de bultos con su avance («37 de 147»), «Bien» de un toque, contar
// un bulto (escribiendo, con los botones o escaneando), «Dañado» con nota y foto, recibir en el
// almacén lo contado y «Diferencias de la importación» en CSV y PDF para reclamar a la fábrica.
import { AlertTriangle, CheckCircle2, ClipboardCheck, Download, FileDown, PackageCheck, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Arrival, Bale, BaleStatus, Product } from '../../data/types';
import { unitOf, unitsText } from '../../domain/products';
import { BALE_STATUS_LABEL, baleStatusFor, countedOf, differencesCsv, receivedFromBales, type DiffReport } from '../../domain/receiving';
import { cleanCode } from '../../lib/barcode';
import type { NewPhoto } from '../../lib/image';
import type { LabelFormat } from '../../lib/labels-pdf';
import { fmtMoney } from '../../lib/money';
import { pdfObjectUrl } from '../../lib/pdf';
import { fmtDate, fmtDateTime } from '../../lib/time';
import { useLine } from '../../app/line-context';
import { getPhoto } from '../../services/catalog';
import { findByCode } from '../../services/codes';
import { receiveArrival } from '../../services/inventory';
import { checkBale, type ArrivalDetail } from '../../services/receiving';
import { Button, Card, EmptyState, Pill, QtyStepper, Section, Sheet, Tabs, TextArea } from '../../ui/kit';
import { PhotoPicker, useStoredPhoto } from '../../ui/media';
import { ScanButton } from '../../ui/scanner';
import { useAction } from '../../ui/toast';
import { buildLabelsUrl, FORMAT_OPTIONS, PdfReady } from '../labels/LabelsSheet';
import { codeUrl } from '../labels/specs';

/** «−$44.74» o «+$11.83» (al costo de la lista de empaque). */
function signedMoney(n: number): string {
  return `${n < 0 ? '−' : '+'}${fmtMoney(Math.abs(n))}`;
}

const TONE: Record<BaleStatus, 'ok' | 'warn' | 'danger' | 'info' | undefined> = { pendiente: undefined, bien: 'ok', falta: 'warn', sobra: 'info', danado: 'danger' };

export function BaleStatusPill({ status }: { status: BaleStatus }) {
  return (
    <Pill tone={TONE[status]} dot>
      {BALE_STATUS_LABEL[status]}
    </Pill>
  );
}

/** «Faltan 2 mazos de Toro…; sobra 1 de…». */
function diffText(b: Bale, products: Map<string, Product>): string {
  return b.items
    .map((i) => {
      const d = countedOf(b, i.productId) - i.qty;
      if (!d) return '';
      const p = products.get(i.productId);
      const n = Math.abs(d);
      return `${d < 0 ? (n === 1 ? 'Falta' : 'Faltan') : n === 1 ? 'Sobra' : 'Sobran'} ${p ? unitsText(p, n) : n} de ${p?.name ?? i.productId}`;
    })
    .filter(Boolean)
    .join('; ');
}

function itemsText(b: Bale, products: Map<string, Product>): string {
  return b.items.map((i) => `${products.get(i.productId)?.name ?? i.productId}: ${products.get(i.productId) ? unitsText(products.get(i.productId)!, i.qty) : i.qty}`).join(' · ');
}

/** Código de la etiqueta de un bulto: «B-IMP-2026-016-12». */
export function baleCode(arrivalCode: string, number: string): string {
  return `B-${arrivalCode}-${number}`;
}

/** Un código leído → el bulto (sirve la etiqueta del bulto o su número solo). */
function baleForCode(a: Arrival, code: string): Bale | undefined {
  const clean = cleanCode(code);
  const prefix = cleanCode(a.code);
  const n = clean.startsWith(`B${prefix}`) ? clean.slice(prefix.length + 1) : clean.startsWith(prefix) ? clean.slice(prefix.length) : clean;
  return a.bales?.find((b) => cleanCode(b.number) === n);
}

type BTab = 'pendientes' | 'diferencias' | 'revisados' | 'todos';

export function ConfirmSection({ d }: { d: ArrivalDetail }) {
  const { ctx, actor, line } = useLine();
  const { run, busy } = useAction();
  const a = d.arrival;
  const bales = a.bales ?? [];
  const [tab, setTab] = useState<BTab>('pendientes');
  const [open, setOpen] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [scanNote, setScanNote] = useState<string>();
  const [labelFormat, setLabelFormat] = useState<LabelFormat>('termica');
  const [labelsUrl, setLabelsUrl] = useState<string | null>(null);
  const checked = bales.filter((b) => b.status !== 'pendiente');
  const issues = checked.filter((b) => b.status !== 'bien');
  const pending = bales.length - checked.length;
  const shown = bales.filter((b) => (tab === 'pendientes' ? b.status === 'pendiente' : tab === 'diferencias' ? b.status !== 'pendiente' && b.status !== 'bien' : tab === 'revisados' ? b.status !== 'pendiente' : true));
  const pct = bales.length ? Math.round((checked.length / bales.length) * 100) : 0;
  const canWrite = !actor.readOnly;
  const openBale = bales.find((b) => b.id === open) ?? null;
  const counts = (s: BaleStatus) => checked.filter((b) => b.status === s).length;

  const printBaleLabels = () =>
    void run(async () => {
      const specs = bales.map((b) => ({
        title: `Bulto ${b.number} · ${a.code}`,
        lines: [itemsText(b, d.products)],
        code: baleCode(a.code, b.number),
        qr: codeUrl(line, baleCode(a.code, b.number)),
        copies: 1,
      }));
      setLabelsUrl(await buildLabelsUrl(specs, labelFormat, `Bultos de ${a.code}`));
    }, `Etiquetas de ${bales.length} bultos listas.`);

  return (
    <Section
      title="Confirmar bultos"
      actions={
        canWrite ? (
          <ScanButton
            label="Escanear un bulto"
            title="Escanear la etiqueta de un bulto"
            hint="Lee la etiqueta del bulto (o escribe su número) para contarlo."
            feedback={scanNote}
            onCode={(code) => {
              const b = baleForCode(a, code);
              if (!b) {
                setScanNote(`No encontré el bulto ${code} en ${a.code}.`);
                throw new Error(`No encontré el bulto ${code} en ${a.code}.`);
              }
              setScanNote(undefined);
              setOpen(b.id);
            }}
          />
        ) : null
      }
    >
      <Card className="grid gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-lg font-bold text-ink" aria-live="polite">
            {checked.length} de {bales.length} bultos revisados
          </p>
          <p className="text-sm text-muted">
            {counts('bien')} bien · {counts('falta')} con falta · {counts('sobra')} con sobra · {counts('danado')} dañados
          </p>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Bultos revisados" aria-valuemin={0} aria-valuemax={bales.length} aria-valuenow={checked.length}>
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-muted">Toca «Bien» si el bulto trae lo que dice la lista. Si no, «Contar»: anota lo que vino y, si llegó dañado, una nota y una foto. Puedes dejarlo y seguir después.</p>
      </Card>
      <div className="my-4">
        <Tabs<BTab>
          label="Bultos"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pendientes', label: 'Por revisar', count: pending },
            { value: 'diferencias', label: 'Con diferencias', count: issues.length },
            { value: 'revisados', label: 'Revisados', count: checked.length },
            { value: 'todos', label: 'Todos', count: bales.length },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={tab === 'pendientes' ? 'No queda ningún bulto por revisar' : 'Nada por aquí'}>
          {tab === 'pendientes' ? 'Revisa el resumen y toca «Recibir en almacén».' : undefined}
        </EmptyState>
      ) : null}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((b) => {
          const diff = b.status !== 'pendiente' ? diffText(b, d.products) : '';
          return (
            <li key={b.id} className="glass grid min-w-0 content-start gap-2 p-3" aria-label={`Bulto ${b.number}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold text-ink">
                  Bulto {b.number}
                  {b.items.length > 1 ? <span className="ml-2 text-sm font-normal text-muted">mixto</span> : null}
                </p>
                <BaleStatusPill status={b.status} />
              </div>
              <p className="text-sm break-words text-muted">{itemsText(b, d.products)}</p>
              {diff ? <p className="text-sm font-semibold break-words text-warn">{diff}</p> : null}
              {b.note ? <p className="text-sm break-words text-ink">«{b.note}»</p> : null}
              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  {b.status === 'pendiente' ? (
                    <Button variant="primary" icon={CheckCircle2} busy={busy} aria-label={`Bulto ${b.number}: bien`} onClick={() => void run(() => checkBale(ctx, a.id, b.id, { bien: true }), `Bulto ${b.number}: bien.`)}>
                      Bien
                    </Button>
                  ) : null}
                  <Button icon={ClipboardCheck} aria-label={`Contar el bulto ${b.number}`} onClick={() => setOpen(b.id)}>
                    {b.status === 'pendiente' ? 'Contar' : 'Volver a contar'}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Card className="mt-4 grid gap-3 p-4">
        <p className="font-semibold text-ink">Etiquetas de los bultos (opcional)</p>
        <p className="text-sm text-muted">Si pegas una etiqueta a cada bulto, al escanearla se abre ese bulto para contarlo.</p>
        <Tabs<LabelFormat>
          label="Formato de las etiquetas de bultos"
          value={labelFormat}
          onChange={(f) => {
            setLabelFormat(f);
            setLabelsUrl(null);
          }}
          options={FORMAT_OPTIONS}
        />
        {labelsUrl ? <PdfReady url={labelsUrl} name={`bultos-${a.code}.pdf`} /> : null}
        <Button icon={Printer} busy={busy} onClick={printBaleLabels}>
          Imprimir etiquetas de bultos ({bales.length})
        </Button>
      </Card>
      {canWrite ? (
        <div className="sticky bottom-[76px] z-20 mt-5 flex flex-wrap items-center justify-end gap-3 lg:bottom-4 lg:justify-start">
          {pending ? <p className="glass px-4 py-2 text-sm font-semibold">Faltan {pending} bultos por revisar</p> : null}
          <Button variant="primary" big icon={PackageCheck} disabled={pending > 0} onClick={() => setReceiving(true)}>
            Recibir en almacén
          </Button>
        </div>
      ) : null}
      {openBale ? <BaleSheet arrival={a} bale={openBale} products={d.products} onClose={() => setOpen(null)} /> : null}
      {receiving ? <ReceiveSheet d={d} onClose={() => setReceiving(false)} /> : null}
    </Section>
  );
}

function BaleSheet({ arrival, bale, products, onClose }: { arrival: Arrival; bale: Bale; products: Map<string, Product>; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [counted, setCounted] = useState<Record<string, number>>(() => Object.fromEntries(bale.items.map((i) => [i.productId, countedOf(bale, i.productId)])));
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [damaged, setDamaged] = useState(bale.status === 'danado');
  const [note, setNote] = useState(bale.note ?? '');
  const [photo, setPhoto] = useState<NewPhoto | undefined>();
  const status = baleStatusFor(bale, counted, damaged);
  const total = bale.items.reduce((s, i) => s + i.qty, 0);
  const first = products.get(bale.items[0]?.productId ?? '');

  const onScan = async (code: string) => {
    const m = await findByCode(ctx, code);
    const pid = m.kind === 'product' ? m.product.id : null;
    const item = bale.items.find((i) => i.productId === pid);
    if (!item) {
      setFeedback(m.kind === 'product' ? `${m.product.name} no viene en este bulto: anótalo en la nota.` : m.kind === 'none' ? `No conozco el código ${m.code}.` : 'Ese código no es de un producto.');
      return;
    }
    const base = scanning ? counted : Object.fromEntries(bale.items.map((i) => [i.productId, 0]));
    const now = (base[item.productId] ?? 0) + 1;
    setCounted({ ...base, [item.productId]: now });
    setScanning(true);
    const p = products.get(item.productId);
    setFeedback(`+1 · ${p?.name ?? ''}: ${now} de ${item.qty}`);
  };

  const save = (bien: boolean) =>
    void run(
      async () => {
        const b = await checkBale(ctx, arrival.id, bale.id, bien ? { bien: true, note } : { counted, damaged, note, photo });
        onClose();
        return b;
      },
      (b) => `Bulto ${b.number}: ${BALE_STATUS_LABEL[b.status].toLowerCase()}.`,
    );

  return (
    <Sheet open onClose={onClose} title={`Bulto ${bale.number}`}>
      <div className="grid gap-4">
        <p className="text-muted">
          La lista dice {first && bale.items.length === 1 ? unitsText(first, total) : `${total} en total`}
          {bale.items.length > 1 ? ` de ${bale.items.length} productos (bulto mixto)` : ''}. Anota lo que vino de verdad.
        </p>
        <ScanButton
          label="Contar escaneando"
          title={`Contar el bulto ${bale.number}`}
          continuous
          hint="Empieza en cero: cada lectura suma un mazo al producto que corresponde."
          feedback={feedback}
          onCode={onScan}
        />
        <ul className="grid gap-2">
          {bale.items.map((i) => {
            const p = products.get(i.productId);
            const c = counted[i.productId] ?? i.qty;
            const d = c - i.qty;
            return (
              <li key={i.productId} className="grid gap-2 rounded-2xl border border-line p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 font-semibold break-words">{p?.name ?? i.productId}</p>
                  <span className={`text-sm font-semibold ${d === 0 ? 'text-ok' : 'text-warn'}`}>{d === 0 ? 'Cuadra' : `${d < 0 ? 'Faltan' : 'Sobran'} ${p ? unitsText(p, Math.abs(d)) : Math.abs(d)}`}</span>
                </div>
                <p className="text-sm text-muted">Lista: {p ? unitsText(p, i.qty) : i.qty}</p>
                <QtyStepper label={`Contados de ${p?.name ?? 'el producto'}`} value={c} onChange={(v) => setCounted((s) => ({ ...s, [i.productId]: v }))} unit={p ? unitOf(p).many : 'u.'} />
              </li>
            );
          })}
        </ul>
        <label className="flex min-h-12 items-center gap-3 rounded-2xl bg-surface-2 p-3">
          <input type="checkbox" className="h-5 w-5 flex-none" checked={damaged} onChange={(e) => setDamaged(e.target.checked)} />
          <span>
            <span className="font-semibold">Llegó dañado</span>
            <span className="block text-sm text-muted">Mojado, roto, aplastado… Cuenta solo lo que sirve, escribe qué pasó y saca una foto.</span>
          </span>
        </label>
        <TextArea label={damaged ? 'Qué le pasó al bulto' : 'Nota (opcional)'} value={note} onChange={(e) => setNote(e.target.value)} placeholder={damaged ? 'Mojado en una esquina: 5 mazos manchados' : 'Por ejemplo: faltan 3 mazos, venía abierto'} />
        <div className="flex flex-wrap items-center gap-2">
          <PhotoPicker label={photo ? 'Cambiar la foto' : 'Foto del bulto (opcional)'} onPhoto={setPhoto} />
          {photo ? <span className="text-sm text-ok">Foto lista</span> : null}
          {bale.photoIds?.length ? <span className="text-sm text-muted">{bale.photoIds.length} foto(s) guardada(s)</span> : null}
        </div>
        <p className={`rounded-2xl p-3 font-semibold ${status === 'bien' ? 'bg-ok-soft text-ok' : status === 'danado' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`}>
          {status === 'bien' ? 'Todo cuadra con la lista.' : status === 'danado' ? 'Queda como dañado.' : status === 'falta' ? 'Queda con falta.' : 'Queda con sobra.'}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button variant="primary" icon={CheckCircle2} busy={busy} onClick={() => save(true)} disabled={damaged}>
            Bien, está completo
          </Button>
          <Button icon={ClipboardCheck} busy={busy} onClick={() => save(false)} disabled={damaged && !note.trim()}>
            Guardar conteo
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function ReceiveSheet({ d, onClose }: { d: ArrivalDetail; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const a = d.arrival;
  const lines = receivedFromBales(a.bales ?? []);
  const total = lines.reduce((s, l) => s + l.qty, 0);
  const expected = lines.reduce((s, l) => s + l.expected, 0);
  return (
    <Sheet open onClose={onClose} title={`Recibir ${a.code}`}>
      <div className="grid gap-4">
        <p className="text-muted">Entra al almacén lo contado, un lote por producto con el costo de sus bultos. Las diferencias quedan en el libro y en «Diferencias de la importación».</p>
        <ul className="grid gap-2">
          {lines.map((l) => {
            const p = d.products.get(l.productId);
            const diff = l.qty - l.expected;
            return (
              <li key={l.productId} className="grid gap-1 rounded-2xl bg-surface-2 p-3">
                <p className="font-semibold break-words">{p?.name ?? l.productId}</p>
                <p className="text-sm">
                  Entran <b>{p ? unitsText(p, l.qty) : l.qty}</b>
                  <span className="text-muted"> · lista {l.expected}</span>
                  {diff ? <span className="font-semibold text-warn"> · {diff > 0 ? `sobran ${diff}` : `faltan ${-diff}`}</span> : null}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="font-semibold text-ink">
          Total: {total} (la lista decía {expected})
        </p>
        <Button
          variant="primary"
          big
          icon={PackageCheck}
          busy={busy}
          onClick={() =>
            void run(async () => {
              await receiveArrival(ctx, a.id);
              onClose();
            }, `${a.code} recibida: ${total} al almacén.`)
          }
        >
          Recibir en almacén
        </Button>
      </div>
    </Sheet>
  );
}

// ---------- Diferencias ----------

export function DifferencesSection({ d, report }: { d: ArrivalDetail; report: DiffReport }) {
  const { run, busy } = useAction();
  const a = d.arrival;
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const info = (pid: string) => {
    const p = d.products.get(pid);
    return { name: p?.name ?? pid, sku: p?.sku ?? '', unitName: p?.unitName ?? 'unidad' };
  };
  const csv = useMemo(() => differencesCsv(report, info, { code: a.code, supplier: a.supplier }), [report, a.code, a.supplier]); // eslint-disable-line react-hooks/exhaustive-deps
  const [csvUrl, setCsvUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    setCsvUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [csv]);
  const makePdf = () =>
    void run(async () => {
      const { differencesPdf } = await import('../../lib/differences-pdf');
      const bytes = await differencesPdf({
        code: a.code,
        supplier: a.supplier,
        origin: a.originCountry,
        dateText: a.receivedAt ? `Recibida el ${fmtDate(a.receivedAt)}` : `Llegó el ${fmtDate(a.eta)}`,
        generatedText: `Generado el ${fmtDateTime(new Date())}`,
        report,
        info,
      });
      setPdfUrl(pdfObjectUrl(bytes));
    }, 'PDF de diferencias listo.');
  const changed = report.byProduct.filter((x) => x.diff !== 0);
  return (
    <Section title="Diferencias de la importación">
      <Card className="grid gap-4 p-4 sm:p-5" aria-label="Diferencias de la importación">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold text-ink">
            {report.checked} de {report.total} bultos revisados · {report.withIssues} con diferencias
          </p>
          <p className={`text-lg font-bold tabular ${report.diff < 0 ? 'text-danger' : report.diff > 0 ? 'text-warn' : 'text-ok'}`}>
            {report.diff === 0 ? 'Cuadra' : `${report.diff > 0 ? 'Sobran' : 'Faltan'} ${Math.abs(report.diff)} · ${signedMoney(report.value)}`}
          </p>
        </div>
        {changed.length ? (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {changed.map((x) => {
              const p = d.products.get(x.productId);
              return (
                <li key={x.productId} className="grid gap-1 rounded-2xl bg-surface-2 p-3">
                  <p className="font-semibold break-words">{p?.name ?? x.productId}</p>
                  <p className="text-sm">
                    <span className={x.diff < 0 ? 'font-semibold text-danger' : 'font-semibold text-warn'}>
                      {x.diff < 0 ? 'Faltan' : 'Sobran'} {p ? unitsText(p, Math.abs(x.diff)) : Math.abs(x.diff)}
                    </span>
                    <span className="text-muted">
                      {' '}
                      · lista {x.expected}, contado {x.counted} · {signedMoney(x.value)}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-ok">
            <CheckCircle2 className="h-5 w-5" aria-hidden /> Hasta ahora todo cuadra con la lista de empaque.
          </p>
        )}
        {report.rows.length ? (
          <div className="grid gap-2">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <AlertTriangle className="h-5 w-5 text-warn" aria-hidden /> Bultos con algo que reclamar
            </p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(a.bales ?? [])
                .filter((b) => b.status !== 'pendiente' && b.status !== 'bien')
                .map((b) => (
                  <li key={b.id} className="grid min-w-0 gap-1 rounded-2xl border border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">Bulto {b.number}</p>
                      <BaleStatusPill status={b.status} />
                    </div>
                    <p className="text-sm break-words text-warn">{diffText(b, d.products) || 'Sin diferencia en la cantidad'}</p>
                    {b.note ? <p className="text-sm break-words">«{b.note}»</p> : null}
                    {b.photoIds?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {b.photoIds.map((id) => (
                          <BalePhoto key={id} id={id} />
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {csvUrl ? (
            <a className="btn btn-secondary" href={csvUrl} download={`diferencias-${a.code}.csv`} data-testid="diferencias-csv">
              <Download aria-hidden /> Descargar CSV
            </a>
          ) : null}
          {pdfUrl ? (
            <a className="btn btn-primary" href={pdfUrl} target="_blank" rel="noopener" data-testid="diferencias-pdf">
              <FileDown aria-hidden /> Abrir el PDF
            </a>
          ) : (
            <Button icon={FileDown} busy={busy} onClick={makePdf}>
              Ver en PDF
            </Button>
          )}
        </div>
      </Card>
    </Section>
  );
}

function BalePhoto({ id }: { id: string }) {
  const { ctx } = useLine();
  const url = useStoredPhoto(id, (pid) => getPhoto(ctx, pid));
  return <div className="h-16 w-16 overflow-hidden rounded-xl border border-line bg-surface-2">{url ? <img src={url} alt="Foto del bulto" className="h-full w-full object-cover" /> : null}</div>;
}

