# Servidor (Supabase)

**Estado (9 de noviembre de 2026): fase 1 conectada.** La app entra con correo y contraseña y sincroniza con el
servidor. Entran Administración (carga y cambia) y Dirección (solo mira); vendedores y locales, en la fase 2.

## Dónde vive

En un proyecto de Supabase del dueño que comparte con otras apps (plan gratis, por ahora). Todo lo del tabaco está
**separado en el esquema `tabaco`**; el café, cuando se active, va en su propio esquema `cafe` (ya reservado y vacío).
Cuando el cliente pague, el tabaco pasa a su propio proyecto en plan Pro: es una mudanza preparada paso a paso en
`MUDANZA.md` (esquema, depósito, cuentas y un script para las fotos). Las migraciones están en
`app-gestion/supabase/migrations/` y la dirección del servidor, en un solo archivo:
`app-gestion/src/servidor/config.ts`.

**Qué se separa:** los datos (esquema propio), el acceso (hace falta una cuenta activa en `tabaco.cuentas`: tener sesión
en el proyecto no alcanza), los archivos (depósito privado propio), las funciones (con prefijo `tabaco_`) y la sesión
guardada en el teléfono (con un nombre propio). **Qué no se separa dentro de un mismo proyecto:** la lista de usuarios
y contraseñas, la clave maestra, la configuración de correos, el espacio del plan y las copias de seguridad (el plan
gratis no tiene). Por eso, mientras siga en el plan gratis: copia propia semanal (Portada → Exportar copia).

## Cómo está armado

- **`tabaco.registros`**: una fila por registro de la app (`tabla`, `id`, `datos` en JSON). Borrar deja la fila marcada
  y vacía para que los demás teléfonos se enteren. Cada fila guarda la transacción que la escribió (`tx`), que ordena
  los cambios para sincronizar sin perder ninguno.
- **`tabaco.cuentas`**: quién entra y con qué rol (`admin`, `seller`, `store`, `direccion`), ligado al usuario de
  Supabase. **`tabaco.invitaciones`**: las invitaciones (se guarda la huella del código, nunca el código). Las tres
  tablas tienen la seguridad por fila encendida y **ninguna regla**: nadie las lee ni las escribe directo.
- **Las puertas** en `public` revisan la cuenta por dentro:
  - `tabaco_soy()`: la cuenta de quien llama, o nada.
  - `tabaco_traer(desde, límite)`: los cambios ya confirmados desde el cursor anterior, por tandas que nunca parten
    una transacción, y el cursor nuevo. Un cambio lento nunca queda atrás del cursor.
  - `tabaco_aplicar(cambios)`: una tanda de cambios (`guardar`, `borrar`, `vaciar`), todo o nada. Solo Administración.
  - `tabaco_invitar`, `tabaco_cuentas`, `tabaco_cuenta_activa`, `tabaco_invitacion_anular`: Administración invita, ve
    quién entra y quita o devuelve el acceso (no puede quitarse el suyo ni dejar el programa sin Administración).
  - `tabaco_invitacion_ver` y `tabaco_invitacion_aceptar` (sin sesión: las usa quien abre el link) y
    `tabaco_invitacion_enlazar` (para quien ya tenía cuenta en el proyecto).
- **La auditoría solo se agrega**: no se cambia ni se borra (lo frenan las funciones y además la tabla). Un reintento de
  algo ya guardado se ignora.
- **Depósito `tabaco-archivos`**: privado, hasta 10 MB por archivo, solo fotos y PDF. Rutas `<tabla>/<id>`.
  Administración sube y borra; Administración y Dirección ven.

## Cómo se conecta la app

- **Entrar.** La portada pide correo y contraseña (`/auth/v1/token`). Sin cuenta activa en el programa no se entra.
  La sesión dura una hora y se renueva sola (una sola pestaña a la vez renueva). «Entrar como…» y «Cambiar de rol»
  quedan solo para las pruebas automáticas con datos de ejemplo.
- **Invitar.** Administración, en Usuarios → «Acceso con contraseña», invita con nombre, correo y rol. El link
  (`#/acceso/<código>`) sirve una vez y vence en los días elegidos. Quien lo abre pone su contraseña y entra. Si su
  correo ya tenía cuenta en otra app del proyecto, entra con esa contraseña y la invitación solo le da acceso (una
  invitación nunca cambia la contraseña de una cuenta ajena al programa). Si alguien olvida su contraseña, se le
  invita otra vez.
- **Sincronizar.** La app guarda primero en el teléfono, como siempre: funciona sin señal. Cada cambio deja su clave en
  la tabla local `pendientes`, en el mismo todo-o-nada que el cambio. Por detrás, un momento después de cada cambio, al
  volver la señal, al volver a la app y cada minuto: sube lo pendiente con `tabaco_aplicar` (las fotos y los PDF van
  antes al depósito) y baja lo de los demás con `tabaco_traer`. Si dos personas cambian el mismo registro, queda el
  último que llega al servidor; lo que un teléfono tiene sin subir nunca se pisa con lo que baja. Lo que el servidor
  no acepta (por ejemplo, un archivo de un tipo que no es foto ni PDF) queda anotado y no frena lo demás.
- **La primera vez de cada teléfono.** Si el servidor está vacío, ese teléfono lo llena. Si el teléfono no tiene nada
  propio, toma lo del servidor. Si los dos tienen datos distintos, la app pregunta («Subir lo de este teléfono» o
  «Usar lo del servidor») y antes deja bajar una copia.
- **El aviso del servidor** (arriba, en cada pantalla): «Al día», «N por subir», «Sin señal», «Vuelve a entrar». Al
  tocarlo: detalles, «Sincronizar ahora» y «Cerrar sesión».

## Lo que falta

1. **Fase 2 · vendedores y locales:** `tabaco_traer` filtra en el servidor lo de cada uno y **quita los costos**, y
   `tabaco_aplicar` revisa qué puede escribir cada rol. Lo que hoy calcula el teléfono con costos (por ejemplo el costo
   de lo vendido en una visita) pasa a calcularse en el servidor. Hasta entonces, las invitaciones de vendedores y
   locales no se muestran.
2. **Probar con dos teléfonos de verdad** (la app y el servidor ya están probados con un servidor de mentira y con
   pruebas SQL en el de verdad).
3. **Mudanza** al proyecto propio cuando el cliente pague (`MUDANZA.md`).

## Riesgos que conviene tener presentes

- **La dirección del servidor y su llave pública van dentro de la app publicada.** Es así en toda app web con
  Supabase y no abre nada por sí sola: lo que protege los datos son las cuentas y las funciones `tabaco_*`.
- **Mismo sitio, mismo almacenamiento.** Todas las páginas de `rengifojjrr.github.io` comparten el almacenamiento del
  navegador, también la sesión guardada. Con un dominio propio para el programa eso se cierra.
- **Sin copias de seguridad en el plan gratis**: la copia semanal a mano sigue siendo necesaria hasta la mudanza.

## Pruebas hechas

- **En el servidor de verdad** (con usuarios simulados y todo deshecho al final): alguien con sesión de otra app no ve ni
  escribe nada y no puede leer las tablas directo; sin sesión, solo responden «ver» y «aceptar» una invitación; el
  vendedor queda afuera en la fase 1; Administración guarda y lee; Dirección solo lee, no invita ni sube; la auditoría
  no se cambia ni se borra; una tanda con un error no deja nada a medias; lo no confirmado no sale al traer; la bajada
  por tandas devuelve cada transacción entera y no repite nada; una invitación crea la cuenta (marcada como del
  programa) con su contraseña, no se usa dos veces, no acepta contraseñas cortas, no sirve para otro correo y no toca
  una cuenta de otra app; en el depósito, alguien de otra app no sube ni ve archivos y Administración sí.
- **En la app, sin internet** (`tests/servidor-falso.ts`, un servidor de mentira con las mismas reglas):
  `tests/unit/servidor-sync.test.ts` (entrar, primera conexión en sus tres casos, subir y bajar con fotos, borrar,
  quién gana, sin señal, token vencido, cuenta quitada, rechazos, tandas, vaciar e invitaciones) y
  `tests/e2e/servidor.spec.ts` (tres navegadores: entrar, cargar, que el otro lo vea, invitar a Dirección, la primera
  conexión con datos propios y cerrar sesión).
