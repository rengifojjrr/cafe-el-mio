// Fotos en lote: elegir muchas fotos a la vez; cada una va al producto cuyo SKU o código de
// barras es el nombre del archivo («ABC-101.jpg», «ABC-101-2.jpg», «ABC-101 (3).jpg»). Antes de
// guardar se ve qué va a cada producto, se ordenan y se puede recortar cuadradas al centro.
import { Crop, Images, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { MAX_PRODUCT_PHOTOS, type PhotoGroup, type PhotoTarget, groupPhotoMatches, matchPhotoFiles, moveItem } from '../../domain/photo-match';
import { compressImage } from '../../lib/image';
import { type PhotoSlot, addProductPhotos, listProducts } from '../../services/catalog';
import { Button, Card, EmptyState, ErrorBox, LinkButton, Loading, PageHeader, Pill } from '../../ui/kit';
import { errorText, useToast } from '../../ui/toast';
import { type PhotoItem, PhotoOrderList } from './photo-order';

interface Picked {
  index: number;
  file: File;
  url: string;
}

export function BatchPhotosPage() {
  const { actor, p } = useLine();
  if (actor.role !== 'admin' || actor.readOnly) {
    return (
      <EmptyState icon={Images} title="Solo administración sube fotos" action={<LinkButton to={p('catalogo')}>Ver catálogo</LinkButton>}>
        {actor.readOnly ? 'Estás en modo «ver como…»: aquí solo se mira.' : 'Vendedores y locales ven el catálogo, pero no lo cambian.'}
      </EmptyState>
    );
  }
  return <BatchPhotos />;
}

/** El orden de las fotos de un grupo: el que eligió la persona o, si no, las que ya tenía y luego las nuevas. */
function slotKeys(g: PhotoGroup, custom: string[] | undefined): string[] {
  const keys = [...g.existing.map((id) => `e:${id}`), ...g.accepted.map((m) => `n:${m.fileIndex}`)];
  if (custom && custom.length === keys.length && keys.every((k) => custom.includes(k))) return custom;
  return keys;
}

function BatchPhotos() {
  const { ctx, p } = useLine();
  const { push } = useToast();
  const products = useAsync(() => listProducts(ctx, { includeInactive: true }), [ctx]);
  const [files, setFiles] = useState<Picked[]>([]);
  const [removed, setRemoved] = useState<Set<number>>(() => new Set());
  const [orders, setOrders] = useState<Record<string, string[]>>({});
  const [square, setSquare] = useState(false);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
    },
    [],
  );

  const targets = useMemo<PhotoTarget[]>(
    () => (products.data ?? []).map((v) => ({ id: v.product.id, sku: v.product.sku, barcode: v.product.barcode, photoIds: v.product.photoIds })),
    [products.data],
  );
  const names = useMemo(() => new Map((products.data ?? []).map((v) => [v.product.id, v.product])), [products.data]);
  const result = useMemo(() => matchPhotoFiles(files.map((f) => f.file.name), targets), [files, targets]);
  const groups = useMemo(() => groupPhotoMatches(result.matched.filter((m) => !removed.has(m.fileIndex)), targets), [result, removed, targets]);
  const unmatched = result.unmatched.filter((u) => !removed.has(u.fileIndex));
  const toSave = groups.reduce((s, g) => s + g.accepted.length, 0);
  const productsToSave = groups.filter((g) => g.accepted.length).length;

  const add = (list: FileList) => {
    const start = files.length;
    const picked = [...list]
      .filter((f) => f.type.startsWith('image/'))
      .map((file, i) => {
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        return { index: start + i, file, url };
      });
    if (picked.length < list.length) push('info', 'Algunos archivos no son fotos y no se tomaron en cuenta.');
    setFiles([...files, ...picked]);
  };

  const clear = () => {
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current = [];
    setFiles([]);
    setRemoved(new Set());
    setOrders({});
  };

  const save = async () => {
    const work = groups.filter((g) => g.accepted.length);
    setSaving({ done: 0, total: toSave });
    let photos = 0;
    let done = 0;
    const failed: string[] = [];
    for (const g of work) {
      const name = names.get(g.productId)?.name ?? g.productId;
      try {
        const slots: PhotoSlot[] = [];
        for (const key of slotKeys(g, orders[g.productId])) {
          if (key.startsWith('e:')) {
            slots.push({ existingId: key.slice(2) });
            continue;
          }
          const f = files[Number(key.slice(2))]!;
          slots.push({ photo: await compressImage(f.file, 1600, 0.82, square) });
          done += 1;
          setSaving({ done, total: toSave });
        }
        await addProductPhotos(ctx, g.productId, slots, MAX_PRODUCT_PHOTOS);
        photos += g.accepted.length;
      } catch (e) {
        failed.push(`${name}: ${errorText(e)}`);
      }
    }
    setSaving(null);
    if (photos) push('ok', `Listo: ${photos} ${photos === 1 ? 'foto' : 'fotos'} en ${work.length - failed.length} ${work.length - failed.length === 1 ? 'producto' : 'productos'} (WebP, 1600 px máx.).`);
    if (failed.length) push('error', failed.length === 1 ? failed[0]! : `${failed.length} productos no se guardaron. ${failed[0]}`);
    if (!failed.length) clear();
  };

  if (products.loading && !products.data) return <Loading rows={3} />;
  if (products.error) return <ErrorBox error={products.error} />;

  return (
    <>
      <PageHeader
        back={{ to: p('catalogo'), label: 'Catálogo' }}
        title="Fotos en lote"
        subtitle="Elige muchas fotos a la vez: cada una va al producto cuyo SKU o código de barras es el nombre del archivo."
      />
      <Card className="mb-4 grid gap-3 p-5">
        <p className="text-sm text-ink">
          «ABC-101.jpg» es la foto principal del producto ABC-101; «ABC-101-2.jpg», «ABC-101_3.jpg» o «ABC-101 (2).jpg» son la segunda y la tercera. Hasta{' '}
          {MAX_PRODUCT_PHOTOS} fotos por producto: las que ya tiene se conservan. Se guardan en WebP de 1600 px como máximo.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={Upload} onClick={() => fileRef.current?.click()} disabled={saving !== null}>
            {files.length ? 'Agregar más fotos' : 'Elegir fotos'}
          </Button>
          {files.length ? (
            <Button variant="ghost" icon={Trash2} onClick={clear} disabled={saving !== null}>
              Empezar de nuevo
            </Button>
          ) : null}
          <label className="flex min-h-12 items-center gap-3 px-1">
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={square} onChange={(e) => setSquare(e.target.checked)} />
            <span className="flex items-center gap-1.5 font-semibold text-ink">
              <Crop className="h-4 w-4 text-accent" aria-hidden />
              Recortar cuadradas (al centro)
            </span>
          </label>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="Elegir las fotos de los productos"
          onChange={(e) => {
            if (e.target.files?.length) add(e.target.files);
            e.target.value = '';
          }}
        />
      </Card>

      {files.length ? (
        <p className="mb-3 font-semibold text-ink" data-testid="resumen-fotos">
          {toSave} {toSave === 1 ? 'foto va' : 'fotos van'} a {productsToSave} {productsToSave === 1 ? 'producto' : 'productos'}
          {unmatched.length ? ` · ${unmatched.length} sin producto` : ''}
        </p>
      ) : null}

      {groups.length ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {groups.map((g) => {
            const product = names.get(g.productId);
            const keys = slotKeys(g, orders[g.productId]);
            const items: PhotoItem[] = keys.map((key) => {
              if (key.startsWith('e:')) return { key, photoId: key.slice(2), label: 'Ya estaba' };
              const f = files[Number(key.slice(2))]!;
              return { key, url: f.url, label: f.file.name, removable: true };
            });
            return (
              <Card key={g.productId} as="li" className="min-w-0 p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-bold break-words text-ink">{product?.name}</h2>
                    <p className="text-sm text-muted">SKU {product?.sku}</p>
                  </div>
                  <Pill tone={g.accepted.length ? 'ok' : 'warn'}>{g.accepted.length ? `+${g.accepted.length}` : 'Sin lugar'}</Pill>
                </div>
                <PhotoOrderList
                  items={items}
                  square={square}
                  onMove={(from, to) => setOrders({ ...orders, [g.productId]: moveItem(keys, from, to) })}
                  onRemove={(key) => setRemoved(new Set([...removed, Number(key.slice(2))]))}
                />
                {g.overflow.length ? (
                  <p className="mt-2 text-sm text-warn">
                    No entran (ya llega a {MAX_PRODUCT_PHOTOS} fotos): {g.overflow.map((m) => m.fileName).join(', ')}. Quita una arriba o en la ficha del producto.
                  </p>
                ) : null}
              </Card>
            );
          })}
        </ul>
      ) : null}

      {unmatched.length ? (
        <Card className="mt-4 p-4">
          <h2 className="font-bold text-ink">Sin producto ({unmatched.length})</h2>
          <p className="text-sm text-muted">No hay un producto con ese SKU o código de barras. Cambia el nombre del archivo y vuelve a elegirlo.</p>
          <ul className="mt-2 grid gap-1">
            {unmatched.map((u) => (
              <li key={u.fileIndex} className="flex min-h-12 items-center justify-between gap-2 rounded-xl bg-surface-2 px-3">
                <span className="min-w-0 text-ink">
                  <span className="block truncate">{u.fileName}</span>
                  {u.reason === 'ambiguo' ? <span className="block text-sm text-warn">Dos productos tienen ese SKU o código: corrígelo en el catálogo.</span> : null}
                </span>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setRemoved(new Set([...removed, u.fileIndex]))} aria-label={`Quitar ${u.fileName}`}>
                  <Trash2 aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {files.length ? (
        <div className="sticky bottom-[76px] z-20 mt-5 flex flex-wrap gap-2 lg:bottom-4">
          <Button variant="primary" big icon={Save} busy={saving !== null} disabled={!toSave || saving !== null} onClick={() => void save()}>
            {saving ? `Guardando ${saving.done} de ${saving.total}…` : `Guardar ${toSave} ${toSave === 1 ? 'foto' : 'fotos'}`}
          </Button>
        </div>
      ) : null}
    </>
  );
}
