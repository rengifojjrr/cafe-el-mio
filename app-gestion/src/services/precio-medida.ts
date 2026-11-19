// La regla de precio por medida de los tabacos de mazo (Ajustes): guardarla, ver qué cambiaría en
// los productos ya guardados, aplicarla (solo a los que se eligen) y deshacer la última vez. Nunca
// cambia un precio sin que lo pidan, y nunca el de un producto con el precio puesto a mano.
import { z } from 'zod';
import type { LineSettings } from '../data/types';
import { type CambioPrecio, type ReglaPrecioMazo, cambiosDeRegla, leerMedidas, medidaTexto, reglaDe } from '../domain/precio-medida';
import { fmtMoney, round2 } from '../lib/money';
import { type Ctx, ValidationError, audit, getSettings, guard, mutate, nowIso } from './context';

export interface VistaRegla {
  regla: ReglaPrecioMazo | null;
  /** El último «Aplicar», si todavía se puede deshacer. */
  ultimo?: LineSettings['ultimoAjustePrecio'];
}

export async function leerReglaPrecio(ctx: Ctx): Promise<VistaRegla> {
  guard(ctx, 'settings.read');
  const s = await getSettings(ctx);
  return { regla: reglaDe(s), ultimo: s.ultimoAjustePrecio };
}

const reglaSchema = z.object({
  precio: z.number({ error: 'Escribe el precio por mazo.' }).positive('El precio por mazo tiene que ser mayor que cero.'),
  /** Las medidas que van a otro precio, como se escriben: «6½ × 64, 7 × 70», «6 1/2x64», «7x70». */
  medidas: z.string().trim().max(400).default(''),
  precioMedidas: z.number().positive('El precio de esas medidas tiene que ser mayor que cero.').optional(),
});

/** Guarda la regla. Sin medidas aparte, un solo precio para todas. No toca ningún producto. */
export async function guardarReglaPrecio(ctx: Ctx, input: z.input<typeof reglaSchema>): Promise<ReglaPrecioMazo> {
  guard(ctx, 'settings.manage');
  const data = reglaSchema.parse(input);
  const medidas = leerMedidas(data.medidas);
  if (data.medidas && medidas.length === 0) throw new ValidationError('No entendí las medidas: escríbelas como «6½ × 64, 7 × 70» (largo × cepo).');
  if (medidas.length && data.precioMedidas === undefined) throw new ValidationError('Escribe el precio de esas medidas.');
  const regla: ReglaPrecioMazo = {
    precio: round2(data.precio),
    especiales: medidas.length && data.precioMedidas ? [{ medidas, precio: round2(data.precioMedidas) }] : [],
  };
  return mutate(ctx, async () => {
    const prev = await getSettings(ctx);
    await ctx.repo.settings.put({ ...prev, precioMazo: regla });
    const texto = [`${fmtMoney(regla.precio)} por mazo`, ...regla.especiales.map((e) => `${e.medidas.map(medidaTexto).join(', ')} → ${fmtMoney(e.precio)}`)].join('; ');
    await audit(ctx, 'precio.regla', 'settings', prev.id, `Regla de precio por medida: ${texto}`);
    return regla;
  });
}

/** Lo que cambiaría «Aplicar a los productos de mazo» (sin cambiar nada). */
export async function vistaPreviaRegla(ctx: Ctx): Promise<{ regla: ReglaPrecioMazo | null; cambios: CambioPrecio[]; aMano: number }> {
  guard(ctx, 'product.write');
  const [s, products] = await Promise.all([getSettings(ctx), ctx.repo.products.all()]);
  const regla = reglaDe(s);
  if (!regla) return { regla: null, cambios: [], aMano: 0 };
  return { regla, ...cambiosDeRegla(regla, products) };
}

/**
 * Aplica la regla a los productos elegidos (de la vista previa). Guarda lo de antes para poder
 * deshacerlo. Un producto con el precio a mano no se toca aunque venga en la lista.
 */
export async function aplicarReglaPrecio(ctx: Ctx, productIds: readonly string[]): Promise<number> {
  guard(ctx, 'product.write');
  return mutate(ctx, async () => {
    const [s, products] = await Promise.all([getSettings(ctx), ctx.repo.products.all()]);
    const regla = reglaDe(s);
    if (!regla) throw new ValidationError('Primero guarda la regla de precio por mazo.');
    const elegidos = new Set(productIds);
    const { cambios } = cambiosDeRegla(regla, products);
    const aplicar = cambios.filter((c) => elegidos.has(c.productId));
    if (aplicar.length === 0) throw new ValidationError('No hay precios que cambiar.');
    const byId = new Map(products.map((p) => [p.id, p]));
    const at = nowIso(ctx);
    for (const c of aplicar) {
      const p = byId.get(c.productId)!;
      await ctx.repo.products.put({ ...p, priceToStore: c.despues, updatedAt: at });
    }
    await ctx.repo.settings.put({ ...s, ultimoAjustePrecio: { at, by: ctx.actor.userId, cambios: aplicar.map((c) => ({ productId: c.productId, antes: c.antes, despues: c.despues })) } });
    await audit(ctx, 'precio.aplicar', 'settings', s.id, `Regla de precio aplicada a ${aplicar.length} productos de mazo: ${aplicar.map((c) => `${c.name} ${fmtMoney(c.antes)} → ${fmtMoney(c.despues)}`).join('; ')}`);
    return aplicar.length;
  });
}

/**
 * Deshace el último «Aplicar»: cada producto vuelve a su precio de antes, salvo que lo hayan cambiado
 * después (ese queda como está). Devuelve cuántos volvieron y cuántos no.
 */
export async function deshacerAjustePrecio(ctx: Ctx): Promise<{ vueltos: number; cambiadosDespues: number }> {
  guard(ctx, 'product.write');
  return mutate(ctx, async () => {
    const s = await getSettings(ctx);
    const ultimo = s.ultimoAjustePrecio;
    if (!ultimo?.cambios.length) throw new ValidationError('No hay nada que deshacer.');
    const at = nowIso(ctx);
    let vueltos = 0;
    let cambiadosDespues = 0;
    for (const c of ultimo.cambios) {
      const p = await ctx.repo.products.get(c.productId);
      if (!p) continue;
      if (round2(p.priceToStore) !== round2(c.despues)) {
        cambiadosDespues += 1;
        continue;
      }
      await ctx.repo.products.put({ ...p, priceToStore: c.antes, updatedAt: at });
      vueltos += 1;
    }
    const { ultimoAjustePrecio: _u, ...sinUltimo } = s;
    await ctx.repo.settings.put(sinUltimo);
    await audit(ctx, 'precio.deshacer', 'settings', s.id, `Deshecho el último ajuste de precios: ${vueltos} vuelven a su precio${cambiadosDespues ? `; ${cambiadosDespues} se cambiaron después y quedan como están` : ''}`);
    return { vueltos, cambiadosDespues };
  });
}
