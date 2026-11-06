// Usuarios y zonas, ajustes de la línea (con la plantilla del contrato) y auditoría.
// Solo administración: los demás roles ven un aviso, y los servicios también se niegan.
import { Lock, MapPin, Pencil, Power, Save, ScrollText, Search, Store, UserPlus, Users } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { ROLE_LABEL } from '../../app/nav';
import type { AuditEntry, CommissionRule, LineSettings, User, Zone } from '../../data/types';
import { CONTRACT_DISCLAIMER, CONTRACT_VARIABLES, annexText, parseContract, renderTemplate, type ContractBlock } from '../../domain/contract';
import { addDaysToDate, fmtDate, fmtDateTime, toIsoDate } from '../../lib/time';
import { listAudit, listUsers, readSettings, saveSettings, saveUser, saveZone, setUserActive } from '../../services/admin';
import { listProducts, type ProductView } from '../../services/catalog';
import { renameWarehouse } from '../../services/inventory';
import { listStores, listZones } from '../../services/stores';
import { Button, Card, EmptyState, ErrorBox, Field, Loading, NumberInput, PageHeader, Pill, Section, SelectInput, Sheet, TextInput } from '../../ui/kit';
import { MapView, type MapMarker } from '../../ui/map';
import { useAction } from '../../ui/toast';
import type { Market } from '../../data/types';
import { marketName, marketsOf } from '../../domain/markets';
import { listMarkets } from '../../services/markets';
import { CommissionSchemeSettings, SellerCommissionText, SellerSchemeButton } from '../red/commission';
import { InviteButton } from '../red/invite';
import { MarketSelect, MarketsSettings, RouteCostSettings } from '../red/markets';

function AdminOnly({ children }: { children: ReactNode }) {
  const { actor } = useLine();
  if (actor.role !== 'admin') {
    return (
      <EmptyState icon={Lock} title="Solo administración">
        Esta pantalla es de la oficina de la línea. Con tu cuenta no se puede abrir.
      </EmptyState>
    );
  }
  return <>{children}</>;
}

/** Convierte lo escrito en un número (vacío o inválido llega como NaN y lo rechaza la validación). */
function num(v: number | ''): number {
  return v === '' ? Number.NaN : v;
}

// ---------------------------------------------------------------------------
// Usuarios y zonas
// ---------------------------------------------------------------------------

export function UsersPage() {
  return (
    <AdminOnly>
      <UsersInner />
    </AdminOnly>
  );
}

function UsersInner() {
  const { ctx, actor, config } = useLine();
  const users = useAsync(() => listUsers(ctx), [ctx]);
  const zones = useAsync(() => listZones(ctx), [ctx]);
  const stores = useAsync(() => listStores(ctx), [ctx]);
  const markets = useAsync(() => listMarkets(ctx), [ctx]);
  const lineSettings = useAsync(() => readSettings(ctx), [ctx]);
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [zoneEditing, setZoneEditing] = useState<Zone | 'new' | null>(null);
  const canWrite = !actor.readOnly;

  if (users.loading && !users.data) return <Loading rows={5} />;
  if (users.error) return <ErrorBox error={users.error} />;

  const list = users.data ?? [];
  const zoneName = (id?: string) => zones.data?.find((z) => z.id === id)?.name ?? 'Sin zona';
  const marketList = markets.data ?? [];
  const sellerMarket = (u: User) => (marketList.length > 1 ? ` · ${marketName(marketList, u.marketId ?? zones.data?.find((z) => z.id === u.zoneId)?.marketId)}` : '');
  const storeName = (id?: string) => stores.data?.find((s) => s.store.id === id)?.store.name ?? 'Local';
  const admins = list.filter((u) => u.role === 'admin');
  const sellers = list.filter((u) => u.role === 'seller');
  const storeUsers = list.filter((u) => u.role === 'store');

  const toggle = (u: User) =>
    void run(() => setUserActive(ctx, u.id, !u.active), u.active ? `${u.name} quedó inactivo.` : `${u.name} quedó activo.`);

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle={`Quién usa la app de ${config.name}: administración, vendedores y locales.`}
        actions={
          canWrite ? (
            <Button variant="primary" icon={UserPlus} onClick={() => setEditing('new')}>
              Alta de vendedor
            </Button>
          ) : undefined
        }
      />

      <Section title={`Vendedores (${sellers.length})`}>
        {sellers.length === 0 ? (
          <EmptyState icon={Users} title="Aún no hay vendedores">
            Toca «Alta de vendedor» para dar de alta al primero, con su zona y su comisión.
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {sellers.map((u) => (
              <Card key={u.id} as="li" className="p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-accent-soft font-bold text-accent" aria-hidden>
                    {u.name
                      .split(' ')
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join('')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-ink">{u.name}</h3>
                      {u.active ? <Pill tone="ok">Activo</Pill> : <Pill>Inactivo</Pill>}
                    </div>
                    <p className="text-sm text-muted">
                      <MapPin className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                      {zoneName(u.zoneId)}
                      {sellerMarket(u)}
                    </p>
                    <SellerCommissionText user={u} lineScheme={lineSettings.data?.commissionScheme} />
                    <p className="mt-1 truncate text-sm text-muted">
                      {[u.email, u.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                    </p>
                  </div>
                </div>
                {canWrite ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button icon={Pencil} onClick={() => setEditing(u)}>
                      Editar
                    </Button>
                    <Button variant="ghost" icon={Power} busy={busy} onClick={() => toggle(u)}>
                      {u.active ? 'Desactivar' : 'Activar'}
                    </Button>
                    <SellerSchemeButton user={u} lineScheme={lineSettings.data?.commissionScheme} />
                    {u.active ? <InviteButton target={{ kind: 'seller', userId: u.id }} name={u.name} /> : null}
                  </div>
                ) : null}
              </Card>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Administración (${admins.length})`}>
        <Card as="div" className="overflow-hidden">
          <ul>
            {admins.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">
                    {u.name}
                    {u.id === actor.userId && !actor.readOnly ? <span className="text-muted"> (tú)</span> : null}
                  </p>
                  <p className="truncate text-sm text-muted">{[u.email, u.phone].filter(Boolean).join(' · ')}</p>
                </div>
                {u.active ? <Pill tone="ok">Activo</Pill> : <Pill>Inactivo</Pill>}
                {canWrite ? (
                  <Button variant="ghost" icon={Pencil} onClick={() => setEditing(u)} aria-label={`Editar a ${u.name}`} />
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section title={`Cuentas de locales (${storeUsers.length})`}>
        <p className="-mt-1 mb-3 max-w-[64ch] text-sm text-muted">
          Se crean solas cuando administración aprueba un local. El encargado entra con ella para ver su consignación, sus cuentas y pedir más.
        </p>
        {storeUsers.length === 0 ? (
          <EmptyState icon={Store} title="Todavía no hay locales aprobados">
            Cuando apruebes un local en «Locales», aparecerá aquí su cuenta.
          </EmptyState>
        ) : (
          <Card as="div" className="overflow-hidden">
            <ul>
              {storeUsers.map((u) => (
                <li key={u.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <Store className="h-5 w-5 flex-none text-accent" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{storeName(u.storeId)}</p>
                    <p className="truncate text-sm text-muted">
                      {u.name}
                      {u.email ? ` · ${u.email}` : ''}
                    </p>
                  </div>
                  {u.active ? <Pill tone="ok">Activa</Pill> : <Pill>Inactiva</Pill>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section
        title={`Zonas (${zones.data?.length ?? 0})`}
        actions={
          canWrite ? (
            <Button icon={MapPin} onClick={() => setZoneEditing('new')}>
              Agregar zona
            </Button>
          ) : undefined
        }
      >
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(zones.data ?? []).map((z) => {
            const count = sellers.filter((s) => s.zoneId === z.id).length;
            return (
              <li key={z.id}>
                <button
                  type="button"
                  disabled={!canWrite}
                  onClick={() => setZoneEditing(z)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-2 text-left hover:border-accent disabled:cursor-default disabled:hover:border-line"
                >
                  <MapPin className="h-5 w-5 flex-none text-accent" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{z.name}</span>
                    <span className="block text-sm text-muted">
                      {count === 0 ? 'Sin vendedor' : count === 1 ? '1 vendedor' : `${count} vendedores`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <UserSheet key={editing === 'new' ? 'new' : (editing?.id ?? 'none')} editing={editing} zones={zones.data ?? []} markets={marketList} onClose={() => setEditing(null)} />
      <ZoneSheet key={zoneEditing === 'new' ? 'new-zone' : (zoneEditing?.id ?? 'no-zone')} editing={zoneEditing} zones={zones.data ?? []} markets={marketList} onClose={() => setZoneEditing(null)} />
    </>
  );
}

function UserSheet({ editing, zones, markets, onClose }: { editing: User | 'new' | null; zones: Zone[]; markets: Market[]; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const user = editing && editing !== 'new' ? editing : null;
  const role: 'admin' | 'seller' = user?.role === 'admin' ? 'admin' : 'seller';
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [zoneId, setZoneId] = useState(user?.zoneId ?? '');
  const firstMarket = markets[0]?.id ?? '';
  const zoneMarket = (id: string) => zones.find((z) => z.id === id)?.marketId ?? firstMarket;
  const [marketId, setMarketId] = useState(user?.marketId ?? (user?.zoneId ? zoneMarket(user.zoneId) : firstMarket));
  const marketZones = markets.length > 1 ? zones.filter((z) => (z.marketId ?? firstMarket) === marketId) : zones;
  const [override, setOverride] = useState<'none' | CommissionRule['type']>(user?.commissionOverride?.type ?? 'none');
  const [value, setValue] = useState<number | ''>(user?.commissionOverride?.value ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const saved = await run(
      () =>
        saveUser(ctx, {
          id: user?.id,
          role,
          name,
          email,
          phone,
          zoneId: zoneId || undefined,
          marketId: role === 'seller' && markets.length > 1 ? marketId || undefined : undefined,
          commissionOverride: role === 'seller' && override !== 'none' ? { type: override, value: num(value) } : undefined,
          active: user?.active ?? true,
        }),
      user ? 'Cambios guardados.' : 'Vendedor dado de alta.',
    );
    if (saved) onClose();
  };

  return (
    <Sheet open={editing !== null} onClose={onClose} title={user ? `Editar a ${user.name}` : 'Alta de vendedor'}>
      <form noValidate className="grid gap-4" onSubmit={(e) => void submit(e)}>
        <TextInput label="Nombre completo" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="nombre@example.com" />
          <TextInput label="Teléfono" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="(305) 555-0100" />
        </div>
        {role === 'seller' ? (
          <>
            <MarketSelect
              markets={markets}
              all={false}
              value={marketId}
              onChange={(id) => {
                setMarketId(id);
                if (zoneId && zoneMarket(zoneId) !== id) setZoneId('');
              }}
            />
            <SelectInput
              label="Zona"
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              placeholder="Elige la zona"
              options={marketZones.map((z) => ({ value: z.id, label: z.name }))}
            />
            <SelectInput
              label="Comisión"
              value={override}
              onChange={(e) => setOverride(e.target.value as typeof override)}
              hint="Lo normal es «según cada producto». Una comisión especial reemplaza la de todos los productos para este vendedor."
              options={[
                { value: 'none', label: 'Según cada producto' },
                { value: 'percent', label: 'Especial: % del precio al local' },
                { value: 'fixed', label: 'Especial: monto fijo por unidad' },
              ]}
            />
            {override !== 'none' ? (
              <NumberInput
                label={override === 'percent' ? 'Porcentaje' : 'Monto por unidad (USD)'}
                value={value}
                onValue={setValue}
                min={0}
                max={override === 'percent' ? 50 : undefined}
                step={override === 'percent' ? 0.5 : 0.05}
              />
            ) : null}
          </>
        ) : null}
        <Button type="submit" variant="primary" icon={Save} busy={busy}>
          {user ? 'Guardar cambios' : 'Dar de alta'}
        </Button>
      </form>
    </Sheet>
  );
}

function ZoneSheet({ editing, zones, markets, onClose }: { editing: Zone | 'new' | null; zones: Zone[]; markets: Market[]; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const zone = editing && editing !== 'new' ? editing : null;
  const [marketId, setMarketId] = useState(zone?.marketId ?? markets[0]?.id ?? '');
  const market = markets.find((m) => m.id === marketId);
  const [name, setName] = useState(zone?.name ?? '');
  const [lat, setLat] = useState<number | ''>(zone?.lat ?? '');
  const [lng, setLng] = useState<number | ''>(zone?.lng ?? '');

  const markers: MapMarker[] = useMemo(
    () =>
      zones
        .filter((z) => z.id !== zone?.id)
        .map((z) => ({
          id: z.id,
          lat: z.lat,
          lng: z.lng,
          kind: 'seller' as const,
          title: z.name,
          label: z.name
            .split(' ')
            .map((w) => w[0])
            .slice(0, 2)
            .join(''),
        })),
    [zones, zone?.id],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const saved = await run(() => saveZone(ctx, { id: zone?.id, name, lat: num(lat), lng: num(lng), marketId: marketId || undefined }), zone ? 'Zona guardada.' : 'Zona agregada.');
    if (saved) onClose();
  };

  return (
    <Sheet open={editing !== null} onClose={onClose} title={zone ? `Zona ${zone.name}` : 'Agregar zona'} wide>
      <form noValidate className="grid gap-4" onSubmit={(e) => void submit(e)}>
        <TextInput label="Nombre de la zona" value={name} onChange={(e) => setName(e.target.value)} placeholder="Little River" required />
        <MarketSelect markets={markets} all={false} value={marketId} onChange={setMarketId} />
        <div>
          <p className="field-label mb-1.5">Centro de la zona</p>
          <p className="mb-2 text-sm text-muted">Toca el mapa para poner el punto. Las otras zonas aparecen con sus iniciales.</p>
          {editing !== null ? (
            <MapView
              label="Mapa para elegir el centro de la zona"
              className="h-64"
              markers={markers.filter((mk) => markets.length < 2 || (zones.find((z) => z.id === mk.id)?.marketId ?? markets[0]?.id) === marketId)}
              center={market ? [market.lat, market.lng] : undefined}
              zoom={market?.zoom}
              fitKey={`zonas-${marketId}-${markers.length}`}
              pick={{
                value: lat !== '' && lng !== '' ? { lat, lng } : null,
                onPick: (pt) => {
                  setLat(pt.lat);
                  setLng(pt.lng);
                },
              }}
            />
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <NumberInput label="Latitud" value={lat} onValue={setLat} step={0.0001} />
          <NumberInput label="Longitud" value={lng} onValue={setLng} step={0.0001} />
        </div>
        <Button type="submit" variant="primary" icon={Save} busy={busy}>
          {zone ? 'Guardar zona' : 'Agregar zona'}
        </Button>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Ajustes de la línea
// ---------------------------------------------------------------------------

export function SettingsPage() {
  return (
    <AdminOnly>
      <SettingsInner />
    </AdminOnly>
  );
}

function SettingsInner() {
  const { ctx } = useLine();
  const settings = useAsync(() => readSettings(ctx), [ctx]);
  const products = useAsync(() => listProducts(ctx), [ctx]);
  if (settings.loading && !settings.data) return <Loading rows={5} />;
  if (settings.error) return <ErrorBox error={settings.error} />;
  if (!settings.data) return null;
  return (
    <>
      <SettingsForm settings={settings.data} products={products.data ?? []} />
      {/* Ronda 3: cada sección se guarda sola. */}
      <CommissionSchemeSettings scheme={settings.data.commissionScheme} />
      <MarketsSettings markets={marketsOf(settings.data)} />
      <RouteCostSettings value={settings.data.routeCostPerKm} />
    </>
  );
}

function SettingsForm({ settings, products }: { settings: LineSettings; products: ProductView[] }) {
  const { ctx, actor, config, line } = useLine();
  const { run, busy } = useAction();
  const templateId = useId();
  const taRef = useRef<HTMLTextAreaElement>(null);

  const [companyName, setCompanyName] = useState(settings.companyName);
  const [warehouseName, setWarehouseName] = useState(settings.warehouseName);
  const [settlementEveryDays, setSettlementEveryDays] = useState<number | ''>(settings.settlementEveryDays);
  const [paymentTermsDays, setPaymentTermsDays] = useState<number | ''>(settings.paymentTermsDays);
  const [payableOn, setPayableOn] = useState<LineSettings['commissionPayableOn']>(settings.commissionPayableOn);
  const [ruleType, setRuleType] = useState<CommissionRule['type']>(settings.defaultSellerCommission.type);
  const [ruleValue, setRuleValue] = useState<number | ''>(settings.defaultSellerCommission.value);
  const [defaultLowStock, setDefaultLowStock] = useState<number | ''>(settings.defaultLowStock);
  const [expiryWarningDays, setExpiryWarningDays] = useState<number | ''>(settings.expiryWarningDays);
  const [noRotationDays, setNoRotationDays] = useState<number | ''>(settings.noRotationDays);
  const [contractTermMonths, setContractTermMonths] = useState<number | ''>(settings.contractTermMonths);
  const [terminationNoticeDays, setTerminationNoticeDays] = useState<number | ''>(settings.terminationNoticeDays);
  const [template, setTemplate] = useState(settings.contractTemplate);

  const templateChanged = template !== settings.contractTemplate;
  const isCafe = config.inbound === 'roast';

  const insertVar = (key: string) => {
    const token = `{{${key}}}`;
    const ta = taRef.current;
    const start = ta?.selectionStart ?? template.length;
    const end = ta?.selectionEnd ?? template.length;
    setTemplate(template.slice(0, start) + token + template.slice(end));
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const preview = useMemo(() => {
    const today = new Date();
    const sample = products.slice(0, 3).map((v) => ({
      productId: v.product.id,
      name: v.product.name,
      sku: v.product.sku,
      priceToStore: v.product.priceToStore,
      suggestedRetail: v.product.suggestedRetail,
      storeEarning: v.storeEarning,
    }));
    const vars: Record<string, string> = {
      'contrato.version': '1',
      fecha: fmtDate(today),
      'empresa.nombre': companyName || settings.companyName,
      'empresa.representante': 'Vendedor de ejemplo',
      'local.nombre': 'Tienda de ejemplo',
      'local.tipo': (config.storeTypes[0] ?? 'tienda').toLowerCase(),
      'local.direccion': '123 Calle Muestra (dirección de ejemplo), Miami, FL',
      'local.encargado': 'Encargado de ejemplo',
      'local.telefono': '(305) 555-0100',
      'local.correo': 'tienda@example.com',
      'liquidacion.dias': String(settlementEveryDays),
      'pago.dias': String(paymentTermsDays),
      'vigencia.meses': String(contractTermMonths),
      'aviso.dias': String(terminationNoticeDays),
      'anexo.productos': annexText(sample, config.unitName.one),
    };
    if (line === 'tabaco') {
      vars['permiso.numero'] = 'TP-DEMO-00000';
      vars['permiso.vence'] = fmtDate(addDaysToDate(toIsoDate(today), 365));
    }
    const r = renderTemplate(template, vars);
    return { blocks: parseContract(r.text), missing: r.missing };
  }, [template, companyName, settings.companyName, settlementEveryDays, paymentTermsDays, contractTermMonths, terminationNoticeDays, products, config, line]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await run(async () => {
      await saveSettings(ctx, {
        companyName,
        settlementEveryDays: num(settlementEveryDays),
        paymentTermsDays: num(paymentTermsDays),
        commissionPayableOn: payableOn,
        defaultSellerCommission: { type: ruleType, value: num(ruleValue) },
        defaultLowStock: num(defaultLowStock),
        expiryWarningDays: num(expiryWarningDays),
        noRotationDays: num(noRotationDays),
        contractTermMonths: num(contractTermMonths),
        terminationNoticeDays: num(terminationNoticeDays),
        contractTemplate: template,
      });
      if (warehouseName.trim() !== settings.warehouseName) await renameWarehouse(ctx, warehouseName);
    }, 'Ajustes guardados.');
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)}>
      <PageHeader
        title="Ajustes"
        subtitle={`Reglas de ${config.name}: liquidaciones, comisiones, avisos y la plantilla del contrato.`}
        actions={
          <Button type="submit" variant="primary" icon={Save} busy={busy} disabled={actor.readOnly}>
            Guardar ajustes
          </Button>
        }
      />
      <fieldset disabled={actor.readOnly} className="m-0 min-w-0 border-0 p-0">
        <Section title="Empresa y almacén">
          <Card className="grid gap-4 p-5 md:grid-cols-2">
            <TextInput label="Razón social" value={companyName} onChange={(e) => setCompanyName(e.target.value)} hint="Aparece en el contrato como «la Empresa»." />
            <TextInput label="Nombre del almacén" value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} hint="Se ve en el catálogo y en el mapa." />
          </Card>
        </Section>

        <Section title="Liquidaciones y cobros">
          <Card className="grid gap-4 p-5 md:grid-cols-2">
            <NumberInput label="Liquidar cada (días)" value={settlementEveryDays} onValue={setSettlementEveryDays} min={7} max={60} step={1} hint="Lo vendido se liquida con esta frecuencia." />
            <NumberInput label="Días para pagar cada liquidación" value={paymentTermsDays} onValue={setPaymentTermsDays} min={0} max={60} step={1} hint="Pasado este plazo, el saldo queda vencido." />
          </Card>
        </Section>

        <Section title="Comisiones de los vendedores">
          <Card className="grid gap-4 p-5 md:grid-cols-2">
            <SelectInput
              label="La comisión se puede pagar"
              value={payableOn}
              onChange={(e) => setPayableOn(e.target.value as LineSettings['commissionPayableOn'])}
              hint="Al cobrar es lo más prudente: el vendedor cobra cuando el local ya pagó."
              options={[
                { value: 'cobro', label: 'Cuando el local paga la liquidación' },
                { value: 'venta', label: 'En cuanto se reporta la venta' },
              ]}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectInput
                label="Comisión por defecto"
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value as CommissionRule['type'])}
                hint="Se propone al crear productos nuevos."
                options={[
                  { value: 'percent', label: '% del precio al local' },
                  { value: 'fixed', label: 'Monto fijo por unidad' },
                ]}
              />
              <NumberInput
                label={ruleType === 'percent' ? 'Porcentaje' : 'USD por unidad'}
                value={ruleValue}
                onValue={setRuleValue}
                min={0}
                max={ruleType === 'percent' ? 50 : undefined}
                step={ruleType === 'percent' ? 0.5 : 0.05}
              />
            </div>
          </Card>
        </Section>

        <Section title="Umbrales y avisos">
          <Card className="grid gap-4 p-5 md:grid-cols-3">
            <NumberInput label="Stock bajo por defecto (unidades)" value={defaultLowStock} onValue={setDefaultLowStock} min={0} step={1} hint="Cada producto puede tener el suyo." />
            {isCafe ? (
              <NumberInput label="Avisar café por vencer con (días)" value={expiryWarningDays} onValue={setExpiryWarningDays} min={1} max={180} step={1} hint="Lotes en almacén que vencen antes de este plazo." />
            ) : null}
            <NumberInput label="Días sin ventas para «no rota»" value={noRotationDays} onValue={setNoRotationDays} min={7} max={120} step={1} hint="Locales con producto y sin ventas en ese tiempo." />
          </Card>
        </Section>

        <Section title="Contrato de consignación">
          <Card className="grid gap-4 p-5 md:grid-cols-2">
            <NumberInput label="Vigencia (meses)" value={contractTermMonths} onValue={setContractTermMonths} min={1} max={60} step={1} />
            <NumberInput label="Aviso para terminarlo (días)" value={terminationNoticeDays} onValue={setTerminationNoticeDays} min={0} max={120} step={1} />
          </Card>

          <Card className="mt-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-ink">Plantilla</h3>
              <Pill tone="accent">Versión {settings.contractTemplateVersion}</Pill>
              {templateChanged ? <Pill tone="warn">Cambios sin guardar: será la versión {settings.contractTemplateVersion + 1}</Pill> : null}
            </div>
            <p className="mt-1 max-w-[70ch] text-sm text-muted">
              Los contratos nuevos salen con la plantilla guardada. Los que ya están firmados no cambian. Al principio de la línea, «#» marca el título, «##» cada sección y «-» las viñetas, seguidos de un espacio. Tiene que conservar el aviso: «{CONTRACT_DISCLAIMER}»
            </p>
            <p className="mt-4 mb-2 text-sm font-semibold text-ink">Toca una variable para ponerla donde está el cursor</p>
            <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-wrap lg:overflow-visible">
              {Object.entries(CONTRACT_VARIABLES).map(([key, desc]) => (
                <button
                  key={key}
                  type="button"
                  title={desc}
                  onClick={() => insertVar(key)}
                  className="flex min-h-12 flex-none flex-col justify-center rounded-xl border border-line bg-surface-2 px-3 py-1 text-left hover:border-accent"
                >
                  <span className="text-sm font-semibold whitespace-nowrap text-accent">{`{{${key}}}`}</span>
                  <span className="text-xs whitespace-nowrap text-muted">{desc}</span>
                </button>
              ))}
            </div>
            <div className="mt-3">
              <Field label="Texto de la plantilla" htmlFor={templateId} hint="Las variables entre llaves dobles se llenan con los datos del local al emitir cada contrato.">
                <textarea
                  id={templateId}
                  ref={taRef}
                  className="input min-h-[420px] font-mono text-sm leading-relaxed"
                  value={template}
                  spellCheck={false}
                  onChange={(e) => setTemplate(e.target.value)}
                />
              </Field>
            </div>
          </Card>

          <Card className="mt-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-ink">Vista previa con datos de ejemplo</h3>
              {preview.missing.length ? (
                <Pill tone="danger">Variables que no existen: {preview.missing.map((m) => `{{${m}}}`).join(', ')}</Pill>
              ) : (
                <Pill tone="ok">Todas las variables tienen valor</Pill>
              )}
            </div>
            <article className="mt-4 max-h-[560px] overflow-y-auto rounded-2xl border border-papel-linea bg-papel p-5 text-papel-tinta sm:p-8" aria-label="Vista previa del contrato">
              <ContractBlocks blocks={preview.blocks} />
            </article>
          </Card>
        </Section>

        <div className="mt-6 flex justify-end">
          <Button type="submit" variant="primary" big icon={Save} busy={busy} disabled={actor.readOnly}>
            Guardar ajustes
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function ContractBlocks({ blocks }: { blocks: ContractBlock[] }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${key}`} className="my-2 list-disc space-y-1 pl-5">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  blocks.forEach((b, i) => {
    if (b.kind === 'bullet') {
      bullets.push(b.text);
      return;
    }
    flush(String(i));
    if (b.kind === 'title') out.push(<h4 key={i} className="font-display text-2xl leading-tight font-semibold">{b.text}</h4>);
    else if (b.kind === 'heading') out.push(<h5 key={i} className="mt-5 mb-1 font-bold">{b.text}</h5>);
    else if (b.kind === 'note') out.push(<p key={i} className="my-3 rounded-xl border border-papel-linea px-3 py-2 text-sm font-semibold">{b.text}</p>);
    else out.push(<p key={i} className="my-2 leading-relaxed">{b.text}</p>);
  });
  flush('end');
  return <>{out}</>;
}

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------

export function AuditPage() {
  return (
    <AdminOnly>
      <AuditInner />
    </AdminOnly>
  );
}

function roleLabel(role: AuditEntry['role']): string {
  return role === 'sistema' ? 'Sistema' : ROLE_LABEL[role];
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function AuditInner() {
  const { ctx } = useLine();
  const list = useAsync(() => listAudit(ctx, 500), [ctx]);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const term = normalize(q.trim());
    const all = list.data ?? [];
    if (!term) return all;
    return all.filter((e) => normalize(`${e.actorName} ${roleLabel(e.role)} ${e.action} ${e.summary}`).includes(term));
  }, [list.data, q]);

  return (
    <>
      <PageHeader title="Auditoría" subtitle="Quién hizo qué y cuándo en esta línea. Solo se agrega: nadie puede editar ni borrar entradas." />
      <div className="max-w-md">
        <Field label="Buscar" htmlFor="buscar-auditoria" hint={list.data ? `${filtered.length} de ${list.data.length} entradas (las más recientes primero).` : undefined}>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
            <input
              id="buscar-auditoria"
              className="input pl-10"
              type="search"
              placeholder="Persona, acción o local"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </Field>
      </div>

      <Section title="Registro">
        {list.loading && !list.data ? (
          <Loading rows={5} />
        ) : list.error ? (
          <ErrorBox error={list.error} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={ScrollText} title={q ? 'Nada coincide con la búsqueda' : 'Todavía no hay entradas'}>
            {q ? 'Prueba con otro nombre o palabra.' : 'Cada cambio que se haga en la línea queda anotado aquí.'}
          </EmptyState>
        ) : (
          <>
            <Card as="div" className="hidden overflow-x-auto md:block">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Fecha y hora</th>
                    <th scope="col">Quién</th>
                    <th scope="col">Rol</th>
                    <th scope="col">Acción</th>
                    <th scope="col">Resumen</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.seq ?? e.id}>
                      <td className="whitespace-nowrap text-muted tabular">{fmtDateTime(e.at)}</td>
                      <td className="font-semibold whitespace-nowrap">{e.actorName}</td>
                      <td className="whitespace-nowrap text-muted">{roleLabel(e.role)}</td>
                      <td>
                        <span className="pill">{e.action}</span>
                      </td>
                      <td className="min-w-[18rem]">{e.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card as="div" className="overflow-hidden md:hidden">
              <ul>
                {filtered.map((e) => (
                  <li key={e.seq ?? e.id} className="border-b border-line px-4 py-3 last:border-b-0">
                    <p className="text-ink">{e.summary}</p>
                    <p className="mt-1 text-sm text-muted">
                      {e.actorName} · {roleLabel(e.role)}
                    </p>
                    <p className="text-xs text-muted tabular">
                      {fmtDateTime(e.at)} · {e.action}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </Section>
    </>
  );
}
