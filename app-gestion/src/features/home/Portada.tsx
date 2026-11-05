// Portada del ecosistema: las dos líneas como protagonistas, «Entrar como…», el recorrido
// guiado, el QR del link, instalar, restablecer y exportar o importar la demo.
import {
  ArrowRightLeft,
  Compass,
  Crown,
  Download,
  LogIn,
  Moon,
  Pencil,
  RotateCcw,
  Smartphone,
  Sun,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { LineId } from '../../data/types';
import { lineConfig } from '../../lines/config';
import { PUBLIC_URL, brandProductPhoto } from '../../lib/assets';
import { useInstall } from '../../lib/pwa';
import { lineTeaser } from '../../services/teaser';
import { enterAs, exportState, getEcosystem, importState, resetDemo, saveEcosystem } from '../../services/session';
import { AccountPicker } from '../../app/AccountPicker';
import { useAsync } from '../../app/hooks';
import { CigarSilhouette, LineMark } from '../../ui/brand';
import { Button, SampleBadge, Sheet, TextInput } from '../../ui/kit';
import { errorText, useAction, useToast } from '../../ui/toast';
import { useTour } from '../tour/TourProvider';

export function Portada() {
  const eco = useAsync(getEcosystem, []);
  const nav = useNavigate();
  const tour = useTour();
  const { push } = useToast();
  const { run, busy } = useAction();
  const [picker, setPicker] = useState<LineId | 'all' | null>(null);
  const [tourPick, setTourPick] = useState(false);
  const [rename, setRename] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [install, setInstall] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const name = eco.data?.name ?? 'Grupo Miami · Tabaco & Café';
  const [first, ...restName] = name.split('·');

  useEffect(() => {
    delete document.documentElement.dataset.line;
  }, []);

  const goDireccion = async () => {
    try {
      await enterAs('direccion');
      nav('/direccion');
    } catch (e) {
      push('error', errorText(e));
    }
  };

  const doExport = async () => {
    const json = await exportState();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `demo-grupo-miami-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file: File) => {
    await run(async () => importState(await file.text()), 'Listo: la demo quedó como en el respaldo.');
  };

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 pt-5 lg:px-8">
        <span className="font-display text-xl font-semibold">Grupo Miami</span>
        <SampleBadge />
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            icon={eco.data?.theme === 'light' ? Moon : Sun}
            aria-label="Cambiar entre modo claro y oscuro"
            onClick={() => void saveEcosystem({ theme: eco.data?.theme === 'light' ? 'dark' : 'light' })}
          />
          <Button variant="ghost" icon={Pencil} onClick={() => setRename(true)} aria-label="Cambiar el nombre del ecosistema" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-8 pb-28 lg:px-8">
        <section className="max-w-3xl">
          <h1 className="font-display text-[2.6rem] leading-[1.02] font-semibold tracking-tight sm:text-[4rem]">
            {first?.trim()}
            {restName.length ? <span className="block text-muted">{restName.join('·').trim()}</span> : null}
          </h1>
          <p className="mt-4 max-w-[56ch] text-lg text-muted">
            Distribución en consignación y contabilidad del grupo de Miami. Dos apps separadas, cada una con sus datos, su catálogo, su gente y sus cuentas.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="primary" big icon={LogIn} onClick={() => setPicker('all')}>
              Entrar como…
            </Button>
            <Button big icon={Compass} onClick={() => setTourPick(true)}>
              Recorrido guiado
            </Button>
            <Button big icon={Crown} onClick={() => void goDireccion()}>
              Dirección
            </Button>
          </div>
        </section>

        <section className="mt-10 grid gap-4 lg:grid-cols-2" aria-label="Las dos líneas">
          <LineCard line="tabaco" onEnter={() => setPicker('tabaco')} onTour={() => tour.start('tabaco')} />
          <LineCard line="cafe" onEnter={() => setPicker('cafe')} onTour={() => tour.start('cafe')} />
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="glass grid gap-3 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <h2 className="text-lg font-bold">La demo</h2>
              <p className="text-muted">Todo vive en este navegador: las firmas y los pagos son de ejemplo. Para llevar el mismo estado a otro teléfono, expórtalo y vuelve a importarlo allá.</p>
            </div>
            <Button icon={Smartphone} onClick={() => setInstall(true)}>
              Instalar en el teléfono
            </Button>
            <Button icon={RotateCcw} onClick={() => setConfirmReset(true)}>
              Restablecer demo
            </Button>
            <Button icon={Download} onClick={() => void run(doExport, 'Respaldo descargado.')}>
              Exportar (JSON)
            </Button>
            <Button icon={Upload} onClick={() => fileRef.current?.click()} busy={busy}>
              Importar (JSON)
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Elegir respaldo JSON"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImport(f);
                e.target.value = '';
              }}
            />
          </div>
          <QrCard />
        </section>
      </main>

      <Sheet open={picker !== null} onClose={() => setPicker(null)} title="Entrar como…">
        <p className="mb-4 text-muted">Elige cualquier rol para recorrer la app con sus ojos. Siempre tendrás a mano «Cambiar de rol».</p>
        <AccountPicker onDone={() => setPicker(null)} only={picker === 'all' || picker === null ? undefined : picker} />
      </Sheet>

      <Sheet open={tourPick} onClose={() => setTourPick(false)} title="Recorrido guiado">
        <p className="mb-4 text-muted">Siete pasos por línea. La app cambia sola de cuenta en cada paso.</p>
        <div className="grid gap-2">
          {(['tabaco', 'cafe'] as const).map((l) => (
            <button
              key={l}
              type="button"
              data-line={l}
              className="flex min-h-16 items-center justify-between rounded-2xl border border-line bg-surface px-4 text-left hover:border-accent"
              onClick={() => {
                setTourPick(false);
                tour.start(l);
              }}
            >
              <LineMark line={l} size="sm" />
              <ArrowRightLeft className="h-5 w-5 text-accent" aria-hidden />
            </button>
          ))}
        </div>
      </Sheet>

      <RenameSheet open={rename} onClose={() => setRename(false)} current={name} />
      <InstallSheet open={install} onClose={() => setInstall(false)} />

      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title="Restablecer la demo">
        <p className="text-muted">Se borra todo lo que se hizo en este navegador y se cargan otra vez los datos de ejemplo, con fechas de hoy.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            variant="danger"
            icon={RotateCcw}
            busy={busy}
            onClick={() =>
              void run(async () => {
                await resetDemo(new Date(), eco.data?.name);
                setConfirmReset(false);
              }, 'Listo: datos de ejemplo cargados de nuevo.')
            }
          >
            Sí, restablecer
          </Button>
          <Button variant="ghost" onClick={() => setConfirmReset(false)}>
            Cancelar
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function LineCard({ line, onEnter, onTour }: { line: LineId; onEnter: () => void; onTour: () => void }) {
  const cfg = lineConfig(line);
  const teaser = useAsync(() => lineTeaser(line), [line]);
  const t = teaser.data;
  return (
    <article data-line={line} className="relative isolate overflow-hidden rounded-[28px] border border-line bg-bg p-6 sm:p-7" aria-label={`Línea ${cfg.name}`}>
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden style={{ background: 'radial-gradient(40rem 22rem at 100% 0%, var(--bg-glow), transparent 65%)' }} />
      <LineMark line={line} size="lg" />
      <p className="mt-3 max-w-[40ch] text-muted">{cfg.tagline}</p>
      <div className="mt-5 h-16 sm:h-20" aria-hidden>
        {line === 'tabaco' ? (
          <CigarSilhouette lengthIn={7} ringGauge={50} shade="colorado" vitola="Churchill" ruler={false} className="h-full w-auto max-w-full" />
        ) : (
          <img src={brandProductPhoto('cafe-espresso-el-mio-100-arabica')} alt="" className="h-full w-auto rounded-xl object-contain" width={112} height={80} />
        )}
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-3">
        {[
          ['Productos', t?.products],
          ['Locales activos', t?.activeStores],
          ['Vendedores', t?.sellers],
        ].map(([k, v]) => (
          <div key={String(k)}>
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="glow tabular text-2xl font-bold">{v ?? '—'}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="primary" icon={LogIn} onClick={onEnter}>
          Entrar a {cfg.name}
        </Button>
        <Button variant="ghost" icon={Compass} onClick={onTour}>
          Recorrido de 7 pasos
        </Button>
      </div>
    </article>
  );
}

function QrCard() {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    void import('qrcode').then((QR) => {
      const css = getComputedStyle(document.documentElement);
      return QR.toDataURL(PUBLIC_URL, {
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
  }, []);
  return (
    <figure className="glass flex items-center gap-4 p-5 md:flex-col md:items-start">
      <div className="h-32 w-32 flex-none overflow-hidden rounded-xl bg-papel p-1.5">{src ? <img src={src} alt={`Código QR del link ${PUBLIC_URL}`} width={120} height={120} /> : null}</div>
      <figcaption className="max-w-[26ch] text-sm text-muted">
        Escanéalo con la cámara para abrir la app en el teléfono.
        <a className="mt-1 block font-semibold break-all text-ink underline" href={PUBLIC_URL}>
          {PUBLIC_URL.replace('https://', '')}
        </a>
      </figcaption>
    </figure>
  );
}

function RenameSheet({ open, onClose, current }: { open: boolean; onClose: () => void; current: string }) {
  const [value, setValue] = useState(current);
  const { run, busy } = useAction();
  useEffect(() => setValue(current), [current, open]);
  return (
    <Sheet open={open} onClose={onClose} title="Nombre del ecosistema">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await saveEcosystem({ name: value });
            onClose();
          }, 'Nombre guardado.');
        }}
        className="grid gap-4"
      >
        <TextInput label="Nombre" value={value} onChange={(e) => setValue(e.target.value)} hint="Es provisional. Usa «·» para separar el nombre de la descripción." />
        <Button type="submit" variant="primary" busy={busy}>
          Guardar nombre
        </Button>
      </form>
    </Sheet>
  );
}

function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inst = useInstall();
  const { push } = useToast();
  return (
    <Sheet open={open} onClose={onClose} title="Instalar en el teléfono">
      {inst.installed ? (
        <p className="text-muted">Ya la estás usando como app instalada.</p>
      ) : inst.canPrompt ? (
        <div className="grid gap-3">
          <p className="text-muted">Queda como una app más, con su ícono, y abre sin la barra del navegador.</p>
          <Button
            variant="primary"
            icon={Smartphone}
            onClick={async () => {
              const ok = await inst.prompt();
              if (ok) {
                push('ok', 'App instalada.');
                onClose();
              }
            }}
          >
            Instalar
          </Button>
        </div>
      ) : inst.ios ? (
        <ol className="grid list-decimal gap-2 pl-5 text-ink">
          <li>Abre este link en Safari.</li>
          <li>Toca el botón Compartir (el cuadrado con la flecha hacia arriba).</li>
          <li>Elige «Agregar a pantalla de inicio» y toca «Agregar».</li>
        </ol>
      ) : (
        <ol className="grid list-decimal gap-2 pl-5 text-ink">
          <li>Abre este link en Chrome del teléfono.</li>
          <li>Toca el menú ⋮ y elige «Instalar app» o «Agregar a pantalla principal».</li>
        </ol>
      )}
    </Sheet>
  );
}
