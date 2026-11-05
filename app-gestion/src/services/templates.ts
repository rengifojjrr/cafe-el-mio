// Plantillas PDF de contrato de consignación y de nota de entrega. Administración sube el PDF
// y ubica dónde va cada firma. Cada guardado es una versión nueva e inmutable: los documentos
// guardan el id de la plantilla con que se emitieron y se siguen viendo igual.
import { z } from 'zod';
import type { ContractTemplate, TemplateField, TemplateFieldType, TemplateKind } from '../data/types';
import { type Ctx, NotFoundError, ValidationError, audit, guard, mutate, nowIso } from './context';

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  consignacion: 'Contrato de consignación',
  entrega: 'Nota de entrega',
};

export const FIELD_LABEL: Record<TemplateFieldType, string> = {
  firma_local: 'Firma del local',
  firma_vendedor: 'Firma del vendedor',
  nombre_local: 'Nombre del local',
  encargado: 'Encargado',
  vendedor: 'Vendedor',
  fecha: 'Fecha',
  direccion_local: 'Dirección del local',
  detalle_entrega: 'Detalle de la entrega',
};

export const FIELDS_BY_KIND: Record<TemplateKind, TemplateFieldType[]> = {
  consignacion: ['firma_local', 'firma_vendedor', 'nombre_local', 'encargado', 'vendedor', 'fecha', 'direccion_local'],
  entrega: ['firma_local', 'detalle_entrega', 'nombre_local', 'encargado', 'vendedor', 'fecha', 'direccion_local'],
};

const REQUIRED_BY_KIND: Record<TemplateKind, TemplateFieldType[]> = {
  consignacion: ['firma_local', 'firma_vendedor'],
  entrega: ['firma_local'],
};

export const MAX_PDF_BYTES = 15 * 1024 * 1024;

const fieldSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['firma_local', 'firma_vendedor', 'nombre_local', 'encargado', 'vendedor', 'fecha', 'direccion_local', 'detalle_entrega']),
    page: z.number().int().min(0),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0.02, 'Un recuadro es demasiado chico.').max(1),
    h: z.number().min(0.01, 'Un recuadro es demasiado chico.').max(1),
  })
  .refine((f) => f.x + f.w <= 1.001 && f.y + f.h <= 1.001, 'Un recuadro se sale de la página.');

const templateSchema = z.object({
  kind: z.enum(['consignacion', 'entrega']),
  name: z.string().trim().min(3, 'Ponle un nombre a la plantilla.').max(80),
  pdf: z.custom<Blob>((v) => typeof Blob !== 'undefined' && v instanceof Blob, 'Falta el PDF.'),
  pageSizes: z.array(z.object({ w: z.number().positive(), h: z.number().positive() })).min(1, 'El PDF no tiene páginas.'),
  fields: z.array(fieldSchema),
});

export type TemplateInput = z.input<typeof templateSchema>;

function newestFirst(a: ContractTemplate, b: ContractTemplate): number {
  return b.version - a.version || b.createdAt.localeCompare(a.createdAt);
}

/** Todas las versiones (para administración). */
export async function listTemplates(ctx: Ctx, kind?: TemplateKind): Promise<ContractTemplate[]> {
  guard(ctx, 'settings.read');
  const all = kind ? await ctx.repo.templates.where('kind', kind) : await ctx.repo.templates.all();
  return all.sort(newestFirst);
}

/** La plantilla activa de un tipo (o null: se usa el texto de Ajustes o la nota generada). */
export async function getActiveTemplate(ctx: Ctx, kind: TemplateKind): Promise<ContractTemplate | null> {
  guard(ctx, 'contract.read');
  return findActive(ctx, kind);
}

/** Uso interno de los servicios: la plantilla activa, sin chequear permisos. */
export async function findActive(ctx: Ctx, kind: TemplateKind): Promise<ContractTemplate | null> {
  const list = await ctx.repo.templates.where('kind', kind);
  return list.filter((t) => t.active).sort(newestFirst)[0] ?? null;
}

/** Una versión concreta (la que usó un documento). La puede ver cualquier rol de la línea. */
export async function getTemplate(ctx: Ctx, id: string): Promise<ContractTemplate> {
  guard(ctx, 'contract.read');
  const t = await ctx.repo.templates.get(id);
  if (!t) throw new NotFoundError('la plantilla');
  return t;
}

/** Guarda una versión nueva, la deja activa y desactiva la anterior de ese tipo. */
export async function saveTemplate(ctx: Ctx, input: TemplateInput): Promise<ContractTemplate> {
  guard(ctx, 'settings.manage');
  const data = templateSchema.parse(input);
  if (data.pdf.size > MAX_PDF_BYTES) throw new ValidationError('El PDF pesa más de 15 MB: usa uno más liviano.');
  const allowed = new Set(FIELDS_BY_KIND[data.kind]);
  for (const f of data.fields) {
    if (!allowed.has(f.type)) throw new ValidationError(`«${FIELD_LABEL[f.type]}» no va en una ${TEMPLATE_KIND_LABEL[data.kind].toLowerCase()}.`);
    if (f.page >= data.pageSizes.length) throw new ValidationError('Hay un recuadro en una página que no existe.');
  }
  for (const req of REQUIRED_BY_KIND[data.kind]) {
    if (!data.fields.some((f) => f.type === req)) throw new ValidationError(`Falta ubicar «${FIELD_LABEL[req]}».`);
  }
  return mutate(ctx, async () => {
    const existing = await ctx.repo.templates.where('kind', data.kind);
    const version = existing.reduce((m, t) => Math.max(m, t.version), 0) + 1;
    for (const t of existing) {
      if (t.active) await ctx.repo.templates.put({ ...t, active: false });
    }
    const template: ContractTemplate = {
      id: ctx.newId('pla'),
      kind: data.kind,
      name: data.name,
      pdf: data.pdf,
      pageSizes: data.pageSizes,
      fields: data.fields.map((f) => ({ ...f }) as TemplateField),
      version,
      active: true,
      createdAt: nowIso(ctx),
      createdBy: ctx.actor.userId,
    };
    await ctx.repo.templates.put(template);
    await audit(ctx, 'plantilla.guardar', 'template', template.id, `${TEMPLATE_KIND_LABEL[data.kind]}: plantilla PDF v${version} «${data.name}» activa (${data.fields.length} recuadros)`);
    return template;
  });
}

/** Vuelve al texto de Ajustes (contrato) o a la nota generada por la app (entrega). */
export async function revertToTextTemplate(ctx: Ctx, kind: TemplateKind): Promise<void> {
  guard(ctx, 'settings.manage');
  await mutate(ctx, async () => {
    const list = await ctx.repo.templates.where('kind', kind);
    let changed = 0;
    for (const t of list) {
      if (!t.active) continue;
      await ctx.repo.templates.put({ ...t, active: false });
      changed += 1;
    }
    if (changed) await audit(ctx, 'plantilla.texto', 'template', kind, `${TEMPLATE_KIND_LABEL[kind]}: se vuelve a usar el texto`);
  });
}

/** Nombre del encargo («usar el texto»). Es el mismo servicio que revertToTextTemplate. */
export const useTextTemplate = revertToTextTemplate;
