// «Venta rápida»: alguien viene al almacén y se lleva lo suyo: el dueño de un local, una persona (a su
// nombre) o cualquiera en el mostrador. Tres toques para un mazo: el cliente → el producto (va 1
// mazo) → «Cobrar». Baja el stock, sale la factura (o el recibo) en PDF para compartir y queda el
// pago anotado. La app no cobra: la tarjeta se cobra aparte. En tabaco, a una persona o en el
// mostrador se anota que se comprobó su edad (21 o más).
import { CheckCircle2, CreditCard, HandCoins, Plus, Search, Trash2, Wallet, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Invoice, SalePack } from '../../data/types';
import { type ClaseCliente, esLocal } from '../../domain/clientes';
import { AVISO_EDAD, pideEdad } from '../../domain/compliance';
import { baseQty } from '../../domain/pricing';
import { normalize, searchText, stockText, unitNames } from '../../domain/products';
import { fmtMoney } from '../../lib/money';
import { fmtDate } from '../../lib/time';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { findByCode } from '../../services/codes';
import { type QuickPayment, type QuickProduct, type QuickStore, packQtyText, quickSale, quickSaleProducts, quickSaleStores } from '../../services/invoices';
import { PAYMENT_METHOD_LABEL } from '../../services/money';
import { Button, Card, EmptyState, ErrorBox, Loading, PageHeader, Section, TextInput } from '../../ui/kit';
import { ScanButton } from '../../ui/scanner';
import { useAction, useToast } from '../../ui/toast';
import { RoleGate } from '../common';
import { InvoiceDocButtons } from './invoices';
import { ClientePicker, PackQty, PickedStore, defaultPack } from './parts';

export function QuickSalePage() {
  return (
    <RoleGate roles={['admin']} message="La venta rápida la registra administración en el almacén.">
      <QuickSale />
    </RoleGate>
  );
}

interface CartLine {
  productId: string;
  pack: SalePack;
  packQty: number;
}

const PAY_OPTIONS: { value: QuickPayment; label: string; icon: typeof Wallet }[] = [
  { value: 'efectivo', label: 'Efectivo', icon: Wallet },
  { value: 'tarjeta', label: PAYMENT_METHOD_LABEL.tarjeta, icon: CreditCard },
  { value: 'zelle', label: 'Zelle', icon: HandCoins },
  { value: 'cuenta', label: 'A cuenta', icon: Plus },
];

function QuickSale() {
  const { ctx, actor } = useLine();
  const { push } = useToast();
  const { run, busy } = useAction();
  const [params] = useSearchParams();
  const stores = useAsync(() => quickSaleStores(ctx), [ctx]);
  const [storeId, setStoreId] = useState<string | null>(params.get('local'));
  const catalog = useAsync(() => quickSaleProducts(ctx, storeId), [ctx, storeId]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [q, setQ] = useState('');
  const [method, setMethod] = useState<QuickPayment>('efectivo');
  const [reference, setReference] = useState('');
  const [done, setDone] = useState<Invoice | null>(null);
  const [clase, setClase] = useState<ClaseCliente>('local');
  // Una persona o el mostrador (no están en la lista de locales).
  const [otro, setOtro] = useState<QuickStore | null>(null);
  const [nota, setNota] = useState('');
  const [edad, setEdad] = useState(false);

  const picked = otro && otro.store.id === storeId ? otro : stores.data?.find((s) => s.store.id === storeId && !s.blocked);
  const pide = pideEdad(ctx.line, picked?.store);
  const mostrador = picked?.store.clase === 'almacen';
  // Al mostrador no se le fía: no hay a quién cobrarle después.
  const metodos = mostrador ? PAY_OPTIONS.filter((o) => o.value !== 'cuenta') : PAY_OPTIONS;
  const products = useMemo(() => catalog.data?.products ?? [], [catalog.data]);
  const byId = useMemo(() => new Map(products.map((x) => [x.product.id, x])), [products]);
  const term = normalize(q);
  const shown = term ? products.filter((x) => searchText(x.product).includes(term)) : products.slice(0, 9);
  const lines = cart.flatMap((l) => {
    const x = byId.get(l.productId);
    if (!x) return [];
    const price = l.pack === 'caja' ? x.price.box : x.price.unit;
    return [{ ...l, x, price, amount: price * l.packQty }];
  });
  const total = lines.reduce((a, l) => a + l.amount, 0);

  /** Cada toque suma uno (un mazo o una caja); nunca más de lo que hay. */
  const add = (x: QuickProduct, pack?: SalePack) => {
    setDone(null);
    const cur = cart.find((l) => l.productId === x.product.id);
    if (!cur) {
      const want = pack ?? defaultPack(x.product);
      // Si no alcanza para una caja entera, va por unidad.
      setCart([...cart, { productId: x.product.id, pack: baseQty(x.product, want, 1) > x.available ? 'unidad' : want, packQty: 1 }]);
      return;
    }
    if (baseQty(x.product, cur.pack, cur.packQty + 1) > x.available) {
      push('error', `No hay más ${x.product.name}: quedan ${stockText(x.product, x.available)}.`);
      return;
    }
    setCart(cart.map((l) => (l.productId === x.product.id ? { ...l, packQty: l.packQty + 1 } : l)));
  };

  const onCode = async (code: string) => {
    const r = await findByCode(ctx, code);
    const id = r.kind === 'product' ? r.product.id : r.kind === 'case' ? r.caseUnit.productId : null;
    const x = id ? byId.get(id) : undefined;
    if (!x) {
      push('error', r.kind === 'none' ? `No encontré el código ${code}.` : 'Ese producto no está activo para vender.');
      return;
    }
    if (x.available <= 0) {
      push('error', `No hay ${x.product.name} en el almacén.`);
      return;
    }
    // Una caja con su número propio es una caja.
    add(x, r.kind === 'case' ? 'caja' : undefined);
  };

  const charge = () =>
    void run(
      async () => {
        if (!storeId) throw new Error('Elige quién compra.');
        const r = await quickSale(ctx, {
          storeId,
          items: cart.map((l) => ({ productId: l.productId, pack: l.pack, packQty: l.packQty })),
          payment: { method: mostrador && method === 'cuenta' ? 'efectivo' : method, reference },
          note: mostrador ? nota : '',
          edadComprobada: pide ? edad : false,
        });
        setCart([]);
        setReference('');
        setNota('');
        // La edad se comprueba en cada venta.
        setEdad(false);
        setDone(r.invoice);
        return r;
      },
      (r) => {
        const first = lines[0];
        const what = lines.length === 1 && first ? packQtyText(first.x.product, first.pack, first.packQty) : `${lines.length} productos`;
        return method === 'cuenta'
          ? `Venta ${r.invoice.code} anotada a cuenta: ${what} · ${fmtMoney(r.invoice.total)}, vence el ${fmtDate(r.invoice.dueOn)}.`
          : `Venta ${r.invoice.code} cobrada: ${what} · ${fmtMoney(r.invoice.total)} (${PAYMENT_METHOD_LABEL[method].toLowerCase()}).`;
      },
    );

  if (stores.error) return <ErrorBox error={stores.error} />;
  return (
    <>
      <PageHeader title="Venta rápida" subtitle="Vinieron al almacén: un local, una persona o el mostrador. Elige lo que se lleva y cobra. Baja el stock y sale la factura para compartir." />

      <Section title="¿Quién compra?">
        {stores.loading && !stores.data ? (
          <Loading rows={2} />
        ) : picked ? (
          <PickedStore
            store={picked}
            detail={catalog.data && esLocal(picked.store) ? `lista ${catalog.data.listName}` : undefined}
            onChange={() => {
              setStoreId(null);
              setOtro(null);
              setCart([]);
              setDone(null);
              setEdad(false);
            }}
          />
        ) : (
          <ClientePicker
            stores={stores.data ?? []}
            clase={clase}
            onClase={setClase}
            onPick={(s) => {
              setStoreId(s.store.id);
              setOtro(esLocal(s.store) ? null : s);
              setCart([]);
              setDone(null);
              setEdad(false);
              if (s.store.clase === 'almacen' && method === 'cuenta') setMethod('efectivo');
            }}
          />
        )}
      </Section>

      {picked ? (
        <Section title="¿Qué se lleva?" actions={<ScanButton onCode={onCode} />}>
          <label className="relative mb-3 block">
            <span className="sr-only">Buscar producto</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
            <input className="input pl-10" placeholder="Buscar por nombre, capa, medida o código" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {catalog.loading && !catalog.data ? <Loading rows={2} /> : null}
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Productos">
            {shown.map((x) => {
              const unit = unitNames(x.product.unitName);
              const p = defaultPack(x.product);
              return (
                <li key={x.product.id}>
                  <button
                    type="button"
                    data-product={x.product.id}
                    data-available={x.available}
                    className="glass flex min-h-16 w-full items-center justify-between gap-3 p-3 text-left hover:border-accent disabled:opacity-55"
                    disabled={x.available <= 0}
                    onClick={() => add(x)}
                    aria-label={`Agregar ${x.product.name}`}
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{x.product.name}</span>
                      <span className={`block text-sm ${x.available > 0 ? 'text-muted' : 'text-danger'}`}>{x.available > 0 ? `Hay ${stockText(x.product, x.available)}` : 'Sin existencias'}</span>
                    </span>
                    <span className="flex-none text-right">
                      <span className="tabular block font-bold text-ink">{fmtMoney(p === 'caja' ? x.price.box : x.price.unit)}</span>
                      <span className="block text-xs text-muted">{p === 'caja' ? 'la caja' : `el ${unit.one}`}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!term && products.length > shown.length ? <p className="mt-2 text-sm text-muted">Busca o escanea para ver los otros {products.length - shown.length} productos.</p> : null}
        </Section>
      ) : null}

      {done && cart.length === 0 ? (
        <Card className="mt-6 grid gap-3 p-4 sm:p-5" aria-label={`Venta ${done.code}`}>
          <p className="flex items-center gap-2 text-lg font-bold text-ok">
            <CheckCircle2 className="h-6 w-6" aria-hidden /> Venta {done.code} registrada
          </p>
          <p className="text-ink">
            {fmtMoney(done.total)} · {done.status === 'pagada' ? 'pagada' : `a cuenta, vence el ${fmtDate(done.dueOn)}`}
            {done.withoutResaleCert && picked && esLocal(picked.store) ? ' · sin certificado de reventa vigente' : ''}
            {done.edadComprobada ? ' · edad comprobada (21+)' : ''}
          </p>
          <InvoiceDocButtons invoiceId={done.id} code={done.code} />
        </Card>
      ) : null}

      {picked && lines.length ? (
        <Section title="Cobrar">
          <ul className="grid grid-cols-1 gap-2">
            {lines.map((l) => (
              <li key={l.productId} className="glass grid grid-cols-[minmax(0,1fr)] gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block font-semibold">{l.x.product.name}</span>
                    <span className="block text-sm text-muted">
                      {packQtyText(l.x.product, l.pack, l.packQty)} × {fmtMoney(l.price)} = <b className="text-ink">{fmtMoney(l.amount)}</b>
                    </span>
                  </span>
                  <Button variant="ghost" icon={Trash2} aria-label={`Quitar ${l.x.product.name}`} onClick={() => setCart((c) => c.filter((x) => x.productId !== l.productId))} />
                </div>
                <PackQty
                  product={l.x.product}
                  pack={l.pack}
                  packQty={l.packQty}
                  available={l.x.available}
                  onChange={(pack, packQty) => setCart((c) => (packQty <= 0 ? c.filter((x) => x.productId !== l.productId) : c.map((x) => (x.productId === l.productId ? { ...x, pack, packQty } : x))))}
                />
              </li>
            ))}
          </ul>
          <fieldset className="mt-4 grid gap-2">
            <legend className="field-label mb-1.5">Cómo paga</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {metodos.map((o) => (
                <button key={o.value} type="button" className={`btn ${method === o.value ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={method === o.value} onClick={() => setMethod(o.value)}>
                  <o.icon aria-hidden />
                  {o.label}
                </button>
              ))}
            </div>
            {method === 'tarjeta' ? <p className="text-sm text-muted">Se cobra aparte, en el datáfono. Aquí solo se anota; nunca escribas el número de la tarjeta.</p> : null}
            {method === 'cuenta' ? <p className="text-sm text-muted">Queda por cobrar con los días de crédito del cliente ({picked.terms.toLowerCase()}).</p> : null}
            {method === 'zelle' ? <TextInput label="Número de confirmación de Zelle" value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" /> : null}
          </fieldset>
          {mostrador ? (
            <div className="mt-4">
              <TextInput label="Nota (opcional)" hint="Si quiere, el nombre de quien compra: queda en la factura." value={nota} onChange={(e) => setNota(e.target.value)} maxLength={200} autoComplete="off" />
            </div>
          ) : null}
          {pide ? (
            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-warn bg-warn-soft p-3">
              <input type="checkbox" className="mt-1 h-5 w-5 flex-none" checked={edad} onChange={(e) => setEdad(e.target.checked)} />
              <span>
                <span className="font-semibold text-ink">{AVISO_EDAD}</span>
                <span className="block text-sm text-muted">Pídele un documento con foto. A menores de 21 no se les vende tabaco.</span>
              </span>
            </label>
          ) : null}
          <div className="sticky bottom-[76px] z-20 mt-5 flex flex-wrap items-center justify-end gap-3 lg:bottom-4 lg:justify-start">
            <Button type="button" variant="primary" big icon={Zap} busy={busy} disabled={actor.readOnly || lines.length === 0 || (pide && !edad)} onClick={charge}>
              {method === 'cuenta' ? `Anotar a cuenta ${fmtMoney(total)}` : `Cobrar ${fmtMoney(total)}`}
            </Button>
          </div>
        </Section>
      ) : picked && !done ? (
        <EmptyState icon={Zap} title="Toca un producto">
          Va de a un mazo (o de a una caja en lo que se vende por caja). Después ajustas la cantidad.
        </EmptyState>
      ) : null}
    </>
  );
}
