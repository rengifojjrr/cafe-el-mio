// Fotos: miniatura de producto (foto subida, foto de la marca o silueta del tabaco)
// y el botón para tomar o elegir una foto (se comprime a WebP antes de guardarla).
import { capaShade } from '../domain/products';
import { Camera, ImageOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Photo } from '../data/types';
import { brandProductPhoto } from '../lib/assets';
import { compressImage, photoUrl, type NewPhoto } from '../lib/image';
import { CigarSilhouette } from './brand';
import { errorText, useToast } from './toast';

interface ThumbProduct {
  name: string;
  photoIds: string[];
  brandPhoto?: string;
  attrs: Record<string, string | number>;
}

/** Carga una foto guardada (por id) con la función de servicio que corresponda. */
export function useStoredPhoto(id: string | undefined, load: (id: string) => Promise<Photo | undefined>): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (!id) {
      setUrl(undefined);
      return;
    }
    void load(id).then((p) => {
      if (alive && p) setUrl(photoUrl(p.id, p.blob));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return url;
}

export function ProductThumb({
  product,
  loadPhoto,
  size = 'sm',
  className = '',
}: {
  product: ThumbProduct;
  loadPhoto?: (id: string) => Promise<Photo | undefined>;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const uploaded = useStoredPhoto(product.photoIds[0], loadPhoto ?? (async () => undefined));
  if (uploaded) {
    return <img src={uploaded} alt={`Foto de ${product.name}`} className={`h-full w-full object-cover ${className}`} loading="lazy" />;
  }
  if (product.brandPhoto) {
    return <img src={brandProductPhoto(product.brandPhoto, size)} alt={`Foto de ${product.name}`} className={`h-full w-full object-contain ${className}`} loading="lazy" />;
  }
  const a = product.attrs;
  if (a.lengthIn && a.ringGauge) {
    return (
      <CigarSilhouette
        lengthIn={Number(a.lengthIn)}
        ringGauge={Number(a.ringGauge)}
        shade={String(a.wrapperShade ?? capaShade(a.capa))}
        vitola={String(a.vitola ?? '')}
        ruler={size === 'lg'}
        className={`h-full w-full ${className}`}
        title={`Silueta a escala de ${product.name}`}
      />
    );
  }
  return (
    <div className={`grid h-full w-full place-items-center text-faint ${className}`} aria-label="Sin foto">
      <ImageOff className="h-6 w-6" aria-hidden />
    </div>
  );
}

/** Botón grande para tomar o elegir una foto. Devuelve la foto ya comprimida. */
export function PhotoPicker({ label = 'Tomar o elegir foto', onPhoto, disabled }: { label?: string; onPhoto: (p: NewPhoto) => void | Promise<void>; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => ref.current?.click()} disabled={disabled || busy}>
        <Camera aria-hidden />
        {busy ? 'Comprimiendo…' : label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={label}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try {
            await onPhoto(await compressImage(f));
          } catch (err) {
            push('error', errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
