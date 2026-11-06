// Mercados (Ajustes) y el filtro «Mercado» del mapa, Rentabilidad y Dirección. También el costo por
// km de los repartos (Ajustes).
import { MapPin, Plus, Save, Trash2, Truck } from 'lucide-react';
import { useState } from 'react';
import { useLine } from '../../app/line-context';
import type { Market } from '../../data/types';
import { saveMarkets } from '../../services/markets';
import { saveRouteCostPerKm } from '../../services/routes';
import { DEFAULT_COST_PER_KM } from '../../domain/routes';
import { Button, Card, NumberInput, Section, SelectInput, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';

/** Select «Mercado» (solo si la línea tiene más de uno). '' es «Todos». */
export function MarketSelect({ markets, value, onChange, all = true, label = 'Mercado' }: { markets: readonly Market[]; value: string; onChange: (id: string) => void; all?: boolean; label?: string }) {
  if (markets.length < 2) return null;
  return (
    <SelectInput
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={[...(all ? [{ value: '', label: 'Todos' }] : []), ...markets.map((m) => ({ value: m.id, label: m.name }))]}
    />
  );
}

type Row = { id?: string; name: string; lat: number | ''; lng: number | ''; zoom: number | '' };

/** Ajustes: la lista de mercados. El primero es el de siempre. */
export function MarketsSettings({ markets }: { markets: Market[] }) {
  const { ctx, actor } = useLine();
  const { run, busy } = useAction();
  const [rows, setRows] = useState<Row[]>(markets.map((m) => ({ ...m })));
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const n = (v: number | '') => (v === '' ? Number.NaN : v);
  return (
    <Section title="Mercados">
      <Card className="grid grid-cols-[minmax(0,1fr)] gap-4 p-5">
        <p className="max-w-[70ch] text-sm text-muted">
          Cada mercado agrupa sus zonas, locales y vendedores, y el mapa se centra en él. El primero es el de siempre: lo que no dice su mercado es de él. No se puede quitar un mercado que todavía tiene zonas, locales o vendedores.
        </p>
        <fieldset disabled={actor.readOnly} className="m-0 grid min-w-0 gap-3 border-0 p-0">
          <ul className="grid grid-cols-1 gap-3">
            {rows.map((r, i) => (
              <li key={r.id ?? `nuevo-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-xl border border-line p-3">
                <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="col-span-2 sm:col-span-1">
                    <TextInput label="Nombre" value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Houston" />
                  </div>
                  <NumberInput label="Latitud" value={r.lat} onValue={(v) => set(i, { lat: v })} step={0.01} />
                  <NumberInput label="Longitud" value={r.lng} onValue={(v) => set(i, { lng: v })} step={0.01} />
                  <NumberInput label="Acercamiento" value={r.zoom} onValue={(v) => set(i, { zoom: v })} min={4} max={14} step={1} />
                </div>
                <Button variant="ghost" icon={Trash2} disabled={rows.length < 2} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Quitar ${r.name || 'mercado'}`} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button icon={Plus} onClick={() => setRows((rs) => [...rs, { name: '', lat: rs[0]?.lat ?? '', lng: rs[0]?.lng ?? '', zoom: 10 }])}>
              Agregar mercado
            </Button>
            <Button
              variant="primary"
              icon={Save}
              busy={busy}
              onClick={() =>
                void run(async () => {
                  const saved = await saveMarkets(
                    ctx,
                    rows.map((r) => ({ id: r.id, name: r.name, lat: n(r.lat), lng: n(r.lng), zoom: r.zoom === '' ? 10 : r.zoom })),
                  );
                  setRows(saved.map((m) => ({ ...m })));
                }, 'Mercados guardados.')
              }
            >
              Guardar mercados
            </Button>
          </div>
        </fieldset>
        <p className="flex items-start gap-2 text-sm text-muted">
          <MapPin className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
          El centro se puede copiar de cualquier mapa (latitud y longitud). Las zonas, los locales y los vendedores se asignan a su mercado en Usuarios y en la ficha de cada local.
        </p>
      </Card>
    </Section>
  );
}

/** Ajustes: costo por km que se propone en los repartos nuevos. */
export function RouteCostSettings({ value }: { value?: number }) {
  const { ctx, actor } = useLine();
  const { run, busy } = useAction();
  const [v, setV] = useState<number | ''>(value ?? DEFAULT_COST_PER_KM);
  return (
    <Section title="Repartos">
      <Card className="grid grid-cols-1 items-end gap-4 p-5 sm:grid-cols-2">
        <NumberInput label="Costo por kilómetro (USD)" value={v} onValue={setV} min={0} max={20} step={0.05} hint="Combustible y desgaste del camión. Cada reparto lo puede cambiar." disabled={actor.readOnly} />
        <Button icon={Truck} busy={busy} disabled={actor.readOnly} onClick={() => void run(() => saveRouteCostPerKm(ctx, v === '' ? Number.NaN : v), 'Costo por km guardado.')}>
          Guardar costo por km
        </Button>
      </Card>
    </Section>
  );
}
