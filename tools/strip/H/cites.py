"""Package H: which tracked documents and data files cite which reference photo.

A citation is a photo number inside a run that starts with "photo"/"photos"/"rect"/"rects" (e.g. "photos 34, 37,
41 and 43", "rect 08", "on 08/17/42/43"), or a file name under reference/g20/ or reference/ours/, or a measured.json
/ catalogue "photo" key. Prints {photo id: [files]} as JSON. Approximate by construction (a bare "39" in prose is
not counted unless it follows one of those words); good enough to say where a photo's numbers went.

Usage: python3 tools/strip/H/cites.py > design/strip/H/cites.json
"""
import json
import os
import re
import subprocess

IDS = ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "32", "33", "34", "35", "36", "37", "38", "39",
       "40", "41", "42", "43", "60", "61", "62", "63", "64", "65", "66", "67", "68"]
RUN = re.compile(r"\b(?:photos?|rects?|shots?|on)\s+((?:\d\d(?:\s*(?:,|/|and|or|–|-|\+)\s*)?)+)", re.I)
FILE = re.compile(r"reference/(?:g20|ours)/(\d\d)_")
KEY = re.compile(r"\"photo\"\s*:\s*\"(\d\d)\"|\"(\d\d)\"\s*:\s*\{\s*\"file\"")


def main():
    files = subprocess.run(["git", "ls-files", "docs", "design", "shared", "tools", "bench", "apps/f30_cluster/app.json"],
                           capture_output=True, text=True).stdout.split()
    out = {i: set() for i in IDS}
    for f in files:
        if not f.endswith((".md", ".json", ".py", ".js")) or f.startswith(("design/strip/H/", "tools/strip/H/")):
            continue
        try:
            t = open(f, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        if os.path.getsize(f) > 3_000_000:
            continue
        found = set()
        for m in RUN.finditer(t):
            found.update(re.findall(r"\d\d", m.group(1)))
        found.update(FILE.findall(t))
        for a, b in KEY.findall(t):
            found.add(a or b)
        for i in found & set(IDS):
            out[i].add(f)
    print(json.dumps({k: sorted(v) for k, v in out.items()}, indent=1))


if __name__ == "__main__":
    main()
