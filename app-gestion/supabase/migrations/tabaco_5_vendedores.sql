-- Programa de Tabaco · fase 2: cada vendedor entra con su cuenta y ve solo lo suyo.
--
--   · tabaco_traer: a un vendedor le baja sus locales y lo de ellos (contratos, entregas, visitas,
--     ventas, liquidaciones, pagos), sus comisiones, sus conversaciones y sus avisos; el catálogo y
--     los lotes sin costos; y del almacén, lo que entra y sale de otros locales sin decir cuál (para
--     que su stock del almacén cuadre). Un local que no es suyo (o que dejó de serlo) le llega como
--     borrado. Nunca le baja la auditoría, las listas de precios, las importaciones ni a los demás
--     vendedores.
--   · tabaco_aplicar: un vendedor solo guarda lo suyo y no borra nada; lo que decide Administración
--     (aprobar un local, condiciones de compra, preparar entregas, pagos) no lo cambia; el precio de
--     un local nunca es menor que el base. A lo que vende le pone el servidor el costo de cada lote.
--     Un «no» al vendedor es un error de datos (22023): la app lo anota y sigue con lo demás.
--   · Invitaciones de vendedor, ligadas a su usuario de la app.
--   · Depósito: el vendedor ve las fotos del catálogo y las de lo suyo, las plantillas, y sube sus fotos.

-- ---------- Quién soy y qué es mío ----------

create or replace function tabaco.mi_usuario_app() returns text
language sql stable security definer set search_path = '' as $$
  select c.usuario_app from tabaco.cuentas c where c.usuario = auth.uid() and c.activa
$$;

-- Los locales de un vendedor (lo que el servidor tiene ahora).
create or replace function tabaco.locales_de(p_vendedor text) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(s.id), '{}') from tabaco.registros s
   where s.tabla = 'stores' and not s.borrado and s.datos->>'sellerId' = p_vendedor
$$;

-- Las conversaciones en las que participa.
create or replace function tabaco.hilos_de(p_usuario text) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.id), '{}') from tabaco.registros t
   where t.tabla = 'threads' and not t.borrado and t.datos->'participantIds' ? p_usuario
$$;

-- ¿Ese local es de ese vendedor? Lo mira en el momento: ve lo que la misma tanda ya guardó.
create or replace function tabaco.es_mio(p_vendedor text, p_local text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_local is not null and exists (
    select 1 from tabaco.registros s
     where s.tabla = 'stores' and s.id = p_local and not s.borrado and s.datos->>'sellerId' = p_vendedor)
$$;

-- ---------- Costos: fuera para el vendedor, puestos por el servidor ----------

-- Las líneas de una venta o factura sin costo (para el vendedor).
create or replace function tabaco.sin_costo(p_lineas jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(
           (l - 'cost' - 'lots') || jsonb_build_object(
             'cost', 0,
             'lots', coalesce((select jsonb_agg(x || '{"unitCost": 0}'::jsonb order by m)
                                 from jsonb_array_elements(case when jsonb_typeof(l->'lots') = 'array' then l->'lots' else '[]'::jsonb end)
                                      with ordinality as y(x, m)), '[]'::jsonb))
           order by n), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_lineas) = 'array' then p_lineas else '[]'::jsonb end) with ordinality as t(l, n)
$$;

-- El costo de un lote (o, si no está, el del producto).
create or replace function tabaco.costo_lote(p_lote text, p_producto text) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(lt.datos->>'unitCost', '')::numeric from tabaco.registros lt where lt.tabla = 'lots' and lt.id = p_lote),
    (select nullif(pr.datos->>'cost', '')::numeric from tabaco.registros pr where pr.tabla = 'products' and pr.id = p_producto),
    0)
$$;

-- Las líneas con el costo de cada lote (lo que el vendedor mandó sin saberlo).
create or replace function tabaco.costear_lineas(p_lineas jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           case when jsonb_typeof(l->'lots') = 'array' and jsonb_array_length(l->'lots') > 0 then
             l || (select jsonb_build_object(
                            'lots', jsonb_agg(x || jsonb_build_object('unitCost', tabaco.costo_lote(x->>'lotId', l->>'productId')) order by m),
                            'cost', round(sum(coalesce(nullif(x->>'qty', '')::numeric, 0) * tabaco.costo_lote(x->>'lotId', l->>'productId')), 2))
                     from jsonb_array_elements(l->'lots') with ordinality as y(x, m))
           else l end
           order by n), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_lineas) = 'array' then p_lineas else '[]'::jsonb end) with ordinality as t(l, n)
$$;

-- Pone el costo a una venta, factura o devolución que guardó un vendedor.
create or replace function tabaco.costear(p_tabla text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_tabla in ('salesReports', 'invoices') then
    update tabaco.registros r set datos = r.datos || jsonb_build_object('lines', tabaco.costear_lineas(r.datos->'lines'))
     where r.tabla = p_tabla and r.id = p_id and not r.borrado;
  elsif p_tabla = 'returns' then
    -- La devolución o merma: lo que salió del local, lote por lote (sus movimientos).
    update tabaco.registros r set datos = r.datos || jsonb_build_object('cost', (
             select coalesce(round(sum(coalesce(nullif(m.datos->>'qty', '')::numeric, 0) * tabaco.costo_lote(m.datos->>'lotId', m.datos->>'productId')), 2), 0)
               from tabaco.registros m
              where m.tabla = 'movements' and not m.borrado and m.datos->>'refId' = p_id))
     where r.tabla = 'returns' and r.id = p_id and not r.borrado;
  end if;
end $$;

-- ---------- Lo que baja un vendedor ----------

-- Lo que un vendedor ve de un registro: null si no le toca; si no, {datos, borrado}.
create or replace function tabaco.para_vendedor(p_tabla text, p_id text, p_datos jsonb, p_borrado boolean, p_yo text, p_locales text[], p_hilos text[])
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mio boolean := (p_datos->>'storeId') is not null and (p_datos->>'storeId') = any(p_locales);
  v_dueno text := p_datos->>'ownerId';
  v_tal_cual jsonb := jsonb_build_object('datos', p_datos, 'borrado', false);
begin
  -- Que algo se borró se le avisa (solo dice qué registro fue).
  if p_borrado then
    return jsonb_build_object('datos', '{}'::jsonb, 'borrado', true);
  end if;
  case p_tabla
    when 'products' then
      return jsonb_build_object('datos', p_datos - 'cost' - 'sampleCost', 'borrado', false);
    when 'lots' then
      return jsonb_build_object('datos', p_datos - 'unitCost', 'borrado', false);
    when 'warehouses', 'zones', 'templates', 'announcements' then
      return v_tal_cual;
    when 'settings' then
      return jsonb_build_object('datos', p_datos - 'ultimoAjustePrecio', 'borrado', false);
    when 'stores' then
      if p_id = any(p_locales) then
        return v_tal_cual;
      end if;
      -- Un local que no es suyo (o que dejó de serlo): le llega como borrado.
      return jsonb_build_object('datos', '{}'::jsonb, 'borrado', true);
    when 'contracts', 'deliveries', 'visits', 'reorders', 'unmetDemand', 'settlements', 'payments' then
      if v_mio then return v_tal_cual; end if;
      return null;
    when 'salesReports', 'invoices' then
      if v_mio then
        return jsonb_build_object('datos', p_datos || jsonb_build_object('lines', tabaco.sin_costo(p_datos->'lines')), 'borrado', false);
      end if;
      return null;
    when 'returns' then
      if v_mio then return jsonb_build_object('datos', p_datos || '{"cost": 0}'::jsonb, 'borrado', false); end if;
      return null;
    when 'movements' then
      if v_mio then return v_tal_cual; end if;
      if p_datos->'from'->>'kind' = 'warehouse' or p_datos->'to'->>'kind' = 'warehouse' then
        -- Lo del almacén que va o viene de otro local, sin decir cuál: su stock del almacén cuadra.
        return jsonb_build_object(
          'datos',
          (p_datos - 'unitPrice' - 'basePrice' - 'reason')
            || jsonb_build_object(
                 'storeId', null,
                 'refId', '',
                 'actorId', '',
                 'from', case when p_datos->'from'->>'kind' = 'store' then '{"kind": "adjustment"}'::jsonb else p_datos->'from' end,
                 'to', case when p_datos->'to'->>'kind' = 'store' then '{"kind": "adjustment"}'::jsonb else p_datos->'to' end),
          'borrado', false);
      end if;
      return null;
    when 'commissions', 'payouts' then
      if p_datos->>'sellerId' = p_yo then return v_tal_cual; end if;
      return null;
    when 'threads' then
      if p_id = any(p_hilos) then return v_tal_cual; end if;
      return null;
    when 'messages' then
      if (p_datos->>'threadId') = any(p_hilos) then return v_tal_cual; end if;
      return null;
    when 'notifications' then
      if p_datos->>'userId' = p_yo then return v_tal_cual; end if;
      return null;
    when 'users' then
      if p_id = p_yo then return v_tal_cual; end if;
      -- De Administración y de los locales suyos, solo el nombre (para los mensajes).
      if p_datos->>'role' = 'admin' or (p_datos->>'role' = 'store' and (p_datos->>'storeId') = any(p_locales)) then
        return jsonb_build_object(
          'datos',
          jsonb_strip_nulls(jsonb_build_object(
            'role', p_datos->'role', 'name', p_datos->'name', 'email', '', 'phone', '',
            'active', p_datos->'active', 'createdAt', p_datos->'createdAt', 'storeId', p_datos->'storeId')),
          'borrado', false);
      end if;
      return null;
    when 'photos' then
      if p_datos->>'ownerType' = 'product'
         or (p_datos->>'ownerType' in ('store', 'document') and v_dueno = any(p_locales))
         or (p_datos->>'ownerType' = 'visit' and exists (
               select 1 from tabaco.registros v where v.tabla = 'visits' and v.id = v_dueno and not v.borrado and (v.datos->>'storeId') = any(p_locales)))
         or (p_datos->>'ownerType' = 'return' and exists (
               select 1 from tabaco.registros v where v.tabla = 'returns' and v.id = v_dueno and not v.borrado and (v.datos->>'storeId') = any(p_locales)))
         or (p_datos->>'ownerType' = 'message' and exists (
               select 1 from tabaco.registros m where m.tabla = 'messages' and m.id = v_dueno and not m.borrado and (m.datos->>'threadId') = any(p_hilos)))
      then
        return v_tal_cual;
      end if;
      return null;
    else
      -- Auditoría, listas de precios, importaciones, cajas, repartos, invitaciones y lo que venga: no.
      return null;
  end case;
end $$;

-- ---------- Lo que puede guardar un vendedor ----------

create or replace function tabaco.no_vendedor(p_mensaje text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_mensaje using errcode = '22023';
end $$;

-- Revisa un cambio de un vendedor; si no puede, lo rechaza (22023: la app lo anota y sigue).
create or replace function tabaco.revisar_vendedor(p_yo text, p_tabla text, p_id text, p_op text, p_datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_viejo tabaco.registros;
  v_existe boolean;
  v_campo text;
  v_lado text;
begin
  if p_op <> 'guardar' then
    perform tabaco.no_vendedor(format('Un vendedor no borra registros (%s).', p_tabla));
  end if;
  select * into v_viejo from tabaco.registros r where r.tabla = p_tabla and r.id = p_id;
  v_existe := found and not v_viejo.borrado;
  case p_tabla
    when 'audit' then
      if p_datos->>'actorId' is distinct from p_yo then
        perform tabaco.no_vendedor('La auditoría de un vendedor lleva su nombre.');
      end if;
    when 'notifications' then
      if v_existe and v_viejo.datos->>'userId' is distinct from p_yo then
        perform tabaco.no_vendedor('Ese aviso no es tuyo.');
      end if;
    when 'stores' then
      if p_datos->>'sellerId' is distinct from p_yo then
        perform tabaco.no_vendedor('Un vendedor solo guarda sus locales.');
      end if;
      if p_datos->>'clase' is not null then
        perform tabaco.no_vendedor('Los clientes que no son locales los anota Administración.');
      end if;
      if v_existe then
        if v_viejo.datos->>'sellerId' is distinct from p_yo then
          perform tabaco.no_vendedor('Ese local no es tuyo.');
        end if;
        if (p_datos->>'status') is distinct from (v_viejo.datos->>'status')
           and ((p_datos->>'status') not in ('prospecto', 'contrato_enviado', 'firmado') or (v_viejo.datos->>'status') in ('activo', 'pausado', 'cerrado')) then
          perform tabaco.no_vendedor('Aprobar, pausar o cerrar un local lo hace Administración.');
        end if;
        foreach v_campo in array array['saleMode', 'creditDays', 'priceListId', 'approvedAt', 'clase'] loop
          if (p_datos->v_campo) is distinct from (v_viejo.datos->v_campo) then
            perform tabaco.no_vendedor('Las condiciones de compra del local las pone Administración.');
          end if;
        end loop;
      else
        if coalesce(p_datos->>'status', '') <> 'prospecto' then
          perform tabaco.no_vendedor('Un local nuevo empieza como prospecto.');
        end if;
        if coalesce(nullif(p_datos->>'creditDays', '')::numeric, 0) <> 0 or p_datos->>'priceListId' is not null or p_datos->>'approvedAt' is not null then
          perform tabaco.no_vendedor('Las condiciones de compra del local las pone Administración.');
        end if;
      end if;
      -- El precio de un local nunca es menor que el precio base del producto.
      if jsonb_typeof(p_datos->'precios') = 'object' and exists (
           select 1 from jsonb_each(p_datos->'precios') e
             join tabaco.registros pr on pr.tabla = 'products' and pr.id = e.key and not pr.borrado
            where jsonb_typeof(e.value) <> 'number' or (e.value)::text::numeric < coalesce(nullif(pr.datos->>'priceToStore', '')::numeric, 0)) then
        perform tabaco.no_vendedor('El precio de un local no puede ser menor que el precio base.');
      end if;
    when 'contracts', 'visits', 'reorders', 'unmetDemand', 'deliveries', 'salesReports', 'returns', 'invoices', 'movements' then
      if not tabaco.es_mio(p_yo, p_datos->>'storeId') or (v_existe and not tabaco.es_mio(p_yo, v_viejo.datos->>'storeId')) then
        perform tabaco.no_vendedor('Ese local no es tuyo.');
      end if;
      if p_tabla = 'deliveries' then
        if not v_existe then
          if coalesce(p_datos->>'status', '') <> 'solicitada' then
            perform tabaco.no_vendedor('Una entrega nueva empieza como pedida.');
          end if;
        elsif (p_datos->>'status') is distinct from (v_viejo.datos->>'status') then
          -- El vendedor pide; Administración prepara. Al entregar, se recibe lo preparado, tal cual.
          if not ((v_viejo.datos->>'status') = 'preparada' and (p_datos->>'status') = 'entregada') then
            perform tabaco.no_vendedor('Ese paso de la entrega lo hace Administración.');
          end if;
          if (p_datos->'items') is distinct from (v_viejo.datos->'items') then
            perform tabaco.no_vendedor('Lo preparado no se cambia al recibir.');
          end if;
        elsif (v_viejo.datos->>'status') <> 'solicitada' and (p_datos->'items') is distinct from (v_viejo.datos->'items') then
          perform tabaco.no_vendedor('Lo preparado lo cambia Administración.');
        end if;
      elsif p_tabla = 'movements' then
        if v_existe and (v_viejo.datos is distinct from p_datos) then
          perform tabaco.no_vendedor('Un movimiento no se cambia.');
        end if;
        foreach v_lado in array array['from', 'to'] loop
          if coalesce(p_datos->v_lado->>'kind', '') not in ('warehouse', 'store', 'sold', 'loss', 'adjustment')
             or (p_datos->v_lado->>'kind' = 'store' and p_datos->v_lado->>'storeId' is distinct from p_datos->>'storeId') then
            perform tabaco.no_vendedor('Un vendedor solo mueve producto de sus locales.');
          end if;
        end loop;
      elsif p_tabla in ('salesReports', 'returns', 'invoices') then
        if v_existe and v_viejo.actualizado_por is distinct from auth.uid() then
          perform tabaco.no_vendedor('Ese registro no es tuyo.');
        end if;
        if p_tabla = 'invoices' and (coalesce(nullif(p_datos->>'paid', '')::numeric, 0) <> 0 or (p_datos->>'sellerId' is not null and p_datos->>'sellerId' <> p_yo)) then
          perform tabaco.no_vendedor('Los pagos de una factura los anota Administración.');
        end if;
      end if;
    when 'commissions' then
      if p_datos->>'sellerId' is distinct from p_yo or not tabaco.es_mio(p_yo, p_datos->>'storeId') then
        perform tabaco.no_vendedor('Esa comisión no es tuya.');
      end if;
      if coalesce(p_datos->>'status', '') not in ('devengada', 'pagable') or (v_existe and v_viejo.datos->>'status' = 'pagada') then
        perform tabaco.no_vendedor('Las comisiones las paga Administración.');
      end if;
    when 'threads' then
      if not (coalesce(p_datos->'participantIds', '[]'::jsonb) ? p_yo) or (v_existe and not (coalesce(v_viejo.datos->'participantIds', '[]'::jsonb) ? p_yo)) then
        perform tabaco.no_vendedor('No participas en esa conversación.');
      end if;
    when 'messages' then
      if p_datos->>'authorId' is distinct from p_yo
         or not exists (select 1 from tabaco.registros t where t.tabla = 'threads' and t.id = p_datos->>'threadId' and not t.borrado and t.datos->'participantIds' ? p_yo)
         or (v_existe and v_viejo.datos->>'authorId' is distinct from p_yo) then
        perform tabaco.no_vendedor('Ese mensaje no es tuyo.');
      end if;
    when 'photos' then
      if coalesce(p_datos->>'ownerType', '') not in ('store', 'visit', 'return', 'message', 'document')
         or (v_existe and v_viejo.actualizado_por is distinct from auth.uid()) then
        perform tabaco.no_vendedor('Esa foto la sube Administración.');
      end if;
    else
      perform tabaco.no_vendedor(format('Un vendedor no guarda en «%s».', p_tabla));
  end case;
end $$;

-- ---------- Las puertas, con los vendedores ----------

drop function public.tabaco_traer(bigint, integer);
create function public.tabaco_traer(p_desde bigint default 0, p_limite integer default 1000) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rol text := tabaco.mi_rol();
  v_desde xid8 := (greatest(coalesce(p_desde, 0), 0)::text)::xid8;
  v_hasta xid8 := pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot());
  v_limite integer := least(greatest(coalesce(p_limite, 1000), 1), 5000);
  v_corte xid8;
  v_primero xid8;
  v_registros jsonb;
  v_yo text;
  v_locales text[];
  v_hilos text[];
begin
  if v_rol is null then
    raise exception 'No tienes cuenta en el programa de Tabaco' using errcode = '42501';
  end if;
  if v_rol not in ('admin', 'direccion', 'seller') then
    raise exception 'Por ahora el servidor del programa de Tabaco es para Administración, Dirección y vendedores' using errcode = '42501';
  end if;
  if v_rol = 'seller' then
    v_yo := tabaco.mi_usuario_app();
    if v_yo is null then
      raise exception 'Tu cuenta de vendedor no está ligada a un vendedor de la app: pídele a Administración una invitación nueva.' using errcode = '42501';
    end if;
    v_locales := tabaco.locales_de(v_yo);
    v_hilos := tabaco.hilos_de(v_yo);
  end if;
  -- Por tandas que nunca parten una transacción (igual que antes).
  select r.tx into v_corte from tabaco.registros r
   where r.tx >= v_desde and r.tx < v_hasta
   order by r.tx offset v_limite limit 1;
  if v_corte is null then
    v_corte := v_hasta;
  else
    select r.tx into v_primero from tabaco.registros r
     where r.tx >= v_desde and r.tx < v_hasta
     order by r.tx limit 1;
    if v_corte = v_primero then
      v_corte := null;
      select r.tx into v_corte from tabaco.registros r
       where r.tx > v_primero and r.tx < v_hasta
       order by r.tx limit 1;
      v_corte := coalesce(v_corte, v_hasta);
    end if;
  end if;
  if v_rol = 'seller' then
    select coalesce(
             jsonb_agg(jsonb_build_object('tabla', r.tabla, 'id', r.id, 'datos', x.f->'datos', 'borrado', (x.f->>'borrado')::boolean)
                       order by r.tx, r.tabla, r.id),
             '[]'::jsonb)
      into v_registros
      from tabaco.registros r
      cross join lateral (select tabaco.para_vendedor(r.tabla, r.id, r.datos, r.borrado, v_yo, v_locales, v_hilos) as f) x
     where r.tx >= v_desde and r.tx < v_corte and x.f is not null;
  else
    select coalesce(
             jsonb_agg(jsonb_build_object('tabla', r.tabla, 'id', r.id, 'datos', r.datos, 'borrado', r.borrado)
                       order by r.tx, r.tabla, r.id),
             '[]'::jsonb)
      into v_registros
      from tabaco.registros r
     where r.tx >= v_desde and r.tx < v_corte;
  end if;
  return jsonb_build_object('hasta', (v_corte::text)::bigint, 'mas', v_corte < v_hasta, 'registros', v_registros);
end $$;
comment on function public.tabaco_traer(bigint, integer) is 'Programa de Tabaco: los cambios confirmados desde el cursor anterior, por tandas. A un vendedor, solo lo suyo y sin costos.';

create or replace function public.tabaco_aplicar(p_cambios jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rol text := tabaco.mi_rol();
  v_yo text;
  c jsonb;
  v_tabla text;
  v_id text;
  v_op text;
  v_n integer := 0;
  v_costear text[] := '{}';
  k text;
begin
  if v_rol is null then
    raise exception 'No tienes cuenta en el programa de Tabaco' using errcode = '42501';
  end if;
  if v_rol not in ('admin', 'seller') then
    raise exception 'Dirección mira: no guarda en el servidor del programa de Tabaco' using errcode = '42501';
  end if;
  if v_rol = 'seller' then
    v_yo := tabaco.mi_usuario_app();
    if v_yo is null then
      raise exception 'Tu cuenta de vendedor no está ligada a un vendedor de la app: pídele a Administración una invitación nueva.' using errcode = '42501';
    end if;
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'array' then
    raise exception 'Se esperaba una lista de cambios';
  end if;
  if jsonb_array_length(p_cambios) > 2000 then
    raise exception 'Demasiados cambios juntos (máximo 2000)';
  end if;
  -- Antes de vaciar una tabla, una copia de lo que había (una sola cada 10 minutos). Solo Administración vacía.
  if v_rol = 'admin'
     and exists (select 1 from jsonb_array_elements(p_cambios) e where e.value->>'op' = 'vaciar')
     and not exists (select 1 from tabaco.copias kk where kk.motivo = 'antes de vaciar' and kk.hecha_en > pg_catalog.now() - interval '10 minutes') then
    perform tabaco.hacer_copia('antes de vaciar');
  end if;
  for c in select value from jsonb_array_elements(p_cambios) loop
    v_tabla := c->>'tabla';
    v_id := c->>'id';
    v_op := c->>'op';
    if v_tabla is null or v_tabla !~ '^[A-Za-z]{2,40}$' then
      raise exception 'Tabla inválida: %', coalesce(v_tabla, '(vacía)');
    end if;
    if v_op = 'guardar' then
      if v_id is null or char_length(v_id) not between 1 and 200 then
        raise exception 'Id inválido en %', v_tabla;
      end if;
      if jsonb_typeof(c->'datos') is distinct from 'object' then
        raise exception 'Datos inválidos en %/%', v_tabla, v_id;
      end if;
      if pg_catalog.octet_length((c->'datos')::text) > 1000000 then
        raise exception 'Registro demasiado grande en %/% (las fotos y los PDF van al depósito, no aquí)', v_tabla, v_id;
      end if;
    end if;
    if v_rol = 'seller' then
      perform tabaco.revisar_vendedor(v_yo, v_tabla, v_id, v_op, c->'datos');
    end if;
    if v_op = 'guardar' then
      if v_tabla = 'audit' and exists (select 1 from tabaco.registros r where r.tabla = 'audit' and r.id = v_id) then
        continue;
      end if;
      insert into tabaco.registros (tabla, id, datos, borrado)
      values (v_tabla, v_id, c->'datos', false)
      on conflict (tabla, id) do update set datos = excluded.datos, borrado = false;
      if v_rol = 'seller' and v_tabla in ('salesReports', 'invoices', 'returns') then
        v_costear := array_append(v_costear, v_tabla || '/' || v_id);
      end if;
    elsif v_op = 'borrar' then
      if v_tabla = 'audit' then
        raise exception 'La auditoría no se borra' using errcode = '42501';
      end if;
      update tabaco.registros r set borrado = true, datos = '{}'::jsonb
       where r.tabla = v_tabla and r.id = v_id and not r.borrado;
    elsif v_op = 'vaciar' then
      if v_tabla = 'audit' then
        raise exception 'La auditoría no se borra' using errcode = '42501';
      end if;
      update tabaco.registros r set borrado = true, datos = '{}'::jsonb
       where r.tabla = v_tabla and not r.borrado;
    else
      raise exception 'Operación inválida: %', coalesce(v_op, '(vacía)');
    end if;
    v_n := v_n + 1;
  end loop;
  -- Lo que vendió o devolvió un vendedor lleva el costo de cada lote (él no lo ve). Al final: los
  -- movimientos de la misma tanda ya están guardados.
  foreach k in array v_costear loop
    perform tabaco.costear(split_part(k, '/', 1), substr(k, strpos(k, '/') + 1));
  end loop;
  return v_n;
end $$;
comment on function public.tabaco_aplicar(jsonb) is 'Programa de Tabaco: guarda una tanda de cambios, todo o nada. Administración, todo; un vendedor, solo lo suyo (y el servidor le pone los costos).';

-- ---------- Invitaciones de vendedor ----------

alter table tabaco.invitaciones drop constraint invitaciones_rol_check;
alter table tabaco.invitaciones add constraint invitaciones_rol_check check (rol in ('admin', 'direccion', 'seller'));

create or replace function public.tabaco_invitar(p_correo text, p_nombre text, p_rol text, p_usuario_app text default null, p_dias integer default 7)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_correo text := lower(btrim(coalesce(p_correo, '')));
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_usuario text := nullif(btrim(coalesce(p_usuario_app, '')), '');
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_inv tabaco.invitaciones;
begin
  if not tabaco.es_admin() then
    raise exception 'Solo Administración invita al programa de Tabaco.' using errcode = '42501';
  end if;
  if v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Ese correo no parece válido.' using errcode = '22023';
  end if;
  if coalesce(p_rol, '') not in ('admin', 'direccion', 'seller') then
    raise exception 'Se invita a Administración, a Dirección o a un vendedor.' using errcode = '22023';
  end if;
  if p_rol = 'seller' and (v_usuario is null or not exists (
       select 1 from tabaco.registros u where u.tabla = 'users' and u.id = v_usuario and not u.borrado
          and u.datos->>'role' = 'seller' and coalesce((u.datos->>'active')::boolean, true))) then
    raise exception 'Elige el vendedor (tiene que estar dado de alta y activo en Usuarios, y sincronizado).' using errcode = '22023';
  end if;
  if v_nombre = '' then
    raise exception 'Falta el nombre de la persona.' using errcode = '22023';
  end if;
  if coalesce(p_dias, 0) not between 1 and 30 then
    raise exception 'La invitación vale entre 1 y 30 días.' using errcode = '22023';
  end if;
  -- Una sola invitación vigente por correo: la nueva reemplaza a la anterior.
  update tabaco.invitaciones set anulada_en = now()
   where correo = v_correo and usada_en is null and anulada_en is null;
  insert into tabaco.invitaciones (token_hash, correo, nombre, rol, usuario_app, creada_por, vence_en)
  values (tabaco.huella(v_token), v_correo, v_nombre, p_rol, v_usuario, auth.uid(), now() + make_interval(days => p_dias))
  returning * into v_inv;
  return jsonb_build_object('id', v_inv.id, 'token', v_token, 'vence_en', v_inv.vence_en);
end $$;
comment on function public.tabaco_invitar(text, text, text, text, integer) is 'Programa de Tabaco: Administración invita a alguien (devuelve el código del link una sola vez). Un vendedor va ligado a su usuario de la app.';

-- ---------- Depósito: lo que ve y sube un vendedor ----------

create or replace function tabaco.vendedor_ve_archivo(p_nombre text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_yo text;
  v_tabla text := split_part(p_nombre, '/', 1);
  v_id text := substr(p_nombre, strpos(p_nombre, '/') + 1);
  v_datos jsonb;
begin
  if coalesce(tabaco.mi_rol(), '') <> 'seller' then
    return false;
  end if;
  if v_tabla = 'templates' then
    return true;
  end if;
  if v_tabla <> 'photos' then
    return false;
  end if;
  v_yo := tabaco.mi_usuario_app();
  select r.datos into v_datos from tabaco.registros r where r.tabla = 'photos' and r.id = v_id and not r.borrado;
  if not found or v_yo is null then
    return false;
  end if;
  return tabaco.para_vendedor('photos', v_id, v_datos, false, v_yo, tabaco.locales_de(v_yo), tabaco.hilos_de(v_yo)) is not null;
end $$;

create or replace function tabaco.vendedor_sube_archivo(p_nombre text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id text := substr(p_nombre, strpos(p_nombre, '/') + 1);
begin
  if coalesce(tabaco.mi_rol(), '') <> 'seller' or split_part(p_nombre, '/', 1) <> 'photos' then
    return false;
  end if;
  -- Una foto nueva, o una que subió él: nunca la de otro.
  return not exists (select 1 from tabaco.registros r where r.tabla = 'photos' and r.id = v_id and not r.borrado and r.actualizado_por is distinct from auth.uid());
end $$;

create policy "tabaco: el vendedor ve las fotos del catálogo y las suyas" on storage.objects
  for select to authenticated
  using (bucket_id = 'tabaco-archivos' and tabaco.vendedor_ve_archivo(name));

create policy "tabaco: el vendedor sube sus fotos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tabaco-archivos' and tabaco.vendedor_sube_archivo(name));

create policy "tabaco: el vendedor cambia sus fotos" on storage.objects
  for update to authenticated
  using (bucket_id = 'tabaco-archivos' and tabaco.vendedor_sube_archivo(name))
  with check (bucket_id = 'tabaco-archivos' and tabaco.vendedor_sube_archivo(name));

-- ---------- Permisos ----------

revoke all on all functions in schema tabaco from public, anon, authenticated;
-- Las reglas del depósito corren como quien sube o baja.
grant execute on function tabaco.es_admin() to authenticated;
grant execute on function tabaco.puede_leer() to authenticated;
grant execute on function tabaco.vendedor_ve_archivo(text) to authenticated;
grant execute on function tabaco.vendedor_sube_archivo(text) to authenticated;

revoke all on function public.tabaco_traer(bigint, integer) from public, anon;
revoke all on function public.tabaco_aplicar(jsonb) from public, anon;
revoke all on function public.tabaco_invitar(text, text, text, text, integer) from public, anon;
grant execute on function public.tabaco_traer(bigint, integer) to authenticated;
grant execute on function public.tabaco_aplicar(jsonb) to authenticated;
grant execute on function public.tabaco_invitar(text, text, text, text, integer) to authenticated;
