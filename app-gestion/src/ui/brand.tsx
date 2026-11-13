// Identidad visual de cada línea: la silueta del tabaco a escala (largo × cepo, con el color
// de su capa y su anilla) y las marcas de Tabaco y de Café El Mío.
import { useId } from 'react';
import type { LineId } from '../data/types';
import { type HeadShape, colitaSvg, headShape, headTaper } from '../domain/cabeza';
import { marca } from '../lib/assets';

const PX_PER_IN = 40;

/** Pulgadas con fracción (6.125 → 6⅛″) y milímetros. */
export function fmtLength(inches: number): string {
  const whole = Math.floor(inches);
  const frac = Math.round((inches - whole) * 8);
  const glyph = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'][frac] ?? '';
  return `${whole}${glyph}″ (${Math.round(inches * 25.4)} mm)`;
}

export function fmtRing(ring: number): string {
  return `${ring} (${((ring / 64) * 25.4).toFixed(1)} mm)`;
}

/**
 * La colita (el rabito de hoja torcida de la cabeza): un trazo de la misma capa, un poco más oscuro,
 * con una raya fina que lo hace ver torcido. `d` es el camino que da `colitaSvg`.
 */
export function ColitaTrazo({ d, shade, grosor }: { d: string; shade: string; grosor: number }) {
  return (
    <g data-parte="colita" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} style={{ stroke: `var(--capa-${shade}, var(--capa-colorado))` }} strokeWidth={grosor} />
      <path d={d} style={{ stroke: 'var(--capa-veta)' }} strokeWidth={grosor} />
      <path d={d} style={{ stroke: 'var(--capa-veta)' }} strokeWidth={grosor * 0.38} strokeDasharray={`${grosor * 0.55} ${grosor * 0.75}`} />
    </g>
  );
}

export function CigarSilhouette({
  lengthIn,
  ringGauge,
  shade,
  vitola = '',
  head,
  ruler = true,
  maxIn = 8,
  className = '',
  title,
}: {
  lengthIn: number;
  ringGauge: number;
  shade: string;
  vitola?: string;
  /** Forma de la cabeza (`headShape` del producto). Si no se dice, la regla con la vitola sola. */
  head?: HeadShape;
  ruler?: boolean;
  maxIn?: number;
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const L = Math.max(3, Math.min(lengthIn, maxIn)) * PX_PER_IN;
  const D = Math.max(20, Math.min(ringGauge, 70)) / 64 * PX_PER_IN;
  const pad = 14;
  const width = maxIn * PX_PER_IN + pad * 2;
  const top = 18;
  const height = top + D + (ruler ? 34 : 14);
  const cy = top + D / 2;
  const x0 = pad;
  const x1 = pad + L;
  const r = D / 2;
  const cabeza = head ?? headShape({ attrs: { vitola } });
  const taper = headTaper(cabeza, vitola) * PX_PER_IN;
  // La colita sale del centro de la cabeza y se enrosca hacia arriba (no cuenta en el largo).
  const colita = cabeza === 'colita' ? colitaSvg(r / PX_PER_IN, (x, y) => [x1 + x * PX_PER_IN, cy - y * PX_PER_IN]) : '';
  // Cuerpo: pie plano a la izquierda, cabeza redonda (o en punta) a la derecha.
  const body = taper
    ? `M${x0} ${top} H${x1 - taper} C${x1 - taper * 0.35} ${top}, ${x1} ${cy - r * 0.32}, ${x1} ${cy} C${x1} ${cy + r * 0.32}, ${x1 - taper * 0.35} ${top + D}, ${x1 - taper} ${top + D} H${x0} Z`
    : `M${x0} ${top} H${x1 - r} A${r} ${r} 0 0 1 ${x1 - r} ${top + D} H${x0} Z`;
  const bandX = x1 - (taper ? taper + 0.55 * PX_PER_IN : 1.15 * PX_PER_IN);
  const bandW = 0.48 * PX_PER_IN;
  const veins = Array.from({ length: Math.floor(L / 34) }, (_, i) => x0 + 18 + i * 34);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`${title ?? `Silueta a escala: ${fmtLength(lengthIn)} de largo, cepo ${ringGauge}`}${cabeza === 'colita' ? ', con colita' : ''}`}
      data-cabeza={cabeza}
      preserveAspectRatio="xMinYMid meet"
    >
      <defs>
        <linearGradient id={`cuerpo-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--capa-brillo)' }} />
          <stop offset="0.35" style={{ stopColor: 'var(--capa-brillo)', stopOpacity: 0 }} />
          <stop offset="1" style={{ stopColor: 'var(--capa-veta)' }} />
        </linearGradient>
        <linearGradient id={`anilla-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--anilla)' }} />
          <stop offset="0.5" style={{ stopColor: 'var(--anilla-hondo)' }} />
          <stop offset="1" style={{ stopColor: 'var(--anilla)' }} />
        </linearGradient>
        <clipPath id={`clip-${uid}`}>
          <path d={body} />
        </clipPath>
      </defs>
      <path d={body} style={{ fill: `var(--capa-${shade}, var(--capa-colorado))` }} />
      <g clipPath={`url(#clip-${uid})`}>
        {veins.map((vx) => (
          <path key={vx} d={`M${vx} ${top} q8 ${D * 0.5} 2 ${D}`} style={{ stroke: 'var(--capa-veta)' }} strokeWidth="1" fill="none" />
        ))}
        <rect x={x0} y={top} width={L} height={D} fill={`url(#cuerpo-${uid})`} />
        <rect x={bandX} y={top - 1} width={bandW} height={D + 2} fill={`url(#anilla-${uid})`} />
        <rect x={bandX + bandW * 0.36} y={top - 1} width={bandW * 0.28} height={D + 2} style={{ fill: 'var(--anilla-tinta)' }} opacity="0.55" />
      </g>
      <ellipse cx={x0} cy={cy} rx={3} ry={r} style={{ fill: 'var(--capa-veta)' }} />
      {colita ? <ColitaTrazo d={colita} shade={shade} grosor={Math.max(3.4, D * 0.13)} /> : null}
      {ruler ? (
        <g style={{ color: 'var(--faint)' }}>
          <line x1={pad} x2={pad + maxIn * PX_PER_IN} y1={top + D + 12} y2={top + D + 12} stroke="currentColor" strokeWidth="1" />
          {Array.from({ length: maxIn + 1 }, (_, i) => (
            <g key={i}>
              <line x1={pad + i * PX_PER_IN} x2={pad + i * PX_PER_IN} y1={top + D + 7} y2={top + D + 17} stroke="currentColor" strokeWidth="1" />
              <text x={pad + i * PX_PER_IN} y={top + D + 30} fontSize="10" textAnchor="middle" fill="currentColor" fontFamily="Figtree, sans-serif">
                {i}″
              </text>
            </g>
          ))}
        </g>
      ) : null}
    </svg>
  );
}

/** Marca de cada línea para la cabecera y la portada. */
export function LineMark({ line, size = 'md' }: { line: LineId | 'eco'; size?: 'sm' | 'md' | 'lg' }) {
  const text = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-lg' : 'text-2xl';
  if (line === 'cafe') {
    const h = size === 'lg' ? 34 : size === 'sm' ? 20 : 26;
    return (
      <span className="logo-el-mio inline-flex items-center">
        <img src={marca('logo-el-mio.png')} alt="Café El Mío" style={{ height: h, width: 'auto' }} width={Math.round((501 / 96) * h)} height={h} />
      </span>
    );
  }
  if (line === 'tabaco') {
    return (
      <span className="inline-flex items-center gap-2.5">
        <svg viewBox="0 0 40 12" className={size === 'lg' ? 'h-4 w-14' : 'h-3 w-10'} aria-hidden>
          <path d="M1 1 H33 A5 5 0 0 1 33 11 H1 Z" style={{ fill: 'var(--tabaco-tabaco)' }} />
          <rect x="24" y="0.5" width="4" height="11" style={{ fill: 'var(--tabaco-oro)' }} />
        </svg>
        <span className={`font-display ${text} font-semibold text-ink`}>Tabaco</span>
      </span>
    );
  }
  return <span className={`font-display ${text} font-semibold text-ink`}>Grupo Miami</span>;
}
