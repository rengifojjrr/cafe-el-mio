// «Ver en 3D»: un tabaco generado con su largo, su cepo, el color de su capa y su anilla,
// dibujado en un canvas (sin three.js: pesa unos pocos KB y se baja solo al tocar el botón).
// Se gira arrastrando, se acerca con dos dedos o con la rueda. Gira solo hasta que lo tocan.
import { useEffect, useRef, useState } from 'react';

type RGB = [number, number, number];

/** Lee un color del tema (tokens.css) y lo pasa a RGB. */
function cssColor(name: string, fallback: RGB): RGB {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1]!.length === 3 ? hex[1]!.replace(/./g, (c) => c + c) : hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return fallback;
}

/** [r, g, b] → «#rrggbb» para el canvas (los colores salen de los tokens, no se escriben aquí). */
function toHex(c: readonly number[]): string {
  return `#${c.map((ch) => Math.max(0, Math.min(255, Math.round(ch))).toString(16).padStart(2, '0')).join('')}`;
}

function isPointed(vitola: string): number {
  const v = vitola.toLowerCase();
  if (/(torpedo|pir[aá]mide|figurado|salom)/.test(v)) return 0.95;
  if (/belicoso/.test(v)) return 0.6;
  return 0;
}

interface Quad {
  pts: [number, number][];
  depth: number;
  color: string;
}

/** Radio del tabaco a lo largo (x de 0 = pie a L = cabeza), en pulgadas. */
function radiusAt(x: number, L: number, R: number, taper: number): number {
  if (x < 0.04) return R * (0.93 + 0.07 * (x / 0.04));
  if (taper > 0) {
    const start = L - taper;
    if (x <= start) return R;
    const t = (x - start) / taper;
    return R * Math.max(0.08, Math.cos((t * Math.PI) / 2) ** 0.85);
  }
  const start = L - R;
  if (x <= start) return R;
  const t = Math.min(1, (x - start) / R);
  return R * Math.sqrt(Math.max(0, 1 - t * t));
}

export function Cigar3D({ lengthIn, ringGauge, shade, vitola, label }: { lengthIn: number; ringGauge: number; shade: string; vitola: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const view = useRef({ yaw: -0.55, pitch: 0.32, zoom: 1, auto: true });
  const [hint, setHint] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const base = cssColor(`--capa-${shade}`, [154, 91, 51]);
    const band = cssColor('--anilla', [217, 164, 65]);
    const bandInk = cssColor('--anilla-tinta', [26, 18, 8]);
    const L = lengthIn;
    const R = ringGauge / 64 / 2;
    const taper = isPointed(vitola);
    const bandStart = L - (taper ? taper + 0.55 : 1.15);
    const bandEnd = bandStart + 0.48;
    const NX = 72;
    const NT = 28;
    // Vetas: variación fija alrededor (siempre igual para el mismo tabaco).
    const veins = Array.from({ length: NT }, (_, j) => 0.9 + 0.1 * Math.sin(j * 2.7 + ringGauge) * Math.cos(j * 1.3));
    let width = 0;
    let height = 0;
    let frame = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = wrap.clientWidth;
      height = Math.round(Math.min(420, Math.max(260, width * 0.62)));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = () => {
      const { yaw, pitch, zoom } = view.current;
      ctx.clearRect(0, 0, width, height);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const scale = ((Math.min(width, height * 1.9) * 0.78) / L) * zoom;
      const camera = L * 2.4;
      const light = [-0.35, 0.62, 0.7];
      const project = (x: number, y: number, z: number): [number, number, number] => {
        // Centrado en el medio del tabaco; giro (yaw) alrededor del eje vertical y luego inclinación.
        const px = x - L / 2;
        const rx = px * cy + z * sy;
        const rz = -px * sy + z * cy;
        const ry = y * cp - rz * sp;
        const rz2 = y * sp + rz * cp;
        const f = camera / (camera + rz2);
        return [width / 2 + rx * scale * f, height / 2 - ry * scale * f, rz2];
      };
      const rotN = (nx: number, ny: number, nz: number): [number, number, number] => {
        const rx = nx * cy + nz * sy;
        const rz = -nx * sy + nz * cy;
        return [rx, ny * cp - rz * sp, ny * sp + rz * cp];
      };
      const quads: Quad[] = [];
      for (let i = 0; i < NX; i++) {
        const xa = (L * i) / NX;
        const xb = (L * (i + 1)) / NX;
        const ra = radiusAt(xa, L, R, taper);
        const rb = radiusAt(xb, L, R, taper);
        const slope = (ra - rb) / (xb - xa);
        const xm = (xa + xb) / 2;
        const inBand = xm >= bandStart && xm <= bandEnd;
        const inInk = inBand && xm >= bandStart + 0.17 && xm <= bandStart + 0.31;
        for (let j = 0; j < NT; j++) {
          const ta = (j / NT) * Math.PI * 2;
          const tb = ((j + 1) / NT) * Math.PI * 2;
          const tm = (ta + tb) / 2;
          // Normal de la superficie de revolución (inclinada en la cabeza).
          const n = rotN(slope, Math.cos(tm), Math.sin(tm));
          const len = Math.hypot(n[0], n[1], n[2]);
          const nn: [number, number, number] = [n[0] / len, n[1] / len, n[2] / len];
          if (nn[2] > 0.25) continue; // Mira para atrás: no se dibuja.
          const p1 = project(xa, ra * Math.cos(ta), ra * Math.sin(ta));
          const p2 = project(xb, rb * Math.cos(ta), rb * Math.sin(ta));
          const p3 = project(xb, rb * Math.cos(tb), rb * Math.sin(tb));
          const p4 = project(xa, ra * Math.cos(tb), ra * Math.sin(tb));
          const diffuse = Math.max(0, nn[0] * light[0]! + nn[1] * light[1]! - nn[2] * light[2]!);
          const spec = diffuse ** 18 * 0.35;
          const tone = inBand ? 1 : veins[j]!;
          const k = (0.32 + 0.78 * diffuse) * tone;
          const src = inInk ? bandInk : inBand ? band : base;
          const shine = inBand ? spec * 1.6 : spec;
          const c = src.map((ch) => Math.round(Math.min(255, ch * k + 255 * shine)));
          quads.push({ pts: [p1, p2, p3, p4].map((pt) => [pt[0], pt[1]] as [number, number]), depth: (p1[2] + p2[2] + p3[2] + p4[2]) / 4, color: toHex(c) });
        }
      }
      // El pie (la boca cortada): un disco más oscuro.
      const foot: [number, number][] = [];
      for (let j = 0; j <= NT; j++) {
        const t = (j / NT) * Math.PI * 2;
        const pt = project(0, R * 0.93 * Math.cos(t), R * 0.93 * Math.sin(t));
        foot.push([pt[0], pt[1]]);
      }
      const footNormal = rotN(-1, 0, 0);
      quads.sort((a, b) => b.depth - a.depth);
      const drawFoot = () => {
        if (footNormal[2] > 0) return;
        ctx.beginPath();
        foot.forEach(([x, y], idx) => (idx ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = toHex(base.map((ch) => ch * 0.55));
        ctx.fill();
      };
      const footDepth = project(0, 0, 0)[2];
      let footDrawn = false;
      for (const q of quads) {
        if (!footDrawn && q.depth < footDepth) {
          drawFoot();
          footDrawn = true;
        }
        ctx.beginPath();
        ctx.moveTo(q.pts[0]![0], q.pts[0]![1]);
        for (let k = 1; k < 4; k++) ctx.lineTo(q.pts[k]![0], q.pts[k]![1]);
        ctx.closePath();
        ctx.fillStyle = q.color;
        ctx.fill();
        ctx.strokeStyle = q.color;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      if (!footDrawn) drawFoot();
    };

    const loop = () => {
      if (view.current.auto) view.current.yaw += 0.006;
      draw();
      frame = requestAnimationFrame(loop);
    };

    // Arrastrar para girar; dos dedos para acercar.
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      view.current.auto = false;
      setHint(false);
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch) view.current.zoom = Math.min(2.6, Math.max(0.6, view.current.zoom * (dist / pinch)));
        pinch = dist;
        return;
      }
      view.current.yaw += (e.clientX - prev.x) * 0.011;
      view.current.pitch = Math.min(1.2, Math.max(-1.2, view.current.pitch + (e.clientY - prev.y) * 0.008));
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.current.auto = false;
      view.current.zoom = Math.min(2.6, Math.max(0.6, view.current.zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(() => resize());
    ro.observe(wrap);
    resize();
    loop();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [lengthIn, ringGauge, shade, vitola]);

  return (
    <div ref={wrapRef} className="hero-producto touch-none select-none">
      <canvas ref={canvasRef} role="img" aria-label={`${label} en 3D: ${lengthIn} pulgadas de largo, cepo ${ringGauge}. Arrastra para girarlo.`} className="block cursor-grab active:cursor-grabbing" />
      <p className={`px-4 pb-3 text-sm text-hero-tenue transition-opacity ${hint ? 'opacity-100' : 'opacity-60'}`}>Arrastra para girarlo. Con dos dedos (o la rueda) lo acercas o lo alejas.</p>
    </div>
  );
}
