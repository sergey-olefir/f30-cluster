"""Marker number -> step -> class (package CL).

CQ's design/car/session_marks.json says which session step each "Poznachka N" (log: `probe: mark M<N> ...`) is; the decision
tables need a CLASS of step (a bc-short press, a door opening, ...).  STEP_CLASS is the one table that maps CQ's step ids to the
classes the tables use.  A step of the Twin Dial / f30 repeat (tag twin / f30) gets the class suffixed with the tag, so the stock
analysis is never mixed with it.  Marks restart at 1 in each run of the probe app: a mark's time is the time of its log line, and
the mark -> step map is applied per run (runs are separated by the probe's `start` line).
"""
from __future__ import annotations

import json
import os
from typing import Dict, Optional

STEP_CLASS: Dict[str, str] = {
    "B1.2": "rest-stalk", "B1.3": "bc-short", "B1.4": "bc-short", "B1.5": "bc-short", "B1.6": "bc-long",
    "B1.7": "stalk-left", "B1.8": "stalk-right", "B1.9": "stalk-hold-left", "B1.10": "stalk-flash",
    "B1.11": "thumb-up", "B1.12": "thumb-list-up", "B1.13": "wheel-fav", "B1.14": "wheel-special2", "B1.15": "wheel-skip",
    "B1.16": "wheel-voice", "B1.17": "wheel-phone", "B1.18": "wheel-volume", "B1.19": "controller-turn",
    "B1.20": "msg-bc-short", "B1.21": "cluster-view", "B7.2": "cluster-view",
    "B2.9": "trip-reset", "B2.2": "odometer-read", "B2.3": "trip-read",
    "B3.3": "door-driver", "B3.9": "door-two", "B3.10": "door-driver",
    "B4.12": "src-carplay", "B5.3": "call-phone", "B5.4": "call-phone", "B5.12": "call-carplay", "B5.13": "call-carplay",
    "B6.9": "mode-switch", "B6.12": "mode-switch", "B6.13": "mode-switch", "B6.14": "mode-switch",
    "B6.10": "door-twin", "B6.15": "door-f30",
}
# steps whose class applies to a repeat under Twin Dial / f30 (tag in session_marks.json): the class gets the tag appended
TAGGED = True


def load_marks(path: Optional[str]) -> Dict[str, dict]:
    """{ "<mark number>": {"class": ..., "step": ..., "tag": ...} } from CQ's session_marks.json (marks) or a hand-written markers.json."""
    if not path or not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            d = json.load(fh)
    except (OSError, ValueError):
        return {}
    out: Dict[str, dict] = {}
    if isinstance(d.get("marks"), list):
        for m in d["marks"]:
            step, tag = m.get("step"), m.get("tag") or ""
            cls = STEP_CLASS.get(step)
            if cls and tag in ("twin", "f30") and not cls.endswith(("-twin", "-f30")) and cls.startswith(("bc-", "stalk-", "thumb-", "wheel-", "controller", "msg-")):
                cls = cls + "-" + tag
            out[str(m.get("mark"))] = {"class": cls, "step": step, "tag": tag}
    elif isinstance(d.get("markers"), dict):
        out = {str(k): (v if isinstance(v, dict) else {"class": v}) for k, v in d["markers"].items()}
    return out
