// Visor de PDF: dibuja cada página con pdf.js al ancho de la pantalla, puede marcar recuadros
// (dónde va cada firma) y ofrece descargar o abrir el PDF en otra pestaña.
import { Download, ExternalLink } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import type { Contract, Delivery, Store, TemplateField, TemplateFieldType } from '../../data/types';
import { annexText } from '../../domain/contract';
import { type PdfDoc, blobBytes, mergePdfs, openPdf, pdfObjectUrl, renderPdfPage, stampPdf, textToPdf } from '../../lib/pdf';
import { fmtDateTime } from '../../lib/time';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { FIELD_LABEL, getTemplate } from '../../services/templates';

type Doc = PdfDoc;

/** Ancho disponible del contenedor (para dibujar las páginas a ese ancho). */
export function useContainerWidth(max = 820): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.min(max, Math.floor(el.clientWidth / 8) * 8));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [max]);
  return [ref, width];
}

/** Abre el PDF una vez por cada juego de bytes. */
export function usePdfDocument(bytes: Uint8Array | null): { doc: Doc | null; pages: number; error: string | null } {
  const [state, setState] = useState<{ doc: Doc | null; pages: number; error: string | null }>({ doc: null, pages: 0, error: null });
  useEffect(() => {
    if (!bytes) return;
    let alive = true;
    let close: (() => void) | null = null;
    setState({ doc: null, pages: 0, error: null });
    openPdf(bytes)
      .then((opened) => {
        close = opened.close;
        if (alive) setState({ doc: opened.doc, pages: opened.doc.numPages, error: null });
        else opened.close();
      })
      .catch((e: unknown) => {
        if (alive) setState({ doc: null, pages: 0, error: e instanceof Error ? e.message : 'No se pudo abrir el PDF.' });
      });
    return () => {
      alive = false;
      close?.();
    };
  }, [bytes]);
  return state;
}

/** Una página del PDF; los hijos se dibujan encima (recuadros en porcentajes de la página). */
export function PdfPageView({ doc, index, width, children, label }: { doc: Doc; index: number; width: number; children?: ReactNode; label: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!holder.current || width <= 0) return;
    let alive = true;
    // Un canvas nuevo por dibujo: pdf.js no deja dibujar dos veces a la vez en el mismo.
    const canvas = document.createElement('canvas');
    canvas.className = 'block';
    canvas.setAttribute('aria-hidden', 'true');
    renderPdfPage(doc, index, canvas, width)
      .then(({ cssHeight }) => {
        if (!alive || !holder.current) return;
        holder.current.replaceChildren(canvas);
        setHeight(cssHeight);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [doc, index, width]);
  return (
    <div className="relative mx-auto overflow-hidden rounded-lg bg-papel shadow-lg" style={{ width, height: height ?? Math.round(width * 1.294) }} role="img" aria-label={label}>
      <div ref={holder} className="absolute inset-0" />
      {height === null ? <div className="skeleton absolute inset-0 rounded-none" aria-hidden /> : null}
      {children}
    </div>
  );
}

export function PdfViewer({
  bytes,
  fileName,
  highlight,
  title = 'Documento',
}: {
  bytes: Uint8Array;
  fileName: string;
  highlight?: TemplateField[];
  title?: string;
}) {
  const [box, width] = useContainerWidth();
  const { doc, pages, error } = usePdfDocument(bytes);
  // La dirección del PDF se crea y se libera en el mismo efecto: con useMemo, el doble montaje
  // de React en desarrollo la liberaba y «Descargar PDF» quedaba apuntando a nada.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = pdfObjectUrl(bytes);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes]);
  return (
    <div className="grid gap-3">
      {url ? (
        <div className="no-print flex flex-wrap gap-2">
          <a className="btn btn-primary" href={url} download={fileName}>
            <Download aria-hidden /> Descargar PDF
          </a>
          <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden /> Abrir en otra pestaña
          </a>
        </div>
      ) : null}
      <div ref={box} className="grid gap-4" aria-label={title}>
        {error ? <p className="rounded-xl bg-danger-soft p-3 text-danger">{error}</p> : null}
        {doc && width > 0
          ? Array.from({ length: pages }, (_, i) => (
              <PdfPageView key={i} doc={doc} index={i} width={width} label={`${title}, página ${i + 1} de ${pages}`}>
                {(highlight ?? [])
                  .filter((f) => f.page === i)
                  .map((f) => (
                    <span
                      key={f.id}
                      className="absolute grid place-items-center rounded-md border-2 border-dashed border-accent bg-accent-soft text-center text-[0.7rem] font-bold text-papel-tinta"
                      style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}
                    >
                      {FIELD_LABEL[f.type]}
                    </span>
                  ))}
              </PdfPageView>
            ))
          : !error
            ? <div className="skeleton h-96" aria-label="Cargando el PDF" />
            : null}
      </div>
    </div>
  );
}

/** «Tabaquería El Faro» → «tabaqueria-el-faro», para nombres de archivo. */
export function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------- Documentos sobre plantilla PDF ----------

/** Lo que se pone recién al firmar: las dos firmas y la fecha. */
const AT_SIGNING = new Set<TemplateFieldType>(['firma_local', 'firma_vendedor', 'fecha']);

/**
 * Contrato emitido sobre una plantilla PDF. Por firmar: ya lleva los datos del local y el anexo
 * de precios, y se marcan los recuadros de las firmas. Firmado: lleva además las firmas y la fecha.
 */
export function ContractPdfView({ contract, store, sellerName }: { contract: Contract; store: Pick<Store, 'name' | 'managerName' | 'address' | 'city'>; sellerName: string }) {
  const { ctx, config } = useLine();
  const template = useAsync(() => getTemplate(ctx, contract.templateId!), [ctx, contract.templateId]);
  const signed = contract.status === 'firmado';
  const pdf = useAsync(async () => {
    const t = template.data;
    if (!t) return null;
    const local = contract.signatures.find((s) => s.role === 'local');
    const empresa = contract.signatures.find((s) => s.role === 'empresa');
    const stamped = await stampPdf(await blobBytes(t.pdf), signed ? t.fields : t.fields.filter((f) => !AT_SIGNING.has(f.type)), {
      firma_local: local?.image,
      firma_vendedor: empresa?.image,
      nombre_local: store.name,
      encargado: local?.name ?? store.managerName,
      vendedor: empresa?.name ?? sellerName,
      fecha: contract.signedAt ? fmtDateTime(contract.signedAt) : '',
      direccion_local: `${store.address}, ${store.city}`,
    });
    const closing = signed
      ? `> Firmado en la aplicación por ${[local?.name, empresa?.name].filter(Boolean).join(' y ')}${contract.signedAt ? ` el ${fmtDateTime(contract.signedAt)}` : ''}. Firma de demostración.`
      : '> Este anexo es parte del contrato que se firma.';
    const annex = await textToPdf(
      `# Anexo A: productos en consignación\nContrato v${contract.version} de ${store.name}. Liquidación cada ${contract.settlementDays} días.\n\n${annexText(contract.annex, config.unitName.one)}\n\n${closing}`,
      'Anexo A',
    );
    return mergePdfs(stamped, annex);
  }, [template.data, signed, contract.signedAt, contract.id]);
  if (template.error) return <p className="rounded-xl bg-danger-soft p-3 text-danger">{template.error.message}</p>;
  if (!pdf.data) return <div className="skeleton h-96" aria-label="Preparando el PDF" />;
  return (
    <div className="grid gap-2">
      {signed ? null : <p className="text-sm text-muted">Los recuadros marcan dónde va cada firma. Al firmar, el PDF queda con las firmas y la fecha; el anexo de precios va al final.</p>}
      <PdfViewer
        bytes={pdf.data}
        fileName={`contrato-${slug(store.name)}-v${contract.version}.pdf`}
        highlight={signed ? undefined : template.data?.fields.filter((f) => AT_SIGNING.has(f.type))}
        title={`Contrato de consignación de ${store.name}`}
      />
    </div>
  );
}

/** Nota de entrega estampada sobre la plantilla PDF con la firma de quien recibió. */
export function DeliveryPdfView({
  delivery,
  storeName,
  sellerName,
  address,
  lines,
  invoiceCode,
}: {
  delivery: Delivery;
  storeName: string;
  sellerName: string;
  address: string;
  lines: { name: string; qty: number }[];
  /** Venta en firme: la factura que nació al recibir. */
  invoiceCode?: string;
}) {
  const { ctx } = useLine();
  const template = useAsync(() => getTemplate(ctx, delivery.templateId!), [ctx, delivery.templateId]);
  const pdf = useAsync(async () => {
    const t = template.data;
    if (!t) return null;
    return stampPdf(await blobBytes(t.pdf), t.fields, {
      firma_local: delivery.receivedSignature?.image,
      nombre_local: storeName,
      encargado: delivery.receivedSignature?.name ?? '',
      vendedor: sellerName,
      fecha: delivery.deliveredAt ? fmtDateTime(delivery.deliveredAt) : '',
      direccion_local: address,
      detalle_entrega: [`Nota ${delivery.code}${invoiceCode ? ` · Factura ${invoiceCode}` : ''}`, ...lines.map((l) => `${l.name} × ${l.qty}`)].join('\n'),
    });
  }, [template.data, delivery.id]);
  if (template.error) return <p className="rounded-xl bg-danger-soft p-3 text-danger">{template.error.message}</p>;
  if (!pdf.data) return <div className="skeleton h-96" aria-label="Preparando el PDF" />;
  return <PdfViewer bytes={pdf.data} fileName={`nota-de-entrega-${delivery.code.toLowerCase()}.pdf`} title={`Nota de entrega ${delivery.code}`} />;
}
