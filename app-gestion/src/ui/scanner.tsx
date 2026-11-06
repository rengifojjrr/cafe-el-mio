// «Escanear»: lee un código de barras o QR y se lo pasa a quien lo pidió (recibir, contar,
// venta rápida, preparar una entrega, la visita). Siempre se puede escribir el código a mano.
// La cámara (BarcodeDetector o @zxing/browser) se carga aparte, solo al abrir el lector.
import { Keyboard, ScanBarcode } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { cleanCode } from '../lib/barcode';
import { Button, Sheet, TextInput } from './kit';

export interface ScanProps {
  /** Se llama con el código limpio (sin espacios ni guiones). */
  onCode: (code: string) => void | Promise<void>;
  label?: string;
  /** Para contar o recibir: el lector queda abierto después de cada lectura. */
  continuous?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
}

/** Botón que abre el lector. */
export function ScanButton({ onCode, label = 'Escanear', continuous, disabled, variant = 'secondary' }: ScanProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} icon={ScanBarcode} onClick={() => setOpen(true)} disabled={disabled}>
        {label}
      </Button>
      <ScanSheet
        open={open}
        onClose={() => setOpen(false)}
        onCode={async (code) => {
          await onCode(code);
          if (!continuous) setOpen(false);
        }}
      />
    </>
  );
}

/** El lector: por ahora, escribir el código a mano (la cámara se agrega en su trozo aparte). */
export function ScanSheet({ open, onClose, onCode, title = 'Escanear' }: { open: boolean; onClose: () => void; onCode: (code: string) => void | Promise<void>; title?: string }) {
  const [manual, setManual] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const code = cleanCode(manual);
    if (!code) return;
    setManual('');
    await onCode(code);
  };
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form className="grid gap-3" onSubmit={(e) => void submit(e)}>
        <TextInput
          label="Escribe el código"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="Código de barras, SKU o número de caja"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          data-testid="codigo-manual"
        />
        <Button type="submit" variant="primary" icon={Keyboard} disabled={!manual.trim()}>
          Usar este código
        </Button>
      </form>
    </Sheet>
  );
}
