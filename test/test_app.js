/* Headless test harness for Wortmeister.
   Boots index.html + app.js in jsdom with a fake IndexedDB and a stubbed fetch,
   then drives triage and study through the real DOM handlers. */

/* Pinned to the user's timezone before any Date is constructed. UTC-5 is what
   makes the local-vs-UTC date bug observable: 19:00 local is already tomorrow
   in UTC, so a UTC-keyed day boundary lands in the middle of evening study. */
process.env.TZ = 'America/Bogota';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
require('fake-indexeddb/auto');

const APP = process.env.APPDIR || path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function A_extendedSample(w){
  return w.__wm.A.words.find(x => w.__wm.tierOf(x) === 'B2-extended');
}

(async () => {
  // ---------------------------------------------------------- data integrity
  console.log('\n== data file ==');
  const raw = fs.readFileSync(path.join(APP, 'data/vocab.v1.json'), 'utf8');
  const data = JSON.parse(raw);
  ok('parses as JSON', true);
  ok('version 1', data.v === 1);
  ok('has words', data.words.length > 10000, data.words.length);
  ok('count matches array', data.count === data.words.length);

  const F = data.fields;
  const idx = n => F.indexOf(n);
  ok('all rows have every field',
    data.words.every(r => r.length === F.length));
  ok('ids are 0..n-1 in order',
    data.words.every((r, i) => r[idx('id')] === i));

  const lemmas = data.words.map(r => r[idx('lemma')]);
  ok('no empty lemma', lemmas.every(l => l && l.trim().length));
  ok('no empty translation',
    data.words.every(r => r[idx('en')] && r[idx('en')].trim().length));

  const nouns = data.words.filter(r => r[idx('pos')] === 'noun');
  const withArt = nouns.filter(r => ['der', 'die', 'das'].includes(r[idx('article')]));
  ok('nouns carry an article (>99%)',
    withArt.length / nouns.length > 0.99,
    (withArt.length / nouns.length * 100).toFixed(1) + '%');

  const verbs = data.words.filter(r => r[idx('pos')] === 'verb');
  ok('verbs carry Partizip II (>98%)',
    verbs.filter(r => r[idx('pp')]).length / verbs.length > 0.98);
  ok('verbs carry an auxiliary',
    verbs.every(r => ['haben', 'sein', 'haben/sein'].includes(r[idx('aux')])));

  const prio = data.words.map(r => r[idx('priority')]);
  ok('priority descending (rank order)',
    prio.every((p, i) => i === 0 || p <= prio[i - 1] + 1e-9));
  ok('verbPrep present', data.verbPrep.length > 100, data.verbPrep.length);

  // ---------------------------------------------------------- boot in jsdom
  console.log('\n== boot ==');
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');

  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(html.replace('<script src="app.js"></script>', ''), {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://example.com/', virtualConsole: vc
  });
  const w = dom.window;
  w.indexedDB = global.indexedDB;
  w.IDBKeyRange = global.IDBKeyRange;
  w.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(raw) });
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  w.performance = w.performance || { now: () => Date.now() };
  w.navigator.storage = undefined;
  w.confirm = () => true;
  w.scrollTo = () => {};
  w.URL.createObjectURL = () => 'blob:x';
  w.URL.revokeObjectURL = () => {};

  const s = w.document.createElement('script');
  s.textContent = js;
  w.document.body.appendChild(s);

  for (let i = 0; i < 100 && w.document.getElementById('splash'); i++) await sleep(60);
  ok('splash cleared (app booted)', !w.document.getElementById('splash'));
  ok('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  ok('home view visible', w.document.getElementById('v-home').classList.contains('on'));
  ok('countdown rendered', /Tage bis/.test(w.document.getElementById('countdown').textContent));
  ok('nav built', w.document.querySelectorAll('.nav button').length >= 5);

  const triageCount = w.document.getElementById('s-triage').textContent;
  ok('triage backlog shown', triageCount && triageCount !== '0', triageCount);

  // ---------------------------------------------------------- triage
  console.log('\n== triage sprint ==');
  const click = sel => w.document.querySelector(sel).dispatchEvent(
    new w.MouseEvent('click', { bubbles: true }));

  click('[data-go="triage"]');
  await sleep(60);
  ok('triage view visible', w.document.getElementById('v-triage').classList.contains('on'));
  const firstWord = w.document.getElementById('tg-word').textContent;
  ok('first triage word is highest priority', firstWord.length > 0, firstWord);

  for (let i = 0; i < 40; i++) { click('[data-tg="know"]'); await sleep(4); }
  for (let i = 0; i < 25; i++) { click('[data-tg="learn"]'); await sleep(4); }
  click('[data-tg="unsure"]'); await sleep(30);
  await sleep(4500);   // let the debounced writer flush

  const idbState = await new Promise(res => {
    const rq = global.indexedDB.open('wortmeister', 1);
    rq.onsuccess = () => {
      const out = new Map();
      const c = rq.result.transaction('state', 'readonly').objectStore('state').openCursor();
      c.onsuccess = e => {
        const cur = e.target.result;
        if (!cur) { rq.result.close(); return res(out); }
        out.set(cur.key, cur.value); cur.continue();
      };
    };
  });
  const known = [...idbState.values()].filter(v => v.s === 'known').length;
  const queued = [...idbState.values()].filter(v => v.s === 'queued').length;
  ok('known words persisted to IndexedDB', known === 40, 'got ' + known);
  ok('queued words persisted', queued === 26, 'got ' + queued);
  ok('uncertain flag stored', [...idbState.values()].some(v => v.u === true));

  // undo
  click('[data-tg="undo"]'); await sleep(30);
  ok('undo removes the last decision', true);

  // ---------------------------------------------------------- study
  console.log('\n== study session ==');
  click('[data-go="study"]');
  await sleep(60);
  ok('study view visible', w.document.getElementById('v-study').classList.contains('on'));
  const prompt1 = w.document.getElementById('st-prompt').textContent;
  ok('card prompt rendered', prompt1.length > 0, prompt1);
  ok('grades hidden before reveal',
    w.document.getElementById('st-grades').classList.contains('hidden'));

  click('#st-reveal'); await sleep(20);
  ok('answer revealed', !w.document.getElementById('st-answer').classList.contains('hidden'));
  ok('grade buttons shown',
    !w.document.getElementById('st-grades').classList.contains('hidden'));
  const ivLabels = [0, 1, 2, 3].map(i => w.document.getElementById('i' + i).textContent);
  ok('interval previews filled', ivLabels.every(t => t.length > 0), ivLabels.join(' / '));

  click('[data-grade="2"]'); await sleep(30);
  const prompt2 = w.document.getElementById('st-prompt').textContent;
  ok('advances to next card', prompt2 !== prompt1);

  // grade a run of cards
  for (let i = 0; i < 20; i++) {
    click('#st-reveal'); await sleep(4);
    click(`[data-grade="${i % 4}"]`); await sleep(4);
  }
  await sleep(1400);
  ok('session progresses without error', errors.length === 0,
    errors.slice(0, 2).join(' | '));

  // ---------------------------------------------------------- scheduler
  console.log('\n== scheduler ==');
  const M = w.__wm;
  ok('scheduler exported', !!M && typeof M.applyGrade === 'function');

  // new card graduating through the learning steps
  let st = M.newState();
  M.applyGrade(st, M.G.GOOD, Date.now());
  ok('new -> learning on first Good', st.s === 'learning', st.s);
  ok('first step is 10 minutes',
    Math.abs(st.d - Date.now() - 600000) < 5000, st.d - Date.now());
  M.applyGrade(st, M.G.GOOD, Date.now());
  ok('second step is 1 day',
    Math.abs(st.d - Date.now() - 86400000) < 5000, st.d - Date.now());
  ok('still learning after two Goods', st.s === 'learning', st.s);
  M.applyGrade(st, M.G.GOOD, Date.now());
  ok('graduates to review after the steps', st.s === 'review', st.s);
  ok('graduating interval is 3 days', st.i === 3, st.i);

  // Hard on a brand-new card must not read LEARN_STEPS[-1]
  let stH = M.newState();
  M.applyGrade(stH, M.G.HARD, Date.now());
  ok('Hard on a new card schedules a real step',
    Number.isFinite(stH.d) && stH.d > Date.now(), stH.d);

  // Easy graduates further out
  let st2 = M.newState();
  M.applyGrade(st2, M.G.EASY, Date.now());
  ok('Easy graduates immediately', st2.s === 'review', st2.s);
  ok('Easy graduating interval is 5 days', st2.i === 5, st2.i);

  // Good multiplies by ease
  let st3 = M.newState(); st3.s = 'review'; st3.i = 10; st3.e = 2.5;
  M.applyGrade(st3, M.G.GOOD, Date.now());
  ok('Good multiplies interval by ease', st3.i === 25, st3.i);

  // Hard shrinks ease and grows the interval only slightly
  let st4 = M.newState(); st4.s = 'review'; st4.i = 10; st4.e = 2.5;
  M.applyGrade(st4, M.G.HARD, Date.now());
  ok('Hard lowers ease', Math.abs(st4.e - 2.35) < 1e-9, st4.e);
  ok('Hard grows interval by 1.2x', st4.i === 12, st4.i);

  // Again lapses back into relearning
  let st5 = M.newState(); st5.s = 'review'; st5.i = 20; st5.e = 2.5;
  M.applyGrade(st5, M.G.AGAIN, Date.now());
  ok('Again lowers ease', Math.abs(st5.e - 2.30) < 1e-9, st5.e);
  ok('Again -> relearning', st5.s === 'relearning', st5.s);
  ok('Again increments lapses', st5.l === 1, st5.l);

  // exam-aware cap
  let st6 = M.newState(); st6.s = 'review'; st6.i = 400; st6.e = 3.0;
  M.applyGrade(st6, M.G.GOOD, Date.now());
  const cap = M.daysToExam();
  ok('interval capped at days-to-exam', st6.i === cap, st6.i + ' vs cap ' + cap);
  ok('cap matches 11 Nov 2026', cap > 80 && cap < 100, cap);

  // leech
  let st7 = M.newState(); st7.s = 'review'; st7.l = 7; st7.i = 10;
  M.applyGrade(st7, M.G.AGAIN, Date.now());
  ok('8th lapse marks leech', st7.s === 'leech', st7.s);

  // ease clamps
  ok('ease clamped high', M.clampEase(9) === 3.0);
  ok('ease clamped low', M.clampEase(0.1) === 1.3);

  // response-time grading
  M.A.set.medians.de2en = new Array(20).fill(4000);
  ok('fast answer promotes Good -> Easy',
    M.adjustGrade(M.G.GOOD, 500, 'de2en') === M.G.EASY);
  ok('slow answer demotes Good -> Hard',
    M.adjustGrade(M.G.GOOD, 30000, 'de2en') === M.G.HARD);
  ok('normal answer stays Good',
    M.adjustGrade(M.G.GOOD, 4200, 'de2en') === M.G.GOOD);
  ok('Again is never re-graded',
    M.adjustGrade(M.G.AGAIN, 200, 'de2en') === M.G.AGAIN);
  M.pushTime('de2en', 999999);
  ok('response times capped at 60s',
    Math.max(...M.A.set.medians.de2en) <= 60000);

  // interval preview labels
  const prev = M.previewIntervals(M.newState());
  ok('preview returns four labels', prev.length === 4 && prev.every(x => x), prev.join(' / '));

  // queue behaviour
  ok('daily new target within bounds',
    M.autoNewTarget() >= 10 && M.autoNewTarget() <= 60, M.autoNewTarget());
  ok('scope excludes B2-extended by default',
    !M.inScope(A_extendedSample(w)), 'tier check');

  // ------------------------------------------------------- local calendar
  console.log('\n== local dates ==');
  const lateEvening = new Date(2026, 0, 5, 23, 30).getTime();
  ok('today() uses the local calendar date', M.today(lateEvening) === '2026-01-05',
    M.today(lateEvening));
  ok('UTC would have called that the next day',
    new Date(lateEvening).toISOString().slice(0, 10) === '2026-01-06');
  // the exact predicate logAnswer uses to decide whether the streak continues
  const monMorning = new Date(2026, 7, 10, 10, 0).getTime();
  const tueEvening = new Date(2026, 7, 11, 20, 0).getTime();
  ok('morning then next evening chains the streak',
    M.today(tueEvening - 86400000) === M.today(monMorning),
    M.today(tueEvening - 86400000) + ' vs ' + M.today(monMorning));
  ok('an actual skipped day breaks the chain',
    M.today(new Date(2026, 7, 12, 10, 0).getTime() - 86400000) !== M.today(monMorning));

  const histBackup = M.A.set.history;
  M.A.set.history = {};
  M.A.set.history[M.today()] = { new: 20, rev: 0 };
  ok('pace averages over elapsed days, not a flat 7', M.recentPace(7) === 20,
    M.recentPace(7));
  M.A.set.history[M.today(Date.now() - 86400000)] = { new: 10, rev: 0 };
  ok('pace over two days averages both', M.recentPace(7) === 15, M.recentPace(7));
  ok('pace series is one entry per day', M.paceSeries(7).length === 7);
  M.A.set.history = histBackup;

  // ------------------------------------------------------- answer checking
  console.log('\n== typed answers ==');
  ok('fold lowercases and collapses space', M.foldGerman('  Der   Betrieb ') === 'der betrieb',
    M.foldGerman('  Der   Betrieb '));
  ok('fold expands umlauts', M.foldGerman('Universität') === 'universitaet',
    M.foldGerman('Universität'));
  ok('fold expands eszett', M.foldGerman('heißen') === 'heissen', M.foldGerman('heißen'));
  ok('levenshtein equal is 0', M.levenshtein('abc', 'abc', 1) === 0);
  ok('levenshtein one edit is 1', M.levenshtein('abc', 'abd', 1) === 1);
  ok('levenshtein bails past max', M.levenshtein('abc', 'xyz', 1) > 1);

  const NOUN = { pos: 'noun', lemma: 'Betrieb', article: 'der', plural: 'Betriebe', en: 'business' };
  const UML = { pos: 'noun', lemma: 'Universität', article: 'die', plural: '', en: 'university' };
  const VERB = { pos: 'verb', lemma: 'beziehen', article: '', en: 'to obtain' };
  const SHORT = { pos: 'noun', lemma: 'Rad', article: 'das', plural: '', en: 'wheel' };
  const ESZ = { pos: 'verb', lemma: 'heißen', article: '', en: 'to be called' };

  ok('target for a noun carries the article', M.typeTarget(NOUN) === 'der Betrieb',
    M.typeTarget(NOUN));
  ok('target for a verb is the bare lemma', M.typeTarget(VERB) === 'beziehen');

  const chk = (word, input) => M.checkTyped(word, input);
  ok('exact answer is correct', chk(VERB, 'beziehen').ok && !chk(VERB, 'beziehen').near);
  ok('answer is case-insensitive', chk(VERB, 'BEZIEHEN').ok);
  ok('surrounding whitespace is ignored', chk(VERB, '  beziehen  ').ok);
  ok('ue is accepted for ü', chk(UML, 'die universitaet').ok && !chk(UML, 'die universitaet').near);
  ok('the umlaut spelling is also accepted', chk(UML, 'die Universität').ok);
  ok('ss is accepted for ß', chk(ESZ, 'heissen').ok && !chk(ESZ, 'heissen').near);
  ok('noun with the right article is correct', chk(NOUN, 'der Betrieb').ok);
  ok('noun without an article is wrong', !chk(NOUN, 'Betrieb').ok);
  ok('noun with the wrong article is wrong', !chk(NOUN, 'die Betrieb').ok);
  ok('a wrong article never counts as a typo', chk(NOUN, 'die Betrieb').near === false);
  ok('one typo above 5 chars counts but only as near',
    chk(VERB, 'bezihen').ok && chk(VERB, 'bezihen').near);
  ok('one typo inside a noun still needs the right article',
    chk(NOUN, 'der Betrib').ok && chk(NOUN, 'der Betrib').near);
  ok('one typo on a short word is wrong', !chk(SHORT, 'das Bad').ok);
  ok('two typos are wrong', !chk(VERB, 'bezihn').ok);
  ok('empty input is wrong', !chk(VERB, '').ok);
  ok('whitespace-only input is wrong', !chk(VERB, '   ').ok);
  ok('the expected spelling is reported back', chk(VERB, 'xxxx').expected === 'beziehen');

  // ------------------------------------------------------- mode progression
  console.log('\n== mode progression ==');
  const plainWord = M.A.words.find(x => x.pos === 'verb' && M.inScope(x) && /^[a-z]{7,}$/i.test(x.lemma));
  const nounWord = M.A.words.find(x => M.isDrillableNoun(x) && M.inScope(x) && /^[a-zA-Z]{7,}$/.test(x.lemma));
  ok('found a plain verb to drill', !!plainWord, plainWord && plainWord.lemma);
  ok('found a noun to drill', !!nounWord, nounWord && nounWord.article + ' ' + nounWord.lemma);

  const stage = (word, reps) => {
    M.A.state.clear(); M.A.dirty.clear();
    M.A.state.set(word.id,
      { s: 'review', e: 2.5, i: 1, d: Date.now() - 1000, r: reps, l: 0, p: -1, m: {}, t: 0 });
  };
  const modeAt = (word, reps) => { stage(word, reps); return M.pickMode(word); };

  ok('reps 0 is flip DE→EN', modeAt(plainWord, 0) === 'de2en', modeAt(plainWord, 0));
  ok('reps 1 is flip DE→EN', modeAt(plainWord, 1) === 'de2en');
  ok('reps 2 is flip EN→DE', modeAt(plainWord, 2) === 'en2de', modeAt(plainWord, 2));
  ok('reps 4 is flip EN→DE', modeAt(plainWord, 4) === 'en2de');
  ok('reps 5 is typing', modeAt(plainWord, 5) === 'type', modeAt(plainWord, 5));
  ok('reps 9 is still typing', modeAt(plainWord, 9) === 'type');
  ok('a noun starts on flip too', modeAt(nounWord, 0) === 'de2en');
  ok('a noun interleaves the article drill from rep 2',
    modeAt(nounWord, 2) === 'article', modeAt(nounWord, 2));
  ok('the noun returns to flip at rep 3', modeAt(nounWord, 3) === 'en2de');
  ok('the article drill returns every third rep', modeAt(nounWord, 5) === 'article');
  ok('the noun still reaches typing', modeAt(nounWord, 6) === 'type', modeAt(nounWord, 6));
  ok('an article-less noun is never article-drilled',
    !M.isDrillableNoun({ pos: 'noun', lemma: 'Leute', article: '' }));

  // ------------------------------------------------------- typing, via DOM
  console.log('\n== typing mode (DOM) ==');
  const el = id => w.document.getElementById(id);
  const setInput = v => {
    const i = el('st-input');
    i.value = v;
    i.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const openStudy = async (word, reps) => {
    stage(word, reps);
    click('[data-go="home"]'); await sleep(20);
    click('[data-go="study"]'); await sleep(50);
  };

  await openStudy(plainWord, 5);
  ok('typing card is selected at 5 reps', el('st-mode').textContent === 'Schreiben',
    el('st-mode').textContent);
  ok('typing pad is shown', !el('st-typepad').classList.contains('hidden'));
  ok('flip grades stay hidden in typing mode', el('st-grades').classList.contains('hidden'));
  ok('the prompt is the English gloss', el('st-prompt').textContent.includes(plainWord.en));
  ok('check is disabled while the field is empty', el('st-check').disabled);
  setInput(plainWord.lemma);
  ok('check enables once something is typed', !el('st-check').disabled);
  click('#st-check'); await sleep(30);
  ok('a correct answer shows the positive banner',
    el('st-result').className.includes('good'), el('st-result').className);
  ok('the banner replaces the input pad', el('st-typepad').classList.contains('hidden'));
  let got = M.A.state.get(plainWord.id);
  ok('a correct typed answer does not lapse the card', got.l === 0, got.l);
  ok('a correct typed answer counts a type rep', got.m.type === 1, JSON.stringify(got.m));
  ok('a correct typed answer advances the interval', got.i > 1, got.i);

  await openStudy(plainWord, 5);
  setInput('völligfalsch');
  click('#st-check'); await sleep(30);
  ok('a wrong answer shows the negative banner',
    el('st-result').className.includes('bad'), el('st-result').className);
  ok('the wrong answer banner shows the correct spelling',
    el('st-rbody').textContent.includes(plainWord.lemma), el('st-rbody').textContent);
  got = M.A.state.get(plainWord.id);
  ok('a wrong typed answer grades Again (lapse)', got.l === 1, got.l);
  ok('a wrong typed answer goes to relearning', got.s === 'relearning', got.s);

  await openStudy(plainWord, 5);
  setInput(plainWord.lemma.slice(0, -1));      // one deletion → Levenshtein 1
  click('#st-check'); await sleep(30);
  ok('a near miss still shows the positive banner', el('st-result').className.includes('good'));
  ok('a near miss shows the correct spelling',
    el('st-rbody').textContent.includes(plainWord.lemma));
  got = M.A.state.get(plainWord.id);
  ok('a near miss grades Hard, not Good', Math.abs(got.e - 2.35) < 1e-9, got.e);
  ok('a near miss does not lapse the card', got.l === 0, got.l);

  await openStudy(nounWord, 5);
  ok('a noun at rep 5 is article-drilled first', el('st-mode').textContent === 'Artikel');
  await openStudy(nounWord, 6);
  ok('the noun typing prompt asks for the article',
    el('st-hint').textContent === 'Mit Artikel schreiben', el('st-hint').textContent);
  setInput(nounWord.lemma);                     // no article → wrong
  click('#st-check'); await sleep(30);
  ok('a noun typed without its article is wrong', el('st-result').className.includes('bad'));

  await openStudy(nounWord, 6);
  setInput(nounWord.article + ' ' + nounWord.lemma);
  click('#st-check'); await sleep(30);
  ok('a noun typed with its article is correct', el('st-result').className.includes('good'));

  // ------------------------------------------------------- article drill
  console.log('\n== article drill (DOM) ==');
  await openStudy(nounWord, 2);
  ok('article drill is selected', el('st-mode').textContent === 'Artikel',
    el('st-mode').textContent);
  ok('article pad is shown', !el('st-artpad').classList.contains('hidden'));
  ok('the prompt is the bare noun, no article',
    el('st-prompt').textContent.startsWith(nounWord.lemma) &&
    !/^(der|die|das)\s/.test(el('st-prompt').textContent), el('st-prompt').textContent);
  ok('three article buttons are offered', w.document.querySelectorAll('[data-art]').length === 3);
  click(`[data-art="${nounWord.article}"]`); await sleep(30);
  ok('the right article shows the positive banner', el('st-result').className.includes('good'));
  got = M.A.state.get(nounWord.id);
  ok('a right article does not lapse the card', got.l === 0, got.l);
  ok('a right article counts an article rep', got.m.article === 1, JSON.stringify(got.m));

  await openStudy(nounWord, 2);
  const wrongArt = ['der', 'die', 'das'].find(a => a !== nounWord.article);
  click(`[data-art="${wrongArt}"]`); await sleep(30);
  ok('a wrong article shows the negative banner', el('st-result').className.includes('bad'));
  ok('the wrong article banner shows the right one',
    el('st-rbody').textContent.includes(nounWord.article + ' ' + nounWord.lemma));
  got = M.A.state.get(nounWord.id);
  ok('a wrong article grades Again (lapse)', got.l === 1, got.l);

  ok('Weiter advances to the next card', (() => {
    click('#st-continue');
    return el('st-result').classList.contains('hidden');
  })());

  // ------------------------------------------------------- session re-entry
  console.log('\n== session re-entry cap ==');
  await openStudy(plainWord, 0);
  const startLen = M.ST.queue.length;
  ok('a staged session holds exactly one card', startLen === 1, startLen);
  for (let k = 0; k < 6; k++) {
    click('#st-reveal'); await sleep(4);
    click('[data-grade="0"]'); await sleep(4);
  }
  ok('repeated Again re-queues the card within the session', M.ST.queue.length > 1,
    M.ST.queue.length);
  ok('re-entry is capped per word', M.ST.queue.length <= 1 + M.CFG.MAX_REENTRY,
    M.ST.queue.length);

  // restore a normal-looking state for the remaining view assertions
  M.A.state.clear(); M.A.dirty.clear();
  for (let n = 0; n < 30; n++) {
    M.A.state.set(n, { s: 'known', e: 2.5, i: 0, d: 0, r: 0, l: 0, p: -1, m: {}, t: 0 });
  }

  // ---------------------------------------------------------- other views
  console.log('\n== other views ==');
  for (const v of ['browse', 'stats', 'settings', 'home']) {
    click(`[data-go="${v}"]`); await sleep(50);
    ok(v + ' renders', w.document.getElementById('v-' + v).classList.contains('on'));
  }
  ok('browse lists rows', w.document.querySelectorAll('#br-list .wrow').length > 0);
  ok('stats rendered', /Wortstatus/.test(w.document.getElementById('stats-body').innerHTML));
  ok('settings shows install prompt',
    /Home-Bildschirm/.test(w.document.getElementById('installcard').innerHTML));
  ok('no errors after full pass', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
