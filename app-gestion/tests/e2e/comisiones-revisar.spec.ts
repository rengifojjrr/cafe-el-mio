// Comisiones por revisar: cada vendedor sube sus comisiones desde su teléfono y el servidor no
// recalcula el monto. Administración ve, antes de pagar, las que no cuadran con su venta.
import { expect, test } from '@playwright/test';
import { enterAs, go } from './helpers';

test('una comisión inflada sale en «Comisiones por revisar» y al pagar', async ({ page }) => {
  await enterAs(page, 'tabaco:admin');
  await go(page, '/tabaco/comisiones');
  await expect(page.getByRole('heading', { level: 1, name: 'Comisiones' })).toBeVisible();
  // Con los datos de ejemplo, todas cuadran.
  await expect(page.getByText(/no cuadran? con su venta/)).toHaveCount(0);

  // Una comisión por cobrar, con el monto cambiado en la base del teléfono (como la mandaría alguien
  // que llama al servidor a mano).
  const vendedor = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('tabaco-datos');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const todas = (key: string) =>
      new Promise<Record<string, unknown>[]>((resolve) => {
        const r = db.transaction(key).objectStore(key).getAll();
        r.onsuccess = () => resolve(r.result as Record<string, unknown>[]);
      });
    const comms = await todas('commissions');
    const c = comms.find((x) => x.status === 'pagable' && x.salesReportId)!;
    await new Promise<void>((resolve) => {
      const tx = db.transaction('commissions', 'readwrite');
      tx.objectStore('commissions').put({ ...c, amount: Number(c.amount) + 500 });
      tx.oncomplete = () => resolve();
    });
    const users = await todas('users');
    db.close();
    return String(users.find((u) => u.id === c.sellerId)!.name);
  });

  await page.reload();
  const aviso = page.getByRole('note').filter({ hasText: 'Una comisión no cuadra con su venta.' });
  await expect(aviso).toBeVisible();
  await expect(aviso.getByText(/Con la venta y su regla serían \$/)).toBeVisible();
  await expect(aviso).toContainText(vendedor);
  if (process.env.CAPTURAS_REVISION) {
    await aviso.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/comisiones-aviso-${test.info().project.name}.png` });
  }

  // Al pagarle a ese vendedor, la hoja lo vuelve a decir (y deja pagar: solo marca).
  await page.getByRole('listitem').filter({ hasText: vendedor }).getByRole('button', { name: 'Pagar comisiones' }).click();
  const hoja = page.getByRole('dialog', { name: 'Pagar comisiones' });
  await expect(hoja.getByText('Una de estas comisiones no cuadra con su venta:')).toBeVisible();
  await expect(hoja.getByRole('button', { name: 'Marcar como pagadas' })).toBeEnabled();
  if (process.env.CAPTURAS_REVISION) await page.screenshot({ path: `test-results/comisiones-revisar-${test.info().project.name}.png`, fullPage: false });
});
