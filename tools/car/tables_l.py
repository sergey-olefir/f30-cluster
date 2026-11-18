"""The remaining L-items: lines the installed apps already write (brief 3.1): L3 L6 L7 L9 L13 L14 L15.

L1 L2 L8 are in tables_msg.py, L4 L5 in tables_trip.py, L10 L11 L12 in tables_render.py.
"""
from __future__ import annotations

import json
import re
from typing import Dict, List, Optional

import car_logs as cl
from context import Ctx
from tables_base import Ans

_RE_LAYOUT_BUILD = re.compile(r'^layout "([^"]+)": (\d+) widgets, (\d+) layers .*whole-sheet writes (\d+) bytes, pixel memory ([\d.]+) MiB of (\d+) MiB')
_RE_CLOCK_LOCAL = re.compile(r"^clock \(local\) raw: (.*) -> (-?\d+|null)$")
_RE_CLOCK_RAW = re.compile(r"^clock raw: (.*) -> (-?\d+|null)$")
_RE_CLOCK_OURS = re.compile(r"^clock: ours shows (\d\d):(\d\d), UTC([+-])(\d\d):(\d\d) from (.*?) - it must read")
_RE_DN_SRC = re.compile(r"^day/night source: the (car|sun)\b")
_RE_DN = re.compile(r"^day/night: the car says (\S+) -> (\w+)$")
_RE_SIGN = re.compile(r"^sign: (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) \(state value unit")
_RE_PHONE = re.compile(r"^phone state raw \(P9\): (\S+)$")
_RE_MEDIA = re.compile(r"^media text \(P8\): first line (none|\d+ characters), second (none|\d+ characters)$")
_RE_PROBE_LIST = re.compile(r"^probe: (ccList|ccListRiskClass|basicList): (\d+) (?:entry|entries)(?:: (.*?))?(?: \+\d+ more)?(?: \(the last line for this field\))?$")
_RE_CCSYM = re.compile(r"^probe: cc symbols: (\d+) symbols?")


def l3(ctx: Ctx) -> Ans:
    a = Ans("L3", "the clock's fallback: statusShowTimeDate arrives and is local time")
    lines = ctx.app_lines.get("f30_cluster", []) + ctx.app_lines.get("twin_dial", [])
    loc = [(l, _RE_CLOCK_LOCAL.match(l.msg)) for l in lines if _RE_CLOCK_LOCAL.match(l.msg)]
    ours = [(l, _RE_CLOCK_OURS.match(l.msg)) for l in lines if _RE_CLOCK_OURS.match(l.msg)]
    raw = [(l, _RE_CLOCK_RAW.match(l.msg)) for l in lines if _RE_CLOCK_RAW.match(l.msg)]
    if not lines:
        a.status = "no-material"
        a.needs.append("f30_cluster.log or twin_dial.log of 0.7.19+ / 0.1.0+")
        return a
    d: Dict[str, object] = {"local_arrives": bool(loc), "utc_clock_lines": len(raw)}
    if loc:
        a.status = "answered"
        a.label = "arrives"
        l, m = loc[0]
        hm = re.search(r'"displayHour":(\d+).*?"displayMinute":(\d+)', m.group(1))
        out = None if m.group(2) == "null" else int(m.group(2))
        d["offset_minutes"] = out
        if hm:
            d["displayed"] = [int(hm.group(1)), int(hm.group(2))]
        a.cite(l, "clock (local) line: shown time %s, offset %s min" % (":".join(hm.groups()) if hm else "?", out),
               offset_min=out, hour=int(hm.group(1)) if hm else None, minute=int(hm.group(2)) if hm else None)
    else:
        a.status = "partial" if ours or raw else "not-yet"
        a.label = "not-sent" if (raw and not loc) else None
        a.needs.append("a 0.7.19+ log: the 'clock (local) raw' line")
    if ours:
        l, m = ours[-1]
        src = m.group(6)
        word = ("shown" if "shown" in src else "car-zone" if "car" in src else "setting" if "setting" in src else "config")
        sign = -1 if m.group(3) == "-" else 1
        d["ours_offset_min"] = sign * (int(m.group(4)) * 60 + int(m.group(5)))
        d["ours_from"] = word
        a.cite(l, "clock: ours shows %s:%s from the %s source" % (m.group(1), m.group(2), word), offset_min=d["ours_offset_min"])
    a.decided = d
    a.material = sorted({cl.rel(p) for app in ("f30_cluster", "twin_dial") for p in ctx.session.app_logs(app)})
    return a


def l6(ctx: Ctx) -> Ans:
    a = Ans("L6", "phone state: aggregatedCallState arrives")
    lines = ctx.app_lines.get("twin_dial", [])
    hits = [(l, _RE_PHONE.match(l.msg)) for l in lines if _RE_PHONE.match(l.msg)]
    pr = [p for p in ctx.probe if p.tag == "call-state"]
    if hits or pr:
        a.status = "answered"
        a.label = "arrives"
        vals = sorted({cl.enum_name(m.group(1)) or cl.num(m.group(1)) for _l, m in hits if cl.enum_name(m.group(1)) or cl.num(m.group(1)) is not None}
                      | {p.enum("state") for p in pr if p.enum("state")} , key=str)
        a.decided = {"arrives": True, "values": vals[:8]}
        if hits:
            a.cite(hits[0][0], "phone state line, first value %s" % (cl.enum_name(hits[0][1].group(1)) or "number"), state=cl.enum_name(hits[0][1].group(1)))
        elif pr:
            a.cite(pr[0], "probe call-state line", state=pr[0].enum("state"))
        a.dated = (cl.fmt_ts(ctx.last_ts("twin_dial")) or "")[:10] if lines else None
        a.material = sorted({cl.rel(p) for p in ctx.session.app_logs("twin_dial")})
    elif lines:
        a.status = "answered"
        a.label = "not-sent"
        mins = round(((ctx.last_ts("twin_dial") or 0) - (ctx.first_ts("twin_dial") or 0)) / 60.0, 1)
        a.decided = {"arrives": False, "observed_minutes": mins}
        a.why.append("Twin Dial's log has no phone state line (it writes one at the first value, even DISCONNECTED)")
    else:
        a.status = "no-material"
        a.needs.append("twin_dial.log")
    return a


def l7(ctx: Ctx) -> Ans:
    a = Ans("L7", "media: HmiMediaState on HMI_CID arrives (lengths only)")
    lines = ctx.app_lines.get("twin_dial", [])
    hits = [(l, _RE_MEDIA.match(l.msg)) for l in lines if _RE_MEDIA.match(l.msg)]
    pr = [p for p in ctx.probe if p.tag in ("player-metadata", "main-menu-metadata", "track-progress", "media-menu")]
    if hits or pr:
        a.status = "answered"
        a.label = "arrives"
        d: Dict[str, object] = {"arrives": True}
        if hits:
            l, m = hits[0]
            la = None if m.group(1) == "none" else int(m.group(1).split()[0])
            lb = None if m.group(2) == "none" else int(m.group(2).split()[0])
            d["first_line_len"], d["second_line_len"] = la, lb
            a.cite(l, "media text line: first %s, second %s characters" % (la, lb), first_len=la, second_len=lb)
        a.decided = d
        a.material = sorted({cl.rel(p) for p in ctx.session.app_logs("twin_dial")})
    elif lines:
        a.status = "partial"
        a.label = "unseen"
        a.needs.append("play something on the centre screen while Twin Dial runs (the line comes at the first metadata)")
    else:
        a.status = "no-material"
        a.needs.append("twin_dial.log")
    return a


def l9(ctx: Ctx) -> Ans:
    """Layout builds in the first 10 s after each app start (the bench predicts 3 for the current engine)."""
    a = Ans("L9", "layout builds in the first 10 s of a start (bench predicts 3; 1 means the getters beat cluster-render)")
    per_run = []
    for app in ("f30_cluster", "twin_dial"):
        lines = ctx.app_lines.get(app, [])
        for (t0, t1, ver) in ctx.run_bounds(app):
            n = 0
            first = None
            n30 = 0
            first_at = None
            for l in lines:
                if l.ts is not None and t0 <= l.ts <= t0 + 30.0 and _RE_LAYOUT_BUILD.match(l.msg):
                    n30 += 1
                    first_at = first_at if first_at is not None else round(l.ts - t0, 1)
                    if l.ts <= t0 + 10.0:
                        n += 1
                        first = first or l
            # snapshots of older builds count too, with their own versions
            per_run.append({"app": app, "version": [int(x) for x in re.findall(r"\d+", ver)[:3]], "builds_10s": n, "builds_30s": n30, "first_build_s": first_at,
                            "start": t0, "line": first})
    for app in ("f30_cluster", "twin_dial"):
        for p in ctx.snapshots.get(app, []):
            ls = cl.read_lines(p)
            starts = [(l.ts, re.match(r"^starting \w+ (\S+)$", l.msg)) for l in ls if l.ts and re.match(r"^starting \w+ (\S+)$", l.msg)]
            for i, (ts, m) in enumerate(starts):
                n = 0
                n30 = 0
                first = None
                first_at = None
                for l in ls:
                    if l.ts is not None and ts <= l.ts <= ts + 30.0 and _RE_LAYOUT_BUILD.match(l.msg):
                        n30 += 1
                        first_at = first_at if first_at is not None else round(l.ts - ts, 1)
                        if l.ts <= ts + 10.0:
                            n += 1
                            first = first or l
                per_run.append({"app": app, "version": [int(x) for x in re.findall(r"\d+", m.group(1))[:3]], "builds_10s": n, "builds_30s": n30, "first_build_s": first_at,
                                "start": ts, "line": first, "snapshot": True})
    if not per_run:
        a.status = "no-material"
        a.needs.append("a log with an app start in it (collect.sh)")
        return a
    counts = [r["builds_10s"] for r in per_run]
    # a start that the log shows whole (the app's first line is in the file) and whose build line came at all
    a.status = "answered" if any(r["builds_30s"] for r in per_run) else "partial"
    a.label = "arrives"
    cur = [r for r in per_run if tuple(r["version"]) >= (0, 7, 19) or r["app"] == "twin_dial"]
    a.decided = {"runs": [{"app": r["app"], "version": r["version"], "builds_10s": r["builds_10s"], "builds_30s": r["builds_30s"],
                           "first_build_s": r["first_build_s"], "snapshot": bool(r.get("snapshot"))} for r in per_run][:12],
                 "max_10s": max(counts), "min_10s": min(counts), "max_30s": max(r["builds_30s"] for r in per_run),
                 "runs_of_the_current_engine": len(cur),
                 "matches_bench_3": (all(r["builds_10s"] == 3 for r in cur) if cur else None)}
    if not cur:
        a.why.append("every run in this material is a build before 0.7.19: the time-zone and ccList rebuilds that make the bench's 3 did not exist yet, so these counts are not comparable; the first build line comes %s s after the start (the cluster-render connection)" %
                     ("/".join(str(r["first_build_s"]) for r in per_run[:4] if r["first_build_s"] is not None) or "?"))
    for r in per_run:
        if r["line"] is not None:
            a.cite(r["line"], "first layout build line within 10 s of the start, %d builds in all" % r["builds_10s"], builds=r["builds_10s"], version=r["version"])
            break
    a.why.append("a build line is `layout \"...\": N widgets ... whole-sheet writes ...`; only starts that the log shows from the first line are counted")
    a.dated = (cl.fmt_ts(max(r["start"] for r in per_run)) or "")[:10]
    a.material = sorted({cl.rel(p) for app in ("f30_cluster", "twin_dial") for p in ctx.session.app_logs(app) + ctx.snapshots.get(app, [])})
    return a


def l13(ctx: Ctx) -> Ans:
    a = Ans("L13", "the 0.7.18 probes' results: ccListRiskClass / basicList lines, which entry marks a stored message")
    lines = ctx.app_lines.get("f30_cluster", [])
    hits = [(l, _RE_PROBE_LIST.match(l.msg)) for l in lines if _RE_PROBE_LIST.match(l.msg)]
    sym = [l for l in lines if _RE_CCSYM.match(l.msg)]
    pr = [p for p in ctx.probe if p.tag in ("basicList", "ccListRiskClass")]
    if not hits and not pr:
        a.status = "no-material" if not lines else "not-yet"
        a.needs.append("f30_cluster.log of 0.7.18 .. 0.7.20 (the lines 'probe: basicList:' / 'probe: ccListRiskClass:'), if still present on the car")
        a.why.append("the 0.7.18 lines were never recorded in the repository; the saved logs are 0.7.10 .. 0.7.12")
        return a
    d: Dict[str, object] = {}
    states: Dict[str, set] = {}
    for l, m in hits:
        field = m.group(1)
        body = m.group(3) or ""
        for grp in re.findall(r"\[([^\]]*)\]", body):
            kv = dict(re.findall(r"([a-z]+) (\S+)", grp))
            if field == "basicList" and "id" in kv:
                states.setdefault(kv["id"], set()).add((kv.get("reason"), kv.get("state")))
    for p in pr:
        if p.tag == "basicList":
            for e in _list_of(p):
                states.setdefault(str(e.get("id")), set()).add((e.get("reason"), e.get("state")))
    flips = {k: sorted(str(s[1]) for s in v if s[1]) for k, v in states.items() if len({s[1] for s in v}) > 1}
    d["basicList_ids"] = len(states)
    d["entries_that_change_state"] = {k: [x for x in v if re.match(r"^[A-Z0-9_]+$", x)] for k, v in flips.items()}
    d["symbols_requested"] = bool(sym)
    a.status = "answered" if hits or pr else "partial"
    a.label = "arrives"
    if hits:
        a.cite(hits[0][0], "0.7.18 list line for %s with %s entries" % (hits[0][1].group(1), hits[0][1].group(2)), entries=int(hits[0][1].group(2)))
    a.decided = d
    a.why.append("an entry whose state toggles is a candidate for the stored-message mark; the photo of BMW's marker decides (needs photo)")
    return a


def _list_of(p) -> List[dict]:
    from tables_msg import list_entries
    return list_entries(p.body)


def l14(ctx: Ctx) -> Ans:
    a = Ans("L14", "the speed-limit sign in f30: TrafficSignDisplayControl arrives")
    lines = ctx.app_lines.get("f30_cluster", [])
    hits = [(l, _RE_SIGN.match(l.msg)) for l in lines if _RE_SIGN.match(l.msg)]
    pr = [p for p in ctx.probe if p.tag == "sign"]
    if hits:
        a.status = "answered"
        a.label = "arrives"
        states = sorted({m.group(1) for _l, m in hits})
        vals = sorted({int(float(m.group(2))) for _l, m in hits if re.match(r"^-?\d+(\.\d+)?$", m.group(2))})
        a.decided = {"arrives": True, "states": [s for s in states if re.match(r"^[a-z]+$", s)][:8], "values": vals[:20],
                     "units": sorted({m.group(3) for _l, m in hits if cl.enum_name(m.group(3))})[:4]}
        a.cite(hits[0][0], "sign line, state %s value %s" % (hits[0][1].group(1), hits[0][1].group(2)))
    elif pr:
        a.status = "answered"
        a.label = "arrives"
        a.decided = {"arrives": True, "values": sorted({int(p.val("value")) for p in pr if p.val("value") is not None})[:20]}
        a.cite(pr[0], "probe sign line", value=pr[0].val("value"))
    else:
        a.status = "no-material" if not lines else "partial"
        a.label = "unseen" if lines else None
        a.needs.append("a drive past speed-limit signs with f30 0.7.x running (the 'sign:' line is written at each new combination)")
        a.why.append("the round-3 brief claimed the sign arrives; no line is in the repository")
    a.material = sorted({cl.rel(p) for p in ctx.session.app_logs("f30_cluster")})
    return a


def l15(ctx: Ctx) -> Ans:
    a = Ans("L15", "day/night: the car's value against the sun; the meaning of 0")
    lines = ctx.app_lines.get("f30_cluster", []) + ctx.app_lines.get("twin_dial", [])
    src = [(l, _RE_DN_SRC.match(l.msg)) for l in lines if _RE_DN_SRC.match(l.msg)]
    dn = [(l, _RE_DN.match(l.msg)) for l in lines if _RE_DN.match(l.msg)]
    if not src and not dn:
        a.status = "no-material" if not lines else "not-yet"
        a.needs.append("a log with 'day/night' lines (fix/colour-daynight, 0.7.x)")
        return a
    a.status = "answered"
    a.label = "arrives"
    vals = {}
    for l, m in dn:
        vals.setdefault(m.group(1), set()).add(m.group(2))
    d: Dict[str, object] = {"source_seen": sorted({m.group(1) for _l, m in src}), "codes": {k: sorted(v) for k, v in vals.items() if re.match(r"^[A-Z0-9_]+$", k)}}
    d["car_value_arrives"] = bool(dn)
    d["code_0_means"] = sorted(vals.get("0", [])) if "0" in vals else None
    sun = ctx.readings.get("sun") if isinstance(ctx.readings.get("sun"), dict) else None
    if sun and dn:
        set_min, rise_min = sun.get("set_min_utc"), sun.get("rise_min_utc")
        agree = []
        for l, m in dn:
            tod = (int(l.ts) % 86400) // 60
            night_sun = (tod >= set_min or tod < rise_min) if set_min is not None and rise_min is not None else None
            if m.group(2) in ("day", "night") and night_sun is not None:
                agree.append((m.group(2) == "night") == night_sun)
        d["agrees_with_sun"] = (sum(agree), len(agree))
    for l, m in (dn[:2] or src[:1]):
        a.cite(l, "day/night line", code=cl.num(m.group(1)) if hasattr(m, "group") and m.re is _RE_DN else None)
    a.decided = d
    a.dated = (cl.fmt_ts(max(l.ts for l, _ in (dn or src))) or "")[:10]
    return a
