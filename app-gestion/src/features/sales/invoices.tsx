// Facturas de venta en firme: su estado, la fila de una lista, el detalle con el PDF (factura o
// recibo), compartirlo (WhatsApp, correo o el menú del teléfono) y registrar un pago (solo el apunte).
import { Download, FileText, HandCoins, Mail, MessageCircle, Share2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { PaymentMethod } from '../../data/types';
import { AGING_LABEL } from '../../domain/money-rules';
import { type InvoicePdfData, downloadPdf, invoicePdf, mailtoLink, pdfFileName, sharePdf, whatsappLink } from '../../lib/invoice-pdf';
import { fmtMoney } from '../../lib/money';
import { fmtDate, fmtDateTime } from '../../lib/time';
import { useLine } from '../../app/line-context';
import { INVOICE_ORIGIN_LABEL, type InvoiceDocument, type InvoiceView, invoiceDocument, needsReference, recordInvoicePayment } from '../../services/invoices';
import { PAYMENT_METHOD_LABEL } from '../../services/money';
import { Button, Money, NumberInput, Pill, SelectInput, Sheet, TextInput } from '../../ui/kit';
import { errorText, useAction, useToast } from '../../ui/toast';
import { Facts, METHOD_OPTIONS } from '../money/shared';

export function InvoiceStatusPill({ inv }: { inv: Pick<InvoiceView, 'status' | 'overdue'> }) {
  if (inv.status === 'pagada') return <Pill tone="ok">Pagada</Pill>;
  if (inv.overdue) return <Pill tone="danger">Vencida</Pill>;
  if (inv.status === 'parcial') return <Pill tone="warn">Pago parcial</Pill>;
  return <Pill tone="info">Por cobrar</Pill>;
}

/** Una factura en una lista: toca para ver el detalle; «Registrar pago» si se puede. */
export function InvoiceItem({ inv, showStore, onOpen, onPay }: { inv: InvoiceView; showStore?: boolean; onOpen: () => void; onPay?: () => void }) {
  return (
    <div className="glass grid grid-cols-[minmax(0,1fr)] gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center" data-invoice={inv.code}>
      <button type="button" className="min-w-0 text-left" onClick={onOpen} aria-label={`Ver factura ${inv.code}${showStore ? ` de ${inv.storeName}` : ''}`}>
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{showStore ? inv.storeName : `Factura ${inv.code}`}</span>
          <InvoiceStatusPill inv={inv} />
          {inv.withoutResaleCert ? <Pill tone="warn">Sin certificado de reventa</Pill> : null}
        </span>
        <span className="mt-0.5 block text-sm text-muted">
          {showStore ? `${inv.code} · ` : ''}
          {fmtDate(inv.issuedAt)} · {inv.balance > 0 ? `vence el ${fmtDate(inv.dueOn)}` : 'pagada'} · {INVOICE_ORIGIN_LABEL[inv.origin]}
        </span>
      </button>
      <div className="flex items-baseline justify-between gap-2 sm:block sm:text-right">
        <span className="text-sm text-muted sm:order-2 sm:block">{inv.balance > 0 ? (inv.paid > 0 ? `queda de ${fmtMoney(inv.total)}` : 'por cobrar') : 'total'}</span>
        <span className="tabular block text-lg font-bold">
          <Money value={inv.balance > 0 ? inv.balance : inv.total} />
        </span>
      </div>
      {onPay && inv.balance > 0 ? (
        <Button icon={HandCoins} onClick={onPay}>
          Registrar pago
        </Button>
      ) : null}
    </div>
  );
}

/** Los datos del PDF a partir de la factura (en palabras de tienda). */
export function pdfData(doc: InvoiceDocument, line: string): InvoicePdfData {
  const inv = doc.invoice;
  const totals: [string, string][] = [['Subtotal', fmtMoney(inv.subtotal)]];
  if (inv.tax > 0) totals.push([`Impuesto de venta (${inv.taxPercent} %)`, fmtMoney(inv.tax)]);
  totals.push(['Total', fmtMoney(inv.total)]);
  if (inv.paid > 0) totals.push(['Pagado', fmtMoney(inv.paid)]);
  if (inv.balance > 0 && inv.paid > 0) totals.push(['Saldo', fmtMoney(inv.balance)]);
  const cert = doc.store.resaleCert;
  const notes = [
    inv.withoutResaleCert
      ? 'El local no tenía certificado de reventa vigente al facturar: pedirle el nuevo.'
      : `Compra para reventa: certificado de reventa ${cert?.number ?? ''} vigente.`,
  ];
  if (line === 'tabaco') notes.push('Venta entre empresas. El local vende tabaco solo a mayores de 21 años, con identificación.');
  return {
    title: `${inv.balance > 0 ? 'Factura' : 'Factura y recibo'} ${inv.code}`,
    company: doc.companyName,
    warehouse: doc.warehouseName,
    issued: fmtDate(inv.issuedAt),
    due: fmtDate(inv.dueOn),
    terms: doc.terms,
    store: { name: doc.store.name, address: `${doc.store.address}, ${doc.store.city}`, manager: doc.store.managerName, phone: doc.store.phone, taxId: doc.store.taxId },
    lines: doc.lines.map((l) => ({ name: l.name, qty: l.qtyText, price: l.priceText, amount: fmtMoney(l.amount) })),
    totals,
    payment: doc.paymentText,
    notes,
  };
}

/** «Factura en PDF» y «Compartir»: con el menú del teléfono si deja mandar archivos; si no, WhatsApp y correo. */
export function InvoiceDocButtons({ invoiceId, code }: { invoiceId: string; code: string }) {
  const { ctx, line } = useLine();
  const { push } = useToast();
  const [busy, setBusy] = useState<'pdf' | 'share' | null>(null);
  const [fallback, setFallback] = useState<{ text: string; subject: string; email: string } | null>(null);

  const build = async () => {
    const doc = await invoiceDocument(ctx, invoiceId);
    const bytes = await invoicePdf(pdfData(doc, line));
    const inv = doc.invoice;
    const text = `${doc.companyName}: factura ${inv.code} para ${doc.store.name}. Total ${fmtMoney(inv.total)}. ${doc.paymentText}.`;
    return { doc, bytes, name: pdfFileName(inv.code, doc.store.name), text };
  };
  const run = async (kind: 'pdf' | 'share') => {
    setBusy(kind);
    try {
      const b = await build();
      if (kind === 'pdf') {
        downloadPdf(b.bytes, b.name);
        push('ok', `Factura ${code} lista en PDF.`);
      } else if (!(await sharePdf(b.bytes, b.name, b.text))) {
        // Sin menú para compartir archivos: se descarga y se ofrece WhatsApp o correo.
        downloadPdf(b.bytes, b.name);
        setFallback({ text: b.text, subject: `Factura ${b.doc.invoice.code} · ${b.doc.companyName}`, email: b.doc.store.email });
      }
    } catch (e) {
      push('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button icon={FileText} busy={busy === 'pdf'} onClick={() => void run('pdf')}>
          Factura en PDF
        </Button>
        <Button variant="ghost" icon={Share2} busy={busy === 'share'} onClick={() => void run('share')}>
          Compartir
        </Button>
      </div>
      {fallback ? (
        <div className="grid gap-2 rounded-2xl border border-line bg-surface-2 p-3 text-sm">
          <p className="flex items-center gap-2 text-muted">
            <Download className="h-4 w-4 flex-none" aria-hidden /> El PDF se descargó. Mándalo por WhatsApp o por correo y adjúntalo.
          </p>
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-secondary" href={whatsappLink(fallback.text)} target="_blank" rel="noreferrer">
              <MessageCircle aria-hidden /> WhatsApp
            </a>
            <a className="btn btn-secondary" href={mailtoLink(fallback.email, fallback.subject, fallback.text)}>
              <Mail aria-hidden /> Correo
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** El detalle de una factura: lo que se llevó, los pagos y su PDF. */
export function InvoiceSheet({ invoice, onClose, onPay }: { invoice: InvoiceView | null; onClose: () => void; onPay?: (inv: InvoiceView) => void }) {
  const inv = invoice;
  return (
    <Sheet open={Boolean(inv)} onClose={onClose} title={inv ? `Factura ${inv.code}` : 'Factura'} wide>
      {inv ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <InvoiceStatusPill inv={inv} />
            {inv.balance > 0 ? <Pill>{AGING_LABEL[inv.bucket]}</Pill> : null}
            <Pill>{INVOICE_ORIGIN_LABEL[inv.origin]}</Pill>
            {inv.withoutResaleCert ? <Pill tone="warn">Sin certificado de reventa</Pill> : null}
          </div>
          <Facts
            items={[
              ['Local', inv.storeName],
              ['Vendedor', inv.sellerName],
              ['Emitida', fmtDate(inv.issuedAt)],
              ['Vence', `${fmtDate(inv.dueOn)}${inv.creditDays ? ` (${inv.creditDays} días)` : ' (de contado)'}`],
              ['Subtotal', <Money key="s" value={inv.subtotal} />],
              ...(inv.tax > 0 ? ([[`Impuesto (${inv.taxPercent} %)`, <Money key="t" value={inv.tax} />]] as [string, ReactNode][]) : []),
              ['Total', <Money key="tt" value={inv.total} className="font-bold" />],
              ['Saldo', <Money key="b" value={inv.balance} className={inv.balance > 0 ? 'font-bold text-ink' : ''} />],
            ]}
          />
          <div>
            <h3 className="mb-2 font-bold">Lo que se llevó</h3>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {inv.lines.map((l, i) => (
                <li key={`${l.productId}-${l.pack}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-semibold">{l.name}</span>
                    <span className="tabular block text-sm text-muted">
                      {inv.qtyTexts[i]} × {fmtMoney(l.unitPrice)}
                    </span>
                  </span>
                  <span className="tabular font-bold">{fmtMoney(l.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 font-bold">Pagos registrados</h3>
            {inv.payments.length === 0 ? (
              <p className="text-muted">Todavía no hay pagos registrados.</p>
            ) : (
              <ul className="grid gap-2">
                {inv.payments.map((p) => (
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
          <InvoiceDocButtons invoiceId={inv.id} code={inv.code} />
          {onPay && inv.balance > 0 ? (
            <Button variant="primary" icon={HandCoins} onClick={() => onPay(inv)}>
              Registrar pago
            </Button>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/** Registrar un pago de una factura: solo el apunte. La app no cobra ni mueve dinero. */
export function InvoicePaymentSheet({ invoice, onClose }: { invoice: InvoiceView | null; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('efectivo');
  const [reference, setReference] = useState('');

  useEffect(() => {
    if (invoice) {
      setAmount(invoice.balance);
      setMethod('efectivo');
      setReference('');
    }
  }, [invoice]);

  const inv = invoice;
  return (
    <Sheet open={Boolean(inv)} onClose={onClose} title="Registrar pago">
      {inv ? (
        <form
          className="grid grid-cols-[minmax(0,1fr)] gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await recordInvoicePayment(ctx, inv.id, { amount: amount === '' ? 0 : amount, method, reference });
              onClose();
            }, `Pago registrado en ${inv.code}.`);
          }}
        >
          <p className="rounded-2xl border border-line bg-surface-2 p-3 text-sm text-muted">
            Aquí solo se anota el pago que ya hizo {inv.storeName}. La app no cobra, no se conecta a bancos y no mueve dinero.
          </p>
          <Facts
            items={[
              ['Factura', inv.code],
              ['Saldo', <Money key="b" value={inv.balance} className="font-bold" />],
            ]}
          />
          <NumberInput label="Monto pagado (USD)" value={amount} onValue={setAmount} min={0.01} step={0.01} max={inv.balance} required hint="Puede ser un pago parcial." />
          <SelectInput label="Cómo pagó" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={METHOD_OPTIONS} />
          <TextInput
            label="Referencia"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={method === 'cheque' ? 'Número de cheque' : needsReference(method) ? 'Número de confirmación' : 'Opcional'}
            hint={method === 'tarjeta' ? 'Se cobra aparte, en el datáfono. Nunca escribas el número de la tarjeta.' : needsReference(method) ? 'Número de cheque o de confirmación.' : 'En efectivo puede quedar vacía.'}
          />
          <Button type="submit" variant="primary" icon={HandCoins} busy={busy}>
            Guardar pago
          </Button>
        </form>
      ) : null}
    </Sheet>
  );
}
