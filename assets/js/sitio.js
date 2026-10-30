/* Café El Mío — interacciones del sitio.
   Sin dependencias. Lee el catálogo de catalogo.js, lo actualiza en vivo desde
   Shopify y manda el pago a la tienda (cafe-el-mio.myshopify.com) con un enlace
   de carrito. */
(() => {
  'use strict';

  const d = document;
  const raiz = d.documentElement;
  raiz.classList.add('js');

  const $ = (s, c = d) => c.querySelector(s);
  const $$ = (s, c = d) => Array.from(c.querySelectorAll(s));
  const CFG = window.ELMIO;
  const CATALOGO = window.CATALOGO || [];
  const BASE = raiz.dataset.base || '';
  const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esEscritorio = () => innerWidth > 860;

  const dinero = (n) => '$' + Number(n).toFixed(2);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const traducir = (t) => (CFG.opciones && CFG.opciones[t]) || t;
  const icono = (n) => `<svg aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const almacen = {
    leer(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
  };

  /* ---------- Catálogo ---------- */
  const porHandle = (h) => CATALOGO.find((p) => p.handle === h);
  function porVariante(id) {
    for (const p of CATALOGO) {
      const v = (p.variantes || []).find((x) => x.id === id);
      if (v) return [p, v];
    }
    return [null, null];
  }
  function varianteInicial(p) {
    const disp = p.variantes.filter((v) => v.disponible);
    const lista = disp.length ? disp : p.variantes;
    return lista.find((v) => v.opciones.includes('Espresso') && v.opciones.includes('12oz'))
      || lista.find((v) => v.opciones.includes('12oz'))
      || lista[0];
  }
  function rango(p) {
    const precios = (p.variantes || []).filter((v) => v.disponible).map((v) => v.precio);
    if (!precios.length) return null;
    return [Math.min(...precios), Math.max(...precios)];
  }
  const textoVariante = (v) => v.opciones.filter((o) => o !== 'Default Title').map(traducir).join(', ');
  const urlProducto = (p) => (p.slug ? `${BASE}cafes/${p.slug}.html` : `${CFG.tienda}/${CFG.idioma}/products/${p.handle}`);
  const urlImagen = (p, chica) => {
    const src = chica ? p.imagenChica : p.imagen;
    return /^https?:/.test(src) ? src : BASE + src;
  };
  const urlPago = (items) => `${CFG.tienda}/${CFG.idioma}/cart/` + items.map((i) => `${i.id}:${i.cantidad}`).join(',');

  function nuevoDesdeShopify(sp) {
    const texto = (sp.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const img = sp.images && sp.images[0] ? sp.images[0].src : '';
    const ancho = (w) => (img ? img + (img.includes('?') ? '&' : '?') + 'width=' + w : '');
    return {
      handle: sp.handle, nombre: sp.title, categoria: 'otros', etiqueta: 'Nuevo',
      corto: texto.length > 90 ? texto.slice(0, 88) + '…' : texto,
      imagen: ancho(900), imagenChica: ancho(480),
      tinte: '#e8cfa4', tinteTexto: '#22140d', nuevo: true
    };
  }

  async function sincronizar() {
    let datos = null;
    try {
      const c = JSON.parse(sessionStorage.getItem('elmio:shopify') || 'null');
      if (c && Date.now() - c.t < 10 * 60 * 1000) datos = c.d;
    } catch (e) { /* sin caché */ }
    if (!datos) {
      try {
        const r = await fetch(`${CFG.tienda}/products.json?limit=250`, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        datos = await r.json();
        try { sessionStorage.setItem('elmio:shopify', JSON.stringify({ t: Date.now(), d: datos })); } catch (e) { /* lleno */ }
      } catch (e) {
        return; // la tienda no respondió: seguimos con el catálogo incluido
      }
    }
    if (!datos || !Array.isArray(datos.products)) return;
    const vivos = new Set();
    for (const sp of datos.products) {
      vivos.add(sp.handle);
      let p = porHandle(sp.handle);
      if (!p) { p = nuevoDesdeShopify(sp); CATALOGO.push(p); }
      p.opciones = sp.options.map((o) => ({ nombre: o.name, valores: o.values }));
      p.variantes = sp.variants.map((v) => ({
        id: v.id,
        opciones: [v.option1, v.option2, v.option3].filter(Boolean),
        precio: parseFloat(v.price),
        antes: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
        disponible: v.available !== false
      }));
    }
    CATALOGO.forEach((p) => { p.retirado = !vivos.has(p.handle); });
    d.dispatchEvent(new CustomEvent('catalogo'));
  }

  function pintarPrecios() {
    $$('[data-precio]').forEach((el) => {
      const p = porHandle(el.dataset.precio);
      if (!p) return;
      const r = rango(p);
      if (!r) { el.textContent = 'Agotado'; return; }
      el.innerHTML = r[0] !== r[1] ? `<small>Desde</small> ${dinero(r[0])}` : dinero(r[0]);
    });
    $$('[data-por-unidad]').forEach((el) => {
      const caja = porHandle(el.dataset.porUnidad);
      const suelto = caja && porHandle(caja.base);
      const rc = caja && rango(caja), rs = suelto && rango(suelto);
      if (!rc || !rs || !caja.unidades) return;
      const ahorro = rs[0] * caja.unidades - rc[0];
      el.textContent = `Sale a ${dinero(rc[0] / caja.unidades)} el paquete` + (ahorro > 0.5 ? `: ahorras ${dinero(ahorro)}.` : '.');
    });
    $$('[data-tarjeta]').forEach((el) => {
      const p = porHandle(el.dataset.tarjeta);
      if (!p) return;
      el.toggleAttribute('data-retirado', !!p.retirado);
      const agotado = !rango(p);
      let marca = $('.tarjeta__agotado', el);
      if (agotado && !marca) el.insertAdjacentHTML('afterbegin', '<span class="tarjeta__agotado">Agotado</span>');
      if (!agotado && marca) marca.remove();
    });
  }

  function tarjetaHTML(p) {
    const r = rango(p);
    const precio = !r ? 'Agotado' : r[0] !== r[1] ? `<small>Desde</small> ${dinero(r[0])}` : dinero(r[0]);
    const externo = !p.slug;
    return `<a class="tarjeta" href="${esc(urlProducto(p))}"${externo ? ' target="_blank" rel="noopener"' : ''} style="--tinte:${esc(p.tinte)};--tinte-texto:${esc(p.tinteTexto)}" data-tarjeta="${esc(p.handle)}" data-categoria="${esc(p.categoria)}">
      <span class="tarjeta__etiqueta">${esc(p.etiqueta)}</span>
      <span class="tarjeta__foto">${p.imagen ? `<img src="${esc(urlImagen(p, true))}" alt="" loading="lazy" decoding="async" draggable="false">` : ''}</span>
      <span class="tarjeta__nombre">${esc(p.nombre)}</span>
      <span class="tarjeta__notas">${esc(p.corto)}</span>
      <span class="tarjeta__pie"><span class="tarjeta__precio" data-precio="${esc(p.handle)}">${precio}</span><span class="tarjeta__ir" aria-hidden="true">${icono('flecha')}</span></span>
    </a>`;
  }

  /* ---------- Bolsa ---------- */
  const CLAVE_BOLSA = 'elmio:bolsa';
  let bolsa = almacen.leer(CLAVE_BOLSA, []).filter((i) => i && i.id && i.cantidad > 0);
  let focoPrevio = null;

  const unidades = () => bolsa.reduce((a, i) => a + i.cantidad, 0);
  const guardarBolsa = () => almacen.guardar(CLAVE_BOLSA, bolsa);

  function agregar(id, cantidad = 1) {
    const it = bolsa.find((i) => i.id === id);
    if (it) it.cantidad = Math.min(99, it.cantidad + cantidad);
    else bolsa.push({ id, cantidad });
    guardarBolsa();
    pintarBolsa();
    $$('[data-cuenta]').forEach((el) => { el.classList.remove('salta'); void el.offsetWidth; el.classList.add('salta'); });
    const [p] = porVariante(id);
    avisar(`${p ? p.nombre : 'Café'} está en tu bolsa.`);
  }
  function cambiar(id, delta) {
    const it = bolsa.find((i) => i.id === id);
    if (!it) return;
    it.cantidad = Math.max(0, Math.min(99, it.cantidad + delta));
    if (!it.cantidad) bolsa = bolsa.filter((i) => i !== it);
    guardarBolsa();
    pintarBolsa();
  }
  function quitar(id) {
    bolsa = bolsa.filter((i) => i.id !== id);
    guardarBolsa();
    pintarBolsa();
  }

  function pintarBolsa() {
    const n = unidades();
    $$('[data-cuenta]').forEach((el) => { el.textContent = n; });
    $$('.boton-bolsa').forEach((el) => el.setAttribute('aria-label', `Abrir la bolsa, ${n} ${n === 1 ? 'producto' : 'productos'}`));
    const cuerpo = $('[data-bolsa-cuerpo]');
    if (!cuerpo) return;
    const pie = $('[data-bolsa-pie]');
    const validos = bolsa.map((i) => [i, ...porVariante(i.id)]).filter(([, p]) => p);
    if (!validos.length) {
      cuerpo.innerHTML = `<div class="bolsa__vacia"><strong>Tu bolsa está vacía</strong><p>Escoge un café y aquí lo verás antes de pagar.</p><a class="boton boton--ambar" href="${BASE}tienda.html">Ver los cafés</a></div>`;
      if (pie) pie.hidden = true;
      return;
    }
    if (pie) pie.hidden = false;
    let total = 0;
    cuerpo.innerHTML = '<ul class="lista-bolsa">' + validos.map(([i, p, v]) => {
      total += v.precio * i.cantidad;
      const variante = textoVariante(v);
      return `<li class="item-bolsa">
        <div class="item-bolsa__foto" style="background:${esc(p.tinte)}">${p.imagen ? `<img src="${esc(urlImagen(p, true))}" alt="">` : ''}</div>
        <div>
          <p class="item-bolsa__nombre">${esc(p.nombre)}</p>
          ${variante ? `<p class="item-bolsa__variante">${esc(variante)}</p>` : ''}
          ${v.disponible ? '' : '<p class="item-bolsa__variante">Agotado por ahora</p>'}
          <div class="cantidad" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
            <button type="button" data-menos="${v.id}" aria-label="Quitar uno">${icono('menos')}</button>
            <output aria-live="polite">${i.cantidad}</output>
            <button type="button" data-mas="${v.id}" aria-label="Agregar uno">${icono('mas')}</button>
          </div>
        </div>
        <div>
          <p class="item-bolsa__precio">${dinero(v.precio * i.cantidad)}</p>
          <button type="button" class="item-bolsa__quitar" data-quitar="${v.id}">Quitar</button>
        </div>
      </li>`;
    }).join('') + '</ul>';
    const t = $('[data-bolsa-total]');
    if (t) t.textContent = dinero(total);
  }

  function pagar() {
    const items = bolsa.filter((i) => { const [, v] = porVariante(i.id); return v && v.disponible; });
    if (!items.length) return;
    location.href = urlPago(items);
  }

  function abrirBolsa() {
    const b = $('[data-bolsa]');
    if (!b) return;
    cerrarMenu();
    focoPrevio = d.activeElement;
    b.removeAttribute('inert');
    b.classList.add('esta-abierta');
    $('[data-velo]').classList.add('esta-abierto');
    d.body.classList.add('bloqueado');
    $$('[data-abrir-bolsa]').forEach((x) => x.setAttribute('aria-expanded', 'true'));
    setTimeout(() => { const c = $('[data-cerrar-bolsa]', b); if (c) c.focus(); }, 60);
  }
  function cerrarBolsa() {
    const b = $('[data-bolsa]');
    if (!b || !b.classList.contains('esta-abierta')) return;
    b.classList.remove('esta-abierta');
    b.setAttribute('inert', '');
    $('[data-velo]').classList.remove('esta-abierto');
    d.body.classList.remove('bloqueado');
    $$('[data-abrir-bolsa]').forEach((x) => x.setAttribute('aria-expanded', 'false'));
    if (focoPrevio && focoPrevio.focus) focoPrevio.focus();
  }

  let temporizadorAviso;
  function avisar(texto) {
    const a = $('[data-aviso]');
    if (!a) return;
    a.innerHTML = `<span>${esc(texto)}</span><button type="button" data-abrir-bolsa>Ver bolsa</button>`;
    a.classList.add('es-visible');
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => a.classList.remove('es-visible'), 3600);
  }

  /* ---------- Menú móvil ---------- */
  let menuAbierto = false;
  function abrirMenu() {
    const m = $('[data-menu]');
    if (!m) return;
    menuAbierto = true;
    m.removeAttribute('inert');
    m.classList.add('esta-abierto');
    d.body.classList.add('bloqueado');
    $$('[data-abrir-menu]').forEach((b) => { b.setAttribute('aria-expanded', 'true'); b.setAttribute('aria-label', 'Cerrar menú'); });
    const cab = $('[data-cabecera]');
    if (cab) cab.classList.remove('esta-oculta');
  }
  function cerrarMenu() {
    const m = $('[data-menu]');
    if (!m || !menuAbierto) return;
    menuAbierto = false;
    m.classList.remove('esta-abierto');
    m.setAttribute('inert', '');
    if (!$('[data-bolsa].esta-abierta')) d.body.classList.remove('bloqueado');
    $$('[data-abrir-menu]').forEach((b) => { b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-label', 'Abrir menú'); });
  }

  /* ---------- Clics generales ---------- */
  d.addEventListener('click', (e) => {
    const t = e.target.closest('button, a, [data-velo]');
    if (!t) return;
    if (t.matches('[data-abrir-bolsa]')) { e.preventDefault(); abrirBolsa(); return; }
    if (t.matches('[data-cerrar-bolsa], [data-velo]')) { cerrarBolsa(); return; }
    if (t.matches('[data-abrir-menu]')) { menuAbierto ? cerrarMenu() : abrirMenu(); return; }
    if (t.matches('[data-menu] a')) { cerrarMenu(); return; }
    if (t.matches('[data-mas]')) { cambiar(+t.dataset.mas, 1); return; }
    if (t.matches('[data-menos]')) { cambiar(+t.dataset.menos, -1); return; }
    if (t.matches('[data-quitar]')) { quitar(+t.dataset.quitar); return; }
    if (t.matches('[data-pagar]')) { pagar(); return; }
    if (t.matches('[data-agregar]')) {
      e.preventDefault();
      const p = porHandle(t.dataset.agregar);
      if (!p) return;
      const v = varianteInicial(p);
      if (v && v.disponible) agregar(v.id, 1);
    }
  });

  d.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cerrarBolsa(); cerrarMenu(); }
    if (e.key === 'Tab') {
      const cont = $('[data-bolsa].esta-abierta') || (menuAbierto && $('[data-menu]'));
      if (!cont) return;
      const focos = $$('a[href], button:not([disabled]), input, select, textarea', cont).filter((x) => x.offsetParent !== null);
      if (menuAbierto) focos.unshift(...$$('[data-abrir-menu]'));
      if (!focos.length) return;
      const primero = focos[0], ultimo = focos[focos.length - 1];
      if (e.shiftKey && d.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && d.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    }
  });

  /* ---------- Ficha de producto ---------- */
  function iniciarFicha() {
    const f = $('[data-ficha]');
    if (!f) return;
    const handle = f.dataset.ficha;
    const contOpciones = $('[data-ficha-opciones]', f);
    const salidaCantidad = $('[data-ficha-cantidad]', f);
    const botonAgregar = $('[data-ficha-agregar]', f);
    const enlaceComprar = $('[data-ficha-comprar]', f);
    let cantidad = 1;
    let eleccion = null;

    function pintarOpciones() {
      const p = porHandle(handle);
      if (!p) return;
      if (!eleccion) eleccion = varianteInicial(p).opciones.slice();
      contOpciones.innerHTML = p.opciones.map((o, idx) => {
        if (o.valores.length < 2) return '';
        const elegido = eleccion[idx];
        return `<fieldset class="selector" data-opcion="${idx}">
          <legend>${esc(traducir(o.nombre))}<span data-elegido>${esc(traducir(elegido))}</span></legend>
          <div class="selector__opciones">${o.valores.map((val) => `
            <label class="opcion"><input type="radio" name="op${idx}" value="${esc(val)}"${val === elegido ? ' checked' : ''}><span>${esc(traducir(val))}</span></label>`).join('')}
          </div></fieldset>`;
      }).join('');
      actualizar();
    }

    function varianteActual(p) {
      return p.variantes.find((v) => v.opciones.every((o, i) => o === eleccion[i]));
    }

    function actualizar() {
      const p = porHandle(handle);
      if (!p) return;
      p.opciones.forEach((o, idx) => {
        const fs = $(`fieldset[data-opcion="${idx}"]`, contOpciones);
        if (!fs) { eleccion[idx] = o.valores[0]; return; }
        $$('input', fs).forEach((inp) => {
          const prueba = eleccion.slice();
          prueba[idx] = inp.value;
          const v = p.variantes.find((x) => x.opciones.every((op, i) => op === prueba[i]));
          inp.disabled = !v || !v.disponible;
        });
        const marca = $('[data-elegido]', fs);
        if (marca) marca.textContent = traducir(eleccion[idx]);
      });
      const v = varianteActual(p);
      const precio = $('[data-ficha-precio]', f);
      const antes = $('[data-ficha-antes]', f);
      const unidad = $('[data-ficha-unidad]', f);
      if (precio) precio.textContent = v ? dinero(v.precio * cantidad) : '—';
      if (antes) {
        const hay = v && v.antes && v.antes > v.precio;
        antes.hidden = !hay;
        if (hay) antes.textContent = dinero(v.antes * cantidad);
      }
      if (unidad) {
        let txt = cantidad > 1 && v ? `${dinero(v.precio)} cada uno` : '';
        if (p.unidades && v) {
          const base = porHandle(p.base);
          const rb = base && rango(base);
          const porPaquete = v.precio / p.unidades;
          txt = `Sale a ${dinero(porPaquete)} el paquete` + (rb && rb[0] * p.unidades - v.precio > .5 ? `: ahorras ${dinero(rb[0] * p.unidades - v.precio)} por caja.` : '.');
        }
        unidad.textContent = txt;
      }
      const ok = v && v.disponible;
      botonAgregar.disabled = !ok;
      botonAgregar.textContent = ok ? 'Agregar a la bolsa' : (v ? 'Agotado por ahora' : 'Combinación no disponible');
      if (enlaceComprar) {
        if (ok) { enlaceComprar.href = urlPago([{ id: v.id, cantidad }]); enlaceComprar.removeAttribute('aria-disabled'); }
        else { enlaceComprar.removeAttribute('href'); enlaceComprar.setAttribute('aria-disabled', 'true'); }
      }
      if (salidaCantidad) salidaCantidad.textContent = cantidad;
    }

    contOpciones.addEventListener('change', (e) => {
      const fs = e.target.closest('fieldset[data-opcion]');
      if (!fs) return;
      eleccion[+fs.dataset.opcion] = e.target.value;
      const p = porHandle(handle);
      // si la combinación no existe, busca la más parecida disponible
      if (!varianteActual(p) || !varianteActual(p).disponible) {
        const idx = +fs.dataset.opcion;
        const alterna = p.variantes.find((v) => v.disponible && v.opciones[idx] === e.target.value);
        if (alterna) { eleccion = alterna.opciones.slice(); pintarOpciones(); return; }
      }
      actualizar();
    });
    f.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cantidad]');
      if (!b) return;
      cantidad = Math.max(1, Math.min(99, cantidad + Number(b.dataset.cantidad)));
      actualizar();
    });
    $('[data-ficha-form]', f).addEventListener('submit', (e) => {
      e.preventDefault();
      const p = porHandle(handle);
      const v = p && varianteActual(p);
      if (v && v.disponible) agregar(v.id, cantidad);
    });
    d.addEventListener('catalogo', pintarOpciones);
    pintarOpciones();

    // Inclinación suave del empaque al mover el puntero
    const escenario = $('[data-inclinar]', f);
    if (escenario && !sinMovimiento && matchMedia('(pointer: fine)').matches) {
      escenario.addEventListener('pointermove', (e) => {
        const r = escenario.getBoundingClientRect();
        escenario.style.setProperty('--gx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
        escenario.style.setProperty('--gy', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
      });
      escenario.addEventListener('pointerleave', () => { escenario.style.setProperty('--gx', 0); escenario.style.setProperty('--gy', 0); });
    }
  }

  /* ---------- Tienda: filtros y productos nuevos ---------- */
  function iniciarTienda() {
    const rejilla = $('[data-rejilla]');
    if (!rejilla) return;
    const botones = $$('[data-filtro]');
    let actual = 'todos';
    function contar() {
      botones.forEach((b) => {
        const c = $('.filtro__cuenta', b);
        if (!c) return;
        const n = $$('.tarjeta:not([data-retirado])', rejilla).filter((t) => b.dataset.filtro === 'todos' || t.dataset.categoria === b.dataset.filtro).length;
        c.textContent = n;
        b.hidden = n === 0 && b.dataset.filtro !== 'todos';
      });
    }
    function aplicar(cat) {
      actual = cat;
      botones.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filtro === cat)));
      $$('.tarjeta', rejilla).forEach((t) => { t.hidden = cat !== 'todos' && t.dataset.categoria !== cat; });
    }
    botones.forEach((b) => b.addEventListener('click', () => {
      aplicar(b.dataset.filtro);
      history.replaceState(null, '', b.dataset.filtro === 'todos' ? location.pathname : '#' + b.dataset.filtro);
    }));
    const inicial = decodeURIComponent(location.hash.slice(1));
    aplicar(botones.some((b) => b.dataset.filtro === inicial) ? inicial : 'todos');
    d.addEventListener('catalogo', () => {
      CATALOGO.filter((p) => p.nuevo && !rejilla.querySelector(`[data-tarjeta="${CSS.escape(p.handle)}"]`))
        .forEach((p) => rejilla.insertAdjacentHTML('beforeend', tarjetaHTML(p)));
      pintarPrecios();
      contar();
      aplicar(actual);
    });
    contar();
  }

  /* ---------- Carril arrastrable ---------- */
  function iniciarCarriles() {
    $$('[data-carril]').forEach((c) => {
      const sec = c.closest('section') || d;
      const ant = $('[data-carril-anterior]', sec);
      const sig = $('[data-carril-siguiente]', sec);
      const barra = $('[data-carril-progreso]', sec);
      const paso = () => {
        const t = $('.tarjeta', c);
        const w = t ? t.getBoundingClientRect().width + 20 : 320;
        return w * Math.max(1, Math.floor(c.clientWidth / w) - 1);
      };
      if (ant) ant.addEventListener('click', () => c.scrollBy({ left: -paso(), behavior: sinMovimiento ? 'auto' : 'smooth' }));
      if (sig) sig.addEventListener('click', () => c.scrollBy({ left: paso(), behavior: sinMovimiento ? 'auto' : 'smooth' }));
      const progreso = () => {
        const max = c.scrollWidth - c.clientWidth;
        const r = max > 0 ? c.scrollLeft / max : 1;
        const visible = c.scrollWidth ? c.clientWidth / c.scrollWidth : 1;
        if (barra) barra.style.setProperty('--avance', Math.min(1, visible + (1 - visible) * r).toFixed(3));
        if (ant) ant.disabled = c.scrollLeft < 4;
        if (sig) sig.disabled = c.scrollLeft > max - 4;
      };
      c.addEventListener('scroll', progreso, { passive: true });
      addEventListener('resize', progreso);
      progreso();

      let activo = false, movio = false, x0 = 0, s0 = 0;
      c.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        activo = true; movio = false; x0 = e.clientX; s0 = c.scrollLeft;
      });
      addEventListener('pointermove', (e) => {
        if (!activo) return;
        const dx = e.clientX - x0;
        if (!movio && Math.abs(dx) > 6) { movio = true; c.classList.add('arrastrando'); }
        if (movio) c.scrollLeft = s0 - dx;
      });
      addEventListener('pointerup', () => {
        if (!activo) return;
        activo = false;
        c.classList.remove('arrastrando');
      });
      c.addEventListener('click', (e) => { if (movio) { e.preventDefault(); e.stopPropagation(); movio = false; } }, true);
      c.addEventListener('dragstart', (e) => e.preventDefault());
    });
  }

  /* ---------- Videos: cargan y suenan solo cuando se ven ---------- */
  const videosVisibles = new Set();
  function puedeSonar(v) {
    const paso = v.closest('.paso');
    return !paso || !esEscritorio() || paso.classList.contains('es-activo');
  }
  function cargarVideo(v) {
    if (v.dataset.cargado) return;
    const chico = v.dataset.srcChico && innerWidth < 800;
    v.src = chico ? v.dataset.srcChico : v.dataset.src;
    v.dataset.cargado = '1';
  }
  function iniciarVideos() {
    const vids = $$('video[data-video]');
    if (!vids.length) return;
    const ahorro = navigator.connection && navigator.connection.saveData;
    if (sinMovimiento || ahorro || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entradas) => entradas.forEach((e) => {
      const v = e.target;
      if (e.isIntersecting) {
        videosVisibles.add(v);
        cargarVideo(v);
        if (puedeSonar(v)) v.play().catch(() => {});
      } else {
        videosVisibles.delete(v);
        v.pause();
      }
    }), { rootMargin: '200px 0px' });
    vids.forEach((v) => {
      v.muted = true;
      v.addEventListener('playing', () => v.classList.add('suena'), { once: true });
      io.observe(v);
    });
  }

  /* ---------- Ritual: un paso por tramo de scroll ---------- */
  let ritual = null, pasos = [], barras = [], pasoActual = -1;
  function activarPaso(i) {
    if (i === pasoActual) return;
    pasoActual = i;
    pasos.forEach((p, k) => {
      p.classList.toggle('es-activo', k === i);
      p.setAttribute('aria-hidden', String(k !== i));
      const v = $('video', p);
      if (!v) return;
      if (k === i && videosVisibles.has(v)) { cargarVideo(v); v.play().catch(() => {}); }
      else if (k !== i) v.pause();
    });
  }
  function medirRitual() {
    if (!ritual) return;
    if (!esEscritorio() || sinMovimiento) {
      if (pasoActual !== -2) { pasos.forEach((p) => { p.classList.add('es-activo'); p.removeAttribute('aria-hidden'); }); pasoActual = -2; }
      return;
    }
    if (pasoActual === -2) pasoActual = -1;
    const r = ritual.getBoundingClientRect();
    const total = ritual.offsetHeight - innerHeight;
    const avance = Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
    const n = pasos.length;
    activarPaso(Math.min(n - 1, Math.floor(avance * n)));
    barras.forEach((b, k) => b.style.setProperty('--llenado', Math.min(1, Math.max(0, avance * n - k)).toFixed(3)));
  }

  /* ---------- Scroll: cabecera, paralaje y ritual ---------- */
  function iniciarScroll() {
    const escenas = $$('[data-scroll]');
    const cab = $('[data-cabecera]');
    ritual = $('[data-ritual]');
    if (ritual) {
      pasos = $$('[data-paso]', ritual);
      barras = $$('.ritual__progreso span', ritual);
    }
    let ultimoY = scrollY, pendiente = false;
    function cuadro() {
      pendiente = false;
      const vh = innerHeight, y = scrollY;
      if (!sinMovimiento) {
        for (const el of escenas) {
          const r = el.getBoundingClientRect();
          if (r.bottom < -200 || r.top > vh + 200) continue;
          const p = (vh - r.top) / (vh + r.height);
          el.style.setProperty('--p', Math.min(1, Math.max(0, p)).toFixed(4));
        }
      }
      if (cab) {
        cab.classList.toggle('es-solida', y > 30);
        if (!menuAbierto) {
          if (y > ultimoY + 6 && y > 520) cab.classList.add('esta-oculta');
          else if (y < ultimoY - 6 || y < 200) cab.classList.remove('esta-oculta');
        }
      }
      ultimoY = y;
      medirRitual();
    }
    addEventListener('scroll', () => { if (!pendiente) { pendiente = true; requestAnimationFrame(cuadro); } }, { passive: true });
    addEventListener('resize', cuadro);
    cuadro();
  }

  /* ---------- Revelado de ventanitas ---------- */
  function iniciarRevelado() {
    const els = $$('[data-revelar]');
    if (!els.length) return;
    if (sinMovimiento || !('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('es-visible')); return; }
    const io = new IntersectionObserver((entradas) => entradas.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('es-visible'); io.unobserve(e.target); }
    }), { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
    els.forEach((el) => io.observe(el));
  }

  /* ---------- Reloj de las 3:05 (hora de Miami) ---------- */
  function iniciarReloj() {
    const mensajes = $$('[data-reloj-mensaje]');
    if (!mensajes.length || typeof Intl === 'undefined') return;
    let hora, partes;
    try {
      hora = new Intl.DateTimeFormat('es-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
      partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    } catch (e) { return; }
    function tic() {
      const ahora = new Date();
      const p = partes.formatToParts(ahora);
      const h = +p.find((x) => x.type === 'hour').value % 24;
      const m = +p.find((x) => x.type === 'minute').value;
      const min = h * 60 + m, meta = 15 * 60 + 5;
      let texto;
      if (min >= meta && min < meta + 25) {
        texto = 'Son las 3:05 en Miami. ¡A colar!';
      } else {
        let falta = meta - min;
        if (falta <= 0) falta += 1440;
        const hh = Math.floor(falta / 60), mm = falta % 60;
        const cuanto = (hh ? `${hh} h ` : '') + `${mm} min`;
        texto = `En Miami son las ${hora.format(ahora)} y faltan ${cuanto} para el cafecito de las 3:05.`;
      }
      mensajes.forEach((el) => { el.textContent = texto; });
    }
    tic();
    setInterval(tic, 20000);
  }

  /* ---------- Contacto: arma el correo ---------- */
  function iniciarFormulario() {
    const f = $('[data-formulario]');
    if (!f) return;
    const error = $('[data-formulario-error]', f);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const datos = new FormData(f);
      const val = (k) => String(datos.get(k) || '').trim();
      const nombre = val('nombre'), correo = val('correo'), telefono = val('telefono'), motivo = val('motivo'), mensaje = val('mensaje');
      if (!nombre || !mensaje) {
        error.textContent = !nombre ? 'Escribe tu nombre para saber a quién responder.' : 'Escribe tu mensaje antes de enviarlo.';
        (!nombre ? f.elements.nombre : f.elements.mensaje).focus();
        return;
      }
      error.textContent = '';
      const firma = [nombre, correo, telefono].filter(Boolean).join('\n');
      const asunto = `${motivo || 'Mensaje'} de ${nombre}`;
      location.href = `mailto:${CFG.contacto.correo}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(mensaje + '\n\n' + firma)}`;
      const nota = $('[data-formulario-nota]', f);
      if (nota) nota.textContent = 'Se abrió tu aplicación de correo con el mensaje listo. Solo falta darle a enviar.';
    });
  }

  /* ---------- Arranque ---------- */
  function iniciar() {
    $$('[data-anio]').forEach((el) => { el.textContent = new Date().getFullYear(); });
    const b = $('[data-bolsa]');
    if (b) b.setAttribute('inert', '');
    const m = $('[data-menu]');
    if (m) m.setAttribute('inert', '');
    pintarBolsa();
    pintarPrecios();
    iniciarFicha();
    iniciarTienda();
    iniciarCarriles();
    iniciarVideos();
    iniciarScroll();
    iniciarRevelado();
    iniciarReloj();
    iniciarFormulario();
    d.addEventListener('catalogo', () => { pintarPrecios(); pintarBolsa(); });
    sincronizar();
    addEventListener('storage', (e) => { if (e.key === CLAVE_BOLSA) { bolsa = almacen.leer(CLAVE_BOLSA, []); pintarBolsa(); } });
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
