#!/usr/bin/env python3
"""Package H: the genealogy of the strip's geometry constants.

For every constant named below, walk `git log -p` of the file it lives in and print each commit that changed a line
assigning it, with the old and new right-hand side. Read-only; prints to stdout (and --json writes
design/strip/H/genealogy.json). Run from the repository root:

    python3 tools/strip/H/genealogy.py [--json]
"""
import json
import re
import subprocess
import sys

# (file, constant name, regex that matches an assignment line of it)
TARGETS = [
    ("design/gen_6wb.py", n, r"^\s*(?:[A-Z_]+\s*,\s*)*" + n + r"(?:\s*,\s*[A-Z_]+)*\s*=") for n in (
        "CC_BOX", "CC_TOP", "CC_TOP_SOFT", "NAV_BAR", "NAV_HOLE", "SIGN_WIN", "SIGN_SOFT", "I_WIN", "WIN_SOFT",
        "HOOK_STUB", "OWN", "COVER", "SHADE", "CC_SYM", "CC_TEXT_C", "CC_TEXT_W", "CC_LINE_Y", "NAV_CX",
        "ROW_BASE", "CUT_Y", "MAP_WINDOW", "MAP_FADE", "FOOT_LINE", "MODE_C")
] + [
    ("tools/overlay/plan_dials.py", n, r"^\s*(?:[A-Z_]+\s*,\s*)*" + n + r"(?:\s*,\s*[A-Z_]+)*\s*=") for n in (
        "COVER_BOX", "SIGN_CLEAR", "SHADE_Y", "SHADE_KO", "I_CLEAR", "CC_CLEAR", "KEEP", "FOOT_Y")
]


def git(*a):
    return subprocess.run(("git",) + a, capture_output=True, text=True, check=False).stdout


def history(path, name, rx):
    pat = re.compile(rx)
    out = git("log", "--format=@@C %h %ad %s", "--date=short", "-p", "--follow", "-U0", "--", path)
    rows, cur, adds, dels = [], None, [], []

    def flush():
        if cur and (adds or dels):
            rows.append(dict(commit=cur[0], date=cur[1], subject=cur[2], removed=dels[:], added=adds[:]))

    for line in out.splitlines():
        if line.startswith("@@C "):
            flush()
            h, d, s = line[4:].split(" ", 2)
            cur, adds, dels = (h, d, s), [], []
        elif line.startswith("+") and not line.startswith("+++"):
            if pat.match(line[1:]):
                adds.append(line[1:].strip())
        elif line.startswith("-") and not line.startswith("---"):
            if pat.match(line[1:]):
                dels.append(line[1:].strip())
    flush()
    rows.reverse()
    return rows


def main():
    res = {}
    for path, name, rx in TARGETS:
        h = history(path, name, rx)
        if not h:
            continue
        res[path + ":" + name] = h
        print("=== %s  (%s)" % (name, path))
        for r in h:
            print("  %s %s %s" % (r["commit"], r["date"], r["subject"][:90]))
            for x in r["removed"]:
                print("     - " + x[:150])
            for x in r["added"]:
                print("     + " + x[:150])
    if "--json" in sys.argv:
        with open("design/strip/H/genealogy.json", "w") as f:
            json.dump(res, f, indent=1)


if __name__ == "__main__":
    main()
