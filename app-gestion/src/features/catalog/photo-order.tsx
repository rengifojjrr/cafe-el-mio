// Ordenar las fotos de un producto: miniatura, «Subir» y «Bajar» (y «Quitar» para las nuevas
// de un lote). La primera es la principal: la que se ve en el catálogo.
import { ArrowDown, ArrowUp, Save, X } from 'lucide-react';
import { useState } from 'react';
import { useLine } from '../../app/line-context';
import { moveItem } from '../../domain/photo-match';
import { getPhoto, reorderProductPhotos } from '../../services/catalog';
import { Button, Sheet } from '../../ui/kit';
import { useStoredPhoto } from '../../ui/media';
import { useAction } from '../../ui/toast';

export interface PhotoItem {
  key: string;
  /** Foto guardada (se carga de la base)… */
  photoId?: string;
  /** …o una nueva, todavía en el teléfono. */
  url?: string;
  label: string;
  removable?: boolean;
}

function Thumb({ item, square }: { item: PhotoItem; square?: boolean }) {
  const { ctx } = useLine();
  const stored = useStoredPhoto(item.photoId, (id) => getPhoto(ctx, id));
  const url = item.url ?? stored;
  return (
    <div className="h-16 w-16 flex-none overflow-hidden rounded-xl border border-line bg-surface-3">
      {url ? <img src={url} alt={item.label} className={`h-full w-full ${square ? 'object-cover' : 'object-contain'}`} /> : null}
    </div>
  );
}

export function PhotoOrderList({
  items,
  onMove,
  onRemove,
  square,
}: {
  items: PhotoItem[];
  onMove: (from: number, to: number) => void;
  onRemove?: (key: string) => void;
  square?: boolean;
}) {
  return (
    <ol className="grid gap-2">
      {items.map((it, i) => (
        <li key={it.key} className="flex min-w-0 items-center gap-2 rounded-2xl border border-line bg-surface-2 p-2">
          <Thumb item={it} square={square} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{i === 0 ? 'Principal' : `Foto ${i + 1}`}</p>
            <p className="truncate text-sm text-muted">{it.label}</p>
          </div>
          <div className="flex flex-none">
            <button type="button" className="btn btn-ghost btn-icon" disabled={i === 0} onClick={() => onMove(i, i - 1)} aria-label={`Subir: ${it.label}`}>
              <ArrowUp aria-hidden />
            </button>
            <button type="button" className="btn btn-ghost btn-icon" disabled={i === items.length - 1} onClick={() => onMove(i, i + 1)} aria-label={`Bajar: ${it.label}`}>
              <ArrowDown aria-hidden />
            </button>
            {it.removable && onRemove ? (
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => onRemove(it.key)} aria-label={`Quitar: ${it.label}`}>
                <X aria-hidden />
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Hoja para ordenar las fotos de la ficha del producto. */
export function PhotoOrderSheet({ productId, photoIds, onClose }: { productId: string; photoIds: string[]; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [order, setOrder] = useState(photoIds);
  const save = async () => {
    const done = await run(async () => {
      await reorderProductPhotos(ctx, productId, order);
      return true;
    }, 'Orden de las fotos guardado.');
    if (done) onClose();
  };
  return (
    <Sheet open onClose={onClose} title="Ordenar fotos">
      <p className="mb-3 text-sm text-muted">La primera es la principal: la que se ve en el catálogo.</p>
      <PhotoOrderList
        items={order.map((id) => {
          const was = photoIds.indexOf(id);
          return { key: id, photoId: id, label: was === 0 ? 'Era la principal' : `Era la foto ${was + 1}` };
        })}
        onMove={(from, to) => setOrder(moveItem(order, from, to))}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" icon={Save} busy={busy} onClick={() => void save()}>
          Guardar orden
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </Sheet>
  );
}
