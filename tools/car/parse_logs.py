#!/usr/bin/env python3
"""From the car's logs to decisions: fills design/car/answers.json (package CL).

  UV_CACHE_DIR=<main checkout>/bake/work/.uvcache uv run -q --no-project python -I tools/car/parse_logs.py <session-folder> \\
        [--out design/car/answers.json] [--readings readings.json] [--markers design/car/markers.json] [--register design/car/register.json]
        [--only L1,P13] [--no-privacy-check] [--print]

<session-folder> is reference/car/<date>/ (tools/car/collect.sh writes one; the 2026-11-15 snapshot works too).
Per register item the answer is answered / partial / not-yet / no-material / manual, with the evidence's SHAPES (numbers and
enum names only: tables_base.safe_value refuses anything else), the value decided, and what is still missing.  Every table is
the code form of a decision table in a report; each module says which.  Nothing here connects to the car.

readings.json (optional, numbers only, typed by the lead from the owner's photos): see tools/car/README.md.
markers.json (optional): {"markers": {"<n>": {"class": "bc-short", "item": "P13"}}} -- which step each "Poznachka N" was.
"""
from __future__ import annotations

import datetime
import json
import os
import sys
from typing import Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import car_logs as cl                      # noqa: E402
import privacy_check as pc                 # noqa: E402
import tables_l                            # noqa: E402
import tables_msg                          # noqa: E402
import tables_probe                        # noqa: E402
import tables_render                       # noqa: E402
import tables_trip                         # noqa: E402
import steps                               # noqa: E402
from context import Ctx, load_json         # noqa: E402
from tables_base import Ans                # noqa: E402

REPO = cl.REPO

# the register of brief 3.1-3.4 (CA's design/car/register.json replaces / extends it when it exists)
BUILTIN: Dict[str, Dict[str, str]] = {
    "L1": {"kind": "L", "q": "why f30's window over BMW's panel stays open (MC section 6)"},
    "L2": {"kind": "L", "q": "does statusActiveCCMessage notify, what it rests on, is its number the ccList id"},
    "L3": {"kind": "L", "q": "the clock's fallback (statusShowTimeDate)"},
    "L4": {"kind": "L", "q": "Twin Dial's trip fields: arrive or not; raw against iDrive's trip page"},
    "L5": {"kind": "L", "q": "the odometer member"},
    "L6": {"kind": "L", "q": "phone state arrives"},
    "L7": {"kind": "L", "q": "media (HmiMediaState on HMI_CID) arrives"},
    "L8": {"kind": "L", "q": "the second witness (displayed cc)"},
    "L9": {"kind": "L", "q": "layout builds at start (bench predicts 3)"},
    "L10": {"kind": "L", "q": "upload accounting (cluster-render)"},
    "L11": {"kind": "L", "q": "the map slot under our panel"},
    "L12": {"kind": "L", "q": "cluster-render's version"},
    "L13": {"kind": "L", "q": "the 0.7.18 probes' results"},
    "L14": {"kind": "L", "q": "the speed-limit sign arrives in f30"},
    "L15": {"kind": "L", "q": "day/night source and the meaning of 0"},
    "P1": {"kind": "P", "q": "which message shows now (active / displayed / menu / ccList)"},
    "P2": {"kind": "P", "q": "the stored-message mark; risk class"},
    "P3": {"kind": "P", "q": "odometer carriers and factor"},
    "P4": {"kind": "P", "q": "trip computer factors, counter, departure"},
    "P5": {"kind": "P", "q": "units"},
    "P6": {"kind": "P", "q": "the car's own coolant verdict"},
    "P7": {"kind": "P", "q": "doors, boot, bonnet, locking"},
    "P8": {"kind": "P", "q": "media"},
    "P9": {"kind": "P", "q": "phone"},
    "P10": {"kind": "P", "q": "voltage"},
    "P11": {"kind": "P", "q": "cluster view setting and indirect key"},
    "P12": {"kind": "P", "q": "guided route"},
    "P13": {"kind": "P", "q": "buttons: the tab key"},
    "P14": {"kind": "P", "q": "map presence fields"},
    "P15": {"kind": "P", "q": "sign, cruise, limiter"},
    "P16": {"kind": "P", "q": "boost, oil, tyres"},
    "P17": {"kind": "P", "q": "heading, altitude, service due"},
    "X1": {"kind": "X", "q": "f30 with 'Change with the drive mode' off: the black box"},
    "X2": {"kind": "X", "q": "Twin Dial mbCover over the gear letter"},
    "X3": {"kind": "X", "q": "f30 mbGap"},
    "X4": {"kind": "X", "q": "forced rebuilds mbRebuild"},
    "X5": {"kind": "X", "q": "f30 sceneTex r8 / etc2"},
    "X6": {"kind": "X", "q": "the map window"},
    "X7": {"kind": "X", "q": "f30's message release"},
    "X8": {"kind": "X", "q": "message timing"},
    "X9": {"kind": "X", "q": "the band's level and night palette"},
    "X10": {"kind": "X", "q": "the KOMBI accepts the round-3 shaders"},
    "X11": {"kind": "X", "q": "switch-time film"},
    "F1": {"kind": "F", "q": "BMW's own sign visible with Twin Dial up"},
    "F2": {"kind": "F", "q": "side lamps and belt lamp with Twin Dial up"},
    "F3": {"kind": "F", "q": "a dial's lower ends, close photo"},
    "F4": {"kind": "F", "q": "photo 16: which side lamps BMW draws over us"},
    "F5": {"kind": "F", "q": "does the HUD show the cruise set speed"},
    "F6": {"kind": "F", "q": "the cluster's own cruise and limiter display"},
    "F7": {"kind": "F", "q": "the stock cluster's media line, phone list, call pop-up"},
    "F8": {"kind": "F", "q": "Ukrainian message names: the longest"},
}


def load_register(path: Optional[str]) -> Dict[str, Dict[str, str]]:
    reg = {k: dict(v) for k, v in BUILTIN.items()}
    cands = [path] if path else [os.path.join(REPO, "design", "car", "register.json"),
                                  os.path.join(REPO, "bake", "work", "car", "pub", "CA", "register.json")]
    for p in cands:
        obj = load_json(p) if p else None
        if obj is None:
            continue
        items = obj.get("items") if isinstance(obj, dict) else obj
        if isinstance(items, dict):
            items = [dict(v, id=k) for k, v in items.items()]
        if not isinstance(items, list):
            continue
        for it in items:
            if isinstance(it, dict) and isinstance(it.get("id"), str):
                cur = reg.setdefault(it["id"], {"kind": str(it.get("kind", "?"))[:1], "q": ""})
                if it.get("question"):
                    cur["q"] = str(it["question"])[:200]
                cur["from_register"] = True
                if it.get("blocks"):
                    cur["blocks"] = it["blocks"]
        reg["_source"] = {"path": cl.rel(p)}
        break
    return reg


def run_tables(ctx: Ctx) -> Dict[str, Ans]:
    """Every table, each guarded: a table that raises is reported (stderr and the item's `needs`) and the others still run."""
    out: Dict[str, Ans] = {}
    errors: Dict[str, str] = {}

    def run(ids, fn):
        try:
            res = fn()
        except Exception as e:      # a bug in a table must never hide the other answers
            import traceback
            tb = traceback.extract_tb(e.__traceback__)[-1]
            for i in ids:
                a = Ans(i, BUILTIN.get(i, {}).get("q", ""))
                a.status = "not-yet"
                a.needs.append("the table raised %s at %s:%d - fix tools/car and run again" % (type(e).__name__, os.path.basename(tb.filename), tb.lineno))
                out[i] = a
            sys.stderr.write("parse_logs: table %s raised %s: %s\n" % ("/".join(ids), type(e).__name__, str(e)[:120]))
            return
        if isinstance(res, Ans):
            res = [res]
        for a in res:
            out[a.id] = a

    run(["L1", "L2"], lambda: tables_msg.l1_l2(ctx))
    run(["L8"], lambda: tables_msg.l8(ctx))
    run(["L3"], lambda: tables_l.l3(ctx))
    run(["L4", "P4"], lambda: tables_trip.l4_trip(ctx))
    run(["L5", "P3"], lambda: tables_trip.l5_p3(ctx))
    for i, fn in (("L6", tables_l.l6), ("L7", tables_l.l7), ("L9", tables_l.l9), ("L10", tables_render.l10), ("L11", tables_render.l11),
                  ("L12", tables_render.l12), ("L13", tables_l.l13), ("L14", tables_l.l14), ("L15", tables_l.l15),
                  ("P1", tables_probe.p1), ("P2", tables_probe.p2), ("P5", tables_trip.p5_units), ("P6", tables_probe.p6), ("P7", tables_probe.p7),
                  ("P8", tables_probe.p8), ("P9", tables_probe.p9), ("P10", tables_probe.p10), ("P11", tables_probe.p11), ("P12", tables_probe.p12),
                  ("P13", tables_probe.p13), ("P14", tables_probe.p14), ("P15", tables_probe.p15), ("P16", tables_probe.p16), ("P17", tables_probe.p17),
                  ("X5", tables_render.x5_switch), ("X10", x10), ("X6", x6)):
        run([i], lambda fn=fn: fn(ctx))
    l1 = out.get("L1")
    if l1 is not None:
        run(["X7"], lambda: x7(ctx, l1))
    return out


def x7(ctx: Ctx, l1: Ans) -> Ans:
    a = Ans("X7", "f30's message release: the window closes and never over a listed message")
    evs = tables_msg.timeline(ctx, apps=("f30_cluster",))
    rel = [e for e in evs if e["kind"] == "release"]
    if not rel:
        a.status = "not-yet" if ctx.app_lines.get("f30_cluster") else "no-material"
        a.needs.append("an f30 build with config.ccActive.release set, a door message, a second message, a message that returns")
        return a
    a.status = "partial"
    a.label = "arrives"
    a.decided = {"release_lines": len(rel), "reasons": sorted({e["why"] for e in rel if e["why"] in ("listed", "heuristic")}),
                 "hang_cases_after": l1.decided.get("hang_cases")}
    a.cite(rel[0]["line"], "first 'released to the list' line")
    if l1.decided.get("hang_cases") == []:
        a.status = "answered"
        a.why.append("release lines are present and the same log shows no hang stretch (L1)")
    a.needs.append("the owner's photo of a listed message with the window shut (never over a listed message) -- a photo, not a log")
    return a


def x10(ctx: Ctx) -> Ans:
    a = Ans("X10", "the KOMBI accepts the round-3 shaders: no reset, no missing layer (log side: guard strikes, restarts)")
    g = tables_render.x10_guard(ctx)
    if not ctx.cr_lines:
        a.status = "no-material"
        a.needs.append("cluster-render's journal of the session")
        return a
    a.status = "partial"
    a.label = "arrives"
    exits = 0
    for app in ("f30_cluster", "twin_dial"):
        exits += sum(1 for l in ctx.app_lines.get(app, []) if l.msg.startswith("exit code") and not l.msg.startswith("exit code 0"))
    a.decided = {"guard_strikes": g["guard_disabled"], "guard_events": g["events"][:6], "renderer_starts_in_journal": g["starts"], "app_nonzero_exits": exits}
    for l in g["lines"][:2]:
        a.cite(l, "cluster-render guard disabled the panel scene after mapping it", strike=g["events"][0]["strike"])
    if g["guard_disabled"]:
        a.why.append("the guard switched the panel off after a strike; it is not asked for again until cluster-render's version changes (or guard-reset): after a guard line the owner's photo of the cluster means nothing until that is read")
    if g["guard_disabled"] == 0 and exits == 0:
        a.why.append("no guard strike and no abnormal app exit in the saved journal; whether the cluster itself reset is the owner's observation")
    a.needs.append("the owner's observation: no cluster reset after start, a mode switch, day/night")
    return a


def x6(ctx: Ctx) -> Ans:
    a = Ans("X6", "the map window: BMW's map on the panel's own id (photo) and that the app can read the slot rows (log side)")
    sl = [l for l in ctx.app_lines.get("twin_dial", []) + ctx.app_lines.get("f30_cluster", []) if l.msg.startswith("map slots:") or l.msg.startswith("mapSlots")]
    a.status = "manual"
    a.needs.append("photos (centre in P and D, with and without a route); log side: mapSlots lines or the journal (see L11)")
    if sl:
        a.status = "partial"
        a.label = "arrives"
        a.decided = {"slot_lines": len(sl)}
    return a


def manual(id_: str, info: Dict[str, str]) -> Ans:
    a = Ans(id_, info.get("q", ""))
    a.status = "manual"
    a.needs.append("a photo / video / observation by the owner (SESSION.uk.md); the lead records the result")
    return a


def summarise(items: Dict[str, dict]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for v in items.values():
        out[v["status"]] = out.get(v["status"], 0) + 1
    return out


def build(session_dir: str, readings_path: Optional[str], markers_path: Optional[str], register_path: Optional[str], only: Optional[List[str]] = None) -> dict:
    session = cl.Session(session_dir)
    readings = load_json(readings_path)
    mpath = markers_path
    if not mpath:
        for cand in (os.path.join(REPO, "design", "car", "session_marks.json"), os.path.join(REPO, "bake", "work", "car", "pub", "CQ", "marks.json"),
                     os.path.join(REPO, "design", "car", "markers.json")):
            if os.path.isfile(cand):
                mpath = cand
                break
    marker_map = steps.load_marks(mpath)
    ctx = Ctx(session, readings, marker_map)
    reg = load_register(register_path)
    src = reg.pop("_source", None)
    answers = run_tables(ctx)
    items: Dict[str, dict] = {}
    order = sorted(set(list(reg.keys()) + list(answers.keys())), key=lambda k: (k[0], int(''.join(c for c in k[1:] if c.isdigit()) or 0)))
    for k in order:
        if only and k not in only:
            continue
        a = answers.get(k)
        info = reg.get(k, {"kind": k[0], "q": ""})
        if a is None:
            a = manual(k, info) if info.get("kind") in ("X", "F") else Ans(k, info.get("q", ""))
            if info.get("kind") not in ("X", "F"):
                a.status = "not-yet"
                a.needs.append("no decision table for this register item in tools/car (add one to tables_*.py)")
        if not a.title:
            a.title = info.get("q", "")
        j = a.to_json()
        j["kind"] = info.get("kind", k[0])
        if info.get("from_register"):
            j["in_register"] = True
        if info.get("blocks") and not j["blocks"]:
            j["blocks"] = info["blocks"] if isinstance(info["blocks"], list) else [str(info["blocks"])]
        items[k] = j
    material = {}
    for app in ("f30_cluster", "twin_dial", "signal_probe", "car_vitals", "driver_profiles"):
        ls = ctx.app_lines.get(app, [])
        if ls:
            ts = [l.ts for l in ls if l.ts]
            material[app] = {"lines": len(ls), "from": cl.fmt_ts(min(ts)) if ts else None, "to": cl.fmt_ts(max(ts)) if ts else None,
                             "version_last": [int(x) for x in ctx.versions.get(app, "0.0.0").split(".")[:3] if x.isdigit()] if ctx.versions.get(app) else None,
                             "runs": len(ctx.starts.get(app, [])), "probe_lines": sum(1 for p in ctx.probe if p.src.startswith(app))}
    material["cluster_render_lines"] = len(ctx.cr_lines)
    out = {
        "schema": 1,
        "tool": "tools/car/parse_logs.py",
        "generated": datetime.date.today().isoformat(),
        "session": {"folder": cl.rel(session.root), "date": session.date, "material": material,
                    "readings": bool(readings), "markers": len(ctx.markers), "marker_map": bool(ctx.marker_map)},
        "register": src or {"path": None, "note": "built-in list of brief section 3 (CA's register not found)"},
        "summary": summarise(items),
        "items": items,
    }
    return out


def main(argv: List[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    opts = {"--out": os.path.join(REPO, "design", "car", "answers.json"), "--readings": None, "--markers": None, "--register": None, "--only": None}
    flags = {"--no-privacy-check": False, "--print": False}
    session_dir = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in opts:
            opts[a] = argv[i + 1]
            i += 2
        elif a in flags:
            flags[a] = True
            i += 1
        else:
            session_dir = a
            i += 1
    if not session_dir or not os.path.isdir(session_dir):
        print("parse_logs: a session folder is needed (reference/car/<date>/)")
        return 2
    # the input first: what in the collected material should not be there
    if not flags["--no-privacy-check"]:
        hits = 0
        for f in pc.iter_files([session_dir]):
            if f.endswith((".log", ".txt")) or ".log." in os.path.basename(f):
                hits += len(pc.scan_file(f))
        print("privacy check of the input: %d flagged line(s) (python3 -I tools/car/privacy_check.py <folder> lists them; --redact-to makes clean copies)" % hits)
    only = opts["--only"].split(",") if opts["--only"] else None
    ans = build(session_dir, opts["--readings"], opts["--markers"], opts["--register"], only)
    bad = pc.check_derived(ans)
    if bad:
        print("parse_logs: the derived file breaks the privacy rules, NOT written:")
        for where, rule in bad[:20]:
            print("  %s at %s" % (rule, where))
        return 1
    if flags["--print"]:
        print(json.dumps(ans, indent=1)[:20000])
    os.makedirs(os.path.dirname(os.path.abspath(opts["--out"])), exist_ok=True)
    with open(opts["--out"], "w", encoding="utf-8") as fh:
        json.dump(ans, fh, indent=1, sort_keys=False)
        fh.write("\n")
    print("wrote %s: %s" % (cl.rel(opts["--out"]), ", ".join("%s %d" % kv for kv in sorted(ans["summary"].items()))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
