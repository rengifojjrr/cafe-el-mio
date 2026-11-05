// Cuentas del local: lo que debe, cuándo vence, sus liquidaciones y sus pagos. En palabras de tienda.
import { CalendarClock, CircleAlert, CircleCheck, Receipt, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AGING_LABEL } from '../../domain/money-rules';
import { fmtMoney, round2 } from '../../lib/money';
import { fmtDate, fmtDateTime, fmtRelativeDays } from '../../lib/time';
import { listProducts } from '../../services/catalog';
import { PAYMENT_METHOD_LABEL, listSettlements, storeAccounts, type SettlementView, type StoreAccount } from '../../services/money';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { Card, EmptyState, ErrorBox, Loading, Money, PageHeader, Pill, Section, SelectInput } from '../../ui/kit';
import { SettlementSheet, SettlementStatusPill } from './shared';

export function StoreAccountsPage() {
  const { ctx, actor } = useLine();
  const accounts = useAsync(() => storeAccounts(ctx), [ctx]);
  const [picked, setPicked] = useState<string>('');

  if (accounts.error) return <ErrorBox error={accounts.error} />;
  if (accounts.loading && !accounts.data) return <Loading rows={3} />;
  const list = accounts.data ?? [];

  if (actor.role === 'store') {
    const mine = list[0];
    return (
      <>
        <PageHeader title="Mis cuentas" subtitle="Lo que debes por lo que vendiste, cuándo vence y los pagos que ya hiciste." />
        {mine ? <AccountView account={mine} /> : <NoAccount />}
      </>
    );
  }

  const current = list.find((a) => a.store.id === picked) ?? list[0];
  return (
    <>
      <PageHeader
        title="Cuentas de los locales"
        subtitle={actor.role === 'seller' ? 'Lo que debe cada uno de tus locales, para cobrar en la visita.' : 'Elige un local para ver su cuenta como la ve el local.'}
      />
      {list.length === 0 ? (
        <NoAccount />
      ) : (
        <>
          <div className="mb-5 max-w-md">
            <SelectInput
              label="Local"
              value={current?.store.id ?? ''}
              onChange={(e) => setPicked(e.target.value)}
              options={list.map((a) => ({ value: a.store.id, label: `${a.store.name}${a.overdue > 0 ? ' · vencido' : ''}` }))}
            />
          </div>
          {current ? <AccountView account={current} /> : null}
        </>
      )}
    </>
  );
}

function NoAccount() {
  return (
    <EmptyState icon={Receipt} title="Todavía no hay cuentas">
      Cuando el local reciba producto en consignación y venda, aquí aparece lo que debe y cuándo vence.
    </EmptyState>
  );
}

function AccountView({ account }: { account: StoreAccount }) {
  const { ctx } = useLine();
  const storeId = account.store.id;
  const settlements = useAsync(() => listSettlements(ctx, { storeId }), [ctx, storeId]);
  const products = useAsync(() => listProducts(ctx), [ctx]);
  const [detail, setDetail] = useState<SettlementView | null>(null);
  const names = useMemo(() => new Map((products.data ?? []).map((v) => [v.product.id, v.product.name])), [products.data]);
  const now = ctx.now();
  const list = settlements.data ?? [];
  const open = list.filter((s) => s.balance > 0);
  const nextDue = [...open].sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  const payments = list.flatMap((s) => s.payments.map((pmt) => ({ ...pmt, code: s.code }))).sort((a, b) => b.at.localeCompare(a.at));
  const overdue = round2(open.filter((s) => s.overdue).reduce((a, s) => a + s.balance, 0));

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-muted">
            <Wallet className="h-4 w-4" aria-hidden /> {account.store.name} debe
          </p>
          <p className={`tabular mt-1 text-[2.4rem] leading-none font-bold ${account.balance > 0 ? 'glow' : 'text-ok'}`}>{fmtMoney(account.balance)}</p>
          {account.balance > 0 && nextDue ? (
            <p className="mt-2 text-ink">
              La próxima vence el <strong>{fmtDate(nextDue.dueOn)}</strong> <span className="text-muted">({fmtRelativeDays(nextDue.dueOn, now)})</span>.
            </p>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-ok">
              <CircleCheck className="h-5 w-5" aria-hidden /> Al día: no hay nada pendiente de pago.
            </p>
          )}
          {overdue > 0 ? (
            <p className="mt-3 flex items-start gap-2 rounded-2xl bg-danger-soft p-3 font-semibold text-danger" role="alert">
              <CircleAlert className="mt-0.5 h-5 w-5 flex-none" aria-hidden />
              Hay {fmtMoney(overdue)} vencidos. Ponte al día con tu vendedor o con la oficina.
            </p>
          ) : null}
        </Card>
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-muted">
            <CalendarClock className="h-4 w-4" aria-hidden /> Vendido sin liquidar todavía
          </p>
          <p className="tabular mt-1 text-2xl font-bold text-ink">{fmtMoney(account.unsettledSales)}</p>
          <p className="mt-2 text-sm text-muted">
            {account.nextSettlementOn
              ? `Entra en la liquidación del ${fmtDate(account.nextSettlementOn)}. Hasta entonces no se cobra.`
              : 'Cuando vendas, se liquida cada cierto número de días.'}
          </p>
        </Card>
      </div>

      <p className="mt-4 text-sm text-muted">
        Los pagos se hacen en efectivo, cheque, Zelle o transferencia a la empresa. La app solo los anota: no cobra ni mueve dinero.
      </p>

      <Section title="Liquidaciones">
        {settlements.loading && !settlements.data ? (
          <Loading rows={2} />
        ) : list.length === 0 ? (
          <EmptyState icon={Receipt} title="Todavía no hay liquidaciones">
            La primera llega cuando se cumple el plazo desde tu primera venta.
          </EmptyState>
        ) : (
          <ul className="grid gap-2">
            {list.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setDetail(s)} className="glass flex w-full flex-wrap items-center gap-3 p-4 text-left hover:border-line-strong">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{s.code}</span>
                      <SettlementStatusPill s={s} />
                      {s.balance > 0 ? <Pill>{AGING_LABEL[s.bucket]}</Pill> : null}
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">
                      Ventas del {fmtDate(s.periodFrom)} al {fmtDate(s.periodTo)} · vence el {fmtDate(s.dueOn)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="tabular block font-bold">
                      <Money value={s.balance > 0 ? s.balance : s.amount} />
                    </span>
                    <span className="block text-sm text-muted">{s.balance > 0 ? (s.paid > 0 ? `quedan de ${fmtMoney(s.amount)}` : 'por pagar') : 'pagada'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Pagos que hiciste">
        {payments.length === 0 ? (
          <p className="text-muted">Todavía no hay pagos registrados.</p>
        ) : (
          <ul className="glass divide-y divide-line overflow-hidden">
            {payments.slice(0, 30).map((pmt) => (
              <li key={pmt.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  <span className="block font-semibold">
                    {PAYMENT_METHOD_LABEL[pmt.method]} · {pmt.code}
                  </span>
                  <span className="block text-sm text-muted">
                    {fmtDateTime(pmt.at)}
                    {pmt.reference ? ` · Ref. ${pmt.reference}` : ''}
                  </span>
                </span>
                <Money value={pmt.amount} className="font-bold" />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <SettlementSheet settlement={detail} productName={(id) => names.get(id) ?? 'Producto'} onClose={() => setDetail(null)} />
    </>
  );
}
