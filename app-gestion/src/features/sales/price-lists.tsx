// Ajustes → «Listas de precios»: «Público (PVP)», «Local», «Mayorista» y las que se creen. Por producto,
// precio escrito o % sobre el costo, por unidad y por caja, y precio «desde N cajas». Lo que no está en
// la lista sale del % de toda la lista o, si no hay, del precio al local del producto.
import { Pencil, Plus, Save, Tags, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import type { PriceEntry, PriceList, Product } from '../../data/types';
import { PRICE_LIST_KIND_LABEL, PRICE_SOURCE_LABEL, priceFor } from '../../domain/pricing';
import { unitOf } from '../../domain/products';
import { fmtMoney, fmtPercent } from '../../lib/money';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { readSettings } from '../../services/admin';
import { type PriceListView, type PriceRow, listPriceLists, priceListRows, saveFirmSettings, savePriceList, setPriceEntry } from '../../services/prices';
import { Button, Card, EmptyState, ErrorBox, LinkButton, Loading, NumberInput, PageHeader, Pill, Section, SelectInput, Sheet, Tabs, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';
import { RoleGate } from '../common';

export function PriceListsPage() {
  return (
    <RoleGate roles={['admin']} message="Las listas de precios las ve y las cambia administración (llevan los costos).">
      <PriceLists />
    </RoleGate>
  );
}

const num = (v: number | '') => (v === '' ? undefined : v);

function PriceLists() {
  const { ctx, p, actor } = useLine();
  const lists = useAsync(() => listPriceLists(ctx), [ctx]);
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<PriceListView | 'new' | null>(null);
  const current = lists.data?.find((l) => l.id === picked) ?? lists.data?.find((l) => l.isDefault) ?? lists.data?.[0];
  if (lists.error) return <ErrorBox error={lists.error} />;
  return (
    <>
      <PageHeader
        back={{ to: p('ajustes'), label: 'Ajustes' }}
        title="Listas de precios"
        subtitle="Lo que paga cada local por producto cuando compra en firme: precio escrito o % sobre el costo, por unidad y por caja, y desde N cajas."
        actions={
          actor.readOnly ? null : (
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              Nueva lista
            </Button>
          )
        }
      />
      {lists.loading && !lists.data ? <Loading rows={3} /> : null}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(lists.data ?? []).map((l) => (
          <li key={l.id}>
            <div className={`glass grid h-full gap-2 p-4 ${current?.id === l.id ? 'border-accent' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-ink">{l.name}</span>
                {l.isDefault ? <Pill tone="accent">De la línea</Pill> : null}
                {!l.active ? <Pill>Inactiva</Pill> : null}
              </div>
              <p className="text-sm text-muted">
                {PRICE_LIST_KIND_LABEL[l.kind]} · {l.entriesCount} precio{l.entriesCount === 1 ? '' : 's'} propios · {l.stores} local{l.stores === 1 ? '' : 'es'}
              </p>
              <p className="text-sm text-muted">
                Lo demás: {l.defaultMarkupPercent !== undefined ? `${l.defaultMarkupPercent} % sobre el costo` : l.kind === 'pvp' ? 'el PVP del producto' : 'el precio al local del producto'}
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                <Button variant={current?.id === l.id ? 'primary' : 'secondary'} icon={Tags} onClick={() => setPicked(l.id)} aria-pressed={current?.id === l.id}>
                  Ver precios
                </Button>
                {actor.readOnly ? null : (
                  <Button variant="ghost" icon={Pencil} onClick={() => setEditing(l)}>
                    Editar
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {current ? <ListPrices list={current} /> : lists.data ? <EmptyState icon={Tags} title="Todavía no hay listas de precios" /> : null}
      <ListSheet editing={editing} onClose={() => setEditing(null)} onSaved={(l) => setPicked(l.id)} />
    </>
  );
}

function ListSheet({ editing, onClose, onSaved }: { editing: PriceListView | 'new' | null; onClose: () => void; onSaved: (l: PriceList) => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const list = editing && editing !== 'new' ? editing : null;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PriceList['kind']>('otra');
  const [markup, setMarkup] = useState<number | ''>('');
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (!editing) return;
    setName(list?.name ?? '');
    setKind(list?.kind ?? 'otra');
    setMarkup(list?.defaultMarkupPercent ?? '');
    setActive(list?.active ?? true);
  }, [editing, list]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const saved = await run(() => savePriceList(ctx, { id: list?.id, name, kind, defaultMarkupPercent: num(markup), active }), list ? 'Lista guardada.' : 'Lista creada.');
    if (saved) {
      onSaved(saved);
      onClose();
    }
  };
  return (
    <Sheet open={editing !== null} onClose={onClose} title={list ? `Lista ${list.name}` : 'Nueva lista de precios'}>
      <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
        <TextInput label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mayorista Doral" required />
        <SelectInput
          label="Tipo"
          value={kind}
          onChange={(e) => setKind(e.target.value as PriceList['kind'])}
          options={(Object.keys(PRICE_LIST_KIND_LABEL) as PriceList['kind'][]).map((k) => ({ value: k, label: PRICE_LIST_KIND_LABEL[k] }))}
        />
        <NumberInput
          label="% sobre el costo para lo que no tenga precio (opcional)"
          value={markup}
          onValue={setMarkup}
          min={0}
          step={0.5}
          hint="Vacío: lo que no está en la lista va al precio al local del producto (o al PVP, en la lista de PVP)."
        />
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Lista activa (se puede asignar a los locales)
        </label>
        <Button type="submit" variant="primary" icon={Save} busy={busy}>
          Guardar lista
        </Button>
      </form>
    </Sheet>
  );
}

function ListPrices({ list }: { list: PriceListView }) {
  const { ctx, actor } = useLine();
  const rows = useAsync(() => priceListRows(ctx, list.id), [ctx, list.id, list.updatedAt]);
  const [editing, setEditing] = useState<PriceRow | null>(null);
  return (
    <Section title={`Precios de «${list.name}»`}>
      {rows.error ? <ErrorBox error={rows.error} /> : null}
      {rows.loading && !rows.data ? <Loading rows={3} /> : null}
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {(rows.data ?? []).map((r) => {
          const unit = unitOf(r.product).one;
          return (
            <li key={r.product.id} className="glass grid grid-cols-[minmax(0,1fr)] gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="font-semibold">{r.product.name}</p>
                <p className="text-sm text-muted">
                  <b className="text-ink tabular">{fmtMoney(r.unit)}</b> por {unit} · <b className="text-ink tabular">{fmtMoney(r.box)}</b> la caja
                  {r.entry?.volume ? ` · desde ${r.entry.volume.minBoxes} cajas, ${fmtMoney(r.entry.volume.box)}` : ''}
                </p>
                <p className={`text-xs ${r.unit < r.product.cost ? 'text-danger' : 'text-muted'}`}>
                  {PRICE_SOURCE_LABEL[r.source]}
                  {r.entry?.mode === 'markup' && r.entry.markupPercent !== undefined ? ` (${r.entry.markupPercent} %)` : ''} · costo {fmtMoney(r.product.cost)} · margen {fmtPercent(r.margin)}
                  {r.unit < r.product.cost ? ' · ¡por debajo del costo!' : ''}
                </p>
              </div>
              {actor.readOnly ? null : (
                <Button icon={Pencil} onClick={() => setEditing(r)} aria-label={`Cambiar el precio de ${r.product.name}`}>
                  Cambiar
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <EntrySheet list={list} row={editing} onClose={() => setEditing(null)} />
    </Section>
  );
}

function EntrySheet({ list, row, onClose }: { list: PriceListView; row: PriceRow | null; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [mode, setMode] = useState<PriceEntry['mode']>('fixed');
  const [unitPrice, setUnitPrice] = useState<number | ''>('');
  const [box, setBox] = useState<number | ''>('');
  const [markup, setMarkup] = useState<number | ''>('');
  const [minBoxes, setMinBoxes] = useState<number | ''>('');
  const [volBox, setVolBox] = useState<number | ''>('');
  useEffect(() => {
    if (!row) return;
    const e = row.entry;
    setMode(e?.mode ?? 'fixed');
    setUnitPrice(e?.unit ?? (e ? '' : row.unit));
    setBox(e?.box ?? '');
    setMarkup(e?.markupPercent ?? list.defaultMarkupPercent ?? '');
    setMinBoxes(e?.volume?.minBoxes ?? '');
    setVolBox(e?.volume?.box ?? '');
  }, [row, list.defaultMarkupPercent]);
  if (!row) return null;
  const p: Product = row.product;
  const unit = unitOf(p).one;
  const draft: PriceEntry = {
    mode,
    unit: mode === 'fixed' ? num(unitPrice) : undefined,
    box: num(box),
    markupPercent: mode === 'markup' ? num(markup) : undefined,
    volume: minBoxes !== '' && volBox !== '' ? { minBoxes, box: volBox } : undefined,
  };
  const preview = priceFor(p, { kind: list.kind, defaultMarkupPercent: list.defaultMarkupPercent, entries: { [p.id]: draft } });
  return (
    <Sheet open onClose={onClose} title={p.name}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await setPriceEntry(ctx, list.id, p.id, draft);
            onClose();
          }, `Precio guardado en ${list.name}.`);
        }}
      >
        <p className="text-sm text-muted">
          Costo {fmtMoney(p.cost)} por {unit} · precio al local {fmtMoney(p.priceToStore)} · caja de {p.packSize}.
        </p>
        <Tabs<PriceEntry['mode']>
          label="Cómo se pone el precio"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'fixed', label: 'Precio escrito' },
            { value: 'markup', label: '% sobre el costo' },
          ]}
        />
        {mode === 'fixed' ? (
          <NumberInput label={`Precio por ${unit} (USD)`} value={unitPrice} onValue={setUnitPrice} min={0.01} step={0.01} />
        ) : (
          <NumberInput label="% sobre el costo" value={markup} onValue={setMarkup} min={0} step={0.5} hint="Se redondea a centavos." />
        )}
        <NumberInput label="Precio por caja (opcional)" value={box} onValue={setBox} min={0.01} step={0.01} hint={`Vacío: ${unit} × ${p.packSize}.`} />
        <div className="grid grid-cols-2 gap-3">
          <NumberInput label="Desde (cajas)" value={minBoxes} onValue={setMinBoxes} min={2} step={1} hint="Opcional" />
          <NumberInput label="Precio por caja" value={volBox} onValue={setVolBox} min={0.01} step={0.01} />
        </div>
        <p className="rounded-2xl bg-surface-2 p-3 text-sm">
          Queda: <b className="tabular">{fmtMoney(preview.unit)}</b> por {unit} · <b className="tabular">{fmtMoney(preview.box)}</b> la caja
          {preview.unit < p.cost ? <span className="text-danger"> · por debajo del costo</span> : null}
        </p>
        <Button type="submit" variant="primary" icon={Save} busy={busy}>
          Guardar precio
        </Button>
        {row.entry ? (
          <Button
            variant="ghost"
            icon={Trash2}
            busy={busy}
            onClick={() =>
              void run(async () => {
                await setPriceEntry(ctx, list.id, p.id, null);
                onClose();
              }, 'Vuelve al precio de toda la lista.')
            }
          >
            Quitar de la lista
          </Button>
        ) : null}
      </form>
    </Sheet>
  );
}

/** Ajustes: impuesto de venta y lista de los locales sin lista propia (va fuera del formulario de Ajustes). */
export function FirmSalesSettings() {
  const { ctx, p, actor } = useLine();
  const { run, busy } = useAction();
  const settings = useAsync(() => readSettings(ctx), [ctx]);
  const lists = useAsync(() => listPriceLists(ctx), [ctx]);
  const [tax, setTax] = useState<number | ''>('');
  const [listId, setListId] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    setTax(settings.data.salesTaxPercent ?? '');
    setListId(settings.data.defaultPriceListId ?? '');
  }, [settings.data]);
  if (!settings.data || !lists.data) return null;
  return (
    <Section title="Venta en firme y precios" actions={<LinkButton to={p('ajustes/precios')} icon={Tags}>Listas de precios</LinkButton>}>
      <Card className="p-5">
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => saveFirmSettings(ctx, { salesTaxPercent: num(tax), defaultPriceListId: listId || undefined }), 'Ajustes de la venta en firme guardados.');
          }}
        >
          <NumberInput
            label="Impuesto de venta (%)"
            value={tax}
            onValue={setTax}
            min={0}
            max={20}
            step={0.25}
            hint="Vacío o 0: no se calcula. Con un %, va solo en las facturas de locales sin certificado de reventa vigente."
          />
          <SelectInput
            label="Lista de los locales sin lista propia"
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            options={[{ value: '', label: 'La «Local»' }, ...lists.data.filter((l) => l.active).map((l) => ({ value: l.id, label: l.name }))]}
          />
          <div className="md:col-span-2">
            <Button type="submit" variant="primary" icon={Save} busy={busy} disabled={actor.readOnly}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}
