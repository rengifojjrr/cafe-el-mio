// Catálogo: una tarjeta por familia (por ejemplo «Toro 6 × 52») con sus capas como chips,
// filtros de un toque que se recuerdan por persona, y la capa, la fortaleza y la procedencia
// a la vista sin entrar a la ficha.
import { AlertTriangle, BookOpen, Eye, EyeOff, FileSpreadsheet, Images, Plus, Ruler, Search, ShoppingBag, SlidersHorizontal, Truck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  type CatalogFilters,
  type Facet,
  type Family,
  activeFilterCount,
  applyFilters,
  buildFacets,
  groupFamilies,
  sanitizeFilters,
  toggleFilter,
} from '../../domain/catalog-filters';
import { capaLabel, capaShade, sizeText, stockText, unitOf } from '../../domain/products';
import { KIND_LABEL } from '../../lines/config';
import { fmtMoney } from '../../lib/money';
import { fmtDate, fmtRelativeDays } from '../../lib/time';
import { useAsync, usePersistentState } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { getPhoto, listProducts, type ProductView } from '../../services/catalog';
import { Button, EmptyState, ErrorBox, LinkButton, Loading, PageHeader, Pill, Sheet } from '../../ui/kit';
import { ProductThumb } from '../../ui/media';
import { QuickOrderSheet } from '../consignment/components';

export function CatalogPage() {
  const { ctx, actor, config, p, line } = useLine();
  const isAdmin = actor.role === 'admin';
  const [q, setQ] = usePersistentState(`catalogo-q:${line}`, '');
  const [rawFilters, setFilters] = usePersistentState<CatalogFilters>(`catalogo-filtros:${actor.accountId}:${line}`, {}, 'local');
  const filters = useMemo(() => sanitizeFilters(rawFilters), [rawFilters]);
  const [showInactive, setShowInactive] = usePersistentState(`catalogo-inactivos:${line}`, false);
  const [ordering, setOrdering] = useState<ProductView | null>(null);
  const [choosing, setChoosing] = useState<Family<ProductView> | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const { data, error, loading } = useAsync(() => listProducts(ctx, { includeInactive: isAdmin && showInactive }), [ctx, showInactive, isAdmin]);
  const now = ctx.now();

  const filterKeys = config.filterFields;
  const filtered = useMemo(() => applyFilters(data ?? [], filters, q), [data, filters, q]);
  // Los campos de lista (tueste, por ejemplo) se muestran con su nombre, no con el valor guardado.
  const facets = useMemo(() => {
    const labels = new Map(config.productFields.flatMap((f) => (f.kind === 'select' ? f.options.map((o) => [`${f.key}:${o.value}`, o.label] as const) : [])));
    return buildFacets(data ?? [], filterKeys, filters, q).map((f) => ({
      ...f,
      options: f.options.map((o) => ({ ...o, label: f.key === 'capa' || f.key === 'strength' ? o.label : (labels.get(`${f.key}:${o.value}`) ?? o.label) })),
    }));
  }, [data, filterKeys, filters, q, config.productFields]);
  const families = useMemo(() => groupFamilies(filtered), [filtered]);
  const active = activeFilterCount(filters);

  const subtitle =
    actor.role === 'store'
      ? 'Lo que puedes pedir, lo que ganas y cuándo llega más.'
      : actor.role === 'seller'
        ? 'Precios, tu comisión y la próxima llegada al almacén.'
        : `${data?.length ?? 0} productos de ${config.name} en ${groupFamilies(data ?? []).length} familias.`;

  const order = (fam: Family<ProductView>) => {
    if (fam.variants.length === 1) setOrdering(fam.variants[0]!);
    else setChoosing(fam);
  };

  return (
    <>
      <PageHeader
        title="Catálogo"
        subtitle={subtitle}
        actions={
          <>
            {line === 'tabaco' ? (
              <LinkButton to={p('catalogo/comparar')} icon={Ruler}>
                Comparar
              </LinkButton>
            ) : null}
            {isAdmin && !actor.readOnly ? (
              <>
                <LinkButton to={p('catalogo/nuevo')} variant="primary" icon={Plus}>
                  Nuevo producto
                </LinkButton>
                <LinkButton to={p('catalogo/importar')} icon={FileSpreadsheet}>
                  Importar
                </LinkButton>
                <LinkButton to={p('catalogo/fotos')} icon={Images}>
                  Fotos en lote
                </LinkButton>
              </>
            ) : null}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">Buscar en el catálogo</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            className="input pl-10"
            type="search"
            placeholder={line === 'tabaco' ? 'Buscar: toro, maduro, 6x52, código…' : 'Buscar por nombre, tueste, molido…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <Button variant={showFilters ? 'primary' : 'secondary'} icon={SlidersHorizontal} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
          Más filtros
        </Button>
      </div>

      <QuickChips facets={facets} filters={filters} onToggle={(key, value) => setFilters(toggleFilter(filters, key, value))} onClear={() => setFilters({})} />

      <FilterBar
        facets={facets.filter((f) => !QUICK_KEYS.includes(f.key))}
        filters={filters}
        open={showFilters}
        onToggle={(key, value) => setFilters(toggleFilter(filters, key, value))}
        extra={
          isAdmin ? (
            <>
              <button type="button" className="chip" aria-pressed={Boolean(filters.low?.length)} onClick={() => setFilters(toggleFilter(filters, 'low', 'si'))}>
                <AlertTriangle className="h-4 w-4" aria-hidden /> Stock bajo
              </button>
              <button type="button" className="chip" aria-pressed={showInactive} onClick={() => setShowInactive(!showInactive)}>
                {showInactive ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />} {showInactive ? 'Ocultar inactivos' : 'Ver inactivos'}
              </button>
            </>
          ) : null
        }
      />

      {data ? (
        <p className="mb-3 text-sm text-muted" aria-live="polite" data-testid="resultados">
          {filtered.length === 1 ? '1 producto' : `${filtered.length} productos`}
          {families.length !== filtered.length ? ` en ${families.length === 1 ? '1 familia' : `${families.length} familias`}` : ''}
          {active || q.trim() ? ' con estos filtros' : ''}
        </p>
      ) : null}
      {loading && !data ? <Loading rows={4} /> : null}
      {error ? <ErrorBox error={error} /> : null}
      {data && families.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={data.length ? 'Nada coincide' : 'Aún no hay productos'}
          action={
            active || q ? (
              <Button
                onClick={() => {
                  setFilters({});
                  setQ('');
                }}
              >
                Quitar filtros y búsqueda
              </Button>
            ) : null
          }
        >
          {data.length ? 'Prueba con otra palabra o quita algún filtro.' : isAdmin ? 'Toca «Nuevo producto» para armar el catálogo.' : 'Administración todavía no cargó productos.'}
        </EmptyState>
      ) : null}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {families.map((fam) => (
          <li key={fam.key} className="min-w-0">
            <FamilyCard family={fam} now={now} onOrder={() => order(fam)} />
          </li>
        ))}
      </ul>
      <QuickOrderSheet view={ordering} onClose={() => setOrdering(null)} />
      <Sheet open={Boolean(choosing)} onClose={() => setChoosing(null)} title={choosing ? `¿Cuál ${choosing.name}?` : ''}>
        <ul className="grid gap-2">
          {(choosing?.variants ?? []).map((v) => (
            <li key={v.product.id}>
              <button
                type="button"
                className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line px-4 py-2 text-left hover:bg-surface-2"
                onClick={() => {
                  setChoosing(null);
                  setOrdering(v);
                }}
              >
                <CapaDot capa={v.product.attrs.capa} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{v.product.variantLabel || v.product.name}</span>
                  <span className="block text-sm text-muted">{v.stock.available > 0 ? `Hay ${stockText(v.product, v.stock.available)}` : 'Sin stock ahora'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

/** Los filtros de un toque que más se usan, en una sola fila: tipo, capa, fortaleza y existencias. */
const QUICK_KEYS = ['kind', 'capa', 'strength', 'roast', 'grind', 'stock'];

function QuickChips({ facets, filters, onToggle, onClear }: { facets: Facet[]; filters: CatalogFilters; onToggle: (key: string, value: string) => void; onClear: () => void }) {
  const quick = facets.filter((f) => QUICK_KEYS.includes(f.key)).sort((a, b) => QUICK_KEYS.indexOf(a.key) - QUICK_KEYS.indexOf(b.key));
  const active = activeFilterCount(filters);
  if (quick.length === 0) return null;
  return (
    <div className="scroll-x mb-3 flex gap-2 py-0.5" role="group" aria-label="Filtros rápidos">
      {active ? (
        <button type="button" className="chip flex-none" onClick={onClear}>
          <X className="h-4 w-4" aria-hidden /> Quitar ({active})
        </button>
      ) : null}
      {quick.flatMap((f, gi) => [
        gi > 0 ? <span key={`sep-${f.key}`} className="my-2 w-px flex-none bg-line" aria-hidden /> : null,
        ...f.options.map((o) => {
          const on = Boolean(filters[f.key]?.includes(o.value));
          return (
            <button
              key={`${f.key}-${o.value}`}
              type="button"
              className="chip flex-none"
              aria-pressed={on}
              aria-label={`${f.title}: ${o.label} (${o.count})`}
              disabled={!on && o.count === 0}
              onClick={() => onToggle(f.key, o.value)}
            >
              {f.key === 'capa' ? <CapaDot capa={o.value} /> : null}
              {o.label}
              <span className="chip-count tabular">{o.count}</span>
            </button>
          );
        }),
      ])}
    </div>
  );
}

/** El resto de los filtros (vitola, procedencia, marca…), en un panel que se abre con «Más filtros». */
function FilterBar({
  facets,
  filters,
  open,
  onToggle,
  extra,
}: {
  facets: Facet[];
  filters: CatalogFilters;
  open: boolean;
  onToggle: (key: string, value: string) => void;
  extra?: React.ReactNode;
}) {
  if (!open || (facets.length === 0 && !extra)) return null;
  return (
    <div className="glass mb-3 grid gap-2 p-3" role="group" aria-label="Más filtros del catálogo">
      {facets.map((f) => (
        <div key={f.key} className="flex min-w-0 items-center gap-2">
          <span className="w-24 flex-none text-sm font-semibold text-muted">{f.title}</span>
          <div className="scroll-x flex min-w-0 flex-1 gap-2 py-0.5">
            {f.options.map((o) => {
              const on = Boolean(filters[f.key]?.includes(o.value));
              return (
                <button
                  key={o.value}
                  type="button"
                  className="chip flex-none"
                  aria-pressed={on}
                  disabled={!on && o.count === 0}
                  onClick={() => onToggle(f.key, o.value)}
                >
                  {f.key === 'capa' ? <CapaDot capa={o.value} /> : null}
                  {o.label}
                  <span className="chip-count tabular">{o.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {extra ? <div className="flex flex-wrap items-center gap-2">{extra}</div> : null}
    </div>
  );
}

export function CapaDot({ capa }: { capa: unknown }) {
  if (!capa) return null;
  return <span className="inline-block h-3 w-3 flex-none rounded-full border border-line-strong" style={{ background: `var(--capa-${capaShade(capa)})` }} aria-hidden />;
}

/** Fortaleza en tres rayas (suave, media, fuerte). */
export function StrengthMeter({ value }: { value: unknown }) {
  const level = value === 'fuerte' ? 3 : value === 'media' ? 2 : value === 'suave' ? 1 : 0;
  if (!level) return null;
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-3 w-1.5 rounded-sm ${i <= level ? 'bg-accent' : 'bg-surface-3'}`} />
      ))}
    </span>
  );
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function priceRange(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? fmtMoney(min) : `${fmtMoney(min)} a ${fmtMoney(max)}`;
}

function FamilyCard({ family, now, onOrder }: { family: Family<ProductView>; now: Date; onOrder: () => void }) {
  const { ctx, actor, p, line } = useLine();
  const first = family.variants[0]!;
  const pr = first.product;
  const unit = unitOf(pr);
  const available = family.variants.reduce((a, v) => a + Math.max(0, v.stock.available), 0);
  const low = family.variants.some((v) => v.stock.lowStock);
  const inactive = family.variants.every((v) => !v.product.active);
  const strengths = uniq(family.variants.map((v) => String(v.product.attrs.strength ?? '')));
  const origins = uniq(family.variants.map((v) => String(v.product.attrs.originCountry ?? v.product.attrs.origin ?? '')));
  const sizes = uniq(family.variants.map((v) => sizeText(v.product.attrs)));
  const sameUnit = family.variants.every((v) => v.product.unitName === pr.unitName);
  const nextArrival = family.variants.map((v) => v.stock.nextArrival).find(Boolean);
  const showCapas = line === 'tabaco' && family.variants.some((v) => v.product.attrs.capa);
  const facts = [pr.attrs.vitola && !family.name.toLowerCase().includes(String(pr.attrs.vitola).toLowerCase()) ? String(pr.attrs.vitola) : '', sizes.length === 1 && !family.name.includes('×') ? sizes[0] : '', origins.join(' / ')].filter(Boolean);

  return (
    <div className="glass relative flex h-full min-w-0 flex-col overflow-hidden transition-colors hover:border-line-strong">
      <Link to={p(`catalogo/${pr.id}`)} className="absolute inset-0 z-0 rounded-[20px]" aria-label={`Ver ${family.name}`} />
      <div className={line === 'tabaco' ? 'pointer-events-none h-16 min-w-0 overflow-hidden px-3 pt-3' : 'pointer-events-none h-40 min-w-0 bg-surface-2 p-3'}>
        <ProductThumb product={pr} loadPhoto={(id) => getPhoto(ctx, id)} />
      </div>
      <div className="pointer-events-none flex flex-1 flex-col gap-2 p-4 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-xl leading-tight text-ink">{family.name}</h2>
            {facts.length ? <p className="truncate text-sm text-muted">{facts.join(' · ')}</p> : null}
          </div>
          <div className="flex flex-none flex-col items-end gap-1">
            {pr.kind ? <Pill tone={pr.kind === 'premium' ? 'accent' : undefined}>{KIND_LABEL[pr.kind]}</Pill> : null}
            {inactive ? <Pill>Inactivo</Pill> : low && actor.role === 'admin' ? <Pill tone="warn">Stock bajo</Pill> : null}
          </div>
        </div>

        {showCapas ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Capas">
            {family.variants.map((v) => (
              <Link
                key={v.product.id}
                to={p(`catalogo/${v.product.id}`)}
                className={`chip pointer-events-auto relative z-10 ${v.stock.available > 0 ? '' : 'opacity-60'}`}
                aria-label={`${capaLabel(v.product.attrs.capa)}${sizes.length > 1 ? ` ${sizeText(v.product.attrs)}` : ''}${v.stock.available > 0 ? '' : ', sin stock'}`}
              >
                <CapaDot capa={v.product.attrs.capa} />
                {capaLabel(v.product.attrs.capa)}
                {sizes.length > 1 ? <span className="text-faint">{sizeText(v.product.attrs)}</span> : null}
              </Link>
            ))}
          </div>
        ) : family.variants.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {family.variants.map((v) => (
              <Link key={v.product.id} to={p(`catalogo/${v.product.id}`)} className="chip pointer-events-auto relative z-10">
                {v.product.variantLabel || v.product.name}
              </Link>
            ))}
          </div>
        ) : null}

        {strengths.length ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <StrengthMeter value={strengths.length === 1 ? strengths[0] : 'media'} />
            Fortaleza {strengths.map((s) => s).join(' a ')}
          </p>
        ) : null}

        <div className="mt-auto grid gap-1 pt-1 text-sm">
          {actor.role === 'store' ? (
            <p className="flex justify-between gap-2">
              <span className="font-semibold text-ink">Ganas por {unit.one}</span>
              <span className="glow font-bold tabular">{priceRange(family.variants.map((v) => v.storeEarning))}</span>
            </p>
          ) : (
            <p className="flex justify-between gap-2">
              <span className="text-muted">Al local, por {sameUnit ? unit.one : 'unidad'}</span>
              <span className="font-semibold tabular">{priceRange(family.variants.map((v) => v.product.priceToStore))}</span>
            </p>
          )}
          {actor.role === 'seller' && first.sellerCommissionPerUnit !== undefined ? (
            <p className="flex justify-between gap-2">
              <span className="text-muted">Tu comisión por {unit.one}</span>
              <span className="glow font-bold tabular">{priceRange(family.variants.map((v) => v.sellerCommissionPerUnit ?? 0))}</span>
            </p>
          ) : null}
        </div>
        <div className="border-t border-line pt-2 text-sm">
          {available > 0 ? (
            <p className="flex justify-between gap-2">
              <span className="text-muted">En el almacén</span>
              <span className="font-bold tabular text-ink">{sameUnit ? stockText(pr, available) : available}</span>
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-warn">
              <Truck className="h-4 w-4 flex-none" aria-hidden />
              <span className="truncate">
                {nextArrival ? `Sin stock · llegan ${nextArrival.qty} el ${fmtDate(nextArrival.eta)} (${fmtRelativeDays(nextArrival.eta, now)})` : 'Sin stock ahora'}
              </span>
            </p>
          )}
        </div>
        {actor.role === 'store' && !actor.readOnly ? (
          <Button variant="primary" icon={ShoppingBag} className="pointer-events-auto relative z-10 mt-1 w-full" onClick={onOrder}>
            Pedir
          </Button>
        ) : null}
      </div>
    </div>
  );
}
