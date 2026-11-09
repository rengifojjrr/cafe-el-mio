// Invitaciones: el link (#/invitacion/<token>), su vencimiento y el texto para WhatsApp. Funciones puras.
//
// OJO: el token NO es un mecanismo de seguridad. Es JSON en base64url (línea, cuenta, invitación y
// vencimiento) que cualquiera puede leer y armar. Sin servidor, abrir el link solo elige la cuenta en
// este navegador, igual que «Entrar como…». Con la nube, el servidor firma el token, lo guarda, lo
// valida (vigente y no revocado) y crea o enlaza la cuenta de la persona al aceptarlo.
import type { Invitation, IsoDateTime, LineId } from '../data/types';
import { isProgramLine } from '../lines/programa';

export interface InvitationToken {
  v: 1;
  line: LineId;
  accountId: string;
  /** Id de la invitación. */
  inv: string;
  /** Vence (ISO). */
  exp: IsoDateTime;
}

export const INVITATION_DAYS = [1, 3, 7, 14, 30] as const;
export const DEFAULT_INVITATION_DAYS = 7;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeInvitationToken(t: Omit<InvitationToken, 'v'>): string {
  return toBase64Url(JSON.stringify({ v: 1, line: t.line, accountId: t.accountId, inv: t.inv, exp: t.exp }));
}

/** Lee un token; si no es una invitación de esta app, null. */
export function decodeInvitationToken(token: string): InvitationToken | null {
  if (!/^[A-Za-z0-9_-]{10,2000}$/.test(token)) return null;
  try {
    const o = JSON.parse(fromBase64Url(token)) as Partial<InvitationToken>;
    // Solo invitaciones a una línea de este programa (una de café no entra al de Tabaco).
    if (o.v !== 1 || !isProgramLine(o.line)) return null;
    if (typeof o.accountId !== 'string' || typeof o.inv !== 'string' || typeof o.exp !== 'string') return null;
    if (!o.accountId.startsWith(`${o.line}:`) || Number.isNaN(Date.parse(o.exp))) return null;
    return { v: 1, line: o.line, accountId: o.accountId, inv: o.inv, exp: o.exp };
  } catch {
    return null;
  }
}

export type InvitationState = 'vigente' | 'vencida' | 'revocada';

export const INVITATION_STATE_LABEL: Record<InvitationState, string> = {
  vigente: 'Vigente',
  vencida: 'Vencida',
  revocada: 'Revocada',
};

export function invitationState(inv: Pick<Invitation, 'expiresAt' | 'revokedAt'>, now: Date): InvitationState {
  if (inv.revokedAt) return 'revocada';
  return new Date(inv.expiresAt).getTime() <= now.getTime() ? 'vencida' : 'vigente';
}

/** El link completo: la dirección de la app + #/invitacion/<token>. */
export function invitationLink(appBase: string, token: string): string {
  return `${appBase.replace(/#.*$/, '')}#/invitacion/${token}`;
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Texto listo para mandar por WhatsApp. */
export function invitationMessage(input: { name: string; company: string; lineName: string; role: 'seller' | 'store'; link: string; expires: string }): string {
  const first = input.name.trim().split(/\s+/)[0] ?? input.name;
  const what = input.role === 'seller' ? 'tu cuenta de vendedor' : 'la cuenta de tu tienda';
  return `Hola, ${first}: te invito a la app de ${input.company} (${input.lineName}). Ábrela con este enlace para entrar con ${what}: ${input.link} (vale hasta el ${input.expires}).`;
}
