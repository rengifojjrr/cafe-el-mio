// Plantillas PDF de contrato y de nota de entrega: permisos, versiones, qué plantilla toma cada
// documento, documentos firmados por rol, y el estampado de firmas y textos con pdf-lib.
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream, degrees } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LineId, TemplateField, User } from '../../src/data/types';
import { getLineRepo, setDbPrefix } from '../../src/data';
import type { Actor } from '../../src/domain/permissions';
import { mergePdfs, readPdfInfo, stampPdf, textToPdfWithSlots } from '../../src/lib/pdf';
import { issueContract } from '../../src/services/contracts';
import { prepareDelivery, receiveDelivery, requestDelivery } from '../../src/services/consignment';
import { lineCtx } from '../../src/services/context';
import { listSignedDocuments } from '../../src/services/documents';
import { exportState, importState, resetDemo } from '../../src/services/session';
import { findActive, listTemplates, revertToTextTemplate, saveTemplate } from '../../src/services/templates';

const NOW = new Date('2026-11-05T15:00:00Z');
// PNG de 1×1 (una firma mínima de prueba).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

/** Cuántos textos (operador Tj) dibuja la primera página: uno por línea escrita. */
async function textOps(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  let ops = '';
  for (const s of streams) if (s instanceof PDFRawStream) ops += new TextDecoder('latin1').decode(decodePDFRawStream(s).decode());
  return (ops.match(/\bTj\b/g) ?? []).length;
}

function field(type: TemplateField['type'], y: number): TemplateField {
  return { id: `f-${type}-${y}`, type, page: 0, x: 0.1, y, w: 0.35, h: 0.07 };
}

async function actorFor(line: LineId, role: User['role'], pick?: (u: User) => boolean): Promise<Actor> {
  const users = await getLineRepo(line).users.all();
  const u = users.find((x) => x.role === role && (!pick || pick(x)));
  if (!u) throw new Error(`sin usuario ${role}`);
  return { accountId: `${line}:${u.id}`, userId: u.id, role: u.role, line, storeId: u.storeId, name: u.name, readOnly: false };
}

const ctxOf = (line: LineId, actor: Actor) => lineCtx(line, actor, { now: () => NOW });

let pdf: Uint8Array;

beforeAll(async () => {
  setDbPrefix('pruebas-plantillas-');
  await resetDemo(NOW);
  pdf = await onePagePdf();
});

describe('plantillas PDF: permisos', () => {
  it('vendedor y local no pueden ver ni guardar plantillas', async () => {
    for (const role of ['seller', 'store'] as const) {
      const ctx = ctxOf('tabaco', await actorFor('tabaco', role));
      await expect(listTemplates(ctx)).rejects.toThrow(/permiso/);
      await expect(
        saveTemplate(ctx, { kind: 'consignacion', name: 'Mía', pdf: new Blob([pdf.slice()]), pageSizes: [{ w: 612, h: 792 }], fields: [field('firma_local', 0.7), field('firma_vendedor', 0.8)] }),
      ).rejects.toThrow(/permiso/);
    }
  });

  it('«ver como…» (solo mirar) tampoco puede guardar', async () => {
    const admin = await actorFor('tabaco', 'admin');
    const ctx = ctxOf('tabaco', { ...admin, readOnly: true });
    await expect(
      saveTemplate(ctx, { kind: 'entrega', name: 'Nota', pdf: new Blob([pdf.slice()]), pageSizes: [{ w: 612, h: 792 }], fields: [field('firma_local', 0.7)] }),
    ).rejects.toThrow(/solo se mira/);
  });
});

describe('plantillas PDF: versiones y documentos', () => {
  it('un contrato necesita las dos firmas y los recuadros dentro de la página', async () => {
    const ctx = ctxOf('tabaco', await actorFor('tabaco', 'admin'));
    await expect(
      saveTemplate(ctx, { kind: 'consignacion', name: 'Sin vendedor', pdf: new Blob([pdf.slice()]), pageSizes: [{ w: 612, h: 792 }], fields: [field('firma_local', 0.7)] }),
    ).rejects.toThrow(/Firma del vendedor/);
    await expect(
      saveTemplate(ctx, {
        kind: 'consignacion',
        name: 'Fuera',
        pdf: new Blob([pdf.slice()]),
        pageSizes: [{ w: 612, h: 792 }],
        fields: [field('firma_local', 0.7), { ...field('firma_vendedor', 0.8), x: 0.9 }],
      }),
    ).rejects.toThrow();
    await expect(
      saveTemplate(ctx, { kind: 'entrega', name: 'Con firma de vendedor', pdf: new Blob([pdf.slice()]), pageSizes: [{ w: 612, h: 792 }], fields: [field('firma_local', 0.7), field('firma_vendedor', 0.8)] }),
    ).rejects.toThrow(/no va en una nota de entrega/);
  });

  it('guardar crea una versión nueva activa y desactiva la anterior; el contrato emitido toma la activa', async () => {
    const ctx = ctxOf('tabaco', await actorFor('tabaco', 'admin'));
    const v1 = await saveTemplate(ctx, { kind: 'consignacion', name: 'Contrato A', pdf: new Blob([pdf.slice()]), pageSizes: [{ w: 612, h: 792 }], fields: [field('firma_local', 0.7), field('firma_vendedor', 0.8)] });
    const v2 = await saveTemplate(ctx, { kind: 'consignacion', name: 'Contrato B', pdf: new Blob([pdf.slice()]), pageSizes: [{ w: 612, h: 792 }], fields: [field('firma_local', 0.6), field('firma_vendedor', 0.8)] });
    expect(v2.version).toBe(v1.version + 1);
    const all = await listTemplates(ctx, 'consignacion');
    expect(all.filter((t) => t.active).map((t) => t.id)).toEqual([v2.id]);
    expect(all.find((t) => t.id === v1.id)?.active).toBe(false);

    const stores = await getLineRepo('tabaco').stores.all();
    const esquina = stores.find((s) => s.status === 'contrato_enviado')!;
    const seller = ctxOf('tabaco', await actorFor('tabaco', 'seller', (u) => u.id === esquina.sellerId));
    const c = await issueContract(seller, esquina.id);
    expect(c.templateId).toBe(v2.id);
    expect(c.status).toBe('enviado');

    await revertToTextTemplate(ctx, 'consignacion');
    expect(await findActive(ctx, 'consignacion')).toBeNull();
    const c2 = await issueContract(seller, esquina.id);
    expect(c2.templateId).toBeUndefined();
    // El anterior sigue apuntando a su versión aunque ya no esté activa.
    expect((await getLineRepo('tabaco').contracts.get(c.id))?.templateId).toBe(v2.id);
  });

  it('la nota de entrega toma la plantilla de entrega activa al recibir', async () => {
    const admin = ctxOf('tabaco', await actorFor('tabaco', 'admin'));
    const nota = await saveTemplate(admin, { kind: 'entrega', name: 'Nota', pdf: new Blob([pdf.slice()]), pageSizes: [{ w: 612, h: 792 }], fields: [field('firma_local', 0.7), { ...field('detalle_entrega', 0.2), h: 0.3 }] });
    const stores = await getLineRepo('tabaco').stores.all();
    const users = await getLineRepo('tabaco').users.all();
    const products = await getLineRepo('tabaco').products.all();
    // Un local activo, con permiso vigente y con cuenta propia.
    const store = stores.find((s) => s.status === 'activo' && s.tobaccoPermit && s.tobaccoPermit.expiresOn > '2027-01-01' && users.some((u) => u.storeId === s.id))!;
    const seller = ctxOf('tabaco', await actorFor('tabaco', 'seller', (u) => u.id === store.sellerId));
    const product = products.find((p) => p.sku === 'TB-BIS-ROB50')!;
    const d = await requestDelivery(seller, { storeId: store.id, items: [{ productId: product.id, qty: 20 }] });
    await prepareDelivery(admin, d.id);
    const storeActor = ctxOf('tabaco', await actorFor('tabaco', 'store', (u) => u.storeId === store.id));
    const received = await receiveDelivery(storeActor, d.id, { name: 'Dueño de prueba', image: `${PNG}${'A'.repeat(200)}` });
    expect(received.templateId).toBe(nota.id);
  });

  it('documentos firmados: cada rol ve solo lo suyo', async () => {
    const admin = ctxOf('tabaco', await actorFor('tabaco', 'admin'));
    const all = await listSignedDocuments(admin);
    expect(all.some((d) => d.kind === 'contrato' && d.status === 'firmado')).toBe(true);
    expect(all.some((d) => d.kind === 'entrega')).toBe(true);
    const storeActor = await actorFor('tabaco', 'store');
    const mine = await listSignedDocuments(ctxOf('tabaco', storeActor));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((d) => d.storeId === storeActor.storeId)).toBe(true);
    const sellerActor = await actorFor('tabaco', 'seller');
    const stores = await getLineRepo('tabaco').stores.all();
    const own = new Set(stores.filter((s) => s.sellerId === sellerActor.userId).map((s) => s.id));
    const sellerDocs = await listSignedDocuments(ctxOf('tabaco', sellerActor));
    expect(sellerDocs.length).toBeGreaterThan(0);
    expect(sellerDocs.every((d) => own.has(d.storeId))).toBe(true);
    // Una cuenta de café no lee los documentos de tabaco.
    const cafeAdmin = await actorFor('cafe', 'admin');
    await expect(listSignedDocuments(ctxOf('tabaco', cafeAdmin))).rejects.toThrow(/otra línea/);
  });

  it('exportar e importar conserva el PDF de las plantillas', async () => {
    const admin = ctxOf('tabaco', await actorFor('tabaco', 'admin'));
    const before = await listTemplates(admin);
    const json = await exportState();
    await importState(json);
    const after = await listTemplates(admin);
    expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
    const t = after[0]!;
    expect(t.pdf).toBeInstanceOf(Blob);
    expect(t.pdf.size).toBe(before.find((b) => b.id === t.id)!.pdf.size);
  });
});

describe('estampar el PDF', () => {
  it('pone firmas (PNG) y textos con tildes, y conserva las páginas', async () => {
    const out = await stampPdf(pdf, [field('firma_local', 0.7), field('nombre_local', 0.2), { ...field('detalle_entrega', 0.3), h: 0.2 }], {
      firma_local: PNG,
      nombre_local: 'Tabaquería Ñandú — Calle Ocho',
      detalle_entrega: 'Biscayne Robusto × 20\nCafé Espresso El Mío × 12\n¿Algo más? ¡No!',
    });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    expect(out.length).toBeGreaterThan(pdf.length);
  });

  it('el detalle de la entrega va en una línea por producto', async () => {
    const out = await stampPdf(pdf, [{ ...field('detalle_entrega', 0.3), h: 0.3 }], { detalle_entrega: 'Nota E-0102\nBrickell Belicoso × 20\nCafé Espresso El Mío × 12' });
    expect(await textOps(out)).toBe(3);
  });

  it('el texto de Ajustes se convierte en PDF con espacio para las firmas', async () => {
    const { bytes, slots } = await textToPdfWithSlots('# Contrato\n> Plantilla de ejemplo: la revisa un abogado.\n\n## Partes\nTexto con acentos: consignación, señal.\n\n- Una viñeta', 'Contrato');
    const info = await readPdfInfo(bytes);
    expect(info.pageSizes.length).toBeGreaterThanOrEqual(1);
    expect(slots.map((s) => s.type).sort()).toEqual(['firma_local', 'firma_vendedor']);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w).toBeLessThanOrEqual(1);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y + s.h).toBeLessThanOrEqual(1);
    }
    // El anexo de precios (textToPdf) no trae líneas de firma: las firmas van en la plantilla.
    expect((await textToPdfWithSlots('# Anexo A\n- Un producto', 'Anexo A', [])).slots).toEqual([]);
    const merged = await mergePdfs(bytes, await onePagePdf());
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(info.pageSizes.length + 1);
  });

  it('un archivo que no es PDF se rechaza con un mensaje claro', async () => {
    await expect(readPdfInfo(new TextEncoder().encode('hola'))).rejects.toThrow(/PDF/);
  });

  it('un PDF con páginas giradas se rechaza: las firmas quedarían fuera de su recuadro', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).setRotation(degrees(90));
    await expect(readPdfInfo(await doc.save())).rejects.toThrow(/giradas/);
  });
});
