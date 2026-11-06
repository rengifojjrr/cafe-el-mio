// «Entrar como…»: elegir cualquier rol de cualquiera de las dos apps (sin contraseñas: es demo).
import { ChevronDown, Crown, Store as StoreIcon, Truck, UserCog } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { LineId, Role } from '../data/types';
import { enterAs, listAccounts, type AccountOption } from '../services/session';
import { LineMark } from '../ui/brand';
import { Loading } from '../ui/kit';
import { errorText, useToast } from '../ui/toast';
import { useAsync } from './hooks';

const ROLE_ICON: Record<Role, typeof Crown> = { direccion: Crown, admin: UserCog, seller: Truck, store: StoreIcon };
const ROLE_HINT: Record<Role, string> = {
  direccion: 'Las dos líneas lado a lado. Solo mirar.',
  admin: 'Catálogo, almacén, locales, cobros, comisiones y contabilidad.',
  seller: 'Sus locales, visitas, contratos, entregas y comisiones.',
  store: 'Su consignación, lo que gana, sus cuentas y pedir más.',
};

export function AccountPicker({ onDone, only }: { onDone?: () => void; only?: LineId }) {
  const nav = useNavigate();
  const { push } = useToast();
  const { data, loading } = useAsync(listAccounts, []);
  const [open, setOpen] = useState<LineId | null>(null);
  if (loading || !data) return <Loading rows={4} />;
  if (data.primary.length === 0) {
    return (
      <div className="grid gap-3">
        <p className="text-muted">Preparando los datos de ejemplo… tarda unos segundos la primera vez.</p>
        <Loading rows={3} />
      </div>
    );
  }

  const go = async (acc: AccountOption) => {
    try {
      await enterAs(acc.id);
      onDone?.();
      nav(acc.line ? `/${acc.line}` : '/direccion');
    } catch (e) {
      push('error', errorText(e));
    }
  };

  const groups: { key: LineId | 'eco'; items: AccountOption[] }[] = [
    { key: 'eco', items: data.primary.filter((a) => a.line === null) },
    { key: 'tabaco', items: data.primary.filter((a) => a.line === 'tabaco') },
    { key: 'cafe', items: data.primary.filter((a) => a.line === 'cafe') },
  ].filter((g) => !only || g.key === only) as { key: LineId | 'eco'; items: AccountOption[] }[];

  return (
    <div className="grid gap-5">
      {groups.map((g) => (
        <div key={g.key} data-line={g.key === 'eco' ? undefined : g.key} className="grid gap-2">
          {g.key !== 'eco' ? (
            <div className="px-1">
              <LineMark line={g.key} size="sm" />
            </div>
          ) : null}
          <ul className="grid gap-2">
            {g.items.map((acc) => {
              const Icon = ROLE_ICON[acc.role];
              return (
                <li key={acc.id}>
                  <button
                    type="button"
                    onClick={() => void go(acc)}
                    className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-left transition-colors hover:border-accent"
                    data-account={acc.id}
                  >
                    <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-accent-soft text-accent">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-ink">{acc.label}</span>
                      <span className="block truncate text-sm text-muted">
                        {acc.name} · {ROLE_HINT[acc.role]}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {g.key !== 'eco' && data.others[g.key].length ? (
            <div>
              <button type="button" className="btn btn-ghost w-full justify-between text-sm" aria-expanded={open === g.key} onClick={() => setOpen(open === g.key ? null : (g.key as LineId))}>
                Otras cuentas ({data.others[g.key].length})
                <ChevronDown className={`transition-transform ${open === g.key ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {open === g.key ? (
                <ul className="mt-1 grid gap-1.5">
                  {data.others[g.key].map((acc) => (
                    <li key={acc.id}>
                      <button type="button" onClick={() => void go(acc)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-accent-soft">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ink">{acc.name}</span>
                          <span className="block truncate text-sm text-muted">{acc.label}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
