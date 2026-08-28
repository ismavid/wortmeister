/* Wortmeister — German A1–B2 vocabulary trainer.
   Phase 1: triage sprint, flip cards, SM-2 + response-time scheduling,
   IndexedDB persistence, backup/restore, PWA install.
   Phase 2: typing mode, article drill, per-word mode progression, pacing panel.
   No framework, no build step. */
'use strict';

/* ============================ config ============================ */
const CFG = {
  data: 'data/vocab.v1.json',
  // a SEPARATE file keyed by the ids already in vocab.v1.json — the vocabulary
  // is never edited, so no id can move and no progress can be re-pointed
  sentences: 'data/sentences.v1.json',
  dbName: 'wortmeister', dbVer: 1,
  MIN: 60000, DAY: 86400000,
  LEARN_STEPS: [10 * 60000, 86400000],   // 10 min, 1 day
  GRAD: 3, GRAD_EASY: 5,                 // graduating intervals (days)
  EASE_MIN: 1.3, EASE_MAX: 3.0, EASE_START: 2.5,
  LEECH_AT: 8,
  FAST: 0.6, SLOW: 2.0,                  // response-time multipliers
  MED_WINDOW: 50, MED_CAP: 60000,
  TYPO_MIN_LEN: 5,                       // Levenshtein slack only above this
  MAX_REENTRY: 4,                        // re-looks per word per session
  // Cards to let past before a re-looked word comes back. Expanding, because
  // expanding retrieval beats a fixed gap — and bounded, because appending to
  // the end of a 231-card queue meant ~23 minutes before you saw it again,
  // which is not relearning, it is just failing twice.
  REENTRY_GAPS: [2, 5, 10, 18],
  MATCH_PAIRS: 6,                        // words per pairing round
  MATCH_EVERY: 22,                       // cards between pairing rounds
  SETTINGS_DEBOUNCE: 1500,
  FUZZ: 1,                               // interval jitter on; 0 disables (tests)
  FUZZ_MIN_INTERVAL: 3,                  // 1–2 day intervals stay exact
  SIBLING_GAP: 5,                        // cards to keep between related words
  MASTER_DAYS: 21,                       // interval at which a word is "learned"
  MIN_DAY: 20,                           // cards that still count as a day done
  FREEZE_EVERY: 7,                       // clean days earned per streak freeze
  FREEZE_MAX: 2,
  defaults: {
    exam: '2026-11-11', newPerDay: 0, maxReviews: 250,
    scope: { A1: true, A2: true, B1: true, 'B2-core': true, 'B2-extended': false },
    streak: 0, lastDay: null, history: {}, medians: {}, speak: false, lang: 'en'
  }
};
const G = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 };
/* Mode labels name the task, not the internal key — the pill is the only
   thing telling you what this card is going to ask for. */
const MODE_LABEL = {
  de2en: 'German → English', en2de: 'English → German', type: 'Type it',
  article: 'Article', verb: 'Verb forms', rection: 'Preposition',
  match: 'Match', cloze: 'In a sentence', hint: 'Fill it in'
};
/* How much of the word the "Fill it in" mode gives away, by level.
   Level rises only when you answer correctly — getting it wrong should never
   buy you less help — and drops back one on a miss. */
const HINT_SHARE = [0.5, 0.25, 0];
const HINT_MAX = HINT_SHARE.length - 1;
/* Gender gets a constant shape because colour is already spoken for by the
   CEFR ambient. One silent, repeated cue across ~5,700 nouns. */
const GENDER_SHAPE = { der: '▲', die: '●', das: '■' };

/* ============================ language ============================
   The interface speaks English or Spanish; the vocabulary does not. Word
   meanings stay English because `en` is the only gloss the data carries, so
   switching language must never imply the cards themselves were translated.

   `lang` is a settings field defaulting to 'en', so an existing install reads
   as English without its stored settings being rewritten — boot never saves,
   and review records live in a different store entirely. Nothing here can
   touch progress. */
const I18N = {
  en: {
    'loading': 'Loading vocabulary…',
    'err.title': 'Could not load the app',
    'err.load': 'Check your connection and reload',

    'nav.home': 'Home', 'nav.browse': 'Words',
    'nav.stats': 'Stats', 'nav.settings': 'Settings',

    'home.notStarted': 'not started yet',
    'home.doneToday': 'done for today',
    'home.ofToday': 'of {n} today',
    'home.countdown': '{n} days until the exam',
    'home.startSorting': 'Start sorting',
    'home.sortMore': 'Sort {n} more',
    'home.study': 'Study — {n} cards',
    'home.sortWords': 'Sort words — {n} left',
    'home.nothingDue': 'Nothing due today',

    'guide.title': 'Start by sorting your words',
    'guide.1': 'Each word appears once. Mark the ones you already know so they never enter your study queue.',
    'guide.2': 'Aim for about a second per word — swipe right if you know it, left to learn it.',
    'guide.3': 'Sort the A1–B1 words before you start studying, or the queue fills up with words you already know.',

    'install.title': 'Add this to your Home Screen',
    'install.body': 'Safari deletes all data for this site after 7 days. Added to the Home Screen, it runs as an app and your progress survives.',
    'install.share': 'Share ⍋ → “Add to Home Screen”.',
    'install.ok': '✓ Installed as an app',
    'install.okBody': 'Your progress is safe from the 7-day data purge in Safari.',

    'ms.week': '<b>{done}</b> of {target} this week',
    'ms.lastDay': 'last day',
    'ms.dayLeft': '{n} day left',
    'ms.daysLeft': '{n} days left',
    'ms.mastered': '<b>{n}</b> mastered',
    'ms.learning': '<b>{n}</b> learning',
    'ms.toGo': '{n} to go',
    'ms.est': ' (est.)',

    'tg.question': 'Do you already know this word?',
    'tg.learn': 'Learn it', 'tg.learnSub': 'do not know it',
    'tg.unsure': 'Not sure', 'tg.unsureSub': 'maybe',
    'tg.know': 'I know it', 'tg.knowSub': 'never ask again',
    'tg.undo': 'Undo last', 'tg.technical': 'Technical',

    'st.title': 'Study',
    'st.tapReveal': 'Tap to reveal',
    'st.showAnswer': 'Show answer',
    'st.again': 'Again', 'st.hard': 'Hard', 'st.good': 'Good', 'st.easy': 'Easy',
    'st.knowNever': 'I know this — never ask again',
    'st.check': 'Check', 'st.continue': 'Continue', 'st.backHome': 'Back to home',
    'st.typeGerman': 'Type the German',
    'st.typeGermanAria': 'Type the German word',
    'st.dative': 'Dative', 'st.accusative': 'Accusative',
    'st.close': 'Close',
    'st.prt': 'Präteritum (simple past)',
    'st.pp': 'Partizip II (past participle)',
    'st.correct': 'Correct', 'st.almost': 'Almost', 'st.notQuite': 'Not quite',
    'st.fillRest': 'Fill in the rest',
    'st.noHelp': 'No help left',
    'st.noHelpArticle': 'No help left — include the article',
    'st.includeArticle': 'Include the article',
    'st.whichArticle': 'Which article?',
    'st.whichCase': 'Which case does it take?',
    'st.whichPrep': 'Which preposition?',
    'st.whichWord': 'Which word fits?',
    'st.matchPairs': 'Match the pairs',
    'st.matchSub': 'tap a word, then its meaning',
    'st.verbSub': 'Simple past, past participle, and haben or sein',
    'st.answer': 'Answer: ', 'st.spelling': 'Spelling: ',
    'st.youWrote': 'You wrote',
    'st.youChose': 'You chose',
    'st.prepWrongCase': 'Right preposition, wrong case<br>Answer: ',
    'st.allDone': 'That is everything due today',
    'st.comeBack': 'Come back tomorrow, or sort more words',

    'mode.de2en': 'German → English', 'mode.en2de': 'English → German',
    'mode.type': 'Type it', 'mode.article': 'Article', 'mode.verb': 'Verb forms',
    'mode.rection': 'Preposition', 'mode.match': 'Match',
    'mode.cloze': 'In a sentence', 'mode.hint': 'Fill it in',

    'br.title': 'Words',
    'br.search': 'Search German or English',
    'br.allLevels': 'All levels', 'br.allWords': 'All words',
    'br.notSorted': 'Not sorted', 'br.learning': 'Learning',
    'br.inReview': 'In review', 'br.known': 'Known', 'br.difficult': 'Difficult',
    'br.tapHint': 'Tap to mark known · tap again to undo',
    'br.noMatch': 'No words match that',
    'br.backQueue': 'Back in the queue — tap again to mark it known',
    'br.markedKnown': 'Marked as known — tap again to undo',

    'stats.title': 'Stats',
    'stats.today': 'Today', 'stats.due': 'Due', 'stats.newWords': 'New words',
    'stats.leftToSort': 'Left to sort',
    'stats.consistency': 'Consistency', 'stats.streak': 'Streak',
    'stats.freezes': 'Streak freezes banked',
    'stats.pace': 'Pace', 'stats.needed': 'Needed per day',
    'stats.yourAvg': 'Your average', 'stats.status': 'Status',
    'stats.sortFirst': 'Sort first', 'stats.onTrack': 'On track',
    'stats.behind': 'Behind',
    'stats.where': 'Where your words are',
    'stats.waiting': 'Sorted, waiting', 'stats.notSortedYet': 'Not sorted yet',
    'stats.byExercise': 'By exercise',
    'stats.willYouMakeIt': 'Will you make it',
    'stats.retention': 'Answers you got right (30 days)',
    'stats.knewRate': 'You already knew, of what you sorted',
    'stats.target': 'Words you will need to learn',
    'stats.masteredSoFar': 'Mastered so far', 'stats.stillLearning': 'Still learning',
    'stats.thisWeek': 'This week', 'stats.leftToLearn': 'Words left to learn',
    'stats.finishedBy': 'Finished by', 'stats.exam': 'Exam',
    'stats.noData': 'not enough data yet',
    'stats.leechTitle': 'Words that keep beating you',
    'stats.leechSub': 'Wrong eight times, so they are paused. Tap one to start it over from the beginning.',
    'stats.restart': 'restart', 'stats.restartAll': 'Restart all {n}',
    'stats.backOne': '{n} word is back in the queue',
    'stats.backMany': '{n} words are back in the queue',
    'stats.startingOver': '{w} — starting over',
    'stats.ofTarget': '{done} of {target}',

    'set.title': 'Settings',
    'set.exam': 'Exam', 'set.examDate': 'Exam date',
    'set.newPerDay': 'New words per day (0 = work it out for me)',
    'set.maxReviews': 'Maximum reviews per day',
    'set.voice': 'Voice', 'set.readAloud': 'Read answers aloud',
    'set.voiceSub': 'German answers are read in German, English answers in English. Tap a revealed answer to hear it again.',
    'set.language': 'Language',
    'set.languageSub': 'Interface language only. Word meanings stay in English — that is the only gloss the vocabulary data carries.',
    'set.whatToStudy': 'What to study',
    'set.data': 'Data',
    'set.dataSub': 'Safari deletes website data after 7 days. Apps added to the Home Screen are exempt — but back up regularly anyway.',
    'set.backup': 'Back up', 'set.restore': 'Restore',
    'set.reset': 'Reset everything',
    'set.words': '{n} words · data v1',
    'set.sentences': 'Example sentences from Tatoeba (CC BY 2.0 FR)',

    'toast.voiceOn': 'Answers will be read aloud',
    'toast.voiceOff': 'Voice off',
    'toast.scope': 'Scope updated',
    'toast.backup': 'Backup saved to your downloads',
    'toast.restored': 'Restored {n} words',
    'toast.restoreFail': 'Could not restore — {e}',
    'toast.reset': 'Everything reset',
    'toast.lang': 'Interface language changed',
    'confirm.reset': 'Delete all your progress? This cannot be undone. Back up first if you are not sure.',
    'err.notBackup': 'that is not a Wortmeister backup',

    'u.day': 'day', 'u.days': 'days',
    'u.word': 'word', 'u.words': 'words',
    'u.freeze': 'freeze', 'u.freezes': 'freezes',
    'u.dow': 'Sun Mon Tue Wed Thu Fri Sat'
  },

  es: {
    'loading': 'Cargando vocabulario…',
    'err.title': 'No se pudo cargar la app',
    'err.load': 'Revisa tu conexión y recarga',

    'nav.home': 'Inicio', 'nav.browse': 'Palabras',
    'nav.stats': 'Progreso', 'nav.settings': 'Ajustes',

    'home.notStarted': 'aún sin empezar',
    'home.doneToday': 'listo por hoy',
    'home.ofToday': 'de {n} hoy',
    'home.countdown': '{n} días para el examen',
    'home.startSorting': 'Empezar a clasificar',
    'home.sortMore': 'Clasificar {n} más',
    'home.study': 'Estudiar — {n} tarjetas',
    'home.sortWords': 'Clasificar — faltan {n}',
    'home.nothingDue': 'Nada pendiente hoy',

    'guide.title': 'Empieza clasificando tus palabras',
    'guide.1': 'Cada palabra aparece una vez. Marca las que ya conoces para que nunca entren en tu cola de estudio.',
    'guide.2': 'Apunta a un segundo por palabra: desliza a la derecha si la conoces, a la izquierda para aprenderla.',
    'guide.3': 'Clasifica las palabras A1–B1 antes de empezar a estudiar, o la cola se llenará de palabras que ya conoces.',

    'install.title': 'Añade esto a tu pantalla de inicio',
    'install.body': 'Safari borra todos los datos de este sitio a los 7 días. Añadida a la pantalla de inicio funciona como app y tu progreso sobrevive.',
    'install.share': 'Compartir ⍋ → “Añadir a pantalla de inicio”.',
    'install.ok': '✓ Instalada como app',
    'install.okBody': 'Tu progreso está a salvo del borrado de datos de Safari a los 7 días.',

    'ms.week': '<b>{done}</b> de {target} esta semana',
    'ms.lastDay': 'último día',
    'ms.dayLeft': 'queda {n} día',
    'ms.daysLeft': 'quedan {n} días',
    'ms.mastered': '<b>{n}</b> dominadas',
    'ms.learning': '<b>{n}</b> aprendiendo',
    'ms.toGo': 'faltan {n}',
    'ms.est': ' (aprox.)',

    'tg.question': '¿Ya conoces esta palabra?',
    'tg.learn': 'Aprenderla', 'tg.learnSub': 'no la conozco',
    'tg.unsure': 'No estoy seguro', 'tg.unsureSub': 'tal vez',
    'tg.know': 'La conozco', 'tg.knowSub': 'no preguntar más',
    'tg.undo': 'Deshacer', 'tg.technical': 'Técnica',

    'st.title': 'Estudiar',
    'st.tapReveal': 'Toca para ver',
    'st.showAnswer': 'Ver respuesta',
    'st.again': 'Otra vez', 'st.hard': 'Difícil', 'st.good': 'Bien',
    'st.easy': 'Fácil',
    'st.knowNever': 'Ya la sé — no preguntar más',
    'st.check': 'Comprobar', 'st.continue': 'Continuar',
    'st.backHome': 'Volver al inicio',
    'st.typeGerman': 'Escribe en alemán',
    'st.typeGermanAria': 'Escribe la palabra en alemán',
    'st.dative': 'Dativo', 'st.accusative': 'Acusativo',
    'st.close': 'Cerrar',
    'st.prt': 'Präteritum (pretérito)',
    'st.pp': 'Partizip II (participio)',
    'st.correct': 'Correcto', 'st.almost': 'Casi', 'st.notQuite': 'No exactamente',
    'st.fillRest': 'Completa el resto',
    'st.noHelp': 'Sin ayuda',
    'st.noHelpArticle': 'Sin ayuda — incluye el artículo',
    'st.includeArticle': 'Incluye el artículo',
    'st.whichArticle': '¿Qué artículo?',
    'st.whichCase': '¿Qué caso rige?',
    'st.whichPrep': '¿Qué preposición?',
    'st.whichWord': '¿Qué palabra encaja?',
    'st.matchPairs': 'Une las parejas',
    'st.matchSub': 'toca una palabra y luego su significado',
    'st.verbSub': 'Pretérito, participio y haben o sein',
    'st.answer': 'Respuesta: ', 'st.spelling': 'Ortografía: ',
    'st.youWrote': 'Escribiste',
    'st.youChose': 'Elegiste',
    'st.prepWrongCase': 'Preposición correcta, caso incorrecto<br>Respuesta: ',
    'st.allDone': 'Eso es todo lo pendiente de hoy',
    'st.comeBack': 'Vuelve mañana, o clasifica más palabras',

    'mode.de2en': 'Alemán → Inglés',
    'mode.en2de': 'Inglés → Alemán',
    'mode.type': 'Escríbela', 'mode.article': 'Artículo',
    'mode.verb': 'Formas verbales',
    'mode.rection': 'Preposición', 'mode.match': 'Parejas',
    'mode.cloze': 'En una frase', 'mode.hint': 'Complétala',

    'br.title': 'Palabras',
    'br.search': 'Buscar en alemán o inglés',
    'br.allLevels': 'Todos los niveles', 'br.allWords': 'Todas las palabras',
    'br.notSorted': 'Sin clasificar', 'br.learning': 'Aprendiendo',
    'br.inReview': 'En repaso', 'br.known': 'Conocidas',
    'br.difficult': 'Difíciles',
    'br.tapHint': 'Toca para marcar conocida · toca otra vez para deshacer',
    'br.noMatch': 'Ninguna palabra coincide',
    'br.backQueue': 'De vuelta en la cola — toca otra vez para marcarla conocida',
    'br.markedKnown': 'Marcada como conocida — toca otra vez para deshacer',

    'stats.title': 'Progreso',
    'stats.today': 'Hoy', 'stats.due': 'Pendientes',
    'stats.newWords': 'Palabras nuevas',
    'stats.leftToSort': 'Por clasificar',
    'stats.consistency': 'Constancia', 'stats.streak': 'Racha',
    'stats.freezes': 'Congelaciones guardadas',
    'stats.pace': 'Ritmo', 'stats.needed': 'Necesarias por día',
    'stats.yourAvg': 'Tu promedio', 'stats.status': 'Estado',
    'stats.sortFirst': 'Clasifica primero', 'stats.onTrack': 'Al día',
    'stats.behind': 'Atrasado',
    'stats.where': 'Dónde están tus palabras',
    'stats.waiting': 'Clasificadas, en espera',
    'stats.notSortedYet': 'Sin clasificar',
    'stats.byExercise': 'Por ejercicio',
    'stats.willYouMakeIt': '¿Vas a llegar?',
    'stats.retention': 'Respuestas correctas (30 días)',
    'stats.knewRate': 'Ya conocías, de lo que clasificaste',
    'stats.target': 'Palabras que tendrás que aprender',
    'stats.masteredSoFar': 'Dominadas hasta ahora',
    'stats.stillLearning': 'Aún aprendiendo',
    'stats.thisWeek': 'Esta semana',
    'stats.leftToLearn': 'Palabras por aprender',
    'stats.finishedBy': 'Terminarás el', 'stats.exam': 'Examen',
    'stats.noData': 'aún sin datos suficientes',
    'stats.leechTitle': 'Palabras que se te resisten',
    'stats.leechSub': 'Falladas ocho veces, así que están pausadas. Toca una para empezarla desde el principio.',
    'stats.restart': 'reiniciar', 'stats.restartAll': 'Reiniciar las {n}',
    'stats.backOne': '{n} palabra volvió a la cola',
    'stats.backMany': '{n} palabras volvieron a la cola',
    'stats.startingOver': '{w} — empezando de nuevo',
    'stats.ofTarget': '{done} de {target}',

    'set.title': 'Ajustes',
    'set.exam': 'Examen', 'set.examDate': 'Fecha del examen',
    'set.newPerDay': 'Palabras nuevas por día (0 = calcúlalo por mí)',
    'set.maxReviews': 'Máximo de repasos por día',
    'set.voice': 'Voz', 'set.readAloud': 'Leer las respuestas en voz alta',
    'set.voiceSub': 'Las respuestas en alemán se leen en alemán, y las respuestas en inglés en inglés. Toca una respuesta revelada para volver a escucharla.',
    'set.language': 'Idioma',
    'set.languageSub': 'Solo el idioma de la interfaz. Los significados siguen en inglés — es la única traducción que traen los datos del vocabulario.',
    'set.whatToStudy': 'Qué estudiar',
    'set.data': 'Datos',
    'set.dataSub': 'Safari borra los datos del sitio a los 7 días. Las apps añadidas a la pantalla de inicio están exentas, pero haz copias de seguridad igual.',
    'set.backup': 'Copia de seguridad', 'set.restore': 'Restaurar',
    'set.reset': 'Borrar todo',
    'set.words': '{n} palabras · datos v1',
    'set.sentences': 'Frases de ejemplo de Tatoeba (CC BY 2.0 FR)',

    'toast.voiceOn': 'Las respuestas se leerán en voz alta',
    'toast.voiceOff': 'Voz desactivada',
    'toast.scope': 'Alcance actualizado',
    'toast.backup': 'Copia guardada en tus descargas',
    'toast.restored': 'Se restauraron {n} palabras',
    'toast.restoreFail': 'No se pudo restaurar — {e}',
    'toast.reset': 'Todo borrado',
    'toast.lang': 'Idioma de la interfaz cambiado',
    'confirm.reset': '¿Borrar todo tu progreso? Esto no se puede deshacer. Haz una copia de seguridad primero si no estás seguro.',
    'err.notBackup': 'eso no es una copia de Wortmeister',

    'u.day': 'día', 'u.days': 'días',
    'u.word': 'palabra', 'u.words': 'palabras',
    'u.freeze': 'congelación', 'u.freezes': 'congelaciones',
    'u.dow': 'Dom Lun Mar Mié Jue Vie Sáb'
  }
};
const LANGS = ['en', 'es'];
function lang() { return (A.set && I18N[A.set.lang]) ? A.set.lang : 'en'; }
/** Number and date locale, so thousands separators and months follow suit. */
function loc() { return lang() === 'es' ? 'es-CO' : 'en-GB'; }
function nfmt(n) { return (n == null ? 0 : n).toLocaleString(loc()); }
/** Translate. `{name}` placeholders are filled from `vars`. */
function T(key, vars) {
  const table = I18N[lang()] || I18N.en;
  let s = table[key];
  if (s == null) s = I18N.en[key];
  if (s == null) return key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}
/** "1 day" / "3 days", for the handful of counters that need it. */
function plural(n, one, many) { return nfmt(n) + ' ' + T(n === 1 ? one : many); }
/** Mode pill labels. MODE_LABEL stays the canonical key registry — Stats
    derives its counters from its keys — and only the label is translated. */
function modeLabel(k) { return T('mode.' + k); }
/** Fill every statically-marked node in the shell. Called on boot and on each
    language change; re-rendering the active view covers everything dynamic. */
function applyI18n() {
  document.documentElement.lang = lang();
  $$('[data-i18n]').forEach(el => { el.textContent = T(el.dataset.i18n); });
  $$('[data-i18n-html]').forEach(el => { el.innerHTML = T(el.dataset.i18nHtml); });
  // Buttons whose label is a bare text node followed by a <small> the app
  // writes into — the interval previews under Again/Hard/Good/Easy. Replacing
  // textContent would delete that <small> and the previews with it.
  $$('[data-i18n-lead]').forEach(el => {
    const txt = T(el.dataset.i18nLead), first = el.firstChild;
    if (first && first.nodeType === 3) first.nodeValue = txt;
    else el.insertBefore(document.createTextNode(txt), el.firstChild);
  });
  $$('[data-i18n-ph]').forEach(el => { el.placeholder = T(el.dataset.i18nPh); });
  $$('[data-i18n-al]').forEach(el => el.setAttribute('aria-label', T(el.dataset.i18nAl)));
  $$('.nav').forEach(n => $$('button', n).forEach(b => {
    const s = b.querySelector('span');
    if (s && b.dataset.go) s.textContent = T('nav.' + b.dataset.go);
  }));
}

/* The `aux` column is inherited from the build pipeline and is wrong for a
   number of verbs — a spot check of 29 unambiguous sein-verbs found 7 marked
   haben. Drilling that as-is would teach the wrong answer before an exam, so
   verified corrections live here. 'both' means either auxiliary is accepted,
   which is the honest answer for motion verbs that also take a direct object
   ("ich bin gefahren" / "ich habe das Auto gefahren").
   The real fix is a data rebuild in tools/vocab-build; this covers the cases
   most likely to come up. */
const AUX_OVERRIDE = {
  aufstehen: 'sein', passieren: 'sein', abfahren: 'sein', rennen: 'sein',
  aufbrechen: 'sein', einziehen: 'sein', ausziehen: 'sein', umziehen: 'sein',
  fahren: 'both', fliegen: 'both', schwimmen: 'both', reiten: 'both',
  segeln: 'both', joggen: 'both', klettern: 'both', wandern: 'both',
  fliehen: 'sein', stürzen: 'sein', explodieren: 'sein', platzen: 'sein',
  verschwinden: 'sein', entstehen: 'sein', erscheinen: 'sein', auftreten: 'sein',
  zerbrechen: 'both', schmelzen: 'both', trocknen: 'both'
};
/* The ambient light behind the glass takes the colour of the current word's
   level, so the card you are on is legible before you have read anything. */
const LEVEL_TINT = { A1: '#30d158', A2: '#64d2ff', B1: '#ff9f0a', B2: '#bf5af2' };

/* ============================ tiny DOM ============================ */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/**
 * iOS does not reflow when the keyboard opens: the visual viewport shrinks but
 * the layout viewport does not, so Safari scrolls the focused input into view
 * and the prompt ends up above the fold. Track the visual viewport, size the
 * app to it, and flag the compact type scale while it is short.
 */
function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    document.documentElement.style.setProperty('--vvh', vv.height + 'px');
    // a keyboard eats far more than browser chrome ever does
    document.body.classList.toggle('kb', vv.height < window.innerHeight - 120);
    window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}

/** Restart the enter animation on an element that is already on screen.
    Reading offsetWidth forces the reflow that makes the replay take. */
function replayEnter(el) {
  if (!el) return;
  el.classList.remove('enter');
  void el.offsetWidth;
  el.classList.add('enter');
}

function setTint(level) {
  const el = $('#ambient');
  if (el) el.style.setProperty('--tint', LEVEL_TINT[level] || '#0a84ff');
}
/** The drifting background runs only while studying — it is the one place you
    look at a single screen for minutes, and it costs battery everywhere else. */
function setAmbientLive(on) {
  const el = $('#ambient');
  if (el) el.classList.toggle('live', !!on);
}
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200);
}

/* ============================ IndexedDB ============================ */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(CFG.dbName, CFG.dbVer);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('state')) d.createObjectStore('state');
      };
      rq.onsuccess = () => { this.db = rq.result; res(this.db); };
      rq.onerror = () => rej(rq.error);
    });
  },
  tx(store, mode) { return this.db.transaction(store, mode).objectStore(store); },
  get(store, key) {
    return new Promise((res, rej) => {
      const r = this.tx(store, 'readonly').get(key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  },
  set(store, key, val) {
    return new Promise((res, rej) => {
      const r = this.tx(store, 'readwrite').put(val, key);
      r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    });
  },
  all(store) {
    return new Promise((res, rej) => {
      const out = new Map();
      const r = this.tx(store, 'readonly').openCursor();
      r.onsuccess = e => {
        const c = e.target.result;
        if (!c) return res(out);
        out.set(c.key, c.value); c.continue();
      };
      r.onerror = () => rej(r.error);
    });
  },
  putMany(store, entries) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      entries.forEach(([k, v]) => s.put(v, k));
      t.oncomplete = () => res(); t.onerror = () => rej(t.error);
    });
  },
  clear(store) {
    return new Promise((res, rej) => {
      const r = this.tx(store, 'readwrite').clear();
      r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    });
  }
};

/* ============================ app state ============================ */
const A = {
  words: [],          // array of word objects, index === id === priority rank-1
  verbPrep: [],
  prepBy: new Map(),  // bare lemma -> [{prep, kase, en, ex, reflexive}]
  family: new Map(),  // 5-letter stem -> [word id]
  byPos: new Map(),   // pos -> [word], for cloze distractors
  sentences: {},      // word id -> [[german, blankAt, blankLen, english]]
  state: new Map(),   // id -> review record (only touched words)
  set: null,          // settings
  dirty: new Set(),
  flushT: null,
  firstDirty: 0,
  setT: null
};

/* Writes are debounced, but a triage sprint answers roughly once a second,
   which would reset a plain debounce forever and never persist anything.
   So: debounce 1.2 s, with a hard ceiling of 4 s or 25 pending records. */
function markDirty(id) {
  A.dirty.add(id);
  const now = Date.now();
  if (!A.firstDirty) A.firstDirty = now;
  clearTimeout(A.flushT);
  if (now - A.firstDirty > 4000 || A.dirty.size >= 25) { flush(); return; }
  A.flushT = setTimeout(flush, 1200);
}
async function flush() {
  clearTimeout(A.flushT);
  A.firstDirty = 0;
  if (A.setT) { clearTimeout(A.setT); A.setT = null; saveSettings(); }
  if (!A.dirty.size) return;
  const entries = [];
  for (const id of A.dirty) {
    const st = A.state.get(id);
    if (st) entries.push([id, st]);      // deleted records are dropped, not written
  }
  A.dirty.clear();
  if (!entries.length) return;
  try { await DB.putMany('state', entries); } catch (e) { console.warn('flush', e); }
}
async function saveSettings() { await DB.set('kv', 'settings', A.set); }

/* Settings carry the rolling medians and the full history map, so writing them
   per answer means one whole-object write per card. Explicit edits still save
   immediately; per-answer bookkeeping rides a debounce like review state does. */
function queueSettings() {
  clearTimeout(A.setT);
  A.setT = setTimeout(() => { A.setT = null; saveSettings(); }, CFG.SETTINGS_DEBOUNCE);
}
addEventListener('pagehide', flush);
addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

/* ============================ vocabulary ============================ */
function tierOf(w) {
  if (w.level.replace('*', '') !== 'B2') return 'core';
  return w.freqClass <= 13 ? 'B2-core' : 'B2-extended';
}
function inScope(w) {
  const lv = w.level.replace('*', '');
  if (lv !== 'B2') return !!A.set.scope[lv];
  return !!A.set.scope[tierOf(w)];
}
/** Headword the way it should be memorised: "der Betrieb, Betriebe". */
function display(w) {
  if (w.pos !== 'noun') return w.lemma;
  const head = (w.article ? w.article + ' ' : '') + w.lemma;
  return w.plural ? head + ', ' + w.plural : head;
}
/** display() with the gender shape in front, for places that render HTML. */
function displayMarked(w) {
  const m = genderMark(w);
  return (m ? '<span class="gmark">' + m + '</span>' : '') + esc(display(w));
}
function grammar(w) {
  const bits = [];
  if (w.pos === 'verb') {
    const a = auxFor(w);
    const auxLabel = a === 'both' ? 'haben/sein' : a;
    const parts = [w.prt, (auxLabel ? auxLabel + ' ' : '') + w.pp]
      .filter(x => x && x.trim());
    if (parts.length) bits.push('<b>' + esc(w.lemma + ', ' + parts.join(', ')) + '</b>');
    if (w.sep) bits.push('separable · he/she/it <b>' + esc(w.p3) + '</b>');
    // the word-level `rection` column ships empty; the real patterns are in
    // data.verbPrep, indexed by lemma at load
    const pats = rectionFor(w);
    if (pats) {
      bits.push(pats.map(p =>
        '<b>' + esc((p.reflexive ? 'sich ' : '') + w.lemma + ' ' + p.prep) + '</b>' +
        (p.kase === 'Dativ' || p.kase === 'Akkusativ' ? ' + ' + esc(p.kase) : '')
      ).join('<br>'));
    }
  } else if (w.pos === 'noun' && w.plural) {
    bits.push('plural: <b>' + esc(w.plural) + '</b>');
  }
  // a word is easier to hold onto as part of a family than on its own
  const kin = relatives(w, 2);
  if (kin.length) {
    bits.push('related: ' + kin.map(k => '<b>' + esc(k.lemma) + '</b>').join(', '));
  }
  return bits.join('<br>');
}
function isDrillableNoun(w) {
  return w.pos === 'noun' && ['der', 'die', 'das'].includes(w.article);
}
/** Verbs that carry both principal parts can be drilled on their forms. */
function hasVerbForms(w) {
  return w.pos === 'verb' && !!w.prt && !!w.pp;
}
/** The auxiliary to grade against — 'haben', 'sein', or 'both'. */
function auxFor(w) {
  return AUX_OVERRIDE[w.lemma] || w.aux;
}
/** Governed-preposition patterns for a verb, keyed on the bare lemma. */
function rectionFor(w) {
  return (w.pos === 'verb' && A.prepBy.get(w.lemma)) || null;
}
/** The gender shape for a noun, or '' for everything else. */
function genderMark(w) {
  return isDrillableNoun(w) ? GENDER_SHAPE[w.article] : '';
}

/** Index words by morphological family so a card can show its relatives. */
function indexFamilies() {
  A.family = new Map();
  for (const w of A.words) {
    const k = familyKey(w);
    if (k.length < 5) continue;
    let l = A.family.get(k);
    if (!l) A.family.set(k, l = []);
    l.push(w.id);
  }
}
/** Up to `max` relatives, highest priority first (the array is rank-ordered). */
function relatives(w, max) {
  const l = A.family.get(familyKey(w));
  if (!l || l.length < 2) return [];
  const out = [];
  for (const id of l) {
    if (id === w.id) continue;
    out.push(A.words[id]);
    if (out.length >= max) break;
  }
  return out;
}

async function loadVocab() {
  let cached = await DB.get('kv', 'vocab');
  if (!cached || cached.v !== 1) {
    const r = await fetch(CFG.data, { cache: 'force-cache' });
    if (!r.ok) throw new Error('vocab ' + r.status);
    cached = await r.json();
    await DB.set('kv', 'vocab', cached);
  }
  const f = cached.fields;
  A.words = cached.words.map(row => {
    const o = {};
    for (let i = 0; i < f.length; i++) o[f[i]] = row[i];
    return o;
  });
  A.verbPrep = cached.verbPrep || [];
  indexRection();
  indexFamilies();
  indexPos();
}

/** Same-part-of-speech pools, for plausible cloze distractors. */
function indexPos() {
  A.byPos = new Map();
  for (const w of A.words) {
    if (!inScope(w)) continue;
    let l = A.byPos.get(w.pos);
    if (!l) A.byPos.set(w.pos, l = []);
    l.push(w);
  }
}

/**
 * The cloze bank is optional. A missing or malformed file leaves `cloze`
 * simply unavailable — pickMode falls through to typing — rather than
 * breaking a study session. It is cached under its own key, so fetching it
 * can never disturb the cached vocabulary.
 */
async function loadSentences() {
  let cached = await DB.get('kv', 'sentences');
  if (!cached || cached.v !== 1 || !cached.byId) {
    try {
      const r = await fetch(CFG.sentences, { cache: 'force-cache' });
      const fresh = r.ok ? await r.json() : null;
      if (fresh && fresh.v === 1 && fresh.byId) {
        cached = fresh;
        await DB.set('kv', 'sentences', cached);
      } else {
        cached = null;                  // never cache something unusable
      }
    } catch (e) {
      console.warn('sentence bank unavailable', e);
      cached = null;
    }
  }
  A.sentences = (cached && cached.byId) || {};
}

/** Sentences available for a word, or null. */
function sentencesFor(w) {
  const l = A.sentences[w.id];
  return (l && l.length) ? l : null;
}

/**
 * Four options for a cloze: the answer plus three same-part-of-speech words of
 * similar length. Similar length matters — a short answer among long
 * distractors is solvable without reading the sentence.
 */
function clozeChoices(w, seed) {
  const pool = (A.byPos.get(w.pos) || []).filter(x =>
    x.id !== w.id && familyKey(x) !== familyKey(w));
  const near = pool.filter(x => Math.abs(x.lemma.length - w.lemma.length) <= 3);
  const from = near.length >= 8 ? near : pool;
  const rnd = seededRandom(Math.abs(seed) + 101);
  const picked = [];
  for (let guard = 0; guard < 400 && picked.length < 3 && from.length; guard++) {
    const c = from[Math.floor(rnd() * from.length)];
    if (!picked.some(x => x.id === c.id)) picked.push(c);
  }
  const opts = picked.map(x => x.lemma).concat([w.lemma]);
  return shuffleSeeded(opts, seededRandom(Math.abs(seed) + 271));
}

/** The sentence with the target replaced by a blank. */
function clozePrompt(s) {
  return esc(s[0].slice(0, s[1])) + '<i class="blank">_____</i>' +
    esc(s[0].slice(s[1] + s[2]));
}
/** The sentence with the target restored and highlighted. */
function clozeFilled(s) {
  return esc(s[0].slice(0, s[1])) + '<b>' + esc(s[0].substr(s[1], s[2])) + '</b>' +
    esc(s[0].slice(s[1] + s[2]));
}

/* verbPrep rows are [verb, preposition, case, gloss, example]. Two of them
   carry "D" instead of a preposition — those verbs take a bare dative object
   and have no preposition to drill, so they are dropped. Reflexive entries are
   stored as "sich ärgern" while the word list holds the bare lemma. */
function indexRection() {
  A.prepBy = new Map();
  for (const row of A.verbPrep) {
    const [verb, prep, kase, en, ex] = row;
    if (!verb || !prep || prep === 'D') continue;
    const reflexive = /^sich\s+/.test(verb);
    const lemma = verb.replace(/^sich\s+/, '');
    const list = A.prepBy.get(lemma) || [];
    list.push({ prep, kase, en, ex, reflexive, verb });
    A.prepBy.set(lemma, list);
  }
}

/* ============================ scheduler ============================ */
const clampEase = e => Math.max(CFG.EASE_MIN, Math.min(CFG.EASE_MAX, e));

/* Local calendar date, not UTC. toISOString() rolls the day over at 19:00 in
   UTC-5, which both broke the streak across a morning/evening pair of sessions
   and reset the "new words today" counter in the middle of an evening one. */
function today(ms) {
  const d = ms == null ? new Date() : new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function daysToExam() {
  const ms = new Date(A.set.exam + 'T09:00:00').getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / CFG.DAY));
}
function newState() {
  // p = -1 means "not yet on a learning step"; see applyGrade.
  return { s: 'new', e: CFG.EASE_START, i: 0, d: 0, r: 0, l: 0, p: -1, m: {}, t: 0 };
}
function getState(id) { return A.state.get(id) || null; }
function setState(id, st) { A.state.set(id, st); markDirty(id); }

/** Rolling median of response time per mode — "how fast is normal for me". */
function medianFor(mode) {
  const arr = (A.set.medians[mode] || []);
  if (arr.length < 8) return 4000;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function pushTime(mode, ms) {
  ms = Math.min(ms, CFG.MED_CAP);
  const arr = A.set.medians[mode] || (A.set.medians[mode] = []);
  arr.push(ms);
  if (arr.length > CFG.MED_WINDOW) arr.shift();
}

/**
 * Adjust a self-reported "Good" using how long the answer took.
 * Fast recall is stronger than the button admits; slow recall is weaker.
 */
function adjustGrade(grade, ms, mode) {
  if (grade !== G.GOOD) return grade;
  const med = medianFor(mode);
  if (ms < CFG.FAST * med) return G.EASY;
  if (ms > CFG.SLOW * med) return G.HARD;
  return G.GOOD;
}

/**
 * Anki-style interval jitter. Without it, every word sorted in the same sprint
 * and graded the same way resurfaces on the same day forever, and the clumps
 * grow as intervals lengthen. A 10-day interval becomes 8–12, a 30-day one
 * 26–34. Short intervals are left exact so the learning steps stay predictable.
 */
function fuzzInterval(d) {
  if (!CFG.FUZZ || d < CFG.FUZZ_MIN_INTERVAL) return d;
  // tiered, not a flat percentage — a flat 5% on 25 days gives only three
  // possible landing days, which barely breaks up a clump. These tiers
  // reproduce Anki's documented spreads: 3→2-4, 10→8-12, 15→13-17, 30→26-34.
  let delta;
  if (d < 7) delta = 1;
  else if (d < 20) delta = Math.max(2, Math.round(d * 0.15));
  else delta = Math.max(4, Math.round(d * 0.13));
  return d + Math.round((Math.random() * 2 - 1) * delta);
}

/** Apply a grade. Mutates and returns the state record. */
function applyGrade(st, grade, now) {
  const cap = daysToExam();
  const dueIn = ms => { st.d = now + ms; return st; };
  const dueDays = d => {
    st.i = Math.max(1, Math.min(Math.round(fuzzInterval(d)), cap));
    st.d = now + st.i * CFG.DAY;
    return st;
  };
  st.r++;

  // p = -1 means "not yet on a learning step", so the first Good lands on
  // step 0 (10 min) rather than skipping straight to the 1-day step.
  if (st.s === 'new' || st.s === 'queued') { st.s = 'learning'; st.p = -1; }

  if (st.s === 'learning' || st.s === 'relearning') {
    const relearn = st.s === 'relearning';
    if (grade === G.AGAIN) { st.p = 0; return dueIn(CFG.LEARN_STEPS[0]); }
    if (grade === G.HARD) {
      const p = Math.min(Math.max(st.p, 0), CFG.LEARN_STEPS.length - 1);
      return dueIn(CFG.LEARN_STEPS[p]);
    }
    st.p++;
    if (grade !== G.EASY && st.p < CFG.LEARN_STEPS.length) {
      return dueIn(CFG.LEARN_STEPS[st.p]);
    }
    st.s = 'review';
    const base = grade === G.EASY ? CFG.GRAD_EASY : CFG.GRAD;
    return dueDays(relearn ? Math.max(1, base * 0.6) : base);
  }

  // review
  if (grade === G.AGAIN) {
    st.l++;
    st.e = clampEase(st.e - 0.20);
    st.i = Math.max(1, Math.round(st.i * 0.4));
    if (st.l >= CFG.LEECH_AT) { st.s = 'leech'; st.d = now + 365 * CFG.DAY; return st; }
    st.s = 'relearning'; st.p = 0;
    return dueIn(CFG.LEARN_STEPS[0]);
  }
  if (grade === G.HARD) { st.e = clampEase(st.e - 0.15); return dueDays(st.i * 1.2); }
  if (grade === G.GOOD) { return dueDays(st.i * st.e); }
  st.e = clampEase(st.e + 0.15);
  return dueDays(st.i * st.e * 1.3);
}

/** What each button would schedule, for the labels under the grade buttons.
    Previewed without fuzz so the label matches the nominal interval — Anki
    hides the jitter from these buttons for the same reason. */
function previewIntervals(st) {
  const fuzz = CFG.FUZZ;
  CFG.FUZZ = 0;
  try {
  return [G.AGAIN, G.HARD, G.GOOD, G.EASY].map(g => {
    const copy = JSON.parse(JSON.stringify(st));
    applyGrade(copy, g, Date.now());
    const ms = copy.d - Date.now();
    if (copy.s === 'leech') return 'paused';
    if (ms < CFG.DAY) return Math.max(1, Math.round(ms / CFG.MIN)) + ' min';
    const d = Math.round(ms / CFG.DAY);
    return d >= 30 ? (d / 30).toFixed(1).replace('.0', '') + ' mo' : d + ' d';
  });
  } finally { CFG.FUZZ = fuzz; }
}

/* ---- session ordering ---- */

/** Deterministic PRNG, seeded per day, so reloading mid-session does not
    reshuffle the queue under you. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function daySeed() {
  const d = today();
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d.charCodeAt(i), 16777619);
  return h;
}
function shuffleSeeded(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/** Crude morphological family — the folded first five letters of the lemma.
    Groups bewerben / Bewerbung / Bewerber without needing a stemmer. */
function familyKey(w) {
  const s = foldGerman(w.lemma).replace(/[^a-z]/g, '');
  return s.slice(0, 5);
}

/** Keep related words apart, so recall does not collapse into pattern-matching
    off the card you saw two seconds ago. */
function spaceSiblings(list, gap) {
  const pending = list.slice(), out = [];
  while (pending.length) {
    let pick = 0;
    for (let i = 0; i < pending.length; i++) {
      const fam = familyKey(pending[i]);
      let clash = false;
      for (let k = Math.max(0, out.length - gap); k < out.length; k++) {
        if (familyKey(out[k]) === fam) { clash = true; break; }
      }
      if (!clash) { pick = i; break; }
    }
    out.push(pending.splice(pick, 1)[0]);
  }
  return out;
}

/* ======================= typed-answer checking ======================= */
/* German keyboards are not always at hand, so ae/oe/ue/ss are folded to the
   umlaut forms on both sides — typing either spelling is accepted. */
const UMLAUT = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' };
function foldGerman(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[äöüß]/g, c => UMLAUT[c])
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance, bailing out early once it exceeds `max`. */
function levenshtein(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** What the user has to type: nouns carry their article, everything else doesn't. */
function typeTarget(w) {
  return isDrillableNoun(w) ? w.article + ' ' + w.lemma : w.lemma;
}

/**
 * How much help this word still gets in "Fill it in".
 *
 * Stored in `st.h` once the mode has been answered. Records written before
 * this mode existed have no `h`, so the level is *derived* from how often the
 * word has been seen at all — a word you have answered eight times should not
 * suddenly be spoon-fed. Deriving it means no migration and no rewrite.
 */
function hintLevel(st) {
  if (!st) return 0;
  if (st.h !== undefined) return Math.max(0, Math.min(HINT_MAX, st.h));
  return Math.min(HINT_MAX, Math.floor((st.r || 0) / 4));
}

/**
 * The masked target: the first letters of the lemma in place, everything else
 * a dot. The article is never revealed — der/die/das are all three letters, so
 * masking it shows the shape without leaking the gender, which the article
 * drill is separately responsible for teaching.
 */
function hintMask(w, level) {
  const target = typeTarget(w);
  const lemmaAt = target.length - w.lemma.length;
  const show = Math.ceil(w.lemma.length * HINT_SHARE[Math.min(level, HINT_MAX)]);
  let out = '';
  for (let i = 0; i < target.length; i++) {
    if (target[i] === ' ') { out += ' '; continue; }
    out += (i >= lemmaAt && i < lemmaAt + show) ? target[i] : '·';
  }
  return out;
}

/**
 * Grade a typed answer.
 * Returns { ok, near, expected } — `near` means it counted but only as Hard.
 *
 * The article is checked exactly and never gets Levenshtein slack: der/die/das
 * is the thing being tested, so "die Betrieb" is a wrong answer, not a typo.
 * Slack applies to the noun body alone, and only above TYPO_MIN_LEN, because
 * one edit on a short word lands on a different word (Rad / Bad).
 */
function checkTyped(w, raw) {
  const expected = typeTarget(w);
  const got = foldGerman(raw);
  if (!got) return { ok: false, near: false, expected };

  const wantWord = foldGerman(w.lemma);
  let gotWord = got;

  if (isDrillableNoun(w)) {
    const m = got.match(/^(der|die|das)\s+(.+)$/);
    if (!m || m[1] !== w.article) return { ok: false, near: false, expected };
    gotWord = m[2];
  }

  if (gotWord === wantWord) return { ok: true, near: false, expected };
  if (wantWord.length > CFG.TYPO_MIN_LEN && levenshtein(gotWord, wantWord, 1) <= 1) {
    return { ok: true, near: true, expected };
  }
  return { ok: false, near: false, expected };
}

/** One typed form against its target: 'exact', 'near' (one typo), or 'wrong'. */
function matchForm(input, want) {
  const got = foldGerman(input), target = foldGerman(want);
  if (!got) return 'wrong';
  if (got === target) return 'exact';
  if (target.length > CFG.TYPO_MIN_LEN && levenshtein(got, target, 1) <= 1) return 'near';
  return 'wrong';
}

const VOWELS = 'aeiou';
/** True when two strings differ by exactly one substituted vowel. */
function vowelSwap(a, b) {
  if (a.length !== b.length) return false;
  let at = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (at >= 0) return false;
    at = i;
  }
  return at >= 0 && VOWELS.includes(a[at]) && VOWELS.includes(b[at]);
}

/**
 * Like matchForm, but a single swapped vowel counts as wrong rather than a
 * typo. In a verb form that vowel is the ablaut — the whole point of the
 * drill — so "fang an" is a different form of anfangen, not a misspelling of
 * "fing an". Edits elsewhere (a dropped letter, a doubled consonant) stay
 * forgiven, same as typing mode.
 */
function matchVerbForm(input, want) {
  const m = matchForm(input, want);
  if (m !== 'near') return m;
  return vowelSwap(foldGerman(input), foldGerman(want)) ? 'wrong' : 'near';
}

/**
 * Grade a verb-form answer: Präteritum, Partizip II and the auxiliary.
 * The auxiliary is a two-way choice, so it is exact-or-wrong — but a verb
 * marked 'both' accepts either, because for those verbs both are correct.
 */
function checkVerbForms(w, prt, pp, aux) {
  const want = { prt: w.prt, pp: w.pp, aux: auxFor(w) };
  const mPrt = matchVerbForm(prt, w.prt);
  const mPp = matchVerbForm(pp, w.pp);
  const auxOk = want.aux === 'both'
    ? (aux === 'haben' || aux === 'sein')
    : aux === want.aux;
  const ok = mPrt !== 'wrong' && mPp !== 'wrong' && auxOk;
  return { ok, near: ok && (mPrt === 'near' || mPp === 'near'), auxOk, want };
}

/**
 * Grade a rection answer. The preposition is the main point, so getting it
 * right but the case wrong is a near miss rather than a failure.
 * Patterns whose case is '—' (like "gelten als") skip the case step entirely.
 */
function checkRection(pat, prep, kase) {
  const prepOk = prep === pat.prep;
  const needsCase = pat.kase === 'Dativ' || pat.kase === 'Akkusativ';
  const caseOk = !needsCase || kase === pat.kase;
  return { ok: prepOk && caseOk, near: prepOk && !caseOk, prepOk, needsCase };
}

/** Four preposition options: the answer plus three plausible distractors. */
function prepChoices(pat, seed) {
  const pool = ['an', 'auf', 'aus', 'bei', 'für', 'gegen', 'in', 'mit',
    'nach', 'um', 'unter', 'von', 'vor', 'zu', 'über', 'als']
    .filter(p => p !== pat.prep);
  const picked = [];
  // deterministic per card, so re-showing the same card is not a fresh lottery
  let k = Math.abs(seed) % pool.length;
  while (picked.length < 3) {
    const p = pool[k % pool.length];
    if (!picked.includes(p)) picked.push(p);
    k += 7;
  }
  const out = picked.concat([pat.prep]);
  // rotate the answer into a stable but non-obvious slot
  const shift = Math.abs(seed) % 4;
  return out.slice(out.length - shift).concat(out.slice(0, out.length - shift));
}

/* ============================ speech ============================ */
/*
 * Reads the answer aloud when the toggle is on, in the language of the text
 * being read: German for a German answer, English when the answer is the
 * English gloss. Five of the six modes answer in German, which is where the
 * pronunciation value is.
 *
 * Everything is guarded — jsdom has no speechSynthesis, and neither do some
 * locked-down browsers. Absent support silently disables the feature rather
 * than breaking a study session.
 */
const SPEECH = { voices: [], ready: false };

function speechAvailable() {
  return typeof speechSynthesis !== 'undefined' &&
    typeof SpeechSynthesisUtterance !== 'undefined';
}
function loadVoices() {
  if (!speechAvailable()) return;
  SPEECH.voices = speechSynthesis.getVoices() || [];
  SPEECH.ready = SPEECH.voices.length > 0;
}
/** Best available voice for a language, preferring a local one. */
function pickVoice(lang) {
  const want = lang.slice(0, 2);
  const cand = SPEECH.voices.filter(v => (v.lang || '').slice(0, 2) === want);
  if (!cand.length) return null;
  return cand.find(v => v.localService) || cand[0];
}
function stopSpeech() {
  if (speechAvailable()) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
}
/** Say `text` in `lang`. Never throws — speech is a nicety, not a dependency. */
function say(text, lang) {
  if (!A.set || !A.set.speak || !speechAvailable()) return false;
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = lang;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.rate = lang.startsWith('de') ? 0.9 : 1;   // German a touch slower
    speechSynthesis.speak(u);
    return true;
  } catch (e) { return false; }
}

/** What a card should read out, and in which language. */
function speechFor(w, mode) {
  if (!w) return null;
  switch (mode) {
    // the answer here is the English gloss, so that is what gets read
    case 'de2en': return { text: w.en, lang: 'en-US' };
    case 'en2de': return { text: display(w), lang: 'de-DE' };
    case 'type': case 'hint': return { text: typeTarget(w), lang: 'de-DE' };
    case 'article': return { text: w.article + ' ' + w.lemma, lang: 'de-DE' };
    case 'verb': return { text: [w.lemma, w.prt, w.pp].filter(Boolean).join(', '), lang: 'de-DE' };
    default: return { text: w.lemma, lang: 'de-DE' };
  }
}
function speakCard(w, mode) {
  // a governed preposition is only worth hearing in its sentence
  if (mode === 'rection' && ST.pat) {
    const p = ST.pat;
    return say(p.ex || (p.reflexive ? 'sich ' : '') + w.lemma + ' ' + p.prep, 'de-DE');
  }
  const s = speechFor(w, mode);
  if (s) say(s.text, s.lang);
}

/* ============================ queues ============================ */
function untriaged() {
  const out = [];
  for (const w of A.words) if (inScope(w) && !A.state.has(w.id)) out.push(w);
  return out;
}
function dueList(now) {
  const out = [];
  for (const [id, st] of A.state) {
    if (st.s === 'known' || st.s === 'leech' || st.s === 'queued') continue;
    if (st.d <= now) { const w = A.words[id]; if (w && inScope(w)) out.push(w); }
  }
  out.sort((a, b) => A.state.get(a.id).d - A.state.get(b.id).d);
  return out;
}
function queuedNew() {
  const out = [];
  for (const [id, st] of A.state) {
    if (st.s !== 'queued') continue;
    const w = A.words[id];
    if (w && inScope(w)) out.push(w);
  }
  // uncertain words first, then priority rank
  out.sort((a, b) => {
    const ua = A.state.get(a.id).u ? 0 : 1, ub = A.state.get(b.id).u ? 0 : 1;
    return ua - ub || a.id - b.id;
  });
  return out;
}
function remainingToLearn() {
  let n = 0;
  for (const w of A.words) {
    if (!inScope(w)) continue;
    const st = A.state.get(w.id);
    if (!st) { n++; continue; }                       // not yet triaged
    if (st.s === 'known') continue;
    if (st.s === 'review' && st.i >= 21) continue;    // effectively learned
    n++;
  }
  return n;
}
function autoNewTarget(remaining) {
  if (A.set.newPerDay > 0) return A.set.newPerDay;
  const left = remaining == null ? remainingToLearn() : remaining;
  const need = Math.ceil(left / daysToExam());
  return Math.max(10, Math.min(60, need));
}

/** Today's session: all due reviews (capped) interleaved with new words. */
function buildSession() {
  const now = Date.now();
  const rnd = seededRandom(daySeed());
  // pick the most overdue first, then shuffle: selection should respect the
  // schedule, presentation order within a day should not be predictable
  const due = shuffleSeeded(dueList(now).slice(0, A.set.maxReviews), rnd);
  const doneToday = (A.set.history[today()] || {}).new || 0;
  const want = Math.max(0, autoNewTarget() - doneToday);
  let fresh = queuedNew().slice(0, want);
  if (!fresh.length && !due.length) fresh = untriaged().slice(0, want); // never blank
  if (!due.length) return spaceSiblings(fresh, CFG.SIBLING_GAP);

  // interleave so new cards are spread through the session, not front-loaded
  const out = [], every = fresh.length ? Math.max(1, Math.floor(due.length / fresh.length)) : 0;
  let fi = 0;
  due.forEach((w, i) => {
    out.push(w);
    if (fi < fresh.length && every && (i + 1) % every === 0) out.push(fresh[fi++]);
  });
  while (fi < fresh.length) out.push(fresh[fi++]);
  return spaceSiblings(out, CFG.SIBLING_GAP);
}

/**
 * How a word should be asked, by how many times it has been answered.
 * Recognition first, then recall, then production:
 *   reps 0–1  flip DE→EN (recognition)
 *   reps 2–4  fill it in — typing with fading hints, replacing the old EN→DE
 *             flip card, because producing the word beats recognising it
 *   reps 5+   production, weighted towards filling it in
 *
 * Specialist drills take every third slot rather than replacing the
 * progression: nouns from rep 2 (gender), verbs from rep 3 (forms, and the
 * governed preposition where one exists). A verb with both alternates between
 * them so neither is starved.
 */
function pickMode(w) {
  const st = getState(w.id);
  const reps = st ? st.r : 0;

  // Every fourth rep, not every third: production below also keys on % 3, and
  // on the same modulus the article slot would swallow every type/cloze slot a
  // noun ever got — nouns would never be typed with their article again.
  if (isDrillableNoun(w) && reps >= 2 && reps % 4 === 2) return 'article';

  if (w.pos === 'verb' && reps >= 3 && reps % 3 === 0) {
    const forms = hasVerbForms(w);
    const rection = !!rectionFor(w);
    if (forms && rection) return (reps / 3) % 2 === 0 ? 'verb' : 'rection';
    if (forms) return 'verb';
    if (rection) return 'rection';
  }

  if (reps < 2) return 'de2en';
  if (reps < 5) return 'hint';

  // Production rotation, weighted towards "Fill it in": two slots in every
  // three. Writing the word from a shrinking scaffold is the thing that
  // sticks, so it leads — but typing cold and choosing it in a sentence keep
  // a slot each, because a mode you only ever see one way stops testing you.
  if (reps % 3 !== 2) return 'hint';
  return (sentencesFor(w) && reps % 6 === 2) ? 'cloze' : 'type';
}

/* ============================ history / streak ============================ */
function logAnswer(isNew, grade) {
  const d = today();
  const h = A.set.history[d] || (A.set.history[d] = { new: 0, rev: 0, again: 0 });
  if (h.again === undefined) h.again = 0;   // records written before v1.2
  if (isNew) h.new++; else h.rev++;
  if (grade === G.AGAIN) h.again++;
  if (A.set.lastDay !== d) { advanceStreak(d); A.set.lastDay = d; }
  queueSettings();
}

/** Whole days between two local YYYY-MM-DD dates. */
function daysBetween(a, b) {
  const t = s => new Date(s + 'T12:00:00').getTime();   // midday dodges DST
  return Math.round((t(b) - t(a)) / CFG.DAY);
}

/**
 * Advance the streak onto day `d`.
 *
 * A missed day is covered by a banked freeze rather than resetting to 1.
 * Losing a six-week streak to one late shift is how the habit dies, and the
 * streak is only worth anything as a reason to come back tomorrow.
 * `freezes` is absent on older settings, so it reads as 0 and behaves exactly
 * as before until one is earned.
 */
function advanceStreak(d) {
  const gap = A.set.lastDay ? daysBetween(A.set.lastDay, d) : 1;
  let freezes = A.set.freezes || 0;

  if (gap === 1) {
    A.set.streak = (A.set.streak || 0) + 1;
  } else if (gap > 1 && freezes >= gap - 1) {
    freezes -= gap - 1;                       // spend one per missed day
    A.set.streak = (A.set.streak || 0) + 1;
    A.set.frozeOn = d;
  } else {
    A.set.streak = 1;
  }

  // earn one back for every clean week, capped so they cannot be hoarded
  if (A.set.streak > 0 && A.set.streak % CFG.FREEZE_EVERY === 0) {
    freezes = Math.min(CFG.FREEZE_MAX, freezes + 1);
  }
  A.set.freezes = freezes;
}

/** Answers per local day, oldest first, for the heatmap. */
function heatSeries(days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = today(Date.now() - i * CFG.DAY);
    const h = A.set.history[key] || {};
    out.push({ key, n: (h.new || 0) + (h.rev || 0) });
  }
  return out;
}

/* History and lastDay used to be keyed to UTC dates. Translate lastDay once so
   the streak survives the switch; past history keys keep their old labels,
   which only shifts old bars in the 14-day chart by a day. */
function migrateDates() {
  if (A.set.tzFixed) return;
  A.set.tzFixed = true;
  const utc = ms => new Date(ms).toISOString().slice(0, 10);
  if (A.set.lastDay === utc(Date.now())) A.set.lastDay = today();
  else if (A.set.lastDay === utc(Date.now() - CFG.DAY)) A.set.lastDay = today(Date.now() - CFG.DAY);
}

/** New words answered per local day, oldest first, for the pacing chart. */
function paceSeries(days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = today(Date.now() - i * CFG.DAY);
    out.push({ key, n: (A.set.history[key] || {}).new || 0 });
  }
  return out;
}

/** Share of answers not graded Again, over the last `days`. Null with no data. */
function retention(days) {
  let total = 0, again = 0;
  for (let i = 0; i < days; i++) {
    const h = A.set.history[today(Date.now() - i * CFG.DAY)];
    if (!h) continue;
    total += (h.new || 0) + (h.rev || 0);
    again += h.again || 0;
  }
  return total ? (total - again) / total : null;
}

/** Days to clear the remaining queue at the recent pace, or null if stalled. */
function projectedDays() {
  const pace = recentPace(7);
  if (pace <= 0) return null;
  return Math.ceil(remainingToLearn() / pace);
}

/* A leech has failed eight times; returning it to its old interval would just
   fail it a ninth. Rehabilitation restarts it at recognition with the lapse
   counter cleared and a mid-range ease, so it climbs the modes again. */
function rehabLeech(id) {
  const st = A.state.get(id);
  if (!st || st.s !== 'leech') return false;
  st.s = 'queued';
  st.l = 0; st.r = 0; st.p = -1; st.i = 0; st.d = 0;
  st.e = clampEase(Math.max(st.e, 2.0));
  setState(id, st);
  return true;
}
function rehabAllLeeches() {
  let n = 0;
  for (const id of Array.from(A.state.keys())) if (rehabLeech(id)) n++;
  return n;
}

/** Average new words per day, over days actually elapsed rather than a flat 7. */
function recentPace(days) {
  const keys = Object.keys(A.set.history).sort();
  if (!keys.length) return 0;
  const series = paceSeries(days);
  const total = series.reduce((s, d) => s + d.n, 0);
  const firstMs = new Date(keys[0] + 'T00:00:00').getTime();
  const elapsed = Math.max(1, Math.min(days, Math.ceil((Date.now() - firstMs) / CFG.DAY)));
  return Math.round(total / elapsed);
}

/* ============================ router ============================ */
/* No Study tab: Home's primary button is the way in, and a second route to it
   only made the two compete. */
const NAV = [
  ['home', '◎'], ['browse', '☰'], ['stats', '◔'], ['settings', '⚙']
];
let current = 'home';
function go(name) {
  current = name;
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + name));
  $$('.nav').forEach(n => $$('button', n).forEach(b =>
    b.classList.toggle('on', b.dataset.go === name)));
  if (name === 'home') renderHome();
  if (name === 'browse') renderBrowse();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
  if (name === 'triage') startTriage();
  if (name === 'study') startStudy();
  setAmbientLive(name === 'study' || name === 'triage');
  if (name !== 'study') stopSpeech();
  window.scrollTo(0, 0);
}
function buildNav() {
  const html = NAV.map(([k, i]) =>
    `<button data-go="${k}"><b>${i}</b><span>${T('nav.' + k)}</span></button>`).join('');
  $$('.nav').forEach(n => { n.innerHTML = html; });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]');
  if (b) { go(b.dataset.go); }
});

/* ============================ home ============================ */
const CIRC = 2 * Math.PI * 80;
/** Every number Home and Stats are built from, computed once. */
function overview() {
  const scoped = A.words.filter(inScope);
  let known = 0, triaged = 0;
  for (const w of scoped) {
    const st = A.state.get(w.id);
    if (!st) continue;
    triaged++;
    if (st.s === 'known' || (st.s === 'review' && st.i >= 21)) known++;
  }
  const remaining = remainingToLearn();
  const dte = daysToExam();
  const due = Math.min(dueList(Date.now()).length, A.set.maxReviews);
  const h = A.set.history[today()] || {};
  const newDone = h.new || 0;
  const answered = (h.new || 0) + (h.rev || 0);
  const newLeft = Math.max(0, autoNewTarget(remaining) - newDone);
  const cards = due + newLeft;
  return {
    scoped: scoped.length, known, triaged, untriaged: scoped.length - triaged,
    remaining, dte, due, newLeft, cards,
    need: Math.ceil(remaining / dte),
    // today's ring: what you have answered against everything still waiting.
    // A lifetime bar moves 0.3% a day and reinforces nothing; this one finishes.
    answered, dayTarget: answered + cards,
    dayDone: cards === 0 && answered > 0,
    minDay: answered >= CFG.MIN_DAY
  };
}

/**
 * The long arc: how many words you have actually learned, against an estimate
 * of how many you will have to.
 *
 * The unsorted pile is projected from your own sorting so far. If 38% of the
 * words you have sorted turned out to be ones you already knew, roughly 38% of
 * the rest should be too — so the target is not the whole 7,035, it is what is
 * genuinely left for you specifically. The estimate sharpens every time you
 * sort more, and is labelled with a ~ until the pile is empty.
 *
 * Derived from existing records only. Nothing new is stored.
 */
/**
 * How far through the learning process one word is, 0 to 1.
 *
 * Mastery is not a switch. A word answered once is genuinely further along
 * than one never seen, and a word sitting on a 14-day interval is nearly
 * there. Grading it this way is what lets the bar move on every review instead
 * of jumping only when a word crosses CFG.MASTER_DAYS — which takes about a
 * month per word.
 */
function wordStrength(st) {
  if (!st) return 0;
  if (st.s === 'known') return st.r ? 1 : 0;      // retired at sort time is not progress
  if (st.s === 'queued' || st.s === 'new') return 0;
  if (st.s === 'leech') return 0.1;               // started, but going backwards
  if (st.s === 'learning' || st.s === 'relearning') return st.r ? 0.15 : 0;
  if (st.s === 'review') {
    if (st.i >= CFG.MASTER_DAYS) return 1;
    return 0.3 + 0.7 * Math.max(0, st.i) / CFG.MASTER_DAYS;
  }
  return 0;
}

function milestone() {
  const scoped = A.words.filter(inScope);
  let sorted = 0, alreadyKnew = 0, mastered = 0, learning = 0, strength = 0;
  for (const w of scoped) {
    const st = A.state.get(w.id);
    if (!st) continue;
    sorted++;
    // retired at sort time without ever being studied — you already knew it
    if (st.s === 'known' && !st.r) { alreadyKnew++; continue; }
    const s = wordStrength(st);
    strength += s;
    if (s >= 1) mastered++;
    else if (s > 0) learning++;
  }
  const unsorted = scoped.length - sorted;
  const toLearnSorted = sorted - alreadyKnew;
  // Re-projected from scratch on every render, so the target tightens with
  // each word you sort: the more you have sorted, the less of the estimate is
  // guesswork. With nothing sorted there is no rate yet, so assume the worst.
  const needRate = sorted ? toLearnSorted / sorted : 1;
  const estUnsorted = Math.round(unsorted * needRate);
  const target = toLearnSorted + estUnsorted;
  return {
    scoped: scoped.length, sorted, alreadyKnew, mastered, learning, unsorted,
    strength, target, estimated: unsorted > 0,
    knewRate: sorted ? alreadyKnew / sorted : null,
    toGo: Math.max(0, target - mastered - learning),
    pct: target ? Math.min(1, mastered / target) : 0,
    // graded progress: moves on every review, not once a month per word
    pctStarted: target ? Math.min(1, strength / target) : 0
  };
}

/** Monday-anchored start of the current local week. */
function weekStart(ms) {
  const d = new Date(ms == null ? Date.now() : ms);
  const dow = (d.getDay() + 6) % 7;                 // Monday = 0
  return today(d.getTime() - dow * CFG.DAY);
}

/**
 * The middle horizon: new words started this week against the pace the exam
 * actually demands. Days is the whole arc; the week is the unit you can still
 * course-correct inside.
 */
function weekProgress(need) {
  const start = weekStart();
  let done = 0, days = 0;
  for (let i = 0; i < 7; i++) {
    const key = today(Date.now() - i * CFG.DAY);
    if (key < start) break;
    done += (A.set.history[key] || {}).new || 0;
    days++;
  }
  const perDay = need == null ? overview().need : need;
  const target = Math.max(1, perDay * 7);
  return {
    done, target, days, daysLeft: 7 - days,
    left: Math.max(0, target - done),
    pct: Math.min(1, done / target),
    onTrack: done >= perDay * days
  };
}

/** The bar itself. Catchy is fine; misleading is not, hence the ~. */
function renderMilestone() {
  const el = $('#milestone');
  if (!el) return;
  const m = milestone();
  // a started word gets a visible sliver even when it rounds to nothing
  const seen = v => v > 0 ? Math.max(v * 100, 1.5).toFixed(1) : '0';
  const pct = seen(m.pct), started = seen(m.pctStarted);
  // The width is set to its true value immediately and the growth is a
  // transform animation on top. Animating the width itself would mean the bar
  // reads zero until the transition finishes — wrong under reduced motion, in
  // a screenshot, or if the render is interrupted.
  const wk = weekProgress();
  const wpct = wk.done > 0 ? Math.max(wk.pct * 100, 2).toFixed(1) : '0';

  el.innerHTML = `
    <div class="wbar"><i class="${wk.pct >= 1 ? 'done' : ''}" style="width:${wpct}%"></i></div>
    <div class="mlabel wlabel">
      <span><b>${wk.done.toLocaleString(loc())}</b> of ${
        wk.target.toLocaleString(loc())} this week</span>
      <span>${wk.daysLeft === 0 ? 'last day' :
        wk.daysLeft + (wk.daysLeft === 1 ? ' day left' : ' days left')}</span>
    </div>

    <div class="mbar">
      <i class="mlearning" style="width:${started}%"></i>
      <i class="mmastered ${m.pct >= 1 ? 'done' : ''}" style="width:${pct}%"></i>
      <div class="mticks">${'<span></span>'.repeat(10)}</div>
    </div>
    <div class="mlabel">
      <span><b>${m.mastered.toLocaleString(loc())}</b> mastered${
        m.learning ? ` · <b>${m.learning.toLocaleString(loc())}</b> learning` : ''}</span>
      <span>${m.toGo.toLocaleString(loc())} to go${m.estimated ? ' (est.)' : ''}</span>
    </div>`;
}

function renderHome() {
  setTint(null);
  const o = overview();
  const dayPct = o.dayTarget ? o.answered / o.dayTarget : 0;
  const lifePct = o.scoped ? Math.round(o.known / o.scoped * 100) : 0;
  $('#ringfill').setAttribute('stroke-dasharray', `${(dayPct * CIRC).toFixed(1)} ${CIRC}`);
  $('#ringfill').setAttribute('stroke',
    o.dayDone ? 'var(--green)' : 'var(--blue)');

  // a tick at the minimum day, so a bad evening still has a visible target
  const tickAt = o.dayTarget ? Math.min(1, CFG.MIN_DAY / o.dayTarget) : 0;
  const tick = $('#ringtick');
  tick.style.display = (o.dayDone || !o.dayTarget || tickAt >= 1) ? 'none' : '';
  tick.setAttribute('stroke-dasharray', `2 ${CIRC}`);
  tick.setAttribute('stroke-dashoffset', `${(-tickAt * CIRC).toFixed(1)}`);

  $('#ringpct').textContent = o.dayDone ? '✓' : o.answered.toLocaleString(loc());
  // the overall figure lives in the milestone bar now, so the ring is just today
  $('#ringsub').textContent = o.dayDone
    ? T('home.doneToday')
    : T('home.ofToday', { n: nfmt(o.dayTarget) });
  $('#countdown').textContent = T('home.countdown', { n: o.dte });
  renderMilestone();
  renderCounters(o);

  const bits = [];
  if (!isStandalone()) bits.push(installBanner());
  if (!o.triaged) bits.push(firstRunGuide());
  bits.push(nextAction(o));
  $('#todo').innerHTML = bits.join('');
}

/**
 * One obvious thing to do next, so Home never asks you to choose.
 * Sorting comes first because studying an unsorted list fills the queue with
 * words you already know — the one way to waste the whole schedule.
 */
function nextAction(o) {
  if (!o.triaged) {
    return '<button class="btn" data-go="triage">' + T('home.startSorting') + '</button>';
  }
  if (o.cards > 0) {
    const more = o.untriaged > 0
      ? `<button class="btn ghost sm" data-go="triage" style="margin-top:9px">
           ${T('home.sortMore', { n: nfmt(o.untriaged) })}</button>`
      : '';
    return `<button class="btn" data-go="study">
      ${T('home.study', { n: nfmt(o.cards) })}</button>` + more;
  }
  if (o.untriaged > 0) {
    return `<button class="btn" data-go="triage">
      ${T('home.sortWords', { n: nfmt(o.untriaged) })}</button>`;
  }
  return '<button class="btn" disabled>' + T('home.nothingDue') + '</button>';
}

/** The Today and Pace rows, which live under Stats but are kept current
    from Home too so the tab is never stale when you open it. */
function renderCounters(o) {
  o = o || overview();
  $('#s-due').textContent = o.due.toLocaleString(loc());
  $('#s-new').textContent = o.newLeft.toLocaleString(loc());
  $('#s-triage').textContent = o.untriaged.toLocaleString(loc());
  $('#s-streak').textContent =
    plural(A.set.streak || 0, 'u.day', 'u.days');
  const fz = A.set.freezes || 0;
  $('#s-freeze').textContent = plural(fz, 'u.freeze', 'u.freezes');
  renderHeat();
  $('#s-need').textContent = plural(o.need, 'u.word', 'u.words');
  const avg = recentPace(7);
  $('#s-actual').textContent = plural(avg, 'u.word', 'u.words');
  const tr = $('#s-track');
  if (!o.triaged) { tr.textContent = T('stats.sortFirst'); tr.style.color = 'var(--gold)'; }
  else if (avg >= o.need) { tr.textContent = T('stats.onTrack'); tr.style.color = 'var(--green)'; }
  else { tr.textContent = T('stats.behind'); tr.style.color = 'var(--gold)'; }
  renderPace(o.need);
}

/** Shown until the first word is sorted — the flow is not self-evident. */
function firstRunGuide() {
  return `<div class="note">
    <b>${T('guide.title')}</b>
    <ol><li>${T('guide.1')}</li><li>${T('guide.2')}</li><li>${T('guide.3')}</li></ol>
    </div>`;
}

/** Twelve weeks of activity, four levels, today ringed. */
function renderHeat() {
  const el = $('#heat');
  if (!el) return;
  const series = heatSeries(84);
  const t = today();
  el.innerHTML = '<div class="heat">' + series.map(d => {
    const lvl = d.n === 0 ? '' : d.n < 25 ? 'l1' : d.n < 75 ? 'l2' : d.n < 150 ? 'l3' : 'l4';
    return `<i class="${lvl}${d.key === t ? ' today' : ''}" title="${d.key}: ${d.n}"></i>`;
  }).join('') + '</div>';
}

/** Seven days of new words against the required daily pace. */
function renderPace(need) {
  const series = paceSeries(7);
  const top = Math.max(need, ...series.map(d => d.n), 1);
  const DOW = T('u.dow').split(' ');
  const bars = series.map(d =>
    `<div><i class="${d.n >= need && d.n > 0 ? 'hit' : ''}"
        style="height:${Math.max(3, d.n / top * 100)}%" title="${d.key}: ${d.n}"></i></div>`
  ).join('');
  const labels = series.map(d =>
    `<span>${DOW[new Date(d.key + 'T00:00:00').getDay()]}</span>`).join('');
  // the goal line sits inside the chart and is positioned as a percentage of
  // it, so changing the chart height cannot pull the two out of alignment
  $('#pace').innerHTML = `
    <div class="chart">${bars}
      <i class="goalline" style="bottom:${(need / top * 100).toFixed(1)}%"></i></div>
    <div class="chartx">${labels}</div>`;
}

function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}
function installBanner() {
  return `<div class="note">
    <b>${T('install.title')}</b>
    <p class="sub" style="margin:0">${T('install.body')}<br><br>${
      T('install.share')}</p></div>`;
}

/* ======================= motion primitives =======================
   Springs, momentum projection and rubber-banding, hand-rolled because the
   app carries no runtime dependencies. Apple's model: think in damping ratio
   and response, not mass/stiffness/damping. */

/**
 * Where a flick would come to rest. Apple's exponential-decay projection from
 * Designing Fluid Interfaces — not the textbook v²/2a, which lands short.
 */
function projectMomentum(velocity, decel) {
  const d = decel == null ? 0.998 : decel;
  return (velocity / 1000) * d / (1 - d);
}

/**
 * Progressive resistance past a boundary. A hard stop reads as frozen; real
 * things slow before they stop.
 */
function rubberband(overshoot, dimension, constant) {
  const c = constant == null ? 0.55 : constant;
  return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
}

/**
 * Damped spring, integrated per frame. Returns a handle whose .stop() gives
 * back the live value and velocity, so an interrupted animation can be
 * re-targeted from where it actually is rather than from where it was going.
 * That is the whole point of §3 — never start from the target value.
 */
function spring(opts) {
  const damping = opts.damping == null ? 1 : opts.damping;
  const response = opts.response == null ? 0.4 : opts.response;
  const w0 = 2 * Math.PI / response;
  let x = opts.from - opts.to;          // displacement from target
  let v = opts.velocity || 0;
  let raf = 0, last = 0, stopped = false;

  const step = now => {
    if (stopped) return;
    const dt = Math.min((now - last) / 1000, 1 / 30);   // clamp after a stall
    last = now;
    // semi-implicit Euler; stable at these frequencies
    const a = -w0 * w0 * x - 2 * damping * w0 * v;
    v += a * dt;
    x += v * dt;
    if (Math.abs(x) < 0.4 && Math.abs(v) < 12) {
      opts.onFrame(opts.to, 0);
      stopped = true;
      if (opts.onDone) opts.onDone();
      return;
    }
    opts.onFrame(opts.to + x, v);
    raf = requestAnimationFrame(step);
  };

  if (typeof requestAnimationFrame === 'function') {
    raf = requestAnimationFrame(now => { last = now; step(now + 16); });
  } else {                                   // no rAF (tests): settle at once
    opts.onFrame(opts.to, 0);
    if (opts.onDone) opts.onDone();
    stopped = true;
  }
  return {
    stop() {
      stopped = true;
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      return { value: opts.to + x, velocity: v };
    },
    get done() { return stopped; }
  };
}

/* ============================ triage ============================ */
const TG = { list: [], i: 0, undo: [] };
function startTriage() {
  TG.list = untriaged(); TG.i = 0; TG.undo = [];
  nextTriage();
}
function nextTriage() {
  if (TG.i >= TG.list.length) {
    $('#tg-word').innerHTML =
      '<span style="font-size:22px;color:var(--green)">All sorted</span>';
    $('#tg-count').textContent = '';
    $('#tg-meter').style.width = '100%';
    setTimeout(() => go('home'), 900);
    return;
  }
  if (TG.resetSwipe) TG.resetSwipe();
  const w = TG.list[TG.i];
  $('#tg-word').textContent = display(w);
  setTint(w.level.replace('*', ''));
  $('#tg-fach').textContent = w.fach ? T('tg.technical') : '';
  $('#tg-fach').style.display = w.fach ? '' : 'none';
  $('#tg-count').textContent = `${TG.i + 1} / ${TG.list.length}`;
  $('#tg-meter').style.width = (TG.i / TG.list.length * 100) + '%';
}
function triage(action) {
  if (action === 'undo') {
    if (!TG.undo.length) return;
    const id = TG.undo.pop();
    A.state.delete(id);
    A.dirty.delete(id);                  // never queue a write for a deleted record
    DB.tx('state', 'readwrite').delete(id);
    TG.i = Math.max(0, TG.i - 1);
    return nextTriage();
  }
  const w = TG.list[TG.i];
  if (!w) return;
  const st = newState();
  if (action === 'know') { st.s = 'known'; }
  else { st.s = 'queued'; st.u = action === 'unsure'; }
  setState(w.id, st);
  TG.undo.push(w.id);
  TG.i++;
  nextTriage();
}
$$('[data-tg]').forEach(b => b.addEventListener('click', () => triage(b.dataset.tg)));

/* Swipe: right = know, left = learn.
   The card tracks the finger 1:1, hints at the outcome as you go, projects
   where a flick would land, and can be grabbed again mid-flight. The previous
   version only read the final touch position, which threw away every frame of
   feedback in between. */
(function swipe() {
  const el = $('#tg-face');
  if (!el) return;
  const HYST = 10;              // movement before we commit to a direction
  let anim = null, x = 0, grabbed = false, axis = null;
  let startX = 0, startY = 0, lastX = 0, lastT = 0, vel = 0;

  const width = () => (el.getBoundingClientRect().width || 320);
  const paint = px => {
    x = px;
    const w = width();
    const p = Math.max(-1, Math.min(1, px / (w * 0.5)));
    el.style.transform = `translate3d(${px}px,0,0) rotate(${p * 5}deg)`;
    // telegraph the outcome rather than making the user guess the threshold
    const know = $('#tg-yes'), learn = $('#tg-no');
    if (know) know.style.opacity = Math.max(0, p);
    if (learn) learn.style.opacity = Math.max(0, -p);
  };
  const reset = () => {
    if (anim) { anim.stop(); anim = null; }
    el.style.transition = '';
    paint(0);
  };
  TG.resetSwipe = reset;

  el.addEventListener('pointerdown', e => {
    if (e.button) return;
    // interrupt: take over from wherever the card actually is right now
    let v0 = 0;
    if (anim) { const s = anim.stop(); x = s.value; v0 = s.velocity; anim = null; }
    grabbed = true; axis = null;
    startX = e.clientX - x; startY = e.clientY;
    lastX = e.clientX; lastT = performance.now(); vel = v0;
    if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
  });

  el.addEventListener('pointermove', e => {
    if (!grabbed) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!axis) {
      if (Math.abs(dx) < HYST && Math.abs(dy) < HYST) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis === 'y') { grabbed = false; return; }   // let the page have it
    }
    const now = performance.now(), dt = Math.max(1, now - lastT);
    vel = (e.clientX - lastX) / dt * 1000;             // px per second
    lastX = e.clientX; lastT = now;

    // soft edges: the card keeps responding, it just stops keeping up
    const w = width(), lim = w * 0.62;
    paint(Math.abs(dx) > lim
      ? Math.sign(dx) * (lim + rubberband(Math.abs(dx) - lim, w))
      : dx);
  });

  const release = () => {
    if (!grabbed) return;
    grabbed = false;
    const w = width();
    // decide from where the flick is GOING, not where the finger stopped
    const projected = x + projectMomentum(vel);
    const commit = Math.abs(projected) > w * 0.38;
    const dir = projected > 0 ? 1 : -1;

    if (commit) {
      const action = dir > 0 ? 'know' : 'learn';
      anim = spring({
        from: x, to: dir * w * 1.6, velocity: vel,
        damping: 1, response: 0.32,
        onFrame: paint,
        // snap back to origin BEFORE the next word renders, or it flashes in
        // at the off-screen position for a frame
        onDone: () => { anim = null; reset(); triage(action); }
      });
    } else {
      // a flick that did not carry gets a little bounce coming back
      anim = spring({
        from: x, to: 0, velocity: vel, damping: 0.8, response: 0.34,
        onFrame: paint, onDone: () => { anim = null; }
      });
    }
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
})();

/* ============================ study ============================ */
const ST = {
  queue: [], i: 0, mode: 'de2en', t0: 0, revealed: false, done: 0,
  elapsed: 0, again: new Map(), t0session: 0, wrong: 0, sent: null,
  aux: null,        // auxiliary picked in the verb-form drill
  pat: null,        // rection pattern being asked
  prep: null        // preposition picked, before the case step
};
/* Modes that grade themselves and have no reveal step. `match` must be here or
   a tap on the card face during a pairing round reveals the underlying card
   and lets the grade buttons hijack the round. */
const AUTO_MODES = {
  type: true, article: true, verb: true, rection: true, match: true,
  cloze: true, hint: true
};
/** Pairing-round state. Separate from ST because a round spans five cards. */
const MT = { words: null, miss: null, pairedIds: null, sel: null, t0: 0 };

function startStudy() {
  ST.queue = buildSession(); ST.i = 0; ST.done = 0; ST.again = new Map();
  ST.wrong = 0; ST.t0session = Date.now();
  MT.words = null;
  // open with a pairing round when there are enough lightly-seen words, and
  // float them to the front so the round consumes a contiguous block
  const round = ST.queue.length >= CFG.MATCH_PAIRS + 3 ? pickMatchRound(ST.queue) : null;
  if (round) {
    const ids = new Set(round.map(w => w.id));
    ST.queue = round.concat(ST.queue.filter(w => !ids.has(w.id)));
    ST.matchRound = round;
  } else {
    ST.matchRound = null;
  }
  if (!ST.queue.length) {
    $('#st-prompt').innerHTML =
      '<span style="font-size:20px;color:var(--green)">Nothing due today</span>';
    $('#st-answer').classList.add('hidden');
    $('#st-gram').classList.add('hidden');
    $('#st-hint').textContent = T('st.comeBack');
    hidePads();
    $('#st-donepad').classList.remove('hidden');
    $('#st-count').textContent = '';
    return;
  }
  showCard();
}
function hidePads() {
  ['#st-pad', '#st-grades', '#st-typepad', '#st-artpad', '#st-verbpad',
    '#st-prepad', '#st-casepad', '#st-matchpad', '#st-clozepad',
    '#st-result', '#st-donepad']
    .forEach(s => $(s).classList.add('hidden'));
}

/* ---- pairing round ----
   Five words against five meanings, as an opening round. It is the easiest
   mode by design: it opens the session with fast wins so starting is cheap,
   and it forces discrimination between words you half-know rather than
   recall in isolation. Only words with few reps qualify. */
function pickMatchRound(queue, want) {
  const n = want || CFG.MATCH_PAIRS;
  const eligible = [];
  const seen = new Set();
  for (const w of queue) {
    if (seen.has(w.id)) continue;
    const st = getState(w.id);
    if ((st ? st.r : 0) > 2) continue;
    if (eligible.some(x => familyKey(x) === familyKey(w))) continue;  // no siblings
    seen.add(w.id);
    eligible.push(w);
    if (eligible.length === n) break;
  }
  return eligible.length === n ? eligible : null;
}

/**
 * Pull a pairing round to the cursor out of the cards still ahead.
 * Splices by object identity so a word that appears twice (because it was
 * re-looked) keeps its second instance — removing by id would silently drop
 * cards from the session.
 */
function stageMatchRound() {
  const upcoming = ST.queue.slice(ST.i);
  const round = pickMatchRound(upcoming);
  if (!round) return null;
  const rest = upcoming.slice();
  for (const w of round) {
    const at = rest.indexOf(w);
    if (at >= 0) rest.splice(at, 1);
  }
  ST.queue = ST.queue.slice(0, ST.i).concat(round, rest);
  return round;
}

function startMatch(words) {
  MT.words = words;
  MT.miss = new Map(words.map(w => [w.id, 0]));
  MT.pairedIds = new Set();
  MT.sel = null;
  MT.t0 = performance.now();

  const rnd = seededRandom(daySeed() ^ words[0].id);
  const left = shuffleSeeded(words, rnd);
  const right = shuffleSeeded(words, seededRandom(daySeed() ^ (words[0].id + 977)));
  const cell = (w, side, label) =>
    `<button class="mtile" data-side="${side}" data-wid="${w.id}">${esc(label)}</button>`;

  $('#st-prompt').innerHTML = T('st.matchPairs') + '<small class="gloss">' + T('st.matchSub') + '</small>';
  $('#st-answer').classList.add('hidden');
  $('#st-gram').classList.add('hidden');
  $('#st-hint').textContent = '';
  $('#st-mode').textContent = modeLabel('match');
  $('#st-face').classList.add('top');

  const rows = [];
  for (let i = 0; i < words.length; i++) {
    rows.push(cell(left[i], 'de', display(left[i])));
    rows.push(cell(right[i], 'en', right[i].en));
  }
  $('#st-matchgrid').innerHTML = rows.join('');
  hidePads();
  $('#st-matchpad').classList.remove('hidden');
  $('#st-face').closest('.stage').classList.add('matching');
  replayEnter($('#st-matchpad'));
}

function matchTap(btn) {
  if (btn.classList.contains('gone')) return;
  const side = btn.dataset.side, wid = +btn.dataset.wid;
  if (!MT.sel) {
    MT.sel = btn;
    btn.classList.add('sel');
    return;
  }
  if (MT.sel === btn) { btn.classList.remove('sel'); MT.sel = null; return; }
  if (MT.sel.dataset.side === side) {           // same column — move the selection
    MT.sel.classList.remove('sel');
    MT.sel = btn; btn.classList.add('sel');
    return;
  }
  const first = MT.sel;
  MT.sel = null;
  first.classList.remove('sel');

  if (+first.dataset.wid === wid) {
    first.classList.add('gone');
    btn.classList.add('gone');
    MT.pairedIds.add(wid);
    if (MT.pairedIds.size === MT.words.length) setTimeout(finishMatch, 260);
  } else {
    MT.miss.set(+first.dataset.wid, (MT.miss.get(+first.dataset.wid) || 0) + 1);
    MT.miss.set(wid, (MT.miss.get(wid) || 0) + 1);
    [first, btn].forEach(b => {
      b.classList.add('bad');
      setTimeout(() => b.classList.remove('bad'), 320);
    });
  }
}

function finishMatch() {
  const per = (performance.now() - MT.t0) / MT.words.length;
  for (const w of MT.words) {
    const miss = MT.miss.get(w.id) || 0;
    const grade = miss === 0 ? adjustGrade(G.GOOD, per, 'match')
      : miss === 1 ? G.HARD : G.AGAIN;
    gradeWord(w, grade, per, 'match');
  }
  // the round consumed the first five cards of the queue
  ST.i += MT.words.length;
  MT.words = null;
  $('#st-face').closest('.stage').classList.remove('matching');
  showCard();
}

$('#st-matchgrid').addEventListener('click', e => {
  const b = e.target.closest('.mtile');
  if (b && MT.words) matchTap(b);
});
function showCard() {
  if (ST.i >= ST.queue.length) {
    const mins = Math.max(1, Math.round((Date.now() - ST.t0session) / CFG.MIN));
    const acc = ST.done ? Math.round((ST.done - ST.wrong) / ST.done * 100) : 100;
    $('#st-prompt').innerHTML =
      `<span style="font-size:20px;color:var(--green)">Session complete</span>`;
    $('#st-answer').classList.add('hidden');
    // end on what you achieved, not on a bare count
    $('#st-gram').innerHTML =
      `<b>${ST.done}</b> cards · <b>${acc}%</b> right · <b>${mins}</b> min`;
    $('#st-gram').classList.remove('hidden');
    const o = overview();
    $('#st-hint').textContent = o.dayDone
      ? T('st.allDone')
      : o.cards + ' still waiting today';
    hidePads();
    $('#st-donepad').classList.remove('hidden');
    $('#st-meter').style.width = '100%';
    flush();
    renderHome();
    return;
  }
  // Pairing rounds: one to open the session, then every MATCH_EVERY cards
  // while there are still lightly-seen words ahead to build one from.
  let round = null;
  if (ST.matchRound && ST.i === 0) {
    round = ST.matchRound;
    ST.matchRound = null;
  } else if (ST.i > 0 && ST.i % CFG.MATCH_EVERY === 0 &&
             ST.queue.length - ST.i > CFG.MATCH_PAIRS + 2) {
    round = stageMatchRound();
  }
  if (round) {
    ST.mode = 'match';
    $('#st-count').textContent = `${ST.i + 1} / ${ST.queue.length}`;
    $('#st-meter').style.width = (ST.i / ST.queue.length * 100) + '%';
    setTint(round[0].level.replace('*', ''));
    startMatch(round);
    return;
  }

  const w = ST.queue[ST.i];
  ST.mode = pickMode(w);
  ST.revealed = false;
  ST.t0 = performance.now();
  replayEnter($('#st-face'));

  setTint(w.level.replace('*', ''));
  $('#st-mode').textContent = modeLabel(ST.mode);
  $('#st-answer').classList.add('hidden');
  $('#st-gram').classList.add('hidden');
  $('#st-mask').classList.add('hidden');
  $('#st-gram').innerHTML = grammar(w);
  $('#st-face').classList.toggle('top', !!AUTO_MODES[ST.mode]);
  hidePads();

  if (ST.mode === 'hint') {
    const lvl = hintLevel(getState(w.id));
    ST.hintLvl = lvl;
    $('#st-prompt').innerHTML = esc(w.en) + '<small>' + esc(posLabel(w.pos)) + '</small>';
    $('#st-mask').innerHTML = hintMask(w, lvl)
      .replace(/·/g, '<i>·</i>').replace(/ /g, '&nbsp;');
    $('#st-mask').classList.remove('hidden');
    $('#st-answer').innerHTML = displayMarked(w);
    $('#st-hint').textContent = lvl >= HINT_MAX
      ? (isDrillableNoun(w) ? T('st.noHelpArticle') : T('st.noHelp'))
      : (isDrillableNoun(w) ? T('st.includeArticle') : T('st.fillRest'));
    const inp = $('#st-input');
    inp.value = ''; inp.disabled = false;
    $('#st-check').disabled = true;
    $('#st-typepad').classList.remove('hidden');
    inp.focus();
  } else if (ST.mode === 'type') {
    $('#st-prompt').innerHTML = esc(w.en) + '<small>' + esc(posLabel(w.pos)) + '</small>';
    $('#st-answer').innerHTML = displayMarked(w);
    $('#st-hint').textContent = isDrillableNoun(w)
      ? T('st.includeArticle') : T('st.typeGermanAria');
    const inp = $('#st-input');
    inp.value = ''; inp.disabled = false;
    $('#st-check').disabled = true;
    $('#st-typepad').classList.remove('hidden');
    inp.focus();
  } else if (ST.mode === 'article') {
    $('#st-prompt').innerHTML = esc(w.lemma) + '<small class="gloss">' + esc(w.en) + '</small>';
    $('#st-answer').innerHTML = displayMarked(w);
    $('#st-hint').textContent = T('st.whichArticle');
    $('#st-artpad').classList.remove('hidden');
  } else if (ST.mode === 'verb') {
    $('#st-prompt').innerHTML = esc(w.lemma) + '<small class="gloss">' + esc(w.en) + '</small>';
    $('#st-answer').innerHTML = esc(verbFormsLine(w));
    $('#st-hint').textContent = T('st.verbSub');
    $('#st-vprt').value = ''; $('#st-vprt').disabled = false;
    $('#st-vpp').value = ''; $('#st-vpp').disabled = false;
    ST.aux = null;
    $$('[data-aux]').forEach(b => b.classList.remove('sel'));
    $('#st-vcheck').disabled = true;
    $('#st-verbpad').classList.remove('hidden');
  } else if (ST.mode === 'cloze') {
    const list = sentencesFor(w);
    ST.sent = list[(getState(w.id) ? getState(w.id).r : 0) % list.length];
    $('#st-prompt').innerHTML = '<span class="sentence">' + clozePrompt(ST.sent) + '</span>';
    $('#st-answer').innerHTML = '<span class="sentence">' + clozeFilled(ST.sent) + '</span>';
    $('#st-gram').innerHTML = esc(ST.sent[3]);
    $('#st-hint').textContent = T('st.whichWord');
    $('#st-clozeopts').innerHTML = clozeChoices(w, w.id)
      .map(o => `<button class="gbtn pbtn" data-cloze="${esc(o)}">${esc(o)}</button>`).join('');
    $('#st-clozepad').classList.remove('hidden');
  } else if (ST.mode === 'rection') {
    const pats = rectionFor(w);
    ST.pat = pats[(getState(w.id) ? getState(w.id).r : 0) % pats.length];
    ST.prep = null;
    $('#st-prompt').innerHTML = rectionPrompt(w, ST.pat);
    $('#st-answer').innerHTML = esc(rectionAnswer(ST.pat));
    $('#st-hint').textContent = T('st.whichPrep');
    if (ST.pat.ex) $('#st-gram').innerHTML = '<b>' + esc(ST.pat.ex) + '</b>';
    $('#st-preps').innerHTML = prepChoices(ST.pat, w.id)
      .map(p => `<button class="gbtn pbtn" data-prep="${esc(p)}">${esc(p)}</button>`).join('');
    $('#st-prepad').classList.remove('hidden');
  } else {
    $('#st-prompt').innerHTML = ST.mode === 'de2en'
      ? esc(display(w))
      : esc(w.en) + '<small>' + esc(posLabel(w.pos)) + '</small>';
    $('#st-answer').innerHTML = ST.mode === 'de2en' ? esc(w.en) : displayMarked(w);
    $('#st-hint').textContent = T('st.tapReveal');
    $('#st-pad').classList.remove('hidden');
  }

  $('#st-count').textContent = `${ST.i + 1} / ${ST.queue.length}`;
  $('#st-meter').style.width = (ST.i / ST.queue.length * 100) + '%';
  const pad = $$('.pad').find(p => !p.classList.contains('hidden'));
  if (pad) replayEnter(pad);
}
function posLabel(p) {
  return ({ noun: 'noun', verb: 'verb', adj: 'adjective', adv: 'adverb',
    conj: 'conjunction', prep: 'preposition', pron: 'pronoun', num: 'numeral',
    det: 'determiner', particle: 'particle', intj: 'interjection',
    prefix: 'prefix' })[p] || p;
}
function reveal() {
  if (ST.revealed || ST.i >= ST.queue.length) return;
  if (AUTO_MODES[ST.mode]) return;        // typed and article cards grade themselves
  ST.revealed = true;
  ST.elapsed = performance.now() - ST.t0;
  $('#st-answer').classList.remove('hidden');
  if ($('#st-gram').innerHTML) $('#st-gram').classList.remove('hidden');
  $('#st-hint').textContent = '';
  $('#st-pad').classList.add('hidden');
  $('#st-grades').classList.remove('hidden');

  const w = ST.queue[ST.i];
  const st = getState(w.id) || newState();
  const iv = previewIntervals(st);
  for (let k = 0; k < 4; k++) $('#i' + k).textContent = iv[k];
  speakCard(w, ST.mode);
}
$('#st-reveal').addEventListener('click', reveal);
$('#st-face').addEventListener('click', reveal);

/* Cards due again inside the session window come back this session — that is
   what makes the 10-minute learning step do something. Capped per word so a
   card that keeps failing cannot stretch the session without limit. */
function requeueIfSoon(w, st) {
  if (st.d - Date.now() >= 20 * CFG.MIN) return;
  if (st.s === 'known' || st.s === 'leech') return;
  const seen = ST.again.get(w.id) || 0;
  if (seen >= CFG.MAX_REENTRY) return;
  ST.again.set(w.id, seen + 1);

  // Where the cursor will be once this answer is finished. A pairing round
  // settles several words before advancing, so it has to be accounted for or
  // the card lands behind the cursor and is silently never shown.
  const base = (MT.words ? ST.i + MT.words.length : ST.i + 1);
  const gap = CFG.REENTRY_GAPS[Math.min(seen, CFG.REENTRY_GAPS.length - 1)];
  const at = Math.min(base + gap, ST.queue.length);
  ST.queue.splice(at, 0, w);
}

/** Grade one word without advancing the card cursor — the pairing round
    settles five words at once, so scoring and advancing are separate. */
function gradeWord(w, grade, elapsed, mode) {
  let st = getState(w.id);
  const wasNew = !st || st.s === 'queued' || st.s === 'new';
  if (!st) st = newState();
  pushTime(mode, elapsed);
  st.t = Math.round(elapsed);
  st.m[mode] = (st.m[mode] || 0) + 1;
  if (grade === G.AGAIN) ST.wrong++;
  applyGrade(st, grade, Date.now());
  setState(w.id, st);
  requeueIfSoon(w, st);
  logAnswer(wasNew, grade);
  ST.done++;
}

function commitAnswer(w, grade, elapsed) {
  gradeWord(w, grade, elapsed, ST.mode);
  ST.i++;
}

$$('[data-grade]').forEach(b => b.addEventListener('click', () => {
  const w = ST.queue[ST.i];
  if (!w || !ST.revealed || MT.words) return;
  const raw = b.dataset.grade;
  if (raw === 'know') {
    let st = getState(w.id);
    const wasNew = !st || st.s === 'queued' || st.s === 'new';
    if (!st) st = newState();
    st.s = 'known';
    setState(w.id, st);
    logAnswer(wasNew, null);
    ST.done++;
    ST.i++;
  } else {
    commitAnswer(w, adjustGrade(+raw, ST.elapsed, ST.mode), ST.elapsed);
  }
  showCard();
}));

/* ---- auto-graded modes: typing and article drill ---- */

/** Show the result banner and park the card until the user taps Weiter. */
function showResult(ok, title, detail) {
  const bar = $('#st-result');
  bar.className = 'resultbar ' + (ok ? 'good' : 'bad');
  $('#st-ricon').textContent = ok ? '✓' : '✕';
  $('#st-rtitle').textContent = title;
  $('#st-rbody').innerHTML = detail;
  $('#st-answer').classList.remove('hidden');
  if ($('#st-gram').innerHTML) $('#st-gram').classList.remove('hidden');
  $('#st-hint').textContent = '';
  speakCard(ST.queue[ST.i], ST.mode);
}

function submitTyped() {
  const w = ST.queue[ST.i];
  if (!w || ST.revealed || (ST.mode !== 'type' && ST.mode !== 'hint')) return;
  const inp = $('#st-input');
  const raw = inp.value;
  if (!raw.trim()) return;
  ST.revealed = true;
  ST.elapsed = performance.now() - ST.t0;
  inp.disabled = true;
  inp.blur();                 // drop the keyboard so the result is fully visible
  $('#st-typepad').classList.add('hidden');

  const res = checkTyped(w, raw);
  let grade;
  if (!res.ok) {
    grade = G.AGAIN;
    // showing what was typed next to the answer is the whole lesson — without
    // it you cannot see which part you got wrong
    showResult(false, T('st.notQuite'),
      T('st.youWrote') + ' <s>' + esc(raw.trim()) + '</s><br>' + T('st.answer') + '<i>' +
      esc(res.expected) + '</i>');
  } else if (res.near) {
    grade = G.HARD;
    showResult(true, T('st.almost'),
      T('st.youWrote') + ' <s>' + esc(raw.trim()) + '</s><br>' + T('st.spelling') + '<i>' +
      esc(res.expected) + '</i>');
  } else {
    // the card face already shows the word — the banner would only repeat it
    grade = adjustGrade(G.GOOD, ST.elapsed, ST.mode);
    showResult(true, T('st.correct'), '');
  }
  commitAnswer(w, grade, ST.elapsed);

  // The scaffold shrinks only when you got it right, and grows back one step
  // when you did not — failing should never cost you help.
  if (ST.mode === 'hint') {
    const st = getState(w.id);
    if (st) {
      const cur = ST.hintLvl;
      st.h = res.ok && !res.near ? Math.min(HINT_MAX, cur + 1)
        : res.ok ? cur
          : Math.max(0, cur - 1);
      setState(w.id, st);
    }
  }
  $('#st-result').classList.remove('hidden');
}

function submitArticle(picked) {
  const w = ST.queue[ST.i];
  if (!w || ST.revealed || ST.mode !== 'article') return;
  ST.revealed = true;
  ST.elapsed = performance.now() - ST.t0;
  $('#st-artpad').classList.add('hidden');

  const ok = picked === w.article;
  const grade = ok ? adjustGrade(G.GOOD, ST.elapsed, ST.mode) : G.AGAIN;
  showResult(ok, ok ? T('st.correct') : T('st.notQuite'),
    ok ? '' : T('st.youChose') + ' <s>' + esc(picked) + '</s><br>' + T('st.answer') + '<i>' +
      esc(w.article + ' ' + w.lemma) + '</i>');
  commitAnswer(w, grade, ST.elapsed);
  $('#st-result').classList.remove('hidden');
}

/* ---- verb forms ---- */
function verbFormsLine(w) {
  const a = auxFor(w);
  return [w.prt, w.pp, a === 'both' ? 'haben/sein' : a].join(' · ');
}
function submitVerb() {
  const w = ST.queue[ST.i];
  if (!w || ST.revealed || ST.mode !== 'verb') return;
  const prt = $('#st-vprt').value, pp = $('#st-vpp').value;
  if (!prt.trim() || !pp.trim() || !ST.aux) return;
  ST.revealed = true;
  ST.elapsed = performance.now() - ST.t0;
  $('#st-vprt').disabled = true;
  $('#st-vpp').disabled = true;
  $('#st-vpp').blur();
  $('#st-verbpad').classList.add('hidden');

  const res = checkVerbForms(w, prt, pp, ST.aux);
  const yours = [prt.trim(), pp.trim(), ST.aux].join(' · ');
  let grade;
  if (!res.ok) {
    grade = G.AGAIN;
    showResult(false, T('st.notQuite'),
      T('st.youWrote') + ' <s>' + esc(yours) + '</s><br>' + T('st.answer') + '<i>' +
      esc(verbFormsLine(w)) + '</i>');
  } else if (res.near) {
    grade = G.HARD;
    showResult(true, T('st.almost'),
      T('st.youWrote') + ' <s>' + esc(yours) + '</s><br>' + T('st.spelling') + '<i>' +
      esc(verbFormsLine(w)) + '</i>');
  } else {
    grade = adjustGrade(G.GOOD, ST.elapsed, ST.mode);
    showResult(true, T('st.correct'), '');
  }
  commitAnswer(w, grade, ST.elapsed);
  $('#st-result').classList.remove('hidden');
}
function syncVerbPad() {
  $('#st-vcheck').disabled =
    !($('#st-vprt').value.trim() && $('#st-vpp').value.trim() && ST.aux);
}
['#st-vprt', '#st-vpp'].forEach(sel => {
  $(sel).addEventListener('input', syncVerbPad);
  $(sel).addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    if (sel === '#st-vprt') $('#st-vpp').focus(); else submitVerb();
  });
});
$$('[data-aux]').forEach(b => b.addEventListener('click', () => {
  if (ST.revealed) return;
  ST.aux = b.dataset.aux;
  $$('[data-aux]').forEach(x => x.classList.toggle('sel', x === b));
  syncVerbPad();
}));
$('#st-vcheck').addEventListener('click', submitVerb);

/* ---- rection: preposition, then case ---- */
const CONTRACTIONS = {
  von: ['vom'], an: ['am', 'ans'], in: ['im', 'ins'], zu: ['zum', 'zur'],
  bei: ['beim'], auf: ['aufs'], 'für': ['fürs']
};
/** The example sentence with the preposition replaced by a blank. */
function blankExample(pat) {
  if (!pat.ex) return '';
  const alts = [pat.prep].concat(CONTRACTIONS[pat.prep] || [])
    .sort((a, b) => b.length - a.length)
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp('(^|\\s)(' + alts.join('|') + ')(?=\\s|[.,!?])', 'i');
  const safe = esc(pat.ex);
  return re.test(safe) ? safe.replace(re, '$1___') : '';
}
function rectionPrompt(w, pat) {
  const head = (pat.reflexive ? 'sich ' : '') + w.lemma;
  const blank = blankExample(pat);
  return esc(head) + '<small class="gloss">' + esc(pat.en) + '</small>' +
    (blank ? '<small class="gloss">' + blank + '</small>' : '');
}
function rectionAnswer(pat) {
  const needsCase = pat.kase === 'Dativ' || pat.kase === 'Akkusativ';
  return pat.prep + (needsCase ? ' + ' + pat.kase : '');
}
function finishRection(kase) {
  const w = ST.queue[ST.i];
  ST.revealed = true;
  ST.elapsed = performance.now() - ST.t0;
  $('#st-prepad').classList.add('hidden');
  $('#st-casepad').classList.add('hidden');

  const res = checkRection(ST.pat, ST.prep, kase);
  let grade;
  if (!res.prepOk) {
    grade = G.AGAIN;
    showResult(false, T('st.notQuite'),
      T('st.youChose') + ' <s>' + esc(ST.prep) + '</s><br>' + T('st.answer') + '<i>' +
      esc(rectionAnswer(ST.pat)) + '</i>');
  } else if (res.near) {
    grade = G.HARD;
    showResult(true, T('st.almost'),
      T('st.prepWrongCase') + '<i>' +
      esc(rectionAnswer(ST.pat)) + '</i>');
  } else {
    grade = adjustGrade(G.GOOD, ST.elapsed, ST.mode);
    showResult(true, T('st.correct'), '<i>' + esc(rectionAnswer(ST.pat)) + '</i>');
  }
  commitAnswer(w, grade, ST.elapsed);
  $('#st-result').classList.remove('hidden');
}
/* ---- cloze: choose the word that fits ---- */
$('#st-clozeopts').addEventListener('click', e => {
  const b = e.target.closest('[data-cloze]');
  const w = ST.queue[ST.i];
  if (!b || !w || ST.revealed || ST.mode !== 'cloze') return;
  ST.revealed = true;
  ST.elapsed = performance.now() - ST.t0;
  $('#st-clozepad').classList.add('hidden');

  const picked = b.dataset.cloze;
  const ok = picked === w.lemma;
  const grade = ok ? adjustGrade(G.GOOD, ST.elapsed, ST.mode) : G.AGAIN;
  showResult(ok, ok ? T('st.correct') : T('st.notQuite'),
    ok ? '' : T('st.youChose') + ' <s>' + esc(picked) + '</s><br>' + T('st.answer') + '<i>' +
      esc(w.lemma) + '</i>');
  commitAnswer(w, grade, ST.elapsed);
  $('#st-result').classList.remove('hidden');
});

$('#st-preps').addEventListener('click', e => {
  const b = e.target.closest('[data-prep]');
  if (!b || ST.revealed || ST.mode !== 'rection' || ST.prep) return;
  ST.prep = b.dataset.prep;
  const needsCase = ST.pat.kase === 'Dativ' || ST.pat.kase === 'Akkusativ';
  // only ask for the case once the preposition is right — a wrong preposition
  // makes the case question meaningless
  if (ST.prep === ST.pat.prep && needsCase) {
    $('#st-prepad').classList.add('hidden');
    $('#st-hint').textContent = T('st.whichCase');
    $('#st-casepad').classList.remove('hidden');
    return;
  }
  finishRection(null);
});
$$('[data-case]').forEach(b => b.addEventListener('click', () => {
  if (ST.revealed || ST.mode !== 'rection') return;
  finishRection(b.dataset.case);
}));

$('#st-input').addEventListener('input', e => {
  $('#st-check').disabled = !e.target.value.trim();
});
$('#st-input').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  // stop the press from also reaching the document handler below, which would
  // submit and immediately skip past the result
  e.preventDefault(); e.stopPropagation();
  submitTyped();
});

/* After an auto-graded answer the keyboard is already up, so Enter should
   advance instead of forcing a reach for the button. */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || current !== 'study') return;
  if ($('#st-result').classList.contains('hidden')) return;
  e.preventDefault();
  $('#st-continue').click();
});
$('#st-check').addEventListener('click', submitTyped);
$$('[data-art]').forEach(b =>
  b.addEventListener('click', () => submitArticle(b.dataset.art)));
$('#st-continue').addEventListener('click', () => {
  $('#st-result').classList.add('hidden');
  showCard();
});

/* ============================ browse ============================ */
function renderBrowse() {
  const q = $('#br-q').value.trim().toLowerCase();
  const lvl = $('#br-lvl').value, stf = $('#br-state').value;
  const out = [];
  for (const w of A.words) {
    if (lvl && w.level.replace('*', '') !== lvl) continue;
    const st = A.state.get(w.id);
    const s = st ? st.s : 'new';
    if (stf) {
      if (stf === 'new' && st) continue;
      if (stf === 'learning' && !(s === 'learning' || s === 'relearning' || s === 'queued')) continue;
      if (stf === 'review' && s !== 'review') continue;
      if (stf === 'known' && s !== 'known') continue;
      if (stf === 'leech' && s !== 'leech') continue;
    }
    if (q && !w.lemma.toLowerCase().includes(q) && !w.en.toLowerCase().includes(q)) continue;
    out.push(w);
    if (out.length >= 300) break;
  }
  $('#br-count').textContent = out.length >= 300 ? '300+' : out.length;
  $('#br-list').innerHTML = out.map(w => {
    const st = A.state.get(w.id);
    const s = st ? st.s : 'new';
    const badge = { known: '✓', leech: '!', review: '↻', learning: '•', relearning: '•', queued: '▸', new: '' }[s] || '';
    const lv = w.level.replace('*', '');
    return `<div class="wrow" data-id="${w.id}">
      <span class="pill p-${lv}">${lv}</span>
      <div><b>${esc(display(w))}</b><span>${esc(w.en)}</span></div>
      <span style="color:var(--faint);font-size:16px;width:18px;text-align:center">${badge}</span>
    </div>`;
  }).join('') || `<div class="empty">${T('br.noMatch')}</div>`;
}
['#br-q', '#br-lvl', '#br-state'].forEach(s => {
  const el = $(s);
  el.addEventListener('input', renderBrowse);
  el.addEventListener('change', renderBrowse);
});
$('#br-list').addEventListener('click', e => {
  const row = e.target.closest('[data-id]');
  if (!row) return;
  const id = +row.dataset.id, w = A.words[id], st = A.state.get(id);
  if (st && st.s === 'known') {
    A.state.delete(id); A.dirty.delete(id); DB.tx('state', 'readwrite').delete(id);
    toast(T('br.backQueue'));
  } else {
    const n = newState(); n.s = 'known'; setState(id, n);
    toast(T('br.markedKnown'));
  }
  renderBrowse();
});

/* ============================ stats ============================ */
function renderStats() {
  renderCounters();
  const scoped = A.words.filter(inScope);
  const c = { new: 0, queued: 0, learning: 0, review: 0, known: 0, leech: 0 };
  // derived from MODE_LABEL so the counters and the rows cannot drift apart —
  // a missing key here used to throw and blank the whole screen
  const modeReps = {};
  for (const k in MODE_LABEL) modeReps[k] = 0;
  for (const w of scoped) {
    const st = A.state.get(w.id);
    if (!st) { c.new++; continue; }
    if (st.s === 'relearning') c.learning++;
    else if (c[st.s] !== undefined) c[st.s]++;
    for (const k in modeReps) if (st.m && st.m[k]) modeReps[k] += st.m[k];
  }
  const leeches = [];
  for (const [id, st] of A.state) if (st.s === 'leech') leeches.push(A.words[id]);

  const secs = m => (medianFor(m) / 1000).toFixed(1) + ' s';

  const ms = milestone();
  const wk = weekProgress();
  const ret = retention(30);
  const left = remainingToLearn();
  const proj = projectedDays();
  const dte = daysToExam();
  const fmt = ms => new Date(ms).toLocaleDateString(loc(),
    { day: 'numeric', month: 'short', year: 'numeric' });
  const projLabel = proj == null ? T('stats.noData') : fmt(Date.now() + proj * CFG.DAY);
  const projColor = proj == null ? 'var(--dim)'
    : (proj <= dte ? 'var(--green)' : 'var(--gold)');
  const examLabel = fmt(new Date(A.set.exam + 'T09:00:00').getTime());

  $('#stats-body').innerHTML = `
    <h2>${T('stats.where')}</h2>
    <div class="card">
      <div class="stat"><span>${T('br.known')}</span><b>${c.known.toLocaleString(loc())}</b></div>
      <div class="stat"><span>${T('br.inReview')}</span><b>${c.review.toLocaleString(loc())}</b></div>
      <div class="stat"><span>${T('br.learning')}</span><b>${c.learning.toLocaleString(loc())}</b></div>
      <div class="stat"><span>${T('stats.waiting')}</span><b>${c.queued.toLocaleString(loc())}</b></div>
      <div class="stat"><span>${T('stats.notSortedYet')}</span><b>${c.new.toLocaleString(loc())}</b></div>
      <div class="stat"><span>${T('br.difficult')}</span><b>${c.leech.toLocaleString(loc())}</b></div>
    </div>
    <h2>${T('stats.byExercise')}</h2>
    <div class="card">
      ${Object.keys(MODE_LABEL).map(k =>
        `<div class="stat"><span>${modeLabel(k)}</span>
          <b>${modeReps[k].toLocaleString(loc())}<i> · ${secs(k)}</i></b></div>`).join('')}
    </div>
    <h2>${T('stats.willYouMakeIt')}</h2>
    <div class="card">
      <div class="stat"><span>${T('stats.retention')}</span><b>${
        ret == null ? '–' : Math.round(ret * 100) + '%'}</b></div>
      <div class="stat"><span>${T('stats.knewRate')}</span><b>${
        ms.knewRate == null ? '–' : Math.round(ms.knewRate * 100) + '%'}</b></div>
      <div class="stat"><span>${T('stats.target')}</span><b>${
        ms.estimated ? '~' : ''}${ms.target.toLocaleString(loc())}</b></div>
      <div class="stat"><span>${T('stats.masteredSoFar')}</span><b>${
        ms.mastered.toLocaleString(loc())}</b></div>
      <div class="stat"><span>${T('stats.stillLearning')}</span><b>${
        ms.learning.toLocaleString(loc())}</b></div>
      <div class="stat"><span>${T('stats.thisWeek')}</span><b>${
        T('stats.ofTarget', { done: nfmt(wk.done), target: nfmt(wk.target) })}</b></div>
      <div class="stat"><span>${T('stats.leftToLearn')}</span><b>${left.toLocaleString(loc())}</b></div>
      <div class="stat"><span>${T('stats.finishedBy')}</span><b style="color:${projColor}">${projLabel}</b></div>
      <div class="stat"><span>${T('stats.exam')}</span><b>${examLabel}</b></div>
    </div>
    ${leeches.length ? `<h2>${T('stats.leechTitle')}</h2>
      <p class="sub" style="margin:0 0 6px">${T('stats.leechSub')}</p>
      <div class="card">${leeches.slice(0, 40).map(w => {
        const lv = w.level.replace('*', '');
        return `<div class="wrow" data-leech="${w.id}">
          <span class="pill p-${lv}">${lv}</span>
          <div><b>${esc(display(w))}</b><span>${esc(w.en)}</span></div>
          <span style="color:var(--blue-lt);font-size:13px">${T('stats.restart')}</span>
        </div>`;
      }).join('')}</div>
      <button class="btn ghost sm" id="leech-all" style="margin-top:10px">
        ${T('stats.restartAll', { n: leeches.length })}</button>` : ''}`;
}

$('#stats-body').addEventListener('click', e => {
  if (e.target.closest('#leech-all')) {
    const n = rehabAllLeeches();
    toast(T(n === 1 ? 'stats.backOne' : 'stats.backMany', { n: nfmt(n) }));
    renderStats();
    return;
  }
  const row = e.target.closest('[data-leech]');
  if (!row) return;
  const id = +row.dataset.leech;
  if (rehabLeech(id)) toast(T('stats.startingOver', { w: display(A.words[id]) }));
  renderStats();
});

/* ============================ settings ============================ */
function renderSettings() {
  $('#installcard').innerHTML = isStandalone()
    ? `<div class="note ok"><b>${T('install.ok')}</b>
         <p class="sub" style="margin:0">${T('install.okBody')}</p></div>`
    : installBanner();

  $('#set-exam').value = A.set.exam;
  $('#set-new').value = A.set.newPerDay;
  $('#set-max').value = A.set.maxReviews;
  $('#set-speak').checked = !!A.set.speak;
  $('#set-speak').disabled = !speechAvailable();
  $$('#set-lang button').forEach(b =>
    b.classList.toggle('on', b.dataset.lang === lang()));

  const counts = {};
  for (const w of A.words) {
    const lv = w.level.replace('*', '');
    const k = lv === 'B2' ? tierOf(w) : lv;
    counts[k] = (counts[k] || 0) + 1;
  }
  $('#scope').innerHTML = Object.keys(A.set.scope).map(k =>
    `<label class="check"><input type="checkbox" data-scope="${k}"
       ${A.set.scope[k] ? 'checked' : ''}><span>${k}</span>
     <b style="color:var(--dim);font-weight:700">${(counts[k] || 0).toLocaleString(loc())}</b></label>`
  ).join('');
  // CC BY 2.0 FR requires attribution wherever the sentences are used
  const nSent = Object.keys(A.sentences).length;
  $('#ver').innerHTML = T('set.words', { n: nfmt(A.words.length) }) +
    (nSent ? '<br>' + T('set.sentences') : '');
}
$('#set-exam').addEventListener('change', e => { A.set.exam = e.target.value; saveSettings(); });
$('#set-new').addEventListener('change', e => { A.set.newPerDay = +e.target.value || 0; saveSettings(); });
$('#set-max').addEventListener('change', e => { A.set.maxReviews = +e.target.value || 250; saveSettings(); });
$('#set-speak').addEventListener('change', e => {
  A.set.speak = e.target.checked;
  saveSettings();
  if (A.set.speak) {
    loadVoices();
    // iOS wants the first utterance inside a user gesture; this tap is one
    say('Bereit', 'de-DE');
    toast(T('toast.voiceOn'));
  } else {
    stopSpeech();
    toast(T('toast.voiceOff'));
  }
});
/* tap the revealed answer to hear it again */
$('#st-answer').addEventListener('click', e => {
  e.stopPropagation();
  if (ST.queue[ST.i]) speakCard(ST.queue[ST.i], ST.mode);
});
/* Language is a display setting: it writes one settings field and re-renders.
   It never reads, writes or migrates a review record — switching mid-session
   is safe, and so is switching back. */
$('#set-lang').addEventListener('click', e => {
  const b = e.target.closest('[data-lang]');
  if (!b || !LANGS.includes(b.dataset.lang) || b.dataset.lang === lang()) return;
  A.set.lang = b.dataset.lang;
  saveSettings();
  applyI18n();
  buildNav();
  go(current);              // redraw the visible screen in the new language
  toast(T('toast.lang'));
});
$('#scope').addEventListener('change', e => {
  const k = e.target.dataset.scope;
  if (!k) return;
  A.set.scope[k] = e.target.checked; saveSettings(); toast(T('toast.scope'));
});

/* ---- backup / restore ---- */
$('#btn-export').addEventListener('click', async () => {
  await flush();
  const dump = {
    app: 'wortmeister', v: 1, exported: new Date().toISOString(),
    settings: A.set,
    state: Array.from(A.state.entries()).map(([id, s]) => [id, s])
  };
  const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wortmeister-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(T('toast.backup'));
});
$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'wortmeister') throw new Error(T('err.notBackup'));
    A.set = Object.assign({}, CFG.defaults, d.settings || {});
    A.state = new Map(d.state || []);
    A.dirty.clear();
    await DB.clear('state');
    await DB.putMany('state', Array.from(A.state.entries()));
    await saveSettings();
    toast(T('toast.restored', { n: nfmt(A.state.size) }));
    applyI18n(); buildNav();
    go('home');
  } catch (err) { toast(T('toast.restoreFail', { e: err.message })); }
  e.target.value = '';
});
$('#btn-reset').addEventListener('click', async () => {
  if (!confirm(T('confirm.reset'))) return;
  await DB.clear('state');
  A.state = new Map();
  A.dirty.clear();
  A.set = JSON.parse(JSON.stringify(CFG.defaults));
  await saveSettings();
  toast(T('toast.reset')); go('home');
});

/* ============================ boot ============================ */
async function boot() {
  try {
    await DB.open();
    A.set = Object.assign({}, JSON.parse(JSON.stringify(CFG.defaults)),
      (await DB.get('kv', 'settings')) || {});
    if (!A.set.medians) A.set.medians = {};
    if (!A.set.history) A.set.history = {};
    migrateDates();
    $('#splashmsg').textContent = T('loading');
    await loadVocab();
    A.state = await DB.all('state');
    applyI18n();
    buildNav();
    trackKeyboard();
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    // voices arrive asynchronously in most browsers
    loadVoices();
    if (speechAvailable() && typeof speechSynthesis.addEventListener === 'function') {
      speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }
    go('home');
    $('#splash').remove();
    // The sentence bank is another 313 KB and is only needed from rep 5, so it
    // loads after first paint. Until it arrives, cloze cards fall back to
    // typing — no waiting, and no failure mode if it never arrives.
    loadSentences();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  } catch (e) {
    $('#splash').innerHTML =
      `<div style="padding:24px;text-align:center;color:var(--red)">
         <b>${T('err.title')}</b><br><span class="sub">${esc(e.message)}</span>
         <br><br><span class="sub">${T('err.load')}.</span></div>`;
    console.error(e);
  }
}
boot();

/* Exposed for the headless test harness (test/test_app.js). Harmless in the
   browser; lets the tests exercise the real scheduler rather than a copy. */
window.__wm = {
  CFG, G, A, ST, applyGrade, adjustGrade, clampEase, newState, previewIntervals,
  daysToExam, buildSession, dueList, queuedNew, untriaged, tierOf, inScope,
  display, medianFor, pushTime, remainingToLearn, autoNewTarget,
  overview, nextAction, renderCounters, MODE_LABEL, milestone, renderMilestone,
  I18N, T, lang, loc, nfmt, plural, modeLabel, applyI18n, LANGS,
  wordStrength, weekStart, weekProgress, stageMatchRound, requeueIfSoon,
  projectMomentum, rubberband, spring,
  fuzzInterval, seededRandom, daySeed, shuffleSeeded, familyKey, spaceSiblings,
  advanceStreak, daysBetween, heatSeries, renderHeat,
  genderMark, displayMarked, relatives, indexFamilies, gradeWord, pickMatchRound, MT,
  speechAvailable, speechFor, speakCard, say, stopSpeech, pickVoice, SPEECH,
  sentencesFor, clozeChoices, clozePrompt, clozeFilled, loadSentences, indexPos,
  hintLevel, hintMask, HINT_SHARE, HINT_MAX, trackKeyboard,
  setAmbientLive,
  today, pickMode, foldGerman, levenshtein, typeTarget, checkTyped,
  isDrillableNoun, recentPace, paceSeries,
  hasVerbForms, auxFor, rectionFor, matchForm, matchVerbForm, vowelSwap,
  checkVerbForms, checkRection,
  prepChoices, verbFormsLine, blankExample, rectionAnswer, grammar,
  retention, projectedDays, rehabLeech, rehabAllLeeches, renderStats, logAnswer
};
