"""The answer record and the evidence rules every decision table uses (package CL).

Evidence carries NUMBERS, ENUM NAMES and FIXED WORDS OF OURS only.  A `shape` is a template written in the code of
this package with numbers filled in; it is never a copy of a log line.  The privacy check (privacy_check.py) rejects
anything else in a derived file.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from car_logs import Line, fmt_ts, rel

# an evidence value may be: int / float / bool / None, an ENUM name, or one of our own short lowercase words
SAFE_WORDS = {
    "white", "red", "yellow", "green", "orange", "default", "none", "grey", "blue", "unknown", "true", "false",
    "rest", "shown", "kept", "member", "flat", "answered", "error", "silent", "arrives", "wired",
    # our apps and the renderer's targets, and the words our tables use as values
    "f30_cluster", "twin_dial", "signal_probe", "car_vitals", "driver_profiles", "panel", "map", "hud", "guide_auto",
    "kombi", "rl3", "average", "travel", "start", "rangeTank", "supreme", "range", "secure", "ms", "s", "other", "limit", "end", "off", "on",
    "opaque", "g20-our-row", "g20-bmw-row", "unknown", "stalk-bit", "indirect-any", "press", "scroll", "provider-not-available",
    "watch-error", "mixed", "car", "sun", "day", "night", "invalid",
}
_ENUM = re.compile(r"^[A-Z_][A-Z0-9_]{0,95}$")
_ID_TOKEN = re.compile(r"^[a-z][a-z0-9_.-]{0,40}$")     # a field tag or a key: ours, never a log's free text


def safe_value(v: Any) -> Any:
    """Return v if it is allowed in evidence, else raise ValueError (a bug in a table, caught by the tests)."""
    if v is None or isinstance(v, (bool, int, float)):
        return v
    if isinstance(v, str):
        if _ENUM.match(v) or v in SAFE_WORDS or re.match(r"^0x[0-9a-fA-F]{1,8}$", v):
            return v
        raise ValueError("unsafe evidence value %r" % v[:40])
    if isinstance(v, (list, tuple)):
        return [safe_value(x) for x in v]
    if isinstance(v, dict):
        return {safe_key(k): safe_value(x) for k, x in v.items()}
    raise ValueError("unsafe evidence value of type %s" % type(v).__name__)


def safe_key(k: str) -> str:
    if not isinstance(k, str) or not re.match(r"^(?:[A-Za-z][A-Za-z0-9_.-]{0,40}|0x[0-9a-fA-F]{1,8}|\d{1,6})$", k):
        raise ValueError("unsafe evidence key %r" % (k,))
    return k


@dataclass
class Evidence:
    file: str
    line: int
    ts: Optional[str]
    shape: str                 # a template of ours, numbers filled in
    n: Dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict:
        return {"file": self.file, "line": self.line, "ts": self.ts, "shape": self.shape, "n": safe_value(self.n)}


def ev(line, shape: str, **n) -> Evidence:
    """Evidence from a Line or ProbeLine (anything with .src, .no, .ts) -- `shape` is OUR template."""
    src = getattr(line, "src", "") or ""
    return Evidence(src, getattr(line, "no", 0), fmt_ts(getattr(line, "ts", None)), shape, n)


STATUSES = ("answered", "partial", "not-yet", "no-material", "manual", "contradicted")
LABELS = ("arrives", "arrives-other-app", "not-sent", "unseen", None)


@dataclass
class Ans:
    id: str
    title: str = ""
    status: str = "not-yet"
    label: Optional[str] = None            # the evidence label of the brief
    decided: Dict[str, Any] = field(default_factory=dict)
    evidence: List[Evidence] = field(default_factory=list)
    why: List[str] = field(default_factory=list)      # sentences of OURS: what was concluded and why
    needs: List[str] = field(default_factory=list)    # what is still missing (an owner's reading, a marker file, a step)
    material: List[str] = field(default_factory=list)  # repo-relative files the answer came from
    dated: Optional[str] = None            # the date of the material (a snapshot answer is marked with it)
    blocks: List[str] = field(default_factory=list)   # spec sections this answer unblocks (from the register or ours)

    def to_json(self) -> dict:
        assert self.status in STATUSES, self.status
        assert self.label in LABELS, self.label
        return {
            "id": self.id, "title": self.title, "status": self.status, "label": self.label,
            "decided": safe_value(self.decided), "evidence": [e.to_json() for e in self.evidence[:24]],
            "evidence_total": len(self.evidence), "why": self.why, "needs": self.needs, "material": self.material,
            "dated": self.dated, "blocks": self.blocks,
        }

    def cite(self, line, shape: str, **n) -> "Ans":
        self.evidence.append(ev(line, shape, **n))
        f = rel_src(line)
        if f and f not in self.material:
            self.material.append(f)
        return self


def rel_src(line) -> str:
    return getattr(line, "src", "") or ""


def mm(a: Optional[float], b: Optional[float]) -> Optional[float]:
    return None if a is None or b is None else round(b - a, 3)
