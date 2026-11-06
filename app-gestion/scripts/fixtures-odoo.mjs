// Genera los archivos de prueba de la importación de productos, con datos INVENTADOS que siguen
// el formato de la exportación de Odoo (Inventario → Productos → Exportar):
// - tests/fixtures/odoo-variantes.xlsx: la exportación corta (4 columnas, como la de la empresa).
// - tests/fixtures/odoo-variantes-completo.csv: «Variante de producto (product.product)» completa, en inglés.
// Uso: node scripts/fixtures-odoo.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import writeXlsxFile from 'write-excel-file/node';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tests', 'fixtures');
mkdirSync(out, { recursive: true });

// Exportación corta: nombre para mostrar, cantidades y categoría. Sin precios ni costos.
const corta = [
  ['Nombre para mostrar', 'Cantidad real', 'Cantidad disponible', 'Categoría de producto/Nombre completo'],
  ['[ABC-101] 6x52 Toro', 120, 120, 'All / Tabaco / Habano'],
  ['[ABC-102] 6X52 Toro Maduro', 80, 80, 'All / Tabaco / Maduro'],
  ['[ABC-107] 6x52 Toro Conneticut', 40, 40, 'All / Tabaco / Conneticut'],
  ['[ABC-103] 6⅛x52 Torpedo Box Press Connecticut', 35, 35, 'All / Tabaco / Habano'],
  ['[ABC-104] 4½x60', 60, 60, 'All / Tabaco / Habano'],
  ['[ABC-105] 7¼x58 Salomón', 12, 12, 'All / Tabaco / Maduro'],
  ['[ABC-106] 6½X54 Aleta Conneticut', 18, 18, ''],
  ['6x64 Box Press', 25, 25, 'All / Tabaco / Habano'],
  ['7x70 Big Cigars Maduro', 10, 10, ''],
  ['[ABC-108] 5x50 Robusto', 90, 90, 'All / Tabaco / Habano'],
  ['[ABC-109] 6x60 Gordo Maduro', 45, 45, 'All / Tabaco / Maduro'],
  ['[ABC-110] 7x48 Churchill', 0, 0, 'All / Tabaco / Habano'],
  ['[ABC-201] Brisa Azul Box Hab', 6, 6, 'All / Tabaco / Premium'],
  ['[ABC-202] Brisa Azul Box Mad', 4, 4, 'All / Tabaco / Premium'],
  ['[ABC-203] Brisa Azul 5 Pack', 20, 20, 'All / Tabaco / Premium'],
  ['[ABC-204] Brisa Azul 10 Pack', 12, 12, 'All / Tabaco / Premium'],
  ['[ABC-205] Brisa Azul mazos 25', 8, 8, 'All / Tabaco / Premium'],
  ['Mazos Premium', 15, 15, ''],
];
await writeXlsxFile(corta, { sheet: 'Variante de producto' }).toFile(join(out, 'odoo-variantes.xlsx'));

// Códigos internos de ejemplo: prefijo 200 de GS1 (uso interno), con su dígito de control.
function ean13(seq) {
  const d = `200${String(seq).padStart(9, '0')}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  return `${d}${(10 - (sum % 10)) % 10}`;
}

// Exportación completa (product.product) en inglés: con referencia, código, precios y costos.
const header = ['Name', 'Display Name', 'Internal Reference', 'Barcode', 'Sales Price', 'Cost', 'Quantity On Hand', 'Free To Use Quantity', 'Product Category', 'Variant Values', 'Country of Origin'];
const completa = [
  ['6x52 Toro', '[GM-301] 6x52 Toro (Maduro)', 'GM-301', ean13(30001), '27.50', '11.20', '40', '38', 'All / Tabaco / Maduro', 'Capa: Maduro', 'Nicaragua'],
  ['6x52 Toro', '[GM-302] 6x52 Toro (Habano)', 'GM-302', ean13(30002), '26.00', '10.80', '55', '55', 'All / Tabaco / Habano', 'Capa: Habano', 'Nicaragua'],
  ['5x50 Robusto', '[GM-303] 5x50 Robusto (Connecticut)', 'GM-303', ean13(30003), '24.00', '9.90', '30', '30', 'All / Tabaco / Conneticut', 'Capa: Connecticut', 'Honduras'],
  ['6⅛x52 Torpedo', '[GM-304] 6⅛x52 Torpedo (Maduro)', 'GM-304', ean13(30004), '28.00', '11.50', '0', '0', 'All / Tabaco / Maduro', 'Capa: Maduro', 'República Dominicana'],
  ['Brisa Azul Box', '[GM-401] Brisa Azul Box (Hab)', 'GM-401', ean13(40001), '95.00', '52.00', '6', '6', 'All / Tabaco / Premium', 'Capa: Habano', 'Nicaragua'],
  ['Brisa Azul Box', '[GM-402] Brisa Azul Box (Mad)', 'GM-402', ean13(40002), '95.00', '52.00', '3', '3', 'All / Tabaco / Premium', 'Capa: Maduro', 'Nicaragua'],
  ['7x50 Churchill', '[GM-305] 7x50 Churchill (Habano)', 'GM-305', ean13(30005), '26.50', '0.00', '12', '12', 'All / Tabaco / Habano', 'Capa: Habano', 'Cuba'],
  ['6x60 Gordo', '[GM-306] 6x60 Gordo', 'GM-306', ean13(30006), '', '10.40', '22', '22', 'All / Tabaco / Habano', '', 'Nicaragua'],
];
const csv = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
writeFileSync(join(out, 'odoo-variantes-completo.csv'), `${[header, ...completa].map((r) => r.map(csv).join(',')).join('\n')}\n`, 'utf8');

console.log(`Listo: ${out}/odoo-variantes.xlsx y odoo-variantes-completo.csv`);
