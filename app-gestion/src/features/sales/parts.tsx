// Piezas de la venta rápida y de los pedidos por teléfono o pegados: elegir el cliente (un local, los
// recientes primero; una persona, sin duplicarla; o el almacén, la venta de mostrador) y la cantidad
// en su presentación (mazos, tabacos o unidades, o cajas).
import { Search, Store as StoreIcon, UserPlus, UserRound, Warehouse } from 'lucide-react';
import { useState } from 'react';
import type { Product, SalePack, Store } from '../../data/types';
import { type ClaseCliente, CLASE_LABEL, claseDe, claveNombre } from '../../domain/clientes';
import { creditText } from '../../domain/invoices';
import { normalize, unitNames } from '../../domain/products';
import { fmtDate } from '../../lib/time';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { asegurarMostrador, buscarPersonas, crearPersona, verCliente } from '../../services/clientes';
import type { QuickStore } from '../../services/invoices';
import { Button, QtyStepper, Tabs, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';

/** Los locales como fichas grandes: los recientes y frecuentes primero; buscar si no está. */
export function StorePicker({ stores, onPick, top = 6 }: { stores: readonly QuickStore[]; onPick: (s: QuickStore) => void; top?: number }) {
  const [q, setQ] = useState('');
  const term = normalize(q);
  const shown = term ? stores.filter((x) => normalize(`${x.store.name} ${x.store.city} ${x.store.managerName}`).includes(term)) : stores.slice(0, top);
  return (
    <div className="grid gap-3">
      <label className="relative block">
        <span className="sr-only">Buscar local</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
        <input className="input pl-10" placeholder="Buscar local, ciudad o encargado" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {shown.length === 0 ? <p className="text-muted">Ningún local coincide.</p> : null}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Locales">
        {shown.map((x) => (
          <li key={x.store.id}>
            <button
              type="button"
              data-store={x.store.id}
              className="glass flex min-h-14 w-full items-center gap-3 p-3 text-left hover:border-accent disabled:opacity-55"
              disabled={Boolean(x.blocked)}
              onClick={() => onPick(x)}
            >
              <StoreIcon className="h-5 w-5 flex-none text-accent" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate font-semibold text-ink">{x.store.name}</span>
                <span className={`block text-sm ${x.blocked ? 'text-danger' : 'text-muted'}`}>{x.blocked ?? x.terms}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!term && stores.length > top ? <p className="text-sm text-muted">Busca para ver los otros {stores.length - top} locales.</p> : null}
    </div>
  );
}

/** El cliente elegido (local, persona o almacén), con «Cambiar». */
export function PickedStore({ store, detail, onChange }: { store: QuickStore; detail?: string; onChange: () => void }) {
  const clase = claseDe(store.store);
  const Icon = clase === 'persona' ? UserRound : clase === 'almacen' ? Warehouse : StoreIcon;
  const extra = clase === 'persona' ? [CLASE_LABEL.persona, store.store.phone].filter(Boolean).join(' · ') : clase === 'almacen' ? 'Venta de mostrador' : store.terms;
  return (
    <div className="glass flex flex-wrap items-center justify-between gap-3 p-3" data-cliente={clase}>
      <span className="flex min-w-0 items-center gap-3">
        <Icon className="h-5 w-5 flex-none text-accent" aria-hidden />
        <span className="min-w-0">
          <span className="block font-bold text-ink">{store.store.name}</span>
          <span className="block text-sm text-muted">
            {extra}
            {detail ? ` · ${detail}` : ''}
          </span>
        </span>
      </span>
      <Button variant="ghost" onClick={onChange}>
        {clase === 'local' ? 'Cambiar local' : 'Cambiar cliente'}
      </Button>
    </div>
  );
}

/** Un cliente que no es local, con la misma forma que los locales de la lista. */
export function clienteRapido(store: Store): QuickStore {
  return { store, terms: creditText(store), count: 0 };
}

/**
 * ¿Quién compra? Un selector simple arriba: «Local · Persona · Almacén». Local: los de siempre.
 * Persona: el nombre (y el teléfono, si quiere); mientras se escribe sugiere las que ya compraron y,
 * si no está, «Crear “Ana Pérez”» en un toque. Almacén: la venta de mostrador, de una.
 */
export function ClientePicker({ stores, onPick, clase, onClase }: { stores: readonly QuickStore[]; onPick: (s: QuickStore) => void; clase: ClaseCliente; onClase: (c: ClaseCliente) => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const elegir = (c: ClaseCliente) => {
    onClase(c);
    if (c === 'almacen') void run(async () => onPick(clienteRapido(await asegurarMostrador(ctx))));
  };
  return (
    <div className="grid gap-3">
      <Tabs<ClaseCliente>
        label="Tipo de cliente"
        value={clase}
        onChange={elegir}
        options={[
          { value: 'local', label: 'Local' },
          { value: 'persona', label: 'Persona' },
          { value: 'almacen', label: 'Almacén' },
        ]}
      />
      {clase === 'local' ? <StorePicker stores={stores} onPick={onPick} /> : null}
      {clase === 'persona' ? <PersonaPicker onPick={onPick} /> : null}
      {clase === 'almacen' ? (
        <div className="glass flex flex-wrap items-center justify-between gap-3 p-3">
          <span className="min-w-0 text-muted">Venta de mostrador: a quien viene a buscar al almacén sin dar su nombre.</span>
          <Button icon={Warehouse} busy={busy} onClick={() => elegir('almacen')}>
            Vender en el mostrador
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Persona: sugiere las que ya compraron (sin duplicar) y crea una nueva en un toque. */
function PersonaPicker({ onPick }: { onPick: (s: QuickStore) => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const term = claveNombre(nombre);
  const found = useAsync(() => buscarPersonas(ctx, nombre), [ctx, term]);
  const data = found.data;
  const crear = () =>
    void run(
      async () => {
        const r = await crearPersona(ctx, { nombre, telefono });
        onPick(clienteRapido(r.persona));
        return r;
      },
      (r) => (r.nueva ? `Cliente nuevo: ${r.persona.name}.` : `${r.persona.name} ya estaba: se usa la misma.`),
    );
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TextInput label="Nombre de la persona" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" placeholder="Por ejemplo: Ana Pérez" />
        <TextInput label="Teléfono (opcional)" value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" autoComplete="off" />
      </div>
      {data?.sugerencias.length ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Personas">
          {data.sugerencias.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                data-persona={x.id}
                className="glass flex min-h-14 w-full items-center gap-3 p-3 text-left hover:border-accent"
                // La ficha completa (con su teléfono y su estado), no solo la sugerencia.
                onClick={() => void run(async () => onPick(clienteRapido(await verCliente(ctx, x.id))))}
              >
                <UserRound className="h-5 w-5 flex-none text-accent" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{x.nombre}</span>
                  <span className="block text-sm text-muted">
                    {[x.telefono, x.compras ? `${x.compras} ${x.compras === 1 ? 'compra' : 'compras'}${x.ultima ? `, la última el ${fmtDate(x.ultima)}` : ''}` : 'Sin compras todavía'].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {term.length >= 2 && !data?.exacta ? (
        <Button variant="primary" icon={UserPlus} busy={busy} onClick={crear} className="justify-self-start">
          Crear «{nombre.replace(/\s+/g, ' ').trim()}»
        </Button>
      ) : null}
      {term.length < 2 && !data?.sugerencias.length ? <p className="text-sm text-muted">Escribe el nombre: si ya compró antes, aparece aquí para no duplicarla.</p> : null}
    </div>
  );
}

/** Presentación que se propone: lo que se pide de a uno (mazos) por unidad; lo demás, por caja. */
export function defaultPack(p: Pick<Product, 'unitName' | 'packSize'>): SalePack {
  return p.unitName === 'mazo' || p.packSize <= 1 ? 'unidad' : 'caja';
}

/** Cantidad en su presentación: mazos (o tabacos o unidades) o cajas, sin pasar de lo que hay. */
export function PackQty({
  product,
  pack,
  packQty,
  available,
  onChange,
}: {
  product: Pick<Product, 'name' | 'unitName' | 'packSize'>;
  pack: SalePack;
  packQty: number;
  /** En unidades base. */
  available?: number;
  onChange: (pack: SalePack, packQty: number) => void;
}) {
  const unit = unitNames(product.unitName);
  const per = pack === 'caja' ? Math.max(1, product.packSize) : 1;
  const max = available !== undefined ? Math.floor(available / per) : undefined;
  const switchTo = (next: SalePack) => {
    if (next === pack) return;
    const base = pack === 'caja' ? packQty * product.packSize : packQty;
    onChange(next, next === 'caja' ? Math.max(1, Math.floor(base / product.packSize)) : Math.max(1, base));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {product.packSize > 1 ? (
        <Tabs<SalePack>
          label={`Presentación de ${product.name}`}
          value={pack}
          onChange={switchTo}
          options={[
            { value: 'unidad', label: unit.many.charAt(0).toUpperCase() + unit.many.slice(1) },
            { value: 'caja', label: `Cajas de ${product.packSize}` },
          ]}
        />
      ) : null}
      <QtyStepper label={product.name} value={packQty} onChange={(n) => onChange(pack, n)} max={max} unit={pack === 'caja' ? 'cajas' : unit.many} />
    </div>
  );
}
