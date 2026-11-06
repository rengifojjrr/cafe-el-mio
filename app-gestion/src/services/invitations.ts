// Invitaciones a un vendedor o a un local: link con QR y texto para WhatsApp, con vencimiento.
//
// Sin servidor, abrir el link solo puede elegir la cuenta EN ESTE NAVEGADOR (igual que «Entrar
// como…»): si la invitación no está aquí (se creó en otro teléfono), se explica que hace falta la
// nube. El token no es un mecanismo de seguridad (ver domain/invitation.ts).
//
// Lo que necesita la versión con nube: el servidor guarda la invitación y firma el token; al
// aceptarla crea (o enlaza) la cuenta de la persona con su correo o teléfono, la marca como usada y
// la revocación vale al instante en todos los teléfonos. El local entra con su lista de precios, que
// vive en el local y la protege la base (RLS).
import type { DirectoryAccount, Invitation, LineId, User } from '../data/types';
import { getCoreRepo, getLineRepo } from '../data';
import { DEFAULT_INVITATION_DAYS, INVITATION_DAYS, type InvitationState, decodeInvitationToken, encodeInvitationToken, invitationState } from '../domain/invitation';
import { addDays } from '../lib/time';
import { emitChange } from './bus';
import { type Ctx, NotFoundError, ValidationError, audit, guard, mutate, nowIso } from './context';
import { enterAs, ensureSeeded, findAccount } from './session';

export type InviteTarget = { kind: 'seller'; userId: string } | { kind: 'store'; storeId: string };

export interface InvitationView extends Invitation {
  state: InvitationState;
  token: string;
  name: string;
}

/** La cuenta de «Entrar como…» de un usuario: la principal si es una, o «línea:usuario». */
async function accountIdFor(line: LineId, userId: string): Promise<string> {
  const primary = (await getCoreRepo().directory.all()).find((a) => a.line === line && a.userId === userId);
  return primary?.id ?? `${line}:${userId}`;
}

async function targetUser(ctx: Ctx, target: InviteTarget): Promise<{ user: User; storeId?: string; priceListId?: string; label: string }> {
  if (target.kind === 'seller') {
    guard(ctx, 'invitation.create');
    if (ctx.actor.role !== 'admin') guard(ctx, 'user.manage');
    const user = await ctx.repo.users.get(target.userId);
    if (!user || user.role !== 'seller') throw new NotFoundError('el vendedor');
    if (!user.active) throw new ValidationError(`${user.name} está inactivo: actívalo antes de invitarlo.`);
    return { user, label: user.name };
  }
  const store = await ctx.repo.stores.get(target.storeId);
  if (!store) throw new NotFoundError('el local');
  guard(ctx, 'invitation.create', { type: 'store', store });
  const users = (await ctx.repo.users.where('storeId', store.id)).filter((u) => u.active);
  const user = users[0];
  if (!user) throw new ValidationError(`${store.name} todavía no tiene cuenta: se crea cuando administración lo aprueba.`);
  return { user, storeId: store.id, priceListId: store.priceListId, label: store.name };
}

function toView(line: LineId, inv: Invitation, name: string, now: Date): InvitationView {
  return { ...inv, state: invitationState(inv, now), token: encodeInvitationToken({ line, accountId: inv.accountId, inv: inv.id, exp: inv.expiresAt }), name };
}

/** Crea una invitación que vence en `days` días (7 si no se dice). */
export async function createInvitation(ctx: Ctx, target: InviteTarget, opts?: { days?: number }): Promise<InvitationView> {
  const days = opts?.days ?? DEFAULT_INVITATION_DAYS;
  if (!(INVITATION_DAYS as readonly number[]).includes(days)) throw new ValidationError('Elige cuántos días vale la invitación.');
  const { user, storeId, priceListId, label } = await targetUser(ctx, target);
  const accountId = await accountIdFor(ctx.line, user.id);
  return mutate(ctx, async () => {
    const at = nowIso(ctx);
    const inv: Invitation = {
      id: ctx.newId('inv'),
      accountId,
      userId: user.id,
      role: target.kind,
      ...(storeId ? { storeId } : {}),
      ...(priceListId ? { priceListId } : {}),
      expiresAt: addDays(at, days),
      createdAt: at,
      createdBy: ctx.actor.userId,
    };
    await ctx.repo.invitations.put(inv);
    await audit(ctx, 'invitacion.crear', 'invitation', inv.id, `Invitación para ${label} (${user.name}), vale ${days} días`);
    return toView(ctx.line, inv, label, ctx.now());
  });
}

/** Invitaciones de un vendedor o de un local (las más nuevas primero). */
export async function listInvitations(ctx: Ctx, target: InviteTarget): Promise<InvitationView[]> {
  let label: string;
  let match: (i: Invitation) => boolean;
  if (target.kind === 'seller') {
    guard(ctx, 'invitation.read');
    if (ctx.actor.role !== 'admin') guard(ctx, 'user.read');
    const u = await ctx.repo.users.get(target.userId);
    label = u?.name ?? 'Vendedor';
    match = (i) => i.role === 'seller' && i.userId === target.userId;
  } else {
    const store = await ctx.repo.stores.get(target.storeId);
    if (!store) throw new NotFoundError('el local');
    guard(ctx, 'invitation.read', { type: 'store', store });
    label = store.name;
    match = (i) => i.role === 'store' && i.storeId === target.storeId;
  }
  const all = await ctx.repo.invitations.all();
  const now = ctx.now();
  return all
    .filter(match)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((i) => toView(ctx.line, i, label, now));
}

export async function revokeInvitation(ctx: Ctx, invitationId: string): Promise<void> {
  await mutate(ctx, async () => {
    const inv = await ctx.repo.invitations.get(invitationId);
    if (!inv) throw new NotFoundError('la invitación');
    if (inv.role === 'store' && inv.storeId) {
      const store = await ctx.repo.stores.get(inv.storeId);
      if (!store) throw new NotFoundError('el local');
      guard(ctx, 'invitation.create', { type: 'store', store });
    } else {
      guard(ctx, 'invitation.create');
      if (ctx.actor.role !== 'admin') guard(ctx, 'user.manage');
    }
    if (inv.revokedAt) return;
    await ctx.repo.invitations.put({ ...inv, revokedAt: nowIso(ctx) });
    await audit(ctx, 'invitacion.revocar', 'invitation', inv.id, `Invitación revocada (${inv.role === 'seller' ? 'vendedor' : 'local'})`);
  });
}

// ---------- Abrir el link (todavía sin cuenta) ----------

export type InvitationOutcome =
  | { kind: 'ok'; line: LineId; account: DirectoryAccount; role: 'seller' | 'store'; storeName?: string; expiresAt: string; invitationId: string }
  | { kind: 'invalida' }
  | { kind: 'vencida'; expiresAt: string }
  | { kind: 'revocada' }
  | { kind: 'nube'; line: LineId }
  | { kind: 'inactiva' };

/** Lee el link: ¿es una invitación de este navegador, vigente y de una cuenta activa? No entra todavía. */
export async function checkInvitation(token: string, now = new Date()): Promise<InvitationOutcome> {
  const t = decodeInvitationToken(token);
  if (!t) return { kind: 'invalida' };
  await ensureSeeded();
  const inv = await getLineRepo(t.line).invitations.get(t.inv);
  if (!inv) {
    // No está en este navegador: se creó en otro teléfono. Sin nube no hay cómo saber si vale.
    if (new Date(t.exp).getTime() <= now.getTime()) return { kind: 'vencida', expiresAt: t.exp };
    return { kind: 'nube', line: t.line };
  }
  const state = invitationState(inv, now);
  if (state === 'revocada') return { kind: 'revocada' };
  if (state === 'vencida') return { kind: 'vencida', expiresAt: inv.expiresAt };
  const account = await findAccount(inv.accountId);
  if (!account || account.line !== t.line) return { kind: 'inactiva' };
  const store = inv.storeId ? await getLineRepo(t.line).stores.get(inv.storeId) : undefined;
  return { kind: 'ok', line: t.line, account, role: inv.role, storeName: store?.name, expiresAt: inv.expiresAt, invitationId: inv.id };
}

/** Entra con la cuenta de la invitación (si sigue valiendo) y anota que se usó. */
export async function acceptInvitation(token: string, now = new Date()): Promise<InvitationOutcome> {
  const outcome = await checkInvitation(token, now);
  if (outcome.kind !== 'ok') return outcome;
  const repo = getLineRepo(outcome.line);
  const inv = await repo.invitations.get(outcome.invitationId);
  if (inv) {
    await repo.transaction(async () => {
      await repo.invitations.put({ ...inv, acceptedAt: now.toISOString() });
      const user = await repo.users.get(inv.userId);
      await repo.audit.append({
        id: `aud_inv_${now.getTime()}`,
        at: now.toISOString(),
        actorId: inv.userId,
        actorName: user?.name ?? outcome.account.name,
        role: inv.role,
        action: 'invitacion.aceptar',
        entity: 'invitation',
        entityId: inv.id,
        summary: `${user?.name ?? outcome.account.name} entró con su invitación`,
      });
    });
    emitChange(outcome.line);
  }
  await enterAs(outcome.account.id);
  return outcome;
}
