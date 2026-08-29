# Wortmeister — project instructions

German A1–B2 vocabulary trainer. Static PWA on GitHub Pages, mobile-first,
built for **Ismael's Goethe-Zertifikat B2 on 11 November 2026**.

Read `docs/PLAN.md` for the full design rationale before making architectural
changes. Phases 1, 2 and 3 are all shipped.

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
5. **UI language is English by default, Spanish by toggle. Never German.**
   Only the vocabulary itself is German. The original rule was a German UI at
   B1→B2 so the interface doubled as practice; Ismael asked for English on
   9 Aug 2026 because an interface you have to decode gets in the way of the
   drill it wraps. Do not "restore" the German UI. Grammar terms that
   textbooks keep in German (`Präteritum`, `Partizip II`, `der/die/das`) stay
   as they are.

   Spanish was added 28 Aug 2026 (Ismael's first language). Rules:
   - Every user-facing string goes through `T(key)`. No bare literals in
     render code — the suite asserts English and Spanish have identical key
     sets, so an untranslated key fails rather than silently falling back.
   - Static shell text is marked in `index.html` with `data-i18n`,
     `data-i18n-html`, `data-i18n-ph` (placeholder), `data-i18n-al`
     (aria-label), or `data-i18n-lead`. **Use `data-i18n-lead` for any
     element whose label is a bare text node followed by children the app
     writes into** — the grade buttons hold `<small id="i0">…</small>` for
     the interval previews, and `textContent` would delete them.
   - `lang` is a settings field defaulting to `'en'`. Boot never writes
     settings, so an existing install picks up the default without its stored
     record being rewritten.
   - **Card meanings are translated too**, via `data/glosses.es.v1.json` —
     a separate file keyed by the ids already in `vocab.v1.json`, like the
     sentence bank, covering all 7,035 in-scope words. It is fetched only when
     the interface is Spanish. **The fallback is per word**: `gloss(w)` returns
     English for anything uncovered and `modeLabel(k, w)` says `Alemán →
     Inglés` for that card, so the pill never promises a translation that is
     not there. Never inline Spanish into `vocab.v1.json`.
   - Numbers and dates follow `loc()`, not a hardcoded `'en'`/`'en-GB'`.
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
10. **Bump `CACHE` in sw.js on every deploy that touches a precached asset.**
   The service worker is cache-first, so a returning user otherwise gets the
   new `index.html` with the old `app.js` — which fails in ways that look like
   random breakage. This has already burned one debugging session.
11. **`renderStats()` derives `modeReps` from `MODE_LABEL`.** Keep it that way.
   When the two lists were maintained by hand, a missing key made
   `undefined.toLocaleString()` throw and blanked the whole Stats screen.
12. **Home shows one action, the daily ring, and the week + overall bars.**
   Every other counter lives under Stats; `overview()` computes them once and
   `renderCounters()` fills them from both screens. Home previously repeated
   four of them, which is what made it feel busy. `nextAction()` picks the
   single next step — do not add a second competing button. The ring is today,
   the bar is the long arc; keep those roles distinct.
13. **Never add `env(safe-area-inset-*)` to anything laid out inside `body`.**
    `body` already pads by all four insets, so `#app`, `.view` and everything
    under them start *inside* the safe area. Referencing `env()` again from an
    element positioned against the body counts the inset twice. `.nav` did
    exactly that and floated 82px above the bottom of an iPhone 17 on a screen
    that had already been shortened by 34px; `.pad` did the same to the grade
    buttons. Only `body` itself and `position: fixed` elements — which lay out
    against the viewport, not the body — may reference the insets. The suite
    lints this.

14. **Size against height as well as width on the phone.** Every dimension
    here was originally a `vw` or a `vw`-based `clamp()`, so a screen that is
    tall rather than wide gained nothing from the extra pixels. The ring takes
    `min(64vw, calc(var(--vvh) * .29), 248px)`. **Do not raise `.word` the same
    way** — it was measured, and at 42px `der Betrieb, Betriebe` wraps to two
    lines. The study type is already at the width-optimal size.

15. **Never `var()` a custom property that `:root` does not declare.** An
   undefined var inside `linear-gradient()` invalidates the whole `background`
   declaration silently — no console error, the element just renders
   transparent. The milestone bar shipped invisible this way once (`--cyan`
   was dropped in the minimalist rewrite). The suite now lints every `var()`
   in index.html against the declared tokens.

---

## Layout

```
index.html              app shell + ALL css (no separate stylesheet)
app.js                  all logic, ~950 lines, sectioned by banner comments
sw.js                   offline precache — bump CACHE when assets change
manifest.webmanifest    PWA manifest
data/vocab.v1.json      10,390 words, columnar, 1.0 MB (~247 KB gzipped)
data/sentences.v1.json  9,240 cloze sentences (Tatoeba, CC BY 2.0 FR)
data/glosses.es.v1.json 7,035 Spanish meanings, keyed by the same ids (172 KB)
test/test_app.js        517 assertions, jsdom + fake-indexeddb
test/test_compat.js     22 assertions — progress must survive every change
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
grade pad. Reversible from the Words screen. Nothing is ever deleted.

---

## Scheduler

SM-2 with two deliberate modifications. Both are load-bearing — do not
"simplify" them away.

- **Response-time grading.** A rolling median of reveal time is kept per mode
  (`A.set.medians`). `Good` faster than 0.6× median promotes to `Easy`;
  slower than 2.0× demotes to `Hard`. Times cap at 60 s so a put-down phone
  doesn't poison the median.
- **Exam-aware cap.** `interval = min(interval, daysToExam())`. Nothing is
  scheduled past 11 Nov, so every learned word gets one more look first.

Learning steps `[10 min, 1 day]`, graduating at 3 days (Easy 5). Ease clamped
`[1.3, 3.0]`, deltas `−0.20 / −0.15 / — / +0.15`. Eight lapses → `leech`,
suspended and listed under Stats. Cards due again within 20 minutes
re-enter the same session, which is what makes the 10-minute step work.

`window.__wm` exposes the scheduler for tests. Keep it exported.

---

## Tests — run these before claiming anything works

```bash
cd test && npm install && npm test     # expect: 517 passed, then 22 passed
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
   Stats.
4. **Home pacing panel.** Seven days of new words against the required daily
   line, green where the day met it.

Both auto-graded modes route through `commitAnswer()`, the same path the flip
grade buttons use, so scheduling behaviour cannot drift between modes.

## Shipped: Phase 3

1. **Verb forms** (`verb`). Infinitive prompts; Präteritum and Partizip II are
   typed, the auxiliary is picked. 2,069 verbs carry both principal parts.
   Typo tolerance is **narrower than typing mode**: `matchVerbForm()` rejects a
   single swapped vowel, because in a verb form that vowel is the ablaut —
   `fang an` is a different form of *anfangen*, not a misspelling of `fing an`.
   Dropped letters stay forgiven.
2. **Rection** (`rection`). Pick the governed preposition from four options,
   then the case. A wrong preposition ends the card without asking for the
   case. Patterns whose case is `—` (`gelten als`) skip the case step.
3. **Leech rehabilitation.** `rehabLeech()` returns a suspended word to
   `queued` with `l = 0`, `r = 0` and ease lifted to at least 2.0, so it climbs
   the mode progression from recognition again. Tap a word under Stats, or
   rehabilitate all at once.
4. **Richer stats.** Retention over 30 days (`h.again` in the history record),
   projected completion date against the exam date, per-mode medians.

### The `aux` column is not trustworthy

A spot check of 29 unambiguous *sein*-verbs found **7 marked `haben`**
(`aufstehen`, `passieren`, `abfahren`, `rennen`, `fliegen`, `umziehen`,
`fahren`). `AUX_OVERRIDE` in app.js carries verified corrections and marks
genuinely dual verbs `'both'`, where either auxiliary is accepted. It is a
patch, not a fix — the real fix is a rebuild in `tools/vocab-build`. Do not
widen the verb drill's reach without revisiting this.

### verbPrep quirks

Rows are `[verb, preposition, case, gloss, example]`. Reflexive entries are
stored as `sich ärgern` while the word list holds the bare lemma, so
`indexRection()` strips `sich ` — that lifts linkage from 86/149 to 146/149.
Two rows carry `"D"` instead of a preposition (`sich widmen`, `zustimmen`);
those verbs take a bare dative object and are dropped. The word-level
`rection` column ships **empty on all 10,390 rows** — never read it.

## Shipped: Phase 4 (4.0–4.3 + iOS pass)

Plan: `docs/PHASE-4.md`. Governed by one rule — no change may alter stored
progress, and no backup restore may be needed.

0. **`test/test_compat.js` + `test/fixtures/state-v1.json`.** Seeds IndexedDB
   with a frozen snapshot of real state, boots, walks every screen, waits out
   the debounced writer, then proves every record is byte-identical. The
   fixture deliberately mixes generations: records with no `m`, a history day
   with no `again`, settings with no `tzFixed`. **Run this before claiming any
   change is safe.** Build features against it, not around it.
1. **Interval fuzz.** `fuzzInterval()` — tiered, not a flat percentage,
   reproducing Anki's spreads (3→2-4, 10→8-12, 15→13-17, 30→26-34). Without it
   words sorted together and graded alike resurfaced together forever.
   `CFG.FUZZ = 0` disables it for exact-interval tests. Previews are always
   un-fuzzed.
2. **Session ordering.** Due cards are selected most-overdue-first then
   shuffled with a date-seeded PRNG (so a reload does not re-deal).
   `spaceSiblings()` keeps one word family `CFG.SIBLING_GAP` apart.
3. **Daily ring.** Home shows today, not lifetime — `overview()` returns
   `answered / dayTarget`. A lifetime bar moves 0.3%/day and reinforces
   nothing. Gold tick marks `CFG.MIN_DAY`.
4. **Streak freezes.** `advanceStreak()` covers a missed day from a banked
   freeze instead of resetting. One earned per `FREEZE_EVERY` clean days,
   capped at `FREEZE_MAX`. `freezes` absent reads as 0 and behaves as before.
5. **Pairing round** (`match`). Five words, five meanings, opening the session.
   `commitAnswer()` was split into `gradeWord()` + cursor advance because a
   round settles five words at once. **`match` must stay in `AUTO_MODES`** or a
   face tap reveals the underlying card and the grade buttons hijack the round.
6. **Gender shapes** (der ▲ die ● das ■) and **word families** on reveal,
   indexed from a folded five-letter stem at load.

7. **Cloze** (`cloze`). `data/sentences.v1.json` — 9,240 Tatoeba sentences over
   4,993 words, built by `tools/vocab-build/build_sentences.js`. **A separate
   file keyed by existing ids; `vocab.v1.json` is never rewritten.** Loaded
   after first paint and entirely optional — a missing or malformed bank makes
   `pickMode` fall through to typing rather than failing. Production alternates
   type (even reps) and cloze (odd reps, when a sentence exists).

   The builder is deliberately strict, and two of its rules exist because the
   first run produced broken cards:
   - the blank comes from `matchAll` offsets, not `indexOf` — `indexOf('an')`
     blanked the "an" inside "Man"
   - a sentence is only used when the target appears **in its dictionary
     form**, or the inflected answer stands out among lemma-shaped distractors
   - plus: the target must appear exactly once, be the only word above its own
     level (i+1), and the sentence must be 4–12 words with a translation
   - **CC BY 2.0 FR requires attribution** — it is in Settings and the README.

8. **Fill it in** (`hint`). Typing with a fading scaffold, prompted by the
   English gloss. **It replaced `en2de`** at reps 2–4 and takes half the
   production slots above rep 5 (`reps % 4` is 0 or 2), because producing the
   word beats recognising it. `en2de` stays in `MODE_LABEL` so existing
   `st.m.en2de` counts still render under Stats — do not delete it.

   - `hintLevel(st)` reads `st.h`, a NEW additive field. Records written before
     this mode have no `h`, so the level is **derived** from `st.r` instead — a
     word answered eight times is not suddenly spoon-fed. Derived at read time,
     so nothing is migrated or rewritten.
   - The level rises only on a fully correct answer, holds on a near miss, and
     drops one on a miss. Failing must never buy you less help.
   - `hintMask()` never reveals the article: der/die/das are all three letters,
     so masking it shows the shape without leaking the gender that the article
     drill is separately responsible for.
   - Grading reuses `checkTyped()`, so the article is still required.

9. **Keyboard-safe layout.** iOS shrinks the *visual* viewport when the
   keyboard opens but not the layout viewport, so Safari scrolls the input into
   view and pushes the prompt off the top. `trackKeyboard()` tracks
   `visualViewport`, drives `--vvh`, and sets `body.kb`, which compacts the
   type scale and moves the question to the top. Verified at 440pt — the height
   an iPhone 17 keyboard leaves — that nothing is clipped in any typing mode.

### Not built yet

`4.5` per-word mnemonic (`st.n`) is unstarted; see `docs/PHASE-4.md`.

## Then: Phase 4 (original plan)

Nothing is specified. Candidates: pulling B2-extended into scope once the core
set is cleared, an adjective-declension drill, and a `vocab.v2.json` rebuild
that fixes the auxiliaries.

---

## Style

Vanilla ES2020+. Two-space indent, semicolons, single quotes. Functions are
small and named; no clever one-liners. Comments explain *why*, never *what* —
if a line needs a "what" comment, rename the variable instead. Match the
existing section-banner structure in `app.js` rather than adding new files;
the single-file constraint is intentional.

When changing scheduling behaviour, state the expected interval sequence in
the commit message so regressions are obvious.
