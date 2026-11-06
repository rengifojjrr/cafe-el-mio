// Invitaciones (R3-6): el token del link, su vencimiento, y abrirlo en este navegador o en otro.
import { beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../../src/data/types';
import { getCoreRepo, getLineRepo, setDbPrefix } from '../../src/data';
import { decodeInvitationToken, encodeInvitationToken, invitationLink, invitationMessage, invitationState, whatsappUrl } from '../../src/domain/invitation';
import { type Actor, ForbiddenError } from '../../src/domain/permissions';
import { lineCtx } from '../../src/services/context';
import { acceptInvitation, checkInvitation, createInvitation, listInvitations, revokeInvitation } from '../../src/services/invitations';
import { resetDemo } from '../../src/services/session';

const NOW = new Date('2026-11-05T15:00:00Z');

describe('token de la invitación', () => {
  const t = { line: 'tabaco' as const, accountId: 'tabaco:t-usr_0002', inv: 'inv_123', exp: '2026-11-12T15:00:00.000Z' };

  it('ida y vuelta, con letras seguras para un link', () => {
    const token = encodeInvitationToken(t);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeInvitationToken(token)).toEqual({ v: 1, ...t });
    const withAccents = encodeInvitationToken({ ...t, inv: 'inv_ñandú' });
    expect(decodeInvitationToken(withAccents)?.inv).toBe('inv_ñandú');
  });

  it('lo que no es una invitación de la app da null', () => {
    expect(decodeInvitationToken('hola')).toBeNull();
    expect(decodeInvitationToken('no es base64 !!!')).toBeNull();
    expect(decodeInvitationToken(btoa(JSON.stringify({ v: 2, ...t })).replace(/=+$/, ''))).toBeNull();
    // La cuenta tiene que ser de la línea del token.
    expect(decodeInvitationToken(encodeInvitationToken({ ...t, accountId: 'cafe:x' }))).toBeNull();
  });

  it('vigente, vencida o revocada', () => {
    expect(invitationState({ expiresAt: '2026-11-12T15:00:00.000Z' }, NOW)).toBe('vigente');
    expect(invitationState({ expiresAt: '2026-11-05T15:00:00.000Z' }, NOW)).toBe('vencida');
    expect(invitationState({ expiresAt: '2026-11-12T15:00:00.000Z', revokedAt: '2026-11-05T10:00:00.000Z' }, NOW)).toBe('revocada');
  });

  it('link, WhatsApp y texto listo para mandar', () => {
    expect(invitationLink('https://ejemplo.test/app/#/tabaco', 'abc')).toBe('https://ejemplo.test/app/#/invitacion/abc');
    const text = invitationMessage({ name: 'Tomás Garza', company: 'GM Tabacos', lineName: 'Tabaco', role: 'seller', link: 'https://x/#/invitacion/abc', expires: '12 nov 2026' });
    expect(text).toContain('Hola, Tomás');
    expect(text).toContain('https://x/#/invitacion/abc');
    expect(whatsappUrl(text)).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`);
  });
});

// ---------- Servicios (con las bases de la app, como en el navegador) ----------

let users: User[];
const actorOf = (u: User): Actor => ({ accountId: `tabaco:${u.id}`, userId: u.id, role: u.role, line: 'tabaco', storeId: u.storeId, name: u.name, readOnly: false });
const ctxOf = (u: User, now = NOW) => lineCtx('tabaco', actorOf(u), { repo: getLineRepo('tabaco'), now: () => now });

beforeAll(async () => {
  setDbPrefix('pruebas-invitaciones-');
  await resetDemo(NOW);
  users = await getLineRepo('tabaco').users.all();
});

describe('invitar y abrir el link', () => {
  it('administración invita a un vendedor; el link entra con su cuenta en este navegador', async () => {
    const admin = users.find((u) => u.role === 'admin')!;
    const tomas = users.find((u) => u.name === 'Lucía Paredes')!;
    const inv = await createInvitation(ctxOf(admin), { kind: 'seller', userId: tomas.id }, { days: 7 });
    expect(inv.state).toBe('vigente');
    expect(inv.accountId).toBe(`tabaco:${tomas.id}`);
    expect(new Date(inv.expiresAt).getTime() - NOW.getTime()).toBe(7 * 86_400_000);
    const list = await listInvitations(ctxOf(admin), { kind: 'seller', userId: tomas.id });
    expect(list[0]!.id).toBe(inv.id);
    // La semilla trae otra (vencida) de Lucía.
    expect(list.length).toBeGreaterThanOrEqual(2);

    const check = await checkInvitation(inv.token, NOW);
    expect(check).toMatchObject({ kind: 'ok', line: 'tabaco', role: 'seller' });
    const r = await acceptInvitation(inv.token, NOW);
    expect(r.kind).toBe('ok');
    expect((await getCoreRepo().session.get('session'))?.accountId).toBe(`tabaco:${tomas.id}`);
    expect((await getLineRepo('tabaco').invitations.get(inv.id))?.acceptedAt).toBe(NOW.toISOString());
  });

  it('la cuenta principal usa su id de «Entrar como…»', async () => {
    const admin = users.find((u) => u.role === 'admin')!;
    const andres = users.find((u) => u.name === 'Andrés Molina')!;
    const inv = await createInvitation(ctxOf(admin), { kind: 'seller', userId: andres.id });
    expect(inv.accountId).toBe('tabaco:seller');
  });

  it('vencida, revocada, de otro teléfono o ilegible: cada caso con su mensaje', async () => {
    const admin = users.find((u) => u.role === 'admin')!;
    const yanelis = users.find((u) => u.name === 'Yanelis Cruz')!;
    const inv = await createInvitation(ctxOf(admin), { kind: 'seller', userId: yanelis.id }, { days: 1 });
    expect((await checkInvitation(inv.token, new Date(NOW.getTime() + 2 * 86_400_000))).kind).toBe('vencida');
    await revokeInvitation(ctxOf(admin), inv.id);
    expect((await checkInvitation(inv.token, NOW)).kind).toBe('revocada');
    expect((await acceptInvitation(inv.token, NOW)).kind).toBe('revocada');
    // Creada en otro teléfono: este navegador no la tiene.
    const foreign = encodeInvitationToken({ line: 'tabaco', accountId: `tabaco:${yanelis.id}`, inv: 'inv_de_otro_telefono', exp: '2026-11-20T00:00:00.000Z' });
    expect((await checkInvitation(foreign, NOW)).kind).toBe('nube');
    const foreignOld = encodeInvitationToken({ line: 'tabaco', accountId: `tabaco:${yanelis.id}`, inv: 'inv_vieja', exp: '2026-10-01T00:00:00.000Z' });
    expect((await checkInvitation(foreignOld, NOW)).kind).toBe('vencida');
    expect((await checkInvitation('esto-no-es-un-token', NOW)).kind).toBe('invalida');
  });

  it('el local: lo invita su vendedor (no otro) y entra con la cuenta del local', async () => {
    const andres = users.find((u) => u.name === 'Andrés Molina')!;
    const yanelis = users.find((u) => u.name === 'Yanelis Cruz')!;
    const stores = await getLineRepo('tabaco').stores.all();
    const brisa = stores.find((s) => s.name === 'Licorería Brisa Doral')!;
    const esquina = stores.find((s) => s.name === 'Bodega La Esquina 49')!;
    await expect(createInvitation(ctxOf(yanelis), { kind: 'store', storeId: brisa.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvitation(ctxOf(andres), { kind: 'seller', userId: andres.id })).rejects.toBeInstanceOf(ForbiddenError);
    // Un local que todavía no se aprobó no tiene cuenta.
    await expect(createInvitation(ctxOf(andres), { kind: 'store', storeId: esquina.id })).rejects.toThrow(/no tiene cuenta/);
    const inv = await createInvitation(ctxOf(andres), { kind: 'store', storeId: brisa.id });
    const r = await acceptInvitation(inv.token, NOW);
    expect(r).toMatchObject({ kind: 'ok', role: 'store', storeName: 'Licorería Brisa Doral' });
    if (r.kind === 'ok') expect(r.account.storeId).toBe(brisa.id);
    // El vendedor ve las invitaciones de sus locales, no las de los vendedores.
    expect((await listInvitations(ctxOf(andres), { kind: 'store', storeId: brisa.id })).length).toBe(1);
    await expect(listInvitations(ctxOf(andres), { kind: 'seller', userId: andres.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('«ver como…» no invita', async () => {
    const admin = users.find((u) => u.role === 'admin')!;
    const tomas = users.find((u) => u.name === 'Lucía Paredes')!;
    const ro = lineCtx('tabaco', { ...actorOf(admin), readOnly: true }, { repo: getLineRepo('tabaco'), now: () => NOW });
    await expect(createInvitation(ro, { kind: 'seller', userId: tomas.id })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
