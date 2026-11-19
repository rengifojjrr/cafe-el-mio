// Las reglas de la fase 2 (vendedores) del servidor de mentira: las mismas que
// supabase/migrations/tabaco_5_vendedores.sql (para_vendedor, revisar_vendedor y costear).

type Datos = Record<string, unknown>;
export interface FilaVendedor {
  tabla: string;
  id: string;
  datos: Datos;
  borrado: boolean;
  /** Quién la escribió (id del usuario del servidor). */
  autor?: string;
}

const s = (v: unknown): string | null => (typeof v === 'string' ? v : v == null ? null : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const sin = (d: Datos, ...campos: string[]): Datos => {
  const out = { ...d };
  for (const c of campos) delete out[c];
  return out;
};

export class NoVendedor extends Error {}

/** Lo que el vendedor ve de una fila: null si no le toca. */
export function paraVendedor(f: FilaVendedor, yo: string, locales: Set<string>, hilos: Set<string>, buscar: (tabla: string, id: string) => FilaVendedor | undefined): { datos: Datos; borrado: boolean } | null {
  if (f.borrado) return { datos: {}, borrado: true };
  const d = f.datos;
  const mio = s(d.storeId) !== null && locales.has(s(d.storeId)!);
  const tal = { datos: d, borrado: false };
  switch (f.tabla) {
    case 'products':
      return { datos: sin(d, 'cost', 'sampleCost'), borrado: false };
    case 'lots':
      return { datos: sin(d, 'unitCost'), borrado: false };
    case 'warehouses':
    case 'zones':
    case 'templates':
    case 'announcements':
      return tal;
    case 'settings':
      return { datos: sin(d, 'ultimoAjustePrecio'), borrado: false };
    case 'stores':
      return locales.has(f.id) ? tal : { datos: {}, borrado: true };
    case 'contracts':
    case 'deliveries':
    case 'visits':
    case 'reorders':
    case 'unmetDemand':
    case 'settlements':
    case 'payments':
      return mio ? tal : null;
    case 'salesReports':
    case 'invoices':
      return mio ? { datos: { ...d, lines: sinCosto(d.lines) }, borrado: false } : null;
    case 'returns':
      return mio ? { datos: { ...d, cost: 0 }, borrado: false } : null;
    case 'movements': {
      if (mio) return tal;
      const from = d.from as { kind?: string } | undefined;
      const to = d.to as { kind?: string } | undefined;
      if (from?.kind === 'warehouse' || to?.kind === 'warehouse') {
        return {
          datos: {
            ...sin(d, 'unitPrice', 'basePrice', 'reason'),
            storeId: null,
            refId: '',
            actorId: '',
            from: from?.kind === 'store' ? { kind: 'adjustment' } : from,
            to: to?.kind === 'store' ? { kind: 'adjustment' } : to,
          },
          borrado: false,
        };
      }
      return null;
    }
    case 'commissions':
    case 'payouts':
      return s(d.sellerId) === yo ? tal : null;
    case 'threads':
      return hilos.has(f.id) ? tal : null;
    case 'messages':
      return hilos.has(s(d.threadId) ?? '') ? tal : null;
    case 'notifications':
      return s(d.userId) === yo ? tal : null;
    case 'users': {
      if (f.id === yo) return tal;
      if (d.role === 'admin' || (d.role === 'store' && locales.has(s(d.storeId) ?? ''))) {
        const out: Datos = { role: d.role, name: d.name, email: '', phone: '', active: d.active, createdAt: d.createdAt };
        if (d.storeId != null) out.storeId = d.storeId;
        return { datos: out, borrado: false };
      }
      return null;
    }
    case 'photos': {
      const tipo = s(d.ownerType);
      const dueno = s(d.ownerId) ?? '';
      const ok =
        tipo === 'product' ||
        ((tipo === 'store' || tipo === 'document') && locales.has(dueno)) ||
        (tipo === 'visit' && locales.has(s(buscar('visits', dueno)?.datos.storeId) ?? '')) ||
        (tipo === 'return' && locales.has(s(buscar('returns', dueno)?.datos.storeId) ?? '')) ||
        (tipo === 'message' && hilos.has(s(buscar('messages', dueno)?.datos.threadId) ?? ''));
      return ok ? tal : null;
    }
    default:
      return null;
  }
}

function sinCosto(lineas: unknown): unknown[] {
  return (Array.isArray(lineas) ? lineas : []).map((l) => {
    const x = l as Datos;
    return { ...sin(x, 'cost', 'lots'), cost: 0, lots: (Array.isArray(x.lots) ? x.lots : []).map((lt) => ({ ...(lt as Datos), unitCost: 0 })) };
  });
}

/** Revisa un cambio de un vendedor (lanza NoVendedor si no puede). `esMio` mira el estado de ahora. */
export function revisarVendedor(
  yo: string,
  autorYo: string,
  c: { tabla: string; id: string; op: string; datos?: Datos },
  buscar: (tabla: string, id: string) => FilaVendedor | undefined,
): void {
  const no = (m: string): never => {
    throw new NoVendedor(m);
  };
  if (c.op !== 'guardar') no(`Un vendedor no borra registros (${c.tabla}).`);
  const d = c.datos ?? {};
  const viejoF = buscar(c.tabla, c.id);
  const viejo = viejoF && !viejoF.borrado ? viejoF : undefined;
  const esMio = (local: unknown) => {
    const st = s(local) ? buscar('stores', s(local)!) : undefined;
    return Boolean(st && !st.borrado && s(st.datos.sellerId) === yo);
  };
  switch (c.tabla) {
    case 'audit':
      if (s(d.actorId) !== yo) no('La auditoría de un vendedor lleva su nombre.');
      return;
    case 'notifications':
      if (viejo && s(viejo.datos.userId) !== yo) no('Ese aviso no es tuyo.');
      return;
    case 'stores': {
      if (s(d.sellerId) !== yo) no('Un vendedor solo guarda sus locales.');
      if (d.clase != null) no('Los clientes que no son locales los anota Administración.');
      if (viejo) {
        if (s(viejo.datos.sellerId) !== yo) no('Ese local no es tuyo.');
        const antes = s(viejo.datos.status);
        const ahora = s(d.status);
        if (ahora !== antes && (!['prospecto', 'contrato_enviado', 'firmado'].includes(ahora ?? '') || ['activo', 'pausado', 'cerrado'].includes(antes ?? ''))) {
          no('Aprobar, pausar o cerrar un local lo hace Administración.');
        }
        for (const k of ['saleMode', 'creditDays', 'priceListId', 'approvedAt', 'clase']) {
          if (JSON.stringify(d[k] ?? null) !== JSON.stringify(viejo.datos[k] ?? null)) no('Las condiciones de compra del local las pone Administración.');
        }
      } else {
        if (s(d.status) !== 'prospecto') no('Un local nuevo empieza como prospecto.');
        if (num(d.creditDays) !== 0 || d.priceListId != null || d.approvedAt != null) no('Las condiciones de compra del local las pone Administración.');
      }
      const precios = d.precios as Record<string, unknown> | undefined;
      if (precios && typeof precios === 'object') {
        for (const [pid, v] of Object.entries(precios)) {
          const p = buscar('products', pid);
          if (p && !p.borrado && (typeof v !== 'number' || v < num(p.datos.priceToStore))) no('El precio de un local no puede ser menor que el precio base.');
        }
      }
      return;
    }
    case 'contracts':
    case 'visits':
    case 'reorders':
    case 'unmetDemand':
    case 'deliveries':
    case 'salesReports':
    case 'returns':
    case 'invoices':
    case 'movements': {
      if (!esMio(d.storeId) || (viejo && !esMio(viejo.datos.storeId))) no('Ese local no es tuyo.');
      if (c.tabla === 'deliveries') {
        if (!viejo) {
          if (s(d.status) !== 'solicitada') no('Una entrega nueva empieza como pedida.');
        } else if (s(d.status) !== s(viejo.datos.status)) {
          if (!(s(viejo.datos.status) === 'preparada' && s(d.status) === 'entregada')) no('Ese paso de la entrega lo hace Administración.');
          if (JSON.stringify(d.items) !== JSON.stringify(viejo.datos.items)) no('Lo preparado no se cambia al recibir.');
        } else if (s(viejo.datos.status) !== 'solicitada' && JSON.stringify(d.items) !== JSON.stringify(viejo.datos.items)) {
          no('Lo preparado lo cambia Administración.');
        }
      } else if (c.tabla === 'movements') {
        if (viejo && JSON.stringify(viejo.datos) !== JSON.stringify(d)) no('Un movimiento no se cambia.');
        for (const lado of ['from', 'to'] as const) {
          const l = d[lado] as { kind?: string; storeId?: string } | undefined;
          if (!['warehouse', 'store', 'sold', 'loss', 'adjustment'].includes(l?.kind ?? '') || (l?.kind === 'store' && l.storeId !== s(d.storeId))) {
            no('Un vendedor solo mueve producto de sus locales.');
          }
        }
      } else if (c.tabla === 'salesReports' || c.tabla === 'returns' || c.tabla === 'invoices') {
        if (viejo && viejo.autor !== autorYo) no('Ese registro no es tuyo.');
        if (c.tabla === 'invoices' && (num(d.paid) !== 0 || (d.sellerId != null && s(d.sellerId) !== yo))) no('Los pagos de una factura los anota Administración.');
      }
      return;
    }
    case 'commissions':
      if (s(d.sellerId) !== yo || !esMio(d.storeId)) no('Esa comisión no es tuya.');
      if (!['devengada', 'pagable'].includes(s(d.status) ?? '') || (viejo && s(viejo.datos.status) === 'pagada')) no('Las comisiones las paga Administración.');
      return;
    case 'threads': {
      const parts = (d.participantIds as string[] | undefined) ?? [];
      const antes = (viejo?.datos.participantIds as string[] | undefined) ?? [];
      if (!parts.includes(yo) || (viejo && !antes.includes(yo))) no('No participas en esa conversación.');
      return;
    }
    case 'messages': {
      const hilo = buscar('threads', s(d.threadId) ?? '');
      if (s(d.authorId) !== yo || !hilo || hilo.borrado || !((hilo.datos.participantIds as string[] | undefined) ?? []).includes(yo) || (viejo && s(viejo.datos.authorId) !== yo)) {
        no('Ese mensaje no es tuyo.');
      }
      return;
    }
    case 'photos':
      if (!['store', 'visit', 'return', 'message', 'document'].includes(s(d.ownerType) ?? '') || (viejo && viejo.autor !== autorYo)) no('Esa foto la sube Administración.');
      return;
    default:
      no(`Un vendedor no guarda en «${c.tabla}».`);
  }
}

/** El costo de un lote (o el del producto). */
function costoLote(buscar: (tabla: string, id: string) => FilaVendedor | undefined, lote: unknown, producto: unknown): number {
  const lt = buscar('lots', s(lote) ?? '');
  if (lt && lt.datos.unitCost != null) return num(lt.datos.unitCost);
  const p = buscar('products', s(producto) ?? '');
  return p && p.datos.cost != null ? num(p.datos.cost) : 0;
}

/** Lo que el servidor le pone a una venta, factura o devolución de un vendedor: el costo de cada lote. */
export function costear(tabla: string, datos: Datos, id: string, filas: Iterable<FilaVendedor>, buscar: (tabla: string, id: string) => FilaVendedor | undefined): Datos {
  if (tabla === 'salesReports' || tabla === 'invoices') {
    const lines = (Array.isArray(datos.lines) ? datos.lines : []).map((l) => {
      const x = l as Datos;
      const lots = Array.isArray(x.lots) ? (x.lots as Datos[]) : [];
      if (!lots.length) return x;
      const conCosto: Datos[] = lots.map((lt) => ({ ...lt, unitCost: costoLote(buscar, lt.lotId, x.productId) }));
      return { ...x, lots: conCosto, cost: r2(conCosto.reduce((a, lt) => a + num(lt.qty) * num(lt.unitCost), 0)) };
    });
    return { ...datos, lines };
  }
  if (tabla === 'returns') {
    let costo = 0;
    for (const m of filas) {
      if (m.tabla !== 'movements' || m.borrado || s(m.datos.refId) !== id) continue;
      costo += num(m.datos.qty) * costoLote(buscar, m.datos.lotId, m.datos.productId);
    }
    return { ...datos, cost: r2(costo) };
  }
  return datos;
}
