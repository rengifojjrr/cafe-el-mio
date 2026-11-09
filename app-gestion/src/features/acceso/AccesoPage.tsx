// #/acceso/<código>: quien recibe una invitación al programa pone su contraseña y entra. Si ya
// tenía cuenta en el servidor (de otra app), entra con la suya y la invitación se le enlaza.
import { KeyRound, LogIn, TimerOff, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAsync } from '../../app/hooks';
import { fmtDate } from '../../lib/time';
import { type Diferencias, type Entrada, type InvitacionServidor, aceptarInvitacion, enlazarInvitacion, verInvitacion } from '../../services/acceso';
import { LineMark } from '../../ui/brand';
import { Button, Loading, TextInput } from '../../ui/kit';
import { errorText } from '../../ui/toast';
import { DecidirConexion } from './EntrarSheet';
import { useEstadoSync } from './hooks';

const ROL = { admin: 'Administración', direccion: 'Dirección' } as const;

export function AccesoPage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const inv = useAsync(() => verInvitacion(token), [token]);
  const sync = useEstadoSync();
  const [clave, setClave] = useState('');
  const [otra, setOtra] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decidir, setDecidir] = useState<Diferencias | null>(null);
  const [entrando, setEntrando] = useState(false);
  // Lo que dijo el servidor al abrir el link: al aceptar, la invitación pasa a «usada» y la pantalla
  // se vuelve a pedir sola; no debe decir «ya se usó» justo cuando la persona está entrando.
  const [fija, setFija] = useState<InvitacionServidor | null>(null);
  useEffect(() => {
    if (inv.data && !fija) setFija(inv.data);
  }, [inv.data, fija]);

  useEffect(() => {
    document.documentElement.dataset.line = 'tabaco';
    return () => {
      delete document.documentElement.dataset.line;
    };
  }, []);

  const seguir = (r: Entrada) => {
    if (r.tipo === 'decidir') setDecidir(r.diferencias);
    else {
      setEntrando(true);
      nav(r.destino, { replace: true });
    }
  };

  const i = fija ?? inv.data;
  const yaTiene = i?.cuenta === 'otra';

  const enviar = async () => {
    setError(null);
    if (!yaTiene) {
      if (clave.length < 8) return setError('La contraseña necesita 8 caracteres por lo menos.');
      if (clave !== otra) return setError('Las dos contraseñas no son iguales.');
    }
    setBusy(true);
    try {
      seguir(yaTiene ? await enlazarInvitacion(token, i?.correo ?? '', clave) : await aceptarInvitacion(token, clave));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (entrando) {
    body = (
      <>
        <p className="mb-3 font-semibold text-ink">Entrando…</p>
        <Loading rows={2} />
      </>
    );
  } else if (inv.loading && !i) body = <Loading rows={3} />;
  else if (inv.error && !i) {
    body = (
      <>
        <h1 className="font-display text-2xl font-semibold">No se pudo abrir la invitación</h1>
        <p className="mt-2 text-muted">{errorText(inv.error)}</p>
        <Button className="mt-4" onClick={inv.reload}>
          Probar otra vez
        </Button>
      </>
    );
  } else if (decidir) {
    body = (
      <>
        <h1 className="mb-3 font-display text-2xl font-semibold">Este teléfono y el servidor</h1>
        <DecidirConexion diferencias={decidir} onListo={seguir} />
      </>
    );
  } else if (!i || i.estado !== 'vigente') {
    const vencida = i?.estado === 'vencida';
    const Icon = vencida ? TimerOff : XCircle;
    body = (
      <>
        <Icon className="mx-auto h-8 w-8 text-warn" aria-hidden />
        <h1 className="mt-2 font-display text-2xl font-semibold">{vencida ? 'La invitación venció' : i?.estado === 'usada' ? 'Esta invitación ya se usó' : 'Esta invitación no vale'}</h1>
        <p className="mt-2 text-muted">
          {i?.estado === 'usada'
            ? 'Si eres tú, entra con tu correo y tu contraseña desde la portada.'
            : 'Pídele a Administración una invitación nueva: cada link sirve una sola vez y por pocos días.'}
        </p>
        <Button variant="primary" className="mt-4" icon={LogIn} onClick={() => nav('/')}>
          Ir a la portada
        </Button>
      </>
    );
  } else {
    body = (
      <form
        className="grid gap-4 text-left"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <div>
          <h1 className="font-display text-2xl font-semibold">Hola, {i.nombre}</h1>
          <p className="mt-1 text-muted">
            Te invitaron como <b className="text-ink">{ROL[i.rol ?? 'direccion']}</b> al programa de Tabaco. Vale hasta el {fmtDate(i.vence_en ?? '')}.
          </p>
        </div>
        <TextInput label="Correo" type="email" autoComplete="username" value={i.correo ?? ''} readOnly />
        {yaTiene ? (
          <>
            <p className="text-muted">Ya tienes una cuenta en el servidor con este correo: entra con tu contraseña de siempre.</p>
            <TextInput label="Tu contraseña" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} required />
          </>
        ) : (
          <>
            <TextInput
              label={i.cuenta === 'tabaco' ? 'Tu contraseña nueva' : 'Crea tu contraseña'}
              type="password"
              autoComplete="new-password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              hint="8 caracteres o más. No la compartas: con ella se entra a los datos de la empresa."
              required
            />
            <TextInput label="Repítela" type="password" autoComplete="new-password" value={otra} onChange={(e) => setOtra(e.target.value)} required />
          </>
        )}
        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-semibold text-danger">
            {error}
          </p>
        ) : null}
        {busy && sync.progreso ? <p className="text-sm text-muted">{sync.progreso}</p> : null}
        <Button type="submit" variant="primary" big icon={yaTiene ? LogIn : KeyRound} busy={busy}>
          {yaTiene ? 'Entrar' : 'Guardar y entrar'}
        </Button>
      </form>
    );
  }

  return (
    <div className="mx-auto grid min-h-dvh max-w-md place-items-center p-4">
      <div className="glass w-full p-6 text-center">
        <div className="mb-4 flex justify-center">
          <LineMark line="tabaco" />
        </div>
        {body}
      </div>
    </div>
  );
}
