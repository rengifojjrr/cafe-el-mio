/* Catálogo de Café El Mío.
   Textos en español escritos para este sitio. Precios, variantes y disponibilidad
   salen de la tienda Shopify (cafe-el-mio.myshopify.com) y sitio.js los actualiza
   en vivo al cargar; estos valores son el respaldo si la tienda no responde. */
window.ELMIO = {
  tienda: 'https://cafe-el-mio.myshopify.com',
  idioma: 'es',
  contacto: {
    telefono: '+13052606647',
    telefonoTexto: '(305) 260-6647',
    correo: 'info@cafeelmio.com',
    instagram: 'https://www.instagram.com/cafeelmio',
    facebook: 'https://www.facebook.com/cafeelmio',
    ciudad: 'Miami, Florida 33172'
  },
  categorias: {
    espresso: 'Espresso cubano',
    origen: 'Cafés de origen',
    muestras: 'Muestras',
    te: 'Té',
    otros: 'Otros'
  },
  // Cómo se muestran en español las opciones que vienen de Shopify
  opciones: {
    Grind: 'Molido', Size: 'Tamaño', Title: 'Presentación',
    Coarse: 'Grueso', Espresso: 'Espresso (fino)', Standard: 'Medio', 'Whole Bean': 'En grano', 'Loose leaf': 'Hoja suelta',
    '12oz': '12 oz', '1 LB': '1 lb', '2 LB': '2 lb', '5 LB': '5 lb', '12 LB': '12 lb', '1oz': '1 oz',
    '12 Pack': '12 cápsulas', '6-count 2oz sample packs': '6 sobres de 2 oz', 'Default Title': 'Única'
  }
};

window.CATALOGO = [
 {
  "handle": "cafe-espresso-el-mio-100-arabica",
  "slug": "el-mio",
  "nombre": "Café Espresso El Mío",
  "categoria": "espresso",
  "etiqueta": "El de siempre",
  "corto": "100 % arábica, tueste oscuro y molido. 10 oz (283 g).",
  "descripcion": [
   "El café de la casa. Arábica de tueste oscuro, tostado y empacado en Miami y molido para que lo prepares como te guste: en la cafetera, en la máquina de espresso o en colador.",
   "Fuerte, aromático y con ese amargor que pide azúcar. Es el que se cuela por la mañana, el que se le brinda a la visita y el de la pausa de las 3:05."
  ],
  "ficha": [
   [
    "Tueste",
    "Oscuro"
   ],
   [
    "Presentación",
    "Molido"
   ],
   [
    "Peso neto",
    "10 oz (283 g)"
   ],
   [
    "Grano",
    "100 % arábica"
   ],
   [
    "Tostado y empacado",
    "Miami, Florida"
   ]
  ],
  "preparar": "Pensado para cafecito, colada y cortadito en cafetera. También funciona en máquina de espresso.",
  "tinte": "#3B2418",
  "tinteTexto": "#FFF8EC",
  "imagen": "assets/img/productos/cafe-espresso-el-mio-100-arabica.webp",
  "imagenChica": "assets/img/productos/cafe-espresso-el-mio-100-arabica-sm.webp",
  "opciones": [
   {
    "nombre": "Title",
    "valores": [
     "Default Title"
    ]
   }
  ],
  "variantes": [
   {
    "id": 39344740171944,
    "opciones": [
     "Default Title"
    ],
    "precio": 5.99,
    "antes": null,
    "disponible": true
   }
  ]
 },
 {
  "handle": "12-packs-cafe-espresso-el-mio",
  "slug": "el-mio-caja-24",
  "nombre": "El Mío, caja de 24",
  "categoria": "espresso",
  "etiqueta": "Para la casa que cuela todos los días",
  "corto": "24 paquetes de 10 oz de Café Espresso El Mío.",
  "descripcion": [
   "Veinticuatro paquetes de Café Espresso El Mío para que no falte en la casa, la oficina o el negocio.",
   "Cada paquete sale más barato que comprándolo suelto."
  ],
  "ficha": [
   [
    "Contenido",
    "24 paquetes de 10 oz (283 g)"
   ],
   [
    "Tueste",
    "Oscuro"
   ],
   [
    "Presentación",
    "Molido"
   ],
   [
    "Grano",
    "100 % arábica"
   ],
   [
    "Tostado y empacado",
    "Miami, Florida"
   ]
  ],
  "preparar": "El mismo Café Espresso El Mío de siempre, para cafetera o máquina de espresso.",
  "unidades": 24,
  "base": "cafe-espresso-el-mio-100-arabica",
  "tinte": "#4A2C1C",
  "tinteTexto": "#FFF8EC",
  "imagen": "assets/img/productos/12-packs-cafe-espresso-el-mio.webp",
  "imagenChica": "assets/img/productos/12-packs-cafe-espresso-el-mio-sm.webp",
  "opciones": [
   {
    "nombre": "Title",
    "valores": [
     "Default Title"
    ]
   }
  ],
  "variantes": [
   {
    "id": 39668442497192,
    "opciones": [
     "Default Title"
    ],
    "precio": 132.0,
    "antes": null,
    "disponible": true
   }
  ]
 },
 {
  "handle": "colombia",
  "slug": "colombia",
  "nombre": "Colombia",
  "categoria": "origen",
  "etiqueta": "Origen único",
  "notas": [
   "Naranja deshidratada",
   "Frutos rojos",
   "Chocolate"
  ],
  "corto": "Naranja deshidratada, frutos rojos y chocolate.",
  "descripcion": [
   "Café de pequeños caficultores de Antioquia, cultivado entre 1.300 y 1.500 metros en suelo volcánico.",
   "Se lava por completo y se seca en secadores solares que lo protegen de la lluvia. En la taza es dulce, con fruta y un final de chocolate."
  ],
  "ficha": [
   [
    "Tueste",
    "Medio"
   ],
   [
    "Productores",
    "Pequeños caficultores de Medellín"
   ],
   [
    "Región",
    "Medellín, Antioquia (Colombia)"
   ],
   [
    "Altitud",
    "1.300 a 1.500 m"
   ],
   [
    "Variedades",
    "Castillo, Caturra, Colombia y Típica"
   ],
   [
    "Suelo",
    "Franco volcánico"
   ],
   [
    "Proceso",
    "Lavado y secado en secadores solares"
   ]
  ],
  "preparar": "Molido medio para goteo, grueso para prensa francesa o espresso para cafetera.",
  "tinte": "#E2945E",
  "tinteTexto": "#22140D",
  "imagen": "assets/img/productos/colombia.webp",
  "imagenChica": "assets/img/productos/colombia-sm.webp",
  "opciones": [
   {
    "nombre": "Grind",
    "valores": [
     "Coarse",
     "Espresso",
     "Standard",
     "Whole Bean"
    ]
   },
   {
    "nombre": "Size",
    "valores": [
     "12oz",
     "1 LB",
     "2 LB",
     "5 LB",
     "12 LB"
    ]
   }
  ],
  "variantes": [
   {
    "id": 55754438607016,
    "opciones": [
     "Coarse",
     "12oz"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754438639784,
    "opciones": [
     "Coarse",
     "1 LB"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754438672552,
    "opciones": [
     "Coarse",
     "2 LB"
    ],
    "precio": 39.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754438705320,
    "opciones": [
     "Coarse",
     "5 LB"
    ],
    "precio": 79.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754438738088,
    "opciones": [
     "Coarse",
     "12 LB"
    ],
    "precio": 169.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754438770856,
    "opciones": [
     "Espresso",
     "12oz"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754438803624,
    "opciones": [
     "Espresso",
     "1 LB"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754438836392,
    "opciones": [
     "Espresso",
     "2 LB"
    ],
    "precio": 39.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754438869160,
    "opciones": [
     "Espresso",
     "5 LB"
    ],
    "precio": 79.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754438901928,
    "opciones": [
     "Espresso",
     "12 LB"
    ],
    "precio": 169.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754438934696,
    "opciones": [
     "Standard",
     "12oz"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754438967464,
    "opciones": [
     "Standard",
     "1 LB"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754439000232,
    "opciones": [
     "Standard",
     "2 LB"
    ],
    "precio": 39.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754439033000,
    "opciones": [
     "Standard",
     "5 LB"
    ],
    "precio": 79.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754439065768,
    "opciones": [
     "Standard",
     "12 LB"
    ],
    "precio": 169.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754439098536,
    "opciones": [
     "Whole Bean",
     "12oz"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754439131304,
    "opciones": [
     "Whole Bean",
     "1 LB"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754439164072,
    "opciones": [
     "Whole Bean",
     "2 LB"
    ],
    "precio": 39.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754439196840,
    "opciones": [
     "Whole Bean",
     "5 LB"
    ],
    "precio": 79.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754439229608,
    "opciones": [
     "Whole Bean",
     "12 LB"
    ],
    "precio": 169.99,
    "antes": null,
    "disponible": true
   }
  ]
 },
 {
  "handle": "costa-rica",
  "slug": "costa-rica",
  "nombre": "Costa Rica",
  "categoria": "origen",
  "etiqueta": "Origen único",
  "notas": [
   "Manzana dulce",
   "Pasas",
   "Miel"
  ],
  "corto": "Manzana dulce, pasas y miel.",
  "descripcion": [
   "Viene de microfincas de Alajuela, entre 1.300 y 1.445 metros, en suelo volcánico.",
   "Se despulpa con un proceso ecológico y se seca al sol. Es un café meloso, de los que se disfrutan solos."
  ],
  "ficha": [
   [
    "Tueste",
    "Medio"
   ],
   [
    "Productores",
    "Microfincas de Alajuela"
   ],
   [
    "Región",
    "Alajuela (Costa Rica)"
   ],
   [
    "Altitud",
    "1.300 a 1.445 m"
   ],
   [
    "Variedades",
    "Caturra y Catuaí"
   ],
   [
    "Suelo",
    "Franco volcánico"
   ],
   [
    "Proceso",
    "Despulpado ecológico y secado al sol"
   ]
  ],
  "preparar": "Brilla en goteo y en prensa francesa. Pídelo en grano si lo mueles en casa.",
  "tinte": "#E9C46F",
  "tinteTexto": "#22140D",
  "imagen": "assets/img/productos/costa-rica.webp",
  "imagenChica": "assets/img/productos/costa-rica-sm.webp",
  "opciones": [
   {
    "nombre": "Grind",
    "valores": [
     "Coarse",
     "Espresso",
     "Standard",
     "Whole Bean"
    ]
   },
   {
    "nombre": "Size",
    "valores": [
     "12oz",
     "1 LB",
     "2 LB",
     "5 LB",
     "12 LB"
    ]
   }
  ],
  "variantes": [
   {
    "id": 55754440179880,
    "opciones": [
     "Coarse",
     "12oz"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440212648,
    "opciones": [
     "Coarse",
     "1 LB"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440245416,
    "opciones": [
     "Coarse",
     "2 LB"
    ],
    "precio": 39.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440278184,
    "opciones": [
     "Coarse",
     "5 LB"
    ],
    "precio": 79.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440310952,
    "opciones": [
     "Coarse",
     "12 LB"
    ],
    "precio": 169.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440343720,
    "opciones": [
     "Espresso",
     "12oz"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440376488,
    "opciones": [
     "Espresso",
     "1 LB"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440409256,
    "opciones": [
     "Espresso",
     "2 LB"
    ],
    "precio": 39.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440442024,
    "opciones": [
     "Espresso",
     "5 LB"
    ],
    "precio": 79.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440474792,
    "opciones": [
     "Espresso",
     "12 LB"
    ],
    "precio": 169.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440507560,
    "opciones": [
     "Standard",
     "12oz"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440540328,
    "opciones": [
     "Standard",
     "1 LB"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440573096,
    "opciones": [
     "Standard",
     "2 LB"
    ],
    "precio": 39.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440605864,
    "opciones": [
     "Standard",
     "5 LB"
    ],
    "precio": 79.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440638632,
    "opciones": [
     "Standard",
     "12 LB"
    ],
    "precio": 169.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440671400,
    "opciones": [
     "Whole Bean",
     "12oz"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440704168,
    "opciones": [
     "Whole Bean",
     "1 LB"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440736936,
    "opciones": [
     "Whole Bean",
     "2 LB"
    ],
    "precio": 39.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440769704,
    "opciones": [
     "Whole Bean",
     "5 LB"
    ],
    "precio": 79.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754440802472,
    "opciones": [
     "Whole Bean",
     "12 LB"
    ],
    "precio": 169.99,
    "antes": null,
    "disponible": true
   }
  ]
 },
 {
  "handle": "peru-coffee-pods",
  "slug": "peru-capsulas",
  "nombre": "Perú en cápsulas",
  "categoria": "origen",
  "etiqueta": "Origen único",
  "notas": [
   "Caramelo salado",
   "Dulzor sedoso",
   "Cítricos"
  ],
  "corto": "12 cápsulas de una taza. Caramelo salado, dulzor sedoso y cítricos.",
  "descripcion": [
   "Café de la Cooperativa Norandino, en Piura y Amazonas, cultivado entre 1.100 y 1.700 metros.",
   "Viene en cápsulas de una sola taza para cuando no hay tiempo de montar la cafetera."
  ],
  "ficha": [
   [
    "Tueste",
    "Medio"
   ],
   [
    "Presentación",
    "12 cápsulas de una taza"
   ],
   [
    "Productores",
    "Cooperativa Norandino"
   ],
   [
    "Región",
    "Piura y Amazonas (Perú)"
   ],
   [
    "Altitud",
    "1.100 a 1.700 m"
   ],
   [
    "Variedades",
    "Caturra, Bourbon, Catuaí, Pache y Catimor"
   ],
   [
    "Suelo",
    "Arcilloso, rico en minerales"
   ],
   [
    "Proceso",
    "Lavado y secado al sol"
   ]
  ],
  "preparar": "Una cápsula por taza en tu cafetera de cápsulas.",
  "tinte": "#D9A274",
  "tinteTexto": "#22140D",
  "imagen": "assets/img/productos/peru-coffee-pods.webp",
  "imagenChica": "assets/img/productos/peru-coffee-pods-sm.webp",
  "opciones": [
   {
    "nombre": "Grind",
    "valores": [
     "Standard"
    ]
   },
   {
    "nombre": "Size",
    "valores": [
     "12 Pack"
    ]
   }
  ],
  "variantes": [
   {
    "id": 55754441162920,
    "opciones": [
     "Standard",
     "12 Pack"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   }
  ]
 },
 {
  "handle": "african-espresso",
  "slug": "espresso-africano",
  "nombre": "Espresso Africano",
  "categoria": "origen",
  "etiqueta": "Mezcla",
  "origenes": [
   "Kenia",
   "Tanzania",
   "Etiopía"
  ],
  "corto": "Mezcla de Kenia, Tanzania y Etiopía. Tueste medio-oscuro.",
  "descripcion": [
   "Una mezcla de cafés de Kenia, Tanzania y Etiopía con tueste medio-oscuro, pensada para el espresso.",
   "Elige el molido según tu cafetera, o llévalo en grano si lo mueles en casa."
  ],
  "ficha": [
   [
    "Tueste",
    "Medio-oscuro"
   ],
   [
    "Origen",
    "Kenia, Tanzania y Etiopía"
   ]
  ],
  "preparar": "Molido espresso para máquina o cafetera.",
  "tinte": "#8E3B4E",
  "tinteTexto": "#FFF8EC",
  "imagen": "assets/img/productos/african-espresso.webp",
  "imagenChica": "assets/img/productos/african-espresso-sm.webp",
  "opciones": [
   {
    "nombre": "Grind",
    "valores": [
     "Coarse",
     "Espresso",
     "Standard",
     "Whole Bean"
    ]
   },
   {
    "nombre": "Size",
    "valores": [
     "12oz",
     "1 LB",
     "2 LB",
     "5 LB",
     "12 LB"
    ]
   }
  ],
  "variantes": [
   {
    "id": 55754375266472,
    "opciones": [
     "Coarse",
     "12oz"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375299240,
    "opciones": [
     "Coarse",
     "1 LB"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375332008,
    "opciones": [
     "Coarse",
     "2 LB"
    ],
    "precio": 39.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375364776,
    "opciones": [
     "Coarse",
     "5 LB"
    ],
    "precio": 79.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375397544,
    "opciones": [
     "Coarse",
     "12 LB"
    ],
    "precio": 169.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375430312,
    "opciones": [
     "Espresso",
     "12oz"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375463080,
    "opciones": [
     "Espresso",
     "1 LB"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375495848,
    "opciones": [
     "Espresso",
     "2 LB"
    ],
    "precio": 39.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375528616,
    "opciones": [
     "Espresso",
     "5 LB"
    ],
    "precio": 79.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375561384,
    "opciones": [
     "Espresso",
     "12 LB"
    ],
    "precio": 169.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375594152,
    "opciones": [
     "Standard",
     "12oz"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375626920,
    "opciones": [
     "Standard",
     "1 LB"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375659688,
    "opciones": [
     "Standard",
     "2 LB"
    ],
    "precio": 39.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375692456,
    "opciones": [
     "Standard",
     "5 LB"
    ],
    "precio": 79.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375725224,
    "opciones": [
     "Standard",
     "12 LB"
    ],
    "precio": 169.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375757992,
    "opciones": [
     "Whole Bean",
     "12oz"
    ],
    "precio": 18.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375790760,
    "opciones": [
     "Whole Bean",
     "1 LB"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375823528,
    "opciones": [
     "Whole Bean",
     "2 LB"
    ],
    "precio": 39.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375856296,
    "opciones": [
     "Whole Bean",
     "5 LB"
    ],
    "precio": 79.99,
    "antes": null,
    "disponible": true
   },
   {
    "id": 55754375889064,
    "opciones": [
     "Whole Bean",
     "12 LB"
    ],
    "precio": 169.99,
    "antes": null,
    "disponible": true
   }
  ]
 },
 {
  "handle": "best-sellers-sample-pack-6bean-cowboy-breakfast-peru-mexico-bali",
  "slug": "muestras-favoritos",
  "nombre": "Muestras: los favoritos",
  "categoria": "muestras",
  "etiqueta": "Para probar",
  "corto": "6 sobres de 2 oz con los cafés más vendidos.",
  "descripcion": [
   "Seis sobres de 2 oz para descubrir tu favorito antes de llevarte la bolsa grande."
  ],
  "contenido": [
   [
    "6Bean Blend",
    "Tueste oscuro. La mezcla de la casa, ideal para espresso."
   ],
   [
    "Cowboy Blend",
    "Tueste oscuro y medio. Cacao, caramelo y vainilla."
   ],
   [
    "Breakfast Blend",
    "Tueste medio. Mezcla suave de Suramérica."
   ],
   [
    "Perú",
    "Tueste medio. Caramelo salado, dulzor sedoso y cítricos."
   ],
   [
    "México",
    "Tueste medio. Chocolate, canela y manzana verde."
   ],
   [
    "Bali",
    "Tueste medio-oscuro. Chocolate amargo, melaza y azúcar morena."
   ]
  ],
  "ficha": [
   [
    "Contenido",
    "6 sobres de 2 oz"
   ],
   [
    "Molido",
    "Medio"
   ]
  ],
  "preparar": "Cada sobre rinde para una cafetera de goteo pequeña o una prensa francesa.",
  "tinte": "#C49A6C",
  "tinteTexto": "#22140D",
  "imagen": "assets/img/productos/best-sellers-sample-pack-6bean-cowboy-breakfast-peru-mexico-bali.webp",
  "imagenChica": "assets/img/productos/best-sellers-sample-pack-6bean-cowboy-breakfast-peru-mexico-bali-sm.webp",
  "opciones": [
   {
    "nombre": "Grind",
    "valores": [
     "Standard"
    ]
   },
   {
    "nombre": "Size",
    "valores": [
     "6-count 2oz sample packs"
    ]
   }
  ],
  "variantes": [
   {
    "id": 55754372350120,
    "opciones": [
     "Standard",
     "6-count 2oz sample packs"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   }
  ]
 },
 {
  "handle": "flavored-coffees-sample-pack",
  "slug": "muestras-saborizados",
  "nombre": "Muestras: saborizados",
  "categoria": "muestras",
  "etiqueta": "Para probar",
  "corto": "6 sobres de 2 oz: vainilla, avellana, canela, caramelo, moca y canela con avellana.",
  "descripcion": [
   "Todos parten de café de especialidad de un solo origen, tostado en lotes pequeños a punto medio. Cada pedido se aromatiza todavía tibio con aceites saborizantes de alta calidad.",
   "Saborizantes naturales."
  ],
  "contenido": [
   [
    "Vainilla francesa",
    "Cremosa, redonda y suave."
   ],
   [
    "Avellana",
    "Sabor a nuez sobre café de Brasil."
   ],
   [
    "Rollo de canela",
    "Todo el sabor, sin azúcar ni calorías añadidas."
   ],
   [
    "Caramelo",
    "Dulce y mantecoso. Va solo o como base de bebidas frías."
   ],
   [
    "Moca",
    "Chocolate intenso sobre arábica de tueste medio."
   ],
   [
    "Canela y avellana",
    "Una taza suave y redonda."
   ]
  ],
  "ficha": [
   [
    "Contenido",
    "6 sobres de 2 oz"
   ],
   [
    "Tueste",
    "Medio"
   ],
   [
    "Molido",
    "Medio"
   ]
  ],
  "preparar": "Perfectos en cafetera de goteo. Con leche, mejor.",
  "tinte": "#EBD5AE",
  "tinteTexto": "#22140D",
  "imagen": "assets/img/productos/flavored-coffees-sample-pack.webp",
  "imagenChica": "assets/img/productos/flavored-coffees-sample-pack-sm.webp",
  "opciones": [
   {
    "nombre": "Grind",
    "valores": [
     "Standard"
    ]
   },
   {
    "nombre": "Size",
    "valores": [
     "6-count 2oz sample packs"
    ]
   }
  ],
  "variantes": [
   {
    "id": 55754372710568,
    "opciones": [
     "Standard",
     "6-count 2oz sample packs"
    ],
    "precio": 24.99,
    "antes": null,
    "disponible": true
   }
  ]
 },
 {
  "handle": "matcha",
  "slug": "matcha",
  "nombre": "Matcha",
  "categoria": "te",
  "etiqueta": "Té",
  "corto": "Té en hoja suelta, 1 oz.",
  "descripcion": [
   "Refinado y persistente, pensado para la preparación tradicional y para los rituales de todos los días."
  ],
  "ficha": [
   [
    "Presentación",
    "Hoja suelta"
   ],
   [
    "Peso",
    "1 oz"
   ]
  ],
  "preparar": "Agua caliente sin hervir y un batidor de bambú.",
  "tinte": "#A6B98A",
  "tinteTexto": "#22140D",
  "imagen": "assets/img/productos/matcha.webp",
  "imagenChica": "assets/img/productos/matcha-sm.webp",
  "opciones": [
   {
    "nombre": "Grind",
    "valores": [
     "Loose leaf"
    ]
   },
   {
    "nombre": "Size",
    "valores": [
     "1oz"
    ]
   }
  ],
  "variantes": [
   {
    "id": 55754366910632,
    "opciones": [
     "Loose leaf",
     "1oz"
    ],
    "precio": 21.99,
    "antes": null,
    "disponible": true
   }
  ]
 }
];
