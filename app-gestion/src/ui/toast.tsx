import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Tone = 'ok' | 'error' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

const ToastCtx = createContext<{ push: (tone: Tone, text: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((tone: Tone, text: string) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { id, tone, text }]);
    window.setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite" role="status">
        {list.map((t) => (
          <div
            key={t.id}
            className={`glass entrada-suave pointer-events-none flex w-full max-w-md items-start gap-3 px-4 py-3 text-sm ${
              t.tone === 'error' ? 'text-danger' : t.tone === 'ok' ? 'text-ok' : 'text-ink'
            }`}
          >
            {t.tone === 'error' ? <CircleAlert className="mt-0.5 h-5 w-5 flex-none" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none" aria-hidden />}
            <p className="flex-1 font-medium text-ink">{t.text}</p>
            {/* El aviso deja pasar los toques a lo que tapa (en el teléfono suele quedar sobre un botón o una casilla); solo la X se toca. */}
            <button className="pointer-events-auto text-muted" onClick={() => setList((l) => l.filter((x) => x.id !== t.id))} aria-label="Cerrar aviso">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast fuera de ToastProvider');
  return ctx;
}

/** Texto claro de un error (incluye los de validación de zod). */
export function errorText(e: unknown): string {
  // Errores de validación (zod) sin cargar zod en la portada: tienen `issues`.
  if (e && typeof e === 'object' && 'issues' in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    const first = (e as { issues: { message?: string }[] }).issues[0];
    return first?.message ?? 'Revisa los datos.';
  }
  if (e instanceof Error) return e.message;
  return 'Algo salió mal.';
}

/** Ejecuta una acción con aviso de éxito o de error y estado «trabajando». */
export function useAction() {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (success) push('ok', typeof success === 'function' ? success(r) : success);
        return r;
      } catch (e) {
        push('error', errorText(e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [push],
  );
  return { run, busy };
}
