// El programa como se publica: solo Tabaco. Arranca en cero con sus propias bases de datos, no crea
// ni muestra nada del café, no acepta cuentas, copias ni invitaciones de café, y borra las bases de
// antes (las dos líneas juntas) cuando solo tenían ejemplos.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { LineId } from '../../src/data/types';
import { getCoreRepo, getLineRepo, setDbPrefix } from '../../src/data';
import { coreDbName, lineDbName } from '../../src/data/local/dexie';
import { removeOldDatabases } from '../../src/data/local/old-databases';
import { decodeInvitationToken, encodeInvitationToken } from '../../src/domain/invitation';
import type { Actor } from '../../src/domain/permissions';
import { PROGRAM_LINE, programLines, setProgramLines } from '../../src/lines/programa';
import { lineCtx } from '../../src/services/context';
import { exportLine, importLine } from '../../src/services/real-data';
import {
  allowDemoData,
  exportState,
  findAccount,
  getLineDataMode,
  importState,
  listAccounts,
  resetDemo,
  resolveActor,
  seedIfNeeded,
} from '../../src/services/session';

const NOW = new Date('2026-11-09T15:00:00Z');

async function databases(): Promise<string[]> {
  return (await indexedDB.databases()).map((d) => d.name ?? '');
}

async function ctxFor(line: LineId, accountId: string) {
  const acc = await findAccount(accountId);
  if (!acc) throw new Error(`No existe ${accountId}`);
  const actor: Actor = { accountId: acc.id, userId: acc.userId, role: acc.role, line: acc.line, storeId: acc.storeId, name: acc.name, readOnly: false };
  return lineCtx(line, actor, { repo: getLineRepo(line), now: () => NOW });
}

/** Crea una base vieja (como las de antes de separar las líneas) con sus ajustes. */
function oldDb(name: string, settings?: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('settings', { keyPath: 'id' });
      db.createObjectStore('products', { keyPath: 'id' });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('settings', 'readwrite');
      if (settings) tx.objectStore('settings').put({ id: 'settings', ...settings });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
}

beforeEach(() => {
  setProgramLines(null);
  allowDemoData(true);
});

afterAll(() => {
  // Las demás pruebas del archivo de configuración usan las dos líneas.
  setProgramLines(['tabaco', 'cafe']);
});

describe('el programa de Tabaco', () => {
  it('es solo de Tabaco y guarda en sus propias bases de datos', () => {
    expect(PROGRAM_LINE).toBe('tabaco');
    expect(programLines()).toEqual(['tabaco']);
    expect(lineDbName('tabaco')).toBe('tabaco-datos');
    expect(coreDbName()).toBe('tabaco-cuentas');
  });

  it('un navegador nuevo arranca en cero: solo Tabaco, sin crear la base del café', async () => {
    setDbPrefix('pruebas-programa-nuevo-');
    await seedIfNeeded(NOW, { demo: false });
    expect(await getLineDataMode('tabaco')).toBe('real');
    expect(await getLineRepo('tabaco').products.count()).toBe(0);
    expect(await getLineRepo('tabaco').stores.count()).toBe(0);
    const names = await databases();
    expect(names).toContain('pruebas-programa-nuevo-tabaco-datos');
    expect(names).toContain('pruebas-programa-nuevo-tabaco-cuentas');
    expect(names.filter((n) => n.startsWith('pruebas-programa-nuevo-') && n.includes('cafe'))).toEqual([]);

    const { primary } = await listAccounts();
    expect(primary.map((a) => a.id)).toEqual(['direccion', 'tabaco:admin']);
    expect(await resolveActor('cafe')).toBeNull();
  });

  it('con la marca de pruebas, la demo es solo de Tabaco', async () => {
    setDbPrefix('pruebas-programa-demo-');
    await resetDemo(NOW);
    expect(await getLineRepo('tabaco').products.count()).toBe(21);
    const { primary } = await listAccounts();
    expect(primary.map((a) => a.id)).toEqual(['direccion', 'tabaco:admin', 'tabaco:seller', 'tabaco:store']);
    expect((await databases()).filter((n) => n.startsWith('pruebas-programa-demo-') && n.includes('cafe'))).toEqual([]);
  });

  it('una cuenta de café no existe aquí, aunque haya quedado anotada', async () => {
    await getCoreRepo().directory.put({ id: 'cafe:admin', role: 'admin', line: 'cafe', userId: 'c-usr_0001', name: 'Marta', label: 'Administración de Café', primary: true });
    expect(await findAccount('cafe:admin')).toBeNull();
    expect((await listAccounts()).primary.some((a) => a.line === 'cafe')).toBe(false);
  });

  it('el respaldo es solo de Tabaco; uno viejo con las dos líneas carga Tabaco y deja el café afuera', async () => {
    const mine = JSON.parse(await exportState()) as { lines: Record<string, unknown> };
    expect(Object.keys(mine.lines)).toEqual(['tabaco']);

    // Un respaldo de antes, con las dos líneas.
    setProgramLines(['tabaco', 'cafe']);
    setDbPrefix('pruebas-programa-viejo-');
    await resetDemo(NOW);
    const old = await exportState();
    setProgramLines(null);
    setDbPrefix('pruebas-programa-importar-');
    await importState(old);
    expect(await getLineRepo('tabaco').products.count()).toBe(21);
    expect((await listAccounts()).primary.map((a) => a.id)).toEqual(['direccion', 'tabaco:admin', 'tabaco:seller', 'tabaco:store']);
    expect((await getCoreRepo().directory.all()).some((a) => a.line === 'cafe')).toBe(false);
    expect((await databases()).filter((n) => n.startsWith('pruebas-programa-importar-') && n.includes('cafe'))).toEqual([]);
  });

  it('la copia de la línea Café no entra: es de otro programa', async () => {
    setProgramLines(['tabaco', 'cafe']);
    setDbPrefix('pruebas-programa-copia-');
    await resetDemo(NOW);
    const { json } = await exportLine(await ctxFor('cafe', 'cafe:admin'));
    setProgramLines(null);
    await expect(importLine(await ctxFor('tabaco', 'tabaco:admin'), json)).rejects.toThrow(/Café, que es otro programa: aquí solo va Tabaco/);
  });

  it('una invitación a café no se acepta', () => {
    const exp = new Date(NOW.getTime() + 86_400_000).toISOString();
    const tabaco = encodeInvitationToken({ line: 'tabaco', accountId: 'tabaco:t-usr_0002', inv: 'inv_1', exp });
    const cafe = encodeInvitationToken({ line: 'cafe', accountId: 'cafe:c-usr_0002', inv: 'inv_2', exp });
    expect(decodeInvitationToken(tabaco)).not.toBeNull();
    expect(decodeInvitationToken(cafe)).toBeNull();
  });
});

describe('las bases de antes de separar Tabaco y Café', () => {
  it('se borran si solo tenían ejemplos', async () => {
    await oldDb('eco-tabaco', {});
    await oldDb('eco-cafe', { dataMode: 'demo' });
    await oldDb('eco-core');
    expect((await removeOldDatabases()).sort()).toEqual(['eco-cafe', 'eco-core', 'eco-tabaco']);
    expect((await databases()).filter((n) => n.startsWith('eco-'))).toEqual([]);
  });

  it('si una tenía datos reales, esa y la común se dejan quietas', async () => {
    await oldDb('eco-tabaco', { dataMode: 'real' });
    await oldDb('eco-cafe', {});
    await oldDb('eco-core');
    expect(await removeOldDatabases()).toEqual(['eco-cafe']);
    expect((await databases()).filter((n) => n.startsWith('eco-')).sort()).toEqual(['eco-core', 'eco-tabaco']);
  });
});
