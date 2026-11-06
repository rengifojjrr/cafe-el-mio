// Lo que acompaña a todas las pantallas: el botón flotante «Cambiar de rol», los avisos
// emergentes, el recorrido guiado y el tema (oscuro o claro).
import { Repeat } from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router';
import { getEcosystem } from '../services/session';
import { Sheet } from '../ui/kit';
import { AccountPicker } from './AccountPicker';
import { useAsync } from './hooks';

export function RootLayout() {
  const eco = useAsync(getEcosystem, []);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const theme = eco.data?.theme ?? 'dark';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const navType = useNavigationType();
  // Las entradas sin estado (carga inicial, recargar, dirección escrita) se recuerdan por su ruta.
  useScrollMemory(loc.key === 'default' ? `ruta:${loc.pathname}${loc.search}` : loc.key, loc.pathname, navType);

  const onHome = loc.pathname === '/';
  const printing = loc.pathname.endsWith('/imprimir');

  return (
    <>
      <Outlet />
      {!onHome && !printing ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="no-print glass fixed right-3 bottom-[84px] z-[60] flex min-h-11 items-center gap-2 rounded-full px-3.5 text-sm font-bold text-ink shadow-lg lg:right-6 lg:bottom-6 lg:min-h-12 lg:px-4 lg:text-base"
          data-testid="cambiar-rol"
        >
          <Repeat className="h-5 w-5 text-accent" aria-hidden />
          Cambiar de rol
        </button>
      ) : null}
      <Sheet open={open} onClose={() => setOpen(false)} title="Cambiar de rol">
        <p className="mb-4 text-muted">Elige con qué cuenta entrar. Todavía no hay contraseñas: cualquiera con este navegador puede entrar con cualquier cuenta.</p>
        <AccountPicker onDone={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

/**
 * Al ir a una pantalla nueva se empieza arriba; al volver (atrás del navegador o del teléfono)
 * se recupera el punto donde estaba la lista. Las listas cargan sus datos un momento después,
 * así que se reintenta hasta que la página tenga altura suficiente (o la persona se mueva).
 */
const SCROLL_KEY = 'pos-pantallas';

function readPositions(): Record<string, number> {
  try {
    return JSON.parse(window.sessionStorage.getItem(SCROLL_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function useScrollMemory(key: string, pathname: string, navType: string) {
  // useLayoutEffect: el oyente de la pantalla anterior se quita en el mismo paso del cambio. Si no,
  // al abrir una pantalla más corta el navegador recorta la posición y pisaba la de la lista.
  useLayoutEffect(() => {
    let frame = 0;
    const save = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          const all = readPositions();
          all[key] = window.scrollY;
          const keys = Object.keys(all);
          if (keys.length > 60) delete all[keys[0]!];
          window.sessionStorage.setItem(SCROLL_KEY, JSON.stringify(all));
        } catch {
          // Sin almacenamiento: no se recuerda la posición.
        }
      });
    };
    let tries = 0;
    let timer = 0;
    let userMoved = false;
    const stopOnUser = () => {
      userMoved = true;
    };
    const target = navType === 'POP' ? readPositions()[key] : undefined;
    if (target !== undefined) {
      const restore = () => {
        if (userMoved) return;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: Math.min(target, Math.max(0, max)) });
        if (max < target && tries++ < 30) timer = window.setTimeout(restore, 80);
      };
      restore();
      window.addEventListener('wheel', stopOnUser, { passive: true, once: true });
      window.addEventListener('touchstart', stopOnUser, { passive: true, once: true });
    } else if (navType !== 'REPLACE') {
      // Pantalla nueva: arriba. Cambiar solo los filtros de la dirección («replace») no mueve la página.
      window.scrollTo({ top: 0 });
    }
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      window.removeEventListener('scroll', save);
      window.removeEventListener('wheel', stopOnUser);
      window.removeEventListener('touchstart', stopOnUser);
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
    // Cada entrada del historial tiene su clave; la ruta y el tipo de navegación vienen con ella.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pathname]);
}
