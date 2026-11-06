// «Escanear»: lee un código de barras o QR y se lo pasa a quien lo pidió (recibir, contar,
// venta rápida, preparar una entrega, la visita). Siempre se puede escribir el código a mano
// o leerlo de una foto. La cámara (BarcodeDetector o @zxing/browser) se carga aparte, solo al
// abrir el lector, y se apaga al cerrarlo.
import { Camera, CameraOff, Flashlight, FlashlightOff, ImageUp, Keyboard, Loader2, RefreshCw, ScanBarcode } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cleanCode } from '../lib/barcode';
import type { CameraSession } from './camera';
import { Button, Sheet, TextInput } from './kit';
import { errorText, useToast } from './toast';

export interface ScanProps {
  /** Se llama con el código limpio (sin espacios ni guiones). */
  onCode: (code: string) => void | Promise<void>;
  label?: string;
  /** Para contar o recibir: el lector queda abierto después de cada lectura. */
  continuous?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Título de la hoja del lector (por defecto, «Escanear»). */
  title?: string;
  /** Texto corto bajo la cámara: qué pasa con cada lectura. */
  hint?: ReactNode;
  /** Lo último que pasó (para el modo continuo): «+1 mazo de Toro…». */
  feedback?: ReactNode;
  className?: string;
}

/** Botón que abre el lector. */
export function ScanButton({ onCode, label = 'Escanear', continuous, disabled, variant = 'secondary', title, hint, feedback, className }: ScanProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        icon={ScanBarcode}
        className={className}
        onClick={() => {
          primeAudio();
          setOpen(true);
        }}
        disabled={disabled}
      >
        {label}
      </Button>
      <ScanSheet
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        hint={hint}
        feedback={feedback}
        onCode={async (code) => {
          await onCode(code);
          if (!continuous) setOpen(false);
        }}
      />
    </>
  );
}

// ---------- Pitido y vibración al leer ----------

let audio: AudioContext | null = null;

/** Prepara el sonido dentro de un toque (iPhone no deja sonar si no). */
export function primeAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audio ??= new AC();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function beep(): void {
  try {
    primeAudio();
    if (audio) {
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = 1760;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  } catch {
    // Sin sonido no pasa nada.
  }
  try {
    navigator.vibrate?.(50);
  } catch {
    // Algunos navegadores no vibran.
  }
}

/** La misma lectura de la cámara dentro de este tiempo no se cuenta dos veces. */
const REPEAT_MS = 1500;

/** El lector: cámara, «Leer de una foto» y el código escrito a mano. */
export function ScanSheet({
  open,
  onClose,
  onCode,
  title = 'Escanear',
  hint,
  feedback,
  camera = true,
}: {
  open: boolean;
  onClose: () => void;
  onCode: (code: string) => void | Promise<void>;
  title?: string;
  hint?: ReactNode;
  feedback?: ReactNode;
  /** Sin cámara: solo foto y escribir (por ejemplo en una computadora sin cámara). */
  camera?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {open ? <ScanBody onCode={onCode} hint={hint} feedback={feedback} camera={camera} /> : null}
    </Sheet>
  );
}

function ScanBody({ onCode, hint, feedback, camera }: { onCode: (code: string) => void | Promise<void>; hint?: ReactNode; feedback?: ReactNode; camera: boolean }) {
  const { push } = useToast();
  const [manual, setManual] = useState('');
  const [reading, setReading] = useState(false);
  const last = useRef<{ code: string; at: number } | null>(null);
  const busy = useRef(false);

  const handle = useCallback(
    async (raw: string, source: 'camara' | 'foto' | 'mano') => {
      const code = cleanCode(raw);
      if (!code) return;
      if (source === 'camara') {
        const now = Date.now();
        if (busy.current) return;
        if (last.current && last.current.code === code && now - last.current.at < REPEAT_MS) return;
        last.current = { code, at: now };
      }
      if (source !== 'mano') beep();
      busy.current = true;
      try {
        await onCode(code);
      } catch (e) {
        push('error', errorText(e));
      } finally {
        busy.current = false;
      }
    },
    [onCode, push],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // La hoja va en un portal, pero React hace subir el evento por el árbol de componentes: sin
    // esto, escribir un código enviaría también el formulario donde está el botón (la visita).
    e.stopPropagation();
    const input = e.currentTarget.querySelector('input');
    const code = cleanCode(manual);
    if (!code) return;
    setManual('');
    await handle(code, 'mano');
    // Un lector de mano (USB o Bluetooth) escribe el código y Enter: el cursor se queda en el campo
    // para la lectura siguiente.
    if (input?.isConnected) input.focus();
  };

  const fromPhoto = async (file: File) => {
    setReading(true);
    try {
      const { decodeImage } = await import('./camera');
      const text = await decodeImage(file);
      if (!text) {
        push('error', 'No encontré un código en esa foto. Prueba con otra más de cerca, derecha y con buena luz, o escribe el código.');
        return;
      }
      await handle(text, 'foto');
    } catch (e) {
      push('error', errorText(e));
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="grid gap-4" onPointerDown={primeAudio}>
      {camera ? <CameraPane onText={(t) => void handle(t, 'camara')} /> : null}
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      {feedback ? (
        <div className="rounded-2xl bg-accent-soft px-3 py-2 font-semibold text-ink" aria-live="polite" data-testid="lector-ultimo">
          {feedback}
        </div>
      ) : null}
      <PhotoButton busy={reading} onFile={(f) => void fromPhoto(f)} />
      <form className="grid gap-3" onSubmit={(e) => void submit(e)}>
        <TextInput
          label="Escribe el código"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="Código de barras, SKU o número de caja"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          data-testid="codigo-manual"
        />
        <Button type="submit" variant="primary" icon={Keyboard} disabled={!manual.trim()}>
          Usar este código
        </Button>
      </form>
    </div>
  );
}

function PhotoButton({ busy, onFile }: { busy: boolean; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button icon={busy ? Loader2 : ImageUp} onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? 'Buscando el código…' : 'Leer de una foto'}
      </Button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        aria-label="Leer de una foto"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </>
  );
}

type CamState = { kind: 'prendiendo' } | { kind: 'lista'; torch: boolean } | { kind: 'error'; message: string } | { kind: 'apagada' };

/** Vista de la cámara. Se prende al abrir y se apaga (todas las pistas) al cerrar. */
function CameraPane({ onText }: { onText: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const session = useRef<CameraSession | null>(null);
  const [state, setState] = useState<CamState>({ kind: 'prendiendo' });
  const [torchOn, setTorchOn] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** Apagada por la persona o porque la app pasó a segundo plano. */
  const [paused, setPaused] = useState<false | 'persona' | 'fondo'>(false);

  useEffect(() => {
    if (paused) {
      setState({ kind: 'apagada' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'prendiendo' });
    const el = video.current;
    if (!el) return;
    void import('./camera')
      .then(({ startCamera }) => startCamera(el, (t) => onTextRef.current(t), () => cancelled))
      .then((s) => {
        if (cancelled) {
          s.stop();
          return;
        }
        session.current = s;
        setState({ kind: 'lista', torch: s.torch });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: errorText(e) });
      });
    return () => {
      cancelled = true;
      session.current?.stop();
      session.current = null;
      setTorchOn(false);
    };
  }, [attempt, paused]);

  // Si la app pasa a segundo plano, la cámara se apaga; al volver, se prende de nuevo.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') setPaused((p) => p || 'fondo');
      else setPaused((p) => (p === 'fondo' ? false : p));
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const toggleTorch = async () => {
    const s = session.current;
    if (!s) return;
    try {
      await s.setTorch(!torchOn);
      setTorchOn(!torchOn);
    } catch {
      setState({ kind: 'lista', torch: false });
    }
  };

  const live = state.kind === 'lista' || state.kind === 'prendiendo';
  return (
    <div className="grid gap-2">
      <div className={`relative overflow-hidden rounded-2xl border border-line bg-surface-2 ${live ? '' : 'hidden'}`}>
        <video ref={video} className="aspect-[4/3] max-h-[42dvh] w-full object-cover" muted playsInline aria-label="Vista de la cámara" />
        <div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-[38%] -translate-y-1/2 rounded-xl border-2 border-accent" aria-hidden />
        {state.kind === 'prendiendo' ? (
          <p className="absolute inset-0 grid place-items-center text-sm font-semibold text-muted">
            <span className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Prendiendo la cámara…
            </span>
          </p>
        ) : null}
        {state.kind === 'lista' && state.torch ? (
          <Button
            variant="secondary"
            icon={torchOn ? FlashlightOff : Flashlight}
            className="absolute top-2 right-2"
            onClick={() => void toggleTorch()}
            aria-label={torchOn ? 'Apagar la linterna' : 'Prender la linterna'}
            aria-pressed={torchOn}
          />
        ) : null}
      </div>
      {state.kind === 'lista' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">Apunta al código y quédate quieto un momento.</p>
          <Button variant="ghost" icon={CameraOff} onClick={() => setPaused('persona')}>
            Apagar cámara
          </Button>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className="grid gap-2 rounded-2xl bg-warn-soft p-3" role="alert">
          <p className="flex items-start gap-2 text-sm text-ink">
            <CameraOff className="mt-0.5 h-5 w-5 flex-none text-warn" aria-hidden />
            {state.message}
          </p>
          <Button variant="ghost" icon={RefreshCw} onClick={() => setAttempt((n) => n + 1)}>
            Probar la cámara de nuevo
          </Button>
        </div>
      ) : null}
      {state.kind === 'apagada' ? (
        <Button
          icon={Camera}
          onClick={() => {
            setPaused(false);
            setAttempt((n) => n + 1);
          }}
        >
          Prender la cámara
        </Button>
      ) : null}
    </div>
  );
}
