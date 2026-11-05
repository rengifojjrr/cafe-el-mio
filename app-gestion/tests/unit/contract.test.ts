// Contrato: las variables se resuelven todas, cada línea tiene sus cláusulas y el texto
// conserva el aviso de plantilla de ejemplo y el consentimiento a firmar electrónicamente.
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_DISCLAIMER,
  CONTRACT_VARIABLES,
  annexText,
  parseContract,
  renderTemplate,
  templateVariables,
} from '../../src/domain/contract';
import { CAFE_CONTRACT, TABACO_CONTRACT } from '../../src/lines/contract-templates';

const PERMIT = 'TP-DEMO-99999';

function allVars(withPermit: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(CONTRACT_VARIABLES)) out[k] = `«${k}»`;
  out['anexo.productos'] = annexText(
    [{ productId: 'p1', name: 'Biscayne Robusto', sku: 'TB-BIS-ROB50', priceToStore: 5.5, suggestedRetail: 9.5, storeEarning: 4 }],
    'tabaco',
  );
  out['permiso.numero'] = PERMIT;
  out['permiso.vence'] = '1 jun 2027';
  if (!withPermit) {
    delete out['permiso.numero'];
    delete out['permiso.vence'];
  }
  return out;
}

describe('renderTemplate', () => {
  it('reemplaza cada variable, con o sin espacios', () => {
    const r = renderTemplate('Hola {{ a }} y {{b.c}}. {{a}} otra vez.', { a: 'x', 'b.c': 'y' });
    expect(r.text).toBe('Hola x y y. x otra vez.');
    expect(r.missing).toEqual([]);
  });
  it('marca lo que falta y lo informa una sola vez', () => {
    const r = renderTemplate('{{a}} {{z}} {{z}} {{vacio}}', { a: 'x', vacio: '' });
    expect(r.text).toBe('x [falta: z] [falta: z] [falta: vacio]');
    expect(r.missing.sort()).toEqual(['vacio', 'z']);
  });
  it('templateVariables lista las variables sin repetir', () => {
    expect(templateVariables('{{a}} {{ b }} {{a}}').sort()).toEqual(['a', 'b']);
  });
});

describe('plantillas de cada línea', () => {
  it('solo usan variables conocidas', () => {
    for (const t of [TABACO_CONTRACT, CAFE_CONTRACT]) {
      for (const v of templateVariables(t)) expect(Object.keys(CONTRACT_VARIABLES)).toContain(v);
    }
  });

  it('tabaco: se resuelve completo y lleva permiso, 21+, propiedad y firma electrónica', () => {
    const { text, missing } = renderTemplate(TABACO_CONTRACT, allVars(true));
    expect(missing).toEqual([]);
    expect(text).not.toContain('{{');
    expect(text).not.toContain('[falta:');
    expect(text).toContain(CONTRACT_DISCLAIMER);
    expect(text).toMatch(/Plantilla de ejemplo: la revisa un abogado/);
    expect(text).toMatch(/la mercancía es de la empresa hasta que se vende/i);
    expect(text).toMatch(/sigue siendo propiedad de la Empresa hasta que el Local lo vende/);
    expect(text).toMatch(/firmar este contrato electrónicamente/);
    expect(text).toMatch(/21 años/);
    expect(text).toContain(PERMIT);
    expect(text).toMatch(/DBPR/);
    expect(text).toMatch(/Biscayne Robusto/);
  });

  it('café: se resuelve sin datos de permiso de tabaco y no habla de 21+', () => {
    const { text, missing } = renderTemplate(CAFE_CONTRACT, allVars(false));
    expect(missing).toEqual([]);
    expect(text).not.toContain('{{');
    expect(text).toContain(CONTRACT_DISCLAIMER);
    expect(text).toMatch(/la mercancía es de la empresa hasta que se vende/i);
    expect(text).toMatch(/firmar este contrato electrónicamente/);
    expect(text).not.toMatch(/21 años/);
    expect(text).not.toContain(PERMIT);
    expect(text).toMatch(/consumir antes de/);
  });

  it('tabaco sin permiso no se puede resolver', () => {
    const { missing } = renderTemplate(TABACO_CONTRACT, allVars(false));
    expect(missing.sort()).toEqual(['permiso.numero', 'permiso.vence']);
  });

  it('las dos traen liquidación, daños y robo, devoluciones, vigencia y terminación', () => {
    for (const t of [TABACO_CONTRACT, CAFE_CONTRACT]) {
      for (const heading of ['## Liquidación y pago', '## Daños, robo y mermas', '## Devoluciones', '## Vigencia y terminación', '## Firma electrónica', '## Anexo A: productos en consignación']) {
        expect(t).toContain(heading);
      }
    }
  });
});

describe('anexo de productos', () => {
  it('sin productos, lo dice', () => {
    expect(annexText([], 'tabaco')).toMatch(/Sin productos/);
  });
  it('una viñeta por producto con precio al local, PVP y ganancia', () => {
    const text = annexText(
      [
        { productId: 'a', name: 'Colombia', sku: 'CF-COL', priceToStore: 12.5, suggestedRetail: 18.99, storeEarning: 6.49 },
        { productId: 'b', name: 'Matcha', sku: 'CF-MAT', priceToStore: 14.5, suggestedRetail: 21.99, storeEarning: 7.49 },
      ],
      'unidad',
    );
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- Colombia \(CF-COL\)/);
    expect(lines[0]).toContain('$12.50');
    expect(lines[0]).toContain('$18.99');
    expect(lines[0]).toContain('$6.49');
  });
});

describe('parseContract', () => {
  it('convierte el texto en título, aviso, secciones, párrafos y viñetas', () => {
    const { text } = renderTemplate(TABACO_CONTRACT, allVars(true));
    const blocks = parseContract(text);
    expect(blocks[0]).toEqual({ kind: 'title', text: 'Contrato de consignación de productos de tabaco' });
    expect(blocks.some((b) => b.kind === 'note' && b.text.includes('abogado'))).toBe(true);
    const headings = blocks.filter((b) => b.kind === 'heading').map((b) => b.text);
    expect(headings).toContain('Partes');
    expect(headings).toContain('Anexo A: productos en consignación');
    expect(blocks.some((b) => b.kind === 'bullet' && b.text.startsWith('Biscayne Robusto'))).toBe(true);
    expect(blocks.some((b) => b.kind === 'paragraph')).toBe(true);
  });
  it('junta las líneas de un mismo párrafo', () => {
    expect(parseContract('uno\ndos\n\ntres')).toEqual([
      { kind: 'paragraph', text: 'uno dos' },
      { kind: 'paragraph', text: 'tres' },
    ]);
  });
});
