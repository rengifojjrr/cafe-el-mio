#!/usr/bin/env python3
"""Genera las páginas HTML de Café El Mío.

Cabecera, menú, bolsa y pie se escriben aquí una sola vez y se repiten
idénticos en todas las páginas. Los productos salen de assets/js/catalogo.js.

Uso:  python3 fuente/construir.py
"""
import html
import json
import math
import os
import re
import struct
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITIO_URL = 'https://rengifojjrr.github.io/cafe-el-mio/'
VERSION = time.strftime('%Y%m%d%H%M')
TIENDA = 'https://cafe-el-mio.myshopify.com'

e = html.escape


# ---------------------------------------------------------------------------
# Datos
# ---------------------------------------------------------------------------
def leer_catalogo():
    js = open(os.path.join(RAIZ, 'assets/js/catalogo.js'), encoding='utf-8').read()
    cuerpo = js.split('window.CATALOGO = ', 1)[1].rstrip().rstrip(';')
    return json.loads(cuerpo)


CATALOGO = leer_catalogo()
POR_HANDLE = {p['handle']: p for p in CATALOGO}
CATEGORIAS = [('espresso', 'Espresso cubano'), ('origen', 'Cafés de origen'), ('muestras', 'Muestras'), ('te', 'Té')]
NOMBRE_CATEGORIA = dict(CATEGORIAS)
OPCIONES = {
    'Grind': 'Molido', 'Size': 'Tamaño', 'Title': 'Presentación',
    'Coarse': 'Grueso', 'Espresso': 'Espresso (fino)', 'Standard': 'Medio', 'Whole Bean': 'En grano', 'Loose leaf': 'Hoja suelta',
    '12oz': '12 oz', '1 LB': '1 lb', '2 LB': '2 lb', '5 LB': '5 lb', '12 LB': '12 lb', '1oz': '1 oz',
    '12 Pack': '12 cápsulas', '6-count 2oz sample packs': '6 sobres de 2 oz', 'Default Title': 'Única',
}
CREDITOS = json.load(open(os.path.join(RAIZ, 'fuente/creditos-fotos.json'), encoding='utf-8'))


def medidas_webp(ruta):
    """Ancho y alto de un .webp sin dependencias."""
    with open(ruta, 'rb') as f:
        b = f.read(40)
    chunk = b[12:16]
    if chunk == b'VP8X':
        w = 1 + int.from_bytes(b[24:27], 'little')
        h = 1 + int.from_bytes(b[27:30], 'little')
    elif chunk == b'VP8L':
        b0, b1, b2, b3 = b[21:25]
        w = 1 + (((b1 & 0x3F) << 8) | b0)
        h = 1 + (((b3 & 0xF) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6))
    else:
        w, h = struct.unpack('<HH', b[26:30])
        w &= 0x3FFF
        h &= 0x3FFF
    return w, h


def dims(rel):
    return medidas_webp(os.path.join(RAIZ, rel))


def rango(p):
    precios = [v['precio'] for v in p['variantes'] if v['disponible']]
    return (min(precios), max(precios)) if precios else None


def precio_html(p):
    r = rango(p)
    if not r:
        return 'Agotado'
    if r[0] != r[1]:
        return '<small>Desde</small> ${:.2f}'.format(r[0])
    return '${:.2f}'.format(r[0])


def variante_inicial(p):
    disp = [v for v in p['variantes'] if v['disponible']] or p['variantes']
    for v in disp:
        if 'Espresso' in v['opciones'] and '12oz' in v['opciones']:
            return v
    for v in disp:
        if '12oz' in v['opciones']:
            return v
    return disp[0]


# ---------------------------------------------------------------------------
# Piezas comunes
# ---------------------------------------------------------------------------
SPRITE = '''<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <defs>
    <symbol id="i-bolsa" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 8h13l-1 12.5h-11L5.5 8z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/></symbol>
    <symbol id="i-flecha" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
    <symbol id="i-flecha-izq" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></symbol>
    <symbol id="i-mas" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></symbol>
    <symbol id="i-menos" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14"/></symbol>
    <symbol id="i-cerrar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></symbol>
    <symbol id="i-instagram" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.9"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none"/></symbol>
    <symbol id="i-facebook" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M14.5 21v-7.2h2.6l.5-3.1h-3.1V8.8c0-.9.4-1.6 1.7-1.6h1.5V4.5c-.6-.1-1.6-.2-2.6-.2-2.6 0-4.2 1.5-4.2 4.3v2.1H8.2v3.1h2.7V21"/></symbol>
    <symbol id="i-telefono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M6.2 3.8h3.1l1.6 4.3-2 1.3a10.7 10.7 0 0 0 5.7 5.7l1.3-2 4.3 1.6v3.1c0 1.2-1 2.2-2.2 2.1C10.6 19.4 4.6 13.4 4.1 6 4 4.8 5 3.8 6.2 3.8z"/></symbol>
    <symbol id="i-correo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4 7.5l8 5.5 8-5.5"/></symbol>
    <symbol id="i-ubicacion" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 21s-6.8-6-6.8-11.3a6.8 6.8 0 0 1 13.6 0C18.8 15 12 21 12 21z"/><circle cx="12" cy="9.7" r="2.4"/></symbol>
    <symbol id="i-camion" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 6.5h10.5v9.5H3zM13.5 9.5h4l3 3.2v3.3h-7"/><circle cx="7" cy="17.6" r="1.7"/><circle cx="17" cy="17.6" r="1.7"/></symbol>
    <symbol id="i-candado" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/></symbol>
    <symbol id="i-taza" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 9.5h11.5v4.3a5 5 0 0 1-5 5H9.5a5 5 0 0 1-5-5V9.5z"/><path d="M16 10.5h1.4a2.4 2.4 0 0 1 0 4.8H16"/><path d="M8.3 3.5c-.9 1.1.9 1.9 0 3.3M12 3.5c-.9 1.1.9 1.9 0 3.3"/></symbol>
    <symbol id="i-grano" viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="7.1" ry="10.4" transform="rotate(32 12 12)" fill="currentColor"/><path d="M16.4 4.6c-4.3 4-0.8 8.9-8.8 14.8" fill="none" style="stroke:var(--grano-linea, #f7b11b)" stroke-width="1.7" stroke-linecap="round"/></symbol>
  </defs>
</svg>'''


def icono(nombre):
    return '<svg aria-hidden="true"><use href="#i-{}"/></svg>'.format(nombre)


NAV = [
    ('tienda', 'tienda.html', 'Cafés'),
    ('ritual', 'index.html#ritual', 'El ritual'),
    ('historia', 'historia.html', 'Historia'),
    ('preparacion', 'preparacion.html', 'Cómo prepararlo'),
    ('contacto', 'contacto.html', 'Contacto'),
]


def cabecera(B, actual):
    enlaces = ''.join(
        '<a href="{}{}"{}>{}</a>'.format(B, url, ' aria-current="page"' if clave == actual else '', texto)
        for clave, url, texto in NAV)
    return f'''<header class="cabecera" data-cabecera>
  <div class="contenedor cabecera__fila">
    <a class="cabecera__marca" href="{B}index.html"><img src="{B}assets/img/marca/logo-el-mio.png" width="501" height="96" alt="Café El Mío, inicio"></a>
    <nav class="cabecera__nav" aria-label="Principal">{enlaces}</nav>
    <div class="cabecera__acciones">
      <button class="boton-bolsa" type="button" data-abrir-bolsa aria-controls="bolsa" aria-expanded="false" aria-label="Abrir la bolsa, 0 productos">{icono('bolsa')}<span class="boton-bolsa__texto" aria-hidden="true">Bolsa</span><span class="boton-bolsa__cuenta" data-cuenta aria-hidden="true">0</span></button>
      <button class="boton-menu" type="button" data-abrir-menu aria-controls="menu-movil" aria-expanded="false" aria-label="Abrir menú"><span></span><span></span></button>
    </div>
  </div>
</header>
<div class="menu-movil" id="menu-movil" data-menu>
  <ul class="menu-movil__lista">
    <li><a href="{B}index.html"{' aria-current="page"' if actual == 'inicio' else ''}>Inicio</a></li>
    {''.join('<li><a href="{}{}"{}>{}</a></li>'.format(B, url, ' aria-current="page"' if clave == actual else '', texto) for clave, url, texto in NAV)}
  </ul>
  <div class="menu-movil__pie">
    <a href="tel:+13052606647">(305) 260-6647</a>
    <a href="mailto:info@cafeelmio.com">info@cafeelmio.com</a>
    <a href="https://www.instagram.com/cafeelmio" target="_blank" rel="noopener">@cafeelmio</a>
  </div>
</div>'''


def bolsa_html(B):
    return f'''<div class="velo" data-velo></div>
<aside class="bolsa" id="bolsa" data-bolsa aria-label="Tu bolsa" role="dialog" aria-modal="true">
  <div class="bolsa__cabeza">
    <h2 class="bolsa__titulo">Tu bolsa</h2>
    <button class="redondo" type="button" data-cerrar-bolsa aria-label="Cerrar la bolsa">{icono('cerrar')}</button>
  </div>
  <div class="bolsa__cuerpo" data-bolsa-cuerpo></div>
  <div class="bolsa__pie" data-bolsa-pie hidden>
    <p class="bolsa__total"><span>Subtotal</span><strong data-bolsa-total>$0.00</strong></p>
    <button class="boton boton--ambar boton--ancho" type="button" data-pagar>{icono('candado')}Pagar en la tienda segura</button>
    <p class="bolsa__nota">Pasarás a la tienda de Café El Mío en Shopify con tu bolsa lista. El envío y los impuestos se calculan allí, según tu dirección.</p>
  </div>
</aside>
<div class="aviso" role="status" aria-live="polite" data-aviso></div>'''


def pie(B):
    return f'''<footer class="pie">
  <div class="contenedor pie__grid">
    <div class="pie__marca">
      <img src="{B}assets/img/marca/logo-el-mio.png" width="501" height="96" alt="Café El Mío" loading="lazy">
      <p class="pie__lema">Auténtico como el de mi tierra.</p>
      <div class="pie__redes">
        <a class="redondo" href="https://www.instagram.com/cafeelmio" target="_blank" rel="noopener" aria-label="Instagram de Café El Mío">{icono('instagram')}</a>
        <a class="redondo" href="https://www.facebook.com/cafeelmio" target="_blank" rel="noopener" aria-label="Facebook de Café El Mío">{icono('facebook')}</a>
      </div>
    </div>
    <nav class="pie__col" aria-label="Tienda">
      <h2>Tienda</h2>
      <ul>
        <li><a href="{B}tienda.html">Todos los cafés</a></li>
        <li><a href="{B}cafes/el-mio.html">Café Espresso El Mío</a></li>
        <li><a href="{B}cafes/el-mio-caja-24.html">Caja de 24</a></li>
        <li><a href="{B}tienda.html#origen">Cafés de origen</a></li>
        <li><a href="{B}tienda.html#muestras">Muestras</a></li>
      </ul>
    </nav>
    <nav class="pie__col" aria-label="Conoce">
      <h2>Conoce</h2>
      <ul>
        <li><a href="{B}historia.html">Nuestra historia</a></li>
        <li><a href="{B}index.html#ritual">El ritual del cafecito</a></li>
        <li><a href="{B}preparacion.html">Cómo prepararlo</a></li>
        <li><a href="{B}contacto.html">Preguntas frecuentes</a></li>
      </ul>
    </nav>
    <div class="pie__col">
      <h2>Hablemos</h2>
      <ul>
        <li><a href="tel:+13052606647">(305) 260-6647</a></li>
        <li><a href="mailto:info@cafeelmio.com">info@cafeelmio.com</a></li>
        <li>Miami, Florida</li>
      </ul>
    </div>
  </div>
  <div class="contenedor pie__legal">
    <p>© <span data-anio>2026</span> Café El Mío, LLC. Tostado y empacado en Miami.</p>
    <ul>
      <li><a href="{TIENDA}/es/policies/refund-policy" target="_blank" rel="noopener">Devoluciones</a></li>
      <li><a href="{TIENDA}/es/policies/privacy-policy" target="_blank" rel="noopener">Privacidad</a></li>
      <li><a href="{TIENDA}/es/policies/terms-of-service" target="_blank" rel="noopener">Términos</a></li>
      <li><a href="{B}creditos.html">Créditos de fotos</a></li>
    </ul>
  </div>
</footer>'''


def pagina(nombre, titulo, descripcion, cuerpo, actual='', B='', imagen_og='assets/img/marca/compartir.jpg', base_href=None):
    titulo_completo = titulo if 'Café El Mío' in titulo else titulo + ' | Café El Mío'
    base_tag = '<base href="{}">\n'.format(base_href) if base_href else ''
    doc = f'''<!doctype html>
<html lang="es" data-base="{B}">
<head>
<meta charset="utf-8">
{base_tag}<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(titulo_completo)}</title>
<meta name="description" content="{e(descripcion)}">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#1f130c">
<link rel="icon" href="{B}assets/img/marca/favicon.svg" type="image/svg+xml">
<link rel="icon" href="{B}assets/img/marca/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="{B}assets/img/marca/icono-180.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Café El Mío">
<meta property="og:title" content="{e(titulo_completo)}">
<meta property="og:description" content="{e(descripcion)}">
<meta property="og:image" content="{SITIO_URL}{imagen_og}">
<meta property="og:locale" content="es_US">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="{B}assets/fonts/bodoni-moda.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="{B}assets/fonts/figtree.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preconnect" href="{TIENDA}" crossorigin>
<link rel="stylesheet" href="{B}assets/css/estilos.css?v={VERSION}">
<script src="{B}assets/js/catalogo.js?v={VERSION}" defer></script>
<script src="{B}assets/js/sitio.js?v={VERSION}" defer></script>
</head>
<body>
{SPRITE}
<a class="saltar" href="#contenido">Saltar al contenido</a>
{cabecera(B, actual)}
<main id="contenido">
{cuerpo}
</main>
{pie(B)}
{bolsa_html(B)}
</body>
</html>
'''
    destino = os.path.join(RAIZ, nombre)
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    open(destino, 'w', encoding='utf-8').write(doc)
    print('  ', nombre)


# ---------------------------------------------------------------------------
# Imágenes, videos y tarjetas
# ---------------------------------------------------------------------------
def foto(B, slug, alt, sizes='(max-width: 860px) 100vw, 50vw', cargar='lazy'):
    grande = 'assets/img/fotos/{}-1600.webp'.format(slug)
    if not os.path.exists(os.path.join(RAIZ, grande)):
        grande = 'assets/img/fotos/{}-1200.webp'.format(slug)
    chica = 'assets/img/fotos/{}-800.webp'.format(slug)
    w, h = dims(grande)
    return ('<img src="{B}{chica}" srcset="{B}{chica} 800w, {B}{grande} {w}w" sizes="{sizes}" '
            'width="{w}" height="{h}" alt="{alt}" loading="{cargar}" decoding="async">').format(
        B=B, chica=chica, grande=grande, w=w, h=h, sizes=sizes, alt=e(alt), cargar=cargar)


def foto_simple(B, rel, alt):
    w, h = dims(rel)
    return '<img src="{}{}" width="{}" height="{}" alt="{}" loading="lazy" decoding="async">'.format(B, rel, w, h, e(alt))


def video(B, nombre, chico=None, clase=''):
    extra = ' data-src-chico="{}assets/video/{}.mp4"'.format(B, chico) if chico else ''
    cls = ' class="{}"'.format(clase) if clase else ''
    return ('<video{cls} data-video data-src="{B}assets/video/{n}.mp4"{extra} poster="{B}assets/video/{n}.webp" '
            'muted loop playsinline preload="none" aria-hidden="true" disablepictureinpicture></video>').format(
        cls=cls, B=B, n=nombre, extra=extra)


def tarjeta(B, p):
    img = p['imagenChica']
    w, h = dims(img)
    return f'''<a class="tarjeta" href="{B}cafes/{p['slug']}.html" style="--tinte:{p['tinte']};--tinte-texto:{p['tinteTexto']}" data-tarjeta="{p['handle']}" data-categoria="{p['categoria']}">
      <span class="tarjeta__etiqueta">{e(p['etiqueta'])}</span>
      <span class="tarjeta__foto"><img src="{B}{img}" width="{w}" height="{h}" alt="" loading="lazy" decoding="async" draggable="false"></span>
      <span class="tarjeta__nombre">{e(p['nombre'])}</span>
      <span class="tarjeta__notas">{e(p['corto'])}</span>
      <span class="tarjeta__pie"><span class="tarjeta__precio" data-precio="{p['handle']}">{precio_html(p)}</span><span class="tarjeta__ir" aria-hidden="true">{icono('flecha')}</span></span>
    </a>'''


def abanico():
    """Vitral de medio punto: el abanico de vidrios de colores de las casas cubanas."""
    cx, cy = 300, 300
    r_centro, r_medio, r_borde = 66, 232, 292
    piezas = []

    def punto(r, ang):
        a = math.radians(ang)
        return cx + r * math.cos(a), cy - r * math.sin(a)

    def sector(r0, r1, a0, a1, color):
        x1, y1 = punto(r0, a0)
        x2, y2 = punto(r1, a0)
        x3, y3 = punto(r1, a1)
        x4, y4 = punto(r0, a1)
        return ('<path d="M{:.1f} {:.1f}L{:.1f} {:.1f}A{r1} {r1} 0 0 1 {:.1f} {:.1f}L{:.1f} {:.1f}A{r0} {r0} 0 0 0 {:.1f} {:.1f}Z" fill="{c}"/>'
                .format(x1, y1, x2, y2, x3, y3, x4, y4, x1, y1, r1=r1, r0=r0, c=color))

    internos = ['#f7b11b', '#b8432b', '#ffc94d', '#4c6b3c', '#efd9b4', '#4c6b3c', '#ffc94d', '#b8432b', '#f7b11b']
    n = len(internos)
    for i, c in enumerate(internos):
        piezas.append(sector(r_centro, r_medio, 180 - i * 180 / n, 180 - (i + 1) * 180 / n, c))
    m = 18
    for i in range(m):
        piezas.append(sector(r_medio, r_borde, 180 - i * 180 / m, 180 - (i + 1) * 180 / m, '#f7b11b' if i % 2 == 0 else '#da9208'))
    piezas.append('<path d="M{} {}A{r} {r} 0 0 1 {} {}Z" fill="#fff1d6"/>'.format(cx - r_centro, cy, cx + r_centro, cy, r=r_centro))
    return ('<svg class="abanico" viewBox="0 0 600 318" aria-hidden="true" focusable="false">'
            '<g stroke="#22140d" stroke-width="5" stroke-linejoin="round">' + ''.join(piezas) + '</g>'
            '<rect x="0" y="298" width="600" height="20" rx="4" fill="#22140d"/></svg>')


VAPOR = ('<svg class="vapor" viewBox="0 0 120 160" aria-hidden="true" focusable="false">'
         '<path d="M30 150c-14-22 14-34 0-58s12-36 2-60"/>'
         '<path d="M62 150c-14-22 14-34 0-58s12-36 2-60"/>'
         '<path d="M94 150c-14-22 14-34 0-58s12-36 2-60"/></svg>')


def cinta():
    palabras = ['Cafecito', 'Colada', 'Cortadito', 'Café con leche', 'Espumita', 'Buchito', 'Tacita', 'Cafetera']
    grupo = ''.join('<span class="cinta__palabra">{}</span><svg class="cinta__grano" viewBox="0 0 24 24" aria-hidden="true" style="--grano-linea:#f7b11b"><use href="#i-grano"/></svg>'.format(p) for p in palabras)
    return ('<div class="cinta" aria-label="Cafecito, colada, cortadito, café con leche, espumita, buchito, tacita y cafetera">'
            '<div class="cinta__pista" aria-hidden="true"><div class="cinta__grupo">{g}</div><div class="cinta__grupo">{g}</div></div></div>').format(g=grupo)


def molidos():
    datos = [
        ('Espresso (fino)', 'Para cafetera italiana y máquina de espresso. Es el molido del cafecito cubano.', [3, 3, 3, 3, 3, 3]),
        ('Medio', 'Para cafetera de goteo, filtro de papel o colador de tela.', [6, 6, 6, 6]),
        ('Grueso', 'Para prensa francesa y cold brew.', [9, 9, 9]),
        ('En grano', 'Si tienes molino en casa: muele justo antes de colar.', [14, 14]),
    ]
    items = []
    for nombre, texto, puntos in datos:
        dots = ''.join('<i style="width:{0}px;height:{0}px"></i>'.format(p) for p in puntos)
        items.append('<li class="molido"><div class="molido__punto" aria-hidden="true">{}</div><h3>{}</h3><p>{}</p></li>'.format(dots, nombre, texto))
    return '<ul class="molidos">' + ''.join(items) + '</ul>'


# ---------------------------------------------------------------------------
# Inicio
# ---------------------------------------------------------------------------
def pagina_inicio():
    B = ''
    el_mio = POR_HANDLE['cafe-espresso-el-mio-100-arabica']
    caja = POR_HANDLE['12-packs-cafe-espresso-el-mio']
    carril = ''.join(tarjeta(B, p) for p in CATALOGO if p['categoria'] in ('origen', 'muestras', 'te'))
    w24, h24 = dims(caja['imagenChica'])
    carril += f'''<a class="tarjeta tarjeta--todo" href="tienda.html" style="--tinte:#3a2619;--tinte-texto:#fff8ec">
      <span class="tarjeta__etiqueta">La tienda</span>
      <span class="tarjeta__foto"><img src="{caja['imagenChica']}" width="{w24}" height="{h24}" alt="" loading="lazy" decoding="async" draggable="false"></span>
      <span class="tarjeta__nombre">Ver todos los cafés</span>
      <span class="tarjeta__notas">El Mío de siempre, la caja de 24, orígenes, muestras y té.</span>
      <span class="tarjeta__pie"><span class="tarjeta__precio">Ir a la tienda</span><span class="tarjeta__ir" aria-hidden="true">{icono('flecha')}</span></span>
    </a>'''

    galeria_1 = [('colada-tacitas', 'Colada de café cubano repartida en tacitas'), ('domino-park', 'Parque del Dominó en la Pequeña Habana, Miami'),
                 ('cortadito', 'Un cortadito en vaso de foam'), ('moka-chorro', 'Café subiendo en la cafetera'),
                 ('calle-ocho-edificio', 'Edificio de colores en la Calle Ocho'), ('cerezas-maduras', 'Cerezas de café maduras en la mata')]
    galeria_2 = [('cafe-cubano-mostrador', 'Cafecito en el mostrador de una cafetería'), ('granos-manos', 'Manos con cerezas de café recién cosechadas'),
                 ('cafecito-tacita', 'Tacita de café cubano con su espuma'), ('terrazas-cafetal', 'Ruinas de un cafetal en Las Terrazas, Cuba'),
                 ('calle-ocho-mural', 'Mural de azulejos de la Calle 8 en la Pequeña Habana'), ('moka-crema', 'Café recién colado dentro de la cafetera')]

    def fila(items, inversa=False):
        fotos = ''.join('<figure class="galeria__foto">{}</figure>'.format(foto(B, s, a, sizes='(max-width: 860px) 60vw, 30vw')) for s, a in items)
        fotos_rep = ''.join('<figure class="galeria__foto" aria-hidden="true">{}</figure>'.format(foto(B, s, '', sizes='(max-width: 860px) 60vw, 30vw')) for s, a in items)
        return ('<div class="galeria__fila{}"><div class="galeria__pista"><div class="galeria__grupo">{}</div>'
                '<div class="galeria__grupo">{}</div></div></div>').format(' galeria__fila--inversa' if inversa else '', fotos, fotos_rep)

    wb, hb = dims(el_mio['imagen'])
    cuerpo = f'''
<section class="portada" aria-labelledby="portada-titulo">
  <div class="portada__fondo">{video(B, 'granos-1600', chico='granos-900')}</div>
  <div class="contenedor portada__contenido">
    <div class="portada__texto">
      <h1 class="portada__titular" id="portada-titulo">
        <span class="linea"><span>Auténtico</span></span>
        <span class="linea"><span>como el de</span></span>
        <span class="linea"><span>mi tierra.</span></span>
      </h1>
      <p class="portada__bajada">Café espresso cubano, tostado y empacado en Miami. Para colar en la cafetera, batir la espumita y compartir la colada.</p>
      <div class="portada__acciones">
        <a class="boton boton--ambar" href="cafes/el-mio.html">Comprar El Mío</a>
        <a class="boton boton--linea" href="#ritual">Cómo se cuela</a>
      </div>
      <p class="portada__hora" data-reloj-mensaje>En Miami, el cafecito es a las 3:05.</p>
    </div>
    <div class="portada__producto" aria-hidden="true">
      {VAPOR}
      <img class="portada__paquete" src="{el_mio['imagen']}" width="{wb}" height="{hb}" alt="" fetchpriority="high">
    </div>
  </div>
</section>

{cinta()}

<section class="destacado tema-claro seccion" aria-labelledby="destacado-titulo">
  <div class="contenedor destacado__grid">
    <div class="destacado__escena" data-scroll>
      {abanico()}
      <img class="destacado__paquete" src="{el_mio['imagen']}" width="{wb}" height="{hb}" alt="Paquete de Café Espresso El Mío, 10 onzas" loading="lazy" decoding="async">
    </div>
    <div class="destacado__info">
      <h2 class="titulo-grande" id="destacado-titulo">El de siempre</h2>
      <p class="destacado__producto">Café Espresso El Mío</p>
      <p class="destacado__texto">Un paquete de 10 onzas de café 100 % arábica, de tueste oscuro y ya molido. Fuerte, aromático y con ese amargor que pide azúcar: el que se cuela por la mañana, el que se le brinda a la visita y el de la pausa de las 3:05.</p>
      <ul class="chips">
        <li class="chip">Tueste oscuro</li><li class="chip">Molido</li><li class="chip">10 oz (283 g)</li><li class="chip">Tostado en Miami</li>
      </ul>
      <div class="compra-rapida">
        <p class="precio" data-precio="{el_mio['handle']}">{precio_html(el_mio)}</p>
        <button class="boton boton--oscuro" type="button" data-agregar="{el_mio['handle']}">{icono('bolsa')}Agregar a la bolsa</button>
        <a class="enlace-flecha" href="cafes/el-mio.html">Ver detalles {icono('flecha')}</a>
      </div>
      <a class="oferta" href="cafes/el-mio-caja-24.html">
        <img src="{caja['imagenChica']}" width="{w24}" height="{h24}" alt="" loading="lazy" decoding="async">
        <div><strong>¿Cuelas todos los días? Llévate la caja de 24</strong><span data-por-unidad="{caja['handle']}">Sale más barato cada paquete.</span></div>
        {icono('flecha')}
      </a>
    </div>
  </div>
</section>

<section class="ritual tema-oscuro" id="ritual" aria-labelledby="ritual-titulo">
  <div class="contenedor ritual__cabeza">
    <h2 class="titulo-grande" id="ritual-titulo">Cómo se cuela un cafecito cubano</h2>
    <p class="entrada">Cuatro pasos, una cafetera y paciencia para batir. Así se hace en casa desde siempre.</p>
  </div>
  <div class="ritual__pista" data-ritual>
    <div class="ritual__fijo">
      <div class="contenedor ritual__escenario">
        <ol class="ritual__pasos">
          <li class="paso es-activo" data-paso>
            <div class="paso__texto">
              <span class="paso__numero" aria-hidden="true">1</span>
              <h3 class="paso__titulo">Prepara la cafetera</h3>
              <p>Agua hasta la válvula, El Mío en el embudo sin apretarlo y fuego medio. En unos minutos el café empieza a subir.</p>
            </div>
            <div class="paso__medio arco">{foto(B, 'moka-chorro', 'Café subiendo dentro de una cafetera italiana', sizes='(max-width: 860px) 100vw, 45vw')}</div>
          </li>
          <li class="paso" data-paso>
            <div class="paso__texto">
              <span class="paso__numero" aria-hidden="true">2</span>
              <h3 class="paso__titulo">Atrapa las primeras gotas</h3>
              <p>Las primeras gotas son las más concentradas. Échalas en una taza con el azúcar: más o menos una cucharadita por cada tacita.</p>
            </div>
            <div class="paso__medio arco">{video(B, 'azucar')}</div>
          </li>
          <li class="paso" data-paso>
            <div class="paso__texto">
              <span class="paso__numero" aria-hidden="true">3</span>
              <h3 class="paso__titulo">Bate la espumita</h3>
              <p>Bate con la cucharita, con energía, hasta que el azúcar y el café se vuelvan una crema clara y espesa. Ese es el secreto.</p>
            </div>
            <div class="paso__medio arco">{video(B, 'batir')}</div>
          </li>
          <li class="paso" data-paso>
            <div class="paso__texto">
              <span class="paso__numero" aria-hidden="true">4</span>
              <h3 class="paso__titulo">Sirve la colada</h3>
              <p>Vierte el resto del café sobre la espumita, revuelve suave y reparte en tacitas. El cafecito se comparte.</p>
            </div>
            <div class="paso__medio arco">{foto(B, 'colada-tacitas', 'Colada de café cubano servida en tacitas', sizes='(max-width: 860px) 100vw, 45vw')}</div>
          </li>
        </ol>
        <div class="ritual__progreso" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      </div>
    </div>
  </div>
  <div class="contenedor ritual__pie"><a class="boton boton--linea" href="preparacion.html">Ver todas las recetas</a></div>
</section>

<section class="origenes tema-oscuro-2 seccion" aria-labelledby="origenes-titulo">
  <div class="contenedor origenes__cabeza">
    <div>
      <h2 class="titulo-grande" id="origenes-titulo">Más allá del espresso</h2>
      <p class="entrada">Además de El Mío de siempre, tenemos cafés de un solo origen, una mezcla africana para espresso, muestras para probar y matcha. Escoge el molido y el tamaño, desde 12 onzas hasta 12 libras.</p>
    </div>
    <div class="carril-controles">
      <button class="redondo" type="button" data-carril-anterior aria-label="Ver anteriores">{icono('flecha-izq')}</button>
      <button class="redondo" type="button" data-carril-siguiente aria-label="Ver siguientes">{icono('flecha')}</button>
    </div>
  </div>
  <div class="carril" data-carril tabindex="0" aria-label="Cafés de origen, muestras y té. Arrastra o desliza para ver más.">
    {carril}
  </div>
  <div class="contenedor"><div class="carril-barra" aria-hidden="true"><span data-carril-progreso></span></div></div>
</section>

<section class="historia-adelanto tema-claro seccion" aria-labelledby="historia-titulo">
  <div class="contenedor historia-adelanto__grid">
    <div class="collage">
      <div class="collage__alta arco paralaje" data-revelar data-scroll>{foto(B, 'calle-ocho-mural', 'Mural de azulejos con el letrero de la Calle 8 en la Pequeña Habana, Miami', sizes='(max-width: 860px) 60vw, 30vw')}</div>
      <div class="collage__baja arco" data-revelar>{foto(B, 'cafetal-grabado', 'Grabado antiguo de un cafetal cubano', sizes='(max-width: 860px) 40vw, 20vw')}</div>
    </div>
    <div>
      <h2 class="titulo-grande" id="historia-titulo">Un café que es mío, para que lo hagas tuyo</h2>
      <p class="entrada" style="margin-top:24px">El Mío nació en Miami en 2021. Lo presentó el comunicador cubano Carlucho con una idea muy sencilla, y Gente de Zona le puso música al lanzamiento.</p>
      <blockquote class="cita">
        <p>«Un café que es mío y quiero que usted lo haga suyo.»</p>
        <footer>Carlucho, al presentar El Mío</footer>
      </blockquote>
      <p class="texto-suave" style="max-width:52ch;margin-bottom:32px">Desde entonces se tuesta y se empaca en Miami, con el sabor del café que se colaba en casa, allá en la tierra.</p>
      <a class="boton boton--oscuro" href="historia.html">Conoce nuestra historia</a>
    </div>
  </div>
</section>

<section class="galeria tema-oscuro seccion" aria-labelledby="galeria-titulo">
  <div class="contenedor galeria__cabeza">
    <h2 class="titulo-grande" id="galeria-titulo">La cultura del cafecito</h2>
    <a class="enlace-flecha" href="https://www.instagram.com/cafeelmio" target="_blank" rel="noopener">Comparte tu colada con @cafeelmio {icono('flecha')}</a>
  </div>
  <div class="galeria__filas">
    {fila(galeria_1)}
    {fila(galeria_2, inversa=True)}
  </div>
</section>

<section class="las-305 seccion" aria-labelledby="las305-titulo">
  <div class="contenedor las-305__grid">
    <div class="las-305__ventana arco" data-revelar>{video(B, 'vapor-taza')}</div>
    <div>
      <p class="las-305__reloj" aria-hidden="true">3:05</p>
      <h2 class="las-305__titulo" id="las305-titulo">En Miami, las 3:05 de la tarde son sagradas.</h2>
      <p class="entrada">Por el 305, a esa hora se hace una pausa para el cafecito. Una tacita, un buchito, cinco minutos de conversación y de vuelta a lo que estabas.</p>
      <p class="las-305__vivo" data-reloj-mensaje>Cada día a las 3:05, hora de Miami.</p>
      <div><a class="boton boton--oscuro" href="tienda.html">Que no falte en casa</a></div>
    </div>
  </div>
</section>
'''
    pagina('index.html', 'Café El Mío | Café espresso cubano tostado en Miami',
           'Café espresso cubano 100 % arábica, tostado y empacado en Miami. Auténtico como el de mi tierra: El Mío de siempre, cafés de origen y recetas para colar el cafecito.',
           cuerpo, actual='inicio', B=B)


# ---------------------------------------------------------------------------
# Tienda
# ---------------------------------------------------------------------------
def pagina_tienda():
    B = ''
    tarjetas = ''.join(tarjeta(B, p) for p in CATALOGO)
    filtros = '<button class="filtro" type="button" data-filtro="todos" aria-pressed="true">Todos<span class="filtro__cuenta">{}</span></button>'.format(len(CATALOGO))
    for clave, nombre in CATEGORIAS:
        n = sum(1 for p in CATALOGO if p['categoria'] == clave)
        filtros += '<button class="filtro" type="button" data-filtro="{}" aria-pressed="false">{}<span class="filtro__cuenta">{}</span></button>'.format(clave, nombre, n)
    filtros += '<button class="filtro" type="button" data-filtro="otros" aria-pressed="false" hidden>Novedades<span class="filtro__cuenta">0</span></button>'
    cuerpo = f'''
<section class="encabezado tema-oscuro">
  <div class="contenedor">
    <h1 class="encabezado__titulo">Nuestros cafés</h1>
    <p class="entrada">El Mío de siempre, cafés de origen, muestras y té. Los precios se leen directo de nuestra tienda en línea y el pago se hace en la tienda segura de Shopify.</p>
  </div>
</section>
<section class="tema-oscuro" style="padding-bottom:var(--seccion)" aria-label="Productos">
  <div class="contenedor">
    <div class="filtros" role="group" aria-label="Filtrar por tipo">{filtros}</div>
    <div class="rejilla" data-rejilla>
      {tarjetas}
    </div>
  </div>
</section>
<section class="tema-oscuro-2 seccion" aria-labelledby="molido-titulo">
  <div class="contenedor">
    <h2 class="titulo-grande" id="molido-titulo">Elige tu molido</h2>
    <p class="entrada" style="margin-top:20px">Cada café de origen viene en cuatro molidos. Si no sabes cuál pedir, piensa en cómo lo vas a preparar.</p>
    {molidos()}
    <p style="margin-top:36px"><a class="enlace-flecha" href="preparacion.html">Ver las recetas paso a paso {icono('flecha')}</a></p>
  </div>
</section>
'''
    pagina('tienda.html', 'Tienda', 'Compra Café Espresso El Mío, la caja de 24, cafés de origen de Colombia, Costa Rica y Perú, muestras y matcha. Envíos desde Miami.',
           cuerpo, actual='tienda', B=B)


# ---------------------------------------------------------------------------
# Producto
# ---------------------------------------------------------------------------
def pagina_producto(p):
    B = '../'
    w, h = dims(p['imagen'])
    ancha = ' ficha__escenario--ancha' if p['handle'] in ('cafe-espresso-el-mio-100-arabica', '12-packs-cafe-espresso-el-mio') else ''
    v0 = variante_inicial(p)
    notas = ''
    if p.get('notas'):
        notas = '<ul class="notas-cata" aria-label="Notas de cata">' + ''.join('<li>{}</li>'.format(e(n)) for n in p['notas']) + '</ul>'
    elif p.get('origenes'):
        notas = '<ul class="notas-cata" aria-label="Orígenes">' + ''.join('<li>{}</li>'.format(e(n)) for n in p['origenes']) + '</ul>'
    opciones = ''
    for idx, o in enumerate(p['opciones']):
        if len(o['valores']) < 2:
            continue
        botones = ''.join('<label class="opcion"><input type="radio" name="op{i}" value="{v}"{c}><span>{t}</span></label>'.format(
            i=idx, v=e(val), c=' checked' if val == v0['opciones'][idx] else '', t=e(OPCIONES.get(val, val))) for val in o['valores'])
        opciones += '<fieldset class="selector" data-opcion="{}"><legend>{}<span data-elegido>{}</span></legend><div class="selector__opciones">{}</div></fieldset>'.format(
            idx, OPCIONES.get(o['nombre'], o['nombre']), e(OPCIONES.get(v0['opciones'][idx], v0['opciones'][idx])), botones)
    contenido = ''
    if p.get('contenido'):
        contenido = '<div class="ficha__bloque"><h2>Qué trae</h2><ul class="contenido-lista">' + ''.join(
            '<li><strong>{}</strong><span>{}</span></li>'.format(e(a), e(b)) for a, b in p['contenido']) + '</ul></div>'
    ficha = '<dl class="datos">' + ''.join('<dt>{}</dt><dd>{}</dd>'.format(e(a), e(b)) for a, b in p['ficha']) + '</dl>'
    descripcion = ''.join('<p>{}</p>'.format(e(x)) for x in p['descripcion'])
    sobre = 'Sobre este té' if p['categoria'] == 'te' else 'Sobre este café'
    relacionados = [x for x in CATALOGO if x['handle'] != p['handle'] and x['categoria'] == p['categoria']]
    relacionados += [x for x in CATALOGO if x['handle'] != p['handle'] and x not in relacionados]
    carril = ''.join(tarjeta(B, x) for x in relacionados[:6])
    pago_inicial = '{}/es/cart/{}:1'.format(TIENDA, v0['id'])
    cuerpo = f'''
<section class="ficha tema-oscuro" data-ficha="{p['handle']}">
  <div class="contenedor">
    <ol class="miga" aria-label="Estás en">
      <li><a href="../tienda.html">Tienda</a></li>
      <li><a href="../tienda.html#{p['categoria']}">{NOMBRE_CATEGORIA.get(p['categoria'], 'Otros')}</a></li>
      <li aria-current="page">{e(p['nombre'])}</li>
    </ol>
    <div class="ficha__grid">
      <div class="ficha__escenario{ancha}" style="--tinte:{p['tinte']}" data-inclinar>
        <img src="../{p['imagen']}" width="{w}" height="{h}" alt="{e(p['nombre'])}" fetchpriority="high">
      </div>
      <div class="ficha__info">
        <p class="texto-suave" style="font-weight:600;margin-bottom:10px">{e(p['etiqueta'])}</p>
        <h1 class="ficha__titulo">{e(p['nombre'])}</h1>
        <p class="ficha__corto">{e(p['corto'])}</p>
        {notas}
        <div class="ficha__precio"><span class="precio" data-ficha-precio>${v0['precio']:.2f}</span><s class="texto-suave" data-ficha-antes hidden></s></div>
        <p class="ficha__unidad" data-ficha-unidad aria-live="polite"></p>
        <form data-ficha-form>
          <div data-ficha-opciones>{opciones}</div>
          <div class="ficha__compra">
            <div class="cantidad" role="group" aria-label="Cantidad">
              <button type="button" data-cantidad="-1" aria-label="Quitar uno">{icono('menos')}</button>
              <output data-ficha-cantidad aria-live="polite">1</output>
              <button type="button" data-cantidad="1" aria-label="Agregar uno">{icono('mas')}</button>
            </div>
            <button class="boton boton--ambar" type="submit" data-ficha-agregar>Agregar a la bolsa</button>
            <a class="boton boton--linea" data-ficha-comprar href="{pago_inicial}">Comprar ahora</a>
          </div>
        </form>
        <ul class="ficha__garantias">
          <li>{icono('camion')}<span>Enviamos desde Miami. El costo del envío se calcula al pagar, según tu dirección.</span></li>
          <li>{icono('candado')}<span>Pagas en la tienda segura de Café El Mío en Shopify.</span></li>
          <li>{icono('taza')}<span>{e(p['preparar'])}</span></li>
        </ul>
        <div class="ficha__bloque"><h2>{sobre}</h2><div class="prosa texto-suave">{descripcion}</div></div>
        {contenido}
        <div class="ficha__bloque"><h2>Ficha</h2>{ficha}</div>
      </div>
    </div>
  </div>
</section>
<section class="tema-oscuro-2 seccion" aria-labelledby="relacionados-titulo">
  <div class="contenedor origenes__cabeza">
    <h2 class="titulo-grande" id="relacionados-titulo">También te puede gustar</h2>
    <div class="carril-controles">
      <button class="redondo" type="button" data-carril-anterior aria-label="Ver anteriores">{icono('flecha-izq')}</button>
      <button class="redondo" type="button" data-carril-siguiente aria-label="Ver siguientes">{icono('flecha')}</button>
    </div>
  </div>
  <div class="carril" data-carril tabindex="0" aria-label="Otros productos">{carril}</div>
  <div class="contenedor"><div class="carril-barra" aria-hidden="true"><span data-carril-progreso></span></div></div>
</section>
'''
    desc = '{} {}'.format(p['nombre'], p['corto'])
    pagina('cafes/{}.html'.format(p['slug']), p['nombre'], desc, cuerpo, actual='tienda', B=B)


# ---------------------------------------------------------------------------
# Historia
# ---------------------------------------------------------------------------
def pagina_historia():
    B = ''
    el_mio = POR_HANDLE['cafe-espresso-el-mio-100-arabica']
    wb, hb = dims(el_mio['imagen'])
    cuerpo = f'''
<section class="encabezado tema-oscuro">
  <div class="contenedor historia-portada">
    <div>
      <h1 class="encabezado__titulo">Un café que es mío</h1>
      <p class="entrada">El Mío es café cubano tostado y empacado en Miami. Esta es la historia de dónde viene su sabor y de cómo llegó a tu mesa.</p>
    </div>
    <div class="historia-portada__arco arco" data-revelar>{foto(B, 'domino-park', 'Vecinos jugando dominó en el Parque Máximo Gómez, en la Pequeña Habana de Miami', cargar='eager')}</div>
  </div>
</section>

<section class="tema-claro seccion" aria-labelledby="cap-tierra">
  <div class="contenedor capitulo">
    <div>
      <span class="capitulo__ano">1748</span>
      <h2 class="titulo-grande" id="cap-tierra">El café de la tierra</h2>
      <div class="prosa texto-suave" style="margin-top:24px">
        <p>Según la historia más contada, el café llegó a Cuba en 1748. Entre finales del siglo XVIII y comienzos del XIX, los cafetales se extendieron por las montañas del oriente de la isla y por la Sierra del Rosario, en el occidente.</p>
        <p>Los primeros cafetales del sureste cubano son hoy Patrimonio de la Humanidad. Y en el campo, por generaciones, el café se tostó en casa y se molió en pilón, el mortero de madera que todavía se ve en las fincas.</p>
      </div>
    </div>
    <div class="capitulo__fotos">
      <figure class="ancha"><div class="marco" style="height:100%">{foto(B, 'cafetal-grabado', 'Grabado antiguo de un cafetal cubano con palmas reales')}</div></figure>
      <figure><div class="marco alta">{foto(B, 'pilon-vinales', 'Mujer moliendo café en un pilón de madera cerca de Viñales, Cuba', sizes='(max-width: 860px) 50vw, 25vw')}</div><figcaption class="pie-foto">Café molido en pilón, cerca de Viñales.</figcaption></figure>
      <figure><div class="marco media">{foto(B, 'terrazas-cafetal', 'Ruinas de piedra de un antiguo cafetal en Las Terrazas, Cuba', sizes='(max-width: 860px) 50vw, 25vw')}</div><figcaption class="pie-foto">Ruinas de un cafetal en Las Terrazas.</figcaption></figure>
    </div>
  </div>
</section>

<section class="banda-video" aria-label="Tostado tradicional">
  {video(B, 'tostar-lena')}
  <div class="contenedor banda-video__texto">
    <p>En el campo se tostaba en cazuela, al fuego de leña. El cariño sigue siendo el mismo.</p>
  </div>
</section>

<section class="tema-oscuro seccion" aria-labelledby="cap-miami">
  <div class="contenedor capitulo capitulo--invertido">
    <div>
      <span class="capitulo__ano">305</span>
      <h2 class="titulo-grande" id="cap-miami">La ventanita</h2>
      <div class="prosa texto-suave" style="margin-top:24px">
        <p>En Miami el café cubano se toma de pie, en la ventanita: ese mostrador que da a la calle donde se pide un cafecito, un cortadito o una colada para la oficina. La colada viene en un vaso con tacitas para repartir, porque el café cubano se comparte.</p>
        <p>Y a las 3:05 de la tarde, por el código de área 305, la ciudad hace su pausa del cafecito.</p>
      </div>
    </div>
    <div class="capitulo__fotos">
      <figure><div class="marco alta">{foto(B, 'cafe-cubano-mostrador', 'Un cafecito servido en el mostrador de una cafetería', sizes='(max-width: 860px) 50vw, 25vw')}</div></figure>
      <figure><div class="marco alta">{foto(B, 'cortadito', 'Un cortadito en vaso de foam', sizes='(max-width: 860px) 50vw, 25vw')}</div></figure>
      <figure class="ancha"><div class="marco" style="height:100%">{foto(B, 'colada-tacitas', 'Colada de café cubano repartida en tacitas')}</div></figure>
    </div>
  </div>
</section>

<section class="tema-claro seccion" aria-labelledby="cap-2021">
  <div class="contenedor capitulo">
    <div>
      <span class="capitulo__ano">2021</span>
      <h2 class="titulo-grande" id="cap-2021">Nace El Mío</h2>
      <div class="prosa texto-suave" style="margin-top:24px">
        <p>En abril de 2021, el presentador cubano Carlucho anunció El Mío en su programa de televisión: un café cubano tostado y empacado en Miami, para la comunidad de aquí y para quien lo quiera probar en cualquier parte.</p>
      </div>
      <blockquote class="cita">
        <p>«Un café que es mío y quiero que usted lo haga suyo.»</p>
        <footer>Carlucho</footer>
      </blockquote>
      <div class="prosa texto-suave">
        <p>Gente de Zona le puso melodía al lanzamiento, y con el concurso El Mío la gente compartió fotos, videos y coreografías tomando café.</p>
      </div>
    </div>
    <div class="destacado__escena" data-scroll>
      {abanico()}
      <img class="destacado__paquete" src="{el_mio['imagen']}" width="{wb}" height="{hb}" alt="Paquete de Café Espresso El Mío" loading="lazy" decoding="async">
    </div>
  </div>
</section>

<section class="tema-oscuro seccion" aria-labelledby="cap-hoy">
  <div class="contenedor capitulo capitulo--invertido">
    <div>
      <span class="capitulo__ano">Hoy</span>
      <h2 class="titulo-grande" id="cap-hoy">Tostado y empacado en Miami</h2>
      <div class="prosa texto-suave" style="margin-top:24px">
        <p>El Mío sigue siendo el mismo: 100 % arábica, tueste oscuro, molido y en su paquete de 10 onzas.</p>
        <p>Ahora lo acompañan cafés de un solo origen de Colombia, Costa Rica y Perú, una mezcla africana para espresso, muestras para probar y matcha.</p>
      </div>
      <div class="portada__acciones" style="margin-top:32px">
        <a class="boton boton--ambar" href="tienda.html">Ver los cafés</a>
        <a class="boton boton--linea" href="preparacion.html">Cómo prepararlo</a>
      </div>
    </div>
    <div class="las-305__ventana arco" data-revelar style="justify-self:center;max-width:460px">{video(B, 'espresso-chorro')}</div>
  </div>
</section>
'''
    pagina('historia.html', 'Nuestra historia', 'Del café de la tierra a la ventanita de Miami: la historia de Café El Mío, el café cubano que presentó Carlucho en 2021.',
           cuerpo, actual='historia', B=B)


# ---------------------------------------------------------------------------
# Preparación
# ---------------------------------------------------------------------------
RECETAS = [
    dict(id='cafecito', titulo='Cafecito cubano', foto=('foto', 'moka-crema', 'Café recién colado dentro de una cafetera italiana'),
         intro='El de toda la vida: fuerte, dulce y con su espumita.',
         datos=[('Molido', 'Espresso (fino)'), ('Cafetera', 'Italiana'), ('Azúcar', '1 cdta por tacita'), ('Tiempo', 'Unos 5 min')],
         pasos=['Llena el depósito de la cafetera con agua fría hasta la válvula.',
                'Pon El Mío en el embudo hasta el borde, sin apretarlo, y enrosca bien.',
                'Fuego medio. Ten lista una taza con el azúcar: una cucharadita por cada tacita que vas a servir.',
                'Cuando salgan las primeras gotas, échalas sobre el azúcar y regresa la cafetera al fuego.',
                'Bate el azúcar con esas gotas hasta formar una crema clara y espesa: la espumita.',
                'Cuando termine de subir el café, viértelo sobre la espumita, revuelve suave y sirve en tacitas.'],
         consejo='Retira la cafetera del fuego apenas empiece a gorgotear. Si sigue hirviendo, el café se amarga.'),
    dict(id='cortadito', titulo='Cortadito', foto=('foto', 'cortadito', 'Un cortadito en vaso de foam'),
         intro='Mitad cafecito, mitad leche caliente. El de media mañana.',
         datos=[('Base', 'Un cafecito'), ('Leche', 'Entera o evaporada'), ('Proporción', 'Mitad y mitad')],
         pasos=['Prepara un cafecito cubano con su espumita.',
                'Calienta la leche hasta que esté bien caliente, sin que hierva. Si quieres, espúmala.',
                'Sirve el café en un vaso pequeño y complétalo con la misma cantidad de leche.'],
         consejo='Con leche evaporada queda más cremoso y dulce, como en muchas cafeterías de Miami.'),
    dict(id='cafe-con-leche', titulo='Café con leche', foto=('simple', 'assets/img/fotos/guia-leche-1280.webp', 'Leche cayendo en una taza de café'),
         intro='El desayuno cubano: una taza grande, bien caliente.',
         datos=[('Café', '1 parte'), ('Leche caliente', '3 partes'), ('Para mojar', 'Tostada con mantequilla')],
         pasos=['Cuela el café en la cafetera, esta vez sin espumita.',
                'Calienta bien la leche y endulza a tu gusto.',
                'Sirve la leche en una taza grande y agrega el café por encima.'],
         consejo='El clásico va con una tostada de pan cubano con mantequilla para mojar en la taza.'),
    dict(id='espresso', titulo='Espresso en máquina', foto=('simple', 'assets/img/fotos/guia-espresso-1280.webp', 'Espresso saliendo del portafiltro'),
         intro='Para quien tiene máquina en casa o en el negocio.',
         datos=[('Molido', 'Espresso (fino)'), ('Dosis', '18 g'), ('Bebida', '36 g'), ('Tiempo', '25 a 30 s')],
         pasos=['Llena el portafiltro con 18 g de café molido para espresso.',
                'Nivela y prensa con firmeza y de forma pareja.',
                'Extrae unos 36 g de bebida en 25 a 30 segundos.'],
         consejo='Si muele en casa: cuando sale muy rápido y ácido, muele más fino; si sale lento y amargo, más grueso.'),
    dict(id='goteo', titulo='Cafetera de goteo', foto=('simple', 'assets/img/fotos/guia-filtro-1280.webp', 'Agua cayendo sobre café molido en un filtro'),
         intro='Para la jarra de la mañana y para los cafés de origen.',
         datos=[('Molido', 'Medio'), ('Proporción', '10 g por cada 170 ml'), ('Agua', '92 a 96 °C')],
         pasos=['Pon el filtro y agrega 2 cucharadas rasas de café por cada taza de agua.',
                'Llena el depósito con agua fría y enciende la cafetera.',
                'Cuando termine, revuelve la jarra antes de servir para que el sabor quede parejo.'],
         consejo='Colombia y Costa Rica lucen sus notas de fruta y miel en goteo.'),
    dict(id='prensa', titulo='Prensa francesa', foto=('simple', 'assets/img/fotos/guia-prensa-1280.webp', 'Prensa francesa con café junto a un vaso de espresso'),
         intro='Cuerpo y aroma con muy pocos pasos.',
         datos=[('Molido', 'Grueso'), ('Proporción', '30 g por 450 ml'), ('Tiempo', '4 min')],
         pasos=['Pon 30 g de café molido grueso por cada 450 ml de agua.',
                'Agrega agua recién hervida que haya reposado 30 segundos y revuelve.',
                'Tapa sin bajar el émbolo y espera 4 minutos.',
                'Baja el émbolo despacio y sirve enseguida.'],
         consejo='Si lo dejas en la prensa, se sigue extrayendo y se amarga: sírvelo todo de una vez.'),
    dict(id='cold-brew', titulo='Cold brew', foto=('simple', 'assets/video/granos-1600.webp', 'Granos de café tostado'),
         intro='Para los días de calor en Miami, que son casi todos.',
         datos=[('Molido', 'Grueso'), ('Proporción', '100 g por 800 ml'), ('Reposo', '12 a 18 h en la nevera')],
         pasos=['Mezcla 100 g de café molido grueso con 800 ml de agua fría en un frasco.',
                'Tapa y deja reposar en la nevera entre 12 y 18 horas.',
                'Cuela con un filtro de papel o de tela.',
                'Sirve con hielo. Si queda muy concentrado, rebaja con agua o leche.'],
         consejo='Se conserva hasta una semana en la nevera, bien tapado.'),
]


def pagina_preparacion():
    B = ''
    indice = ''.join('<li><a href="#{}">{}</a></li>'.format(r['id'], r['titulo']) for r in RECETAS)
    bloques = []
    for i, r in enumerate(RECETAS):
        tipo, ref, alt = r['foto']
        img = foto(B, ref, alt, sizes='(max-width: 900px) 100vw, 45vw') if tipo == 'foto' else foto_simple(B, ref, alt)
        datos = ''.join('<div class="receta__dato"><span>{}</span><strong>{}</strong></div>'.format(a, b) for a, b in r['datos'])
        pasos = ''.join('<li><p>{}</p></li>'.format(p) for p in r['pasos'])
        tema = 'tema-oscuro' if i % 2 == 0 else 'tema-oscuro-2'
        bloques.append(f'''<section class="{tema}" aria-labelledby="r-{r['id']}">
  <div class="contenedor receta" id="{r['id']}">
    <div class="receta__foto marco">{img}</div>
    <div>
      <h2 class="receta__titulo" id="r-{r['id']}">{r['titulo']}</h2>
      <p class="entrada">{r['intro']}</p>
      <div class="receta__datos">{datos}</div>
      <ol class="pasos-receta">{pasos}</ol>
      <p class="consejo"><strong>Consejo:</strong> {r['consejo']}</p>
    </div>
  </div>
</section>''')
    cuerpo = f'''
<section class="encabezado tema-oscuro">
  <div class="contenedor">
    <h1 class="encabezado__titulo">Cómo prepararlo</h1>
    <p class="entrada">Recetas para sacarle el mejor sabor a tu café, desde el cafecito cubano de toda la vida hasta el cold brew.</p>
    <ul class="indice-metodos" aria-label="Recetas">{indice}</ul>
  </div>
</section>
{''.join(bloques)}
<section class="tema-claro seccion" aria-labelledby="molido-titulo">
  <div class="contenedor">
    <h2 class="titulo-grande" id="molido-titulo">Elige tu molido</h2>
    <p class="entrada" style="margin-top:20px">El molido correcto depende de cómo prepares el café.</p>
    {molidos()}
    <div class="portada__acciones" style="margin-top:40px"><a class="boton boton--oscuro" href="tienda.html">Ver los cafés</a></div>
  </div>
</section>
'''
    pagina('preparacion.html', 'Cómo prepararlo', 'Recetas paso a paso: cafecito cubano con espumita, cortadito, café con leche, espresso, goteo, prensa francesa y cold brew.',
           cuerpo, actual='preparacion', B=B)


# ---------------------------------------------------------------------------
# Contacto
# ---------------------------------------------------------------------------
PREGUNTAS = [
    ('¿Hacen envíos fuera de Miami?', 'Sí. Enviamos desde Miami a todo Estados Unidos y también a otros países. El costo del envío y los impuestos se calculan al pagar, según tu dirección.'),
    ('¿Cómo pago mi pedido?', 'Cuando le das a Pagar, pasas a la tienda segura de Café El Mío en Shopify con tu bolsa completa. Allí pones tu dirección y completas el pago.'),
    ('¿Qué molido escojo?', 'Para cafetera italiana o máquina de espresso, Espresso (fino). Para cafetera de goteo, Medio. Para prensa francesa o cold brew, Grueso. Y si tienes molino, En grano. En <a href="preparacion.html">Cómo prepararlo</a> tienes las recetas.'),
    ('¿Puedo devolver un producto?', 'Por ser alimentos, los cafés no admiten devolución. Pero si tu pedido llega dañado o no es lo que pediste, escríbenos a <a href="mailto:info@cafeelmio.com">info@cafeelmio.com</a> en cuanto lo recibas y lo resolvemos.'),
    ('¿El Mío es 100 % arábica?', 'Sí. Café Espresso El Mío es 100 % arábica, de tueste oscuro, tostado y empacado en Miami.'),
    ('¿Venden para negocios?', 'Si tienes una cafetería, bodega, restaurante u oficina, escríbenos y conversamos. La caja de 24 paquetes es un buen punto de partida.'),
]


def pagina_contacto():
    B = ''
    canales = [
        ('tel:+13052606647', 'telefono', 'Llámanos', '(305) 260-6647'),
        ('mailto:info@cafeelmio.com', 'correo', 'Escríbenos', 'info@cafeelmio.com'),
        ('https://www.instagram.com/cafeelmio', 'instagram', 'Instagram', '@cafeelmio'),
        ('https://www.facebook.com/cafeelmio', 'facebook', 'Facebook', 'Café El Mío'),
    ]
    lista = ''
    for url, ic, titulo, dato in canales:
        externo = ' target="_blank" rel="noopener"' if url.startswith('http') else ''
        lista += '<li><a class="canal" href="{}"{}><span class="canal__icono">{}</span><span><strong>{}</strong><span>{}</span></span>{}</a></li>'.format(
            url, externo, icono(ic), titulo, dato, icono('flecha'))
    lista += '<li><div class="canal"><span class="canal__icono">{}</span><span><strong>Desde Miami</strong><span>Miami, Florida 33172</span></span></div></li>'.format(icono('ubicacion'))
    preguntas = ''.join('<details class="pregunta"><summary>{}</summary><div class="pregunta__respuesta"><p>{}</p></div></details>'.format(q, a) for q, a in PREGUNTAS)
    cuerpo = f'''
<section class="encabezado tema-oscuro">
  <div class="contenedor">
    <h1 class="encabezado__titulo">Hablemos</h1>
    <p class="entrada">¿Una pregunta sobre tu pedido, una idea para tu negocio o ganas de contarnos cómo te quedó la colada? Aquí estamos.</p>
  </div>
</section>
<section class="tema-oscuro" style="padding-bottom:var(--seccion)">
  <div class="contenedor contacto__grid">
    <ul class="canales">{lista}</ul>
    <form class="formulario" data-formulario novalidate>
      <h2>Mándanos un mensaje</h2>
      <div class="formulario__fila">
        <div class="campo"><label for="f-nombre">Nombre</label><input id="f-nombre" name="nombre" autocomplete="name" required></div>
        <div class="campo"><label for="f-correo">Correo</label><input id="f-correo" name="correo" type="email" autocomplete="email"></div>
      </div>
      <div class="formulario__fila">
        <div class="campo"><label for="f-telefono">Teléfono</label><input id="f-telefono" name="telefono" type="tel" autocomplete="tel"></div>
        <div class="campo"><label for="f-motivo">Sobre qué</label>
          <select id="f-motivo" name="motivo"><option>Un pedido</option><option>Para mi negocio</option><option>Prensa o colaboraciones</option><option>Otra cosa</option></select>
        </div>
      </div>
      <div class="campo"><label for="f-mensaje">Mensaje</label><textarea id="f-mensaje" name="mensaje" required></textarea></div>
      <p class="formulario__error" data-formulario-error role="alert"></p>
      <button class="boton boton--oscuro" type="submit">{icono('correo')}Enviar por correo</button>
      <p class="formulario__nota" data-formulario-nota>Al enviarlo se abre tu aplicación de correo con el mensaje listo. Si prefieres, llámanos al (305) 260-6647.</p>
    </form>
  </div>
</section>
<section class="tema-claro seccion" aria-labelledby="preguntas-titulo">
  <div class="contenedor">
    <h2 class="titulo-grande" id="preguntas-titulo" style="margin-bottom:40px">Preguntas frecuentes</h2>
    <div class="preguntas">{preguntas}</div>
  </div>
</section>
'''
    pagina('contacto.html', 'Contacto', 'Escríbenos o llámanos al (305) 260-6647. Preguntas frecuentes sobre envíos, pagos, molidos y pedidos para negocios.',
           cuerpo, actual='contacto', B=B)


# ---------------------------------------------------------------------------
# Créditos y 404
# ---------------------------------------------------------------------------
DESCRIPCION_FOTOS = {
    'moka-chorro': 'Café subiendo en la cafetera', 'colada-tacitas': 'Colada en tacitas', 'cortadito': 'Cortadito',
    'cafe-cubano-mostrador': 'Cafecito en el mostrador', 'cafecito-tacita': 'Tacita de café cubano',
    'cerezas-colombia': 'Cerezas de café en Colombia', 'cerezas-maduras': 'Cerezas de café maduras', 'cereza-arabica': 'Cereza de arábica',
    'domino-park': 'Parque del Dominó, Pequeña Habana', 'calle-ocho-mural': 'Mural de la Calle 8', 'calle-ocho-edificio': 'Edificio en la Calle Ocho',
    'cafetal-grabado': 'Vista de un cafetal (grabado, en duotono)', 'cafetal-postal': 'Cafetal en La Habana (postal antigua)',
    'pilon-vinales': 'Café en pilón cerca de Viñales', 'moka-bialetti': 'Cafetera italiana', 'moka-crema': 'Café en la cafetera',
    'moka-azul': 'Cafetera azul', 'terrazas-cafetal': 'Cafetal en Las Terrazas',
}
AUTORES = {'Berteun Damman (That\'s I)': 'Berteun Damman', 'Adam Jones from Kelowna, BC, Canada': 'Adam Jones',
           'U. S. Fish and Wildlife Service - Northeast Region': 'U.S. Fish and Wildlife Service', 'Unknown author': 'Autor desconocido'}
VIDEOS = [
    ('granos-1600', 'Granos tostados con vapor', 'https://mixkit.co/free-stock-video/roasted-coffee-beans-close-up-with-steam-100239/'),
    ('azucar', 'Azúcar en el espresso', 'https://mixkit.co/free-stock-video/sugar-being-poured-into-a-cup-of-espresso-46569/'),
    ('batir', 'Revolviendo el café', 'https://mixkit.co/free-stock-video/cup-of-espresso-being-stirred-with-a-spoon-46570/'),
    ('tostar-lena', 'Tostando café al fuego', 'https://mixkit.co/free-stock-video/person-roasting-coffee-beans-4676/'),
    ('vapor-taza', 'Taza con vapor', 'https://mixkit.co/free-stock-video/demonstration-video-of-a-steaming-cup-of-coffee-43935/'),
    ('espresso-chorro', 'Espresso saliendo de la máquina', 'https://mixkit.co/free-stock-video/cup-being-filled-with-coffee-in-a-coffee-machine-41865/'),
]


def pagina_creditos():
    B = ''
    items = ''
    for slug, c in CREDITOS.items():
        autor = AUTORES.get(c['artist'], c['artist']) or 'Autor desconocido'
        lic = 'Dominio público' if c['license'] == 'Public domain' else c['license']
        items += '<li><img src="assets/img/fotos/{}-800.webp" alt="" loading="lazy"><div><strong>{}</strong><span>Foto: {}. Licencia {}. <a href="{}" target="_blank" rel="noopener">Ver en Wikimedia Commons</a>.</span></div></li>'.format(
            slug, e(DESCRIPCION_FOTOS.get(slug, slug)), e(autor), e(lic), e(c['page']))
    vids = ''.join('<li><img src="assets/video/{}.webp" alt="" loading="lazy"><div><strong>{}</strong><span>Video de Mixkit, licencia gratuita de Mixkit. <a href="{}" target="_blank" rel="noopener">Ver original</a>.</span></div></li>'.format(n, t, u) for n, t, u in VIDEOS)
    otros = ('<li><img src="assets/img/fotos/granos-manos-800.webp" alt="" loading="lazy"><div><strong>Cerezas de café en la mano</strong><span>Imagen de la tienda de Café El Mío.</span></div></li>'
             '<li><img src="assets/img/fotos/guia-filtro-1280.webp" alt="" loading="lazy"><div><strong>Fotos de las recetas de goteo, prensa, espresso y café con leche</strong><span>Cuadros de videos de Mixkit (licencia gratuita de Mixkit).</span></div></li>')
    cuerpo = f'''
<section class="encabezado tema-oscuro">
  <div class="contenedor">
    <h1 class="encabezado__titulo">Créditos</h1>
    <p class="entrada">Las fotos de los productos son de Café El Mío. Estas son las demás imágenes y videos del sitio, con sus autores y licencias. Algunas fotos se recortaron o se pasaron a duotono.</p>
  </div>
</section>
<section class="tema-oscuro" style="padding-bottom:var(--seccion)">
  <div class="contenedor" style="display:grid;gap:56px">
    <div><h2 class="titulo-medio" style="margin-bottom:20px">Fotos</h2><ul class="creditos">{items}{otros}</ul></div>
    <div><h2 class="titulo-medio" style="margin-bottom:20px">Videos</h2><ul class="creditos">{vids}</ul></div>
  </div>
</section>
'''
    pagina('creditos.html', 'Créditos', 'Autores y licencias de las fotos y videos del sitio de Café El Mío.', cuerpo, B=B)


def pagina_404():
    B = ''
    cuerpo = '''
<section class="no-encontrada tema-oscuro">
  <div class="contenedor">
    <p class="no-encontrada__numero" aria-hidden="true">404</p>
    <h1 class="titulo-grande" style="margin-top:20px">Este café no está en el menú</h1>
    <p class="entrada" style="margin-top:20px">La página que buscas no existe o cambió de lugar.</p>
    <div class="portada__acciones" style="margin-top:32px">
      <a class="boton boton--ambar" href="index.html">Ir al inicio</a>
      <a class="boton boton--linea" href="tienda.html">Ver los cafés</a>
    </div>
  </div>
</section>
'''
    pagina('404.html', 'Página no encontrada', 'La página que buscas no existe.', cuerpo, B=B, base_href='/cafe-el-mio/')


if __name__ == '__main__':
    print('Generando páginas…')
    pagina_inicio()
    pagina_tienda()
    for producto in CATALOGO:
        pagina_producto(producto)
    pagina_historia()
    pagina_preparacion()
    pagina_contacto()
    pagina_creditos()
    pagina_404()
    print('Listo. Versión', VERSION)
