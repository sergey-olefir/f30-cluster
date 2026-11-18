"""The L-items CA added to the register (L16-L30), and the generic probe table for items without a table of their own (P18-P21).

Sources: design/car/register.json (CA) -- steps and `decides` of each item.  Every table reads lines the installed apps already write.
Numbers, enum names and counts only; a road, a position or a name is never read (their lines carry shapes and lengths).
"""
from __future__ import annotations

import json
import os
import re
from typing import Dict, List, Optional

import car_logs as cl
from context import Ctx, load_json
from tables_base import Ans
import tables_msg
import tables_render

_RE_RAW = re.compile(r"^(msa|clock|clock \(local\)|check-control|marker) raw: (.*) -> (.*)$")
_RE_COND = re.compile(r"^(?:probe: vehicle condition|bottom row: vehicle condition) (\S+)")
_RE_ENGINE = re.compile(r"^engine: (\w[\w ]*?) \((.*)\)$")
_RE_DRIVE = re.compile(r"^drive mode (\w+)(?: (\w+))? \((.*)\)$")
_RE_DRIVE_BAD = re.compile(r"^drive mode not recognised: ")
_RE_SLA = re.compile(r"^speed-limit settings: ")
_RE_ROAD = re.compile(r"^road label: ")
_RE_NAV = re.compile(r"^navigation: ")
_RE_POS = re.compile(r"^position: ")
_RE_ASSET = re.compile(r"^asset (\d+) (\w+) (\d+)x(\d+) of (\w+) on (\w+): (\d+) writes, (\d+) KB, (\d+) failed")
_RE_KGUARD = re.compile(r"^kombi guard: the cluster's display service went away (\d+) ms after")
_RE_LISTSHAPE = re.compile(r"^check-control list: ")
_RE_PROBE_LIST_ENTRY = re.compile(r"\[id (-?\d+|-) colour (\S+) symbol (-?\d+|-)\]")


def _app(ctx, *apps):
    out = []
    for a in apps:
        out.extend(ctx.app_lines.get(a, []))
    return out


def _vt(ctx, app="f30_cluster"):
    return tuple(int(x) for x in re.findall(r"\d+", ctx.versions.get(app, "0.0.0"))[:3]) or (0, 0, 0)


def l16(ctx: Ctx) -> Ans:
    a = Ans("L16", "the clock's primary source: timeDateUTC offsets (logged whole once per zone change)")
    hits = [(l, _RE_RAW.match(l.msg)) for l in _app(ctx, "f30_cluster", "twin_dial") if _RE_RAW.match(l.msg) and _RE_RAW.match(l.msg).group(1) == "clock"]
    if not hits:
        a.status = "no-material" if not (ctx.app_lines.get("f30_cluster") or ctx.app_lines.get("twin_dial")) else "not-yet"
        a.needs.append("a log with a 'clock raw:' line (the car's first time zone)")
        return a
    outs = sorted({m.group(3) for _l, m in hits if re.match(r"^-?\d+$|^null$", m.group(3))})
    a.status = "answered"
    a.label = "arrives"
    a.decided = {"lines": len(hits), "offsets_minutes": [int(x) for x in outs if x != "null"][:6], "null_offset_seen": "null" in outs}
    a.cite(hits[0][0], "clock raw line: offset %s" % hits[0][1].group(3) if re.match(r"^-?\d+$", hits[0][1].group(3)) else "clock raw line: no offset", offset_min=cl.num(hits[0][1].group(3)))
    return a


def l17_l18_l19(ctx: Ctx) -> List[Ans]:
    lines = _app(ctx, "f30_cluster")
    out = []
    # L17
    a = Ans("L17", "auto start/stop (statusConditionMSA) and READY / OFF")
    msa = [l for l in lines if _RE_RAW.match(l.msg) and _RE_RAW.match(l.msg).group(1) == "msa"]
    eng = [(l, _RE_ENGINE.match(l.msg)) for l in lines if _RE_ENGINE.match(l.msg)]
    if msa or eng:
        a.status = "partial"
        a.label = "arrives"
        a.decided = {"msa_lines": len(msa), "engine_states": sorted({m.group(1) for _l, m in eng if m.group(1) in ("running", "stopped", "off", "ready")})[:6],
                     "engine_lines": len(eng)}
        for l in (msa[:1] or [e[0] for e in eng[:1]]):
            a.cite(l, "first msa / engine line")
        a.needs.append("a drive with a start/stop stop, with the MSA button off and a cold start (log lines 'msa raw' / 'engine:')")
    else:
        a.status = "no-material" if not lines else "not-yet"
        a.needs.append("f30_cluster.log of a drive with an auto start/stop stop")
    out.append(a)
    # L18
    a = Ans("L18", "vehicle condition values (standby row, P with engine off)")
    cond = [(l, _RE_COND.match(l.msg)) for l in lines if _RE_COND.match(l.msg)]
    if cond:
        vals = sorted({cl.enum_name(m.group(1).strip('"')) or cl.num(m.group(1)) for _l, m in cond if cl.enum_name(m.group(1).strip('"')) or cl.num(m.group(1)) is not None}, key=str)
        a.status = "partial"
        a.label = "arrives"
        a.decided = {"values_seen": vals[:12], "lines": len(cond)}
        a.cite(cond[0][0], "first vehicle condition line", condition=vals[0] if vals else None)
        a.needs.append("which value is the standby row (5?) and P with the engine off (7?): the owner's marks across ignition on / engine off / standby")
    else:
        a.status = "no-material" if not lines else "not-yet"
        a.needs.append("f30_cluster.log across ignition on / engine off / standby ('vehicle condition N')")
    out.append(a)
    # L19
    a = Ans("L19", "drive mode changes: notified; every mode maps")
    dm = [(l, _RE_DRIVE.match(l.msg)) for l in lines if _RE_DRIVE.match(l.msg)]
    bad = [l for l in lines if _RE_DRIVE_BAD.match(l.msg)]
    if dm or bad:
        a.status = "answered" if dm else "partial"
        a.label = "arrives"
        a.decided = {"modes_seen": sorted({m.group(1) for _l, m in dm if re.match(r"^[A-Z_]+$|^[a-z_]+$", m.group(1)) and len(m.group(1)) < 20})[:8],
                     "changes_logged": len(dm), "unrecognised_values": len(bad)}
        if dm:
            a.cite(dm[0][0], "first drive mode line")
        for l in bad[:1]:
            a.cite(l, "a drive mode value the app does not map")
    else:
        a.status = "no-material" if not lines else "not-yet"
    out.append(a)
    for x in out:
        x.dated = (cl.fmt_ts(ctx.last_ts("f30_cluster")) or "")[:10] if lines else None
        x.material = sorted({cl.rel(p) for p in ctx.session.app_logs("f30_cluster")})
    return out


def _shape_item(ctx: Ctx, aid: str, title: str, rx, label: str) -> Ans:
    a = Ans(aid, title)
    lines = _app(ctx, "f30_cluster")
    hits = [l for l in lines if rx.match(l.msg)]
    if not hits:
        a.status = "no-material" if not lines else "not-yet"
        a.needs.append("f30_cluster.log of a build that writes these lines, with the situation in it (see the register's steps)")
        return a
    a.status = "partial"
    a.label = "arrives"
    a.decided = {"lines": len(hits)}
    a.cite(hits[0], "first %s line (a shape: counts and lengths only)" % label)
    a.material = sorted({cl.rel(p) for p in ctx.session.app_logs("f30_cluster")})
    a.dated = (cl.fmt_ts(ctx.last_ts("f30_cluster")) or "")[:10]
    return a


def l20(ctx): return _shape_item(ctx, "L20", "the driver's speed-limit settings (notifier-only)", _RE_SLA, "speed-limit settings")


def l21(ctx: Ctx) -> Ans:
    a = Ans("L21", "road label, navigation state, position: do they reach f30 (shapes only)")
    lines = _app(ctx, "f30_cluster")
    d = {"road_lines": sum(1 for l in lines if _RE_ROAD.match(l.msg)), "navigation_lines": sum(1 for l in lines if _RE_NAV.match(l.msg)),
         "position_lines": sum(1 for l in lines if _RE_POS.match(l.msg))}
    if not any(d.values()):
        a.status = "no-material" if not lines else "not-yet"
        a.needs.append("f30_cluster.log with a guided route (lines 'road label:' 'navigation:')")
        return a
    a.status = "partial"
    a.label = "arrives"
    a.decided = d
    for rx in (_RE_ROAD, _RE_NAV, _RE_POS):
        h = next((l for l in lines if rx.match(l.msg)), None)
        if h is not None:
            a.cite(h, "first line of this kind (shape only; never read as text)")
    a.needs.append("the calibration of config.road / config.nav against the car's own text (lengths, not the text)")
    return a


def l24(ctx: Ctx) -> Ans:
    a = Ans("L24", "KOMBI resets and the guard since 0.7.16")
    g = tables_render.x10_guard(ctx)
    lines = _app(ctx, "f30_cluster")
    unavailable = sum(1 for l in ctx.cr_lines if "display service not available" in l.msg)
    kg = [(l, _RE_KGUARD.match(l.msg)) for l in lines if _RE_KGUARD.match(l.msg)]
    guard_file = False
    for d in ctx.session.app_dirs("f30_cluster"):
        p = os.path.join(d, "data-ls.txt")
        if os.path.isfile(p):
            guard_file = "kombi-guard.json" in open(p, encoding="utf-8", errors="replace").read()
    if not ctx.cr_lines and not lines:
        a.status = "no-material"
        return a
    a.status = "answered" if ctx.cr_lines else "partial"
    a.label = "arrives"
    a.decided = {"renderer_guard_disabled_events": g["guard_disabled"], "guard_events": g["events"][:6], "app_kombi_guard_lines": len(kg),
                 "kombi_guard_json_present": guard_file, "cluster_render_display_unavailable_lines": unavailable}
    for l in g["lines"][:1]:
        a.cite(l, "cluster-render guard disabled the panel after a strike", strike=g["events"][0]["strike"])
    for l, m in kg[:1]:
        a.cite(l, "f30's own kombi guard: the display service went away %s ms after the scene was shown" % m.group(1), ms=int(m.group(1)))
    a.why.append("whether the 0.7.13 shader-size fix holds with the night looks back is read from the absence of these lines over the session's start / mode switch / day-night steps")
    return a


def l25(ctx: Ctx) -> Ans:
    a = Ans("L25", "ccList pairs (id, symbol id, colour) the car lists")
    pairs: Dict[int, Dict[str, set]] = {}
    first = None
    for e in tables_msg.timeline(ctx, apps=("f30_cluster", "twin_dial")):
        if e["kind"] == "list":
            first = first or e["line"]
            for i, c in e["ids"]:
                if i is not None:
                    pairs.setdefault(i, {"colours": set(), "symbols": set()})["colours"].add(c)
    for l in _app(ctx, "f30_cluster"):
        if l.msg.startswith("probe: ccList:"):
            for i, c, s in _RE_PROBE_LIST_ENTRY.findall(l.msg):
                if i != "-":
                    d = pairs.setdefault(int(i), {"colours": set(), "symbols": set()})
                    d["colours"].add(c.lower())
                    if s != "-":
                        d["symbols"].add(int(s))
            first = first or l
    for p in ctx.probe:
        if p.tag == "ccList":
            for e in tables_msg.list_entries(p.body):
                if isinstance(e.get("id"), int):
                    d = pairs.setdefault(e["id"], {"colours": set(), "symbols": set()})
                    if isinstance(e.get("colour"), str):
                        d["colours"].add(e["colour"].lower())
                    if isinstance(e.get("symbol"), int):
                        d["symbols"].add(e["symbol"])
            first = first or p
    if not pairs:
        a.status = "no-material"
        a.needs.append("logs with 'check-control list:' lines over as many days of use as they hold")
        return a
    ok_col = {"white", "red", "yellow", "green", "orange", "default", "none"}
    a.status = "partial"
    a.label = "arrives"
    a.decided = {"ids": {str(k): {"colours": sorted(c for c in v["colours"] if c in ok_col), "symbol_ids": sorted(v["symbols"])} for k, v in sorted(pairs.items())[:40]}}
    a.cite(first, "ccList line with ids and colours (name lengths are not copied)")
    a.needs.append("symbol ids come from the 0.7.18 probe lines or the signal_probe's ccList lines; fill by_symbol_id of message_symbols.json from ids only")
    return a


def l26(ctx: Ctx) -> Ans:
    a = Ans("L26", "message auto-hide and re-show timing; the frame dwell")
    evs = tables_msg.timeline(ctx, apps=("f30_cluster", "twin_dial")) or tables_msg.probe_timeline(ctx)
    runs = []
    for app in ("f30_cluster", "twin_dial"):
        runs += [(r[0], r[1], r[2]) for r in ctx.run_bounds(app) if tuple(int(x) for x in re.findall(r"\d+", r[2])[:3]) >= (0, 7, 19) or app == "twin_dial"]
    res = tables_msg.analyse_cc(evs, runs) if evs else {"runs": []}
    eps = [(e["end"] - e["start"]) for r in res["runs"] for e in r["episodes"] if e["end"] and e["start"]]
    zeros = []
    for r in res["runs"]:
        for ra in r["rest_after"]:
            zeros.append(ra)
    frames = [e for e in evs if e["kind"] == "frames" and e.get("of") and e["of"] >= 2]
    dwell = []
    for i in range(1, len(frames)):
        dt = frames[i]["ts"] - frames[i - 1]["ts"]
        if frames[i]["frame"] != frames[i - 1]["frame"] and 0.5 < dt < 60:
            dwell.append(round(dt, 1))
    if not eps and not dwell:
        a.status = "no-material" if not evs else "not-yet"
        a.needs.append("a door message left open until BMW hides it (B3.3) in a log of 0.7.19+ / Twin Dial / the probe")
        return a
    a.status = "partial"
    a.label = "arrives"
    a.decided = {"episodes": len(eps), "episode_seconds": [round(x, 1) for x in sorted(eps)][:12], "frame_dwell_seconds": dwell[:12]}
    a.why.append("an episode is the time the list is not at rest; the manual's ~20 s hide and ~8 s re-show are read as: episode_seconds near 20 for a door left open, and a re-show shows as a second episode")
    a.needs.append("the owner's clock times of the message appearing and disappearing (B3.3) to compare with these seconds")
    return a


def l27(ctx: Ctx) -> Ans:
    a = Ans("L27", "slot rows at the moment the black box shows")
    times = ctx.readings.get("black_box_times")
    if not times or not isinstance(times, list):
        a.status = "no-material" if not ctx.cr_lines else "not-yet"
        a.needs.append("the owner's clock times when the box showed (readings.json: black_box_times, ISO UTC) and cluster-render's journal of that time")
        return a
    _x, per = tables_render.slot_intervals(ctx)
    import datetime
    rows = []
    for t in times[:8]:
        try:
            ts = datetime.datetime.strptime(t, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp()
        except ValueError:
            continue
        row = {}
        for slot in ("0x203", "0x323", "0x200", "0x100"):
            last = None
            for e in per.get(slot, []):
                if e["ts"] <= ts:
                    last = e
            row[slot] = {"content": last["content"], "map": last["map"], "status": last["status"]} if last else None
        rows.append(row)
    a.status = "answered" if rows and any(any(v for v in r.values()) for r in rows) else "partial"
    a.label = "arrives"
    a.decided = {"at_box": rows}
    return a


def l28(ctx: Ctx) -> Ans:
    a = Ans("L28", "does the cluster-render status socket return status.txt's text (map window presence rule S1)")
    lines = [l for l in _app(ctx, "f30_cluster", "twin_dial") if l.msg.startswith("map slots") or l.msg.startswith("mapSlots") or "status answer" in l.msg]
    if lines:
        a.status = "partial"
        a.label = "arrives"
        a.decided = {"lines": len(lines)}
        a.cite(lines[0], "first map-slot status line")
    else:
        a.status = "no-material" if not ctx.app_lines.get("twin_dial") else "not-yet"
        a.needs.append("a build with config.mapSlots (SN) or the client's status ask line")
    return a


def l29(ctx: Ctx) -> Ans:
    a = Ans("L29", "does cluster-render upload a layer dropped before its upload finished (status 'asset N ... writes, KB')")
    rows = []
    for p in ctx.session.status_files():
        for i, t in enumerate(open(p, encoding="utf-8", errors="replace"), 1):
            m = _RE_ASSET.match(t.strip())
            if m:
                rows.append({"asset": int(m.group(1)), "w": int(m.group(3)), "h": int(m.group(4)), "writes": int(m.group(7)), "kb": int(m.group(8)), "failed": int(m.group(9))})
    if not rows:
        a.status = "no-material"
        a.needs.append("cluster-render's status.txt around an app start (collect.sh saves it)")
        return a
    a.status = "partial"
    a.label = "arrives"
    a.decided = {"asset_rows": len(rows), "assets_with_kb_above_0": sum(1 for r in rows if r["kb"] > 0), "max_kb": max(r["kb"] for r in rows)}
    a.needs.append("status.txt sampled during a start (the torn-down build): whether KB for a dropped asset keeps growing")
    return a


def l30(ctx: Ctx) -> Ans:
    a = Ans("L30", "is newCCMessage ever sent")
    lines = _app(ctx, "f30_cluster")
    ccm = [l for l in lines if l.msg.startswith("check-control message:")]
    ev = tables_msg.timeline(ctx, apps=("f30_cluster",))
    ep = [e for e in ev if e["kind"] == "list" and not e["rest"]]
    if ccm:
        a.status = "answered"
        a.label = "arrives"
        a.decided = {"arrives": True, "lines": len(ccm)}
        a.cite(ccm[0], "a check-control message line (newCCMessage) arrived")
    elif ep:
        mins = round(((ctx.last_ts("f30_cluster") or 0) - (ctx.first_ts("f30_cluster") or 0)) / 60.0, 1)
        a.status = "answered"
        a.label = "not-sent"
        a.decided = {"arrives": False, "observed_minutes": mins, "message_episodes_meanwhile": len(ep)}
    else:
        a.status = "no-material" if not lines else "not-yet"
    return a


# ---- the generic table: any probe item without a table of its own ---------------------------------------------------------------

def probe_fields_file() -> Optional[dict]:
    for p in (os.path.join(cl.REPO, "design", "car", "probe_fields.json"), os.path.join(cl.REPO, "bake", "work", "car", "pub", "CP", "probe_fields.json")):
        d = load_json(p)
        if d:
            return d
    return None


def generic_p(ctx: Ctx, item: str, title: str) -> Ans:
    """arrives / silent / unseen per tag of the item, from CP's probe_fields.json; no decision beyond that."""
    a = Ans(item, title)
    pf = probe_fields_file()
    tags = sorted({f["tag"] for f in (pf or {}).get("fields", []) if f.get("item") == item})
    a.material = sorted({cl.rel(p) for app in ("signal_probe", "twin_dial") for p in ctx.session.app_logs(app)})
    if not tags:
        a.status = "not-yet"
        a.needs.append("CP's probe_fields.json has no field for %s yet" % item)
        return a
    if not ctx.probe and not ctx.summaries():
        a.status = "no-material"
        a.needs.append("the signal_probe log of the session")
        return a
    sil = ctx.silent_tags()
    d = {"arrives": [], "silent": [], "unseen": []}
    for t in tags:
        if any(p.tag == t for p in ctx.probe):
            d["arrives"].append(t)
        elif t in sil:
            d["silent"].append(t)
        else:
            d["unseen"].append(t)
    a.decided = d
    a.status = "partial" if d["arrives"] else ("answered" if d["silent"] and not d["unseen"] else "not-yet")
    a.label = "arrives" if d["arrives"] else ("not-sent" if d["silent"] else "unseen")
    for t in d["arrives"][:2]:
        a.cite(next(p for p in ctx.probe if p.tag == t), "first %s line" % t.replace("_", "-"))
    a.needs.append("a decision table for %s is not written: the lines are in the log; the lead reads them against the register's steps" % item)
    return a
