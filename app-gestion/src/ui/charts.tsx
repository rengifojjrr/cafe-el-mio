// Gráficas (Recharts) en la paleta de la línea. Solo usan variables de tokens.css.
// Solo las importan pantallas que se cargan aparte, así Recharts no pesa en la carga inicial.
import { type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useReducedMotion } from '../app/hooks';
import { fmtMoney, fmtMoney0, fmtNumber } from '../lib/money';

export type ChartFormat = 'money' | 'money0' | 'number';

export interface Series {
  key: string;
  label: string;
  /** Variable de color de tokens.css; por defecto --chart-1, --chart-2… en orden. */
  color?: string;
}

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

function format(v: unknown, f: ChartFormat): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  if (f === 'money') return fmtMoney(n);
  if (f === 'money0') return fmtMoney0(n);
  return fmtNumber(Math.round(n));
}

/** Formato corto para el eje: 12,5 mil · 1,2 M. */
function shortAxis(v: number, f: ChartFormat): string {
  const abs = Math.abs(v);
  const prefix = f === 'number' ? '' : '$';
  if (abs >= 1_000_000) return `${prefix}${(v / 1_000_000).toLocaleString('es-US', { maximumFractionDigits: 1 })} M`;
  if (abs >= 1_000) return `${prefix}${(v / 1_000).toLocaleString('es-US', { maximumFractionDigits: abs >= 10_000 ? 0 : 1 })} mil`;
  return `${prefix}${Math.round(v).toLocaleString('es-US')}`;
}

const tooltipStyle = {
  contentStyle: {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    color: 'var(--ink)',
    boxShadow: '0 10px 30px -12px var(--shadow)',
    fontSize: 13,
  },
  labelStyle: { color: 'var(--muted)', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: 'var(--ink)', padding: 0 },
};

const axisTick = { fill: 'var(--muted)', fontSize: 12 };

function colorOf(s: Series, i: number): string {
  return s.color ?? PALETTE[i % PALETTE.length]!;
}

/** Marco accesible: la gráfica se describe con una tabla oculta para lectores de pantalla. */
type Row = Record<string, unknown>;

function ChartFrame({
  label,
  height,
  data,
  xKey,
  series,
  fmt,
  xLabel,
  children,
}: {
  label: string;
  height: number;
  data: Row[];
  xKey: string;
  series: Series[];
  fmt: ChartFormat;
  xLabel?: (v: unknown) => string;
  children: ReactNode;
}) {
  return (
    <figure className="m-0" aria-label={label}>
      <div style={{ width: '100%', height }} aria-hidden="true">
        {children}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{xKey}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              <th scope="row">{xLabel ? xLabel(row[xKey]) : String(row[xKey] ?? '')}</th>
              {series.map((s) => (
                <td key={s.key}>{format(row[s.key], fmt)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function legendFormatter(value: string): ReactNode {
  return <span style={{ color: 'var(--muted)', fontSize: 12 }}>{value}</span>;
}

/** Barras verticales (agrupadas o apiladas). */
export function BarsChart({
  data,
  xKey,
  series,
  stacked = false,
  height = 240,
  fmt = 'money0',
  label,
  xLabel,
  legend = series.length > 1,
}: {
  data: readonly object[];
  xKey: string;
  series: Series[];
  stacked?: boolean;
  height?: number;
  fmt?: ChartFormat;
  label: string;
  xLabel?: (v: unknown) => string;
  legend?: boolean;
}) {
  const reduced = useReducedMotion();
  const rows = data as Row[];
  return (
    <ChartFrame label={label} height={height} data={rows} xKey={xKey} series={series} fmt={fmt} xLabel={xLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey={xKey} tick={axisTick} axisLine={{ stroke: 'var(--chart-grid)' }} tickLine={false} tickFormatter={xLabel ? (v: unknown) => xLabel(v) : undefined} interval={0} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => shortAxis(v, fmt)} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: 'var(--accent-soft)' }}
            formatter={(v: unknown, name: unknown) => [format(v, fmt), String(name)]}
            labelFormatter={(v: unknown) => (xLabel ? xLabel(v) : String(v))}
          />
          {legend ? <Legend formatter={legendFormatter} iconType="circle" iconSize={8} itemSorter={null} /> : null}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={colorOf(s, i)}
              stackId={stacked ? 'pila' : undefined}
              radius={!stacked || i === series.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
              maxBarSize={44}
              isAnimationActive={!reduced}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Barras horizontales: buena para rankings con nombres largos. */
export function RankBars({
  data,
  labelKey,
  valueKey,
  valueLabel,
  fmt = 'number',
  label,
  color = 'var(--chart-1)',
  rowHeight = 34,
}: {
  data: readonly object[];
  labelKey: string;
  valueKey: string;
  valueLabel: string;
  fmt?: ChartFormat;
  label: string;
  color?: string;
  rowHeight?: number;
}) {
  const reduced = useReducedMotion();
  const rows = data as Row[];
  const height = Math.max(120, rows.length * rowHeight + 24);
  const series = [{ key: valueKey, label: valueLabel, color }];
  return (
    <ChartFrame label={label} height={height} data={rows} xKey={labelKey} series={series} fmt={fmt}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
          <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v: number) => shortAxis(v, fmt)} />
          <YAxis
            type="category"
            dataKey={labelKey}
            tick={{ ...axisTick, fill: 'var(--ink)' }}
            axisLine={false}
            tickLine={false}
            width={128}
            tickFormatter={(v: unknown) => {
              const s = String(v);
              return s.length > 18 ? `${s.slice(0, 17)}…` : s;
            }}
          />
          <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--accent-soft)' }} formatter={(v: unknown) => [format(v, fmt), valueLabel]} />
          <Bar dataKey={valueKey} name={valueLabel} fill={color} radius={[0, 6, 6, 0]} maxBarSize={22} isAnimationActive={!reduced} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Líneas (o áreas suaves) para series en el tiempo. */
export function LinesChart({
  data,
  xKey,
  series,
  height = 240,
  fmt = 'money0',
  label,
  xLabel,
  area = false,
  legend = series.length > 1,
}: {
  data: readonly object[];
  xKey: string;
  series: Series[];
  height?: number;
  fmt?: ChartFormat;
  label: string;
  xLabel?: (v: unknown) => string;
  area?: boolean;
  legend?: boolean;
}) {
  const reduced = useReducedMotion();
  const rows = data as Row[];
  const common = (
    <>
      <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
      <XAxis dataKey={xKey} tick={axisTick} axisLine={{ stroke: 'var(--chart-grid)' }} tickLine={false} tickFormatter={xLabel ? (v: unknown) => xLabel(v) : undefined} interval={0} />
      <YAxis tick={axisTick} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => shortAxis(v, fmt)} />
      <Tooltip {...tooltipStyle} formatter={(v: unknown, name: unknown) => [format(v, fmt), String(name)]} labelFormatter={(v: unknown) => (xLabel ? xLabel(v) : String(v))} />
      {legend ? <Legend formatter={legendFormatter} iconType="circle" iconSize={8} itemSorter={null} /> : null}
    </>
  );
  return (
    <ChartFrame label={label} height={height} data={rows} xKey={xKey} series={series} fmt={fmt} xLabel={xLabel}>
      <ResponsiveContainer width="100%" height="100%">
        {area ? (
          <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {common}
            {series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={colorOf(s, i)}
                strokeWidth={2.5}
                fill={colorOf(s, i)}
                fillOpacity={0.14}
                dot={{ r: 3, fill: colorOf(s, i), strokeWidth: 0 }}
                isAnimationActive={!reduced}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {common}
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={colorOf(s, i)}
                strokeWidth={2.5}
                dot={{ r: 3, fill: colorOf(s, i), strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={!reduced}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </ChartFrame>
  );
}
