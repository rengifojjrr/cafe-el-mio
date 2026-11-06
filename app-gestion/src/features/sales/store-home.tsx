// Inicio del local que compra en firme: lo que debe, sus facturas (con el PDF), lo que llega y sus
// pedidos. No hay consignación ni «lo que ganas»: compra a sus precios y paga sus facturas.
import { ClipboardList, MessageCircle, Receipt, ShoppingBag, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { creditText } from '../../domain/invoices';
import { fmtMoney } from '../../lib/money';
import { fmtDate } from '../../lib/time';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { listDeliveries, listReorders } from '../../services/consignment';
import { listInvoices, type InvoiceView } from '../../services/invoices';
import { openThread } from '../../services/messages';
import { storeDebt, type StoreView } from '../../services/stores';
import { Button, EmptyState, LinkButton, PageHeader, Pill, Section, Stat } from '../../ui/kit';
import { useAction } from '../../ui/toast';
import { DeliveryCard } from '../consignment/components';
import { InvoiceItem, InvoiceSheet } from './invoices';

export function FirmStoreHome({ view }: { view: StoreView }) {
  const { ctx, actor, p } = useLine();
  const nav = useNavigate();
  const { run } = useAction();
  const s = view.store;
  const debt = useAsync(() => storeDebt(ctx, s.id), [ctx, s.id]);
  const invoices = useAsync(() => listInvoices(ctx, { storeId: s.id }), [ctx, s.id]);
  const orders = useAsync(() => listReorders(ctx, { storeId: s.id, open: true }), [ctx, s.id]);
  const ready = useAsync(() => listDeliveries(ctx, { storeId: s.id, status: 'preparada' }), [ctx, s.id]);
  const [detail, setDetail] = useState<InvoiceView | null>(null);
  const owed = debt.data?.total ?? 0;
  const overdue = (debt.data?.overdue ?? 0) > 0;
  const list = invoices.data ?? [];
  const open = list.filter((i) => i.balance > 0);
  const recent = [...open, ...list.filter((i) => i.balance <= 0)].slice(0, 5);

  const writeSeller = () =>
    void run(async () => {
      const t = await openThread(ctx, { kind: 'seller' });
      nav(p(`mensajes/${t.id}`));
    });

  return (
    <>
      <PageHeader title={s.name} subtitle={`Hola, ${actor.name.split(' ')[0]}. ${creditText(s)}. Tu vendedor es ${view.sellerName}.`} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <LinkButton to={p('pedir')} variant="primary" big icon={ShoppingBag} className="w-full">
          Pedir más producto
        </LinkButton>
        <LinkButton to={p('cuentas')} big icon={Receipt} className="w-full">
          Mis cuentas
        </LinkButton>
        <Button big icon={MessageCircle} className="w-full" onClick={writeSeller} disabled={actor.readOnly}>
          Escribir a mi vendedor
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Lo que debes"
          value={owed}
          format="money"
          icon={Wallet}
          tone={overdue ? 'danger' : owed > 0 ? 'warn' : 'ok'}
          hint={overdue ? `${fmtMoney(debt.data!.overdue)} vencidos` : debt.data?.nextDueOn ? `Vence el ${fmtDate(debt.data.nextDueOn)}` : 'Al día'}
          to={p('cuentas')}
        />
        <Stat label="Facturas por pagar" value={debt.data?.openInvoices ?? 0} icon={Receipt} to={p('cuentas')} />
        <Stat label="Pedidos en curso" value={orders.data?.length ?? 0} icon={ClipboardList} to={p('pedidos')} />
      </div>

      {(ready.data ?? []).length ? (
        <Section title="Para recibir">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {(ready.data ?? []).map((d) => (
              <DeliveryCard key={d.id} d={d} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Tus facturas" actions={<LinkButton to={p('cuentas')} variant="ghost">Ver todas</LinkButton>}>
        {invoices.data && list.length === 0 ? (
          <EmptyState icon={Receipt} title="Todavía no tienes facturas">
            Cada entrega que recibes con firma trae su factura.
          </EmptyState>
        ) : null}
        <ul className="grid grid-cols-1 gap-2">
          {recent.map((i) => (
            <li key={i.id}>
              <InvoiceItem inv={i} onOpen={() => setDetail(i)} />
            </li>
          ))}
        </ul>
      </Section>

      {(orders.data ?? []).length ? (
        <Section title="Tus pedidos" actions={<LinkButton to={p('pedidos')} variant="ghost">Ver todos</LinkButton>}>
          <ul className="grid grid-cols-1 gap-2">
            {(orders.data ?? []).map((o) => (
              <li key={o.id} className="glass flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="min-w-0">
                  <b>{o.code}</b> · {o.itemsView.map((i) => `${i.name} × ${i.qty}`).join(', ')}
                </span>
                <Pill tone={o.status === 'enviado' ? 'warn' : 'accent'}>{o.status === 'enviado' ? 'Esperando a tu vendedor' : o.status === 'confirmado' ? 'Confirmado · preparando' : 'Listo para entregar'}</Pill>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <InvoiceSheet invoice={detail} onClose={() => setDetail(null)} />
    </>
  );
}
