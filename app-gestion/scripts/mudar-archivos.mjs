// Mudanza del programa de Tabaco a su propio proyecto: copia las fotos y los PDF del depósito
// `tabaco-archivos` del proyecto viejo al nuevo (ver docs/MUDANZA.md, paso 4).
//
// Se corre una vez, desde una terminal, con las llaves secretas de los dos proyectos en variables de
// entorno (NUNCA en un archivo del repositorio):
//
//   VIEJO_URL=https://<viejo>.supabase.co VIEJO_LLAVE=<llave secreta del viejo> \
//   NUEVO_URL=https://<nuevo>.supabase.co NUEVO_LLAVE=<llave secreta del nuevo> \
//   node scripts/mudar-archivos.mjs
//
// Se puede correr más de una vez: lo que ya está en el nuevo se reemplaza por lo mismo.
const BUCKET = 'tabaco-archivos';
const { VIEJO_URL, VIEJO_LLAVE, NUEVO_URL, NUEVO_LLAVE } = process.env;

if (!VIEJO_URL || !VIEJO_LLAVE || !NUEVO_URL || !NUEVO_LLAVE) {
  console.error('Faltan VIEJO_URL, VIEJO_LLAVE, NUEVO_URL o NUEVO_LLAVE (ver docs/MUDANZA.md).');
  process.exit(1);
}
if (VIEJO_URL === NUEVO_URL) {
  console.error('El proyecto viejo y el nuevo son el mismo.');
  process.exit(1);
}

/** Las llaves secretas nuevas (sb_secret_…) van solo en `apikey`; las viejas (JWT), también como token. */
function cabeceras(llave, extra = {}) {
  return { apikey: llave, ...(llave.startsWith('eyJ') ? { Authorization: `Bearer ${llave}` } : {}), ...extra };
}

const ruta = (r) => r.split('/').map(encodeURIComponent).join('/');

async function listar(url, llave, prefijo) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: cabeceras(llave, { 'content-type': 'application/json' }),
      body: JSON.stringify({ prefix: prefijo, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`No se pudo listar ${prefijo || '(raíz)'}: ${res.status} ${await res.text()}`);
    const items = await res.json();
    for (const it of items) {
      const completo = prefijo ? `${prefijo}/${it.name}` : it.name;
      // Una carpeta no tiene id: se recorre.
      if (it.id === null) out.push(...(await listar(url, llave, completo)));
      else out.push({ ruta: completo, tipo: it.metadata?.mimetype ?? 'application/octet-stream' });
    }
    if (items.length < 1000) return out;
  }
}

async function copiar({ ruta: r, tipo }) {
  const baja = await fetch(`${VIEJO_URL}/storage/v1/object/${BUCKET}/${ruta(r)}`, { headers: cabeceras(VIEJO_LLAVE) });
  if (!baja.ok) throw new Error(`No se pudo bajar ${r}: ${baja.status}`);
  const cuerpo = await baja.arrayBuffer();
  const sube = await fetch(`${NUEVO_URL}/storage/v1/object/${BUCKET}/${ruta(r)}`, {
    method: 'POST',
    headers: cabeceras(NUEVO_LLAVE, { 'content-type': tipo, 'x-upsert': 'true' }),
    body: cuerpo,
  });
  if (!sube.ok) throw new Error(`No se pudo subir ${r}: ${sube.status} ${await sube.text()}`);
  return cuerpo.byteLength;
}

const archivos = await listar(VIEJO_URL, VIEJO_LLAVE, '');
console.log(`En el proyecto viejo hay ${archivos.length} archivos en ${BUCKET}.`);
let bytes = 0;
let hechos = 0;
const fallas = [];
// De a 4 a la vez.
let i = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (i < archivos.length) {
      const a = archivos[i++];
      try {
        bytes += await copiar(a);
        hechos += 1;
        if (hechos % 25 === 0) console.log(`  ${hechos} de ${archivos.length}…`);
      } catch (e) {
        fallas.push(`${a.ruta}: ${e.message}`);
      }
    }
  }),
);
const enNuevo = await listar(NUEVO_URL, NUEVO_LLAVE, '');
console.log(`Copiados: ${hechos} (${(bytes / 1024 / 1024).toFixed(1)} MB). En el nuevo ahora hay ${enNuevo.length}.`);
if (fallas.length) {
  console.error(`Fallaron ${fallas.length}:\n${fallas.join('\n')}`);
  process.exit(1);
}
