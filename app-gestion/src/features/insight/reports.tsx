// Rentabilidad y reportes: lo más vendido, lo más pedido, sell-through y rotación,
// rentabilidad por producto, local, vendedor y zona, locales que no rotan, quiebres y demanda no atendida.
import { AlertTriangle, PackageX, Snail, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { fmtMoney, fmtNumber, fmtPercent } from '../../lib/money';
import { reports, type ProfitRow } from '../../services/analytics';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { RankBars } from '../../ui/charts';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Pill, Section, Stat, Tabs } from '../../ui/kit';
import { AdminOnly, TableWrap } from '../money/shared';

export function ReportsPage() {
  const { actor } = useLine();
  if (actor.role !== 'admin') return <AdminOnly what="los reportes de rentabilidad" />;
  return <Reports />;
}

type Period = '30' | '60' | '90';
type Dim = 'product' | 'store' | 'seller' | 'zone';
const DIM_LABEL: Record<Dim, string> = { product: 'Producto', store: 'Local', seller: 'Vendedor', zone: 'Zona' };

function Reports() {
  const { ctx, config } = useLine();
  const [period, setPeriod] = useState<Period>('90');
  const [dim, setDim] = useState<Dim>('product');
  const data = useAsync(() => reports(ctx, Number(period)), [ctx, period]);
  const r = data.data;

  const rowsFor = (d: Dim): ProfitRow[] => (!r ? [] : d === 'product' ? r.byProduct : d === 'store' ? r.byStore : d === 'seller' ? r.bySeller : r.byZone);
  const totals = (r?.byProduct ?? []).reduce(
    (a, x) => ({ units: a.units + x.units, revenue: a.revenue + x.revenue, margin: a.margin + x.margin }),
    { units: 0, revenue: 0, margin: 0 },
  );

  return (
    <>
      <PageHeader
        title="Rentabilidad y reportes"
        subtitle={`Qué se vende, qué piden los locales y dónde deja margen la línea ${config.name}. Margen = ventas a precio al local − costo por lote − comisiones.`}
        actions={
          <Tabs
            label="Periodo"
            value={period}
            onChange={setPeriod}
            options={[
              { value: '30', label: '30 días' },
              { value: '60', label: '60 días' },
              { value: '90', label: '90 días' },
            ]}
          />
        }
      />
      {data.error ? <ErrorBox error={data.error} /> : null}
      {data.loading && !r ? (
        <Loading rows={4} />
      ) : r ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Unidades vendidas" value={totals.units} icon={TrendingUp} />
            <Stat label="Ventas a precio al local" value={totals.revenue} format="money0" tone="ink" />
            <Stat label="Margen" value={totals.margin} format="money0" />
            <Stat label="Margen sobre ventas" value={totals.revenue > 0 ? totals.margin / totals.revenue : 0} format="percent" tone="ink" />
          </div>

          <div className="mt-7 grid gap-4 lg:grid-cols-2">
            <section>
              <h2 className="mb-3 text-lg font-bold">Lo más vendido</h2>
              <Card className="p-4">
                {r.topSold.length ? (
                  <RankBars data={r.topSold.slice(0, 8)} labelKey="name" valueKey="units" valueLabel="Unidades vendidas" label={`Productos más vendidos en ${period} días`} />
                ) : (
                  <p className="text-muted">Sin ventas en el periodo.</p>
                )}
              </Card>
            </section>
            <section>
              <h2 className="mb-3 text-lg font-bold">Lo que más piden los locales</h2>
              <Card className="p-4">
                {r.topRequested.length ? (
                  <RankBars
                    data={r.topRequested.slice(0, 8)}
                    labelKey="name"
                    valueKey="units"
                    valueLabel="Unidades pedidas"
                    color="var(--chart-2)"
                    label={`Productos más pedidos por los locales en ${period} días`}
                  />
                ) : (
                  <p className="text-muted">Los locales no hicieron pedidos en el periodo.</p>
                )}
              </Card>
            </section>
          </div>

          <Section title="Sell-through y rotación">
            <p className="-mt-1 mb-3 text-sm text-muted">
              Sell-through = vendido ÷ colocado en el periodo. Rotación = días que dura lo que hay en los locales al ritmo de venta actual.
            </p>
            <TableWrap label="Sell-through y rotación por producto" min={600}>
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col" className="num">
                    Colocado
                  </th>
                  <th scope="col" className="num">
                    Vendido
                  </th>
                  <th scope="col">Sell-through</th>
                  <th scope="col" className="num">
                    Rotación
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.sellThrough.map((x) => (
                  <tr key={x.productId}>
                    <td className="font-semibold">{x.name}</td>
                    <td className="num">{fmtNumber(x.placed)}</td>
                    <td className="num">{fmtNumber(x.sold)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.round(x.ratio * 100))}%` }} />
                        </div>
                        <span className="tabular text-sm">{x.placed > 0 ? fmtPercent(x.ratio) : '—'}</span>
                      </div>
                    </td>
                    <td className="num">{x.rotationDays === null ? 'sin ventas' : `${fmtNumber(x.rotationDays)} días`}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Section>

          <Section
            title="Rentabilidad"
            actions={
              <Tabs
                label="Agrupar por"
                value={dim}
                onChange={setDim}
                options={[
                  { value: 'product', label: 'Por producto' },
                  { value: 'store', label: 'Por local' },
                  { value: 'seller', label: 'Por vendedor' },
                  { value: 'zone', label: 'Por zona' },
                ]}
              />
            }
          >
            {rowsFor(dim).length === 0 ? (
              <EmptyState icon={TrendingUp} title="Sin ventas en el periodo" />
            ) : (
              <TableWrap label={`Rentabilidad por ${DIM_LABEL[dim].toLowerCase()}`} min={720}>
                <thead>
                  <tr>
                    <th scope="col">{DIM_LABEL[dim]}</th>
                    <th scope="col" className="num">
                      Unidades
                    </th>
                    <th scope="col" className="num">
                      Ventas
                    </th>
                    <th scope="col" className="num">
                      Costo
                    </th>
                    <th scope="col" className="num">
                      Comisiones
                    </th>
                    <th scope="col" className="num">
                      Margen
                    </th>
                    <th scope="col" className="num">
                      %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rowsFor(dim).map((x) => (
                    <tr key={x.key}>
                      <td className="font-semibold">{x.label}</td>
                      <td className="num">{fmtNumber(x.units)}</td>
                      <td className="num">{fmtMoney(x.revenue)}</td>
                      <td className="num">{fmtMoney(x.cogs)}</td>
                      <td className="num">{fmtMoney(x.commissions)}</td>
                      <td className={`num font-bold ${x.margin < 0 ? 'text-danger' : ''}`}>{fmtMoney(x.margin)}</td>
                      <td className="num">{fmtPercent(x.marginPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Section>

          <div className="mt-7 grid gap-4 lg:grid-cols-2">
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                <Snail className="h-5 w-5 text-warn" aria-hidden /> Locales que no rotan
              </h2>
              {r.nonRotating.length === 0 ? (
                <Card className="p-4">
                  <p className="text-muted">Todos los locales activos vendieron hace poco.</p>
                </Card>
              ) : (
                <ul className="glass divide-y divide-line overflow-hidden">
                  {r.nonRotating.map((x) => (
                    <li key={x.storeId} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{x.name}</span>
                        <span className="block text-sm text-muted">{fmtNumber(x.units)} unidades en consignación</span>
                      </span>
                      <Pill tone="warn">{x.daysSinceSale === null ? 'Sin ventas' : `${x.daysSinceSale} días sin vender`}</Pill>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                <PackageX className="h-5 w-5 text-danger" aria-hidden /> Quiebres de stock y demanda no atendida
              </h2>
              {r.stockouts.length === 0 ? (
                <Card className="p-4">
                  <p className="text-muted">No hay productos sin stock ni pedidos sin atender.</p>
                </Card>
              ) : (
                <ul className="glass divide-y divide-line overflow-hidden">
                  {r.stockouts.map((x) => (
                    <li key={x.productId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{x.name}</span>
                        <span className="block text-sm text-muted">
                          {fmtNumber(x.available)} disponibles · aviso en {fmtNumber(x.threshold)}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {x.available === 0 ? <Pill tone="danger">Agotado</Pill> : x.available <= x.threshold ? <Pill tone="warn">Stock bajo</Pill> : null}
                        {x.unmet > 0 ? <Pill tone="info">{fmtNumber(x.unmet)} sin atender</Pill> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {r.unmetDemand.length ? (
                <p className="mt-3 flex items-start gap-2 text-sm text-muted">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warn" aria-hidden />
                  Demanda no atendida (todo el historial):{' '}
                  {r.unmetDemand
                    .slice(0, 4)
                    .map((u) => `${u.name} ${fmtNumber(u.units)} u. en ${u.stores} local${u.stores === 1 ? '' : 'es'}`)
                    .join('; ')}
                  .
                </p>
              ) : null}
            </section>
          </div>
        </>
      ) : null}
    </>
  );
}
