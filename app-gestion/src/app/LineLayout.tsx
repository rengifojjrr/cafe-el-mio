// Armazón de cada línea: cabecera, menú según el rol (riel en computadora, barra abajo en el
// teléfono), campana de avisos, «Ver como…» y el aviso de «solo mirar».
import { Bell, Eye, LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router';
import { isLineId, lineConfig } from '../lines/config';
import { lineCtx } from '../services/context';
import { unreadNotifications } from '../services/messages';
import { directorOpenLine, getEcosystem, leave, listAccounts, resolveActor, saveEcosystem, viewAs } from '../services/session';
import { LineMark } from '../ui/brand';
import { Button, Loading, Sheet } from '../ui/kit';
import { errorText, useToast } from '../ui/toast';
import { useAsync } from './hooks';
import { LineContext, type LineState } from './line-context';
import { NAV, ROLE_LABEL } from './nav';

export function LineLayout() {
  const params = useParams();
  const line = params.line;
  if (!isLineId(line)) return <Navigate to="/" replace />;
  return <LineShell line={line} />;
}

function LineShell({ line }: { line: 'tabaco' | 'cafe' }) {
  const nav = useNavigate();
  const resolved = useAsync(() => resolveActor(line), [line]);

  useEffect(() => {
    document.documentElement.dataset.line = line;
    const meta = document.querySelector('meta[name="theme-color"]');
    const color = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (meta && color) meta.setAttribute('content', color);
    return () => {
      delete document.documentElement.dataset.line;
    };
  }, [line]);

  const r = resolved.data;
  const state = useMemo<LineState | null>(() => {
    if (!r) return null;
    const ctx = lineCtx(line, r.actor);
    return { line, config: lineConfig(line), ctx, actor: r.actor, account: r.account, viewing: r.viewing, p: (path = '') => `/${line}${path ? `/${path}` : ''}` };
  }, [line, r]);

  if (resolved.loading && !resolved.data) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Loading rows={4} />
      </div>
    );
  }
  if (!state) {
    return (
      <div className="mx-auto grid min-h-dvh max-w-md place-items-center p-6 text-center">
        <div className="glass p-6">
          <h1 className="font-display text-2xl font-semibold">Elige una cuenta de {lineConfig(line).name}</h1>
          <p className="mt-2 text-muted">Tu sesión no tiene acceso a esta línea. Las cuentas de Tabaco y de Café no se cruzan.</p>
          <Button variant="primary" className="mt-4" onClick={() => nav('/')}>
            Ir a la portada
          </Button>
        </div>
      </div>
    );
  }
  // Al cambiar de cuenta (o entrar a «ver como…») se vuelve a montar todo: ninguna pantalla
  // se queda con el estado inicial que calculó con la cuenta anterior.
  const actorKey = `${state.actor.accountId}|${state.actor.userId}|${state.actor.readOnly ? 'ro' : 'rw'}`;
  return (
    <LineContext.Provider value={state}>
      <Shell key={actorKey} state={state} />
    </LineContext.Provider>
  );
}

function Shell({ state }: { state: LineState }) {
  const { actor, viewing, account, line, p, ctx } = state;
  const nav = useNavigate();
  const { push } = useToast();
  const [more, setMore] = useState(false);
  const [viewSheet, setViewSheet] = useState(false);
  const role = actor.role === 'direccion' ? 'admin' : actor.role;
  const items = NAV[role];
  const unread = useAsync(() => unreadNotifications(ctx), [ctx]);
  const eco = useAsync(getEcosystem, []);
  const isDirector = account.role === 'direccion';
  const canViewAs = (account.role === 'admin' && account.line === line) || isDirector;

  const toggleTheme = () => void saveEcosystem({ theme: eco.data?.theme === 'light' ? 'dark' : 'light' });
  const exit = async () => {
    if (isDirector) {
      await directorOpenLine(null);
      nav('/direccion');
    } else {
      await leave();
      nav('/');
    }
  };
  const stopViewing = async () => {
    try {
      if (isDirector && viewing?.id === `${line}:direccion`) {
        await directorOpenLine(null);
        nav('/direccion');
        return;
      }
      await viewAs(null);
      nav(p());
    } catch (e) {
      push('error', errorText(e));
    }
  };

  const bottom = items.filter((i) => i.bottom);
  const rest = items.filter((i) => !i.bottom);

  return (
    <div className="min-h-dvh lg:pl-[248px]">
      {/* Riel (computadora) */}
      <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-line bg-glass backdrop-blur-xl lg:flex">
        <div className="flex h-[68px] items-center px-5">
          <Link to={p()} aria-label={`Inicio de ${state.config.name}`}>
            <LineMark line={line} />
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Menú principal">
          <ul className="grid gap-0.5">
            {items.map((it) => (
              <li key={it.path}>
                <NavLink
                  to={p(it.path)}
                  end={it.path === ''}
                  className={({ isActive }) =>
                    `flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] font-semibold transition-colors ${
                      isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-accent-soft hover:text-ink'
                    }`
                  }
                >
                  <it.icon className="h-5 w-5" aria-hidden />
                  {it.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-line p-3 text-sm">
          <Link to="/" className="flex min-h-11 items-center gap-2 rounded-xl px-3 font-semibold text-muted hover:text-ink">
            ‹ Portada del ecosistema
          </Link>
        </div>
      </aside>

      {/* Cabecera */}
      <header className="no-print sticky top-0 z-30 border-b border-line bg-glass backdrop-blur-xl">
        <div className="mx-auto flex h-[60px] max-w-6xl items-center gap-2 px-4 lg:h-[68px] lg:px-8">
          <Link to={p()} className="lg:hidden" aria-label={`Inicio de ${state.config.name}`}>
            <LineMark line={line} size="sm" />
          </Link>
          <div className="hidden min-w-0 lg:block">
            <p className="truncate text-sm text-muted">
              {ROLE_LABEL[actor.role]} · <span className="font-semibold text-ink">{actor.name}</span>
            </p>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {canViewAs && !actor.readOnly ? (
              <Button variant="ghost" icon={Eye} onClick={() => setViewSheet(true)} className="hidden sm:inline-flex">
                Ver como…
              </Button>
            ) : null}
            <Button variant="ghost" icon={eco.data?.theme === 'light' ? Moon : Sun} onClick={toggleTheme} aria-label="Cambiar entre modo claro y oscuro" />
            <Link to={p('avisos')} className="btn btn-ghost btn-icon relative" aria-label={`Avisos${unread.data ? `: ${unread.data} sin leer` : ''}`}>
              <Bell aria-hidden />
              {unread.data ? (
                <span className="absolute top-1.5 right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[0.7rem] font-bold text-accent-ink tabular">{unread.data}</span>
              ) : null}
            </Link>
            <Button variant="ghost" icon={LogOut} onClick={() => void exit()} aria-label={isDirector ? 'Volver a Dirección' : 'Salir a la portada'} />
          </div>
        </div>
        {actor.readOnly ? (
          <div className="border-t border-line bg-warn-soft">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm lg:px-8">
              <Eye className="h-4 w-4 text-warn" aria-hidden />
              <p className="font-semibold text-ink">
                Estás viendo como {ROLE_LABEL[actor.role].toLowerCase()}: {actor.name}. Solo mirar.
              </p>
              <div className="ml-auto flex gap-2">
                {isDirector ? (
                  <button type="button" className="font-bold text-warn underline" onClick={() => setViewSheet(true)}>
                    Ver como otra cuenta
                  </button>
                ) : null}
                <button type="button" className="font-bold text-warn underline" onClick={() => void stopViewing()}>
                  {isDirector && viewing?.id === `${line}:direccion` ? 'Volver a Dirección' : 'Volver a mi cuenta'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-5 pb-36 lg:px-8 lg:pb-16" id="contenido">
        <Outlet />
      </main>

      {/* Barra de abajo (teléfono) */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-glass pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Menú">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {bottom.slice(0, 4).map((it) => (
            <li key={it.path}>
              <NavLink
                to={p(it.path)}
                end={it.path === ''}
                className={({ isActive }) => `flex min-h-[64px] flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold ${isActive ? 'text-accent' : 'text-muted'}`}
              >
                <it.icon className="h-6 w-6" aria-hidden />
                {it.short ?? it.label}
              </NavLink>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setMore(true)} className="flex min-h-[64px] w-full flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold text-muted">
              <Menu className="h-6 w-6" aria-hidden />
              Más
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="Más">
        <ul className="grid grid-cols-2 gap-2">
          {[...bottom.slice(4), ...rest].map((it) => (
            <li key={it.path}>
              <Link to={p(it.path)} onClick={() => setMore(false)} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 font-semibold">
                <it.icon className="h-5 w-5 text-accent" aria-hidden />
                {it.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-2">
          {canViewAs && !actor.readOnly ? (
            <Button icon={Eye} onClick={() => (setMore(false), setViewSheet(true))}>
              Ver como…
            </Button>
          ) : null}
          <Link to="/" className="btn btn-ghost" onClick={() => setMore(false)}>
            <X aria-hidden /> Portada del ecosistema
          </Link>
        </div>
      </Sheet>

      <ViewAsSheet open={viewSheet} onClose={() => setViewSheet(false)} />
    </div>
  );
}

function ViewAsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { line, p } = useLineSafe();
  const nav = useNavigate();
  const { push } = useToast();
  const accounts = useAsync(listAccounts, []);
  if (!open) return null;
  const lineAccounts = accounts.data ? [...accounts.data.primary.filter((a) => a.line === line), ...accounts.data.others[line]] : [];
  return (
    <Sheet open={open} onClose={onClose} title="Ver como…">
      <p className="mb-4 text-muted">Mira esta línea con los ojos de otra cuenta. Solo se mira: no se puede cambiar nada.</p>
      <ul className="grid gap-2">
        {lineAccounts
          .filter((a) => a.role !== 'admin')
          .map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-line bg-surface-2 px-4 text-left hover:border-accent"
                onClick={async () => {
                  try {
                    await viewAs(a.id);
                    onClose();
                    nav(p());
                  } catch (e) {
                    push('error', errorText(e));
                  }
                }}
              >
                <span>
                  <span className="block font-semibold">{a.name}</span>
                  <span className="block text-sm text-muted">{a.role === 'seller' ? 'Vendedor' : a.label}</span>
                </span>
                <Eye className="h-5 w-5 text-accent" aria-hidden />
              </button>
            </li>
          ))}
      </ul>
    </Sheet>
  );
}

function useLineSafe() {
  const params = useParams();
  const line = isLineId(params.line) ? params.line : 'tabaco';
  return { line, p: (path = '') => `/${line}${path ? `/${path}` : ''}` };
}
