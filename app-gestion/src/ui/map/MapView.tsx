// Mapa (Leaflet) con teselas oscuras de CARTO y respaldo en OpenStreetMap si fallan.
// Marcadores propios (divIcon): locales por estado y ventas, vendedores, almacén y punto elegido.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { StoreStatus } from '../../data/types';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: 'store' | 'seller' | 'warehouse';
  title: string;
  status?: StoreStatus;
  /** 0 a 1: escala por ventas. */
  weight?: number;
  /** Late si tiene un pedido pendiente. */
  pulse?: boolean;
  /** Texto corto dentro del marcador (iniciales del vendedor o número de la ruta). */
  label?: string;
  selected?: boolean;
}

export interface MapViewProps {
  markers: MapMarker[];
  route?: [number, number][];
  onMarkerClick?: (id: string) => void;
  /** Modo «tocar el mapa para poner el punto». */
  pick?: { value: { lat: number; lng: number } | null; onPick: (p: { lat: number; lng: number }) => void };
  center?: [number, number];
  zoom?: number;
  className?: string;
  /** Cambia este valor para volver a encuadrar todos los marcadores. */
  fitKey?: string;
  label: string;
}

const CARTO_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const WAREHOUSE_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect width="12" height="12" x="6" y="10"/></svg>';

function iconFor(m: MapMarker): L.DivIcon {
  if (m.kind === 'warehouse') {
    return L.divIcon({ className: 'mk-wrap', html: `<span class="mk mk-warehouse" title="${escapeHtml(m.title)}">${WAREHOUSE_SVG}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] });
  }
  if (m.kind === 'seller') {
    // El vendedor se dibuja arriba a la derecha de su punto, para no tapar el local de su última visita.
    return L.divIcon({ className: 'mk-wrap', html: `<span class="mk mk-seller" title="${escapeHtml(m.title)}">${escapeHtml(m.label ?? '')}</span>`, iconSize: [34, 34], iconAnchor: [-4, 38] });
  }
  const size = Math.round(16 + (m.weight ?? 0) * 18);
  const cls = ['mk', 'mk-store', `mk-${m.status ?? 'activo'}`, m.pulse ? 'mk-pulse' : '', m.selected ? 'mk-selected' : ''].join(' ');
  return L.divIcon({
    className: 'mk-wrap',
    html: `<span class="${cls}" style="width:${size}px;height:${size}px" title="${escapeHtml(m.title)}">${m.label ? `<b>${escapeHtml(m.label)}</b>` : ''}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function pickIcon(): L.DivIcon {
  return L.divIcon({ className: 'mk-wrap', html: '<span class="mk mk-pick"></span>', iconSize: [30, 30], iconAnchor: [15, 28] });
}

export default function MapView({ markers, route, onMarkerClick, pick, center, zoom = 11, className = '', fitKey, label }: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const routeLayer = useRef<L.Polyline | null>(null);
  const pickMarker = useRef<L.Marker | null>(null);
  const onClickRef = useRef(onMarkerClick);
  onClickRef.current = onMarkerClick;
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const fitted = useRef<string | undefined>(undefined);

  // Crear el mapa una sola vez.
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, center: center ?? [25.79, -80.27], zoom, scrollWheelZoom: true });
    // En desarrollo (StrictMode) el mapa se crea dos veces: el nuevo tiene que volver a encuadrar.
    fitted.current = undefined;
    const light = document.documentElement.dataset.theme === 'light';
    const carto = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${light ? 'light_all' : 'dark_all'}/{z}/{x}/{y}{r}.png`, {
      attribution: CARTO_ATTR,
      subdomains: 'abcd',
      maxZoom: 19,
    });
    let errors = 0;
    let loaded = 0;
    carto.on('tileload', () => {
      loaded += 1;
    });
    carto.on('tileerror', () => {
      errors += 1;
      if (errors >= 4 && loaded === 0 && m.hasLayer(carto)) {
        m.removeLayer(carto);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: OSM_ATTR, maxZoom: 19 }).addTo(m);
      }
    });
    carto.addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      pickRef.current?.onPick({ lat: Number(e.latlng.lat.toFixed(6)), lng: Number(e.latlng.lng.toFixed(6)) });
    });
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marcadores.
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const mk of markers) {
      const marker = L.marker([mk.lat, mk.lng], { icon: iconFor(mk), title: mk.title, keyboard: true, riseOnHover: true, zIndexOffset: mk.kind === 'warehouse' ? 500 : mk.selected ? 1000 : mk.kind === 'seller' ? -100 : 0 });
      marker.on('click', () => onClickRef.current?.(mk.id));
      marker.on('keypress', (e: L.LeafletKeyboardEvent) => {
        if (e.originalEvent.key === 'Enter') onClickRef.current?.(mk.id);
      });
      marker.addTo(g);
    }
    if (fitted.current !== (fitKey ?? 'default') && markers.length > 0) {
      fitted.current = fitKey ?? 'default';
      const b = L.latLngBounds(markers.map((x) => [x.lat, x.lng] as [number, number]));
      if (pick?.value) b.extend([pick.value.lat, pick.value.lng]);
      m.fitBounds(b.pad(0.15), { maxZoom: 14 });
    }
  }, [markers, fitKey, pick?.value]);

  // Ruta del día.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    routeLayer.current?.remove();
    routeLayer.current = null;
    if (route && route.length > 1) {
      routeLayer.current = L.polyline(route, { className: 'mk-route', weight: 3, dashArray: '6 8' }).addTo(m);
    }
  }, [route]);

  // Punto elegido.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pick?.value) {
      pickMarker.current?.remove();
      pickMarker.current = null;
      return;
    }
    const ll: [number, number] = [pick.value.lat, pick.value.lng];
    if (!pickMarker.current) {
      pickMarker.current = L.marker(ll, { icon: pickIcon(), draggable: true, title: 'Ubicación elegida' }).addTo(m);
      pickMarker.current.on('dragend', () => {
        const p = pickMarker.current!.getLatLng();
        pickRef.current?.onPick({ lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)) });
      });
      if (markers.length === 0) m.setView(ll, Math.max(m.getZoom(), 15));
    } else {
      pickMarker.current.setLatLng(ll);
    }
  }, [pick?.value, markers.length]);

  return <div ref={el} className={`mapa relative z-0 overflow-hidden rounded-[20px] border border-line ${className}`} role="region" aria-label={label} />;
}
