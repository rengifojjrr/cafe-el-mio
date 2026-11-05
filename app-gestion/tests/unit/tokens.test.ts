// Ningún color escrito a mano fuera de src/styles/tokens.css.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..', 'src');
const TOKENS = join(SRC, 'styles', 'tokens.css');
const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\boklab\(|\b(?:bg|text|border|from|to|via|fill|stroke|ring|outline|shadow)-(?:red|blue|green|yellow|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)(?:-\d{2,3})?\b/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
  });
}

describe('tokens de color', () => {
  it('solo src/styles/tokens.css tiene colores literales', () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      if (file === TOKENS) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // Los ids de elementos SVG (url(#id)) y las entidades HTML no son colores.
          const clean = line.replace(/url\(#[^)]*\)/g, '').replace(/&#\d+;/g, '');
          if (COLOR.test(clean)) offenders.push(`${relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('tokens.css define los colores de las dos líneas', () => {
    const css = readFileSync(TOKENS, 'utf8');
    for (const c of ['#0e1013', '#171a1f', '#7b4b2a', '#d9a441', '#1f4d3a', '#5eead4', '#1f130c', '#2a1a11', '#3a2619', '#f7b11b', '#ffc94d', '#da9208', '#e8cfa4', '#fff8ec']) {
      expect(css.toLowerCase()).toContain(c);
    }
  });
});
