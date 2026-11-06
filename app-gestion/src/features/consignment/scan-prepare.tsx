// Preparar una entrega escaneando: cada lectura de un producto suma un mazo, tabaco o unidad a
// su línea; la etiqueta de una caja con trazabilidad suma la caja entera y la caja queda ligada
// a la entrega y al local. Se prepara lo juntado (nunca más de lo pedido).
import { Boxes, CheckCheck, PackageCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Product } from '../../data/types';
import { unitOf, unitsText } from '../../domain/products';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { hasCost, listProducts } from '../../services/catalog';
import { findByCode } from '../../services/codes';
import { prepareDelivery, type DeliveryView } from '../../services/consignment';
import { loadStoreForActor } from '../../services/stores';
import { Button, Loading, Pill, QtyStepper, Sheet } from '../../ui/kit';
import { ScanButton } from '../../ui/scanner';
import { useAction } from '../../ui/toast';

export function PrepareScanSheet({ d, onClose }: { d: DeliveryView; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const products = useAsync(() => listProducts(ctx, { includeInactive: true }), [ctx]);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [cases, setCases] = useState<{ id: string; code: string; productId: string }[]>([]);
  const [feedback, setFeedback] = useState<string>();
  const byId = useMemo(() => new Map((products.data ?? []).flatMap((v) => (hasCost(v.product) ? [[v.product.id, v.product] as const] : []))), [products.data]);
  const itemOf = (productId: string) => d.items.find((i) => i.productId === productId);
  const total = Object.values(picked).reduce((a, n) => a + n, 0);

  const bump = (pr: Product, n: number): boolean => {
    const item = itemOf(pr.id);
    if (!item) return false;
    const now = picked[pr.id] ?? 0;
    if (now + n > item.qty) {
      setFeedback(`Ya juntaste todo lo pedido de ${pr.name} (${unitsText(pr, item.qty)}).`);
      return false;
    }
    setPicked((s) => ({ ...s, [pr.id]: (s[pr.id] ?? 0) + n }));
    setFeedback(`+${unitsText(pr, n)} · ${pr.name}: ${now + n} de ${item.qty}`);
    return true;
  };

  const onCode = async (code: string) => {
    const m = await findByCode(ctx, code);
    if (m.kind === 'product') {
      const pr = byId.get(m.product.id);
      if (!pr || !itemOf(pr.id)) {
        setFeedback(`${m.product.name} no va en esta entrega.`);
        return;
      }
      bump(pr, 1);
      return;
    }
    if (m.kind === 'case') {
      const c = m.caseUnit;
      const pr = byId.get(c.productId);
      if (!pr || !itemOf(pr.id)) {
        setFeedback(`La caja ${c.code} es de un producto que no va en esta entrega.`);
        return;
      }
      if (cases.some((x) => x.id === c.id)) {
        setFeedback(`La caja ${c.code} ya está escaneada.`);
        return;
      }
      if (c.deliveryId) {
        setFeedback(`La caja ${c.code} ya salió en otra entrega.`);
        return;
      }
      if (bump(pr, pr.packSize)) setCases((s) => [...s, { id: c.id, code: c.code, productId: c.productId }]);
      return;
    }
    setFeedback(m.kind === 'none' ? `No conozco el código ${m.code}.` : 'Ese código no es de un producto.');
  };

  const prepare = () =>
    void run(
      async () => {
        const store = await loadStoreForActor(ctx, d.storeId);
        const r = await prepareDelivery(ctx, d.id, { approveStore: store.status === 'firmado', picked, caseIds: cases.map((c) => c.id) });
        onClose();
        return r;
      },
      (r) => (r.short ? `Preparada con ${r.prepared} u.; faltaron ${r.short} (demanda no atendida).` : `Preparada: ${r.prepared} u. listas para entregar.`),
    );

  return (
    <Sheet open onClose={onClose} title={`Preparar ${d.code} escaneando`} wide>
      {products.loading && !products.data ? <Loading rows={2} /> : null}
      <div className="grid gap-4">
        <p className="text-sm text-muted">Escanea cada mazo, tabaco o unidad que pones en la entrega (o la etiqueta de una caja). También puedes ajustar a mano. Se prepara lo juntado; lo que falte queda como demanda no atendida.</p>
        <div className="flex flex-wrap gap-2">
          <ScanButton variant="primary" label="Escanear" title={`Juntar ${d.code}`} continuous feedback={feedback} hint="Cada lectura suma uno; la etiqueta de una caja suma la caja entera." onCode={onCode} />
          <Button
            icon={CheckCheck}
            onClick={() => {
              setPicked(Object.fromEntries(d.itemsView.map((i) => [i.productId, Math.min(i.qty, i.available ?? i.qty)])));
              setFeedback(undefined);
            }}
          >
            Todo lo que hay
          </Button>
        </div>
        {feedback ? (
          <p className="rounded-2xl bg-accent-soft px-3 py-2 text-sm font-semibold text-ink" aria-live="polite">
            {feedback}
          </p>
        ) : null}
        <ul className="grid gap-2">
          {d.itemsView.map((i) => {
            const pr = byId.get(i.productId);
            const n = picked[i.productId] ?? 0;
            const done = n >= i.qty;
            return (
              <li key={i.productId} className="grid gap-2 rounded-2xl border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="font-semibold break-words">{i.name}</p>
                    <p className="text-sm text-muted">
                      Pidieron {pr ? unitsText(pr, i.qty) : i.qty}
                      {i.available !== undefined ? ` · hay ${pr ? unitsText(pr, i.available) : i.available}` : ''}
                    </p>
                  </div>
                  <Pill tone={done ? 'ok' : n ? 'accent' : undefined}>
                    {n} de {i.qty}
                  </Pill>
                </div>
                <QtyStepper label={`${i.name}, juntados`} value={n} max={i.qty} onChange={(v) => setPicked((s) => ({ ...s, [i.productId]: v }))} unit={pr ? unitOf(pr).many : 'u.'} />
              </li>
            );
          })}
        </ul>
        {cases.length ? (
          <div className="grid gap-2">
            <p className="flex items-center gap-2 font-semibold">
              <Boxes className="h-5 w-5 text-accent" aria-hidden /> Cajas con trazabilidad
            </p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {cases.map((c) => (
                <li key={c.id} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-line pl-3">
                  <span className="min-w-0 text-sm font-semibold break-all">{c.code}</span>
                  <Button
                    variant="ghost"
                    icon={X}
                    aria-label={`Quitar la caja ${c.code}`}
                    onClick={() => {
                      const pr = byId.get(c.productId);
                      setCases((s) => s.filter((x) => x.id !== c.id));
                      if (pr) setPicked((s) => ({ ...s, [pr.id]: Math.max(0, (s[pr.id] ?? 0) - pr.packSize) }));
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Button variant="primary" big icon={PackageCheck} busy={busy} disabled={total === 0} onClick={prepare}>
          Preparar con lo juntado
        </Button>
      </div>
    </Sheet>
  );
}
