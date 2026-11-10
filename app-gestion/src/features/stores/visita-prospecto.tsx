// Hoja para anotar la visita a un prospecto (en un recorrido o desde su ficha): qué pasó y lo que
// dio el local (encargado, teléfono, correo, horario, permiso).
import { ClipboardPen } from 'lucide-react';
import { useState } from 'react';
import { useLine } from '../../app/line-context';
import type { ProspectResult, Store } from '../../data/types';
import { PROSPECT_RESULT_LABEL } from '../../domain/recorridos';
import { anotarVisitaProspecto } from '../../services/recorridos';
import { Button, Sheet, TextArea, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';

export const RESULT_TONE: Record<ProspectResult, 'ok' | 'warn' | 'danger' | 'info' | 'accent'> = {
  interesado: 'ok',
  lo_piensa: 'accent',
  no_interesa: 'danger',
  sin_encargado: 'warn',
  cerrado: 'danger',
};

const RESULT_ORDER: ProspectResult[] = ['interesado', 'lo_piensa', 'no_interesa', 'sin_encargado', 'cerrado'];

/** Hoja para anotar la visita a un prospecto: qué pasó y lo que dio el local. */
export function VisitaProspectoSheet({ store, open, onClose }: { store: Store; open: boolean; onClose: () => void }) {
  const { ctx, config } = useLine();
  const { run, busy } = useAction();
  const [result, setResult] = useState<ProspectResult | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(() => ({
    managerName: store.managerName,
    phone: store.phone,
    email: store.email,
    hours: store.hours,
    permitNumber: store.tobaccoPermit?.number ?? '',
    permitExpires: store.tobaccoPermit?.expiresOn ?? '',
    note: '',
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const guardar = () => {
    setError(null);
    if (!result) return setError('Elige qué pasó en la visita.');
    void run(async () => {
      await anotarVisitaProspecto(ctx, store.id, { result, ...f });
      onClose();
    }, `Visita a ${store.name} anotada.`);
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Visita a ${store.name}`}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          guardar();
        }}
      >
        <fieldset className="grid gap-2">
          <legend className="field-label mb-1.5">¿Qué pasó?</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="¿Qué pasó?">
            {RESULT_ORDER.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={result === r} className={`btn ${result === r ? 'btn-primary' : 'btn-secondary'} justify-start`} onClick={() => setResult(r)}>
                {PROSPECT_RESULT_LABEL[r]}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="text-sm text-muted">Lo que te dio el local. Lo que dejes vacío no borra lo que ya estaba anotado.</p>
        <TextInput label="Nombre del encargado" value={f.managerName} onChange={(e) => set('managerName', e.target.value)} autoComplete="off" />
        <TextInput label="Teléfono" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(713) 555-0123" />
        <TextInput label="Correo" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="opcional" />
        <TextInput label="Horario" value={f.hours} onChange={(e) => set('hours', e.target.value)} placeholder="Lun–Sáb 10:00–20:00" />
        {config.requiresTobaccoPermit ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Número del permiso de tabaco" value={f.permitNumber} onChange={(e) => set('permitNumber', e.target.value)} hint="Pídeselo al encargado o búscalo en el local." />
            <TextInput label="El permiso vence el" type="date" value={f.permitExpires} onChange={(e) => set('permitExpires', e.target.value)} />
          </div>
        ) : null}
        <TextArea label="Nota" value={f.note} onChange={(e) => set('note', e.target.value)} rows={3} maxLength={300} placeholder="Qué marcas vende, qué le interesó, qué preguntó, cuándo volver…" />
        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" big icon={ClipboardPen} busy={busy}>
          Guardar visita
        </Button>
      </form>
    </Sheet>
  );
}
