// Aviso de copia de seguridad pendiente: con datos reales, si pasaron 7 días o más desde la
// última «Exportar» de la línea (o si nunca se exportó y ya hay algo cargado).
import { Download, FileSpreadsheet, ShieldAlert } from 'lucide-react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { downloadText } from '../../lib/download';
import { type BackupStatus, backupStatus, exportLine } from '../../services/real-data';
import { Button, LinkButton } from '../../ui/kit';
import { useAction } from '../../ui/toast';

/** Exporta la copia de la línea y la descarga. Devuelve el nombre del archivo. */
export function useExportLine() {
  const { ctx } = useLine();
  const { run, busy } = useAction();
  const exportNow = () =>
    run(
      async () => {
        const { fileName, json } = await exportLine(ctx);
        downloadText(fileName, json);
        return fileName;
      },
      (fileName) => `Copia descargada: ${fileName}. Guárdala fuera de este teléfono.`,
    );
  return { exportNow, busy };
}

export function backupText(s: BackupStatus, lineName: string): string {
  if (s.daysSince === null) return `Todavía no hay una copia de seguridad de ${lineName}.`;
  return `La última copia de ${lineName} es de hace ${s.daysSince} ${s.daysSince === 1 ? 'día' : 'días'}.`;
}

export function BackupNotice({ className = '', firstSteps }: { className?: string; firstSteps?: boolean }) {
  const { ctx, actor, config, p } = useLine();
  const canExport = actor.role === 'admin' && !actor.readOnly;
  const status = useAsync(() => (canExport ? backupStatus(ctx) : Promise.resolve(null)), [ctx, canExport]);
  const { exportNow, busy } = useExportLine();
  const s = status.data;
  // Recién empezado en blanco: lo primero es cargar el catálogo.
  if (firstSteps && s?.mode === 'real' && s.products === 0) {
    return (
      <div className={`flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-accent-soft p-4 ${className}`}>
        <FileSpreadsheet className="h-6 w-6 flex-none text-accent" aria-hidden />
        <div className="min-w-0 flex-1 basis-56">
          <p className="font-bold text-ink">{config.name} está en blanco, lista para tus datos.</p>
          <p className="text-sm text-ink">Empieza por el catálogo: importa tus productos desde el Excel de Odoo (o cualquier .xlsx o .csv).</p>
        </div>
        <LinkButton to={p('catalogo/importar')} variant="primary" icon={FileSpreadsheet}>
          Importar productos
        </LinkButton>
      </div>
    );
  }
  if (!s?.due) return null;
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-2xl border border-warn bg-warn-soft p-4 ${className}`} data-testid="aviso-copia">
      <ShieldAlert className="h-6 w-6 flex-none text-warn" aria-hidden />
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-bold text-ink">{backupText(s, config.name)}</p>
        <p className="text-sm text-ink">Los datos viven solo en este navegador: exporta una copia cada semana y guárdala fuera del teléfono.</p>
      </div>
      <Button variant="primary" icon={Download} busy={busy} onClick={() => void exportNow()}>
        Exportar ahora
      </Button>
    </div>
  );
}
