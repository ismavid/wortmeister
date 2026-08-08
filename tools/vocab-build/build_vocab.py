#!/usr/bin/env python3
"""Assemble the A1-B2 master vocabulary.

Layers:
  core  - official Goethe A1/A2/B1 Wortlisten (authoritative level tags)
  B2    - DeReWo lemma-frequency expansion above the B1 list, validated against
          Wiktionary so that parse junk and proper nouns drop out

Enrichment comes from the English Wiktionary German extract (kaikki.org):
gender, plural, Präteritum, Partizip II, auxiliary, 3sg present, English senses.
"""
import json
import pickle
import re
import sys
from collections import defaultdict

WIKT = "/tmp/de/wikt.jsonl"
POS_PREF = ["verb", "adj", "adv", "conj", "prep", "pron", "num", "det",
            "particle", "intj", "phrase", "prefix", "postp", "adp"]
FREQ_CUTOFF = 14          # DeReWo frequency class ceiling for the B2 layer

WORD_RE = re.compile(r"^[A-Za-zÄÖÜäöüßÉÈÀÂÊÎÔÛÇéèàâêîôûç][A-Za-zÄÖÜäöüßéèàâêîôûç\-']*"
                     r"( [A-Za-zÄÖÜäöüßéèàâêîôûç\-']+)?$")


# ------------------------------------------------------------------ glosses
# Reject only metadata glosses. Leading articles are stripped, NOT rejected -
# "a mountain" is a perfectly good gloss for Berg.
BAD_GLOSS = re.compile(r"^(alternative form|alternative spelling|obsolete form|"
                       r"archaic form|misspelling|inflection of|past participle of|"
                       r"(weak|strong|mixed)?\s*(nominative|genitive|dative|accusative)[\w/ -]*of|"
                       r"(singular|plural) of|"
                       r"feminine of|masculine of|female equivalent|"
                       r"male equivalent|abbreviation of|initialism|acronym|"
                       r"synonym of|(superlative|comparative|positive)( degree)? of|"
                       r"((singular|plural|first-person|second-person|"
                       r"third-person)[ -]?)*imperative of|"
                       r"(first|second|third)-person .* of|"
                       r"(present|past) participle of|diminutive of|"
                       r"nominali[sz]ation of|verbal noun of|"
                       r"used (only )?in|see |obsolete|archaic|dated )", re.I)

# "agent noun of gönnen: patron, benefactor" -> "patron, benefactor"
DERIVED = re.compile(r"^(agent noun|gerund|nominali[sz]ation|diminutive|"
                     r"feminine|masculine) of [^:;]+[:;]\s*", re.I)
# same shape but with nothing useful after it -> unusable, try the next sense
DERIVED_ONLY = re.compile(r"^(agent noun|gerund|nominali[sz]ation|diminutive) "
                          r"of [\w\-äöüÄÖÜß]+$", re.I)
PAREN = re.compile(r"\s*\([^()]*\)")
LEAD_ART = re.compile(r"^(a|an|the)\s+", re.I)


def clean_gloss(g):
    g = PAREN.sub("", g)
    g = re.sub(r"\s*\[[^\]]*\]", "", g)
    g = re.sub(r"\s+", " ", g).strip(" ;,.")
    g = DERIVED.sub("", g)
    g = LEAD_ART.sub("", g)
    return g


def gloss_for(rec, maxlen=70):
    """Best short English gloss + a longer 'senses' string."""
    senses = [s for s in rec.get("s", []) if not s["t"]] or rec.get("s", [])
    cleaned = []
    for s in senses:
        c = clean_gloss(s["g"])
        if c and not BAD_GLOSS.match(c) and not DERIVED_ONLY.match(c):
            cleaned.append(c)
    if not cleaned:
        # fall back to a bare "agent noun of X" rather than losing the word
        fallback = [clean_gloss(s["g"]) for s in senses]
        fallback = [f for f in fallback if f and not BAD_GLOSS.match(f)]
        if fallback:
            return fallback[0], fallback[0], True
        return None, None, True
    primary = cleaned[0]
    flag = False
    if len(primary) > maxlen:
        parts = [p.strip() for p in primary.split(",")]
        short = ""
        for p in parts:
            if len(short) + len(p) + 2 > maxlen:
                break
            short = f"{short}, {p}" if short else p
        if short:
            primary = short
        else:
            primary = primary[:maxlen].rsplit(" ", 1)[0]
            flag = True
    if len(cleaned[0]) > 110:
        flag = True                       # encyclopedic definition, worth review
    return primary, " | ".join(cleaned[:3])[:300], flag


# ------------------------------------------------------------------ wiktionary
def usable_senses(rec):
    """How many senses are real translations rather than inflection metadata."""
    return sum(1 for s in rec.get("s", [])
               if not BAD_GLOSS.match(clean_gloss(s["g"]) or "x"))


def load_wikt():
    """(word, pos) -> best record; plus word -> set(pos).

    A word can have several homograph records. Rank by how many *usable*
    senses each has, not by raw sense count - otherwise a two-line
    "inflection of Angestellter" stub beats the entry that actually
    translates the word.
    """
    idx, bypos = {}, defaultdict(set)
    with open(WIKT, encoding="utf-8") as fh:
        for line in fh:
            r = json.loads(line)
            key = (r["w"], r["p"])
            old = idx.get(key)
            if old is None or (usable_senses(r), len(r.get("s", []))) > \
                              (usable_senses(old), len(old.get("s", []))):
                idx[key] = r
            bypos[r["w"]].add(r["p"])
    return idx, bypos


def pick_pos(word, bypos):
    """German capitalises nouns, which makes POS selection nearly deterministic."""
    have = bypos.get(word)
    if not have:
        return None
    if word[:1].isupper():
        if "noun" in have:
            return "noun"
        # adjectival nouns (der Angestellte, die Deutsche) are often filed as adj
        return "adj" if "adj" in have else None
    for p in POS_PREF:
        if p in have:
            return p
    return None


def variants(word):
    """(spelling, adopt_as_lemma) pairs to retry when a lemma misses.

    Hyphenation artefacts are genuine corrections and replace the lemma;
    the masculine "-r" of an adjectival noun is only a lookup key, so the
    displayed headword stays "der Vorstandsvorsitzende", not "...zender".
    """
    out = [(word, True)]
    if "-" in word:
        out.append((word.replace("-", ""), True))      # Entschuldi-gung
        out.append((word.split("-")[-1], True))
    if " " in word:
        out.append((word.split()[-1], True))
    if word[:1].isupper() and word.endswith("e"):
        out.append((word + "r", False))                # Angestellte -> Angestellter
    seen, res = set(), []
    for w, adopt in out:
        if w and w not in seen:
            seen.add(w)
            res.append((w, adopt))
    return res


# ------------------------------------------------------------------ sein-verbs
SEIN_ROOTS = {
    "gehen", "kommen", "fahren", "laufen", "reisen", "fliegen", "rennen",
    "schwimmen", "steigen", "springen", "fallen", "sinken", "wachsen",
    "sterben", "werden", "sein", "bleiben", "geschehen", "passieren",
    "gelingen", "misslingen", "begegnen", "folgen", "erscheinen", "auftreten",
    "einschlafen", "aufwachen", "aufstehen", "ziehen", "wandern", "eilen",
    "flüchten", "fliehen", "klettern", "segeln", "rutschen", "stürzen",
    "platzen", "explodieren", "schmelzen", "erfrieren", "verschwinden",
    "entstehen", "entkommen", "entgehen", "scheitern", "umziehen", "zurücktreten",
    "vorkommen", "geraten", "gedeihen", "reifen", "verwelken", "einziehen",
    "ausziehen", "abbiegen", "abfahren", "ankommen", "aufbrechen", "eintreten",
}


def aux_of(rec, lemma):
    a = rec.get("aux")
    if a in ("haben", "sein"):
        return a
    if a and "sein" in a and "haben" in a:
        return "haben/sein"
    base = lemma
    for pre in ("ab", "an", "auf", "aus", "be", "bei", "ein", "ent", "er", "los",
                "mit", "nach", "über", "um", "unter", "ver", "vor", "weg",
                "weiter", "zer", "zu", "zurück", "zusammen", "hin", "her"):
        if lemma.startswith(pre) and len(lemma) > len(pre) + 3:
            base = lemma[len(pre):]
            break
    if lemma in SEIN_ROOTS or base in SEIN_ROOTS:
        return "sein"
    return "haben"


# ------------------------------------------------------------------ main
def noun_info(nouns, word):
    """Gender + nominative plural from german-nouns (German Wiktionary).

    More reliable than the English Wiktionary forms table, which tags the
    *male/female equivalent noun* with a gender and confuses the extractor
    (that is how 'der Nachbar' came out as 'die').
    """
    try:
        recs = nouns[word]
    except Exception:
        return None, None, False
    gender = plural = None
    proper_only = True
    for r in recs or []:
        pos = r.get("pos") or []
        if "Substantiv" in pos:
            proper_only = False
        else:
            continue
        g = r.get("genus") or r.get("genus 1")
        if g in ("m", "f", "n") and not gender:
            gender = g
        pl = (r.get("flexion") or {}).get("nominativ plural")
        if pl and not plural:
            plural = pl
    return gender, plural, proper_only


def main():
    wikt, bypos = load_wikt()
    print(f"wiktionary: {len(wikt)} (word,pos) records", file=sys.stderr)
    from german_nouns.lookup import Nouns
    nouns_db = Nouns()

    lex = pickle.load(open("/tmp/de/lex.pkl", "rb"))
    freq, rank = lex["freq"], lex["rank"]

    goethe = json.load(open("/tmp/de/goethe_raw.json", encoding="utf-8"))
    goethe += json.load(open("/tmp/de/goethe_themes.json", encoding="utf-8"))
    level_of, goethe_tail = {}, {}
    order = {"A1": 0, "A2": 1, "B1": 2}
    for g in goethe:
        lem = (g["lemma"] or "").strip()
        if not lem or not WORD_RE.match(lem):
            continue
        if lem not in level_of or order[g["level"]] < order[level_of[lem]]:
            level_of[lem] = g["level"]
            goethe_tail[lem] = g.get("tail", "")
    print(f"goethe lemmas (raw): {len(level_of)}", file=sys.stderr)

    rows, dropped = [], []

    def tier_of(level, fc):
        if level != "B2":
            return "core"
        if fc is None:
            return "extended"
        return "B2-core" if fc <= 13 else "B2-extended"

    def resolve_female(rec):
        """'female equivalent of Anwalt' -> reuse the masculine gloss."""
        for s in rec.get("s", []):
            m = re.search(r"(?:female|feminine) (?:equivalent|form) of ([\w\-äöüÄÖÜß]+)",
                          s["g"], re.I)
            if m:
                base = wikt.get((m.group(1), "noun"))
                if base:
                    p, sn, fl = gloss_for(base)
                    if p:
                        return f"{p} (female)", sn, fl
        return None, None, False

    def make_row(lemma, level, source):
        pos = rec = primary = None
        senses, flag = None, False
        for cand, adopt in variants(lemma):
            avail = bypos.get(cand)
            if not avail:
                continue
            first = pick_pos(cand, bypos)
            # try the preferred POS, then any other the word has: "starr" is an
            # adjective, but its verb entry ("imperative of starren") wins the
            # POS race and yields only a metadata gloss
            for p in [first] + [x for x in POS_PREF + ["noun"] if x != first]:
                if not p or p not in avail:
                    continue
                r = wikt[(cand, p)]
                pr, sn, fl = gloss_for(r)
                if not pr:
                    pr, sn, fl = resolve_female(r)
                if pr:
                    pos, rec = p, r
                    if adopt:
                        lemma = cand
                    primary, senses, flag = pr, sn, fl
                    break
            if pos:
                break
        if pos is None:
            dropped.append((lemma, level, "no-usable-entry"))
            return None
        fc = freq.get(lemma)
        # The Goethe alphabetical lists omit many function words (alle, am, zwei,
        # uns), so very frequent CLOSED-CLASS words get an inferred elementary
        # level, marked with * to show it is not from the official list.
        # Frequent CONTENT words are deliberately left at B2: "zusätzlich" and
        # "Ergebnis" are common in a news corpus but are not A1 vocabulary.
        CLOSED = {"pron", "det", "conj", "prep", "num", "particle", "intj", "adp"}
        if level == "B2" and fc is not None and fc <= 10 and pos in CLOSED:
            level, source = ("A1*" if fc <= 8 else "A2*"), "frequency-inferred"
        row = {
            "lemma": lemma, "pos": pos, "level": level, "source": source,
            "tier": tier_of(level, fc),
            "en": primary, "en_senses": senses, "review": flag,
            "freq_class": fc, "freq_rank": rank.get(lemma),
            "article": "", "plural": "", "praeteritum": "", "partizip2": "",
            "aux": "", "praesens_3sg": "", "separable": "", "irregular": "",
        }
        if pos == "noun":
            g_db, pl_db, proper_only = noun_info(nouns_db, lemma)
            g = g_db or rec.get("g")
            row["article"] = {"m": "der", "f": "die", "n": "das"}.get(g, "")
            row["plural"] = pl_db or rec.get("pl", "") or ""
            if not g_db and rec.get("g"):
                # fell back to the noisier English-Wiktionary gender
                row["review"] = True
            # Demonyms ("Leipziger" glossed as "Leipziger") are useless entries.
            # DE/EN cognates that gloss to themselves - Hotel, Bus, April, Film -
            # are perfectly good vocabulary, so only the -er/-erin shape is cut.
            if primary.strip().lower() == lemma.lower() and \
               lemma.endswith(("er", "erin")):
                dropped.append((lemma, level, "demonym"))
                return None
        if pos == "verb":
            row["praeteritum"] = rec.get("pt", "") or ""
            row["partizip2"] = rec.get("pp", "") or ""
            row["praesens_3sg"] = rec.get("p3", "") or ""
            row["aux"] = aux_of(rec, lemma)
            p3 = row["praesens_3sg"]
            row["separable"] = "yes" if (" " in p3 or "separable" in rec.get("vt", [])) else "no"
            vt = rec.get("vt", [])
            row["irregular"] = "yes" if ("strong" in vt or "irregular" in vt) else "no"
        return row

    for lemma, level in sorted(level_of.items()):
        r = make_row(lemma, level, "Goethe-Wortliste")
        if r:
            rows.append(r)
    have = {r["lemma"] for r in rows}
    print(f"core kept: {len(rows)}  dropped: {len(dropped)}", file=sys.stderr)

    # ---- B2 expansion, most frequent first
    cands = sorted((w for w, c in freq.items()
                    if c <= FREQ_CUTOFF and w not in have and WORD_RE.match(w)),
                   key=lambda w: (freq[w], rank.get(w, 10 ** 9)))
    added = 0
    for w in cands:
        r = make_row(w, "B2", "DeReWo-frequency")
        if r:
            rows.append(r)
            added += 1
    print(f"B2 added: {added}", file=sys.stderr)

    ORD = {"A1": 0, "A1*": 0, "A2": 1, "A2*": 1, "B1": 2, "B2": 3}
    rows.sort(key=lambda r: (ORD[r["level"]],
                             r["freq_rank"] if r["freq_rank"] is not None else 10 ** 9,
                             r["lemma"]))
    json.dump(rows, open("/tmp/de/vocab.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump(dropped, open("/tmp/de/dropped.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    from collections import Counter
    print("LEVELS", Counter(r["level"] for r in rows), file=sys.stderr)
    print("POS   ", Counter(r["pos"] for r in rows), file=sys.stderr)
    print("review", sum(1 for r in rows if r["review"]), file=sys.stderr)
    print("TOTAL ", len(rows), file=sys.stderr)


if __name__ == "__main__":
    main()
