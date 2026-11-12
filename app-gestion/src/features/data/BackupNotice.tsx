// La copia de seguridad.
// - Con sesión en el servidor: el servidor copia todo cada madrugada (y antes de reemplazar datos) y
//   guarda 30 días. Aquí se dice cuándo fue la última; bajar una copia al teléfono queda como extra.
// - Sin servidor (solo en este navegador): aviso si pasaron 7 días o más desde la última «Exportar»
//   (o si nunca se exportó y ya hay algo cargado).
import { Download, FileSpreadsheet, ShieldAlert, ShieldCheck, Tag } from 'lucide-react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { downloadText } from '../../lib/download';
import { fmtAgo, fmtDateTime } from '../../lib/time';
import { copiaAlDia, copiasDelServidor } from '../../servidor/copias';
import { conectado } from '../../servidor/sincronizar';
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

/** Con sesión en el servidor: cuándo fue la última copia automática. */
function CopiaDelServidor({ className = '', canExport }: { className?: string; canExport: boolean }) {
  const { ctx } = useLine();
  const info = useAsync(() => copiasDelServidor(), []);
  const { exportNow, busy } = useExportLine();
  if (info.loading && !info.data) return null;
  if (!info.data) {
    return (
      <p className={`text-sm text-muted ${className}`} data-testid="copia-servidor" data-estado="sin-dato">
        No se pudo revisar ahora la copia del servidor (puede ser la señal). El servidor la hace solo cada madrugada.
      </p>
    );
  }
  const c = info.data;
  const now = ctx.now();
  const cuando = c.ultima ? `${fmtAgo(c.ultima.hecha_en, now)} (${fmtDateTime(c.ultima.hecha_en)})` : '';
  if (copiaAlDia(c, now)) {
    return (
      <div className={`flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3 ${className}`} data-testid="copia-servidor" data-estado="al-dia">
        <ShieldCheck className="h-5 w-5 flex-none text-ok" aria-hidden />
        <p className="min-w-0 flex-1 basis-56 text-sm text-ink">
          <b>Copia de seguridad automática:</b> la última fue {cuando}. El servidor copia todo cada madrugada y guarda 30 días
          {c.guardadas > 1 ? ` (hay ${c.guardadas})` : ''}.
        </p>
        {canExport ? (
          <Button icon={Download} busy={busy} onClick={() => void exportNow()}>
            Bajar una copia
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-2xl border border-warn bg-warn-soft p-4 ${className}`} data-testid="copia-servidor" data-estado="atrasada">
      <ShieldAlert className="h-6 w-6 flex-none text-warn" aria-hidden />
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-bold text-ink">{c.ultima ? `La copia automática del servidor no se hace desde ${cuando}.` : 'Todavía no hay copia automática en el servidor.'}</p>
        <p className="text-sm text-ink">Avisa a quien administra el servidor. Mientras, baja una copia a este teléfono.</p>
      </div>
      {canExport ? (
        <Button variant="primary" icon={Download} busy={busy} onClick={() => void exportNow()}>
          Exportar ahora
        </Button>
      ) : null}
    </div>
  );
}

export function BackupNotice({ className = '', firstSteps }: { className?: string; firstSteps?: boolean }) {
  const { ctx, actor, config, p } = useLine();
  const canExport = actor.role === 'admin' && !actor.readOnly;
  const status = useAsync(() => (canExport ? backupStatus(ctx) : Promise.resolve(null)), [ctx, canExport]);
  const { exportNow, busy } = useExportLine();
  const s = status.data;
  const enServidor = conectado();
  const copia = enServidor ? <CopiaDelServidor className={className} canExport={canExport} /> : null;
  // Recién empezado en blanco (nada con precio todavía): lo primero es el catálogo.
  if (firstSteps && s?.mode === 'real' && s.products === s.unpriced) {
    return (
      <>
        <div className={`flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-accent-soft p-4 ${className}`}>
          <FileSpreadsheet className="h-6 w-6 flex-none text-accent" aria-hidden />
          <div className="min-w-0 flex-1 basis-56">
            <p className="font-bold text-ink">{config.name} está en blanco, lista para tus datos.</p>
            <p className="text-sm text-ink">
              {s.unpriced
                ? `Ya están ${s.unpriced === 1 ? 'el producto' : `los ${s.unpriced} productos`} de la marca, sin precio y desactivados: ponles precio al local y costo, y actívalos. O importa tus productos desde Excel o CSV.`
                : 'Empieza por el catálogo: importa tus productos desde el Excel de Odoo (o cualquier .xlsx o .csv).'}
            </p>
          </div>
          {s.unpriced ? (
            <LinkButton to={p('catalogo?inactivos=1')} variant="primary" icon={Tag}>
              Ponerles precio
            </LinkButton>
          ) : null}
          <LinkButton to={p('catalogo/importar')} variant={s.unpriced ? 'secondary' : 'primary'} icon={FileSpreadsheet}>
            Importar productos
          </LinkButton>
        </div>
        {copia}
      </>
    );
  }
  if (copia) return copia;
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
