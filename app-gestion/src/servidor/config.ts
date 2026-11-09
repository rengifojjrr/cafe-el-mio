// El servidor del programa de Tabaco: el único lugar de la app donde está su dirección.
//
// Hoy vive en un proyecto de Supabase que se comparte con otras apps (todo lo del tabaco va en su
// esquema `tabaco`, ver docs/SUPABASE.md). Para mudarlo a su propio proyecto se cambian estas
// líneas, se compila y se publica; cada teléfono se vuelve a conectar solo (docs/MUDANZA.md).
//
// La llave es la pública del proyecto («publishable»): va dentro de toda app web que usa el
// servidor y no abre nada por sí sola. Lo que protege los datos son las cuentas y las funciones
// del esquema `tabaco`. La llave secreta del proyecto NUNCA va aquí.
export const SERVIDOR = {
  url: 'https://vajbsfgojtunamhrzrpf.supabase.co',
  llave: 'sb_publishable_Xljd7Ep1GxBXSPp5F4A1hg_Qg-iESzl',
  /** Depósito privado de fotos y PDF del programa. */
  deposito: 'tabaco-archivos',
} as const;
