// Piezas de la venta rápida y de los pedidos por teléfono o pegados: elegir el local (los recientes
// primero) y la cantidad en su presentación (mazos, tabacos o unidades, o cajas).
import { Search, Store as StoreIcon } from 'lucide-react';
import { useState } from 'react';
import type { Product, SalePack } from '../../data/types';
import { normalize, unitNames } from '../../domain/products';
import type { QuickStore } from '../../services/invoices';
import { Button, QtyStepper, Tabs } from '../../ui/kit';

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
        <input className="input pl-10" placeholder="Buscar local por nombre, ciudad o encargado" value={q} onChange={(e) => setQ(e.target.value)} />
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

/** El local elegido, con «Cambiar». */
export function PickedStore({ store, detail, onChange }: { store: QuickStore; detail?: string; onChange: () => void }) {
  return (
    <div className="glass flex flex-wrap items-center justify-between gap-3 p-3">
      <span className="min-w-0">
        <span className="block font-bold text-ink">{store.store.name}</span>
        <span className="block text-sm text-muted">
          {store.terms}
          {detail ? ` · ${detail}` : ''}
        </span>
      </span>
      <Button variant="ghost" onClick={onChange}>
        Cambiar local
      </Button>
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
