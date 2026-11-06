// El precio del local que compra en firme (el de su lista), para la tarjeta y la ficha del catálogo.
// Nunca muestra el PVP: el local en firme compra a su precio y vende al que quiera. El local en
// consignación no lo lleva (sigue viendo el PVP y lo que gana).
import { unitOf } from '../../domain/products';
import { fmtMoney } from '../../lib/money';
import type { ProductView } from '../../services/catalog';

export function StorePrice({ view, className = '' }: { view: Pick<ProductView, 'product' | 'storePrice'>; className?: string }) {
  const sp = view.storePrice;
  if (!sp) return null;
  const unit = unitOf(view.product).one;
  return (
    <dl className={`grid grid-cols-2 gap-x-3 gap-y-1 text-sm ${className}`} aria-label={`Tu precio, lista ${sp.listName}`}>
      <dt className="font-semibold text-ink">Tu precio por {unit}</dt>
      <dd className="glow text-right font-bold tabular">{fmtMoney(sp.unit)}</dd>
      <dt className="text-muted">La caja ({view.product.packSize})</dt>
      <dd className="text-right font-semibold tabular">{fmtMoney(sp.box)}</dd>
      {sp.volume ? (
        <>
          <dt className="text-muted">Desde {sp.volume.minBoxes} cajas</dt>
          <dd className="text-right font-semibold tabular">{fmtMoney(sp.volume.box)} c/u</dd>
        </>
      ) : null}
      <dd className="col-span-2 text-xs text-muted">Lista {sp.listName}</dd>
    </dl>
  );
}
