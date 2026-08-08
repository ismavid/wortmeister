# Build pipeline — German A1–B2 vocabulary

Run in this order (all paths assume a Linux sandbox with `/tmp/de` as scratch):

| # | Script | Does |
|---|---|---|
| 1 | `parse_goethe.py` | Parses the alphabetical sections of the official Goethe A1/A2/B1 Wortliste PDFs |
| 2 | `parse_themes.py` | Parses the thematic *Wortgruppen* sections (numbers, months, colours, animals) |
| 3 | `build_lexicon.py` | Indexes the Ding DE-EN dictionary and the DeReWo lemma-frequency list |
| 4 | `filter_wiktionary.py` | Streams the 1 GB kaikki.org German Wiktionary extract into a compact JSONL |
| 5 | `build_vocab.py` | Assembles the master list: levels, POS, gender, plural, verb forms, glosses |
| 6 | `fix_vocab.py` | Separable/inseparable and auxiliary corrections; de-duplication |
| 7 | `gloss_overrides.py` | Hand-written glosses where Wiktionary gave only a derivational note |
| 8 | `verb_prep.py` | Hand-curated Verben-mit-Präposition table |
| 9 | `make_deliverables.py` | Writes the XLSX, the app seed JSON and the Anki TSVs |

`gloss.py` is the earlier Ding-based gloss ranker, kept for reference; the final
build takes its translations from Wiktionary instead.

## Sources
- Goethe-Institut Wortlisten A1 / A2 / B1 (official)
- DeReWo v-ww-bll-320000g, IDS Mannheim (CC BY-NC) — lemma frequency
- English Wiktionary German extract via kaikki.org — senses, verb forms, auxiliaries
- `german-nouns` (German Wiktionary) — gender and plural
- Ding DE-EN dictionary, TU Chemnitz (GPL) — cross-checking
