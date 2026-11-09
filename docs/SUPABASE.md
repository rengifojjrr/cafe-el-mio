# Servidor (Supabase)

**Estado (9 de noviembre de 2026): fase 1 del servidor construida y probada; la app todavía no se conecta.**

## Dónde vive

En un proyecto de Supabase del dueño que comparte con otras apps (plan gratis, por ahora). Todo lo del tabaco está
**separado en el esquema `tabaco`**; el café, cuando se active, va en su propio esquema `cafe` (ya reservado y vacío).
Cuando el cliente pague, el tabaco pasa a su propio proyecto en plan Pro: es mover el esquema `tabaco`, el depósito
`tabaco-archivos` y las cuentas del programa. Las migraciones están en `app-gestion/supabase/migrations/`.

**Qué se separa:** los datos (esquema propio), el acceso (hace falta una cuenta activa en `tabaco.cuentas`: tener sesión
en el proyecto no alcanza), los archivos (depósito privado propio) y las funciones (con prefijo `tabaco_`).
**Qué no se separa dentro de un mismo proyecto:** la lista de usuarios y contraseñas, la clave maestra, la
configuración de correos, el espacio del plan y las copias de seguridad (el plan gratis no tiene). Por eso, mientras
siga en el plan gratis: copia propia semanal y, al principio, solo entran Administración y vendedores.

## Cómo está armado

- **`tabaco.registros`**: una fila por registro de la app (`tabla`, `id`, `datos` en JSON). Borrar deja la fila marcada
  y vacía para que los demás equipos se enteren. Cada fila guarda la transacción que la escribió (`tx`), que ordena
  los cambios para sincronizar sin perder ninguno.
- **`tabaco.cuentas`**: quién entra y con qué rol (`admin`, `seller`, `store`, `direccion`), ligado al usuario de
  Supabase. Las dos tablas tienen la seguridad por fila encendida y **ninguna regla**: nadie las lee ni las escribe
  directo.
- **Tres puertas** en `public`, que revisan la cuenta por dentro:
  - `tabaco_soy()`: la cuenta de quien llama, o nada.
  - `tabaco_traer(desde)`: los cambios ya confirmados desde el cursor anterior, y el cursor nuevo. Solo devuelve lo de
    transacciones terminadas: un cambio lento nunca queda atrás del cursor.
  - `tabaco_aplicar(cambios)`: una tanda de cambios (`guardar`, `borrar`, `vaciar`), todo o nada.
- **La auditoría solo se agrega**: no se cambia ni se borra (lo frenan las funciones y además la tabla). Un reintento de
  algo ya guardado se ignora.
- **Depósito `tabaco-archivos`**: privado, hasta 10 MB por archivo, solo fotos y PDF. Rutas `<tabla>/<id>`.

**Fase 1 (hoy):** Administración guarda; Administración y Dirección leen; vendedores y locales todavía no usan el
servidor. Hay una cuenta de Administración creada para el dueño.

## Cómo se conecta la app (lo que falta)

La app sigue guardando primero en el teléfono, como hoy; una **sincronización** sube los cambios pendientes con
`tabaco_aplicar` y baja los de los demás con `tabaco_traer`. Así funciona sin señal y todos terminan viendo lo mismo.
Si dos personas cambian el mismo registro, queda el último cambio; el libro de movimientos no tiene ese problema
porque cada movimiento es un registro nuevo.

1. **Inicio de sesión** con correo y contraseña (reemplaza «Entrar como…») e invitaciones de verdad.
2. **Sincronización** en la capa de datos (`src/data/`): cola de cambios, subida por tandas, bajada por cursor, fotos y
   PDF al depósito. Las pantallas no cambian.
3. **Pasar lo cargado** desde la copia JSON.
4. **Fase 2 · vendedores y locales:** `tabaco_traer` filtra en el servidor lo de cada uno y **quita los costos**, y
   `tabaco_aplicar` revisa qué puede escribir cada rol. Lo que hoy calcula el teléfono con costos (por ejemplo el costo
   de lo vendido en una visita) pasa a calcularse en el servidor.
5. **Probar** con dos teléfonos a la vez y publicar.

## Pruebas hechas en el servidor

Con usuarios simulados y todo deshecho al final: alguien con sesión de otra app no ve ni escribe nada y no puede leer
las tablas directo; sin sesión, ninguna puerta responde; el vendedor queda afuera en la fase 1; Administración guarda y
lee; Dirección solo lee; la auditoría no se cambia ni se borra; una tanda con un error no deja nada a medias; lo no
confirmado no sale al traer; en el depósito, alguien de otra app no sube ni ve archivos y Administración sí.
