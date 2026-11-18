"""cluster-render's journal and status text: L10 (upload accounting), L11 (the map slot under our panel), L12 (its version),
X5 (the scene's "goes whole" KB over mode switches), X10 (the guard and restarts).

Sources: docs/research3/MP-REPORT.md section 8, MT-REPORT.md, r3/SN section 1 (slot rows), the saved journal of 2026-11-13..14.
The lines are the service's own; they carry numbers, scene ids (0x...) and slot ids only.
"""
from __future__ import annotations

import re
import statistics
from typing import Dict, List, Optional, Tuple

import car_logs as cl
from context import Ctx
from tables_base import Ans

_RE_WHOLE = re.compile(r"^target (\w+): its scene goes whole to the renderer again: (\d+) KB charged to the upload budget$")
_RE_RATE = re.compile(r"^target (\w+): in the last (\d+) s its layers wrote (\d+) frames \((\d+) ms from offer to flush on average\), (\d+) KB, (\d+) failed, (\d+) budget holds")
_RE_SLOT = re.compile(r"^dcsm: slot (0x[0-9a-fA-F]+) status (\d+) content (0x[0-9a-fA-F]+) class (\d+) map (\d+)$")
_RE_START = re.compile(r"^start: cluster-render (\d+)\.(\d+)\.(\d+), pid (\d+)$")
_RE_GUARD = re.compile(r"^guard: panel (0x[0-9a-fA-F]+) (0x[0-9a-fA-F]+) (\d+) disabled at strike (\d+): (\d+) ms after mapping it")
_RE_CAP = re.compile(r"^upload: cap (\d+) KB/s \(ceiling (\d+), floor (\d+)\): (\w+)")
_RE_CAPCHG = re.compile(r"cap (\d+) KB/s")
_RE_STATUS_SLOT = re.compile(r"^slot (0x[0-9a-fA-F]+) status (\d+): (0x[0-9a-fA-F]+) class (\d+) map (\d+)(?:, (0x[0-9a-fA-F]+) class (\d+) map (\d+))?")

PANEL_SCENE = "0x10004f8"       # our panel's scene (both apps), slot 0x203
MAP_SLOT = "0x100"
PANEL_SLOT = "0x203"


def _stats(xs: List[float]) -> dict:
    if not xs:
        return {"n": 0}
    xs = sorted(xs)
    return {"n": len(xs), "min": xs[0], "median": statistics.median(xs), "max": xs[-1],
            "p90": xs[min(len(xs) - 1, int(0.9 * len(xs)))]}


def l10(ctx: Ctx) -> Ans:
    a = Ans("L10", "upload accounting: the cap, KB per minute, 'goes whole' KB (the real cost of a theme switch)")
    if not ctx.cr_lines and not ctx.session.status_files():
        a.status = "no-material"
        a.needs.append("cluster-render's log / journal and status text (collect.sh)")
        return a
    whole: Dict[str, List[Tuple[float, int, cl.Line]]] = {}
    rates: Dict[str, List[Tuple[int, int, int, cl.Line]]] = {}
    for l in ctx.cr_lines:
        m = _RE_WHOLE.match(l.msg)
        if m:
            whole.setdefault(m.group(1), []).append((l.ts, int(m.group(2)), l))
            continue
        m = _RE_RATE.match(l.msg)
        if m:
            rates.setdefault(m.group(1), []).append((int(m.group(2)), int(m.group(5)), int(m.group(7)), l))
    caps = []
    for p in ctx.session.status_files():
        with open(p, "r", encoding="utf-8", errors="replace") as fh:
            for i, t in enumerate(fh, 1):
                m = _RE_CAP.match(t.strip())
                if m:
                    caps.append((int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4), p, i))
    d: Dict[str, object] = {}
    for tgt, xs in whole.items():
        d["goes_whole_%s_KB" % tgt] = _stats([float(k) for _t, k, _l in xs])
    for tgt, xs in rates.items():
        per_min = [k for secs, k, _h, _l in xs if 55 <= secs <= 65]
        d["kb_per_minute_%s" % tgt] = _stats([float(k) for k in per_min])
        d["budget_holds_per_minute_%s" % tgt] = _stats([float(h) for secs, _k, h, _l in xs if 55 <= secs <= 65])
    if caps:
        vals = sorted({c[0] for c in caps})
        d["cap_KBps_seen"] = vals
        d["cap_ceiling"] = caps[-1][1]
        d["cap_floor"] = caps[-1][2]
        d["cap_steps_below_ceiling"] = any(c[0] < c[1] for c in caps)
    # a cap change in the journal
    steps = 0
    for l in ctx.cr_lines:
        if l.msg.startswith("upload: cap"):
            steps += 1
    d["cap_lines_in_journal"] = steps
    for tgt, xs in whole.items():
        hist: Dict[int, int] = {}
        for _t, k, _l in xs:
            hist[k] = hist.get(k, 0) + 1
        d["goes_whole_%s_values" % tgt] = {str(k): v for k, v in sorted(hist.items(), key=lambda kv: -kv[1])[:6]}
    d["panel_whole_events"] = len(whole.get("panel", []))
    d["map_whole_events"] = len(whole.get("map", []))
    a.decided = d
    if whole or rates or caps:
        a.status = "answered"
        a.label = "arrives"
        first = (rates.get("panel") or rates.get("map") or [None])[0]
        for tgt in ("panel", "map"):
            if whole.get(tgt):
                a.cite(whole[tgt][0][2], "target %s goes whole: %d KB charged" % (tgt, whole[tgt][0][1]), target=tgt, kb=whole[tgt][0][1])
        if caps:
            a.evidence.append(_status_ev(caps[0], "upload cap %d KB/s (ceiling %d, floor %d)" % (caps[0][0], caps[0][1], caps[0][2]),
                                          {"cap": caps[0][0], "ceiling": caps[0][1], "floor": caps[0][2]}))
        a.why.append("per-target numbers from every 'goes whole' and 'in the last N s' line; a 'goes whole' on the panel happens each time the KOMBI maps our content again")
        a.material = sorted({cl.rel(p) for p in ctx.session.cluster_render_logs()} | {cl.rel(p) for p in ctx.session.status_files()})
        times = [l.ts for l in ctx.cr_lines if l.ts]
        a.dated = (cl.fmt_ts(max(times)) or "")[:10] if times else None
    else:
        a.status = "no-material"
    return a


def _status_ev(c, shape, n):
    from tables_base import Evidence
    return Evidence(cl.rel(c[4]).split("/")[-1], c[5], None, shape, n)


def slot_intervals(ctx: Ctx) -> Tuple[None, Dict[str, List[dict]]]:
    """Replay the 'dcsm: slot ... status ... content ... map ...' events: per slot a list of {ts, status, content, class, map}."""
    per: Dict[str, List[dict]] = {}
    seen = set()
    for l in ctx.cr_lines:
        m = _RE_SLOT.match(l.msg)
        if not m:
            continue
        key = (l.ts, m.group(0))
        if key in seen:         # the same event appears in the log and in the journal copy
            continue
        seen.add(key)
        per.setdefault(m.group(1), []).append({"ts": l.ts, "status": int(m.group(2)), "content": m.group(3), "class": int(m.group(4)),
                                              "map": int(m.group(5)), "line": l})
    return None, per


def l11(ctx: Ctx) -> Ans:
    """Which scene sits in slot 0x100 (BMW's map slot) while our panel (0x10004f8 in slot 0x203) is mapped."""
    a = Ans("L11", "the map slot (0x100) while our panel is up: was BMW's map there when no black box showed (theory H-M)")
    _x, per = slot_intervals(ctx)
    panel = per.get(PANEL_SLOT, [])
    mp = per.get(MAP_SLOT, [])
    if not panel or not mp:
        a.status = "no-material"
        a.needs.append("cluster-render's journal with 'dcsm: slot' lines while the app runs (collect.sh), then the same with Twin Dial up")
        return a
    # intervals in which the panel scene is in slot 0x203 with map 1 (mapped by the display)
    ivs = []
    cur = None
    for e in panel:
        up = e["content"] == PANEL_SCENE and e["map"] == 1
        if up and cur is None:
            cur = e["ts"]
        elif not up and cur is not None:
            ivs.append((cur, e["ts"]))
            cur = None
    if cur is not None:
        ivs.append((cur, per[PANEL_SLOT][-1]["ts"]))
    # state of slot 0x100 at each moment: the last event before t
    def at(slot_events, t):
        last = None
        for e in slot_events:
            if e["ts"] <= t:
                last = e
            else:
                break
        return last
    hist: Dict[str, float] = {}
    total = 0.0
    first_line = None
    for (t0, t1) in ivs:
        evs = [e for e in mp if t0 <= e["ts"] <= t1]
        st = at(mp, t0)
        times = [t0] + [e["ts"] for e in evs] + [t1]
        states = [st] + evs
        for i, s in enumerate(states):
            dur = times[i + 1] - times[i]
            if s is None or dur <= 0:
                continue
            key = "%s map %d" % (s["content"], s["map"])
            hist[key] = hist.get(key, 0.0) + dur
            total += dur
            if first_line is None:
                first_line = s["line"]
    if not ivs or total <= 0:
        a.status = "partial"
        a.decided = {"panel_up_intervals": 0}
        a.why.append("slot 0x203 never held 0x10004f8 as mapped in the saved journal; nothing to correlate")
        return a
    top = sorted(hist.items(), key=lambda kv: -kv[1])
    contents = {}
    for k, s in hist.items():
        c, _m, mapv = k.split(" ")
        contents.setdefault(c, {})[mapv] = round(s, 1)
    a.status = "answered"
    a.label = "arrives"
    own_map = round(sum(v.get("1", 0) for c, v in contents.items() if c == "0x10004f0"), 1)
    bmw_m = contents.get("0x1000300", {})
    a.decided = {"own_map_scene_mapped_s": own_map, "bmw_scene_0x1000300_mapped_s": bmw_m.get("1", 0), "bmw_scene_0x1000300_unmapped_s": round(bmw_m.get("0", 0) + bmw_m.get("3", 0), 1),
                 "panel_up_intervals": len(ivs), "panel_up_seconds": round(total, 1),
                 "slot_0x100_content_seconds": {k: v for k, v in contents.items()},
                 "slot_0x100_dominant": top[0][0].split(" ")[0],
                 "slot_0x100_dominant_mapped": top[0][0].endswith("map 1"),
                 "panel_scene": PANEL_SCENE}
    a.why.append("the panel's scene id (0x10004f8, slot 0x203) is the same for f30_cluster and Twin Dial; the material is f30's, so this says what the slot held under OUR panel, not yet under Twin Dial")
    a.why.append("a content id other than ours with map 1 in slot 0x100 means the display kept a scene there (BMW's map, hypothesis H-M); it does not say the map was visible")
    a.cite(first_line, "slot 0x100 held %s while the panel was up" % top[0][0].split(" ")[0], seconds=round(top[0][1], 1))
    a.material = sorted({cl.rel(p) for p in ctx.session.cluster_render_logs()})
    a.dated = (cl.fmt_ts(first_line.ts) or "")[:10]
    a.needs.append("repeat with Twin Dial up (X6: mapSlots logging, or this table on the journal of that run)")
    return a


def l12(ctx: Ctx) -> Ans:
    a = Ans("L12", "cluster-render's version (>= 0.5.12 for ETC2)")
    vers = []
    for l in ctx.cr_lines:
        m = _RE_START.match(l.msg)
        if m:
            vers.append(((int(m.group(1)), int(m.group(2)), int(m.group(3))), l))
    comp = ctx.session.root + "/cluster-render/component.json"
    import json
    import os
    cv = None
    if os.path.isfile(comp):
        try:
            c = json.load(open(comp, encoding="utf-8"))
            mm = re.match(r"^(\d+)\.(\d+)\.(\d+)", str(c.get("version", "")))
            if mm:
                cv = tuple(int(x) for x in mm.groups())
        except (OSError, ValueError):
            cv = None
    if not vers and cv is None:
        a.status = "no-material"
        a.needs.append("cluster-render/component.json or a 'start: cluster-render' journal line")
        return a
    latest = vers[-1][0] if vers else cv
    a.status = "answered"
    a.label = "arrives"
    a.decided = {"version": list(latest), "ge_0_5_12": latest >= (0, 5, 12), "component_json": list(cv) if cv else None,
                 "starts_in_journal": len(vers)}
    if vers:
        a.cite(vers[-1][1], "start: cluster-render %d.%d.%d" % latest, version=list(latest))
    a.material = sorted({cl.rel(p) for p in ctx.session.cluster_render_logs()} | ({cl.rel(comp)} if cv else set()))
    times = [l.ts for l in ctx.cr_lines if l.ts]
    a.dated = (cl.fmt_ts(max(times)) or "")[:10] if times else None
    return a


def x10_guard(ctx: Ctx) -> Dict[str, object]:
    out = {"guard_disabled": 0, "starts": 0, "events": [], "lines": []}
    for l in ctx.cr_lines:
        mg = _RE_GUARD.match(l.msg)
        if mg:
            out["guard_disabled"] += 1
            out["events"].append({"strike": int(mg.group(4)), "ms_after_mapping": int(mg.group(5))})
            out["lines"].append(l)
        if _RE_START.match(l.msg):
            out["starts"] += 1
    return out


def x5_switch(ctx: Ctx) -> Ans:
    """'goes whole ... KB' per marker window labelled mode-switch (the three Sport -> Comfort switches of X5)."""
    a = Ans("X5", "f30 textures: 'goes whole' KB over three Sport -> Comfort switches; picture is a photo (manual)")
    wins = ctx.class_windows("mode-switch")
    whole = [(l.ts, int(_RE_WHOLE.match(l.msg).group(2)), _RE_WHOLE.match(l.msg).group(1), l) for l in ctx.cr_lines if _RE_WHOLE.match(l.msg)]
    if not wins:
        a.status = "partial" if whole else "no-material"
        a.needs.append("marker windows of class mode-switch (design/car/markers.json from CQ) and cluster-render's journal of the session")
        a.decided = {"goes_whole_events": len(whole)}
        return a
    per = []
    for (t0, t1, n) in wins:
        ev = [w for w in whole if t0 <= w[0] <= t1 and w[2] == "panel"]
        per.append({"marker": n, "panel_whole_events": len(ev), "panel_whole_KB": sum(e[1] for e in ev)})
    a.status = "answered"
    a.label = "arrives"
    a.decided = {"windows": per}
    a.needs.append("the dials close up (photo) for quality; 'etc2' drawing at all is shown by the panel mapping without a guard line")
    return a
