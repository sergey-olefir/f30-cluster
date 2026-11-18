#!/usr/bin/env python3
"""Privacy check and redaction for everything collected from the car and everything derived from it (package CL).

  python3 -I tools/car/privacy_check.py <folder-or-file>... [--kind logs|derived] [--redact-to DIR] [--quiet]

Rules (brief section 1): numbers, enum names and lengths only.  Never a media title, a station name, a contact name, a phone
number, a call list, a device name, a road name, a coordinate, a bearing, a VIN, a modem's identity, a key or a token.

Two kinds of check
  logs     a raw log or a text file copied from the car.  Flags text that should not be there: letters outside Latin,
           a coordinate pair, a VIN, a phone-like number, an e-mail, a MAC address, an IPv4 address, a token-like string,
           a free text where a probe line must carry a number, a very long quoted string.
  derived  a file this toolchain wrote (answers.json, patches).  Every string must be ASCII and short and must match none
           of the rules above; numbers, booleans and null are always fine.

Exit status 0 = nothing flagged, 1 = something flagged, 2 = usage.  With --redact-to every flagged span in a log is
replaced by <redacted:rule> in a copy written under DIR (the original is never changed).
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Dict, Iterable, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

# symbols our own log lines use; anything else non-ASCII is text
ALLOWED_NONASCII = set("→÷×ø°·…–—‑’“”é −±≈≤≥§")

RULES: List[Tuple[str, "re.Pattern"]] = [
    ("coordinate", re.compile(r"(?<![\d.])-?\d{1,3}\.\d{4,}\s*[,;/ ]\s*-?\d{1,3}\.\d{4,}(?![\d.])")),
    ("vin", re.compile(r"\b(?=[A-HJ-NPR-Z0-9]{17}\b)(?=(?:[^0-9]*[0-9]){3})(?=(?:[^A-Z]*[A-Z]){3})[A-HJ-NPR-Z0-9]{17}\b")),
    ("phone", re.compile(r"(?<![\w.])(?:\+\d[\d ()\-]{7,}\d|\(\d{2,4}\)[ \-]?\d[\d \-]{5,}\d|\d{2,4}[ \-]\d{3}[ \-]\d{2,4}[ \-]\d{2,4})(?![\w.])")),
    ("email", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
    ("mac", re.compile(r"\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b")),
    ("ip", re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")),
    ("token", re.compile(r"(?<![A-Za-z0-9_])(?=[A-Za-z0-9+_-]*[a-z])(?=[A-Za-z0-9+_-]*[A-Z])(?=[A-Za-z0-9+_-]*\d)(?!(?:[A-Za-z0-9+-]*_){4})[A-Za-z0-9+_-]{32,}={0,2}(?![A-Za-z0-9_/])")),
    ("token", re.compile(r"(?<![\w-])[0-9a-f]{40,}(?![\w-])")),
]
_RE_NONLATIN = re.compile(r"[^\x00-\x7f]")

# lines whose key=value pairs must be numbers / enum names / lengths
_RE_PROBE_KV = re.compile(r"([A-Za-z][A-Za-z0-9_.-]*)=((?:\[[^\]]*\])|(?:[^\s\[\]]+))")
_ENUMISH = re.compile(r"^(?:[A-Z_][A-Z0-9_]*|-|\?|true|false|none|unknown|-?\d+(?:\.\d+)?(?:\(0x[0-9a-f]+\))?|0x[0-9a-f]+|[a-z]+-range|[A-Z0-9_]+(?:[+/][A-Z0-9_,*]+)*|[A-Z_]+/\d+|\d+(?:\.\d+)?~?|member|flat|\d+/\d+)$")
_LENKEY = re.compile(r"(?:^|-)len$|-len$|^len$|chars$")
_RE_PROBE_PREFIX = re.compile(r"^(?:\S+ )?\w+ probe:? P\d+ ")
_FREE_TEXT_KEYS = re.compile(r"^(?:name|title|artist|text|number|station|album|caller|contact|road|street|address|ssid|friendly\w*)$", re.I)


class Hit:
    def __init__(self, path: str, line: int, rule: str, span: Tuple[int, int]):
        self.path, self.line, self.rule, self.span = path, line, rule, span

    def __repr__(self) -> str:
        return "%s:%d: %s" % (self.path, self.line, self.rule)


def scan_line(text: str, probe: bool = False) -> List[Tuple[str, Tuple[int, int]]]:
    """[(rule, (start, end))] for one log line (the text is never returned: callers report rule and place only)."""
    hits: List[Tuple[str, Tuple[int, int]]] = []
    for name, rx in RULES:
        for m in rx.finditer(text):
            if name == "ip" and (_is_version_like(text, m) or m.group(0).startswith(("127.", "0.0.0.0"))):
                continue
            hits.append((name, m.span()))
    for m in _RE_NONLATIN.finditer(text):
        if m.group(0) in ALLOWED_NONASCII:
            continue
        hits.append(("non-latin-text", m.span()))
        break
    if probe or _RE_PROBE_PREFIX.match(text):
        for m in _RE_PROBE_KV.finditer(text):
            k, v = m.group(1), m.group(2)
            if v.startswith("["):
                continue
            # a text member is logged as its LENGTH: *-len carries a number, and a key that names a text never carries letters
            if _LENKEY.search(k) and not re.match(r"^(?:\d+|-|\?)$", v):
                hits.append(("free-text-where-a-number-belongs", m.span()))
            elif _FREE_TEXT_KEYS.match(k) and not re.match(r"^(?:-?\d+(?:\.\d+)?|-|\?|true|false|known|unknown|set)$", v):
                hits.append(("free-text-where-a-number-belongs", m.span()))
    return hits


def _is_version_like(text: str, m: "re.Match") -> bool:
    # kernel / library versions such as 1.2.3.4 next to a word 'version' or 'v'; ramses lines carry these
    pre = text[max(0, m.start() - 12):m.start()].lower()
    return "version" in pre or pre.rstrip().endswith("v") or "ramses" in pre


def scan_file(path: str, kind: str = "logs") -> List[Hit]:
    hits: List[Hit] = []
    base = os.path.basename(path)
    if base in ("component.json",):
        return hits
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for i, t in enumerate(fh, 1):
            for rule, span in scan_line(t.rstrip("\n")):
                hits.append(Hit(path, i, rule, span))
            if len(t) > 4000 and not t.startswith(" ") and kind == "logs":
                hits.append(Hit(path, i, "very-long-line", (0, len(t))))
    return hits


def redact_text(text: str) -> Tuple[str, int]:
    out: List[str] = []
    n = 0
    for line in text.split("\n"):
        hs = sorted(scan_line(line), key=lambda h: h[1][0], reverse=True)
        taken: List[Tuple[int, int]] = []
        for rule, (a, b) in hs:
            if any(a < y and b > x for x, y in taken):
                continue
            line = line[:a] + "<redacted:%s>" % rule + line[b:]
            taken.append((a, b))
            n += 1
        out.append(line)
    return "\n".join(out), n


# --------------------------------------------------------------------------------------------------------------------

DERIVED_MAX = 260


def check_derived(obj, where: str = "$") -> List[Tuple[str, str]]:
    """[(path, rule)] for every string in a derived JSON structure that breaks the rules."""
    bad: List[Tuple[str, str]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            bad += check_derived(k, where + ".<key>") if isinstance(k, str) else []
            bad += check_derived(v, where + "." + str(k))
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            bad += check_derived(v, "%s[%d]" % (where, i))
    elif isinstance(obj, str):
        if len(obj) > DERIVED_MAX:
            bad.append((where, "long-string"))
        if _RE_NONLATIN.search(obj) and not all(c in ALLOWED_NONASCII for c in _RE_NONLATIN.findall(obj)):
            bad.append((where, "non-ascii-text"))
        is_path = re.match(r"^(?:reference|bake|design|tools|docs|apps|shared|kit)/[\w./-]+$", obj) is not None
        for name, rx in RULES:
            if name == "token" and is_path:
                continue
            if rx.search(obj):
                bad.append((where, name))
    return bad


# --------------------------------------------------------------------------------------------------------------------

def iter_files(paths: Iterable[str]) -> Iterable[str]:
    for p in paths:
        if os.path.isdir(p):
            for r, ds, fs in os.walk(p):
                ds[:] = sorted(d for d in ds if d not in ("redacted", ".git", "node_modules"))
                for f in sorted(fs):
                    if f.endswith((".log", ".txt", ".json", ".md", ".1", ".2", ".3", ".4", ".js")) or ".log." in f:
                        yield os.path.join(r, f)
        elif os.path.isfile(p):
            yield p


def main(argv: List[str]) -> int:
    kind = "logs"
    redact_to: Optional[str] = None
    quiet = False
    paths: List[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--kind":
            kind = argv[i + 1]
            i += 2
        elif a == "--redact-to":
            redact_to = argv[i + 1]
            i += 2
        elif a == "--quiet":
            quiet = True
            i += 1
        elif a in ("-h", "--help"):
            print(__doc__)
            return 0
        else:
            paths.append(a)
            i += 1
    if not paths:
        print(__doc__)
        return 2
    total = 0
    by_rule: Dict[str, int] = {}
    files_hit = 0
    for f in iter_files(paths):
        if kind == "derived" and f.endswith(".json"):
            try:
                with open(f, "r", encoding="utf-8") as fh:
                    obj = json.load(fh)
            except (OSError, ValueError):
                continue
            bad = check_derived(obj)
            for where, rule in bad:
                by_rule[rule] = by_rule.get(rule, 0) + 1
                total += 1
                if not quiet:
                    print("%s: %s at %s" % (f, rule, where))
            if bad:
                files_hit += 1
            continue
        hs = scan_file(f, kind)
        if hs:
            files_hit += 1
        for h in hs:
            by_rule[h.rule] = by_rule.get(h.rule, 0) + 1
            total += 1
            if not quiet and total <= 200:
                print("%s:%d: %s" % (f, h.line, h.rule))
        if hs and redact_to:
            with open(f, "r", encoding="utf-8", errors="replace") as fh:
                red, n = redact_text(fh.read())
            dest = os.path.join(redact_to, os.path.basename(f))
            os.makedirs(redact_to, exist_ok=True)
            with open(dest, "w", encoding="utf-8") as oh:
                oh.write(red)
    print("privacy check: %d hit(s) in %d file(s)%s" % (total, files_hit, ("; by rule " + ", ".join("%s %d" % kv for kv in sorted(by_rule.items()))) if by_rule else ""))
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
