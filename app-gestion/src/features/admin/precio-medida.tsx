// Ajustes → «Precio por mazo»: la regla de precio por medida de los tabacos de mazo (un precio para
// todas y otro para las medidas anotadas aparte). Guardar la regla no cambia ningún producto: eso lo
// hace «Aplicar a los productos de mazo», con la vista previa de qué cambia y «Deshacer».
import { Ruler, Undo2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { leerMedidas, medidaTexto } from '../../domain/precio-medida';
import { fmtMoney } from '../../lib/money';
import { fmtDateTime } from '../../lib/time';
import { aplicarReglaPrecio, deshacerAjustePrecio, guardarReglaPrecio, leerReglaPrecio, vistaPreviaRegla } from '../../services/precio-medida';
import { Button, Card, ErrorBox, Loading, NumberInput, Section, Sheet, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';

export function ReglaPrecioSettings() {
  const { ctx } = useLine();
  const data = useAsync(() => leerReglaPrecio(ctx), [ctx]);
  if (data.error) return <ErrorBox error={data.error} />;
  if (!data.data) return <Loading rows={2} />;
  // La clave hace que el formulario se arme de nuevo con la regla guardada.
  return <ReglaForm key={JSON.stringify(data.data.regla)} vista={data.data} />;
}

function ReglaForm({ vista }: { vista: Awaited<ReturnType<typeof leerReglaPrecio>> }) {
  const { ctx, actor } = useLine();
  const { run, busy } = useAction();
  const r = vista.regla;
  const [precio, setPrecio] = useState<number | ''>(r?.precio ?? '');
  const [medidas, setMedidas] = useState(r?.especiales[0]?.medidas.map(medidaTexto).join(', ') ?? '');
  const [precioMedidas, setPrecioMedidas] = useState<number | ''>(r?.especiales[0]?.precio ?? '');
  const [preview, setPreview] = useState(false);
  const leidas = leerMedidas(medidas);
  const ultimo = vista.ultimo;
  return (
    <Section title="Precio por mazo (tabaco de mazo)">
      <Card className="grid gap-4 p-5" aria-label="Regla de precio por medida">
        <p className="text-sm text-muted">
          El precio base por mazo de un tabaco de mazo sale de su medida. Al crear o editar uno, el precio se llena con esta regla (se puede cambiar a mano en ese producto, y lo puesto a mano manda).
          Guardar la regla no cambia los productos ya guardados.
        </p>
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
          <NumberInput label="Precio por mazo (USD)" value={precio} onValue={setPrecio} min={0} step={0.01} hint="Para todas las medidas que no van aparte." disabled={actor.readOnly} />
          <TextInput
            label="Medidas que van aparte"
            value={medidas}
            onChange={(e) => setMedidas(e.target.value)}
            placeholder="6½ × 64, 7 × 70"
            hint={medidas.trim() ? (leidas.length ? `Entiendo: ${leidas.map(medidaTexto).join(' · ')}` : 'No entiendo esas medidas: largo × cepo, por ejemplo «7 × 70».') : 'Largo × cepo, separadas por coma. Vacío: un solo precio.'}
            disabled={actor.readOnly}
            autoComplete="off"
          />
          <NumberInput label="Precio de esas medidas (USD)" value={precioMedidas} onValue={setPrecioMedidas} min={0} step={0.01} disabled={actor.readOnly || !medidas.trim()} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={Ruler}
            busy={busy}
            disabled={actor.readOnly}
            onClick={() =>
              void run(
                () =>
                  guardarReglaPrecio(ctx, {
                    precio: precio === '' ? Number.NaN : precio,
                    medidas,
                    precioMedidas: medidas.trim() && precioMedidas !== '' ? precioMedidas : undefined,
                  }),
                'Regla de precio guardada.',
              )
            }
          >
            Guardar regla
          </Button>
          {r ? (
            <Button icon={Wand2} disabled={actor.readOnly} onClick={() => setPreview(true)}>
              Aplicar a los productos de mazo
            </Button>
          ) : null}
        </div>
        {ultimo?.cambios.length ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 p-3 text-sm" data-testid="ultimo-ajuste-precio">
            <span>
              Último ajuste: {ultimo.cambios.length} {ultimo.cambios.length === 1 ? 'precio cambiado' : 'precios cambiados'} el {fmtDateTime(ultimo.at)}.
            </span>
            <Button
              variant="ghost"
              icon={Undo2}
              busy={busy}
              disabled={actor.readOnly}
              onClick={() =>
                void run(
                  () => deshacerAjustePrecio(ctx),
                  (x) => (x.cambiadosDespues ? `Deshecho: ${x.vueltos} vuelven a su precio; ${x.cambiadosDespues} se cambiaron después y quedan como están.` : `Deshecho: ${x.vueltos} vuelven a su precio.`),
                )
              }
            >
              Deshacer
            </Button>
          </div>
        ) : null}
      </Card>
      {preview ? <AplicarSheet onClose={() => setPreview(false)} /> : null}
    </Section>
  );
}

/** Vista previa de qué cambia; se aplica a los marcados. */
function AplicarSheet({ onClose }: { onClose: () => void }) {
  const { ctx, actor } = useLine();
  const { run, busy } = useAction();
  const data = useAsync(() => vistaPreviaRegla(ctx), [ctx]);
  const [fuera, setFuera] = useState<Set<string>>(new Set());
  const d = data.data;
  const elegidos = (d?.cambios ?? []).filter((c) => !fuera.has(c.productId));
  return (
    <Sheet open onClose={onClose} title="Aplicar a los productos de mazo" wide>
      {data.error ? <ErrorBox error={data.error} /> : null}
      {!d ? (
        <Loading rows={3} />
      ) : d.cambios.length === 0 ? (
        <p className="text-muted">
          Todos los productos de mazo ya tienen el precio de la regla{d.aMano ? ` (${d.aMano} con el precio a mano no se tocan)` : ''}. No hay nada que cambiar.
        </p>
      ) : (
        <div className="grid gap-4">
          <p className="text-muted">
            Esto cambia el precio base de {d.cambios.length} {d.cambios.length === 1 ? 'producto' : 'productos'} de mazo. Desmarca los que no quieras cambiar.
            {d.aMano ? ` ${d.aMano} con el precio puesto a mano no se tocan.` : ''} Después se puede deshacer.
          </p>
          <ul className="grid gap-2" aria-label="Precios que cambian">
            {d.cambios.map((c) => (
              <li key={c.productId}>
                <label className="flex items-center gap-3 rounded-2xl border border-line p-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5 flex-none"
                    checked={!fuera.has(c.productId)}
                    onChange={(e) =>
                      setFuera((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.delete(c.productId);
                        else n.add(c.productId);
                        return n;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{c.name}</span>
                    <span className="block text-sm text-muted">{c.medida}</span>
                  </span>
                  <span className="tabular flex-none text-right">
                    <span className="block text-sm text-muted line-through">{fmtMoney(c.antes)}</span>
                    <span className="block font-bold text-ink">{fmtMoney(c.despues)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Button
            variant="primary"
            big
            icon={Wand2}
            busy={busy}
            disabled={actor.readOnly || elegidos.length === 0}
            onClick={() =>
              void run(
                async () => {
                  const n = await aplicarReglaPrecio(
                    ctx,
                    elegidos.map((c) => c.productId),
                  );
                  onClose();
                  return n;
                },
                (n) => `Listo: ${n} ${n === 1 ? 'precio cambiado' : 'precios cambiados'}. Se puede deshacer en Ajustes.`,
              )
            }
          >
            Cambiar {elegidos.length} {elegidos.length === 1 ? 'precio' : 'precios'}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
