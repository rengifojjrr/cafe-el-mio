// Datos fiscales de los locales (Tax ID, certificado de reventa, permiso de tabaco), avisos de
// vencimiento y las filas del «Reporte para la contadora». Funciones puras.
//
// La app no calcula impuestos (salvo que Ajustes tenga un %): este reporte solo junta lo vendido por
// local, con sus números fiscales, para que la contadora prepare las declaraciones.
import type { IsoDate, IsoDateTime, Store, StoreDocumentKind } from '../data/types';
import { round2 } from '../lib/money';
import { daysBetween, toIsoDate } from '../lib/time';

export const DOC_WARN_DAYS = 30;

export const DOC_LABEL: Record<StoreDocumentKind, string> = {
  permiso: 'Permiso de venta de tabaco',
  taxId: 'Tax ID (EIN)',
  reventa: 'Certificado de reventa',
};

/** Quién emite el permiso de tabaco: Florida (DBPR) o Texas (Comptroller). */
export const PERMIT_ISSUERS = ['Florida DBPR', 'Texas Comptroller'] as const;
export const DEFAULT_PERMIT_ISSUER = PERMIT_ISSUERS[0];

/** «123456789» o «12-3456789» → «12-3456789»; cualquier otra cosa → null. */
export function normalizeEin(raw: string): string | null {
  const t = raw.trim();
  const m = /^(\d{2})-?(\d{7})$/.exec(t);
  return m ? `${m[1]}-${m[2]}` : null;
}

export function isValidEin(raw: string): boolean {
  return normalizeEin(raw) !== null;
}

export type ExpiryState = 'vigente' | 'vence_pronto' | 'vencido' | 'falta';

/** Estado de un documento con vencimiento, hoy. */
export function expiryState(expiresOn: IsoDate | undefined | null, now: Date, warnDays = DOC_WARN_DAYS): ExpiryState {
  if (!expiresOn) return 'falta';
  const days = daysBetween(now, expiresOn);
  if (days < 0) return 'vencido';
  if (days <= warnDays) return 'vence_pronto';
  return 'vigente';
}

/** ¿El certificado de reventa estaba vigente en ese momento (o fecha)? */
export function resaleCertValidAt(store: Pick<Store, 'resaleCert'>, at: IsoDateTime | IsoDate | Date): boolean {
  const c = store.resaleCert;
  if (!c?.number?.trim() || !c.expiresOn) return false;
  const day = at instanceof Date ? toIsoDate(at) : at.length === 10 ? at : toIsoDate(at);
  return c.expiresOn >= day;
}

export interface DocWarning {
  kind: Extract<StoreDocumentKind, 'permiso' | 'reventa'>;
  state: Exclude<ExpiryState, 'vigente'>;
  expiresOn?: IsoDate;
  /** Días que faltan (negativo: hace cuántos venció). */
  days?: number;
  text: string;
}

/**
 * Lo que hay que atender de los documentos de un local: permiso de tabaco (si la línea lo pide) y
 * certificado de reventa. «falta» solo se informa para el certificado (el permiso que falta ya lo
 * avisa la consignación).
 */
export function storeDocWarnings(store: Pick<Store, 'tobaccoPermit' | 'resaleCert'>, now: Date, opts: { requiresPermit: boolean; warnDays?: number }): DocWarning[] {
  const out: DocWarning[] = [];
  const warn = opts.warnDays ?? DOC_WARN_DAYS;
  if (opts.requiresPermit && store.tobaccoPermit?.number?.trim()) {
    const st = expiryState(store.tobaccoPermit.expiresOn, now, warn);
    if (st === 'vence_pronto' || st === 'vencido') {
      const days = daysBetween(now, store.tobaccoPermit.expiresOn);
      out.push({ kind: 'permiso', state: st, expiresOn: store.tobaccoPermit.expiresOn, days, text: st === 'vencido' ? 'Permiso de tabaco vencido' : `Permiso de tabaco vence en ${days === 0 ? 'hoy' : days === 1 ? '1 día' : `${days} días`}` });
    }
  }
  const cert = store.resaleCert;
  if (!cert?.number?.trim()) {
    out.push({ kind: 'reventa', state: 'falta', text: 'Sin certificado de reventa' });
  } else {
    const st = expiryState(cert.expiresOn, now, warn);
    if (st === 'vence_pronto' || st === 'vencido') {
      const days = daysBetween(now, cert.expiresOn);
      out.push({ kind: 'reventa', state: st, expiresOn: cert.expiresOn, days, text: st === 'vencido' ? 'Certificado de reventa vencido' : `Certificado de reventa vence en ${days === 0 ? 'hoy' : days === 1 ? '1 día' : `${days} días`}` });
    }
  }
  return out;
}

/** Título y texto del aviso «documento por vencer» (los mismos en la semilla y en el servicio, para no repetirlo). */
export function docAlertNotice(w: Pick<DocWarning, 'kind' | 'state' | 'expiresOn'>, storeName: string, fmt: (d: IsoDate) => string): { title: string; body: string } {
  const what = w.kind === 'permiso' ? 'Permiso de tabaco' : 'Certificado de reventa';
  const when = w.expiresOn ? fmt(w.expiresOn) : '';
  return w.state === 'vencido'
    ? { title: `${what} vencido: ${storeName}`, body: `Venció el ${when}. Pide el documento nuevo.` }
    : { title: `${what} por vencer: ${storeName}`, body: `Vence el ${when}. Pide la renovación a tiempo.` };
}

// ---------- Reporte para la contadora ----------

export interface AccountantRow {
  storeId: string;
  storeName: string;
  marketName: string;
  taxId: string;
  permitNumber: string;
  permitIssuer: string;
  resaleCertNumber: string;
  resaleCertExpiresOn: string;
  /** «Sí», «Hasta el …» (venció en el periodo), «Vencido» o «No tiene». */
  resaleCertStatus: 'si' | 'parcial' | 'vencido' | 'no_tiene';
  /** Consignación: vendido (reportado) en el periodo, a precio al local. */
  consignmentSold: number;
  /** De eso, lo que ya entró en una liquidación. */
  consignmentSettled: number;
  /** Venta en firme (facturas del periodo): sin impuesto, impuesto y total. */
  firmSubtotal: number;
  firmTax: number;
  firmTotal: number;
  invoices: number;
  /** Lo vendido sin certificado de reventa vigente (consignación al momento de la venta + facturas marcadas). */
  withoutCert: number;
  /** Ventas del periodo sin impuesto: consignación + firme. */
  total: number;
}

export interface AccountantTotals {
  consignmentSold: number;
  consignmentSettled: number;
  firmSubtotal: number;
  firmTax: number;
  firmTotal: number;
  invoices: number;
  withoutCert: number;
  total: number;
}

export const RESALE_STATUS_TEXT: Record<AccountantRow['resaleCertStatus'], string> = {
  si: 'Sí',
  parcial: 'Venció en el periodo',
  vencido: 'Vencido',
  no_tiene: 'No tiene',
};

/** Filas del reporte: un local por fila, solo los que vendieron algo entre `from` y `to` (fechas de Miami, inclusive). */
export function buildAccountantRows(input: {
  from: IsoDate;
  to: IsoDate;
  stores: readonly Pick<Store, 'id' | 'name' | 'taxId' | 'tobaccoPermit' | 'resaleCert'>[];
  marketOf: (storeId: string) => string;
  reports: readonly { storeId: string; at: IsoDateTime; total: number; settlementId: string | null }[];
  invoices: readonly { storeId: string; issuedAt: IsoDateTime; subtotal: number; tax: number; total: number; withoutResaleCert: boolean }[];
  defaultIssuer?: string;
}): { rows: AccountantRow[]; totals: AccountantTotals } {
  const inRange = (at: string) => {
    const d = toIsoDate(at);
    return d >= input.from && d <= input.to;
  };
  const rows = new Map<string, AccountantRow>();
  const storesById = new Map(input.stores.map((s) => [s.id, s]));
  const rowFor = (storeId: string): AccountantRow | null => {
    const s = storesById.get(storeId);
    if (!s) return null;
    let r = rows.get(storeId);
    if (!r) {
      const c = s.resaleCert;
      const status: AccountantRow['resaleCertStatus'] = !c?.number?.trim() || !c.expiresOn ? 'no_tiene' : c.expiresOn >= input.to ? 'si' : c.expiresOn >= input.from ? 'parcial' : 'vencido';
      r = {
        storeId,
        storeName: s.name,
        marketName: input.marketOf(storeId),
        taxId: s.taxId ?? '',
        permitNumber: s.tobaccoPermit?.number ?? '',
        permitIssuer: s.tobaccoPermit?.number ? (s.tobaccoPermit.issuer ?? input.defaultIssuer ?? '') : '',
        resaleCertNumber: c?.number ?? '',
        resaleCertExpiresOn: c?.expiresOn ?? '',
        resaleCertStatus: status,
        consignmentSold: 0,
        consignmentSettled: 0,
        firmSubtotal: 0,
        firmTax: 0,
        firmTotal: 0,
        invoices: 0,
        withoutCert: 0,
        total: 0,
      };
      rows.set(storeId, r);
    }
    return r;
  };
  for (const rep of input.reports) {
    if (!inRange(rep.at)) continue;
    const r = rowFor(rep.storeId);
    if (!r) continue;
    r.consignmentSold += rep.total;
    if (rep.settlementId) r.consignmentSettled += rep.total;
    if (!resaleCertValidAt(storesById.get(rep.storeId)!, rep.at)) r.withoutCert += rep.total;
  }
  for (const inv of input.invoices) {
    if (!inRange(inv.issuedAt)) continue;
    const r = rowFor(inv.storeId);
    if (!r) continue;
    r.firmSubtotal += inv.subtotal;
    r.firmTax += inv.tax;
    r.firmTotal += inv.total;
    r.invoices += 1;
    if (inv.withoutResaleCert) r.withoutCert += inv.subtotal;
  }
  const list = [...rows.values()]
    .map((r) => ({
      ...r,
      consignmentSold: round2(r.consignmentSold),
      consignmentSettled: round2(r.consignmentSettled),
      firmSubtotal: round2(r.firmSubtotal),
      firmTax: round2(r.firmTax),
      firmTotal: round2(r.firmTotal),
      withoutCert: round2(r.withoutCert),
      total: round2(r.consignmentSold + r.firmSubtotal),
    }))
    .sort((a, b) => a.marketName.localeCompare(b.marketName, 'es') || a.storeName.localeCompare(b.storeName, 'es'));
  const totals: AccountantTotals = { consignmentSold: 0, consignmentSettled: 0, firmSubtotal: 0, firmTax: 0, firmTotal: 0, invoices: 0, withoutCert: 0, total: 0 };
  for (const r of list) {
    totals.consignmentSold = round2(totals.consignmentSold + r.consignmentSold);
    totals.consignmentSettled = round2(totals.consignmentSettled + r.consignmentSettled);
    totals.firmSubtotal = round2(totals.firmSubtotal + r.firmSubtotal);
    totals.firmTax = round2(totals.firmTax + r.firmTax);
    totals.firmTotal = round2(totals.firmTotal + r.firmTotal);
    totals.invoices += r.invoices;
    totals.withoutCert = round2(totals.withoutCert + r.withoutCert);
    totals.total = round2(totals.total + r.total);
  }
  return { rows: list, totals };
}

export type PeriodKind = 'mes' | 'trimestre' | 'anio' | 'rango';

/** Primer y último día (Miami) del mes, trimestre o año que contiene `day`. */
export function periodRange(kind: Exclude<PeriodKind, 'rango'>, day: IsoDate): { from: IsoDate; to: IsoDate } {
  const [y, m] = day.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (kind === 'mes') return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last(y, m))}` };
  if (kind === 'trimestre') {
    const q0 = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: `${y}-${pad(q0)}-01`, to: `${y}-${pad(q0 + 2)}-${pad(last(y, q0 + 2))}` };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}
