#!/usr/bin/env python3
"""Emit the app's columnar vocabulary payload plus PWA icons.

Columnar (arrays, not objects) drops the repeated JSON keys and cuts the
payload by ~85%. Rows are sorted by priority rank, so the array index IS the
rank and that column can be dropped too.
"""
import json
import os
import struct
import zlib

APP = os.environ.get("APPDIR",
                     "/sessions/gallant-stoic-faraday/mnt/_Agent/app/german-b2")
os.makedirs(f"{APP}/data", exist_ok=True)
os.makedirs(f"{APP}/icons", exist_ok=True)

vocab = json.load(open("/tmp/de/vocab.json", encoding="utf-8"))
vprep = json.load(open("/tmp/de/verb_prep.json", encoding="utf-8"))
vocab.sort(key=lambda r: r["priority_rank"])

FIELDS = ["id", "lemma", "en", "pos", "level", "article", "plural",
          "prt", "pp", "aux", "p3", "sep", "rection", "priority",
          "freqClass", "fach"]

rows = []
for i, r in enumerate(vocab):
    rows.append([
        i,                                    # id == index == priority rank-1
        r["lemma"],
        r["en"],
        r["pos"],
        r["level"],
        r["article"] or "",
        r["plural"] or "",
        r["praeteritum"] or "",
        r["partizip2"] or "",
        r["aux"] or "",
        r["praesens_3sg"] or "",
        1 if r["separable"] == "yes" else 0,
        r.get("rection") or "",
        r["priority"],
        r["freq_class"] if r["freq_class"] is not None else 16,
        1 if r.get("fachdeutsch") else 0,
    ])

payload = {
    "v": 1,
    "built": "2026-08-08",
    "count": len(rows),
    "fields": FIELDS,
    "words": rows,
    "verbPrep": [[p["verb"], p["prep"], p["case"], p["en"], p["example"]]
                 for p in vprep],
}
out = f"{APP}/data/vocab.v1.json"
with open(out, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
raw = os.path.getsize(out)
gz = len(zlib.compress(open(out, "rb").read(), 9))
print(f"{out}: {raw:,} bytes raw, ~{gz:,} gzipped, {len(rows):,} words")


# ---------------------------------------------------------------- PNG icons
def png(path, size, bg=(11, 15, 25), fg=(122, 162, 247)):
    """Minimal PNG writer - avoids a Pillow dependency."""
    px = []
    cx = cy = size / 2
    # rounded square background with a centred "W" bar motif
    bar_w = max(2, size // 14)
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            c = bg
            dx, dy = abs(x - cx), abs(y - cy)
            r = size * 0.42
            if dx < r and dy < r:
                # W strokes: four diagonals
                t = (y - (size * 0.30)) / (size * 0.40)
                if 0 <= t <= 1:
                    for k, dirn in ((0.30, 1), (0.45, -1), (0.55, 1), (0.70, -1)):
                        sx = size * k + dirn * t * size * 0.10
                        if abs(x - sx) < bar_w:
                            c = fg
            row += bytes(c)
        px.append(bytes(row))
    data = zlib.compress(b"".join(px), 9)

    def chunk(tag, body):
        return (struct.pack(">I", len(body)) + tag + body +
                struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    blob = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", data) + chunk(b"IEND", b""))
    open(path, "wb").write(blob)
    return len(blob)


for s in (192, 512):
    n = png(f"{APP}/icons/icon-{s}.png", s)
    print(f"  icons/icon-{s}.png: {n:,} bytes")
