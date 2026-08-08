#!/usr/bin/env python3
"""Parse the thematic 'Wortgruppen' sections of the Goethe Wortlisten.

These pages hold Zahlen, Uhrzeit, Zeit, Farben, Tiere, Länder, Berufe etc. -
real A1/A2/B1 vocabulary that the alphabetical list deliberately omits.
Layout is table-like and irregular, so we pattern-match rather than parse.
"""
import json
import re
import sys

import pdfplumber

SPECS = [("A1_SD1_Wortliste_02.pdf", 4, 7, "A1"),
         ("Goethe-Zertifikat_A2_Wortliste.pdf", 4, 6, "A2"),
         ("goethe_b1.pdf", 7, 14, "B1")]

NOUN = re.compile(r"\b(der|die|das)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß]{1,28})\b")
AFTER_EQ = re.compile(r"=\s*([a-zäöüßA-ZÄÖÜ][A-Za-zÄÖÜäöüß]{1,30})")
BARE = re.compile(r"^[a-zäöüß][a-zäöüß]{2,20}$")

STOPWORDS = {"und", "oder", "der", "die", "das", "den", "dem", "des", "ein",
             "eine", "einen", "einem", "eines", "einer", "aber", "mit", "von",
             "für", "auf", "bei", "aus", "nach", "vor", "über", "unter", "zum",
             "zur", "man", "sie", "wir", "ich", "ist", "sind", "war", "wird",
             "uhr", "seite", "wortliste", "zertifikat", "goethe", "inventare"}


def main():
    out = []
    for path, first, last, level in SPECS:
        pdf = pdfplumber.open(f"/tmp/de/raw/{path}")
        found = set()
        for pi in range(first, min(last, len(pdf.pages) - 1) + 1):
            text = pdf.pages[pi].extract_text() or ""
            for art, noun in NOUN.findall(text):
                found.add((noun, art))
            for w in AFTER_EQ.findall(text):
                if w[:1].isupper():
                    found.add((w, None))
                elif BARE.match(w) and w not in STOPWORDS:
                    found.add((w, None))
            for line in text.split("\n"):
                for tok in re.split(r"[\s/,;()]+", line):
                    tok = tok.strip(".:!?–—-")
                    if BARE.match(tok) and tok not in STOPWORDS and len(tok) >= 4:
                        found.add((tok, None))
        print(f"{level}: {len(found)} thematic candidates", file=sys.stderr)
        for w, art in sorted(found):
            out.append({"level": level, "lemma": w, "article": art or "",
                        "raw": f"{art + ' ' if art else ''}{w}", "tail": "",
                        "src": "thematic"})
    json.dump(out, open("/tmp/de/goethe_themes.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"TOTAL {len(out)}", file=sys.stderr)


if __name__ == "__main__":
    main()
