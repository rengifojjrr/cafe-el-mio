// Fechas y horas en español: el punto se le quita al mes, nunca a «a. m.» ni a «p. m.».
import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateTime, fmtTime } from '../../src/lib/time';

describe('fechas y horas', () => {
  it('la tarde lleva «p. m.» con sus dos puntos; la mañana, «a. m.»', () => {
    expect(fmtDateTime('2026-11-12T17:09:48.611Z')).toMatch(/^12 nov 2026, 12:09 p\.\s?m\.$/);
    expect(fmtDateTime('2026-11-12T13:05:00.000Z')).toMatch(/^12 nov 2026, 8:05 a\.\s?m\.$/);
    expect(fmtTime('2026-11-12T17:09:48.611Z')).toMatch(/^12:09 p\.\s?m\.$/);
  });
  it('el mes va sin punto', () => {
    expect(fmtDate('2026-11-12')).toBe('12 nov 2026');
    expect(fmtDateTime('2026-09-03T20:00:00.000Z')).toMatch(/^3 sept? 2026, 4:00 p\.\s?m\.$/);
  });
});
