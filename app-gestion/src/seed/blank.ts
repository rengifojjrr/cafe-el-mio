// Una línea en blanco, lista para los datos reales de la empresa: la configuración de la línea
// (ajustes, mercados, comisión progresiva, plantilla del contrato, almacén y zonas) y una sola
// cuenta, «Administración». Ni locales, ni personas, ni ventas, ni movimientos inventados.
// En Café quedan los 9 cafés de El Mío con lo que es real (nombre, fotos, descripción, atributos y
// el PVP de la tienda de la marca): sin costo, sin precio al local, sin código de barras de ejemplo,
// sin stock y desactivados hasta que alguien les ponga precio.
// No usa el simulador de la semilla: es liviano y se baja solo para arrancar una línea.
import type { AuditEntry, LineId, LineSettings, Product, User, Warehouse, Zone } from '../data/types';
import { HOUSTON, MIAMI } from '../domain/markets';
import { idFactory } from '../lib/ids';
import { CAFE_SEED } from './cafe';
import type { LineSeedDef, SeedTables } from './engine';
import { TABACO_SCHEME } from './schemes';
import { TABACO_SEED } from './tabaco';
import { BLANK_ADMIN_NAME } from './version';

const DEFS: Record<LineId, LineSeedDef> = { tabaco: TABACO_SEED, cafe: CAFE_SEED };

export { BLANK_ADMIN_NAME };

const letterOf = (line: LineId) => (line === 'tabaco' ? 't' : 'c');

/**
 * Los ajustes con los que arranca la línea: los mismos de partida que traía la semilla, ya como
 * datos reales. Sin listas de precios (se crean en Ajustes) y sin fecha de copia.
 */
export function blankSettings(line: LineId): LineSettings {
  const def = DEFS[line];
  return {
    id: 'settings',
    ...structuredClone(def.settings),
    warehouseName: def.warehouse.name,
    contractTemplate: def.config.contractTemplate,
    contractTemplateVersion: 1,
    markets: line === 'tabaco' ? [MIAMI, HOUSTON] : [MIAMI],
    routeCostPerKm: line === 'tabaco' ? 0.65 : 0.6,
    ...(line === 'tabaco' ? { commissionScheme: structuredClone(TABACO_SCHEME) } : {}),
    dataMode: 'real',
  };
}

/** El almacén de partida: su nombre y un punto en el mapa, sin la dirección de ejemplo. */
export function blankWarehouse(line: LineId): Warehouse {
  const { name, lat, lng } = DEFS[line].warehouse;
  return { id: 'almacen', name, address: '', lat, lng };
}

/** Las zonas del mapa (barrios de Miami y, en Tabaco, Houston), cada una con su mercado. */
export function blankZones(line: LineId): Zone[] {
  return DEFS[line].zones.map(({ key: _key, ...z }) => ({ ...z, marketId: z.marketId ?? MIAMI.id }));
}

/**
 * Los 9 cafés de El Mío solo con lo real. Costo y precio al local en 0 (no se sabe todavía) y
 * desactivados: no se pueden pedir ni entregar hasta que tengan precio al local.
 */
export function elMioProducts(nowIso: string): Product[] {
  const id = idFactory();
  return CAFE_SEED.products.map((p) => {
    const { key: _key, rate: _rate, shelfLifeDays: _shelf, supply: _supply, cost: _cost, priceToStore: _price, barcode: _barcode, boxPrice: _box, ...real } = p;
    return {
      ...structuredClone(real),
      id: `c-${id('prd')}`,
      active: false,
      cost: 0,
      priceToStore: 0,
      photoIds: [],
      // El costo es provisional: no se cargó todavía.
      sampleCost: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });
}

/** La cuenta de una línea en blanco. */
export function blankAdmin(line: LineId, nowIso: string, id = `${letterOf(line)}-usr_admin`): User {
  return { id, role: 'admin', name: BLANK_ADMIN_NAME, email: '', phone: '', active: true, createdAt: nowIso };
}

/** Lo que dice la auditoría al arrancar en blanco. */
export function blankAuditSummary(line: LineId): string {
  return line === 'cafe'
    ? 'Empezó en blanco con datos reales: quedan los 9 cafés de El Mío, sin precio al local ni costo y desactivados'
    : 'Empezó en blanco con datos reales';
}

/** Todas las tablas de una línea en blanco (lo que no está, queda vacío). */
export function buildBlankLine(line: LineId, now: Date): SeedTables {
  const at = now.toISOString();
  const admin = blankAdmin(line, at);
  const first: AuditEntry = {
    id: `${letterOf(line)}-aud_inicio`,
    at,
    actorId: admin.id,
    actorName: admin.name,
    role: 'admin',
    action: 'datos.empezar_en_blanco',
    entity: 'settings',
    entityId: 'settings',
    summary: blankAuditSummary(line),
  };
  return {
    settings: [blankSettings(line)],
    warehouses: [blankWarehouse(line)],
    zones: blankZones(line),
    users: [admin],
    audit: [first],
    products: line === 'cafe' ? elMioProducts(at) : [],
  };
}
