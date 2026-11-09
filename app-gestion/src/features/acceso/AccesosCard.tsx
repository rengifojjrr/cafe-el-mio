// Administración (con el servidor): quién entra con contraseña, las invitaciones abiertas, invitar a
// alguien (Administración o Dirección) y quitar o devolver el acceso.
import { Ban, Copy, KeyRound, MessageCircle, RotateCcw, UserPlus, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { whatsappUrl } from '../../domain/invitation';
import { fmtDate, fmtDateTime } from '../../lib/time';
import { type CuentaConAcceso, anularInvitacion, cambiarAcceso, invitar, listarAccesos } from '../../services/acceso-admin';
import { conServidor } from '../../services/puerta';
import { Button, ErrorBox, Loading, Pill, Section, SelectInput, Sheet, TextInput } from '../../ui/kit';
import { errorText, useAction, useToast } from '../../ui/toast';
import { useSesionServidor } from './hooks';

const ROL: Record<string, string> = { admin: 'Administración', direccion: 'Dirección', seller: 'Vendedor', store: 'Local' };

export function AccesosCard() {
  const { actor } = useLine();
  const sesion = useSesionServidor();
  const [tick, setTick] = useState(0);
  const datos = useAsync(() => (conServidor() && sesion && actor.role === 'admin' ? listarAccesos() : Promise.resolve(null)), [sesion?.usuario.id, tick, actor.role]);
  const { run, busy } = useAction();
  const [invitando, setInvitando] = useState(false);
  if (!conServidor() || !sesion || actor.role !== 'admin') return null;
  const recargar = () => setTick((t) => t + 1);
  const d = datos.data;
  const canWrite = !actor.readOnly;

  const acceso = (c: CuentaConAcceso) =>
    void run(
      async () => {
        await cambiarAcceso(c.usuario, !c.activa);
        recargar();
      },
      c.activa ? `${c.nombre || c.correo} ya no entra.` : `${c.nombre || c.correo} vuelve a entrar.`,
    );

  return (
    <Section
      title="Acceso con contraseña"
      actions={
        canWrite ? (
          <Button icon={UserPlus} onClick={() => setInvitando(true)}>
            Invitar
          </Button>
        ) : null
      }
    >
      <p className="mb-3 text-muted">
        Quién entra al servidor del programa con su correo y su contraseña. Por ahora entran Administración y Dirección; vendedores y locales, en la próxima etapa.
      </p>
      {datos.error ? <ErrorBox error={datos.error} /> : null}
      {datos.loading && !d ? <Loading rows={2} /> : null}
      {d ? (
        <ul className="grid gap-2" aria-label="Cuentas con acceso">
          {d.cuentas.map((c) => (
            <li key={c.usuario} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-ink">
                  {c.nombre || c.correo} {c.yo ? <span className="text-sm font-normal text-muted">(tú)</span> : null}
                </span>
                <span className="block truncate text-sm text-muted">
                  {ROL[c.rol]} · {c.correo}
                  {c.ultima_entrada ? ` · entró el ${fmtDateTime(c.ultima_entrada)}` : ''}
                </span>
              </span>
              {c.activa ? <Pill tone="ok">Entra</Pill> : <Pill tone="danger">Sin acceso</Pill>}
              {canWrite && !c.yo ? (
                <Button variant="ghost" icon={c.activa ? Ban : RotateCcw} busy={busy} onClick={() => acceso(c)}>
                  {c.activa ? 'Quitar acceso' : 'Devolver acceso'}
                </Button>
              ) : null}
            </li>
          ))}
          {d.invitaciones.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-ink">{i.nombre}</span>
                <span className="block truncate text-sm text-muted">
                  {ROL[i.rol]} · {i.correo} · {i.estado === 'vigente' ? `invitación hasta el ${fmtDate(i.vence_en)}` : 'la invitación venció'}
                </span>
              </span>
              <Pill tone={i.estado === 'vigente' ? 'info' : 'warn'}>{i.estado === 'vigente' ? 'Invitada' : 'Vencida'}</Pill>
              {canWrite ? (
                <Button
                  variant="ghost"
                  icon={XCircle}
                  busy={busy}
                  onClick={() =>
                    void run(async () => {
                      await anularInvitacion(i.id);
                      recargar();
                    }, 'Invitación anulada.')
                  }
                >
                  Anular
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <InvitarSheet
        open={invitando}
        onClose={() => {
          setInvitando(false);
          recargar();
        }}
      />
    </Section>
  );
}

function InvitarSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ctx, config } = useLine();
  const { push } = useToast();
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [rol, setRol] = useState<'admin' | 'direccion'>('direccion');
  const [dias, setDias] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ link: string; venceEn: string; nombre: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setHecho(null);
      setError(null);
    }
  }, [open]);

  const crear = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await invitar(ctx, { nombre, correo, rol, dias });
      setHecho({ ...r, nombre });
      setNombre('');
      setCorreo('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const mensaje = hecho
    ? `Hola ${hecho.nombre}: te invito a la app de ${config.companyName || 'Grupo Miami'} · Tabaco. Abre este link, pon tu contraseña y entras: ${hecho.link} (vale hasta el ${fmtDate(hecho.venceEn)}).`
    : '';

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(hecho?.link ?? '');
      push('ok', 'Link copiado.');
    } catch {
      push('info', 'Mantén el dedo sobre el link para copiarlo.');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Invitar al programa">
      {hecho ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-label="Invitación lista para mandar">
          <p className="text-ink">
            Listo. Manda este link a <b>{hecho.nombre}</b>: sirve una sola vez y vale hasta el {fmtDate(hecho.venceEn)}. No lo publiques: quien lo abra pone la contraseña de esa cuenta.
          </p>
          <label className="grid gap-1.5">
            <span className="field-label">Link de la invitación</span>
            <input className="input text-sm" readOnly value={hecho.link} onFocus={(e) => e.currentTarget.select()} aria-label="Link de la invitación" />
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button icon={Copy} onClick={() => void copiar()}>
              Copiar link
            </Button>
            <a className="btn btn-primary" href={whatsappUrl(mensaje)} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden /> Mandar por WhatsApp
            </a>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Listo
          </Button>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void crear();
          }}
        >
          <TextInput label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" required />
          <TextInput label="Correo" type="email" inputMode="email" value={correo} onChange={(e) => setCorreo(e.target.value)} autoComplete="off" required />
          <SelectInput
            label="Entra como"
            value={rol}
            onChange={(e) => setRol(e.target.value as 'admin' | 'direccion')}
            options={[
              { value: 'direccion', label: 'Dirección (solo mira las cifras)' },
              { value: 'admin', label: 'Administración (carga y cambia todo)' },
            ]}
          />
          <SelectInput
            label="La invitación vale"
            value={String(dias)}
            onChange={(e) => setDias(Number(e.target.value))}
            options={[1, 3, 7, 14].map((d) => ({ value: String(d), label: d === 1 ? '1 día' : `${d} días` }))}
          />
          {error ? (
            <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-semibold text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" icon={KeyRound} busy={busy}>
            Crear invitación
          </Button>
          <p className="text-sm text-muted">
            Si la persona olvida su contraseña, invítala otra vez: con el link nuevo pone una nueva. Si su correo ya tenía cuenta en otra app de este servidor, entra con la contraseña de
            esa app.
          </p>
        </form>
      )}
    </Sheet>
  );
}
