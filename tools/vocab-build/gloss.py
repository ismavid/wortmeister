#!/usr/bin/env python3
"""Rank Ding DE->EN candidate glosses.

Three signals, because raw file order is meaningless:
  1. bidirectional confirmation - does the reverse EN->DE lookup return this
     German headword, and how early in its synonym list?
  2. English frequency - "to go" beats "to prove" as the primary sense of gehen
  3. domain/register penalties - [chem.], [ugs.] etc. are poor first glosses
"""
import math
import pickle
import re
import sys
from collections import defaultdict

BRACKET = re.compile(r"\s*[\[\{\(][^\[\]\{\}\(\)]*[\]\}\)]")
GENDER = re.compile(r"\{(m|f|n|pl)\}")
DOMAIN = re.compile(r"\[([a-zäöü.]+)\]")
NARROW = {"chem.", "min.", "biol.", "med.", "techn.", "geol.", "bot.", "zool.",
          "mach.", "electr.", "naut.", "mil.", "jur.", "fin.", "comp.", "phys.",
          "math.", "astron.", "archi.", "agr.", "auto.", "aviat.", "textil.",
          "ornith.", "ichth.", "myth.", "hist.", "relig.", "print.", "photo.",
          "psych.", "phil.", "ling.", "pharm.", "constr.", "anat.", "geogr."}
SLANG = {"ugs.", "slang", "vulg.", "pej.", "obs.", "veraltet", "poet.", "humor.",
         "übtr.", "fig.", "selten", "Ös.", "Schw.", "Süddt.", "Norddt.", "altertümlich"}
STOP = {"a", "an", "the", "of", "to", "it", "in", "on", "at", "for", "be", "is",
        "as", "by", "with", "and", "or", "one's", "sb.", "sth.", "up", "out",
        "off", "into", "over", "down", "away", "about", "that", "this"}


def strip_all(s):
    prev = None
    while prev != s:
        prev = s
        s = BRACKET.sub("", s)
    return re.sub(r"\s+", " ", s).strip(" .;,")


def en_freq_table():
    t = {}
    with open("/tmp/de/raw/en_50k.txt", encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            w = line.split()[0]
            t.setdefault(w, i)
    return t


def build(path="/tmp/de/raw/de-en.txt"):
    """de_head -> [cand], plus en_head -> [(de_head, position)]"""
    de_idx = defaultdict(list)
    en_idx = defaultdict(list)
    with open(path, encoding="utf-8", errors="replace") as fh:
        for ln, line in enumerate(fh):
            line = line.rstrip("\n")
            if not line or line.startswith("#") or " :: " not in line:
                continue
            de_side, en_side = line.split(" :: ", 1)
            dg, eg = de_side.split(" | "), en_side.split(" | ")
            de0, en0 = dg[0], eg[0]
            tags = set(DOMAIN.findall(de0)) | set(DOMAIN.findall(en0))
            pen = (3 if tags & NARROW else 0) + (2 if tags & SLANG else 0)

            de_parts, en_parts = de0.split("; "), en0.split("; ")
            de_heads = []
            for i, p in enumerate(de_parts):
                h = strip_all(p)
                if h and len(h.split()) <= 3:
                    de_heads.append((h, i, GENDER.search(p).group(1) if GENDER.search(p) else None))
            en_heads = []
            for i, p in enumerate(en_parts):
                h = strip_all(p)
                if h:
                    en_heads.append((h, i))
            if not de_heads or not en_heads:
                continue
            gloss = "; ".join(h for h, _ in en_heads[:3])
            for h, i, g in de_heads:
                de_idx[h].append({"en": gloss, "en_head": en_heads[0][0],
                                  "gender": g, "pen": pen, "de_pos": i, "ln": ln})
            for h, i in en_heads:
                for dh, dp, _ in de_heads:
                    en_idx[h].append((dh, dp + i))
    return de_idx, en_idx


def score(cand, de_head, en_idx, enf):
    s = cand["pen"] * 2.0 + cand["de_pos"] * 1.2

    # 1. bidirectional confirmation
    back = en_idx.get(cand["en_head"], [])
    positions = [p for d, p in back if d == de_head]
    if positions:
        s -= 4.0 - min(min(positions), 3) * 0.6
    else:
        s += 2.5

    # 2. English frequency, judged by the RAREST content word: "to hoof it"
    #    must not score well just because "it" is frequent.
    head = cand["en_head"].lower()
    words = [w.strip(".,;") for w in re.sub(r"^to ", "", head).split()]
    content = [w for w in words if w not in STOP]
    ranks = [enf.get(w) for w in content]
    if content and all(r is not None for r in ranks):
        s += math.log10(max(ranks) + 10) * 1.6
    elif content:
        s += 7.0                                   # unknown/rare English word

    # 3. placeholders and glosses-as-explanations are bad primary translations
    if re.search(r"\bsb\.|\bsth\.|\bsomeone\b|\bsomething\b|<", head):
        s += 3.0
    s += 0.35 * max(0, len(content) - 2)
    s += cand["ln"] / 1e7
    return s


def best(de_head, de_idx, en_idx, enf, n=4):
    cands = list(de_idx.get(de_head, []))
    if not cands:                       # reflexive verbs live under "sich X"
        cands = list(de_idx.get("sich " + de_head, []))
        cands += list(de_idx.get(de_head + " (sich)", []))
    if not cands:
        return []
    seen, out = set(), []
    for c in sorted(cands, key=lambda c: score(c, de_head, en_idx, enf)):
        if c["en"] in seen:
            continue
        seen.add(c["en"])
        out.append(c)
        if len(out) >= n:
            break
    return out


if __name__ == "__main__":
    de_idx, en_idx = build()
    enf = en_freq_table()
    with open("/tmp/de/ding.pkl", "wb") as fh:
        pickle.dump({"de": dict(de_idx), "en": dict(en_idx), "enf": enf}, fh)
    tests = ["gehen", "Betrieb", "zuverlässig", "nachhaltig", "Haus", "laufen",
             "Angebot", "bewerben", "erhalten", "Umgebung", "anspruchsvoll",
             "Verhalten", "Wirkung", "beteiligen", "Erfahrung", "wesentlich",
             "vermeiden", "Anspruch", "durchführen", "Voraussetzung"]
    for t in tests:
        b = best(t, de_idx, en_idx, enf, 3)
        print(f"{t:16s} -> {[x['en'] for x in b]}", file=sys.stderr)
