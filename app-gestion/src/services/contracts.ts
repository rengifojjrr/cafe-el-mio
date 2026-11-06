// Contrato de consignación entre la empresa de la línea y el local, firmado en el teléfono
// del vendedor: firman el encargado del local y el vendedor como representante de la empresa.
import { z } from 'zod';
import type { Contract, ContractAnnexItem, Signature, Store, User } from '../data/types';
import { annexText, renderTemplate } from '../domain/contract';
import { permitState } from '../domain/compliance';
import { storeEarning } from '../domain/money-rules';
import { fmtDate } from '../lib/time';
import { type Ctx, NotFoundError, ValidationError, audit, getSettings, guard, mutate, notify, nowIso } from './context';
import { STORE_STATUS_LABEL, loadStoreForActor } from './stores';
import { findActive } from './templates';

export async function contractsForStore(ctx: Ctx, storeId: string): Promise<Contract[]> {
  const store = await loadStoreForActor(ctx, storeId);
  guard(ctx, 'contract.read', { type: 'store', store });
  const list = await ctx.repo.contracts.where('storeId', storeId);
  return list.sort((a, b) => b.version - a.version);
}

export async function getContract(ctx: Ctx, contractId: string): Promise<{ contract: Contract; store: Store; seller?: User }> {
  const contract = await ctx.repo.contracts.get(contractId);
  if (!contract) throw new NotFoundError('el contrato');
  const store = await loadStoreForActor(ctx, contract.storeId);
  guard(ctx, 'contract.read', { type: 'store', store });
  const seller = await ctx.repo.users.get(store.sellerId);
  return { contract, store, seller: seller ? { ...seller, commissionOverride: undefined } : undefined };
}

/** Vista previa del texto con los datos de hoy (sin guardar nada). */
export async function previewContract(ctx: Ctx, storeId: string): Promise<{ body: string; missing: string[]; annex: ContractAnnexItem[] }> {
  const store = await loadStoreForActor(ctx, storeId);
  guard(ctx, 'contract.read', { type: 'store', store });
  const previous = await ctx.repo.contracts.where('storeId', storeId);
  const version = previous.reduce((m, c) => Math.max(m, c.version), 0) + 1;
  return buildBody(ctx, store, version);
}

async function buildBody(ctx: Ctx, store: Store, version: number) {
  const [settings, seller, products] = await Promise.all([getSettings(ctx), ctx.repo.users.get(store.sellerId), ctx.repo.products.all()]);
  const annex: ContractAnnexItem[] = products
    .filter((p) => p.active)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((p) => ({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      unitName: p.unitName,
      priceToStore: p.priceToStore,
      suggestedRetail: p.suggestedRetail,
      storeEarning: storeEarning(p),
    }));
  const vars: Record<string, string> = {
    'contrato.version': String(version),
    fecha: fmtDate(ctx.now()),
    'empresa.nombre': settings.companyName,
    'empresa.representante': seller?.name ?? '',
    'local.nombre': store.name,
    'local.tipo': store.type.toLowerCase(),
    'local.direccion': `${store.address}, ${store.city}`,
    'local.encargado': store.managerName,
    'local.telefono': store.phone,
    'local.correo': store.email || 'sin correo',
    'liquidacion.dias': String(settings.settlementEveryDays),
    'pago.dias': String(settings.paymentTermsDays),
    'vigencia.meses': String(settings.contractTermMonths),
    'aviso.dias': String(settings.terminationNoticeDays),
    'anexo.productos': annexText(annex, ctx.config.unitName.one),
  };
  if (store.tobaccoPermit) {
    vars['permiso.numero'] = store.tobaccoPermit.number;
    vars['permiso.vence'] = fmtDate(store.tobaccoPermit.expiresOn);
  }
  const { text, missing } = renderTemplate(settings.contractTemplate, vars);
  return { body: text, missing, annex, settings };
}

/** Emite (o vuelve a emitir) el contrato del local: queda «enviado», listo para firmar. */
export async function issueContract(ctx: Ctx, storeId: string): Promise<Contract> {
  return mutate(ctx, async () => {
    const store = await ctx.repo.stores.get(storeId);
    if (!store) throw new NotFoundError('el local');
    guard(ctx, 'contract.issue', { type: 'store', store });
    if (store.status === 'cerrado') throw new ValidationError('El local está cerrado.');
    if (ctx.config.requiresTobaccoPermit) {
      const st = permitState(store, ctx.now());
      if (st === 'sin_permiso') throw new ValidationError('Registra el permiso de venta de tabaco del local antes de emitir el contrato.');
      if (st === 'vencido') throw new ValidationError('El permiso de venta de tabaco del local está vencido: actualízalo antes de emitir el contrato.');
    }
    const previous = await ctx.repo.contracts.where('storeId', storeId);
    const version = previous.reduce((m, c) => Math.max(m, c.version), 0) + 1;
    const { body, missing, annex, settings } = await buildBody(ctx, store, version);
    if (missing.length) throw new ValidationError(`Faltan datos para el contrato: ${missing.join(', ')}.`);
    for (const c of previous) {
      if (c.status === 'enviado') {
        c.status = 'anulado';
        await ctx.repo.contracts.put(c);
      }
    }
    // Si administración dejó activa una plantilla PDF, el contrato se emite sobre ese PDF.
    const pdfTemplate = await findActive(ctx, 'consignacion');
    const contract: Contract = {
      id: ctx.newId('ctr'),
      storeId,
      version,
      templateVersion: pdfTemplate ? pdfTemplate.version : settings.contractTemplateVersion,
      status: 'enviado',
      body,
      annex,
      settlementDays: settings.settlementEveryDays,
      createdAt: nowIso(ctx),
      createdBy: ctx.actor.userId,
      signatures: [],
      templateId: pdfTemplate?.id,
    };
    await ctx.repo.contracts.put(contract);
    if (store.status === 'prospecto') {
      store.status = 'contrato_enviado';
      store.statusHistory.push({ status: 'contrato_enviado', at: contract.createdAt, by: ctx.actor.userId });
      await ctx.repo.stores.put(store);
    }
    await audit(ctx, 'contrato.emitir', 'contract', contract.id, `Contrato v${version} de ${store.name} listo para firmar`);
    return contract;
  });
}

const signatureSchema = z.object({
  name: z.string().trim().min(3, 'Escribe el nombre completo de quien firma.'),
  image: z.string().startsWith('data:image/png', 'Falta la firma.').min(200, 'La firma está vacía.'),
  geo: z.object({ lat: z.number(), lng: z.number(), accuracy: z.number() }).optional(),
});

export async function signContract(
  ctx: Ctx,
  contractId: string,
  input: { local: z.input<typeof signatureSchema>; empresa: z.input<typeof signatureSchema>; consent: boolean },
): Promise<Contract> {
  if (!input.consent) throw new ValidationError('Hace falta aceptar firmar electrónicamente.');
  const local = signatureSchema.parse(input.local);
  const empresa = signatureSchema.parse(input.empresa);
  return mutate(ctx, async () => {
    const contract = await ctx.repo.contracts.get(contractId);
    if (!contract) throw new NotFoundError('el contrato');
    const store = await ctx.repo.stores.get(contract.storeId);
    if (!store) throw new NotFoundError('el local');
    guard(ctx, 'contract.sign', { type: 'store', store });
    if (contract.status !== 'enviado') throw new ValidationError('Este contrato ya no se puede firmar.');
    const at = nowIso(ctx);
    const sig = (role: Signature['role'], s: z.output<typeof signatureSchema>): Signature => ({
      role,
      name: s.name,
      image: s.image,
      signedAt: at,
      geo: s.geo,
      deviceUserId: ctx.actor.userId,
    });
    contract.signatures = [sig('local', local), sig('empresa', empresa)];
    contract.status = 'firmado';
    contract.signedAt = at;
    await ctx.repo.contracts.put(contract);
    if (store.status === 'prospecto' || store.status === 'contrato_enviado') {
      store.status = 'firmado';
      store.statusHistory.push({ status: 'firmado', at, by: ctx.actor.userId });
      await ctx.repo.stores.put(store);
    }
    await audit(ctx, 'contrato.firmar', 'contract', contract.id, `Contrato v${contract.version} de ${store.name} firmado por ${local.name} y ${empresa.name}`);
    await notify(
      ctx,
      'admins',
      'contrato_firmado',
      `Contrato firmado: ${store.name}`,
      `Quedó «${STORE_STATUS_LABEL[store.status]}». Revísalo y aprueba el local.`,
      `/${ctx.line}/locales/${store.id}`,
    );
    return contract;
  });
}
