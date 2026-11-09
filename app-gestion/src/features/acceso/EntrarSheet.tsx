// Entrar con correo y contraseña. La primera vez que el teléfono se conecta, si este teléfono y el
// servidor tienen datos distintos, se pregunta qué hacer (ver `DecidirConexion`).
import { CloudDownload, CloudUpload, Download, KeyRound, LogIn } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { type Diferencias, type Entrada, decidirConexion, entrarConCorreo } from '../../services/acceso';
import { Button, Sheet, TextInput } from '../../ui/kit';
import { errorText, useToast } from '../../ui/toast';
import { useEstadoSync } from './hooks';
import { descargarCopia } from './copia';

export function EntrarSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decidir, setDecidir] = useState<Diferencias | null>(null);
  const sync = useEstadoSync();

  const seguir = (r: Entrada) => {
    if (r.tipo === 'decidir') {
      setDecidir(r.diferencias);
      return;
    }
    setClave('');
    onClose();
    nav(r.destino);
  };

  const enviar = async () => {
    setError(null);
    setBusy(true);
    try {
      seguir(await entrarConCorreo(correo, clave));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title={decidir ? 'Este teléfono y el servidor' : 'Entrar'}>
      {decidir ? (
        <DecidirConexion diferencias={decidir} onListo={seguir} />
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
        >
          <p className="text-muted">Entra con tu correo y tu contraseña. Lo que cargues se guarda en el servidor y lo ven las demás personas del programa.</p>
          <TextInput label="Correo" type="email" autoComplete="username" inputMode="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required />
          <TextInput label="Contraseña" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} required />
          {error ? (
            <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-semibold text-danger">
              {error}
            </p>
          ) : null}
          {busy && sync.progreso ? <p className="text-sm text-muted">{sync.progreso}</p> : null}
          <Button type="submit" variant="primary" big icon={LogIn} busy={busy}>
            Entrar
          </Button>
          <p className="flex items-start gap-2 text-sm text-muted">
            <KeyRound className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
            ¿No tienes cuenta o se te olvidó la contraseña? Pídele a Administración una invitación: con el link pones tu contraseña.
          </p>
        </form>
      )}
    </Sheet>
  );
}

/** La primera conexión de un teléfono con datos distintos de los del servidor: la persona decide. */
export function DecidirConexion({ diferencias, onListo }: { diferencias: Diferencias; onListo: (r: Entrada) => void }) {
  const { push } = useToast();
  const sync = useEstadoSync();
  const [busy, setBusy] = useState<'servidor' | 'equipo' | 'copia' | null>(null);
  const { soloAqui, distintos, soloServidor, puedeSubir } = diferencias;

  const elegir = async (eleccion: 'servidor' | 'equipo') => {
    setBusy(eleccion);
    try {
      onListo(await decidirConexion(eleccion));
    } catch (e) {
      push('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const copia = async () => {
    setBusy('copia');
    try {
      await descargarCopia('copia-de-este-telefono');
      push('ok', 'Copia descargada.');
    } catch (e) {
      push('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4" data-testid="decidir-conexion">
      <p className="text-ink">Es la primera vez que este teléfono se conecta, y tiene datos que no están en el servidor:</p>
      <ul className="grid gap-1 rounded-2xl border border-line bg-surface-2 p-4 text-ink">
        <li>
          <b className="tabular">{soloAqui}</b> {soloAqui === 1 ? 'registro está' : 'registros están'} solo en este teléfono.
        </li>
        <li>
          <b className="tabular">{distintos}</b> {distintos === 1 ? 'registro es distinto' : 'registros son distintos'} en los dos lados.
        </li>
        <li>
          <b className="tabular">{soloServidor}</b> {soloServidor === 1 ? 'registro está' : 'registros están'} solo en el servidor.
        </li>
      </ul>
      <p className="text-muted">
        {puedeSubir
          ? 'Si este es el teléfono donde cargaste los datos, súbelos: lo del servidor que falta aquí también se queda. Si no, usa lo del servidor. Antes, descarga una copia de este teléfono por si acaso.'
          : 'Este teléfono va a quedar igual al servidor. Antes, descarga una copia de lo que hay aquí por si acaso.'}
      </p>
      <Button icon={Download} busy={busy === 'copia'} disabled={busy !== null} onClick={() => void copia()}>
        Descargar copia de este teléfono
      </Button>
      <div className="grid gap-2 sm:grid-cols-2">
        {puedeSubir ? (
          <Button variant="primary" icon={CloudUpload} busy={busy === 'equipo'} disabled={busy !== null} onClick={() => void elegir('equipo')}>
            Subir lo de este teléfono
          </Button>
        ) : null}
        <Button variant={puedeSubir ? 'secondary' : 'primary'} icon={CloudDownload} busy={busy === 'servidor'} disabled={busy !== null} onClick={() => void elegir('servidor')}>
          Usar lo del servidor
        </Button>
      </div>
      {busy && sync.progreso ? <p className="text-sm text-muted">{sync.progreso}</p> : null}
    </div>
  );
}
