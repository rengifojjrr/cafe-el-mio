// Firma de demostración para la semilla: un trazo tipo «firma» generado a partir del nombre.
// Es un SVG (no hace falta canvas), claramente de ejemplo.
export function demoSignature(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };
  const letters = name.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ ]/g, '').slice(0, 14);
  let x = 12;
  const y = 46;
  let d = `M${x} ${y}`;
  for (const ch of letters) {
    if (ch === ' ') {
      x += 10;
      d += ` M${x} ${y}`;
      continue;
    }
    const up = 14 + rand() * 22;
    const w = 9 + rand() * 9;
    d += ` C${(x + w * 0.2).toFixed(1)} ${(y - up).toFixed(1)}, ${(x + w * 0.9).toFixed(1)} ${(y - up * 0.7).toFixed(1)}, ${(x + w * 0.6).toFixed(1)} ${(y + 4 - rand() * 6).toFixed(1)}`;
    d += ` S${(x + w * 1.1).toFixed(1)} ${(y + 6).toFixed(1)}, ${(x + w * 1.3).toFixed(1)} ${(y - 2).toFixed(1)}`;
    x += w * 1.15;
  }
  d += ` M${Math.max(20, x * 0.15).toFixed(1)} ${y + 10} Q${(x * 0.6).toFixed(1)} ${y + 16}, ${(x + 10).toFixed(1)} ${y + 6}`;
  const width = Math.ceil(x + 24);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} 72' width='${width}' height='72'><path d='${d}' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
