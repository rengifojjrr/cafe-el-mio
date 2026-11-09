// Un servidor de mentira para las pruebas: responde como el de verdad (Supabase con el esquema
// `tabaco`: tabaco_1, tabaco_2 y tabaco_3 de supabase/migrations) sin salir a internet. Lo usan
// las pruebas unitarias (en lugar de `fetch`) y las de punta a punta (con `page.route`).
// Las reglas que importan son las mismas: quién puede subir y bajar, todo-o-nada, la auditoría
// que solo se agrega, la bajada por tandas que no parte una transacción y el depósito privado.

export interface CuentaFalsa {
  rol: 'admin' | 'seller' | 'store' | 'direccion';
  usuario_app: string | null;
  tienda: string | null;
  nombre: string;
  activa: boolean;
}

interface UsuarioFalso {
  id: string;
  correo: string;
  clave: string;
  /** Cuenta creada por una invitación del programa (se le puede poner contraseña nueva). */
  programa: boolean;
  cuenta: CuentaFalsa | null;
}

interface Fila {
  tabla: string;
  id: string;
  datos: Record<string, unknown>;
  borrado: boolean;
  tx: number;
}

interface InvitacionFalsa {
  id: string;
  token: string;
  correo: string;
  nombre: string;
  rol: 'admin' | 'direccion';
  usuario_app: string | null;
  vence: number;
  usada: boolean;
  anulada: boolean;
}

export interface PedidoFalso {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | Uint8Array | null;
}

export interface RespuestaFalsa {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': '*',
};

function json(status: number, v: unknown): RespuestaFalsa {
  return { status, headers: { ...CORS, 'content-type': 'application/json' }, body: v === undefined ? '' : JSON.stringify(v) };
}

class NoSePuede extends Error {
  constructor(
    message: string,
    readonly code = '42501',
    readonly hint: string | null = null,
  ) {
    super(message);
  }
}

let contador = 0;
const nuevoId = (p: string) => `${p}-${++contador}-${Math.random().toString(36).slice(2, 8)}`;

export class ServidorFalso {
  usuarios = new Map<string, UsuarioFalso>();
  /** token de acceso → id de usuario */
  accesos = new Map<string, string>();
  /** token de renovación → id de usuario */
  renovaciones = new Map<string, string>();
  registros = new Map<string, Fila>();
  archivos = new Map<string, { tipo: string; bytes: Uint8Array }>();
  invitaciones: InvitacionFalsa[] = [];
  private tx = 1000;
  /** Sin señal: toda llamada falla como si no hubiera internet. */
  sinSenal = false;
  /** Lo que se llamó (método y ruta), para revisar en las pruebas. */
  llamadas: string[] = [];
  /** Tamaño máximo de los datos de un registro (el de verdad: 1 MB). */
  maxDatos = 1_000_000;

  agregarUsuario(correo: string, clave: string, cuenta: Omit<CuentaFalsa, 'activa'> | null, opts: { programa?: boolean } = {}): string {
    const id = nuevoId('usr');
    this.usuarios.set(correo.toLowerCase(), {
      id,
      correo: correo.toLowerCase(),
      clave,
      programa: opts.programa ?? false,
      cuenta: cuenta ? { ...cuenta, activa: true } : null,
    });
    return id;
  }

  usuarioPorId(id: string): UsuarioFalso | undefined {
    return [...this.usuarios.values()].find((u) => u.id === id);
  }

  /** Lo vivo del servidor: «tabla/id» → datos. */
  vivos(): Map<string, Record<string, unknown>> {
    const out = new Map<string, Record<string, unknown>>();
    for (const [k, f] of this.registros) if (!f.borrado) out.set(k, f.datos);
    return out;
  }

  /** Para las pruebas de punta a punta: un `fetch` que responde aquí. */
  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers as Record<string, string> | undefined) ?? {})) headers[k.toLowerCase()] = v;
    let body: string | Uint8Array | null = null;
    if (typeof init.body === 'string') body = init.body;
    else if (init.body instanceof Blob) body = new Uint8Array(await init.body.arrayBuffer());
    const r = await this.responder({ method: init.method ?? 'GET', url: input, headers, body });
    const payload = typeof r.body === 'string' ? r.body : r.body;
    return new Response(r.status === 204 ? null : (payload as BodyInit), { status: r.status, headers: r.headers });
  };

  async responder(p: PedidoFalso): Promise<RespuestaFalsa> {
    if (p.method === 'OPTIONS') return { status: 200, headers: CORS, body: '' };
    if (this.sinSenal) throw new Error('Sin señal');
    const url = new URL(p.url);
    this.llamadas.push(`${p.method} ${url.pathname}`);
    const texto = typeof p.body === 'string' ? p.body : '';
    try {
      if (url.pathname === '/auth/v1/token') return this.token(url.searchParams.get('grant_type'), texto ? (JSON.parse(texto) as Record<string, string>) : {});
      if (url.pathname === '/auth/v1/logout') {
        const t = (p.headers.authorization ?? '').replace(/^Bearer /, '');
        this.accesos.delete(t);
        return { status: 204, headers: CORS, body: '' };
      }
      const yo = this.quien(p.headers.authorization);
      if (yo === 'vencido') return json(401, { code: 'PGRST301', message: 'JWT expired', details: null, hint: null });
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const fn = url.pathname.slice('/rest/v1/rpc/'.length);
        const args = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
        const r = this.rpc(fn, args, yo);
        return r === undefined ? { status: 204, headers: CORS, body: '' } : json(200, r);
      }
      if (url.pathname.startsWith('/storage/v1/object/')) return this.deposito(p, url.pathname, yo);
      return json(404, { message: 'No existe' });
    } catch (e) {
      if (e instanceof NoSePuede) return json(e.code === '42501' ? (yo_es_anonimo(p) ? 401 : 403) : 400, { code: e.code, message: e.message, details: null, hint: e.hint });
      throw e;
    }
  }

  private token(grant: string | null, body: Record<string, string>): RespuestaFalsa {
    let usuario: UsuarioFalso | undefined;
    if (grant === 'password') {
      usuario = this.usuarios.get((body.email ?? '').toLowerCase());
      if (!usuario || usuario.clave !== body.password) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    } else if (grant === 'refresh_token') {
      const id = this.renovaciones.get(body.refresh_token ?? '');
      if (!id) return json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
      this.renovaciones.delete(body.refresh_token ?? '');
      usuario = this.usuarioPorId(id);
    }
    if (!usuario) return json(400, { msg: 'unsupported_grant_type' });
    const access = nuevoId('acc');
    const refresh = nuevoId('ref');
    this.accesos.set(access, usuario.id);
    this.renovaciones.set(refresh, usuario.id);
    return json(200, {
      access_token: access,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: refresh,
      user: { id: usuario.id, email: usuario.correo },
    });
  }

  /** Vence todos los tokens de acceso (como si hubiera pasado una hora). */
  vencerAccesos(): void {
    this.accesos.clear();
  }

  private quien(auth: string | undefined): UsuarioFalso | null | 'vencido' {
    const t = (auth ?? '').replace(/^Bearer /, '');
    if (!t) return null;
    const id = this.accesos.get(t);
    if (!id) return 'vencido';
    return this.usuarioPorId(id) ?? null;
  }

  private rol(yo: UsuarioFalso | null): CuentaFalsa['rol'] | null {
    return yo?.cuenta?.activa ? yo.cuenta.rol : null;
  }

  private rpc(fn: string, a: Record<string, unknown>, yo: UsuarioFalso | null): unknown {
    const anon = ['tabaco_invitacion_ver', 'tabaco_invitacion_aceptar'];
    if (!yo && !anon.includes(fn)) throw new NoSePuede(`permission denied for function ${fn}`);
    switch (fn) {
      case 'tabaco_soy': {
        const c = yo?.cuenta;
        return c?.activa ? { rol: c.rol, usuario_app: c.usuario_app, tienda: c.tienda, nombre: c.nombre } : null;
      }
      case 'tabaco_traer':
        return this.traer(yo, Number(a.p_desde ?? 0), Number(a.p_limite ?? 1000));
      case 'tabaco_aplicar':
        return this.aplicar(yo, a.p_cambios);
      case 'tabaco_invitar':
        return this.invitar(yo, a);
      case 'tabaco_invitacion_ver':
        return this.verInvitacion(String(a.p_token ?? ''));
      case 'tabaco_invitacion_aceptar':
        return this.aceptar(String(a.p_token ?? ''), String(a.p_clave ?? ''));
      case 'tabaco_invitacion_enlazar':
        return this.enlazar(yo!, String(a.p_token ?? ''));
      case 'tabaco_cuentas':
        return this.cuentas(yo);
      case 'tabaco_cuenta_activa': {
        if (this.rol(yo) !== 'admin') throw new NoSePuede('Solo Administración cambia los accesos.');
        const u = this.usuarioPorId(String(a.p_usuario));
        if (!u?.cuenta) throw new NoSePuede('Esa cuenta no existe.', '22023');
        if (u.id === yo!.id && !a.p_activa) throw new NoSePuede('No puedes quitarte el acceso a ti mismo.', '22023');
        u.cuenta.activa = !!a.p_activa;
        return undefined;
      }
      case 'tabaco_invitacion_anular': {
        if (this.rol(yo) !== 'admin') throw new NoSePuede('Solo Administración anula invitaciones.');
        const i = this.invitaciones.find((x) => x.id === a.p_id);
        if (i && !i.usada) i.anulada = true;
        return undefined;
      }
      default:
        throw new NoSePuede(`No existe la función ${fn}`, 'PGRST202');
    }
  }

  private traer(yo: UsuarioFalso | null, desde: number, limite: number) {
    const rol = this.rol(yo);
    if (!rol) throw new NoSePuede('No tienes cuenta en el programa de Tabaco');
    if (rol !== 'admin' && rol !== 'direccion') throw new NoSePuede('Por ahora el servidor del programa de Tabaco es solo para Administración y Dirección');
    const hasta = this.tx + 1;
    const filas = [...this.registros.values()].filter((f) => f.tx >= desde && f.tx < hasta).sort((x, y) => x.tx - y.tx || x.tabla.localeCompare(y.tabla) || x.id.localeCompare(y.id));
    let corte = hasta;
    if (filas.length > limite) {
      corte = filas[limite]!.tx;
      if (corte === filas[0]!.tx) corte = filas.find((f) => f.tx > corte)?.tx ?? hasta;
    }
    return {
      hasta: corte,
      mas: corte < hasta,
      registros: filas.filter((f) => f.tx < corte).map((f) => ({ tabla: f.tabla, id: f.id, datos: f.datos, borrado: f.borrado })),
    };
  }

  private aplicar(yo: UsuarioFalso | null, cambios: unknown): number {
    const rol = this.rol(yo);
    if (!rol) throw new NoSePuede('No tienes cuenta en el programa de Tabaco');
    if (rol !== 'admin') throw new NoSePuede('Por ahora solo Administración guarda en el servidor del programa de Tabaco');
    if (!Array.isArray(cambios)) throw new NoSePuede('Se esperaba una lista de cambios', 'P0001');
    if (cambios.length > 2000) throw new NoSePuede('Demasiados cambios juntos (máximo 2000)', 'P0001');
    // Todo o nada: primero se revisa todo.
    for (const c of cambios as Record<string, unknown>[]) {
      const tabla = String(c.tabla ?? '');
      if (!/^[A-Za-z]{2,40}$/.test(tabla)) throw new NoSePuede(`Tabla inválida: ${tabla}`, 'P0001');
      if (c.op === 'guardar') {
        if (typeof c.datos !== 'object' || c.datos === null || Array.isArray(c.datos)) throw new NoSePuede(`Datos inválidos en ${tabla}/${String(c.id)}`, 'P0001');
        if (JSON.stringify(c.datos).length > this.maxDatos) throw new NoSePuede(`Registro demasiado grande en ${tabla}/${String(c.id)} (las fotos y los PDF van al depósito, no aquí)`, 'P0001');
      } else if (c.op === 'borrar' || c.op === 'vaciar') {
        if (tabla === 'audit') throw new NoSePuede('La auditoría no se borra');
      } else throw new NoSePuede(`Operación inválida: ${String(c.op)}`, 'P0001');
    }
    const tx = ++this.tx;
    let n = 0;
    for (const c of cambios as { tabla: string; id: string; op: string; datos?: Record<string, unknown> }[]) {
      const k = `${c.tabla}/${c.id}`;
      if (c.op === 'guardar') {
        if (c.tabla === 'audit' && this.registros.has(k)) continue;
        this.registros.set(k, { tabla: c.tabla, id: c.id, datos: JSON.parse(JSON.stringify(c.datos)) as Record<string, unknown>, borrado: false, tx });
      } else if (c.op === 'borrar') {
        const f = this.registros.get(k);
        if (f && !f.borrado) this.registros.set(k, { ...f, datos: {}, borrado: true, tx });
      } else {
        for (const [kk, f] of this.registros) if (f.tabla === c.tabla && !f.borrado) this.registros.set(kk, { ...f, datos: {}, borrado: true, tx });
      }
      n += 1;
    }
    return n;
  }

  private invitar(yo: UsuarioFalso | null, a: Record<string, unknown>) {
    if (this.rol(yo) !== 'admin') throw new NoSePuede('Solo Administración invita al programa de Tabaco.');
    const correo = String(a.p_correo ?? '')
      .trim()
      .toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new NoSePuede('Ese correo no parece válido.', '22023');
    if (!String(a.p_nombre ?? '').trim()) throw new NoSePuede('Falta el nombre de la persona.', '22023');
    for (const i of this.invitaciones) if (i.correo === correo && !i.usada) i.anulada = true;
    const inv: InvitacionFalsa = {
      id: nuevoId('inv'),
      token: nuevoId('tok').replace(/-/g, '') + Math.random().toString(16).slice(2),
      correo,
      nombre: String(a.p_nombre).trim(),
      rol: a.p_rol === 'admin' ? 'admin' : 'direccion',
      usuario_app: (a.p_usuario_app as string | null) ?? null,
      vence: Date.now() + Number(a.p_dias ?? 7) * 86_400_000,
      usada: false,
      anulada: false,
    };
    this.invitaciones.push(inv);
    return { id: inv.id, token: inv.token, vence_en: new Date(inv.vence).toISOString() };
  }

  private estado(i: InvitacionFalsa): string {
    return i.anulada ? 'anulada' : i.usada ? 'usada' : i.vence < Date.now() ? 'vencida' : 'vigente';
  }

  private verInvitacion(token: string) {
    const i = this.invitaciones.find((x) => x.token === token);
    if (!i) return { estado: 'no_existe' };
    const u = this.usuarios.get(i.correo);
    return { estado: this.estado(i), nombre: i.nombre, rol: i.rol, correo: i.correo, vence_en: new Date(i.vence).toISOString(), cuenta: !u ? 'nueva' : u.programa ? 'tabaco' : 'otra' };
  }

  private darCuenta(u: UsuarioFalso, i: InvitacionFalsa): void {
    u.cuenta = { rol: i.rol, usuario_app: i.usuario_app ?? u.cuenta?.usuario_app ?? null, tienda: null, nombre: i.nombre, activa: true };
    i.usada = true;
  }

  private aceptar(token: string, clave: string) {
    const i = this.invitaciones.find((x) => x.token === token);
    if (!i || this.estado(i) !== 'vigente') throw new NoSePuede('Esa invitación ya no vale. Pide una nueva a Administración.');
    if (clave.length < 8) throw new NoSePuede('La contraseña necesita 8 caracteres por lo menos.', '22023');
    let u = this.usuarios.get(i.correo);
    if (!u) {
      this.agregarUsuario(i.correo, clave, null, { programa: true });
      u = this.usuarios.get(i.correo)!;
    } else if (u.programa) {
      u.clave = clave;
    } else throw new NoSePuede('Ya tienes una cuenta con ese correo: entra con tu contraseña de siempre.', '42501', 'cuenta_existente');
    this.darCuenta(u, i);
    return { correo: i.correo, rol: i.rol };
  }

  private enlazar(yo: UsuarioFalso, token: string) {
    const i = this.invitaciones.find((x) => x.token === token);
    if (!i || this.estado(i) !== 'vigente') throw new NoSePuede('Esa invitación ya no vale. Pide una nueva a Administración.');
    if (yo.correo !== i.correo) throw new NoSePuede(`Esta invitación es para ${i.correo}, no para la cuenta con la que entraste.`);
    this.darCuenta(yo, i);
    return { correo: i.correo, rol: i.rol };
  }

  private cuentas(yo: UsuarioFalso | null) {
    if (this.rol(yo) !== 'admin') throw new NoSePuede('Solo Administración ve las cuentas del programa de Tabaco.');
    return {
      cuentas: [...this.usuarios.values()]
        .filter((u) => u.cuenta)
        .map((u) => ({ usuario: u.id, nombre: u.cuenta!.nombre, rol: u.cuenta!.rol, correo: u.correo, activa: u.cuenta!.activa, usuario_app: u.cuenta!.usuario_app, yo: u.id === yo!.id, ultima_entrada: null })),
      invitaciones: this.invitaciones
        .filter((i) => !i.usada && !i.anulada)
        .map((i) => ({ id: i.id, nombre: i.nombre, correo: i.correo, rol: i.rol, creada_en: new Date().toISOString(), vence_en: new Date(i.vence).toISOString(), estado: this.estado(i) })),
    };
  }

  private deposito(p: PedidoFalso, path: string, yo: UsuarioFalso | null): RespuestaFalsa {
    const rol = this.rol(yo);
    const BUCKET = 'tabaco-archivos';
    if (p.method === 'GET' && path.startsWith(`/storage/v1/object/authenticated/${BUCKET}/`)) {
      if (rol !== 'admin' && rol !== 'direccion') return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      const ruta = decodeURIComponent(path.slice(`/storage/v1/object/authenticated/${BUCKET}/`.length));
      const f = this.archivos.get(ruta);
      if (!f) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      return { status: 200, headers: { ...CORS, 'content-type': f.tipo }, body: f.bytes };
    }
    if (rol !== 'admin') return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    if (p.method === 'POST' && path.startsWith(`/storage/v1/object/${BUCKET}/`)) {
      const ruta = decodeURIComponent(path.slice(`/storage/v1/object/${BUCKET}/`.length));
      const tipo = p.headers['content-type'] ?? 'application/octet-stream';
      if (!['image/webp', 'image/jpeg', 'image/png', 'image/svg+xml', 'application/pdf'].includes(tipo)) {
        return json(400, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${tipo} is not supported` });
      }
      const bytes = p.body instanceof Uint8Array ? p.body : new TextEncoder().encode(String(p.body ?? ''));
      if (bytes.length > 10 * 1024 * 1024) return json(400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      this.archivos.set(ruta, { tipo, bytes });
      return json(200, { Key: `${BUCKET}/${ruta}` });
    }
    if (p.method === 'DELETE' && path === `/storage/v1/object/${BUCKET}`) {
      const { prefixes } = JSON.parse(String(p.body ?? '{}')) as { prefixes?: string[] };
      for (const r of prefixes ?? []) this.archivos.delete(r);
      return json(200, []);
    }
    return json(404, { message: 'No existe' });
  }
}

function yo_es_anonimo(p: PedidoFalso): boolean {
  return !p.headers.authorization;
}
