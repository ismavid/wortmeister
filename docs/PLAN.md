# Wortmeister — B2 Vocabulary Trainer

**Design plan v1** · 8 Aug 2026 · target: Goethe-Zertifikat B2, November 2026

A static, mobile-first, offline-capable web app on GitHub Pages. No backend, no
accounts, no build step. One repo, one `index.html`, one data file.

---

## 1. The constraint that shapes everything

99 days from today to a mid-November exam. The master list holds **10,390 words**.

| Set | Words | Note |
|---|---|---|
| A1–B1 (official Goethe) | 3,244 | You should mostly know these; triage will prove it |
| B2-core (freq class ≤13) | 3,791 | The real target |
| B2-extended (freq class 14) | 3,354 | Long tail, journalistic, low exam yield |

**Recommended scope: A1–B1 + B2-core = 7,035 words.** If triage clears ~65% as
already-known, that leaves **~2,460 to actually learn → ~25 new/day**.

Anki-style steady state runs 8–10 reviews per new card, so 25 new/day settles
around 200–250 reviews/day. At realistic speeds:

- 25 new × ~20 s = ~8 min
- 220 reviews × ~5 s = ~18 min
- **≈ 26 min/day**, every day, for 99 days.

Attempting all 10,390 pushes this past 45 min/day. B2-extended stays in the app
as browsable reference, not in the study queue — a switch in Settings can pull it
in if you finish early.

---

## 2. Prioritisation — what to learn first

Every word carries a `priority` score (0–100) and a `priorityRank` (1 = first).
Frequency dominates, but frequency alone is a bad study order, so five signals combine:

| Signal | Weight | Reasoning |
|---|---|---|
| DeReWo frequency class | `(16 − class) × 6` | Dominant term. Class 8 ≈ top 300 words |
| CEFR level | A1 +14, A2 +12, B1 +9, B2 +0 | A foundation gap costs more than a missing B2 synonym |
| On an official Goethe list | +8 | Guaranteed exam-relevant, not corpus-inferred |
| Part of speech | conj/pron +8, prep +7, verb +6, adv +5, adj +3, noun +0 | A verb or connector unlocks more sentences than a rare noun |
| Verb has a governed preposition | +5 | Your logged weak spot, and heavily tested |
| **Fachdeutsch** (184 words) | +6 | Chemical engineering, energy, industry, and job-application German — your actual goal |
| **Cognate penalty** | up to −10 | `Dokumentation`→documentation, `Sektor`→sector. Measured by string similarity to the English gloss. Free to read, wasteful to drill |
| Long compound noun (≥14 chars) | −4 | `Stadtverordnetenversammlung` is transparent once you know the parts |

The daily new-word queue is drawn strictly in `priorityRank` order from whatever
tier is active. You never choose what to study — the app does.

---

## 3. Storage — the Safari problem

**Safari deletes all script-writable storage (localStorage, IndexedDB, service
workers) for a site after 7 days.** This would erase months of review history.

**Apps added to the Home Screen are exempt** — they run outside Safari with their
own use counter, which daily use keeps alive. So:

1. **Onboarding screen 1 is a hard prompt to "Add to Home Screen"**, with the
   reason stated. Not a suggestion — the app nags until it detects standalone mode
   (`navigator.standalone`).
2. **IndexedDB** holds review state (bigger quota than localStorage's ~5 MB, and
   `navigator.storage.persist()` is generally granted to installed PWAs).
3. **localStorage** holds only settings — a few hundred bytes.
4. **Manual backup**: a Backup button downloads `wortmeister-YYYY-MM-DD.json`
   (~400 KB); Restore reads it back. The app reminds you weekly.

Offline works via a service worker precaching the shell + data, so you can study
on the bus with no signal.

---

## 4. Data model

### Word record (read-only, ships with the app)

Stored **columnar** — arrays, not objects — which drops repeated keys and cuts the
payload from 6.5 MB to **746 KB raw / 207 KB gzipped** (measured). GitHub Pages
serves gzip automatically. Loaded once, then cached in IndexedDB.

```
[id, lemma, display, en, pos, level, tier, article, plural,
 praeteritum, partizip2, aux, praesens3sg, separable, rection,
 priority, priorityRank, freqClass, fachdeutsch]
```

### Review state (written by the app, one row per word)

```js
{
  id: 4821,
  state: "new" | "learning" | "review" | "relearning" | "known" | "leech",
  ease: 2.5,          // SM-2 ease factor
  interval: 6,        // days
  due: 1786291200000, // epoch ms
  reps: 4,
  lapses: 1,
  lastMs: 3400,       // response time of last answer
  modes: { flip: 3, type: 1, article: 2, verb: 0 }  // reps per mode
}
```

`state: "known"` is the "never ask me again" terminal state. Reversible from the
Browse screen — nothing is ever deleted.

---

## 5. Scheduling algorithm

SM-2 with two modifications: **response-time grading** and an **exam-aware interval cap**.

### Base transitions

| Grade | Ease | Next interval |
|---|---|---|
| Again | −0.20 | → relearning, 10 min, then `max(1, interval × 0.4)` d |
| Hard | −0.15 | `interval × 1.2` |
| Good | — | `interval × ease` |
| Easy | +0.15 | `interval × ease × 1.3` |

Ease clamped to [1.3, 3.0]. Learning steps: **10 min → 1 day**, graduating at 3 days
(Easy graduates at 5).

### Response time — "how well do I know this?"

The app keeps a rolling median of time-to-reveal over the last 50 cards *per mode*
(your speed differs between flipping and typing). Times cap at 60 s so putting the
phone down doesn't poison the median.

- `t < 0.6 × median` and you pressed Good → **promoted to Easy**
- `t > 2.0 × median` and you pressed Good → **demoted to Hard**

Typing and article modes are auto-graded, no buttons:

| Outcome | Grade |
|---|---|
| Wrong | Again |
| Right, `t > 2 × median` | Hard |
| Right | Good |
| Right, `t < 0.6 × median` | Easy |

### Exam-aware cap

`interval = min(interval, daysUntilExam)`. Nothing gets scheduled past the exam, so
every word you have learned gets at least one more look before November.

### Leeches

`lapses ≥ 8` → tagged leech, pulled from the queue, surfaced in a "Schwierige
Wörter" list for manual attention. Prevents 20 impossible words eating your session.

---

## 6. Triage sprint

The mode that makes this feasible. Words appear rapid-fire in `priorityRank`
order, one per screen, no animation:

```
        der Betrieb
   ───────────────────
   ✗ Lernen   ?   ✓ Kenne ich
```

- **✓ Kenne ich** → `state: "known"`, never scheduled
- **✗ Lernen** → enters the new queue at its priority rank
- **?** → enters the new queue but flagged `uncertain`, gets one extra early review

Target ~1 s per word. A 10-minute sprint clears ~500 words. Progress bar shows
`triaged / target set`. Swipe gestures mirror the buttons (right = know, left = learn).

**Recommended first week:** triage-only, ~15 min/day, ~3,500 words/session-week.
Do not start study until the A1–B1 block is triaged, or the queue fills with words
you already know.

---

## 7. Study modes

The session interleaves modes rather than blocking them — interleaving beats
massed practice for retention, and it stops the session feeling mechanical.

| Mode | Prompt | Answer | Applies to |
|---|---|---|---|
| **Flip DE→EN** | `der Betrieb` | tap → `business, operation` + rate | all |
| **Flip EN→DE** | `business, operation` | tap → `der Betrieb, -e` + rate | all |
| **Type the German** | `to apply for` | text input, typo-tolerant | all |
| **Article drill** | `___ Betrieb` | tap der / die / das | 5,772 nouns |
| **Verb forms** | `beziehen` | type Präteritum + Partizip II, pick haben/sein | 2,087 verbs |
| **Rection** | `sich bewerben ___ eine Stelle` | pick preposition + case | 149 patterns |

**Mode progression per word.** A word does not stay on flip cards forever:

- reps 1–2 → flip DE→EN (recognition)
- reps 3–4 → flip EN→DE (recall)
- reps 5+ → type the German (production)
- nouns interleave article drill from rep 2; verbs interleave form drills from rep 3

**Typo tolerance for typing mode:** case-insensitive; `ae/oe/ue/ss` accepted for
`ä/ö/ü/ß`; Levenshtein distance ≤1 on words >5 chars counts as correct but grades
Hard and shows the correct spelling.

---

## 8. Screens

```
Home ──┬── Triage sprint
       ├── Study session ── session summary
       ├── Browse / search  (filter by level, tier, POS, state, Fachdeutsch)
       ├── Stats
       └── Settings
```

**Home** is the only screen that matters daily:

- Big circular progress ring: words mastered / target set
- `Heute: 24 neu · 187 fällig` and one large **Lernen** button
- Streak counter, days-to-exam countdown
- On-track indicator: required pace vs actual pace over the last 7 days

**Stats**: words by state, retention rate, reviews per day (last 30), average
response time trend, projected completion date vs exam date, leech list.

Design: system font stack, dark-mode default (evening study), thumb-reachable
controls in the bottom third, 44 px minimum tap targets, no external fonts or
libraries — everything inline so first paint is instant and offline is trivial.

---

## 9. Repo layout

```
german-b2/
├── index.html              # app shell + inline CSS (~15 KB)
├── app.js                  # all logic (~40 KB)
├── sw.js                   # service worker, offline precache
├── manifest.webmanifest    # PWA manifest, display: standalone
├── data/
│   └── vocab.v1.json       # columnar, 746 KB (207 KB gzipped)
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

No framework, no bundler, no npm. Push to `main`, enable Pages, open the URL on
your phone, Add to Home Screen. Deploys are a `git push`.

Versioning the data file (`vocab.v1.json`) means a vocabulary update never breaks
a cached client — the service worker fetches the new name and review state keys
on stable word `id`, which never changes.

---

## 10. Build phases

| Phase | Contents | Why this order |
|---|---|---|
| **1** | Shell, data load, IndexedDB, **triage sprint**, flip cards both directions, SM-2 + response-time grading, backup/restore, PWA manifest | Triage is the bottleneck — you can start using the app the day this lands |
| **2** | Typing mode, article drill, Home dashboard with pacing, service worker offline | Turns recognition into production |
| **3** | Verb-form drill, rection drill, Stats screen, leech handling, Browse/search | Refinement once the daily habit is running |

Phase 1 is the one that matters. Everything after is improvement on a system that
is already carrying you.

---

## 11. Open decisions

1. ~~**Exact exam date.**~~ Settled: **11 Nov 2026**, set as `CFG.defaults.exam`
   and adjustable under Einstellungen. The pacing engine and the interval cap
   both key off it. (Prose above still reads 15 Nov in places.)
2. **B2-extended in or out?** Default: out of the study queue, browsable. Reversible
   in Settings.
3. **Daily time budget.** 26 min/day is the estimate for the recommended scope. If
   your real budget is 15 min, the honest move is to cut the target set, not to
   fall behind silently — the app should then cap the queue and tell you which
   words it is dropping.
