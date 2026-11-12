-- Programa de Tabaco · 4: copias de seguridad automáticas en el servidor.
--
-- - Una copia completa por día (tarea «tabaco-copia-diaria» de pg_cron, 08:17 UTC = de madrugada en
--   Houston y Miami). Se guardan 30 días y siempre las 7 últimas, aunque sean más viejas.
-- - Una copia antes de vaciar una tabla (por ejemplo, al importar una copia que reemplaza todo). Una
--   sola cada 10 minutos: una importación grande llega en varias tandas.
-- - La app ve cuándo fue la última (`tabaco_copias`). Volver a una copia (`tabaco.restaurar_copia`)
--   no se puede desde la app: se hace a mano, con la consola del proyecto (ver SUPABASE.md).
-- - Las fotos y los PDF no entran en la copia: viven en el depósito y la app ya no los borra nunca,
--   así un registro que vuelve de una copia encuentra su archivo.

create table tabaco.copias (
  id bigint generated always as identity primary key,
  hecha_en timestamptz not null default now(),
  motivo text not null check (char_length(motivo) between 1 and 80),
  registros integer not null default 0
);
comment on table tabaco.copias is 'Copias de seguridad de tabaco.registros: una por día y antes de vaciar una tabla.';

create table tabaco.copias_registros (
  copia bigint not null references tabaco.copias (id) on delete cascade,
  tabla text not null,
  id text not null,
  datos jsonb not null,
  borrado boolean not null,
  tx xid8 not null,
  actualizado_en timestamptz not null,
  primary key (copia, tabla, id)
);
comment on table tabaco.copias_registros is 'Lo que tenía tabaco.registros en cada copia.';

alter table tabaco.copias enable row level security;
alter table tabaco.copias_registros enable row level security;
-- Sin políticas a propósito: solo se entra por las funciones.

-- Hace una copia de todo tabaco.registros y borra las viejas. Devuelve el número de la copia.
create function tabaco.hacer_copia(p_motivo text default 'diaria') returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_n integer;
begin
  insert into tabaco.copias (motivo)
  values (pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_motivo), ''), 'diaria'), 80))
  returning id into v_id;
  insert into tabaco.copias_registros (copia, tabla, id, datos, borrado, tx, actualizado_en)
  select v_id, r.tabla, r.id, r.datos, r.borrado, r.tx, r.actualizado_en from tabaco.registros r;
  get diagnostics v_n = row_count;
  update tabaco.copias set registros = v_n where id = v_id;
  -- Se guardan 30 días, y siempre las 7 últimas aunque sean más viejas.
  delete from tabaco.copias c
   where c.hecha_en < pg_catalog.now() - interval '30 days'
     and c.id not in (select c2.id from tabaco.copias c2 order by c2.id desc limit 7);
  return v_id;
end $$;
comment on function tabaco.hacer_copia(text) is 'Programa de Tabaco: copia completa de los registros (la llama la tarea diaria y tabaco_aplicar antes de vaciar).';

-- Vuelve los registros a como estaban en una copia. Antes hace una copia de lo de ahora. La
-- auditoría solo se agrega: no se toca. Lo creado después de la copia queda marcado como borrado,
-- así los teléfonos se enteran. Solo desde la consola del proyecto (no hay permiso para la app).
create function tabaco.restaurar_copia(p_copia bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_antes bigint;
  v_cambiados integer;
  v_agregados integer;
  v_borrados integer;
begin
  if not exists (select 1 from tabaco.copias c where c.id = p_copia) then
    raise exception 'No existe la copia %', p_copia;
  end if;
  v_antes := tabaco.hacer_copia('antes de restaurar la copia ' || p_copia);
  update tabaco.registros r set datos = c.datos, borrado = c.borrado
    from tabaco.copias_registros c
   where c.copia = p_copia and r.tabla = c.tabla and r.id = c.id and r.tabla <> 'audit'
     and (r.datos is distinct from c.datos or r.borrado is distinct from c.borrado);
  get diagnostics v_cambiados = row_count;
  insert into tabaco.registros (tabla, id, datos, borrado)
  select c.tabla, c.id, c.datos, c.borrado
    from tabaco.copias_registros c
   where c.copia = p_copia
     and not exists (select 1 from tabaco.registros r where r.tabla = c.tabla and r.id = c.id);
  get diagnostics v_agregados = row_count;
  update tabaco.registros r set borrado = true, datos = '{}'::jsonb
   where r.tabla <> 'audit' and not r.borrado
     and not exists (select 1 from tabaco.copias_registros c where c.copia = p_copia and c.tabla = r.tabla and c.id = r.id);
  get diagnostics v_borrados = row_count;
  return jsonb_build_object('copia_previa', v_antes, 'cambiados', v_cambiados, 'agregados', v_agregados, 'borrados', v_borrados);
end $$;
comment on function tabaco.restaurar_copia(bigint) is 'Programa de Tabaco: vuelve a una copia (antes copia lo de ahora). Solo desde la consola.';

-- Para la app: cuándo fue la última copia y cuántas hay. Administración y Dirección.
create function public.tabaco_copias() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ultima jsonb;
begin
  if not tabaco.puede_leer() then
    raise exception 'No tienes cuenta en el programa de Tabaco' using errcode = '42501';
  end if;
  -- Fechas en ISO con milisegundos y «Z»: la leen igual todos los navegadores.
  select jsonb_build_object('hecha_en', pg_catalog.to_char(c.hecha_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'motivo', c.motivo, 'registros', c.registros)
    into v_ultima
    from tabaco.copias c
   order by c.id desc
   limit 1;
  return jsonb_build_object(
    'ultima', v_ultima,
    'guardadas', (select count(*) from tabaco.copias),
    'desde', (select pg_catalog.to_char(min(c.hecha_en) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from tabaco.copias c)
  );
end $$;
comment on function public.tabaco_copias() is 'Programa de Tabaco: la última copia automática del servidor y cuántas hay guardadas.';

-- tabaco_aplicar, igual que antes, más la copia antes de vaciar.
create or replace function public.tabaco_aplicar(p_cambios jsonb) returns integer
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
  -- Antes de vaciar una tabla, una copia de lo que había (una sola cada 10 minutos).
  if exists (select 1 from jsonb_array_elements(p_cambios) e where e.value->>'op' = 'vaciar')
     and not exists (select 1 from tabaco.copias k where k.motivo = 'antes de vaciar' and k.hecha_en > pg_catalog.now() - interval '10 minutes') then
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
comment on function public.tabaco_aplicar(jsonb) is 'Programa de Tabaco: guarda una tanda de cambios, todo o nada (con copia antes de vaciar). Fase 1: solo Administración.';

-- ---------- Permisos ----------
-- Las funciones nuevas nacen con permiso para todos: se quita. Hacer y restaurar copias, nadie de
-- afuera (solo la tarea diaria, tabaco_aplicar y la consola). Ver la última, quien tiene sesión.

revoke all on table tabaco.copias, tabaco.copias_registros from public, anon, authenticated;
revoke all on function tabaco.hacer_copia(text) from public, anon, authenticated;
revoke all on function tabaco.restaurar_copia(bigint) from public, anon, authenticated;
revoke all on function public.tabaco_copias() from public, anon;
grant execute on function public.tabaco_copias() to authenticated;
revoke all on function public.tabaco_aplicar(jsonb) from public, anon;
grant execute on function public.tabaco_aplicar(jsonb) to authenticated;

-- ---------- La tarea diaria ----------
-- pg_cron reemplaza la tarea si ya existe con ese nombre.
select cron.schedule('tabaco-copia-diaria', '17 8 * * *', $$select tabaco.hacer_copia('diaria')$$);
