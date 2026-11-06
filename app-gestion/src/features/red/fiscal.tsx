// Datos fiscales del local en su ficha y en el formulario: Tax ID (EIN), certificado de reventa,
// quién emite el permiso de tabaco y la foto o PDF de cada documento, con avisos de vencimiento.
import { Download, Eye, FileText, Pencil, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useLine } from '../../app/line-context';
import type { Photo, Store, StoreDocumentKind } from '../../data/types';
import { DEFAULT_PERMIT_ISSUER, DOC_LABEL, PERMIT_ISSUERS, isValidEin, storeDocWarnings } from '../../domain/fiscal';
import { compressImage } from '../../lib/image';
import { addDaysToDate, fmtDate, toIsoDate } from '../../lib/time';
import { MAX_DOCUMENT_BYTES, getStoreDocument, removeStoreDocument, saveStoreFiscal, uploadStoreDocument } from '../../services/fiscal';
import { Button, Card, KeyValue, Pill, SelectInput, Sheet, TextInput } from '../../ui/kit';
import { errorText, useAction, useToast } from '../../ui/toast';

/** Avisos del certificado de reventa (el del permiso ya lo muestra la ficha). */
export function ResaleCertPill({ store }: { store: Pick<Store, 'resaleCert' | 'tobaccoPermit'> }) {
  const { ctx } = useLine();
  const w = storeDocWarnings(store, ctx.now(), { requiresPermit: false }).find((x) => x.kind === 'reventa');
  if (!w) return null;
  return <Pill tone={w.state === 'vence_pronto' ? 'warn' : 'danger'}>{w.text}</Pill>;
}

export function issuerOptions(current?: string) {
  const list: string[] = [...PERMIT_ISSUERS];
  if (current && !list.includes(current)) list.push(current);
  return list.map((v) => ({ value: v, label: v }));
}

export interface FiscalFormValue {
  taxId: string;
  resaleNumber: string;
  resaleExpires: string;
}

/** Tarjeta del formulario del local: Tax ID y certificado de reventa (opcionales). */
export function FiscalFormCard({ value, onChange }: { value: FiscalFormValue; onChange: (v: FiscalFormValue) => void }) {
  const set = (patch: Partial<FiscalFormValue>) => onChange({ ...value, ...patch });
  const badEin = value.taxId.trim() !== '' && !isValidEin(value.taxId);
  return (
    <Card className="grid gap-4 p-4 sm:p-5">
      <h2 className="font-bold">Datos fiscales</h2>
      <p className="text-sm text-muted">Los pide la contadora. Sin certificado de reventa vigente, las ventas a este local salen marcadas «sin certificado».</p>
      <TextInput label="Tax ID (EIN)" value={value.taxId} onChange={(e) => set({ taxId: e.target.value })} placeholder="12-3456789" inputMode="numeric" error={badEin ? 'Son 9 dígitos: NN-NNNNNNN.' : undefined} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput label="Certificado de reventa" value={value.resaleNumber} onChange={(e) => set({ resaleNumber: e.target.value })} hint="En Florida, el Annual Resale Certificate." />
        <TextInput label="El certificado vence el" type="date" value={value.resaleExpires} onChange={(e) => set({ resaleExpires: e.target.value })} />
      </div>
    </Card>
  );
}

function openBlob(photo: Photo, download?: string) {
  const url = URL.createObjectURL(photo.blob);
  const a = document.createElement('a');
  a.href = url;
  if (download) a.download = download;
  else {
    a.target = '_blank';
    a.rel = 'noopener';
  }
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function DocumentRow({ store, kind, canEdit }: { store: Store; kind: StoreDocumentKind; canEdit: boolean }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const { push } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const has = Boolean(store.documents?.[kind]);
  const label = DOC_LABEL[kind];

  const pick = async (file: File) => {
    const isPdf = file.type === 'application/pdf';
    if (isPdf && file.size > MAX_DOCUMENT_BYTES) {
      push('error', 'El PDF pasa de 8 MB: súbelo más liviano.');
      return;
    }
    await run(async () => {
      const doc = isPdf ? { blob: file, mime: 'application/pdf', width: 0, height: 0 } : await compressImage(file);
      await uploadStoreDocument(ctx, store.id, kind, doc);
    }, `${label}: archivo guardado.`);
  };

  const show = (download: boolean) =>
    void run(async () => {
      const ph = await getStoreDocument(ctx, store.id, kind);
      if (!ph) throw new Error('No encontré el archivo.');
      const ext = ph.mime === 'application/pdf' ? 'pdf' : ph.mime.includes('webp') ? 'webp' : 'jpg';
      openBlob(ph, download ? `${store.name} - ${label}.${ext}` : undefined);
    });

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2">
      <FileText className="h-5 w-5 flex-none text-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{label}</span>
        <span className="block text-sm text-muted">{has ? 'Foto o PDF guardado' : 'Sin archivo'}</span>
      </span>
      {has ? (
        <>
          <Button variant="ghost" icon={Eye} onClick={() => show(false)} aria-label={`Ver ${label}`} />
          <Button variant="ghost" icon={Download} onClick={() => show(true)} aria-label={`Descargar ${label}`} />
        </>
      ) : null}
      {canEdit ? (
        <>
          <Button icon={Upload} busy={busy} onClick={() => input.current?.click()} aria-label={`Subir foto o PDF: ${label}`}>
            {has ? 'Cambiar' : 'Subir'}
          </Button>
          {has ? <Button variant="ghost" icon={Trash2} onClick={() => void run(() => removeStoreDocument(ctx, store.id, kind), `${label}: archivo quitado.`)} aria-label={`Quitar archivo: ${label}`} /> : null}
          <input
            ref={input}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            aria-label={`Archivo de ${label}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void pick(f).catch((err: unknown) => push('error', errorText(err)));
            }}
          />
        </>
      ) : null}
    </li>
  );
}

/** «Datos fiscales y documentos» en la ficha del local. */
export function StoreFiscalSection({ store, canEdit }: { store: Store; canEdit: boolean }) {
  const { config } = useLine();
  const [editing, setEditing] = useState(false);
  const kinds: StoreDocumentKind[] = config.requiresTobaccoPermit ? ['permiso', 'taxId', 'reventa'] : ['taxId', 'reventa'];
  const permit = store.tobaccoPermit;
  return (
    <Card className="p-4 sm:p-5" aria-label="Datos fiscales y documentos">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Datos fiscales y documentos</h2>
        {canEdit ? (
          <Button icon={Pencil} onClick={() => setEditing(true)}>
            Editar datos fiscales
          </Button>
        ) : null}
      </div>
      <KeyValue
        items={[
          ['Tax ID (EIN)', store.taxId ?? 'Sin registrar'],
          ['Certificado de reventa', store.resaleCert ? `${store.resaleCert.number} · vence el ${fmtDate(store.resaleCert.expiresOn)}` : 'Sin certificado'],
          ...(config.requiresTobaccoPermit
            ? ([['Permiso de venta de tabaco', permit ? `${permit.number} · ${permit.issuer ?? DEFAULT_PERMIT_ISSUER} · vence el ${fmtDate(permit.expiresOn)}` : 'Sin registrar']] as [string, string][])
            : []),
        ]}
      />
      <ul className="mt-4 grid grid-cols-1 gap-2">
        {kinds.map((k) => (
          <DocumentRow key={k} store={store} kind={k} canEdit={canEdit} />
        ))}
      </ul>
      <FiscalSheet key={editing ? 'abierta' : 'cerrada'} store={store} open={editing} onClose={() => setEditing(false)} />
    </Card>
  );
}

function FiscalSheet({ store, open, onClose }: { store: Store; open: boolean; onClose: () => void }) {
  const { ctx, config } = useLine();
  const { run, busy } = useAction();
  const [taxId, setTaxId] = useState(store.taxId ?? '');
  const [number, setNumber] = useState(store.resaleCert?.number ?? '');
  const [expires, setExpires] = useState(store.resaleCert?.expiresOn ?? addDaysToDate(toIsoDate(ctx.now()), 365));
  const [issuer, setIssuer] = useState(store.tobaccoPermit?.issuer ?? DEFAULT_PERMIT_ISSUER);
  const badEin = taxId.trim() !== '' && !isValidEin(taxId);
  return (
    <Sheet open={open} onClose={onClose} title="Datos fiscales">
      <form
        className="grid grid-cols-[minmax(0,1fr)] gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await saveStoreFiscal(ctx, store.id, {
              taxId,
              resaleCert: number.trim() ? { number: number.trim(), expiresOn: expires } : null,
              permitIssuer: config.requiresTobaccoPermit && store.tobaccoPermit ? issuer : undefined,
            });
            onClose();
          }, 'Datos fiscales guardados.');
        }}
      >
        <TextInput label="Tax ID (EIN)" value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="12-3456789" inputMode="numeric" error={badEin ? 'Son 9 dígitos: NN-NNNNNNN.' : undefined} />
        <TextInput label="Número del certificado de reventa" value={number} onChange={(e) => setNumber(e.target.value)} hint="Déjalo vacío si el local no tiene." />
        <TextInput label="El certificado vence el" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        {config.requiresTobaccoPermit && store.tobaccoPermit ? (
          <SelectInput label="Quién emite el permiso de tabaco" value={issuer} onChange={(e) => setIssuer(e.target.value)} options={issuerOptions(store.tobaccoPermit.issuer)} />
        ) : null}
        <Button type="submit" variant="primary" busy={busy}>
          Guardar datos fiscales
        </Button>
      </form>
    </Sheet>
  );
}
