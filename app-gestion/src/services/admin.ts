// Usuarios y zonas, ajustes de la línea y auditoría (solo administración).
import { z } from 'zod';
import type { AuditEntry, LineSettings, User, Zone } from '../data/types';
import { templateVariables } from '../domain/contract';
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

const userSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['admin', 'seller']),
  name: z.string().trim().min(3, 'Escribe el nombre completo.'),
  email: z.union([z.literal(''), z.string().trim().email('Escribe un correo válido.')]),
  phone: z.string().trim().max(20, 'El teléfono es demasiado largo.').default(''),
  zoneId: z.string().optional(),
  commissionOverride: ruleSchema.optional(),
  active: z.boolean().default(true),
});

/** Alta (o edición) de vendedores y de personas de administración. Las cuentas de los locales se crean al aprobarlos. */
export async function saveUser(ctx: Ctx, input: z.input<typeof userSchema>): Promise<User> {
  guard(ctx, 'user.manage');
  const data = userSchema.parse(input);
  if (data.role === 'seller' && !data.zoneId) throw new ValidationError('Elige la zona del vendedor.');
  return mutate(ctx, async () => {
    const prev = data.id ? await ctx.repo.users.get(data.id) : undefined;
    if (data.id && !prev) throw new NotFoundError('el usuario');
    const user: User = {
      id: prev?.id ?? ctx.newId('usr'),
      role: data.role,
      name: data.name,
      email: data.email,
      phone: data.phone,
      zoneId: data.zoneId,
      commissionOverride: data.role === 'seller' ? data.commissionOverride : undefined,
      // La comisión progresiva propia se edita en otra hoja: se conserva al guardar.
      commissionScheme: data.role === 'seller' ? prev?.commissionScheme : undefined,
      active: data.active,
      createdAt: prev?.createdAt ?? nowIso(ctx),
    };
    if (!user.commissionScheme) delete user.commissionScheme;
    await ctx.repo.users.put(user);
    await audit(ctx, prev ? 'usuario.editar' : 'usuario.crear', 'user', user.id, `${prev ? 'Editado' : 'Alta de'} ${user.role === 'seller' ? 'vendedor' : 'administración'}: ${user.name}`);
    return user;
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
  lat: z.number({ error: 'Toca el mapa o escribe la latitud.' }).min(24, 'El punto queda fuera del sur de Florida.').max(27.5, 'El punto queda fuera del sur de Florida.'),
  lng: z.number({ error: 'Toca el mapa o escribe la longitud.' }).min(-82.5, 'El punto queda fuera del sur de Florida.').max(-79.5, 'El punto queda fuera del sur de Florida.'),
});

export async function saveZone(ctx: Ctx, input: z.input<typeof zoneSchema>): Promise<Zone> {
  guard(ctx, 'user.manage');
  const data = zoneSchema.parse(input);
  return mutate(ctx, async () => {
    const zone: Zone = { id: data.id ?? ctx.newId('zon'), name: data.name, lat: data.lat, lng: data.lng };
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
