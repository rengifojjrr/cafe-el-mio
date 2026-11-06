// «Pedido por teléfono» (el dueño llama y dicta) y «Pegar pedido» (el dueño manda un WhatsApp): la
// oficina lo anota en pocos toques y pasa directo al almacén para preparar. Después sigue el camino
// de siempre: preparar → entregar con la firma del dueño (y, si compra en firme, sale su factura).
import { CheckCircle2, ClipboardPaste, PackageCheck, Phone, Search, Send, Trash2, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { SalePack } from '../../data/types';
import { type PasteLine, parsePastedOrder } from '../../domain/paste-order';
import { baseQty } from '../../domain/pricing';
import { mixedUnitsText, normalize, searchText, stockText, unitNames } from '../../domain/products';
import { fmtMoney } from '../../lib/money';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { createPhoneOrder } from '../../services/consignment';
import { type QuickProduct, type QuickStore, packQtyText, quickSaleProducts, quickSaleStores } from '../../services/invoices';
import { Button, Card, ErrorBox, LinkButton, Loading, PageHeader, Pill, Section, SelectInput, TextArea } from '../../ui/kit';
import { useAction } from '../../ui/toast';
import { RoleGate } from '../common';
import { PackQty, PickedStore, StorePicker, defaultPack } from './parts';

export function PhoneOrderPage() {
  return (
    <RoleGate roles={['admin']} message="Los pedidos por teléfono los anota administración.">
      <PhoneOrder />
    </RoleGate>
  );
}

export function PasteOrderPage() {
  return (
    <RoleGate roles={['admin']} message="Los pedidos pegados de un mensaje los anota administración.">
      <PasteOrder />
    </RoleGate>
  );
}

/** El local y sus productos (con sus precios) para anotar un pedido. */
function useOrderData() {
  const { ctx } = useLine();
  const [params] = useSearchParams();
  const stores = useAsync(() => quickSaleStores(ctx, 'pedido'), [ctx]);
  const [storeId, setStoreId] = useState<string | null>(params.get('local'));
  const catalog = useAsync(() => quickSaleProducts(ctx, storeId, 'pedido'), [ctx, storeId]);
  const picked = stores.data?.find((s) => s.store.id === storeId && !s.blocked);
  return { stores, storeId, setStoreId, catalog, picked };
}

/** Lo que paga el local: su lista si compra en firme; en consignación, el precio al local. */
function priceText(x: QuickProduct, store: QuickStore): string {
  const unit = unitNames(x.product.unitName).one;
  if (store.store.saleMode === 'firme') return `${fmtMoney(x.price.unit)} por ${unit} · ${fmtMoney(x.price.box)} la caja`;
  return `${fmtMoney(x.product.priceToStore)} por ${unit} al local (consignación)`;
}

function OrderDone({ code, onAgain }: { code: string; onAgain: () => void }) {
  const { p } = useLine();
  return (
    <Card className="mt-6 grid gap-3 p-4 sm:p-5">
      <p className="flex items-center gap-2 text-lg font-bold text-ok">
        <CheckCircle2 className="h-6 w-6" aria-hidden /> Pedido {code} anotado
      </p>
      <p className="text-ink">Ya está en Entregas para preparar. Al entregar, firma el dueño o encargado del local.</p>
      <div className="flex flex-wrap gap-2">
        <LinkButton to={p('entregas')} variant="primary" icon={PackageCheck}>
          Preparar en Entregas
        </LinkButton>
        <Button onClick={onAgain}>Anotar otro pedido</Button>
      </div>
    </Card>
  );
}

// ---------- Por teléfono ----------

function PhoneOrder() {
  const { ctx, actor, p } = useLine();
  const { run, busy } = useAction();
  const { stores, storeId, setStoreId, catalog, picked } = useOrderData();
  const [qty, setQty] = useState<Record<string, { pack: SalePack; packQty: number }>>({});
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const products = catalog.data?.products ?? [];
  const term = normalize(q);
  const shown = term ? products.filter((x) => searchText(x.product).includes(term)) : products;
  const items = products.flatMap((x) => {
    const v = qty[x.product.id];
    return v && v.packQty > 0 ? [{ x, ...v, base: baseQty(x.product, v.pack, v.packQty) }] : [];
  });
  const total = items.reduce((a, i) => a + (picked?.store.saleMode === 'firme' ? (i.pack === 'caja' ? i.x.price.box : i.x.price.unit) * i.packQty : i.base * i.x.product.priceToStore), 0);
  const reset = () => {
    setQty({});
    setNote('');
    setDone(null);
  };

  if (stores.error) return <ErrorBox error={stores.error} />;
  return (
    <>
      <PageHeader
        title="Pedido por teléfono"
        subtitle="El dueño llama y dicta: anótalo aquí. Pasa directo al almacén para preparar; al entregar firma el dueño (y si compra en firme, sale su factura)."
        actions={
          <LinkButton to={`${p('pegar-pedido')}${storeId ? `?local=${storeId}` : ''}`} icon={ClipboardPaste}>
            Pegar un mensaje
          </LinkButton>
        }
      />
      <Section title="¿Quién llama?">
        {stores.loading && !stores.data ? (
          <Loading rows={2} />
        ) : picked ? (
          <PickedStore
            store={picked}
            detail={catalog.data && picked.store.saleMode === 'firme' ? `lista ${catalog.data.listName}` : undefined}
            onChange={() => {
              setStoreId(null);
              reset();
            }}
          />
        ) : (
          <StorePicker stores={stores.data ?? []} onPick={(s) => setStoreId(s.store.id)} />
        )}
      </Section>

      {done ? <OrderDone code={done} onAgain={reset} /> : null}

      {picked && !done ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              async () => {
                const r = await createPhoneOrder(ctx, { storeId: picked.store.id, items: items.map((i) => ({ productId: i.x.product.id, qty: i.base })), note }, 'telefono');
                setQty({});
                setDone(r.reorder.code);
                return r;
              },
              (r) => `Pedido ${r.reorder.code} anotado para ${picked.store.name}: pasa al almacén para preparar.`,
            );
          }}
        >
          <Section title="¿Qué pide?">
            <label className="relative mb-3 block">
              <span className="sr-only">Buscar producto</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
              <input className="input pl-10" placeholder="Buscar por nombre, capa o medida" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            {catalog.loading && !catalog.data ? <Loading rows={3} /> : null}
            <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {shown.map((x) => {
                const v = qty[x.product.id] ?? { pack: defaultPack(x.product), packQty: 0 };
                return (
                  <li key={x.product.id} className="glass grid grid-cols-[minmax(0,1fr)] gap-2 p-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{x.product.name}</p>
                      <p className="text-sm text-muted">{priceText(x, picked)}</p>
                      <p className={`text-sm ${x.available > 0 ? 'text-muted' : 'text-warn'}`}>{x.available > 0 ? `Hay ${stockText(x.product, x.available)}` : 'Sin existencias ahora: lo que falte queda como demanda no atendida'}</p>
                    </div>
                    <PackQty product={x.product} pack={v.pack} packQty={v.packQty} onChange={(pack, packQty) => setQty((s) => ({ ...s, [x.product.id]: { pack, packQty } }))} />
                  </li>
                );
              })}
            </ul>
          </Section>
          <Card className="mt-4 p-4">
            <TextArea label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: lo recoge el sábado" />
          </Card>
          <div className="sticky bottom-[76px] z-20 mt-5 flex flex-wrap items-center justify-end gap-3 lg:bottom-4 lg:justify-start">
            {items.length ? (
              <p className="glass px-4 py-2 text-sm font-semibold">
                {mixedUnitsText(items.map((i) => ({ product: i.x.product, qty: i.base })))} · <span className="glow tabular">{fmtMoney(total)}</span>
              </p>
            ) : null}
            <Button type="submit" variant="primary" big icon={Phone} busy={busy} disabled={items.length === 0 || actor.readOnly}>
              Crear pedido
            </Button>
          </div>
        </form>
      ) : null}
    </>
  );
}

// ---------- Pegado de un mensaje ----------

interface ReviewLine extends PasteLine {
  key: number;
}

const EXAMPLE = '10 toro maduro, 5 robusto habano\n2 cajas torpedo maduro\n3 mz churchill conneticut';

function PasteOrder() {
  const { ctx, actor, p, line } = useLine();
  const { run, busy } = useAction();
  const { stores, storeId, setStoreId, catalog, picked } = useOrderData();
  const [text, setText] = useState('');
  const [lines, setLines] = useState<ReviewLine[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [changing, setChanging] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const products = useMemo(() => catalog.data?.products ?? [], [catalog.data]);
  const byId = useMemo(() => new Map(products.map((x) => [x.product.id, x])), [products]);
  const options = useMemo(() => [...products].sort((a, b) => a.product.name.localeCompare(b.product.name, 'es')).map((x) => ({ value: x.product.id, label: x.product.name })), [products]);

  const read = () => {
    const r = parsePastedOrder(
      text,
      products.map((x) => x.product),
      { preferred: products.filter((x) => x.lastForStore).map((x) => x.product.id) },
    );
    setLines(r.lines.map((l, i) => ({ ...l, key: i })));
    setIgnored(r.ignored);
    setChanging(null);
  };
  const update = (key: number, patch: Partial<ReviewLine>) => setLines((ls) => (ls ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const choose = (l: ReviewLine, productId: string) => {
    const x = byId.get(productId);
    if (!x) return;
    // Si el mensaje no dijo la presentación, se propone la de siempre del producto elegido.
    const pack = l.packGuessed ? defaultPack(x.product) : l.pack;
    update(l.key, { productId, status: 'ok', pack: x.product.packSize > 1 ? pack : 'unidad' });
    setChanging(null);
  };
  const ready = (lines ?? []).filter((l) => l.productId && l.qty > 0);
  const pending = (lines ?? []).filter((l) => !l.productId).length;
  const merged = new Map<string, number>();
  for (const l of ready) {
    const x = byId.get(l.productId!);
    if (x) merged.set(x.product.id, (merged.get(x.product.id) ?? 0) + baseQty(x.product, l.pack, l.qty));
  }
  const reset = () => {
    setText('');
    setLines(null);
    setIgnored([]);
    setDone(null);
  };

  if (stores.error) return <ErrorBox error={stores.error} />;
  return (
    <>
      <PageHeader
        title="Pegar pedido"
        subtitle="Copia el mensaje de WhatsApp del dueño y pégalo aquí. La app propone las líneas; revísalas y crea el pedido."
        actions={
          <LinkButton to={`${p('pedido-telefono')}${storeId ? `?local=${storeId}` : ''}`} icon={Phone}>
            Anotar a mano
          </LinkButton>
        }
      />
      <Section title="¿De qué local es?">
        {stores.loading && !stores.data ? (
          <Loading rows={2} />
        ) : picked ? (
          <PickedStore
            store={picked}
            onChange={() => {
              setStoreId(null);
              reset();
            }}
          />
        ) : (
          <StorePicker stores={stores.data ?? []} onPick={(s) => setStoreId(s.store.id)} />
        )}
      </Section>

      {done ? <OrderDone code={done} onAgain={reset} /> : null}

      {picked && !done ? (
        <>
          <Section title="El mensaje">
            <Card className="grid gap-3 p-4">
              <TextArea label="Pega aquí el mensaje" value={text} onChange={(e) => setText(e.target.value)} placeholder={line === 'tabaco' ? EXAMPLE : '3 cajas de café el mío\n1 caja de 24\n2 colombia'} rows={5} />
              <Button variant="primary" icon={Wand2} disabled={!text.trim() || products.length === 0} onClick={read}>
                Leer pedido
              </Button>
            </Card>
          </Section>

          {lines ? (
            <Section title={lines.length ? `Lo que entendí (${lines.length})` : 'No encontré productos en el mensaje'}>
              <ul className="grid grid-cols-1 gap-2">
                {lines.map((l) => {
                  const x = l.productId ? byId.get(l.productId) : undefined;
                  const showCandidates = !l.productId ? l.status === 'ambiguo' : changing === l.key;
                  return (
                    <li key={l.key} className="glass grid grid-cols-[minmax(0,1fr)] gap-2 p-3" aria-label={`Línea: ${l.raw}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-sm text-muted">«{l.raw}»</p>
                        <Button variant="ghost" icon={Trash2} aria-label={`Quitar «${l.raw}»`} onClick={() => setLines((ls) => (ls ?? []).filter((y) => y.key !== l.key))} />
                      </div>
                      {x ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-ink">{x.product.name}</p>
                          {l.candidates.length ? (
                            <Button variant="ghost" onClick={() => setChanging(changing === l.key ? null : l.key)}>
                              Cambiar
                            </Button>
                          ) : null}
                        </div>
                      ) : l.status === 'ambiguo' ? (
                        <p className="font-semibold text-warn">¿Cuál de estos es?</p>
                      ) : (
                        <p className="font-semibold text-danger">No encontré este producto. Elígelo o quita la línea.</p>
                      )}
                      {showCandidates && l.candidates.length ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label={`Productos posibles para «${l.raw}»`}>
                          {l.candidates.map((id) => {
                            const c = byId.get(id);
                            return c ? (
                              <Button key={id} variant={id === l.productId ? 'primary' : 'secondary'} onClick={() => choose(l, id)}>
                                {c.product.name}
                              </Button>
                            ) : null;
                          })}
                        </div>
                      ) : null}
                      {!x && l.status === 'desconocido' ? (
                        <SelectInput label="Producto" value="" onChange={(e) => choose(l, e.target.value)} options={options} placeholder="Elige el producto" />
                      ) : null}
                      {x ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <PackQty product={x.product} pack={l.pack} packQty={l.qty} onChange={(pack, qty) => update(l.key, { pack, qty, packGuessed: false, qtyGuessed: false })} />
                          {l.qtyGuessed ? <Pill tone="warn">No decía cuántos</Pill> : null}
                          <span className="text-sm text-muted">{packQtyText(x.product, l.pack, l.qty)}</span>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {ignored.length ? <p className="mt-2 text-sm text-muted">No se usó: {ignored.map((t) => `«${t}»`).join(', ')}.</p> : null}
              <div className="sticky bottom-[76px] z-20 mt-5 flex flex-wrap items-center justify-end gap-3 lg:bottom-4 lg:justify-start">
                {pending ? <p className="glass px-4 py-2 text-sm font-semibold text-warn">Falta elegir el producto en {pending} línea{pending === 1 ? '' : 's'}</p> : null}
                <Button
                  variant="primary"
                  big
                  icon={Send}
                  busy={busy}
                  disabled={pending > 0 || merged.size === 0 || actor.readOnly}
                  onClick={() =>
                    void run(
                      async () => {
                        const r = await createPhoneOrder(ctx, { storeId: picked.store.id, items: [...merged].map(([productId, qty]) => ({ productId, qty })), note: `«${text.trim().replace(/\s*\n+\s*/g, ' · ').slice(0, 200)}»` }, 'pegado');
                        setDone(r.reorder.code);
                        setLines(null);
                        return r;
                      },
                      (r) => `Pedido ${r.reorder.code} anotado para ${picked.store.name}: pasa al almacén para preparar.`,
                    )
                  }
                >
                  Crear pedido{merged.size ? ` (${merged.size} producto${merged.size === 1 ? '' : 's'})` : ''}
                </Button>
              </div>
            </Section>
          ) : null}
        </>
      ) : null}
    </>
  );
}

