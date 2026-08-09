# Phase 4 — make it a daily habit

**Plan · 9 Aug 2026 · 94 days to the exam**

Goal: Ismael opens this every day without deciding to. New exercise types
(pairing, sentence choice), a genuinely mixed session, and habit mechanics —
without touching a single byte of existing progress.

---

## 0. The constraint that governs everything

> **Nothing in this phase may alter existing review progress, and no backup
> restore may be required. It must just work on the next load.**

That is achievable, and the app has already done it twice: `migrateDates()`
added a settings flag and `h.again` added a history counter, both after data
existed, both without rewriting a single record. A deploy was measured moving
32 records, 5 reviewed cards, streak and history across a changed build —
byte-identical, down to a card's exact due timestamp.

### The compatibility contract

Every change in this phase obeys all six rules:

1. **Word ids never move.** `data/vocab.v1.json` is frozen. New data ships as a
   *new file* keyed by existing id (`sentences.v1.json`), never as an edit to
   the vocabulary. Editing v1 in place is doubly wrong: it would break the id
   contract, and existing clients would not even see it — the vocabulary is
   cached in IndexedDB and only refetched when its `v` changes (measured: a
   word swapped in the served file was still the old word after two reloads).
2. **`CFG.dbName` stays `wortmeister`.** Changing it orphans everything.
3. **`onupgradeneeded` only ever creates missing stores.** If `dbVer` is ever
   bumped, no store is deleted or cleared. Phase 4 avoids the bump entirely by
   putting new per-word data in the existing record.
4. **State fields are added, never renamed, removed, or repurposed.** Every new
   field must read correctly when absent — `st.x || 0`, `st.m[mode] || 0`.
5. **Settings keys are added only.** `Object.assign({}, defaults, stored)`
   already means stored values win and new defaults fill gaps.
6. **No migration rewrites records.** Anything derivable is derived at read
   time. A record written in July 2026 is still read, unmodified, in November.

### How the contract is enforced, not just promised

Add a **frozen-fixture regression test** to the suite:

- `test/fixtures/state-v1.json` — a snapshot of today's exact record shape,
  including a `known`, a `queued`, a mid-`learning`, a `review` with a long
  interval, a `relearning`, and a `leech`, plus a settings blob from today.
- The test seeds fake IndexedDB with it, boots the real app, and asserts:
  record count unchanged, every field of every record byte-identical after
  boot and after a render pass of every screen, and no new field is *required*
  for any code path.
- It fails if anything in Phase 4 ever writes to a record it should only read.

This is the mechanism that turns "it won't touch your progress" into something
the test suite refuses to let regress. **Build this first, before any feature.**

---

## 1. What actually drives daily use

Be honest about the lever sizes. Points and badges are the weakest of these;
the top two are worth more than everything else combined.

| Lever | Why it works | Effort |
|---|---|---|
| **A daily goal that completes** | The lifetime ring sits at 21% and moves ~0.3%/day — invisible. A goal you *finish* gives a daily completion event. This is the single biggest change. | S |
| **A floor you can hit on a bad day** | All-or-nothing goals die the first busy evening. A "minimum day" that still counts protects the chain. | S |
| **Streak that survives one miss** | One earned freeze per 7 clean days, max 2 banked, spent automatically. Losing a 40-day streak to one late shift ends the habit outright. | S |
| **Don't-break-the-chain visual** | A 12-week heatmap is the strongest single cue in Anki's UI. | S |
| **Lower friction to start** | Home already opens on one button. Keep it that way. | – |
| **A reminder at a fixed time** | Cue → routine → reward. See the honest limitation below. | M |
| **Session ends on a win** | Finish with items you recovered, not items you failed. | S |

### The reminder problem, stated honestly

Real push notifications need a push service and a server. This app has no
backend and deploys by `git push` — adding one would break the thing that makes
it maintainable. iOS supports Web Push only for Home-Screen-installed PWAs, and
still requires a server to send.

Options, least-bad first:

1. **An iOS Shortcut / calendar alarm** at your study time that opens the app.
   Zero code, works today, completely reliable. **Recommended.**
2. **`navigator.setAppBadge()`** with the due count — works on installed PWAs,
   but only updates while the app is running or shortly after, so the badge
   goes stale. Half a feature. Worth doing as a small extra, not as the plan.
3. A push server. Rejected — it breaks the no-backend constraint.

Do not let this block the phase. Levers 1–4 above do not need it.

---

## 2. What the research actually supports

Grounding for the exercise design, strongest evidence first.

- **Spacing + retrieval practice** — already the core of the app. Keep.
- **Interleaving** beats blocking, substantially: one study found interleaved
  practice more than doubled test scores (77% vs 38%) with spacing held
  constant. This is the direct justification for §3.
- **Keyword mnemonic** is the most studied vocabulary mnemonic and reliably
  beats rote repetition for acquisition. Long-term retention results are mixed,
  and combining it with retrieval practice did **not** beat keyword alone in at
  least one study. So: offer it as an optional per-word hook, do not build the
  app around it.
- **Generation effect** — producing beats recognising. Typing mode already
  does this; matching is deliberately the *easy* mode and belongs early in a
  word's life, not late.

Design consequence: pairing and cloze are added for **variety and
discrimination**, not because they beat typing. They earn their place by
keeping sessions short, varied and startable — which is the actual bottleneck.

---

## 3. A properly mixed session (no new data — do this first)

Current `buildSession()` sorts due cards strictly by due date and inserts new
words every N. Four problems, all fixable without touching stored state.

### 3.1 Interval fuzz — a real latent bug

Anki randomises each interval slightly so cards introduced together and rated
the same do not resurface together forever: a 10-day interval becomes 8–12
days, a 30-day one 26–34. **Wortmeister has no fuzz at all**, so every word
sorted in the same sprint and graded the same way will clump on the same day,
permanently, and the clumps grow as intervals lengthen.

Fix: apply ±5% (minimum ±1 day) inside `dueDays()`, after the exam cap.

**Progress impact: none.** Fuzz applies when a card is next graded. Existing due
dates are never rewritten.

### 3.2 Shuffle within the day

Due order within a single day carries no pedagogical meaning. Shuffle the due
set instead of sorting by timestamp, seeded per-day so a reload mid-session
does not reshuffle.

### 3.3 Three-way interleave

Interleave **due reviews / new words / specialist drills** evenly across the
session instead of the current new-every-N. Directly answers "not just all the
unknown words at the beginning".

### 3.4 Sibling spacing

Never put two cards from the same word family within 5 cards of each other
(`Bewerbung` / `bewerben`, or a noun's article drill next to its typing card).
Adjacent siblings turn recall into pattern-matching.

### 3.5 Session shape

```
[ 1 pairing round — 5 fast wins ]
[ interleaved core: reviews · new · drills ]
[ recovery round: items missed earlier this session ]
```

Open with a win so starting is cheap; close with recovered items so the last
thing you feel is competence, not failure.

---

## 4. New exercises that need no new data

### 4.1 Pairing (`match`)

Five German words on one side, five English on the other. Tap one, tap its
partner. Correct pairs fade out; a wrong pair shakes and both reset.

- **Grading, per word:** matched first try → Good (response-time adjusted);
  matched after a wrong attempt → Hard; still unmatched when the round ends →
  Again. Routes through the existing `commitAnswer()` so scheduling cannot
  drift.
- **Distractors:** the other four come from the same session, matched on POS
  and level, and explicitly *not* from the same word family — near-synonyms
  make the round ambiguous rather than hard.
- **Placement:** reps 1–2, and as the opening round. It is the easiest mode and
  belongs early in a word's life.
- **Session accounting:** one round = 5 cards, so the counter stays honest.
- **New state:** `st.m.match` only, which already reads as 0 when absent.

### 4.2 Gender as shape

Colour is already taken — the ambient light encodes CEFR level. So gender gets
**shape**, which keeps the two channels from colliding:

```
der ▲     die ●     das ■
```

A small glyph beside every noun, and the same three shapes behind the article
drill buttons. One consistent, silent cue on ~5,700 nouns. Cheap, and removes
nothing.

### 4.3 Word families on reveal

Computed, not authored: group lemmas sharing a stem of ≥5 characters, plus
separable-verb prefixes (the data already has `sep` and `p3`). On reveal, show
up to two relatives:

> **die Bewerbung** · related: *bewerben*, *der Bewerber*

This is the "sequence" hook — it turns isolated items into a small structure,
and costs one precomputed index at load.

---

## 5. Sentence choice (`cloze`) — the one piece needing new data

> Prompt: `Er ______ sich um eine Stelle.` → **bewirbt** / bewertet / bewegt / bewahrt

This is the exercise closest to what the exam actually tests, and the most
expensive to build. It needs a sentence bank.

### Source

**Tatoeba** deu–eng, released under **CC BY 2.0 FR**, bulk downloads refreshed
weekly. Attribution is required — one line in Settings and in the README.

### Pipeline (`tools/vocab-build/build_sentences.py`)

1. Pull the deu sentence list plus eng links.
2. Keep 4–12 word sentences with a translation.
3. Tag each sentence with the vocabulary ids it contains.
4. Keep a sentence for word *W* only if **W is the only word in it above W's own
   CEFR level** — the i+1 rule. This is what stops a B1 cloze from being
   unreadable.
5. Cap at 3 sentences per word, prefer shortest.
6. Emit `data/sentences.v1.json`:
   `{ v: 1, byId: { "4821": [[sentence, blankStart, blankLen, englishGloss]] } }`

### Fitting the contract

- A **new file**, fetched separately, cached under a **new** `kv` key
  (`sentences`). `vocab.v1.json` is not touched, so no id can move and no
  cached vocabulary is invalidated.
- Coverage will be partial — realistically 40–60% of the target set.
  `pickMode()` must fall back to typing when a word has no sentence. Never
  assume presence.
- Distractors: three words of the same POS with similar surface form, drawn by
  edit distance on the lemma — that is what makes the choice about meaning
  rather than shape.

### Honest risks

Sentence quality is uneven and unreviewed; some will be odd. Mitigate with the
length cap, the i+1 filter, and a manual spot-check of ~100 before shipping.
**Ship this last.** If it slips, everything above still works.

---

## 6. Optional: your own mnemonic

One free-text field per word, editable from the Words screen and shown on
reveal. Stored as `st.n` on the existing record — a string on a record that
already exists, so **no new object store and no `dbVer` bump**.

The research says keyword mnemonics beat rote learning for acquisition, so this
earns a place — but as an optional hook on words that keep beating you, not a
required step. Surface it automatically on leeches, where it pays.

---

## 7. Keeping it minimal

The rules that stop this phase from undoing three rounds of simplification:

1. **Home stays one action and no numbers.** Every new statistic goes to Stats.
2. **Every addition must replace something or live behind a tap.** The heatmap
   replaces nothing on Home — it goes under Stats.
3. **Colour = level. Shape = gender. Nothing else gets a colour.**
4. **No points, no XP, no coins.** The streak, the daily ring and the heatmap
   are the entire reward surface. They are honest signals of real behaviour.
5. **No animation that delays input.** Celebrations are the enemy of a
   90-second session.

---

## 8. Risk register

| Risk | Severity | Prevention |
|---|---|---|
| Regenerating `vocab.v1.json` shifts ids | **Catastrophic, silent** — every "known" mark attaches to a different word | Frozen file; new data in new files keyed by id; fixture test |
| `dbName` or destructive `onupgradeneeded` | Total loss | Neither is touched this phase |
| A new field assumed present on old records | Crash or wrong scheduling | Fixture test covers every record state |
| A migration rewrites records | Corruption via bug | No migrations. Derive at read time |
| Stats blanked by a missing key | Whole screen dies | Already fixed structurally; keep deriving from `MODE_LABEL` |
| Service worker serves stale JS | Looks like random breakage | Bump `CACHE` every deploy (constraint 10) |
| Sentence bank quality | Confusing cards | i+1 filter, length cap, manual spot-check, ship last |

---

## 9. Sequence

Ordered so the risky, data-heavy work comes last and everything before it is
independently shippable.

| Step | Contents | Risk | Effort |
|---|---|---|---|
| **4.0** | Frozen-fixture compatibility test | none | S |
| **4.1** | Interval fuzz · shuffle · three-way interleave · sibling spacing · session shape | low | M |
| **4.2** | Daily goal ring · minimum day · streak freeze · heatmap · session summary | low | M |
| **4.3** | Pairing mode · gender shapes · word families | low | M |
| **4.4** | Sentence bank + cloze mode | **medium** | L |
| **4.5** | Optional mnemonic field · app badge | low | S |

4.0 first, always. 4.1 alone fixes a real scheduling defect and would be worth
doing even if the rest were dropped.

---

## Sources

- Anki fuzz behaviour — <https://faqs.ankiweb.net/the-anki-2.1-scheduler.html>,
  <https://github.com/xquercus/load-balanced-scheduler>
- Interleaving effect size — <https://www.mempowered.com/mnemonics/retrieval-practice-keyword-mnemonic>
- Keyword mnemonic + retrieval practice — <https://link.springer.com/article/10.3758/s13421-019-00936-2>,
  <https://pubmed.ncbi.nlm.nih.gov/31077068/>
- Tatoeba downloads and licence — <https://tatoeba.org/en/downloads>,
  <https://tatoeba.org/en/terms_of_use>
