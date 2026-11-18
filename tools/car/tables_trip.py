"""Trip computer and odometer: L4, L5, P3, P4, P5 (docs/research3/MK-REPORT.md sections 3, 6, 7; MK-PROTOCOL.md; PROBE-PROTOCOL P3-P5).

The catalogue states no unit for any of these members.  Every factor is a hypothesis until a number the car shows is
compared with a raw number the car sent.  The owner's reading goes into readings.json (numbers only, see README):

  "odometer_km": 48215,
  "trip": {"since_start": {"cons": 6.8, "speed": 41, "way": 12.4, "time": [0, 43], "from": [14, 0]},
           "other":       {"cons": 7.1, "speed": 55, "way": 80.2, "time": [1, 31], "from": [8, 30]}},
  "units": {"distance": "km", "temperature": "C", "pressure": "bar"},
  "at_marker": 41          (optional: take the raw values nearest this marker instead of the last ones)

Without a reading the tables still say what arrives, which sources are silent, and which factors pass the distance / time
cross-check (the cross-check fixes the RATIO of two factors, not their size: that needs one reading or the plausible range).
"""
from __future__ import annotations

import math
import re
from typing import Dict, List, Optional, Tuple

import car_logs as cl
from context import Ctx
from tables_base import Ans

ODO_BAD = 16777215
PLAUSIBLE = {"speed": (0, 250), "cons": (0, 99.9), "way": (0, 99999)}
FACTORS = (0.001, 0.01, 0.1, 1, 10)

# ---- line shapes of Twin Dial (shared/twin_tokens.js) ---------------------------------------------------------------
_RE_NEW = re.compile(r"^(trip|odometer) (\w+) \((\w+)\) (first|#\d+) at ([\d.]+) s: raw (.*?) -> (.*)$")
_RE_OLD_TRIP = re.compile(r"^trip (average|travel|departure) raw \(P4\): (.*)$")
_RE_OLD_ODO = re.compile(r"^odometer raw \(P3\): (\S+) -> (.*)$")
_RE_SUMMARY = re.compile(r"^trip summary #(\d+) at ([\d.]+) s: heard (.*?); SILENT (.*)$")
_RE_SHOWS = re.compile(r"^trip shows: (.*)$")
_RE_CHECK = re.compile(r"^trip check( \[(\w+)\])?: (OUT OF RANGE .*|distance / time = ([\d.]+) km/h, average speed ([\d.]+) km/h, ratio ([\d.]+) -> (.*))$")
_RE_GETTER = re.compile(r"^trip getter (\w+) \((\S+), silent\): (.*)$")
_RE_ODO_FIRST = re.compile(r"^odometer raw \(P3\): (\S+) -> (.*?)( \[(\w+), first at ([\d.]+) s.*\])?$")


def kv_nums(raw: str) -> Dict[str, Optional[float]]:
    """'speed1=410 cons1=68 speedUnit=KM_S_H' -> numbers and (for enums) a string; '-' -> None."""
    d: Dict[str, object] = {}
    for k, v in re.findall(r"([A-Za-z][A-Za-z0-9_]*)=(\S+)", raw):
        n = cl.num(v)
        d[k] = n if n is not None else (cl.enum_name(v) if cl.enum_name(v) else None)
    return d


def arrivals(ctx: Ctx) -> Dict[str, List[dict]]:
    """source -> [{ts, line, raw: {member: number|enum}}] from Twin Dial's log (new and 0.1.0 shapes) and from the probe."""
    out: Dict[str, List[dict]] = {}

    def add(src, l, raw, via):
        out.setdefault(src, []).append({"ts": l.ts, "line": l, "raw": raw, "via": via})

    for l in ctx.app_lines.get("twin_dial", []):
        m = _RE_NEW.match(l.msg)
        if m:
            what, src = m.group(1), m.group(2)
            raw = m.group(6)
            if what == "trip" and src == "rl3":
                r = kv_nums(raw)
                mt = re.search(r"trip=(-|\d+)d(-|\d+)h(-|\d+)m", raw)
                if mt:
                    r["tripDay"], r["tripH"], r["tripM"] = [cl.num(x) for x in mt.groups()]
                mr = re.search(r"reset=(-|\d+):(-|\d+)", raw)
                if mr:
                    r["resetH"], r["resetM"] = [cl.num(x) for x in mr.groups()]
                add("rl3", l, r, "log")
            else:
                add(src, l, kv_nums(raw), "log")
            continue
        m = _RE_OLD_TRIP.match(l.msg)
        if m:
            nums = [None if x == "x" else float(x) for x in m.group(2).split(",")]
            what = m.group(1)
            if what == "average" and len(nums) == 4:
                add("average", l, {"speed1": nums[0], "cons1": nums[1], "speed2": nums[2], "cons2": nums[3]}, "log0.1.0")
            elif what == "travel" and len(nums) == 3:
                add("travel", l, {"hours": nums[0], "minutes": nums[1], "way": nums[2]}, "log0.1.0")
            elif what == "departure" and len(nums) == 2:
                add("start", l, {"hour": nums[0], "minute": nums[1]}, "log0.1.0")
            continue
        m = _RE_OLD_ODO.match(l.msg)
        if m:
            v = cl.num(m.group(1))
            add("rangeTank", l, {"mileage": v}, "log0.1.0")
    # the probe's own lines
    for p in ctx.probe:
        if p.tag == "bc-average":
            add("average", p, {k: p.val(k) for k in ("speed1", "cons1", "speed2", "cons2")} | {"speedUnit": p.enum("speedUnit"), "consUnit": p.enum("consUnit")}, "probe")
        elif p.tag == "bc-travel":
            add("travel", p, {k: p.val(k) for k in ("hours", "minutes", "way")}, "probe")
        elif p.tag == "bc-start":
            add("start", p, {"hour": p.val("hour"), "minute": p.val("minute")}, "probe")
        elif p.tag in ("bc-all3", "bc-all1"):
            add("rl3", p, {"option": p.enum("option"), "speed": p.val("speedAvg"), "consDigit": p.val("consAvgDigit"), "consScale": p.val("consAvgScale"),
                           "way": p.val("distance"), "tripDay": p.val("tripDay"), "tripH": p.val("tripH"), "tripM": p.val("tripM"),
                           "resetH": p.val("resetH"), "resetM": p.val("resetMi")}, "probe")
        elif p.tag == "range-tank":
            add("rangeTank", p, {"mileage": p.val("mileage"), "range": p.val("range")}, "probe")
        elif p.tag == "range-alt":
            add("range", p, {"mileage": p.val("mileage")}, "probe")
        elif p.tag == "mileage-supreme":
            add("supreme", p, {"mileage": p.val("mileage"), "qualifier": p.enum("qualifier")}, "probe")
        elif p.tag == "mileage-secure":
            add("secure", p, {"mileage": p.val("mileage"), "manipulation": p.val("manipulation")}, "probe")
    return out


def _latest(series: List[dict], at_ts: Optional[float] = None) -> Optional[dict]:
    if not series:
        return None
    s = [x for x in series if x["ts"] is not None]
    if at_ts is not None:
        s = [x for x in s if x["ts"] <= at_ts + 5.0] or s
    return s[-1] if s else None


def _reading_ts(ctx: Ctx) -> Optional[float]:
    n = ctx.readings.get("at_marker")
    if n is None:
        return None
    for m in ctx.markers:
        if m.n == n:
            return m.ts
    return None


def match_factor(raw: Optional[float], shown: Optional[float], decimals: int) -> Optional[float]:
    """The factor in FACTORS for which raw * factor equals `shown` to its printed precision, or None."""
    if raw is None or shown is None:
        return None
    tol = 0.5 * 10 ** (-decimals) + 1e-9
    hits = [f for f in FACTORS if abs(raw * f - shown) <= tol]
    return hits[0] if hits else None


def _decimals(x) -> int:
    s = repr(float(x))
    return len(s.split(".")[1].rstrip("0")) if "." in s and s.split(".")[1].strip("0") else 0


# --------------------------------------------------------------------------------------------------------------------

def l4_trip(ctx: Ctx) -> Tuple[Ans, Ans]:
    """L4 (do the fields arrive) and P4 (factors, the counter, the departure's zone, the cross-check)."""
    l4 = Ans("L4", "Twin Dial's trip fields: arrive or not; raw values against iDrive's trip page")
    p4 = Ans("P4", "trip computer: factors, which counter is 'since start', the departure time, the cross-check")
    arr = arrivals(ctx)
    td = ctx.app_lines.get("twin_dial", [])
    trip_srcs = ["average", "travel", "start", "rl3"]
    got = {s: len(arr.get(s, [])) for s in trip_srcs}
    summ = [(l, _RE_SUMMARY.match(l.msg)) for l in td if _RE_SUMMARY.match(l.msg)]
    getters = [(l, _RE_GETTER.match(l.msg)) for l in td if _RE_GETTER.match(l.msg)]
    sub_lines = [l for l in td if l.msg.startswith("signal KombiIF ")]
    if not td and not ctx.probe:
        for a in (l4, p4):
            a.status = "no-material"
            a.needs.append("twin_dial.log of the build on the car (collect.sh finds its data folder)")
        return l4, p4
    any_arr = any(got.values())
    # ---- L4
    d4: Dict[str, object] = {"arrived": {s: got[s] for s in trip_srcs}, "builds_with_summary": len(summ)}
    gt = {}
    for l, m in getters:
        src, what = m.group(1), m.group(3)
        gt[src] = ("answered" if what.startswith("answered") else "provider-not-available" if what.startswith("provider not available")
                   else "error" if what.startswith("error or no answer") else "watch-error" if what.startswith("watch error")
                   else "other")
        l4.cite(l, "trip getter for %s: %s" % (src, gt[src].replace("-", " ")), source_n=0)
    if gt:
        d4["getter_outcome"] = gt
    l4.decided = d4
    if any_arr:
        l4.status = "answered"
        l4.label = "arrives"
        for s in trip_srcs:
            if arr.get(s):
                x = arr[s][0]
                l4.cite(x["line"], "first %s line (%s)" % (s, x["via"]), **{k: v for k, v in x["raw"].items() if v is not None and not isinstance(v, str)})
        l4.why.append("raw numbers are in the evidence; the shown value needs a reading of iDrive's trip page (readings.json) to be compared")
    elif summ or getters or sub_lines:
        l4.status = "answered"
        l4.label = "not-sent"
        last = max([float(m.group(2)) for _l, m in summ] or [0.0])
        d4["observed_minutes"] = round(last / 60.0, 1)
        l4.why.append("no trip line arrived while the build's summary ran; the getters' outcomes say why (answered / error / no provider)")
    else:
        l4.status = "partial"
        l4.label = "unseen"
        l4.needs.append("a Twin Dial run of 3+ minutes (the summary comes at 2 and 10 minutes)")
        l4.why.append("the log has no trip line and no summary: either the build predates the lines or it did not run long enough")
    l4.material = sorted({cl.rel(p) for p in ctx.session.app_logs("twin_dial")})
    # ---- P4
    d: Dict[str, object] = {}
    rd = (ctx.readings.get("trip") or {})
    ss = rd.get("since_start") if isinstance(rd, dict) else None
    at = _reading_ts(ctx)
    A = _latest(arr.get("average", []), at)
    T = _latest(arr.get("travel", []), at)
    S = _latest(arr.get("start", []), at)
    R = _latest(arr.get("rl3", []), at)
    if not (A or T or S or R):
        p4.status = l4.status if l4.status != "answered" else "partial"
        p4.label = l4.label
        p4.needs.append("trip lines in the log (see L4)")
        p4.decided = {"sources": {s: got[s] for s in trip_srcs}}
        return l4, p4
    p4.label = "arrives"
    if A:
        p4.cite(A["line"], "average raw speed1=%s cons1=%s speed2=%s cons2=%s" % tuple(_f(A["raw"].get(k)) for k in ("speed1", "cons1", "speed2", "cons2")),
                **{k: A["raw"].get(k) for k in ("speed1", "cons1", "speed2", "cons2")})
        for k in ("speedUnit", "consUnit"):
            if isinstance(A["raw"].get(k), str):
                d[k] = A["raw"][k]
    if T:
        p4.cite(T["line"], "travel raw hours=%s minutes=%s way=%s" % tuple(_f(T["raw"].get(k)) for k in ("hours", "minutes", "way")),
                **{k: T["raw"].get(k) for k in ("hours", "minutes", "way")})
    if S:
        p4.cite(S["line"], "departure raw hour=%s minute=%s" % (_f(S["raw"].get("hour")), _f(S["raw"].get("minute"))), hour=S["raw"].get("hour"), minute=S["raw"].get("minute"))
    # the distance / time cross-check, from raw: which (way factor, speed factor) pairs are consistent
    cross = None
    if A and T:
        hrs = (T["raw"].get("hours") or 0) + (T["raw"].get("minutes") or 0) / 60.0
        way = T["raw"].get("way")
        out = []
        if hrs >= 0.05 and way is not None:
            for bc in (1, 2):
                sp = A["raw"].get("speed%d" % bc)
                if sp is None or sp in (4095, 65535):
                    continue
                for fw in FACTORS:
                    for fs in FACTORS:
                        v = way * fw / hrs
                        ratio = (sp * fs) / v if v > 0 else None
                        if ratio is None:
                            continue
                        if 0.9 <= ratio <= 3.0 and PLAUSIBLE["speed"][0] <= sp * fs <= PLAUSIBLE["speed"][1] and way * fw <= 6553.5 * 1.0001:
                            out.append((bc, fw, fs, round(ratio, 2)))
        cross = out
        d["cross_check_pairs"] = [{"bc": b, "way": fw, "speed": fs, "ratio": r} for b, fw, fs, r in out[:12]]
        d["cross_check_ratio_fixed"] = sorted({round(fw / fs, 3) for _b, fw, fs, _r in out})[:6]
        d["cross_check_note"] = "the ratio way-factor / speed-factor is what the cross-check fixes; the size needs a reading"
    # the app's own check lines
    for l in td:
        m = _RE_CHECK.match(l.msg)
        if m and m.group(4):
            d.setdefault("app_check", []).append({"source": m.group(2) or "kombi", "ratio": float(m.group(6)),
                                                  "consistent": not m.group(7).startswith("a factor is about 10x off")})
            p4.cite(l, "the app's own distance / time check: ratio %s" % m.group(6), ratio=float(m.group(6)))
            if len(d["app_check"]) >= 4:
                break
    # factors against a reading
    patches: Dict[str, object] = {}
    if isinstance(ss, dict):
        res: Dict[str, object] = {}
        bc_votes = {1: 0, 2: 0}
        if A:
            for bc in (1, 2):
                n_ok = 0
                if isinstance(ss.get("speed"), (int, float)) and match_factor(A["raw"].get("speed%d" % bc), ss["speed"], _decimals(ss["speed"])) is not None:
                    n_ok += 1
                if isinstance(ss.get("cons"), (int, float)) and match_factor(A["raw"].get("cons%d" % bc), ss["cons"], _decimals(ss["cons"])) is not None:
                    n_ok += 1
                bc_votes[bc] = n_ok
            bc = 1 if bc_votes[1] >= bc_votes[2] else 2
            if bc_votes[bc] > 0:
                res["bc"] = bc
                patches["bc"] = bc
                f_sp = match_factor(A["raw"].get("speed%d" % bc), ss.get("speed"), _decimals(ss["speed"])) if isinstance(ss.get("speed"), (int, float)) else None
                f_co = match_factor(A["raw"].get("cons%d" % bc), ss.get("cons"), _decimals(ss["cons"])) if isinstance(ss.get("cons"), (int, float)) else None
                if f_sp is not None:
                    res["speed"] = f_sp
                    patches["speed"] = f_sp
                if f_co is not None:
                    res["cons"] = f_co
                    patches["cons"] = f_co
        if T and isinstance(ss.get("way"), (int, float)):
            f_w = match_factor(T["raw"].get("way"), ss["way"], _decimals(ss["way"]))
            if f_w is not None:
                res["way"] = f_w
                patches["way"] = f_w
        if T and isinstance(ss.get("time"), list) and len(ss["time"]) == 2:
            res["time_equal"] = (T["raw"].get("hours"), T["raw"].get("minutes")) == (ss["time"][0], ss["time"][1])
        if S and isinstance(ss.get("from"), list) and len(ss["from"]) == 2:
            raw_m = S["raw"].get("hour") * 60 + S["raw"].get("minute") if S["raw"].get("hour") is not None and S["raw"].get("minute") is not None else None
            sh_m = ss["from"][0] * 60 + ss["from"][1]
            if raw_m is not None:
                diff = ((sh_m - raw_m + 720) % 1440) - 720
                res["departure_offset_min"] = diff
                res["departure_local"] = diff == 0
                if diff != 0 and diff % 15 == 0:
                    patches["departureUtc"] = ["kombi"]
        if R:
            rr = R["raw"]
            f = {}
            if isinstance(ss.get("speed"), (int, float)):
                f["speed"] = match_factor(rr.get("speed"), ss["speed"], _decimals(ss["speed"]))
            if isinstance(ss.get("cons"), (int, float)):
                f["cons"] = match_factor(rr.get("consDigit"), ss["cons"], _decimals(ss["cons"]))
            if isinstance(ss.get("way"), (int, float)):
                f["way"] = match_factor(rr.get("way"), ss["way"], _decimals(ss["way"]))
            res["rl3"] = {k: v for k, v in f.items() if v is not None}
            if res["rl3"]:
                patches["rl3"] = res["rl3"]
        d["reading_match"] = res
        d["patch_trip_factors"] = patches
        if res:
            p4.status = "answered"
        else:
            p4.status = "partial"
            p4.why.append("the reading does not match any raw value at any factor of 0.001 .. 10: a wrong member, or the reading and the log are from different moments (set at_marker)")
    else:
        p4.status = "partial"
        p4.needs.append("the owner's reading of iDrive's trip page (readings.json: trip.since_start)")
        # the best guess with no reading: factors whose results are plausible and cross-check-consistent
        if cross:
            fw = {}
            for _b, a_, b_, _r in cross:
                fw[(a_, b_)] = fw.get((a_, b_), 0) + 1
            d["unverified_default"] = {"way": 0.1, "speed": 0.1, "cons": 0.1}
    p4.decided = d
    p4.material = l4.material
    p4.dated = (cl.fmt_ts(ctx.last_ts("twin_dial")) or "")[:10] if ctx.last_ts("twin_dial") else None
    return l4, p4


def _f(x):
    return "-" if x is None else (str(int(x)) if isinstance(x, float) and x == int(x) else str(x))


# --------------------------------------------------------------------------------------------------------------------

def l5_p3(ctx: Ctx) -> Tuple[Ans, Ans]:
    """L5 (the odometer member arrives) and P3 (which carrier, which factor, the invalid values)."""
    l5 = Ans("L5", "the odometer member arrives; factor 1 km")
    p3 = Ans("P3", "odometer: carriers, factor, invalid values")
    arr = arrivals(ctx)
    carriers = ["rangeTank", "supreme", "range", "secure"]
    have = {c: arr.get(c, []) for c in carriers}
    td_lines = ctx.app_lines.get("twin_dial", [])
    if not any(have.values()):
        for a in (l5, p3):
            a.status = "no-material" if not td_lines and not ctx.probe else "partial"
            a.label = "unseen" if td_lines or ctx.probe else None
            a.needs.append("a Twin Dial log (odometer line) or the probe's P3 lines")
        return l5, p3
    cluster_km = ctx.readings.get("odometer_km")
    d: Dict[str, object] = {}
    valid_by = {}
    for c in carriers:
        series = have[c]
        if not series:
            continue
        vals = [x["raw"].get("mileage") for x in series if x["raw"].get("mileage") is not None]
        bad = sorted({v for v in vals if v in (0, ODO_BAD) or v >= ODO_BAD})
        ok = [v for v in vals if 0 < v < ODO_BAD]
        d[c] = {"lines": len(series), "valid": len(ok), "last": ok[-1] if ok else None, "invalid_seen": bad}
        if ok:
            valid_by[c] = ok[-1]
    # the file's own `none` values
    l5.decided = {"carriers_arrived": [c for c in carriers if have[c]], "rangeTank_arrived": bool(have["rangeTank"])}
    first = None
    for c in carriers:
        if have[c]:
            first = have[c][0]
            break
    l5.cite(first["line"], "first odometer line (%s), raw %s" % (first["via"], _f(first["raw"].get("mileage"))), mileage=first["raw"].get("mileage"))
    l5.label = "arrives"
    l5.status = "answered" if valid_by else "partial"
    if not valid_by:
        l5.why.append("only invalid values (0 or 16777215) arrived: the member carries no odometer on this car; the app falls back to the next carrier")
    own = ctx.readings.get("odometer_shown_on_0_1_0")
    if isinstance(own, bool):
        l5.decided["owner_saw_the_number"] = own
    p3.label = "arrives"
    best = None
    if isinstance(cluster_km, (int, float)):
        scored = []
        for c, v in valid_by.items():
            f = match_factor(v, cluster_km, 0) if abs(v - cluster_km) > 1 else 1
            # driving since the photo changes the odometer a little: accept within 5 km as factor 1
            if abs(v - cluster_km) <= 5:
                f = 1
            if f is not None:
                scored.append((c, f))
        d["match_against_cluster"] = {c: f for c, f in scored}
        if scored:
            best = scored[0]
            p3.status = "answered"
            d["factor_rangeTank"] = dict(scored).get("rangeTank")
            order = [c for c in carriers if c in dict(scored)] + [c for c in carriers if c not in dict(scored)]
            d["order"] = order
            d["factors"] = {c: f for c, f in scored}
        else:
            p3.status = "partial"
            p3.why.append("no carrier matches the cluster's odometer at factor 0.001 .. 10")
    else:
        p3.status = "partial"
        p3.needs.append("the cluster's odometer in km (readings.json: odometer_km)")
        d["plausible_without_reading"] = {c: (1000 <= v <= 1500000) for c, v in valid_by.items()}
    p3.decided = d
    p3.material = l5.material = sorted({cl.rel(p) for p in ctx.session.app_logs("twin_dial")})
    for c in carriers:
        if have[c]:
            x = have[c][-1]
            p3.cite(x["line"], "%s raw %s (%s)" % (c, _f(x["raw"].get("mileage")), x["via"]), mileage=x["raw"].get("mileage"))
    return l5, p3


def p5_units(ctx: Ctx) -> Ans:
    a = Ans("P5", "units: km / miles, Celsius, bar")
    d: Dict[str, object] = {}
    for l in ctx.app_lines.get("twin_dial", []):
        m = re.match(r"^units raw \(P5\): mileage (\S+) ", l.msg)
        if m:
            d["mileage_unit"] = cl.enum_name(m.group(1)) or cl.num(m.group(1))
            a.cite(l, "units line: mileage unit given", unit=d["mileage_unit"])
            break
    for p in ctx.probe:
        if p.tag == "units" and "mileage_unit" not in d:
            d["mileage_unit"] = p.enum("mileage") or p.val("mileage")
            a.cite(p, "probe units line", unit=d["mileage_unit"])
        elif p.tag == "external-display":
            d["temp_unit"] = p.enum("tempUnit") or p.val("tempUnit")
            a.cite(p, "probe external-display line", unit=d["temp_unit"])
        elif p.tag == "units-ext":
            for k in ("temp", "speed", "cons", "fuel", "pressure", "power", "torque"):
                if p.enum(k) is not None or p.val(k) is not None:
                    d["ext_" + k] = p.enum(k) or p.val(k)
            a.cite(p, "probe units-ext line", pressure=d.get("ext_pressure"))
    if not d:
        import tables_vitals
        vit = tables_vitals.vitals(ctx)
        f = tables_vitals.facts(vit) if vit else {}
        if f.get("pressure_unit"):
            a.status = "partial"
            a.label = "arrives-other-app"
            a.decided = {"pressure_unit": f["pressure_unit"], "temperature_unit": f.get("temperature_unit")}
            a.dated = (cl.fmt_ts(vit["last"]) or "")[:10]
            a.material = sorted({cl.rel(p) for p in ctx.session.app_logs("car_vitals")})
            a.cite(vit["first_line"]["units"], "car_vitals 'car units' line (another app's log)", pressure=f["pressure_unit"], temperature=f.get("temperature_unit"))
            a.needs.append("the distance unit (km / miles): Twin Dial's 'units raw (P5)' line or the probe's units line")
            return a
        a.status = "no-material"
        a.needs.append("the units lines (Twin Dial 0.1.0 writes one, the probe's P5 more)")
        return a
    a.status = "answered"
    a.label = "arrives"
    a.decided = d
    mi = d.get("mileage_unit")
    d["km"] = mi in ("KILOMETER", "KILOMETERS", 0, 1) if mi is not None else None
    d["miles_variant_needed"] = mi in ("MEILEN", "MILES") if isinstance(mi, str) else None
    a.dated = (cl.fmt_ts(ctx.last_ts("twin_dial")) or "")[:10] if ctx.last_ts("twin_dial") else None
    return a
