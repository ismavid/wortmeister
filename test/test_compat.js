/* Compatibility guarantee.
   Seeds IndexedDB with a frozen snapshot of real review state, boots the real
   app, walks every screen, and proves nothing was rewritten.

   This is the test that makes "your progress is safe" enforceable rather than
   promised. It runs in its own process so it gets a clean fake IndexedDB. */

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

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/state-v1.json'), 'utf8'));

/** Write the fixture straight into IndexedDB, the way a real user's data sits. */
function seed() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open('wortmeister', 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('state')) d.createObjectStore('state');
    };
    rq.onsuccess = () => {
      const db = rq.result;
      const t = db.transaction(['kv', 'state'], 'readwrite');
      t.objectStore('kv').put(FIX.settings, 'settings');
      const s = t.objectStore('state');
      FIX.state.forEach(([id, rec]) => s.put(rec, id));
      t.oncomplete = () => { db.close(); res(); };
      t.onerror = () => rej(t.error);
    };
    rq.onerror = () => rej(rq.error);
  });
}

/** Read the whole database back out, exactly as stored. */
function dump() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open('wortmeister', 1);
    rq.onsuccess = () => {
      const db = rq.result;
      const out = { state: new Map(), settings: null };
      const t = db.transaction(['kv', 'state'], 'readonly');
      const g = t.objectStore('kv').get('settings');
      g.onsuccess = () => { out.settings = g.result; };
      const c = t.objectStore('state').openCursor();
      c.onsuccess = e => {
        const cur = e.target.result;
        if (!cur) return;
        out.state.set(cur.key, cur.value);
        cur.continue();
      };
      t.oncomplete = () => { db.close(); res(out); };
      t.onerror = () => rej(t.error);
    };
    rq.onerror = () => rej(rq.error);
  });
}

(async () => {
  console.log('\n== compatibility: existing progress survives untouched ==');
  await seed();

  const raw = fs.readFileSync(path.join(APP, 'data/vocab.v1.json'), 'utf8');
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

  for (let i = 0; i < 150 && w.document.getElementById('splash'); i++) await sleep(60);
  ok('app boots on pre-existing data', !w.document.getElementById('splash'));
  ok('no runtime errors while booting on it', errors.length === 0, errors.slice(0, 2).join(' | '));

  const M = w.__wm;
  ok('every stored record was loaded', M.A.state.size === FIX.state.length,
    M.A.state.size + ' of ' + FIX.state.length);

  // legacy shapes must read, not crash
  ok('a record with no `m` field still reads',
    (M.A.state.get(5).m || {}).de2en === undefined && M.A.state.get(5).s === 'known');
  ok('a history day with no `again` counts as zero',
    M.retention(3650) !== null && M.retention(3650) > 0, String(M.retention(3650)));
  ok('settings with no tzFixed still load', M.A.set.streak === 9, M.A.set.streak);
  ok('the stored streak is preserved', M.A.set.streak === FIX.settings.streak);
  ok('the stored exam date is preserved', M.A.set.exam === FIX.settings.exam);
  ok('stored medians survive', M.A.set.medians.de2en.length === 10);

  // walk every screen, including ones that render from state
  const click = sel => {
    const e = w.document.querySelector(sel);
    if (e) e.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    return !!e;
  };
  for (const v of ['browse', 'stats', 'settings', 'home']) {
    click('.nav button[data-go="' + v + '"]');
    await sleep(60);
  }
  ok('Stats renders against real data',
    /Where your words are/.test(w.document.getElementById('stats-body').innerHTML));
  ok('the leech in the fixture is listed',
    !!w.document.querySelector('[data-leech="120"]'));
  ok('Words renders against real data',
    w.document.querySelectorAll('#br-list .wrow').length > 0);
  ok('still no runtime errors after walking every screen',
    errors.length === 0, errors.slice(0, 2).join(' | '));

  // give any debounced writer every chance to misbehave
  await sleep(5000);
  w.dispatchEvent(new w.Event('pagehide'));
  await sleep(800);

  const after = await dump();

  ok('no record was added or removed', after.state.size === FIX.state.length,
    after.state.size + ' of ' + FIX.state.length);

  let drifted = [];
  for (const [id, before] of FIX.state) {
    const now = after.state.get(id);
    if (JSON.stringify(now) !== JSON.stringify(before)) {
      drifted.push(id + ': ' + JSON.stringify(before) + ' -> ' + JSON.stringify(now));
    }
  }
  ok('every review record is byte-identical after boot and a full walk',
    drifted.length === 0, drifted.slice(0, 2).join(' | '));

  ok('the scheduling fields of a mid-review card are untouched', (() => {
    const b = FIX.state.find(([id]) => id === 88)[1], a = after.state.get(88);
    return a.d === b.d && a.i === b.i && a.e === b.e && a.r === b.r && a.l === b.l;
  })());
  ok('a known word is still known', after.state.get(5).s === 'known');
  ok('a leech is still suspended', after.state.get(120).s === 'leech' && after.state.get(120).l === 8);
  ok('the uncertain flag survives', after.state.get(12).u === true);

  ok('stored settings were not rewritten by merely opening the app',
    JSON.stringify(after.settings) === JSON.stringify(FIX.settings),
    JSON.stringify(after.settings || {}).slice(0, 120));

  // the id contract: state keys must still resolve to the same words
  ok('word ids still resolve to the same lemmas',
    M.A.words[5] && M.A.words[120] && M.A.words[204] &&
    M.A.words[5].id === 5 && M.A.words[204].id === 204);
  ok('the vocabulary file is still v1 with stable ids',
    M.A.words.every((x, i) => x.id === i));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAILED', e && e.stack || e); process.exit(1); });
