// Contrato de consignación: se lee como un documento, se firma en el teléfono del vendedor
// (encargado del local y vendedor como representante de la empresa) y se imprime o guarda en PDF.
import { FileSignature, MapPin, Printer, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import type { Contract, Signature } from '../../data/types';
import { CONTRACT_DISCLAIMER, parseContract } from '../../domain/contract';
import { fmtDate, fmtDateTime } from '../../lib/time';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { getContract, issueContract, signContract } from '../../services/contracts';
import { getActiveTemplate } from '../../services/templates';
import { Button, Card, ErrorBox, LinkButton, Loading, PageHeader, Pill, TextInput } from '../../ui/kit';
import { SignatureField, askLocation } from '../../ui/signature';
import { ContractPdfView } from './pdf-viewer';
import { useAction } from '../../ui/toast';

function ContractDocument({ contract }: { contract: Contract }) {
  const blocks = parseContract(contract.body);
  return (
    <article className="print-sheet mx-auto max-w-[70ch] rounded-[20px] bg-papel px-5 py-7 text-papel-tinta shadow-lg sm:px-10 sm:py-10" lang="es">
      {blocks.map((b, i) => {
        if (b.kind === 'title') return <h1 key={i} className="font-display text-[1.7rem] leading-tight font-semibold sm:text-3xl">{b.text}</h1>;
        if (b.kind === 'heading') return <h2 key={i} className="mt-6 mb-1.5 text-lg font-bold">{b.text}</h2>;
        if (b.kind === 'note') return <p key={i} className="mt-3 rounded-lg border border-papel-linea px-3 py-2 text-sm font-semibold">{b.text}</p>;
        if (b.kind === 'bullet') return <p key={i} className="mt-1.5 pl-4 text-[0.95rem] leading-relaxed -indent-4">• {b.text}</p>;
        return <p key={i} className="mt-2 text-[0.97rem] leading-relaxed">{b.text}</p>;
      })}
      {contract.signatures.length ? (
        <section className="mt-8 grid gap-6 border-t border-papel-linea pt-6 sm:grid-cols-2" aria-label="Firmas">
          {contract.signatures.map((s) => (
            <SignatureBlock key={s.role} s={s} />
          ))}
        </section>
      ) : null}
      <p className="mt-8 text-xs text-papel-suave">
        Contrato v{contract.version} · plantilla v{contract.templateVersion} · emitido el {fmtDate(contract.createdAt)}
        {contract.signedAt ? ` · firmado el ${fmtDateTime(contract.signedAt)}` : ''}. Firma de demostración registrada en la aplicación.
      </p>
    </article>
  );
}

function SignatureBlock({ s }: { s: Signature }) {
  return (
    <div>
      <img src={s.image} alt={`Firma de ${s.name}`} className="h-16 w-auto max-w-full" />
      <div className="mt-1 border-t border-papel-tinta pt-1.5 text-sm">
        <p className="font-bold">{s.name}</p>
        <p className="text-papel-suave">{s.role === 'local' ? 'Por el local (encargado)' : 'Por la empresa (vendedor como representante)'}</p>
        <p className="text-papel-suave">{fmtDateTime(s.signedAt)}</p>
        {s.geo ? (
          <p className="text-papel-suave">
            Ubicación: {s.geo.lat.toFixed(5)}, {s.geo.lng.toFixed(5)} (±{s.geo.accuracy} m)
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ContractPage() {
  const { id = '' } = useParams();
  const { ctx, actor, p } = useLine();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const fromHub = (useLocation().state as { from?: string } | null)?.from === 'contratos';
  const { data, error, loading } = useAsync(() => getContract(ctx, id), [ctx, id]);
  const pending = data?.contract.status === 'enviado';
  // Si administración activó otra plantilla después de preparar este contrato, se avisa.
  const active = useAsync(async () => (pending ? getActiveTemplate(ctx, 'consignacion') : null), [ctx, pending]);
  if (loading && !data) return <Loading rows={5} />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const { contract, store, seller } = data;
  const canSign = contract.status === 'enviado' && !actor.readOnly && (actor.role === 'admin' || (actor.role === 'seller' && store.sellerId === actor.userId));
  const canReissue = !actor.readOnly && (actor.role === 'admin' || (actor.role === 'seller' && store.sellerId === actor.userId)) && store.status !== 'cerrado';
  return (
    <>
      <PageHeader
        back={
          fromHub
            ? { to: p('contratos'), label: actor.role === 'store' ? 'Mis contratos' : 'Contratos' }
            : { to: actor.role === 'store' ? p() : p(`locales/${store.id}`), label: actor.role === 'store' ? 'Mi tienda' : store.name }
        }
        title="Contrato de consignación"
        subtitle={`${store.name} · versión ${contract.version}`}
        actions={
          <>
            {/* Con plantilla PDF, el visor ya tiene «Descargar PDF»: no hace falta la versión imprimible. */}
            {contract.templateId ? null : (
              <LinkButton to={p(`contratos/${contract.id}/imprimir`)} icon={Printer}>
                Imprimible / PDF
              </LinkButton>
            )}
            {canReissue && contract.status !== 'anulado' ? (
              <Button
                variant="ghost"
                icon={RefreshCw}
                busy={busy}
                onClick={() =>
                  void run(async () => {
                    const c = await issueContract(ctx, store.id);
                    nav(p(`contratos/${c.id}`));
                  }, 'Nueva versión lista para firmar.')
                }
              >
                {contract.status === 'enviado' ? 'Preparar de nuevo' : 'Nueva versión'}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Pill tone={contract.status === 'firmado' ? 'ok' : contract.status === 'anulado' ? 'danger' : 'warn'} dot>
          {contract.status === 'firmado' ? `Firmado el ${fmtDate(contract.signedAt!)}` : contract.status === 'anulado' ? 'Anulado (hay una versión más nueva)' : 'Por firmar'}
        </Pill>
        {/* Texto largo: en un teléfono tiene que poder partirse en varias líneas (una «pill» no se parte). */}
        <span className="rounded-xl bg-warn-soft px-3 py-1.5 text-sm font-semibold text-ink">{CONTRACT_DISCLAIMER}</span>
      </div>
      {canReissue && contract.status === 'enviado' && active.data && active.data.id !== contract.templateId ? (
        <p className="mb-4 rounded-xl bg-accent-soft px-3 py-2 text-sm text-ink">
          Hay una plantilla de contrato más nueva: «{active.data.name}» (versión {active.data.version}). Toca «Preparar de nuevo» para que este contrato la use.
        </p>
      ) : null}
      {contract.templateId ? (
        <ContractPdfView contract={contract} store={store} sellerName={seller?.name ?? ''} />
      ) : (
        <ContractDocument contract={contract} />
      )}
      {canSign ? <SignForm contract={contract} managerName={store.managerName} sellerName={seller?.name ?? ''} /> : null}
    </>
  );
}

function SignForm({ contract, managerName, sellerName }: { contract: Contract; managerName: string; sellerName: string }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [localName, setLocalName] = useState(managerName);
  const [companyName, setCompanyName] = useState(sellerName);
  const [localSig, setLocalSig] = useState<string | null>(null);
  const [companySig, setCompanySig] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [withGeo, setWithGeo] = useState(true);
  const ready = localSig && companySig && consent && localName.trim().length > 2 && companyName.trim().length > 2;
  return (
    <Card className="mx-auto mt-6 max-w-[70ch] p-4 sm:p-6" aria-label="Firmar el contrato">
      <h2 className="flex items-center gap-2 font-display text-2xl font-semibold">
        <FileSignature className="h-6 w-6 text-accent" aria-hidden /> Firmar en este teléfono
      </h2>
      <p className="mt-1 text-muted">Firman los dos: primero el encargado del local y después el vendedor, en nombre de la empresa. Es una firma de demostración: queda el trazo, el nombre, la fecha y la hora.</p>
      <form
        className="mt-5 grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const geo = withGeo ? await askLocation() : undefined;
            await signContract(ctx, contract.id, {
              local: { name: localName, image: localSig ?? '', geo },
              empresa: { name: companyName, image: companySig ?? '', geo },
              consent,
            });
          }, 'Contrato firmado. Administración ya tiene el aviso para aprobar el local.');
        }}
      >
        <fieldset className="grid gap-3 rounded-2xl border border-line p-4">
          <legend className="px-1 font-bold">1 · Encargado del local</legend>
          <TextInput label="Nombre completo" value={localName} onChange={(e) => setLocalName(e.target.value)} autoComplete="name" />
          <SignatureField label="Firma del encargado" onChange={setLocalSig} />
        </fieldset>
        <fieldset className="grid gap-3 rounded-2xl border border-line p-4">
          <legend className="px-1 font-bold">2 · Vendedor, por la empresa</legend>
          <TextInput label="Nombre completo" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          <SignatureField label="Firma del vendedor" onChange={setCompanySig} />
        </fieldset>
        <label className="flex items-start gap-3 rounded-2xl bg-surface-2 p-4">
          <input type="checkbox" className="mt-1 h-5 w-5 flex-none" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            <span className="font-semibold">Las dos partes aceptan firmar electrónicamente</span>
            <span className="block text-sm text-muted">Le dan a esta firma el mismo valor que a una firma en papel, como dice la cláusula «Firma electrónica» del contrato.</span>
          </span>
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={withGeo} onChange={(e) => setWithGeo(e.target.checked)} />
          <MapPin className="h-4 w-4 text-accent" aria-hidden /> Guardar la ubicación de la firma (si el teléfono la da)
        </label>
        <Button type="submit" variant="primary" big icon={ShieldCheck} busy={busy} disabled={!ready}>
          Firmar contrato
        </Button>
        {!ready ? <p className="text-sm text-muted">Faltan {[!localSig && 'la firma del encargado', !companySig && 'la firma del vendedor', !consent && 'aceptar la firma electrónica'].filter(Boolean).join(', ')}.</p> : null}
      </form>
    </Card>
  );
}

export function ContractPrintPage() {
  const { id = '' } = useParams();
  const { ctx, p } = useLine();
  const { data, error, loading } = useAsync(() => getContract(ctx, id), [ctx, id]);
  if (loading && !data) return <Loading rows={5} />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <LinkButton to={p(`contratos/${data.contract.id}`)} variant="ghost">
          ‹ Volver al contrato
        </LinkButton>
        {data.contract.templateId ? null : (
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>
            Imprimir o guardar como PDF
          </Button>
        )}
      </div>
      {data.contract.templateId ? (
        <>
          <p className="no-print mb-3 rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-ink">{CONTRACT_DISCLAIMER}</p>
          <ContractPdfView contract={data.contract} store={data.store} sellerName={data.seller?.name ?? ''} />
        </>
      ) : (
        <ContractDocument contract={data.contract} />
      )}
    </>
  );
}
