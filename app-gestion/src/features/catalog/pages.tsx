// Catálogo: fichas con la silueta a escala (tabaco) o la foto de la marca (café), precios,
// lo que gana el local, la comisión del vendedor y la disponibilidad con la próxima llegada.
import { AlertTriangle, BookOpen, Camera, Eye, EyeOff, PackagePlus, Pencil, Plus, Save, Search, ShoppingBag, Trash2, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { CommissionRule, Product } from '../../data/types';
import { describeRule, storeEarning } from '../../domain/money-rules';
import { capaShade, packText } from '../../domain/products';
import { arrivalStatusLabel } from '../../lines/config';
import { fmtMoney } from '../../lib/money';
import { fmtDate, fmtRelativeDays } from '../../lib/time';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { addProductPhoto, getPhoto, getProduct, hasCost, listProducts, removeProductPhoto, saveProduct, setProductActive, type ProductView } from '../../services/catalog';
import { listLots, type NextArrival } from '../../services/inventory';
import { CigarSilhouette } from '../../ui/brand';
import {
  Button,
  Card,
  EmptyState,
  ErrorBox,
  KeyValue,
  LinkButton,
  Loading,
  NumberInput,
  PageHeader,
  Pill,
  Section,
  SelectInput,
  Stat,
  TextArea,
  TextInput,
} from '../../ui/kit';
import { PhotoPicker, ProductThumb, useStoredPhoto } from '../../ui/media';
import { useAction } from '../../ui/toast';
import { attrText } from '../common';
import { QuickOrderSheet } from '../consignment/components';

function arrivalText(n: NextArrival | undefined, now: Date): string {
  if (!n) return 'Sin llegada programada';
  return `Llegan ${n.qty} el ${fmtDate(n.eta)}, ${fmtRelativeDays(n.eta, now)}`;
}

// ---------- Lista ----------

export function CatalogPage() {
  const { ctx, actor, config, p, line } = useLine();
  const isAdmin = actor.role === 'admin';
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const [ordering, setOrdering] = useState<ProductView | null>(null);
  const { data, error, loading } = useAsync(() => listProducts(ctx, { includeInactive: showInactive }), [ctx, showInactive]);
  const now = ctx.now();

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((v) => {
      if (onlyLow && !v.stock.lowStock) return false;
      if (!term) return true;
      const pr = v.product;
      return `${pr.name} ${pr.sku} ${pr.brandLine} ${Object.values(pr.attrs).join(' ')}`.toLowerCase().includes(term);
    });
  }, [data, q, onlyLow]);

  const subtitle =
    actor.role === 'store'
      ? 'Lo que puedes pedir, lo que ganas por cada unidad y cuándo llega más.'
      : actor.role === 'seller'
        ? 'Precios, tu comisión por producto y la próxima llegada al almacén.'
        : `${data?.length ?? 0} productos de ${config.name}. Costos, precios, comisiones y existencias.`;

  return (
    <>
      <PageHeader
        title="Catálogo"
        subtitle={subtitle}
        actions={
          isAdmin && !actor.readOnly ? (
            <LinkButton to={p('catalogo/nuevo')} variant="primary" icon={Plus}>
              Nuevo producto
            </LinkButton>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Buscar en el catálogo</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
          <input className="input pl-10" placeholder={line === 'tabaco' ? 'Buscar por nombre, vitola, país…' : 'Buscar por nombre, origen, tueste…'} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {isAdmin ? (
          <>
            <Button variant={onlyLow ? 'primary' : 'secondary'} icon={AlertTriangle} onClick={() => setOnlyLow(!onlyLow)} aria-pressed={onlyLow}>
              Stock bajo
            </Button>
            <Button variant="ghost" icon={showInactive ? EyeOff : Eye} onClick={() => setShowInactive(!showInactive)} aria-pressed={showInactive}>
              {showInactive ? 'Ocultar inactivos' : 'Ver inactivos'}
            </Button>
          </>
        ) : null}
      </div>
      {loading && !data ? <Loading rows={4} /> : null}
      {error ? <ErrorBox error={error} /> : null}
      {data && list.length === 0 ? (
        <EmptyState icon={BookOpen} title={data.length ? 'Nada coincide con la búsqueda' : 'Aún no hay productos'}>
          {data.length ? 'Prueba con otra palabra.' : isAdmin ? 'Toca «Nuevo producto» para armar el catálogo.' : 'Administración todavía no cargó productos.'}
        </EmptyState>
      ) : null}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((v) => (
          <li key={v.product.id}>
            <ProductCard view={v} now={now} onOrder={() => setOrdering(v)} />
          </li>
        ))}
      </ul>
      <QuickOrderSheet view={ordering} onClose={() => setOrdering(null)} />
    </>
  );
}

function ProductCard({ view, now, onOrder }: { view: ProductView; now: Date; onOrder: () => void }) {
  const { ctx, actor, config, p, line } = useLine();
  const pr = view.product;
  const s = view.stock;
  const summary = config.productFields.filter((f) => config.summaryFields.includes(f.key));
  return (
    <div className="glass relative flex h-full min-w-0 flex-col overflow-hidden transition-colors hover:border-line-strong">
      <Link to={p(`catalogo/${pr.id}`)} className="absolute inset-0 z-0 rounded-[20px]" aria-label={`Ver ${pr.name}`} />
      <div className={line === 'tabaco' ? 'pointer-events-none h-20 min-w-0 overflow-hidden px-3 pt-3' : 'pointer-events-none h-40 min-w-0 bg-surface-2 p-3'}>
        <ProductThumb product={pr} loadPhoto={(id) => getPhoto(ctx, id)} />
      </div>
      <div className="pointer-events-none flex flex-1 flex-col gap-2 p-4 pt-3 [&_button]:pointer-events-auto">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-bold leading-tight text-ink">{pr.name}</h2>
            <p className="truncate text-sm text-muted">{pr.brandLine}</p>
          </div>
          {!pr.active ? <Pill>Inactivo</Pill> : s.lowStock ? <Pill tone="warn">Stock bajo</Pill> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {summary.map((f) => (
            <span key={f.key} className="pill">
              {attrText(f, pr.attrs[f.key])}
            </span>
          ))}
        </div>
        <div className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 pt-2 text-sm">
          <span className="text-muted">Precio al local</span>
          <span className="text-right font-semibold tabular">{fmtMoney(pr.priceToStore)}</span>
          <span className="text-muted">PVP sugerido</span>
          <span className="text-right font-semibold tabular">{fmtMoney(pr.suggestedRetail)}</span>
          {actor.role === 'store' ? (
            <>
              <span className="font-semibold text-ink">Ganas por unidad</span>
              <span className="glow text-right font-bold tabular">{fmtMoney(view.storeEarning)}</span>
            </>
          ) : null}
          {actor.role === 'seller' && view.sellerCommissionPerUnit !== undefined ? (
            <>
              <span className="font-semibold text-ink">Tu comisión</span>
              <span className="glow text-right font-bold tabular">{fmtMoney(view.sellerCommissionPerUnit)}/u.</span>
            </>
          ) : null}
          {actor.role === 'admin' && hasCost(pr) ? (
            <>
              <span className="text-muted">Costo{pr.sampleCost ? ' (ejemplo)' : ''}</span>
              <span className="text-right tabular">{fmtMoney(pr.cost)}</span>
            </>
          ) : null}
        </div>
        <div className="mt-2 border-t border-line pt-2 text-sm">
          <p className="flex justify-between gap-2">
            <span className="text-muted">Disponible en almacén</span>
            <span className={`font-bold tabular ${s.available <= 0 ? 'text-danger' : 'text-ink'}`}>{s.available}</span>
          </p>
          {actor.role !== 'store' ? (
            <p className="flex justify-between gap-2">
              <span className="text-muted">{actor.role === 'seller' ? 'En tus locales' : 'En consignación'}</span>
              <span className="tabular">
                {s.consignment} <span className="text-faint">en {s.storesHolding} locales</span>
              </span>
            </p>
          ) : null}
          <p className="mt-1 flex items-center gap-1.5 text-muted">
            <Truck className="h-4 w-4 flex-none" aria-hidden />
            <span className="truncate">{arrivalText(s.nextArrival, now)}</span>
          </p>
        </div>
        {actor.role === 'store' && !actor.readOnly ? (
          <Button variant="primary" icon={ShoppingBag} className="relative z-10 mt-2 w-full" onClick={onOrder}>
            Pedir
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Ficha ----------

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const { ctx, actor, config, p, line } = useLine();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const { data: v, error, loading } = useAsync(() => getProduct(ctx, id), [ctx, id]);
  const lots = useAsync(() => (actor.role === 'admin' ? listLots(ctx) : Promise.resolve([])), [ctx, actor.role]);
  const [ordering, setOrdering] = useState(false);
  if (loading && !v) return <Loading rows={4} />;
  if (error) return <ErrorBox error={error} />;
  if (!v) return null;
  const pr = v.product;
  const s = v.stock;
  const now = ctx.now();
  const isAdmin = actor.role === 'admin';
  const canEdit = isAdmin && !actor.readOnly;
  const myLots = (lots.data ?? []).filter((l) => l.product.id === pr.id);
  const a = pr.attrs;

  return (
    <>
      <PageHeader
        back={{ to: p('catalogo'), label: 'Catálogo' }}
        title={pr.name}
        subtitle={`${pr.brandLine} · SKU ${pr.sku}`}
        actions={
          <>
            {actor.role === 'store' && !actor.readOnly ? (
              <Button variant="primary" icon={ShoppingBag} onClick={() => setOrdering(true)}>
                Pedir este producto
              </Button>
            ) : null}
            {canEdit ? (
              <>
                <LinkButton to={p(`catalogo/${pr.id}/editar`)} icon={Pencil}>
                  Editar
                </LinkButton>
                <Button
                  variant="ghost"
                  icon={pr.active ? EyeOff : Eye}
                  busy={busy}
                  onClick={() => void run(() => setProductActive(ctx, pr.id, !pr.active), pr.active ? 'Producto desactivado.' : 'Producto activo.')}
                >
                  {pr.active ? 'Desactivar' : 'Activar'}
                </Button>
              </>
            ) : null}
          </>
        }
      />
      {!pr.active ? <p className="mb-4 rounded-xl bg-surface-2 p-3 text-sm text-muted">Este producto está inactivo: no aparece para vendedores ni locales.</p> : null}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-4 sm:p-6">
          {line === 'tabaco' && a.lengthIn ? (
            <>
              <CigarSilhouette lengthIn={Number(a.lengthIn)} ringGauge={Number(a.ringGauge)} shade={String(a.wrapperShade ?? capaShade(a.capa))} vitola={String(a.vitola)} className="w-full" />
              <p className="mt-2 text-sm text-muted">Silueta a escala real: {attrText(config.productFields[1]!, a.lengthIn)} de largo, cepo {attrText(config.productFields[2]!, a.ringGauge)}.</p>
            </>
          ) : (
            <div className="grid h-72 place-items-center rounded-2xl bg-surface-2 p-4">
              <ProductThumb product={pr} loadPhoto={(pid) => getPhoto(ctx, pid)} size="lg" />
            </div>
          )}
          <PhotoStrip productId={pr.id} photoIds={pr.photoIds} canEdit={canEdit} />
        </Card>
        <div className="grid content-start gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Disponible en almacén" value={s.available} tone={s.lowStock ? 'warn' : 'data'} hint={s.reserved ? `${s.reserved} apartados para entregas` : `Aviso en ${pr.lowStockThreshold}`} />
            <Stat
              label={actor.role === 'store' ? 'Tienes en tu local' : actor.role === 'seller' ? 'En tus locales' : 'En consignación'}
              value={s.consignment}
              hint={actor.role === 'store' ? 'En consignación' : `En ${s.storesHolding} locales`}
            />
          </div>
          <Card className="p-4">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <Truck className="h-5 w-5 text-accent" aria-hidden /> Próxima llegada
            </p>
            {s.nextArrival ? (
              <p className="mt-1 text-ink">
                <span className="glow text-xl font-bold tabular">{s.nextArrival.qty}</span> llegan el {fmtDate(s.nextArrival.eta)},{' '}
                <span className="font-semibold">{fmtRelativeDays(s.nextArrival.eta, now)}</span>
                <span className="block text-sm text-muted">
                  {s.nextArrival.code} · {arrivalStatusLabel(line, s.nextArrival.status)}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-muted">No hay una llegada programada con este producto.</p>
            )}
            {s.lowStock ? (
              <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-warn">
                <AlertTriangle className="h-4 w-4" aria-hidden /> Stock bajo
              </p>
            ) : null}
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 font-bold">Precios</h2>
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-muted">Precio al local</dt>
              <dd className="text-right font-semibold tabular">{fmtMoney(pr.priceToStore)}</dd>
              <dt className="text-muted">PVP sugerido</dt>
              <dd className="text-right font-semibold tabular">{fmtMoney(pr.suggestedRetail)}</dd>
              <dt className="text-muted">El local gana por unidad</dt>
              <dd className="text-right font-bold tabular text-ok">{fmtMoney(storeEarning(pr))}</dd>
              {v.sellerCommissionRule ? (
                <>
                  <dt className="text-muted">{actor.role === 'seller' ? 'Tu comisión' : 'Comisión del vendedor'}</dt>
                  <dd className="text-right font-semibold tabular">
                    {fmtMoney(v.sellerCommissionPerUnit ?? 0)}/u.
                    <span className="block text-xs font-normal text-muted">{describeRule(v.sellerCommissionRule)}</span>
                  </dd>
                </>
              ) : null}
              {hasCost(pr) ? (
                <>
                  <dt className="text-muted">Costo{pr.sampleCost ? ' (de ejemplo)' : ''}</dt>
                  <dd className="text-right tabular">{fmtMoney(pr.cost)}</dd>
                  <dt className="text-muted">Margen por unidad</dt>
                  <dd className="text-right font-semibold tabular">{fmtMoney(pr.priceToStore - pr.cost - (v.sellerCommissionPerUnit ?? 0))}</dd>
                </>
              ) : null}
            </dl>
            <p className="mt-2 text-xs text-muted">
              Presentación: {packText(pr)}.
            </p>
          </Card>
        </div>
      </div>

      <Section title="Ficha">
        <Card className="p-4 sm:p-6">
          <KeyValue items={config.productFields.map((f) => [f.label, attrText(f, a[f.key])])} />
          {pr.notes ? (
            <div className="mt-5">
              <h3 className="text-sm text-muted">{config.notesLabel}</h3>
              <p className="mt-1 max-w-[70ch] text-ink">{pr.notes}</p>
            </div>
          ) : null}
          {pr.pairing ? (
            <div className="mt-4">
              <h3 className="text-sm text-muted">{config.pairingLabel}</h3>
              <p className="mt-1 max-w-[70ch] text-ink">{pr.pairing}</p>
            </div>
          ) : null}
        </Card>
      </Section>

      {isAdmin ? (
        <Section title="Lotes con existencias">
          {myLots.length === 0 ? (
            <p className="text-muted">No hay lotes con existencias.</p>
          ) : (
            <Card className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Recibido</th>
                    {line === 'cafe' ? <th>Consumir antes de</th> : null}
                    <th className="num">Costo</th>
                    <th className="num">Almacén</th>
                    <th className="num">En locales</th>
                  </tr>
                </thead>
                <tbody>
                  {myLots.map((l) => (
                    <tr key={l.lot.id}>
                      <td className="font-semibold">{l.lot.code}</td>
                      <td>{fmtDate(l.lot.receivedAt)}</td>
                      {line === 'cafe' ? (
                        <td>
                          {l.lot.bestBefore ? fmtDate(l.lot.bestBefore) : '—'}
                          {l.daysToExpiry !== undefined && l.daysToExpiry <= 30 ? (
                            <span className="ml-2">
                              <Pill tone={l.daysToExpiry < 0 ? 'danger' : 'warn'}>{l.daysToExpiry < 0 ? 'Vencido' : `${l.daysToExpiry} días`}</Pill>
                            </span>
                          ) : null}
                        </td>
                      ) : null}
                      <td className="num">{fmtMoney(l.lot.unitCost)}</td>
                      <td className="num">{l.warehouse}</td>
                      <td className="num">{l.inStores}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </Section>
      ) : null}
      {canEdit ? (
        <div className="mt-6">
          <Button variant="ghost" icon={PackagePlus} onClick={() => nav(p('almacen'))}>
            Ver llegadas y movimientos en el almacén
          </Button>
        </div>
      ) : null}
      {ordering ? <QuickOrderSheet view={v} onClose={() => setOrdering(false)} /> : null}
    </>
  );
}

function PhotoStrip({ productId, photoIds, canEdit }: { productId: string; photoIds: string[]; canEdit: boolean }) {
  const { ctx } = useLine();
  const { run } = useAction();
  if (!canEdit && photoIds.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        {photoIds.map((pid) => (
          <PhotoTile key={pid} id={pid} onRemove={canEdit ? () => void run(() => removeProductPhoto(ctx, productId, pid), 'Foto quitada.') : undefined} />
        ))}
        {canEdit ? <PhotoPicker label="Agregar foto" onPhoto={async (ph) => void (await run(() => addProductPhoto(ctx, productId, ph), 'Foto guardada (WebP, 1600 px máx.).'))} /> : null}
      </div>
      {canEdit && photoIds.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <Camera className="h-4 w-4" aria-hidden /> Mientras no haya fotos reales, la ficha usa la silueta a escala o la foto de la marca.
        </p>
      ) : null}
    </div>
  );
}

function PhotoTile({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const { ctx } = useLine();
  const url = useStoredPhoto(id, (pid) => getPhoto(ctx, pid));
  return (
    <div className="relative h-20 w-20 overflow-hidden rounded-xl border border-line bg-surface-2">
      {url ? <img src={url} alt="Foto del producto" className="h-full w-full object-cover" /> : null}
      {onRemove ? (
        <button type="button" onClick={onRemove} className="absolute top-1 right-1 grid h-8 w-8 place-items-center rounded-full bg-overlay text-ink" aria-label="Quitar foto">
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

// ---------- Formulario (administración) ----------

interface FormState {
  sku: string;
  name: string;
  brandLine: string;
  active: boolean;
  cost: number | '';
  priceToStore: number | '';
  suggestedRetail: number | '';
  ruleType: CommissionRule['type'];
  ruleValue: number | '';
  lowStockThreshold: number | '';
  packSize: number | '';
  notes: string;
  pairing: string;
  attrs: Record<string, string | number>;
}

function fromProduct(pr: Product | undefined, prefix: string, defaultRule: CommissionRule, unitName: string, defaultLow: number): FormState {
  return {
    sku: pr?.sku ?? `${prefix}-`,
    name: pr?.name ?? '',
    brandLine: pr?.brandLine ?? '',
    active: pr?.active ?? true,
    cost: pr?.cost ?? '',
    priceToStore: pr?.priceToStore ?? '',
    suggestedRetail: pr?.suggestedRetail ?? '',
    ruleType: pr?.sellerCommission.type ?? defaultRule.type,
    ruleValue: pr?.sellerCommission.value ?? defaultRule.value,
    lowStockThreshold: pr?.lowStockThreshold ?? defaultLow,
    packSize: pr?.packSize ?? (unitName === 'tabaco' ? 20 : 12),
    notes: pr?.notes ?? '',
    pairing: pr?.pairing ?? '',
    attrs: pr?.attrs ?? {},
  };
}

export function ProductFormPage() {
  const { id } = useParams();
  const { ctx, actor, p } = useLine();
  const existing = useAsync(() => (id ? getProduct(ctx, id) : Promise.resolve(undefined)), [ctx, id]);
  if (actor.role !== 'admin') {
    return (
      <EmptyState icon={BookOpen} title="Solo administración edita el catálogo" action={<LinkButton to={p('catalogo')}>Ver catálogo</LinkButton>}>
        Vendedores y locales ven el catálogo, pero no lo cambian.
      </EmptyState>
    );
  }
  if (id && existing.loading && !existing.data) return <Loading rows={4} />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const pr = existing.data?.product;
  return <ProductForm key={pr?.id ?? 'nuevo'} initial={pr && hasCost(pr) ? pr : undefined} />;
}

function ProductForm({ initial }: { initial?: Product }) {
  const { ctx, config, p, line, actor } = useLine();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const [f, setF] = useState<FormState>(() => fromProduct(initial, config.skuPrefix, config.defaultCommission, config.unitName.one, line === 'tabaco' ? 60 : 48));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const setAttr = (k: string, v: string | number) => setF((s) => ({ ...s, attrs: { ...s.attrs, [k]: v } }));
  const earning = typeof f.priceToStore === 'number' && typeof f.suggestedRetail === 'number' ? f.suggestedRetail - f.priceToStore : null;

  const submit = () =>
    void run(async () => {
      const saved = await saveProduct(ctx, {
        id: initial?.id,
        sku: f.sku,
        name: f.name,
        brandLine: f.brandLine,
        active: f.active,
        cost: f.cost === '' ? Number.NaN : f.cost,
        priceToStore: f.priceToStore === '' ? Number.NaN : f.priceToStore,
        suggestedRetail: f.suggestedRetail === '' ? Number.NaN : f.suggestedRetail,
        sellerCommission: { type: f.ruleType, value: f.ruleValue === '' ? 0 : f.ruleValue },
        lowStockThreshold: f.lowStockThreshold === '' ? 0 : f.lowStockThreshold,
        packSize: f.packSize === '' ? 1 : f.packSize,
        // Al editar se conserva la unidad del producto (un producto de mazo sigue siendo de mazo).
        unitName: initial?.unitName ?? config.unitName.one,
        notes: f.notes,
        pairing: f.pairing,
        attrs: f.attrs,
      });
      nav(p(`catalogo/${saved.id}`));
      return saved;
    }, initial ? 'Cambios guardados.' : 'Producto creado.');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <PageHeader back={{ to: initial ? p(`catalogo/${initial.id}`) : p('catalogo'), label: initial ? initial.name : 'Catálogo' }} title={initial ? 'Editar producto' : 'Nuevo producto'} subtitle="Los costos solo los ve administración." />
      {line === 'tabaco' && f.attrs.lengthIn && f.attrs.ringGauge ? (
        <Card className="mb-4 p-4">
          <CigarSilhouette lengthIn={Number(f.attrs.lengthIn)} ringGauge={Number(f.attrs.ringGauge)} shade={String(f.attrs.capa ? capaShade(f.attrs.capa) : (f.attrs.wrapperShade ?? 'colorado'))} vitola={String(f.attrs.vitola ?? '')} className="w-full" />
          <p className="mt-1 text-sm text-muted">Vista previa a escala mientras completas largo, cepo y capa.</p>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="grid content-start gap-4 p-4 sm:p-5">
          <h2 className="font-bold">Datos</h2>
          <TextInput label="Nombre" value={f.name} onChange={(e) => set('name', e.target.value)} required />
          <TextInput label="Marca o línea" value={f.brandLine} onChange={(e) => set('brandLine', e.target.value)} required />
          <TextInput label="SKU" value={f.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} required />
          {config.productFields.map((fd) =>
            fd.kind === 'select' ? (
              <SelectInput key={fd.key} label={fd.label} value={String(f.attrs[fd.key] ?? '')} onChange={(e) => setAttr(fd.key, e.target.value)} options={fd.options} placeholder="Elige una opción" />
            ) : fd.kind === 'number' ? (
              <NumberInput
                key={fd.key}
                label={fd.unit ? `${fd.label} (${fd.unit})` : fd.label}
                hint={fd.hint}
                step={fd.step}
                min={fd.min}
                value={f.attrs[fd.key] === undefined || f.attrs[fd.key] === '' ? '' : Number(f.attrs[fd.key])}
                onValue={(v) => setAttr(fd.key, v === '' ? '' : v)}
              />
            ) : (
              <TextInput key={fd.key} label={fd.label} placeholder={fd.placeholder} hint={fd.hint} value={String(f.attrs[fd.key] ?? '')} onChange={(e) => setAttr(fd.key, e.target.value)} />
            ),
          )}
        </Card>
        <div className="grid content-start gap-4">
          <Card className="grid gap-4 p-4 sm:p-5">
            <h2 className="font-bold">Precios y comisiones</h2>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Costo (USD)" step={0.01} min={0} value={f.cost} onValue={(v) => set('cost', v)} />
              <NumberInput label="Precio al local" step={0.01} min={0} value={f.priceToStore} onValue={(v) => set('priceToStore', v)} />
              <NumberInput label="PVP sugerido" step={0.01} min={0} value={f.suggestedRetail} onValue={(v) => set('suggestedRetail', v)} />
              <div className="field">
                <span className="field-label">El local gana</span>
                <p className={`glow pt-2 text-xl font-bold tabular ${earning !== null && earning < 0 ? 'text-danger' : ''}`}>{earning === null ? '—' : fmtMoney(earning)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SelectInput
                label="Comisión del vendedor"
                value={f.ruleType}
                onChange={(e) => set('ruleType', e.target.value as CommissionRule['type'])}
                options={[
                  { value: 'percent', label: '% del precio al local' },
                  { value: 'fixed', label: 'Fija por unidad (USD)' },
                ]}
              />
              <NumberInput label={f.ruleType === 'percent' ? 'Porcentaje' : 'Monto por unidad'} step={f.ruleType === 'percent' ? 0.5 : 0.05} min={0} value={f.ruleValue} onValue={(v) => set('ruleValue', v)} />
            </div>
          </Card>
          <Card className="grid gap-4 p-4 sm:p-5">
            <h2 className="font-bold">Inventario</h2>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={`Unidades por caja`} min={1} step={1} value={f.packSize} onValue={(v) => set('packSize', v)} />
              <NumberInput label="Aviso de stock bajo" min={0} step={1} value={f.lowStockThreshold} onValue={(v) => set('lowStockThreshold', v)} hint="Unidades disponibles" />
            </div>
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
          {initial ? 'Guardar cambios' : 'Crear producto'}
        </Button>
      </div>
    </form>
  );
}
