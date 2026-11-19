// Clientes: los locales, las personas que compran a su nombre y el almacén (la venta de mostrador).
// Las personas y el mostrador se guardan en la tabla de locales, marcados con `clase` (ver
// src/domain/clientes.ts): sus facturas, pagos, entregas y PDF son los de siempre. Solo
// Administración los ve: los vendedores trabajan con sus locales.
import { z } from 'zod';
import type { Invoice, Store } from '../data/types';
import { CLASES, type ClaseCliente, ID_MOSTRADOR, NOMBRE_MOSTRADOR, claseDe, claveNombre, limpiarNombre } from '../domain/clientes';
import { invoiceBalance } from '../domain/invoices';
import { round2 } from '../lib/money';
import { type Ctx, ForbiddenError, NotFoundError, ValidationError, audit, guard, mutate, nowIso } from './context';

function soloAdministracion(ctx: Ctx): void {
  if (ctx.actor.role !== 'admin') throw new ForbiddenError('Solo Administración ve y anota los clientes que no son locales.');
}

const personaSchema = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre de la persona.').max(80, 'El nombre es muy largo.'),
  telefono: z.string().trim().max(30, 'El teléfono es muy largo.').default(''),
});

/** Una persona como se sugiere al escribir su nombre. */
export interface PersonaSugerida {
  id: string;
  nombre: string;
  telefono: string;
  compras: number;
  ultima?: string;
}

/** El registro de una persona nueva (en la tabla de locales, sin vendedor, zona ni dirección). */
function nuevaPersona(ctx: Ctx, nombre: string, telefono: string, at: string): Store {
  return {
    id: ctx.newId('cli'),
    clase: 'persona',
    name: nombre,
    type: 'Persona',
    address: '',
    city: '',
    zoneId: '',
    lat: 0,
    lng: 0,
    managerName: nombre,
    phone: telefono,
    email: '',
    hours: '',
    sellerId: '',
    status: 'activo',
    saleMode: 'firme',
    creditDays: 0,
    notes: '',
    createdAt: at,
    createdBy: ctx.actor.userId,
    approvedAt: at,
    statusHistory: [{ status: 'activo', at, by: ctx.actor.userId }],
  };
}

function compraPorCliente(invoices: readonly Invoice[]): Map<string, { compras: number; ultima: string }> {
  const out = new Map<string, { compras: number; ultima: string }>();
  for (const i of invoices) {
    const cur = out.get(i.storeId) ?? { compras: 0, ultima: '' };
    cur.compras += 1;
    if (i.issuedAt > cur.ultima) cur.ultima = i.issuedAt;
    out.set(i.storeId, cur);
  }
  return out;
}

/**
 * Las personas que coinciden con lo que se escribe, las de compras más recientes primero, y la que
 * se llama exactamente así (sin importar mayúsculas, tildes ni espacios): esa no se crea de nuevo.
 */
export async function buscarPersonas(ctx: Ctx, texto: string, max = 6): Promise<{ sugerencias: PersonaSugerida[]; exacta?: PersonaSugerida }> {
  guard(ctx, 'invoice.read');
  soloAdministracion(ctx);
  const [stores, invoices] = await Promise.all([ctx.repo.stores.all(), ctx.repo.invoices.all()]);
  const compras = compraPorCliente(invoices);
  const clave = claveNombre(texto);
  const todas = stores
    .filter((s) => s.clase === 'persona' && s.status !== 'cerrado')
    .map((s) => ({ id: s.id, nombre: s.name, telefono: s.phone, compras: compras.get(s.id)?.compras ?? 0, ultima: compras.get(s.id)?.ultima || undefined, clave: claveNombre(s.name) }));
  const exacta = clave ? todas.find((p) => p.clave === clave) : undefined;
  const sugerencias = todas
    .filter((p) => !clave || p.clave.includes(clave) || clave.split(' ').every((w) => p.clave.includes(w)))
    .sort((a, b) => Number(b.clave === clave) - Number(a.clave === clave) || (b.ultima ?? '').localeCompare(a.ultima ?? '') || a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, max)
    .map(({ clave: _c, ...p }) => p);
  return { sugerencias, exacta: exacta ? (({ clave: _c, ...p }) => p)(exacta) : undefined };
}

/**
 * Crea una persona para venderle a su nombre. Si ya hay una que se llama así («ana perez» = «Ana
 * Pérez»), devuelve esa en vez de duplicarla (y le anota el teléfono si no tenía).
 */
export async function crearPersona(ctx: Ctx, input: z.input<typeof personaSchema>): Promise<{ persona: Store; nueva: boolean }> {
  guard(ctx, 'sale.quick');
  soloAdministracion(ctx);
  const data = personaSchema.parse(input);
  const nombre = limpiarNombre(data.nombre);
  const clave = claveNombre(nombre);
  if (clave.length < 2) throw new ValidationError('Escribe el nombre de la persona.');
  return mutate(ctx, async () => {
    const ya = (await ctx.repo.stores.all()).find((s) => s.clase === 'persona' && s.status !== 'cerrado' && claveNombre(s.name) === clave);
    if (ya) {
      if (data.telefono && !ya.phone) {
        const conTel = { ...ya, phone: data.telefono };
        await ctx.repo.stores.put(conTel);
        return { persona: conTel, nueva: false };
      }
      return { persona: ya, nueva: false };
    }
    const persona = nuevaPersona(ctx, nombre, data.telefono, nowIso(ctx));
    await ctx.repo.stores.put(persona);
    await audit(ctx, 'cliente.persona', 'store', persona.id, `Cliente nuevo (persona): ${nombre}${data.telefono ? ` · ${data.telefono}` : ''}`);
    return { persona, nueva: true };
  });
}

/** Cambia el nombre o el teléfono de una persona (sin chocar con otra que ya se llame así). */
export async function editarPersona(ctx: Ctx, id: string, input: z.input<typeof personaSchema>): Promise<Store> {
  guard(ctx, 'sale.quick');
  soloAdministracion(ctx);
  const data = personaSchema.parse(input);
  const nombre = limpiarNombre(data.nombre);
  return mutate(ctx, async () => {
    const s = await ctx.repo.stores.get(id);
    if (!s || s.clase !== 'persona') throw new NotFoundError('la persona');
    const clave = claveNombre(nombre);
    const otra = (await ctx.repo.stores.all()).find((x) => x.id !== id && x.clase === 'persona' && x.status !== 'cerrado' && claveNombre(x.name) === clave);
    if (otra) throw new ValidationError(`Ya hay otra persona que se llama ${otra.name}.`);
    const next: Store = { ...s, name: nombre, managerName: nombre, phone: data.telefono };
    await ctx.repo.stores.put(next);
    await audit(ctx, 'cliente.persona', 'store', s.id, `Persona: ${s.name} → ${nombre}${data.telefono ? ` · ${data.telefono}` : ''}`);
    return next;
  });
}

/**
 * El cliente fijo «Almacén (mostrador)»: el mismo id en todos los teléfonos, así dos que lo crean a
 * la vez no lo duplican. No se cierra ni se borra.
 */
export async function asegurarMostrador(ctx: Ctx): Promise<Store> {
  guard(ctx, 'sale.quick');
  soloAdministracion(ctx);
  const ya = await ctx.repo.stores.get(ID_MOSTRADOR);
  if (ya) return ya;
  return mutate(ctx, async () => {
    const otra = await ctx.repo.stores.get(ID_MOSTRADOR);
    if (otra) return otra;
    const at = nowIso(ctx);
    const mostrador: Store = { ...nuevaPersona(ctx, NOMBRE_MOSTRADOR, '', at), id: ID_MOSTRADOR, clase: 'almacen', type: 'Almacén', managerName: '' };
    await ctx.repo.stores.put(mostrador);
    return mostrador;
  });
}

/** Un cliente con lo que compró (facturas: venta rápida y pedidos entregados en firme). */
export interface ClienteFila {
  store: Store;
  clase: ClaseCliente;
  compras: number;
  total: number;
  saldo: number;
  ultima?: string;
}

export interface Clientes {
  porClase: Record<ClaseCliente, ClienteFila[]>;
  totales: Record<ClaseCliente, { clientes: number; compras: number; total: number; saldo: number }>;
}

/** Todos los clientes por clase, con sus compras en firme (las de consignación están en sus cuentas). */
export async function listarClientes(ctx: Ctx): Promise<Clientes> {
  guard(ctx, 'invoice.read');
  soloAdministracion(ctx);
  const [stores, invoices] = await Promise.all([ctx.repo.stores.all(), ctx.repo.invoices.all()]);
  const porCliente = new Map<string, { compras: number; total: number; saldo: number; ultima: string }>();
  for (const i of invoices) {
    const cur = porCliente.get(i.storeId) ?? { compras: 0, total: 0, saldo: 0, ultima: '' };
    cur.compras += 1;
    cur.total += i.total;
    cur.saldo += invoiceBalance(i);
    if (i.issuedAt > cur.ultima) cur.ultima = i.issuedAt;
    porCliente.set(i.storeId, cur);
  }
  const porClase: Record<ClaseCliente, ClienteFila[]> = { local: [], persona: [], almacen: [] };
  for (const s of stores) {
    const c = porCliente.get(s.id);
    const clase = claseDe(s);
    if (clase === 'local' && s.status === 'cerrado' && !c) continue;
    porClase[clase].push({ store: s, clase, compras: c?.compras ?? 0, total: round2(c?.total ?? 0), saldo: round2(c?.saldo ?? 0), ultima: c?.ultima || undefined });
  }
  for (const k of CLASES) porClase[k].sort((a, b) => (b.ultima ?? '').localeCompare(a.ultima ?? '') || a.store.name.localeCompare(b.store.name, 'es'));
  const totales = Object.fromEntries(
    CLASES.map((k) => [
      k,
      {
        clientes: porClase[k].length,
        compras: porClase[k].reduce((a, x) => a + x.compras, 0),
        total: round2(porClase[k].reduce((a, x) => a + x.total, 0)),
        saldo: round2(porClase[k].reduce((a, x) => a + x.saldo, 0)),
      },
    ]),
  ) as Clientes['totales'];
  return { porClase, totales };
}

/** Un cliente que no es local (persona o mostrador), para su ficha. */
export async function verCliente(ctx: Ctx, id: string): Promise<Store> {
  guard(ctx, 'invoice.read');
  soloAdministracion(ctx);
  const s = await ctx.repo.stores.get(id);
  if (!s || (s.clase !== 'persona' && s.clase !== 'almacen')) throw new NotFoundError('el cliente');
  return s;
}
