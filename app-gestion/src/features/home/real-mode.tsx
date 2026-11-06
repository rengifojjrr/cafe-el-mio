// Portada con datos reales: antes de borrar o reemplazar los datos de una empresa se pregunta de
// verdad (hay que escribir «borrar»). Se baja solo cuando alguna línea tiene datos reales.
import { RotateCcw, Upload } from 'lucide-react';
import { useState } from 'react';
import type { LineId } from '../../data/types';
import { lineConfig } from '../../lines/config';
import { importState, resetDemo } from '../../services/session';
import { Button, Sheet, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';

export function RealModeSheets({
  realLines,
  ecoName,
  resetOpen,
  importFile,
  onClose,
}: {
  realLines: LineId[];
  ecoName?: string;
  resetOpen: boolean;
  importFile: File | null;
  onClose: () => void;
}) {
  const { run, busy } = useAction();
  const [typed, setTyped] = useState('');
  const names = realLines.map((l) => lineConfig(l).name).join(' y ');
  const close = () => {
    setTyped('');
    onClose();
  };
  const reset = () =>
    void run(async () => {
      await resetDemo(new Date(), ecoName);
      close();
    }, 'Listo: datos de ejemplo cargados de nuevo.');
  const doImport = (file: File) => {
    close();
    void run(async () => importState(await file.text()), 'Listo: la demo quedó como en el respaldo.');
  };
  return (
    <>
      <Sheet open={resetOpen} onClose={close} title="Restablecer la demo">
        <p className="text-muted">Se borra todo lo que se hizo en este navegador y se cargan otra vez los datos de ejemplo, con fechas de hoy.</p>
        <div className="mt-4 grid gap-3">
          <div className="rounded-2xl border border-danger bg-danger-soft p-4" role="alert">
            <p className="font-bold text-danger">{names} tiene datos reales de tu empresa.</p>
            <p className="mt-1 text-ink">Restablecer los borra de este navegador y no se pueden recuperar sin una copia. Si no la tienes, cancela y toca «Exportar (JSON)».</p>
          </div>
          <TextInput label="Para confirmar, escribe borrar" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="danger" icon={RotateCcw} busy={busy} disabled={typed.trim().toLowerCase() !== 'borrar'} onClick={reset}>
            Sí, restablecer
          </Button>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
        </div>
      </Sheet>

      <Sheet open={importFile !== null} onClose={close} title="Importar el respaldo">
        <p className="text-ink">
          El respaldo reemplaza las dos líneas. {names} tiene datos reales: se cambian por los del archivo «{importFile?.name}».
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="danger" icon={Upload} busy={busy} onClick={() => importFile && doImport(importFile)}>
            Sí, importar
          </Button>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
        </div>
      </Sheet>
    </>
  );
}
