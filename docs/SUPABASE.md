# Plan para pasar a servidor (Supabase)

**No está construido.** Es el plan para que varios usuarios compartan datos y para que los permisos sean seguros de
verdad. Nada de esto requiere rehacer pantallas: solo cambia la implementación de `src/data/repo.ts`.

## 1. Cambiar `local` por `supabase` con una variable

- `VITE_DATA_BACKEND=local` (hoy) o `supabase`. `src/data/index.ts` elige la implementación.
- Crear `src/data/supabase/` con un adaptador por tabla que cumpla la interfaz `Table<T>` (`get`, `all`, `where`,
  `put`, `bulkPut`, `remove`, `count`) y `AppendOnlyLog` para la auditoría, usando `@supabase/supabase-js` con la
  clave pública (`anon`). Nada secreto va al navegador.
- `transaction()` pasa a ser una función RPC de Postgres por caso de uso (por ejemplo `entregar_consignacion`), para
  que el libro de movimientos se escriba todo o nada en el servidor.

## 2. Esquema

- Un esquema por línea (`tabaco`, `cafe`) con las mismas tablas de `MODELO.md`, o un solo esquema con columna `line`
  en cada tabla y la línea en la RLS. Recomendado: **un esquema por línea**, igual que hoy (dos bases separadas).
- `core.accounts` (usuario de Supabase Auth → rol, línea, `store_id`) reemplaza a «Entrar como…».
- `movements` con restricción: una función/trigger que recalcula el saldo del lugar y rechaza si queda negativo.
- `audit` sin `UPDATE` ni `DELETE` para nadie (`REVOKE` + RLS).

## 3. RLS por rol y por línea

| Tabla | Administración | Vendedor | Local |
|---|---|---|---|
| `products` (sin `cost`) | todo | lectura | lectura |
| `products.cost`, `lots.unit_cost` | todo | sin acceso (vista sin costo) | sin acceso |
| `stores` | todo | `seller_id = auth.uid()` | `id = account.store_id` |
| `movements`, `sales_reports`, `settlements`, `payments` | todo | de sus locales | de su local |
| `commissions`, `payouts` | todo | `seller_id = auth.uid()` | sin acceso |
| `threads`, `messages` | todo | si participa | si participa |
| `users`, `settings`, `audit` | todo | solo su fila de `users` | solo su fila |

Cada política agrega la condición de línea: `account.line = 'tabaco'` en el esquema `tabaco`, etc. Dirección lee
vistas agregadas (`direccion.resumen_linea`) sin acceso a filas.

## 4. Archivos y fotos

- Supabase Storage: `tabaco/` y `cafe/`, con políticas iguales a las de su tabla dueña. Se siguen comprimiendo a
  WebP en el navegador antes de subir.

## 5. Migración de la demo

1. Exportar el JSON desde la portada.
2. Script de carga (Node) que lee el JSON y lo inserta por línea con la clave de servicio (solo en la máquina de
   quien migra, nunca en el repositorio).
3. Cambiar `VITE_DATA_BACKEND` y publicar.
