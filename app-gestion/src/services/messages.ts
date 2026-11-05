// Mensajes por hilos (administración ↔ vendedor, vendedor ↔ local, local → administración
// si el vendedor no contesta en 24 h), comunicados y la campana de avisos.
import { z } from 'zod';
import type { Announcement, AppNotification, Message, Photo, Thread, User } from '../data/types';
import { can } from '../domain/permissions';
import { type Ctx, ForbiddenError, NotFoundError, ValidationError, audit, guard, mutate, notify, nowIso } from './context';

export const ESCALATION_HOURS = 24;

export interface ThreadView extends Thread {
  lastMessage?: Message;
  unread: number;
  otherNames: string;
}

async function myThreads(ctx: Ctx): Promise<Thread[]> {
  guard(ctx, 'message.read');
  const all = await ctx.repo.threads.all();
  if (ctx.actor.role === 'admin') return all;
  return all.filter((t) => can(ctx.actor, 'message.read', ctx.line, { type: 'thread', thread: t }));
}

export async function listThreads(ctx: Ctx): Promise<ThreadView[]> {
  const [threads, messages, users] = await Promise.all([myThreads(ctx), ctx.repo.messages.all(), ctx.repo.users.all()]);
  const usersById = new Map(users.map((u) => [u.id, u]));
  return threads
    .map((t) => {
      const msgs = messages.filter((m) => m.threadId === t.id).sort((a, b) => a.at.localeCompare(b.at));
      const lastRead = t.readBy[ctx.actor.userId] ?? '';
      const others = t.participantIds.filter((id) => id !== ctx.actor.userId).map((id) => usersById.get(id));
      return {
        ...t,
        lastMessage: msgs[msgs.length - 1],
        unread: msgs.filter((m) => m.authorId !== ctx.actor.userId && m.at > lastRead).length,
        otherNames: others
          .filter((u): u is User => Boolean(u))
          .map((u) => u.name)
          .join(', '),
      };
    })
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

export async function getThread(ctx: Ctx, threadId: string): Promise<{ thread: Thread; messages: Message[]; authors: Map<string, User> }> {
  const t = await ctx.repo.threads.get(threadId);
  if (!t) throw new NotFoundError('la conversación');
  if (ctx.actor.role !== 'admin') guard(ctx, 'message.read', { type: 'thread', thread: t });
  else guard(ctx, 'message.read');
  const [messages, users] = await Promise.all([ctx.repo.messages.where('threadId', threadId), ctx.repo.users.all()]);
  return {
    thread: t,
    messages: messages.sort((a, b) => a.at.localeCompare(b.at)),
    authors: new Map(users.map((u) => [u.id, { ...u, commissionOverride: undefined }])),
  };
}

export async function markThreadRead(ctx: Ctx, threadId: string): Promise<void> {
  if (ctx.actor.readOnly) return;
  const t = await ctx.repo.threads.get(threadId);
  if (!t || !t.participantIds.includes(ctx.actor.userId)) return;
  await mutate(ctx, async () => {
    t.readBy = { ...t.readBy, [ctx.actor.userId]: nowIso(ctx) };
    await ctx.repo.threads.put(t);
  });
}

const messageSchema = z.object({
  text: z.string().trim().max(2000),
  productId: z.string().optional(),
  photo: z.custom<Omit<Photo, 'id' | 'ownerType' | 'ownerId' | 'createdAt'>>().optional(),
});

export async function sendMessage(ctx: Ctx, threadId: string, input: z.input<typeof messageSchema>): Promise<Message> {
  const data = messageSchema.parse(input);
  if (!data.text && !data.productId && !data.photo) throw new ValidationError('Escribe un mensaje o adjunta algo.');
  return mutate(ctx, async () => {
    const t = await ctx.repo.threads.get(threadId);
    if (!t) throw new NotFoundError('la conversación');
    guard(ctx, 'message.send', { type: 'thread', thread: t });
    const at = nowIso(ctx);
    const msg: Message = { id: ctx.newId('msg'), threadId, authorId: ctx.actor.userId, at, text: data.text, productId: data.productId };
    if (data.photo) {
      const photoId = ctx.newId('pho');
      await ctx.repo.photos.put({ ...data.photo, id: photoId, ownerType: 'message', ownerId: msg.id, createdAt: at });
      msg.photoId = photoId;
    }
    await ctx.repo.messages.put(msg);
    t.lastMessageAt = at;
    t.readBy = { ...t.readBy, [ctx.actor.userId]: at };
    await ctx.repo.threads.put(t);
    await notify(
      ctx,
      t.participantIds,
      'mensaje',
      `Mensaje de ${ctx.actor.name}`,
      data.text ? data.text.slice(0, 120) : data.photo ? 'Te mandó una foto.' : 'Te mandó un producto.',
      `/${ctx.line}/mensajes/${t.id}`,
    );
    return msg;
  });
}

/**
 * Abre (o encuentra) la conversación con alguien:
 * - vendedor ↔ administración, vendedor ↔ su local;
 * - local → administración solo si su vendedor no contestó en 24 h.
 */
export async function openThread(ctx: Ctx, target: { kind: 'admin' } | { kind: 'seller' } | { kind: 'store'; storeId: string } | { kind: 'sellerById'; sellerId: string }): Promise<Thread> {
  guard(ctx, 'message.send');
  const all = await ctx.repo.threads.all();
  const users = await ctx.repo.users.all();
  const admins = users.filter((u) => u.role === 'admin');
  const me = ctx.actor;
  let kind: Thread['kind'];
  let participants: string[];
  let title: string;
  let storeId: string | undefined;
  let sellerId: string | undefined;

  if (target.kind === 'admin') {
    if (me.role === 'seller') {
      kind = 'admin_vendedor';
      participants = [me.userId, ...admins.map((a) => a.id)];
      title = `Administración · ${me.name}`;
      sellerId = me.userId;
    } else if (me.role === 'store' && me.storeId) {
      const store = await ctx.repo.stores.get(me.storeId);
      if (!store) throw new NotFoundError('tu local');
      const status = await escalationStatus(ctx, me.storeId);
      if (!status.allowed) throw new ValidationError(status.reason);
      kind = 'local_admin';
      participants = [me.userId, ...admins.map((a) => a.id)];
      title = `Administración · ${store.name}`;
      storeId = store.id;
    } else throw new ForbiddenError();
  } else if (target.kind === 'sellerById') {
    if (me.role !== 'admin') throw new ForbiddenError();
    const seller = users.find((u) => u.id === target.sellerId && u.role === 'seller');
    if (!seller) throw new NotFoundError('el vendedor');
    kind = 'admin_vendedor';
    participants = [seller.id, ...admins.map((a) => a.id)];
    title = `Administración · ${seller.name}`;
    sellerId = seller.id;
  } else if (target.kind === 'seller') {
    if (me.role !== 'store' || !me.storeId) throw new ForbiddenError();
    const store = await ctx.repo.stores.get(me.storeId);
    if (!store) throw new NotFoundError('tu local');
    kind = 'vendedor_local';
    participants = [store.sellerId, me.userId];
    title = store.name;
    storeId = store.id;
    sellerId = store.sellerId;
  } else {
    const store = await ctx.repo.stores.get(target.storeId);
    if (!store) throw new NotFoundError('el local');
    if (me.role === 'seller' && store.sellerId !== me.userId) throw new ForbiddenError('Ese local no es tuyo.');
    if (me.role !== 'seller' && me.role !== 'admin') throw new ForbiddenError();
    const storeUsers = users.filter((u) => u.storeId === store.id);
    if (storeUsers.length === 0) throw new ValidationError('Este local todavía no tiene cuenta: se crea cuando administración lo aprueba.');
    kind = 'vendedor_local';
    participants = [store.sellerId, ...storeUsers.map((u) => u.id)];
    title = store.name;
    storeId = store.id;
    sellerId = store.sellerId;
  }

  const existing = all.find(
    (t) => t.kind === kind && (storeId ? t.storeId === storeId : true) && (sellerId && kind === 'admin_vendedor' ? t.sellerId === sellerId : true),
  );
  if (existing) return existing;
  return mutate(ctx, async () => {
    const at = nowIso(ctx);
    const t: Thread = { id: ctx.newId('hil'), kind, title, participantIds: [...new Set(participants)], storeId, sellerId, createdAt: at, lastMessageAt: at, readBy: {} };
    await ctx.repo.threads.put(t);
    return t;
  });
}

/** ¿Puede el local escribirle a administración? Solo si su vendedor no contestó en 24 h. */
export async function escalationStatus(ctx: Ctx, storeId: string): Promise<{ allowed: boolean; reason: string; waitingSince?: string }> {
  const threads = (await ctx.repo.threads.all()).filter((t) => t.storeId === storeId);
  const direct = threads.find((t) => t.kind === 'local_admin');
  if (direct) return { allowed: true, reason: 'Ya tienes conversación con administración.' };
  const t = threads.find((x) => x.kind === 'vendedor_local');
  if (!t) return { allowed: false, reason: 'Primero escríbele a tu vendedor. Si no contesta en 24 horas, puedes escribirle a administración.' };
  const msgs = (await ctx.repo.messages.where('threadId', t.id)).sort((a, b) => a.at.localeCompare(b.at));
  const store = await ctx.repo.stores.get(storeId);
  const sellerId = store?.sellerId;
  const lastSeller = [...msgs].reverse().find((m) => m.authorId === sellerId);
  const pending = msgs.filter((m) => m.authorId !== sellerId && (!lastSeller || m.at > lastSeller.at));
  const first = pending[0];
  if (!first) return { allowed: false, reason: 'Tu vendedor ya te contestó. Si deja de contestar 24 horas, se habilita escribirle a administración.' };
  const hours = (ctx.now().getTime() - new Date(first.at).getTime()) / 3_600_000;
  if (hours >= ESCALATION_HOURS) return { allowed: true, reason: `Tu vendedor no contesta desde hace ${Math.floor(hours)} horas.`, waitingSince: first.at };
  return {
    allowed: false,
    reason: `Tu vendedor tiene hasta ${Math.ceil(ESCALATION_HOURS - hours)} horas más para contestar. Después podrás escribirle a administración.`,
    waitingSince: first.at,
  };
}

// ---------- Comunicados ----------

export async function listAnnouncements(ctx: Ctx): Promise<Announcement[]> {
  guard(ctx, 'announcement.read');
  const all = await ctx.repo.announcements.all();
  const visible = all.filter((a) => {
    if (ctx.actor.role === 'admin') return true;
    if (a.audience === 'todos') return true;
    return ctx.actor.role === 'seller' ? a.audience === 'vendedores' : a.audience === 'locales';
  });
  return visible.sort((a, b) => b.at.localeCompare(a.at));
}

const announcementSchema = z.object({
  title: z.string().trim().min(3, 'Escribe un título.').max(90),
  body: z.string().trim().min(5, 'Escribe el comunicado.').max(2000),
  audience: z.enum(['vendedores', 'locales', 'todos']),
});

export async function createAnnouncement(ctx: Ctx, input: z.input<typeof announcementSchema>): Promise<Announcement> {
  guard(ctx, 'announcement.create');
  const data = announcementSchema.parse(input);
  return mutate(ctx, async () => {
    const a: Announcement = { id: ctx.newId('com'), ...data, at: nowIso(ctx), authorId: ctx.actor.userId };
    await ctx.repo.announcements.put(a);
    const users = await ctx.repo.users.all();
    const to = users.filter((u) => u.active && (data.audience === 'todos' ? u.role !== 'admin' : data.audience === 'vendedores' ? u.role === 'seller' : u.role === 'store'));
    await notify(ctx, to.map((u) => u.id), 'comunicado', `Comunicado: ${a.title}`, a.body.slice(0, 120), `/${ctx.line}/mensajes`);
    await audit(ctx, 'comunicado.enviar', 'announcement', a.id, `Comunicado a ${data.audience}: ${a.title}`);
    return a;
  });
}

// ---------- Avisos (campana) ----------

export async function listNotifications(ctx: Ctx): Promise<AppNotification[]> {
  const list = await ctx.repo.notifications.where('userId', ctx.actor.userId);
  return list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
}

export async function unreadNotifications(ctx: Ctx): Promise<number> {
  const list = await ctx.repo.notifications.where('userId', ctx.actor.userId);
  return list.filter((n) => !n.read).length;
}

export async function markNotificationsRead(ctx: Ctx, ids?: string[]): Promise<void> {
  if (ctx.actor.readOnly) return;
  await mutate(ctx, async () => {
    const list = await ctx.repo.notifications.where('userId', ctx.actor.userId);
    const target = list.filter((n) => !n.read && (!ids || ids.includes(n.id)));
    for (const n of target) n.read = true;
    if (target.length) await ctx.repo.notifications.bulkPut(target);
  });
}

export async function getMessagePhoto(ctx: Ctx, photoId: string): Promise<Photo | undefined> {
  guard(ctx, 'message.read');
  return ctx.repo.photos.get(photoId);
}
