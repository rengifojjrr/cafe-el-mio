-- Programa de Tabaco · fase 1, segunda parte: la app se conecta.
--   1. Invitaciones de verdad para Administración y Dirección (con link, sin correos del proyecto).
--   2. Administración ve y quita accesos desde la app.
--   3. La bajada viene por partes (tandas), para que el primer teléfono no baje todo de un golpe.
--   4. Dirección también ve las fotos y los PDF del depósito (solo mirar).
--
-- Las cuentas que crea una invitación quedan marcadas con «programa: tabaco»: así se reconocen al
-- mudar el programa a su propio proyecto, y solo a esas se les puede poner contraseña nueva con
-- otra invitación. Una cuenta que ya existía en el proyecto (de otra app) entra con su contraseña
-- de siempre y la invitación solo le da acceso al programa.

-- ---------- Invitaciones ----------

create table tabaco.invitaciones (
  id uuid primary key default gen_random_uuid(),
  -- Solo se guarda la huella del código: el link completo lo tiene quien lo recibe.
  token_hash text not null unique,
  correo text not null check (correo = lower(correo) and correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  nombre text not null default '',
  rol text not null check (rol in ('admin', 'direccion')),
  -- El id de la persona dentro del programa (Administración: su usuario en la app).
  usuario_app text,
  creada_por uuid not null,
  creada_en timestamptz not null default now(),
  vence_en timestamptz not null,
  usada_en timestamptz,
  usada_por uuid,
  anulada_en timestamptz
);
comment on table tabaco.invitaciones is 'Invitaciones al programa de Tabaco. Se guarda la huella del código, nunca el código.';
create index invitaciones_correo on tabaco.invitaciones (correo);
alter table tabaco.invitaciones enable row level security;
-- Sin políticas a propósito: solo se entra por las funciones.

create function tabaco.huella(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create function tabaco.estado_invitacion(p_inv tabaco.invitaciones) returns text
language sql stable set search_path = '' as $$
  select case
    when p_inv.anulada_en is not null then 'anulada'
    when p_inv.usada_en is not null then 'usada'
    when p_inv.vence_en < pg_catalog.now() then 'vencida'
    else 'vigente' end
$$;

-- Administración y Dirección ven los archivos; solo Administración los cambia.
create function tabaco.puede_leer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(tabaco.mi_rol() in ('admin', 'direccion'), false)
$$;

-- Administración invita: devuelve el código una sola vez (va en el link).
create function public.tabaco_invitar(p_correo text, p_nombre text, p_rol text, p_usuario_app text default null, p_dias integer default 7)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_correo text := lower(btrim(coalesce(p_correo, '')));
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_inv tabaco.invitaciones;
begin
  if not tabaco.es_admin() then
    raise exception 'Solo Administración invita al programa de Tabaco.' using errcode = '42501';
  end if;
  if v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Ese correo no parece válido.' using errcode = '22023';
  end if;
  if coalesce(p_rol, '') not in ('admin', 'direccion') then
    raise exception 'Por ahora solo se invita a Administración o a Dirección.' using errcode = '22023';
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
  values (tabaco.huella(v_token), v_correo, v_nombre, p_rol, nullif(btrim(coalesce(p_usuario_app, '')), ''),
          auth.uid(), now() + make_interval(days => p_dias))
  returning * into v_inv;
  return jsonb_build_object('id', v_inv.id, 'token', v_token, 'vence_en', v_inv.vence_en);
end $$;
comment on function public.tabaco_invitar(text, text, text, text, integer) is 'Programa de Tabaco: Administración invita a alguien (devuelve el código del link una sola vez).';

-- Quien abre el link ve para quién es (sin entrar todavía).
create function public.tabaco_invitacion_ver(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_inv tabaco.invitaciones;
  v_existe boolean;
  v_meta jsonb;
begin
  select * into v_inv from tabaco.invitaciones where token_hash = tabaco.huella(p_token);
  if not found then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  select true, u.raw_app_meta_data into v_existe, v_meta from auth.users u where lower(u.email) = v_inv.correo limit 1;
  return jsonb_build_object(
    'estado', tabaco.estado_invitacion(v_inv),
    'nombre', v_inv.nombre,
    'rol', v_inv.rol,
    'correo', v_inv.correo,
    'vence_en', v_inv.vence_en,
    'cuenta', case when not coalesce(v_existe, false) then 'nueva'
                   when coalesce(v_meta ->> 'programa', '') = 'tabaco' then 'tabaco'
                   else 'otra' end);
end $$;
comment on function public.tabaco_invitacion_ver(text) is 'Programa de Tabaco: para quién es una invitación y si sigue valiendo.';

-- Acepta la invitación poniendo una contraseña. Crea la cuenta si no existe; si la creó este
-- programa, le pone la contraseña nueva; si es de otra app del proyecto, no la toca.
create function public.tabaco_invitacion_aceptar(p_token text, p_clave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_inv tabaco.invitaciones;
  v_id uuid;
  v_meta jsonb;
begin
  select * into v_inv from tabaco.invitaciones where token_hash = tabaco.huella(p_token) for update;
  if not found or tabaco.estado_invitacion(v_inv) <> 'vigente' then
    raise exception 'Esa invitación ya no vale. Pide una nueva a Administración.' using errcode = '42501';
  end if;
  if char_length(coalesce(p_clave, '')) < 8 then
    raise exception 'La contraseña necesita 8 caracteres por lo menos.' using errcode = '22023';
  end if;
  if octet_length(p_clave) > 72 then
    raise exception 'La contraseña es muy larga (hasta 72 letras).' using errcode = '22023';
  end if;
  select u.id, u.raw_app_meta_data into v_id, v_meta from auth.users u where lower(u.email) = v_inv.correo limit 1;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_super_admin
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_inv.correo,
      extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), now(), now(), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'programa', 'tabaco'),
      jsonb_build_object('nombre', v_inv.nombre),
      '', '', '', '', '', '', '', '', false);
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text,
            jsonb_build_object('sub', v_id::text, 'email', v_inv.correo, 'email_verified', true),
            'email', now(), now(), now());
  elsif coalesce(v_meta ->> 'programa', '') = 'tabaco' then
    -- Contraseña nueva para una cuenta del programa: las sesiones abiertas se cierran.
    update auth.users set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), updated_at = now()
     where id = v_id;
    delete from auth.sessions where user_id = v_id;
  else
    raise exception 'Ya tienes una cuenta con ese correo: entra con tu contraseña de siempre.'
      using errcode = '42501', hint = 'cuenta_existente';
  end if;
  insert into tabaco.cuentas (usuario, rol, usuario_app, nombre, activa)
  values (v_id, v_inv.rol, v_inv.usuario_app, v_inv.nombre, true)
  on conflict (usuario) do update
    set rol = excluded.rol,
        usuario_app = coalesce(excluded.usuario_app, tabaco.cuentas.usuario_app),
        nombre = excluded.nombre,
        activa = true;
  update tabaco.invitaciones set usada_en = now(), usada_por = v_id where id = v_inv.id;
  return jsonb_build_object('correo', v_inv.correo, 'rol', v_inv.rol);
end $$;
comment on function public.tabaco_invitacion_aceptar(text, text) is 'Programa de Tabaco: acepta una invitación poniendo una contraseña.';

-- Para quien ya tenía cuenta en el proyecto: entra con su contraseña y la invitación se le enlaza.
create function public.tabaco_invitacion_enlazar(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_inv tabaco.invitaciones;
begin
  if auth.uid() is null then
    raise exception 'Primero entra con tu correo y tu contraseña.' using errcode = '42501';
  end if;
  select * into v_inv from tabaco.invitaciones where token_hash = tabaco.huella(p_token) for update;
  if not found or tabaco.estado_invitacion(v_inv) <> 'vigente' then
    raise exception 'Esa invitación ya no vale. Pide una nueva a Administración.' using errcode = '42501';
  end if;
  if lower(coalesce(auth.email(), '')) <> v_inv.correo then
    raise exception 'Esta invitación es para %, no para la cuenta con la que entraste.', v_inv.correo using errcode = '42501';
  end if;
  insert into tabaco.cuentas (usuario, rol, usuario_app, nombre, activa)
  values (auth.uid(), v_inv.rol, v_inv.usuario_app, v_inv.nombre, true)
  on conflict (usuario) do update
    set rol = excluded.rol,
        usuario_app = coalesce(excluded.usuario_app, tabaco.cuentas.usuario_app),
        nombre = excluded.nombre,
        activa = true;
  update tabaco.invitaciones set usada_en = now(), usada_por = auth.uid() where id = v_inv.id;
  return jsonb_build_object('correo', v_inv.correo, 'rol', v_inv.rol);
end $$;
comment on function public.tabaco_invitacion_enlazar(text) is 'Programa de Tabaco: enlaza una invitación a la cuenta con la que se entró.';

-- Administración: quién entra y qué invitaciones siguen abiertas.
create function public.tabaco_cuentas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not tabaco.es_admin() then
    raise exception 'Solo Administración ve las cuentas del programa de Tabaco.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'cuentas', (select coalesce(jsonb_agg(jsonb_build_object(
                  'usuario', c.usuario, 'nombre', c.nombre, 'rol', c.rol, 'correo', u.email, 'activa', c.activa,
                  'usuario_app', c.usuario_app, 'yo', c.usuario = auth.uid(), 'ultima_entrada', u.last_sign_in_at)
                  order by c.activa desc, c.nombre), '[]'::jsonb)
                from tabaco.cuentas c left join auth.users u on u.id = c.usuario),
    'invitaciones', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', i.id, 'nombre', i.nombre, 'correo', i.correo, 'rol', i.rol,
                       'creada_en', i.creada_en, 'vence_en', i.vence_en, 'estado', tabaco.estado_invitacion(i))
                       order by i.creada_en desc), '[]'::jsonb)
                     from tabaco.invitaciones i where i.usada_en is null and i.anulada_en is null));
end $$;
comment on function public.tabaco_cuentas() is 'Programa de Tabaco: cuentas e invitaciones abiertas (solo Administración).';

create function public.tabaco_cuenta_activa(p_usuario uuid, p_activa boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not tabaco.es_admin() then
    raise exception 'Solo Administración cambia los accesos.' using errcode = '42501';
  end if;
  if p_usuario = auth.uid() and not coalesce(p_activa, false) then
    raise exception 'No puedes quitarte el acceso a ti mismo.' using errcode = '22023';
  end if;
  update tabaco.cuentas set activa = coalesce(p_activa, false) where usuario = p_usuario;
  if not found then
    raise exception 'Esa cuenta no existe.' using errcode = '22023';
  end if;
  if not exists (select 1 from tabaco.cuentas where rol = 'admin' and activa) then
    raise exception 'Tiene que quedar al menos una cuenta de Administración.' using errcode = '22023';
  end if;
end $$;
comment on function public.tabaco_cuenta_activa(uuid, boolean) is 'Programa de Tabaco: da o quita el acceso a una cuenta (solo Administración).';

create function public.tabaco_invitacion_anular(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not tabaco.es_admin() then
    raise exception 'Solo Administración anula invitaciones.' using errcode = '42501';
  end if;
  update tabaco.invitaciones set anulada_en = now() where id = p_id and usada_en is null and anulada_en is null;
end $$;
comment on function public.tabaco_invitacion_anular(uuid) is 'Programa de Tabaco: anula una invitación que todavía no se usó.';

-- ---------- Bajada por partes ----------
-- Igual que antes, pero en tandas de hasta p_limite filas. Una tanda nunca parte una transacción
-- (si una sola es más grande que la tanda, va entera). «mas» dice si queda algo por bajar.

drop function public.tabaco_traer(bigint);

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
begin
  if v_rol is null then
    raise exception 'No tienes cuenta en el programa de Tabaco' using errcode = '42501';
  end if;
  if v_rol not in ('admin', 'direccion') then
    raise exception 'Por ahora el servidor del programa de Tabaco es solo para Administración y Dirección' using errcode = '42501';
  end if;
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
  select coalesce(
           jsonb_agg(jsonb_build_object('tabla', r.tabla, 'id', r.id, 'datos', r.datos, 'borrado', r.borrado)
                     order by r.tx, r.tabla, r.id),
           '[]'::jsonb)
    into v_registros
    from tabaco.registros r
   where r.tx >= v_desde and r.tx < v_corte;
  return jsonb_build_object('hasta', (v_corte::text)::bigint, 'mas', v_corte < v_hasta, 'registros', v_registros);
end $$;
comment on function public.tabaco_traer(bigint, integer) is 'Programa de Tabaco: los cambios confirmados desde el cursor anterior, por tandas. Fase 1: Administración y Dirección.';

-- ---------- Archivos: Dirección también los ve ----------

drop policy "tabaco: administración ve sus archivos" on storage.objects;
create policy "tabaco: administración y dirección ven los archivos" on storage.objects
  for select to authenticated
  using (bucket_id = 'tabaco-archivos' and tabaco.puede_leer());

-- ---------- Permisos ----------

revoke all on all tables in schema tabaco from public, anon, authenticated;
revoke all on all functions in schema tabaco from public, anon, authenticated;
-- Las reglas del depósito corren como quien sube o baja: necesitan estas dos.
grant execute on function tabaco.es_admin() to authenticated;
grant execute on function tabaco.puede_leer() to authenticated;

revoke all on function public.tabaco_traer(bigint, integer) from public, anon;
revoke all on function public.tabaco_invitar(text, text, text, text, integer) from public, anon;
revoke all on function public.tabaco_invitacion_enlazar(text) from public, anon;
revoke all on function public.tabaco_cuentas() from public, anon;
revoke all on function public.tabaco_cuenta_activa(uuid, boolean) from public, anon;
revoke all on function public.tabaco_invitacion_anular(uuid) from public, anon;
grant execute on function public.tabaco_traer(bigint, integer) to authenticated;
grant execute on function public.tabaco_invitar(text, text, text, text, integer) to authenticated;
grant execute on function public.tabaco_invitacion_enlazar(text) to authenticated;
grant execute on function public.tabaco_cuentas() to authenticated;
grant execute on function public.tabaco_cuenta_activa(uuid, boolean) to authenticated;
grant execute on function public.tabaco_invitacion_anular(uuid) to authenticated;

-- Abrir el link y aceptar se hace antes de tener cuenta: también sin sesión.
revoke all on function public.tabaco_invitacion_ver(text) from public;
revoke all on function public.tabaco_invitacion_aceptar(text, text) from public;
grant execute on function public.tabaco_invitacion_ver(text) to anon, authenticated;
grant execute on function public.tabaco_invitacion_aceptar(text, text) to anon, authenticated;
