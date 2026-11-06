// Alta y edición de productos (administración). En tabaco lo primero es «¿Premium o de mazo?»:
// capote, tripa y marca solo en premium. El nombre se arma solo con la familia y la variante
// (nadie escribe «Toro Maduro» a mano) y «Otra variante» copia la familia para cambiar la capa.
import { BookOpen, Crown, Package, Save } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { CommissionRule, Product, ProductKind } from '../../data/types';
import { capaShade, composeName, sizeText, variantLabelFor } from '../../domain/products';
import type { FieldDef } from '../../lines/config';
import { fmtMoney } from '../../lib/money';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { getProduct, hasCost, saveProduct } from '../../services/catalog';
import { CigarSilhouette } from '../../ui/brand';
import { Button, Card, EmptyState, ErrorBox, LinkButton, Loading, NumberInput, PageHeader, SelectInput, TextArea, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';

type Num = number | '';

interface FormState {
  kind: ProductKind | '';
  familyName: string;
  familyTouched: boolean;
  sku: string;
  skuTouched: boolean;
  brandLine: string;
  barcode: string;
  active: boolean;
  unitName: string;
  cigarsPerBundle: Num;
  packSize: Num;
  cost: Num;
  priceToStore: Num;
  boxPrice: Num;
  suggestedRetail: Num;
  ruleType: CommissionRule['type'];
  ruleValue: Num;
  lowStockThreshold: Num;
  notes: string;
  pairing: string;
  attrs: Record<string, string | number>;
}

function initialState(pr: Product | undefined, opts: { line: 'tabaco' | 'cafe'; prefix: string; rule: CommissionRule; low: number; copy: boolean }): FormState {
  const isCopy = opts.copy && pr;
  const attrs = { ...(pr?.attrs ?? {}) };
  if (isCopy) delete attrs.capa;
  return {
    kind: pr?.kind ?? '',
    familyName: pr?.familyName ?? pr?.name ?? '',
    familyTouched: Boolean(pr),
    sku: isCopy ? '' : (pr?.sku ?? ''),
    skuTouched: Boolean(pr && !isCopy),
    brandLine: pr?.brandLine ?? '',
    barcode: isCopy ? '' : (pr?.barcode ?? ''),
    active: pr?.active ?? true,
    unitName: pr?.unitName ?? (opts.line === 'tabaco' ? 'mazo' : 'unidad'),
    cigarsPerBundle: pr ? Number(pr.attrs.cigarsPerBundle ?? 25) : 25,
    packSize: pr?.packSize ?? (opts.line === 'tabaco' ? 50 : 12),
    cost: pr?.cost ?? '',
    priceToStore: pr?.priceToStore ?? '',
    boxPrice: pr?.boxPrice ?? '',
    suggestedRetail: pr?.suggestedRetail ?? '',
    ruleType: pr?.sellerCommission.type ?? opts.rule.type,
    ruleValue: pr?.sellerCommission.value ?? opts.rule.value,
    lowStockThreshold: pr?.lowStockThreshold ?? opts.low,
    notes: pr?.notes ?? '',
    pairing: pr?.pairing ?? '',
    attrs,
  };
}

export function ProductFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const from = params.get('de');
  const { ctx, actor, p } = useLine();
  const sourceId = id ?? from ?? undefined;
  const existing = useAsync(() => (sourceId ? getProduct(ctx, sourceId) : Promise.resolve(undefined)), [ctx, sourceId]);
  if (actor.role !== 'admin') {
    return (
      <EmptyState icon={BookOpen} title="Solo administración edita el catálogo" action={<LinkButton to={p('catalogo')}>Ver catálogo</LinkButton>}>
        Vendedores y locales ven el catálogo, pero no lo cambian.
      </EmptyState>
    );
  }
  if (sourceId && existing.loading && !existing.data) return <Loading rows={4} />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const pr = existing.data?.product;
  const full = pr && hasCost(pr) ? pr : undefined;
  return <ProductForm key={`${id ?? 'nuevo'}-${from ?? ''}`} initial={id ? full : undefined} copyOf={!id && from ? full : undefined} />;
}

function ProductForm({ initial, copyOf }: { initial?: Product; copyOf?: Product }) {
  const { ctx, config, p, line, actor } = useLine();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const [f, setF] = useState<FormState>(() =>
    initialState(initial ?? copyOf, { line, prefix: config.skuPrefix, rule: config.defaultCommission, low: line === 'tabaco' ? 60 : 48, copy: Boolean(copyOf) }),
  );
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const setAttr = (k: string, v: string | number) => setF((s) => ({ ...s, attrs: { ...s.attrs, [k]: v } }));

  const isTabaco = line === 'tabaco';
  const needsKind = config.hasKinds && !f.kind;
  const kind = f.kind || undefined;
  // Familia sugerida para lo de mazo: vitola y medida («Toro 6 × 52»), mientras no la escriban.
  const suggestedFamily = isTabaco && kind === 'mazo' ? [String(f.attrs.vitola ?? '').trim(), sizeText(f.attrs)].filter(Boolean).join(' ') : '';
  const familyName = f.familyTouched || !suggestedFamily ? f.familyName : suggestedFamily;
  const variant = variantLabelFor(line, f.attrs, familyName);
  const preview = composeName(familyName || '…', kind === 'mazo' || copyOf ? variant : '');
  const suggestedSku = `${config.skuPrefix}-${familyName.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 10)}${f.attrs.capa ? `-${String(f.attrs.capa).slice(0, 3).toUpperCase()}` : ''}`;
  const sku = f.skuTouched ? f.sku : familyName ? suggestedSku : f.sku;
  const unitWord = f.unitName === 'mazo' ? 'mazo' : f.unitName === 'tabaco' ? 'tabaco' : 'unidad';
  const earning = typeof f.priceToStore === 'number' && typeof f.suggestedRetail === 'number' ? f.suggestedRetail - f.priceToStore : null;
  const boxDefault = typeof f.priceToStore === 'number' && typeof f.packSize === 'number' ? Math.round(f.priceToStore * f.packSize * 100) / 100 : null;
  const fields = config.productFields.filter((fd) => !fd.kinds || (kind && fd.kinds.includes(kind)));

  const submit = () =>
    void run(async () => {
      const attrs: Record<string, string | number> = { ...f.attrs };
      if (f.unitName === 'mazo') attrs.cigarsPerBundle = f.cigarsPerBundle === '' ? 25 : f.cigarsPerBundle;
      else delete attrs.cigarsPerBundle;
      const brandLine = isTabaco
        ? kind === 'premium'
          ? [attrs.brand, attrs.edition].filter(Boolean).join(' · ') || 'Premium'
          : 'De mazo (sin marca)'
        : f.brandLine;
      const saved = await saveProduct(ctx, {
        id: initial?.id,
        sku,
        name: familyName,
        familyName,
        kind,
        brandLine,
        barcode: f.barcode.trim(),
        active: f.active,
        cost: f.cost === '' ? Number.NaN : f.cost,
        priceToStore: f.priceToStore === '' ? Number.NaN : f.priceToStore,
        boxPrice: f.boxPrice === '' ? 0 : f.boxPrice,
        suggestedRetail: f.suggestedRetail === '' ? Number.NaN : f.suggestedRetail,
        sellerCommission: { type: f.ruleType, value: f.ruleValue === '' ? 0 : f.ruleValue },
        lowStockThreshold: f.lowStockThreshold === '' ? 0 : f.lowStockThreshold,
        packSize: f.packSize === '' ? 1 : f.packSize,
        unitName: f.unitName,
        notes: f.notes,
        pairing: f.pairing,
        attrs,
      });
      nav(p(`catalogo/${saved.id}`), { replace: true });
      return saved;
    }, initial ? 'Cambios guardados.' : copyOf ? 'Variante creada.' : 'Producto creado.');

  const header = (
    <PageHeader
      back={{ to: initial ? p(`catalogo/${initial.id}`) : copyOf ? p(`catalogo/${copyOf.id}`) : p('catalogo'), label: initial ? initial.name : copyOf ? copyOf.name : 'Catálogo' }}
      title={initial ? 'Editar producto' : copyOf ? `Otra variante de ${copyOf.familyName ?? copyOf.name}` : 'Nuevo producto'}
      subtitle={copyOf ? 'Se copió la familia: elige la capa (o la medida) de la nueva variante.' : 'Los costos solo los ve administración.'}
    />
  );

  if (needsKind) {
    return (
      <>
        {header}
        <Card className="mx-auto max-w-2xl p-5 sm:p-7">
          <h2 className="font-display text-2xl">¿Premium o de mazo?</h2>
          <p className="mt-1 text-muted">Lo de mazo no tiene marca: lo que importa es la medida y la capa. El premium lleva marca, capote y tripa.</p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button type="button" className="glass flex min-h-28 flex-col items-start gap-1 p-4 text-left hover:border-line-strong" onClick={() => setF((s) => ({ ...s, kind: 'mazo', unitName: 'mazo', packSize: 50 }))}>
              <Package className="h-7 w-7 text-accent" aria-hidden />
              <span className="text-lg font-bold">De mazo</span>
              <span className="text-sm text-muted">Sin marca. Mazos de 25 tabacos, cajas de 50 mazos.</span>
            </button>
            <button type="button" className="glass flex min-h-28 flex-col items-start gap-1 p-4 text-left hover:border-line-strong" onClick={() => setF((s) => ({ ...s, kind: 'premium', unitName: 'tabaco', packSize: 20 }))}>
              <Crown className="h-7 w-7 text-accent" aria-hidden />
              <span className="text-lg font-bold">Premium</span>
              <span className="text-sm text-muted">Con marca, línea o edición, capote y tripa.</span>
            </button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {header}
      {isTabaco && f.attrs.lengthIn && f.attrs.ringGauge ? (
        <div className="hero-producto mb-4 p-4">
          <CigarSilhouette
            lengthIn={Number(f.attrs.lengthIn)}
            ringGauge={Number(f.attrs.ringGauge)}
            shade={String(f.attrs.capa ? capaShade(f.attrs.capa) : 'colorado')}
            vitola={String(f.attrs.vitola ?? '')}
            className="sombra-suave w-full"
          />
          <p className="mt-1 text-sm text-hero-tenue">Vista previa a escala mientras completas largo, cepo y capa.</p>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="grid content-start gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">Datos</h2>
            {config.hasKinds ? (
              <SelectInput
                label="Tipo"
                value={f.kind}
                onChange={(e) => set('kind', e.target.value as ProductKind)}
                options={[
                  { value: 'mazo', label: 'De mazo' },
                  { value: 'premium', label: 'Premium' },
                ]}
              />
            ) : null}
          </div>
          <TextInput
            label={kind === 'mazo' ? 'Familia (vitola y medida)' : isTabaco ? 'Nombre' : 'Nombre del producto'}
            hint={kind === 'mazo' ? 'Se arma sola con la vitola y la medida; puedes cambiarla.' : undefined}
            value={familyName}
            onChange={(e) => setF((s) => ({ ...s, familyName: e.target.value, familyTouched: true }))}
            required
          />
          <p className="-mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <span className="text-muted">Se verá como: </span>
            <span className="font-semibold text-ink">{preview}</span>
          </p>
          {!isTabaco ? <TextInput label="Marca o línea" value={f.brandLine} onChange={(e) => set('brandLine', e.target.value)} required /> : null}
          {fields.map((fd) => (
            <AttrField key={fd.key} field={fd} value={f.attrs[fd.key]} onChange={(v) => setAttr(fd.key, v)} />
          ))}
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="SKU" value={sku} onChange={(e) => setF((s) => ({ ...s, sku: e.target.value.toUpperCase(), skuTouched: true }))} required />
            <TextInput label="Código de barras" inputMode="numeric" placeholder="Si lo trae" value={f.barcode} onChange={(e) => set('barcode', e.target.value.trim())} />
          </div>
        </Card>
        <div className="grid content-start gap-4">
          <Card className="grid gap-4 p-4 sm:p-5">
            <h2 className="font-bold">Cómo se cuenta y se vende</h2>
            {isTabaco ? (
              <SelectInput
                label="Se cuenta por"
                value={f.unitName}
                onChange={(e) => set('unitName', e.target.value)}
                options={[
                  { value: 'mazo', label: 'Mazo (tabacos atados)' },
                  { value: 'tabaco', label: 'Tabaco suelto' },
                ]}
              />
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              {f.unitName === 'mazo' ? <NumberInput label="Tabacos por mazo" min={1} step={1} value={f.cigarsPerBundle} onValue={(v) => set('cigarsPerBundle', v)} /> : null}
              <NumberInput label={`${f.unitName === 'mazo' ? 'Mazos' : f.unitName === 'tabaco' ? 'Tabacos' : 'Unidades'} por caja`} min={1} step={1} value={f.packSize} onValue={(v) => set('packSize', v)} />
            </div>
          </Card>
          <Card className="grid gap-4 p-4 sm:p-5">
            <h2 className="font-bold">Precios y comisiones</h2>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={`Precio al local por ${unitWord}`} step={0.01} min={0} value={f.priceToStore} onValue={(v) => set('priceToStore', v)} />
              <NumberInput label="Precio por caja" step={0.01} min={0} value={f.boxPrice} onValue={(v) => set('boxPrice', v)} hint={boxDefault !== null ? `Vacío: ${fmtMoney(boxDefault)}` : 'Si la caja tiene otro precio'} />
              <NumberInput label={`PVP sugerido por ${unitWord}`} step={0.01} min={0} value={f.suggestedRetail} onValue={(v) => set('suggestedRetail', v)} />
              <div className="field">
                <span className="field-label">El local gana</span>
                <p className={`glow pt-2 text-xl font-bold tabular ${earning !== null && earning < 0 ? 'text-danger' : ''}`}>{earning === null ? '—' : fmtMoney(earning)}</p>
              </div>
              <NumberInput label={`Costo por ${unitWord} (USD)`} step={0.01} min={0} value={f.cost} onValue={(v) => set('cost', v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SelectInput
                label="Comisión del vendedor"
                value={f.ruleType}
                onChange={(e) => set('ruleType', e.target.value as CommissionRule['type'])}
                options={[
                  { value: 'percent', label: '% del precio al local' },
                  { value: 'fixed', label: `Fija por ${unitWord} (USD)` },
                ]}
              />
              <NumberInput label={f.ruleType === 'percent' ? 'Porcentaje' : 'Monto'} step={f.ruleType === 'percent' ? 0.5 : 0.05} min={0} value={f.ruleValue} onValue={(v) => set('ruleValue', v)} />
            </div>
          </Card>
          <Card className="grid gap-4 p-4 sm:p-5">
            <h2 className="font-bold">Inventario</h2>
            <NumberInput label="Aviso de stock bajo" min={0} step={1} value={f.lowStockThreshold} onValue={(v) => set('lowStockThreshold', v)} hint={`En ${unitWord === 'unidad' ? 'unidades' : `${unitWord}s`} disponibles`} />
            <label className="flex min-h-12 items-center gap-3">
              <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
              <span className="font-semibold">Activo (lo ven vendedores y locales)</span>
            </label>
          </Card>
          <Card className="grid gap-4 p-4 sm:p-5">
            <TextArea label={config.notesLabel} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            <TextArea label={config.pairingLabel} value={f.pairing} onChange={(e) => set('pairing', e.target.value)} />
          </Card>
        </div>
      </div>
      <div className="sticky bottom-[76px] z-20 mt-5 flex justify-end gap-2 lg:bottom-4 lg:justify-start">
        <Button type="submit" variant="primary" big icon={Save} busy={busy} disabled={actor.readOnly}>
          {initial ? 'Guardar cambios' : copyOf ? 'Crear variante' : 'Crear producto'}
        </Button>
      </div>
    </form>
  );
}

function AttrField({ field, value, onChange }: { field: FieldDef; value: string | number | undefined; onChange: (v: string | number) => void }) {
  if (field.kind === 'select') {
    return <SelectInput label={field.label} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} options={field.options} placeholder="Elige una opción" />;
  }
  if (field.kind === 'number') {
    return (
      <NumberInput
        label={field.unit ? `${field.label} (${field.unit})` : field.label}
        hint={field.hint}
        step={field.step}
        min={field.min}
        value={value === undefined || value === '' ? '' : Number(value)}
        onValue={(v) => onChange(v === '' ? '' : v)}
      />
    );
  }
  const listId = field.suggestions ? `sugerencias-${field.key}` : undefined;
  return (
    <>
      <TextInput label={field.label} placeholder={field.placeholder} hint={field.hint} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} list={listId} />
      {field.suggestions ? (
        <datalist id={listId}>
          {field.suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}
