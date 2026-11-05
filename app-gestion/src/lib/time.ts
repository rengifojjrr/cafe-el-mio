import { DateTime, Settings } from 'luxon';
import type { IsoDate, IsoDateTime } from '../data/types';

/** Toda fecha se muestra y se agrupa en la hora de Miami. */
export const ZONE = 'America/New_York';
Settings.defaultZone = ZONE;
Settings.defaultLocale = 'es';

export function ny(iso: IsoDateTime | Date): DateTime {
  const dt = typeof iso === 'string' ? DateTime.fromISO(iso, { zone: 'utc' }) : DateTime.fromJSDate(iso);
  return dt.setZone(ZONE).setLocale('es');
}

export function nyDate(isoDate: IsoDate): DateTime {
  return DateTime.fromISO(isoDate, { zone: ZONE }).setLocale('es');
}

/** Fecha (YYYY-MM-DD) de Miami para un instante. */
export function toIsoDate(at: IsoDateTime | Date): IsoDate {
  return ny(at).toISODate() as IsoDate;
}

export function isoNow(now: Date): IsoDateTime {
  return now.toISOString();
}

export function addDays(at: IsoDateTime | Date, days: number): IsoDateTime {
  return ny(at).plus({ days }).toUTC().toISO() as IsoDateTime;
}

export function addDaysToDate(date: IsoDate, days: number): IsoDate {
  return nyDate(date).plus({ days }).toISODate() as IsoDate;
}

/** Días de calendario (en Miami) entre dos instantes o fechas: b − a. */
export function daysBetween(a: IsoDateTime | IsoDate | Date, b: IsoDateTime | IsoDate | Date): number {
  const da = startOfDay(a);
  const db = startOfDay(b);
  return Math.round(db.diff(da, 'days').days);
}

function startOfDay(v: IsoDateTime | IsoDate | Date): DateTime {
  if (v instanceof Date) return ny(v).startOf('day');
  return (v.length === 10 ? nyDate(v) : ny(v)).startOf('day');
}

/** «2026-11» para agrupar por mes. */
export function monthKey(at: IsoDateTime | Date): string {
  return ny(at).toFormat('yyyy-MM');
}

export function fmtMonth(key: string): string {
  const dt = DateTime.fromFormat(key, 'yyyy-MM', { zone: ZONE }).setLocale('es');
  return dt.toFormat('LLL yyyy').replace('.', '');
}

export function fmtDate(v: IsoDateTime | IsoDate | Date): string {
  const dt = v instanceof Date ? ny(v) : v.length === 10 ? nyDate(v) : ny(v);
  return dt.toFormat('d LLL yyyy').replace('.', '');
}

export function fmtShortDate(v: IsoDateTime | IsoDate | Date): string {
  const dt = v instanceof Date ? ny(v) : v.length === 10 ? nyDate(v) : ny(v);
  return dt.toFormat('d LLL').replace('.', '');
}

export function fmtDateTime(v: IsoDateTime | Date): string {
  return ny(v).toFormat("d LLL yyyy, h:mm a").replace('.', '').replace('AM', 'a. m.').replace('PM', 'p. m.');
}

export function fmtTime(v: IsoDateTime | Date): string {
  return ny(v).toFormat('h:mm a').replace('AM', 'a. m.').replace('PM', 'p. m.');
}

/** «hoy», «mañana», «en 8 días», «hace 3 días». */
export function fmtRelativeDays(target: IsoDateTime | IsoDate, now: Date): string {
  const d = daysBetween(now, target);
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  if (d === -1) return 'ayer';
  if (d > 0) return `en ${d} días`;
  return `hace ${-d} días`;
}

/** «hace 5 min», «hace 2 h», «ayer», «3 nov». */
export function fmtAgo(at: IsoDateTime, now: Date): string {
  const mins = Math.round((now.getTime() - new Date(at).getTime()) / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = daysBetween(at, now);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  return fmtShortDate(at);
}
