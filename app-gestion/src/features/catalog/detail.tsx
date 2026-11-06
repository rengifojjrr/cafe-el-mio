// Ficha del producto: el tabaco grande sobre fondo oscuro (o la foto), sus variantes por capa,
// los atributos en una cuadrícula, «Ver en 3D», «Comparar con…», existencias, precios y lotes.
// Es su propia pantalla: al volver, la lista queda donde estaba y con sus filtros.
import { AlertTriangle, Box, Camera, Eye, EyeOff, PackagePlus, Pencil, Plus, Rotate3d, Ruler, ShoppingBag, Trash2, Truck } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { describeRule, storeEarning } from '../../domain/money-rules';
import { capaLabel, capaShade, cigarsPerBundle, familyKey, packText, sizeText, stockText, unitOf } from '../../domain/products';
import { KIND_LABEL, STRENGTHS, arrivalStatusLabel } from '../../lines/config';
import { fmtMoney } from '../../lib/money';
import { fmtDate, fmtRelativeDays } from '../../lib/time';
import { useAsync, useReducedMotion } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { addProductPhoto, getPhoto, getProduct, hasCost, listProducts, removeProductPhoto, setProductActive } from '../../services/catalog';
import { listLots } from '../../services/inventory';
import { CigarSilhouette, fmtLength, fmtRing } from '../../ui/brand';
import { Button, Card, ErrorBox, LinkButton, Loading, PageHeader, Pill, Section, Sheet, Stat } from '../../ui/kit';
import { PhotoPicker, ProductThumb, useStoredPhoto } from '../../ui/media';
import { useAction } from '../../ui/toast';
import { QuickOrderSheet } from '../consignment/components';
import { CapaDot, StrengthMeter } from './list';

// El visor 3D (canvas) se baja solo al tocar «Ver en 3D».
const Cigar3D = lazy(() => import('./cigar3d').then((m) => ({ default: m.Cigar3D })));

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const { ctx, actor, config, p, line } = useLine();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const reduced = useReducedMotion();
  const { data: v, error, loading } = useAsync(() => getProduct(ctx, id), [ctx, id]);
  const all = useAsync(() => listProducts(ctx, { includeInactive: actor.role === 'admin' }), [ctx, actor.role]);
  const lots = useAsync(() => (actor.role === 'admin' ? listLots(ctx) : Promise.resolve([])), [ctx, actor.role]);
  const [ordering, setOrdering] = useState(false);
  const [show3d, setShow3d] = useState(false);
  const siblings = useMemo(() => {
    if (!v) return [];
    const key = familyKey(v.product);
    return (all.data ?? []).filter((x) => familyKey(x.product) === key);
  }, [all.data, v]);
  if (loading && !v) return <Loading rows={4} />;
  if (error) return <ErrorBox error={error} />;
  if (!v) return null;
  const pr = v.product;
  const s = v.stock;
  const now = ctx.now();
  const isAdmin = actor.role === 'admin';
  const canEdit = isAdmin && !actor.readOnly;
  const myLots = (lots.data ?? []).filter((l) => l.product.id === pr.id);
  const a = pr.attrs;
  const unit = unitOf(pr);
  const isCigar = line === 'tabaco' && Boolean(a.lengthIn && a.ringGauge);
  const familyName = pr.familyName ?? pr.name;
  const perBundle = cigarsPerBundle(pr);
  const shade = String(a.wrapperShade ?? capaShade(a.capa));

  const facts: [string, React.ReactNode][] =
    line === 'tabaco'
      ? [
          ['Vitola', a.vitola ? String(a.vitola) : '—'],
          ['Medida', a.lengthIn ? `${fmtLength(Number(a.lengthIn))} × ${fmtRing(Number(a.ringGauge))}` : '—'],
          [
            'Capa',
            a.capa ? (
              <span className="inline-flex items-center gap-2">
                <CapaDot capa={a.capa} />
                {capaLabel(a.capa)}
                {a.wrapper ? <span className="text-hero-tenue">· {String(a.wrapper)}</span> : null}
              </span>
            ) : (
              '—'
            ),
          ],
          [
            'Fortaleza',
            a.strength ? (
              <span className="inline-flex items-center gap-2">
                <StrengthMeter value={a.strength} />
                {STRENGTHS.find((x) => x.value === a.strength)?.label ?? String(a.strength)}
              </span>
            ) : (
              '—'
            ),
          ],
          ['Procedencia', [a.originCountry, a.originRegion].filter(Boolean).join(' · ') || '—'],
          ...(pr.kind === 'premium'
            ? ([
                ['Marca', [a.brand, a.edition].filter(Boolean).join(' · ') || '—'],
                ['Capote', a.binder ? String(a.binder) : '—'],
                ['Tripa', a.filler ? String(a.filler) : '—'],
              ] as [string, React.ReactNode][])
            : []),
          ['Presentación', packText(pr)],
        ]
      : config.productFields.map((f) => [f.label, a[f.key] === undefined || a[f.key] === '' ? '—' : f.kind === 'select' ? (f.options.find((o) => o.value === String(a[f.key]))?.label ?? String(a[f.key])) : String(a[f.key])] as [string, React.ReactNode]).concat([['Presentación', packText(pr)]]);

  return (
    <>
      <PageHeader
        back={{ to: p('catalogo'), label: 'Catálogo' }}
        title={familyName}
        subtitle={`${pr.variantLabel ? `${pr.variantLabel} · ` : ''}SKU ${pr.sku}${pr.barcode ? ` · código ${pr.barcode}` : ''}`}
        actions={
          <>
            {actor.role === 'store' && !actor.readOnly ? (
              <Button variant="primary" icon={ShoppingBag} onClick={() => setOrdering(true)}>
                Pedir este producto
              </Button>
            ) : null}
            {canEdit ? (
              <>
                <LinkButton to={p(`catalogo/${pr.id}/editar`)} icon={Pencil}>
                  Editar
                </LinkButton>
                <LinkButton to={p(`catalogo/nuevo?de=${pr.id}`)} icon={Plus}>
                  Otra variante
                </LinkButton>
                <Button
                  variant="ghost"
                  icon={pr.active ? EyeOff : Eye}
                  busy={busy}
                  onClick={() => void run(() => setProductActive(ctx, pr.id, !pr.active), pr.active ? 'Producto desactivado.' : 'Producto activo.')}
                >
                  {pr.active ? 'Desactivar' : 'Activar'}
                </Button>
              </>
            ) : null}
          </>
        }
      />
      {!pr.active ? <p className="mb-4 rounded-xl bg-surface-2 p-3 text-sm text-muted">Este producto está inactivo: no aparece para vendedores ni locales.</p> : null}

      <section className="hero-producto mb-4 p-4 sm:p-7" aria-label={`Presentación de ${pr.name}`}>
        <div className="flex flex-wrap items-center gap-2">
          {pr.kind ? <span className="pill border-transparent bg-hero-chip text-hero-tinta">{KIND_LABEL[pr.kind]}</span> : null}
          {isCigar ? <span className="text-sm tracking-[0.18em] text-hero-tenue uppercase">{[a.vitola, sizeText(a)].filter(Boolean).join(' · ')}</span> : null}
        </div>
        <HeroImage photoIds={pr.photoIds} fallback={
          isCigar ? (
            <CigarSilhouette lengthIn={Number(a.lengthIn)} ringGauge={Number(a.ringGauge)} shade={shade} vitola={String(a.vitola ?? '')} ruler={false} className="sombra-suave mx-auto my-6 w-full max-w-3xl" />
          ) : (
            <div className="mx-auto my-4 grid h-64 max-w-md place-items-center sm:h-80">
              <ProductThumb product={pr} loadPhoto={(pid) => getPhoto(ctx, pid)} size="lg" />
            </div>
          )
        } />
        {siblings.length > 1 ? (
          <div className="mt-2">
            <p className="mb-2 text-sm text-hero-tenue">{line === 'tabaco' ? 'Capas de esta familia' : 'Variantes'}</p>
            <div className="flex flex-wrap gap-2">
              {siblings.map((sib) => (
                <Link
                  key={sib.product.id}
                  to={p(`catalogo/${sib.product.id}`)}
                  replace
                  className="chip flex-none border-hero-linea bg-hero-chip text-hero-tinta"
                  aria-current={sib.product.id === pr.id ? 'true' : undefined}
                  aria-pressed={sib.product.id === pr.id}
                >
                  {line === 'tabaco' ? <CapaDot capa={sib.product.attrs.capa} /> : null}
                  {sib.product.variantLabel || sib.product.name}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {isCigar ? (
            <Button variant="secondary" icon={Rotate3d} onClick={() => setShow3d(true)}>
              Ver en 3D
            </Button>
          ) : null}
          {isCigar ? (
            <LinkButton to={p(`catalogo/comparar?ids=${pr.id}`)} icon={Ruler}>
              Comparar con…
            </LinkButton>
          ) : null}
        </div>
        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-hero-linea pt-4 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([k, val]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs tracking-[0.14em] text-hero-tenue uppercase">{k}</dt>
              <dd className="mt-0.5 font-semibold text-hero-tinta">{val}</dd>
            </div>
          ))}
          {perBundle ? (
            <div>
              <dt className="text-xs tracking-[0.14em] text-hero-tenue uppercase">Mazo</dt>
              <dd className="mt-0.5 font-semibold text-hero-tinta">{perBundle} tabacos</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="grid content-start gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Disponible en almacén" value={s.available} tone={s.lowStock ? 'warn' : 'data'} hint={`${unit.many}${s.reserved ? ` · ${s.reserved} apartados` : ''}`} />
            <Stat
              label={actor.role === 'store' ? 'Tienes en tu local' : actor.role === 'seller' ? 'En tus locales' : 'En consignación'}
              value={s.consignment}
              hint={actor.role === 'store' ? unit.many : `${unit.many} en ${s.storesHolding} locales`}
            />
          </div>
          {perBundle && s.available > 0 ? <p className="text-sm text-muted">En el almacén: {stockText(pr, s.available)}.</p> : null}
          <Card className="p-4">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <Truck className="h-5 w-5 text-accent" aria-hidden /> Próxima llegada
            </p>
            {s.nextArrival ? (
              <p className="mt-1 text-ink">
                <span className="glow text-xl font-bold tabular">{s.nextArrival.qty}</span> {unit.many} llegan el {fmtDate(s.nextArrival.eta)},{' '}
                <span className="font-semibold">{fmtRelativeDays(s.nextArrival.eta, now)}</span>
                <span className="block text-sm text-muted">
                  {s.nextArrival.code} · {arrivalStatusLabel(line, s.nextArrival.status)}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-muted">No hay una llegada programada con este producto.</p>
            )}
            {s.lowStock ? (
              <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-warn">
                <AlertTriangle className="h-4 w-4" aria-hidden /> Stock bajo (aviso en {pr.lowStockThreshold})
              </p>
            ) : null}
          </Card>
        </div>
        <Card className="p-4">
          <h2 className="mb-2 font-bold">Precios por {unit.one}</h2>
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-muted">Precio al local</dt>
            <dd className="text-right font-semibold tabular">{fmtMoney(pr.priceToStore)}</dd>
            <dt className="text-muted">Por caja</dt>
            <dd className="text-right tabular">{fmtMoney(pr.boxPrice && pr.boxPrice > 0 ? pr.boxPrice : pr.priceToStore * pr.packSize)}</dd>
            <dt className="text-muted">PVP sugerido</dt>
            <dd className="text-right font-semibold tabular">{fmtMoney(pr.suggestedRetail)}</dd>
            <dt className="text-muted">El local gana</dt>
            <dd className="text-right font-bold tabular text-ok">{fmtMoney(storeEarning(pr))}</dd>
            {v.sellerCommissionRule ? (
              <>
                <dt className="text-muted">{actor.role === 'seller' ? 'Tu comisión' : 'Comisión del vendedor'}</dt>
                <dd className="text-right font-semibold tabular">
                  {fmtMoney(v.sellerCommissionPerUnit ?? 0)}
                  <span className="block text-xs font-normal text-muted">{describeRule(v.sellerCommissionRule)}</span>
                </dd>
              </>
            ) : null}
            {hasCost(pr) ? (
              <>
                <dt className="text-muted">Costo{pr.sampleCost ? ' (de ejemplo)' : ''}</dt>
                <dd className="text-right tabular">{fmtMoney(pr.cost)}</dd>
                <dt className="text-muted">Margen</dt>
                <dd className="text-right font-semibold tabular">{fmtMoney(pr.priceToStore - pr.cost - (v.sellerCommissionPerUnit ?? 0))}</dd>
              </>
            ) : null}
          </dl>
        </Card>
      </div>

      {pr.notes || pr.pairing ? (
        <Section title="Para saber más">
          <Card className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6">
            {pr.notes ? (
              <div>
                <h3 className="text-sm text-muted">{config.notesLabel}</h3>
                <p className="mt-1 max-w-[70ch] text-ink">{pr.notes}</p>
              </div>
            ) : null}
            {pr.pairing ? (
              <div>
                <h3 className="text-sm text-muted">{config.pairingLabel}</h3>
                <p className="mt-1 max-w-[70ch] text-ink">{pr.pairing}</p>
              </div>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {canEdit || pr.photoIds.length ? (
        <Section title="Fotos">
          <PhotoStrip productId={pr.id} photoIds={pr.photoIds} canEdit={canEdit} />
        </Section>
      ) : null}

      {isAdmin ? (
        <Section title="Lotes con existencias">
          {myLots.length === 0 ? (
            <p className="text-muted">No hay lotes con existencias.</p>
          ) : (
            <Card className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Recibido</th>
                    {line === 'cafe' ? <th>Consumir antes de</th> : null}
                    <th className="num">Costo</th>
                    <th className="num">Almacén</th>
                    <th className="num">En locales</th>
                  </tr>
                </thead>
                <tbody>
                  {myLots.map((l) => (
                    <tr key={l.lot.id}>
                      <td className="font-semibold">{l.lot.code}</td>
                      <td>{fmtDate(l.lot.receivedAt)}</td>
                      {line === 'cafe' ? (
                        <td>
                          {l.lot.bestBefore ? fmtDate(l.lot.bestBefore) : '—'}
                          {l.daysToExpiry !== undefined && l.daysToExpiry <= 30 ? (
                            <span className="ml-2">
                              <Pill tone={l.daysToExpiry < 0 ? 'danger' : 'warn'}>{l.daysToExpiry < 0 ? 'Vencido' : `${l.daysToExpiry} días`}</Pill>
                            </span>
                          ) : null}
                        </td>
                      ) : null}
                      <td className="num">{fmtMoney(l.lot.unitCost)}</td>
                      <td className="num">{l.warehouse}</td>
                      <td className="num">{l.inStores}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </Section>
      ) : null}
      {canEdit ? (
        <div className="mt-6">
          <Button variant="ghost" icon={PackagePlus} onClick={() => nav(p('almacen'))}>
            Ver llegadas y movimientos en el almacén
          </Button>
        </div>
      ) : null}
      {ordering ? <QuickOrderSheet view={v} onClose={() => setOrdering(false)} /> : null}
      <Sheet open={show3d} onClose={() => setShow3d(false)} title={`${pr.name} en 3D`} wide>
        {show3d && isCigar ? (
          reduced ? (
            <div className="hero-producto p-4">
              <CigarSilhouette lengthIn={Number(a.lengthIn)} ringGauge={Number(a.ringGauge)} shade={shade} vitola={String(a.vitola ?? '')} className="w-full" />
              <p className="mt-2 text-sm text-hero-tenue">Tienes activado «reducir movimiento»: se muestra la silueta a escala.</p>
            </div>
          ) : (
            <Suspense fallback={<div className="skeleton h-80" aria-label="Preparando el 3D" />}>
              <Cigar3D lengthIn={Number(a.lengthIn)} ringGauge={Number(a.ringGauge)} shade={shade} vitola={String(a.vitola ?? '')} label={pr.name} />
            </Suspense>
          )
        ) : null}
      </Sheet>
    </>
  );
}

/** La primera foto real, grande y con sombra suave; si no hay, la silueta o la foto de la marca. */
function HeroImage({ photoIds, fallback }: { photoIds: string[]; fallback: React.ReactNode }) {
  const { ctx } = useLine();
  const url = useStoredPhoto(photoIds[0], (pid) => getPhoto(ctx, pid));
  if (!photoIds.length) return <>{fallback}</>;
  return (
    <div className="mx-auto my-4 grid max-w-xl place-items-center">
      {url ? <img src={url} alt="Foto del producto" className="sombra-suave max-h-80 w-auto rounded-2xl object-contain" /> : <div className="skeleton h-64 w-full" aria-hidden />}
    </div>
  );
}

function PhotoStrip({ productId, photoIds, canEdit }: { productId: string; photoIds: string[]; canEdit: boolean }) {
  const { ctx } = useLine();
  const { run } = useAction();
  if (!canEdit && photoIds.length === 0) return null;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {photoIds.map((pid) => (
          <PhotoTile key={pid} id={pid} onRemove={canEdit ? () => void run(() => removeProductPhoto(ctx, productId, pid), 'Foto quitada.') : undefined} />
        ))}
        {canEdit && photoIds.length < 3 ? <PhotoPicker label="Agregar foto" onPhoto={async (ph) => void (await run(() => addProductPhoto(ctx, productId, ph), 'Foto guardada (WebP, 1600 px máx.).'))} /> : null}
      </div>
      {canEdit && photoIds.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <Camera className="h-4 w-4" aria-hidden /> Mientras no haya fotos reales, la ficha usa la silueta a escala o la foto de la marca. Hasta 3 fotos.
        </p>
      ) : null}
    </div>
  );
}

function PhotoTile({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const { ctx } = useLine();
  const url = useStoredPhoto(id, (pid) => getPhoto(ctx, pid));
  return (
    <div className="relative h-20 w-20 overflow-hidden rounded-xl border border-line bg-surface-2">
      {url ? <img src={url} alt="Foto del producto" className="h-full w-full object-cover" /> : <Box className="m-auto h-full text-faint" aria-hidden />}
      {onRemove ? (
        <button type="button" onClick={onRemove} className="absolute top-1 right-1 grid h-8 w-8 place-items-center rounded-full bg-overlay text-ink" aria-label="Quitar foto">
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
