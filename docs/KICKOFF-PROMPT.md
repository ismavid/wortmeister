# Claude Code kickoff prompt

Open the repo folder in a terminal and run `claude`. Then paste the block below.

`CLAUDE.md` at the repo root is loaded automatically every session, so you do
not need to re-explain the project after this first message.

---

```
Read CLAUDE.md and docs/PLAN.md first.

This is Wortmeister, a static German A1–B2 vocabulary trainer I'm using to
prepare for the Goethe-Zertifikat B2 on 11 November 2026. Phase 1 is shipped
and passing: triage sprint, flip cards both directions, SM-2 scheduling with
response-time grading, IndexedDB persistence, backup/restore, PWA install.

Before changing anything:
1. Run `cd test && npm install && node test_app.js` and confirm 70/70 pass.
2. Read app.js end to end. It's one file, sectioned by banner comments.

Then build Phase 2, in this order, committing after each step with the test
suite green:

1. Typing mode ("Type the German"). English gloss as prompt, German as typed
   input, auto-graded with no buttons — wrong → Again, right & slow → Hard,
   right → Good, right & fast → Easy, using the same per-mode median as the
   flip modes. Typo tolerance: case-insensitive, accept ae/oe/ue/ss for
   ä/ö/ü/ß, and Levenshtein ≤1 on words longer than 5 chars counts as correct
   but grades Hard and shows the correct spelling. Nouns must include the
   article to count as correct.

2. Article drill. Bare noun, three buttons der/die/das, auto-graded the same
   way. Applies to the 5,732 nouns.

3. Extend pickMode() so a word progresses: reps 0–1 flip DE→EN, reps 2–4 flip
   EN→DE, reps 5+ typing; nouns interleave the article drill from rep 2. Track
   per-mode reps in st.m, which already exists.

Constraints that matter more than elegance:
- No framework, no bundler, no runtime npm dependency. It deploys by git push.
- Everything stays in index.html and app.js. Do not split into modules.
- UI text in German at B1–B2 level. Code and comments in English.
- Mobile-first, dark, 48px minimum tap targets. Check it at 375px wide.
- Word ids are permanent; review state keys on them.

Add test assertions in test/test_app.js for every new mode, including the
typo-tolerance edge cases. Do not tell me a phase is done until the suite
passes and you've told me the new assertion count.

Start by running the tests and giving me your read on app.js — including
anything you think I got wrong.
```

---

## Notes

- Claude Code works on a **local folder**, not an upload. Point it at the repo
  root — the folder containing `CLAUDE.md`, `index.html` and `app.js`.
- `tools/vocab-build/` is the Python pipeline that generated the word list.
  It is not needed for app work; it only matters if the vocabulary itself is
  regenerated, which requires re-downloading the source corpora.
- If Claude Code proposes adding a framework, a bundler, or splitting `app.js`
  into modules, say no. Those changes break the deploy story.
