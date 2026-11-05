// Copia las letras, el logo y las fotos de producto de la web de marca (../assets)
// a public/marca/, que está en .gitignore. Corre antes de `dev` y de `build`.
// Solo lee de la web de marca; nunca escribe en ella.
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const origen = join(raiz, '..', 'assets');
const destino = join(raiz, 'public', 'marca');

const copias = [
  ['fonts/figtree.woff2', 'fonts/figtree.woff2'],
  ['img/marca/logo-el-mio.png', 'logo-el-mio.png'],
];

async function existe(ruta) {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

if (!(await existe(origen))) {
  console.error(`No encuentro la carpeta de la marca en ${origen}.`);
  process.exit(1);
}

await rm(destino, { recursive: true, force: true });
await mkdir(join(destino, 'fonts'), { recursive: true });
await mkdir(join(destino, 'productos'), { recursive: true });

for (const [de, a] of copias) {
  await cp(join(origen, de), join(destino, a));
}

const fotos = (await readdir(join(origen, 'img', 'productos'))).filter((f) => f.endsWith('.webp'));
for (const foto of fotos) {
  await cp(join(origen, 'img', 'productos', foto), join(destino, 'productos', foto));
}

console.log(`Marca copiada: ${copias.length} archivos y ${fotos.length} fotos de producto en public/marca/.`);
