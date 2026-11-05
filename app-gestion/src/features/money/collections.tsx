// Cobros (administración): antigüedad de lo que se debe, cuenta de cada local, liquidaciones y pagos.
import { CalendarClock, FileStack, HandCoins, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { aging } from '../../domain/money-rules';
import { round2 } from '../../lib/money';
import { addDays, daysBetween, fmtDate, fmtRelativeDays } from '../../lib/time';
import { listProducts } from '../../services/catalog';
import { generateDueSettlements, generateSettlement, listSettlements, storeAccounts, type SettlementView } from '../../services/money';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { Button, EmptyState, ErrorBox, Loading, Money, PageHeader, Pill, Section, Stat, Tabs } from '../../ui/kit';
import { useAction } from '../../ui/toast';
import { AdminOnly, AgingCards, PaymentSheet, SettlementSheet, SettlementStatusPill } from './shared';

export function CollectionsPage() {
  const { actor } = useLine();
  if (actor.role !== 'admin') return <AdminOnly what="los cobros de todos los locales" />;
  return <Collections />;
}

type TabKey = 'cobrar' | 'vencidas' | 'pagadas';

function Collections() {
  const { ctx, actor, p, config } = useLine();
  const accounts = useAsync(() => storeAccounts(ctx), [ctx]);
  const settlements = useAsync(() => listSettlements(ctx), [ctx]);
  const products = useAsync(() => listProducts(ctx, { includeInactive: true }), [ctx]);
  const { run, busy } = useAction();
  const [tab, setTab] = useState<TabKey>('cobrar');
  const [detail, setDetail] = useState<SettlementView | null>(null);
  const [paying, setPaying] = useState<SettlementView | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [allAccounts, setAllAccounts] = useState(false);
  const now = ctx.now();

  const names = useMemo(() => new Map((products.data ?? []).map((v) => [v.product.id, v.product.name])), [products.data]);
  const list = settlements.data ?? [];
  const byTab: Record<TabKey, SettlementView[]> = {
    cobrar: list.filter((s) => s.balance > 0 && !s.overdue),
    vencidas: list.filter((s) => s.overdue),
    pagadas: list.filter((s) => s.balance <= 0),
  };
  const receivable = round2(list.reduce((a, s) => a + s.balance, 0));
  const overdue = round2(byTab.vencidas.reduce((a, s) => a + s.balance, 0));
  const since = addDays(now, -30);
  const collected30 = round2(list.flatMap((s) => s.payments).filter((x) => x.at >= since).reduce((a, x) => a + x.amount, 0));
  const unsettled = round2((accounts.data ?? []).reduce((a, x) => a + x.unsettledSales, 0));
  const due = (accounts.data ?? []).filter((a) => a.unsettledReports > 0 && (!a.nextSettlementOn || daysBetween(now, a.nextSettlementOn) <= 0)).length;
  const withActivity = (accounts.data ?? []).filter((a) => a.balance > 0 || a.unsettledSales > 0);
  const shownAccounts = allAccounts ? (accounts.data ?? []) : withActivity;
  const hiddenAccounts = (accounts.data?.length ?? 0) - withActivity.length;

  if (settlements.error) return <ErrorBox error={settlements.error} />;

  return (
    <>
      <PageHeader
        title="Cobros"
        subtitle={`Lo que debe cada local de ${config.name} y sus liquidaciones. Aquí solo se registran los pagos: la app no mueve dinero.`}
        actions={
          actor.readOnly ? null : (
            <Button
              variant="primary"
              icon={FileStack}
              busy={busy && settlingId === 'todas'}
              onClick={() => {
                setSettlingId('todas');
                void run(
                  () => generateDueSettlements(ctx),
                  (n) => (n === 0 ? 'No había liquidaciones pendientes por generar.' : `${n} liquidaci${n === 1 ? 'ón generada' : 'ones generadas'}.`),
                ).finally(() => setSettlingId(null));
              }}
            >
              Generar liquidaciones pendientes{due ? ` (${due})` : ''}
            </Button>
          )
        }
      />

      {settlements.loading && !settlements.data ? (
        <Loading rows={3} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Por cobrar" value={receivable} format="money" icon={Receipt} />
            <Stat label="Vencido" value={overdue} format="money" tone={overdue > 0 ? 'danger' : 'ink'} hint={byTab.vencidas.length ? `${byTab.vencidas.length} liquidaciones` : 'Nada vencido'} />
            <Stat label="Vendido sin liquidar" value={unsettled} format="money" tone="ink" hint="Se liquida en la próxima fecha" />
            <Stat label="Cobrado en 30 días" value={collected30} format="money" tone="ok" />
          </div>

          <Section title="Antigüedad de lo que se debe">
            <AgingCards aging={aging(list, now)} />
          </Section>
        </>
      )}

      <Section title="Cuenta de cada local">
        {accounts.loading && !accounts.data ? (
          <Loading rows={3} />
        ) : accounts.data && accounts.data.length ? (
          <>
          <ul className="glass divide-y divide-line overflow-hidden">
            {shownAccounts.map((a) => (
              <li key={a.store.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={p(`locales/${a.store.id}`)} className="font-bold text-ink underline-offset-4 hover:underline">
                      {a.store.name}
                    </Link>
                    {a.overdue > 0 ? <Pill tone="danger">Vencido {fmtMoneyShort(a.overdue)}</Pill> : null}
                    {a.store.status !== 'activo' ? <Pill>{a.store.status === 'pausado' ? 'Pausado' : a.store.status}</Pill> : null}
                  </div>
                  <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted">Saldo</dt>
                      <dd className="font-semibold">
                        <Money value={a.balance} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Vendido sin liquidar</dt>
                      <dd className="font-semibold">
                        <Money value={a.unsettledSales} />
                      </dd>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <dt className="text-muted">Próxima liquidación</dt>
                      <dd className="font-semibold">
                        {a.nextSettlementOn ? (
                          <>
                            {fmtDate(a.nextSettlementOn)} <span className="font-normal text-muted">({fmtRelativeDays(a.nextSettlementOn, now)})</span>
                          </>
                        ) : (
                          'Sin ventas todavía'
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
                {actor.readOnly ? null : (
                  <Button
                    icon={CalendarClock}
                    disabled={a.unsettledReports === 0}
                    busy={busy && settlingId === a.store.id}
                    onClick={() => {
                      setSettlingId(a.store.id);
                      void run(() => generateSettlement(ctx, a.store.id), (s) => `Liquidación ${s.code} generada para ${a.store.name}.`).finally(() => setSettlingId(null));
                    }}
                  >
                    Liquidar ahora
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {hiddenAccounts > 0 ? (
            <Button variant="ghost" className="mt-2" onClick={() => setAllAccounts((v) => !v)} aria-expanded={allAccounts}>
              {allAccounts ? 'Mostrar solo los que tienen saldo o ventas' : `Mostrar también los ${hiddenAccounts} locales sin saldo ni ventas`}
            </Button>
          ) : null}
          </>
        ) : (
          <EmptyState icon={Receipt} title="Todavía no hay locales con cuenta">
            Cuando un local firma y recibe producto, aquí aparece lo que vende y lo que debe.
          </EmptyState>
        )}
      </Section>

      <Section
        title="Liquidaciones"
        actions={
          <Tabs
            label="Filtrar liquidaciones"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'cobrar', label: 'Por cobrar', count: byTab.cobrar.length },
              { value: 'vencidas', label: 'Vencidas', count: byTab.vencidas.length },
              { value: 'pagadas', label: 'Pagadas', count: byTab.pagadas.length },
            ]}
          />
        }
      >
        {byTab[tab].length === 0 ? (
          <EmptyState icon={HandCoins} title={tab === 'vencidas' ? 'Nada vencido' : tab === 'pagadas' ? 'Todavía no hay liquidaciones pagadas' : 'Nada por cobrar'}>
            {tab === 'vencidas' ? 'Ningún local tiene pagos atrasados.' : 'Genera las liquidaciones pendientes para cobrar lo vendido.'}
          </EmptyState>
        ) : (
          <ul className="grid gap-2">
            {byTab[tab].slice(0, 60).map((s) => (
              <li key={s.id}>
                <div className="glass grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <button type="button" className="min-w-0 text-left" onClick={() => setDetail(s)} aria-label={`Ver liquidación ${s.code} de ${s.storeName}`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{s.storeName}</span>
                      <SettlementStatusPill s={s} />
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">
                      {s.code} · emitida el {fmtDate(s.issuedAt)} · vence el {fmtDate(s.dueOn)}
                    </span>
                  </button>
                  <div className="flex items-baseline justify-between gap-2 sm:block sm:text-right">
                    <span className="text-sm text-muted sm:order-2 sm:block">{s.balance > 0 ? (s.paid > 0 ? `saldo de ${fmtMoneyShort(s.amount)}` : 'saldo') : 'pagada'}</span>
                    <span className="tabular block text-lg font-bold">
                      <Money value={s.balance > 0 ? s.balance : s.amount} />
                    </span>
                  </div>
                  {s.balance > 0 && !actor.readOnly ? (
                    <Button variant="secondary" icon={HandCoins} onClick={() => setPaying(s)}>
                      Registrar pago
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <SettlementSheet
        settlement={detail}
        productName={(id) => names.get(id) ?? 'Producto'}
        onClose={() => setDetail(null)}
        onPay={
          actor.readOnly
            ? undefined
            : (s) => {
                setDetail(null);
                setPaying(s);
              }
        }
      />
      <PaymentSheet settlement={paying} onClose={() => setPaying(null)} />
    </>
  );
}

function fmtMoneyShort(n: number): string {
  return n.toLocaleString('es-US', { style: 'currency', currency: 'USD' });
}
