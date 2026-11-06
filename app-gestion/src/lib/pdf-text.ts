// Texto para PDF con la letra estándar (WinAnsi): las fracciones que no sabe dibujar pasan a
// «1/8» y lo demás que no entra se quita. Lo usan las etiquetas y el informe de diferencias.
import type { PDFFont } from 'pdf-lib';

const REPLACE: Record<string, string> = { '⅛': ' 1/8', '⅜': ' 3/8', '⅝': ' 5/8', '⅞': ' 7/8', '″': '"', '′': "'", '–': '-', '—': '-', '−': '-' };

export function pdfText(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text.replace(/[⅛⅜⅝⅞″′–—−]/g, (c) => REPLACE[c] ?? '')) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      // No se puede dibujar: se omite.
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Corta el texto con «…» para que entre en el ancho. */
export function fit(font: PDFFont, text: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
