// Locales: la lista, «Registrar tienda» (OpenStreetMap o tocar el mapa) y la ficha del local
// con sus estados, contrato, consignación, entregas, visitas y cuentas.
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileSignature,
  MapPin,
  MessageCircle,
  Navigation,
  PauseCircle,
  Pencil,
  Phone,
  PlayCircle,
  Plus,
  Search,
  Store as StoreIcon,
  Truck,
  XCircle,
  Zap,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Store, StoreStatus } from '../../data/types';
import { permitState, supplyCheck } from '../../domain/compliance';
import { creditText, hasValidResaleCert } from '../../domain/invoices';
import { searchAddress, type GeoResult } from '../../lib/geocode';
import { fmtMoney } from '../../lib/money';
import { addDaysToDate, fmtAgo, fmtDate, fmtDateTime, toIsoDate } from '../../lib/time';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { contractsForStore, issueContract } from '../../services/contracts';
import { listDeliveries, listReorders, storeVisits } from '../../services/consignment';
import { openThread } from '../../services/messages';
import { listInvoices, type InvoiceView } from '../../services/invoices';
import { listSettlements } from '../../services/money';
import { priceListOptions } from '../../services/prices';
import {
  STORE_STATUS_LABEL,
  getStorePhoto,
  listSellers,
  listStores,
  listZones,
  loadStoreForActor,
  registerStore,
  setFacadePhoto,
  setStoreStatus,
  storeConsignment,
  storeDebt,
  transitionsFor,
  updateStore,
  type StoreView,
} from '../../services/stores';
import type { NewPhoto } from '../../lib/image';
import { directionsUrl, MapView } from '../../ui/map';
import {
  Button,
  Card,
  EmptyState,
  ErrorBox,
  KeyValue,
  LinkButton,
  Loading,
  NumberInput,
  PageHeader,
  Pill,
  Section,
  SelectInput,
  Sheet,
  Tabs,
  TextArea,
  TextInput,
} from '../../ui/kit';
import { HoursPicker } from '../../ui/hours';
import { PhotoPicker, useStoredPhoto } from '../../ui/media';
import { errorText, useAction, useToast } from '../../ui/toast';
import { PermitPill, StoreStatusPill } from '../common';
import { DeliveryCard, RequestDeliverySheet, ReportSalesSheet, ReturnSheet } from '../consignment/components';
import { InvoiceItem, InvoiceSheet } from '../sales/invoices';

type Filter = 'todos' | 'activos' | 'proceso' | 'pausados';

// ---------- Lista ----------

export function StoresPage() {
  const { ctx, actor, p, config } = useLine();
  const { data, error, loading } = useAsync(() => listStores(ctx), [ctx]);
  const [filter, setFilter] = useState<Filter>('todos');
  const [q, setQ] = useState('');
  const [seller, setSeller] = useState('');
  const sellers = useMemo(() => [...new Set((data ?? []).map((s) => s.sellerName))].sort(), [data]);
  const list = (data ?? []).filter((v) => {
    const st = v.store.status;
    if (filter === 'activos' && st !== 'activo') return false;
    if (filter === 'proceso' && !['prospecto', 'contrato_enviado', 'firmado'].includes(st)) return false;
    if (filter === 'pausados' && st !== 'pausado' && st !== 'cerrado') return false;
    if (seller && v.sellerName !== seller) return false;
    const term = q.trim().toLowerCase();
    return !term || `${v.store.name} ${v.store.city} ${v.store.type} ${v.store.managerName}`.toLowerCase().includes(term);
  });
  const count = (f: (s: StoreStatus) => boolean) => (data ?? []).filter((v) => f(v.store.status)).length;
  const canRegister = (actor.role === 'seller' || actor.role === 'admin') && !actor.readOnly;
  return (
    <>
      <PageHeader
        title={actor.role === 'seller' ? 'Mis locales' : 'Locales'}
        subtitle={actor.role === 'seller' ? 'Tus tiendas: inscríbelas, firma el contrato y colócales producto.' : `Las tiendas de ${config.name}, su estado, su consignación y lo que deben.`}
        actions={
          canRegister ? (
            <LinkButton to={p('locales/nuevo')} variant="primary" big icon={Plus}>
              Registrar tienda
            </LinkButton>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs<Filter>
          label="Filtrar locales por estado"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'todos', label: 'Todos', count: data?.length },
            { value: 'activos', label: 'Activos', count: count((s) => s === 'activo') },
            { value: 'proceso', label: 'Por firmar o aprobar', count: count((s) => ['prospecto', 'contrato_enviado', 'firmado'].includes(s)) },
            { value: 'pausados', label: 'Pausados o cerrados', count: count((s) => s === 'pausado' || s === 'cerrado') },
          ]}
        />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <label className="relative min-w-0 flex-1 basis-60">
          <span className="sr-only">Buscar local</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
          <input className="input pl-10" placeholder="Buscar por nombre, ciudad o encargado" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {actor.role === 'admin' ? (
          <select className="input w-auto min-w-48" value={seller} onChange={(e) => setSeller(e.target.value)} aria-label="Filtrar por vendedor">
            <option value="">Todos los vendedores</option>
            {sellers.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        ) : null}
      </div>
      {loading && !data ? <Loading rows={5} /> : null}
      {error ? <ErrorBox error={error} /> : null}
      {data && data.length === 0 ? (
        <EmptyState icon={StoreIcon} title="Aún no tienes tiendas" action={canRegister ? <LinkButton to={p('locales/nuevo')} variant="primary" icon={Plus}>Registrar tienda</LinkButton> : undefined}>
          Toca «Registrar tienda» para inscribir la primera.
        </EmptyState>
      ) : null}
      {data && data.length > 0 && list.length === 0 ? <p className="text-muted">Ningún local coincide con el filtro.</p> : null}
      <ul className="grid gap-2">
        {list.map((v) => (
          <li key={v.store.id}>
            <StoreRow v={v} />
          </li>
        ))}
      </ul>
    </>
  );
}

function StoreRow({ v }: { v: StoreView }) {
  const { p, actor, ctx } = useLine();
  const s = v.store;
  return (
    <Link
      to={p(`locales/${s.id}`)}
      className="glass grid gap-2 p-4 transition-colors hover:border-line-strong md:grid-cols-[minmax(0,1fr)_230px_250px_140px] md:items-center md:gap-4"
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-bold text-ink">
          {s.name}
          {v.pendingOrders ? <Pill tone="accent">{v.pendingOrders} pedido{v.pendingOrders > 1 ? 's' : ''}</Pill> : null}
        </p>
        <p className="truncate text-sm text-muted">
          {s.type} · {v.zoneName}
          {actor.role === 'admin' ? ` · ${v.sellerName}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 md:justify-center">
        <StoreStatusPill status={s.status} />
        <PermitPill state={v.permit && v.permit !== 'vigente' ? v.permit : null} />
      </div>
      <div className="grid gap-0.5 text-sm md:text-right">
        {s.saleMode === 'firme' ? (
          <p>
            <span className="font-semibold text-accent">{creditText(s)}</span>
          </p>
        ) : (
          <p>
            <span className="text-muted">En consignación </span>
            <span className="font-semibold tabular">
              {v.consignmentUnits} u. · {fmtMoney(v.consignmentValue)}
            </span>
          </p>
        )}
        <p>
          <span className="text-muted">Debe </span>
          <span className={`font-semibold tabular ${v.overdue ? 'text-danger' : v.owedTotal > 0 ? 'text-ink' : 'text-muted'}`}>
            {fmtMoney(v.owedTotal)}
            {v.overdue ? ' · vencido' : ''}
          </span>
        </p>
      </div>
      <p className="text-sm text-muted md:text-right">{v.lastVisitAt ? `Visita ${fmtAgo(v.lastVisitAt, ctx.now())}` : 'Sin visitas'}</p>
    </Link>
  );
}

// ---------- Registrar / editar ----------

export function StoreFormPage() {
  const { id } = useParams();
  const { ctx, actor, p } = useLine();
  const existing = useAsync(() => (id ? loadStoreForActor(ctx, id) : Promise.resolve(undefined)), [ctx, id]);
  if (actor.role !== 'seller' && actor.role !== 'admin') {
    return <EmptyState icon={StoreIcon} title="Solo vendedores y administración registran tiendas" action={<LinkButton to={p()}>Ir al inicio</LinkButton>} />;
  }
  if (id && existing.loading && !existing.data) return <Loading rows={4} />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  return <StoreForm key={existing.data?.id ?? 'nueva'} initial={existing.data} />;
}

interface StoreFormState {
  name: string;
  type: string;
  address: string;
  city: string;
  zoneId: string;
  point: { lat: number; lng: number } | null;
  managerName: string;
  phone: string;
  email: string;
  hours: string;
  notes: string;
  sellerId: string;
  permitNumber: string;
  permitExpires: string;
  saleMode: 'consignacion' | 'firme';
  creditDays: number | '';
  onCredit: boolean;
  priceListId: string;
}

function StoreForm({ initial }: { initial?: Store }) {
  const { ctx, actor, config, p, line } = useLine();
  const nav = useNavigate();
  const { push } = useToast();
  const { run, busy } = useAction();
  const zones = useAsync(() => listZones(ctx), [ctx]);
  const sellers = useAsync(() => listSellers(ctx), [ctx]);
  const [photo, setPhoto] = useState<NewPhoto | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>();
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [f, setF] = useState<StoreFormState>(() => ({
    name: initial?.name ?? '',
    type: initial?.type ?? config.storeTypes[0]!,
    address: initial?.address ?? '',
    city: initial?.city ?? '',
    zoneId: initial?.zoneId ?? '',
    point: initial ? { lat: initial.lat, lng: initial.lng } : null,
    managerName: initial?.managerName ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    hours: initial?.hours ?? '',
    notes: initial?.notes ?? '',
    sellerId: initial?.sellerId ?? '',
    permitNumber: initial?.tobaccoPermit?.number ?? '',
    permitExpires: initial?.tobaccoPermit?.expiresOn ?? addDaysToDate(toIsoDate(ctx.now()), 365),
    saleMode: initial?.saleMode ?? 'consignacion',
    creditDays: initial?.creditDays || 15,
    onCredit: (initial?.creditDays ?? 0) > 0,
    priceListId: initial?.priceListId ?? '',
  }));
  const lists = useAsync(() => (actor.role === 'admin' ? priceListOptions(ctx) : Promise.resolve([])), [ctx, actor.role]);
  const set = <K extends keyof StoreFormState>(k: K, v: StoreFormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const nearestZone = (pt: { lat: number; lng: number }) => {
    let best = '';
    let d = Infinity;
    for (const z of zones.data ?? []) {
      const dd = (z.lat - pt.lat) ** 2 + (z.lng - pt.lng) ** 2;
      if (dd < d) {
        d = dd;
        best = z.id;
      }
    }
    return best;
  };
  const choosePoint = (pt: { lat: number; lng: number }) => setF((s) => ({ ...s, point: pt, zoneId: s.zoneId || nearestZone(pt) }));

  const search = async () => {
    setSearching(true);
    try {
      const r = await searchAddress(`${f.address}, ${f.city}`.replace(/^, |, $/g, ''));
      setResults(r);
      if (r.length === 0) push('info', 'No apareció. Toca el mapa para poner el punto de la tienda.');
    } catch (e) {
      push('error', errorText(e));
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const submit = () =>
    void run(async () => {
      if (!f.point) throw new Error('Ubica la tienda: busca la dirección o toca el mapa.');
      const input = {
        name: f.name,
        type: f.type,
        address: f.address,
        city: f.city,
        zoneId: f.zoneId,
        lat: f.point.lat,
        lng: f.point.lng,
        managerName: f.managerName,
        phone: f.phone,
        email: f.email,
        hours: f.hours,
        notes: f.notes,
        sellerId: actor.role === 'admin' ? f.sellerId || undefined : undefined,
        tobaccoPermit: config.requiresTobaccoPermit ? { number: f.permitNumber, expiresOn: f.permitExpires } : undefined,
        terms:
          actor.role === 'admin'
            ? { saleMode: f.saleMode, creditDays: f.saleMode === 'firme' && f.onCredit ? (f.creditDays === '' ? 0 : f.creditDays) : 0, priceListId: f.priceListId || undefined }
            : undefined,
      };
      const saved = initial ? await updateStore(ctx, initial.id, input) : await registerStore(ctx, input);
      if (photo) await setFacadePhoto(ctx, saved.id, photo);
      nav(p(`locales/${saved.id}`));
      return saved;
    }, initial ? 'Datos del local guardados.' : 'Tienda registrada como prospecto. Siguiente paso: el contrato.');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <PageHeader
        back={{ to: initial ? p(`locales/${initial.id}`) : p('locales'), label: initial ? initial.name : 'Locales' }}
        title={initial ? 'Editar local' : 'Registrar tienda'}
        subtitle={initial ? undefined : 'Queda como prospecto. Después se prepara y se firma el contrato aquí mismo.'}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="grid content-start gap-4 p-4 sm:p-5">
          <h2 className="font-bold">La tienda</h2>
          <TextInput label="Nombre de la tienda" value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="organization" required />
          <SelectInput label="Tipo" value={f.type} onChange={(e) => set('type', e.target.value)} options={config.storeTypes.map((t) => ({ value: t, label: t }))} />
          <TextInput label="Dirección" value={f.address} onChange={(e) => set('address', e.target.value)} placeholder="Número y calle" autoComplete="street-address" required />
          <TextInput label="Ciudad" value={f.city} onChange={(e) => set('city', e.target.value)} placeholder="Hialeah, FL" required />
          <Button icon={Search} onClick={() => void search()} busy={searching}>
            Buscar en el mapa
          </Button>
          {results && results.length > 0 ? (
            <ul className="grid gap-1.5" aria-label="Resultados de la búsqueda">
              {results.map((r) => (
                <li key={`${r.lat},${r.lng}`}>
                  <button
                    type="button"
                    className="w-full rounded-xl border border-line px-3 py-2 text-left text-sm hover:border-accent"
                    onClick={() => {
                      choosePoint({ lat: r.lat, lng: r.lng });
                      if (r.city && !f.city) set('city', r.city);
                      setResults(null);
                    }}
                  >
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <p className="field-label mb-1.5 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-accent" aria-hidden /> Punto en el mapa
            </p>
            <MapView
              label="Mapa para ubicar la tienda: toca para poner el punto"
              className="h-64"
              markers={[]}
              center={f.point ? [f.point.lat, f.point.lng] : [25.79, -80.28]}
              zoom={f.point ? 15 : 10}
              pick={{ value: f.point, onPick: choosePoint }}
            />
            <p className="field-hint mt-1.5">{f.point ? `Punto elegido: ${f.point.lat}, ${f.point.lng}. Arrástralo o toca otro lugar para moverlo.` : 'Si la búsqueda no la encuentra, toca el mapa donde está la tienda.'}</p>
          </div>
          <SelectInput label="Zona" value={f.zoneId} onChange={(e) => set('zoneId', e.target.value)} options={(zones.data ?? []).map((z) => ({ value: z.id, label: z.name }))} placeholder="Elige la zona" />
        </Card>
        <div className="grid content-start gap-4">
          <Card className="grid gap-4 p-4 sm:p-5">
            <h2 className="font-bold">Encargado y contacto</h2>
            <TextInput label="Nombre del encargado" value={f.managerName} onChange={(e) => set('managerName', e.target.value)} autoComplete="name" required />
            <TextInput label="Teléfono" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(305) 555-0123" required />
            <TextInput label="Correo" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="opcional" />
            <HoursPicker value={f.hours} onChange={(text) => set('hours', text)} />
          </Card>
          {config.requiresTobaccoPermit ? (
            <Card className="grid gap-4 p-4 sm:p-5">
              <h2 className="font-bold">Permiso de venta de tabaco</h2>
              <p className="text-sm text-muted">En Florida lo otorga el DBPR. Sin permiso vigente no se le puede consignar tabaco, y el local se compromete a vender solo a mayores de 21 años.</p>
              <TextInput label="Número del permiso" value={f.permitNumber} onChange={(e) => set('permitNumber', e.target.value)} required />
              <TextInput label="Vence el" type="date" value={f.permitExpires} onChange={(e) => set('permitExpires', e.target.value)} required />
            </Card>
          ) : null}
          {actor.role === 'admin' ? (
            <Card className="grid gap-4 p-4 sm:p-5">
              <h2 className="font-bold">Cómo compra</h2>
              <Tabs<'consignacion' | 'firme'>
                label="Cómo compra el local"
                value={f.saleMode}
                onChange={(v) => set('saleMode', v)}
                options={[
                  { value: 'consignacion', label: 'Consignación' },
                  { value: 'firme', label: 'Compra en firme (mayoreo)' },
                ]}
              />
              <p className="text-sm text-muted">
                {f.saleMode === 'firme'
                  ? 'Pide, recibe con firma y paga: cada entrega trae su factura y la mercancía pasa a ser del local.'
                  : 'La mercancía sigue siendo de la empresa hasta que se vende; paga lo vendido en cada liquidación.'}
              </p>
              {f.saleMode === 'firme' ? (
                <>
                  <Tabs<'contado' | 'credito'>
                    label="Cómo paga"
                    value={f.onCredit ? 'credito' : 'contado'}
                    onChange={(v) => set('onCredit', v === 'credito')}
                    options={[
                      { value: 'contado', label: 'De contado' },
                      { value: 'credito', label: 'A crédito' },
                    ]}
                  />
                  {f.onCredit ? (
                    <NumberInput label="Días de crédito" value={f.creditDays} onValue={(v) => set('creditDays', v)} min={1} max={120} step={1} hint="La factura vence a los N días de la entrega." />
                  ) : null}
                </>
              ) : null}
              <SelectInput
                label="Lista de precios"
                value={f.priceListId}
                onChange={(e) => set('priceListId', e.target.value)}
                options={[
                  { value: '', label: `La de la línea${lists.data?.find((l) => l.isDefault) ? ` (${lists.data.find((l) => l.isDefault)!.name})` : ''}` },
                  ...(lists.data ?? []).map((l) => ({ value: l.id, label: l.name })),
                ]}
                hint="Con estos precios se le factura lo que compra en firme (también en la venta rápida)."
              />
            </Card>
          ) : null}
          <Card className="grid gap-4 p-4 sm:p-5">
            <h2 className="font-bold">Fachada y notas</h2>
            <div className="flex flex-wrap items-center gap-3">
              {photoPreview ? <img src={photoPreview} alt="Foto de la fachada" className="h-20 w-28 rounded-xl object-cover" /> : null}
              <PhotoPicker
                label={photoPreview ? 'Cambiar foto' : 'Foto de la fachada'}
                onPhoto={(ph) => {
                  setPhoto(ph);
                  setPhotoPreview(URL.createObjectURL(ph.blob));
                }}
              />
            </div>
            {actor.role === 'admin' ? (
              <SelectInput label="Vendedor responsable" value={f.sellerId} onChange={(e) => set('sellerId', e.target.value)} options={(sellers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} placeholder="Elige el vendedor" />
            ) : null}
            <TextArea label="Notas" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Lo que conviene saber de la tienda" />
          </Card>
        </div>
      </div>
      <div className="sticky bottom-[76px] z-20 mt-5 flex justify-end lg:bottom-4 lg:justify-start">
        <Button type="submit" variant="primary" big icon={initial ? CheckCircle2 : Plus} busy={busy} disabled={actor.readOnly}>
          {initial ? 'Guardar cambios' : line === 'tabaco' ? 'Registrar tienda' : 'Registrar tienda'}
        </Button>
      </div>
    </form>
  );
}

// ---------- Ficha del local ----------

type DetailTab = 'consignacion' | 'facturas' | 'entregas' | 'visitas' | 'cuentas';

export function StoreDetailPage() {
  const { id = '' } = useParams();
  const { ctx, actor, p, line, config } = useLine();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const store = useAsync(() => loadStoreForActor(ctx, id), [ctx, id]);
  const contracts = useAsync(() => contractsForStore(ctx, id), [ctx, id]);
  const consignment = useAsync(() => storeConsignment(ctx, id), [ctx, id]);
  const deliveries = useAsync(() => listDeliveries(ctx, { storeId: id }), [ctx, id]);
  const visits = useAsync(() => storeVisits(ctx, id), [ctx, id]);
  const settlements = useAsync(() => listSettlements(ctx, { storeId: id }), [ctx, id]);
  const reorders = useAsync(() => listReorders(ctx, { storeId: id, open: true }), [ctx, id]);
  const debt = useAsync(() => storeDebt(ctx, id), [ctx, id]);
  const invoices = useAsync(() => listInvoices(ctx, { storeId: id }), [ctx, id]);
  const photo = useStoredPhoto(store.data?.facadePhotoId, () => getStorePhoto(ctx, id));
  const [tabPicked, setTab] = useState<DetailTab | null>(null);
  const [invDetail, setInvDetail] = useState<InvoiceView | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);
  const [statusSheet, setStatusSheet] = useState<StoreStatus | null>(null);

  if (store.loading && !store.data) return <Loading rows={5} />;
  if (store.error) return <ErrorBox error={store.error} />;
  const s = store.data;
  if (!s) return null;
  const now = ctx.now();
  const isAdmin = actor.role === 'admin';
  const isOwnerSeller = actor.role === 'seller' && s.sellerId === actor.userId;
  const canWork = (isAdmin || isOwnerSeller) && !actor.readOnly;
  const contract = contracts.data?.find((c) => c.status !== 'anulado');
  const permit = config.requiresTobaccoPermit ? permitState(s, now) : null;
  const check = supplyCheck(line, s, now);
  const firm = s.saleMode === 'firme';
  const tab: DetailTab = tabPicked ?? (firm ? 'facturas' : 'consignacion');
  const invList = invoices.data ?? [];
  const units = (consignment.data ?? []).reduce((a, c) => a + c.qty, 0);
  const owed = debt.data?.total ?? 0;
  const overdue = (debt.data?.overdue ?? 0) > 0;

  const prepareContract = () =>
    void run(async () => {
      const c = await issueContract(ctx, s.id);
      nav(p(`contratos/${c.id}`));
      return c;
    }, 'Contrato listo para firmar.');

  const writeToStore = () =>
    void run(async () => {
      const t = await openThread(ctx, { kind: 'store', storeId: s.id });
      nav(p(`mensajes/${t.id}`));
    });

  return (
    <>
      <PageHeader
        back={actor.role === 'store' ? undefined : { to: p('locales'), label: actor.role === 'seller' ? 'Mis locales' : 'Locales' }}
        title={s.name}
        subtitle={`${s.type} · ${s.address}, ${s.city}`}
        actions={
          canWork ? (
            <LinkButton to={p(`locales/${s.id}/editar`)} icon={Pencil}>
              Editar
            </LinkButton>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StoreStatusPill status={s.status} />
        <PermitPill state={permit} />
        {contract ? <Pill tone={contract.status === 'firmado' ? 'ok' : 'warn'}>{contract.status === 'firmado' ? `Contrato v${contract.version} firmado` : `Contrato v${contract.version} por firmar`}</Pill> : null}
        {reorders.data?.length ? <Pill tone="accent">{reorders.data.length} pedido(s) en curso</Pill> : null}
      </div>

      {!check.ok && (s.status === 'activo' || s.status === 'firmado') ? (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-danger bg-danger-soft p-4" role="alert">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-danger" aria-hidden />
          <p className="text-ink">{check.reason}</p>
        </div>
      ) : null}

      {/* Siguiente paso, grande y claro */}
      {canWork ? (
        <div className="mb-5 grid gap-2 sm:flex sm:flex-wrap">
          {s.status === 'prospecto' && !firm ? (
            <Button variant="primary" big icon={FileSignature} busy={busy} onClick={prepareContract}>
              Preparar contrato
            </Button>
          ) : null}
          {firm && isAdmin && transitionsFor(s).includes('activo') && (s.status === 'prospecto' || s.status === 'contrato_enviado') ? (
            <Button variant="primary" big icon={CheckCircle2} busy={busy} onClick={() => void run(() => setStoreStatus(ctx, s.id, 'activo', 'compra en firme'), `${s.name} quedó activo: ya puede comprar en firme.`)}>
              Aprobar para comprar en firme
            </Button>
          ) : null}
          {firm && !isAdmin && (s.status === 'prospecto' || s.status === 'contrato_enviado') ? (
            <p className="text-muted">Compra en firme: no firma contrato de consignación. Administración lo aprueba.</p>
          ) : null}
          {s.status === 'contrato_enviado' && contract ? (
            <LinkButton to={p(`contratos/${contract.id}`)} variant="primary" big icon={FileSignature}>
              Firmar contrato
            </LinkButton>
          ) : null}
          {s.status === 'activo' || s.status === 'firmado' ? (
            <>
              {s.status === 'activo' ? (
                <LinkButton to={p(`locales/${s.id}/visita`)} variant="primary" big icon={ClipboardCheck}>
                  Registrar visita
                </LinkButton>
              ) : null}
              <Button big icon={Truck} onClick={() => setRequestOpen(true)} disabled={!check.ok}>
                {firm ? 'Tomar pedido' : 'Pedir producto'}
              </Button>
              {isAdmin && s.status === 'activo' ? (
                <LinkButton to={`${p('venta-rapida')}?local=${s.id}`} big icon={Zap}>
                  Venta rápida
                </LinkButton>
              ) : null}
            </>
          ) : null}
          {isAdmin && s.status === 'firmado' ? (
            <Button variant="primary" big icon={CheckCircle2} busy={busy} onClick={() => void run(() => setStoreStatus(ctx, s.id, 'activo'), `${s.name} quedó activo.`)}>
              Aprobar local
            </Button>
          ) : null}
        </div>
      ) : null}
      {actor.role === 'store' && !actor.readOnly && s.status === 'activo' ? (
        <div className="mb-5 grid gap-2 sm:flex sm:flex-wrap">
          <LinkButton to={p('pedir')} variant="primary" big icon={Plus}>
            Pedir más producto
          </LinkButton>
          {firm ? null : (
            <Button big icon={ClipboardCheck} onClick={() => setSalesOpen(true)}>
              Reportar ventas
            </Button>
          )}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-4 sm:p-5">
          <KeyValue
            items={[
              ['Encargado', s.managerName],
              ['Teléfono', <a key="tel" href={`tel:${s.phone.replace(/[^0-9+]/g, '')}`} className="inline-flex items-center gap-1.5 underline"><Phone className="h-4 w-4" aria-hidden />{s.phone}</a>],
              ['Correo', s.email || '—'],
              ['Horario', s.hours || '—'],
              ...(config.requiresTobaccoPermit
                ? ([['Permiso de tabaco', s.tobaccoPermit ? `${s.tobaccoPermit.number} · vence el ${fmtDate(s.tobaccoPermit.expiresOn)}` : 'Sin registrar']] as [string, string][])
                : []),
              ['Cómo compra', creditText(s)],
              ...(firm || s.taxId || s.resaleCert
                ? ([
                    ['Tax ID', s.taxId || 'Sin registrar'],
                    [
                      'Certificado de reventa',
                      s.resaleCert
                        ? `${s.resaleCert.number} · ${hasValidResaleCert(s, now) ? 'vence' : 'venció'} el ${fmtDate(s.resaleCert.expiresOn)}`
                        : 'Sin registrar',
                    ],
                  ] as [string, string][])
                : []),
              ...(firm
                ? []
                : ([
                    [
                      'Contrato',
                      contract ? (
                        <Link key="ctr" to={p(`contratos/${contract.id}`)} className="underline">
                          {contract.status === 'firmado' ? `Firmado el ${fmtDate(contract.signedAt!)}` : 'Por firmar'} · ver
                        </Link>
                      ) : (
                        'Sin contrato'
                      ),
                    ],
                  ] as [string, ReactNode][])),
              ['Alta', fmtDate(s.createdAt)],
            ]}
          />
          {s.notes ? <p className="mt-4 rounded-xl bg-surface-2 p-3 text-sm text-ink">{s.notes}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <a className="btn btn-secondary" href={directionsUrl(s.lat, s.lng)} target="_blank" rel="noreferrer">
              <Navigation aria-hidden /> Cómo llegar
            </a>
            {(isAdmin || isOwnerSeller) && !actor.readOnly && s.status === 'activo' ? (
              <Button icon={MessageCircle} onClick={writeToStore}>
                Escribir al local
              </Button>
            ) : null}
          </div>
        </Card>
        <div className="grid gap-3">
          {photo ? <img src={photo} alt={`Fachada de ${s.name}`} className="h-40 w-full rounded-[20px] object-cover" /> : null}
          <MapView label={`Ubicación de ${s.name}`} className="h-56" markers={[{ id: s.id, lat: s.lat, lng: s.lng, kind: 'store', status: s.status, title: s.name, weight: 0.5 }]} center={[s.lat, s.lng]} zoom={15} />
        </div>
      </div>

      {s.status !== 'prospecto' ? (
        <>
          <div className="mt-6 mb-3 grid grid-cols-3 gap-3">
            {firm ? (
              <div className="glass p-3">
                <p className="text-sm text-muted">Facturas por pagar</p>
                <p className="glow text-xl font-bold tabular">{debt.data?.openInvoices ?? 0}</p>
              </div>
            ) : (
              <div className="glass p-3">
                <p className="text-sm text-muted">En consignación</p>
                <p className="glow text-xl font-bold tabular">{units} u.</p>
              </div>
            )}
            <div className="glass p-3">
              <p className="text-sm text-muted">Debe</p>
              <p className={`text-xl font-bold tabular ${overdue ? 'text-danger' : 'text-ink'}`}>{fmtMoney(owed)}</p>
              {debt.data && debt.data.unsettled > 0 ? <p className="text-xs text-muted tabular">{fmtMoney(debt.data.unsettled)} sin liquidar</p> : null}
            </div>
            <div className="glass p-3">
              <p className="text-sm text-muted">Última visita</p>
              <p className="text-base font-bold">{visits.data?.[0] ? fmtAgo(visits.data[0].at, now) : '—'}</p>
            </div>
          </div>
          <Tabs<DetailTab>
            label="Secciones del local"
            value={tab}
            onChange={setTab}
            options={[
              ...(firm ? [] : [{ value: 'consignacion' as const, label: 'Consignación' }]),
              ...(firm || invList.length ? [{ value: 'facturas' as const, label: 'Facturas', count: invList.length }] : []),
              { value: 'entregas', label: 'Entregas', count: deliveries.data?.length },
              { value: 'visitas', label: 'Visitas', count: visits.data?.length },
              ...(firm ? [] : [{ value: 'cuentas' as const, label: 'Cuentas' }]),
            ]}
          />
          <div className="mt-3">
            {tab === 'consignacion' ? (
              <>
                {consignment.data && consignment.data.length === 0 ? (
                  <EmptyState icon={Truck} title="Todavía no tiene producto en consignación">
                    {canWork ? 'Toca «Pedir producto» para colocarle su primera entrega.' : 'Cuando reciba su primera entrega aparecerá aquí.'}
                  </EmptyState>
                ) : null}
                <ul className="grid gap-2">
                  {(consignment.data ?? []).map((c) => (
                    <li key={c.productId} className="glass flex flex-wrap items-center justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{c.name}</p>
                        <p className="text-sm text-muted">
                          {fmtMoney(c.priceToStore)} al local · PVP {fmtMoney(c.suggestedRetail)} · el local gana {fmtMoney(c.storeEarning)}
                        </p>
                        {c.expiringQty > 0 && c.nextExpiry ? (
                          <p className="mt-1">
                            <Pill tone="warn">{c.expiringQty} vencen el {fmtDate(c.nextExpiry)}</Pill>
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold tabular">{c.qty} u.</p>
                        <p className="text-sm text-muted tabular">{fmtMoney(c.value)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                {canWork && units > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => setReturnOpen(true)}>
                      Devolución o merma
                    </Button>
                    <Button variant="ghost" onClick={() => setSalesOpen(true)}>
                      Reportar ventas sin conteo
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
            {tab === 'facturas' ? (
              <ul className="grid grid-cols-1 gap-2">
                {invList.length === 0 ? <p className="text-muted">Sin facturas todavía: nacen al recibir con firma lo que compra en firme.</p> : null}
                {invList.slice(0, 40).map((i) => (
                  <li key={i.id}>
                    <InvoiceItem inv={i} onOpen={() => setInvDetail(i)} />
                  </li>
                ))}
              </ul>
            ) : null}
            {tab === 'entregas' ? (
              <ul className="grid gap-2">
                {(deliveries.data ?? []).length === 0 ? <p className="text-muted">Sin entregas todavía.</p> : null}
                {(deliveries.data ?? []).map((d) => (
                  <li key={d.id}>
                    <DeliveryCard d={d} />
                  </li>
                ))}
              </ul>
            ) : null}
            {tab === 'visitas' ? (
              <ul className="grid gap-2">
                {(visits.data ?? []).length === 0 ? <p className="text-muted">Sin visitas todavía.</p> : null}
                {(visits.data ?? []).slice(0, 20).map((v) => {
                  const sold = v.counts.reduce((a, c) => a + (c.expected - c.counted), 0);
                  return (
                    <li key={v.id} className="glass p-3">
                      <p className="flex flex-wrap justify-between gap-2 font-semibold">
                        <span>{fmtDateTime(v.at)}</span>
                        <span className="tabular">{sold > 0 ? `${sold} vendidas por conteo` : 'Sin ventas'}</span>
                      </p>
                      {v.notes ? <p className="text-sm text-muted">{v.notes}</p> : null}
                      {v.geo ? <p className="text-xs text-faint">Con ubicación (±{v.geo.accuracy} m)</p> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {tab === 'cuentas' ? (
              <ul className="grid gap-2">
                {(settlements.data ?? []).length === 0 ? <p className="text-muted">Sin liquidaciones todavía.</p> : null}
                {(settlements.data ?? []).map((x) => (
                  <li key={x.id} className="glass flex flex-wrap items-center justify-between gap-2 p-3">
                    <div>
                      <p className="font-semibold">
                        {x.code} · {fmtDate(x.issuedAt)}
                      </p>
                      <p className="text-sm text-muted">Vence el {fmtDate(x.dueOn)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold tabular">{fmtMoney(x.amount)}</p>
                      <Pill tone={x.status === 'pagada' ? 'ok' : x.overdue ? 'danger' : 'warn'}>{x.status === 'pagada' ? 'Pagada' : x.overdue ? `Vencida · debe ${fmtMoney(x.balance)}` : `Debe ${fmtMoney(x.balance)}`}</Pill>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}

      {isAdmin && !actor.readOnly ? (
        <Section title="Estado del local">
          <div className="flex flex-wrap gap-2">
            {s.status === 'activo' ? (
              <Button icon={PauseCircle} onClick={() => setStatusSheet('pausado')}>
                Pausar
              </Button>
            ) : null}
            {s.status === 'pausado' ? (
              <Button icon={PlayCircle} onClick={() => setStatusSheet('activo')}>
                Reactivar
              </Button>
            ) : null}
            {s.status !== 'cerrado' ? (
              <Button variant="danger" icon={XCircle} onClick={() => setStatusSheet('cerrado')}>
                Cerrar local
              </Button>
            ) : (
              <Button icon={PlayCircle} onClick={() => setStatusSheet('prospecto')}>
                Reabrir como prospecto
              </Button>
            )}
          </div>
          <ol className="mt-4 grid gap-1 text-sm text-muted">
            {s.statusHistory
              .slice()
              .reverse()
              .map((h) => (
                <li key={`${h.status}-${h.at}`}>
                  {fmtDateTime(h.at)} · {STORE_STATUS_LABEL[h.status]}
                </li>
              ))}
          </ol>
        </Section>
      ) : null}

      <StatusSheet store={s} target={statusSheet} onClose={() => setStatusSheet(null)} />
      <RequestDeliverySheet open={requestOpen} onClose={() => setRequestOpen(false)} store={s} />
      <InvoiceSheet invoice={invDetail} onClose={() => setInvDetail(null)} />
      <ReturnSheet open={returnOpen} onClose={() => setReturnOpen(false)} store={s} lines={consignment.data ?? []} />
      <ReportSalesSheet open={salesOpen} onClose={() => setSalesOpen(false)} store={s} lines={consignment.data ?? []} />
    </>
  );
}

function StatusSheet({ store, target, onClose }: { store: Store; target: StoreStatus | null; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [note, setNote] = useState('');
  return (
    <Sheet open={target !== null} onClose={onClose} title={target ? `${STORE_STATUS_LABEL[target]}: ${store.name}` : ''}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!target) return;
          void run(async () => {
            await setStoreStatus(ctx, store.id, target, note);
            setNote('');
            onClose();
          }, 'Estado actualizado.');
        }}
      >
        <p className="text-muted">
          {target === 'cerrado'
            ? 'Para cerrar un local primero hay que registrar como devolución todo lo que tenga en consignación.'
            : target === 'pausado'
              ? 'Un local pausado no recibe entregas hasta que se reactive.'
              : 'El cambio queda en la auditoría.'}
        </p>
        <TextInput label="Motivo (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" variant={target === 'cerrado' ? 'danger' : 'primary'} busy={busy}>
          Confirmar
        </Button>
      </form>
    </Sheet>
  );
}
