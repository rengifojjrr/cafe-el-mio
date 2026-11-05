// Editor de plantilla PDF: se toca la página para poner un recuadro (firma, nombre, fecha…),
// se arrastra para moverlo, se agranda desde la esquina y se guarda como versión nueva.
import { Check, MousePointerClick, Save, Trash2, X } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, type PointerEvent, useRef, useState } from 'react';
import type { TemplateField, TemplateFieldType, TemplateKind } from '../../data/types';
import { useLine } from '../../app/line-context';
import { FIELDS_BY_KIND, FIELD_LABEL, TEMPLATE_KIND_LABEL, saveTemplate } from '../../services/templates';
import { Button, Card, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/toast';
import { PdfPageView, useContainerWidth, usePdfDocument } from './pdf-viewer';

const isSignature = (t: TemplateFieldType) => t === 'firma_local' || t === 'firma_vendedor';

function defaultSize(type: TemplateFieldType): { w: number; h: number } {
  if (isSignature(type)) return { w: 0.34, h: 0.075 };
  if (type === 'detalle_entrega') return { w: 0.8, h: 0.2 };
  return { w: 0.34, h: 0.035 };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

let counter = 0;
const fieldId = () => `rec-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function PdfTemplateEditor({
  kind,
  bytes,
  pageSizes,
  initialFields,
  initialName,
  onSaved,
  onCancel,
}: {
  kind: TemplateKind;
  bytes: Uint8Array;
  pageSizes: { w: number; h: number }[];
  initialFields: TemplateField[];
  initialName: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { ctx, actor } = useLine();
  const { run, busy } = useAction();
  const [box, width] = useContainerWidth(760);
  const { doc, pages, error } = usePdfDocument(bytes);
  const [fields, setFields] = useState<TemplateField[]>(initialFields);
  const [tool, setTool] = useState<TemplateFieldType>(FIELDS_BY_KIND[kind][0]!);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState(initialName);
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; startX: number; startY: number; field: TemplateField; rect: DOMRect } | null>(null);

  const update = (id: string, patch: Partial<TemplateField>) => setFields((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const remove = (id: string) => {
    setFields((list) => list.filter((f) => f.id !== id));
    setSelected(null);
  };

  const addAt = (page: number, fx: number, fy: number) => {
    const { w, h } = defaultSize(tool);
    const f: TemplateField = { id: fieldId(), type: tool, page, x: clamp(fx - w / 2, 0, 1 - w), y: clamp(fy - h / 2, 0, 1 - h), w, h };
    setFields((list) => [...list, f]);
    setSelected(f.id);
  };

  const onPagePointer = (page: number) => (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    addAt(page, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  };

  const startDrag = (f: TemplateField, mode: 'move' | 'resize') => (e: PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const pageEl = (e.currentTarget as HTMLElement).closest('[data-page-overlay]') as HTMLElement | null;
    if (!pageEl) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: f.id, mode, startX: e.clientX, startY: e.clientY, field: f, rect: pageEl.getBoundingClientRect() };
    setSelected(f.id);
  };

  const onDrag = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.rect.width;
    const dy = (e.clientY - d.startY) / d.rect.height;
    if (d.mode === 'move') {
      update(d.id, { x: clamp(d.field.x + dx, 0, 1 - d.field.w), y: clamp(d.field.y + dy, 0, 1 - d.field.h) });
    } else {
      update(d.id, { w: clamp(d.field.w + dx, 0.04, 1 - d.field.x), h: clamp(d.field.h + dy, 0.015, 1 - d.field.y) });
    }
  };

  const endDrag = () => {
    drag.current = null;
  };

  const onKey = (f: TemplateField) => (e: KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 0.02 : 0.005;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(f.id);
    } else if (e.key === 'ArrowLeft') update(f.id, { x: clamp(f.x - step, 0, 1 - f.w) });
    else if (e.key === 'ArrowRight') update(f.id, { x: clamp(f.x + step, 0, 1 - f.w) });
    else if (e.key === 'ArrowUp') update(f.id, { y: clamp(f.y - step, 0, 1 - f.h) });
    else if (e.key === 'ArrowDown') update(f.id, { y: clamp(f.y + step, 0, 1 - f.h) });
    else return;
    e.preventDefault();
  };

  const counts = (t: TemplateFieldType) => fields.filter((f) => f.type === t).length;
  const required: TemplateFieldType[] = kind === 'consignacion' ? ['firma_local', 'firma_vendedor'] : ['firma_local'];
  const missing = required.filter((t) => counts(t) === 0);

  const save = () =>
    void run(async () => {
      await saveTemplate(ctx, { kind, name, pdf: new Blob([bytes.slice()], { type: 'application/pdf' }), pageSizes, fields });
      onSaved();
    }, 'Plantilla guardada como versión nueva. Los próximos documentos la usan.');

  return (
    <div className="grid gap-4" aria-label={`Editor de la plantilla: ${TEMPLATE_KIND_LABEL[kind]}`}>
      <Card className="grid gap-3 p-4">
        <TextInput label="Nombre de la plantilla" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="text-sm text-muted">
          Elige qué poner y toca la página donde va. Arrastra un recuadro para moverlo y su esquina para agrandarlo. Con el teclado: flechas para mover, Suprimir para quitar.
        </p>
      </Card>

      {/* Queda arriba mientras se recorre el PDF, para cambiar de recuadro sin volver a subir. */}
      <div className="sticky top-[60px] z-20 grid gap-1.5 rounded-[20px] border border-line bg-surface p-2.5 shadow-lg lg:top-[68px]">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0" role="radiogroup" aria-label="Qué recuadro poner">
          {FIELDS_BY_KIND[kind].map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tool === t}
              className={`btn min-h-11 flex-none px-3 text-sm ${tool === t ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTool(t)}
            >
              {counts(t) > 0 ? <Check aria-hidden /> : null}
              {FIELD_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="flex min-h-11 items-center gap-3 px-1">
          <p className="flex min-w-0 flex-1 items-center gap-2 text-sm" aria-live="polite">
            <MousePointerClick className="h-4 w-4 flex-none text-accent" aria-hidden />
            <span>
              Toca la página para poner «{FIELD_LABEL[tool]}».
              {missing.length ? <span className="font-semibold text-warn"> Falta: {missing.map((t) => FIELD_LABEL[t]).join(' y ')}.</span> : null}
            </span>
          </p>
          {selected ? (
            <Button variant="danger" icon={Trash2} className="flex-none" onClick={() => remove(selected)} aria-label="Quitar recuadro">
              Quitar
            </Button>
          ) : null}
        </div>
      </div>

      <div ref={box} className="grid gap-4">
        {error ? <p className="rounded-xl bg-danger-soft p-3 text-danger">{error}</p> : null}
        {doc && width > 0
          ? Array.from({ length: pages }, (_, i) => (
              <PdfPageView key={i} doc={doc} index={i} width={width} label={`Página ${i + 1} de ${pages}`}>
                <div
                  data-page-overlay
                  className="absolute inset-0 cursor-crosshair"
                  onClick={onPagePointer(i)}
                  role="presentation"
                  data-testid={`pagina-${i + 1}`}
                >
                  {fields
                    .filter((f) => f.page === i)
                    .map((f) => {
                      const sel = selected === f.id;
                      // El recuadro y su esquina tienen un área táctil más grande que lo que se ve (::after).
                      return (
                        <div
                          key={f.id}
                          tabIndex={0}
                          role="button"
                          aria-label={`${FIELD_LABEL[f.type]} en la página ${i + 1}${sel ? ', seleccionado' : ''}`}
                          aria-pressed={sel}
                          data-field={f.type}
                          className={`absolute touch-none rounded-md border-2 text-papel-tinta select-none after:absolute after:-inset-2 after:content-[''] ${isSignature(f.type) ? 'border-dashed' : ''} ${
                            sel ? 'border-accent bg-accent-soft ring-2 ring-accent' : 'border-accent bg-accent-soft'
                          }`}
                          style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, cursor: 'move' }}
                          onPointerDown={startDrag(f, 'move')}
                          onPointerMove={onDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          onClick={(e) => e.stopPropagation()}
                          onFocus={() => setSelected(f.id)}
                          onKeyDown={onKey(f)}
                        >
                          <span className="pointer-events-none absolute top-0.5 left-1 truncate text-[0.68rem] leading-tight font-bold">{FIELD_LABEL[f.type]}</span>
                          <span
                            className="absolute -right-2 -bottom-2 z-10 h-5 w-5 touch-none rounded-full border-2 border-papel bg-accent after:absolute after:-inset-3 after:content-['']"
                            style={{ cursor: 'nwse-resize' }}
                            onPointerDown={startDrag(f, 'resize')}
                            onPointerMove={onDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            aria-hidden
                          />
                        </div>
                      );
                    })}
                </div>
              </PdfPageView>
            ))
          : !error
            ? <div className="skeleton h-96" aria-label="Cargando el PDF" />
            : null}
      </div>

      <div className="sticky bottom-[76px] z-20 flex flex-wrap items-center gap-3 lg:bottom-4">
        <Button variant="primary" icon={Save} busy={busy} onClick={save} disabled={actor.readOnly || missing.length > 0}>
          Guardar plantilla
        </Button>
        <Button variant="secondary" icon={X} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
