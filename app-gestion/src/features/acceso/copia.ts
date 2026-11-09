// Descargar la copia completa (JSON) de lo que hay en este teléfono.
import { exportState } from '../../services/session';

export async function descargarCopia(nombre = 'copia-grupo-miami'): Promise<void> {
  const json = await exportState();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombre}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
