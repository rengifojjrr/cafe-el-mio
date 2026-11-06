// «Asignar este código a un producto»: un código que la app no conoce (por ejemplo, el que
// trae la caja de fábrica) se guarda como el código de barras de un producto.
import { Link2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Product } from '../../data/types';
import { normalize, searchText } from '../../domain/products';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { listProducts } from '../../services/catalog';
import { assignBarcode } from '../../services/codes';
import { Button, Loading, Sheet } from '../../ui/kit';
import { useAction } from '../../ui/toast';

export function AssignCodeSheet({ code, onClose, onAssigned }: { code: string | null; onClose: () => void; onAssigned?: (p: Product) => void }) {
  return (
    <Sheet open={code !== null} onClose={onClose} title="Asignar este código a un producto">
      {code ? (
        <AssignBody
          code={code}
          onDone={(p) => {
            onAssigned?.(p);
            onClose();
          }}
        />
      ) : null}
    </Sheet>
  );
}

function AssignBody({ code, onDone }: { code: string; onDone: (p: Product) => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const products = useAsync(() => listProducts(ctx, { includeInactive: true }), [ctx]);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const term = normalize(q);
    return (products.data ?? []).filter((v) => !term || searchText(v.product).includes(term)).slice(0, 40);
  }, [products.data, q]);
  return (
    <div className="grid gap-4">
      <p className="rounded-2xl bg-accent-soft p-3 text-ink">
        El código <b className="break-all">{code}</b> no es de ningún producto. Elige a cuál le pertenece: desde ahora, escanearlo lo encuentra. Si el producto ya tenía otro código, se reemplaza.
      </p>
      <label className="relative">
        <span className="sr-only">Buscar el producto</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
        <input className="input pl-10" placeholder="Buscar por nombre, vitola, capa o SKU" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {products.loading && !products.data ? <Loading rows={2} /> : null}
      <ul className="grid gap-2">
        {list.map((v) => (
          <li key={v.product.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line p-3">
            <div className="min-w-0 flex-1 basis-48">
              <p className="font-semibold break-words">{v.product.name}</p>
              <p className="text-sm break-all text-muted">
                SKU {v.product.sku}
                {v.product.barcode ? ` · hoy: ${v.product.barcode}` : ' · sin código'}
              </p>
            </div>
            <Button
              variant="primary"
              icon={Link2}
              busy={busy}
              aria-label={`Asignar a ${v.product.name}`}
              onClick={() =>
                void run(async () => {
                  const p = await assignBarcode(ctx, v.product.id, code);
                  onDone(p);
                  return p;
                }, (p) => `Listo: ${p.name} ahora tiene el código ${p.barcode}.`)
              }
            >
              Asignar
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
