// Mensajes por hilos, comunicados y la campana de avisos.
// - Vendedor: escribe a administración y a sus locales.
// - Local: escribe a su vendedor; a administración solo si su vendedor no contestó en 24 h.
// - Administración: escribe a cualquier vendedor, manda comunicados y ve todas las conversaciones.
import {
  AlarmClock,
  AlertTriangle,
  Bell,
  Camera,
  CheckCheck,
  CircleCheck,
  ClipboardList,
  Coffee,
  Coins,
  FilePen,
  FileText,
  Hourglass,
  Megaphone,
  MessageCircle,
  MessageSquarePlus,
  MessagesSquare,
  Package,
  PackageCheck,
  PackageMinus,
  Paperclip,
  Receipt,
  Send,
  Ship,
  ShoppingBag,
  Store,
  Truck,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { ROLE_LABEL } from '../../app/nav';
import type { Announcement, AppNotification, Message, NotificationKind, Thread, User } from '../../data/types';
import { compressImage, type NewPhoto } from '../../lib/image';
import { fmtAgo, fmtDate, fmtDateTime, fmtTime, toIsoDate } from '../../lib/time';
import { getPhoto, listProducts, type ProductView } from '../../services/catalog';
import { inventoryAlerts, type InventoryAlert } from '../../services/inventory';
import {
  createAnnouncement,
  escalationStatus,
  getMessagePhoto,
  getThread,
  listAnnouncements,
  listNotifications,
  listThreads,
  markNotificationsRead,
  markThreadRead,
  openThread,
  sendMessage,
  type ThreadView,
} from '../../services/messages';
import { listSellers, listStores } from '../../services/stores';
import { Button, Card, EmptyState, ErrorBox, Loading, PageHeader, Pill, Section, SelectInput, Sheet, TextArea, TextInput } from '../../ui/kit';
import { ProductThumb, useStoredPhoto } from '../../ui/media';
import { errorText, useAction, useToast } from '../../ui/toast';

const KIND_LABEL: Record<Thread['kind'], string> = {
  admin_vendedor: 'Administración y vendedor',
  vendedor_local: 'Vendedor y local',
  local_admin: 'Local y administración',
};

const AUDIENCE_LABEL: Record<Announcement['audience'], string> = {
  vendedores: 'Para vendedores',
  locales: 'Para locales',
  todos: 'Para todo el equipo',
};

function initials(text: string): string {
  const words = text
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^\p{Lu}/u.test(w));
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '·';
}

// ---------------------------------------------------------------------------
// Lista de conversaciones y comunicados
// ---------------------------------------------------------------------------

export function MessagesPage() {
  const { ctx, actor, p } = useLine();
  const nav = useNavigate();
  const threads = useAsync(() => listThreads(ctx), [ctx]);
  const announcements = useAsync(() => listAnnouncements(ctx), [ctx]);
  const escalation = useAsync(
    () => (actor.role === 'store' && actor.storeId ? escalationStatus(ctx, actor.storeId) : Promise.resolve(null)),
    [ctx, actor.role, actor.storeId],
  );
  const { run, busy } = useAction();
  const [sheet, setSheet] = useState<'store' | 'seller' | 'announce' | null>(null);
  const canWrite = !actor.readOnly;

  const open = async (target: Parameters<typeof openThread>[1]) => {
    const t = await run(() => openThread(ctx, target));
    if (t) {
      setSheet(null);
      nav(p(`mensajes/${t.id}`));
    }
  };

  const subtitle =
    actor.role === 'admin'
      ? 'Conversaciones con vendedores y locales, y los comunicados al equipo.'
      : actor.role === 'seller'
        ? 'Habla con administración y con tus locales.'
        : 'Habla con tu vendedor. Si no contesta en 24 horas, puedes escribirle a administración.';

  const list = threads.data ?? [];
  const mine = actor.role === 'admin' ? list.filter((t) => t.participantIds.includes(actor.userId)) : list;
  const watching = actor.role === 'admin' ? list.filter((t) => !t.participantIds.includes(actor.userId)) : [];

  return (
    <>
      <PageHeader title="Mensajes" subtitle={subtitle} />

      {canWrite ? (
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          {actor.role === 'seller' ? (
            <>
              <Button variant="primary" icon={MessageSquarePlus} busy={busy} onClick={() => void open({ kind: 'admin' })}>
                Escribir a administración
              </Button>
              <Button icon={Store} onClick={() => setSheet('store')}>
                Escribir a un local
              </Button>
            </>
          ) : null}
          {actor.role === 'store' ? (
            <>
              <Button variant="primary" icon={MessageSquarePlus} busy={busy} onClick={() => void open({ kind: 'seller' })}>
                Escribir a mi vendedor
              </Button>
              <Button icon={UserRound} disabled={!escalation.data?.allowed} onClick={() => void open({ kind: 'admin' })}>
                Escribir a administración
              </Button>
            </>
          ) : null}
          {actor.role === 'admin' ? (
            <>
              <Button variant="primary" icon={MessageSquarePlus} onClick={() => setSheet('seller')}>
                Escribir a un vendedor
              </Button>
              <Button icon={Megaphone} onClick={() => setSheet('announce')}>
                Nuevo comunicado
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {actor.role === 'store' && escalation.data && !escalation.data.allowed ? (
        <p className="mt-2 max-w-[60ch] text-sm text-muted" data-testid="escalado">
          {escalation.data.reason}
        </p>
      ) : null}
      {actor.role === 'store' && escalation.data?.allowed ? (
        <p className="mt-2 max-w-[60ch] text-sm text-warn" data-testid="escalado">
          {escalation.data.reason} Ya puedes escribirle a administración.
        </p>
      ) : null}

      <Section title={actor.role === 'admin' ? 'Tus conversaciones' : 'Conversaciones'}>
        {threads.loading && !threads.data ? (
          <Loading rows={3} />
        ) : threads.error ? (
          <ErrorBox error={threads.error} />
        ) : mine.length === 0 ? (
          <EmptyState icon={MessagesSquare} title="Todavía no hay conversaciones">
            {actor.role === 'store'
              ? 'Toca «Escribir a mi vendedor» para pedirle algo o hacerle una pregunta.'
              : actor.role === 'seller'
                ? 'Toca «Escribir a administración» o «Escribir a un local» para empezar.'
                : 'Toca «Escribir a un vendedor» para empezar una conversación.'}
          </EmptyState>
        ) : (
          <Card className="overflow-hidden" as="div">
            <ul>
              {mine.map((t) => (
                <ThreadRow key={t.id} thread={t} />
              ))}
            </ul>
          </Card>
        )}
      </Section>

      {watching.length ? (
        <Section title="Entre vendedores y locales">
          <p className="-mt-1 mb-3 text-sm text-muted">Administración las ve para estar al tanto; escriben el vendedor y el local.</p>
          <Card className="overflow-hidden" as="div">
            <ul>
              {watching.map((t) => (
                <ThreadRow key={t.id} thread={t} />
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      <Section
        title="Comunicados"
        actions={
          actor.role === 'admin' && canWrite ? (
            <Button variant="ghost" icon={Megaphone} onClick={() => setSheet('announce')}>
              Nuevo comunicado
            </Button>
          ) : undefined
        }
      >
        {announcements.loading && !announcements.data ? (
          <Loading rows={2} />
        ) : announcements.error ? (
          <ErrorBox error={announcements.error} />
        ) : (announcements.data ?? []).length === 0 ? (
          <EmptyState icon={Megaphone} title="Sin comunicados">
            {actor.role === 'admin' ? 'Toca «Nuevo comunicado» para avisarle algo a todo el equipo.' : 'Aquí aparecen los avisos de administración para todo el equipo.'}
          </EmptyState>
        ) : (
          <ul className="grid gap-3">
            {(announcements.data ?? []).map((a) => (
              <Card key={a.id} as="li" className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Megaphone className="h-4 w-4 text-accent" aria-hidden />
                  <h3 className="font-bold text-ink">{a.title}</h3>
                  <span className="ml-auto text-sm text-muted">{fmtDate(a.at)}</span>
                </div>
                <p className="mt-1.5 max-w-[70ch] text-ink">{a.body}</p>
                <div className="mt-2">
                  <Pill tone="accent">{AUDIENCE_LABEL[a.audience]}</Pill>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </Section>

      <StorePickSheet open={sheet === 'store'} onClose={() => setSheet(null)} onPick={(storeId) => void open({ kind: 'store', storeId })} />
      <SellerPickSheet open={sheet === 'seller'} onClose={() => setSheet(null)} onPick={(sellerId) => void open({ kind: 'sellerById', sellerId })} />
      <AnnouncementSheet open={sheet === 'announce'} onClose={() => setSheet(null)} />
    </>
  );
}

function ThreadRow({ thread: t }: { thread: ThreadView }) {
  const { p, actor } = useLine();
  const last = t.lastMessage;
  const preview = last
    ? `${last.authorId === actor.userId ? 'Tú: ' : ''}${last.text || (last.photoId ? 'Foto' : last.productId ? 'Producto adjunto' : '')}`
    : 'Sin mensajes todavía';
  return (
    <li>
      <Link to={p(`mensajes/${t.id}`)} className="row-link" data-testid="hilo">
        <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent" aria-hidden>
          {initials(t.otherNames.split(',')[0] || t.title)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`truncate ${t.unread ? 'font-bold' : 'font-semibold'} text-ink`}>{t.title}</span>
            <span className="ml-auto flex-none text-xs text-muted">{last ? fmtAgo(last.at, new Date()) : ''}</span>
          </span>
          <span className="block truncate text-sm text-muted">
            {KIND_LABEL[t.kind]}
            {t.otherNames ? ` · ${t.otherNames}` : ''}
          </span>
          <span className={`block truncate text-sm ${t.unread ? 'font-semibold text-ink' : 'text-muted'}`}>{preview}</span>
        </span>
        {t.unread ? (
          <span className="grid h-6 min-w-6 flex-none place-items-center rounded-full bg-accent px-1.5 text-xs font-bold text-accent-ink tabular" aria-label={`${t.unread} sin leer`}>
            {t.unread}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function StorePickSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (storeId: string) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Escribir a un local">
      {open ? <StorePickList onPick={onPick} /> : null}
    </Sheet>
  );
}

function StorePickList({ onPick }: { onPick: (storeId: string) => void }) {
  const { ctx } = useLine();
  const stores = useAsync(() => listStores(ctx), [ctx]);
  if (stores.loading && !stores.data) return <Loading rows={3} />;
  if (stores.error) return <ErrorBox error={stores.error} />;
  const list = stores.data ?? [];
  if (list.length === 0) {
    return (
      <EmptyState icon={Store} title="Aún no tienes tiendas">
        Toca «Registrar tienda» en tus locales para inscribir la primera.
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-2">
      {list.map((v) => {
        const hasAccount = Boolean(v.store.approvedAt);
        return (
          <li key={v.store.id}>
            <button
              type="button"
              disabled={!hasAccount}
              onClick={() => onPick(v.store.id)}
              className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-2 text-left hover:border-accent disabled:cursor-not-allowed disabled:opacity-55"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold text-ink">{v.store.name}</span>
                <span className="block truncate text-sm text-muted">{hasAccount ? `${v.store.managerName} · ${v.zoneName}` : 'Todavía sin cuenta: se crea cuando administración aprueba el local.'}</span>
              </span>
              <MessageCircle className="h-5 w-5 flex-none text-accent" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SellerPickSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (sellerId: string) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Escribir a un vendedor">
      {open ? <SellerPickList onPick={onPick} /> : null}
    </Sheet>
  );
}

function SellerPickList({ onPick }: { onPick: (sellerId: string) => void }) {
  const { ctx } = useLine();
  const sellers = useAsync(() => listSellers(ctx), [ctx]);
  if (sellers.loading && !sellers.data) return <Loading rows={3} />;
  if (sellers.error) return <ErrorBox error={sellers.error} />;
  return (
    <ul className="grid gap-2">
      {(sellers.data ?? []).map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onPick(s.id)}
            className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-2 text-left hover:border-accent"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent" aria-hidden>
                {initials(s.name)}
              </span>
              <span className="truncate font-semibold text-ink">{s.name}</span>
            </span>
            <MessageCircle className="h-5 w-5 flex-none text-accent" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function AnnouncementSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Announcement['audience']>('todos');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => createAnnouncement(ctx, { title, body, audience }), 'Comunicado enviado.');
    if (ok) {
      setTitle('');
      setBody('');
      setAudience('todos');
      onClose();
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Nuevo comunicado">
      <form noValidate className="grid gap-4" onSubmit={(e) => void submit(e)}>
        <p className="text-muted">Le llega como aviso a cada persona y queda en «Comunicados».</p>
        <TextInput label="Título" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Llega la tanda del jueves" maxLength={90} required />
        <TextArea label="Texto" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={2000} required />
        <SelectInput
          label="Para quién"
          value={audience}
          onChange={(e) => setAudience(e.target.value as Announcement['audience'])}
          options={[
            { value: 'todos', label: 'Todo el equipo (vendedores y locales)' },
            { value: 'vendedores', label: 'Solo vendedores' },
            { value: 'locales', label: 'Solo locales' },
          ]}
        />
        <Button type="submit" variant="primary" icon={Send} busy={busy}>
          Enviar comunicado
        </Button>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Una conversación
// ---------------------------------------------------------------------------

export function ThreadPage() {
  const { id = '' } = useParams();
  const { ctx, actor, p } = useLine();
  const data = useAsync(() => getThread(ctx, id), [ctx, id]);
  const products = useAsync(() => listProducts(ctx), [ctx]);

  const thread = data.data?.thread;
  const messages = useMemo(() => data.data?.messages ?? [], [data.data]);
  const last = messages[messages.length - 1];
  const participates = thread ? thread.participantIds.includes(actor.userId) : false;

  // Marcar como leído al abrir y cuando llegan mensajes nuevos.
  useEffect(() => {
    if (!thread || !last || actor.readOnly || !participates) return;
    if ((thread.readBy[actor.userId] ?? '') >= last.at) return;
    void markThreadRead(ctx, thread.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id, thread?.id]);

  // Bajar hasta el último mensaje (la caja de escribir queda debajo, sin taparlo).
  useEffect(() => {
    if (!last) return;
    const id = requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
    return () => cancelAnimationFrame(id);
  }, [last?.id, last]);

  if (data.loading && !data.data) return <Loading rows={4} />;
  if (data.error) return <ErrorBox error={data.error} />;
  if (!data.data || !thread) return null;

  const { authors } = data.data;
  const productsById = new Map((products.data ?? []).map((v) => [v.product.id, v]));
  const others = thread.participantIds
    .filter((uid) => uid !== actor.userId)
    .map((uid) => authors.get(uid))
    .filter((u): u is User => Boolean(u));

  let lastDay = '';
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ to: p('mensajes'), label: 'Mensajes' }}
        title={thread.title}
        subtitle={`${KIND_LABEL[thread.kind]}${others.length ? ` · ${others.map((u) => u.name).join(', ')}` : ''}`}
      />

      {messages.length === 0 ? (
        <EmptyState icon={MessageCircle} title="Escribe el primer mensaje">
          {participates && !actor.readOnly ? 'Usa la caja de abajo. Puedes adjuntar una foto o un producto del catálogo.' : 'Esta conversación todavía no tiene mensajes.'}
        </EmptyState>
      ) : (
        <ol className="grid gap-2.5" aria-label="Mensajes de la conversación">
          {messages.map((m) => {
            const day = toIsoDate(m.at);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <MessageItem
                key={m.id}
                message={m}
                author={authors.get(m.authorId)}
                mine={m.authorId === actor.userId}
                dayLabel={showDay ? fmtDate(m.at) : undefined}
                product={m.productId ? productsById.get(m.productId) : undefined}
              />
            );
          })}
        </ol>
      )}

      {actor.readOnly ? (
        <p className="mt-6 rounded-2xl border border-line bg-surface-2 p-4 text-sm text-muted">Estás en modo «solo mirar»: aquí no se puede escribir.</p>
      ) : !participates ? (
        <p className="mt-6 rounded-2xl border border-line bg-surface-2 p-4 text-sm text-muted">
          Esta conversación es entre el vendedor y el local. Administración la ve para estar al tanto, pero no escribe aquí.
        </p>
      ) : (
        <Composer threadId={thread.id} products={products.data ?? []} />
      )}
    </div>
  );
}

function MessageItem({
  message: m,
  author,
  mine,
  dayLabel,
  product,
}: {
  message: Message;
  author?: User;
  mine: boolean;
  dayLabel?: string;
  product?: ProductView;
}) {
  return (
    <>
      {dayLabel ? (
        <li className="my-2 text-center text-xs font-semibold text-muted" aria-hidden>
          {dayLabel}
        </li>
      ) : null}
      <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`} data-testid="mensaje">
        <div className={`max-w-[85%] rounded-2xl border border-line px-4 py-2.5 sm:max-w-[75%] ${mine ? 'rounded-br-md bg-accent-soft' : 'rounded-bl-md bg-surface-2'}`}>
          {!mine ? (
            <p className="text-sm font-bold text-accent">
              {author?.name ?? 'Alguien'}
              {author ? <span className="font-medium text-muted"> · {ROLE_LABEL[author.role]}</span> : null}
            </p>
          ) : null}
          {m.text ? <p className="whitespace-pre-wrap break-words text-ink">{m.text}</p> : null}
          {m.photoId ? <MessagePhoto photoId={m.photoId} /> : null}
          {m.productId ? <ProductAttachment productId={m.productId} view={product} /> : null}
          <p className="mt-1 text-right text-xs text-muted" title={fmtDateTime(m.at)}>
            {fmtTime(m.at)}
          </p>
        </div>
      </li>
    </>
  );
}

function MessagePhoto({ photoId }: { photoId: string }) {
  const { ctx } = useLine();
  const url = useStoredPhoto(photoId, (id) => getMessagePhoto(ctx, id));
  if (!url) return <div className="skeleton mt-2 h-40 w-56" aria-label="Cargando la foto" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-2 block">
      <img src={url} alt="Foto adjunta" className="max-h-72 rounded-xl border border-line object-cover" loading="lazy" />
    </a>
  );
}

function ProductAttachment({ productId, view }: { productId: string; view?: ProductView }) {
  const { ctx, p } = useLine();
  return (
    <Link to={p(`catalogo/${productId}`)} className="mt-2 flex items-center gap-3 rounded-xl border border-line bg-surface p-2 hover:border-accent">
      <span className="h-14 w-16 flex-none overflow-hidden rounded-lg bg-surface-2">
        {view ? <ProductThumb product={view.product} loadPhoto={(id) => getPhoto(ctx, id)} /> : <Package className="m-4 h-6 w-6 text-faint" aria-hidden />}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold text-ink">{view?.product.name ?? 'Producto'}</span>
        <span className="block text-sm text-muted">Ver en el catálogo</span>
      </span>
    </Link>
  );
}

function Composer({ threadId, products }: { threadId: string; products: ProductView[] }) {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<NewPhoto | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [pickProduct, setPickProduct] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo.blob) : null), [photo]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const product = productId ? products.find((v) => v.product.id === productId) : undefined;
  const canSend = Boolean(text.trim() || photo || productId);

  const grow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    const ok = await run(() => sendMessage(ctx, threadId, { text: text.trim(), photo: photo ?? undefined, productId: productId ?? undefined }));
    if (ok) {
      setText('');
      setPhoto(null);
      setProductId(null);
      requestAnimationFrame(grow);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="glass sticky bottom-[136px] z-20 mt-6 grid gap-2 p-2.5 lg:bottom-[88px]" aria-label="Escribir un mensaje">
      {photo || product ? (
        <div className="flex flex-wrap items-center gap-2 px-1 pt-1">
          {photo && preview ? (
            <span className="relative">
              <img src={preview} alt="Foto por enviar" className="h-14 w-14 rounded-lg object-cover" />
              <button
                type="button"
                className="absolute -top-2 -right-2 grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-ink"
                onClick={() => setPhoto(null)}
                aria-label="Quitar la foto"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </span>
          ) : null}
          {product ? (
            <span className="pill pill-accent min-h-9">
              <Package className="h-4 w-4" aria-hidden />
              <span className="max-w-[12rem] truncate">{product.product.name}</span>
              <button type="button" className="grid h-7 w-7 place-items-center" onClick={() => setProductId(null)} aria-label="Quitar el producto">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <PhotoIconButton onPhoto={setPhoto} />
        <Button icon={Paperclip} onClick={() => setPickProduct(true)} aria-label="Adjuntar un producto del catálogo" />
        <label htmlFor="mensaje-texto" className="sr-only">
          Mensaje
        </label>
        <textarea
          id="mensaje-texto"
          ref={taRef}
          className="input min-h-12 flex-1 resize-none py-3 leading-snug"
          rows={1}
          maxLength={2000}
          placeholder="Escribe un mensaje"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
          }}
        />
        <Button type="submit" variant="primary" icon={Send} busy={busy} disabled={!canSend} aria-label="Enviar mensaje" />
      </div>
      <Sheet open={pickProduct} onClose={() => setPickProduct(false)} title="Adjuntar un producto">
        {products.length === 0 ? (
          <EmptyState icon={Package} title="No hay productos activos" />
        ) : (
          <ul className="grid gap-2">
            {products.map((v) => (
              <li key={v.product.id}>
                <button
                  type="button"
                  className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 p-2 text-left hover:border-accent"
                  onClick={() => {
                    setProductId(v.product.id);
                    setPickProduct(false);
                  }}
                >
                  <span className="h-14 w-16 flex-none overflow-hidden rounded-lg bg-surface">
                    <ProductThumb product={v.product} loadPhoto={(pid) => getPhoto(ctx, pid)} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{v.product.name}</span>
                    <span className="block truncate text-sm text-muted">{v.product.sku}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </form>
  );
}

/** Botón de ícono para tomar o elegir una foto; la comprime a WebP antes de adjuntarla. */
function PhotoIconButton({ onPhoto }: { onPhoto: (p: NewPhoto) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  return (
    <>
      <Button icon={Camera} busy={busy} onClick={() => ref.current?.click()} aria-label="Adjuntar una foto" />
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try {
            onPhoto(await compressImage(f));
          } catch (err) {
            push('error', errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Avisos (campana)
// ---------------------------------------------------------------------------

const NOTIF_ICON: Record<NotificationKind, LucideIcon> = {
  local_por_aprobar: Store,
  contrato_firmado: FilePen,
  pedido_nuevo: ShoppingBag,
  pedido_confirmado: ClipboardList,
  entrega_solicitada: Truck,
  entrega_preparada: PackageCheck,
  entrega_recibida: CircleCheck,
  stock_bajo: PackageMinus,
  llegada_recibida: Ship,
  pago_vencido: AlarmClock,
  pago_registrado: Receipt,
  liquidacion_nueva: FileText,
  comision_pagada: Coins,
  mensaje: MessageCircle,
  comunicado: Megaphone,
  cafe_por_vencer: Coffee,
};

const ALERT_ICON: Record<InventoryAlert['kind'], LucideIcon> = {
  stock_bajo: PackageMinus,
  por_vencer_almacen: Hourglass,
  por_vencer_local: Hourglass,
  vencido_local: AlertTriangle,
};

export function NotificationsPage() {
  const { ctx, actor, p } = useLine();
  const nav = useNavigate();
  const { push } = useToast();
  const list = useAsync(() => listNotifications(ctx), [ctx]);
  const showAlerts = actor.role === 'admin' || actor.role === 'seller';
  const alerts = useAsync(() => (showAlerts ? inventoryAlerts(ctx) : Promise.resolve([] as InventoryAlert[])), [ctx, showAlerts]);
  const { run, busy } = useAction();

  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read).length;

  const openItem = async (n: AppNotification) => {
    try {
      if (!n.read && !actor.readOnly) await markNotificationsRead(ctx, [n.id]);
    } catch (e) {
      push('error', errorText(e));
    }
    nav(n.link);
  };

  return (
    <>
      <PageHeader
        title="Avisos"
        subtitle={unread ? `Tienes ${unread} sin leer.` : 'Estás al día.'}
        actions={
          <Button icon={CheckCheck} busy={busy} disabled={!unread || actor.readOnly} onClick={() => void run(() => markNotificationsRead(ctx), 'Todo marcado como leído.')}>
            Marcar todo como leído
          </Button>
        }
      />

      {showAlerts && (alerts.data ?? []).length ? (
        <Section title="Atención">
          <Card as="div" className="overflow-hidden">
            <ul>
              {(alerts.data ?? []).map((a, i) => {
                const Icon = ALERT_ICON[a.kind];
                const to = a.storeId ? p(`locales/${a.storeId}`) : p(`catalogo/${a.productId}`);
                const tone = a.kind === 'vencido_local' || a.kind === 'stock_bajo' ? 'text-danger' : 'text-warn';
                return (
                  <li key={`${a.kind}-${a.productId}-${a.storeId ?? ''}-${i}`}>
                    <Link to={to} className="row-link">
                      <span className={`grid h-10 w-10 flex-none place-items-center rounded-xl bg-surface-2 ${tone}`}>
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-ink">
                          {a.productName}
                          {a.storeName ? ` · ${a.storeName}` : ''}
                        </span>
                        <span className="block text-sm text-muted">{a.detail}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </Section>
      ) : null}

      <Section title="Todos los avisos">
        {list.loading && !list.data ? (
          <Loading rows={4} />
        ) : list.error ? (
          <ErrorBox error={list.error} />
        ) : items.length === 0 ? (
          <EmptyState icon={Bell} title="No tienes avisos">
            Aquí te avisamos de pedidos nuevos, entregas, pagos, llegadas al almacén y mensajes.
          </EmptyState>
        ) : (
          <Card as="div" className="overflow-hidden">
            <ul>
              {items.map((n) => {
                const Icon = NOTIF_ICON[n.kind] ?? Bell;
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => void openItem(n)} className="row-link w-full text-left" data-testid="aviso">
                      <span className={`grid h-10 w-10 flex-none place-items-center rounded-xl ${n.read ? 'bg-surface-2 text-muted' : 'bg-accent-soft text-accent'}`}>
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={`min-w-0 line-clamp-2 ${n.read ? 'font-medium text-muted' : 'font-bold text-ink'}`}>{n.title}</span>
                          <span className="ml-auto flex-none text-xs text-muted">{fmtAgo(n.at, new Date())}</span>
                        </span>
                        <span className={`block text-sm ${n.read ? 'text-faint' : 'text-muted'}`}>{n.body}</span>
                      </span>
                      {!n.read ? <span className="h-2.5 w-2.5 flex-none rounded-full bg-accent" aria-label="Sin leer" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </Section>
    </>
  );
}
