// Lo que acompaña a todas las pantallas: el botón flotante «Cambiar de rol», los avisos
// emergentes, el recorrido guiado y el tema (oscuro o claro).
import { Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { getEcosystem } from '../services/session';
import { Sheet } from '../ui/kit';
import { AccountPicker } from './AccountPicker';
import { useAsync } from './hooks';
import { TourProvider } from '../features/tour/TourProvider';

export function RootLayout() {
  const eco = useAsync(getEcosystem, []);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const theme = eco.data?.theme ?? 'dark';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  const onHome = loc.pathname === '/';
  const printing = loc.pathname.endsWith('/imprimir');

  return (
    <TourProvider>
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
        <p className="mb-4 text-muted">Elige con qué cuenta quieres ver la app. Es una demo: no hay contraseñas.</p>
        <AccountPicker onDone={() => setOpen(false)} />
      </Sheet>
    </TourProvider>
  );
}
