/* Wortmeister — German A1–B2 vocabulary trainer.
   Phase 1: triage sprint, flip cards, SM-2 + response-time scheduling,
   IndexedDB persistence, backup/restore, PWA install.
   Phase 2: typing mode, article drill, per-word mode progression, pacing panel.
   No framework, no build step. */
'use strict';

/* ============================ config ============================ */
const CFG = {
  data: 'data/vocab.v1.json',
  dbName: 'wortmeister', dbVer: 1,
  MIN: 60000, DAY: 86400000,
  LEARN_STEPS: [10 * 60000, 86400000],   // 10 min, 1 day
  GRAD: 3, GRAD_EASY: 5,                 // graduating intervals (days)
  EASE_MIN: 1.3, EASE_MAX: 3.0, EASE_START: 2.5,
  LEECH_AT: 8,
  FAST: 0.6, SLOW: 2.0,                  // response-time multipliers
  MED_WINDOW: 50, MED_CAP: 60000,
  TYPO_MIN_LEN: 5,                       // Levenshtein slack only above this
  MAX_REENTRY: 3,                        // re-looks per word per session
  SETTINGS_DEBOUNCE: 1500,
  defaults: {
    exam: '2026-11-11', newPerDay: 0, maxReviews: 250,
    scope: { A1: true, A2: true, B1: true, 'B2-core': true, 'B2-extended': false },
    streak: 0, lastDay: null, history: {}, medians: {}
  }
};
const G = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 };
/* Mode labels name the task, not the internal key — the pill is the only
   thing telling you what this card is going to ask for. */
const MODE_LABEL = {
  de2en: 'German → English', en2de: 'English → German', type: 'Type it',
  article: 'Article', verb: 'Verb forms', rection: 'Preposition'
};

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
function setTint(level) {
  const el = $('#ambient');
  if (el) el.style.setProperty('--tint', LEVEL_TINT[level] || '#0a84ff');
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

/** Apply a grade. Mutates and returns the state record. */
function applyGrade(st, grade, now) {
  const cap = daysToExam();
  const dueIn = ms => { st.d = now + ms; return st; };
  const dueDays = d => {
    st.i = Math.max(1, Math.min(Math.round(d), cap));
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

/** What each button would schedule, for the labels under the grade buttons. */
function previewIntervals(st) {
  return [G.AGAIN, G.HARD, G.GOOD, G.EASY].map(g => {
    const copy = JSON.parse(JSON.stringify(st));
    applyGrade(copy, g, Date.now());
    const ms = copy.d - Date.now();
    if (copy.s === 'leech') return 'paused';
    if (ms < CFG.DAY) return Math.max(1, Math.round(ms / CFG.MIN)) + ' min';
    const d = Math.round(ms / CFG.DAY);
    return d >= 30 ? (d / 30).toFixed(1).replace('.0', '') + ' mo' : d + ' d';
  });
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
  const due = dueList(now).slice(0, A.set.maxReviews);
  const doneToday = (A.set.history[today()] || {}).new || 0;
  const want = Math.max(0, autoNewTarget() - doneToday);
  let fresh = queuedNew().slice(0, want);
  if (!fresh.length && !due.length) fresh = untriaged().slice(0, want); // never blank
  if (!due.length) return fresh;

  // interleave so new cards are spread through the session, not front-loaded
  const out = [], every = fresh.length ? Math.max(1, Math.floor(due.length / fresh.length)) : 0;
  let fi = 0;
  due.forEach((w, i) => {
    out.push(w);
    if (fi < fresh.length && every && (i + 1) % every === 0) out.push(fresh[fi++]);
  });
  while (fi < fresh.length) out.push(fresh[fi++]);
  return out;
}

/**
 * How a word should be asked, by how many times it has been answered.
 * Recognition first, then recall, then production:
 *   reps 0–1  flip DE→EN
 *   reps 2–4  flip EN→DE
 *   reps 5+   type the German
 *
 * Specialist drills take every third slot rather than replacing the
 * progression: nouns from rep 2 (gender), verbs from rep 3 (forms, and the
 * governed preposition where one exists). A verb with both alternates between
 * them so neither is starved.
 */
function pickMode(w) {
  const st = getState(w.id);
  const reps = st ? st.r : 0;

  if (isDrillableNoun(w) && reps >= 2 && reps % 3 === 2) return 'article';

  if (w.pos === 'verb' && reps >= 3 && reps % 3 === 0) {
    const forms = hasVerbForms(w);
    const rection = !!rectionFor(w);
    if (forms && rection) return (reps / 3) % 2 === 0 ? 'verb' : 'rection';
    if (forms) return 'verb';
    if (rection) return 'rection';
  }

  if (reps < 2) return 'de2en';
  if (reps < 5) return 'en2de';
  return 'type';
}

/* ============================ history / streak ============================ */
function logAnswer(isNew, grade) {
  const d = today();
  const h = A.set.history[d] || (A.set.history[d] = { new: 0, rev: 0, again: 0 });
  if (h.again === undefined) h.again = 0;   // records written before v1.2
  if (isNew) h.new++; else h.rev++;
  if (grade === G.AGAIN) h.again++;
  if (A.set.lastDay !== d) {
    const y = today(Date.now() - CFG.DAY);
    A.set.streak = (A.set.lastDay === y) ? (A.set.streak + 1) : 1;
    A.set.lastDay = d;
  }
  queueSettings();
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
  ['home', '◎', 'Home'], ['browse', '☰', 'Words'],
  ['stats', '◔', 'Stats'], ['settings', '⚙', 'Settings']
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
  window.scrollTo(0, 0);
}
function buildNav() {
  const html = NAV.map(([k, i, l]) =>
    `<button data-go="${k}"><b>${i}</b>${l}</button>`).join('');
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
  const doneToday = (A.set.history[today()] || {}).new || 0;
  const newLeft = Math.max(0, autoNewTarget(remaining) - doneToday);
  return {
    scoped: scoped.length, known, triaged, untriaged: scoped.length - triaged,
    remaining, dte, due, newLeft, cards: due + newLeft,
    need: Math.ceil(remaining / dte)
  };
}

function renderHome() {
  setTint(null);
  const o = overview();
  const pct = o.scoped ? o.known / o.scoped : 0;
  $('#ringfill').setAttribute('stroke-dasharray', `${(pct * CIRC).toFixed(1)} ${CIRC}`);
  $('#ringpct').textContent = Math.round(pct * 100) + '%';
  $('#ringsub').textContent =
    `${o.known.toLocaleString('en')} of ${o.scoped.toLocaleString('en')} words`;
  $('#countdown').textContent = o.dte + ' days until the exam';
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
    return '<button class="btn" data-go="triage">Start sorting</button>';
  }
  if (o.cards > 0) {
    const more = o.untriaged > 0
      ? `<button class="btn ghost sm" data-go="triage" style="margin-top:9px">
           Sort ${o.untriaged.toLocaleString('en')} more</button>`
      : '';
    return `<button class="btn" data-go="study">
      Study — ${o.cards.toLocaleString('en')} cards</button>` + more;
  }
  if (o.untriaged > 0) {
    return `<button class="btn" data-go="triage">
      Sort words — ${o.untriaged.toLocaleString('en')} left</button>`;
  }
  return '<button class="btn" disabled>Nothing due today</button>';
}

/** The Today and Pace rows, which live under Stats but are kept current
    from Home too so the tab is never stale when you open it. */
function renderCounters(o) {
  o = o || overview();
  $('#s-due').textContent = o.due.toLocaleString('en');
  $('#s-new').textContent = o.newLeft.toLocaleString('en');
  $('#s-triage').textContent = o.untriaged.toLocaleString('en');
  $('#s-streak').textContent =
    (A.set.streak || 0) + (A.set.streak === 1 ? ' day' : ' days');
  $('#s-need').textContent = o.need + (o.need === 1 ? ' word' : ' words');
  const avg = recentPace(7);
  $('#s-actual').textContent = avg + (avg === 1 ? ' word' : ' words');
  const tr = $('#s-track');
  if (!o.triaged) { tr.textContent = 'Sort first'; tr.style.color = 'var(--gold)'; }
  else if (avg >= o.need) { tr.textContent = 'On track'; tr.style.color = 'var(--green)'; }
  else { tr.textContent = 'Behind'; tr.style.color = 'var(--gold)'; }
  renderPace(o.need);
}

/** Shown until the first word is sorted — the flow is not self-evident. */
function firstRunGuide() {
  return `<div class="note">
    <b>Start by sorting your words</b>
    <ol>
      <li>Each word appears once. Mark the ones you already know so they never
        enter your study queue.</li>
      <li>Aim for about a second per word — swipe right if you know it, left to
        learn it.</li>
      <li>Sort the A1–B1 words before you start studying, or the queue fills up
        with words you already know.</li>
    </ol></div>`;
}

/** Seven days of new words against the required daily pace. */
function renderPace(need) {
  const series = paceSeries(7);
  const top = Math.max(need, ...series.map(d => d.n), 1);
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
    <b>Add this to your Home Screen</b>
    <p class="sub" style="margin:0">Safari deletes all data for this site after
    7 days. Added to the Home Screen, it runs as an app and your progress
    survives.<br><br>Share ⎋ → “Add to Home Screen”.</p></div>`;
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
  const w = TG.list[TG.i];
  $('#tg-word').textContent = display(w);
  setTint(w.level.replace('*', ''));
  $('#tg-fach').textContent = w.fach ? 'Technical' : '';
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

// swipe: right = know, left = learn
(function swipe() {
  const el = $('#tg-face');
  let x0 = null, y0 = null;
  el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) triage(dx > 0 ? 'know' : 'learn');
    x0 = y0 = null;
  }, { passive: true });
})();

/* ============================ study ============================ */
const ST = {
  queue: [], i: 0, mode: 'de2en', t0: 0, revealed: false, done: 0,
  elapsed: 0, again: new Map(),
  aux: null,        // auxiliary picked in the verb-form drill
  pat: null,        // rection pattern being asked
  prep: null        // preposition picked, before the case step
};
const AUTO_MODES = { type: true, article: true, verb: true, rection: true };

function startStudy() {
  ST.queue = buildSession(); ST.i = 0; ST.done = 0; ST.again = new Map();
  if (!ST.queue.length) {
    $('#st-prompt').innerHTML =
      '<span style="font-size:20px;color:var(--green)">Nothing due today</span>';
    $('#st-answer').classList.add('hidden');
    $('#st-gram').classList.add('hidden');
    $('#st-hint').textContent = 'Come back tomorrow, or sort more words';
    hidePads();
    $('#st-donepad').classList.remove('hidden');
    $('#st-count').textContent = '';
    return;
  }
  showCard();
}
function hidePads() {
  ['#st-pad', '#st-grades', '#st-typepad', '#st-artpad', '#st-verbpad',
    '#st-prepad', '#st-casepad', '#st-result', '#st-donepad']
    .forEach(s => $(s).classList.add('hidden'));
}
function showCard() {
  if (ST.i >= ST.queue.length) {
    $('#st-prompt').innerHTML =
      `<span style="font-size:20px;color:var(--green)">Session complete</span>`;
    $('#st-answer').classList.add('hidden');
    $('#st-gram').classList.add('hidden');
    $('#st-hint').textContent =
      ST.done + (ST.done === 1 ? ' card reviewed' : ' cards reviewed');
    hidePads();
    $('#st-donepad').classList.remove('hidden');
    $('#st-meter').style.width = '100%';
    flush();
    renderHome();
    return;
  }
  const w = ST.queue[ST.i];
  ST.mode = pickMode(w);
  ST.revealed = false;
  ST.t0 = performance.now();

  setTint(w.level.replace('*', ''));
  $('#st-mode').textContent = MODE_LABEL[ST.mode];
  $('#st-answer').classList.add('hidden');
  $('#st-gram').classList.add('hidden');
  $('#st-gram').innerHTML = grammar(w);
  $('#st-face').classList.toggle('top', !!AUTO_MODES[ST.mode]);
  hidePads();

  if (ST.mode === 'type') {
    $('#st-prompt').innerHTML = esc(w.en) + '<small>' + esc(posLabel(w.pos)) + '</small>';
    $('#st-answer').innerHTML = esc(display(w));
    $('#st-hint').textContent = isDrillableNoun(w)
      ? 'Include the article' : 'Type the German word';
    const inp = $('#st-input');
    inp.value = ''; inp.disabled = false;
    $('#st-check').disabled = true;
    $('#st-typepad').classList.remove('hidden');
    inp.focus();
  } else if (ST.mode === 'article') {
    $('#st-prompt').innerHTML = esc(w.lemma) + '<small class="gloss">' + esc(w.en) + '</small>';
    $('#st-answer').innerHTML = esc(display(w));
    $('#st-hint').textContent = 'Which article?';
    $('#st-artpad').classList.remove('hidden');
  } else if (ST.mode === 'verb') {
    $('#st-prompt').innerHTML = esc(w.lemma) + '<small class="gloss">' + esc(w.en) + '</small>';
    $('#st-answer').innerHTML = esc(verbFormsLine(w));
    $('#st-hint').textContent = 'Simple past, past participle, and haben or sein';
    $('#st-vprt').value = ''; $('#st-vprt').disabled = false;
    $('#st-vpp').value = ''; $('#st-vpp').disabled = false;
    ST.aux = null;
    $$('[data-aux]').forEach(b => b.classList.remove('sel'));
    $('#st-vcheck').disabled = true;
    $('#st-verbpad').classList.remove('hidden');
  } else if (ST.mode === 'rection') {
    const pats = rectionFor(w);
    ST.pat = pats[(getState(w.id) ? getState(w.id).r : 0) % pats.length];
    ST.prep = null;
    $('#st-prompt').innerHTML = rectionPrompt(w, ST.pat);
    $('#st-answer').innerHTML = esc(rectionAnswer(ST.pat));
    $('#st-hint').textContent = 'Which preposition?';
    if (ST.pat.ex) $('#st-gram').innerHTML = '<b>' + esc(ST.pat.ex) + '</b>';
    $('#st-preps').innerHTML = prepChoices(ST.pat, w.id)
      .map(p => `<button class="gbtn pbtn" data-prep="${esc(p)}">${esc(p)}</button>`).join('');
    $('#st-prepad').classList.remove('hidden');
  } else {
    $('#st-prompt').innerHTML = ST.mode === 'de2en'
      ? esc(display(w))
      : esc(w.en) + '<small>' + esc(posLabel(w.pos)) + '</small>';
    $('#st-answer').innerHTML = ST.mode === 'de2en' ? esc(w.en) : esc(display(w));
    $('#st-hint').textContent = 'Tap to reveal';
    $('#st-pad').classList.remove('hidden');
  }

  $('#st-count').textContent = `${ST.i + 1} / ${ST.queue.length}`;
  $('#st-meter').style.width = (ST.i / ST.queue.length * 100) + '%';
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
  ST.queue.push(w);
}

function commitAnswer(w, grade, elapsed) {
  let st = getState(w.id);
  const wasNew = !st || st.s === 'queued' || st.s === 'new';
  if (!st) st = newState();
  pushTime(ST.mode, elapsed);
  st.t = Math.round(elapsed);
  st.m[ST.mode] = (st.m[ST.mode] || 0) + 1;
  applyGrade(st, grade, Date.now());
  setState(w.id, st);
  requeueIfSoon(w, st);
  logAnswer(wasNew, grade);
  ST.done++;
  ST.i++;
}

$$('[data-grade]').forEach(b => b.addEventListener('click', () => {
  const w = ST.queue[ST.i];
  if (!w || !ST.revealed) return;
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
}

function submitTyped() {
  const w = ST.queue[ST.i];
  if (!w || ST.revealed || ST.mode !== 'type') return;
  const inp = $('#st-input');
  const raw = inp.value;
  if (!raw.trim()) return;
  ST.revealed = true;
  ST.elapsed = performance.now() - ST.t0;
  inp.disabled = true;
  $('#st-typepad').classList.add('hidden');

  const res = checkTyped(w, raw);
  let grade;
  if (!res.ok) {
    grade = G.AGAIN;
    // showing what was typed next to the answer is the whole lesson — without
    // it you cannot see which part you got wrong
    showResult(false, 'Not quite',
      'You wrote <s>' + esc(raw.trim()) + '</s><br>Answer: <i>' +
      esc(res.expected) + '</i>');
  } else if (res.near) {
    grade = G.HARD;
    showResult(true, 'Almost',
      'You wrote <s>' + esc(raw.trim()) + '</s><br>Spelling: <i>' +
      esc(res.expected) + '</i>');
  } else {
    // the card face already shows the word — the banner would only repeat it
    grade = adjustGrade(G.GOOD, ST.elapsed, ST.mode);
    showResult(true, 'Correct', '');
  }
  commitAnswer(w, grade, ST.elapsed);
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
  showResult(ok, ok ? 'Correct' : 'Not quite',
    ok ? '' : 'You chose <s>' + esc(picked) + '</s><br>Answer: <i>' +
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
  $('#st-verbpad').classList.add('hidden');

  const res = checkVerbForms(w, prt, pp, ST.aux);
  const yours = [prt.trim(), pp.trim(), ST.aux].join(' · ');
  let grade;
  if (!res.ok) {
    grade = G.AGAIN;
    showResult(false, 'Not quite',
      'You wrote <s>' + esc(yours) + '</s><br>Answer: <i>' +
      esc(verbFormsLine(w)) + '</i>');
  } else if (res.near) {
    grade = G.HARD;
    showResult(true, 'Almost',
      'You wrote <s>' + esc(yours) + '</s><br>Spelling: <i>' +
      esc(verbFormsLine(w)) + '</i>');
  } else {
    grade = adjustGrade(G.GOOD, ST.elapsed, ST.mode);
    showResult(true, 'Correct', '');
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
    showResult(false, 'Not quite',
      'You chose <s>' + esc(ST.prep) + '</s><br>Answer: <i>' +
      esc(rectionAnswer(ST.pat)) + '</i>');
  } else if (res.near) {
    grade = G.HARD;
    showResult(true, 'Almost',
      'Right preposition, wrong case<br>Answer: <i>' +
      esc(rectionAnswer(ST.pat)) + '</i>');
  } else {
    grade = adjustGrade(G.GOOD, ST.elapsed, ST.mode);
    showResult(true, 'Correct', '<i>' + esc(rectionAnswer(ST.pat)) + '</i>');
  }
  commitAnswer(w, grade, ST.elapsed);
  $('#st-result').classList.remove('hidden');
}
$('#st-preps').addEventListener('click', e => {
  const b = e.target.closest('[data-prep]');
  if (!b || ST.revealed || ST.mode !== 'rection' || ST.prep) return;
  ST.prep = b.dataset.prep;
  const needsCase = ST.pat.kase === 'Dativ' || ST.pat.kase === 'Akkusativ';
  // only ask for the case once the preposition is right — a wrong preposition
  // makes the case question meaningless
  if (ST.prep === ST.pat.prep && needsCase) {
    $('#st-prepad').classList.add('hidden');
    $('#st-hint').textContent = 'Which case does it take?';
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
  }).join('') || '<div class="empty">No words match that</div>';
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
    toast('Back in the queue — tap again to mark it known');
  } else {
    const n = newState(); n.s = 'known'; setState(id, n);
    toast('Marked as known — tap again to undo');
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

  const ret = retention(30);
  const left = remainingToLearn();
  const proj = projectedDays();
  const dte = daysToExam();
  const fmt = ms => new Date(ms).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short', year: 'numeric' });
  const projLabel = proj == null ? 'noch keine Daten' : fmt(Date.now() + proj * CFG.DAY);
  const projColor = proj == null ? 'var(--dim)'
    : (proj <= dte ? 'var(--green)' : 'var(--gold)');
  const examLabel = fmt(new Date(A.set.exam + 'T09:00:00').getTime());

  $('#stats-body').innerHTML = `
    <h2>Where your words are</h2>
    <div class="card">
      <div class="stat"><span>Known</span><b>${c.known.toLocaleString('en')}</b></div>
      <div class="stat"><span>In review</span><b>${c.review.toLocaleString('en')}</b></div>
      <div class="stat"><span>Learning</span><b>${c.learning.toLocaleString('en')}</b></div>
      <div class="stat"><span>Sorted, waiting</span><b>${c.queued.toLocaleString('en')}</b></div>
      <div class="stat"><span>Not sorted yet</span><b>${c.new.toLocaleString('en')}</b></div>
      <div class="stat"><span>Difficult</span><b>${c.leech.toLocaleString('en')}</b></div>
    </div>
    <h2>By exercise</h2>
    <div class="card">
      ${Object.keys(MODE_LABEL).map(k =>
        `<div class="stat"><span>${MODE_LABEL[k]}</span>
          <b>${modeReps[k].toLocaleString('en')}<i> · ${secs(k)}</i></b></div>`).join('')}
    </div>
    <h2>Will you make it</h2>
    <div class="card">
      <div class="stat"><span>Answers you got right (30 days)</span><b>${
        ret == null ? '–' : Math.round(ret * 100) + '%'}</b></div>
      <div class="stat"><span>Words left to learn</span><b>${left.toLocaleString('en')}</b></div>
      <div class="stat"><span>Finished by</span><b style="color:${projColor}">${projLabel}</b></div>
      <div class="stat"><span>Exam</span><b>${examLabel}</b></div>
    </div>
    ${leeches.length ? `<h2>Words that keep beating you</h2>
      <p class="sub" style="margin:0 0 6px">Wrong eight times, so they are paused.
      Tap one to start it over from the beginning.</p>
      <div class="card">${leeches.slice(0, 40).map(w => {
        const lv = w.level.replace('*', '');
        return `<div class="wrow" data-leech="${w.id}">
          <span class="pill p-${lv}">${lv}</span>
          <div><b>${esc(display(w))}</b><span>${esc(w.en)}</span></div>
          <span style="color:var(--blue-lt);font-size:13px">restart</span>
        </div>`;
      }).join('')}</div>
      <button class="btn ghost sm" id="leech-all" style="margin-top:10px">
        Restart all ${leeches.length}</button>` : ''}`;
}

$('#stats-body').addEventListener('click', e => {
  if (e.target.closest('#leech-all')) {
    const n = rehabAllLeeches();
    toast(n + (n === 1 ? ' word is back in the queue' : ' words are back in the queue'));
    renderStats();
    return;
  }
  const row = e.target.closest('[data-leech]');
  if (!row) return;
  const id = +row.dataset.leech;
  if (rehabLeech(id)) toast(display(A.words[id]) + ' — starting over');
  renderStats();
});

/* ============================ settings ============================ */
function renderSettings() {
  $('#installcard').innerHTML = isStandalone()
    ? `<div class="note ok"><b>✓ Installed as an app</b>
         <p class="sub" style="margin:0">Your progress is safe from Safari's
         7-day data purge.</p></div>`
    : installBanner();

  $('#set-exam').value = A.set.exam;
  $('#set-new').value = A.set.newPerDay;
  $('#set-max').value = A.set.maxReviews;

  const counts = {};
  for (const w of A.words) {
    const lv = w.level.replace('*', '');
    const k = lv === 'B2' ? tierOf(w) : lv;
    counts[k] = (counts[k] || 0) + 1;
  }
  $('#scope').innerHTML = Object.keys(A.set.scope).map(k =>
    `<label class="check"><input type="checkbox" data-scope="${k}"
       ${A.set.scope[k] ? 'checked' : ''}><span>${k}</span>
     <b style="color:var(--dim);font-weight:700">${(counts[k] || 0).toLocaleString('en')}</b></label>`
  ).join('');
  $('#ver').textContent = `${A.words.length.toLocaleString('en')} words · data v1`;
}
$('#set-exam').addEventListener('change', e => { A.set.exam = e.target.value; saveSettings(); });
$('#set-new').addEventListener('change', e => { A.set.newPerDay = +e.target.value || 0; saveSettings(); });
$('#set-max').addEventListener('change', e => { A.set.maxReviews = +e.target.value || 250; saveSettings(); });
$('#scope').addEventListener('change', e => {
  const k = e.target.dataset.scope;
  if (!k) return;
  A.set.scope[k] = e.target.checked; saveSettings(); toast('Scope updated');
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
  toast('Backup saved to your downloads');
});
$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'wortmeister') throw new Error('that is not a Wortmeister backup');
    A.set = Object.assign({}, CFG.defaults, d.settings || {});
    A.state = new Map(d.state || []);
    A.dirty.clear();
    await DB.clear('state');
    await DB.putMany('state', Array.from(A.state.entries()));
    await saveSettings();
    toast(`Restored ${A.state.size.toLocaleString('en')} words`);
    go('home');
  } catch (err) { toast("Couldn't restore — " + err.message); }
  e.target.value = '';
});
$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('Delete all your progress? This cannot be undone. ' +
    'Back up first if you are not sure.')) return;
  await DB.clear('state');
  A.state = new Map();
  A.dirty.clear();
  A.set = JSON.parse(JSON.stringify(CFG.defaults));
  await saveSettings();
  toast('Everything reset'); go('home');
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
    $('#splashmsg').textContent = 'Loading vocabulary…';
    await loadVocab();
    A.state = await DB.all('state');
    buildNav();
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    go('home');
    $('#splash').remove();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  } catch (e) {
    $('#splash').innerHTML =
      `<div style="padding:24px;text-align:center;color:var(--red)">
         <b>Couldn't load the app</b><br><span class="sub">${esc(e.message)}</span>
         <br><br><span class="sub">Check your connection and reload.</span></div>`;
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
  overview, nextAction, renderCounters, MODE_LABEL,
  today, pickMode, foldGerman, levenshtein, typeTarget, checkTyped,
  isDrillableNoun, recentPace, paceSeries,
  hasVerbForms, auxFor, rectionFor, matchForm, matchVerbForm, vowelSwap,
  checkVerbForms, checkRection,
  prepChoices, verbFormsLine, blankExample, rectionAnswer, grammar,
  retention, projectedDays, rehabLeech, rehabAllLeeches, renderStats, logAnswer
};
