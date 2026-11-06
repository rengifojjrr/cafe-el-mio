// «Contratos»: cada rol ve sus documentos firmados (contratos y notas de entrega) y los que
// faltan por firmar. Administración, además, maneja las plantillas: sube un PDF y ubica dónde
// va cada firma, o vuelve al texto de Ajustes.
import { Eye, FilePlus2, FileSignature, FileText, History, MapPinned, RotateCcw, Search, Truck, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ContractTemplate, TemplateField, TemplateKind } from '../../data/types';
import { CONTRACT_VARIABLES, renderTemplate } from '../../domain/contract';
import { blobBytes, readPdfInfo, stampPdf, textToPdfWithSlots, type PdfSlot } from '../../lib/pdf';
import { fmtDate, fmtDateTime } from '../../lib/time';
import { useAsync, useBackState } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { readSettings } from '../../services/admin';
import { listSignedDocuments, type SignedDocument } from '../../services/documents';
import { TEMPLATE_KIND_LABEL, listTemplates, revertToTextTemplate } from '../../services/templates';
import { demoSignature } from '../../seed/signature';
import { Button, Card, EmptyState, ErrorBox, Loading, PageHeader, Pill, Sheet, Tabs } from '../../ui/kit';
import { errorText, useAction, useToast } from '../../ui/toast';
import { PdfTemplateEditor } from './pdf-editor';
import { PdfViewer } from './pdf-viewer';

type Tab = 'firmados' | 'porfirmar' | 'plantillas';
type KindFilter = '' | SignedDocument['kind'];

/** Cuántos documentos se muestran de entrada (administración puede tener cientos). */
const PAGE = 30;

const norm = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

interface EditState {
  kind: TemplateKind;
  bytes: Uint8Array;
  pageSizes: { w: number; h: number }[];
  fields: TemplateField[];
  name: string;
}

let seq = 0;
const slotsToFields = (slots: PdfSlot[]): TemplateField[] => slots.map((s) => ({ ...s, id: `sug-${Date.now().toString(36)}-${(seq++).toString(36)}` }));

export function ContractsHubPage() {
  const { ctx, actor, p } = useLine();
  const isAdmin = actor.role === 'admin';
  const [tab, setTab] = useBackState<Tab>(`contratos-tab:${ctx.actor.accountId}:${ctx.line}`, 'firmados');
  const [editing, setEditing] = useState<EditState | null>(null);
  const [preview, setPreview] = useState<{ bytes: Uint8Array; name: string } | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<KindFilter>('');
  const [limit, setLimit] = useState(PAGE);
  const docs = useAsync(() => listSignedDocuments(ctx), [ctx]);

  if (editing) {
    return (
      <>
        <PageHeader
          back={{ to: p('contratos'), label: 'Contratos' }}
          title="Ubicar firmas"
          subtitle={`${TEMPLATE_KIND_LABEL[editing.kind]}: toca la página donde va cada firma y cada dato. Se guarda como versión nueva; lo ya firmado no cambia.`}
        />
        <PdfTemplateEditor
          kind={editing.kind}
          bytes={editing.bytes}
          pageSizes={editing.pageSizes}
          initialFields={editing.fields}
          initialName={editing.name}
          onSaved={() => {
            setEditing(null);
            setTab('plantillas');
          }}
          onCancel={() => setEditing(null)}
        />
      </>
    );
  }

  const signed = (docs.data ?? []).filter((d) => d.status === 'firmado');
  const pending = (docs.data ?? []).filter((d) => d.status === 'por_firmar');
  const subtitle =
    actor.role === 'store'
      ? 'Tu contrato de consignación y cada nota de entrega que firmaste al recibir.'
      : actor.role === 'seller'
        ? 'Los contratos y las notas de entrega de tus locales: los firmados y los que faltan.'
        : 'Todo lo firmado en la línea y las plantillas de contrato y de nota de entrega.';
  const base = tab === 'firmados' ? signed : pending;
  const needle = norm(q.trim());
  const list = base.filter((d) => (!kind || d.kind === kind) && (!needle || norm(`${d.storeName} ${d.title} ${d.signers.map((x) => x.name).join(' ')}`).includes(needle)));
  const showFilters = tab !== 'plantillas' && base.length > 6;
  const changeTab = (t: Tab) => {
    setTab(t);
    setLimit(PAGE);
  };

  return (
    <>
      <PageHeader title={actor.role === 'store' ? 'Mis contratos' : 'Contratos'} subtitle={subtitle} />
      <div className="mb-4">
        <Tabs<Tab>
          label="Secciones de contratos"
          value={tab}
          onChange={changeTab}
          options={[
            { value: 'firmados', label: 'Firmados', count: signed.length },
            { value: 'porfirmar', label: 'Por firmar', count: pending.length },
            ...(isAdmin ? [{ value: 'plantillas' as Tab, label: 'Plantillas' }] : []),
          ]}
        />
      </div>
      {showFilters ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <label className="relative min-w-0 flex-1 basis-60">
            <span className="sr-only">Buscar documento</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
            <input
              className="input pl-10"
              type="search"
              placeholder={actor.role === 'store' ? 'Buscar por número o por quien firmó' : 'Buscar por local, número o quien firmó'}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLimit(PAGE);
              }}
            />
          </label>
          <select
            className="input w-auto min-w-48"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as KindFilter);
              setLimit(PAGE);
            }}
            aria-label="Qué documentos mostrar"
          >
            <option value="">Contratos y notas de entrega</option>
            <option value="contrato">Solo contratos</option>
            <option value="entrega">Solo notas de entrega</option>
          </select>
        </div>
      ) : null}
      {docs.loading && !docs.data ? <Loading rows={4} /> : null}
      {docs.error ? <ErrorBox error={docs.error} /> : null}
      {tab !== 'plantillas' && docs.data ? (
        list.length ? (
          <>
            <ul className="grid gap-2">
              {list.slice(0, limit).map((d) => (
                <li key={`${d.kind}-${d.id}`}>
                  <DocumentRow d={d} />
                </li>
              ))}
            </ul>
            {list.length > limit ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={() => setLimit(limit + PAGE)}>
                  Ver más
                </Button>
                <span className="text-sm text-muted">
                  Se ven {limit} de {list.length}.
                </span>
              </div>
            ) : null}
          </>
        ) : base.length ? (
          <EmptyState icon={Search} title="Nada coincide con la búsqueda">
            Prueba con otro nombre o elige «Contratos y notas de entrega».
          </EmptyState>
        ) : tab === 'firmados' ? (
          <EmptyState icon={FileSignature} title="Todavía no hay documentos firmados">
            Aquí aparecen los contratos y las notas de entrega en cuanto se firman.
          </EmptyState>
        ) : (
          <EmptyState icon={FileSignature} title="No hay contratos por firmar">
            {actor.role === 'store' ? 'Tu contrato ya está firmado.' : 'Cuando se prepare un contrato para un local, aparece aquí hasta que lo firmen.'}
          </EmptyState>
        )
      ) : null}
      {tab === 'plantillas' && isAdmin ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <TemplateCard kind="consignacion" onEdit={setEditing} onPreview={(bytes, name) => setPreview({ bytes, name })} />
          <TemplateCard kind="entrega" onEdit={setEditing} onPreview={(bytes, name) => setPreview({ bytes, name })} />
        </div>
      ) : null}
      <Sheet open={preview !== null} onClose={() => setPreview(null)} title="Ejemplo con firmas" wide>
        {preview ? (
          <>
            <p className="mb-3 text-sm text-muted">Así queda un documento con datos y firmas de ejemplo.</p>
            <PdfViewer bytes={preview.bytes} fileName={`ejemplo-${preview.name}.pdf`} title="Ejemplo con firmas" />
          </>
        ) : null}
      </Sheet>
    </>
  );
}

function DocumentRow({ d }: { d: SignedDocument }) {
  const { p, actor } = useLine();
  const who = d.signers.map((s) => s.name).join(' y ');
  return (
    <Link to={p(d.path)} state={{ from: 'contratos' }} className="glass flex min-h-16 flex-wrap items-center gap-3 p-4 hover:border-line-strong" data-document={d.kind}>
      <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-accent-soft text-accent">
        {d.kind === 'contrato' ? <FileSignature className="h-5 w-5" aria-hidden /> : <Truck className="h-5 w-5" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-ink">{d.title}</span>
          <Pill tone={d.kind === 'contrato' ? 'accent' : 'info'}>{d.kind === 'contrato' ? 'Contrato' : 'Nota de entrega'}</Pill>
          {d.usesPdf ? <Pill>PDF</Pill> : null}
          {d.status === 'por_firmar' ? <Pill tone="warn">Por firmar</Pill> : null}
        </span>
        <span className="block text-sm text-muted">
          {actor.role === 'store' ? '' : `${d.storeName} · `}
          {d.status === 'firmado' ? `Firmado el ${fmtDateTime(d.date)}` : `Preparado el ${fmtDate(d.date)}`}
          {who ? ` · ${d.kind === 'entrega' ? 'Recibió' : 'Firmaron'} ${who}` : ''}
        </span>
      </span>
    </Link>
  );
}

function sampleVars(companyName: string, settlementDays: number, paymentDays: number, months: number, notice: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(CONTRACT_VARIABLES)) out[k] = `[${k}]`;
  return {
    ...out,
    'contrato.version': '1',
    fecha: fmtDate(new Date()),
    'empresa.nombre': companyName,
    'empresa.representante': 'el vendedor que firma',
    'local.nombre': 'el local',
    'local.tipo': 'local',
    'local.direccion': 'la dirección del local',
    'local.encargado': 'el encargado',
    'local.telefono': 'su teléfono',
    'local.correo': 'su correo',
    'permiso.numero': 'su número de permiso',
    'permiso.vence': 'su fecha de vencimiento',
    'liquidacion.dias': String(settlementDays),
    'pago.dias': String(paymentDays),
    'vigencia.meses': String(months),
    'aviso.dias': String(notice),
    'anexo.productos': '- La lista de productos, precios al local, PVP sugerido y ganancia del local va en el Anexo A, que la app agrega al firmar.',
  };
}

const DELIVERY_TEXT = `# Nota de entrega en consignación
> Plantilla de ejemplo: la revisa un abogado antes de usarla con locales reales.

La mercancía de esta nota se entrega en consignación: sigue siendo de la empresa hasta que el local la vende.

## Productos entregados
[[espacio]]

Quien firma (dueño o encargado del local) declara que recibió la mercancía completa y en buen estado.`;

function TemplateCard({ kind, onEdit, onPreview }: { kind: TemplateKind; onEdit: (e: EditState) => void; onPreview: (bytes: Uint8Array, name: string) => void }) {
  const { ctx, actor } = useLine();
  const { push } = useToast();
  const { run, busy } = useAction();
  const versions = useAsync(() => listTemplates(ctx, kind), [ctx, kind]);
  const settings = useAsync(() => readSettings(ctx), [ctx]);
  const file = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [history, setHistory] = useState(false);
  const active = versions.data?.find((t) => t.active);
  const canWrite = !actor.readOnly;

  const guarded = async (fn: () => Promise<void>) => {
    setWorking(true);
    try {
      await fn();
    } catch (e) {
      push('error', errorText(e));
    } finally {
      setWorking(false);
    }
  };

  const upload = (f: File) =>
    guarded(async () => {
      if (f.type && f.type !== 'application/pdf') throw new Error('Elige un archivo PDF.');
      const bytes = new Uint8Array(await f.arrayBuffer());
      const { pageSizes } = await readPdfInfo(bytes);
      onEdit({ kind, bytes, pageSizes, fields: [], name: f.name.replace(/\.pdf$/i, '') });
    });

  const fromText = () =>
    guarded(async () => {
      if (kind === 'consignacion') {
        const s = settings.data ?? (await readSettings(ctx));
        const text = renderTemplate(s.contractTemplate, sampleVars(s.companyName, s.settlementEveryDays, s.paymentTermsDays, s.contractTermMonths, s.terminationNoticeDays)).text;
        const { bytes, slots } = await textToPdfWithSlots(text, 'Contrato de consignación');
        const { pageSizes } = await readPdfInfo(bytes);
        onEdit({ kind, bytes, pageSizes, fields: slotsToFields(slots), name: 'Contrato desde el texto de Ajustes' });
      } else {
        const { bytes, slots } = await textToPdfWithSlots(DELIVERY_TEXT, 'Nota de entrega', [{ label: 'Recibió (dueño o encargado del local)', type: 'firma_local' }]);
        const { pageSizes } = await readPdfInfo(bytes);
        onEdit({ kind, bytes, pageSizes, fields: slotsToFields(slots), name: 'Nota de entrega básica' });
      }
    });

  const editActive = (t: ContractTemplate) =>
    guarded(async () => {
      onEdit({ kind, bytes: await blobBytes(t.pdf), pageSizes: t.pageSizes, fields: t.fields.map((f) => ({ ...f })), name: t.name });
    });

  const example = (t: ContractTemplate) =>
    guarded(async () => {
      const bytes = await stampPdf(await blobBytes(t.pdf), t.fields, {
        firma_local: demoSignature('Encargado Ejemplo'),
        firma_vendedor: demoSignature('Vendedor Ejemplo'),
        nombre_local: 'Tabaquería de ejemplo',
        encargado: 'Encargado de ejemplo',
        vendedor: actor.name,
        fecha: fmtDateTime(new Date()),
        direccion_local: '1234 Avenida Ejemplo, Miami, FL',
        detalle_entrega: 'Nota E-0000\nProducto de ejemplo × 20\nOtro producto × 12',
      });
      onPreview(bytes, kind);
    });

  return (
    <Card className="grid content-start gap-4 p-4 sm:p-5" aria-label={`Plantilla: ${TEMPLATE_KIND_LABEL[kind]}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-accent-soft text-accent">
          {kind === 'consignacion' ? <FileSignature className="h-5 w-5" aria-hidden /> : <Truck className="h-5 w-5" aria-hidden />}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold">{TEMPLATE_KIND_LABEL[kind]}</h2>
          {versions.loading && !versions.data ? (
            <p className="text-sm text-muted">Cargando…</p>
          ) : active ? (
            <p className="text-sm text-ink" data-testid={`plantilla-activa-${kind}`}>
              Usa el PDF «{active.name}» · versión {active.version} · desde el {fmtDate(active.createdAt)} · {active.fields.length} recuadros
            </p>
          ) : (
            <p className="text-sm text-muted" data-testid={`plantilla-activa-${kind}`}>
              {kind === 'consignacion'
                ? `Usa el texto de Ajustes (versión ${settings.data?.contractTemplateVersion ?? 1}). Sube un PDF para usar tu propio documento.`
                : 'Usa la nota que arma la app. Sube un PDF para usar tu propio formato.'}
            </p>
          )}
        </div>
      </div>
      {canWrite ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button icon={Upload} onClick={() => file.current?.click()} busy={working}>
            Subir PDF
          </Button>
          <Button icon={kind === 'consignacion' ? FileText : FilePlus2} onClick={() => void fromText()} busy={working}>
            {kind === 'consignacion' ? 'Crear PDF desde el texto' : 'Crear PDF básico'}
          </Button>
          {active ? (
            <>
              <Button icon={MapPinned} onClick={() => void editActive(active)} busy={working}>
                Ubicar firmas
              </Button>
              <Button icon={Eye} onClick={() => void example(active)} busy={working}>
                Ver ejemplo
              </Button>
              <Button variant="ghost" icon={RotateCcw} busy={busy} onClick={() => void run(() => revertToTextTemplate(ctx, kind), kind === 'consignacion' ? 'Listo: los contratos nuevos usan el texto de Ajustes.' : 'Listo: las notas nuevas las arma la app.')}>
                {kind === 'consignacion' ? 'Usar el texto' : 'Usar la nota de la app'}
              </Button>
            </>
          ) : null}
          <input
            ref={file}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            aria-label={`Subir PDF para ${TEMPLATE_KIND_LABEL[kind].toLowerCase()}`}
            data-testid={`subir-${kind}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void upload(f);
            }}
          />
        </div>
      ) : null}
      {(versions.data ?? []).length ? (
        <div>
          <Button variant="ghost" icon={History} onClick={() => setHistory(!history)} aria-expanded={history}>
            Versiones ({versions.data?.length})
          </Button>
          {history ? (
            <ul className="mt-2 grid gap-1 text-sm">
              {(versions.data ?? []).map((t) => (
                <li key={t.id} className="flex flex-wrap justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2">
                  <span>
                    v{t.version} · {t.name}
                  </span>
                  <span className="text-muted">
                    {fmtDate(t.createdAt)}
                    {t.active ? ' · activa' : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted">Lo que ya está firmado guarda la versión con que se firmó: cambiar la plantilla no lo modifica.</p>
    </Card>
  );
}
