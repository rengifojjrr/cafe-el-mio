// «Datos de la línea» en Ajustes: de dónde son los datos (ejemplo o reales), la copia de
// seguridad (exportar e importar solo esta línea), importar productos y «Empezar en blanco».
// Va dentro del formulario de Ajustes: aquí no hay <form> (enviaría el de Ajustes).
import { Download, Eraser, FileSpreadsheet, HardDrive, Images, Smartphone, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { normalize } from '../../domain/products';
import { LINE_CONFIG } from '../../lines/config';
import { type PersistState, isIos, isStandalone, isStoragePersisted, requestPersistentStorage } from '../../lib/storage';
import { fmtDateTime } from '../../lib/time';
import { type LineBackupSummary, backupStatus, importLine, previewLineBackup, startBlank } from '../../services/real-data';
import { DataBadge } from '../../ui/data-badge';
import { Button, Card, LinkButton, Sheet, TextInput } from '../../ui/kit';
import { errorText, useAction, useToast } from '../../ui/toast';
import { BackupNotice, useExportLine } from './BackupNotice';

function persistText(state: PersistState | undefined): string {
  if (state === true) return 'El navegador guarda estos datos de forma persistente: no los borra para hacer espacio.';
  if (state === false) return 'El navegador todavía no da almacenamiento persistente: si se queda sin espacio, podría borrar estos datos.';
  return 'Este navegador no dice si guarda los datos de forma persistente.';
}

export function DataPanel() {
  const { ctx, actor, config, line, p } = useLine();
  const status = useAsync(() => backupStatus(ctx), [ctx]);
  const [persisted, setPersisted] = useState<PersistState | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void isStoragePersisted().then((v) => {
      if (alive) setPersisted(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  const { exportNow, busy: exporting } = useExportLine();
  const { push } = useToast();
  const [blankOpen, setBlankOpen] = useState(false);
  const [backup, setBackup] = useState<{ json: string; summary: LineBackupSummary; fileName: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const real = status.data?.mode === 'real';
  const other = LINE_CONFIG[line === 'tabaco' ? 'cafe' : 'tabaco'].name;
  const canWrite = actor.role === 'admin' && !actor.readOnly;

  const pickBackup = async (file: File) => {
    try {
      const json = await file.text();
      setBackup({ json, summary: await previewLineBackup(ctx, json), fileName: file.name });
    } catch (e) {
      push('error', errorText(e));
    }
  };

  const askPersist = async () => {
    const v = await requestPersistentStorage();
    setPersisted(v);
    return v;
  };

  return (
    <Card className="mb-2 p-5" aria-label={`Datos de ${config.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-ink">Datos de {config.name}</h2>
        {status.data ? <DataBadge real={real} /> : null}
      </div>
      {real ? (
        <div className="mt-2 grid gap-2 text-sm text-ink">
          <p>Son los datos de tu empresa y viven solo en este navegador. Si se borra el navegador o se pierde el teléfono, solo quedan las copias que exportes.</p>
          <p className="flex items-start gap-2">
            <HardDrive className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden />
            <span>{persistText(persisted)}</span>
          </p>
          {!isStandalone() ? (
            <p className="flex items-start gap-2">
              <Smartphone className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden />
              <span>
                {isIos() ? 'En este iPhone' : 'En iPhone'}, instala la app en la pantalla de inicio: si no, Safari puede borrar los datos después de 7 días sin usarla.
              </span>
            </p>
          ) : null}
          <p className="text-muted">Última copia: {status.data?.lastExportAt ? fmtDateTime(status.data.lastExportAt) : 'todavía ninguna'}.</p>
        </div>
      ) : (
        <p className="mt-2 max-w-[70ch] text-sm text-ink">
          Ahora ves datos de ejemplo. Para cargar los de tu empresa, empieza en blanco: se borra lo de ejemplo de {config.name} y {other} no se toca. Después importa tus productos desde Excel o CSV.
        </p>
      )}
      {canWrite ? (
        <>
          <BackupNotice className="mt-4" />
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button icon={Download} busy={exporting} onClick={() => void exportNow()}>
              Exportar copia de {config.name}
            </Button>
            <Button icon={Upload} onClick={() => fileRef.current?.click()}>
              Importar copia de {config.name}
            </Button>
            <LinkButton to={p('catalogo/importar')} icon={FileSpreadsheet}>
              Importar productos (Excel o CSV)
            </LinkButton>
            <LinkButton to={p('catalogo/fotos')} icon={Images}>
              Fotos en lote
            </LinkButton>
            <Button variant="danger" icon={Eraser} onClick={() => setBlankOpen(true)}>
              Empezar en blanco
            </Button>
            {real && persisted !== true ? (
              <Button icon={HardDrive} onClick={() => void askPersist()}>
                Pedir almacenamiento persistente
              </Button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label={`Elegir copia de ${config.name}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void pickBackup(f);
            }}
          />
        </>
      ) : null}
      <StartBlankSheet open={blankOpen} real={real} onClose={() => setBlankOpen(false)} onDone={askPersist} />
      <ImportBackupSheet backup={backup} onClose={() => setBackup(null)} onDone={askPersist} />
    </Card>
  );
}

function StartBlankSheet({ open, real, onClose, onDone }: { open: boolean; real: boolean; onClose: () => void; onDone: () => Promise<PersistState> }) {
  const { ctx, config, line } = useLine();
  const { run, busy } = useAction();
  const { exportNow, busy: exporting } = useExportLine();
  const [typed, setTyped] = useState('');
  const other = LINE_CONFIG[line === 'tabaco' ? 'cafe' : 'tabaco'].name;
  const ok = normalize(typed) === normalize(config.name);

  const close = () => {
    setTyped('');
    onClose();
  };
  const confirm = async () => {
    if (!ok) return;
    const done = await run(async () => {
      await startBlank(ctx, typed);
      return true;
    }, `Listo: ${config.name} quedó en blanco para tus datos reales.`);
    if (!done) return;
    close();
    await onDone();
  };

  return (
    <Sheet open={open} onClose={close} title="Empezar en blanco">
      <div className="grid gap-3 text-ink">
        <p>
          Se borra todo lo de <strong>{config.name}</strong> en este navegador: catálogo y fotos, almacén (llegadas, lotes y movimientos), locales, contratos, entregas,
          visitas, ventas, devoluciones, pedidos, cobros, comisiones, mensajes, avisos, listas de precios, facturas, repartos, invitaciones y plantillas.
        </p>
        <p>
          Quedan los ajustes de la línea, el almacén, las zonas y una sola cuenta: «Administración» (le cambias el nombre en Usuarios).
          {line === 'cafe' ? ' Vuelven los 9 cafés de El Mío, sin precio al local ni costo y desactivados.' : ''} {other} no se toca.
        </p>
        {real ? (
          <div className="rounded-2xl border border-danger bg-danger-soft p-3">
            <p className="font-bold text-danger">{config.name} ya tiene datos reales.</p>
            <p className="mt-1 text-sm">Se borran también. Exporta una copia antes si la quieres guardar.</p>
            <Button className="mt-2" icon={Download} busy={exporting} onClick={() => void exportNow()}>
              Exportar copia
            </Button>
          </div>
        ) : null}
        <TextInput
          label={`Para confirmar, escribe ${config.name}`}
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void confirm();
            }
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" icon={Eraser} busy={busy} disabled={!ok} onClick={() => void confirm()}>
            Empezar en blanco
          </Button>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function ImportBackupSheet({
  backup,
  onClose,
  onDone,
}: {
  backup: { json: string; summary: LineBackupSummary; fileName: string } | null;
  onClose: () => void;
  onDone: () => Promise<PersistState>;
}) {
  const { ctx, config } = useLine();
  const { run, busy } = useAction();
  const s = backup?.summary;
  const confirm = async () => {
    if (!backup) return;
    const done = await run(() => importLine(ctx, backup.json), `Listo: ${config.name} quedó como en la copia.`);
    if (!done) return;
    onClose();
    if (done.mode === 'real') await onDone();
  };
  return (
    <Sheet open={backup !== null} onClose={onClose} title={`Importar copia de ${config.name}`}>
      {s ? (
        <div className="grid gap-3 text-ink">
          <p>
            «{backup?.fileName}»: copia de {config.name} del {fmtDateTime(s.exportedAt)}, con {s.products} {s.products === 1 ? 'producto' : 'productos'}, {s.stores}{' '}
            {s.stores === 1 ? 'local' : 'locales'} y {s.users} {s.users === 1 ? 'cuenta' : 'cuentas'}. {s.mode === 'real' ? 'Son datos reales.' : 'Son datos de ejemplo.'}
          </p>
          <p className="rounded-2xl border border-danger bg-danger-soft p-3 font-semibold">Reemplaza todo lo que hay ahora en {config.name}. La otra línea no se toca.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" icon={Upload} busy={busy} onClick={() => void confirm()}>
              Sí, reemplazar
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
