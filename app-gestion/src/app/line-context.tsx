import { createContext, useContext } from 'react';
import type { DirectoryAccount, LineId } from '../data/types';
import type { Actor } from '../domain/permissions';
import type { LineConfig } from '../lines/config';
import type { Ctx } from '../services/context';

export interface LineState {
  line: LineId;
  config: LineConfig;
  ctx: Ctx;
  actor: Actor;
  account: DirectoryAccount;
  /** Si Administración o Dirección mira con los ojos de otra cuenta. */
  viewing: DirectoryAccount | null;
  /** Ruta dentro de la línea: p('catalogo') → /tabaco/catalogo */
  p: (path?: string) => string;
}

export const LineContext = createContext<LineState | null>(null);

export function useLine(): LineState {
  const v = useContext(LineContext);
  if (!v) throw new Error('useLine fuera de una línea');
  return v;
}
