// Aviso de «los datos cambiaron». Cada escritura de un servicio lo emite y las pantallas
// que leen esa línea vuelven a pedir sus datos.
type Channel = 'tabaco' | 'cafe' | 'core';
type Listener = () => void;

const versions: Record<Channel, number> = { tabaco: 0, cafe: 0, core: 0 };
const listeners = new Set<Listener>();

export function emitChange(channel: Channel): void {
  versions[channel] += 1;
  for (const l of listeners) l();
}

export function emitAll(): void {
  versions.tabaco += 1;
  versions.cafe += 1;
  versions.core += 1;
  for (const l of listeners) l();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function version(channel: Channel): number {
  return versions[channel];
}

export function versionKey(): string {
  return `${versions.tabaco}.${versions.cafe}.${versions.core}`;
}
