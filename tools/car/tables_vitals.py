"""What another app's log already says about signals we want (label: arrives-other-app).

car_vitals (a third-party app on this car) logs RAW values of tyre pressure and temperature, the target pressure, the FES boost,
the engine temperatures and the car's units.  Its log is the only evidence on this car for P16's tyres and boost, P6's
temperatures and P5's pressure / temperature units.  The scale of every number is still a hypothesis until a reading of the
car's own page is compared (readings.json: tyres, boost_peak_bar, coolant_c).
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

import car_logs as cl
from context import Ctx

_RE_QUAD = r"\[(\d+),(\d+),(\d+),(\d+)\]"
_RE_TP = re.compile(r"^raw tyre pressure: " + _RE_QUAD + r"$")
_RE_TT = re.compile(r"^raw tyre temperature: " + _RE_QUAD + r"$")
_RE_TG = re.compile(r"^raw target tyre pressure: " + _RE_QUAD + r"$")
_RE_BOOST = re.compile(r"^raw FES boost: (\d+)$")
_RE_ENG = re.compile(r"^raw engine temperatures: \[(\d+),(\d+)\]$")
_RE_UNITS = re.compile(r"^car units: pressure (\w+), temperature (\w+)$")
INVALID = 65535


def vitals(ctx: Ctx) -> Optional[dict]:
    lines = ctx.app_lines.get("car_vitals", [])
    if not lines:
        return None
    out: Dict[str, object] = {"first": None, "last": None, "lines": {}, "first_line": {}}
    tp: List[tuple] = []
    tt: List[tuple] = []
    tg: List[tuple] = []
    bo: List[int] = []
    en: List[tuple] = []
    units = None
    for l in lines:
        m = _RE_TP.match(l.msg)
        if m:
            tp.append(tuple(int(x) for x in m.groups()))
            out["first_line"].setdefault("tyre_pressure", l)
            continue
        m = _RE_TT.match(l.msg)
        if m:
            tt.append(tuple(int(x) for x in m.groups()))
            out["first_line"].setdefault("tyre_temp", l)
            continue
        m = _RE_TG.match(l.msg)
        if m:
            tg.append(tuple(int(x) for x in m.groups()))
            out["first_line"].setdefault("tyre_target", l)
            continue
        m = _RE_BOOST.match(l.msg)
        if m:
            bo.append(int(m.group(1)))
            out["first_line"].setdefault("boost", l)
            continue
        m = _RE_ENG.match(l.msg)
        if m:
            en.append((int(m.group(1)), int(m.group(2))))
            out["first_line"].setdefault("engine_temps", l)
            continue
        m = _RE_UNITS.match(l.msg)
        if m:
            units = (m.group(1), m.group(2))
            out["first_line"].setdefault("units", l)
    ts = [l.ts for l in lines if l.ts]
    out["first"], out["last"] = (min(ts), max(ts)) if ts else (None, None)
    out["tp"], out["tt"], out["tg"], out["boost"], out["eng"], out["units"] = tp, tt, tg, bo, en, units
    return out


def _range(xs: List[int]) -> Optional[List[int]]:
    xs = [x for x in xs if x < 65534 and x != 255]
    return [min(xs), max(xs)] if xs else None


def facts(v: dict) -> dict:
    """Numbers only: ranges of the raw values, the invalid marker, plausible factors against a physical range."""
    d: Dict[str, object] = {}
    if v["tp"]:
        flat = [x for q in v["tp"] for x in q]
        d["tyre_pressure_raw_range"] = _range(flat)
        d["tyre_pressure_invalid_65535_seen"] = any(x >= 65534 for x in flat)
        r = d["tyre_pressure_raw_range"]
        if r:
            d["tyre_pressure_plausible_factors"] = [f for f in (0.01, 0.1, 1) if 1.5 <= r[0] * f and r[1] * f <= 4.0]
        d["tyre_pressure_samples"] = len(v["tp"])
    if v["tg"]:
        flat = [x for q in v["tg"] for x in q]
        d["tyre_target_raw_range"] = _range(flat)
        if v["tp"]:
            last_t = [q for q in v["tg"] if INVALID not in q]
            last_p = [q for q in v["tp"] if INVALID not in q]
            if last_t and last_p:
                diffs = [t - p for t, p in zip(last_t[-1], last_p[-1])]
                d["target_minus_actual_raw_last"] = diffs
    if v["tt"]:
        flat = [x for q in v["tt"] for x in q]
        d["tyre_temp_raw_range"] = _range(flat)
        d["tyre_temp_invalid_65535_seen"] = INVALID in flat
        r = d["tyre_temp_raw_range"]
        d["tyre_temp_plausible_as_celsius_directly"] = bool(r and 0 <= r[0] and r[1] <= 90)
    if v["boost"]:
        d["boost_raw_range"] = [min(v["boost"]), max(v["boost"])]
        d["boost_255_seen"] = 255 in v["boost"]
        d["boost_raw_range_without_255"] = _range(v["boost"])
        d["boost_samples"] = len(v["boost"])
        d["boost_ramp_repeats"] = sum(1 for i in range(1, len(v["boost"])) if v["boost"][i] < v["boost"][i - 1])
    if v["eng"]:
        a = [e[0] for e in v["eng"]]
        b = [e[1] for e in v["eng"]]
        d["engine_temp_raw_range_1"] = [min(a), max(a)]
        d["engine_temp_raw_range_2"] = [min(b), max(b)]
        d["engine_temp_minus_48_plausible"] = all(-10 < x - 48 < 160 for x in a + b)
    if v["units"]:
        pu, tu = v["units"]
        d["pressure_unit"] = pu if re.match(r"^[A-Z]+$", pu) else None
        d["temperature_unit"] = tu if re.match(r"^[A-Z]+$", tu) else None
    return d
