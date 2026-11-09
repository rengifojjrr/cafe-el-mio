-- Programa de Tabaco (Grupo Miami) en un proyecto de Supabase que comparte con otras apps.
-- Todo vive en el esquema `tabaco`; en `public` solo quedan tres puertas: tabaco_soy, tabaco_traer y
-- tabaco_aplicar. Las tablas no se leen ni se escriben directo: no tienen permisos ni políticas.
-- Tener sesión en el proyecto no alcanza: hace falta una cuenta activa en tabaco.cuentas.
--
-- Fase 1: solo Administración guarda; Administración y Dirección leen. Vendedores y locales vienen
-- después, con lo suyo filtrado en el servidor (y sin costos).

create schema if not exists tabaco;
comment on schema tabaco is 'Programa de Tabaco (Grupo Miami). Separado del resto del proyecto: sus datos solo se leen y escriben por las funciones public.tabaco_*.';
revoke all on schema tabaco from public, anon, authenticated;

create schema if not exists cafe;
comment on schema cafe is 'En espera: el programa de Café se arma aquí con el mismo patrón que tabaco cuando se active.';
revoke all on schema cafe from public, anon, authenticated;

-- ---------- Cuentas ----------

create table tabaco.cuentas (
  usuario uuid primary key references auth.users (id) on delete cascade,
  rol text not null check (rol in ('admin', 'seller', 'store', 'direccion')),
  -- El id de la persona dentro del programa (por ejemplo «t-usr_admin»).
  usuario_app text,
  -- Para una cuenta de local: el id del local.
  tienda text,
  nombre text not null default '',
  activa boolean not null default true,
  creada_en timestamptz not null default now()
);
comment on table tabaco.cuentas is 'Quién entra al programa de Tabaco y con qué rol. Tener sesión en el proyecto no alcanza: hace falta una fila activa aquí.';
alter table tabaco.cuentas enable row level security;

-- ---------- Datos ----------

create table tabaco.registros (
  -- La tabla de la app (products, stores, deliveries…) y el id del registro.
  tabla text not null check (tabla ~ '^[A-Za-z]{2,40}$'),
  id text not null check (char_length(id) between 1 and 200),
  datos jsonb not null default '{}'::jsonb check (jsonb_typeof(datos) = 'object'),
  -- Borrar deja la fila marcada (y vacía) para que los demás teléfonos se enteren.
  borrado boolean not null default false,
  -- La transacción que la escribió: ordena los cambios para sincronizar sin perder ninguno.
  tx xid8 not null default pg_current_xact_id(),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);
alter table tabaco.registros add primary key (tabla, id);
comment on table tabaco.registros is 'Los datos del programa: una fila por registro de la app, con su contenido en datos. tx ordena los cambios para sincronizar.';
create index registros_tx on tabaco.registros (tx);
alter table tabaco.registros enable row level security;
-- Sin políticas a propósito: solo se entra por las funciones.

create function tabaco.al_guardar() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.tabla = 'audit' then
    raise exception 'La auditoría no se modifica' using errcode = '42501';
  end if;
  new.tx := pg_catalog.pg_current_xact_id();
  new.actualizado_en := pg_catalog.now();
  new.actualizado_por := auth.uid();
  return new;
end $$;
create trigger registros_al_guardar before insert or update on tabaco.registros
  for each row execute function tabaco.al_guardar();

create function tabaco.al_borrar() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.tabla = 'audit' then
    raise exception 'La auditoría no se borra' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger registros_al_borrar before delete on tabaco.registros
  for each row execute function tabaco.al_borrar();

-- ---------- Quién llama ----------

create function tabaco.mi_rol() returns text
language sql stable security definer set search_path = '' as $$
  select c.rol from tabaco.cuentas c where c.usuario = auth.uid() and c.activa
$$;

create function tabaco.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(tabaco.mi_rol() = 'admin', false)
$$;

-- ---------- Las tres puertas ----------

create function public.tabaco_soy() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('rol', c.rol, 'usuario_app', c.usuario_app, 'tienda', c.tienda, 'nombre', c.nombre)
  from tabaco.cuentas c
  where c.usuario = auth.uid() and c.activa
$$;
comment on function public.tabaco_soy() is 'Programa de Tabaco: la cuenta de quien llama (rol, usuario del programa, local) o null si no tiene.';

-- Trae lo que cambió desde `p_desde` (el «hasta» de la vez anterior; 0 la primera vez). Solo
-- devuelve lo de transacciones ya terminadas, así un cambio lento nunca queda atrás del cursor.
create function public.tabaco_traer(p_desde bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rol text := tabaco.mi_rol();
  v_hasta xid8 := pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot());
  v_registros jsonb;
begin
  if v_rol is null then
    raise exception 'No tienes cuenta en el programa de Tabaco' using errcode = '42501';
  end if;
  if v_rol not in ('admin', 'direccion') then
    raise exception 'Por ahora el servidor del programa de Tabaco es solo para Administración y Dirección' using errcode = '42501';
  end if;
  select coalesce(
           jsonb_agg(jsonb_build_object('tabla', r.tabla, 'id', r.id, 'datos', r.datos, 'borrado', r.borrado)
                     order by r.tx, r.tabla, r.id),
           '[]'::jsonb)
    into v_registros
    from tabaco.registros r
   where r.tx >= (greatest(coalesce(p_desde, 0), 0)::text)::xid8
     and r.tx < v_hasta;
  return jsonb_build_object('hasta', (v_hasta::text)::bigint, 'registros', v_registros);
end $$;
comment on function public.tabaco_traer(bigint) is 'Programa de Tabaco: los cambios confirmados desde el cursor anterior. Fase 1: Administración y Dirección.';

-- Aplica una tanda de cambios, todo o nada:
--   {"tabla": "products", "id": "…", "op": "guardar", "datos": {…}}
--   {"tabla": "products", "id": "…", "op": "borrar"}
--   {"tabla": "products", "op": "vaciar"}
-- La auditoría solo se agrega: no se borra ni se cambia (si ya está, el reintento se ignora).
create function public.tabaco_aplicar(p_cambios jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rol text := tabaco.mi_rol();
  c jsonb;
  v_tabla text;
  v_id text;
  v_op text;
  v_n integer := 0;
begin
  if v_rol is null then
    raise exception 'No tienes cuenta en el programa de Tabaco' using errcode = '42501';
  end if;
  if v_rol <> 'admin' then
    raise exception 'Por ahora solo Administración guarda en el servidor del programa de Tabaco' using errcode = '42501';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'array' then
    raise exception 'Se esperaba una lista de cambios';
  end if;
  if jsonb_array_length(p_cambios) > 2000 then
    raise exception 'Demasiados cambios juntos (máximo 2000)';
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
      if v_tabla = 'audit' and exists (select 1 from tabaco.registros r where r.tabla = 'audit' and r.id = v_id) then
        continue;
      end if;
      insert into tabaco.registros (tabla, id, datos, borrado)
      values (v_tabla, v_id, c->'datos', false)
      on conflict (tabla, id) do update set datos = excluded.datos, borrado = false;
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
  return v_n;
end $$;
comment on function public.tabaco_aplicar(jsonb) is 'Programa de Tabaco: guarda una tanda de cambios, todo o nada. Fase 1: solo Administración.';

-- ---------- Permisos ----------

revoke all on all tables in schema tabaco from public, anon, authenticated;
revoke all on all sequences in schema tabaco from public, anon, authenticated;
revoke all on all functions in schema tabaco from public, anon, authenticated;

revoke all on function public.tabaco_soy() from public, anon;
revoke all on function public.tabaco_traer(bigint) from public, anon;
revoke all on function public.tabaco_aplicar(jsonb) from public, anon;
grant execute on function public.tabaco_soy() to authenticated;
grant execute on function public.tabaco_traer(bigint) to authenticated;
grant execute on function public.tabaco_aplicar(jsonb) to authenticated;

-- Las reglas del depósito de archivos corren como quien sube o baja: necesitan llamar a es_admin.
grant usage on schema tabaco to authenticated;
grant execute on function tabaco.es_admin() to authenticated;
