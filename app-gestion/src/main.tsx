import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './app/App';
import { captureInstallPrompt } from './lib/pwa';
import { alCambiarSesion, salir, sesionActual } from './servidor/cliente';
import { alCambiarEstado, estadoSync, iniciar } from './servidor/sincronizar';
import { emitChange } from './services/bus';
import { conServidor } from './services/puerta';
import { ensureSeeded } from './services/session';

captureInstallPrompt();

// Con el servidor: la sincronización de fondo arranca antes que nada (así ningún cambio se queda
// sin anotar) y entrar o salir, también desde otra pestaña, hace que las pantallas vuelvan a mirar.
if (conServidor()) {
  iniciar();
  alCambiarSesion(() => emitChange('core'));
  // Si el servidor dice que esta cuenta ya no tiene acceso, se cierra la sesión en este teléfono.
  alCambiarEstado(() => {
    if (estadoSync().fase === 'sin-acceso' && sesionActual()) void salir();
  });
}

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

// La app se muestra enseguida; la primera vez, las dos líneas se preparan en blanco en segundo
// plano (y lo de ejemplo de una versión vieja se borra) y las pantallas se actualizan solas.
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Las bases de antes de separar Tabaco y Café: se borran las que solo tenían ejemplos.
void import('./data/local/old-databases').then((m) => m.removeOldDatabases()).catch(() => undefined);

ensureSeeded().catch((e: unknown) => {
  console.error(e);
  root.render(<Boot message={`No se pudo abrir la base de datos del navegador: ${e instanceof Error ? e.message : String(e)}. Prueba fuera del modo incógnito.`} />);
});
