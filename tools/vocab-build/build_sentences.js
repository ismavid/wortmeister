/*
 * Builds data/sentences.v1.json — the cloze bank.
 *
 * Source: Tatoeba bulk exports (CC BY 2.0 FR, attribution required).
 *   https://downloads.tatoeba.org/exports/per_language/deu/deu_sentences.tsv.bz2
 *   https://downloads.tatoeba.org/exports/per_language/deu/deu-eng_links.tsv.bz2
 *   https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2
 *
 * Usage:  node build_sentences.js <corpus-dir> <repo-root>
 *
 * THE ID CONTRACT: this writes a NEW file keyed by the word ids already in
 * data/vocab.v1.json. It never reads, rewrites or reorders the vocabulary.
 * Word ids are what review progress is keyed on — see CLAUDE.md constraint 3.
 *
 * The filtering is deliberately strict. A cloze sentence you cannot read is
 * worse than no cloze at all, and a sentence that teaches a wrong collocation
 * is worse still. Most candidates are thrown away on purpose.
 */
const fs = require('fs');
const path = require('path');

const CORPUS = process.argv[2];
const ROOT = process.argv[3];
if (!CORPUS || !ROOT) {
  console.error('usage: node build_sentences.js <corpus-dir> <repo-root>');
  process.exit(1);
}

const MIN_WORDS = 4;
const MAX_WORDS = 12;
const MAX_PER_WORD = 2;
const LEVEL_RANK = { A1: 1, A2: 2, B1: 3, B2: 4 };

const log = (...a) => console.log(...a);

/* ---------- vocabulary (read-only) ---------- */
const vocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/vocab.v1.json'), 'utf8'));
const F = vocab.fields, ix = n => F.indexOf(n);
const words = vocab.words.map(r => {
  const o = {};
  for (let i = 0; i < F.length; i++) o[F[i]] = r[i];
  return o;
});
log('vocabulary: ' + words.length + ' words (read only, never modified)');

/* A surface form -> word id map. Only forms that identify one word are kept:
   if two words share a form we cannot tell which one the sentence is teaching. */
const formToId = new Map();
const ambiguous = new Set();
function addForm(form, id) {
  if (!form) return;
  const k = form.toLowerCase();
  if (!/^[a-zäöüß][a-zäöüß\-]*$/.test(k)) return;   // single plain word only
  if (formToId.has(k) && formToId.get(k) !== id) { ambiguous.add(k); return; }
  formToId.set(k, id);
}
for (const w of words) {
  addForm(w.lemma, w.id);
  if (w.pos === 'noun' && w.plural) addForm(w.plural, w.id);
  if (w.pos === 'verb') { addForm(w.prt, w.id); addForm(w.pp, w.id); addForm(w.p3, w.id); }
}
for (const k of ambiguous) formToId.delete(k);
log('surface forms: ' + formToId.size + ' unambiguous (' + ambiguous.size + ' dropped as ambiguous)');

const levelOf = id => LEVEL_RANK[String(words[id].level).replace('*', '')] || 4;
const inCoreScope = id => {
  const w = words[id];
  const lv = String(w.level).replace('*', '');
  return lv !== 'B2' || w.freqClass <= 13;
};

/* ---------- corpus ---------- */
function readTsv(file) { return fs.readFileSync(path.join(CORPUS, file), 'utf8').split('\n'); }

log('reading deu-eng links...');
const deuToEng = new Map();
for (const line of readTsv('links.tsv')) {
  const t = line.indexOf('\t');
  if (t < 0) continue;
  const a = line.slice(0, t), b = line.slice(t + 1).trim();
  if (!deuToEng.has(a)) deuToEng.set(a, b);
}
log('  ' + deuToEng.size + ' German sentences have an English translation');

log('reading German sentences...');
const cand = [];
for (const line of readTsv('deu.tsv')) {
  const p = line.split('\t');
  if (p.length < 3) continue;
  const id = p[0], text = p[2].trim();
  if (!deuToEng.has(id)) continue;
  const n = text.split(/\s+/).length;
  if (n < MIN_WORDS || n > MAX_WORDS) continue;
  if (!/^[A-ZÄÖÜ]/.test(text)) continue;             // proper sentence
  if (!/[.!?]$/.test(text)) continue;
  if (/["“”„(){}\[\]<>|@#*_\/\\]|\d/.test(text)) continue;  // no quotes, digits, markup
  cand.push({ id, text });
}
log('  ' + cand.length + ' candidate sentences after shape filtering');

log('reading English sentences (only the ones we need)...');
const needed = new Set();
for (const c of cand) needed.add(deuToEng.get(c.id));
const engText = new Map();
for (const line of readTsv('eng.tsv')) {
  const t1 = line.indexOf('\t');
  if (t1 < 0) continue;
  const id = line.slice(0, t1);
  if (!needed.has(id)) continue;
  const t2 = line.indexOf('\t', t1 + 1);
  engText.set(id, line.slice(t2 + 1).trim());
}
log('  ' + engText.size + ' translations resolved');

/* ---------- select ---------- */
/* A sentence is kept for word W only when W is the ONLY word in it above W's
   own level. That is the i+1 rule: everything else must already be familiar,
   or the blank is unanswerable for the wrong reason. */
const tokenRe = /[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\-]*/g;
const byWord = new Map();
let considered = 0;

for (const c of cand) {
  const en = engText.get(deuToEng.get(c.id));
  if (!en || en.length > 110) continue;

  // match WITH offsets: indexOf would find "an" inside "Man" and blank the
  // wrong three characters
  const toks = [...c.text.matchAll(tokenRe)];
  const hits = [];
  const known = [];
  for (const m of toks) {
    const id = formToId.get(m[0].toLowerCase());
    if (id === undefined) { known.push(null); continue; }
    known.push(id);
    // Only blank a word that appears in its dictionary form. Otherwise the
    // inflected answer stands out among lemma-shaped distractors and the card
    // is solvable on shape instead of meaning.
    if (m[0].toLowerCase() === String(words[id].lemma).toLowerCase()) {
      hits.push({ id, tok: m[0], at: m.index });
    }
  }
  if (!hits.length) continue;
  considered++;

  for (const h of hits) {
    if (!inCoreScope(h.id)) continue;
    const lvl = levelOf(h.id);
    // every other recognised word must be at or below the target's level, and
    // unrecognised tokens are treated as unknown, so allow only a couple
    let harder = 0, unknown = 0;
    for (let i = 0; i < known.length; i++) {
      if (known[i] === null) { unknown++; continue; }
      if (known[i] === h.id) continue;
      if (levelOf(known[i]) > lvl) harder++;
    }
    if (harder > 0) continue;
    if (unknown > 2) continue;

    const list = byWord.get(h.id) || [];
    if (list.length >= MAX_PER_WORD) continue;
    if (list.some(s => s.de === c.text)) continue;

    // the word must appear exactly once, or blanking one leaves the answer
    // visible elsewhere in the sentence
    const occurrences = known.filter(k => k === h.id).length;
    if (occurrences !== 1) continue;

    list.push({ de: c.text, at: h.at, len: h.tok.length, form: h.tok, en });
    byWord.set(h.id, list);
  }
}
log('  ' + considered + ' sentences contained at least one known word');

/* ---------- emit ---------- */
const byId = {};
let total = 0;
for (const [id, list] of byWord) {
  byId[id] = list.map(s => [s.de, s.at, s.len, s.en]);
  total += list.length;
}

const out = {
  v: 1,
  source: 'Tatoeba (tatoeba.org), CC BY 2.0 FR',
  built: new Date().toISOString().slice(0, 10),
  words: Object.keys(byId).length,
  sentences: total,
  byId
};
const dest = path.join(ROOT, 'data/sentences.v1.json');
fs.writeFileSync(dest, JSON.stringify(out));

const scoped = words.filter(w => inCoreScope(w.id)).length;
log('');
log('wrote ' + dest);
log('  words covered : ' + out.words + ' of ' + scoped + ' in scope (' +
  (out.words / scoped * 100).toFixed(1) + '%)');
log('  sentences     : ' + out.sentences);
log('  size          : ' + (fs.statSync(dest).size / 1024).toFixed(0) + ' KB');
