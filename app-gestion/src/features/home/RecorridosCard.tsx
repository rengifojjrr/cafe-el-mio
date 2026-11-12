// En el inicio: cuántos prospectos faltan por visitar, con el botón para abrir los recorridos.
import { Footprints } from 'lucide-react';
import { useAsync } from '../../app/hooks';
import { useLine } from '../../app/line-context';
import { resumenRecorridos } from '../../services/recorridos';
import { LinkButton } from '../../ui/kit';

export function RecorridosCard({ className = '' }: { className?: string }) {
  const { ctx, p } = useLine();
  const r = useAsync(() => resumenRecorridos(ctx), [ctx]);
  if (!r.data || r.data.pendientes === 0) return null;
  const { pendientes, zonas } = r.data;
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-accent-soft p-4 ${className}`} data-testid="tarjeta-recorridos">
      <Footprints className="h-6 w-6 flex-none text-accent" aria-hidden />
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-bold text-ink">
          Recorridos: {pendientes === 1 ? '1 local por visitar' : `${pendientes} locales por visitar`}
          {zonas > 1 ? ` en ${zonas} zonas` : ''}
        </p>
        <p className="text-sm text-ink">En orden por zona, con Google Maps y lo que falta anotar de cada uno.</p>
      </div>
      <LinkButton to={p('recorridos')} variant="primary" icon={Footprints}>
        Abrir recorridos
      </LinkButton>
    </div>
  );
}
