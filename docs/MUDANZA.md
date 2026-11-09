# Mudar el programa de Tabaco a su propio servidor

Hoy el programa vive en un proyecto de Supabase que se comparte con otras apps, separado en su
esquema `tabaco` (ver `SUPABASE.md`). Cuando el cliente pague, se pasa a un proyecto propio en plan
Pro. Todo está armado para que sea una mudanza, no un rearmado: el programa ocupa el esquema `tabaco`,
el depósito `tabaco-archivos`, las funciones `public.tabaco_*` y las cuentas de quienes entran. Nada
más del proyecto viejo lo usa, y nada del programa usa otra cosa del proyecto viejo.

La app no cambia: la dirección del servidor está en un solo archivo
(`app-gestion/src/servidor/config.ts`). Cada teléfono guarda primero en su base y se vuelve a conectar
solo con el servidor nuevo.

## Antes

- Que todos sincronicen: en cada teléfono con cambios, el aviso del servidor debe decir «Al día».
- Avisar: durante la mudanza (una hora, más o menos) nadie carga nada.
- Exportar una copia completa desde la app (Portada → Exportar copia). Por si acaso.

## Pasos

1. **Proyecto nuevo.** En la organización del cliente, plan Pro. Anotar su dirección, su llave
   pública («publishable») y, solo para la mudanza, su llave secreta y la contraseña de su base.
   Las llaves secretas y las contraseñas nunca van al repositorio.

2. **Armarlo.** Aplicar en orden las migraciones de `app-gestion/supabase/migrations/`
   (`tabaco_1…`, `tabaco_2…`, `tabaco_3…`). Quedan el esquema, las funciones, el depósito y sus reglas,
   iguales a los de hoy.

3. **Las cuentas y los datos.** Con `psql` y las dos conexiones de base (`VIEJO_DB`, `NUEVO_DB`, de
   Ajustes → Base de datos de cada proyecto). Las contraseñas se copian tal cual (cifradas): cada
   persona entra en el nuevo con la misma de siempre.

   ```bash
   # Quienes entran al programa (con su contraseña cifrada) y su forma de entrar.
   psql "$VIEJO_DB" -c "\copy (select id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, '' as confirmation_token, '' as recovery_token, '' as email_change_token_new, '' as email_change, '' as email_change_token_current, '' as reauthentication_token, '' as phone_change, '' as phone_change_token, false as is_super_admin from auth.users where id in (select usuario from tabaco.cuentas)) to 'usuarios.csv' csv header"
   psql "$VIEJO_DB" -c "\copy (select id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at from auth.identities where user_id in (select usuario from tabaco.cuentas)) to 'identidades.csv' csv header"
   psql "$NUEVO_DB" -c "\copy auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_super_admin) from 'usuarios.csv' csv header"
   psql "$NUEVO_DB" -c "\copy auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) from 'identidades.csv' csv header"

   # Las cuentas del programa, los datos y las invitaciones que siguen abiertas.
   psql "$VIEJO_DB" -c "\copy tabaco.cuentas to 'cuentas.csv' csv header"
   psql "$VIEJO_DB" -c "\copy (select tabla, id, datos, borrado from tabaco.registros) to 'registros.csv' csv header"
   psql "$VIEJO_DB" -c "\copy (select * from tabaco.invitaciones where usada_en is null and anulada_en is null and vence_en > now()) to 'invitaciones.csv' csv header"
   psql "$NUEVO_DB" -c "\copy tabaco.cuentas from 'cuentas.csv' csv header"
   psql "$NUEVO_DB" -c "\copy tabaco.registros (tabla, id, datos, borrado) from 'registros.csv' csv header"
   psql "$NUEVO_DB" -c "\copy tabaco.invitaciones from 'invitaciones.csv' csv header"
   ```

   Los archivos `.csv` llevan los datos de la empresa: se borran al terminar y no se suben a ningún
   lado.

4. **Las fotos y los PDF.** Con las llaves secretas de los dos proyectos en la terminal:

   ```bash
   VIEJO_URL=https://… VIEJO_LLAVE=… NUEVO_URL=https://… NUEVO_LLAVE=… node app-gestion/scripts/mudar-archivos.mjs
   ```

   Copia todo el depósito `tabaco-archivos` y al final dice cuántos hay en cada lado.

5. **Revisar.** En los dos proyectos: cuántas filas tienen `tabaco.cuentas` y `tabaco.registros`
   (sin contar los borrados) y cuántos archivos tiene el depósito. Tienen que coincidir.

6. **Apuntar la app al nuevo.** En `app-gestion/src/servidor/config.ts`, la dirección y la llave
   pública del proyecto nuevo. Compilar, probar y publicar (mismo link).

7. **Qué ve cada persona.** La app se actualiza sola. La sesión del servidor viejo ya no vale: cada
   quien vuelve a entrar con su correo y su contraseña de siempre. Como su teléfono tiene lo mismo
   que el servidor nuevo, se conecta sin preguntar nada. Si un teléfono tenía algo sin subir del
   viejo, pregunta qué hacer (y deja bajar una copia antes).

8. **Limpiar el proyecto viejo** (cuando el nuevo lleve unos días andando):
   - Vaciar el depósito `tabaco-archivos` desde el panel (o con la API) y borrarlo.
   - Borrar las cuatro reglas del depósito que empiezan con «tabaco:».
   - Borrar las funciones `public.tabaco_*` y el esquema (`drop schema tabaco cascade`).
   - Borrar del proyecto viejo las cuentas que creó el programa y no usa ninguna otra app:
     `delete from auth.users where raw_app_meta_data ->> 'programa' = 'tabaco'`. Las cuentas que ya
     existían (de otras apps) se quedan como estaban.

## Lo que no hay que olvidar

- La llave secreta del proyecto nuevo es del cliente: no se pega en el chat, ni en el código, ni en
  `docs/`.
- En el plan Pro hay copias de seguridad diarias: ya no hace falta la copia semanal a mano (igual
  conviene una antes de cambios grandes).
- Con su proyecto propio, el programa tiene también su propia configuración de correos y de
  contraseñas: se puede activar «contraseñas filtradas» y la recuperación por correo con su propio
  remitente.
