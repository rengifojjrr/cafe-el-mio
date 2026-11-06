// Firma en pantalla (signature_pad). Devuelve el trazo como PNG.
import { Eraser } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type SignaturePadType from 'signature_pad';

export function SignatureField({ label, onChange, disabled }: { label: string; onChange: (png: string | null) => void; disabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadType | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [empty, setEmpty] = useState(true);
  const id = useId();

  useEffect(() => {
    let alive = true;
    let ro: ResizeObserver | null = null;
    void import('signature_pad').then(({ default: SignaturePad }) => {
      const canvas = canvasRef.current;
      if (!alive || !canvas) return;
      const css = getComputedStyle(document.documentElement);
      const pad = new SignaturePad(canvas, {
        penColor: css.getPropertyValue('--firma-tinta').trim() || undefined,
        backgroundColor: css.getPropertyValue('--firma-papel').trim() || undefined,
        minWidth: 0.9,
        maxWidth: 2.6,
      });
      padRef.current = pad;
      const resize = () => {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const data = pad.isEmpty() ? null : pad.toData();
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext('2d')?.scale(ratio, ratio);
        pad.clear();
        if (data) pad.fromData(data);
      };
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(canvas);
      pad.addEventListener('endStroke', () => {
        setEmpty(pad.isEmpty());
        onChangeRef.current(pad.isEmpty() ? null : pad.toDataURL('image/png'));
      });
      if (disabled) pad.off();
    });
    return () => {
      alive = false;
      ro?.disconnect();
      padRef.current?.off();
      padRef.current = null;
    };
  }, [disabled]);

  return (
    <div className="field">
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="relative overflow-hidden rounded-2xl border border-line bg-papel">
        <canvas ref={canvasRef} className="block h-44 w-full touch-none" aria-labelledby={id} role="img" aria-label={`${label}: firma con el dedo dentro del recuadro`} />
        {empty ? <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm text-papel-suave">Firma aquí con el dedo</span> : null}
        <span className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-dashed border-papel-linea" aria-hidden />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-ghost min-h-10 text-sm"
          onClick={() => {
            padRef.current?.clear();
            setEmpty(true);
            onChange(null);
          }}
          disabled={empty}
        >
          <Eraser aria-hidden /> Borrar firma
        </button>
      </div>
    </div>
  );
}

/** Pide la ubicación una vez (si la persona la da). Nunca hace seguimiento continuo. */
export function askLocation(): Promise<{ lat: number; lng: number; accuracy: number } | undefined> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)), accuracy: Math.round(pos.coords.accuracy) }),
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}
