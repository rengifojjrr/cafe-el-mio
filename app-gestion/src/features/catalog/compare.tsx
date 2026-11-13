// Comparador de tamaños: de 2 a 4 vitolas de pie, una al lado de la otra y a la misma escala
// (largo × cepo), con sus medidas. Se abre desde el catálogo («Comparar tamaños») o desde la
// ficha («Comparar con…»). En el teléfono, si no entran, se deslizan de lado.
import { Ruler, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { type HeadShape, colitaSvg, colitaTramos, headShape, headTaper } from '../../domain/cabeza';
import { applyFilters, groupFamilies } from '../../domain/catalog-filters';
import { capaShade, sizeText } from '../../domain/products';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { listProducts, type ProductView } from '../../services/catalog';
import { ColitaTrazo } from '../../ui/brand';
import { EmptyState, ErrorBox, Loading, PageHeader } from '../../ui/kit';
import { CapaDot } from './list';

const MAX = 4;

/**
 * Un tabaco de pie: el pie abajo, la cabeza arriba. `pxPerIn` es la misma escala para todos. La
 * colita (si la tiene) sale de la cabeza hacia arriba y se enrosca hacia un lado: el dibujo gana
 * un poco de alto y de ancho, pero el tabaco no (la colita no cuenta en el largo).
 */
function StandingCigar({ lengthIn, ringGauge, shade, vitola, head, pxPerIn }: { lengthIn: number; ringGauge: number; shade: string; vitola: string; head: HeadShape; pxPerIn: number }) {
  const L = lengthIn * pxPerIn;
  const D = (ringGauge / 64) * pxPerIn;
  const r = D / 2;
  const grosor = Math.max(3.4, D * 0.13);
  const tramos = head === 'colita' ? colitaTramos(r / pxPerIn) : [];
  const puntos = tramos.flat();
  // De pie: lo que en la silueta acostada va hacia afuera (x) aquí va hacia arriba; lo que va hacia arriba (y), hacia un lado.
  const sobra = puntos.length ? Math.max(...puntos.map(([x]) => x)) * pxPerIn + grosor : 0;
  const lado = puntos.length ? Math.max(0, Math.max(...puntos.map(([, y]) => y)) * pxPerIn + grosor - r) : 0;
  const w = D + 8 + lado * 2;
  const h = L + 4 + sobra;
  const x0 = 4 + lado;
  const x1 = x0 + D;
  const cx = x0 + D / 2;
  const bottom = h;
  const top = bottom - L;
  const taper = headTaper(head, vitola) * pxPerIn;
  const colita = head === 'colita' ? colitaSvg(r / pxPerIn, (x, y) => [cx + y * pxPerIn, top - x * pxPerIn]) : '';
  const body = taper
    ? `M${x0} ${bottom} V${top + taper} C${x0} ${top + taper * 0.35}, ${cx - r * 0.32} ${top}, ${cx} ${top} C${cx + r * 0.32} ${top}, ${x1} ${top + taper * 0.35}, ${x1} ${top + taper} V${bottom} Z`
    : `M${x0} ${bottom} V${top + r} A${r} ${r} 0 0 1 ${x1} ${top + r} V${bottom} Z`;
  const bandY = top + (taper ? taper + 0.55 * pxPerIn : 1.15 * pxPerIn);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden data-cabeza={head} className="sombra-suave block">
      <path d={body} style={{ fill: `var(--capa-${shade}, var(--capa-colorado))` }} />
      <path d={body} style={{ fill: 'var(--capa-brillo)' }} transform={`translate(${D * 0.12} 0) scale(0.45 1)`} opacity="0.5" />
      <rect x={x0 - 1} y={bandY} width={D + 2} height={0.48 * pxPerIn} style={{ fill: 'var(--anilla)' }} />
      <rect x={x0 - 1} y={bandY + 0.17 * pxPerIn} width={D + 2} height={0.14 * pxPerIn} style={{ fill: 'var(--anilla-tinta)' }} opacity="0.55" />
      {colita ? <ColitaTrazo d={colita} shade={shade} grosor={grosor} /> : null}
    </svg>
  );
}

export function ComparePage() {
  const { ctx, p } = useLine();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const { data, error, loading } = useAsync(() => listProducts(ctx), [ctx]);
  const cigars = useMemo(() => (data ?? []).filter((v) => Number(v.product.attrs.lengthIn) > 0 && Number(v.product.attrs.ringGauge) > 0), [data]);
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, MAX);
  const chosen = ids.map((id) => cigars.find((v) => v.product.id === id)).filter((v): v is ProductView => Boolean(v));
  const setIds = (next: string[]) => setParams(next.length ? { ids: next.join(',') } : {}, { replace: true });
  const toggle = (id: string) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX ? ids : [...ids, id]);
  const families = useMemo(() => groupFamilies(applyFilters(cigars, {}, q)), [cigars, q]);
  const maxLen = Math.max(5, ...chosen.map((v) => Number(v.product.attrs.lengthIn)));
  // La misma escala para todos: el más largo ocupa unos 300 px de alto.
  const pxPerIn = Math.min(46, 300 / maxLen);

  return (
    <>
      <PageHeader back={{ to: p('catalogo'), label: 'Catálogo' }} title="Comparar tamaños" subtitle="Elige de 2 a 4 vitolas: se ven de pie, a la misma escala, con su largo y su cepo." />
      {loading && !data ? <Loading rows={3} /> : null}
      {error ? <ErrorBox error={error} /> : null}

      <section className="hero-producto mb-4 p-4 sm:p-6" aria-label="Tabacos lado a lado">
        {chosen.length === 0 ? (
          <EmptyState icon={Ruler} title="Elige las vitolas abajo">
            Toca los tabacos que quieras comparar. Hasta {MAX}.
          </EmptyState>
        ) : (
          <div className="scroll-x flex snap-x items-end gap-5 pb-2 sm:justify-center">
            <div className="flex flex-none flex-col justify-end self-stretch pr-1 text-xs text-hero-tenue" aria-hidden>
              <div className="relative border-r border-hero-linea" style={{ height: maxLen * pxPerIn + 4 }}>
                {Array.from({ length: Math.floor(maxLen) + 1 }, (_, i) => (
                  <span key={i} className="absolute right-1 -translate-y-1/2" style={{ bottom: i * pxPerIn }}>
                    {i}″
                  </span>
                ))}
              </div>
              <div className="h-[4.5rem]" />
            </div>
            {chosen.map((v) => {
              const a = v.product.attrs;
              const len = Number(a.lengthIn);
              const ring = Number(a.ringGauge);
              return (
                <figure key={v.product.id} className="m-0 flex w-24 flex-none snap-start flex-col items-center gap-2">
                  <StandingCigar lengthIn={len} ringGauge={ring} shade={String(a.wrapperShade ?? capaShade(a.capa))} vitola={String(a.vitola ?? '')} head={headShape(v.product)} pxPerIn={pxPerIn} />
                  <figcaption className="h-[4.5rem] text-center text-xs leading-tight">
                    <span className="block font-bold text-hero-tinta">{v.product.familyName ?? v.product.name}</span>
                    {v.product.variantLabel ? <span className="block text-hero-tenue">{v.product.variantLabel}</span> : null}
                    <span className="block text-hero-tinta tabular">{sizeText(a)}</span>
                    <span className="block text-hero-tenue tabular">
                      {Math.round(len * 25.4)} × {((ring / 64) * 25.4).toFixed(1)} mm
                    </span>
                  </figcaption>
                  <button type="button" className="btn btn-ghost min-h-10 px-2 text-xs text-hero-tinta" onClick={() => toggle(v.product.id)} aria-label={`Quitar ${v.product.name}`}>
                    <X aria-hidden /> Quitar
                  </button>
                </figure>
              );
            })}
          </div>
        )}
      </section>

      <div className="mb-3 flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Buscar vitolas</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
          <input className="input pl-10" type="search" placeholder="Buscar: toro, 6x52, churchill…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <span className="flex-none text-sm text-muted tabular">
          {ids.length} de {MAX}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {families.map((fam) => (
          <li key={fam.key} className="glass min-w-0 p-3">
            <p className="font-semibold">{fam.name}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {fam.variants.map((v) => {
                const on = ids.includes(v.product.id);
                return (
                  <button key={v.product.id} type="button" className="chip" aria-pressed={on} disabled={!on && ids.length >= MAX} onClick={() => toggle(v.product.id)}>
                    <CapaDot capa={v.product.attrs.capa} />
                    {v.product.variantLabel || sizeText(v.product.attrs) || v.product.name}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
