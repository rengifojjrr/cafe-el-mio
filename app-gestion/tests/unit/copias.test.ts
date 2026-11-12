// La copia automática del servidor: al día si la última es de hace menos de 36 horas.
import { describe, expect, it } from 'vitest';
import { copiaAlDia, HORAS_SIN_COPIA } from '../../src/servidor/copias';

const NOW = new Date('2026-11-12T18:00:00Z');
const hace = (horas: number) => new Date(NOW.getTime() - horas * 3_600_000).toISOString();
const copia = (horas: number | null) => ({ ultima: horas === null ? null : { hecha_en: hace(horas), motivo: 'diaria', registros: 356 }, guardadas: 1, desde: null });

describe('copia automática del servidor', () => {
  it('al día con una copia de anoche', () => {
    expect(copiaAlDia(copia(10), NOW)).toBe(true);
    expect(copiaAlDia(copia(HORAS_SIN_COPIA - 0.1), NOW)).toBe(true);
  });
  it('atrasada si pasó un día y medio, o si no hay ninguna', () => {
    expect(copiaAlDia(copia(HORAS_SIN_COPIA), NOW)).toBe(false);
    expect(copiaAlDia(copia(72), NOW)).toBe(false);
    expect(copiaAlDia(copia(null), NOW)).toBe(false);
  });
});
