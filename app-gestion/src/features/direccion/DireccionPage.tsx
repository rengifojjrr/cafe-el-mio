// Dirección: las dos líneas lado a lado, solo lectura. Cada columna sale de su propia base
// y toma los colores de su línea. Nada se suma, salvo la «suma informativa» marcada aparte.
import { Crown, Eye, LogOut, Sigma } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { LineId, Market } from '../../data/types';
import type { Actor } from '../../domain/permissions';
import { lineConfig } from '../../lines/config';
import { fmtMoney, fmtNumber, fmtPercent } from '../../lib/money';
import { monthLabel } from '../money/shared';
import { lineMarkets, lineOverview, type LineOverview } from '../../services/direccion';
import { directorOpenLine, findAccount, getLineDataMode, getSession, leave } from '../../services/session';
import { useAsync } from '../../app/hooks';
import { LineMark } from '../../ui/brand';
import { LinesChart } from '../../ui/charts';
import { Button, ErrorBox, Loading, SampleBadge, Stat } from '../../ui/kit';
import { MarketSelect } from '../red/markets';
import { errorText, useToast } from '../../ui/toast';

const DIRECTOR: Actor = { accountId: 'direccion', userId: 'direccion', role: 'direccion', line: null, name: 'Dirección', readOnly: true };

export function DireccionPage() {
  const nav = useNavigate();
  const acc = useAsync(async () => {
    const s = await getSession();
    return s.accountId ? findAccount(s.accountId) : null;
  }, []);

  useEffect(() => {
    delete document.documentElement.dataset.line;
  }, []);

  if (acc.loading && acc.data === undefined) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <Loading rows={3} />
      </div>
    );
  }
  if (!acc.data || acc.data.role !== 'direccion') {
    return (
      <div className="mx-auto grid min-h-dvh max-w-md place-items-center p-6 text-center">
        <div className="glass p-6">
          <Crown className="mx-auto h-8 w-8 text-accent" aria-hidden />
          <h1 className="mt-2 font-display text-2xl font-semibold">Vista de Dirección</h1>
          <p className="mt-2 text-muted">Esta vista es para los socios del grupo. Entra como Dirección desde la portada.</p>
          <Button variant="primary" className="mt-4" onClick={() => nav('/')}>
            Ir a la portada
          </Button>
        </div>
      </div>
    );
  }
  return <Overview />;
}

function Overview() {
  const nav = useNavigate();
  const { push } = useToast();
  const [market, setMarket] = useState('');
  // Mercados de las dos líneas (Miami, Houston…), por id.
  const markets = useAsync(async () => {
    const lists = await Promise.all([lineMarkets(DIRECTOR, 'tabaco'), lineMarkets(DIRECTOR, 'cafe')]);
    const byId = new Map<string, Market>();
    for (const m of lists.flat()) if (!byId.has(m.id)) byId.set(m.id, m);
    return [...byId.values()];
  }, []);
  const modes = useAsync(async () => ({ tabaco: await getLineDataMode('tabaco'), cafe: await getLineDataMode('cafe') }), []);
  const data = useAsync(async () => {
    const now = new Date();
    const opts = { marketId: market || null };
    const [tabaco, cafe] = await Promise.all([lineOverview(DIRECTOR, 'tabaco', now, opts), lineOverview(DIRECTOR, 'cafe', now, opts)]);
    return { tabaco, cafe };
  }, [market]);

  const open = async (line: LineId) => {
    try {
      await directorOpenLine(line);
      nav(`/${line}`);
    } catch (e) {
      push('error', errorText(e));
    }
  };
  const exit = async () => {
    await leave();
    nav('/');
  };

  const d = data.data;
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 pt-5 lg:px-8">
        <LineMark line="eco" size="sm" />
        {modes.data && (modes.data.tabaco === 'real' || modes.data.cafe === 'real') ? (
          <span className="pill pill-ok">
            Tabaco: {modes.data.tabaco === 'real' ? 'datos reales' : 'de ejemplo'} · Café: {modes.data.cafe === 'real' ? 'datos reales' : 'de ejemplo'}
          </span>
        ) : (
          <SampleBadge />
        )}
        <div className="ml-auto">
          <Button variant="ghost" icon={LogOut} onClick={() => void exit()}>
            Salir
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-32 lg:px-8">
        <h1 className="font-display text-[2.2rem] leading-tight font-semibold sm:text-[3rem]">Las dos líneas, lado a lado</h1>
        <p className="mt-2 max-w-[62ch] text-muted">
          Solo lectura. Cada cifra sale de su propia línea: las cuentas de Tabaco y de Café no se mezclan. La suma de abajo es solo informativa.
        </p>
        {(markets.data ?? []).length > 1 ? (
          <div className="mt-4 max-w-xs">
            <MarketSelect markets={markets.data ?? []} value={market} onChange={setMarket} />
            {market ? <p className="mt-1 text-sm text-muted">Solo lo de los locales de ese mercado; el almacén es de toda la línea y no se cuenta.</p> : null}
          </div>
        ) : null}

        {data.error ? <ErrorBox error={data.error} /> : null}
        {data.loading && !d ? (
          <div className="mt-6">
            <Loading rows={4} />
          </div>
        ) : d ? (
          <>
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <LineColumn o={d.tabaco} onOpen={() => void open('tabaco')} />
              <LineColumn o={d.cafe} onOpen={() => void open('cafe')} />
            </div>
            <InformativeSum a={d.tabaco} b={d.cafe} />
          </>
        ) : null}
      </main>
    </div>
  );
}

function LineColumn({ o, onOpen }: { o: LineOverview; onOpen: () => void }) {
  const cfg = lineConfig(o.line);
  return (
    <section data-line={o.line} className="relative isolate overflow-hidden rounded-[28px] border border-line bg-bg p-5 sm:p-6" aria-label={`Línea ${cfg.name}`}>
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden style={{ background: 'radial-gradient(36rem 20rem at 100% 0%, var(--bg-glow), transparent 65%)' }} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LineMark line={o.line} />
        <span className="text-sm text-muted">
          {fmtNumber(o.activeStores)} de {fmtNumber(o.totalStores)} locales activos
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Stat label="Ventas 30 días" value={o.sales30} format="money0" />
        <Stat label="Margen bruto 30 días" value={o.margin30} format="money0" tone="ink" hint={`${fmtPercent(o.marginPct30)} de las ventas`} />
        <Stat label="Por cobrar" value={o.receivable} format="money0" tone="ink" hint={o.overdue > 0 ? <span className="text-danger">{fmtMoney(o.overdue)} vencido</span> : 'Nada vencido'} />
        <Stat label="Comisiones por pagar" value={o.commissionsPayable} format="money0" tone="ink" hint="Devengadas y pagables" />
        <Stat label="Inventario al costo" value={o.inventoryCost + o.consignmentCost} format="money0" tone="ink" hint={`${fmtMoney(o.consignmentCost)} en locales`} />
        <Stat label="Pedidos pendientes" value={o.pendingOrders} tone="ink" hint={`${fmtNumber(o.consignmentUnits)} u. en consignación`} />
      </div>
      <div className="glass mt-4 p-4">
        <p className="mb-2 text-sm font-medium text-muted">Ventas y margen por mes</p>
        <LinesChart
          data={o.months}
          xKey="month"
          xLabel={(v) => monthLabel(String(v), new Date())}
          area
          height={180}
          label={`Ventas y margen bruto por mes de ${cfg.name}`}
          series={[
            { key: 'revenue', label: 'Ventas', color: 'var(--chart-1)' },
            { key: 'grossMargin', label: 'Margen bruto', color: 'var(--chart-2)' },
          ]}
        />
      </div>
      <Button variant="primary" icon={Eye} className="mt-4 w-full sm:w-auto" onClick={onOpen}>
        Abrir {cfg.name} como Administración
      </Button>
      <p className="mt-2 text-sm text-muted">Se abre en modo solo mirar.</p>
    </section>
  );
}

function InformativeSum({ a, b }: { a: LineOverview; b: LineOverview }) {
  const items: [string, number][] = [
    ['Ventas 30 días', a.sales30 + b.sales30],
    ['Por cobrar', a.receivable + b.receivable],
    ['Inventario al costo', a.inventoryCost + a.consignmentCost + b.inventoryCost + b.consignmentCost],
  ];
  return (
    <section className="mt-6 rounded-[24px] border border-dashed border-line-strong p-5" aria-label="Suma informativa">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Sigma className="h-5 w-5 text-muted" aria-hidden /> Suma informativa
      </h2>
      <p className="mt-1 max-w-[62ch] text-sm text-muted">
        Solo para tener el orden de magnitud del grupo. No es una contabilidad consolidada: cada línea lleva sus cuentas por separado.
      </p>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="tabular text-2xl font-bold text-ink">{fmtMoney(v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
