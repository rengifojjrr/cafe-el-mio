import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribe, versionKey } from '../services/bus';

/** Número que cambia cada vez que un servicio escribe algo. */
export function useDataVersion(): string {
  return useSyncExternalStore(subscribe, versionKey, versionKey);
}

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

/**
 * Carga datos de un servicio y los vuelve a pedir cuando cambian (cualquier escritura)
 * o cuando cambian las dependencias.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const version = useDataVersion();
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fnRef
      .current()
      .then((data) => {
        if (alive) setState({ data, loading: false });
      })
      .catch((error: unknown) => {
        if (alive) setState({ error: error instanceof Error ? error : new Error(String(error)), loading: false });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  const [match, setMatch] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** Sube un número de 0 a su valor al cargar (sin animación si el sistema pide menos movimiento). */
export function useCountUp(value: number, duration = 700): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (t: number) => {
      // El primer cuadro puede traer una marca de tiempo anterior a «start»: se limita a [0, 1].
      const p = Math.max(0, Math.min(1, (t - start) / duration));
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(origin + (value - origin) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced]);
  return shown;
}

type StorageKind = 'local' | 'session';

function storageOf(kind: StorageKind): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readStored<T>(kind: StorageKind, key: string, initial: T): T {
  try {
    const raw = storageOf(kind)?.getItem(key);
    return raw === null || raw === undefined ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
}

/**
 * Estado que sobrevive a ir a otra pantalla y volver (filtros, pestañas, búsqueda).
 * `session`: mientras la pestaña esté abierta; `local`: se recuerda por persona en este navegador.
 * Si el navegador no deja guardar, funciona igual, solo que sin recordar.
 */
export function usePersistentState<T>(key: string, initial: T, kind: StorageKind = 'session'): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readStored(kind, key, initial));
  const keyRef = useRef(key);
  // Si cambia la clave (otra cuenta u otra línea), se carga lo guardado para esa clave.
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setValue(readStored(kind, key, initial));
    }
    // `initial` cambia en cada render si es un objeto: solo importa la clave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, kind]);
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        try {
          storageOf(kind)?.setItem(keyRef.current, JSON.stringify(next));
        } catch {
          // Sin almacenamiento (modo privado): no se recuerda, pero la pantalla funciona.
        }
        return next;
      });
    },
    [kind],
  );
  return [value, set];
}
