// «Reporte para la contadora» (Contabilidad, administración): ventas por local y periodo con su
// Tax ID, permiso de tabaco y certificado de reventa; consignación y venta en firme por separado.
import { Download, FileText, Landmark } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import type { IsoDate } from '../../data/types';
import { type AccountantRow, type PeriodKind, RESALE_STATUS_TEXT, periodRange } from '../../domain/fiscal';
import { fmtMoney } from '../../lib/money';
import { addDaysToDate, fmtDate, fmtMonth, toIsoDate } from '../../lib/time';
import { accountantReport, type AccountantReport } from '../../services/fiscal';
import { Button, EmptyState, ErrorBox, Loading, PageHeader, Pill, SelectInput, Stat, Tabs, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';
import { AdminOnly, TableWrap, downloadCsv } from '../money/shared';

export function AccountantReportPage() {
  const { actor } = useLine();
  if (actor.role !== 'admin') return <AdminOnly what="el reporte para la contadora" />;
  return <AccountantReportView />;
}

const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: 'mes', label: 'Mes' },
  { value: 'trimestre', label: 'Trimestre' },
  { value: 'anio', label: 'Año' },
  { value: 'rango', label: 'Otro' },
];

function shiftMonths(day: IsoDate, months: number): IsoDate {
  const [y, m] = day.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

const QUARTER = ['ene–mar', 'abr–jun', 'jul–sep', 'oct–dic'];

function resaleText(r: AccountantRow): string {
  return r.resaleCertStatus === 'parcial' ? `Hasta el ${fmtDate(r.resaleCertExpiresOn)}` : RESALE_STATUS_TEXT[r.resaleCertStatus];
}

function AccountantReportView() {
  const { ctx, p, line, config } = useLine();
  const { run, busy } = useAction();
  const today = toIsoDate(ctx.now());
  const [kind, setKind] = useState<PeriodKind>('mes');
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => shiftMonths(today, -i)), [today]);
  const quarters = useMemo(() => Array.from({ length: 6 }, (_, i) => periodRange('trimestre', shiftMonths(today, -3 * i)).from), [today]);
  const years = useMemo(() => [0, 1, 2].map((i) => `${Number(today.slice(0, 4)) - i}-01-01`), [today]);
  const [month, setMonth] = useState(months[0]!);
  const [quarter, setQuarter] = useState(quarters[0]!);
  const [year, setYear] = useState(years[0]!);
  const [from, setFrom] = useState(addDaysToDate(today, -30));
  const [to, setTo] = useState(today);

  const range = kind === 'mes' ? periodRange('mes', month) : kind === 'trimestre' ? periodRange('trimestre', quarter) : kind === 'anio' ? periodRange('anio', year) : { from, to };
  const data = useAsync(() => accountantReport(ctx, range), [ctx, range.from, range.to]);
  const r = data.data;
  const fileBase = `${line}-reporte-contadora-${range.from}-a-${range.to}`;

  const columns = ['Local', 'Mercado', 'Tax ID (EIN)', 'Permiso de tabaco', 'Emitido por', 'Certificado de reventa', 'Vigente en el periodo', 'Consignación vendida', 'De eso, liquidada', 'Venta en firme (sin impuesto)', 'Impuesto', 'Facturas', 'Sin certificado', 'Total de ventas'];
  const rowValues = (x: AccountantRow): (string | number)[] => [
    x.storeName,
    x.marketName,
    x.taxId || 'Sin registrar',
    x.permitNumber || '—',
    x.permitIssuer || '—',
    x.resaleCertNumber || 'No tiene',
    resaleText(x),
    x.consignmentSold,
    x.consignmentSettled,
    x.firmSubtotal,
    x.firmTax,
    x.invoices,
    x.withoutCert,
    x.total,
  ];

  const exportCsv = (rep: AccountantReport) =>
    downloadCsv(`${fileBase}.csv`, [
      [`Reporte para la contadora · ${rep.companyName}`],
      [`Periodo: ${rep.from} a ${rep.to}`],
      [],
      columns,
      ...rep.rows.map(rowValues),
      ['Total', '', '', '', '', '', '', rep.totals.consignmentSold, rep.totals.consignmentSettled, rep.totals.firmSubtotal, rep.totals.firmTax, rep.totals.invoices, rep.totals.withoutCert, rep.totals.total],
    ]);

  const exportPdf = (rep: AccountantReport) =>
    run(async () => {
      const { tablePdf } = await import('../../lib/report-pdf');
      const money = (n: number) => fmtMoney(n);
      const bytes = await tablePdf({
        title: 'Reporte para la contadora',
        subtitle: [`${rep.companyName} · ${config.name}`, `Periodo: ${fmtDate(rep.from)} al ${fmtDate(rep.to)} · generado el ${fmtDate(ctx.now())}`],
        columns: [
          { label: 'Local', width: 15 },
          { label: 'Mercado', width: 6 },
          { label: 'Tax ID', width: 8 },
          { label: 'Permiso', width: 9 },
          { label: 'Emisor', width: 9 },
          { label: 'Cert. reventa', width: 9 },
          { label: 'Vigente', width: 8 },
          { label: 'Consignación', width: 8, align: 'right' },
          { label: 'Liquidada', width: 8, align: 'right' },
          { label: 'En firme', width: 8, align: 'right' },
          { label: 'Impuesto', width: 7, align: 'right' },
          { label: 'Sin cert.', width: 7, align: 'right' },
          { label: 'Total', width: 8, align: 'right' },
        ],
        rows: rep.rows.map((x) => [x.storeName, x.marketName, x.taxId || '—', x.permitNumber || '—', x.permitIssuer || '—', x.resaleCertNumber || 'No tiene', resaleText(x), money(x.consignmentSold), money(x.consignmentSettled), money(x.firmSubtotal), money(x.firmTax), money(x.withoutCert), money(x.total)]),
        totals: ['Total', '', '', '', '', '', '', money(rep.totals.consignmentSold), money(rep.totals.consignmentSettled), money(rep.totals.firmSubtotal), money(rep.totals.firmTax), money(rep.totals.withoutCert), money(rep.totals.total)],
        footnote:
          'Consignación: lo vendido por los locales y reportado en el periodo, a precio al local; «liquidada» es lo que ya entró en una liquidación. En firme: facturas emitidas en el periodo. «Sin cert.»: ventas hechas sin certificado de reventa vigente. La app no calcula impuestos salvo que se configure un %.',
      });
      const blob = new Blob([bytes.slice()], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileBase}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'PDF descargado.');

  return (
    <>
      <PageHeader
        back={{ to: p('contabilidad'), label: 'Contabilidad' }}
        title="Reporte para la contadora"
        subtitle="Ventas por local con su Tax ID, su permiso y su certificado de reventa. La app no calcula impuestos: junta los datos para las declaraciones."
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <Tabs<PeriodKind> label="Periodo del reporte" value={kind} onChange={setKind} options={PERIODS} />
        </div>
        <div className="min-w-0">
          {kind === 'mes' ? (
            <SelectInput label="Mes" value={month} onChange={(e) => setMonth(e.target.value)} options={months.map((m) => ({ value: m, label: fmtMonth(m.slice(0, 7)) }))} />
          ) : kind === 'trimestre' ? (
            <SelectInput
              label="Trimestre"
              value={quarter}
              onChange={(e) => setQuarter(e.target.value)}
              options={quarters.map((q) => ({ value: q, label: `${QUARTER[Math.floor((Number(q.slice(5, 7)) - 1) / 3)]} ${q.slice(0, 4)}` }))}
            />
          ) : kind === 'anio' ? (
            <SelectInput label="Año" value={year} onChange={(e) => setYear(e.target.value)} options={years.map((y) => ({ value: y, label: y.slice(0, 4) }))} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <TextInput label="Desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <TextInput label="Hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {data.error ? <ErrorBox error={data.error} /> : null}
      {data.loading && !r ? <Loading rows={3} /> : null}
      {r ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Ventas del periodo" value={r.totals.total} format="money0" icon={Landmark} hint="Sin impuesto" />
            <Stat label="Consignación" value={r.totals.consignmentSold} format="money0" tone="ink" hint={`${fmtMoney(r.totals.consignmentSettled)} ya liquidado`} />
            <Stat label="En firme" value={r.totals.firmSubtotal} format="money0" tone="ink" hint={`${r.totals.invoices} facturas · impuesto ${fmtMoney(r.totals.firmTax)}`} />
            <Stat label="Sin certificado" value={r.totals.withoutCert} format="money0" tone={r.totals.withoutCert > 0 ? 'warn' : 'ok'} hint="Vendido sin certificado de reventa vigente" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon={Download} onClick={() => exportCsv(r)} disabled={r.rows.length === 0}>
              Descargar CSV
            </Button>
            <Button icon={FileText} busy={busy} onClick={() => void exportPdf(r)} disabled={r.rows.length === 0}>
              Descargar PDF
            </Button>
          </div>
          <p className="mt-2 text-sm text-muted">
            Del {fmtDate(r.from)} al {fmtDate(r.to)}.{' '}
            {r.taxPercent > 0 ? `Impuesto de venta configurado: ${r.taxPercent} %.` : 'Sin % de impuesto configurado: las facturas no llevan impuesto calculado por la app.'}
          </p>
          <div className="mt-3">
            {r.rows.length === 0 ? (
              <EmptyState icon={Landmark} title="Sin ventas en el periodo">
                Elige otro mes o un rango más largo.
              </EmptyState>
            ) : (
              <TableWrap label="Ventas por local para la contadora" min={1180}>
                <thead>
                  <tr>
                    <th scope="col">Local</th>
                    <th scope="col">Tax ID (EIN)</th>
                    <th scope="col">Permiso de tabaco</th>
                    <th scope="col">Certificado de reventa</th>
                    <th scope="col" className="num">
                      Consignación
                    </th>
                    <th scope="col" className="num">
                      Liquidada
                    </th>
                    <th scope="col" className="num">
                      En firme
                    </th>
                    <th scope="col" className="num">
                      Impuesto
                    </th>
                    <th scope="col" className="num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((x) => (
                    <tr key={x.storeId}>
                      <td>
                        <span className="block font-semibold">{x.storeName}</span>
                        <span className="block text-xs text-muted">{x.marketName}</span>
                      </td>
                      <td className="tabular">{x.taxId || <span className="text-muted">Sin registrar</span>}</td>
                      <td>
                        <span className="block tabular">{x.permitNumber || '—'}</span>
                        <span className="block text-xs text-muted">{x.permitIssuer}</span>
                      </td>
                      <td>
                        <span className="block tabular">{x.resaleCertNumber || 'No tiene'}</span>
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          <span className="text-xs text-muted">Vigente: {resaleText(x)}</span>
                          {x.withoutCert > 0 ? <Pill tone="warn">sin certificado · {fmtMoney(x.withoutCert)}</Pill> : null}
                        </span>
                      </td>
                      <td className="num">{fmtMoney(x.consignmentSold)}</td>
                      <td className="num">{fmtMoney(x.consignmentSettled)}</td>
                      <td className="num">{fmtMoney(x.firmSubtotal)}</td>
                      <td className="num">{fmtMoney(x.firmTax)}</td>
                      <td className="num font-bold">{fmtMoney(x.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={4} className="text-left">
                      Total ({r.rows.length} locales)
                    </th>
                    <td className="num font-bold">{fmtMoney(r.totals.consignmentSold)}</td>
                    <td className="num font-bold">{fmtMoney(r.totals.consignmentSettled)}</td>
                    <td className="num font-bold">{fmtMoney(r.totals.firmSubtotal)}</td>
                    <td className="num font-bold">{fmtMoney(r.totals.firmTax)}</td>
                    <td className="num font-bold">{fmtMoney(r.totals.total)}</td>
                  </tr>
                </tfoot>
              </TableWrap>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
