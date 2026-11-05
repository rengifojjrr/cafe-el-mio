// Carga perezosa del mapa: Leaflet solo se descarga en las pantallas que lo usan.
import { lazy, Suspense } from 'react';
import type { MapViewProps } from './MapView';

export type { MapMarker, MapViewProps } from './MapView';

const MapViewLazy = lazy(() => import('./MapView'));

export function MapView(props: MapViewProps) {
  return (
    <Suspense fallback={<div className={`skeleton ${props.className ?? ''}`} aria-label="Cargando el mapa" />}>
      <MapViewLazy {...props} />
    </Suspense>
  );
}

/** Enlace de «Cómo llegar» con Google Maps (abre la app de mapas del teléfono). */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
