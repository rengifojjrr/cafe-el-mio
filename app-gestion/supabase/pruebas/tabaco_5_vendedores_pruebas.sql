-- Pruebas de la fase 2 (vendedores), para correr en el servidor (por ejemplo, en el editor de SQL de
-- Supabase). Todo pasa dentro de una transacción que se deshace: el bloque termina con un error a
-- propósito que trae el resumen (RESULTADOS: …) y nada queda guardado. Cada línea debe decir «t»,
-- «guardada/guardado» o «rechazada/rechazado» según se espera.
--
-- Ojo: public.tabaco_traer solo entrega lo ya confirmado (tx < pg_snapshot_xmin), así que no ve los
-- registros de prueba de esta misma transacción. Por eso lo que ve un vendedor se prueba con
-- tabaco.para_vendedor directamente, y tabaco_traer se prueba con los datos de verdad ya guardados
-- (sin imprimir ninguno: solo cuántos y si se cumplen las reglas).
--
-- Usuarios simulados: un administrador, dos vendedores y Dirección. Datos inventados (ids zz-…).
do $$
declare
  v_admin uuid := gen_random_uuid();
  v_v1 uuid := gen_random_uuid();
  v_v2 uuid := gen_random_uuid();
  v_dir uuid := gen_random_uuid();
  r jsonb;
  res text[] := '{}';
  st text;
  loc text[];
  hil text[];
  todos integer;
  venta jsonb;
begin
  -- ---------- Datos de prueba (como el dueño del proyecto) ----------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', e, '', now(), now(), now(), '{"programa":"tabaco"}', '{}'
    from (values (v_admin, 'prueba.admin@example.com'), (v_v1, 'prueba.v1@example.com'), (v_v2, 'prueba.v2@example.com'), (v_dir, 'prueba.dir@example.com')) t(u, e);
  insert into tabaco.cuentas (usuario, rol, usuario_app, nombre) values
    (v_admin, 'admin', 'zz-admin', 'Admin prueba'),
    (v_v1, 'seller', 'zz-v1', 'Vendedor uno'),
    (v_v2, 'seller', 'zz-v2', 'Vendedor dos'),
    (v_dir, 'direccion', null, 'Dirección prueba');
  insert into tabaco.registros (tabla, id, datos) values
    ('users', 'zz-admin', '{"role":"admin","name":"Admin prueba","email":"a@example.com","phone":"1","active":true,"createdAt":"2026-01-01"}'),
    ('users', 'zz-v1', '{"role":"seller","name":"Vendedor uno","email":"v1@example.com","phone":"2","active":true,"createdAt":"2026-01-01"}'),
    ('users', 'zz-v2', '{"role":"seller","name":"Vendedor dos","email":"v2@example.com","phone":"3","active":true,"createdAt":"2026-01-01"}'),
    ('stores', 'zz-loc1', '{"name":"Local uno","sellerId":"zz-v1","status":"activo","saleMode":"consignacion","creditDays":0}'),
    ('stores', 'zz-loc2', '{"name":"Local dos","sellerId":"zz-v2","status":"activo","saleMode":"consignacion","creditDays":0}'),
    ('products', 'zz-p1', '{"name":"Producto","priceToStore":35,"cost":12.5,"sampleCost":false}'),
    ('lots', 'zz-l1', '{"productId":"zz-p1","unitCost":12.5,"code":"L1"}'),
    ('movements', 'zz-m1', '{"productId":"zz-p1","lotId":"zz-l1","qty":10,"from":{"kind":"warehouse"},"to":{"kind":"store","storeId":"zz-loc1"},"storeId":"zz-loc1","unitPrice":40,"basePrice":35}'),
    ('movements', 'zz-m2', '{"productId":"zz-p1","lotId":"zz-l1","qty":7,"from":{"kind":"warehouse"},"to":{"kind":"store","storeId":"zz-loc2"},"storeId":"zz-loc2","unitPrice":44,"basePrice":35,"refId":"zz-d2","actorId":"zz-v2"}'),
    ('movements', 'zz-m3', '{"productId":"zz-p1","lotId":"zz-l1","qty":2,"from":{"kind":"store","storeId":"zz-loc2"},"to":{"kind":"sold"},"storeId":"zz-loc2"}'),
    ('commissions', 'zz-c1', '{"sellerId":"zz-v1","storeId":"zz-loc1","amount":5}'),
    ('commissions', 'zz-c2', '{"sellerId":"zz-v2","storeId":"zz-loc2","amount":9}'),
    ('salesReports', 'zz-s2', '{"storeId":"zz-loc2","lines":[{"productId":"zz-p1","qty":2,"cost":25,"lots":[{"lotId":"zz-l1","qty":2,"unitCost":12.5}]}]}'),
    ('threads', 'zz-t1', '{"participantIds":["zz-v1","zz-admin"]}'),
    ('threads', 'zz-t2', '{"participantIds":["zz-v2","zz-admin"]}'),
    ('messages', 'zz-msg1', '{"threadId":"zz-t1","authorId":"zz-admin","text":"hola"}'),
    ('messages', 'zz-msg2', '{"threadId":"zz-t2","authorId":"zz-admin","text":"otro"}'),
    ('audit', 'zz-aud1', '{"actorId":"zz-admin","summary":"algo"}'),
    ('priceLists', 'zz-pl1', '{"name":"Mayorista","defaultMarkupPercent":30}'),
    ('photos', 'zz-ph1', '{"ownerType":"product","ownerId":"zz-p1","archivo":"photos/zz-ph1"}'),
    ('photos', 'zz-ph2', '{"ownerType":"store","ownerId":"zz-loc2","archivo":"photos/zz-ph2"}');

  -- ---------- Vendedor uno: lo que ve (tabaco.para_vendedor, la regla que usa tabaco_traer) ----------
  loc := tabaco.locales_de('zz-v1');
  hil := tabaco.hilos_de('zz-v1');
  create temp table vista on commit drop as
    select g.tabla, g.id, tabaco.para_vendedor(g.tabla, g.id, g.datos, g.borrado, 'zz-v1', loc, hil) as fv
      from tabaco.registros g where g.id like 'zz-%';
  res := res || format('loc1 visible: %s', exists (select 1 from vista where id = 'zz-loc1' and not (fv->>'borrado')::boolean));
  res := res || format('loc2 como borrado: %s', exists (select 1 from vista where id = 'zz-loc2' and (fv->>'borrado')::boolean and fv->'datos' = '{}'::jsonb));
  res := res || format('producto sin costo: %s', exists (select 1 from vista where id = 'zz-p1' and not (fv->'datos' ? 'cost') and not (fv->'datos' ? 'sampleCost') and fv->'datos'->>'priceToStore' = '35'));
  res := res || format('lote sin costo: %s', exists (select 1 from vista where id = 'zz-l1' and not (fv->'datos' ? 'unitCost')));
  res := res || format('mov propio entero: %s', exists (select 1 from vista where id = 'zz-m1' and fv->'datos'->>'unitPrice' = '40'));
  res := res || format('mov del almacén a otro local, anónimo: %s', exists (select 1 from vista where id = 'zz-m2' and fv->'datos'->>'storeId' is null and fv->'datos'->'to'->>'kind' = 'adjustment' and not (fv->'datos' ? 'unitPrice') and fv->'datos'->>'refId' = '' and fv->'datos'->>'actorId' = ''));
  res := res || format('venta de otro local, nada: %s', not exists (select 1 from vista where id in ('zz-m3', 'zz-s2') and fv is not null));
  res := res || format('comisiones: solo la suya: %s', exists (select 1 from vista where id = 'zz-c1' and fv is not null) and not exists (select 1 from vista where id = 'zz-c2' and fv is not null));
  res := res || format('mensajes: solo su hilo: %s', exists (select 1 from vista where id = 'zz-msg1' and fv is not null) and not exists (select 1 from vista where id in ('zz-msg2', 'zz-t2') and fv is not null));
  res := res || format('usuarios: él entero, admin sin correo, el otro vendedor nada: %s',
    exists (select 1 from vista where id = 'zz-v1' and fv->'datos'->>'email' = 'v1@example.com')
    and exists (select 1 from vista where id = 'zz-admin' and fv->'datos'->>'email' = '' and fv->'datos'->>'name' = 'Admin prueba')
    and not exists (select 1 from vista where id = 'zz-v2' and fv is not null));
  res := res || format('sin auditoría ni listas: %s', not exists (select 1 from vista where id in ('zz-aud1', 'zz-pl1') and fv is not null));
  res := res || format('fotos: la del catálogo sí, la del otro local no: %s', exists (select 1 from vista where id = 'zz-ph1' and fv is not null) and not exists (select 1 from vista where id = 'zz-ph2' and fv is not null));

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_v1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_v1, 'role', 'authenticated')::text, true);
  res := res || format('depósito: ve la foto del catálogo, no la del otro local: %s', tabaco.vendedor_ve_archivo('photos/zz-ph1') and not tabaco.vendedor_ve_archivo('photos/zz-ph2'));

  -- ---------- Vendedor uno: lo que guarda ----------
  -- Una visita a su local: sí.
  begin
    perform public.tabaco_aplicar('[{"tabla":"visits","id":"zz-vis1","op":"guardar","datos":{"storeId":"zz-loc1"}}]'::jsonb);
    res := res || 'visita a su local: guardada'::text;
  exception when others then res := res || format('visita a su local: ERROR %s', sqlerrm); end;
  -- Una visita al local de otro: no (22023).
  begin
    perform public.tabaco_aplicar('[{"tabla":"visits","id":"zz-vis2","op":"guardar","datos":{"storeId":"zz-loc2"}}]'::jsonb);
    res := res || 'visita al local de otro: GUARDADA (mal)'::text;
  exception when others then get stacked diagnostics st = returned_sqlstate; res := res || format('visita al local de otro: rechazada (%s)', st); end;
  -- Aprobar su local: no.
  begin
    perform public.tabaco_aplicar('[{"tabla":"stores","id":"zz-loc1","op":"guardar","datos":{"name":"Local uno","sellerId":"zz-v1","status":"pausado","saleMode":"consignacion","creditDays":0}}]'::jsonb);
    res := res || 'pausar su local: GUARDADO (mal)'::text;
  exception when others then res := res || format('pausar su local: rechazado (%s)', sqlerrm); end;
  -- Ponerle precio por debajo del base: no; por encima: sí.
  begin
    perform public.tabaco_aplicar('[{"tabla":"stores","id":"zz-loc1","op":"guardar","datos":{"name":"Local uno","sellerId":"zz-v1","status":"activo","saleMode":"consignacion","creditDays":0,"precios":{"zz-p1":30}}}]'::jsonb);
    res := res || 'precio bajo el base: GUARDADO (mal)'::text;
  exception when others then res := res || format('precio bajo el base: rechazado (%s)', sqlerrm); end;
  begin
    perform public.tabaco_aplicar('[{"tabla":"stores","id":"zz-loc1","op":"guardar","datos":{"name":"Local uno","sellerId":"zz-v1","status":"activo","saleMode":"consignacion","creditDays":0,"precios":{"zz-p1":45}}}]'::jsonb);
    res := res || 'precio sobre el base: guardado'::text;
  exception when others then res := res || format('precio sobre el base: ERROR %s', sqlerrm); end;
  -- Cambiar los días de crédito: no.
  begin
    perform public.tabaco_aplicar('[{"tabla":"stores","id":"zz-loc1","op":"guardar","datos":{"name":"Local uno","sellerId":"zz-v1","status":"activo","saleMode":"consignacion","creditDays":30,"precios":{"zz-p1":45}}}]'::jsonb);
    res := res || 'días de crédito: GUARDADO (mal)'::text;
  exception when others then res := res || format('días de crédito: rechazado (%s)', sqlerrm); end;
  -- Un prospecto nuevo a su nombre: sí; a nombre de otro: no.
  begin
    perform public.tabaco_aplicar('[{"tabla":"stores","id":"zz-loc3","op":"guardar","datos":{"name":"Nuevo","sellerId":"zz-v1","status":"prospecto"}}]'::jsonb);
    res := res || 'prospecto suyo: guardado'::text;
  exception when others then res := res || format('prospecto suyo: ERROR %s', sqlerrm); end;
  begin
    perform public.tabaco_aplicar('[{"tabla":"stores","id":"zz-loc4","op":"guardar","datos":{"name":"Ajeno","sellerId":"zz-v2","status":"prospecto"}}]'::jsonb);
    res := res || 'prospecto de otro: GUARDADO (mal)'::text;
  exception when others then res := res || format('prospecto de otro: rechazado (%s)', sqlerrm); end;
  -- Un producto: no. Borrar: no.
  begin
    perform public.tabaco_aplicar('[{"tabla":"products","id":"zz-p1","op":"guardar","datos":{"name":"x","priceToStore":1}}]'::jsonb);
    res := res || 'producto: GUARDADO (mal)'::text;
  exception when others then res := res || format('producto: rechazado (%s)', sqlerrm); end;
  begin
    perform public.tabaco_aplicar('[{"tabla":"visits","id":"zz-vis1","op":"borrar"}]'::jsonb);
    res := res || 'borrar: BORRADO (mal)'::text;
  exception when others then res := res || format('borrar: rechazado (%s)', sqlerrm); end;
  -- Una venta de su local, con el movimiento: el servidor le pone el costo del lote.
  begin
    perform public.tabaco_aplicar('[
      {"tabla":"movements","id":"zz-m4","op":"guardar","datos":{"productId":"zz-p1","lotId":"zz-l1","qty":3,"from":{"kind":"store","storeId":"zz-loc1"},"to":{"kind":"sold"},"storeId":"zz-loc1","refId":"zz-s1"}},
      {"tabla":"salesReports","id":"zz-s1","op":"guardar","datos":{"storeId":"zz-loc1","lines":[{"productId":"zz-p1","qty":3,"unitPrice":45,"cost":0,"lots":[{"lotId":"zz-l1","qty":3,"unitCost":0}]}]}},
      {"tabla":"commissions","id":"zz-c3","op":"guardar","datos":{"sellerId":"zz-v1","storeId":"zz-loc1","amount":30,"status":"devengada"}}
    ]'::jsonb);
    res := res || 'venta, movimiento y comisión: guardados'::text;
  exception when others then res := res || format('venta: ERROR %s', sqlerrm); end;
  -- Un movimiento del local de otro: no.
  begin
    perform public.tabaco_aplicar('[{"tabla":"movements","id":"zz-m5","op":"guardar","datos":{"productId":"zz-p1","lotId":"zz-l1","qty":1,"from":{"kind":"store","storeId":"zz-loc2"},"to":{"kind":"sold"},"storeId":"zz-loc1"}}]'::jsonb);
    res := res || 'movimiento de otro local: GUARDADO (mal)'::text;
  exception when others then res := res || format('movimiento de otro local: rechazado (%s)', sqlerrm); end;
  -- Una comisión pagada o de otro: no.
  begin
    perform public.tabaco_aplicar('[{"tabla":"commissions","id":"zz-c4","op":"guardar","datos":{"sellerId":"zz-v1","storeId":"zz-loc1","amount":1,"status":"pagada"}}]'::jsonb);
    res := res || 'comisión pagada: GUARDADA (mal)'::text;
  exception when others then res := res || format('comisión pagada: rechazada (%s)', sqlerrm); end;
  -- El servidor le puso a su venta el costo del lote (12,5 × 3), y a él le vuelve sin costo.
  reset role;
  select g.datos into venta from tabaco.registros g where g.tabla = 'salesReports' and g.id = 'zz-s1';
  res := res || format('el servidor le pone el costo a su venta: %s', (venta->'lines'->0->>'cost')::numeric = 37.5 and (venta->'lines'->0->'lots'->0->>'unitCost')::numeric = 12.5);
  res := res || format('su venta le vuelve sin costo: %s',
    (select (x->'datos'->'lines'->0->>'cost')::numeric = 0 and (x->'datos'->'lines'->0->'lots'->0->>'unitCost')::numeric = 0
       from tabaco.para_vendedor('salesReports', 'zz-s1', venta, false, 'zz-v1', tabaco.locales_de('zz-v1'), tabaco.hilos_de('zz-v1')) x));
  set local role authenticated;

  -- ---------- Dirección: mira, no guarda ----------
  perform set_config('request.jwt.claim.sub', v_dir::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_dir, 'role', 'authenticated')::text, true);
  begin
    perform public.tabaco_aplicar('[{"tabla":"visits","id":"zz-vis9","op":"guardar","datos":{"storeId":"zz-loc1"}}]'::jsonb);
    res := res || 'Dirección guarda: GUARDÓ (mal)'::text;
  exception when others then get stacked diagnostics st = returned_sqlstate; res := res || format('Dirección guarda: rechazado (%s)', st); end;

  -- ---------- Administración: todo, con costos; invita a un vendedor ----------
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin
    r := public.tabaco_invitar('prueba.nuevo@example.com', 'Vendedor nuevo', 'seller', 'zz-v1', 7);
    res := res || format('invitar a un vendedor: %s', case when r ? 'token' then 'sí' else 'no' end);
  exception when others then res := res || format('invitar a un vendedor: ERROR %s', sqlerrm); end;
  begin
    r := public.tabaco_invitar('prueba.otro@example.com', 'Sin vendedor', 'seller', 'zz-nadie', 7);
    res := res || 'invitar a un vendedor que no existe: INVITÓ (mal)'::text;
  exception when others then res := res || format('invitar a un vendedor que no existe: rechazado (%s)', sqlerrm); end;

  -- ---------- tabaco_traer con los datos de verdad ya guardados (no imprime ninguno) ----------
  -- Un vendedor sin locales: ningún local entero, ningún costo, nada de auditoría ni de otros vendedores.
  perform set_config('request.jwt.claim.sub', v_v1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_v1, 'role', 'authenticated')::text, true);
  r := public.tabaco_traer(0, 5000);
  res := res || format('vendedor: baja %s registros; locales de otros, todos como borrados: %s', jsonb_array_length(r->'registros'),
    not exists (select 1 from jsonb_array_elements(r->'registros') x where x->>'tabla' = 'stores' and not (x->>'borrado')::boolean));
  res := res || format('vendedor: ningún costo en productos ni lotes: %s',
    not exists (select 1 from jsonb_array_elements(r->'registros') x where (x->>'tabla' = 'products' and (x->'datos' ? 'cost' or x->'datos' ? 'sampleCost')) or (x->>'tabla' = 'lots' and x->'datos' ? 'unitCost')));
  res := res || format('vendedor: sin auditoría ni otros vendedores: %s',
    not exists (select 1 from jsonb_array_elements(r->'registros') x where x->>'tabla' = 'audit' or (x->>'tabla' = 'users' and x->'datos'->>'role' = 'seller')));
  res := res || format('vendedor: movimientos sin local ajeno: %s',
    not exists (select 1 from jsonb_array_elements(r->'registros') x where x->>'tabla' = 'movements' and (x->'datos'->>'storeId' is not null or x->'datos'->'to'->>'kind' = 'store' or x->'datos'->'from'->>'kind' = 'store')));
  -- Administración: todo, con costos (lo de antes de la fase 2, igual).
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  r := public.tabaco_traer(0, 5000);
  reset role;
  select count(*) into todos from tabaco.registros g where g.id not like 'zz-%' and g.tx < pg_snapshot_xmin(pg_current_snapshot());
  res := res || format('admin: baja %s de %s registros, productos con costo: %s', jsonb_array_length(r->'registros'), todos,
    exists (select 1 from jsonb_array_elements(r->'registros') x where x->>'tabla' = 'products' and x->'datos' ? 'cost'));

  raise exception 'RESULTADOS:%', E'\n' || array_to_string(res, E'\n');
end $$;
