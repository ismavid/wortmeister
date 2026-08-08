#!/usr/bin/env python3
"""Post-build corrections found during the verification pass."""
import json
import re

vocab = json.load(open("/tmp/de/vocab.json", encoding="utf-8"))
gv = json.load(open("/tmp/de/npm/node_modules/german-verbs-dict/dist/verbs.json",
                    encoding="utf-8"))

# 1. Verbs with über-/unter-/um-/durch-/wider- that Wiktionary conjugated as
#    separable but which are inseparable in their normal B1-B2 meaning.
INSEPARABLE = {
    "überlegen": ("überlegte", "überlegt"),
    "unterschreiben": ("unterschrieb", "unterschrieben"),
    "übersetzen": ("übersetzte", "übersetzt"),
    "unterstellen": ("unterstellte", "unterstellt"),
    "überziehen": ("überzog", "überzogen"),
    "umgeben": ("umgab", "umgeben"),
    "durchsuchen": ("durchsuchte", "durchsucht"),
    "durchqueren": ("durchquerte", "durchquert"),
    "überfahren": ("überfuhr", "überfahren"),
    "umschreiben": ("umschrieb", "umschrieben"),
    "widerlegen": ("widerlegte", "widerlegt"),
    "überfliegen": ("überflog", "überflogen"),
}
# 2. Auxiliary corrections (change of state / motion that Wiktionary got wrong)
AUX_SEIN = {"ausklingen", "abklingen", "verklingen", "einziehen", "auflaufen",
            "hinzukommen", "dazukommen", "emporsteigen", "hervorgehen",
            "zurückkehren", "heimkehren", "umkehren", "einkehren"}

fixed_sep = fixed_aux = filled = 0
for r in vocab:
    if r["pos"] != "verb":
        continue
    lem = r["lemma"]
    if lem in INSEPARABLE:
        pt, pp = INSEPARABLE[lem]
        r["praeteritum"], r["partizip2"] = pt, pp
        r["separable"] = "no"
        r["praesens_3sg"] = re.sub(r"\s+\w+$", "", r["praesens_3sg"]) or r["praesens_3sg"]
        fixed_sep += 1
    if lem in AUX_SEIN and r["aux"] != "sein":
        r["aux"] = "sein"
        fixed_aux += 1
    # 3. fill missing forms from german-verbs-dict (Morphy-derived)
    if (not r["praeteritum"] or not r["partizip2"]) and lem in gv:
        g = gv[lem]
        pp = g.get("PA2")
        prt = (g.get("PRT") or {}).get("S", {}).get("3")
        flat = lambda x: " ".join(x) if isinstance(x, list) else x
        if not r["partizip2"] and pp:
            r["partizip2"] = flat(pp[0] if isinstance(pp, list) else pp)
        if not r["praeteritum"] and prt:
            r["praeteritum"] = flat(prt)
        filled += 1

# 4. de-duplicate lemmas, keeping the lowest CEFR level
ORDER = {"A1": 0, "A1*": 0, "A2": 1, "A2*": 1, "B1": 2, "B2": 3}
best = {}
for r in vocab:
    k = (r["lemma"], r["pos"])
    if k not in best or ORDER[r["level"]] < ORDER[best[k]["level"]]:
        best[k] = r
deduped = list(best.values())
removed = len(vocab) - len(deduped)

deduped.sort(key=lambda r: (ORDER[r["level"]],
                            r["freq_rank"] if r["freq_rank"] is not None else 10 ** 9,
                            r["lemma"]))
json.dump(deduped, open("/tmp/de/vocab.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print(f"separable fixes: {fixed_sep}, aux fixes: {fixed_aux}, "
      f"forms filled: {filled}, duplicates removed: {removed}, "
      f"total now: {len(deduped)}")
