#!/usr/bin/env python3
"""Score every word by how much it is worth learning *first*.

Frequency dominates, but frequency alone is a poor study order:
  - a word on an official Goethe list is guaranteed exam-relevant
  - foundation gaps (A1-B1) cost more than a missing B2 synonym
  - verbs and connectors unlock more sentences than a rare noun
  - DE/EN cognates and transparent compounds are nearly free to read,
    so drilling them is wasted time
  - Ismael needs professional/technical German for a German internship
"""
import difflib
import json
import re
import unicodedata

LEVEL_BONUS = {"A1": 14, "A2": 12, "B1": 9, "B2": 0}
POS_BONUS = {"conj": 8, "pron": 8, "prep": 7, "verb": 6, "adv": 5,
             "adj": 3, "num": 3, "det": 6, "particle": 5, "noun": 0,
             "intj": 0, "prefix": 0, "postp": 0}

# Chemical engineering, energy, industry and the German job-application world.
FACH = re.compile(
    r"anlage|stoff|druck|wärme|energie|technik|verfahren|leistung|chemie|"
    r"reaktion|betrieb|produktion|sicherheit|umwelt|qualität|messung|prüfung|"
    r"labor|maschine|rohr|ventil|pumpe|kessel|destillat|katalys|emission|"
    r"wirkungsgrad|verbrennung|energie|strom|kraftwerk|werkstoff|legierung|"
    r"korrosion|löslich|dichte|temperatur|volumen|gemisch|lösung|säure|lauge|"
    r"ingenieur|forschung|entwicklung|entwurf|norm|richtlinie|genehmigung|"
    r"bewerbung|lebenslauf|praktikum|abteilung|vertrag|gehalt|kündigung|"
    r"versicherung|behörde|aufenthalt|anmeldung|krankenkasse|frist|antrag|"
    r"zeugnis|nachweis|unterlagen|vorstellungsgespräch|arbeitgeber|"
    r"arbeitnehmer|führung|leitung|zuständig|verantwort|termin|besprechung",
    re.I)


def fold(s):
    s = s.lower().replace("ä", "a").replace("ö", "o").replace("ü", "u")
    s = s.replace("ß", "ss")
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def cognate_score(lemma, en):
    """0..1 - how guessable the German word is from the English gloss."""
    first = re.split(r"[,;/]", en)[0].strip().lower()
    first = re.sub(r"^to\s+", "", first)
    if not first or " " in first:
        return 0.0
    return difflib.SequenceMatcher(None, fold(lemma), fold(first)).ratio()


def score(r):
    fc = r["freq_class"] if r["freq_class"] is not None else 16
    s = (16 - fc) * 6.0
    s += LEVEL_BONUS.get(r["level"].rstrip("*"), 0)
    if r["source"] == "Goethe-Wortliste":
        s += 8
    s += POS_BONUS.get(r["pos"], 0)

    cog = cognate_score(r["lemma"], r["en"])
    if cog > 0.62:
        s -= 10 * (cog - 0.62) / 0.38          # up to -10 for near-identical
    if r["pos"] == "noun" and len(r["lemma"]) >= 14:
        s -= 4                                 # long transparent compound
    if FACH.search(r["lemma"]):
        s += 6
    if r["rection"]:
        s += 5                                 # verb with a governed preposition
    return s, cog


if __name__ == "__main__":
    vocab = json.load(open("/tmp/de/vocab.json", encoding="utf-8"))
    for r in vocab:
        r.setdefault("rection", "")
        sc, cog = score(r)
        r["_raw"] = sc
        r["cognate"] = round(cog, 2)
        r["fachdeutsch"] = bool(FACH.search(r["lemma"]))

    lo = min(r["_raw"] for r in vocab)
    hi = max(r["_raw"] for r in vocab)
    ranked = sorted(vocab, key=lambda r: -r["_raw"])
    for i, r in enumerate(ranked, 1):
        r["priority"] = round((r["_raw"] - lo) / (hi - lo) * 100, 1)
        r["priority_rank"] = i
        del r["_raw"]

    json.dump(ranked, open("/tmp/de/vocab.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"scored {len(ranked)} words")
    print("\nTOP 25 by priority:")
    for r in ranked[:25]:
        print(f"  {r['priority']:5.1f} {r['level']:3s} {r['pos'][:4]:5s} "
              f"{(r['article'] + ' ' if r['article'] else '') + r['lemma']:22s} = {r['en'][:34]}")
    print("\nBOTTOM 12 (deprioritised):")
    for r in ranked[-12:]:
        print(f"  {r['priority']:5.1f} {r['level']:3s} {r['pos'][:4]:5s} "
              f"{r['lemma']:26s} = {r['en'][:30]} (cognate {r['cognate']})")
    print(f"\nFachdeutsch-tagged: {sum(1 for r in ranked if r['fachdeutsch'])}")
