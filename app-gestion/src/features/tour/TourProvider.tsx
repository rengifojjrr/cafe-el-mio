import { ChevronLeft, ChevronRight, Compass, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { LineId } from '../../data/types';
import { enterAs, getLineDataMode } from '../../services/session';
import { errorText, useToast } from '../../ui/toast';
import { TOUR } from './steps';

interface TourApi {
  start: (line: LineId) => void;
}

const TourCtx = createContext<TourApi | null>(null);

export function useTour(): TourApi {
  const v = useContext(TourCtx);
  if (!v) throw new Error('useTour fuera de TourProvider');
  return v;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const { push } = useToast();
  const [line, setLine] = useState<LineId | null>(null);
  const [i, setI] = useState(0);

  const goTo = useCallback(
    async (l: LineId, index: number) => {
      const step = TOUR[l][index];
      if (!step) return;
      try {
        await enterAs(step.account);
        setLine(l);
        setI(index);
        nav(step.path);
      } catch (e) {
        push('error', errorText(e));
      }
    },
    [nav, push],
  );

  // El recorrido enseña los datos de ejemplo: con los datos reales de la empresa no hay recorrido.
  const start = useCallback(
    async (l: LineId) => {
      if ((await getLineDataMode(l)) === 'real') {
        push('info', `${l === 'tabaco' ? 'Tabaco' : 'Café'} tiene datos reales: el recorrido es solo para los datos de ejemplo.`);
        return;
      }
      await goTo(l, 0);
    },
    [goTo, push],
  );
  const api = useMemo<TourApi>(() => ({ start: (l) => void start(l) }), [start]);
  const step = line ? TOUR[line][i] : undefined;
  const total = line ? TOUR[line].length : 0;

  return (
    <TourCtx.Provider value={api}>
      {children}
      {line && step ? (
        <aside
          className="no-print glass fixed inset-x-3 top-3 z-[65] mx-auto max-w-xl p-4 sm:top-auto sm:bottom-6 lg:left-[272px]"
          aria-live="polite"
          aria-label="Recorrido guiado"
          data-testid="recorrido"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-accent-soft text-accent">
              <Compass className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted tabular">
                Recorrido de {line === 'tabaco' ? 'Tabaco' : 'Café'} · paso {i + 1} de {total}
              </p>
              <h2 className="font-bold text-ink">{step.title}</h2>
              <p className="mt-1 text-sm text-ink">{step.body}</p>
            </div>
            <button type="button" className="btn btn-ghost btn-icon -mt-2 -mr-2" onClick={() => setLine(null)} aria-label="Terminar el recorrido">
              <X aria-hidden />
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => void goTo(line, i - 1)} disabled={i === 0}>
              <ChevronLeft aria-hidden /> Anterior
            </button>
            {i < total - 1 ? (
              <button type="button" className="btn btn-primary" onClick={() => void goTo(line, i + 1)}>
                Siguiente <ChevronRight aria-hidden />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setLine(null)}>
                Terminar
              </button>
            )}
          </div>
        </aside>
      ) : null}
    </TourCtx.Provider>
  );
}
