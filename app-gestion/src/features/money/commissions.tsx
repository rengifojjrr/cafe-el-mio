// Comisiones del vendedor: devengadas, por cobrar y pagadas, por producto, por local y por mes.
// Administración ve a todos y marca como pagadas las que ya se pueden pagar.
import { Banknote, Coins, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { PaymentMethod } from '../../data/types';
import { fmtMoney, fmtNumber } from '../../lib/money';
import { fmtDate, fmtMonth, fmtShortDate } from '../../lib/time';
import { PAYMENT_METHOD_LABEL, listCommissions, listPayouts, payCommissions, summarizeCommissions, type CommissionView } from '../../services/money';
import { listSellers } from '../../services/stores';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { BarsChart } from '../../ui/charts';
import { Button, Card, EmptyState, ErrorBox, Loading, Money, PageHeader, Pill, Section, SelectInput, Sheet, Stat, Tabs, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';
import { Facts, METHOD_OPTIONS, TableWrap, monthLabel } from './shared';

const STATUS_LABEL: Record<CommissionView['status'], string> = { devengada: 'Devengada', pagable: 'Por cobrar', pagada: 'Pagada' };
const STATUS_TONE: Record<CommissionView['status'], 'info' | 'accent' | 'ok'> = { devengada: 'info', pagable: 'accent', pagada: 'ok' };

export function CommissionsPage() {
  const { actor } = useLine();
  if (actor.role === 'store') {
    return (
      <EmptyState icon={Lock} title="Las comisiones son de los vendedores">
        Lo que gana tu tienda por cada producto está en Mi tienda y en el Catálogo.
      </EmptyState>
    );
  }
  if (actor.role === 'seller') {
    return (
      <>
        <PageHeader title="Mis comisiones" subtitle="Se devengan cuando se reporta la venta en tu local y las puedes cobrar cuando el local paga su liquidación." />
        <CommissionsView sellerId={actor.userId} />
      </>
    );
  }
  return <AdminCommissions />;
}

function AdminCommissions() {
  const { ctx } = useLine();
  const sellers = useAsync(() => listSellers(ctx), [ctx]);
  const [sellerId, setSellerId] = useState('');
  return (
    <>
      <PageHeader title="Comisiones" subtitle="Las de todos los vendedores. Se devengan al reportarse la venta y se pueden pagar cuando el local paga su liquidación." />
      <div className="mb-5 max-w-md">
        <SelectInput
          label="Vendedor"
          value={sellerId}
          onChange={(e) => setSellerId(e.target.value)}
          options={[{ value: '', label: 'Todos los vendedores' }, ...(sellers.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
        />
      </div>
      <CommissionsView sellerId={sellerId || undefined} admin />
    </>
  );
}

type Dim = 'producto' | 'local' | 'mes';

function CommissionsView({ sellerId, admin }: { sellerId?: string; admin?: boolean }) {
  const { ctx, actor } = useLine();
  const list = useAsync(() => listCommissions(ctx, { sellerId }), [ctx, sellerId]);
  const payouts = useAsync(() => listPayouts(ctx, sellerId), [ctx, sellerId]);
  const [dim, setDim] = useState<Dim>('producto');
  const [paying, setPaying] = useState<{ sellerId: string; name: string; amount: number } | null>(null);
  const summary = useMemo(() => summarizeCommissions(list.data ?? []), [list.data]);

  if (list.error) return <ErrorBox error={list.error} />;
  if (list.loading && !list.data) return <Loading rows={4} />;
  const rows = list.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState icon={Coins} title="Todavía no hay comisiones">
        Cuando un local reporte ventas (por conteo en la visita o desde su cuenta), aquí aparece lo que te toca.
      </EmptyState>
    );
  }
  const t = summary.totals;
  const months = summary.byMonth.slice(-6);
  const sellerMap = new Map(summary.bySeller.map((s) => [s.key, s]));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Devengada" value={t.devengada} format="money" tone="ink" hint="Espera que el local pague" />
        <Stat label="Por cobrar" value={t.pagable} format="money" hint="El local ya pagó" />
        <Stat label="Pagada" value={t.pagada} format="money" tone="ok" hint="Ya te la pagaron" />
        <Stat label="Total" value={t.total} format="money" tone="ink" hint={`${fmtNumber(rows.length)} ventas con comisión`} />
      </div>

      <Section title="Por mes">
        <Card className="p-4">
          <BarsChart
            data={months}
            xKey="key"
            xLabel={(v) => monthLabel(String(v), ctx.now())}
            stacked
            fmt="money0"
            label="Comisiones por mes: devengadas, por cobrar y pagadas"
            series={[
              { key: 'pagada', label: 'Pagada', color: 'var(--chart-4)' },
              { key: 'pagable', label: 'Por cobrar', color: 'var(--chart-1)' },
              { key: 'devengada', label: 'Devengada', color: 'var(--chart-2)' },
            ]}
          />
        </Card>
      </Section>

      {admin && !sellerId ? (
        <Section title="Por vendedor">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {summary.bySeller.map((s) => (
              <li key={s.key} className="glass flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{s.label}</p>
                  <p className="text-sm text-muted">
                    Devengada {fmtMoney(s.devengada)} · pagada {fmtMoney(s.pagada)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="glow tabular text-xl font-bold">{fmtMoney(s.pagable)}</p>
                  <p className="text-sm text-muted">por pagar</p>
                </div>
                {!actor.readOnly ? (
                  <Button variant="primary" icon={Banknote} disabled={s.pagable <= 0} onClick={() => setPaying({ sellerId: s.key, name: s.label, amount: s.pagable })} className="w-full sm:w-auto">
                    Pagar comisiones
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {admin && sellerId && !actor.readOnly ? (
        <div className="mt-4">
          <Button
            variant="primary"
            icon={Banknote}
            disabled={(sellerMap.get(sellerId)?.pagable ?? 0) <= 0}
            onClick={() => {
              const s = sellerMap.get(sellerId);
              if (s) setPaying({ sellerId, name: s.label, amount: s.pagable });
            }}
          >
            Pagar {fmtMoney(sellerMap.get(sellerId)?.pagable ?? 0)} en comisiones
          </Button>
        </div>
      ) : null}

      <Section
        title="Detalle"
        actions={
          <Tabs
            label="Agrupar comisiones"
            value={dim}
            onChange={setDim}
            options={[
              { value: 'producto', label: 'Por producto' },
              { value: 'local', label: 'Por local' },
              { value: 'mes', label: 'Por mes' },
            ]}
          />
        }
      >
        {dim === 'mes' ? (
          <TableWrap label="Comisiones por mes" min={520}>
            <thead>
              <tr>
                <th scope="col">Mes</th>
                <th scope="col" className="num">
                  Devengada
                </th>
                <th scope="col" className="num">
                  Por cobrar
                </th>
                <th scope="col" className="num">
                  Pagada
                </th>
                <th scope="col" className="num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {[...summary.byMonth].reverse().map((m) => (
                <tr key={m.key}>
                  <td className="font-semibold capitalize">{fmtMonth(m.key)}</td>
                  <td className="num">{fmtMoney(m.devengada)}</td>
                  <td className="num">{fmtMoney(m.pagable)}</td>
                  <td className="num">{fmtMoney(m.pagada)}</td>
                  <td className="num font-bold">{fmtMoney(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <TableWrap label={dim === 'producto' ? 'Comisiones por producto' : 'Comisiones por local'} min={420}>
            <thead>
              <tr>
                <th scope="col">{dim === 'producto' ? 'Producto' : 'Local'}</th>
                <th scope="col" className="num">
                  Unidades
                </th>
                <th scope="col" className="num">
                  Comisión
                </th>
              </tr>
            </thead>
            <tbody>
              {(dim === 'producto' ? summary.byProduct : summary.byStore).map((r) => (
                <tr key={r.key}>
                  <td className="font-semibold">{r.label}</td>
                  <td className="num">{fmtNumber(r.qty)}</td>
                  <td className="num font-bold">{fmtMoney(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Últimas ventas con comisión">
        <ul className="glass divide-y divide-line overflow-hidden">
          {rows.slice(0, 15).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.productName}</span>
                <span className="block truncate text-sm text-muted">
                  {fmtShortDate(c.accruedAt)} · {c.storeName}
                  {admin && !sellerId ? ` · ${c.sellerName}` : ''} · {fmtNumber(c.qty)} u.
                </span>
              </span>
              <Pill tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Pill>
              <Money value={c.amount} className="w-24 text-right font-bold" />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Pagos de comisiones">
        {payouts.data && payouts.data.length ? (
          <ul className="glass divide-y divide-line overflow-hidden">
            {payouts.data.map((po) => (
              <li key={po.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  <span className="block font-semibold">
                    {fmtDate(po.at)} · {PAYMENT_METHOD_LABEL[po.method]}
                  </span>
                  <span className="block text-sm text-muted">
                    {fmtNumber(po.commissionIds.length)} comisiones{po.reference ? ` · Ref. ${po.reference}` : ''}
                  </span>
                </span>
                <Money value={po.amount} className="font-bold" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Todavía no hay pagos de comisiones.</p>
        )}
      </Section>

      <PayoutSheet target={paying} onClose={() => setPaying(null)} />
    </>
  );
}

function PayoutSheet({ target, onClose }: { target: { sellerId: string; name: string; amount: number } | null; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [method, setMethod] = useState<PaymentMethod>('zelle');
  const [reference, setReference] = useState('');
  useEffect(() => {
    if (target) {
      setMethod('zelle');
      setReference('');
    }
  }, [target]);
  return (
    <Sheet open={Boolean(target)} onClose={onClose} title="Pagar comisiones">
      {target ? (
        <form
          className="grid grid-cols-[minmax(0,1fr)] gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              async () => {
                await payCommissions(ctx, target.sellerId, { method, reference });
                onClose();
              },
              `Comisiones de ${target.name} marcadas como pagadas.`,
            );
          }}
        >
          <p className="rounded-2xl border border-line bg-surface-2 p-3 text-sm text-muted">
            Se marcan como pagadas todas las comisiones de {target.name} que ya se pueden pagar. Aquí solo se anota el pago: la app no transfiere dinero.
          </p>
          <Facts
            items={[
              ['Vendedor', target.name],
              ['Monto', <Money key="m" value={target.amount} className="font-bold" />],
            ]}
          />
          <SelectInput label="Cómo se pagó" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={METHOD_OPTIONS} />
          <TextInput
            label="Referencia"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={method === 'cheque' ? 'Número de cheque' : method === 'efectivo' ? 'Opcional' : 'Número de confirmación'}
            hint={method === 'efectivo' ? 'En efectivo puede quedar vacía.' : undefined}
          />
          <Button type="submit" variant="primary" icon={Banknote} busy={busy}>
            Marcar como pagadas
          </Button>
        </form>
      ) : null}
    </Sheet>
  );
}
