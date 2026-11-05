// Contexto de cada llamada a un servicio: de qué línea son los datos, quién actúa y qué hora es.
import type { AppNotification, AuditEntry, LineId, LineSettings, NotificationKind, User } from '../data/types';
import type { LineRepo } from '../data/repo';
import { getLineRepo } from '../data';
import type { Actor, Action, Resource } from '../domain/permissions';
import { ensure, ForbiddenError } from '../domain/permissions';
import { lineConfig, type LineConfig } from '../lines/config';
import { newId } from '../lib/ids';
import { emitChange } from './bus';

export interface Ctx {
  line: LineId;
  repo: LineRepo;
  actor: Actor;
  config: LineConfig;
  now: () => Date;
  newId: (prefix: string) => string;
}

export function lineCtx(line: LineId, actor: Actor, opts?: { now?: () => Date; repo?: LineRepo }): Ctx {
  return {
    line,
    repo: opts?.repo ?? getLineRepo(line),
    actor,
    config: lineConfig(line),
    now: opts?.now ?? (() => new Date()),
    newId,
  };
}

/** Comprueba el permiso en la capa de servicios. Lanza ForbiddenError si no puede. */
export function guard(ctx: Ctx, action: Action, res?: Resource): void {
  ensure(ctx.actor, action, ctx.line, res);
}

export { ForbiddenError };

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`No encontré ${what}.`);
    this.name = 'NotFoundError';
  }
}

/** Escribe en una transacción y avisa a las pantallas que los datos cambiaron. */
export async function mutate<R>(ctx: Ctx, fn: () => Promise<R>): Promise<R> {
  const result = await ctx.repo.transaction(fn);
  emitChange(ctx.line);
  return result;
}

export function nowIso(ctx: Ctx): string {
  return ctx.now().toISOString();
}

/** Auditoría: quién hizo qué y cuándo. Solo se agrega. */
export async function audit(ctx: Ctx, action: string, entity: string, entityId: string, summary: string): Promise<void> {
  const entry: AuditEntry = {
    id: ctx.newId('aud'),
    at: nowIso(ctx),
    actorId: ctx.actor.userId,
    actorName: ctx.actor.name,
    role: ctx.actor.role,
    action,
    entity,
    entityId,
    summary,
  };
  await ctx.repo.audit.append(entry);
}

export async function getSettings(ctx: Ctx): Promise<LineSettings> {
  const s = await ctx.repo.settings.get('settings');
  if (!s) throw new NotFoundError('los ajustes de la línea');
  return s;
}

/** Avisos (campana). `to` puede ser una lista de usuarios o «toda la administración». */
export async function notify(
  ctx: Ctx,
  to: string[] | 'admins',
  kind: NotificationKind,
  title: string,
  body: string,
  link: string,
): Promise<void> {
  let userIds: string[];
  if (to === 'admins') {
    const admins = await ctx.repo.users.where('role', 'admin');
    userIds = admins.map((u: User) => u.id);
  } else {
    userIds = to;
  }
  const at = nowIso(ctx);
  const items: AppNotification[] = [...new Set(userIds)]
    .filter((id) => id !== ctx.actor.userId)
    .map((userId) => ({ id: ctx.newId('ntf'), userId, kind, title, body, link, at, read: false }));
  if (items.length) await ctx.repo.notifications.bulkPut(items);
}

export function linePath(ctx: Ctx, path: string): string {
  return `/${ctx.line}/${path.replace(/^\//, '')}`;
}
