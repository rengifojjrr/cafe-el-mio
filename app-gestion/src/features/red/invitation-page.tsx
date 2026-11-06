// #/invitacion/<token>: quien recibe el link entra con su cuenta (si la invitación está en este navegador).
import { CloudOff, LogIn, TimerOff, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAsync } from '../../app/hooks';
import { lineConfig } from '../../lines/config';
import { fmtDate } from '../../lib/time';
import { acceptInvitation, checkInvitation, type InvitationOutcome } from '../../services/invitations';
import { LineMark } from '../../ui/brand';
import { Button, Loading } from '../../ui/kit';
import { errorText, useToast } from '../../ui/toast';

/** Texto que pide el encargo para una invitación que no está en este teléfono. */
export const CLOUD_TEXT =
  'Esta invitación necesita la nube: hoy cada teléfono guarda sus propios datos. Pide a administración el archivo de datos (Exportar) o espera a que la app pase a la nube.';

export function InvitationPage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const check = useAsync(() => checkInvitation(token), [token]);

  useEffect(() => {
    delete document.documentElement.dataset.line;
  }, []);

  const o = check.data;
  useEffect(() => {
    if (o?.kind === 'ok') document.documentElement.dataset.line = o.line;
  }, [o]);

  const enter = async () => {
    setBusy(true);
    try {
      const r = await acceptInvitation(token);
      if (r.kind === 'ok') {
        push('ok', `Entraste como ${r.account.name}.`);
        nav(`/${r.line}`);
      }
    } catch (e) {
      push('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-4">
      <div className="glass w-full p-6">
        {check.loading && !o ? <Loading rows={2} /> : null}
        {check.error ? <p className="text-danger">{check.error.message}</p> : null}
        {o ? <Outcome o={o} busy={busy} onEnter={() => void enter()} onHome={() => nav('/')} /> : null}
      </div>
    </main>
  );
}

function Outcome({ o, busy, onEnter, onHome }: { o: InvitationOutcome; busy: boolean; onEnter: () => void; onHome: () => void }) {
  if (o.kind === 'ok') {
    const cfg = lineConfig(o.line);
    return (
      <div className="grid gap-4">
        <LineMark line={o.line} />
        <h1 className="font-display text-3xl font-semibold text-ink">Te invitaron a {cfg.name}</h1>
        <p className="text-muted">
          Vas a entrar como <b className="text-ink">{o.account.name}</b>
          {o.role === 'store' ? `, la cuenta de ${o.storeName ?? 'tu tienda'}` : ', vendedor'}. La invitación vale hasta el {fmtDate(o.expiresAt)}.
        </p>
        <Button variant="primary" big icon={LogIn} busy={busy} onClick={onEnter}>
          Entrar
        </Button>
      </div>
    );
  }
  const map = {
    nube: { icon: CloudOff, title: 'Falta la nube', text: CLOUD_TEXT },
    vencida: { icon: TimerOff, title: 'La invitación venció', text: `Venció el ${o.kind === 'vencida' ? fmtDate(o.expiresAt) : ''}. Pide una nueva a quien te la mandó.` },
    revocada: { icon: XCircle, title: 'La invitación ya no vale', text: 'La revocaron. Pide una nueva a quien te la mandó.' },
    invalida: { icon: XCircle, title: 'Este link no es una invitación', text: 'Revisa que se haya copiado completo, o pide que te lo manden de nuevo.' },
    inactiva: { icon: XCircle, title: 'La cuenta no está activa', text: 'La cuenta de esta invitación ya no está activa. Habla con administración.' },
  } as const;
  const m = map[o.kind];
  return (
    <div className="grid gap-4" role="alert">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-warn-soft text-warn">
        <m.icon className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="font-display text-3xl font-semibold text-ink">{m.title}</h1>
      <p className="text-ink">{m.text}</p>
      <Button onClick={onHome}>Ir a la portada</Button>
    </div>
  );
}
