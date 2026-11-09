// El estado del servidor en la cabecera: al día, subiendo, cuántos cambios faltan subir o sin
// señal. Al tocarlo: los detalles, «Sincronizar ahora» y «Cerrar sesión».
import { CloudAlert, CloudCheck, CloudOff, CloudUpload, KeyRound, LogOut, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { type Fase, sincronizar } from '../../servidor/sincronizar';
import { cerrarSesion } from '../../services/acceso';
import { conServidor } from '../../services/puerta';
import { Button, Sheet } from '../../ui/kit';
import { errorText, useToast } from '../../ui/toast';
import { useEstadoSync, useSesionServidor } from './hooks';

const ROL: Record<string, string> = { admin: 'Administración', direccion: 'Dirección', seller: 'Vendedor', store: 'Local' };

// Sin luxon: esto va en la portada y debe ser liviano.
const HORA = new Intl.DateTimeFormat('es-US', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtCuando = (iso: string) => HORA.format(new Date(iso));

function apariencia(fase: Fase, pendientes: number): { icon: typeof CloudCheck; corto: string; tono: string } {
  switch (fase) {
    case 'trabajando':
      return { icon: RefreshCw, corto: 'Sincronizando…', tono: 'text-muted' };
    case 'sin-conexion':
      return { icon: CloudOff, corto: pendientes ? `Sin señal · ${pendientes} por subir` : 'Sin señal', tono: 'text-warn' };
    case 'sesion-vencida':
      return { icon: KeyRound, corto: 'Vuelve a entrar', tono: 'text-danger' };
    case 'sin-acceso':
      return { icon: KeyRound, corto: 'Sin acceso', tono: 'text-danger' };
    case 'error':
      return { icon: CloudAlert, corto: 'No se pudo sincronizar', tono: 'text-danger' };
    default:
      return pendientes ? { icon: CloudUpload, corto: `${pendientes} por subir`, tono: 'text-warn' } : { icon: CloudCheck, corto: 'Al día', tono: 'text-ok' };
  }
}

export function EstadoServidor() {
  const sesion = useSesionServidor();
  const estado = useEstadoSync();
  const [open, setOpen] = useState(false);
  if (!conServidor() || !sesion) return null;
  const a = apariencia(estado.fase, estado.pendientes);
  const Icon = a.icon;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-ghost min-w-0 px-2.5"
        aria-label={`Servidor: ${a.corto}`}
        data-testid="estado-servidor"
        data-fase={estado.fase}
      >
        <Icon className={`h-5 w-5 flex-none ${a.tono} ${estado.fase === 'trabajando' ? 'animate-spin' : ''}`} aria-hidden />
        <span className="hidden truncate text-sm sm:inline">{a.corto}</span>
      </button>
      <DetalleServidor open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function DetalleServidor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sesion = useSesionServidor();
  const estado = useEstadoSync();
  const nav = useNavigate();
  const { push } = useToast();
  const [saliendo, setSaliendo] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const a = apariencia(estado.fase, estado.pendientes);

  const salir = async () => {
    setSaliendo(true);
    try {
      await cerrarSesion();
      onClose();
      nav('/');
    } catch (e) {
      push('error', errorText(e));
    } finally {
      setSaliendo(false);
      setConfirmar(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Servidor">
      <div className="grid gap-4">
        <div className="rounded-2xl border border-line bg-surface-2 p-4">
          <p className="font-bold text-ink">{sesion?.cuenta?.nombre || sesion?.usuario.correo}</p>
          <p className="text-sm text-muted">
            {sesion?.usuario.correo} · {ROL[sesion?.cuenta?.rol ?? ''] ?? ''}
          </p>
        </div>
        <div className="grid gap-1" role="status">
          <p className={`font-bold ${a.tono}`}>{a.corto}</p>
          {estado.mensaje ? <p className="text-ink">{estado.mensaje}</p> : null}
          {estado.progreso ? <p className="text-sm text-muted">{estado.progreso}</p> : null}
          <p className="text-sm text-muted">
            {estado.ultimo ? `Última vez al día: ${fmtCuando(estado.ultimo)}.` : 'Todavía no se sincronizó en esta sesión.'} La app guarda primero en este teléfono: sin señal sigue
            funcionando y sube lo pendiente cuando vuelve.
          </p>
        </div>
        {estado.rechazos.length ? (
          <div className="rounded-2xl border border-line bg-warn-soft p-4">
            <p className="font-bold text-ink">El servidor no aceptó {estado.rechazos.length === 1 ? 'un registro' : `${estado.rechazos.length} registros`}</p>
            <p className="text-sm text-muted">Quedan solo en este teléfono. Si los corriges y guardas otra vez, se vuelven a subir.</p>
            <ul className="mt-2 grid gap-1 text-sm">
              {estado.rechazos.slice(0, 8).map((r) => (
                <li key={r.clave}>
                  <span className="font-semibold">{r.clave}</span>: {r.mensaje}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {estado.fase === 'sesion-vencida' || estado.fase === 'sin-acceso' ? (
          <Button variant="primary" icon={KeyRound} onClick={() => void salir()} busy={saliendo}>
            Volver a entrar
          </Button>
        ) : (
          <Button variant="primary" icon={RefreshCw} busy={estado.fase === 'trabajando'} onClick={() => void sincronizar()}>
            Sincronizar ahora
          </Button>
        )}
        {confirmar ? (
          <div className="grid gap-2 rounded-2xl border border-line p-4">
            <p className="text-ink">
              Hay {estado.pendientes} {estado.pendientes === 1 ? 'cambio que no subió' : 'cambios que no subieron'} (sin señal). Si sales, se quedan en este teléfono y suben cuando
              alguien de Administración vuelva a entrar aquí.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" icon={LogOut} busy={saliendo} onClick={() => void salir()}>
                Salir igual
              </Button>
              <Button variant="ghost" onClick={() => setConfirmar(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" icon={LogOut} busy={saliendo} onClick={() => (estado.pendientes ? setConfirmar(true) : void salir())}>
            Cerrar sesión
          </Button>
        )}
      </div>
    </Sheet>
  );
}
