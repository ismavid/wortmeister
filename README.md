# Wortmeister

German A1–B2 vocabulary trainer. Static, mobile-first, offline-capable.
Built for **Goethe-Zertifikat B2 on 11 November 2026**.

10,390 words: A1/A2/B1 from the official Goethe Wortlisten, B2 built from the
DeReWo corpus frequency list. Every noun carries its article and plural, every
verb its Präteritum, Partizip II and auxiliary, plus 149 hand-curated
Verb + Präposition patterns.

---

## Deploy

```bash
git init && git add . && git commit -m "Wortmeister v1"
git remote add origin git@github.com:<you>/german-b2.git
git push -u origin main
```

Then **Settings → Pages → Source: `main` / root**. Open the URL on your phone.

### Add to Home Screen — not optional

Safari deletes all localStorage, IndexedDB and service-worker data for a site
after **7 days**. Apps added to the Home Screen are exempt: they run outside
Safari with their own use counter.

> Share **⎋** → **Add to Home Screen** → **Add**

Open it from that icon from then on. The app nags until it detects standalone
mode. Back up occasionally anyway (Settings → Back up).

---

## How to use it

**Week 1 — sorting only.** Words appear rapid-fire in priority order; tap
*I know it* / *Not sure* / *Learn it*, or swipe right for known, left for learn.
Target ~1 s per word. Study stays disabled until you have sorted at least some
words, because starting earlier fills the queue with words you already know.

The interface is in English or Spanish; only the vocabulary itself is German.

### Interface language

**Settings → Language** switches the whole interface between English and
Español. It is a display setting: it writes one field and redraws the screen,
and touches no review record — switch mid-session, switch back, nothing moves.

**Word meanings stay in English in both.** The vocabulary carries exactly one
gloss per word and that gloss is English, so a Spanish interface would be
lying if the cards claimed otherwise. `der Betrieb` still reads
*operation, business* on the back. Translating 10,390 glosses is a data job,
not a UI one — it would need a new file keyed by the existing ids, the same
way the sentence bank works.

**After that — daily.** Home shows one action and nothing else: Study when
cards are waiting, Sort when they are not. Every number lives under Stats, so
the screen you open most never asks you to read anything. Reviews come first,
new words are interleaved so they are spread through the session rather than
front-loaded.

At ~25 new/day the daily load settles around 25–30 minutes.

---

## Study modes

A word does not stay on flip cards. It moves from recognition to recall to
production as you answer it:

| Reps | Mode | Prompt | Answer |
|---|---|---|---|
| opening, then every 22 cards | Match | six words, six meanings | tap a word, then its meaning |
| 0–1 | German → English | `der Betrieb, Betriebe` | tap to flip, then rate |
| 2–4 | **Fill it in** | `nothing` + `nic···` | type the German, with a shrinking scaffold |
| 5+ | **Fill it in** (2 slots in 3) | `nothing` + `······` | type it with no help left |
| 5+ | Type it | `to develop` | type the German, no scaffold |
| 5+ | In a sentence | `_____ Mensch ist sterblich.` | pick the word that fits |
| every 4th from 2 | Article | `Bewerbung` | tap der / die / das |
| from 3 | Verb forms | `anfangen` | type Präteritum + Partizip II, pick the auxiliary |
| from 3 | Preposition | `sich bewerben ___ eine Stelle` | pick the preposition, then the case |

**Fill it in** replaced the old English→German flip card, and is the mode you
get most: producing the word beats recognising it. The first time you meet it
you get about half the letters, in place; the next time about a quarter; after
that a row of dots. The scaffold shrinks **only when you answer correctly**,
and grows back a step when you miss — getting it wrong should never cost you
help. Nouns still need their article, and the article is never part of the
scaffold, so gender is never given away.

Specialist drills interleave rather than replacing the progression: nouns take
the article drill every fourth rep from rep 2, verbs take forms or their
governed preposition every third from rep 3. In practice that lands at roughly
**69% Fill it in** for a plain word, 51% for a noun and 36% for a verb — it is
the mode you get most in every case.

The article slot is deliberately on a different cycle from the production
slots. On the same one it would have swallowed every typing card a noun ever
got, and you would never type a noun with its article again.

**Every mode except the flip cards grades itself** — no buttons. Wrong is
*Again*, right is *Good*, and the same response-time median that adjusts the
flip modes promotes a fast answer to *Easy* or demotes a slow one to
*Hard*.

Spelling is forgiven; grammar is not:

- case-insensitive, surrounding whitespace ignored
- `ae` `oe` `ue` `ss` accepted for `ä` `ö` `ü` `ß`, and vice versa
- one typo in a word longer than 5 characters still counts, but grades
  *Hard* and shows the correct spelling
- **nouns need their article.** `die Betrieb` is wrong, not a typo — der/die/das
  is the thing being tested, so it never gets the one-typo allowance
- **verb forms lose the allowance on the ablaut vowel.** `fang an` is not a
  misspelling of `fing an`, it is a different form. A dropped letter is still
  forgiven
- a wrong preposition ends a Preposition card immediately; the case question
  only makes sense once the preposition is right

### A caveat on the auxiliary

The `aux` column comes from the build pipeline and is wrong for a number of
verbs — a check of 29 unambiguous *sein*-verbs found 7 marked `haben`. The app
carries verified corrections and accepts either auxiliary for genuinely dual
verbs like `fahren`, but the underlying data still needs a rebuild. If a
*Verb forms* card marks you wrong on an auxiliary you are sure about, you are
probably right.

---

## How much is left

The bar under the ring is the long arc: **words learned against how many you
will actually have to learn** — which is not the whole 7,035.

The unsorted pile is projected from your own sorting. If 65% of the words you
have sorted so far turned out to be ones you already knew, roughly 65% of the
rest should be too, so those are subtracted from the target. The figure carries
a `~` until the pile is empty, and sharpens every time you sort more. Stats
shows the basis: the share you already knew, the estimated target, and how many
of them you have learned.

### Mastered, learning, and why there are two bands

Reaching a 21-day interval takes **six correct answers spaced 3, 8 and 20 days
apart** — about a month of calendar time per word. A bar that only counted
those would read zero for weeks while you were plainly getting somewhere.

So the bar has two bands. The solid one is **mastered**: studied to a 21-day
interval, or retired after studying. The lighter one is **learning**, and it is
graded rather than counted — a word on an 8-day interval is worth more than one
you answered once, so the band creeps forward on *every* review rather than
jumping once a month.

A word you simply marked as known at sort time counts towards neither. It was
never yours to learn.

### This week

The thin bar above it is the week: new words started since Monday, against the
daily pace the exam demands times seven. Days is the whole arc; the week is the
unit you can still course-correct inside.

Both re-project every time Home renders, so sorting a batch of words you turn
out to already know pulls the target down immediately.

---

## Fitting the phone

Sized for **iPhone 17 — 402 × 874 pt**, which leaves 781 pt of usable height
once the Dynamic Island and the home indicator take their cut.

Two things were wasting that height:

- **The safe-area inset was counted twice.** `body` pads by all four insets,
  so everything laid out inside it already starts within them — and `.nav` and
  `.pad` added `env(safe-area-inset-bottom)` again on top. The tab bar floated
  82 pt above the bottom of a screen that had already been shortened by 34.
  Only `body` and `position: fixed` elements may reference the insets now, and
  the suite lints it.
- **Everything was sized in `vw`.** A phone that is tall rather than wide
  gained nothing from the extra pixels. The ring now takes
  `min(64vw, calc(var(--vvh) * .29), 248px)`, so it grows on a tall screen and
  still shrinks on a short one.

Home's leftover space used to pool into one dead block above the tab bar. It
is now split above and below the content with auto margins — which, unlike
`justify-content: center`, collapse to zero when the content really does
overflow, so the top of a first-run Home stays reachable.

The study type was left alone deliberately. Driving it from height too was
measured, and at 42 px `der Betrieb, Betriebe` wraps onto two lines — it is
already at the size the *width* allows.

---

## Coming back tomorrow

The ring on Home measures **today**, not your lifetime — a lifetime bar sits at
21% and moves 0.3% a day, which reinforces nothing. It fills as you work and
turns green when the day is clear. The gold tick is the minimum day: hit that
and the day still counts, so a busy evening does not become an all-or-nothing
choice.

A missed day is covered by a **streak freeze** rather than resetting a six-week
streak to 1. You earn one per clean week, capped at two. Twelve weeks of
activity show as a heatmap under Stats.

**A card you fail comes straight back.** It is re-inserted a couple of cards
ahead, then 5, then 10, then 18 if you keep missing it — expanding retrieval,
bounded so it stays inside the same few minutes. It used to be appended to the
end of the queue, which in a 231-card session meant about 23 minutes before you
saw it again; that is not relearning.

Cards do not clump. Intervals carry Anki-style jitter, so words you sorted in
the same sprint and graded the same way stop resurfacing on the same day; the
due order within a day is shuffled; and words from one family (`bewerben` /
`Bewerbung` / `Bewerber`) are kept apart so recall cannot ride on the card you
just saw.

---

## Difficult words

Eight lapses suspend a word as a *leech* so twenty impossible words cannot eat
your session. They are listed under Stats — tap one to restart it, or
restart all of them at once. A restarted word returns to the front of the
queue at recognition with its lapse count cleared, and climbs the modes again.

---

## Scheduling

SM-2 with two modifications.

**Response time.** A rolling median of your reveal time is kept per mode.
Press *Good* faster than 0.6× your median and it is promoted to *Easy*;
slower than 2.0× and it is demoted to *Hard*. Times cap at 60 s so putting
the phone down mid-card does not poison the median.

**Exam-aware cap.** `interval = min(interval, days_until_exam)`. Nothing is
scheduled past 11 November, so every learned word gets one more look first.

| | |
|---|---|
| Learning steps | 10 min → 1 day, graduating at 3 days (Easy: 5) |
| Ease | starts 2.50, clamped to [1.30, 3.00] |
| Again / Hard / Good / Easy | ease −0.20 / −0.15 / — / +0.15 |
| Leech | 8 lapses → suspended, listed under Stats |

Cards due again within 20 minutes reappear in the same session, which is what
makes the 10-minute step do real work.

**I know this** retires a word permanently. Reversible from the Words screen —
tap any word marked ✓ to put it back in the queue. Nothing is ever deleted.

---

## Prioritisation

Words are ordered by a `priority` score, and the new-word queue is drawn
strictly in that order. Frequency dominates; four corrections adjust it:

- **Official Goethe list** +8 — guaranteed exam-relevant
- **Level** A1 +14 → B2 +0 — a foundation gap costs more than a missing synonym
- **Part of speech** connectors and verbs above rare nouns
- **Fachdeutsch** +6 — 184 chemical-engineering, energy, industry and
  job-application words
- **Cognate penalty** up to −10 — `Dokumentation` → documentation is free to
  read, so drilling it wastes a slot

### What that order actually delivers

Measured over the 7,035 in-scope words, in the order they are offered:

| Rank | Official Goethe A1–B1 | Median frequency class |
|---|---|---|
| 1–800 | 100% | 9 |
| 801–1600 | 97% | 11 |
| 1601–2400 | 85% | 12 |
| 2401–3200 | 43% | 11 |
| 4001+ | ~10% | 13 |

Official Goethe vocabulary first, frequency-ordered inside it. Seven
assertions lock this in place, because the order decides which words you
reach before 11 November and a regression there is invisible until it has
already cost weeks.

Two re-weightings were tried and **rejected on measurement**:

- **Boosting B2** (it is the exam being sat) trades `hell`, `müde`, `Bier`,
  `grau` for `hessisch`, `Fraktion`, `Bundesregierung`. DeReWo is a press
  corpus, so B2 frequency ranks journalese above everyday words the exam
  actually uses. The official-list bonus exists precisely to correct that.
- **Boosting the official list** (+8 → +20) trades `Unternehmen`,
  `bezeichnen`, `erscheinen`, `treten` for `putzen`, `Mantel`, `ausruhen`.
  Worse for B2.

The current weighting sits between those two failure modes. Demoting the
54 detectable corpus artefacts (`hessisch`, `Bundestrainer`, `Parteitag`)
moves only 4 words inside a realistic budget, which is not worth a regex.

The binding constraint is not order, it is **budget**: at 15–30 new words a
day you reach 41–75% of the official list before the exam. Nothing reorders
its way out of that.

---

## Files

```
index.html              app shell + all CSS
app.js                  all logic
sw.js                   offline precache
manifest.webmanifest    PWA manifest
data/vocab.v1.json      10,390 words, columnar (1.0 MB, ~247 KB gzipped)
icons/                  192 and 512 px
test/test_app.js        headless test suite
```

No framework, no bundler, no npm at runtime. Data is versioned
(`vocab.v1.json`), and review state keys on stable word `id`, so a vocabulary
update never invalidates progress.

`data/sentences.v1.json` (830 KB, ~313 KB gzipped) is the cloze bank: 9,240
sentences covering 4,993 of the 7,035 words in scope. It is a **separate file
keyed by the ids already in `vocab.v1.json`** — the vocabulary is never
rewritten, so no id can move. It loads after first paint, and if it is missing
the *In a sentence* mode simply does not appear.

### Sentence credits

Example sentences come from **[Tatoeba](https://tatoeba.org)**, used under
**CC BY 2.0 FR**. Rebuild with:

```bash
node tools/vocab-build/build_sentences.js <corpus-dir> .
```

---

## Tests

```bash
cd test && npm install && npm test
```

499 assertions in the main suite, plus 22 in test_compat.js: data-file integrity, boot, triage persistence through a fake
IndexedDB, the full study loop, the scheduler (learning steps, ease adjustment,
exam cap, leech detection, response-time grading), local-date handling, typo
tolerance, mode progression, leech rehabilitation, retention and projection
maths, and all four auto-graded modes driven through the real DOM handlers.

The suite pins `TZ=America/Bogota`, because the local-vs-UTC date bug it guards
against is only observable at a non-zero UTC offset.

---

## Not in this build

All three planned phases are shipped. Still open: a `vocab.v2.json` rebuild to
fix the auxiliaries, an adjective-declension drill, and pulling the 3,354
B2-extended words into the study queue once the core set is cleared (the switch
already exists under Settings → What to study).
