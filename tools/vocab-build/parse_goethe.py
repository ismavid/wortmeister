#!/usr/bin/env python3
"""Parse the official Goethe-Institut Wortliste PDFs (A1/A2/B1) into structured entries.

Layout model: each page has 1-2 columns; each column has a narrow *headword* band
on the left and an *example sentence* band on the right. We keep only the headword
band, rebuild lines, merge continuation lines into entries, then reduce each entry
to a lemma + the grammatical tail the Goethe list supplies (plural / verb forms).
"""
import json
import re
import sys

import pdfplumber

# file -> (first_page, last_page, [(head_x0, head_x1, col_x1), ...])
SPECS = {
    "A1_SD1_Wortliste_02.pdf": (8, 26, [(118, 223, 600)]),
    "Goethe-Zertifikat_A2_Wortliste.pdf": (7, 30, [(20, 98, 299), (299, 373, 600)]),
    "goethe_b1.pdf": (15, 101, [(30, 129, 309), (309, 419, 600)]),
}
LEVELS = {"A1_SD1_Wortliste_02.pdf": "A1",
          "Goethe-Zertifikat_A2_Wortliste.pdf": "A2",
          "goethe_b1.pdf": "B1"}

NOISE = re.compile(
    r"^(WORTLISTE|GOETHE.*|ZERTIFIKAT.*|INVeNTAre|INVENTARE|WORTSCHATZ|"
    r"Alphabetische[rs]?|ALPHABETISCHER?|wortliste|\d+|[\d_]+\w*_SV|"
    r"\d+_\w+|[A-Za-z]?\d{3,}\w*|Ihre Notizen)$")

# a line that is unmistakably a verb-inflection continuation
CONT = re.compile(r"^(hat|ist|hat/ist|ist/hat)\b|^[a-zäöüß]+,?\s+(hat|ist)\b")


def page_lines(page, band):
    hx0, hx1, _ = band
    words = [w for w in page.extract_words() if hx0 <= w["x0"] < hx1]
    rows = {}
    for w in words:
        rows.setdefault(round(w["top"] / 3.0), []).append(w)
    out = []
    for key in sorted(rows):
        ws = sorted(rows[key], key=lambda w: w["x0"])
        toks = [w["text"] for w in ws if not re.fullmatch(r"\d+\.", w["text"])]
        txt = " ".join(toks).strip()
        if txt:
            out.append(txt)
    return out


def clean_line(t):
    t = re.sub(r"\s*\d+\.\s*", " ", t)                     # example numbering
    t = re.sub(r"\s*\(?(D|A|CH)(,\s*(D|A|CH))*\)?\s*[→>]\s*.*$", "", t)  # regional cross-refs
    t = re.sub(r"\s+", " ", t).strip(" ;")
    return t.strip()


def is_open(t):
    t = t.rstrip()
    if t.endswith((",", "/", "(")):
        return True
    if t.endswith("-") and re.search(r"[A-ZÄÖÜ][\wäöüß]*-$", t):
        return True
    # verb entry that has not yet reached its perfect form
    if re.match(r"^[\w()/ äöüßÄÖÜ.-]+,\s", t) and " hat " not in t and " ist " not in t \
       and re.search(r",\s[a-zäöüß]+(\s[a-zäöüß]+)?$", t):
        return True
    return False


ART_START = re.compile(r"^(der|die|das)\s")


def join(a, b):
    # "das Einkaufs-" + "zentrum, -en" is one compound; "Doppel-" + "das Dorf"
    # is two separate entries that merely happened to wrap.
    if a.endswith("-") and not a.endswith(" -") and not ART_START.match(b):
        return a + b
    return a + " " + b


def parse(path, level):
    first, last, bands = SPECS[path]
    pdf = pdfplumber.open(path)
    entries, buf = [], None
    for pi in range(first, last + 1):
        page = pdf.pages[pi]
        for band in bands:
            for txt in page_lines(page, band):
                txt = clean_line(txt)
                if not txt or NOISE.match(txt):
                    continue
                if len(txt) == 1 and txt.isalpha():
                    continue                                # alphabet divider
                if buf is not None and (is_open(buf) or CONT.match(txt)):
                    buf = join(buf, txt)
                    continue
                if buf is not None:
                    entries.append(buf)
                buf = txt
    if buf:
        entries.append(buf)
    return [{"level": level, "raw": e} for e in entries]


ART = re.compile(r"^\(?(der|die|das)\)?(/(der|die|das))*\s+")


def lemma_of(raw):
    """Reduce a raw entry to (lemma, article, tail)."""
    t = raw.strip()
    art = None
    m = ART.match(t)
    if m:
        art = m.group(1)
        t = t[m.end():]
    head = t.split(",")[0].strip()
    head = re.sub(r"\s*\((Sg\.|Pl\.|sich)\)\s*", " ", head).strip()
    head = head.strip(" .;:!?–—")
    if head.startswith("sich "):
        head = head[5:].strip()
    tail = t[len(t.split(",")[0]):].lstrip(", ").strip()
    return head, art, tail


if __name__ == "__main__":
    allout = []
    for f, lvl in LEVELS.items():
        got = parse(f, lvl)
        for g in got:
            g["lemma"], g["article"], g["tail"] = lemma_of(g["raw"])
        print(f"{lvl}: {len(got)} entries", file=sys.stderr)
        allout += got
    with open("/tmp/de/goethe_raw.json", "w", encoding="utf-8") as fh:
        json.dump(allout, fh, ensure_ascii=False, indent=1)
    print(f"TOTAL {len(allout)}", file=sys.stderr)
