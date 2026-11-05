// Documentos firmados de la línea: contratos de consignación (firmados o por firmar) y notas de
// entrega firmadas al recibir. Cada rol ve solo lo suyo: administración todo, el vendedor los de
// sus locales y el local los propios.
import type { Signature } from '../data/types';
import { type Ctx, guard } from './context';
import { scopedStores } from './stores';

export interface SignedDocument {
  id: string;
  kind: 'contrato' | 'entrega';
  status: 'firmado' | 'por_firmar';
  storeId: string;
  storeName: string;
  title: string;
  /** Firmado (o emitido, si está por firmar). */
  date: string;
  signers: { name: string; role: Signature['role'] }[];
  usesPdf: boolean;
  /** Ruta dentro de la línea para abrirlo. */
  path: string;
}

export async function listSignedDocuments(ctx: Ctx): Promise<SignedDocument[]> {
  guard(ctx, 'contract.read');
  guard(ctx, 'delivery.read');
  const stores = await scopedStores(ctx);
  const byId = new Map(stores.map((s) => [s.id, s]));
  const [contracts, deliveries] = await Promise.all([ctx.repo.contracts.all(), ctx.repo.deliveries.all()]);
  const out: SignedDocument[] = [];
  for (const c of contracts) {
    const store = byId.get(c.storeId);
    if (!store || c.status === 'anulado') continue;
    out.push({
      id: c.id,
      kind: 'contrato',
      status: c.status === 'firmado' ? 'firmado' : 'por_firmar',
      storeId: c.storeId,
      storeName: store.name,
      title: `Contrato de consignación v${c.version}`,
      date: c.signedAt ?? c.createdAt,
      signers: c.signatures.map((s) => ({ name: s.name, role: s.role })),
      usesPdf: Boolean(c.templateId),
      path: `contratos/${c.id}`,
    });
  }
  for (const d of deliveries) {
    const store = byId.get(d.storeId);
    if (!store || d.status !== 'entregada' || !d.receivedSignature) continue;
    out.push({
      id: d.id,
      kind: 'entrega',
      status: 'firmado',
      storeId: d.storeId,
      storeName: store.name,
      title: `Nota de entrega ${d.code}`,
      date: d.deliveredAt ?? d.receivedSignature.signedAt,
      signers: [{ name: d.receivedSignature.name, role: 'local' }],
      usesPdf: Boolean(d.templateId),
      path: `entregas/${d.id}/imprimir`,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
