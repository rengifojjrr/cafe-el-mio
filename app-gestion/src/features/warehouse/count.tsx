// Almacén → «Contar»: se escanean o se buscan los productos y se anota cuántos hay. El conteo
// se guarda solo en este teléfono mientras se hace (se puede dejar y seguir después). Al final
// se ve lo que dice el libro contra lo contado y «Guardar conteo» deja un ajuste por diferencia.
import { CheckCircle2, ClipboardCheck, Link2, Plus, ScanBarcode, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Product } from '../../data/types';
import { normalize, searchText, stockText, unitOf, unitsText } from '../../domain/products';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { fmtDateTime } from '../../lib/time';
import { hasCost, listProducts } from '../../services/catalog';
import { findByCode } from '../../services/codes';
import { reviewCount, saveWarehouseCount, type CountLine } from '../../services/warehouse-count';
import { Button, Card, EmptyState, Loading, NumberInput, PageHeader, QtyStepper, Sheet, Tabs, TextInput } from '../../ui/kit';
import { ScanButton } from '../../ui/scanner';
import { useAction } from '../../ui/toast';
import { RoleGate } from '../common';
import { AssignCodeSheet } from '../codes/AssignCodeSheet';

export function CountPage() {
  return (
    <RoleGate roles={['admin']} message="El conteo del almacén lo hace administración.">
      <Count />
    </RoleGate>
  );
}

interface Draft {
  startedAt: string;
  counts: Record<string, number>;
  /** Orden en que se agregaron (lo último arriba). */
  order: string[];
  /** Códigos leídos que la app no conoce. */
  unknown: string[];
}

const emptyDraft = (): Draft => ({ startedAt: new Date().toISOString(), counts: {}, order: [], unknown: [] });

function loadDraft(key: string): Draft {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return emptyDraft();
    const d = JSON.parse(raw) as Partial<Draft>;
    return { startedAt: d.startedAt ?? new Date().toISOString(), counts: d.counts ?? {}, order: d.order ?? Object.keys(d.counts ?? {}), unknown: d.unknown ?? [] };
  } catch {
    return emptyDraft();
  }
}

function saveDraft(key: string, d: Draft | null): void {
  try {
    if (!d || (d.order.length === 0 && d.unknown.length === 0)) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(d));
  } catch {
    // Sin almacenamiento (modo privado): el conteo sigue en pantalla.
  }
}

type Mode = 'sumar' | 'preguntar';

function Count() {
  const { ctx, line, actor, p } = useLine();
  const nav = useNavigate();
  const key = `conteo:${line}:${actor.userId}`;
  const products = useAsync(() => listProducts(ctx, { includeInactive: true }), [ctx]);
  const [draft, setDraft] = useState<Draft>(() => loadDraft(key));
  const [mode, setMode] = useState<Mode>('sumar');
  const [feedback, setFeedback] = useState<string>();
  const [ask, setAsk] = useState<Product | null>(null);
  const [assign, setAssign] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => saveDraft(key, draft), [key, draft]);

  const byId = useMemo(() => new Map((products.data ?? []).flatMap((v) => (hasCost(v.product) ? [[v.product.id, v.product] as const] : []))), [products.data]);
  const add = (productId: string, n: number) =>
    setDraft((d) => ({
      ...d,
      counts: { ...d.counts, [productId]: Math.max(0, (d.counts[productId] ?? 0) + n) },
      order: [productId, ...d.order.filter((x) => x !== productId)],
    }));
  const setQty = (productId: string, n: number) => setDraft((d) => ({ ...d, counts: { ...d.counts, [productId]: Math.max(0, n) } }));
  const remove = (productId: string) =>
    setDraft((d) => {
      const counts = { ...d.counts };
      delete counts[productId];
      return { ...d, counts, order: d.order.filter((x) => x !== productId) };
    });

  const onCode = async (code: string) => {
    const m = await findByCode(ctx, code);
    if (m.kind === 'product') {
      const pr = byId.get(m.product.id);
      if (!pr) return;
      if (mode === 'preguntar') {
        setAsk(pr);
        return;
      }
      add(pr.id, 1);
      const now = (draft.counts[pr.id] ?? 0) + 1;
      setFeedback(`+1 · ${pr.name}: ${unitsText(pr, now)}`);
      return;
    }
    if (m.kind === 'case') {
      const pr = byId.get(m.caseUnit.productId);
      if (!pr) return;
      if (m.caseUnit.deliveryId) {
        setFeedback(`La caja ${m.caseUnit.code} ya salió en una entrega: no se cuenta.`);
        return;
      }
      add(pr.id, pr.packSize);
      setFeedback(`+1 caja (${unitsText(pr, pr.packSize)}) · ${pr.name}`);
      return;
    }
    if (m.kind === 'none') {
      setDraft((d) => (d.unknown.includes(m.code) ? d : { ...d, unknown: [m.code, ...d.unknown] }));
      setFeedback(`No conozco el código ${m.code}. Lo dejo anotado para asignarlo a un producto.`);
      return;
    }
    setFeedback('Ese código no es de un producto.');
  };

  const matches = useMemo(() => {
    const term = normalize(q);
    if (!term) return [];
    return [...byId.values()].filter((pr) => searchText(pr).includes(term)).slice(0, 6);
  }, [byId, q]);

  if (products.loading && !products.data) return <Loading rows={4} />;
  const lines = draft.order.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
  const units = lines.reduce((a, pr) => a + (draft.counts[pr.id] ?? 0), 0);

  return (
    <>
      <PageHeader
        back={{ to: p('almacen'), label: 'Almacén' }}
        title="Contar el almacén"
        subtitle="Escanea o busca cada producto y anota cuántos hay (cuenta también lo apartado para entregas). Al final ves lo que dice el libro y guardas las diferencias."
      />
      <Card className="grid gap-4 p-4">
        <Tabs<Mode>
          label="Qué pasa al escanear"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'sumar', label: 'Cada lectura suma 1' },
            { value: 'preguntar', label: 'Preguntar cuánto' },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
          <ScanButton
            variant="primary"
            label="Escanear"
            title="Contar escaneando"
            continuous={mode === 'sumar'}
            hint={mode === 'sumar' ? 'Cada lectura suma un mazo, tabaco o unidad. La etiqueta de una caja suma la caja entera.' : 'Después de cada lectura te pregunto cuántos hay.'}
            feedback={mode === 'sumar' ? feedback : undefined}
            onCode={onCode}
          />
          <div className="relative">
            <label className="relative block">
              <span className="sr-only">Buscar un producto para contarlo</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
              <input className="input pl-10" placeholder="O busca el producto por nombre o SKU" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            {matches.length ? (
              <ul className="mt-2 grid gap-1">
                {matches.map((pr) => (
                  <li key={pr.id}>
                    <button
                      type="button"
                      className="btn btn-ghost w-full justify-start text-left"
                      onClick={() => {
                        add(pr.id, 0);
                        setQ('');
                      }}
                    >
                      <Plus aria-hidden /> <span className="min-w-0 break-words">{pr.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        {draft.order.length ? <p className="text-sm text-muted">Se guarda en este teléfono mientras tanto: puedes dejarlo y seguir después (empezado el {fmtDateTime(draft.startedAt)}).</p> : null}
      </Card>

      {draft.unknown.length ? (
        <Card className="mt-4 grid gap-2 p-4" aria-label="Códigos que no conozco">
          <p className="font-semibold text-ink">Códigos que no conozco</p>
          <ul className="grid gap-2">
            {draft.unknown.map((code) => (
              <li key={code} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold break-all tabular">{code}</span>
                <span className="flex gap-2">
                  {!actor.readOnly ? (
                    <Button icon={Link2} onClick={() => setAssign(code)}>
                      Asignar a un producto
                    </Button>
                  ) : null}
                  <Button variant="ghost" icon={X} aria-label={`Olvidar ${code}`} onClick={() => setDraft((d) => ({ ...d, unknown: d.unknown.filter((c) => c !== code) }))} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-4">
        {lines.length === 0 ? (
          <EmptyState icon={ScanBarcode} title="Todavía no contaste nada">
            Toca «Escanear» y apunta a cada mazo o caja, o busca el producto por su nombre.
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {lines.map((pr) => {
              const n = draft.counts[pr.id] ?? 0;
              return (
                <li key={pr.id} className="glass grid gap-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold break-words">{pr.name}</p>
                      <p className="text-sm text-muted">{stockText(pr, n)}</p>
                    </div>
                    <Button variant="ghost" icon={Trash2} aria-label={`Quitar ${pr.name} del conteo`} onClick={() => remove(pr.id)} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <QtyStepper label={`Contados de ${pr.name}`} value={n} onChange={(v) => setQty(pr.id, v)} unit={unitOf(pr).many} />
                    {pr.packSize > 1 ? (
                      <Button variant="ghost" icon={Plus} onClick={() => add(pr.id, pr.packSize)}>
                        1 caja
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="sticky bottom-[76px] z-20 mt-5 flex flex-wrap items-center justify-end gap-3 lg:bottom-4 lg:justify-start">
        {lines.length ? (
          <p className="glass px-4 py-2 text-sm font-semibold">
            {lines.length} producto{lines.length === 1 ? '' : 's'} · {units} contados
          </p>
        ) : null}
        {lines.length ? (
          <Button
            variant="ghost"
            icon={X}
            onClick={() => {
              setDraft(emptyDraft());
              setFeedback(undefined);
            }}
          >
            Descartar
          </Button>
        ) : null}
        <Button variant="primary" big icon={ClipboardCheck} disabled={lines.length === 0 || actor.readOnly} onClick={() => setReview(true)}>
          Revisar y guardar
        </Button>
      </div>

      <AskSheet product={ask} onClose={() => setAsk(null)} onQty={(pr, n) => add(pr.id, n)} />
      <AssignCodeSheet
        code={assign}
        onClose={() => setAssign(null)}
        onAssigned={(pr) => {
          setDraft((d) => ({ ...d, unknown: d.unknown.filter((c) => c !== assign) }));
          add(pr.id, 1);
          void products.reload();
        }}
      />
      {review ? (
        <ReviewSheet
          counts={lines.map((pr) => ({ productId: pr.id, counted: draft.counts[pr.id] ?? 0 }))}
          onClose={() => setReview(false)}
          onSaved={() => {
            setDraft(emptyDraft());
            saveDraft(key, null);
            nav(p('almacen'));
          }}
        />
      ) : null}
    </>
  );
}

function AskSheet({ product, onClose, onQty }: { product: Product | null; onClose: () => void; onQty: (p: Product, n: number) => void }) {
  const [n, setN] = useState<number | ''>('');
  return (
    <Sheet open={product !== null} onClose={onClose} title={product ? `¿Cuántos ${unitOf(product).many}?` : ''}>
      {product ? (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (n === '' || n < 0) return;
            onQty(product, Math.floor(n));
            setN('');
            onClose();
          }}
        >
          <p className="font-semibold break-words text-ink">{product.name}</p>
          <NumberInput label={`${unitOf(product).many[0]!.toUpperCase()}${unitOf(product).many.slice(1)} que sumas`} min={0} step={1} value={n} onValue={setN} hint={product.packSize > 1 ? `Una caja trae ${unitsText(product, product.packSize)}.` : undefined} />
          <Button type="submit" variant="primary" icon={Plus} disabled={n === '' || n < 0}>
            Sumar al conteo
          </Button>
        </form>
      ) : null}
    </Sheet>
  );
}

function ReviewSheet({ counts, onClose, onSaved }: { counts: { productId: string; counted: number }[]; onClose: () => void; onSaved: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const review = useAsync(() => reviewCount(ctx, counts), [ctx, JSON.stringify(counts)]);
  const [note, setNote] = useState('');
  const lines = review.data ?? [];
  const changed = lines.filter((l) => l.diff !== 0);
  return (
    <Sheet open onClose={onClose} title="Revisar el conteo" wide>
      {review.loading && !review.data ? <Loading rows={2} /> : null}
      {review.data ? (
        <div className="grid gap-4">
          <p className="text-muted">
            {changed.length
              ? `${changed.length} producto${changed.length === 1 ? '' : 's'} no cuadra${changed.length === 1 ? '' : 'n'} con el libro. Al guardar, cada diferencia queda como un ajuste con motivo «Conteo de almacén».`
              : 'Todo cuadra con el libro. Al guardar queda anotado que se contó.'}
          </p>
          <ul className="grid gap-2">
            {lines.map((l) => (
              <ReviewLine key={l.productId} l={l} />
            ))}
          </ul>
          <TextInput label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: conteo del pasillo 3" />
          <Button
            variant="primary"
            big
            icon={CheckCircle2}
            busy={busy}
            onClick={() =>
              void run(async () => {
                const r = await saveWarehouseCount(ctx, { counts, note });
                onSaved();
                return r;
              }, (r) => (r.adjusted ? `Conteo guardado: ${r.adjusted} ajuste${r.adjusted === 1 ? '' : 's'} en el libro.` : 'Conteo guardado: todo cuadraba.'))
            }
          >
            Guardar conteo
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}

function ReviewLine({ l }: { l: CountLine }) {
  const u = { unitName: l.unitName };
  const tone = l.diff === 0 ? 'text-ok' : l.diff < 0 ? 'text-danger' : 'text-warn';
  return (
    <li className="grid gap-1 rounded-2xl border border-line p-3">
      <p className="font-semibold break-words">{l.name}</p>
      <p className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-3">
        <span className="text-muted">Libro: {unitsText(u, l.expected)}</span>
        <span className="text-ink">Contado: {unitsText(u, l.counted)}</span>
        <span className={`font-bold ${tone}`}>{l.diff === 0 ? 'Cuadra' : `${l.diff > 0 ? 'Sobran' : 'Faltan'} ${unitsText(u, Math.abs(l.diff))}`}</span>
      </p>
      {l.reserved > l.counted ? <p className="text-sm text-warn">Hay {unitsText(u, l.reserved)} apartados para entregas: no alcanzaría para entregarlos.</p> : null}
    </li>
  );
}
