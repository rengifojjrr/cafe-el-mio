// Cámara y lectura de códigos. Se carga solo al abrir el lector. Usa el lector del navegador
// (BarcodeDetector) si lo trae y entiende los formatos; si no, @zxing/browser, que se baja aparte
// la primera vez que hace falta (por ejemplo en el iPhone).
// Solo tipos: se borran al compilar y no meten @zxing en este trozo.
import type { BrowserMultiFormatReader } from '@zxing/browser';
import type { DecodeHintType as HintType } from '@zxing/library';

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'code_128', 'qr_code'];

interface DetectedBarcode {
  rawValue: string;
}
interface NativeDetector {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
interface NativeDetectorCtor {
  new (opts?: { formats?: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

let nativePromise: Promise<NativeDetector | null> | null = null;

/** El lector del navegador, si existe y lee al menos uno de nuestros formatos. */
function nativeDetector(): Promise<NativeDetector | null> {
  nativePromise ??= (async () => {
    const Ctor = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
    if (!Ctor) return null;
    try {
      const supported = (await Ctor.getSupportedFormats?.()) ?? [];
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      return formats.length ? new Ctor({ formats }) : null;
    } catch {
      return null;
    }
  })();
  return nativePromise;
}

type ZxingReader = BrowserMultiFormatReader;
let zxingPromise: Promise<ZxingReader> | null = null;

/** @zxing/browser con nuestros formatos (EAN-13, EAN-8, UPC-A, Code 128 y QR). */
function zxingReader(): Promise<ZxingReader> {
  zxingPromise ??= (async () => {
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
    const hints = new Map<HintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 250 });
  })();
  zxingPromise.catch(() => {
    zxingPromise = null;
  });
  return zxingPromise;
}

export type CameraProblem = 'permiso' | 'sin_camara' | 'sin_https' | 'ocupada' | 'otro';

export class CameraError extends Error {
  constructor(
    readonly problem: CameraProblem,
    message: string,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

function toCameraError(e: unknown): CameraError {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new CameraError('permiso', 'No hay permiso para usar la cámara. Puedes darlo en los ajustes del navegador; mientras tanto, escribe el código o lee una foto.');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return new CameraError('sin_camara', 'No encontré una cámara en este aparato. Escribe el código o lee una foto.');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new CameraError('ocupada', 'La cámara está ocupada (otra app la está usando). Ciérrala y prueba de nuevo, o escribe el código.');
  }
  return new CameraError('otro', 'No pude abrir la cámara. Escribe el código o lee una foto.');
}

export interface CameraSession {
  /** Apaga la cámara (todas las pistas) y deja de leer. Se puede llamar más de una vez. */
  stop(): void;
  /** La linterna se puede prender en este teléfono. */
  torch: boolean;
  setTorch(on: boolean): Promise<void>;
  engine: 'navegador' | 'zxing';
}

/**
 * Prende la cámara de atrás en `video` y llama a `onText` con cada código leído. `cancelled`
 * se consulta después de cada espera: si el lector se cerró mientras tanto, se apaga todo.
 */
export async function startCamera(video: HTMLVideoElement, onText: (text: string) => void, cancelled: () => boolean = () => false): Promise<CameraSession> {
  if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('sin_https', 'La cámara solo funciona con una conexión segura (https). Escribe el código o lee una foto.');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    throw toCameraError(e);
  }
  let stopped = false;
  let stopDecode = () => {};
  const stopAll = () => {
    if (stopped) return;
    stopped = true;
    stopDecode();
    for (const t of stream.getTracks()) t.stop();
    if (video.srcObject === stream) video.srcObject = null;
  };
  if (cancelled()) {
    stopAll();
    throw new CameraError('otro', 'El lector se cerró.');
  }
  try {
    video.muted = true;
    video.setAttribute('playsinline', '');
    const track = stream.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
    const native = await nativeDetector();
    if (native) {
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      let timer = 0;
      let busy = false;
      const tick = async () => {
        if (stopped) return;
        if (!busy && video.readyState >= 2) {
          busy = true;
          try {
            const found = await native.detect(video);
            const text = found.find((f) => f.rawValue)?.rawValue;
            if (text && !stopped) onText(text);
          } catch {
            // Un cuadro sin código (o todavía sin imagen): se sigue intentando.
          }
          busy = false;
        }
        if (!stopped) timer = window.setTimeout(() => void tick(), 140);
      };
      stopDecode = () => window.clearTimeout(timer);
      void tick();
    } else {
      const reader = await zxingReader();
      if (cancelled()) {
        stopAll();
        throw new CameraError('otro', 'El lector se cerró.');
      }
      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result && !stopped) onText(result.getText());
      });
      stopDecode = () => controls.stop();
    }
    if (cancelled()) {
      stopAll();
      throw new CameraError('otro', 'El lector se cerró.');
    }
    return {
      stop: stopAll,
      torch: Boolean(caps.torch),
      setTorch: async (on: boolean) => {
        await track?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      },
      engine: native ? 'navegador' : 'zxing',
    };
  } catch (e) {
    stopAll();
    throw e instanceof CameraError ? e : toCameraError(e);
  }
}

/** Una foto elegida (o tomada) → el código que tenga, o null. Las fotos grandes se achican antes. */
export async function decodeImage(file: Blob): Promise<string | null> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  const bitmap = await createImageBitmap(file);
  try {
    const native = await nativeDetector();
    if (native) {
      try {
        const found = await native.detect(bitmap);
        const text = found.find((f) => f.rawValue)?.rawValue;
        if (text) return text;
      } catch {
        // Si el lector del navegador no puede, se prueba con zxing.
      }
    }
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.fillStyle = 'white';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const reader = await zxingReader();
    try {
      return reader.decodeFromCanvas(canvas).getText();
    } catch {
      return null;
    }
  } finally {
    bitmap.close?.();
  }
}
