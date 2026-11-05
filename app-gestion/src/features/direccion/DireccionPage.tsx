// Pantallas en construcción: se completan en su etapa.
import { Hammer } from 'lucide-react';
import { EmptyState } from '../../ui/kit';

export function DireccionPage() {
  return <EmptyState icon={Hammer} title="En construcción">Esta pantalla se completa en una etapa siguiente.</EmptyState>;
}

