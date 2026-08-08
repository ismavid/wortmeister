# Wortmeister — project instructions

German A1–B2 vocabulary trainer. Static PWA on GitHub Pages, mobile-first,
built for **Ismael's Goethe-Zertifikat B2 on 11 November 2026**.

Read `docs/PLAN.md` for the full design rationale before making architectural
changes. Phases 1 and 2 are shipped; Phase 3 is specified below.

---

## Hard constraints — do not violate these

1. **No framework, no bundler, no npm at runtime.** Vanilla JS, inline CSS,
   plain `<script src>`. The whole point is that `git push` deploys it.
   `npm` is used only for the test harness in `test/`.
2. **No `position: fixed` traps, no external fonts, no CDN dependencies.**
   The app must work fully offline after first load.
3. **Word `id` is permanent.** Review state keys on it. If you regenerate
   `data/vocab.vN.json`, ids must stay stable for existing words or every
   user's progress silently corrupts. Bump the filename (`vocab.v2.json`),
   never overwrite v1 in place.
4. **Safari deletes all script-writable storage after 7 days** for sites not
   installed to the Home Screen. Never move state to `localStorage` alone,
   never remove the install prompt, never remove backup/restore.
5. **UI language is German**, target register B1→B2. Ismael is studying — the
   interface is part of the practice. Code comments and docs stay in English.
6. **Dark theme, mobile-first.** Minimum tap target 48px. Controls live in the
   thumb-reachable bottom third. Test at 375px wide.
7. **Never write a review record for a deleted word.** `flush()` skips ids
   missing from `A.state`; `A.dirty.delete(id)` on removal. This has already
   caused one bug.
8. **Days are local, never UTC.** Use `today(ms)`, never
   `toISOString().slice(0,10)`. Ismael is at UTC−5 and studies in the evening,
   so a UTC day boundary lands at 19:00 local — mid-session. That broke the
   streak across a morning/evening pair and reset the new-word counter
   partway through an evening. The suite pins `TZ=America/Bogota` so a
   regression fails instead of passing on a UTC runner.
9. **Settings writes are debounced.** `A.set` carries the medians and the full
   history map. Per-answer bookkeeping calls `queueSettings()`; only explicit
   edits call `saveSettings()` directly.

---

## Layout

```
index.html              app shell + ALL css (no separate stylesheet)
app.js                  all logic, ~950 lines, sectioned by banner comments
sw.js                   offline precache — bump CACHE when assets change
manifest.webmanifest    PWA manifest
data/vocab.v1.json      10,390 words, columnar, 1.0 MB (~247 KB gzipped)
test/test_app.js        153 assertions, jsdom + fake-indexeddb
docs/PLAN.md            design doc: pacing maths, algorithm, phases
tools/vocab-build/      Python pipeline that produced the data (optional)
```

`app.js` sections, in order: config · DOM helpers · IndexedDB · app state ·
vocabulary · scheduler · typed-answer checking · queues · history · router ·
home · triage · study · browse · stats · settings · boot.

---

## Data model

`data/vocab.v1.json` is columnar — arrays not objects, ~85% smaller. Rows are
sorted by priority rank, so **array index === `id` === rank − 1**.

```
fields: [id, lemma, en, pos, level, article, plural, prt, pp, aux,
         p3, sep, rection, priority, freqClass, fach]
```

`level` is `A1|A2|B1|B2`, with `A1*`/`A2*` meaning frequency-inferred rather
than taken from the official Goethe list. Tier is derived, not stored:
non-B2 → `core`; B2 with `freqClass <= 13` → `B2-core`; else `B2-extended`.

Review state (IndexedDB store `state`, key = word id). Only touched words get
a record — an absent record means "not yet triaged".

```js
{ s: 'new'|'queued'|'learning'|'relearning'|'review'|'known'|'leech',
  e: 2.5,    // ease
  i: 6,      // interval in days
  d: 0,      // due, epoch ms
  r: 0,      // reps
  l: 0,      // lapses
  p: -1,     // learning-step index; -1 = not yet on a step
  u: false,  // flagged uncertain at triage
  m: {},     // reps per mode
  t: 0 }     // last response time, ms
```

`known` is the terminal "never ask me again" state, set from triage or the
grade pad. Reversible from the Wörter screen. Nothing is ever deleted.

---

## Scheduler

SM-2 with two deliberate modifications. Both are load-bearing — do not
"simplify" them away.

- **Response-time grading.** A rolling median of reveal time is kept per mode
  (`A.set.medians`). `Gut` faster than 0.6× median promotes to `Einfach`;
  slower than 2.0× demotes to `Schwer`. Times cap at 60 s so a put-down phone
  doesn't poison the median.
- **Exam-aware cap.** `interval = min(interval, daysToExam())`. Nothing is
  scheduled past 11 Nov, so every learned word gets one more look first.

Learning steps `[10 min, 1 day]`, graduating at 3 days (Easy 5). Ease clamped
`[1.3, 3.0]`, deltas `−0.20 / −0.15 / — / +0.15`. Eight lapses → `leech`,
suspended and listed under Statistik. Cards due again within 20 minutes
re-enter the same session, which is what makes the 10-minute step work.

`window.__wm` exposes the scheduler for tests. Keep it exported.

---

## Tests — run these before claiming anything works

```bash
cd test && npm install && node test_app.js     # expect: 70 passed, 0 failed
```

The suite boots the real `index.html` + `app.js` in jsdom against a fake
IndexedDB and drives triage and study through actual DOM event handlers.
**Add assertions for every new mode.** Four real bugs were caught this way:
debounced-writer starvation during rapid triage, a write queued for a deleted
record, new cards skipping the 10-minute step, and `LEARN_STEPS[-1]` on a
brand-new card graded Hard.

---

## Shipped: Phase 2

1. **Type the German** (`type`). English gloss prompts, German is typed,
   auto-graded with no buttons. `checkTyped()` folds case, whitespace and
   `ae/oe/ue/ss` ↔ `ä/ö/ü/ß` on both sides, then allows Levenshtein ≤1 on
   words longer than `CFG.TYPO_MIN_LEN` — those count but grade Hard and show
   the spelling. **The article is matched exactly and never gets that slack**:
   der/die/das is the thing under test, so `die Betrieb` is wrong, not a typo.
2. **Article drill** (`article`). Bare noun, three buttons, same auto-grading.
   Applies to the 5,763 nouns that carry an article (5,772 nouns total; 3,787
   of them are in the default scope).
3. **Mode progression.** `pickMode()`: reps 0–1 `de2en`, 2–4 `en2de`, 5+
   `type`; nouns take `article` on every third rep from rep 2
   (`reps % 3 === 2`). Per-mode counts accumulate in `st.m` and surface under
   Statistik.
4. **Home pacing panel.** Seven days of new words against the required daily
   line, green where the day met it.

Both auto-graded modes route through `commitAnswer()`, the same path the flip
grade buttons use, so scheduling behaviour cannot drift between modes.

## Then: Phase 3

Verb-form drill (Präteritum + Partizip II + auxiliary from the infinitive),
Verb+Präposition fill-in-the-blank off `data.verbPrep` (149 patterns),
richer stats, leech rehabilitation flow.

---

## Style

Vanilla ES2020+. Two-space indent, semicolons, single quotes. Functions are
small and named; no clever one-liners. Comments explain *why*, never *what* —
if a line needs a "what" comment, rename the variable instead. Match the
existing section-banner structure in `app.js` rather than adding new files;
the single-file constraint is intentional.

When changing scheduling behaviour, state the expected interval sequence in
the commit message so regressions are obvious.
