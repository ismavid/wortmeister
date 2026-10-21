# Endgame — making the last 21 days count

Written 21 October 2026. The exam is **11 November 2026**, 21 days away.

Every number below is measured from this repository's own data and config, not
estimated. Where a number needs Ismael's progress file to be exact, it says so.

---

## 0. The number that changes the plan

`CFG.MASTER_DAYS` is 21: a word counts as learned once its interval reaches 21
days. The exam is 21 days away. **Today was the last day a brand-new word could
reach that interval before the exam.** From tomorrow, every word introduced is
a word that will still be fragile on 11 November.

That is not an argument for panic. It is an argument that the app's goal has
changed, and the app has not noticed.

### What the remaining new words actually cost

At the shipped settings (`NEW_CAP` 5/day, `maxReviews` 60/day), assuming every
single answer is Good — the optimistic case, since any Again adds relearning
touches on top:

| | |
| --- | --- |
| Review slots left before the exam | 1,260 |
| Slots consumed by the next 105 new words | 520 |
| Share of the entire remaining budget | **41.3 %** |
| Words introduced after 8 Nov that never graduate out of learning | all of them |

So 41 % of every remaining repetition would be spent on the 105 words that will
be the *weakest* things he knows on the day. The same slots spent on words
already in review buy far more exam score.

### What `autoNewTarget` currently believes

`autoNewTarget()` computes `ceil(remaining / daysToExam())`. With roughly 7,000
words left and 21 days, that is **334 new words a day**. `NEW_CAP` then clamps
it to 5. The app is silently asking for something impossible and delivering
1.5 % of it, with no acknowledgement anywhere on screen that the plan is dead.

---

## 1. What I measured in the corpus

In scope (A1, A2, B1, B2-core): **10,375** of 10,390 words.

| Level | Words |
| --- | --- |
| A1 | 739 |
| A2 | 615 |
| B1 | 1,875 |
| B2-core | 7,146 |

### What each drill can actually reach

| Drill | Reachable words in scope | Coverage |
| --- | --- | --- |
| German → English, English → German | 10,375 | 100 % |
| Article (`der`/`die`/`das`) | 5,763 nouns | 99.8 % of nouns |
| Verb forms (Prät. + Partizip II) | 2,069 verbs | 99.2 % of verbs |
| In a sentence / the Feed | 4,979 | **48.0 %** |
| Preposition (`rection`) | 75 verbs | **3.6 % of verbs** |
| Spanish meaning | 7,020 | 67.7 % |

Two of those are badly short, and both matter for B2:

- **Only 48 % of scoped words have a single example sentence.** 743 of the
  covered words have exactly one, so the cloze drill and the Feed repeat it
  forever. More than half the vocabulary can never appear in context at all.
- **The Preposition drill reaches 75 verbs.** `data.verbPrep` holds 149 rows
  over 131 distinct verbs, of which 75 are scoped verbs. *Verben mit
  Präpositionen* is a standard B2 item and the app barely tests it.

**1,337 scoped words (12.9 %) can only ever be drilled as translation** — no
sentence, no article, no verb forms. They are learned by recognition alone.

### Sentence register

The Tatoeba bank is short: median **6 words**, 90th percentile **9**, longest
**12**. That is right for A1 and A2 and clearly below B2 reading register,
where sentences run 15–25 words with subordinate clauses. The cloze drill is
therefore easier than the exam it is preparing for.

### Three data defects

1. **The `aux` column is wrong for a meaningful share of verbs.** It marks 181
   verbs *sein* and 1,905 *haben*. A spot check of 29 known *sein*-verbs earlier
   in this project found 7 marked *haben*. The Verb-forms drill therefore marks
   some correct answers wrong. Being punished for a right answer is the fastest
   way to stop trusting a trainer.
2. **The word-level `rection` column ships completely empty** — 0 of 10,390
   rows. The app already knows this and reads `data.verbPrep` instead, so the
   drill works. But `tools/vocab-build/prioritize.py` scores `+5 if
   r["rection"]`, against that same empty column, so the rection bonus fired
   **zero times** across the whole ranking.
3. **Only 184 words are `fach`-tagged** (technical and professional German).
   The whole point of the B2 is a German internship, and the corpus barely
   distinguishes the vocabulary that serves it.

---

## 2. What I cannot see, and what it would change

Everything above is the corpus. **Ismael's own progress lives in IndexedDB on
his phone and I have no access to it.** Settings → Back up produces a JSON file;
with that file the following become exact rather than parametric:

- how many words are in `learning`, `relearning`, `review`, `known`, `leech`
- true retention, and **retention split by drill** — which modes he actually
  fails, which is what should drive mode weighting
- median answer time per mode, which is what session length is really made of
- which words are decaying and when each was last seen
- how many leeches are eating slots

Three items in the plan below (P1.5, P1.6 and the mode weights in P1.3) are
sized by those numbers. The rest stand on the corpus alone.

---

## 3. The plan

Ordered by exam score per hour of work. Each item names the number it moves.

### P0 — before the exam, highest effect, small changes

**P0.1 Terminal phase: stop introducing new words.**
When `daysToExam() <= CFG.MASTER_DAYS`, drop the new-word target to 0 by
default and say so on Home in one line ("Consolidating — no new words before
the exam"). Frees **520 review slots, 41 % of the remaining budget**, and
redirects them to words that can still be secured. Make it a setting, not a
lock, so it is his call — but the default should be the one that scores.

**P0.2 A final pass that ignores SM-2.**
SM-2 optimises long-run retention, not peak recall on a fixed date. A card that
reaches a 21-day interval on 25 October is not scheduled again before the exam.
The last few days should sweep *everything* in `review`/`known` that has not
been seen recently, as cheap recognition, not full grading.

The machinery already exists: **Refresh** drills mastered words and deliberately
writes nothing on a pass. Three changes make it the endgame tool:
- order by time-since-last-seen rather than at random
- draw from everything answered, not only `isMastered`
- raise `REFRESH_MAX` from 20 when the exam is close

**P0.3 An exam-readiness readout.**
Stats answers "how am I pacing" and never answers "what will I actually know on
11 November". The app holds every input: each word's interval, due date and
lapse count, and the date. Project each scoped word to exam day and show three
numbers — **secure**, **fragile**, **never seen**. That is the one number worth
looking at now, and it makes every later decision in this document measurable
instead of argued.

**P0.4 Fix the `aux` column.**
Rebuild as `vocab.v2.json` with corrected auxiliaries, ids preserved and the
filename bumped, exactly as the compatibility contract requires. Until then the
Verb-forms drill is teaching some wrong answers and failing some right ones.

### P1 — before the exam if there is time

**P1.5 Triage the leeches.**
`LEECH_AT` is 8. A leech is a word returning the least per slot in the budget
that matters most. Before an exam each one should be either given a mnemonic or
suspended outright so it stops consuming repetitions. *Needs the export to size.*

**P1.6 Weight modes by what he actually fails.**
Mode selection is currently structural — what the data supports. It should be
driven by measured per-mode accuracy, hardest first. *Needs the export.*

**P1.3 Never let a word reach "mastered" on recognition alone.**
`isMastered()` is `wordStrength(st) >= 1`, which is purely interval-based. A
word can be "mastered" having only ever been shown German → English, the
easiest direction and the least like the exam. Require at least one correct
*production* answer (`type`, `hint`, or `cloze`) before a word counts. For the
1,337 translation-only words this means `type`, which they all support.

### P2 — after 11 November

**P2.1 Expand `verbPrep` from 149 rows to the ~300 standard B2 patterns.**
Takes the Preposition drill from 3.6 % of verbs to roughly 15 %, and covers a
guaranteed exam topic. Pure data work, no engineering.

**P2.2 Raise sentence coverage above 48 % and the register to B2.**
A second source with longer, subordinate-clause sentences, sized at 15–25 words.
This is the single biggest quality gap between the app and the exam, and the
most expensive item here — which is why it sits after the exam, not before.

**P2.3 Rebuild `vocab.v2.json` properly.**
Carry P0.4, populate `rection` from `verbPrep` so `prioritize.py`'s bonus
actually fires, and widen `fach` well beyond 184 words for the internship.

**P2.4 Per-word mnemonics (`st.n`).**
Specified in `docs/PHASE-4.md` §6, never built. It is what makes P1.5 a fix
rather than a deletion.

---

## 4. What not to do

- **Do not raise `NEW_CAP` to cover more ground.** The arithmetic in §0 only
  gets worse as the exam gets closer.
- **Do not pull B2-extended into scope.** 7,146 B2-core words are already more
  than 21 days can secure.
- **Do not re-rank the vocabulary now.** Two re-ranks were measured and rejected
  earlier in this project because they traded common words for rarer ones. With
  21 days left, a new order would only disturb a queue that is already set.
