import 'fake-indexeddb/auto';
import { allowDemoData } from '../../src/services/session';

// Las pruebas unitarias trabajan sobre los datos de ejemplo (resetDemo): sin esto, la app los
// borraría al primer `ensureSeeded`, como hace con cualquier navegador. Las pruebas del arranque
// en blanco lo apagan a mano (`allowDemoData(false)` o `seedIfNeeded(now, { demo: false })`).
allowDemoData(true);
