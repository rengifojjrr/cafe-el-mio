// Horario de la tienda sin escribir: se tocan los días y se eligen la hora de abrir y la de
// cerrar. Se guarda como texto legible («Lun–Sáb 9 a. m.–8 p. m. · Dom cerrado»).
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
const LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export interface HoursRange {
  days: number[];
  open: string;
  close: string;
}

const TIMES: string[] = (() => {
  const out: string[] = [];
  for (let h = 5; h <= 23; h++) for (const m of [0, 30]) out.push(`${String(h).padStart(2, '0')}:${m === 0 ? '00' : '30'}`);
  out.push('23:59');
  return out;
})();

/** «13:30» → «1:30 p. m.»; «09:00» → «9 a. m.» */
export function time12(t: string): string {
  if (t === '23:59') return '12 a. m.';
  const [hh = 0, mm = 0] = t.split(':').map(Number);
  const suffix = hh < 12 ? 'a. m.' : 'p. m.';
  const h = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h}:${String(mm).padStart(2, '0')} ${suffix}` : `${h} ${suffix}`;
}

function daysText(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Todos los días';
  // Tramos seguidos: Lun–Vie; sueltos: Lun, Mié
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    if (j - i >= 2) parts.push(`${DAYS[sorted[i]!]}–${DAYS[sorted[j]!]}`);
    else for (let k = i; k <= j; k++) parts.push(DAYS[sorted[k]!]!);
    i = j + 1;
  }
  return parts.join(', ');
}

export function hoursText(ranges: HoursRange[]): string {
  const used = new Set<number>();
  const parts = ranges
    .filter((r) => r.days.length > 0)
    .map((r) => {
      r.days.forEach((d) => used.add(d));
      return `${daysText(r.days)} ${time12(r.open)}–${time12(r.close)}`;
    });
  const closed = [0, 1, 2, 3, 4, 5, 6].filter((d) => !used.has(d));
  if (parts.length && closed.length && closed.length < 7) parts.push(`${daysText(closed)} cerrado`);
  return parts.join(' · ');
}

/** Lee el horario guardado como texto (también el formato de 24 h de los datos de ejemplo). */
export function parseHours(text: string): HoursRange[] | null {
  if (!text.trim()) return null;
  const ranges: HoursRange[] = [];
  for (const chunk of text.split('·').map((c) => c.trim())) {
    if (/cerrado$/i.test(chunk)) continue;
    const m = /^(.*?)\s+(\d{1,2}(?::\d{2})?\s*(?:a\. m\.|p\. m\.)?)\s*[–-]\s*(\d{1,2}(?::\d{2})?\s*(?:a\. m\.|p\. m\.)?)$/.exec(chunk);
    if (!m) return null;
    const days = parseDays(m[1] ?? '');
    const open = parseTime(m[2] ?? '');
    const close = parseTime(m[3] ?? '');
    if (!days || !open || !close) return null;
    ranges.push({ days, open, close });
  }
  return ranges.length ? ranges : null;
}

function parseDays(s: string): number[] | null {
  const t = s.trim();
  if (/^todos los d[ií]as$/i.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const out: number[] = [];
  for (const part of t.split(',').map((p) => p.trim())) {
    const [a, b] = part.split('–').map((x) => DAYS.findIndex((d) => d.toLowerCase() === x?.trim().toLowerCase()));
    if (a === undefined || a < 0) return null;
    if (b !== undefined && b >= 0) for (let d = a; d <= b; d++) out.push(d);
    else out.push(a);
  }
  return out;
}

function parseTime(s: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\. m\.|p\. m\.)?$/.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'p. m.' && h < 12) h += 12;
  if (m[3] === 'a. m.' && h === 12) h = 0;
  if (h === 0 && m[3]) return '23:59';
  const v = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return TIMES.includes(v) ? v : nearest(v);
}

function nearest(v: string): string {
  const [h = 0, m = 0] = v.split(':').map(Number);
  const target = h * 60 + m;
  let best = TIMES[0]!;
  let d = Infinity;
  for (const t of TIMES) {
    const [th = 0, tm = 0] = t.split(':').map(Number);
    const dd = Math.abs(th * 60 + tm - target);
    if (dd < d) {
      d = dd;
      best = t;
    }
  }
  return best;
}

const PRESETS: { label: string; ranges: HoursRange[] }[] = [
  { label: 'Lun–Sáb 9–8 · Dom cerrado', ranges: [{ days: [0, 1, 2, 3, 4, 5], open: '09:00', close: '20:00' }] },
  { label: 'Todos los días 7–9', ranges: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '07:00', close: '21:00' }] },
  {
    label: 'Lun–Sáb 10–8 · Dom 12–6',
    ranges: [
      { days: [0, 1, 2, 3, 4, 5], open: '10:00', close: '20:00' },
      { days: [6], open: '12:00', close: '18:00' },
    ],
  },
];

/**
 * Horario por días. Con `optional` (un prospecto, por ejemplo) arranca vacío si no hay horario
 * guardado, en vez de poner uno de ejemplo que nadie confirmó.
 */
export function HoursPicker({ value, onChange, optional }: { value: string; onChange: (text: string) => void; optional?: boolean }) {
  const id = useId();
  const [ranges, setRanges] = useState<HoursRange[]>(() => parseHours(value) ?? (optional ? [] : PRESETS[0]!.ranges));
  const [legacy] = useState(() => (value && !parseHours(value) ? value : ''));

  useEffect(() => {
    onChange(hoursText(ranges));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranges]);

  const update = (i: number, patch: Partial<HoursRange>) => setRanges((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const toggleDay = (i: number, d: number) =>
    setRanges((rs) =>
      rs.map((r, k) => {
        if (k === i) return { ...r, days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d] };
        // Un día no puede estar en dos horarios a la vez.
        return { ...r, days: r.days.filter((x) => x !== d) };
      }),
    );

  return (
    <fieldset className="field" aria-describedby={`${id}-res`}>
      <legend className="field-label mb-1">Horario</legend>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="pill min-h-9 cursor-pointer px-3 hover:border-accent" onClick={() => setRanges(p.ranges.map((r) => ({ ...r, days: [...r.days] })))}>
            {p.label}
          </button>
        ))}
        {optional ? (
          <button type="button" className="pill min-h-9 cursor-pointer px-3 hover:border-accent" aria-pressed={ranges.length === 0} onClick={() => setRanges([])}>
            Todavía no lo sé
          </button>
        ) : null}
      </div>
      <div className="mt-2 grid gap-3">
        {ranges.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-2xl border border-line bg-surface-2 p-3">
            <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={`Días del horario ${i + 1}`}>
              {LETTERS.map((l, d) => {
                const on = r.days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    aria-label={DAYS[d]}
                    onClick={() => toggleDay(i, d)}
                    className={`grid h-11 w-full place-items-center rounded-xl border text-sm font-bold transition-colors ${on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-muted hover:border-line-strong'}`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <label className="field">
                <span className="field-hint">Abre</span>
                <select className="input" value={r.open} onChange={(e) => update(i, { open: e.target.value })}>
                  {TIMES.map((t) => (
                    <option key={t} value={t}>
                      {time12(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-hint">Cierra</span>
                <select className="input" value={r.close} onChange={(e) => update(i, { close: e.target.value })}>
                  {TIMES.map((t) => (
                    <option key={t} value={t}>
                      {time12(t)}
                    </option>
                  ))}
                </select>
              </label>
              {ranges.length > 1 ? (
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setRanges((rs) => rs.filter((_, k) => k !== i))} aria-label={`Quitar el horario ${i + 1}`}>
                  <Trash2 aria-hidden />
                </button>
              ) : (
                <span />
              )}
            </div>
          </div>
        ))}
      </div>
      {ranges.length < 3 ? (
        <button
          type="button"
          className="btn btn-ghost mt-1 justify-start"
          onClick={() => setRanges((rs) => [...rs, rs.length === 0 ? { days: [0, 1, 2, 3, 4, 5], open: '10:00', close: '20:00' } : { days: [], open: '10:00', close: '18:00' }])}
        >
          <Plus aria-hidden /> {ranges.length === 0 ? 'Poner el horario' : 'Otro horario para otros días'}
        </button>
      ) : null}
      <p id={`${id}-res`} className="field-hint">
        Queda así: <span className="font-semibold text-ink">{hoursText(ranges) || (optional ? 'sin horario (se anota en la visita)' : 'sin horario')}</span>
        {legacy ? <span className="block">Antes decía: «{legacy}»</span> : null}
      </p>
    </fieldset>
  );
}
