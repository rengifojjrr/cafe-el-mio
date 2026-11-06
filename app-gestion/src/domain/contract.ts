// Plantilla de contrato de consignación con variables {{así}}.
// El texto que se firma queda guardado ya resuelto, con su versión.
import type { ContractAnnexItem } from '../data/types';
import { fmtMoney } from '../lib/money';

const VAR = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export const CONTRACT_DISCLAIMER = 'Plantilla de ejemplo: la revisa un abogado antes de usarla con locales reales.';

/** Variables que entiende la plantilla, con lo que significan (para la pantalla de ajustes). */
export const CONTRACT_VARIABLES: Record<string, string> = {
  'contrato.version': 'Versión del contrato de este local',
  fecha: 'Fecha de emisión',
  'empresa.nombre': 'Empresa de la línea',
  'empresa.representante': 'Vendedor que firma en nombre de la empresa',
  'local.nombre': 'Nombre del local',
  'local.tipo': 'Tipo de local',
  'local.direccion': 'Dirección del local',
  'local.encargado': 'Encargado que firma por el local',
  'local.telefono': 'Teléfono del local',
  'local.correo': 'Correo del local',
  'permiso.numero': 'Número del permiso de venta de tabaco',
  'permiso.vence': 'Vencimiento del permiso',
  'liquidacion.dias': 'Cada cuántos días se liquida',
  'pago.dias': 'Días para pagar cada liquidación',
  'vigencia.meses': 'Meses de vigencia',
  'aviso.dias': 'Días de aviso para terminar',
  'anexo.productos': 'Anexo de productos con precios y ganancia del local',
};

export function templateVariables(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(VAR)) if (m[1]) found.add(m[1]);
  return [...found];
}

/** Pone los valores en la plantilla. Lo que falte queda marcado y se informa en `missing`. */
export function renderTemplate(template: string, vars: Record<string, string>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = template.replace(VAR, (_all, key: string) => {
    const v = vars[key];
    if (v === undefined || v === '') {
      missing.add(key);
      return `[falta: ${key}]`;
    }
    return v;
  });
  return { text, missing: [...missing] };
}

export function annexText(items: readonly ContractAnnexItem[], unitName: string): string {
  if (items.length === 0) return '- (Sin productos todavía: se agregan con la primera entrega.)';
  return items
    .map(
      (i) =>
        `- ${i.name} (${i.sku}): precio al local ${fmtMoney(i.priceToStore)} por ${i.unitName ?? unitName}; PVP sugerido ${fmtMoney(
          i.suggestedRetail,
        )}; el local gana ${fmtMoney(i.storeEarning)} por ${i.unitName ?? unitName} vendido.`,
    )
    .join('\n');
}

export type ContractBlock =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'note'; text: string };

/** Convierte el texto del contrato (títulos «# », secciones «## », viñetas «- ») en bloques. */
export function parseContract(body: string): ContractBlock[] {
  const blocks: ContractBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', text: para.join(' ') });
    para = [];
  };
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('# ')) {
      flush();
      blocks.push({ kind: 'title', text: line.slice(2).trim() });
    } else if (line.startsWith('## ')) {
      flush();
      blocks.push({ kind: 'heading', text: line.slice(3).trim() });
    } else if (line.startsWith('- ')) {
      flush();
      blocks.push({ kind: 'bullet', text: line.slice(2).trim() });
    } else if (line.startsWith('> ')) {
      flush();
      blocks.push({ kind: 'note', text: line.slice(2).trim() });
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}
