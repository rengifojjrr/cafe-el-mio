// Accesos grandes del centro de mando para vender: venta rápida en el almacén, pedido por teléfono y
// pegar un pedido de WhatsApp.
import { ClipboardPaste, Phone, Zap } from 'lucide-react';
import { useLine } from '../../app/line-context';
import { LinkButton } from '../../ui/kit';

export function QuickActions() {
  const { actor, p } = useLine();
  if (actor.role !== 'admin' || actor.readOnly) return null;
  return (
    <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      <LinkButton to={p('venta-rapida')} variant="primary" big icon={Zap} className="w-full">
        Venta rápida
      </LinkButton>
      <LinkButton to={p('pedido-telefono')} big icon={Phone} className="w-full">
        Pedido por teléfono
      </LinkButton>
      <LinkButton to={p('pegar-pedido')} big icon={ClipboardPaste} className="w-full">
        Pegar pedido
      </LinkButton>
    </div>
  );
}
