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

> Share **⎋** → **Zum Home-Bildschirm** → **Hinzufügen**

Open it from that icon from then on. The app nags until it detects standalone
mode. Back up occasionally anyway (Einstellungen → Sichern).

---

## How to use it

**Week 1 — triage only.** Words appear rapid-fire in priority order; tap
*Kenne ich* / *Unsicher* / *Lernen*, or swipe right for known, left for learn.
Target ~1 s per word. Do not start studying until the A1–B1 block is triaged,
or your queue fills with words you already know.

**After that — daily.** Home shows one button. Reviews come first, new words are
interleaved so they are spread through the session rather than front-loaded.

At ~25 new/day the daily load settles around 25–30 minutes.

---

## Study modes

A word does not stay on flip cards. It moves from recognition to recall to
production as you answer it:

| Reps | Mode | Prompt | Answer |
|---|---|---|---|
| 0–1 | Karte DE → EN | `der Betrieb, Betriebe` | tap to flip, then rate |
| 2–4 | Karte EN → DE | `business, operation` | tap to flip, then rate |
| 5+ | Schreiben | `to develop` | type the German |
| from 2 | Artikel | `Bewerbung` | tap der / die / das |

Nouns interleave the article drill from rep 2, taking every third slot, so
gender gets its own repetitions without stalling the progression.

**Schreiben and Artikel grade themselves** — no buttons. Wrong is *Nochmal*,
right is *Gut*, and the same response-time median that adjusts the flip modes
promotes a fast answer to *Einfach* or demotes a slow one to *Schwer*.

Typing is forgiving about spelling but not about grammar:

- case-insensitive, surrounding whitespace ignored
- `ae` `oe` `ue` `ss` accepted for `ä` `ö` `ü` `ß`, and vice versa
- one typo in a word longer than 5 characters still counts, but grades
  *Schwer* and shows the correct spelling
- **nouns need their article.** `die Betrieb` is wrong, not a typo — der/die/das
  is the thing being tested, so it never gets the one-typo allowance

---

## Scheduling

SM-2 with two modifications.

**Response time.** A rolling median of your reveal time is kept per mode.
Press *Gut* faster than 0.6× your median and it is promoted to *Einfach*;
slower than 2.0× and it is demoted to *Schwer*. Times cap at 60 s so putting
the phone down mid-card does not poison the median.

**Exam-aware cap.** `interval = min(interval, days_until_exam)`. Nothing is
scheduled past 11 November, so every learned word gets one more look first.

| | |
|---|---|
| Learning steps | 10 min → 1 day, graduating at 3 days (Einfach: 5) |
| Ease | starts 2.50, clamped to [1.30, 3.00] |
| Again / Hard / Good / Easy | ease −0.20 / −0.15 / — / +0.15 |
| Leech | 8 lapses → suspended, listed under Statistik |

Cards due again within 20 minutes reappear in the same session, which is what
makes the 10-minute step do real work.

**Kenne ich** retires a word permanently. Reversible from the Wörter screen —
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

153 assertions: data-file integrity, boot, triage persistence through a fake
IndexedDB, the full study loop, the scheduler (learning steps, ease adjustment,
exam cap, leech detection, response-time grading), local-date handling, typo
tolerance, mode progression, and both auto-graded modes driven through the real
DOM handlers.

The suite pins `TZ=America/Bogota`, because the local-vs-UTC date bug it guards
against is only observable at a non-zero UTC offset.

---

## Not in this build

Phase 3: verb-form drill (Präteritum + Partizip II + auxiliary), Verb +
Präposition fill-in-the-blank off the 149 curated patterns, richer stats,
leech rehabilitation.
