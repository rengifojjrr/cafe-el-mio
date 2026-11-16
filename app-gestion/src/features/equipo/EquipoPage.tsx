// «Equipo» (Administración): quién cubre qué y cómo va. Por vendedor (sus zonas, sus locales, sus
// visitas, lo que vende y lo que le deben), por zona (con su responsable, que se cambia aquí mismo)
// y por ciudad. Mercado → Zona: la ciudad sale de la dirección de cada local.
import { AlertTriangle, MapPin, Store, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import type { User } from '../../data/types';
import { type FilaCiudad, type FilaVendedor, type FilaZona, type Totales, totalLocales } from '../../domain/equipo';
import { fmtMoney } from '../../lib/money';
import { fmtDate } from '../../lib/time';
import { asignarResponsable } from '../../services/admin';
import { verEquipo } from '../../services/equipo';
import { Card, EmptyState, ErrorBox, LinkButton, Loading, PageHeader, Pill, SelectInput, Tabs } from '../../ui/kit';
import { useAction } from '../../ui/toast';

type Vista = 'vendedores' | 'zonas' | 'ciudades';

const CLAVE_MERCADO = 'equipo:mercado';

function leerMercado(): string {
  try {
    return localStorage.getItem(CLAVE_MERCADO) ?? '';
  } catch {
    return '';
  }
}

export function EquipoPage() {
  const { ctx, actor, p } = useLine();
  const [marketId, setMarketId] = useState(leerMercado);
  const [vista, setVista] = useState<Vista>('vendedores');
  const data = useAsync(() => verEquipo(ctx, marketId || undefined), [ctx, marketId]);

  if (actor.role !== 'admin') {
    return (
      <EmptyState icon={UsersRound} title="Solo Administración ve el equipo">
        Aquí se ve quién cubre cada zona y cómo va cada vendedor.
      </EmptyState>
    );
  }
  if (data.loading && !data.data) return <Loading rows={4} />;
  if (data.error) return <ErrorBox error={data.error} />;
  const e = data.data!;
  const elegir = (id: string) => {
    setMarketId(id);
    try {
      localStorage.setItem(CLAVE_MERCADO, id);
    } catch {
      // Sin almacenamiento: se recuerda solo mientras está abierta.
    }
  };
  const vendedoresActivos = e.vendedores.filter((v) => v.seller.active);

  return (
    <>
      <PageHeader
        title="Equipo"
        subtitle="Quién cubre qué y cómo va: por vendedor, por zona y por ciudad."
        actions={
          <LinkButton to={p('usuarios')} icon={UsersRound}>
            Vendedores y zonas
          </LinkButton>
        }
      />
      {e.markets.length > 1 ? (
        <div className="mb-3">
          <Tabs label="Mercado" value={e.marketId} onChange={elegir} options={e.markets.map((m) => ({ value: m.id, label: m.name }))} />
        </div>
      ) : null}

      {e.zonasSinResponsable || e.sinVendedorActivo.length ? (
        <div className="mb-4 grid gap-2" data-testid="avisos-equipo">
          {e.zonasSinResponsable ? (
            <p className="flex items-start gap-2 rounded-2xl border border-line bg-warn-soft px-4 py-3 text-ink">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-warn" aria-hidden />
              <span>
                {e.zonasSinResponsable === 1 ? '1 zona con locales no tiene responsable' : `${e.zonasSinResponsable} zonas con locales no tienen responsable`}: sus locales siguen con quien los tenía. Asígnalas en «Zonas».
              </span>
            </p>
          ) : null}
          {e.sinVendedorActivo.length ? (
            <p className="flex items-start gap-2 rounded-2xl border border-line bg-warn-soft px-4 py-3 text-ink">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-warn" aria-hidden />
              <span>
                {e.sinVendedorActivo.length === 1 ? '1 local tiene' : `${e.sinVendedorActivo.length} locales tienen`} un vendedor inactivo: dale su zona a otro vendedor.
              </span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mb-4">
        <Tabs
          label="Ver por"
          value={vista}
          onChange={setVista}
          options={[
            { value: 'vendedores', label: 'Vendedores', count: e.vendedores.length },
            { value: 'zonas', label: 'Zonas', count: e.zonas.length },
            { value: 'ciudades', label: 'Ciudades', count: e.ciudades.length },
          ]}
        />
      </div>

      {vista === 'vendedores' ? (
        e.vendedores.length === 0 ? (
          <EmptyState icon={UsersRound} title="Todavía no hay vendedores" action={<LinkButton to={p('usuarios')}>Dar de alta un vendedor</LinkButton>}>
            Da de alta a cada vendedor con las zonas que cubre: sus locales se le asignan solos.
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {e.vendedores.map((v) => (
              <VendedorCard key={v.seller.id} v={v} />
            ))}
          </ul>
        )
      ) : null}

      {vista === 'zonas' ? (
        e.zonas.length === 0 ? (
          <EmptyState icon={MapPin} title="No hay zonas en este mercado" action={<LinkButton to={p('usuarios')}>Agregar zonas</LinkButton>} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {e.zonas.map((z) => (
              <ZonaCard key={z.zone.id} z={z} vendedores={vendedoresActivos.map((v) => v.seller)} />
            ))}
          </ul>
        )
      ) : null}

      {vista === 'ciudades' ? (
        e.ciudades.length === 0 ? (
          <EmptyState icon={Store} title="Todavía no hay locales en este mercado" />
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {e.ciudades.map((c) => (
              <CiudadCard key={c.ciudad} c={c} />
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}

/** Los números de una fila: locales por estado, visitas, ventas y lo que deben. */
function Cifras({ t, visitas7 }: { t: Totales; visitas7?: number }) {
  const items: [string, string, ('warn' | 'danger')?][] = [
    ['Activos', String(t.activos)],
    ['Prospectos', t.porVisitar === t.prospectos ? String(t.prospectos) : `${t.prospectos} (${t.porVisitar} por visitar)`],
    ...(t.enCamino ? ([['Con contrato en camino', String(t.enCamino)]] as [string, string][]) : []),
    ...(visitas7 !== undefined ? ([['Visitas en 7 días', String(visitas7)]] as [string, string][]) : []),
    ['Ventas en 30 días', fmtMoney(t.ventas30)],
    ['Por cobrar', t.vencidos ? `${fmtMoney(t.porCobrar)} · ${t.vencidos} vencido${t.vencidos === 1 ? '' : 's'}` : fmtMoney(t.porCobrar), t.vencidos ? 'danger' : undefined],
    ...(t.sinVisita30 ? ([['Activos sin visita en 30 días', String(t.sinVisita30), 'warn']] as [string, string, 'warn'][]) : []),
    ['Última visita', t.ultimaVisita ? fmtDate(t.ultimaVisita) : '—'],
  ];
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {items.map(([k, val, tone]) => (
        <div key={k} className="min-w-0">
          <dt className="text-muted">{k}</dt>
          <dd className={`tabular font-semibold ${tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink'}`}>{val}</dd>
        </div>
      ))}
    </dl>
  );
}

function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');
}

function VendedorCard({ v }: { v: FilaVendedor }) {
  const n = totalLocales(v.totales);
  return (
    <Card as="li" className="p-4" aria-label={`Vendedor ${v.seller.name}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-accent-soft font-bold text-accent" aria-hidden>
          {iniciales(v.seller.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold text-ink">{v.seller.name}</h2>
            {v.seller.active ? null : <Pill>Inactivo</Pill>}
            {v.excepciones ? <Pill tone="info">{v.excepciones === 1 ? '1 local fuera de sus zonas' : `${v.excepciones} locales fuera de sus zonas`}</Pill> : null}
          </div>
          <p className={`text-sm ${v.zonas.length ? 'text-muted' : 'text-warn'}`}>
            <MapPin className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            {v.zonas.length ? v.zonas.map((z) => z.name).join(', ') : 'Sin zonas'}
            {' · '}
            {n === 1 ? '1 local' : `${n} locales`}
          </p>
        </div>
      </div>
      <Cifras t={v.totales} visitas7={v.visitas7} />
    </Card>
  );
}

function ZonaCard({ z, vendedores }: { z: FilaZona; vendedores: User[] }) {
  const { ctx, actor } = useLine();
  const { run, busy } = useAction();
  const n = totalLocales(z.totales);
  const cambiar = (sellerId: string) =>
    void run(async () => {
      const r = await asignarResponsable(ctx, z.zone.id, sellerId || null);
      return r;
    }, sellerId ? `${z.zone.name}: responsable cambiado.` : `${z.zone.name} quedó sin responsable.`);
  const opciones = [{ value: '', label: 'Sin responsable' }, ...vendedores.map((u) => ({ value: u.id, label: u.name }))];
  if (z.responsable && !vendedores.some((u) => u.id === z.responsable!.id)) opciones.push({ value: z.responsable.id, label: `${z.responsable.name} (inactivo)` });
  return (
    <Card as="li" className="p-4" aria-label={`Zona ${z.zone.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-ink">{z.zone.name}</h2>
        {z.responsable ? null : n ? <Pill tone="warn">Sin responsable</Pill> : <Pill>Sin responsable</Pill>}
        {z.excepciones ? <Pill tone="info">{z.excepciones === 1 ? '1 local de otro vendedor' : `${z.excepciones} locales de otros vendedores`}</Pill> : null}
      </div>
      <p className="text-sm text-muted">
        {n === 1 ? '1 local' : `${n} locales`}
        {z.ciudades.length ? ` · ${z.ciudades.join(', ')}` : ''}
      </p>
      {!actor.readOnly ? (
        <div className="mt-3">
          <SelectInput label="Responsable" value={z.responsable?.id ?? ''} onChange={(ev) => cambiar(ev.target.value)} options={opciones} disabled={busy} />
        </div>
      ) : (
        <p className="mt-2 text-sm">Responsable: {z.responsable?.name ?? 'nadie'}</p>
      )}
      <Cifras t={z.totales} />
    </Card>
  );
}

function CiudadCard({ c }: { c: FilaCiudad }) {
  const n = totalLocales(c.totales);
  return (
    <Card as="li" className="p-4" aria-label={`Ciudad ${c.ciudad}`}>
      <h2 className="font-bold text-ink">{c.ciudad}</h2>
      <p className="text-sm text-muted">
        {n === 1 ? '1 local' : `${n} locales`}
        {c.zonas.length ? ` · ${c.zonas.length === 1 ? 'zona' : 'zonas'} ${c.zonas.join(', ')}` : ''}
      </p>
      <p className="text-sm text-muted">{c.vendedores.length ? `${c.vendedores.length === 1 ? 'Vendedor' : 'Vendedores'}: ${c.vendedores.join(', ')}` : 'Sin vendedor'}</p>
      <Cifras t={c.totales} />
    </Card>
  );
}
