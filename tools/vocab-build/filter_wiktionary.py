#!/usr/bin/env python3
"""Stream the 1 GB kaikki.org German Wiktionary extract on stdin and emit a
compact JSONL with only the fields the vocabulary builder needs."""
import json
import sys

KEEP_POS = {"noun", "verb", "adj", "adv", "conj", "prep", "pron", "num",
            "particle", "intj", "det", "prefix", "postp", "phrase", "adp"}
BAD_SENSE_TAGS = {"obsolete", "archaic", "dated", "rare", "dialectal",
                  "Switzerland", "Austria", "poetic", "humorous", "offensive",
                  "vulgar", "slang", "nonstandard", "misspelling", "no-gloss"}

out = sys.stdout
kept = seen = 0
for line in sys.stdin:
    seen += 1
    try:
        r = json.loads(line)
    except Exception:
        continue
    if r.get("lang_code") != "de":
        continue
    pos = r.get("pos")
    if pos not in KEEP_POS:
        continue
    word = r.get("word", "")
    if not word:
        continue

    senses = []
    for s in r.get("senses", []):
        gl = s.get("glosses") or s.get("raw_glosses")
        if not gl:
            continue
        senses.append({"g": gl[0][:220],
                       "t": sorted(set(s.get("tags", [])) & BAD_SENSE_TAGS)})
        if len(senses) >= 6:
            break
    if not senses:
        continue

    rec = {"w": word, "p": pos, "s": senses}

    forms = r.get("forms", [])
    gender = None
    plural = None
    past = pastp = aux = pres3 = None
    for f in forms:
        tags = set(f.get("tags", []))
        form = f.get("form", "")
        if not form or form in ("-", "—") or "table-tags" in tags or \
           "inflection-template" in tags:
            continue
        if pos == "noun":
            if "plural" in tags and "nominative" in tags and not plural:
                plural = form
            elif tags == {"plural"} and not plural:
                plural = form
            if not gender:
                for g in ("masculine", "feminine", "neuter"):
                    if g in tags:
                        gender = g[0]
                        break
        if pos == "verb":
            if "auxiliary" in tags and not aux:
                aux = form
            elif tags == {"past"} and not past:
                past = form
            elif {"participle", "past"} <= tags and not pastp:
                pastp = form
            elif {"present", "singular", "third-person"} <= tags and not pres3:
                pres3 = form

    ht = r.get("head_templates") or []
    if ht and isinstance(ht[0], dict):
        args = ht[0].get("args", {}) or {}
        if pos == "noun" and not gender:
            g = str(args.get("1", "") or args.get("g", ""))[:1]
            if g in "mfn":
                gender = g
        if pos == "noun" and not plural:
            for k in ("3", "pl", "2"):
                v = args.get(k)
                if v and isinstance(v, str) and v not in ("-", "?"):
                    plural = v
                    break
    if r.get("tags"):
        rec["vt"] = sorted(set(r["tags"]) & {"weak", "strong", "irregular",
                                             "separable", "inseparable",
                                             "reflexive", "transitive",
                                             "intransitive"})
    for k, v in (("g", gender), ("pl", plural), ("pt", past),
                 ("pp", pastp), ("aux", aux), ("p3", pres3)):
        if v:
            rec[k] = v
    out.write(json.dumps(rec, ensure_ascii=False) + "\n")
    kept += 1

print(f"read {seen} kept {kept}", file=sys.stderr)
