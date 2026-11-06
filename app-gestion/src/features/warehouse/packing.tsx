// «Cargar lista de empaque»: de un Excel o CSV (se eligen las columnas y se reconoce cada producto
// por su código o por vitola, medida y capa; lo que no se reconoce se elige a mano) o escrita a
// mano. Al final se revisan los bultos (pueden ser mixtos) y se guarda.
import { ArrowRight, FileSpreadsheet, Keyboard, PackagePlus, Plus, Save, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { Arrival, Product } from '../../data/types';
import { unitOf } from '../../domain/products';
import { PACKING_ROLES, detectPackingColumns, groupIntoBales, parsePackingList, type PackingColumns, type PackingLine, type PackingRole } from '../../domain/receiving';
import { fmtMoney } from '../../lib/money';
import { readSheetFile, type SheetTable } from '../../lib/sheets';
import { useLine } from '../../app/line-context';
import { savePackingList } from '../../services/receiving';
import { Button, Pill, SelectInput, Sheet } from '../../ui/kit';
import { errorText, useAction, useToast } from '../../ui/toast';

type Step = 'inicio' | 'columnas' | 'productos' | 'revisar';

interface EditItem {
  key: number;
  productId: string;
  qty: number | '';
  unitCost: number | '';
}
interface EditBale {
  key: number;
  number: string;
  items: EditItem[];
}

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

let keySeq = 0;
const nextKey = () => (keySeq += 1);

function fromArrival(a: Arrival): EditBale[] {
  return (a.bales ?? []).map((b) => ({ key: nextKey(), number: b.number, items: b.items.map((i) => ({ key: nextKey(), productId: i.productId, qty: i.qty, unitCost: i.unitCost })) }));
}

export function PackingListSheet({ arrival, products, onClose, start }: { arrival: Arrival; products: Map<string, Product>; onClose: () => void; start: 'archivo' | 'mano' | 'editar' }) {
  const { ctx } = useLine();
  const { push } = useToast();
  const { run, busy } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>(start === 'editar' ? 'revisar' : start === 'mano' ? 'revisar' : 'inicio');
  const [table, setTable] = useState<SheetTable | null>(null);
  const [fileName, setFileName] = useState('');
  const [cols, setCols] = useState<PackingColumns>({});
  const [lines, setLines] = useState<PackingLine[]>([]);
  const [skipped, setSkipped] = useState<{ row: number; reason: string }[]>([]);
  /** Producto elegido para cada descripción (texto de la lista → producto). */
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [bales, setBales] = useState<EditBale[]>(() => (start === 'editar' ? fromArrival(arrival) : start === 'mano' ? [{ key: nextKey(), number: '1', items: [{ key: nextKey(), productId: '', qty: '', unitCost: '' }] }] : []));
  const [reading, setReading] = useState(false);

  const all = useMemo(() => [...products.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')), [products]);
  const options = (preferred: string[] = []) => {
    const first = preferred.map((id) => products.get(id)).filter((p): p is Product => Boolean(p));
    const rest = all.filter((p) => !preferred.includes(p.id));
    return [...first, ...rest].map((p) => ({ value: p.id, label: `${p.name}${p.active ? '' : ' (inactivo)'}` }));
  };

  const onFile = async (f: File) => {
    setReading(true);
    try {
      const t = await readSheetFile(f);
      setTable(t);
      setFileName(f.name);
      setCols(detectPackingColumns(t.headers));
      setStep('columnas');
    } catch (e) {
      push('error', errorText(e));
    } finally {
      setReading(false);
    }
  };

  const readLines = () => {
    if (!table) return;
    if (cols.bale === undefined || cols.qty === undefined) {
      push('error', 'Elige al menos la columna del bulto y la de los mazos.');
      return;
    }
    if (cols.vitola === undefined && cols.capa === undefined && cols.code === undefined && cols.name === undefined) {
      push('error', 'Elige con qué se reconoce el producto: medida o vitola, capa, código o descripción.');
      return;
    }
    const r = parsePackingList(table, cols, all);
    if (r.lines.length === 0) {
      push('error', 'No encontré líneas con bulto y mazos. Revisa las columnas elegidas.');
      return;
    }
    setLines(r.lines);
    setSkipped(r.skipped);
    const initial: Record<string, string> = {};
    for (const l of r.lines) if (l.productId && !(l.text in initial)) initial[l.text] = l.productId;
    setPicks(initial);
    setStep('productos');
  };

  // Descripciones distintas de la lista (cada una se resuelve una vez).
  const groups = useMemo(() => {
    const map = new Map<string, { text: string; lines: number; qty: number; candidates: string[]; auto: boolean }>();
    for (const l of lines) {
      const g = map.get(l.text) ?? { text: l.text, lines: 0, qty: 0, candidates: l.candidates, auto: Boolean(l.productId) };
      g.lines += 1;
      g.qty += l.qty;
      map.set(l.text, g);
    }
    return [...map.values()].sort((a, b) => Number(a.auto) - Number(b.auto));
  }, [lines]);
  const unresolved = groups.filter((g) => !picks[g.text]).length;

  const toEditor = () => {
    const resolved = lines.map((l) => {
      const productId = picks[l.text]!;
      return { bale: l.bale, productId, qty: l.qty, unitCost: l.unitCost ?? products.get(productId)?.cost ?? 0 };
    });
    setBales(groupIntoBales(resolved).map((b) => ({ key: nextKey(), number: b.number, items: b.items.map((i) => ({ key: nextKey(), productId: i.productId, qty: i.qty, unitCost: i.unitCost })) })));
    setStep('revisar');
  };

  const update = (key: number, fn: (b: EditBale) => EditBale) => setBales((s) => s.map((b) => (b.key === key ? fn(b) : b)));
  const totals = bales.reduce(
    (acc, b) => {
      for (const i of b.items) {
        const qty = i.qty === '' ? 0 : i.qty;
        acc.qty += qty;
        acc.cost += qty * (i.unitCost === '' ? (products.get(i.productId)?.cost ?? 0) : i.unitCost);
      }
      return acc;
    },
    { qty: 0, cost: 0 },
  );
  const save = () =>
    void run(async () => {
      const a = await savePackingList(ctx, arrival.id, {
        bales: bales.map((b) => ({
          number: b.number,
          items: b.items.map((i) => ({ productId: i.productId, qty: i.qty === '' ? 0 : i.qty, unitCost: i.unitCost === '' ? undefined : i.unitCost })),
        })),
      });
      onClose();
      return a;
    }, (a) => `Lista de empaque guardada: ${a.bales?.length ?? 0} bultos.`);

  return (
    <Sheet open onClose={onClose} title="Lista de empaque" wide>
      {step === 'inicio' ? (
        <div className="grid gap-4">
          <p className="text-muted">Carga la lista que manda la fábrica (Excel o CSV con bulto, medida o vitola, capa, mazos, tabacos por mazo y costo) o escríbela a mano. Un bulto puede traer varios productos.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button variant="primary" big icon={FileSpreadsheet} busy={reading} onClick={() => fileRef.current?.click()}>
              Cargar Excel o CSV
            </Button>
            <Button
              big
              icon={Keyboard}
              onClick={() => {
                setBales([{ key: nextKey(), number: '1', items: [{ key: nextKey(), productId: '', qty: '', unitCost: '' }] }]);
                setStep('revisar');
              }}
            >
              Escribirla a mano
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="lista-empaque-archivo"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onFile(f);
            }}
          />
        </div>
      ) : null}

      {step === 'columnas' && table ? (
        <div className="grid gap-4">
          <p className="text-muted">
            <b className="text-ink">{fileName}</b>: {table.rows.length} filas. Revisa qué columna es cada cosa (las que encontré ya están elegidas).
          </p>
          <div className="min-w-0 overflow-x-auto rounded-2xl border border-line">
            <table className="table text-sm">
              <thead>
                <tr>
                  {table.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, 4).map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className="whitespace-nowrap">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PACKING_ROLES.map((r) => (
              <SelectInput
                key={r.role}
                label={r.label}
                hint={r.hint}
                value={cols[r.role] === undefined ? '' : String(cols[r.role])}
                onChange={(e) => setCols((c) => ({ ...c, [r.role as PackingRole]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                options={[{ value: '', label: '— No está —' }, ...table.headers.map((h, i) => ({ value: String(i), label: h }))]}
              />
            ))}
          </div>
          <Button variant="primary" icon={ArrowRight} onClick={readLines}>
            Seguir
          </Button>
        </div>
      ) : null}

      {step === 'productos' ? (
        <div className="grid gap-4">
          <p className="text-muted">
            {lines.length} líneas en {new Set(lines.map((l) => l.bale)).size} bultos.{' '}
            {unresolved ? <b className="text-warn">Elige el producto de {unresolved === 1 ? 'la línea que no reconocí' : `las ${unresolved} descripciones que no reconocí`}.</b> : 'Reconocí todos los productos: revisa que estén bien.'}
          </p>
          {skipped.length ? (
            <p className="text-sm text-muted">
              Salté {skipped.length} fila{skipped.length === 1 ? '' : 's'}: {skipped.slice(0, 4).map((s) => `fila ${s.row} (${s.reason.toLowerCase()})`).join(', ')}
              {skipped.length > 4 ? '…' : '.'}
            </p>
          ) : null}
          <ul className="grid gap-2">
            {groups.map((g) => (
              <li key={g.text} className={`grid gap-2 rounded-2xl border p-3 ${picks[g.text] ? 'border-line' : 'border-warn'}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 font-semibold break-words">«{g.text}»</p>
                  <span className="text-sm text-muted">
                    {g.lines} línea{g.lines === 1 ? '' : 's'} · {g.qty} mazos {g.auto ? <Pill tone="ok">Reconocido</Pill> : <Pill tone="warn">Elegir</Pill>}
                  </span>
                </div>
                <SelectInput
                  label={`Producto para «${g.text}»`}
                  value={picks[g.text] ?? ''}
                  onChange={(e) => setPicks((s) => ({ ...s, [g.text]: e.target.value }))}
                  options={options(g.candidates)}
                  placeholder="Elige el producto"
                />
              </li>
            ))}
          </ul>
          <Button variant="primary" icon={ArrowRight} disabled={unresolved > 0} onClick={toEditor}>
            Seguir
          </Button>
        </div>
      ) : null}

      {step === 'revisar' ? (
        <div className="grid gap-4">
          <p className="text-muted">
            {bales.length} bulto{bales.length === 1 ? '' : 's'} · {totals.qty} en total · {fmtMoney(totals.cost)} al costo. Cada bulto puede traer varios productos.
          </p>
          <ul className="grid gap-3">
            {bales.map((b) => (
              <li key={b.key} className="grid gap-2 rounded-2xl border border-line p-3" aria-label={`Bulto ${b.number || 'sin número'}`}>
                <div className="flex items-end gap-2">
                  <label className="field min-w-0 flex-1">
                    <span className="field-label">Bulto</span>
                    <input className="input" value={b.number} onChange={(e) => update(b.key, (x) => ({ ...x, number: e.target.value }))} aria-label="Número de bulto" />
                  </label>
                  <Button variant="ghost" icon={Trash2} aria-label={`Quitar el bulto ${b.number}`} onClick={() => setBales((s) => s.filter((x) => x.key !== b.key))} />
                </div>
                {b.items.map((i) => {
                  const pr = products.get(i.productId);
                  return (
                    <div key={i.key} className="grid grid-cols-1 gap-2 rounded-xl bg-surface-2 p-2 sm:grid-cols-[1fr_7rem_7rem_auto] sm:items-end">
                      <SelectInput
                        label="Producto"
                        value={i.productId}
                        onChange={(e) => update(b.key, (x) => ({ ...x, items: x.items.map((y) => (y.key === i.key ? { ...y, productId: e.target.value } : y)) }))}
                        options={options()}
                        placeholder="Elige el producto"
                      />
                      <label className="field">
                        <span className="field-label">{pr ? capitalize(unitOf(pr).many) : 'Cantidad'}</span>
                        <input
                          className="input tabular"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={i.qty}
                          aria-label={`Cantidad en el bulto ${b.number}`}
                          onChange={(e) => update(b.key, (x) => ({ ...x, items: x.items.map((y) => (y.key === i.key ? { ...y, qty: e.target.value === '' ? '' : Math.floor(Number(e.target.value)) } : y)) }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Costo c/u</span>
                        <input
                          className="input tabular"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.01}
                          placeholder={pr ? String(pr.cost) : ''}
                          value={i.unitCost}
                          aria-label={`Costo por unidad en el bulto ${b.number}`}
                          onChange={(e) => update(b.key, (x) => ({ ...x, items: x.items.map((y) => (y.key === i.key ? { ...y, unitCost: e.target.value === '' ? '' : Number(e.target.value) } : y)) }))}
                        />
                      </label>
                      <Button variant="ghost" icon={Trash2} aria-label="Quitar este producto del bulto" disabled={b.items.length === 1} onClick={() => update(b.key, (x) => ({ ...x, items: x.items.filter((y) => y.key !== i.key) }))} />
                    </div>
                  );
                })}
                <Button variant="ghost" icon={Plus} onClick={() => update(b.key, (x) => ({ ...x, items: [...x.items, { key: nextKey(), productId: '', qty: '', unitCost: '' }] }))}>
                  Otro producto en este bulto
                </Button>
              </li>
            ))}
          </ul>
          <Button
            icon={PackagePlus}
            onClick={() =>
              setBales((s) => {
                const last = Number(s.at(-1)?.number);
                return [...s, { key: nextKey(), number: Number.isFinite(last) ? String(last + 1) : String(s.length + 1), items: [{ key: nextKey(), productId: '', qty: '', unitCost: '' }] }];
              })
            }
          >
            Agregar un bulto
          </Button>
          <Button variant="primary" big icon={Save} busy={busy} disabled={bales.length === 0 || bales.some((b) => b.items.some((i) => !i.productId || i.qty === '' || i.qty <= 0))} onClick={save}>
            Guardar lista de empaque
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}
