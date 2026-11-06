// «Imprimir etiquetas»: se eligen los productos (uno, varios o todas las variantes de una
// familia), cuántas de cada uno y el formato (hoja carta o etiqueta térmica). El PDF se arma
// en el teléfono con pdf-lib, que se baja solo al imprimir.
import { CheckSquare, Download, FileDown, Printer, Search, Square, Tag } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { familyKey, familyNameOf, searchText, normalize } from '../../domain/products';
import type { LabelFormat, LabelSpec } from '../../lib/labels-pdf';
import { pdfObjectUrl } from '../../lib/pdf';
import { listProducts, type ProductView } from '../../services/catalog';
import { Button, EmptyState, Loading, Sheet, Tabs } from '../../ui/kit';
import { useAction } from '../../ui/toast';
import { labelCode, productLabel } from './specs';

/** Arma el PDF de etiquetas y devuelve su dirección para abrirlo o bajarlo. */
export async function buildLabelsUrl(specs: LabelSpec[], format: LabelFormat, title: string): Promise<string> {
  const { labelsPdf } = await import('../../lib/labels-pdf');
  return pdfObjectUrl(await labelsPdf(specs, format, title));
}

export const FORMAT_OPTIONS: { value: LabelFormat; label: string }[] = [
  { value: 'carta', label: 'Hoja carta (30 por hoja)' },
  { value: 'termica', label: 'Térmica 2″ × 1″' },
];

/** El PDF listo: se abre en otra pestaña o se baja. */
export function PdfReady({ url, name }: { url: string; name: string }) {
  return (
    <div className="grid gap-2 rounded-2xl bg-ok-soft p-3 sm:grid-cols-2">
      <a className="btn btn-primary" href={url} target="_blank" rel="noopener" data-testid="pdf-etiquetas">
        <FileDown aria-hidden /> Abrir el PDF
      </a>
      <a className="btn btn-secondary" href={url} download={name}>
        <Download aria-hidden /> Bajar el PDF
      </a>
    </div>
  );
}

interface Family {
  key: string;
  name: string;
  items: ProductView[];
}

export function LabelsSheet({ open, onClose, initialIds = [] }: { open: boolean; onClose: () => void; initialIds?: string[] }) {
  return (
    <Sheet open={open} onClose={onClose} title="Imprimir etiquetas" wide>
      {open ? <LabelsBody initialIds={initialIds} /> : null}
    </Sheet>
  );
}

function LabelsBody({ initialIds }: { initialIds: string[] }) {
  const { ctx, line } = useLine();
  const { run, busy } = useAction();
  const products = useAsync(() => listProducts(ctx, { includeInactive: true }), [ctx]);
  const [format, setFormat] = useState<LabelFormat>('carta');
  const [copies, setCopies] = useState<Record<string, number>>(() => Object.fromEntries(initialIds.map((id) => [id, 1])));
  const [q, setQ] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  // Lo que venía elegido (por ejemplo, desde la ficha de un producto) sale primero.
  const [pinned] = useState(() => new Set(initialIds));

  const families = useMemo<Family[]>(() => {
    const term = normalize(q);
    const map = new Map<string, Family>();
    for (const v of products.data ?? []) {
      if (term && !searchText(v.product).includes(term)) continue;
      const key = familyKey(v.product);
      const fam = map.get(key) ?? { key, name: familyNameOf(v.product), items: [] };
      fam.items.push(v);
      map.set(key, fam);
    }
    const first = (f: Family) => (f.items.some((v) => pinned.has(v.product.id)) ? 0 : 1);
    return [...map.values()].sort((a, b) => first(a) - first(b) || a.name.localeCompare(b.name, 'es'));
  }, [products.data, q, pinned]);

  const selected = Object.entries(copies).filter(([, n]) => n > 0);
  const total = selected.reduce((a, [, n]) => a + n, 0);
  const toggle = (id: string) => {
    setUrl(null);
    setCopies((c) => {
      const next = { ...c };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });
  };
  const toggleFamily = (f: Family) => {
    setUrl(null);
    const all = f.items.every((v) => copies[v.product.id]);
    setCopies((c) => {
      const next = { ...c };
      for (const v of f.items) {
        if (all) delete next[v.product.id];
        else next[v.product.id] = next[v.product.id] || 1;
      }
      return next;
    });
  };

  const create = () =>
    void run(async () => {
      const byId = new Map((products.data ?? []).map((v) => [v.product.id, v.product]));
      const specs = selected.flatMap(([id, n]) => {
        const p = byId.get(id);
        return p ? [productLabel(line, p, n)] : [];
      });
      setUrl(await buildLabelsUrl(specs, format, 'Etiquetas'));
    }, `PDF listo: ${total} etiqueta${total === 1 ? '' : 's'}.`);

  if (products.loading && !products.data) return <Loading rows={3} />;
  return (
    <div className="grid gap-4">
      <Tabs<LabelFormat>
        label="Formato de las etiquetas"
        value={format}
        onChange={(f) => {
          setFormat(f);
          setUrl(null);
        }}
        options={FORMAT_OPTIONS}
      />
      <p className="text-sm text-muted">
        {format === 'carta'
          ? 'Hoja carta de 3 × 10 etiquetas de 2⅝″ × 1″ (como las Avery 5160). Imprime al 100 %, sin ajustar a la página.'
          : 'Una etiqueta de 2″ × 1″ por página, para impresoras térmicas.'}{' '}
        Cada etiqueta lleva el nombre, el código en barras y un QR que abre la ficha.
      </p>
      <label className="relative">
        <span className="sr-only">Buscar productos</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
        <input className="input pl-10" placeholder="Buscar por nombre, vitola, capa o código" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {families.length === 0 ? <EmptyState icon={Tag} title="Nada coincide con la búsqueda" /> : null}
      <ul className="grid gap-3">
        {families.map((f) => {
          const all = f.items.every((v) => copies[v.product.id]);
          return (
            <li key={f.key} className="rounded-2xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 font-bold text-ink">{f.name}</p>
                {f.items.length > 1 ? (
                  <Button variant="ghost" icon={all ? CheckSquare : Square} onClick={() => toggleFamily(f)} aria-pressed={all}>
                    Todas las de esta familia
                  </Button>
                ) : null}
              </div>
              <ul className="mt-1 grid gap-1">
                {f.items.map((v) => {
                  const pr = v.product;
                  const on = Boolean(copies[pr.id]);
                  return (
                    <li key={pr.id} className="flex flex-wrap items-center gap-2">
                      <label className="flex min-h-12 min-w-0 flex-1 basis-56 items-center gap-3">
                        <input type="checkbox" className="h-5 w-5 flex-none" checked={on} onChange={() => toggle(pr.id)} />
                        <span className="min-w-0">
                          <span className="block font-semibold break-words">{pr.name}</span>
                          <span className="block text-sm break-all text-muted">{labelCode(pr)}</span>
                        </span>
                      </label>
                      {on ? (
                        <label className="flex items-center gap-2 text-sm">
                          <span className="text-muted">Cuántas</span>
                          <input
                            className="input tabular w-20 text-center"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={500}
                            value={copies[pr.id]}
                            aria-label={`Cuántas etiquetas de ${pr.name}`}
                            onChange={(e) => {
                              setUrl(null);
                              setCopies((c) => ({ ...c, [pr.id]: Math.max(1, Math.min(500, Math.floor(Number(e.target.value) || 1))) }));
                            }}
                          />
                        </label>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      {url ? <PdfReady url={url} name="etiquetas.pdf" /> : null}
      <Button variant="primary" big icon={Printer} busy={busy} disabled={total === 0} onClick={create}>
        Crear PDF{total ? ` (${total} etiqueta${total === 1 ? '' : 's'})` : ''}
      </Button>
    </div>
  );
}
