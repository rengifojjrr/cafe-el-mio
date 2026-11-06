// Datos fiscales de los locales: Tax ID (EIN), certificado de reventa, quién emite el permiso de
// tabaco y la foto o PDF de cada documento; avisos de vencimiento y el «Reporte para la contadora».
import { z } from 'zod';
import type { AppNotification, IsoDate, Photo, Store, StoreDocumentKind } from '../data/types';
import { type AccountantRow, type AccountantTotals, DEFAULT_PERMIT_ISSUER, DOC_LABEL, type DocWarning, buildAccountantRows, docAlertNotice, normalizeEin, storeDocWarnings } from '../domain/fiscal';
import { marketName } from '../domain/markets';
import { fmtDate } from '../lib/time';
import { type Ctx, NotFoundError, ValidationError, audit, guard, mutate, nowIso } from './context';
import { loadMarketIndex } from './markets';
import { loadStoreForActor, scopedStores } from './stores';

/** Tamaño máximo de un PDF de documento (las fotos se comprimen antes). */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

const fiscalSchema = z.object({
  taxId: z.string().trim().max(12).default(''),
  resaleCert: z
    .object({
      number: z.string().trim().max(40),
      expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha de vencimiento del certificado.'),
    })
    .nullable()
    .default(null),
  permitIssuer: z.string().trim().max(60).optional(),
});

/** Guarda Tax ID, certificado de reventa y quién emite el permiso. Vacío borra el dato. */
export async function saveStoreFiscal(ctx: Ctx, storeId: string, input: z.input<typeof fiscalSchema>): Promise<Store> {
  const data = fiscalSchema.parse(input);
  let taxId = '';
  if (data.taxId) {
    const ein = normalizeEin(data.taxId);
    if (!ein) throw new ValidationError('El Tax ID (EIN) tiene 9 dígitos: NN-NNNNNNN.');
    taxId = ein;
  }
  if (data.resaleCert && data.resaleCert.number.length > 0 && data.resaleCert.number.length < 4) {
    throw new ValidationError('Escribe el número del certificado de reventa.');
  }
  return mutate(ctx, async () => {
    const s = await ctx.repo.stores.get(storeId);
    if (!s) throw new NotFoundError('el local');
    guard(ctx, 'store.update', { type: 'store', store: s });
    const next: Store = { ...s };
    if (taxId) next.taxId = taxId;
    else delete next.taxId;
    if (data.resaleCert?.number) next.resaleCert = { number: data.resaleCert.number, expiresOn: data.resaleCert.expiresOn };
    else delete next.resaleCert;
    if (data.permitIssuer !== undefined && next.tobaccoPermit) next.tobaccoPermit = { ...next.tobaccoPermit, issuer: data.permitIssuer || DEFAULT_PERMIT_ISSUER };
    await ctx.repo.stores.put(next);
    await audit(ctx, 'local.fiscal', 'store', s.id, `Datos fiscales de ${s.name}: Tax ID ${next.taxId ?? 'sin dato'}, certificado de reventa ${next.resaleCert ? `${next.resaleCert.number} (vence ${next.resaleCert.expiresOn})` : 'sin dato'}`);
    return next;
  });
}

export interface NewDocument {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
}

/** Sube la foto o el PDF de un documento del local (reemplaza el anterior). */
export async function uploadStoreDocument(ctx: Ctx, storeId: string, kind: StoreDocumentKind, file: NewDocument): Promise<string> {
  const isPdf = file.mime === 'application/pdf';
  if (!isPdf && !file.mime.startsWith('image/')) throw new ValidationError('Sube una foto o un PDF.');
  if (file.blob.size > MAX_DOCUMENT_BYTES) throw new ValidationError('El archivo pasa de 8 MB: súbelo más liviano.');
  return mutate(ctx, async () => {
    const s = await ctx.repo.stores.get(storeId);
    if (!s) throw new NotFoundError('el local');
    guard(ctx, 'store.update', { type: 'store', store: s });
    const id = ctx.newId('doc');
    const photo: Photo = { id, ownerType: 'document', ownerId: storeId, blob: file.blob, mime: file.mime, width: file.width, height: file.height, createdAt: nowIso(ctx) };
    await ctx.repo.photos.put(photo);
    const prev = s.documents?.[kind];
    if (prev) await ctx.repo.photos.remove(prev);
    await ctx.repo.stores.put({ ...s, documents: { ...s.documents, [kind]: id } });
    await audit(ctx, 'local.documento', 'store', s.id, `${DOC_LABEL[kind]} de ${s.name}: ${isPdf ? 'PDF' : 'foto'} nuevo`);
    return id;
  });
}

export async function removeStoreDocument(ctx: Ctx, storeId: string, kind: StoreDocumentKind): Promise<void> {
  await mutate(ctx, async () => {
    const s = await ctx.repo.stores.get(storeId);
    if (!s) throw new NotFoundError('el local');
    guard(ctx, 'store.update', { type: 'store', store: s });
    const prev = s.documents?.[kind];
    if (!prev) return;
    await ctx.repo.photos.remove(prev);
    const documents = { ...s.documents };
    delete documents[kind];
    await ctx.repo.stores.put({ ...s, documents });
    await audit(ctx, 'local.documento.quitar', 'store', s.id, `${DOC_LABEL[kind]} de ${s.name}: archivo quitado`);
  });
}

/** La foto o el PDF de un documento (lo ve quien puede ver el local). */
export async function getStoreDocument(ctx: Ctx, storeId: string, kind: StoreDocumentKind): Promise<Photo | undefined> {
  const s = await loadStoreForActor(ctx, storeId);
  const id = s.documents?.[kind];
  return id ? ctx.repo.photos.get(id) : undefined;
}

// ---------- Avisos de vencimiento ----------

export interface DocAlert extends DocWarning {
  storeId: string;
  storeName: string;
  sellerId: string;
}

const WATCHED: Store['status'][] = ['activo', 'firmado', 'pausado'];

/** Permisos y certificados por vencer o vencidos en los locales que el actor ve (sin los «falta»). */
export async function documentAlerts(ctx: Ctx): Promise<DocAlert[]> {
  const stores = await scopedStores(ctx);
  const now = ctx.now();
  const out: DocAlert[] = [];
  for (const s of stores) {
    if (!WATCHED.includes(s.status)) continue;
    for (const w of storeDocWarnings(s, now, { requiresPermit: ctx.config.requiresTobaccoPermit })) {
      if (w.state === 'falta') continue;
      out.push({ ...w, storeId: s.id, storeName: s.name, sellerId: s.sellerId });
    }
  }
  return out.sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
}

/**
 * Crea los avisos «documento por vencer» que falten (a administración y al vendedor del local).
 * No repite: un aviso por documento, local y fecha de vencimiento. Solo administración.
 */
export async function syncDocumentAlerts(ctx: Ctx): Promise<number> {
  if (ctx.actor.role !== 'admin' || ctx.actor.readOnly) return 0;
  guard(ctx, 'store.list');
  const alerts = await documentAlerts(ctx);
  if (alerts.length === 0) return 0;
  const [existing, admins] = await Promise.all([ctx.repo.notifications.all(), ctx.repo.users.where('role', 'admin')]);
  const seen = new Set(existing.filter((n) => n.kind === 'documento_por_vencer').map((n) => `${n.userId}|${n.title}|${n.body}`));
  const at = nowIso(ctx);
  const items: AppNotification[] = [];
  for (const a of alerts) {
    const { title, body } = docAlertNotice(a, a.storeName, fmtDate);
    for (const userId of new Set([...admins.filter((u) => u.active).map((u) => u.id), a.sellerId])) {
      const key = `${userId}|${title}|${body}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ id: ctx.newId('ntf'), userId, kind: 'documento_por_vencer', title, body, link: `/${ctx.line}/locales/${a.storeId}`, at, read: false });
    }
  }
  if (items.length === 0) return 0;
  await mutate(ctx, async () => {
    await ctx.repo.notifications.bulkPut(items);
  });
  return items.length;
}

// ---------- Reporte para la contadora ----------

export interface AccountantReport {
  from: IsoDate;
  to: IsoDate;
  companyName: string;
  rows: AccountantRow[];
  totals: AccountantTotals;
  /** Hay un % de impuesto configurado (si no, la app no calcula impuestos). */
  taxPercent: number;
}

/** Ventas por local entre dos fechas (Miami, inclusive): consignación y en firme por separado. */
export async function accountantReport(ctx: Ctx, range: { from: IsoDate; to: IsoDate }): Promise<AccountantReport> {
  guard(ctx, 'fiscal.report');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to)) throw new ValidationError('Elige las fechas del periodo.');
  if (range.from > range.to) throw new ValidationError('La fecha «desde» va antes que «hasta».');
  const [stores, reports, invoices, idx, settings] = await Promise.all([
    ctx.repo.stores.all(),
    ctx.repo.salesReports.all(),
    ctx.repo.invoices.all(),
    loadMarketIndex(ctx),
    ctx.repo.settings.get('settings'),
  ]);
  const storesById = new Map(stores.map((s) => [s.id, s]));
  const { rows, totals } = buildAccountantRows({
    from: range.from,
    to: range.to,
    stores,
    marketOf: (id) => {
      const s = storesById.get(id);
      return s ? marketName(idx.markets, idx.storeMarket(s)) : '';
    },
    reports,
    invoices,
    defaultIssuer: ctx.config.requiresTobaccoPermit ? DEFAULT_PERMIT_ISSUER : '',
  });
  return { from: range.from, to: range.to, companyName: settings?.companyName ?? ctx.config.companyName, rows, totals, taxPercent: settings?.salesTaxPercent ?? 0 };
}
