-- Programa de Tabaco: depósito privado para fotos, firmas y PDF (contratos, notas, permisos).
-- Separado de los depósitos de las otras apps del proyecto. Fase 1: solo Administración.
-- Las rutas son «<tabla>/<id>» (por ejemplo «photos/ph_123»).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tabaco-archivos', 'tabaco-archivos', false, 10485760,
        array['image/webp', 'image/jpeg', 'image/png', 'image/svg+xml', 'application/pdf'])
on conflict (id) do nothing;

create policy "tabaco: administración ve sus archivos" on storage.objects
  for select to authenticated
  using (bucket_id = 'tabaco-archivos' and tabaco.es_admin());

create policy "tabaco: administración sube archivos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tabaco-archivos' and tabaco.es_admin());

create policy "tabaco: administración cambia archivos" on storage.objects
  for update to authenticated
  using (bucket_id = 'tabaco-archivos' and tabaco.es_admin())
  with check (bucket_id = 'tabaco-archivos' and tabaco.es_admin());

create policy "tabaco: administración borra archivos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tabaco-archivos' and tabaco.es_admin());
