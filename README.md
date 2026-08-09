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

The interface is in English; only the vocabulary itself is German.

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
| 0–1 | German → English | `der Betrieb, Betriebe` | tap to flip, then rate |
| 2–4 | English → German | `business, operation` | tap to flip, then rate |
| 5+ | Type it | `to develop` | type the German |
| from 2 | Article | `Bewerbung` | tap der / die / das |
| from 3 | Verb forms | `anfangen` | type Präteritum + Partizip II, pick the auxiliary |
| from 3 | Preposition | `sich bewerben ___ eine Stelle` | pick the preposition, then the case |

Specialist drills take every third slot rather than replacing the progression:
nouns from rep 2 (gender), verbs from rep 3 (forms, and the governed
preposition where one exists). A verb with both alternates between them.

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

---

## Tests

```bash
cd test && npm install && node test_app.js
```

274 assertions: data-file integrity, boot, triage persistence through a fake
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
