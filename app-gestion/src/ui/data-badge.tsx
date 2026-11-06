/**
 * De dónde son los datos de una línea: los reales de la empresa (solo en este navegador) o los
 * de ejemplo. `compact`: en el teléfono dice lo justo para caber en la cabecera.
 * Vive aparte del kit para no pesar en la carga inicial de la portada.
 */
export function DataBadge({ real, compact }: { real: boolean; compact?: boolean }) {
  const size = compact ? 'px-2 text-[0.72rem] sm:px-2.5 sm:text-[0.8rem]' : '';
  if (real) {
    return (
      <span className={`pill pill-ok ${size}`} title="Son los datos de tu empresa y viven solo en este navegador: exporta una copia cada semana." data-modo="real">
        Datos reales<span className={compact ? 'hidden sm:inline' : ''}> · solo en este navegador</span>
      </span>
    );
  }
  return (
    <span className={`pill pill-warn ${size}`} title="Todo lo que ves son datos inventados para la demostración." data-modo="ejemplo">
      {compact ? (
        <>
          <span className="sm:hidden">Ejemplo</span>
          <span className="hidden sm:inline">Datos de ejemplo</span>
        </>
      ) : (
        'Datos de ejemplo'
      )}
    </span>
  );
}
