// Componentes base: botones grandes con ícono, tarjetas de vidrio, cifras con brillo,
// estados vacíos que enseñan qué hacer, formularios accesibles y hojas modales.
import { Loader2, Minus, Plus, X, type LucideIcon } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useCountUp } from '../app/hooks';
import { fmtMoney, fmtMoney0, fmtNumber, fmtPercent } from '../lib/money';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  icon: Icon,
  big,
  busy,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: LucideIcon; big?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={`btn btn-${variant} ${big ? 'btn-big' : ''} ${!children ? 'btn-icon' : ''} ${className}`}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : Icon ? <Icon aria-hidden /> : null}
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  variant = 'secondary',
  icon: Icon,
  big,
  children,
  className = '',
  ...rest
}: { to: string; variant?: Variant; icon?: LucideIcon; big?: boolean; children?: ReactNode; className?: string; 'aria-label'?: string }) {
  return (
    <Link to={to} className={`btn btn-${variant} ${big ? 'btn-big' : ''} ${!children ? 'btn-icon' : ''} ${className}`} {...rest}>
      {Icon ? <Icon aria-hidden /> : null}
      {children}
    </Link>
  );
}

export function Card({ children, className = '', as: As = 'section', ...rest }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' | 'li'; 'aria-label'?: string }) {
  return (
    <As className={`glass ${className}`} {...rest}>
      {children}
    </As>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back ? (
          <Link to={back.to} className="mb-1 inline-flex min-h-8 items-center text-sm font-semibold text-muted hover:text-ink">
            ‹ {back.label}
          </Link>
        ) : null}
        <h1 className="font-display text-[1.85rem] leading-tight font-semibold text-ink sm:text-[2.3rem]">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-[62ch] text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, actions, children, className = '' }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mt-7 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

type StatFormat = 'money' | 'money0' | 'number' | 'percent';

function formatValue(v: number, f: StatFormat): string {
  if (f === 'money') return fmtMoney(v);
  if (f === 'money0') return fmtMoney0(v);
  if (f === 'percent') return fmtPercent(v);
  return fmtNumber(Math.round(v));
}

/** Cifra clave con brillo suave y contador que sube al cargar. */
export function Stat({
  label,
  value,
  format = 'number',
  hint,
  tone = 'data',
  icon: Icon,
  to,
}: {
  label: string;
  value: number;
  format?: StatFormat;
  hint?: ReactNode;
  tone?: 'data' | 'ok' | 'warn' | 'danger' | 'ink';
  icon?: LucideIcon;
  to?: string;
}) {
  const shown = useCountUp(value);
  const color = { data: 'glow', ink: 'text-ink', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }[tone];
  const body = (
    <>
      {/* La etiqueta reserva dos líneas: así las cifras de una misma fila quedan a la misma altura en el teléfono. */}
      <div className="flex min-h-[2.6em] items-start gap-2 text-sm leading-tight font-medium text-muted">
        {Icon ? <Icon className="mt-px h-4 w-4 flex-none" aria-hidden /> : null}
        <span>{label}</span>
      </div>
      <div className={`tabular mt-1.5 text-[1.7rem] leading-none font-bold tracking-tight ${color}`} aria-label={`${label}: ${formatValue(value, format)}`}>
        {formatValue(shown, format)}
      </div>
      {hint ? <div className="mt-1.5 text-sm text-muted">{hint}</div> : null}
    </>
  );
  if (to) {
    return (
      <Link to={to} className="glass block h-full p-4 transition-colors hover:border-line-strong">
        {body}
      </Link>
    );
  }
  return <div className="glass h-full p-4">{body}</div>;
}

export function Money({ value, className = '' }: { value: number; className?: string }) {
  return <span className={`tabular ${className}`}>{fmtMoney(value)}</span>;
}

export function Pill({ tone, children, dot }: { tone?: 'ok' | 'warn' | 'danger' | 'info' | 'accent'; children: ReactNode; dot?: boolean }) {
  return <span className={`pill ${tone ? `pill-${tone}` : ''} ${dot ? 'pill-dot' : ''}`}>{children}</span>;
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="glass flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Icon className="h-7 w-7" aria-hidden />
      </span>
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      {children ? <p className="max-w-[46ch] text-muted">{children}</p> : null}
      {action}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-20" />
      ))}
    </div>
  );
}

export function ErrorBox({ error }: { error: Error }) {
  return (
    <div className="glass border-danger p-5 text-danger" role="alert">
      <p className="font-bold">No se pudo cargar.</p>
      <p className="mt-1 text-sm text-ink">{error.message}</p>
    </div>
  );
}

// ---------- Formularios ----------

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function TextInput({ label, hint, error, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={rest.id ?? id}>
      <input id={rest.id ?? id} className="input" aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export function NumberInput({
  label,
  hint,
  error,
  value,
  onValue,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { label: string; hint?: ReactNode; error?: string; value: number | ''; onValue: (v: number | '') => void }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={rest.id ?? id}>
      <input
        id={rest.id ?? id}
        className="input tabular"
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onValue(e.target.value === '' ? '' : Number(e.target.value))}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Field>
  );
}

export function SelectInput({
  label,
  hint,
  error,
  options,
  placeholder,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: ReactNode; error?: string; options: { value: string; label: string }[]; placeholder?: string }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={rest.id ?? id}>
      <select id={rest.id ?? id} className="input" aria-invalid={error ? true : undefined} {...rest}>
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TextArea({ label, hint, error, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode; error?: string }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={rest.id ?? id}>
      <textarea id={rest.id ?? id} className="input" aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

/** Cantidad con botones grandes: suma por caja y deja escribir unidades sueltas. */
/** Lo que suma o resta un toque del contador: «una caja», «un mazo», «un tabaco» o «una unidad». */
function stepWord(pack: number, unit?: string): string {
  if (pack > 1) return 'una caja';
  if (unit === 'mazos') return 'un mazo';
  if (unit === 'tabacos') return 'un tabaco';
  return 'una unidad';
}

export function QtyStepper({
  value,
  onChange,
  pack = 1,
  max,
  label,
  unit = 'u.',
}: {
  value: number;
  onChange: (v: number) => void;
  pack?: number;
  max?: number;
  label: string;
  unit?: string;
}) {
  const clamp = (v: number) => Math.max(0, max !== undefined ? Math.min(max, v) : v);
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" className="btn btn-secondary btn-icon" onClick={() => onChange(clamp(value - pack))} aria-label={`Quitar ${stepWord(pack, unit)} de ${label}`} disabled={value <= 0}>
        <Minus aria-hidden />
      </button>
      <input
        className="input tabular w-20 text-center"
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value}
        aria-label={`Cantidad de ${label}`}
        onChange={(e) => onChange(clamp(Math.floor(Number(e.target.value) || 0)))}
      />
      <button type="button" className="btn btn-secondary btn-icon" onClick={() => onChange(clamp(value + pack))} aria-label={`Agregar ${stepWord(pack, unit)} de ${label}`} disabled={max !== undefined && value >= max}>
        <Plus aria-hidden />
      </button>
      {pack > 1 ? (
        <span className="text-sm text-muted tabular">
          {value % pack === 0 ? `${value / pack} caja${value / pack === 1 ? '' : 's'}` : `${value} ${unit}`}
        </span>
      ) : null}
    </div>
  );
}

// ---------- Hoja modal (abajo en el teléfono, centrada en la computadora) ----------

/** Hojas abiertas, la de arriba al final (por ejemplo, el lector abierto desde otra hoja). */
const openSheets: symbol[] = [];

export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Con la función en una ref, que la pantalla se vuelva a dibujar no reinicia la hoja (el foco no salta).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const me = Symbol('hoja');
    openSheets.push(me);
    const prev = document.activeElement as HTMLElement | null;
    // Escape cierra solo la hoja de arriba.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openSheets[openSheets.length - 1] === me) onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => {
      const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
      (first ?? ref.current)?.focus();
    }, 30);
    return () => {
      openSheets.splice(openSheets.indexOf(me), 1);
      document.removeEventListener('keydown', onKey);
      if (openSheets.length === 0) document.body.style.overflow = '';
      window.clearTimeout(t);
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`glass relative z-10 max-h-[92dvh] w-full overflow-y-auto rounded-b-none bg-surface p-5 sm:rounded-b-[20px] ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
        style={{ animation: 'subir-hoja .28s cubic-bezier(.2,.7,.1,1)' }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
          <button data-close className="btn btn-ghost btn-icon -mt-1 -mr-2" onClick={onClose} aria-label="Cerrar">
            <X aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Tabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" className="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined ? <span className="ml-1.5 text-faint tabular">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-sm text-muted">{k}</dt>
          <dd className="mt-0.5 font-medium break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SampleBadge() {
  return (
    <span className="pill pill-warn" title="Todo lo que ves son datos inventados para la demostración.">
      Datos de ejemplo
    </span>
  );
}
