// Recorridos: los prospectos de cada zona en orden para visitarlos. En cada parada se deja la
// información y se anota la del local (encargado, teléfono, correo, horario, permiso) y qué dijo.
import { CheckCircle2, ClipboardPen, LocateFixed, MapPinned, Navigation, Phone, Plus, Route, Store as StoreIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import type { Store } from '../../data/types';
import { DATO_PROSPECTO_LABEL, PROSPECT_RESULT_LABEL } from '../../domain/recorridos';
import type { Point } from '../../domain/routes';
import { fmtAgo } from '../../lib/time';
import { recorridos, type ParadaRecorrido, type Recorrido } from '../../services/recorridos';
import { Button, Card, EmptyState, ErrorBox, LinkButton, Loading, PageHeader, Pill, Tabs } from '../../ui/kit';
import { MapView, type MapMarker } from '../../ui/map';
import { askLocation } from '../../ui/signature';
import { useToast } from '../../ui/toast';
import { RESULT_TONE, VisitaProspectoSheet } from './visita-prospecto';

const telHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;

export function RecorridosPage() {
  const { ctx, actor, p } = useLine();
  const { push } = useToast();
  const [desde, setDesde] = useState<Point | undefined>();
  const [ubicando, setUbicando] = useState(false);
  const data = useAsync(() => recorridos(ctx, { desde }), [ctx, desde]);
  const [marketId, setMarketId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [visita, setVisita] = useState<Store | null>(null);

  const all = data.data?.recorridos ?? [];
  const markets = (data.data?.markets ?? []).filter((m) => all.some((r) => r.marketId === m.id));
  const market = markets.find((m) => m.id === marketId) ?? markets[0];
  const lista = all.filter((r) => !market || r.marketId === market.id);
  const actual = lista.find((r) => r.zoneId === zoneId) ?? lista[0];
  const puedeAnotar = !actor.readOnly && (actor.role === 'admin' || actor.role === 'seller');

  // Si cambia el mercado y la zona elegida no es de ahí, vuelve a la primera.
  useEffect(() => {
    if (zoneId && !lista.some((r) => r.zoneId === zoneId)) setZoneId('');
  }, [lista, zoneId]);

  const ordenarDesdeAqui = async () => {
    setUbicando(true);
    try {
      const pos = await askLocation();
      if (!pos) push('info', 'No se pudo saber dónde estás. Revisa que la app tenga permiso de ubicación.');
      else setDesde({ lat: pos.lat, lng: pos.lng });
    } finally {
      setUbicando(false);
    }
  };

  const total = all.reduce((a, r) => a + r.paradas.length, 0);

  return (
    <>
      <PageHeader
        title="Recorridos"
        subtitle="Los prospectos de cada zona, en orden para visitarlos. En cada parada deja la información y anota la del local."
        actions={
          <>
            {desde ? (
              <Button icon={MapPinned} onClick={() => setDesde(undefined)}>
                Ordenar desde el centro
              </Button>
            ) : (
              <Button icon={LocateFixed} busy={ubicando} onClick={() => void ordenarDesdeAqui()}>
                Ordenar desde donde estoy
              </Button>
            )}
            {puedeAnotar ? (
              <LinkButton to={p('locales/nuevo')} icon={Plus}>
                Agregar prospecto
              </LinkButton>
            ) : null}
          </>
        }
      />
      {data.error ? (
        <ErrorBox error={data.error} />
      ) : data.loading && !data.data ? (
        <Loading rows={4} />
      ) : all.length === 0 ? (
        <EmptyState icon={Route} title="No hay prospectos por visitar" action={puedeAnotar ? <LinkButton to={p('locales/nuevo')} variant="primary" icon={Plus}>Registrar tienda</LinkButton> : undefined}>
          Cuando registres locales como prospecto, aquí aparecen agrupados por zona y en orden para visitarlos.
        </EmptyState>
      ) : (
        <>
          <Card className="mb-4 p-4 text-sm">
            <p className="font-semibold text-ink">En cada parada</p>
            <ol className="mt-1 grid list-decimal gap-0.5 pl-5 text-muted">
              <li>Preséntate y deja la información (catálogo, precios, tu contacto).</li>
              <li>Pide el nombre del encargado, el teléfono, el correo, el horario y el número del permiso de tabaco.</li>
              <li>Toca «Anotar visita»: qué dijo y lo que te dio. Lo que falta queda marcado para la próxima.</li>
            </ol>
          </Card>
          {markets.length > 1 ? (
            <div className="mb-3">
              <Tabs label="Mercado" value={market?.id ?? ''} onChange={setMarketId} options={markets.map((m) => ({ value: m.id, label: m.name, count: all.filter((r) => r.marketId === m.id).reduce((a, r) => a + r.paradas.length, 0) }))} />
            </div>
          ) : null}
          <div className="mb-4">
            <Tabs label="Zona del recorrido" value={actual?.zoneId ?? ''} onChange={setZoneId} options={lista.map((r) => ({ value: r.zoneId, label: r.zona, count: r.paradas.length }))} />
          </div>
          {actual ? <RecorridoView r={actual} desde={desde} origen={data.data?.desde === 'ubicacion' ? 'donde estás' : `el centro de ${market?.name ?? 'el mercado'}`} onVisita={puedeAnotar ? setVisita : undefined} /> : null}
          <p className="mt-4 text-sm text-muted">
            {total === 1 ? 'Falta 1 parada' : `Faltan ${total} paradas`} en {all.length === 1 ? 'una zona' : `${all.length} zonas`}.
            {data.data?.desde === 'ubicacion' ? ' Ordenadas desde donde estás.' : ' Ordenadas desde el centro del mercado.'}
          </p>
        </>
      )}
      {visita ? <VisitaProspectoSheet key={visita.id} store={visita} open onClose={() => setVisita(null)} /> : null}
    </>
  );
}

function RecorridoView({ r, desde, origen, onVisita }: { r: Recorrido; desde?: Point; origen: string; onVisita?: (s: Store) => void }) {
  const markers: MapMarker[] = useMemo(
    () => [
      ...r.paradas.map((x, i) => ({ id: x.store.id, kind: 'store' as const, lat: x.store.lat, lng: x.store.lng, title: `${i + 1}. ${x.store.name}`, status: 'prospecto' as const, weight: 0.45, label: String(i + 1) })),
      ...r.hechas.map((x) => ({ id: x.store.id, kind: 'store' as const, lat: x.store.lat, lng: x.store.lng, title: `${x.store.name}: ${x.ultima ? PROSPECT_RESULT_LABEL[x.ultima.result] : 'visitado'}`, status: 'cerrado' as const, weight: 0.2 })),
    ],
    [r],
  );
  const line: [number, number][] = [...(desde ? [[desde.lat, desde.lng] as [number, number]] : []), ...r.paradas.map((x) => [x.store.lat, x.store.lng] as [number, number])];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="grid content-start gap-3">
        <MapView markers={markers} route={line.length > 1 ? line : undefined} className="h-[42vh] lg:h-[62vh]" fitKey={`${r.zoneId}|${r.paradas.map((x) => x.store.id).join(',')}|${desde ? 'aqui' : ''}`} label={`Mapa del recorrido de ${r.zona}`} />
        {r.tramos.length ? (
          <div className="grid gap-2" aria-label="Abrir el recorrido en Google Maps">
            {r.tramos.map((t) => (
              <a key={t.desde} className="btn btn-primary" href={t.url} target="_blank" rel="noopener noreferrer">
                <Navigation aria-hidden /> {r.tramos.length === 1 ? 'Abrir el recorrido en Google Maps' : `Paradas ${t.desde} a ${t.hasta} en Google Maps`}
              </a>
            ))}
            <p className="text-sm text-muted">
              {r.paradas.length === 1 ? '1 parada' : `${r.paradas.length} paradas`} · unos {r.km.toLocaleString('es-US')} km saliendo desde {origen}
              {r.tramos.length > 1 ? '. Google Maps abre hasta 4 paradas por vez: al terminar un tramo, abre el siguiente.' : '.'}
            </p>
          </div>
        ) : null}
      </div>
      <div className="grid content-start gap-2">
        {r.paradas.length === 0 ? (
          <Card className="p-4">
            <p className="font-semibold">Ya visitaste todos los de {r.zona}.</p>
          </Card>
        ) : (
          <ol className="grid gap-2" aria-label={`Paradas de ${r.zona}`}>
            {r.paradas.map((x, i) => (
              <ParadaCard key={x.store.id} n={i + 1} x={x} onVisita={onVisita} />
            ))}
          </ol>
        )}
        {r.hechas.length ? (
          <details className="glass p-4">
            <summary className="cursor-pointer font-semibold">Ya visitados ({r.hechas.length})</summary>
            <ul className="mt-2 grid gap-2">
              {r.hechas.map((x) => (
                <HechaItem key={x.store.id} x={x} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function ParadaCard({ n, x, onVisita }: { n: number; x: ParadaRecorrido; onVisita?: (s: Store) => void }) {
  const { ctx, p } = useLine();
  const s = x.store;
  return (
    <li className="glass p-4" aria-label={`Parada ${n}: ${s.name}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-accent font-bold text-accent-ink tabular" aria-hidden>
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{s.name}</p>
          <p className="text-sm text-muted">
            {s.type} · {s.address}, {s.city}
          </p>
          {s.phone ? (
            <a className="mt-0.5 inline-flex items-center gap-1.5 text-sm underline" href={telHref(s.phone)}>
              <Phone className="h-4 w-4" aria-hidden /> {s.phone}
            </a>
          ) : null}
          {s.hours ? <p className="text-sm text-muted">{s.hours}</p> : null}
          {x.ultima ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
              <Pill tone={RESULT_TONE[x.ultima.result]}>{PROSPECT_RESULT_LABEL[x.ultima.result]}</Pill>
              <span className="text-muted">{fmtAgo(x.ultima.at, ctx.now())}</span>
            </p>
          ) : null}
          {x.falta.length ? (
            <p className="mt-1.5 text-sm text-warn" data-testid="falta-recolectar">
              Falta: {x.falta.map((d) => DATO_PROSPECTO_LABEL[d]).join(', ')}
            </p>
          ) : (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-ok">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Datos completos: ya se le puede preparar el contrato.
            </p>
          )}
          {s.notes ? <p className="mt-1.5 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink">{s.notes}</p> : null}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a className="btn btn-secondary" href={x.comoLlegar} target="_blank" rel="noopener noreferrer">
          <Navigation aria-hidden /> Cómo llegar
        </a>
        {onVisita ? (
          <Button variant="primary" icon={ClipboardPen} onClick={() => onVisita(s)}>
            Anotar visita
          </Button>
        ) : (
          <LinkButton to={p(`locales/${s.id}`)} icon={StoreIcon}>
            Ver ficha
          </LinkButton>
        )}
      </div>
      {onVisita ? (
        <LinkButton to={p(`locales/${s.id}`)} className="mt-2 w-full" icon={StoreIcon}>
          Ver ficha
        </LinkButton>
      ) : null}
    </li>
  );
}

function HechaItem({ x }: { x: ParadaRecorrido }) {
  const { ctx, p } = useLine();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2">
      <div className="min-w-0">
        <p className="font-semibold">{x.store.name}</p>
        {x.ultima ? (
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            <Pill tone={RESULT_TONE[x.ultima.result]}>{PROSPECT_RESULT_LABEL[x.ultima.result]}</Pill>
            <span className="text-muted">{fmtAgo(x.ultima.at, ctx.now())}</span>
          </p>
        ) : null}
      </div>
      <LinkButton to={p(`locales/${x.store.id}`)} icon={StoreIcon}>
        Ficha
      </LinkButton>
    </li>
  );
}
