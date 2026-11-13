// La cabeza del tabaco en los dibujos (la silueta 2D, el 3D y comparar): redonda, en punta o con
// colita (el rabito de hoja torcida de algunos tabacos, «pigtail cap»). Una sola regla para todos.
import type { Product } from '../data/types';
import { normalize } from './products';

export type HeadShape = 'redonda' | 'punta' | 'colita';

/**
 * Opciones del campo «Cabeza» del formulario. Vacío es «Automática»: la regla de `headShape`. Se
 * guarda en los atributos del producto (`attrs.cabeza`), como los demás campos del tabaco.
 */
export const CABEZAS: readonly { value: '' | HeadShape; label: string }[] = [
  { value: '', label: 'Automática' },
  { value: 'redonda', label: 'Redonda' },
  { value: 'colita', label: 'Con colita' },
  { value: 'punta', label: 'En punta' },
];

/** Largo de la punta, en pulgadas: torpedo, pirámide, figurado y salomón; el belicoso, más corta. 0 si no tiene. */
export function pointLength(vitola: unknown): number {
  const v = normalize(String(vitola ?? ''));
  if (/(torpedo|piramide|pyramid|figurado|salomon)/.test(v)) return 0.95;
  if (/belicoso/.test(v)) return 0.6;
  return 0;
}

const COLITA = /(behike|colita|rabito|pigtail)/;

export interface HeadInput {
  name?: string;
  familyName?: string;
  attrs?: Product['attrs'];
}

/**
 * La forma de la cabeza. Si el campo «Cabeza» dice cuál, esa. Si no (automática): con colita si la
 * familia, el nombre o la vitola dicen «behike», «colita», «rabito» o «pigtail» (sin importar
 * mayúsculas ni tildes); en punta si la vitola es de punta; redonda en lo demás.
 */
export function headShape(p: HeadInput): HeadShape {
  const attrs = p.attrs ?? {};
  const forced = String(attrs.cabeza ?? '');
  if (forced === 'redonda' || forced === 'punta' || forced === 'colita') return forced;
  const text = normalize([p.familyName, p.name, attrs.vitola].filter(Boolean).map(String).join(' '));
  if (COLITA.test(text)) return 'colita';
  if (pointLength(attrs.vitola) > 0) return 'punta';
  return 'redonda';
}

/** Largo de la punta que se dibuja: la de la vitola; si se forzó «En punta» en otra vitola, la de un torpedo. */
export function headTaper(head: HeadShape, vitola: unknown): number {
  if (head !== 'punta') return 0;
  return pointLength(vitola) || 0.95;
}

/** Un tramo de curva (Bézier cúbica): inicio, dos controles y fin. Puntos [x, y] en pulgadas. */
export type Tramo = readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];

/**
 * La colita, en pulgadas, con la punta de la cabeza en (0, 0): sale hacia +x (fuera del tabaco),
 * se dobla hacia +y (arriba), sube un poco más que el borde del tabaco y se enrosca hacia la
 * cabeza. `radio` es el radio del tabaco (cepo / 64 / 2). No cuenta en el largo.
 */
export function colitaTramos(radio: number): Tramo[] {
  const h = radio + 0.28;
  return [
    [[-0.04, 0], [0.12, -0.01], [0.23, 0.12 * h], [0.21, 0.32 * h]],
    [[0.21, 0.32 * h], [0.19, 0.52 * h], [0.21, 0.82 * h], [0.12, 0.88 * h]],
    [[0.12, 0.88 * h], [0.06, 0.95 * h], [-0.06, 0.95 * h], [-0.07, 0.82 * h]],
    [[-0.07, 0.82 * h], [-0.09, 0.71 * h], [-0.05, 0.63 * h], [-0.01, 0.62 * h]],
  ];
}

/** Un punto de la colita: `s` de 0 (la cabeza) a 1 (la punta de la colita). */
export function colitaPunto(tramos: readonly Tramo[], s: number): [number, number] {
  const k = Math.min(tramos.length - 1, Math.floor(Math.max(0, s) * tramos.length));
  const t = Math.max(0, Math.min(1, s * tramos.length - k));
  const [a, b, c, d] = tramos[k]!;
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
  return [w[0] * a[0] + w[1] * b[0] + w[2] * c[0] + w[3] * d[0], w[0] * a[1] + w[1] * b[1] + w[2] * c[1] + w[3] * d[1]];
}

/** La colita como `d` de un `<path>` de SVG, pasando cada punto por `map` (de pulgadas a la pantalla). */
export function colitaSvg(radio: number, map: (x: number, y: number) => [number, number]): string {
  const f = ([x, y]: readonly [number, number]) => map(x, y).map((n) => Math.round(n * 100) / 100).join(' ');
  return colitaTramos(radio)
    .map(([a, b, c, d], i) => `${i === 0 ? `M${f(a)} ` : ''}C${f(b)}, ${f(c)}, ${f(d)}`)
    .join(' ');
}
