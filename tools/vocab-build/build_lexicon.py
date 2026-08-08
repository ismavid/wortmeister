#!/usr/bin/env python3
"""Build the reference lexicon: Ding DE-EN glosses, noun gender/plural, verb forms,
and DeReWo lemma frequency. Writes /tmp/de/lex.pkl."""
import json
import pickle
import re
import sys
from collections import defaultdict

RAW = "/tmp/de/raw"

# ---------------------------------------------------------------- Ding DE-EN
BRACKET = re.compile(r"\s*[\[\{\(][^\[\]\{\}\(\)]*[\]\}\)]")
GENDER = re.compile(r"\{(m|f|n|pl)\}")
DOMAIN = re.compile(r"\[([a-zäöü.]+)\]")
# register/domain tags that make a gloss a poor "first" choice for a learner
NARROW = {"chem.", "min.", "biol.", "med.", "techn.", "geol.", "bot.", "zool.",
          "mach.", "electr.", "naut.", "mil.", "jur.", "fin.", "comp.", "phys.",
          "math.", "astron.", "archi.", "agr.", "auto.", "aviat.", "textil.",
          "ornith.", "ichth.", "myth.", "hist.", "relig.", "sport", "mus.",
          "print.", "photo.", "psych.", "phil.", "ling.", "pharm.", "constr."}
SLANG = {"ugs.", "slang", "vulg.", "pej.", "obs.", "veraltet", "poet.", "humor.",
         "übtr.", "fig.", "selten", "österr.", "schweiz.", "Süddt.", "Norddt."}


def strip_all(s):
    prev = None
    while prev != s:
        prev = s
        s = BRACKET.sub("", s)
    return re.sub(r"\s+", " ", s).strip(" .;,")


def load_ding():
    """headword -> list of candidate dicts (english, gender, penalty)."""
    idx = defaultdict(list)
    path = f"{RAW}/de-en.txt"
    with open(path, encoding="utf-8", errors="replace") as fh:
        for ln, line in enumerate(fh):
            line = line.rstrip("\n")
            if not line or line.startswith("#") or " :: " not in line:
                continue
            de_side, en_side = line.split(" :: ", 1)
            de_groups = de_side.split(" | ")
            en_groups = en_side.split(" | ")
            if not de_groups or not en_groups:
                continue
            de0, en0 = de_groups[0], en_groups[0]
            tags = set(DOMAIN.findall(de0)) | set(DOMAIN.findall(en0))
            pen = 0
            if tags & NARROW:
                pen += 3
            if tags & SLANG:
                pen += 2
            if len(de_groups) > 3:
                pen += 1

            en_syns = [strip_all(x) for x in en0.split("; ")]
            en_syns = [x for x in en_syns if x]
            if not en_syns:
                continue
            english = "; ".join(en_syns[:3])

            for pos, part in enumerate(de0.split("; ")):
                g = GENDER.search(part)
                head = strip_all(part)
                if not head or " " in head and len(head.split()) > 3:
                    continue
                idx[head].append({
                    "en": english,
                    "gender": g.group(1) if g else None,
                    "pen": pen + pos + (ln / 1e7),
                })
    return idx


# ---------------------------------------------------------------- nouns
def load_nouns():
    from german_nouns.lookup import Nouns
    return Nouns()


# ---------------------------------------------------------------- verbs
def load_verbs():
    p = "/tmp/de/npm/node_modules/german-verbs-dict/dist/verbs.json"
    return json.load(open(p, encoding="utf-8"))


# ---------------------------------------------------------------- frequency
def load_derewo():
    """lemma -> (freq_class, rank). Lower class = more frequent."""
    path = f"{RAW}/derewo/derewo-v-ww-bll-320000g-2012-12-31-1.0.txt"
    freq, rank = {}, {}
    i = 0
    with open(path, encoding="latin-1") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            lemma, cls = parts[0], parts[1]
            if not cls.isdigit():
                continue
            for var in lemma.split(","):
                var = var.strip()
                if not var:
                    continue
                if var not in freq or int(cls) < freq[var]:
                    freq[var] = int(cls)
                    rank[var] = i
            i += 1
    return freq, rank


if __name__ == "__main__":
    print("ding...", file=sys.stderr)
    ding = load_ding()
    print(f"  {len(ding)} headwords", file=sys.stderr)
    print("verbs...", file=sys.stderr)
    verbs = load_verbs()
    print(f"  {len(verbs)} verbs", file=sys.stderr)
    print("derewo...", file=sys.stderr)
    freq, rank = load_derewo()
    print(f"  {len(freq)} lemmas", file=sys.stderr)

    with open("/tmp/de/lex.pkl", "wb") as fh:
        pickle.dump({"ding": dict(ding), "verbs": verbs,
                     "freq": freq, "rank": rank}, fh)
    print("ok", file=sys.stderr)
    for w in ["Betrieb", "gehen", "nachhaltig", "Wirkungsgrad", "zuverlässig"]:
        print(w, "|freq", freq.get(w), "|ding",
              sorted(ding.get(w, []), key=lambda d: d["pen"])[:2], file=sys.stderr)
