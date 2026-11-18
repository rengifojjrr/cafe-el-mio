// Usuarios y zonas, ajustes de la línea y auditoría (solo administración).
import { z } from 'zod';
import type { AuditEntry, LineSettings, Store, User, Zone } from '../data/types';
import { cambiosAlAsignar } from '../domain/equipo';
import { templateVariables } from '../domain/contract';
import { marketsOf, pointInMarket } from '../domain/markets';
import { type Ctx, NotFoundError, ValidationError, audit, getSettings, guard, mutate, nowIso } from './context';

export async function listUsers(ctx: Ctx): Promise<User[]> {
  guard(ctx, 'user.read');
  const users = await ctx.repo.users.all();
  const order = { admin: 0, seller: 1, store: 2 } as const;
  return users.sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name, 'es'));
}

const ruleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('percent'),
    value: z.number({ error: 'Escribe el porcentaje de la comisión.' }).min(0, 'La comisión no puede ser negativa.').max(50, 'La comisión no puede pasar del 50 %.'),
  }),
  z.object({
    type: z.literal('fixed'),
    value: z.number({ error: 'Escribe el monto de la comisión por unidad.' }).min(0, 'La comisión no puede ser negativa.'),
  }),
]);

/** La comisión propia de un vendedor: la de los productos, o la diferencia sobre el precio base. */
const reglaVendedorSchema = z.union([ruleSchema, z.object({ type: z.literal('diferencia'), value: z.literal(0).default(0) })]);

const userSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['admin', 'seller']),
  name: z.string().trim().min(3, 'Escribe el nombre completo.'),
  email: z.union([z.literal(''), z.string().trim().email('Escribe un correo válido.')]),
  phone: z.string().trim().max(20, 'El teléfono es demasiado largo.').default(''),
  /** Forma vieja (una sola zona): equivale a `zoneIds: [zoneId]`. */
  zoneId: z.string().optional(),
  /** Vendedor: las zonas de las que queda responsable (todas de su mercado). Reemplaza las que tenía. */
  zoneIds: z.array(z.string()).optional(),
  /** Vendedor: su mercado (si falta, el de sus zonas). */
  marketId: z.string().optional(),
  commissionOverride: reglaVendedorSchema.optional(),
  active: z.boolean().default(true),
});

/** Alta (o edición) de vendedores y de personas de administración. Las cuentas de los locales se crean al aprobarlos. */
export async function saveUser(ctx: Ctx, input: z.input<typeof userSchema>): Promise<User> {
  guard(ctx, 'user.manage');
  const data = userSchema.parse(input);
  const zoneIds = data.role === 'seller' ? [...new Set(data.zoneIds ?? (data.zoneId ? [data.zoneId] : []))] : [];
  if (data.role === 'seller' && zoneIds.length === 0) throw new ValidationError('Elige al menos una zona del vendedor.');
  return mutate(ctx, async () => {
    const prev = data.id ? await ctx.repo.users.get(data.id) : undefined;
    if (data.id && !prev) throw new NotFoundError('el usuario');
    const markets = marketsOf(await getSettings(ctx));
    const zones = await ctx.repo.zones.all();
    const elegidas = zoneIds.map((id) => {
      const zone = zones.find((z) => z.id === id);
      if (!zone) throw new NotFoundError('la zona');
      return zone;
    });
    const mercadoDe = (z: Zone) => z.marketId ?? markets[0]!.id;
    let marketId = data.role === 'seller' ? (data.marketId ?? prev?.marketId) : undefined;
    if (marketId) {
      if (!markets.some((m) => m.id === marketId)) throw new ValidationError('Ese mercado no existe en la línea.');
      if (elegidas.some((z) => mercadoDe(z) !== marketId)) throw new ValidationError('La zona elegida es de otro mercado.');
    } else {
      marketId = undefined;
      if (new Set(elegidas.map(mercadoDe)).size > 1) throw new ValidationError('Las zonas de un vendedor tienen que ser del mismo mercado.');
    }
    const user: User = {
      id: prev?.id ?? ctx.newId('usr'),
      role: data.role,
      name: data.name,
      email: data.email,
      phone: data.phone,
      // La zona principal (para el mapa): la primera que se eligió.
      zoneId: data.role === 'seller' ? zoneIds[0] : undefined,
      commissionOverride: data.role === 'seller' ? data.commissionOverride : undefined,
      // Lo de la ronda 3 que se edita en otras pantallas se conserva al guardar.
      commissionScheme: data.role === 'seller' ? prev?.commissionScheme : undefined,
      marketId,
      active: data.active,
      createdAt: prev?.createdAt ?? nowIso(ctx),
    };
    if (!user.commissionScheme) delete user.commissionScheme;
    if (!user.marketId) delete user.marketId;
    if (!user.zoneId) delete user.zoneId;
    await ctx.repo.users.put(user);
    await audit(ctx, prev ? 'usuario.editar' : 'usuario.crear', 'user', user.id, `${prev ? 'Editado' : 'Alta de'} ${user.role === 'seller' ? 'vendedor' : 'administración'}: ${user.name}`);
    if (user.role === 'seller') await asignarZonas(ctx, user, zoneIds, zones);
    return user;
  });
}

/**
 * Deja a `seller` responsable exactamente de `zoneIds`. Las zonas que gana se le quitan a quien las
 * tenía y sus locales pasan a él (salvo los asignados a mano a otro). Las que deja quedan sin
 * responsable: sus locales siguen con quien los tiene hasta que la zona tenga otro. Va dentro de un
 * `mutate`.
 */
async function asignarZonas(ctx: Ctx, seller: User, zoneIds: readonly string[], zones: readonly Zone[]): Promise<void> {
  const stores = await ctx.repo.stores.all();
  const { gana, deja } = cambiosAlAsignar(zones, stores, seller.id, zoneIds);
  let movidos = 0;
  for (const c of gana) {
    await ctx.repo.zones.put({ ...c.zone, sellerId: seller.id });
    movidos += await moverLocales(ctx, stores, c.zone.id, seller.id);
  }
  for (const z of deja) {
    const { sellerId: _antes, ...sinResponsable } = z;
    await ctx.repo.zones.put(sinResponsable);
  }
  if (gana.length || deja.length) {
    const partes = [
      gana.length ? `responsable de ${gana.map((c) => c.zone.name).join(', ')}` : '',
      movidos ? `${movidos === 1 ? 'pasa 1 local' : `pasan ${movidos} locales`}` : '',
      deja.length ? `deja ${deja.map((z) => z.name).join(', ')} (sin responsable)` : '',
    ].filter(Boolean);
    await audit(ctx, 'zona.responsable', 'user', seller.id, `${seller.name}: ${partes.join('; ')}`);
  }
}

/** Los locales de la zona que siguen a la zona (no asignados a mano) pasan a `sellerId`. Devuelve cuántos. */
async function moverLocales(ctx: Ctx, stores: readonly Store[], zoneId: string, sellerId: string): Promise<number> {
  let n = 0;
  for (const s of stores) {
    if (s.zoneId !== zoneId) continue;
    if (s.sellerFijo) {
      // Asignado a mano a este mismo vendedor: ya no es una excepción.
      if (s.sellerId === sellerId) {
        const { sellerFijo: _f, ...normal } = s;
        await ctx.repo.stores.put(normal);
      }
      continue;
    }
    if (s.sellerId === sellerId) continue;
    await ctx.repo.stores.put({ ...s, sellerId });
    n += 1;
  }
  return n;
}

/**
 * Cambia el responsable de una zona (o la deja sin responsable con `null`). Sus locales pasan al
 * nuevo responsable, salvo los asignados a mano a otro. Devuelve cuántos locales pasaron.
 */
export async function asignarResponsable(ctx: Ctx, zoneId: string, sellerId: string | null): Promise<{ zone: Zone; movidos: number }> {
  guard(ctx, 'user.manage');
  return mutate(ctx, async () => {
    const zone = await ctx.repo.zones.get(zoneId);
    if (!zone) throw new NotFoundError('la zona');
    const markets = marketsOf(await getSettings(ctx));
    const mercadoZona = zone.marketId ?? markets[0]!.id;
    if (!sellerId) {
      if (!zone.sellerId) return { zone, movidos: 0 };
      const { sellerId: _antes, ...sinResponsable } = zone;
      await ctx.repo.zones.put(sinResponsable);
      await audit(ctx, 'zona.responsable', 'zone', zone.id, `${zone.name} queda sin responsable`);
      return { zone: sinResponsable, movidos: 0 };
    }
    const seller = await ctx.repo.users.get(sellerId);
    if (!seller || seller.role !== 'seller') throw new ValidationError('El vendedor no existe en esta línea.');
    if (!seller.active) throw new ValidationError(`${seller.name} está inactivo: actívalo antes de darle una zona.`);
    const zones = await ctx.repo.zones.all();
    const mercadoVendedor = seller.marketId ?? zones.find((z) => z.id === seller.zoneId)?.marketId ?? (seller.zoneId ? markets[0]!.id : undefined);
    if (mercadoVendedor && mercadoVendedor !== mercadoZona) throw new ValidationError(`${seller.name} trabaja en otro mercado.`);
    const next: Zone = { ...zone, sellerId };
    await ctx.repo.zones.put(next);
    const movidos = zone.sellerId === sellerId ? 0 : await moverLocales(ctx, await ctx.repo.stores.all(), zone.id, sellerId);
    if (!seller.zoneId) await ctx.repo.users.put({ ...seller, zoneId: zone.id });
    await audit(ctx, 'zona.responsable', 'zone', zone.id, `${zone.name}: responsable ${seller.name}${movidos ? ` (${movidos === 1 ? 'pasa 1 local' : `pasan ${movidos} locales`})` : ''}`);
    return { zone: next, movidos };
  });
}

export async function setUserActive(ctx: Ctx, userId: string, active: boolean): Promise<void> {
  guard(ctx, 'user.manage');
  if (userId === ctx.actor.userId && !active) throw new ValidationError('No puedes desactivar tu propia cuenta.');
  await mutate(ctx, async () => {
    const u = await ctx.repo.users.get(userId);
    if (!u) throw new NotFoundError('el usuario');
    u.active = active;
    await ctx.repo.users.put(u);
    await audit(ctx, active ? 'usuario.activar' : 'usuario.desactivar', 'user', u.id, `${u.name} ${active ? 'activo' : 'inactivo'}`);
  });
}

const zoneSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, 'Escribe el nombre de la zona.'),
  lat: z.number({ error: 'Toca el mapa o escribe la latitud.' }),
  lng: z.number({ error: 'Toca el mapa o escribe la longitud.' }),
  /** Mercado de la zona (si falta, el primero de la línea). */
  marketId: z.string().optional(),
});

export async function saveZone(ctx: Ctx, input: z.input<typeof zoneSchema>): Promise<Zone> {
  guard(ctx, 'user.manage');
  const data = zoneSchema.parse(input);
  return mutate(ctx, async () => {
    const markets = marketsOf(await getSettings(ctx));
    const prev = data.id ? await ctx.repo.zones.get(data.id) : undefined;
    const marketId = data.marketId ?? prev?.marketId ?? markets[0]!.id;
    const market = markets.find((m) => m.id === marketId);
    if (!market) throw new ValidationError('Ese mercado no existe en la línea.');
    if (!pointInMarket(market, data.lat, data.lng)) {
      throw new ValidationError(market.id === 'miami' ? 'El punto queda fuera del sur de Florida.' : `El punto queda lejos de ${market.name}.`);
    }
    const zone: Zone = { id: data.id ?? ctx.newId('zon'), name: data.name, lat: data.lat, lng: data.lng, marketId };
    await ctx.repo.zones.put(zone);
    await audit(ctx, 'zona.guardar', 'zone', zone.id, `Zona ${zone.name}`);
    return zone;
  });
}

export async function readSettings(ctx: Ctx): Promise<LineSettings> {
  guard(ctx, 'settings.read');
  return getSettings(ctx);
}

const settingsSchema = z.object({
  companyName: z.string().trim().min(3, 'Escribe la razón social de la empresa.'),
  settlementEveryDays: z
    .number({ error: 'Escribe cada cuántos días se liquida.' })
    .int('Los días son un número entero.')
    .min(7, 'Mínimo cada 7 días.')
    .max(60, 'Máximo cada 60 días.'),
  paymentTermsDays: z
    .number({ error: 'Escribe los días para pagar.' })
    .int('Los días son un número entero.')
    .min(0, 'Los días para pagar no pueden ser negativos.')
    .max(60, 'Máximo 60 días para pagar.'),
  commissionPayableOn: z.enum(['venta', 'cobro']),
  defaultSellerCommission: ruleSchema,
  defaultLowStock: z
    .number({ error: 'Escribe el stock bajo por defecto.' })
    .int('El stock bajo es un número entero.')
    .min(0, 'El stock bajo no puede ser negativo.'),
  expiryWarningDays: z
    .number({ error: 'Escribe con cuántos días se avisa el vencimiento.' })
    .int('Los días son un número entero.')
    .min(1, 'Mínimo 1 día.')
    .max(180, 'Máximo 180 días.'),
  noRotationDays: z
    .number({ error: 'Escribe los días sin ventas para «no rota».' })
    .int('Los días son un número entero.')
    .min(7, 'Mínimo 7 días.')
    .max(120, 'Máximo 120 días.'),
  contractTermMonths: z
    .number({ error: 'Escribe la vigencia del contrato.' })
    .int('Los meses son un número entero.')
    .min(1, 'Mínimo 1 mes.')
    .max(60, 'Máximo 60 meses.'),
  terminationNoticeDays: z
    .number({ error: 'Escribe los días de aviso para terminar.' })
    .int('Los días son un número entero.')
    .min(0, 'Los días de aviso no pueden ser negativos.')
    .max(120, 'Máximo 120 días.'),
  contractTemplate: z.string().min(100, 'La plantilla es demasiado corta.'),
});

export async function saveSettings(ctx: Ctx, input: z.input<typeof settingsSchema>): Promise<LineSettings> {
  guard(ctx, 'settings.manage');
  const data = settingsSchema.parse(input);
  const vars = templateVariables(data.contractTemplate);
  const required = ['local.nombre', 'local.encargado', 'empresa.nombre', 'anexo.productos', 'liquidacion.dias'];
  if (ctx.line === 'tabaco') required.push('permiso.numero');
  const missing = required.filter((v) => !vars.includes(v));
  if (missing.length) throw new ValidationError(`A la plantilla le faltan variables obligatorias: ${missing.map((m) => `{{${m}}}`).join(', ')}.`);
  if (!/abogado/i.test(data.contractTemplate)) throw new ValidationError('La plantilla tiene que conservar el aviso de que la revisa un abogado.');
  return mutate(ctx, async () => {
    const prev = await getSettings(ctx);
    const templateChanged = prev.contractTemplate !== data.contractTemplate;
    const next: LineSettings = {
      ...prev,
      ...data,
      contractTemplateVersion: templateChanged ? prev.contractTemplateVersion + 1 : prev.contractTemplateVersion,
    };
    await ctx.repo.settings.put(next);
    await audit(
      ctx,
      'ajustes.guardar',
      'settings',
      next.id,
      templateChanged ? `Ajustes guardados; plantilla de contrato v${next.contractTemplateVersion}` : 'Ajustes guardados',
    );
    return next;
  });
}

export async function listAudit(ctx: Ctx, limit = 300): Promise<AuditEntry[]> {
  guard(ctx, 'audit.read');
  const all = await ctx.repo.audit.all();
  return all.slice(-limit).reverse();
}
