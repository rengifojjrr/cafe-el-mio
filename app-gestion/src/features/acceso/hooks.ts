import { useSyncExternalStore } from 'react';
import { alCambiarSesion, sesionActual, type SesionServidor } from '../../servidor/cliente';
import { alCambiarEstado, estadoSync, type EstadoSync } from '../../servidor/sincronizar';

/** La sesión del servidor en este teléfono (se actualiza al entrar o salir, también desde otra pestaña). */
export function useSesionServidor(): SesionServidor | null {
  return useSyncExternalStore(alCambiarSesion, sesionActual, () => null);
}

/** Cómo va la sincronización. */
export function useEstadoSync(): EstadoSync {
  return useSyncExternalStore(alCambiarEstado, estadoSync, estadoSync);
}
