import 'fake-indexeddb/auto';
import { setProgramLines } from '../../src/lines/programa';
import { exigirInicioDeSesion } from '../../src/services/puerta';
import { allowDemoData } from '../../src/services/session';

// Las pruebas unitarias trabajan sobre los datos de ejemplo (resetDemo): sin esto, la app los
// borraría al primer `ensureSeeded`, como hace con cualquier navegador. Las pruebas del arranque
// en blanco lo apagan a mano (`allowDemoData(false)` o `seedIfNeeded(now, { demo: false })`).
allowDemoData(true);

// Son pruebas del motor: usan las dos líneas (Tabaco y Café) a la vez. El programa publicado es solo
// de Tabaco; sus pruebas propias vuelven a lo normal con `setProgramLines(null)` (programa.test.ts).
setProgramLines(['tabaco', 'cafe']);

// El motor se prueba entrando con cualquier cuenta: la puerta del servidor (correo y contraseña)
// tiene sus propias pruebas (servidor-*.test.ts).
exigirInicioDeSesion(false);
