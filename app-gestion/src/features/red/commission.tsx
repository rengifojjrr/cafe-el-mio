// Comisión progresiva: el editor del esquema y el simulador (Ajustes), la comisión propia de un
// vendedor (Usuarios) y «Vas en el N %» en el inicio del vendedor.
import { Coins, Plus, Save, TrendingUp, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import type { CommissionScheme, CommissionTier, CommissionTierMetric, User } from '../../data/types';
import {
  type CommissionMetrics,
  METRICS,
  commissionRate,
  describeScheme,
  metricAmountText,
  pctText,
  progressText,
  schemeProblem,
  tierText,
} from '../../domain/commission-scheme';
import { describeRule } from '../../domain/money-rules';
import { fmtMoney, fmtNumber } from '../../lib/money';
import { saveLineCommissionScheme, saveSellerCommissionScheme, sellerCommissionStatus } from '../../services/commission-scheme';
import { Button, Card, NumberInput, Section, SelectInput, Sheet } from '../../ui/kit';
import { useAction } from '../../ui/toast';

const DEFAULT_SCHEME: CommissionScheme = { basePercent: 6, capPercent: 10, tiers: [{ metric: 'locales', min: 5, percent: 8 }] };

const METRIC_SHORT: Record<CommissionTierMetric, string> = {
  locales: 'Locales activos',
  cajas: 'Cajas del mes',
  unidades: 'Unidades del mes',
  ventas: 'Ventas del mes (USD)',
};

type Draft = { basePercent: number | ''; capPercent: number | ''; tiers: { metric: CommissionTierMetric; min: number | ''; percent: number | '' }[] };

function toDraft(s: CommissionScheme): Draft {
  return { basePercent: s.basePercent, capPercent: s.capPercent, tiers: s.tiers.map((t) => ({ ...t })) };
}

function fromDraft(d: Draft): CommissionScheme {
  const n = (v: number | '') => (v === '' ? Number.NaN : v);
  return { basePercent: n(d.basePercent), capPercent: n(d.capPercent), tiers: d.tiers.map((t) => ({ metric: t.metric, min: n(t.min), percent: n(t.percent) })) };
}

/** Editor del esquema: % base, tope y escalones. */
export function SchemeEditor({ value, onChange, disabled }: { value: Draft; onChange: (d: Draft) => void; disabled?: boolean }) {
  const setTier = (i: number, patch: Partial<Draft['tiers'][number]>) => onChange({ ...value, tiers: value.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  return (
    <fieldset disabled={disabled} className="m-0 grid min-w-0 gap-4 border-0 p-0">
      <div className="grid grid-cols-2 gap-3">
        <NumberInput label="% base" value={value.basePercent} onValue={(v) => onChange({ ...value, basePercent: v })} min={0} max={50} step={0.5} hint="Lo que gana sin llegar a ningún escalón." />
        <NumberInput label="Tope (%)" value={value.capPercent} onValue={(v) => onChange({ ...value, capPercent: v })} min={0} max={50} step={0.5} hint="Nunca se pasa, aunque llegue a varios escalones." />
      </div>
      <div className="grid gap-2">
        <p className="field-label">Escalones</p>
        {value.tiers.length === 0 ? <p className="text-sm text-muted">Sin escalones: todos ganan el % base.</p> : null}
        <ul className="grid grid-cols-1 gap-2">
          {value.tiers.map((t, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-xl border border-line p-3">
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="col-span-2 sm:col-span-1">
                  <SelectInput label="Mide" value={t.metric} onChange={(e) => setTier(i, { metric: e.target.value as CommissionTierMetric })} options={METRICS.map((m) => ({ value: m, label: METRIC_SHORT[m] }))} />
                </div>
                <NumberInput label="Desde" value={t.min} onValue={(v) => setTier(i, { min: v })} min={0} step={t.metric === 'ventas' ? 100 : 1} />
                <NumberInput label="Pasa al (%)" value={t.percent} onValue={(v) => setTier(i, { percent: v })} min={0} max={50} step={0.5} />
              </div>
              <Button variant="ghost" icon={Trash2} onClick={() => onChange({ ...value, tiers: value.tiers.filter((_, j) => j !== i) })} aria-label={`Quitar el escalón ${i + 1}`} />
            </li>
          ))}
        </ul>
        {value.tiers.length < 8 ? (
          <Button icon={Plus} onClick={() => onChange({ ...value, tiers: [...value.tiers, { metric: 'locales', min: '', percent: '' }] })}>
            Agregar escalón
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}

/** Sección de Ajustes: la comisión progresiva de la línea y el simulador. */
export function CommissionSchemeSettings({ scheme }: { scheme?: CommissionScheme }) {
  const { ctx, actor } = useLine();
  const { run, busy } = useAction();
  const [on, setOn] = useState(Boolean(scheme));
  const [draft, setDraft] = useState<Draft>(toDraft(scheme ?? DEFAULT_SCHEME));
  const current = fromDraft(draft);
  const problem = on ? schemeProblem(current) : null;
  const save = () =>
    void run(() => saveLineCommissionScheme(ctx, on ? current : null), on ? 'Comisión progresiva guardada: rige para las ventas que vienen.' : 'Sin comisión progresiva: rige la de cada producto.');
  return (
    <Section title="Comisión progresiva">
      <Card className="grid grid-cols-[minmax(0,1fr)] gap-4 p-5">
        <p className="max-w-[70ch] text-sm text-muted">
          El vendedor gana un % del precio al local que sube con sus locales activos o con lo que vende en el mes, sin pasar del tope. El % se fija al reportarse cada venta, con lo que lleva en el mes hasta ese momento; lo ya devengado no cambia. Los productos con «comisión propia» y los vendedores con comisión especial fija no la usan.
        </p>
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={on} onChange={(e) => setOn(e.target.checked)} disabled={actor.readOnly} />
          <span className="font-semibold">Usar comisión progresiva en esta línea</span>
        </label>
        {on ? <SchemeEditor value={draft} onChange={setDraft} disabled={actor.readOnly} /> : <p className="text-sm text-muted">Sin comisión progresiva, cada producto paga su propia comisión (como antes).</p>}
        {problem ? (
          <p className="field-error" role="alert">
            {problem}
          </p>
        ) : null}
        <div>
          <Button variant="primary" icon={Save} busy={busy} onClick={save} disabled={actor.readOnly || Boolean(problem)}>
            Guardar comisión progresiva
          </Button>
        </div>
      </Card>
      {on && !problem ? <Simulator scheme={current} /> : null}
    </Section>
  );
}

/** Simulador: con estas cifras, ¿qué % le toca? */
export function Simulator({ scheme }: { scheme: CommissionScheme }) {
  const [m, setM] = useState<Record<CommissionTierMetric, number | ''>>({ locales: 3, cajas: 0, unidades: 0, ventas: 0 });
  const metrics: CommissionMetrics = { locales: Number(m.locales) || 0, cajas: Number(m.cajas) || 0, unidades: Number(m.unidades) || 0, ventas: Number(m.ventas) || 0 };
  const rate = commissionRate(scheme, metrics);
  return (
    <Card className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 p-5" aria-label="Simulador de comisión">
      <h3 className="flex items-center gap-2 font-bold text-ink">
        <TrendingUp className="h-5 w-5 text-accent" aria-hidden /> Simulador
      </h3>
      <p className="text-sm text-muted">Escribe cómo va un vendedor en el mes y mira qué % le toca.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METRICS.map((k) => (
          <NumberInput key={k} label={METRIC_SHORT[k]} value={m[k]} onValue={(v) => setM((s) => ({ ...s, [k]: v }))} min={0} step={k === 'ventas' ? 100 : 1} />
        ))}
      </div>
      <div className="rounded-2xl border border-line bg-surface-2 p-4" aria-live="polite">
        <p className="text-sm text-muted">Le toca</p>
        <p className="glow text-3xl font-bold tabular" data-testid="simulador-resultado">
          {pctText(rate.percent)}
        </p>
        <p className="mt-1 text-sm text-ink">{rate.tierReached ? `Por el escalón «${tierText(rate.tierReached)}».` : 'Es el % base: todavía no llega a ningún escalón.'}</p>
        {rate.next ? <p className="text-sm text-muted">Con {metricAmountText(rate.next.metric, rate.next.missing)} más pasa al {pctText(rate.next.percent)}.</p> : <p className="text-sm text-muted">Ya está en lo más alto (tope {pctText(scheme.capPercent)}).</p>}
      </div>
    </Card>
  );
}

/** En la tarjeta del vendedor (Usuarios): qué comisión le rige. */
export function SellerCommissionText({ user, lineScheme }: { user: User; lineScheme?: CommissionScheme }) {
  const text = user.commissionOverride
    ? `especial, ${describeRule(user.commissionOverride)}`
    : user.commissionScheme
      ? `progresiva propia (${describeScheme(user.commissionScheme)})`
      : lineScheme
        ? 'progresiva de la línea'
        : 'según cada producto';
  return (
    <p className="mt-1 text-sm text-ink">
      Comisión: <span className="font-semibold">{text}</span>
    </p>
  );
}

/** Botón «Comisión progresiva» del vendedor (Usuarios): la de la línea o una propia. */
export function SellerSchemeButton({ user, lineScheme }: { user: User; lineScheme?: CommissionScheme }) {
  const [open, setOpen] = useState(false);
  const { actor } = useLine();
  if (actor.readOnly) return null;
  return (
    <>
      <Button variant="ghost" icon={Coins} onClick={() => setOpen(true)}>
        Comisión progresiva
      </Button>
      <SellerSchemeSheet key={open ? 'abierta' : 'cerrada'} open={open} onClose={() => setOpen(false)} user={user} lineScheme={lineScheme} />
    </>
  );
}

function SellerSchemeSheet({ open, onClose, user, lineScheme }: { open: boolean; onClose: () => void; user: User; lineScheme?: CommissionScheme }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [own, setOwn] = useState(Boolean(user.commissionScheme));
  const [draft, setDraft] = useState<Draft>(toDraft(user.commissionScheme ?? lineScheme ?? DEFAULT_SCHEME));
  const status = useAsync(() => (open ? sellerCommissionStatus(ctx, user.id) : Promise.resolve(null)), [ctx, open, user.id]);
  const current = fromDraft(draft);
  const problem = own ? schemeProblem(current) : null;
  return (
    <Sheet open={open} onClose={onClose} title={`Comisión de ${user.name}`} wide>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {status.data?.rate ? (
          <p className="rounded-2xl border border-line bg-surface-2 p-3 text-sm text-ink">
            Hoy: {progressText(status.data.rate)}. Lleva {metricAmountText('locales', status.data.metrics.locales)} y {fmtMoney(status.data.metrics.ventas)} vendidos este mes.
          </p>
        ) : null}
        {user.commissionOverride ? <p className="text-sm text-warn">Tiene comisión especial fija ({describeRule(user.commissionOverride)}): manda sobre la progresiva. Se cambia en «Editar».</p> : null}
        <SelectInput
          label="Comisión progresiva"
          value={own ? 'propia' : 'linea'}
          onChange={(e) => setOwn(e.target.value === 'propia')}
          options={[
            { value: 'linea', label: lineScheme ? `La de la línea (${describeScheme(lineScheme)})` : 'La de la línea (hoy no hay)' },
            { value: 'propia', label: 'Propia de este vendedor' },
          ]}
        />
        {own ? <SchemeEditor value={draft} onChange={setDraft} /> : null}
        {problem ? (
          <p className="field-error" role="alert">
            {problem}
          </p>
        ) : null}
        <Button
          variant="primary"
          icon={Save}
          busy={busy}
          disabled={Boolean(problem)}
          onClick={() =>
            void run(async () => {
              await saveSellerCommissionScheme(ctx, user.id, own ? current : null);
              onClose();
            }, own ? `Comisión propia de ${user.name} guardada.` : `${user.name} usa la comisión de la línea.`)
          }
        >
          Guardar
        </Button>
      </div>
    </Sheet>
  );
}

/** Inicio del vendedor: «Vas en el 7 % · con 1 local activo más pasas al 8 %». */
export function CommissionProgress() {
  const { ctx } = useLine();
  const status = useAsync(() => sellerCommissionStatus(ctx), [ctx]);
  const s = status.data;
  const tiers = useMemo(() => (s?.scheme ? [...s.scheme.tiers].sort((a: CommissionTier, b: CommissionTier) => a.percent - b.percent) : []), [s]);
  if (!s?.rate || s.flatOverride) return null;
  return (
    <Card className="mb-3 p-4" aria-label="Tu comisión progresiva">
      <p className="flex flex-wrap items-center gap-2 text-lg font-bold text-ink">
        <TrendingUp className="h-5 w-5 text-accent" aria-hidden /> {progressText(s.rate)}
      </p>
      <p className="mt-1 text-sm text-muted">
        Este mes llevas {metricAmountText('locales', s.metrics.locales)}, {fmtMoney(s.metrics.ventas)} vendidos y {fmtNumber(Math.floor(s.metrics.cajas))} cajas. Productos con comisión propia pagan la suya.
      </p>
      {tiers.length ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Escalones">
          <li>Base {pctText(s.scheme!.basePercent)}</li>
          {tiers.map((t, i) => (
            <li key={i}>{tierText(t)}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
