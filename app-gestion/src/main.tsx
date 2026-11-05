import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './app/App';
import { captureInstallPrompt } from './lib/pwa';
import { ensureSeeded } from './services/session';

captureInstallPrompt();

// Service worker solo con alcance /cafe-el-mio/gestion/ (nunca en la raíz de la web de marca).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

const root = createRoot(document.getElementById('root')!);

function Boot({ message }: { message: string }) {
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="font-display text-3xl font-semibold">Grupo Miami</p>
        <p className="mt-2 text-muted">{message}</p>
      </div>
    </div>
  );
}

// La app se muestra enseguida; la primera vez, los datos de ejemplo se cargan en segundo plano
// y las pantallas se actualizan solas cuando terminan.
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

ensureSeeded().catch((e: unknown) => {
  console.error(e);
  root.render(<Boot message={`No se pudo abrir la base de datos del navegador: ${e instanceof Error ? e.message : String(e)}. Prueba fuera del modo incógnito.`} />);
});
