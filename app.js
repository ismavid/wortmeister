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
const MODE_LABEL = {
  de2en: 'DE → EN', en2de: 'EN → DE', type: 'Schreiben', article: 'Artikel'
};

/* ============================ tiny DOM ============================ */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
    const pp = [w.prt, (w.aux ? w.aux + ' ' : '') + w.pp].filter(x => x && x.trim());
    if (pp.length) bits.push('<b>' + esc(w.lemma + ', ' + pp.join(', ')) + '</b>');
    if (w.sep) bits.push('trennbar · 3. Pers. <b>' + esc(w.p3) + '</b>');
    if (w.rection) bits.push('<b>' + esc(w.rection) + '</b>');
  } else if (w.pos === 'noun' && w.plural) {
    bits.push('Plural: <b>' + esc(w.plural) + '</b>');
  }
  return bits.join('<br>');
}
function isDrillableNoun(w) {
  return w.pos === 'noun' && ['der', 'die', 'das'].includes(w.article);
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
    if (copy.s === 'leech') return 'pausiert';
    if (ms < CFG.DAY) return Math.max(1, Math.round(ms / CFG.MIN)) + ' Min';
    const d = Math.round(ms / CFG.DAY);
    return d >= 30 ? (d / 30).toFixed(1).replace('.0', '') + ' Mon' : d + ' T';
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
 * Nouns interleave the article drill from rep 2, taking every third slot, so
 * gender gets its own repetitions without displacing the progression.
 */
function pickMode(w) {
  const st = getState(w.id);
  const reps = st ? st.r : 0;
  if (isDrillableNoun(w) && reps >= 2 && reps % 3 === 2) return 'article';
  if (reps < 2) return 'de2en';
  if (reps < 5) return 'en2de';
  return 'type';
}

/* ============================ history / streak ============================ */
function logAnswer(isNew) {
  const d = today();
  const h = A.set.history[d] || (A.set.history[d] = { new: 0, rev: 0 });
  if (isNew) h.new++; else h.rev++;
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
const NAV = [
  ['home', '◎', 'Start'], ['study', '▤', 'Lernen'],
  ['browse', '☰', 'Wörter'], ['stats', '◔', 'Statistik'], ['settings', '⚙', 'Mehr']
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
function renderHome() {
  const scoped = A.words.filter(inScope);
  let known = 0, learning = 0, triaged = 0;
  for (const w of scoped) {
    const st = A.state.get(w.id);
    if (!st) continue;
    triaged++;
    if (st.s === 'known' || (st.s === 'review' && st.i >= 21)) known++;
    else if (st.s !== 'queued') learning++;
  }
  const pct = scoped.length ? known / scoped.length : 0;
  $('#ringfill').setAttribute('stroke-dasharray', `${(pct * CIRC).toFixed(1)} ${CIRC}`);
  $('#ringpct').textContent = Math.round(pct * 100) + '%';
  $('#ringsub').textContent = `${known.toLocaleString('de')} von ${scoped.length.toLocaleString('de')} Wörtern`;

  const dte = daysToExam();
  $('#countdown').textContent = dte + ' Tage bis zur Prüfung';

  const remaining = remainingToLearn();
  const need = Math.ceil(remaining / dte);
  const due = dueList(Date.now()).length;
  const untr = scoped.length - triaged;
  const doneToday = (A.set.history[today()] || {}).new || 0;
  const newLeft = Math.max(0, autoNewTarget(remaining) - doneToday);
  $('#s-due').textContent = Math.min(due, A.set.maxReviews);
  $('#s-new').textContent = newLeft;
  $('#s-triage').textContent = untr.toLocaleString('de');
  $('#s-streak').textContent = (A.set.streak || 0) + ' Tage';

  $('#s-need').textContent = need + ' Wörter';
  const avg = recentPace(7);
  $('#s-actual').textContent = avg + ' Wörter';
  const tr = $('#s-track');
  if (!triaged) { tr.textContent = 'Sichten zuerst'; tr.style.color = 'var(--gold)'; }
  else if (avg >= need) { tr.textContent = 'Im Plan'; tr.style.color = 'var(--green)'; }
  else { tr.textContent = 'Im Rückstand'; tr.style.color = 'var(--gold)'; }
  renderPace(need);

  // primary action
  const todo = $('#todo');
  const bits = [];
  if (!isStandalone()) bits.push(installBanner());
  if (untr > 0) {
    bits.push(`<button class="btn" data-go="triage" style="margin-bottom:10px">
      Sichten — ${untr.toLocaleString('de')} übrig</button>`);
  }
  bits.push(`<button class="btn ${untr > 0 ? 'ghost' : ''}" data-go="study"
      ${(due + newLeft) === 0 ? 'disabled' : ''}>
      ${(due + newLeft) === 0 ? 'Heute alles erledigt ✓'
      : `Lernen — ${Math.min(due, A.set.maxReviews) + newLeft} Karten`}</button>`);
  todo.innerHTML = bits.join('');
}

/** Seven days of new words against the required daily pace. */
function renderPace(need) {
  const series = paceSeries(7);
  const top = Math.max(need, ...series.map(d => d.n), 1);
  const DOW = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const bars = series.map(d =>
    `<div><i class="${d.n >= need && d.n > 0 ? 'hit' : ''}"
        style="height:${Math.max(3, d.n / top * 100)}%" title="${d.key}: ${d.n}"></i></div>`
  ).join('');
  const labels = series.map(d =>
    `<span>${DOW[new Date(d.key + 'T00:00:00').getDay()]}</span>`).join('');
  $('#pace').innerHTML = `
    <div class="goal"><i style="top:${(1 - need / top) * 88}px"></i></div>
    <div class="chart">${bars}</div>
    <div class="chartx">${labels}</div>`;
}

function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}
function installBanner() {
  return `<div class="card" style="border-color:var(--gold)">
    <b style="display:block;margin-bottom:6px">Zum Home-Bildschirm hinzufügen</b>
    <p class="sub" style="margin:0">Safari löscht alle Daten dieser Seite nach 7 Tagen.
    Als App auf dem Home-Bildschirm bleibt dein Fortschritt erhalten.<br><br>
    Teilen-Symbol <b>⎋</b> → „Zum Home-Bildschirm“.</p></div>`;
}

/* ============================ triage ============================ */
const TG = { list: [], i: 0, undo: [] };
function startTriage() {
  TG.list = untriaged(); TG.i = 0; TG.undo = [];
  nextTriage();
}
function nextTriage() {
  if (TG.i >= TG.list.length) {
    $('#tg-word').innerHTML = '<span style="font-size:22px;color:var(--green)">Fertig ✓</span>';
    $('#tg-count').textContent = '';
    $('#tg-meter').style.width = '100%';
    setTimeout(() => go('home'), 900);
    return;
  }
  const w = TG.list[TG.i];
  $('#tg-word').textContent = display(w);
  const lv = w.level.replace('*', '');
  $('#tg-lvl').textContent = lv;
  $('#tg-lvl').className = 'pill p-' + lv;
  $('#tg-fach').textContent = w.fach ? 'Fachdeutsch' : '';
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
  elapsed: 0, again: new Map()
};
const AUTO_MODES = { type: true, article: true };

function startStudy() {
  ST.queue = buildSession(); ST.i = 0; ST.done = 0; ST.again = new Map();
  if (!ST.queue.length) {
    $('#st-prompt').innerHTML = '<span style="font-size:20px;color:var(--green)">Heute alles erledigt ✓</span>';
    $('#st-hint').textContent = '';
    hidePads();
    $('#st-count').textContent = '';
    return;
  }
  showCard();
}
function hidePads() {
  ['#st-pad', '#st-grades', '#st-typepad', '#st-artpad', '#st-result']
    .forEach(s => $(s).classList.add('hidden'));
}
function showCard() {
  if (ST.i >= ST.queue.length) {
    $('#st-prompt').innerHTML =
      `<span style="font-size:20px;color:var(--green)">Sitzung fertig ✓</span>`;
    $('#st-answer').classList.add('hidden');
    $('#st-gram').classList.add('hidden');
    $('#st-hint').textContent = ST.done + ' Karten wiederholt';
    hidePads();
    $('#st-meter').style.width = '100%';
    flush();
    renderHome();
    return;
  }
  const w = ST.queue[ST.i];
  ST.mode = pickMode(w);
  ST.revealed = false;
  ST.t0 = performance.now();

  const lv = w.level.replace('*', '');
  $('#st-lvl').textContent = lv;
  $('#st-lvl').className = 'pill p-' + lv;
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
      ? 'Mit Artikel schreiben' : 'Schreib das deutsche Wort';
    const inp = $('#st-input');
    inp.value = ''; inp.disabled = false;
    $('#st-check').disabled = true;
    $('#st-typepad').classList.remove('hidden');
    inp.focus();
  } else if (ST.mode === 'article') {
    $('#st-prompt').innerHTML = esc(w.lemma) + '<small class="gloss">' + esc(w.en) + '</small>';
    $('#st-answer').innerHTML = esc(display(w));
    $('#st-hint').textContent = 'Welcher Artikel?';
    $('#st-artpad').classList.remove('hidden');
  } else {
    $('#st-prompt').innerHTML = ST.mode === 'de2en'
      ? esc(display(w))
      : esc(w.en) + '<small>' + esc(posLabel(w.pos)) + '</small>';
    $('#st-answer').innerHTML = ST.mode === 'de2en' ? esc(w.en) : esc(display(w));
    $('#st-hint').textContent = 'Tippen zum Aufdecken';
    $('#st-pad').classList.remove('hidden');
  }

  $('#st-count').textContent = `${ST.i + 1} / ${ST.queue.length}`;
  $('#st-meter').style.width = (ST.i / ST.queue.length * 100) + '%';
}
function posLabel(p) {
  return ({ noun: 'Nomen', verb: 'Verb', adj: 'Adjektiv', adv: 'Adverb', conj: 'Konjunktion',
    prep: 'Präposition', pron: 'Pronomen', num: 'Numerale', det: 'Artikelwort',
    particle: 'Partikel', intj: 'Interjektion', prefix: 'Präfix' })[p] || p;
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
  logAnswer(wasNew);
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
    logAnswer(wasNew);
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
    showResult(false, 'Nicht ganz',
      'Richtig: <i>' + esc(res.expected) + '</i>');
  } else if (res.near) {
    grade = G.HARD;
    showResult(true, 'Fast richtig',
      'Schreibweise: <i>' + esc(res.expected) + '</i>');
  } else {
    grade = adjustGrade(G.GOOD, ST.elapsed, ST.mode);
    showResult(true, 'Richtig', esc(res.expected));
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
  showResult(ok, ok ? 'Richtig' : 'Nicht ganz',
    '<i>' + esc(w.article + ' ' + w.lemma) + '</i>');
  commitAnswer(w, grade, ST.elapsed);
  $('#st-result').classList.remove('hidden');
}

$('#st-input').addEventListener('input', e => {
  $('#st-check').disabled = !e.target.value.trim();
});
$('#st-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); submitTyped(); }
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
  }).join('') || '<div class="empty">Nichts gefunden</div>';
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
    toast(display(w) + ' — zurück in die Warteschlange');
  } else {
    const n = newState(); n.s = 'known'; setState(id, n);
    toast(display(w) + ' — als gekonnt markiert');
  }
  renderBrowse();
});

/* ============================ stats ============================ */
function renderStats() {
  const scoped = A.words.filter(inScope);
  const c = { new: 0, queued: 0, learning: 0, review: 0, known: 0, leech: 0 };
  const modeReps = { de2en: 0, en2de: 0, type: 0, article: 0 };
  for (const w of scoped) {
    const st = A.state.get(w.id);
    if (!st) { c.new++; continue; }
    if (st.s === 'relearning') c.learning++;
    else if (c[st.s] !== undefined) c[st.s]++;
    for (const k in modeReps) if (st.m && st.m[k]) modeReps[k] += st.m[k];
  }
  const days = Object.keys(A.set.history).sort().slice(-14);
  const maxv = Math.max(1, ...days.map(d => A.set.history[d].new + A.set.history[d].rev));
  const bars = days.map(d => {
    const h = A.set.history[d], v = h.new + h.rev;
    return `<div><i style="height:${(v / maxv * 100).toFixed(0)}%" title="${d}: ${v}"></i></div>`;
  }).join('');
  const leeches = [];
  for (const [id, st] of A.state) if (st.s === 'leech') leeches.push(A.words[id]);

  const secs = m => (medianFor(m) / 1000).toFixed(1) + ' s';

  $('#stats-body').innerHTML = `
    <h2>Wortstatus</h2>
    <div class="card">
      <div class="stat"><span>Gekonnt</span><b>${c.known.toLocaleString('de')}</b></div>
      <div class="stat"><span>Im Review</span><b>${c.review.toLocaleString('de')}</b></div>
      <div class="stat"><span>Am Lernen</span><b>${c.learning.toLocaleString('de')}</b></div>
      <div class="stat"><span>Gesichtet, wartet</span><b>${c.queued.toLocaleString('de')}</b></div>
      <div class="stat"><span>Ungesichtet</span><b>${c.new.toLocaleString('de')}</b></div>
      <div class="stat"><span>Schwierig (Leech)</span><b>${c.leech.toLocaleString('de')}</b></div>
    </div>
    <h2>Karten pro Tag (14 Tage)</h2>
    <div class="card"><div class="chart act">${bars ||
      '<span class="sub">Noch keine Daten</span>'}</div></div>
    <h2>Übungen nach Art</h2>
    <div class="card">
      <div class="stat"><span>Karte DE → EN</span><b>${modeReps.de2en.toLocaleString('de')}</b></div>
      <div class="stat"><span>Karte EN → DE</span><b>${modeReps.en2de.toLocaleString('de')}</b></div>
      <div class="stat"><span>Geschrieben</span><b>${modeReps.type.toLocaleString('de')}</b></div>
      <div class="stat"><span>Artikel</span><b>${modeReps.article.toLocaleString('de')}</b></div>
    </div>
    <h2>Reaktionszeit</h2>
    <div class="card">
      <div class="stat"><span>Median DE → EN</span><b>${secs('de2en')}</b></div>
      <div class="stat"><span>Median EN → DE</span><b>${secs('en2de')}</b></div>
      <div class="stat"><span>Median Schreiben</span><b>${secs('type')}</b></div>
      <div class="stat"><span>Median Artikel</span><b>${secs('article')}</b></div>
    </div>
    ${leeches.length ? `<h2>Schwierige Wörter</h2><div class="card">${leeches.slice(0, 40)
      .map(w => `<div class="stat"><span>${esc(display(w))}</span><b style="font-weight:600;font-size:13px;color:var(--dim)">${esc(w.en)}</b></div>`)
      .join('')}</div>` : ''}`;
}

/* ============================ settings ============================ */
function renderSettings() {
  $('#installcard').innerHTML = isStandalone()
    ? `<div class="card" style="border-color:var(--green)">
         <b style="color:var(--green)">✓ Als App installiert</b>
         <p class="sub" style="margin:6px 0 0">Deine Daten sind vor Safaris
         7-Tage-Löschung geschützt.</p></div>`
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
     <b style="color:var(--dim);font-weight:700">${(counts[k] || 0).toLocaleString('de')}</b></label>`
  ).join('');
  $('#ver').textContent = `${A.words.length.toLocaleString('de')} Wörter · Daten v1`;
}
$('#set-exam').addEventListener('change', e => { A.set.exam = e.target.value; saveSettings(); });
$('#set-new').addEventListener('change', e => { A.set.newPerDay = +e.target.value || 0; saveSettings(); });
$('#set-max').addEventListener('change', e => { A.set.maxReviews = +e.target.value || 250; saveSettings(); });
$('#scope').addEventListener('change', e => {
  const k = e.target.dataset.scope;
  if (!k) return;
  A.set.scope[k] = e.target.checked; saveSettings(); toast('Umfang aktualisiert');
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
  toast('Sicherung erstellt');
});
$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'wortmeister') throw new Error('Falsches Format');
    A.set = Object.assign({}, CFG.defaults, d.settings || {});
    A.state = new Map(d.state || []);
    A.dirty.clear();
    await DB.clear('state');
    await DB.putMany('state', Array.from(A.state.entries()));
    await saveSettings();
    toast(`${A.state.size} Wörter wiederhergestellt`);
    go('home');
  } catch (err) { toast('Fehler: ' + err.message); }
  e.target.value = '';
});
$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('Wirklich allen Fortschritt löschen? Das kann nicht rückgängig gemacht werden.')) return;
  await DB.clear('state');
  A.state = new Map();
  A.dirty.clear();
  A.set = JSON.parse(JSON.stringify(CFG.defaults));
  await saveSettings();
  toast('Zurückgesetzt'); go('home');
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
    $('#splashmsg').textContent = 'Wortschatz laden…';
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
         <b>Fehler beim Laden</b><br><span class="sub">${esc(e.message)}</span></div>`;
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
  today, pickMode, foldGerman, levenshtein, typeTarget, checkTyped,
  isDrillableNoun, recentPace, paceSeries
};
