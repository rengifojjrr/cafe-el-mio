// Piezas comunes de cobros, cuentas, comisiones y contabilidad.
import { HandCoins, Lock } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { PaymentMethod } from '../../data/types';
import { AGING_LABEL, type AgingBucket } from '../../domain/money-rules';
import { fmtMoney, fmtNumber } from '../../lib/money';
import { fmtDate, fmtDateTime, fmtMonth, monthKey } from '../../lib/time';
import { toCsv } from '../../services/analytics';
import { PAYMENT_METHOD_LABEL, SETTLEMENT_STATUS_LABEL, recordPayment, type SettlementView } from '../../services/money';
import { useLine } from '../../app/line-context';
import { Button, EmptyState, Money, NumberInput, Pill, SelectInput, Sheet, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';

export const METHOD_OPTIONS = (Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }));

export function AdminOnly({ what }: { what: string }) {
  const { config } = useLine();
  return (
    <EmptyState icon={Lock} title="Solo administración">
      {`${what[0]?.toUpperCase() ?? ''}${what.slice(1)} los ve la oficina de ${config.name}. Si necesitas un dato, escríbele a administración desde Mensajes.`}
    </EmptyState>
  );
}

/** Descarga un CSV (con BOM para que Excel lea bien las tildes). */
export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Etiqueta de un mes para gráficas; el mes en curso se marca para no leer su caída como baja real. */
export function monthLabel(key: string, now: Date): string {
  return key === monthKey(now) ? `${fmtMonth(key).split(' ')[0] ?? key} (en curso)` : fmtMonth(key);
}

export function csvName(line: string, what: string, now: Date): string {
  return `${line}-${what}-${now.toISOString().slice(0, 10)}.csv`;
}

export function SettlementStatusPill({ s }: { s: Pick<SettlementView, 'status' | 'overdue'> }) {
  if (s.status === 'pagada') return <Pill tone="ok">{SETTLEMENT_STATUS_LABEL.pagada}</Pill>;
  if (s.overdue) return <Pill tone="danger">Vencida</Pill>;
  if (s.status === 'parcial') return <Pill tone="warn">{SETTLEMENT_STATUS_LABEL.parcial}</Pill>;
  return <Pill tone="info">{SETTLEMENT_STATUS_LABEL.pendiente}</Pill>;
}

const BUCKET_TONE: Record<AgingBucket, string> = { '0-15': 'text-ok', '16-30': 'text-warn', '30+': 'text-danger' };
const SHORT_BUCKET: Record<AgingBucket, string> = { '0-15': '0–15 días', '16-30': '16–30 días', '30+': '+30 días' };

export function AgingCards({ aging }: { aging: Record<AgingBucket, { amount: number; count: number }> }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3" role="list" aria-label="Antigüedad de lo que se debe">
      {(Object.keys(AGING_LABEL) as AgingBucket[]).map((b) => (
        <div key={b} role="listitem" className="glass p-3 sm:p-4">
          <p className="text-sm font-medium text-muted">
            <span className="sm:hidden">{SHORT_BUCKET[b]}</span>
            <span className="hidden sm:inline">{AGING_LABEL[b]}</span>
          </p>
          <p className={`tabular mt-1 text-base font-bold sm:text-2xl ${BUCKET_TONE[b]}`}>{fmtMoney(aging[b].amount)}</p>
          <p className="mt-0.5 text-xs text-muted sm:text-sm">
            {aging[b].count === 0 ? 'Ninguna' : `${fmtNumber(aging[b].count)} liquidaci${aging[b].count === 1 ? 'ón' : 'ones'}`}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Datos clave en dos columnas, también en el teléfono. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-sm text-muted">{k}</dt>
          <dd className="mt-0.5 font-medium break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Tabla que en el teléfono se desliza dentro de su caja en vez de romper la página. */
export function TableWrap({ children, min = 640, label }: { children: ReactNode; min?: number; label: string }) {
  return (
    <div className="glass overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table className="table" style={{ minWidth: min }}>
        {children}
      </table>
    </div>
  );
}

export function SettlementSheet({
  settlement,
  productName,
  onClose,
  onPay,
}: {
  settlement: SettlementView | null;
  productName: (id: string) => string;
  onClose: () => void;
  onPay?: (s: SettlementView) => void;
}) {
  const s = settlement;
  return (
    <Sheet open={Boolean(s)} onClose={onClose} title={s ? `Liquidación ${s.code}` : 'Liquidación'} wide>
      {s ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <SettlementStatusPill s={s} />
            <Pill>{AGING_LABEL[s.bucket]}</Pill>
          </div>
          <Facts
            items={[
              ['Local', s.storeName],
              ['Periodo', `${fmtDate(s.periodFrom)} al ${fmtDate(s.periodTo)}`],
              ['Emitida', fmtDate(s.issuedAt)],
              ['Vence', fmtDate(s.dueOn)],
              ['Monto', <Money key="m" value={s.amount} />],
              ['Pagado', <Money key="p" value={s.paid} />],
              ['Saldo', <Money key="b" value={s.balance} className={s.balance > 0 ? 'font-bold text-ink' : ''} />],
              ['Días desde que se emitió', fmtNumber(s.daysOld)],
            ]}
          />
          <div>
            <h3 className="mb-2 font-bold">Lo vendido</h3>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {s.lines.map((l) => (
                <li key={`${l.productId}-${l.unitPrice}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-semibold">{productName(l.productId)}</span>
                    <span className="tabular block text-sm text-muted">
                      {fmtNumber(l.qty)} × {fmtMoney(l.unitPrice)} (precio al local)
                    </span>
                  </span>
                  <span className="tabular font-bold">{fmtMoney(l.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 font-bold">Pagos registrados</h3>
            {s.payments.length === 0 ? (
              <p className="text-muted">Todavía no hay pagos registrados.</p>
            ) : (
              <ul className="grid gap-2">
                {s.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface-2 px-4 py-3">
                    <span>
                      <span className="block font-semibold">{PAYMENT_METHOD_LABEL[p.method]}</span>
                      <span className="block text-sm text-muted">
                        {fmtDateTime(p.at)}
                        {p.reference ? ` · Ref. ${p.reference}` : ''}
                      </span>
                    </span>
                    <Money value={p.amount} className="font-bold" />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {onPay && s.balance > 0 ? (
            <Button variant="primary" icon={HandCoins} onClick={() => onPay(s)}>
              Registrar pago
            </Button>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/** Registrar un pago: solo el apunte. La app no cobra ni mueve dinero. */
export function PaymentSheet({ settlement, onClose }: { settlement: SettlementView | null; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('zelle');
  const [reference, setReference] = useState('');

  useEffect(() => {
    if (settlement) {
      setAmount(settlement.balance);
      setMethod('zelle');
      setReference('');
    }
  }, [settlement]);

  const s = settlement;
  return (
    <Sheet open={Boolean(s)} onClose={onClose} title="Registrar pago">
      {s ? (
        <form
          className="grid grid-cols-[minmax(0,1fr)] gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              async () => {
                await recordPayment(ctx, s.id, { amount: amount === '' ? 0 : amount, method, reference });
                onClose();
              },
              `Pago registrado en ${s.code}.`,
            );
          }}
        >
          <p className="rounded-2xl border border-line bg-surface-2 p-3 text-sm text-muted">
            Aquí solo se anota el pago que ya hizo {s.storeName}. La app no cobra, no se conecta a bancos y no mueve dinero.
          </p>
          <Facts
            items={[
              ['Liquidación', s.code],
              ['Saldo', <Money key="b" value={s.balance} className="font-bold" />],
            ]}
          />
          <NumberInput label="Monto pagado (USD)" value={amount} onValue={setAmount} min={0.01} step={0.01} max={s.balance} required hint="Puede ser un pago parcial." />
          <SelectInput label="Cómo pagó" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={METHOD_OPTIONS} />
          <TextInput
            label="Referencia"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={method === 'cheque' ? 'Número de cheque' : method === 'efectivo' ? 'Opcional' : 'Número de confirmación'}
            hint={method === 'efectivo' ? 'En efectivo puede quedar vacía.' : 'Número de cheque o de confirmación.'}
          />
          <Button type="submit" variant="primary" icon={HandCoins} busy={busy}>
            Guardar pago
          </Button>
        </form>
      ) : null}
    </Sheet>
  );
}
