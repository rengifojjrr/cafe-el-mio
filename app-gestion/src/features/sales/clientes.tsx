// «Clientes» (Administración): los locales, las personas que compran a su nombre y el almacén (la
// venta de mostrador), cada uno con lo que compró en firme. Las personas tienen su ficha con el
// historial de compras; los locales siguen en «Locales» con todo lo suyo.
import { Pencil, Store as StoreIcon, UserRound, Warehouse, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAsync, useBackState } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import type { Store } from '../../data/types';
import { CLASES, CLASE_PLURAL, type ClaseCliente, claveNombre } from '../../domain/clientes';
import { fmtMoney } from '../../lib/money';
import { fmtDate } from '../../lib/time';
import { type ClienteFila, editarPersona, listarClientes } from '../../services/clientes';
import { type InvoiceView, listInvoices } from '../../services/invoices';
import { Button, Card, EmptyState, ErrorBox, LinkButton, Loading, PageHeader, Sheet, Tabs, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';
import { RoleGate } from '../common';
import { InvoiceItem, InvoiceSheet } from './invoices';

export function ClientesPage() {
  return (
    <RoleGate roles={['admin']} message="Los clientes que no son locales (personas y mostrador) los ve Administración.">
      <Clientes />
    </RoleGate>
  );
}

const ICONO: Record<ClaseCliente, typeof StoreIcon> = { local: StoreIcon, persona: UserRound, almacen: Warehouse };

function Clientes() {
  const { ctx, p } = useLine();
  const data = useAsync(() => listarClientes(ctx), [ctx]);
  const [tab, setTab] = useBackState<ClaseCliente>(`clientes-tab:${ctx.actor.accountId}`, 'persona');
  const [q, setQ] = useState('');
  // Por id: después de cambiar el nombre, la ficha se ve con lo nuevo.
  const [abiertoId, setAbiertoId] = useState<string | null>(null);

  if (data.error) return <ErrorBox error={data.error} />;
  if (data.loading && !data.data) return <Loading rows={4} />;
  const c = data.data!;
  const term = claveNombre(q);
  const filas = c.porClase[tab].filter((f) => !term || claveNombre(`${f.store.name} ${f.store.phone}`).includes(term));
  const abierto = abiertoId ? CLASES.flatMap((k) => c.porClase[k]).find((f) => f.store.id === abiertoId) : undefined;

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Locales, personas y el almacén (mostrador): lo que compró cada uno en firme (venta rápida y pedidos entregados)."
        actions={
          <LinkButton to={p('venta-rapida')} icon={Zap}>
            Venta rápida
          </LinkButton>
        }
      />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="totales-clientes">
        {CLASES.map((k) => {
          const t = c.totales[k];
          const Icon = ICONO[k];
          return (
            <Card key={k} className="p-4" aria-label={`Total ${CLASE_PLURAL[k]}`}>
              <p className="flex items-center gap-2 text-sm text-muted">
                <Icon className="h-4 w-4" aria-hidden /> {CLASE_PLURAL[k]}
              </p>
              <p className="tabular text-2xl font-bold text-ink">{fmtMoney(t.total)}</p>
              <p className="text-sm text-muted">
                {k === 'almacen' ? `${t.compras} ${t.compras === 1 ? 'venta' : 'ventas'}` : `${t.clientes} ${t.clientes === 1 ? 'cliente' : 'clientes'} · ${t.compras} ${t.compras === 1 ? 'compra' : 'compras'}`}
                {t.saldo > 0 ? ` · por cobrar ${fmtMoney(t.saldo)}` : ''}
              </p>
            </Card>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Tabs<ClaseCliente>
          label="Clientes por tipo"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'persona', label: CLASE_PLURAL.persona, count: c.totales.persona.clientes },
            { value: 'almacen', label: CLASE_PLURAL.almacen },
            { value: 'local', label: CLASE_PLURAL.local, count: c.totales.local.clientes },
          ]}
        />
      </div>
      {tab !== 'almacen' ? (
        <div className="mb-3 max-w-md">
          <TextInput label="Buscar" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'persona' ? 'Nombre o teléfono' : 'Nombre del local'} />
        </div>
      ) : null}

      {filas.length === 0 ? (
        tab === 'persona' ? (
          <EmptyState icon={UserRound} title={term ? 'Nadie se llama así' : 'Todavía no hay personas'} action={<LinkButton to={p('venta-rapida')}>Vender a una persona</LinkButton>}>
            En «Venta rápida» o en un pedido, elige «Persona» y escribe su nombre: queda aquí con lo que compra.
          </EmptyState>
        ) : tab === 'almacen' ? (
          <EmptyState icon={Warehouse} title="Todavía no hay ventas de mostrador" action={<LinkButton to={p('venta-rapida')}>Vender en el mostrador</LinkButton>}>
            En «Venta rápida», elige «Almacén»: es la venta a quien viene a buscar sin decir su nombre.
          </EmptyState>
        ) : (
          <EmptyState icon={StoreIcon} title="No hay locales con ese nombre" />
        )
      ) : (
        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2" aria-label={CLASE_PLURAL[tab]}>
          {filas.map((f) => (
            <li key={f.store.id}>
              <ClienteRow f={f} onOpen={() => setAbiertoId(f.store.id)} />
            </li>
          ))}
        </ul>
      )}
      {abierto ? <ClienteSheet fila={abierto} onClose={() => setAbiertoId(null)} /> : null}
    </>
  );
}

function ClienteRow({ f, onOpen }: { f: ClienteFila; onOpen: () => void }) {
  const { p } = useLine();
  const Icon = ICONO[f.clase];
  const detalle = [
    f.clase === 'persona' ? f.store.phone : f.clase === 'local' ? [f.store.type, f.store.city].filter(Boolean).join(' · ') : 'Venta de mostrador',
    f.compras ? `${f.compras} ${f.compras === 1 ? 'compra' : 'compras'}${f.ultima ? `, la última el ${fmtDate(f.ultima)}` : ''}` : 'Sin compras en firme',
  ]
    .filter(Boolean)
    .join(' · ');
  const cuerpo = (
    <>
      <Icon className="h-5 w-5 flex-none text-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{f.store.name}</span>
        <span className="block text-sm text-muted">{detalle}</span>
      </span>
      <span className="flex-none text-right">
        <span className="tabular block font-bold text-ink">{fmtMoney(f.total)}</span>
        {f.saldo > 0 ? <span className="tabular block text-sm text-warn">debe {fmtMoney(f.saldo)}</span> : null}
      </span>
    </>
  );
  const cls = 'glass flex min-h-16 w-full items-center gap-3 p-3 text-left hover:border-accent';
  // Los locales tienen su ficha completa en «Locales».
  return f.clase === 'local' ? (
    <Link to={p(`locales/${f.store.id}`)} className={cls} data-cliente={f.store.id}>
      {cuerpo}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={onOpen} data-cliente={f.store.id} aria-label={`Ver ${f.store.name}`}>
      {cuerpo}
    </button>
  );
}

/** La ficha de una persona (o del mostrador): su historial de compras y, si es persona, su nombre y teléfono. */
function ClienteSheet({ fila, onClose }: { fila: ClienteFila; onClose: () => void }) {
  const { ctx, actor } = useLine();
  const invoices = useAsync(() => listInvoices(ctx, { storeId: fila.store.id }), [ctx, fila.store.id]);
  const [detalle, setDetalle] = useState<InvoiceView | null>(null);
  const [editando, setEditando] = useState(false);
  const persona = fila.clase === 'persona';
  return (
    <Sheet open onClose={onClose} title={fila.store.name} wide>
      <div className="grid gap-4">
        <p className="text-muted">
          {persona ? ['Persona', fila.store.phone || 'sin teléfono', `cliente desde el ${fmtDate(fila.store.createdAt)}`].join(' · ') : 'Venta de mostrador en el almacén (sin nombre; a veces va en la nota de la venta).'}
        </p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Dato label="Compras" value={String(fila.compras)} />
          <Dato label="Total" value={fmtMoney(fila.total)} />
          <Dato label="Por cobrar" value={fmtMoney(fila.saldo)} />
        </div>
        {persona && !actor.readOnly ? (
          editando ? (
            <EditarPersona store={fila.store} onDone={() => setEditando(false)} />
          ) : (
            <Button icon={Pencil} onClick={() => setEditando(true)} className="justify-self-start">
              Cambiar nombre o teléfono
            </Button>
          )
        ) : null}
        <section>
          <h3 className="mb-2 font-bold">Historial de compras</h3>
          {invoices.loading && !invoices.data ? <Loading rows={2} /> : null}
          {invoices.data?.length === 0 ? <p className="text-muted">Todavía no compró nada.</p> : null}
          <ul className="grid gap-2" aria-label="Historial de compras">
            {(invoices.data ?? []).map((inv) => (
              <li key={inv.id}>
                <InvoiceItem inv={inv} onOpen={() => setDetalle(inv)} />
              </li>
            ))}
          </ul>
        </section>
      </div>
      <InvoiceSheet invoice={detalle} onClose={() => setDetalle(null)} />
    </Sheet>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="tabular font-bold text-ink">{value}</p>
    </div>
  );
}

function EditarPersona({ store, onDone }: { store: Store; onDone: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [nombre, setNombre] = useState(store.name);
  const [telefono, setTelefono] = useState(store.phone);
  return (
    <form
      className="grid gap-3 rounded-2xl border border-line p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await editarPersona(ctx, store.id, { nombre, telefono });
          onDone();
        }, 'Cambios guardados.');
      }}
    >
      <TextInput label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <TextInput label="Teléfono" value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" />
      <Button type="submit" variant="primary" busy={busy}>
        Guardar
      </Button>
    </form>
  );
}
