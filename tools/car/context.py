"""What the decision tables read: one session folder, parsed once (package CL)."""
from __future__ import annotations

import bisect
import json
import os
import re
from typing import Dict, List, Optional

import car_logs as cl

APPS = ("f30_cluster", "twin_dial", "signal_probe", "car_vitals", "driver_profiles")
_RE_START = re.compile(r"^starting (\w+) (\S+)$")


def load_json(path: Optional[str]) -> Optional[dict]:
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


class Ctx:
    def __init__(self, session: cl.Session, readings: Optional[dict] = None, marker_map: Optional[dict] = None):
        self.session = session
        self.readings = readings or {}
        self.marker_map = marker_map if isinstance(marker_map, dict) else {}
        self.app_lines: Dict[str, List[cl.Line]] = {a: session.lines(a) for a in APPS}
        self.snapshots: Dict[str, List[str]] = {a: session.snapshot_logs(a) for a in APPS}
        self.settings: Dict[str, Optional[dict]] = {a: session.settings(a) for a in APPS}
        self.probe: List[cl.ProbeLine] = []
        for a in ("signal_probe", "twin_dial", "f30_cluster"):
            for l in self.app_lines.get(a, []):
                pl = cl.parse_probe(l)
                if pl:
                    self.probe.append(pl)
        self.probe.sort(key=lambda p: (p.ts if p.ts is not None else 0, p.no))
        allmk: List[cl.Marker] = []
        for a in ("signal_probe", "twin_dial"):
            allmk.extend(cl.markers(self.app_lines.get(a, [])))
        self.markers = sorted(allmk, key=lambda m: (m.ts if m.ts is not None else 0, m.no))
        self._mk_ts = [m.ts for m in self.markers if m.ts is not None]
        self.cr_lines: List[cl.Line] = session.cluster_render_lines()
        self.versions: Dict[str, str] = {}
        self.starts: Dict[str, List[tuple]] = {}
        for a, ls in self.app_lines.items():
            for l in ls:
                m = _RE_START.match(l.msg)
                if m and m.group(1) == a and l.ts is not None:
                    self.starts.setdefault(a, []).append((l.ts, m.group(2), l))
                    self.versions[a] = m.group(2)

    # ---- time helpers
    def last_ts(self, app: str) -> Optional[float]:
        ts = [l.ts for l in self.app_lines.get(app, []) if l.ts is not None]
        return max(ts) if ts else None

    def first_ts(self, app: str) -> Optional[float]:
        ts = [l.ts for l in self.app_lines.get(app, []) if l.ts is not None]
        return min(ts) if ts else None

    def run_bounds(self, app: str) -> List[tuple]:
        """[(start_ts, end_ts, version)] per app start; the last run ends at the log's last line."""
        st = self.starts.get(app, [])
        out = []
        for i, (ts, ver, _l) in enumerate(st):
            end = st[i + 1][0] if i + 1 < len(st) else self.last_ts(app)
            out.append((ts, end, ver))
        return out

    def marker_at(self, ts: Optional[float]) -> Optional[cl.Marker]:
        """The marker whose window contains ts (the latest marker at or before ts)."""
        if ts is None or not self._mk_ts:
            return None
        i = bisect.bisect_right(self._mk_ts, ts) - 1
        return self.markers[i] if i >= 0 else None

    def marker_class(self, m: Optional[cl.Marker]) -> Optional[str]:
        if m is None:
            return None
        e = self.marker_map.get(str(m.n)) if isinstance(self.marker_map, dict) else None
        if isinstance(e, dict):
            return e.get("class")
        if isinstance(e, str):
            return e
        return None

    def class_windows(self, cls: str) -> List[tuple]:
        """[(from_ts, to_ts, marker_n)] of every marker window labelled `cls` in the marker map."""
        out = []
        ws = cl.windows(self.markers, self.last_any_ts())
        for m, a, b in ws:
            if self.marker_class(m) == cls and a is not None:
                out.append((a, b if b is not None else a + 30.0, m.n))
        return out

    def last_any_ts(self) -> Optional[float]:
        ts = [self.last_ts(a) for a in self.app_lines]
        ts = [t for t in ts if t is not None]
        return max(ts) if ts else None

    def probe_by(self, *tags: str) -> List[cl.ProbeLine]:
        s = set(tags)
        return [p for p in self.probe if p.tag in s]

    def probe_t_max(self) -> float:
        return max([p.t for p in self.probe] or [0.0])

    def summaries(self) -> List[dict]:
        out = []
        for a in ("signal_probe", "twin_dial", "f30_cluster"):
            for s in cl.probe_summaries(self.app_lines.get(a, [])):
                s = dict(s)
                s["app"] = a
                out.append(s)
        return out

    def silent_tags(self) -> Dict[str, float]:
        """tag -> minutes observed (the last summary that lists the tag as silent, else the last probe time)."""
        best: Dict[str, float] = {}
        for s in self.summaries():
            for _p, tag in s.get("silent", []):
                best[tag] = max(best.get(tag, 0.0), s["t"] / 60.0)
        spoke = {p.tag for p in self.probe}
        return {t: m for t, m in best.items() if t not in spoke}      # silent at +30 s but heard later is not silent

    def spoke_tags(self) -> set:
        return {p.tag for p in self.probe}

    def has_material(self) -> bool:
        return any(self.app_lines.values()) or bool(self.cr_lines)
