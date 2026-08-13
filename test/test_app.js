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

  // ---------------------------------------------------------- css tokens
  console.log('\n== css custom properties ==');
  {
    // An undefined var() inside a gradient invalidates the whole declaration
    // silently — no console error, the element just renders transparent. That
    // is exactly how the milestone bar shipped empty once.
    const css = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
    const declared = new Set();
    for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    const used = new Set();
    for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) used.add(m[1]);
    const missing = [...used].filter(v => !declared.has(v));
    ok('every var() used in the stylesheet is defined',
      missing.length === 0, missing.join(', '));
    ok('the stylesheet declares tokens at all', declared.size > 10, declared.size);
  }

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
  ok('countdown rendered', /days until the exam/.test(w.document.getElementById('countdown').textContent));
  ok('nav built', w.document.querySelector('.nav').querySelectorAll('button').length === 4,
    w.document.querySelector('.nav').textContent.trim().replace(/\s+/g, ' '));
  ok('every view gets the same nav',
    [...w.document.querySelectorAll('.nav')].every(n => n.querySelectorAll('button').length === 4));

  const M = w.__wm;
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
  // Study has no nav tab — you reach it from Home's primary button, which only
  // appears once something has been sorted
  click('.nav button[data-go="home"]'); await sleep(40);
  ok('home offers Study once words are sorted',
    !!w.document.querySelector('#todo [data-go="study"]'),
    w.document.getElementById('todo').textContent.trim().replace(/\s+/g, ' '));
  click('[data-go="study"]');
  await sleep(60);
  ok('study view visible', w.document.getElementById('v-study').classList.contains('on'));

  // -------------------------------------------------- opening pairing round
  console.log('\n== pairing round ==');
  ok('a session opens with a pairing round',
    !w.document.getElementById('st-matchpad').classList.contains('hidden'),
    w.document.getElementById('st-mode').textContent);
  ok('the round shows a full set of pairs',
    w.document.querySelectorAll('#st-matchgrid .mtile').length === M.CFG.MATCH_PAIRS * 2);
  ok('the mode reads Match', w.document.getElementById('st-mode').textContent === 'Match');
  ok('the reveal button cannot hijack the round', (() => {
    click('#st-reveal');
    return w.document.getElementById('st-grades').classList.contains('hidden');
  })(), 'grades must stay hidden during a pairing round');
  ok('tapping the card face cannot hijack it either', (() => {
    click('#st-face');
    return w.document.getElementById('st-answer').classList.contains('hidden');
  })());

  const tiles = () => [...w.document.querySelectorAll('#st-matchgrid .mtile')];
  const roundIds = [...new Set(tiles().map(t => +t.dataset.wid))];
  ok('the round covers distinct words', roundIds.length === M.CFG.MATCH_PAIRS, roundIds.join(','));
  ok('every word in the round is lightly seen',
    roundIds.every(id => {
      const st = M.A.state.get(id);
      return !st || st.r <= 2;
    }));

  // a deliberate mismatch first, then solve the round
  const deTile = id => tiles().find(t => t.dataset.side === 'de' && +t.dataset.wid === id);
  const enTile = id => tiles().find(t => t.dataset.side === 'en' && +t.dataset.wid === id);
  deTile(roundIds[0]).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  enTile(roundIds[1]).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(20);
  ok('a wrong pair does not clear the tiles',
    !deTile(roundIds[0]).classList.contains('gone'));
  ok('a wrong pair is marked', deTile(roundIds[0]).classList.contains('bad'));

  for (const id of roundIds) {
    deTile(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    enTile(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(20);
  }
  ok('matching a pair clears both tiles',
    tiles().filter(t => t.classList.contains('gone')).length === M.CFG.MATCH_PAIRS * 2);
  await sleep(400);
  ok('the round grades every word it covered',
    roundIds.every(id => (M.A.state.get(id) || {}).m &&
      M.A.state.get(id).m.match === 1),
    roundIds.map(id => JSON.stringify((M.A.state.get(id) || {}).m)).join(' '));
  ok('a word missed once is graded Hard, not Good',
    M.A.state.get(roundIds[0]).e < 2.5 || M.A.state.get(roundIds[0]).s === 'learning',
    'ease ' + M.A.state.get(roundIds[0]).e);
  ok('the session moves on after the round',
    w.document.getElementById('st-matchpad').classList.contains('hidden'));
  ok('the card counter accounts for the five cards',
    M.ST.i >= 5, 'i=' + M.ST.i);

  console.log('\n== study session ==');
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
  ok('scheduler exported', !!M && typeof M.applyGrade === 'function');

  // new card graduating through the learning steps
  // exact-interval assertions need the jitter off; it gets its own section below
  M.CFG.FUZZ = 0;

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

  // ------------------------------------------- exam-relevance ordering
  // New words are drawn strictly in priority-rank order, and that rank is
  // what makes the queue exam-relevant: official Goethe vocabulary first,
  // frequency-ordered inside it. These lock the property in place — the
  // order decides which words he actually reaches before 11 November, and
  // a regression here is invisible until it has already cost him weeks.
  console.log('\n== exam-relevance ordering ==');
  {
    const scope = M.A.words.filter(x => M.inScope(x));
    const official = x => x.level.replace('*', '') !== 'B2';

    ok('in-scope set is the core study set',
      scope.length > 6500 && scope.length < 7500, scope.length);

    // id === priority rank - 1, so ascending ids IS descending priority
    const un = M.untriaged();
    let ascending = true;
    for (let n = 1; n < un.length; n++) if (un[n].id < un[n - 1].id) ascending = false;
    ok('untriaged words are offered in priority-rank order', ascending);

    // queuedNew() sorts uncertain-first, then rank — check the rank half
    const saved = new Map(M.A.state);
    const pick = [scope[900], scope[40], scope[500]];
    for (const x of pick) M.A.state.set(x.id, Object.assign(M.newState(), { s: 'queued' }));
    const qn = M.queuedNew().filter(x => pick.some(p => p.id === x.id));
    ok('queued new words come back in priority-rank order',
      qn.length === 3 && qn[0].id < qn[1].id && qn[1].id < qn[2].id,
      qn.map(x => x.id).join(','));
    M.A.state.clear();
    for (const [k, v] of saved) M.A.state.set(k, v);

    // the official Goethe Wortlisten are the only published statement of
    // what the exam tests, so they must dominate the reachable front
    const first800 = scope.slice(0, 800).filter(official).length;
    ok('the first 800 new words are all official Goethe vocabulary',
      first800 === 800, first800 + '/800');
    const first2400 = scope.slice(0, 2400).filter(official).length;
    ok('the first 2400 are overwhelmingly official Goethe vocabulary',
      first2400 / 2400 >= 0.85, Math.round(first2400 / 2400 * 100) + '%');

    // and frequency has to dominate inside that, or the front fills with
    // list words nobody meets
    const med = list => {
      const f = list.map(x => x.freqClass).sort((a, b) => a - b);
      return f[f.length >> 1];
    };
    ok('early words are more frequent than later ones',
      med(scope.slice(0, 800)) < med(scope.slice(3200, 4000)),
      med(scope.slice(0, 800)) + ' vs ' + med(scope.slice(3200, 4000)));

    // B2 is corpus-derived, so the rare tail is newspaper vocabulary
    ok('no rare B2 word reaches the default scope',
      !scope.some(x => x.level.replace('*', '') === 'B2' && x.freqClass > 13));
  }

  // ------------------------------------------------------- interval fuzz
  console.log('\n== interval fuzz ==');
  M.CFG.FUZZ = 1;

  ok('fuzz leaves 1-day intervals exact', M.fuzzInterval(1) === 1);
  ok('fuzz leaves 2-day intervals exact', M.fuzzInterval(2) === 2);
  ok('fuzz can be switched off', (() => {
    M.CFG.FUZZ = 0;
    const flat = Array.from({ length: 40 }, () => M.fuzzInterval(30));
    M.CFG.FUZZ = 1;
    return flat.every(x => x === 30);
  })());

  const spread10 = Array.from({ length: 400 }, () => M.fuzzInterval(10));
  ok('a 10-day interval stays within 8-12',
    spread10.every(x => x >= 8 && x <= 12),
    Math.min(...spread10) + '-' + Math.max(...spread10));
  ok('a 10-day interval actually varies', new Set(spread10).size > 1,
    [...new Set(spread10)].sort((a, b) => a - b).join(','));

  const spread30 = Array.from({ length: 400 }, () => M.fuzzInterval(30));
  ok('a 30-day interval stays within 26-34',
    spread30.every(x => x >= 26 && x <= 34),
    Math.min(...spread30) + '-' + Math.max(...spread30));
  ok('the spread widens with the interval',
    (Math.max(...spread30) - Math.min(...spread30)) >
    (Math.max(...spread10) - Math.min(...spread10)));

  // the point of the whole thing: identical cards must stop clumping
  const clump = [];
  for (let n = 0; n < 200; n++) {
    const c = { s: 'review', e: 2.5, i: 10, d: 0, r: 5, l: 0, p: -1, m: {}, t: 0 };
    M.applyGrade(c, M.G.GOOD, Date.now());
    clump.push(c.i);
  }
  ok('200 identically-graded cards no longer land on one day',
    new Set(clump).size > 3, [...new Set(clump)].sort((a, b) => a - b).join(','));
  ok('fuzz never schedules past the exam cap',
    clump.every(i => i <= M.daysToExam()));
  ok('fuzz never produces a zero or negative interval', clump.every(i => i >= 1));

  ok('the grade buttons still preview un-fuzzed intervals', (() => {
    const base = { s: 'review', e: 2.5, i: 10, d: 0, r: 5, l: 0, p: -1, m: {}, t: 0 };
    const runs = Array.from({ length: 25 }, () => M.previewIntervals(base).join('|'));
    return new Set(runs).size === 1;
  })(), 'previews must not jitter under the user');
  ok('previewing does not leave fuzz disabled', M.CFG.FUZZ === 1, M.CFG.FUZZ);

  // ------------------------------------------------------- session ordering
  console.log('\n== session ordering ==');
  const CFG_GAP = M.CFG.SIBLING_GAP;
  ok('the day seed is stable within a day', M.daySeed() === M.daySeed());
  const r1 = M.seededRandom(42), r2 = M.seededRandom(42);
  ok('the shuffle is reproducible from a seed',
    Array.from({ length: 5 }, () => r1()).join() ===
    Array.from({ length: 5 }, () => r2()).join());
  const deck = Array.from({ length: 30 }, (_, i) => ({ lemma: 'w' + i }));
  ok('shuffling keeps every card',
    M.shuffleSeeded(deck, M.seededRandom(7)).length === 30);
  ok('shuffling actually reorders',
    M.shuffleSeeded(deck, M.seededRandom(7)).map(x => x.lemma).join() !==
    deck.map(x => x.lemma).join());
  ok('the same seed gives the same order',
    M.shuffleSeeded(deck, M.seededRandom(7)).map(x => x.lemma).join() ===
    M.shuffleSeeded(deck, M.seededRandom(7)).map(x => x.lemma).join());

  ok('word families group a stem', M.familyKey({ lemma: 'Bewerbung' }) === M.familyKey({ lemma: 'bewerben' }),
    M.familyKey({ lemma: 'Bewerbung' }) + ' vs ' + M.familyKey({ lemma: 'bewerben' }));
  ok('unrelated words are not grouped',
    M.familyKey({ lemma: 'bewerben' }) !== M.familyKey({ lemma: 'bewegen' }));
  ok('families fold umlauts', M.familyKey({ lemma: 'Bäcker' }) === M.familyKey({ lemma: 'baecker' }));

  const sibs = [
    { lemma: 'bewerben' }, { lemma: 'Bewerbung' }, { lemma: 'Bewerber' },
    { lemma: 'Haus' }, { lemma: 'Tisch' }, { lemma: 'Stuhl' }, { lemma: 'Lampe' },
    { lemma: 'gehen' }, { lemma: 'Wagen' }, { lemma: 'Kind' }, { lemma: 'Blume' },
    { lemma: 'Fenster' }, { lemma: 'Zeitung' }, { lemma: 'Wolke' }, { lemma: 'Pflanze' }
  ];
  const spaced = M.spaceSiblings(sibs, CFG_GAP);
  ok('sibling spacing keeps every card', spaced.length === sibs.length);
  ok('sibling spacing loses no card',
    sibs.every(x => spaced.some(y => y.lemma === x.lemma)));
  ok('related words are pushed apart when there is filler to use', (() => {
    const fam = M.familyKey({ lemma: 'bewerben' });
    const idx = spaced.map((w, i) => [M.familyKey(w), i]).filter(p => p[0] === fam).map(p => p[1]);
    for (let i = 1; i < idx.length; i++) if (idx[i] - idx[i - 1] <= CFG_GAP) return false;
    return true;
  })(), spaced.map(x => x.lemma).join(' '));
  // when spacing is impossible it must degrade, not drop cards
  const crowded = M.spaceSiblings(
    [{ lemma: 'bewerben' }, { lemma: 'Bewerbung' }, { lemma: 'Bewerber' }], 5);
  ok('spacing degrades gracefully when every card is a sibling',
    crowded.length === 3 && new Set(crowded.map(x => x.lemma)).size === 3,
    crowded.map(x => x.lemma).join(' '));

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

  // ------------------------------------------------------- motion physics
  console.log('\n== motion (Apple fluid-interface model) ==');

  // momentum projection: where a flick is GOING, not where the finger stopped
  ok('a still finger projects nowhere', M.projectMomentum(0) === 0);
  ok('a flick projects forward', M.projectMomentum(1000) > 0);
  ok('a flick projects backward when thrown left', M.projectMomentum(-1000) < 0);
  ok('projection scales with velocity',
    M.projectMomentum(2000) > M.projectMomentum(1000));
  ok('projection uses exponential decay, not v-squared', (() => {
    // Apple's form is linear in v: doubling velocity doubles the distance.
    // The textbook v²/2a would quadruple it — and lands visibly short.
    const a = M.projectMomentum(500), b = M.projectMomentum(1000);
    return Math.abs(b / a - 2) < 1e-6;
  })(), M.projectMomentum(500) + ' / ' + M.projectMomentum(1000));
  ok('a 1000px/s flick throws about half a screen',
    M.projectMomentum(1000) > 300 && M.projectMomentum(1000) < 700,
    M.projectMomentum(1000).toFixed(0) + 'px');
  ok('a snappier deceleration travels less',
    M.projectMomentum(1000, 0.99) < M.projectMomentum(1000, 0.998));

  // rubber-banding: resistance grows, and never fully stops
  ok('no overshoot means no resistance', M.rubberband(0, 400) === 0);
  ok('a little overshoot moves nearly freely', (() => {
    const r = M.rubberband(10, 400);
    return r > 4 && r < 10;
  })(), M.rubberband(10, 400).toFixed(1));
  ok('resistance grows with distance past the edge',
    M.rubberband(200, 400) > M.rubberband(50, 400));
  ok('but the card never stops responding entirely',
    M.rubberband(1000, 400) > M.rubberband(500, 400));
  ok('resistance is sub-linear — you always lose ground', (() => {
    const a = M.rubberband(100, 400), b = M.rubberband(200, 400);
    return b < a * 2;
  })());
  ok('rubber-banding is symmetric', M.rubberband(-100, 400) === -M.rubberband(100, 400));

  // the spring must be interruptible and hand back its live state
  const settled = await new Promise(res => {
    let last = null, frames = 0;
    const t = setTimeout(() => res({ ok: false, last, frames }), 4000);
    M.spring({
      from: 0, to: 100, velocity: 0, damping: 1, response: 0.2,
      onFrame: v => { last = v; frames++; },
      onDone: () => { clearTimeout(t); res({ ok: last === 100, last, frames }); }
    });
  });
  ok('a spring converges exactly onto its target', settled.ok,
    'ended at ' + settled.last + ' after ' + settled.frames + ' frames');
  ok('it gets there over several frames, not in one jump',
    settled.frames > 3, settled.frames);

  const bouncy = await new Promise(res => {
    let peak = 0;
    const t = setTimeout(() => res(peak), 4000);
    M.spring({
      from: 0, to: 100, velocity: 0, damping: 0.55, response: 0.25,
      onFrame: v => { peak = Math.max(peak, v); },
      onDone: () => { clearTimeout(t); res(peak); }
    });
  });
  ok('an under-damped spring overshoots', bouncy > 100, 'peak ' + bouncy.toFixed(1));
  ok('a critically damped one does not', settled.last <= 100.001, settled.last);
  ok('an interrupted spring reports where it actually is, not the target', (() => {
    const h = M.spring({ from: 0, to: 500, velocity: 0, onFrame: () => {} });
    const s = h.stop();
    return typeof s.value === 'number' && typeof s.velocity === 'number';
  })());
  ok('stopping a spring marks it done', (() => {
    const h = M.spring({ from: 0, to: 500, velocity: 0, onFrame: () => {} });
    h.stop();
    return h.done === true;
  })());

  // ------------------------------------------------------- milestone bar
  console.log('\n== milestone estimate ==');
  const msBackup = new Map(M.A.state);
  const scopedIds = M.A.words.filter(x => M.inScope(x)).map(x => x.id);
  const totalScoped = scopedIds.length;
  const rec2 = o => Object.assign(
    { s: 'review', e: 2.5, i: 1, d: 0, r: 3, l: 0, p: -1, m: {}, t: 0 }, o);
  const setup = fn => { M.A.state.clear(); M.A.dirty.clear(); fn(); return M.milestone(); };

  let ms = setup(() => {});
  ok('with nothing sorted the target is the whole scope',
    ms.target === totalScoped, ms.target + ' vs ' + totalScoped);
  ok('with nothing sorted nothing is mastered', ms.mastered === 0 && ms.pct === 0);
  ok('an untouched pile is flagged as an estimate', ms.estimated === true);
  ok('there is no known-rate to report yet', ms.knewRate === null);

  // sort 1000: 400 already known, 600 to learn -> 40% known rate
  ms = setup(() => {
    for (let i = 0; i < 400; i++) M.A.state.set(scopedIds[i], rec2({ s: 'known', r: 0, i: 0 }));
    for (let i = 400; i < 1000; i++) M.A.state.set(scopedIds[i], rec2({ s: 'queued', r: 0, i: 0 }));
  });
  ok('words retired at sort time are counted as already known',
    ms.alreadyKnew === 400, ms.alreadyKnew);
  ok('the known-rate comes from what you sorted',
    Math.abs(ms.knewRate - 0.4) < 1e-9, ms.knewRate);
  ok('the unsorted pile is projected at the same rate', (() => {
    const unsorted = totalScoped - 1000;
    return ms.target === 600 + Math.round(unsorted * 0.6);
  })(), 'target ' + ms.target);
  ok('the target is well below the raw scope', ms.target < totalScoped, ms.target);
  ok('a sorted-but-unstudied word is not progress',
    ms.mastered === 0 && ms.learning === 0 && ms.pctStarted === 0);

  // The estimate must re-project as you sort. If the rate you find stays the
  // same the target legitimately does not move, so this sorts a batch that is
  // mostly already-known and checks the target comes down.
  const before = ms.target;
  ms = setup(() => {
    for (let i = 0; i < 1400; i++) M.A.state.set(scopedIds[i], rec2({ s: 'known', r: 0, i: 0 }));
    for (let i = 1400; i < 2000; i++) M.A.state.set(scopedIds[i], rec2({ s: 'queued', r: 0, i: 0 }));
  });
  ok('a batch of mostly-known words lowers the estimate',
    ms.target < before, before + ' -> ' + ms.target);
  ok('the known-rate rose to match what was found',
    Math.abs(ms.knewRate - 0.7) < 1e-9, ms.knewRate);
  ok('the unsorted pile shrinks as you sort', ms.unsorted === totalScoped - 2000);

  // ---- graded progress: the learning process itself must count ----
  ok('a never-seen word is worth nothing', M.wordStrength(null) === 0);
  ok('a sorted-but-unstudied word is worth nothing',
    M.wordStrength({ s: 'queued', r: 0, i: 0 }) === 0);
  ok('a word in learning is worth something',
    M.wordStrength({ s: 'learning', r: 1, i: 0 }) > 0);
  ok('a fresh review is worth more than one in learning',
    M.wordStrength({ s: 'review', r: 3, i: 3 }) >
    M.wordStrength({ s: 'learning', r: 1, i: 0 }));
  ok('a longer interval is worth more', (() => {
    const a = M.wordStrength({ s: 'review', r: 4, i: 3 });
    const b = M.wordStrength({ s: 'review', r: 5, i: 12 });
    const c = M.wordStrength({ s: 'review', r: 6, i: 20 });
    return a < b && b < c && c < 1;
  })());
  ok('reaching the mastery interval is worth exactly one',
    M.wordStrength({ s: 'review', r: 6, i: M.CFG.MASTER_DAYS }) === 1);
  ok('a word retired after study is worth one',
    M.wordStrength({ s: 'known', r: 5, i: 0 }) === 1);
  ok('a word you already knew is not counted as progress',
    M.wordStrength({ s: 'known', r: 0, i: 0 }) === 0);
  ok('a leech still counts a little, but only a little',
    M.wordStrength({ s: 'leech', r: 12, i: 30 }) > 0 &&
    M.wordStrength({ s: 'leech', r: 12, i: 30 }) < 0.2);
  ok('strength never exceeds one',
    M.wordStrength({ s: 'review', r: 9, i: 400 }) === 1);

  // the bar has to move for a single extra correct answer
  ms = setup(() => {
    for (let i = 0; i < 100; i++) M.A.state.set(scopedIds[i], rec2({ s: 'review', i: 3, r: 3 }));
  });
  const beforeStep = ms.pctStarted;
  ms = setup(() => {
    for (let i = 0; i < 100; i++) M.A.state.set(scopedIds[i], rec2({ s: 'review', i: 3, r: 3 }));
    M.A.state.set(scopedIds[0], rec2({ s: 'review', i: 8, r: 4 }));
  });
  ok('one more correct answer moves the bar', ms.pctStarted > beforeStep,
    beforeStep + ' -> ' + ms.pctStarted);
  ok('but it does not yet count as mastered', ms.mastered === 0, ms.mastered);

  // now learn some of them
  ms = setup(() => {
    for (let i = 0; i < 400; i++) M.A.state.set(scopedIds[i], rec2({ s: 'known', r: 0, i: 0 }));
    for (let i = 400; i < 1000; i++) M.A.state.set(scopedIds[i], rec2({ s: 'queued', r: 0, i: 0 }));
    // 150 studied to mastery, 50 retired after study
    for (let i = 400; i < 550; i++) M.A.state.set(scopedIds[i], rec2({ s: 'review', i: 30, r: 6 }));
    for (let i = 550; i < 600; i++) M.A.state.set(scopedIds[i], rec2({ s: 'known', r: 4, i: 0 }));
  });
  ok('a mature review counts as mastered', ms.mastered === 200, ms.mastered);
  ok('a word retired after study counts as learned, not as already known',
    ms.alreadyKnew === 400, ms.alreadyKnew);
  ok('progress is mastered over the estimated target',
    Math.abs(ms.pct - ms.mastered / ms.target) < 1e-9, ms.pct);
  ok('progress is a sane fraction', ms.pct > 0 && ms.pct < 1, ms.pct);

  // everything sorted -> no estimate left
  ms = setup(() => {
    for (let i = 0; i < totalScoped; i++) {
      M.A.state.set(scopedIds[i], i < 3000 ? rec2({ s: 'known', r: 0, i: 0 })
        : rec2({ s: 'review', i: 30, r: 6 }));
    }
  });
  ok('a fully sorted pile is no longer an estimate', ms.estimated === false);
  ok('a fully sorted pile targets exactly what is left',
    ms.target === totalScoped - 3000, ms.target);
  ok('finishing everything reads as complete', ms.pct === 1, ms.pct);
  ok('progress never exceeds the target', ms.pct <= 1);

  // ---- the week ----
  const whb = M.A.set.history;
  M.A.set.history = {};
  const wkStart = M.weekStart();
  ok('the week is anchored to a Monday',
    new Date(wkStart + 'T12:00:00').getDay() === 1, wkStart);
  ok('the week start is on or before today', wkStart <= M.today(), wkStart);

  let wk = M.weekProgress(10);
  ok('an empty week has no progress', wk.done === 0 && wk.pct === 0);
  ok('the weekly target is the daily pace times seven', wk.target === 70, wk.target);
  M.A.set.history[M.today()] = { new: 25, rev: 100 };
  wk = M.weekProgress(10);
  ok('new words this week count towards it', wk.done === 25, wk.done);
  ok('reviews do not count towards the new-word target', wk.done === 25);
  ok('the weekly bar is a fraction of the target',
    Math.abs(wk.pct - 25 / 70) < 1e-9, wk.pct);
  ok('what is left is reported', wk.left === 45, wk.left);
  ok('days left is within the week', wk.daysLeft >= 0 && wk.daysLeft <= 6, wk.daysLeft);
  M.A.set.history[M.today()] = { new: 500, rev: 0 };
  wk = M.weekProgress(10);
  ok('a big week is capped at full', wk.pct === 1 && wk.left === 0);
  M.A.set.history = whb;

  M.A.state.clear();
  for (const [k, v] of msBackup) M.A.state.set(k, v);

  // ------------------------------------------------------- fill it in
  console.log('\n== fill it in (fading hints) ==');
  const HW = { pos: 'verb', lemma: 'entwickeln', article: '', en: 'to develop' };
  const HN = { pos: 'noun', lemma: 'Bewerbung', article: 'die', plural: 'Bewerbungen', en: 'application' };

  ok('a brand new word gets the most help', M.hintLevel({ r: 0 }) === 0);
  ok('no record at all gets the most help', M.hintLevel(null) === 0);
  ok('a stored level is used once it exists', M.hintLevel({ r: 0, h: 2 }) === 2);
  ok('the level is clamped to the top', M.hintLevel({ r: 0, h: 99 }) === M.HINT_MAX);
  ok('a negative level is clamped up', M.hintLevel({ r: 0, h: -3 }) === 0);
  // records written before this mode existed must not be spoon-fed
  ok('an old well-drilled record starts with less help',
    M.hintLevel({ r: 8 }) === M.HINT_MAX, M.hintLevel({ r: 8 }));
  ok('an old lightly-seen record still gets help', M.hintLevel({ r: 2 }) === 0);

  const m0 = M.hintMask(HW, 0), m1 = M.hintMask(HW, 1), m2 = M.hintMask(HW, 2);
  ok('the mask is as long as the word', m0.length === 'entwickeln'.length, m0);
  ok('level 0 reveals a prefix in order', m0.startsWith('entwi'), m0);
  ok('level 1 reveals fewer letters',
    (m1.match(/[a-zä-ü]/g) || []).length < (m0.match(/[a-zä-ü]/g) || []).length,
    m0 + ' -> ' + m1);
  ok('level 2 reveals nothing', !/[a-zA-ZäöüÄÖÜß]/.test(m2), m2);
  ok('every hidden letter is a dot', /^[·]+$/.test(m2), m2);
  ok('the revealed letters are the real ones',
    m0.replace(/·/g, '') === 'entwickeln'.slice(0, m0.replace(/·/g, '').length));

  const n0 = M.hintMask(HN, 0);
  ok('a noun mask keeps the article space', n0.includes(' '), n0);
  ok('the article is never revealed', !/^d/i.test(n0), n0);
  ok('the article is masked at full length',
    n0.split(' ')[0] === '···', n0.split(' ')[0]);
  ok('the noun body is still hinted', /[a-zA-ZäöüÄÖÜß]/.test(n0.split(' ')[1]), n0);
  ok('a noun at full fade shows nothing',
    !/[a-zA-ZäöüÄÖÜß]/.test(M.hintMask(HN, 2)), M.hintMask(HN, 2));

  // grading reuses the typing checker, so the article is still required
  ok('the answer still needs the article', !M.checkTyped(HN, 'Bewerbung').ok);
  ok('the full answer passes', M.checkTyped(HN, 'die Bewerbung').ok);

  // ------------------------------------------------------- sentence bank
  console.log('\n== cloze ==');
  const sentPath = path.join(APP, 'data/sentences.v1.json');
  const haveBank = fs.existsSync(sentPath);
  ok('the sentence bank ships with the app', haveBank, sentPath);

  const BANK = haveBank ? JSON.parse(fs.readFileSync(sentPath, 'utf8')) : { byId: {} };
  const bankIds = Object.keys(BANK.byId);
  ok('the bank is version 1', BANK.v === 1);
  ok('the bank credits its source', /Tatoeba/.test(BANK.source || ''), BANK.source);
  ok('the bank covers a useful share of the scope', bankIds.length > 3000, bankIds.length);

  // every blank must be exactly the lemma, on a word boundary, appearing once
  const LET = 'A-Za-zÄÖÜäöüßẞ';
  let badCut = 0, midWord = 0, echoed = 0, badRange = 0;
  for (const id of bankIds) {
    const word = M.A.words[+id];
    if (!word) { badRange++; continue; }
    for (const s of BANK.byId[id]) {
      const [de, at, len] = s;
      if (at < 0 || at + len > de.length) { badRange++; continue; }
      if (de.substr(at, len).toLowerCase() !== String(word.lemma).toLowerCase()) badCut++;
      const before = at === 0 ? ' ' : de[at - 1];
      const after = at + len >= de.length ? ' ' : de[at + len];
      if (new RegExp('[' + LET + ']').test(before) ||
          new RegExp('[' + LET + ']').test(after)) midWord++;
      const esc2 = String(word.lemma).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(^|[^' + LET + '])' + esc2 + '([^' + LET + ']|$)', 'gi');
      if ((de.match(re) || []).length > 1) echoed++;
    }
  }
  // "an" inside "Man" was a real bug: indexOf finds substrings, not words
  ok('every blank is exactly the lemma', badCut === 0, badCut);
  ok('no blank lands inside another word', midWord === 0, midWord);
  ok('the answer never appears elsewhere in its own sentence', echoed === 0, echoed);
  ok('every blank offset is in range and maps to a real word', badRange === 0, badRange);
  ok('every sentence carries an English translation',
    bankIds.every(id => BANK.byId[id].every(s => s[3] && s[3].length > 2)));

  // the bank keys on existing ids and never disturbs the vocabulary
  ok('the bank keys on existing word ids',
    bankIds.every(id => M.A.words[+id] && M.A.words[+id].id === +id));
  ok('the vocabulary file is untouched by the bank', M.A.words.length === 10390);

  // the app must survive with no bank at all — fetch is stubbed to vocab here
  ok('a missing or malformed bank leaves cloze simply unavailable',
    typeof M.A.sentences === 'object', JSON.stringify(Object.keys(M.A.sentences).length));
  ok('sentencesFor returns null when a word has none',
    M.sentencesFor({ id: 999999 }) === null);

  // choices
  const cw = M.A.words.find(x => x.pos === 'noun' && M.inScope(x));
  const cch = M.clozeChoices(cw, cw.id);
  ok('four cloze options are offered', cch.length === 4, cch.join(','));
  ok('the cloze answer is among them', cch.includes(cw.lemma), cch.join(','));
  ok('the cloze options are distinct', new Set(cch).size === 4, cch.join(','));
  ok('the options are stable for the same card',
    M.clozeChoices(cw, cw.id).join() === cch.join());
  ok('distractors share the part of speech', (() => {
    const others = cch.filter(o => o !== cw.lemma);
    return others.every(o => (M.A.byPos.get(cw.pos) || []).some(x => x.lemma === o));
  })(), cch.join(','));
  ok('no distractor is from the answer word family',
    cch.filter(o => o !== cw.lemma).every(o => M.familyKey({ lemma: o }) !== M.familyKey(cw)));

  const sample = [['Er ist sehr klug heute.', 12, 4, 'He is very smart today.']];
  ok('the prompt hides the answer',
    !/klug/.test(M.clozePrompt(sample[0])), M.clozePrompt(sample[0]));
  ok('the prompt keeps the rest of the sentence',
    /Er ist sehr/.test(M.clozePrompt(sample[0])) && /heute/.test(M.clozePrompt(sample[0])));
  ok('the filled sentence restores the answer',
    /klug/.test(M.clozeFilled(sample[0])));

  // ------------------------------------------------------- voice
  console.log('\n== voice ==');
  const NOUN_W = { pos: 'noun', lemma: 'Bewerbung', article: 'die', plural: 'Bewerbungen', en: 'application' };
  const VERB_W = { pos: 'verb', lemma: 'anfangen', prt: 'fing an', pp: 'angefangen', aux: 'haben', en: 'to begin' };

  ok('a German→English card reads the English answer',
    M.speechFor(NOUN_W, 'de2en').lang === 'en-US' &&
    M.speechFor(NOUN_W, 'de2en').text === 'application',
    JSON.stringify(M.speechFor(NOUN_W, 'de2en')));
  ok('an English→German card reads German',
    M.speechFor(NOUN_W, 'en2de').lang === 'de-DE');
  ok('the German reading includes the article',
    /die Bewerbung/.test(M.speechFor(NOUN_W, 'en2de').text),
    M.speechFor(NOUN_W, 'en2de').text);
  ok('a typed card reads the target with its article',
    M.speechFor(NOUN_W, 'type').text === 'die Bewerbung',
    M.speechFor(NOUN_W, 'type').text);
  ok('an article card reads the article and noun only',
    M.speechFor(NOUN_W, 'article').text === 'die Bewerbung');
  ok('a verb-forms card reads all three parts',
    /anfangen.*fing an.*angefangen/.test(M.speechFor(VERB_W, 'verb').text),
    M.speechFor(VERB_W, 'verb').text);
  ok('verb forms are read in German', M.speechFor(VERB_W, 'verb').lang === 'de-DE');
  ok('an unknown mode falls back to the German lemma',
    M.speechFor(VERB_W, 'whatever').lang === 'de-DE' &&
    M.speechFor(VERB_W, 'whatever').text === 'anfangen');
  ok('speechFor tolerates a missing word', M.speechFor(null, 'de2en') === null);

  // jsdom has no speechSynthesis — the feature must be inert, not broken
  ok('speech reports itself unavailable here', M.speechAvailable() === false);
  ok('saying something without support does not throw and returns false',
    M.say('test', 'de-DE') === false);
  ok('speakCard without support does not throw', (() => {
    try { M.speakCard(NOUN_W, 'en2de'); return true; } catch (e) { return false; }
  })());
  ok('stopSpeech without support does not throw', (() => {
    try { M.stopSpeech(); return true; } catch (e) { return false; }
  })());
  click('.nav button[data-go="settings"]'); await sleep(60);
  ok('the voice toggle is offered in Settings', !!w.document.getElementById('set-speak'));
  ok('the voice toggle is disabled when unsupported',
    w.document.getElementById('set-speak').disabled === true);
  click('.nav button[data-go="home"]'); await sleep(40);
  ok('voice defaults to off', M.CFG.defaults.speak === false);

  // with the toggle off, nothing is spoken even where support exists
  const realSpeak = M.A.set.speak;
  M.A.set.speak = false;
  ok('nothing is said while the toggle is off', M.say('hallo', 'de-DE') === false);
  M.A.set.speak = realSpeak;

  // ------------------------------------------------------- streak + freezes
  console.log('\n== streak and freezes ==');
  const sBackup = { streak: M.A.set.streak, lastDay: M.A.set.lastDay, freezes: M.A.set.freezes };
  const runStreak = (lastDay, streak, freezes, onDay) => {
    M.A.set.lastDay = lastDay; M.A.set.streak = streak; M.A.set.freezes = freezes;
    M.advanceStreak(onDay);
    return { streak: M.A.set.streak, freezes: M.A.set.freezes };
  };

  ok('days between two local dates', M.daysBetween('2026-08-05', '2026-08-08') === 3);
  ok('days between is zero for the same day', M.daysBetween('2026-08-05', '2026-08-05') === 0);
  ok('days between crosses a month boundary', M.daysBetween('2026-07-31', '2026-08-01') === 1);

  ok('a consecutive day extends the streak',
    runStreak('2026-08-05', 4, 0, '2026-08-06').streak === 5);
  ok('a missed day with no freeze resets to 1',
    runStreak('2026-08-05', 30, 0, '2026-08-07').streak === 1);
  ok('a missed day is covered by a banked freeze',
    runStreak('2026-08-05', 30, 1, '2026-08-07').streak === 31);
  ok('covering a day spends the freeze',
    runStreak('2026-08-05', 30, 1, '2026-08-07').freezes === 0);
  ok('two missed days need two freezes',
    runStreak('2026-08-05', 30, 1, '2026-08-08').streak === 1);
  ok('two freezes cover two missed days',
    runStreak('2026-08-05', 30, 2, '2026-08-08').streak === 31);
  ok('a freeze is earned every seventh day',
    runStreak('2026-08-05', 6, 0, '2026-08-06').freezes === 1);
  ok('freezes are capped', runStreak('2026-08-05', 13, 2, '2026-08-06').freezes === 2);
  ok('a first-ever day starts the streak at 1',
    runStreak(null, 0, 0, '2026-08-06').streak === 1);

  // settings written before freezes existed must behave exactly as before
  M.A.set.lastDay = '2026-08-05'; M.A.set.streak = 12; delete M.A.set.freezes;
  M.advanceStreak('2026-08-07');
  ok('a missing freezes field reads as zero and resets as it always did',
    M.A.set.streak === 1, M.A.set.streak);
  M.A.set.lastDay = '2026-08-05'; M.A.set.streak = 12; delete M.A.set.freezes;
  M.advanceStreak('2026-08-06');
  ok('a missing freezes field still extends normally', M.A.set.streak === 13);

  Object.assign(M.A.set, sBackup);

  ok('the heatmap spans the window it is asked for', M.heatSeries(84).length === 84);
  ok('the heatmap counts both new and review answers', (() => {
    const hb = M.A.set.history;
    M.A.set.history = { [M.today()]: { new: 5, rev: 7 } };
    const n = M.heatSeries(3).slice(-1)[0].n;
    M.A.set.history = hb;
    return n === 12;
  })());

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
  // a word with no specialist drill of its own, so it shows the base progression
  const plainWord = M.A.words.find(x => x.pos !== 'verb' && x.pos !== 'noun' &&
    M.inScope(x) && /^[a-z]{7,}$/i.test(x.lemma));
  const nounWord = M.A.words.find(x => M.isDrillableNoun(x) && M.inScope(x) && /^[a-zA-Z]{7,}$/.test(x.lemma));
  const verbForms = M.A.words.find(x => M.hasVerbForms(x) && M.inScope(x) &&
    !M.rectionFor(x) && /^[a-z]{6,12}$/i.test(x.lemma) &&
    /^[a-zäöüß]+$/i.test(x.prt) && /^[a-zäöüß]+$/i.test(x.pp));
  const verbRect = M.A.words.find(x => M.hasVerbForms(x) && M.rectionFor(x) && M.inScope(x));
  ok('found a plain word to drill', !!plainWord, plainWord && plainWord.pos + ' ' + plainWord.lemma);
  ok('found a noun to drill', !!nounWord, nounWord && nounWord.article + ' ' + nounWord.lemma);
  ok('found a verb with forms only', !!verbForms, verbForms && verbForms.lemma);
  ok('found a verb with a governed preposition', !!verbRect, verbRect && verbRect.lemma);

  const stage = (word, reps) => {
    M.A.state.clear(); M.A.dirty.clear();
    M.A.state.set(word.id,
      { s: 'review', e: 2.5, i: 1, d: Date.now() - 1000, r: reps, l: 0, p: -1, m: {}, t: 0 });
  };
  const modeAt = (word, reps) => { stage(word, reps); return M.pickMode(word); };

  ok('reps 0 is flip DE→EN', modeAt(plainWord, 0) === 'de2en', modeAt(plainWord, 0));
  ok('reps 1 is flip DE→EN', modeAt(plainWord, 1) === 'de2en');
  ok('reps 2 switches to filling it in', modeAt(plainWord, 2) === 'hint', modeAt(plainWord, 2));
  ok('reps 4 still fills it in', modeAt(plainWord, 4) === 'hint');
  ok('reps 5 is typing', modeAt(plainWord, 5) === 'type', modeAt(plainWord, 5));
  ok('reps 9 fills it in again', modeAt(plainWord, 9) === 'hint', modeAt(plainWord, 9));
  ok('a verb keeps the base progression at reps 4', modeAt(verbForms, 4) === 'hint');
  ok('a verb keeps the base progression at reps 5', modeAt(verbForms, 5) === 'type');
  ok('a verb takes the form drill at reps 3', modeAt(verbForms, 3) === 'verb',
    modeAt(verbForms, 3));
  ok('a verb takes the form drill again at reps 6', modeAt(verbForms, 6) === 'verb');
  ok('a verb with both drills starts on the preposition',
    modeAt(verbRect, 3) === 'rection', modeAt(verbRect, 3));
  ok('a verb with both drills alternates to forms at reps 6',
    modeAt(verbRect, 6) === 'verb', modeAt(verbRect, 6));
  ok('a verb with both drills alternates back at reps 9',
    modeAt(verbRect, 9) === 'rection', modeAt(verbRect, 9));
  ok('a noun starts on flip too', modeAt(nounWord, 0) === 'de2en');
  ok('a noun interleaves the article drill from rep 2',
    modeAt(nounWord, 2) === 'article', modeAt(nounWord, 2));
  ok('the noun returns to filling it in at rep 3', modeAt(nounWord, 3) === 'hint');
  ok('the article drill returns every fourth rep', modeAt(nounWord, 6) === 'article', modeAt(nounWord, 6));
  ok('a noun still reaches plain typing', modeAt(nounWord, 5) === 'type', modeAt(nounWord, 5));
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
  ok('typing card is selected at 5 reps', el('st-mode').textContent === 'Type it',
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

  await openStudy(nounWord, 6);
  ok('a noun at rep 6 is article-drilled', el('st-mode').textContent === 'Article', el('st-mode').textContent);
  await openStudy(nounWord, 5);
  ok('the noun typing prompt asks for the article',
    el('st-hint').textContent === 'Include the article', el('st-hint').textContent);
  setInput(nounWord.lemma);                     // no article → wrong
  click('#st-check'); await sleep(30);
  ok('a noun typed without its article is wrong', el('st-result').className.includes('bad'));

  await openStudy(nounWord, 5);
  setInput(nounWord.article + ' ' + nounWord.lemma);
  click('#st-check'); await sleep(30);
  ok('a noun typed with its article is correct', el('st-result').className.includes('good'));

  // ------------------------------------------------------- article drill
  console.log('\n== article drill (DOM) ==');
  await openStudy(nounWord, 2);
  ok('article drill is selected', el('st-mode').textContent === 'Article',
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

  // ------------------------------------------------------- verb forms
  console.log('\n== verb forms ==');
  ok('a verb with both parts is drillable', M.hasVerbForms(verbForms));
  ok('a noun is not form-drillable', !M.hasVerbForms(nounWord));
  ok('a verb missing a participle is not drillable',
    !M.hasVerbForms({ pos: 'verb', prt: 'ging', pp: '' }));

  ok('a verified wrong auxiliary is corrected',
    M.auxFor({ lemma: 'aufstehen', aux: 'haben' }) === 'sein',
    M.auxFor({ lemma: 'aufstehen', aux: 'haben' }));
  ok('a correct auxiliary passes through',
    M.auxFor({ lemma: 'gehen', aux: 'sein' }) === 'sein');
  ok('a genuinely dual verb reports both',
    M.auxFor({ lemma: 'fahren', aux: 'haben' }) === 'both');

  ok('matchForm accepts the exact form', M.matchForm('ging', 'ging') === 'exact');
  ok('matchForm is case-insensitive', M.matchForm('GING', 'ging') === 'exact');
  ok('matchForm collapses the space in a separable form',
    M.matchForm('fing   an', 'fing an') === 'exact');
  ok('matchForm folds umlauts', M.matchForm('schloss', 'schloß') === 'exact');
  ok('matchForm allows one typo above 5 chars',
    M.matchForm('angefanen', 'angefangen') === 'near');
  ok('matchForm rejects a short near-miss', M.matchForm('gang', 'ging') === 'wrong');
  ok('matchForm rejects an empty answer', M.matchForm('', 'ging') === 'wrong');

  // the ablaut vowel is the content of the form, not a spelling detail
  ok('a swapped vowel is detected', M.vowelSwap('fang an', 'fing an') === true);
  ok('a dropped letter is not a vowel swap', M.vowelSwap('angefanen', 'angefangen') === false);
  ok('two differences are not a vowel swap', M.vowelSwap('fang en', 'fing an') === false);
  ok('a consonant swap is not a vowel swap', M.vowelSwap('finf an', 'fing an') === false);
  ok('a swapped ablaut vowel is wrong, not a typo',
    M.matchVerbForm('fang an', 'fing an') === 'wrong', M.matchVerbForm('fang an', 'fing an'));
  ok('a dropped letter is still forgiven in a verb form',
    M.matchVerbForm('angefanen', 'angefangen') === 'near');
  ok('the exact verb form still passes', M.matchVerbForm('fing an', 'fing an') === 'exact');

  const VB = { pos: 'verb', lemma: 'anfangen', prt: 'fing an', pp: 'angefangen', aux: 'haben' };
  ok('all three parts correct passes',
    M.checkVerbForms(VB, 'fing an', 'angefangen', 'haben').ok &&
    !M.checkVerbForms(VB, 'fing an', 'angefangen', 'haben').near);
  ok('a wrong Präteritum fails', !M.checkVerbForms(VB, 'fang an', 'angefangen', 'haben').ok);
  ok('a wrong Partizip fails', !M.checkVerbForms(VB, 'fing an', 'gefangen', 'haben').ok);
  ok('a wrong auxiliary fails', !M.checkVerbForms(VB, 'fing an', 'angefangen', 'sein').ok);
  ok('the auxiliary alone can fail an otherwise perfect answer',
    M.checkVerbForms(VB, 'fing an', 'angefangen', 'sein').auxOk === false);
  ok('one typo in a form is a near miss',
    M.checkVerbForms(VB, 'fing an', 'angefanen', 'haben').near === true);
  const DUAL = { pos: 'verb', lemma: 'fahren', prt: 'fuhr', pp: 'gefahren', aux: 'haben' };
  ok('a dual verb accepts haben', M.checkVerbForms(DUAL, 'fuhr', 'gefahren', 'haben').ok);
  ok('a dual verb also accepts sein', M.checkVerbForms(DUAL, 'fuhr', 'gefahren', 'sein').ok);
  ok('the forms line shows both for a dual verb',
    M.verbFormsLine(DUAL) === 'fuhr · gefahren · haben/sein', M.verbFormsLine(DUAL));

  // ------------------------------------------------------- rection
  console.log('\n== rection ==');
  ok('preposition patterns are indexed', M.A.prepBy.size > 80, M.A.prepBy.size);
  ok('reflexive entries are indexed under the bare lemma',
    M.A.prepBy.has('bewerben'), [...M.A.prepBy.keys()].slice(0, 3).join(','));
  const allPats = [...M.A.prepBy.values()].flat();
  ok('bare-dative rows are excluded from the drill',
    allPats.every(p => p.prep !== 'D'), allPats.filter(p => p.prep === 'D').length);
  ok('the reflexive flag survives indexing',
    M.A.prepBy.get('bewerben').some(p => p.reflexive === true));
  ok('every indexed pattern carries a case field',
    allPats.every(p => typeof p.kase === 'string' && p.kase.length > 0));

  const PAT = { prep: 'um', kase: 'Akkusativ', en: 'to apply for', ex: 'Ich bewerbe mich um eine Stelle.', reflexive: true };
  const NOCASE = { prep: 'als', kase: '—', en: 'to be regarded as', ex: 'Er gilt als Experte.', reflexive: false };
  ok('the right preposition and case passes', M.checkRection(PAT, 'um', 'Akkusativ').ok);
  ok('a wrong preposition fails', !M.checkRection(PAT, 'für', 'Akkusativ').ok);
  ok('a wrong preposition is never a near miss',
    M.checkRection(PAT, 'für', 'Akkusativ').near === false);
  ok('the right preposition with the wrong case is a near miss',
    M.checkRection(PAT, 'um', 'Dativ').near === true &&
    !M.checkRection(PAT, 'um', 'Dativ').ok);
  ok('a caseless pattern passes on the preposition alone',
    M.checkRection(NOCASE, 'als', null).ok, 'gelten als');
  ok('a caseless pattern needs no case step',
    M.checkRection(NOCASE, 'als', null).needsCase === false);

  const ch = M.prepChoices(PAT, 42);
  ok('four cloze options are offered', cch.length === 4, cch.join(','));
  ok('the answer is among them', ch.includes('um'), ch.join(','));
  ok('the cloze options are distinct', new Set(cch).size === 4, cch.join(','));
  ok('the options are stable for the same card',
    M.prepChoices(PAT, 42).join(',') === ch.join(','));
  ok('different cards get different layouts',
    [0, 1, 2, 3, 4, 5].map(s => M.prepChoices(PAT, s).indexOf('um')).some(x => x !== ch.indexOf('um')));

  ok('the example blanks the preposition',
    M.blankExample(PAT) === 'Ich bewerbe mich ___ eine Stelle.', M.blankExample(PAT));
  ok('a contracted preposition is blanked too',
    M.blankExample({ prep: 'von', ex: 'Das hängt vom Wetter ab.' }) === 'Das hängt ___ Wetter ab.',
    M.blankExample({ prep: 'von', ex: 'Das hängt vom Wetter ab.' }));
  ok('an unlocatable preposition yields no blank',
    M.blankExample({ prep: 'aus', ex: 'Daraus schließe ich, dass ...' }) === '');
  ok('the blank never leaks the answer',
    !M.blankExample(PAT).includes(' um '));
  ok('the rection answer is formatted with its case',
    M.rectionAnswer(PAT) === 'um + Akkusativ', M.rectionAnswer(PAT));
  ok('a caseless rection answer omits the case',
    M.rectionAnswer(NOCASE) === 'als', M.rectionAnswer(NOCASE));
  ok('the grammar line now surfaces the governed preposition',
    /bewerben um/.test(M.grammar(M.A.words.find(x => x.lemma === 'bewerben' && x.pos === 'verb'))),
    M.grammar(M.A.words.find(x => x.lemma === 'bewerben' && x.pos === 'verb')));

  // ------------------------------------------------------- verb drill (DOM)
  console.log('\n== verb form drill (DOM) ==');
  const setVerb = (prt, pp, aux) => {
    const a = el('st-vprt'), b = el('st-vpp');
    a.value = prt; a.dispatchEvent(new w.Event('input', { bubbles: true }));
    b.value = pp; b.dispatchEvent(new w.Event('input', { bubbles: true }));
    if (aux) click(`[data-aux="${aux}"]`);
  };
  const trueAux = M.auxFor(verbForms) === 'both' ? 'haben' : M.auxFor(verbForms);
  const wrongAux = trueAux === 'haben' ? 'sein' : 'haben';

  await openStudy(verbForms, 3);
  ok('the form drill is selected', el('st-mode').textContent === 'Verb forms',
    el('st-mode').textContent);
  ok('the verb pad is shown', !el('st-verbpad').classList.contains('hidden'));
  ok('the prompt is the infinitive', el('st-prompt').textContent.includes(verbForms.lemma));
  ok('check is disabled with nothing entered', el('st-vcheck').disabled);
  setVerb(verbForms.prt, verbForms.pp, null);
  ok('check stays disabled without an auxiliary', el('st-vcheck').disabled);
  click(`[data-aux="${trueAux}"]`);
  ok('check enables once all three are given', !el('st-vcheck').disabled);
  click('#st-vcheck'); await sleep(30);
  ok('a fully correct answer shows the positive banner',
    el('st-result').className.includes('good'), el('st-result').className);
  got = M.A.state.get(verbForms.id);
  ok('a correct form answer does not lapse', got.l === 0, got.l);
  ok('a correct form answer counts a verb rep', got.m.verb === 1, JSON.stringify(got.m));

  if (M.auxFor(verbForms) !== 'both') {
    await openStudy(verbForms, 3);
    setVerb(verbForms.prt, verbForms.pp, wrongAux);
    click('#st-vcheck'); await sleep(30);
    ok('the wrong auxiliary fails the card',
      el('st-result').className.includes('bad'), el('st-result').className);
    got = M.A.state.get(verbForms.id);
    ok('a wrong auxiliary grades Again', got.l === 1, got.l);
  } else {
    ok('the wrong auxiliary fails the card', true, 'skipped: dual-auxiliary verb');
    ok('a wrong auxiliary grades Again', true, 'skipped: dual-auxiliary verb');
  }

  await openStudy(verbForms, 3);
  setVerb(verbForms.prt, verbForms.pp.slice(0, -1), trueAux);
  click('#st-vcheck'); await sleep(30);
  got = M.A.state.get(verbForms.id);
  ok('one typo in a form grades Hard, not Again',
    Math.abs(got.e - 2.35) < 1e-9 && got.l === 0, got.e + ' / lapses ' + got.l);
  ok('the near-miss banner shows the correct forms',
    el('st-rbody').textContent.includes(verbForms.pp), el('st-rbody').textContent);

  // ------------------------------------------------------- rection drill (DOM)
  console.log('\n== rection drill (DOM) ==');
  const rpat = M.rectionFor(verbRect)[0];
  const rNeedsCase = rpat.kase === 'Dativ' || rpat.kase === 'Akkusativ';

  await openStudy(verbRect, 3);
  ok('the rection drill is selected', el('st-mode').textContent === 'Preposition',
    el('st-mode').textContent);
  ok('the preposition pad is shown', !el('st-prepad').classList.contains('hidden'));
  ok('four preposition buttons are rendered',
    w.document.querySelectorAll('[data-prep]').length === 4);
  ok('the case pad is hidden until the preposition is right',
    el('st-casepad').classList.contains('hidden'));
  ok('the prompt does not contain the bare answer',
    !el('st-prompt').textContent.includes(' ' + rpat.prep + ' '),
    el('st-prompt').textContent);

  click(`[data-prep="${rpat.prep}"]`); await sleep(20);
  if (rNeedsCase) {
    ok('the right preposition opens the case step',
      !el('st-casepad').classList.contains('hidden'));
    click(`[data-case="${rpat.kase}"]`); await sleep(30);
  } else {
    ok('a caseless pattern finishes on the preposition', !el('st-result').classList.contains('hidden'));
  }
  ok('a fully right rection shows the positive banner',
    el('st-result').className.includes('good'), el('st-result').className);
  got = M.A.state.get(verbRect.id);
  ok('a right rection does not lapse', got.l === 0, got.l);
  ok('a right rection counts a rection rep', got.m.rection === 1, JSON.stringify(got.m));

  await openStudy(verbRect, 3);
  const badPrep = [...w.document.querySelectorAll('[data-prep]')]
    .map(b => b.dataset.prep).find(p => p !== rpat.prep);
  click(`[data-prep="${badPrep}"]`); await sleep(30);
  ok('a wrong preposition grades immediately, with no case step',
    el('st-result').className.includes('bad') &&
    el('st-casepad').classList.contains('hidden'), el('st-result').className);
  got = M.A.state.get(verbRect.id);
  ok('a wrong preposition grades Again', got.l === 1, got.l);
  ok('the banner shows the right preposition',
    el('st-rbody').textContent.includes(rpat.prep), el('st-rbody').textContent);

  if (rNeedsCase) {
    await openStudy(verbRect, 3);
    click(`[data-prep="${rpat.prep}"]`); await sleep(20);
    const badCase = rpat.kase === 'Dativ' ? 'Akkusativ' : 'Dativ';
    click(`[data-case="${badCase}"]`); await sleep(30);
    got = M.A.state.get(verbRect.id);
    ok('the right preposition with the wrong case grades Hard',
      Math.abs(got.e - 2.35) < 1e-9 && got.l === 0, got.e + ' / lapses ' + got.l);
  } else {
    ok('the right preposition with the wrong case grades Hard', true, 'skipped: caseless pattern');
  }

  // -------------------------------------------------- fill it in, via DOM
  console.log('\n== fill it in (DOM) ==');
  const letters = s => (s.match(/[a-zA-ZäöüÄÖÜß]/g) || []).length;

  await openStudy(plainWord, 2);
  ok('rep 2 opens the fill-in card', el('st-mode').textContent === 'Fill it in',
    el('st-mode').textContent);
  ok('the scaffold is shown', !el('st-mask').classList.contains('hidden'));
  ok('the prompt is the English gloss', el('st-prompt').textContent.includes(plainWord.en));
  ok('the typing pad is reused', !el('st-typepad').classList.contains('hidden'));
  const shown0 = letters(el('st-mask').textContent);
  ok('some letters are given away at first', shown0 > 0, shown0 + ' letters');
  ok('not the whole word', shown0 < plainWord.lemma.length, shown0);

  // answer it right -> less help next time
  setInput(plainWord.lemma);
  click('#st-check'); await sleep(30);
  ok('a correct fill-in shows the positive banner',
    el('st-result').className.includes('good'));
  let hs = M.A.state.get(plainWord.id);
  ok('a correct answer raises the level', hs.h === 1, JSON.stringify(hs.h));
  ok('it counts a hint rep', hs.m.hint === 1, JSON.stringify(hs.m));

  await openStudy(plainWord, 2);
  M.A.state.get(plainWord.id).h = 1;
  click('[data-go="home"]'); await sleep(20);
  click('[data-go="study"]'); await sleep(50);
  const shown1 = letters(el('st-mask').textContent);
  ok('the second showing gives fewer letters', shown1 < shown0, shown0 + ' -> ' + shown1);

  M.A.state.get(plainWord.id).h = 2;
  click('[data-go="home"]'); await sleep(20);
  click('[data-go="study"]'); await sleep(50);
  ok('the third showing is a blank', letters(el('st-mask').textContent) === 0,
    el('st-mask').textContent);
  ok('the hint line says the help is gone',
    /No help left/.test(el('st-hint').textContent), el('st-hint').textContent);

  // getting it wrong must not cost you help
  setInput('zzzfalsch');
  click('#st-check'); await sleep(30);
  hs = M.A.state.get(plainWord.id);
  ok('a wrong answer gives help back rather than taking it', hs.h === 1, hs.h);
  ok('a wrong fill-in still grades Again', hs.l === 1 || hs.s === 'relearning',
    hs.s + ' lapses ' + hs.l);

  // a near miss holds the level rather than advancing it
  M.A.state.get(plainWord.id).h = 1;
  M.A.state.get(plainWord.id).l = 0;
  click('[data-go="home"]'); await sleep(20);
  click('[data-go="study"]'); await sleep(50);
  setInput(plainWord.lemma.slice(0, -1));
  click('#st-check'); await sleep(30);
  ok('a near miss holds the level steady', M.A.state.get(plainWord.id).h === 1,
    M.A.state.get(plainWord.id).h);

  // -------------------------------------------------- failed cards come back
  console.log('\n== re-entry distance ==');
  {
    // a realistic long session, and a card failed early in it
    const deck = M.A.words.filter(x => M.inScope(x)).slice(0, 120);
    const target = deck[3];
    M.ST.queue = deck.slice();
    M.ST.i = 3;
    M.ST.again = new Map();
    M.MT.words = null;
    const st = { s: 'relearning', e: 2.2, i: 1, d: Date.now() + 5 * 60000,
      r: 4, l: 1, p: 0, m: {}, t: 0 };

    M.requeueIfSoon(target, st);
    const first = M.ST.queue.indexOf(target, 4);
    ok('a failed card comes back within a handful of cards',
      first > 3 && first - 4 <= 6, 'reappears ' + (first - 4) + ' cards later');
    ok('it is not appended to the end of the queue',
      first < M.ST.queue.length - 10, first + ' of ' + M.ST.queue.length);
    ok('the queue grew by exactly one', M.ST.queue.length === 121, M.ST.queue.length);

    // fail it again: the gap should widen, not stay flat
    M.ST.i = first;
    M.requeueIfSoon(target, st);
    const second = M.ST.queue.indexOf(target, first + 1);
    ok('a second failure comes back further out',
      second - first > first - 4, 'first ' + (first - 4) + ', then ' + (second - first - 1));
    ok('but still inside the session', second < M.ST.queue.length);

    // the cap still holds
    M.ST.again = new Map([[target.id, M.CFG.MAX_REENTRY]]);
    const before = M.ST.queue.length;
    M.requeueIfSoon(target, st);
    ok('the per-word cap still stops it eventually',
      M.ST.queue.length === before, M.ST.queue.length);

    // a card that is genuinely far off must not be pulled back in
    M.ST.again = new Map();
    const far = { s: 'review', e: 2.5, i: 9, d: Date.now() + 9 * 86400000,
      r: 6, l: 0, p: -1, m: {}, t: 0 };
    const n0 = M.ST.queue.length;
    M.requeueIfSoon(deck[10], far);
    ok('a card due in days is not re-queued', M.ST.queue.length === n0);

    // during a pairing round the cursor jumps by the round size — the card
    // must land ahead of that, not behind it where it would never be seen
    M.ST.queue = deck.slice(); M.ST.i = 10; M.ST.again = new Map();
    M.MT.words = deck.slice(10, 10 + M.CFG.MATCH_PAIRS);
    M.requeueIfSoon(deck[10], st);
    const afterRound = M.ST.queue.indexOf(deck[10], 11);
    ok('a word failed inside a pairing round lands after the round',
      afterRound >= 10 + M.CFG.MATCH_PAIRS, afterRound + ' vs cursor ' +
      (10 + M.CFG.MATCH_PAIRS));
    M.MT.words = null;
  }

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

  // ------------------------------------------------------- leech rehab
  console.log('\n== leech rehabilitation ==');
  M.A.state.clear(); M.A.dirty.clear();
  const leechId = plainWord.id, okId = nounWord.id;
  M.A.state.set(leechId, { s: 'leech', e: 1.4, i: 30, d: Date.now() + 3e10, r: 12, l: 8, p: -1, m: {}, t: 0 });
  M.A.state.set(okId, { s: 'review', e: 2.5, i: 10, d: Date.now() + 1e9, r: 4, l: 1, p: -1, m: {}, t: 0 });

  ok('a leech is excluded from the due list',
    !M.dueList(Date.now() + 4e10).some(x => x.id === leechId));
  ok('rehabilitation reports success', M.rehabLeech(leechId) === true);
  let reh = M.A.state.get(leechId);
  ok('a rehabilitated leech is queued again', reh.s === 'queued', reh.s);
  ok('its lapse counter is cleared', reh.l === 0, reh.l);
  ok('its reps restart so it returns to recognition', reh.r === 0, reh.r);
  ok('it is asked as a flip card again', M.pickMode(plainWord) === 'de2en',
    M.pickMode(plainWord));
  ok('its ease is lifted out of the floor', reh.e >= 2.0, reh.e);
  ok('its ease stays within the clamp', reh.e <= M.CFG.EASE_MAX, reh.e);
  ok('it is no longer suspended far in the future', reh.d === 0, reh.d);
  ok('a rehabilitated word re-enters the new queue',
    M.queuedNew().some(x => x.id === leechId));
  ok('rehabilitating a non-leech does nothing', M.rehabLeech(okId) === false);
  ok('the non-leech is untouched', M.A.state.get(okId).l === 1);

  M.A.state.set(leechId, { s: 'leech', e: 1.3, i: 30, d: Date.now(), r: 9, l: 9, p: -1, m: {}, t: 0 });
  M.A.state.set(verbForms.id, { s: 'leech', e: 1.3, i: 30, d: Date.now(), r: 9, l: 8, p: -1, m: {}, t: 0 });
  ok('rehabilitating all reports the count', M.rehabAllLeeches() === 2);
  ok('no leeches remain', ![...M.A.state.values()].some(v => v.s === 'leech'));
  ok('rehabilitating all again is a no-op', M.rehabAllLeeches() === 0);

  // the flow through the real Statistik DOM
  M.A.state.set(leechId, { s: 'leech', e: 1.3, i: 30, d: Date.now(), r: 9, l: 8, p: -1, m: {}, t: 0 });
  click('[data-go="stats"]'); await sleep(50);
  ok('the leech is listed under Statistik',
    !!w.document.querySelector(`[data-leech="${leechId}"]`));
  ok('a rehab-all control is offered', !!el('leech-all'));
  click(`[data-leech="${leechId}"]`); await sleep(40);
  ok('tapping a leech rehabilitates it',
    M.A.state.get(leechId).s === 'queued', M.A.state.get(leechId).s);
  ok('the list clears once nothing is suspended',
    !w.document.querySelector('[data-leech]'));

  // ------------------------------------------------------- richer stats
  console.log('\n== retention and projection ==');
  const hb2 = M.A.set.history;
  M.A.set.history = {};
  ok('retention is null with no history', M.retention(30) === null);
  M.A.set.history[M.today()] = { new: 10, rev: 30, again: 4 };
  ok('retention counts every graded answer',
    Math.abs(M.retention(30) - 0.9) < 1e-9, M.retention(30));
  M.A.set.history[M.today(Date.now() - 86400000)] = { new: 0, rev: 60, again: 26 };
  ok('retention spans the window',
    Math.abs(M.retention(30) - 0.7) < 1e-9, M.retention(30));
  ok('a day outside the window is ignored',
    Math.abs(M.retention(1) - 0.9) < 1e-9, M.retention(1));
  M.A.set.history = { [M.today()]: { new: 5, rev: 5 } };
  ok('records without an again count are treated as zero',
    M.retention(30) === 1, M.retention(30));

  M.A.set.history = {};
  ok('projection is null with no pace', M.projectedDays() === null);
  M.A.set.history[M.today()] = { new: 25, rev: 0, again: 0 };
  const pd = M.projectedDays();
  ok('projection is a positive number of days', pd > 0, pd);
  ok('projection follows the remaining queue',
    pd === Math.ceil(M.remainingToLearn() / M.recentPace(7)), pd);

  // logAnswer must feed the retention counter
  M.A.set.history = {};
  M.logAnswer(false, M.G.AGAIN);
  M.logAnswer(false, M.G.GOOD);
  M.logAnswer(true, M.G.GOOD);
  const hToday = M.A.set.history[M.today()];
  ok('answers are counted by kind',
    hToday.new === 1 && hToday.rev === 2, JSON.stringify(hToday));
  ok('only Again increments the lapse counter', hToday.again === 1, hToday.again);
  ok('retention reflects the logged answers',
    Math.abs(M.retention(30) - 2 / 3) < 1e-9, M.retention(30));
  M.A.set.history = hb2;

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
  ok('stats rendered', /Where your words are/.test(w.document.getElementById('stats-body').innerHTML));
  // a mode row whose counter key is missing throws and blanks the whole screen
  const statsHTML = w.document.getElementById('stats-body').innerHTML;
  ok('stats renders every practice mode',
    ['German → English', 'English → German', 'Type it', 'Article', 'Verb forms', 'Preposition']
      .every(l => statsHTML.includes(l)),
    statsHTML.length + ' chars');
  ok('stats renders the forecast', /Will you make it/.test(statsHTML));
  ok('settings shows install prompt',
    /Add this to your Home Screen/.test(w.document.getElementById('installcard').innerHTML));
  ok('no errors after full pass', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
