"""Shared reading code for the car-session tools (package CL).

Everything here is READ ONLY and works on files that tools/car/collect.sh (or an earlier session) saved under
reference/car/<date>/.  Nothing in this package opens a network connection.

What it knows how to read
  * an OAP app log (the platform's plain file):   2026-11-14T19:09:21.038Z INFO <message>
  * cluster-render's own log:                      2026-11-14 14:30:12.489 W <message>
  * the journal copy of cluster-render:            2026-11-14T19:10:10.766889Z cluster-render.service cluster-render[31270]: I cluster-render: <message>
  * the probe's lines (shared/twin_probe.js now, the signal_probe app later):
        probe: P3 range-tank #2 t=41.3: fuel=38 mileage=48215 (+2 folded)
  * the owner's marker lines (probe menu "Позначка N").  The exact text is CP's choice (docs/car/CP-REPORT.md); the
    regex below accepts the shapes in MARKER_RES and is the ONE place to extend.

Privacy: the evidence the tools write is built from numbers, enum names and fixed words of ours; nothing here ever
copies a free text from a log into a derived file (see privacy_check.py).
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

# --------------------------------------------------------------------------------------------------------------------
# lines

_RE_OAP = re.compile(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?)Z (\w+) (.*)$")
_RE_CR = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?) ([IWEDT]) (.*)$")
_RE_JOURNAL = re.compile(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?)(?:Z|[+-]\d\d:?\d\d)? (\S+?)(?:\.service)? (\S+?)(?:\[\d+\])?: (.*)$")
_RE_JOURNAL_LEVEL = re.compile(r"^([IWEDT]) (.*)$")


def _epoch(stamp: str) -> float:
    stamp = stamp.replace(" ", "T")
    fmt = "%Y-%m-%dT%H:%M:%S.%f" if "." in stamp else "%Y-%m-%dT%H:%M:%S"
    d = _dt.datetime.strptime(stamp, fmt).replace(tzinfo=_dt.timezone.utc)
    return d.timestamp()


@dataclass
class Line:
    ts: Optional[float]      # seconds since the epoch (the log's own clock, UTC for OAP logs)
    level: str               # INFO WARN ERROR SDK_ERROR ... or I W E for cluster-render
    msg: str
    no: int                  # 1-based line number in the file
    src: str                 # file name (basename)

    def stamp(self) -> str:
        if self.ts is None:
            return "-"
        return _dt.datetime.fromtimestamp(self.ts, _dt.timezone.utc).strftime("%H:%M:%S.%f")[:-3]


def parse_line(text: str, no: int = 0, src: str = "") -> Line:
    text = text.rstrip("\n")
    m = _RE_OAP.match(text)
    if m:
        return Line(_epoch(m.group(1)), m.group(2), m.group(3), no, src)
    m = _RE_CR.match(text)
    if m:
        return Line(_epoch(m.group(1)), m.group(2), m.group(3), no, src)
    m = _RE_JOURNAL.match(text)
    if m and m.group(2).startswith("cluster-render"):
        body = m.group(4)
        lv = _RE_JOURNAL_LEVEL.match(body)
        level, msg = (lv.group(1), lv.group(2)) if lv else ("I", body)
        if msg.startswith("cluster-render: "):
            msg = msg[len("cluster-render: "):]
        return Line(_epoch(m.group(1)), level, msg, no, src)
    return Line(None, "CONT", text, no, src)


def read_lines(path: str) -> List[Line]:
    out: List[Line] = []
    if not os.path.isfile(path):
        return out
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for i, t in enumerate(fh, 1):
            out.append(parse_line(t, i, os.path.basename(path)))
    return out


def read_many(paths: Iterable[str]) -> List[Line]:
    """Several files of one log (the rotated .1 first), merged in time order; a line without a time keeps its place."""
    allv: List[Line] = []
    for p in paths:
        allv.extend(read_lines(p))
    last = None
    keyed = []
    for i, l in enumerate(allv):
        if l.ts is not None:
            last = l.ts
        keyed.append((last if last is not None else -1.0, i, l))
    keyed.sort(key=lambda k: (k[0], k[1]))
    return [k[2] for k in keyed]


def app_log_files(folder: str, app: str) -> List[str]:
    """<folder>/<app>.log.1 then <app>.log, if present (rotation order)."""
    out = []
    for suffix in (".log.2", ".log.1", ".log"):
        p = os.path.join(folder, app + suffix)
        if os.path.isfile(p):
            out.append(p)
    return out


# --------------------------------------------------------------------------------------------------------------------
# numbers and enums

_NUM = re.compile(r"^-?\d+(?:\.\d+)?$")
_HEX = re.compile(r"^0x[0-9a-fA-F]+$")


def num(s) -> Optional[float]:
    """A number from a token like 64, 64(0x40), 0x40, -3, 2.5; else None.  '-' and '?' are None."""
    if s is None:
        return None
    s = str(s).strip()
    m = re.match(r"^(-?\d+(?:\.\d+)?)(?:\(0x[0-9a-fA-F]+\))?$", s)
    if m:
        v = float(m.group(1))
        return int(v) if v == int(v) and "." not in m.group(1) else v
    if _HEX.match(s):
        return int(s, 16)
    return None


def enum_name(s) -> Optional[str]:
    if s is not None and re.match(r"^[A-Z_][A-Z0-9_]{0,95}$", str(s)):
        return str(s)
    return None


# --------------------------------------------------------------------------------------------------------------------
# the probe's lines

_RE_PROBE = re.compile(
    r"^probe:?\s+(?P<p>P\d+)\s+(?P<tag>[A-Za-z0-9_.-]+)\s+#(?P<n>\d+)\s+t=(?P<t>-?\d+(?:\.\d+)?):\s?(?P<body>.*)$")
_RE_FOLDED = re.compile(r"\s*\(\+(\d+) folded\)")
_RE_LASTLINE = re.compile(r"\s*\(the last line for this field\)")
_RE_KV = re.compile(r"([A-Za-z][A-Za-z0-9_.-]*)=((?:\[[^\]]*\])|(?:[^\s\[\]]+))")


@dataclass
class ProbeLine:
    p: str
    tag: str
    n: int
    t: float
    kv: Dict[str, str]
    body: str
    ts: Optional[float]
    no: int
    src: str
    folded: int = 0
    last: bool = False

    def val(self, key: str) -> Optional[float]:
        return num(self.kv.get(key))

    def enum(self, key: str) -> Optional[str]:
        return enum_name(self.kv.get(key))


def parse_probe(line: Line) -> Optional[ProbeLine]:
    m = _RE_PROBE.match(line.msg)
    if not m:
        return None
    body = m.group("body")
    folded = 0
    fm = _RE_FOLDED.search(body)
    if fm:
        folded = int(fm.group(1))
        body = _RE_FOLDED.sub("", body)
    last = bool(_RE_LASTLINE.search(body))
    body = _RE_LASTLINE.sub("", body)
    kv: Dict[str, str] = {}
    for k, v in _RE_KV.findall(body):
        if k not in kv:          # a key repeated in one line (several list entries): the first wins, the body keeps the rest
            kv[k] = v
    return ProbeLine(m.group("p"), m.group("tag"), int(m.group("n")), float(m.group("t")), kv, body,
                     line.ts, line.no, line.src, folded, last)


def probe_lines(lines: Iterable[Line]) -> List[ProbeLine]:
    out = []
    for l in lines:
        pl = parse_probe(l)
        if pl:
            out.append(pl)
    return out


_RE_PROBE_SUMMARY = re.compile(r"^probe:?\s+summary t=(\d+):\s+(\d+) of (\d+) fields have spoken:\s*(.*)$")
_RE_PROBE_SILENT = re.compile(r"^probe:?\s+summary t=(\d+):\s+silent:\s*(.*)$")
# signal_probe fmt=1: per set, seconds after the set was switched on
_RE_SP_SUMMARY = re.compile(r"^probe:?\s+summary (S\d+) \+(\d+)s:\s+(\d+) of (\d+) fields have spoken:\s*(.*)$")
_RE_SP_SILENT = re.compile(r"^probe:?\s+summary (S\d+) \+(\d+)s:\s+silent:\s*(.*)$")
_RE_PROBE_START = re.compile(r"^probe:?\s+(?:twin_probe\s+(\S+)\s+on:|start signal_probe v=(\S+) fmt=(\d+) sets=(\S+))")
_RE_PROBE_ASK = re.compile(r"^probe:?\s+ask (P\d+) ([A-Za-z0-9_.-]+) \(silent at \+(\d+)s\): (.*)$")


def probe_summaries(lines: Iterable[Line]) -> List[dict]:
    """{t, set, spoken, total, heard: [(p, tag, events)], silent: [(p, tag)]} per summary; the tags only, no text."""
    by: Dict[tuple, dict] = {}
    for l in lines:
        m = _RE_PROBE_SUMMARY.match(l.msg)
        m2 = _RE_SP_SUMMARY.match(l.msg)
        if m or m2:
            key = ("all", int(m.group(1))) if m else (m2.group(1), int(m2.group(2)))
            rest = m.group(4) if m else m2.group(5)
            spoken, total = (m.group(2), m.group(3)) if m else (m2.group(3), m2.group(4))
            heard = re.findall(r"(P\d+) ([A-Za-z0-9_.-]+)\((\d+) events", rest)
            d = by.setdefault(key, {"t": key[1], "set": key[0], "heard": [], "silent": [], "no": l.no, "ts": l.ts})
            d.update({"spoken": int(spoken), "total": int(total), "heard": [(a, b, int(c)) for a, b, c in heard]})
            continue
        m = _RE_PROBE_SILENT.match(l.msg)
        m2 = _RE_SP_SILENT.match(l.msg)
        if m or m2:
            key = ("all", int(m.group(1))) if m else (m2.group(1), int(m2.group(2)))
            rest = m.group(2) if m else m2.group(3)
            d = by.setdefault(key, {"t": key[1], "set": key[0], "heard": [], "silent": [], "no": l.no, "ts": l.ts})
            d["silent"] = re.findall(r"(P\d+) ([A-Za-z0-9_.-]+)", rest)
    return sorted(by.values(), key=lambda d: (d["ts"] or 0, d["t"]))


def probe_asks(lines: Iterable[Line]) -> Dict[str, str]:
    """tag -> the outcome of the probe's one read-only getter call for a silent field (one of our fixed words)."""
    out: Dict[str, str] = {}
    for l in lines:
        m = _RE_PROBE_ASK.match(l.msg)
        if m:
            what = m.group(4)
            out[m.group(2)] = ("answered" if what.startswith("answered") else "error" if what.startswith("error or no answer")
                               else "provider-not-available" if what.startswith("provider not available") else "notifier-only" if what.startswith("no getter")
                               else "not-subscribed" if what.startswith("not subscribed") else "watch-error" if what.startswith("watch error") else "other")
    return out


def probe_starts(lines: Iterable[Line]) -> List[Line]:
    return [l for l in lines if _RE_PROBE_START.match(l.msg)]


# --------------------------------------------------------------------------------------------------------------------
# the owner's markers

MARKER_RES = [
    # signal_probe fmt=1 (bake/work/car/pub/CP/LOG-FORMAT.md):  probe: mark M2 t=85.9 tms=85894 sets=S1+S6
    re.compile(r"^probe:?\s+mark\s+M(?P<n>\d+)\b(?:.*?\bt=(?P<t>-?\d+(?:\.\d+)?))?"),
    # probe: mark 12 t=345.6       probe: marker #12       probe: Позначка 12   (CP may print any of these)
    re.compile(r"^probe:?\s+(?:mark(?:er)?|позначка|Позначка)\s*#?(?P<n>\d+)\b(?:.*?\bt=(?P<t>-?\d+(?:\.\d+)?))?", re.I),
    re.compile(r"^probe:?\s+P0\s+mark(?:er)?\s+#?(?P<n>\d+)\b(?:.*?\bt=(?P<t>-?\d+(?:\.\d+)?))?", re.I),
    re.compile(r"^probe:?\s+(?:Позначка|позначка|mark(?:er)?)\s+(?P<n>\d+)\b", re.I),
]


@dataclass
class Marker:
    n: int
    ts: Optional[float]
    t: Optional[float]
    no: int
    src: str


def parse_marker(line: Line) -> Optional[Marker]:
    for r in MARKER_RES:
        m = r.match(line.msg)
        if m:
            t = m.groupdict().get("t")
            return Marker(int(m.group("n")), line.ts, float(t) if t else None, line.no, line.src)
    return None


def markers(lines: Iterable[Line]) -> List[Marker]:
    out = []
    for l in lines:
        mk = parse_marker(l)
        if mk:
            out.append(mk)
    return out


def windows(mks: List[Marker], end_ts: Optional[float]) -> List[Tuple[Marker, Optional[float], Optional[float]]]:
    """[(marker, from_ts, to_ts)] -- each marker opens a window that ends at the next marker (or end_ts)."""
    out = []
    for i, m in enumerate(mks):
        nxt = mks[i + 1].ts if i + 1 < len(mks) else end_ts
        out.append((m, m.ts, nxt))
    return out


# --------------------------------------------------------------------------------------------------------------------
# a session folder

APP_FILES = {
    "f30_cluster": ["f30_cluster"],
    "twin_dial": ["twin_dial"],
    "signal_probe": ["signal_probe"],
    "car_vitals": ["car_vitals"],
    "driver_profiles": ["driver_profiles"],
}


@dataclass
class Session:
    """A folder under reference/car/<date>/.  Files are looked for in the layouts of both the old snapshot
    (oap/, logs/other-apps/, cluster-render/) and the collector's (apps/<app>/, cluster-render/)."""
    root: str
    date: str = ""
    meta: dict = field(default_factory=dict)

    def __post_init__(self):
        self.root = os.path.abspath(self.root)
        self.date = os.path.basename(self.root.rstrip("/"))
        mp = os.path.join(self.root, "session.json")
        if os.path.isfile(mp):
            try:
                with open(mp, "r", encoding="utf-8") as fh:
                    self.meta = json.load(fh)
            except (OSError, ValueError):
                self.meta = {}

    def app_dirs(self, app: str) -> List[str]:
        cands = [os.path.join(self.root, "apps", app), os.path.join(self.root, "oap"),
                 os.path.join(self.root, "logs", "other-apps"), os.path.join(self.root, "logs", app),
                 os.path.join(self.root, "logs", "waze-on-cluster")]
        return [c for c in cands if os.path.isdir(c)]

    def app_logs(self, app: str) -> List[str]:
        """The app's log files, oldest first.  Snapshots named <app>-0712.log are older builds and are NOT returned
        (a decision must come from the build that is on the car); see snapshot_logs()."""
        for d in self.app_dirs(app):
            fs = app_log_files(d, app)
            if fs:
                return fs
        return []

    def snapshot_logs(self, app: str) -> List[str]:
        out = []
        for d in self.app_dirs(app):
            for f in sorted(os.listdir(d)):
                if f.startswith(app + "-") and f.endswith(".log"):
                    out.append(os.path.join(d, f))
        return out

    def lines(self, app: str) -> List[Line]:
        return read_many(self.app_logs(app))

    def settings(self, app: str) -> Optional[dict]:
        for d in self.app_dirs(app):
            for n in (app + "-settings.json", "settings.json"):
                p = os.path.join(d, n)
                if os.path.isfile(p):
                    try:
                        with open(p, "r", encoding="utf-8") as fh:
                            return json.load(fh)
                    except (OSError, ValueError):
                        return None
        return None

    def app_versions(self) -> dict:
        v = self.meta.get("apps")
        if isinstance(v, dict):
            return v
        return {}

    def cluster_render_logs(self) -> List[str]:
        d = os.path.join(self.root, "cluster-render")
        out = []
        for n in ("cluster-render.log.1", "cluster-render.log"):
            p = os.path.join(d, n)
            if os.path.isfile(p):
                out.append(p)
        j = os.path.join(self.root, "logs", "woc-journal")
        for n in ("journal.log.4", "journal.log.3", "journal.log.2", "journal.log.1", "journal.log"):
            p = os.path.join(j, n)
            if os.path.isfile(p):
                out.append(p)
        jd = os.path.join(self.root, "cluster-render", "journal.txt")
        if os.path.isfile(jd):
            out.append(jd)
        return out

    def cluster_render_lines(self) -> List[Line]:
        """Only the lines that came from the cluster-render service (the saved journal also carries the kernel's)."""
        ls = read_many(self.cluster_render_logs())
        # the log file and the journal copy overlap: one event once (same second, same text)
        seen = set()
        out = []
        for l in ls:
            if l.ts is None:
                continue
            k = (int(l.ts), l.msg)
            if k in seen:
                continue
            seen.add(k)
            out.append(l)
        return out

    def status_files(self) -> List[str]:
        d = os.path.join(self.root, "cluster-render")
        out = []
        if os.path.isdir(d):
            for n in sorted(os.listdir(d)):
                if n.startswith("status") and n.endswith(".txt"):
                    out.append(os.path.join(d, n))
        return out


def rel(path: str) -> str:
    """A repository-relative path for evidence (never an absolute home path)."""
    try:
        return os.path.relpath(path, REPO)
    except ValueError:
        return os.path.basename(path)


def fmt_ts(ts: Optional[float]) -> Optional[str]:
    if ts is None:
        return None
    return _dt.datetime.fromtimestamp(ts, _dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
