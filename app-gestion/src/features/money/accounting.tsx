// Contabilidad de la línea (nunca mezclada con la otra): estado de resultados por mes,
// inventario valorado, por cobrar y por pagar, y exportación a CSV.
import { Download, FileSpreadsheet, Info, Landmark, Package, Receipt, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { fmtMoney, fmtNumber, fmtPercent } from '../../lib/money';
import { fmtDate, fmtMonth } from '../../lib/time';
import { balances, inventoryValuation, pnlByMonth, type PnlMonth } from '../../services/analytics';
import { listCommissions, listSettlements } from '../../services/money';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { BarsChart } from '../../ui/charts';
import { Button, Card, ErrorBox, LinkButton, Loading, PageHeader, Section, Stat, Tabs } from '../../ui/kit';
import { useAction } from '../../ui/toast';
import { AdminOnly, AgingCards, TableWrap, csvName, downloadCsv, monthLabel } from './shared';

export function AccountingPage() {
  const { actor } = useLine();
  if (actor.role !== 'admin') return <AdminOnly what="la contabilidad" />;
  return <Accounting />;
}

const PNL_ROWS: { key: keyof PnlMonth; label: string; strong?: boolean; minus?: boolean }[] = [
  { key: 'revenue', label: 'Ventas a precio al local' },
  { key: 'cogs', label: 'Costo de lo vendido (por lote)', minus: true },
  { key: 'commissions', label: 'Comisiones de vendedores', minus: true },
  { key: 'shrink', label: 'Mermas', minus: true },
  { key: 'grossMargin', label: 'Margen bruto', strong: true },
];

function Accounting() {
  const { ctx, config, line, p } = useLine();
  const pnl = useAsync(() => pnlByMonth(ctx, 4), [ctx]);
  const val = useAsync(() => inventoryValuation(ctx), [ctx]);
  const bal = useAsync(() => balances(ctx), [ctx]);
  const { run, busy } = useAction();
  const [invTab, setInvTab] = useState<'producto' | 'local'>('producto');
  const now = ctx.now();

  if (pnl.error) return <ErrorBox error={pnl.error} />;
  const months = pnl.data ?? [];
  const last = months[months.length - 1];
  const prev = months[months.length - 2];

  const exportPnl = () =>
    downloadCsv(csvName(line, 'estado-de-resultados', now), [
      ['Mes', 'Ventas a precio al local', 'Costo de lo vendido', 'Comisiones', 'Mermas', 'Margen bruto', 'Unidades vendidas'],
      ...months.map((m) => [m.month, m.revenue, m.cogs, m.commissions, m.shrink, m.grossMargin, m.units]),
    ]);
  const exportInventory = () => {
    const v = val.data;
    if (!v) return;
    downloadCsv(csvName(line, 'inventario-valorado', now), [
      ['Producto', 'En almacén (u.)', 'En consignación (u.)', 'Costo total'],
      ...v.byProduct.map((x) => [x.name, x.warehouse, x.consignment, x.cost]),
      [],
      ['Local', 'Unidades en consignación', 'Costo'],
      ...v.byStore.map((x) => [x.name, x.units, x.cost]),
    ]);
  };
  const exportReceivables = async () => {
    const list = await listSettlements(ctx, { open: true });
    downloadCsv(csvName(line, 'por-cobrar', now), [
      ['Liquidación', 'Local', 'Emitida', 'Vence', 'Monto', 'Pagado', 'Saldo', 'Días', 'Vencida'],
      ...list.map((s) => [s.code, s.storeName, s.issuedAt.slice(0, 10), s.dueOn, s.amount, s.paid, s.balance, s.daysOld, s.overdue ? 'sí' : 'no']),
    ]);
  };
  const exportCommissions = async () => {
    const list = await listCommissions(ctx);
    downloadCsv(csvName(line, 'comisiones', now), [
      ['Fecha', 'Vendedor', 'Local', 'Producto', 'Unidades', 'Base', 'Comisión', 'Estado'],
      ...list.map((c) => [c.accruedAt.slice(0, 10), c.sellerName, c.storeName, c.productName, c.qty, c.base, c.amount, c.status]),
    ]);
  };

  const marginPct = last && last.revenue > 0 ? last.grossMargin / last.revenue : 0;

  return (
    <>
      <PageHeader
        title="Contabilidad"
        subtitle={`Solo ${config.name}: sus ventas, costos y cuentas no se mezclan con la otra línea. Costos de ejemplo hasta cargar los reales.`}
        actions={
          <LinkButton to={p('contabilidad/contadora')} icon={FileSpreadsheet}>
            Reporte para la contadora
          </LinkButton>
        }
      />

      {pnl.loading && !pnl.data ? (
        <Loading rows={2} />
      ) : last ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label={`Ventas de ${fmtMonth(last.month)}`}
            value={last.revenue}
            format="money0"
            icon={TrendingUp}
            hint={prev && prev.revenue > 0 ? `${fmtMonth(prev.month)}: ${fmtMoney(prev.revenue)}` : undefined}
          />
          <Stat label="Margen bruto del mes" value={last.grossMargin} format="money0" tone="ink" hint={`${fmtPercent(marginPct)} de las ventas`} />
          <Stat label="Inventario al costo" value={(val.data?.warehouseCost ?? 0) + (val.data?.consignmentCost ?? 0)} format="money0" tone="ink" icon={Package} hint="Almacén y consignación" />
          <Stat label="Por cobrar" value={bal.data?.receivable ?? 0} format="money0" tone="ink" icon={Receipt} hint={bal.data ? `+ ${fmtMoney(bal.data.unsettledSales)} sin liquidar` : undefined} />
        </div>
      ) : null}

      <Section
        title="Estado de resultados por mes"
        actions={
          <Button icon={Download} onClick={exportPnl} disabled={!months.length}>
            Exportar CSV
          </Button>
        }
      >
        <Card className="p-4">
          <BarsChart
            data={months}
            xKey="month"
            xLabel={(v) => monthLabel(String(v), now)}
            fmt="money0"
            label="Ventas, costo de lo vendido, comisiones y margen bruto por mes"
            series={[
              { key: 'revenue', label: 'Ventas', color: 'var(--chart-1)' },
              { key: 'cogs', label: 'Costo por lote', color: 'var(--chart-5)' },
              { key: 'commissions', label: 'Comisiones', color: 'var(--chart-3)' },
              { key: 'grossMargin', label: 'Margen bruto', color: 'var(--chart-2)' },
            ]}
          />
        </Card>
        <div className="mt-3">
          <TableWrap label="Estado de resultados por mes" min={560}>
            <thead>
              <tr>
                <th scope="col">Concepto</th>
                {months.map((m) => (
                  <th key={m.month} scope="col" className="num capitalize">
                    {fmtMonth(m.month)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PNL_ROWS.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className={`text-left ${r.strong ? 'font-bold text-ink' : 'font-medium text-ink'}`}>
                    {r.label}
                  </th>
                  {months.map((m) => {
                    const v = Number(m[r.key]);
                    return (
                      <td key={m.month} className={`num ${r.strong ? 'font-bold' : ''} ${r.strong && v < 0 ? 'text-danger' : ''}`}>
                        {r.minus && v > 0 ? `− ${fmtMoney(v)}` : fmtMoney(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th scope="row" className="text-left font-medium text-muted">
                  Margen sobre ventas
                </th>
                {months.map((m) => (
                  <td key={m.month} className="num text-muted">
                    {m.revenue > 0 ? fmtPercent(m.grossMargin / m.revenue) : '—'}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row" className="text-left font-medium text-muted">
                  Unidades vendidas
                </th>
                {months.map((m) => (
                  <td key={m.month} className="num text-muted">
                    {fmtNumber(m.units)}
                  </td>
                ))}
              </tr>
            </tbody>
          </TableWrap>
          <p className="mt-2 text-sm text-muted">El mes en curso va hasta hoy. Las ventas se cuentan al reportarse (por conteo o desde la cuenta del local).</p>
        </div>
      </Section>

      <Section
        title="Inventario valorado"
        actions={
          <div className="flex flex-wrap gap-2">
            <Tabs
              label="Ver inventario"
              value={invTab}
              onChange={setInvTab}
              options={[
                { value: 'producto', label: 'Por producto' },
                { value: 'local', label: 'Por local' },
              ]}
            />
            <Button icon={Download} onClick={exportInventory} disabled={!val.data}>
              CSV
            </Button>
          </div>
        }
      >
        {val.loading && !val.data ? (
          <Loading rows={2} />
        ) : val.data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card className="p-4">
                <p className="text-sm font-medium text-muted">En el almacén</p>
                <p className="glow tabular mt-1 text-2xl font-bold">{fmtMoney(val.data.warehouseCost)}</p>
                <p className="text-sm text-muted">{fmtNumber(val.data.warehouseUnits)} unidades al costo de su lote</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm font-medium text-muted">En consignación en locales</p>
                <p className="glow tabular mt-1 text-2xl font-bold">{fmtMoney(val.data.consignmentCost)}</p>
                <p className="text-sm text-muted">
                  {fmtNumber(val.data.consignmentUnits)} unidades · {fmtMoney(val.data.consignmentAtStorePrice)} a precio al local
                </p>
              </Card>
            </div>
            <p className="mt-3 flex items-start gap-2 text-sm text-muted">
              <Info className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
              La mercancía en los locales sigue siendo de la empresa hasta que se vende: por eso cuenta como inventario y no como venta.
            </p>
            <div className="mt-3">
              {invTab === 'producto' ? (
                <TableWrap label="Inventario por producto" min={520}>
                  <thead>
                    <tr>
                      <th scope="col">Producto</th>
                      <th scope="col" className="num">
                        Almacén
                      </th>
                      <th scope="col" className="num">
                        Consignación
                      </th>
                      <th scope="col" className="num">
                        Costo total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {val.data.byProduct.map((x) => (
                      <tr key={x.productId}>
                        <td className="font-semibold">{x.name}</td>
                        <td className="num">{fmtNumber(x.warehouse)}</td>
                        <td className="num">{fmtNumber(x.consignment)}</td>
                        <td className="num font-bold">{fmtMoney(x.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              ) : (
                <TableWrap label="Inventario en consignación por local" min={420}>
                  <thead>
                    <tr>
                      <th scope="col">Local</th>
                      <th scope="col" className="num">
                        Unidades
                      </th>
                      <th scope="col" className="num">
                        Costo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {val.data.byStore.map((x) => (
                      <tr key={x.storeId}>
                        <td className="font-semibold">{x.name}</td>
                        <td className="num">{fmtNumber(x.units)}</td>
                        <td className="num font-bold">{fmtMoney(x.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </div>
          </>
        ) : null}
      </Section>

      <Section
        title="Por cobrar a locales"
        actions={
          <Button icon={Download} busy={busy} onClick={() => void run(exportReceivables, 'CSV de por cobrar descargado.')}>
            CSV
          </Button>
        }
      >
        {bal.data ? (
          <>
            <AgingCards aging={bal.data.aging} />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Card className="p-4">
                <p className="text-sm font-medium text-muted">Liquidado sin pagar</p>
                <p className="tabular mt-1 text-2xl font-bold">{fmtMoney(bal.data.receivable)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm font-medium text-muted">Vendido, todavía sin liquidar</p>
                <p className="tabular mt-1 text-2xl font-bold">{fmtMoney(bal.data.unsettledSales)}</p>
                <p className="text-sm text-muted">Cobrado en los últimos 30 días: {fmtMoney(bal.data.collectedLast30)}</p>
              </Card>
            </div>
          </>
        ) : (
          <Loading rows={1} />
        )}
      </Section>

      <Section
        title="Por pagar a vendedores"
        actions={
          <Button icon={Download} busy={busy} onClick={() => void run(exportCommissions, 'CSV de comisiones descargado.')}>
            CSV
          </Button>
        }
      >
        {bal.data ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-muted">
                <Landmark className="h-4 w-4" aria-hidden /> Devengado
              </p>
              <p className="tabular mt-1 text-2xl font-bold">{fmtMoney(bal.data.payableAccrued)}</p>
              <p className="text-sm text-muted">Se paga cuando el local pague</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm font-medium text-muted">Listo para pagar</p>
              <p className="glow tabular mt-1 text-2xl font-bold">{fmtMoney(bal.data.payableReady)}</p>
              <p className="text-sm text-muted">El local ya pagó</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm font-medium text-muted">Pagado (histórico)</p>
              <p className="tabular mt-1 text-2xl font-bold text-ok">{fmtMoney(bal.data.paidCommissions)}</p>
              <p className="text-sm text-muted">Al {fmtDate(now)}</p>
            </Card>
          </div>
        ) : (
          <Loading rows={1} />
        )}
      </Section>
    </>
  );
}
