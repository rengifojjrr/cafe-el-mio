// Importar productos desde Excel o CSV (la exportación de Odoo u otra hoja): elegir el archivo,
// revisar qué columna es cada cosa, ver la vista previa fila por fila y crear.
import { AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, FileSpreadsheet, Images, Info, Upload, XCircle } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useLine } from '../../app/line-context';
import {
  type ColumnMap,
  type ImportField,
  type ImportOptions,
  type ImportPlan,
  type ImportRow,
  IMPORT_FIELDS,
  countsText,
  defaultImportOptions,
  detectColumns,
  optionErrors,
} from '../../domain/import-products';
import { countText, unitNames } from '../../domain/products';
import { KIND_LABEL, STRENGTHS } from '../../lines/config';
import { fmtMoney } from '../../lib/money';
import { type SheetTable, readSheetFile } from '../../lib/sheets';
import { type ImportResult, previewImport, runImport } from '../../services/catalog-import';
import { Button, Card, EmptyState, LinkButton, NumberInput, PageHeader, Pill, SelectInput, Tabs, TextInput } from '../../ui/kit';
import { errorText, useAction, useToast } from '../../ui/toast';

type Filter = 'todos' | 'nuevo' | 'actualiza' | 'avisos' | 'error';

export function ImportProductsPage() {
  const { actor, p } = useLine();
  if (actor.role !== 'admin' || actor.readOnly) {
    return (
      <EmptyState icon={BookOpen} title="Solo administración importa productos" action={<LinkButton to={p('catalogo')}>Ver catálogo</LinkButton>}>
        {actor.readOnly ? 'Estás en modo «ver como…»: aquí solo se mira.' : 'Vendedores y locales ven el catálogo, pero no lo cambian.'}
      </EmptyState>
    );
  }
  return <Importer />;
}

function Importer() {
  const { ctx, line, p } = useLine();
  const { push } = useToast();
  const { run, busy } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; table: SheetTable } | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [opts, setOpts] = useState<ImportOptions>(() => defaultImportOptions(line));
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [reading, setReading] = useState(false);

  const pick = async (f: File) => {
    setReading(true);
    try {
      const table = await readSheetFile(f);
      if (!table.rows.length) throw new Error('El archivo solo tiene encabezados: no hay productos.');
      setFile({ name: f.name, table });
      setMap(detectColumns(table.headers));
      setPlan(null);
      setResult(null);
    } catch (e) {
      push('error', errorText(e));
    } finally {
      setReading(false);
    }
  };

  const restart = () => {
    setFile(null);
    setPlan(null);
    setResult(null);
    setOpts(defaultImportOptions(line));
  };

  const step = result ? 4 : plan ? 3 : file ? 2 : 1;
  const request = file ? { table: file.table, map, options: opts, fileName: file.name } : null;

  return (
    <>
      <PageHeader
        back={{ to: p('catalogo'), label: 'Catálogo' }}
        title="Importar productos"
        subtitle="Desde el Excel que exporta Odoo o cualquier hoja .xlsx o .csv con una fila de encabezados."
      />
      <ol className="mb-5 flex flex-wrap gap-2 text-sm" aria-label="Pasos">
        {['Archivo', 'Columnas', 'Revisar', 'Listo'].map((label, i) => (
          <li key={label}>
            <Pill tone={step === i + 1 ? 'accent' : undefined}>
              {i + 1}. {label}
            </Pill>
          </li>
        ))}
      </ol>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        aria-label="Elegir el archivo de productos"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pick(f);
        }}
      />

      {step === 1 ? (
        <Card className="grid max-w-2xl gap-4 p-5">
          <p className="text-ink">
            En Odoo: Inventario → Productos → marca los productos → Acción → Exportar. Sirve la exportación corta («Nombre para mostrar», cantidades y categoría) o la
            completa de variantes. Las columnas se reconocen solas y antes de crear ves qué pasa con cada fila.
          </p>
          <Button variant="primary" big icon={FileSpreadsheet} busy={reading} onClick={() => fileRef.current?.click()}>
            Elegir archivo (.xlsx o .csv)
          </Button>
        </Card>
      ) : null}

      {step === 2 && file ? (
        <ColumnsStep
          file={file}
          map={map}
          setMap={setMap}
          opts={opts}
          setOpts={setOpts}
          busy={busy}
          onOther={() => fileRef.current?.click()}
          onPreview={() =>
            void run(async () => {
              if (!request) return;
              setPlan(await previewImport(ctx, request));
            })
          }
        />
      ) : null}

      {step === 3 && plan && file ? (
        <PreviewStep
          plan={plan}
          fileName={file.name}
          busy={busy}
          onBack={() => setPlan(null)}
          onCreate={() =>
            void run(
              async () => {
                if (!request) throw new Error('Elige el archivo.');
                const r = await runImport(ctx, request);
                setResult(r);
                return r;
              },
              (r) => `Listo: ${r.created} ${r.created === 1 ? 'producto nuevo' : 'productos nuevos'} y ${r.updated} ${r.updated === 1 ? 'actualizado' : 'actualizados'}.`,
            )
          }
        />
      ) : null}

      {step === 4 && result ? (
        <Card className="grid max-w-2xl gap-3 p-5">
          <p className="flex items-center gap-2 text-lg font-bold text-ink">
            <CheckCircle2 className="h-6 w-6 text-ok" aria-hidden />
            {result.created} {result.created === 1 ? 'nuevo' : 'nuevos'} y {result.updated} {result.updated === 1 ? 'actualizado' : 'actualizados'}
          </p>
          {result.skipped ? <p className="text-ink">{result.skipped === 1 ? 'Una fila con errores no se cargó.' : `${result.skipped} filas con errores no se cargaron.`}</p> : null}
          <p className="text-muted">
            {result.movements
              ? `El almacén quedó con las cantidades del archivo (${result.movements} ${result.movements === 1 ? 'movimiento' : 'movimientos'} en el libro).`
              : 'El almacén no cambió.'}{' '}
            Revisa precios y costos en cada producto: lo que el archivo no traía quedó con los valores por defecto.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <LinkButton to={p('catalogo')} variant="primary" icon={BookOpen}>
              Ver el catálogo
            </LinkButton>
            <LinkButton to={p('catalogo/fotos')} icon={Images}>
              Fotos en lote
            </LinkButton>
            <Button icon={Upload} onClick={restart}>
              Importar otro archivo
            </Button>
          </div>
        </Card>
      ) : null}
    </>
  );
}

// ---------- Paso 2: columnas y opciones ----------

function sample(table: SheetTable, col: number): string {
  const v = table.rows.find((r) => r[col])?.[col] ?? '';
  return v.length > 28 ? `${v.slice(0, 27)}…` : v;
}

const num = (v: number | '') => (v === '' ? Number.NaN : v);
const shown = (v: number | null) => (v === null || Number.isNaN(v) ? '' : v);

function ColumnsStep({
  file,
  map,
  setMap,
  opts,
  setOpts,
  busy,
  onOther,
  onPreview,
}: {
  file: { name: string; table: SheetTable };
  map: ColumnMap;
  setMap: (m: ColumnMap) => void;
  opts: ImportOptions;
  setOpts: (o: ImportOptions) => void;
  busy: boolean;
  onOther: () => void;
  onPreview: () => void;
}) {
  const { line, config } = useLine();
  const set = <K extends keyof ImportOptions>(k: K, v: ImportOptions[K]) => setOpts({ ...opts, [k]: v });
  const problems = optionErrors(line, opts, map);
  const columnOptions = useMemo(
    () => [
      { value: '-1', label: 'No está en el archivo' },
      ...file.table.headers.map((h, i) => {
        const s = sample(file.table, i);
        return { value: String(i), label: s ? `${h} (p. ej. ${s})` : h };
      }),
    ],
    [file.table],
  );
  const setCol = (field: ImportField, value: string) => {
    const next: ColumnMap = { ...map };
    const i = Number(value);
    if (i < 0) delete next[field];
    else {
      // Una columna es una sola cosa: se la quita al campo que la tenía.
      for (const k of Object.keys(next) as ImportField[]) if (next[k] === i) delete next[k];
      next[field] = i;
    }
    setMap(next);
  };
  const tabaco = line === 'tabaco';
  const roastField = config.productFields.find((f) => f.key === 'roast');
  const lineField = config.productFields.find((f) => f.key === 'productionLine');

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-bold break-words text-ink">Columnas de «{file.name}»</h2>
            <p className="text-sm text-muted">
              {file.table.rows.length} {file.table.rows.length === 1 ? 'fila' : 'filas'}. Revisa qué columna es cada cosa: las de Odoo ya quedaron elegidas.
            </p>
          </div>
          <Button variant="ghost" icon={Upload} onClick={onOther}>
            Elegir otro archivo
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {IMPORT_FIELDS.map((f) => (
            <SelectInput
              key={f.key}
              label={f.key === 'origin' && !tabaco ? 'Origen' : f.label}
              value={String(map[f.key] ?? -1)}
              onChange={(e) => setCol(f.key, e.target.value)}
              options={columnOptions}
            />
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-bold text-ink">Opciones</h2>
        <p className="text-sm text-muted">Para lo que el archivo no dice. Todo se puede cambiar después en cada producto.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {tabaco ? (
            <>
              <SelectInput
                label="Las cantidades de tabaco de mazo vienen en"
                value={opts.qtyUnit}
                onChange={(e) => set('qtyUnit', e.target.value as ImportOptions['qtyUnit'])}
                hint={opts.qtyUnit === 'tabaco' ? 'Se pasan a mazos hacia abajo y se avisa lo que sobra.' : undefined}
                options={[
                  { value: 'mazo', label: 'Mazos' },
                  { value: 'caja', label: `Cajas (de ${Number.isNaN(opts.bundlesPerBox) ? '…' : opts.bundlesPerBox} mazos)` },
                  { value: 'tabaco', label: `Tabacos (de ${Number.isNaN(opts.cigarsPerBundle) ? '…' : opts.cigarsPerBundle} por mazo)` },
                ]}
              />
              <div className="field">
                <span className="field-label">Premium</span>
                <p className="text-sm text-ink">Se cuenta por unidad (cada paquete o caja).</p>
              </div>
              <NumberInput label="Tabacos por mazo" min={1} step={1} value={shown(opts.cigarsPerBundle)} onValue={(v) => set('cigarsPerBundle', num(v))} />
              <NumberInput label="Mazos por caja" min={1} step={1} value={shown(opts.bundlesPerBox)} onValue={(v) => set('bundlesPerBox', num(v))} />
            </>
          ) : (
            <>
              <SelectInput
                label="Las cantidades vienen en"
                value={opts.qtyUnit}
                onChange={(e) => set('qtyUnit', e.target.value as ImportOptions['qtyUnit'])}
                options={[
                  { value: 'unidad', label: 'Unidades' },
                  { value: 'caja', label: `Cajas (de ${Number.isNaN(opts.unitsPerBox) ? '…' : opts.unitsPerBox} unidades)` },
                ]}
              />
              <NumberInput label="Unidades por caja" min={1} step={1} value={shown(opts.unitsPerBox)} onValue={(v) => set('unitsPerBox', num(v))} />
            </>
          )}
          {map.price === undefined ? (
            <>
              <NumberInput
                label={tabaco ? 'Precio al local por mazo (USD)' : 'Precio al local por unidad (USD)'}
                min={0}
                step={0.01}
                value={shown(opts.defaultPrice)}
                onValue={(v) => set('defaultPrice', num(v))}
                hint="El archivo no trae precios. El PVP sugerido queda en precio × 1.75."
              />
              {tabaco ? (
                <NumberInput label="Precio por unidad premium (USD)" min={0} step={0.01} value={shown(opts.defaultPremiumPrice)} onValue={(v) => set('defaultPremiumPrice', num(v))} />
              ) : null}
            </>
          ) : null}
          {map.cost === undefined ? (
            <NumberInput
              label="Costo por defecto (USD, opcional)"
              min={0}
              step={0.01}
              value={shown(opts.defaultCost)}
              onValue={(v) => set('defaultCost', v === '' ? null : v)}
              hint="Si lo dejas vacío, el costo queda en 0 marcado como provisional."
            />
          ) : null}
          <TextInput
            label={tabaco ? 'Procedencia (si el archivo no la trae)' : 'Origen (si el archivo no lo trae)'}
            value={opts.origin}
            onChange={(e) => set('origin', e.target.value)}
            error={tabaco && problems.some((x) => /Cuba/.test(x)) ? 'No se registra tabaco de origen Cuba (embargo de EE. UU.).' : undefined}
          />
          {tabaco ? (
            <SelectInput label="Fortaleza" value={opts.strength} onChange={(e) => set('strength', e.target.value)} options={STRENGTHS} hint="Odoo no la trae: la cambias luego en cada producto." />
          ) : (
            <>
              {roastField?.kind === 'select' ? <SelectInput label="Tueste (si no lo dicen los atributos)" value={opts.roast} onChange={(e) => set('roast', e.target.value)} options={roastField.options} /> : null}
              {lineField?.kind === 'select' ? <SelectInput label="Línea de producción" value={opts.productionLine} onChange={(e) => set('productionLine', e.target.value)} options={lineField.options} /> : null}
              <TextInput label="Presentación" value={opts.presentation} onChange={(e) => set('presentation', e.target.value)} />
            </>
          )}
        </div>
      </Card>

      {problems.length ? (
        <ul className="grid gap-1 text-sm text-danger" aria-label="Falta para seguir">
          {problems.map((x) => (
            <li key={x} className="flex items-start gap-2">
              <XCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
              {x}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" big icon={CheckCircle2} busy={busy} disabled={problems.length > 0} onClick={onPreview}>
          Ver vista previa
        </Button>
      </div>
    </div>
  );
}

// ---------- Paso 3: vista previa ----------

function PreviewStep({ plan, fileName, busy, onBack, onCreate }: { plan: ImportPlan; fileName: string; busy: boolean; onBack: () => void; onCreate: () => void }) {
  const [filter, setFilter] = useState<Filter>('todos');
  const c = plan.counts;
  const rows = plan.rows.filter((r) =>
    filter === 'todos' ? true : filter === 'avisos' ? r.status !== 'error' && r.warnings.length > 0 : r.status === filter,
  );
  const canCreate = c.nuevos + c.actualizan > 0;
  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <h2 className="font-bold break-words text-ink">Vista previa de «{fileName}»</h2>
        <p className="glow mt-1 text-lg font-bold tabular" data-testid="conteo-importar">
          {countsText(c)}
        </p>
        <ul className="mt-3 grid gap-1.5 text-sm text-ink">
          {plan.notices.map((n) => (
            <li key={n} className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
      </Card>

      <Tabs<Filter>
        label="Qué filas ver"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'todos', label: 'Todas', count: plan.rows.length },
          { value: 'nuevo', label: 'Nuevos', count: c.nuevos },
          { value: 'actualiza', label: 'Se actualizan', count: c.actualizan },
          { value: 'avisos', label: 'Con avisos', count: c.conAvisos },
          { value: 'error', label: 'Con errores', count: c.conErrores },
        ]}
      />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <RowCard key={r.rowNumber} row={r} />
        ))}
      </ul>
      {rows.length === 0 ? <p className="text-muted">No hay filas así.</p> : null}

      <div className="sticky bottom-[76px] z-20 flex flex-wrap gap-2 lg:bottom-4">
        <Button variant="primary" big icon={CheckCircle2} busy={busy} disabled={!canCreate} onClick={onCreate}>
          Crear
        </Button>
        <Button big icon={ArrowLeft} onClick={onBack}>
          Volver a las columnas
        </Button>
      </div>
    </div>
  );
}

function qtyLine(r: ImportRow): string {
  if (r.qty === null) return 'No toca el almacén.';
  const unit = unitNames(r.unitName || 'unidad');
  if (r.status === 'actualiza') {
    const now = r.currentQty ?? 0;
    return now === r.qty ? `Almacén: ${countText(r.qty, unit)}, sin cambios.` : `Almacén: de ${countText(now, unit)} a ${countText(r.qty, unit)}.`;
  }
  return r.qty ? `${countText(r.qty, unit)} al almacén.` : 'Sin existencias por ahora.';
}

function RowCard({ row: r }: { row: ImportRow }) {
  const tone = r.status === 'error' ? 'danger' : r.status === 'actualiza' ? 'info' : 'ok';
  const label = r.status === 'error' ? 'No se carga' : r.status === 'actualiza' ? 'Se actualiza' : 'Nuevo';
  const unit = unitNames(r.unitName || 'unidad');
  return (
    <li className="glass min-w-0 p-4" data-fila={r.rowNumber}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted tabular">Fila {r.rowNumber}</p>
        <Pill tone={tone}>{label}</Pill>
      </div>
      <p className="mt-1 text-sm break-words text-muted">{r.source || '(sin nombre)'}</p>
      {r.status !== 'error' ? (
        <div className="mt-2 grid gap-0.5 text-sm">
          <p className="text-base font-bold break-words text-ink">{r.name}</p>
          <p className="break-words text-ink">
            Familia {r.familyName}
            {r.variantLabel ? ` · variante ${r.variantLabel}` : ''}
            {r.kind ? ` · ${KIND_LABEL[r.kind]}` : ''}
          </p>
          <p className="break-words text-muted">
            SKU {r.sku}
            {r.barcode ? ` · código ${r.barcode}` : ''}
          </p>
          <p className="text-ink">{qtyLine(r)}</p>
          <p className="text-muted tabular">
            {fmtMoney(r.priceToStore)} por {unit.one} · PVP {fmtMoney(r.suggestedRetail)} · costo {fmtMoney(r.cost)}
          </p>
        </div>
      ) : null}
      {r.warnings.length || r.errors.length ? (
        <ul className="mt-2 grid gap-1 text-sm">
          {r.errors.map((e) => (
            <li key={e} className="flex items-start gap-1.5 text-danger">
              <XCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
              <span className="min-w-0 break-words">{e}</span>
            </li>
          ))}
          {r.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-warn">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
              <span className="min-w-0 break-words">{w}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
