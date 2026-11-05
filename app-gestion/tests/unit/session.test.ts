// Exportar e importar el estado de la demo (JSON), y restablecer.
import { beforeAll, describe, expect, it } from 'vitest';
import { getCoreRepo, getLineRepo, setDbPrefix } from '../../src/data';
import { enterAs, exportState, findAccount, importState, listAccounts, resetDemo, resolveActor, viewAs } from '../../src/services/session';

const NOW = new Date('2026-11-05T15:00:00Z');

beforeAll(async () => {
  setDbPrefix('pruebas-sesion-');
  await resetDemo(NOW);
});

describe('sesión y respaldo de la demo', () => {
  it('hay una cuenta principal por rol de cada línea, más Dirección', async () => {
    const { primary } = await listAccounts();
    expect(primary.map((a) => a.id).sort()).toEqual(['cafe:admin', 'cafe:seller', 'cafe:store', 'direccion', 'tabaco:admin', 'tabaco:seller', 'tabaco:store'].sort());
  });

  it('una cuenta de Tabaco no tiene actor en Café', async () => {
    await enterAs('tabaco:seller');
    expect(await resolveActor('tabaco')).not.toBeNull();
    expect(await resolveActor('cafe')).toBeNull();
  });

  it('«ver como…» da un actor de solo lectura, y un vendedor no puede usarlo', async () => {
    await enterAs('tabaco:admin');
    await viewAs('tabaco:seller');
    const r = await resolveActor('tabaco');
    expect(r?.actor.role).toBe('seller');
    expect(r?.actor.readOnly).toBe(true);
    await enterAs('tabaco:seller');
    await expect(viewAs('tabaco:store')).rejects.toThrow();
  });

  it('exportar e importar deja exactamente los mismos datos', async () => {
    const json = await exportState();
    const before = await getLineRepo('cafe').movements.count();
    await getLineRepo('cafe').clearAll();
    expect(await getLineRepo('cafe').movements.count()).toBe(0);
    await importState(json);
    expect(await getLineRepo('cafe').movements.count()).toBe(before);
    expect(await findAccount('cafe:store')).not.toBeNull();
    expect((await getCoreRepo().session.get('session'))?.accountId).toBeNull();
  });

  it('un archivo que no es un respaldo se rechaza sin tocar nada', async () => {
    const count = await getLineRepo('tabaco').products.count();
    await expect(importState('{"hola":"mundo"}')).rejects.toThrow();
    await expect(importState('no es json')).rejects.toThrow('JSON');
    expect(await getLineRepo('tabaco').products.count()).toBe(count);
  });
});
