// «Invitar» a un vendedor (Usuarios) o a un local (su ficha): link con QR y texto para WhatsApp.
// Sin la nube, el link solo abre la cuenta en este navegador (ver services/invitations.ts).
import { Copy, Link2, MessageCircle, Send, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { DEFAULT_INVITATION_DAYS, INVITATION_DAYS, INVITATION_STATE_LABEL, invitationLink, invitationMessage, whatsappUrl } from '../../domain/invitation';
import { fmtDate, fmtDateTime } from '../../lib/time';
import { type InvitationView, type InviteTarget, createInvitation, listInvitations, revokeInvitation } from '../../services/invitations';
import { Button, Pill, SelectInput, Sheet } from '../../ui/kit';
import { useAction, useToast } from '../../ui/toast';

/** Dirección de la app tal como la abrió quien invita (publicada o de prueba). */
function appBase(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export function InviteButton({ target, name, className = '' }: { target: InviteTarget; name: string; className?: string }) {
  const { actor } = useLine();
  const [open, setOpen] = useState(false);
  if (actor.readOnly) return null;
  return (
    <>
      <Button icon={Send} onClick={() => setOpen(true)} className={className}>
        Invitar
      </Button>
      <InviteSheet open={open} onClose={() => setOpen(false)} target={target} name={name} />
    </>
  );
}

function QrImage({ text, label }: { text: string; label: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    void import('qrcode').then((QR) => {
      const css = getComputedStyle(document.documentElement);
      return QR.toDataURL(text, {
        margin: 1,
        width: 360,
        color: { dark: css.getPropertyValue('--qr-oscuro').trim() || undefined, light: css.getPropertyValue('--qr-claro').trim() || undefined },
      }).then((url) => {
        if (alive) setSrc(url);
      });
    });
    return () => {
      alive = false;
    };
  }, [text]);
  return <div className="h-44 w-44 flex-none overflow-hidden rounded-xl bg-papel p-1.5">{src ? <img src={src} alt={label} width={168} height={168} /> : null}</div>;
}

const STATE_TONE = { vigente: 'ok', vencida: 'warn', revocada: 'danger' } as const;

export function InviteSheet({ open, onClose, target, name }: { open: boolean; onClose: () => void; target: InviteTarget; name: string }) {
  const { ctx, config } = useLine();
  const { run, busy } = useAction();
  const { push } = useToast();
  const [days, setDays] = useState<number>(DEFAULT_INVITATION_DAYS);
  const [shown, setShown] = useState<string | null>(null);
  const key = target.kind === 'seller' ? target.userId : target.storeId;
  const list = useAsync(() => (open ? listInvitations(ctx, target) : Promise.resolve([] as InvitationView[])), [ctx, open, key]);
  const current = (list.data ?? []).find((i) => i.id === shown) ?? (list.data ?? []).find((i) => i.state === 'vigente');
  const link = current ? invitationLink(appBase(), current.token) : '';
  const message = current
    ? invitationMessage({ name, company: config.companyName, lineName: config.name, role: current.role, link, expires: fmtDate(current.expiresAt) })
    : '';

  const create = () =>
    void run(async () => {
      const inv = await createInvitation(ctx, target, { days });
      setShown(inv.id);
      return inv;
    }, 'Invitación creada.');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      push('ok', 'Link copiado.');
    } catch {
      push('info', 'Mantén el dedo sobre el link para copiarlo.');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Invitar: ${name}`}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <p className="text-muted">
          {target.kind === 'seller' ? 'Manda este link a la persona para que abra la app con su cuenta de vendedor.' : 'Manda este link al encargado para que abra la app con la cuenta de su tienda (y su lista de precios).'}
        </p>
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
          <SelectInput label="Vale por" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} options={INVITATION_DAYS.map((d) => ({ value: String(d), label: d === 1 ? '1 día' : `${d} días` }))} />
          <Button variant="primary" icon={Link2} busy={busy} onClick={create}>
            Crear invitación
          </Button>
        </div>

        {current ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-2xl border border-line bg-surface-2 p-4" aria-label="Invitación lista para mandar">
            <div className="flex flex-wrap items-center gap-4">
              <QrImage text={link} label={`Código QR de la invitación para ${name}`} />
              <p className="min-w-0 flex-1 text-sm text-muted">
                Escanéalo con la cámara o manda el link. Vale hasta el <b className="text-ink">{fmtDate(current.expiresAt)}</b>.
              </p>
            </div>
            <label className="grid gap-1.5">
              <span className="field-label">Link de la invitación</span>
              <input className="input text-sm" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link de la invitación" />
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button icon={Copy} onClick={() => void copy()}>
                Copiar link
              </Button>
              <a className="btn btn-primary" href={whatsappUrl(message)} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden /> Mandar por WhatsApp
              </a>
            </div>
            <p className="text-xs text-muted">
              Hoy cada teléfono guarda sus propios datos: el link abre la cuenta en este teléfono o computadora. En otro teléfono va a pedir la nube (o el archivo de datos que se exporta en la portada).
            </p>
          </div>
        ) : null}

        <div>
          <h3 className="mb-2 font-bold">Invitaciones</h3>
          {(list.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay invitaciones.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2">
              {(list.data ?? []).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2">
                  <button type="button" className="min-h-12 min-w-0 flex-1 text-left" onClick={() => setShown(i.id)} disabled={i.state !== 'vigente'}>
                    <span className="block text-sm font-semibold text-ink">Creada el {fmtDateTime(i.createdAt)}</span>
                    <span className="block text-xs text-muted">
                      {i.state === 'revocada' && i.revokedAt ? `Revocada el ${fmtDate(i.revokedAt)}` : `Vence el ${fmtDate(i.expiresAt)}`}
                      {i.acceptedAt ? ` · usada el ${fmtDate(i.acceptedAt)}` : ''}
                    </span>
                  </button>
                  <Pill tone={STATE_TONE[i.state]}>{INVITATION_STATE_LABEL[i.state]}</Pill>
                  {i.state === 'vigente' ? (
                    <Button variant="ghost" icon={XCircle} onClick={() => void run(() => revokeInvitation(ctx, i.id), 'Invitación revocada: el link ya no abre la cuenta.')}>
                      Revocar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
}
