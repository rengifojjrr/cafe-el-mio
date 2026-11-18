// «Precios de este local»: el vendedor del local (o Administración) le pone a cada producto lo que le
// cobra a ESE local, nunca menos que el precio base. Sin precio propio, el local paga el base. Con la
// comisión por diferencia, el vendedor gana lo que cobre por encima del base. La cuenta del local
// nunca ve esta tarjeta (ni el precio base).
import { Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import type { Store } from '../../data/types';
import { normalize, unitNames } from '../../domain/products';
import { fmtMoney, round2 } from '../../lib/money';
import { type PrecioDelLocalFila, type PreciosDelLocal, guardarPreciosDelLocal, preciosDelLocal } from '../../services/stores';
import { Button, Card, ErrorBox, NumberInput, Sheet, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';

export function PreciosDelLocalCard({ store, canEdit }: { store: Store; canEdit: boolean }) {
  const { ctx, actor } = useLine();
  const [open, setOpen] = useState(false);
  const data = useAsync(() => preciosDelLocal(ctx, store.id), [ctx, store.id]);
  if (data.error) return <ErrorBox error={data.error} />;
  const d = data.data;
  const propios = (d?.filas ?? []).filter((f) => f.precio !== undefined);
  const yo = actor.role === 'seller';
  return (
    <Card as="section" className="p-4 sm:p-5" aria-label="Precios de este local">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="flex items-center gap-2 font-bold">
            <Tags className="h-5 w-5 text-accent" aria-hidden /> Precios de este local
          </h2>
          <p className="mt-1 text-sm text-muted">
            {propios.length
              ? `${propios.length === 1 ? '1 producto tiene' : `${propios.length} productos tienen`} precio propio; el resto, al precio base.`
              : 'Paga el precio base de cada producto.'}
            {d?.diferencia ? ` ${yo ? 'Ganas' : `${d.vendedor ?? 'Su vendedor'} gana`} lo que se le cobre por encima del precio base.` : ''}
          </p>
        </div>
        {canEdit && d ? (
          <Button icon={Tags} onClick={() => setOpen(true)}>
            {propios.length ? 'Cambiar precios' : 'Ponerle precios'}
          </Button>
        ) : null}
      </div>
      {propios.length ? (
        <ul className="mt-3 grid gap-1.5 text-sm" aria-label="Precios propios">
          {propios.slice(0, 6).map((f) => (
            <li key={f.productId} className="flex flex-wrap justify-between gap-x-3 rounded-xl bg-surface-2 px-3 py-2">
              <span className="min-w-0 font-semibold text-ink">{f.name}</span>
              <span className="tabular">
                {fmtMoney(f.precio!)} <span className="text-muted">· base {fmtMoney(f.base)} · +{fmtMoney(round2(f.precio! - f.base))}</span>
              </span>
            </li>
          ))}
          {propios.length > 6 ? <li className="px-3 text-muted">y {propios.length - 6} más</li> : null}
        </ul>
      ) : null}
      {d && open ? <PreciosSheet store={store} data={d} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

type Borrador = Record<string, number | ''>;

function PreciosSheet({ store, data, onClose }: { store: Store; data: PreciosDelLocal; onClose: () => void }) {
  const { ctx, actor } = useLine();
  const { run, busy } = useAction();
  const inicial = useMemo<Borrador>(() => Object.fromEntries(data.filas.map((f) => [f.productId, f.precio ?? ''])), [data]);
  const [borrador, setBorrador] = useState<Borrador>(inicial);
  const [q, setQ] = useState('');
  const term = normalize(q);
  const filas = term ? data.filas.filter((f) => normalize(f.name).includes(term)) : data.filas;
  const errores = data.filas.filter((f) => {
    const v = borrador[f.productId];
    return v !== '' && v !== undefined && v < f.base;
  });
  const cambios: Record<string, number | null> = {};
  for (const f of data.filas) {
    const v = borrador[f.productId] ?? '';
    if (v === (inicial[f.productId] ?? '')) continue;
    cambios[f.productId] = v === '' ? null : round2(v);
  }
  const n = Object.keys(cambios).length;
  const consignacion = store.saleMode !== 'firme';
  const yo = actor.role === 'seller';

  return (
    <Sheet open onClose={onClose} title={`Precios de ${store.name}`} wide>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!n || errores.length) return;
          void run(async () => {
            const r = await guardarPreciosDelLocal(ctx, store.id, cambios);
            onClose();
            return r;
          }, n === 1 ? 'Precio guardado.' : `${n} precios guardados.`);
        }}
      >
        <div className="grid gap-1 text-sm text-muted">
          <p className="text-ink">Lo que le cobras a este local, producto por producto. Nunca menos que el precio base; vacío, paga el base.</p>
          {data.diferencia ? <p>{yo ? 'Tu ganancia' : `La ganancia de ${data.vendedor ?? 'su vendedor'}`} es la diferencia: lo que cobre por encima del base.</p> : null}
          {consignacion ? <p>Lo que ya tiene en consignación se cobra al precio con que se le dejó; el precio nuevo vale para lo que se le deje después.</p> : null}
        </div>
        {data.contratoFirmado ? (
          <p className="rounded-xl border border-warn bg-warn-soft px-3 py-2 text-sm text-ink" data-testid="aviso-contrato-precios">
            Su contrato firmado tiene los precios de cuando firmó. Si los cambias, prepara una nueva versión del contrato (desde su ficha) para que firme los nuevos.
          </p>
        ) : null}
        {data.filas.length > 8 ? <TextInput label="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, vitola, capa…" /> : null}
        <ul className="grid gap-2" aria-label="Productos y precios">
          {filas.map((f) => (
            <FilaPrecio
              key={f.productId}
              f={f}
              value={borrador[f.productId] ?? ''}
              onValue={(v) => setBorrador((b) => ({ ...b, [f.productId]: v }))}
              ganancia={data.diferencia ? (yo ? 'Ganas' : `${data.vendedor ?? 'Su vendedor'} gana`) : undefined}
            />
          ))}
          {filas.length === 0 ? <li className="text-muted">Ningún producto se llama así.</li> : null}
        </ul>
        <div className="sticky -bottom-5 -mx-5 -mb-5 grid gap-2 border-t border-line bg-surface px-5 pt-3 pb-5">
          {errores.length ? (
            <p className="text-sm font-semibold text-danger" role="alert">
              {errores.length === 1 ? `${errores[0]!.name}: el precio no puede ser menor que el base.` : `${errores.length} precios son menores que el base.`}
            </p>
          ) : null}
          <Button type="submit" variant="primary" big busy={busy} disabled={!n || errores.length > 0}>
            {n ? `Guardar ${n === 1 ? '1 precio' : `${n} precios`}` : 'Guardar precios'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function FilaPrecio({ f, value, onValue, ganancia }: { f: PrecioDelLocalFila; value: number | ''; onValue: (v: number | '') => void; ganancia?: string }) {
  const unit = unitNames(f.unitName).one;
  const bajo = value !== '' && value < f.base;
  const extra = value !== '' && !bajo ? round2(value - f.base) : 0;
  // No se prohíbe (el vendedor pone el precio que quiera), pero se avisa: al PVP, el local perdería.
  const sobrePvp = value !== '' && f.pvp > 0 && value > f.pvp;
  return (
    <li className="flex items-end justify-between gap-3 rounded-2xl border border-line p-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{f.name}</p>
        <p className="text-sm text-muted">
          Base {fmtMoney(f.base)} por {unit}
        </p>
        <p className={`mt-0.5 text-sm ${bajo ? 'font-semibold text-danger' : extra > 0 ? 'font-semibold text-ok' : 'text-muted'}`} aria-live="polite">
          {bajo ? `Menor que el base (${fmtMoney(f.base)})` : value === '' ? 'Paga el base' : extra > 0 ? `${ganancia ? `${ganancia} ` : 'Diferencia: +'}${fmtMoney(extra)} por ${unit}` : 'Igual al base'}
        </p>
        {sobrePvp ? <p className="mt-0.5 text-sm font-semibold text-warn">Más que el PVP sugerido ({fmtMoney(f.pvp)}): el local pierde si lo vende a ese precio.</p> : null}
      </div>
      <div className="w-28 flex-none">
        <NumberInput
          label="Precio"
          aria-label={`Precio de ${f.name}`}
          aria-invalid={bajo || undefined}
          step={0.01}
          min={f.base}
          placeholder={f.base.toFixed(2)}
          value={value}
          onValue={onValue}
        />
      </div>
    </li>
  );
}
