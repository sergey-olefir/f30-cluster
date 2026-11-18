"""Decision tables for the check-control machine: L1, L2, L8, L13, P1, P2 (and the clock / day-night L-items, L3 L14 L15).

Source of the tables: docs/research3/MC-REPORT.md section 6 (13 rows, cases A0..A17) and docs/twin-dial/PROBE-PROTOCOL.md P1 / P2.

THE TRAP (MC section 6 row 5, brief 3.1 L1): "active cc: no ccList entry for number N" ALONE does not prove a hang.  The
number and the list arrive in either order, so for a moment (about a second) the number is not in the list.  A hang is a
number that is not 0 while the list is at rest for MORE than ORDER_S seconds.  `analyse_cc` measures exactly that.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

import car_logs as cl
from context import Ctx
from tables_base import Ans, ev

ORDER_S = 1.0          # the order effect: list and number arrive in either order, within a second (MC row 5)
HANG_OPEN_S = 30.0     # a state still open at the end of the log counts as a hang from this age
STORED_S = 25.0        # a listed entry that the field stays on for this long: the A5 pattern (BMW hides it after ~20 s)
EARLY_S = 120.0        # "near the start" of MC row 1

_NUM = r"(-?\d+|null)"
_RE_ACT = re.compile(r"^active cc: number %s control %s frame %s/%s utility %s$" % ((_NUM,) * 5))
_RE_NOENT = re.compile(r"^active cc: no ccList entry for number (\d+)\b")
_RE_WIRED = re.compile(r"^active cc: wired\b")
_RE_REL = re.compile(r"^active cc: released to the list \((\w+)\): (.*)$")
_RE_DEC = re.compile(r"^active cc: decides again$")
_RE_LIST = re.compile(r"^check-control list: (\d+) messages, name lengths ([\d/]*)(?: \(not a list config\.ccList fits\))?; "
                      r"listed (none|.*?)(?: of (\d+) entries)?(?:, (\d+) with no name)?$")
_RE_FRAMES = re.compile(r"^check-control frames: frame (-?\d+|null) of (-?\d+|null), (\d+) ids$")
_RE_MSG = re.compile(r"^check-control message: (no name|name (\d+) chars), (no description|description (\d+) chars), "
                     r"colour (\S+), symbol (-?\d+|null), id (-?\d+|null), type (\S+)$")
_RE_DISP = re.compile(r"^displayed cc: number (-?\d+)$")
_RE_BOTTOM = re.compile(r"^bottom row: (.*)$")
_RE_SIG = re.compile(r"^signal (\w+) (subscribed|error)\b")
_RE_TWIN = re.compile(r"^cc: id (\S+) colour (\S+) name len (\d+) shown-now (\S+) \S+ (\w+) \((.*)\)$")
_RE_TWIN_CONF = re.compile(r"^cc: shown-now confirmed \(number (\d+) matched")


def _n(x) -> Optional[int]:
    return None if x is None or x == "null" or x == "-" else int(x)


def parse_list_ids(seg: str) -> List[tuple]:
    """'15 white, 987 white' -> [(15,'white'), (987,'white')];  'none' -> []"""
    if seg == "none":
        return []
    out = []
    for part in seg.split(", "):
        m = re.match(r"^(\d+|-)(?: ([a-z?]+))?$", part.strip())
        if m:
            out.append((None if m.group(1) == "-" else int(m.group(1)), m.group(2) or "?"))
    return out


def timeline(ctx: Ctx, apps=("f30_cluster", "twin_dial")) -> List[dict]:
    """Events of the message machine from the app logs, in time order: act, noentry, list, disp, frames, msg, bottom, twin, sub, wired, rel."""
    evs: List[dict] = []
    for app in apps:
        for l in ctx.app_lines.get(app, []):
            m = l.msg
            e = None
            mm_ = _RE_ACT.match(m)
            if mm_:
                e = {"kind": "act", "number": _n(mm_.group(1)), "control": _n(mm_.group(2)), "frame_n": _n(mm_.group(3)),
                     "frame_of": _n(mm_.group(4)), "utility": _n(mm_.group(5))}
            elif _RE_NOENT.match(m):
                e = {"kind": "noentry", "number": int(_RE_NOENT.match(m).group(1))}
            elif _RE_WIRED.match(m):
                e = {"kind": "wired"}
            elif _RE_REL.match(m):
                e = {"kind": "release", "why": _RE_REL.match(m).group(1)}
            elif _RE_DEC.match(m):
                e = {"kind": "decides"}
            elif _RE_LIST.match(m):
                g = _RE_LIST.match(m)
                ids = parse_list_ids(g.group(3))
                e = {"kind": "list", "named": int(g.group(1)), "ids": ids, "rest": len(ids) == 0,
                     "unfit": "(not a list config.ccList fits)" in m, "entries": _n(g.group(4)), "unnamed": _n(g.group(5)) or 0}
            elif _RE_FRAMES.match(m):
                g = _RE_FRAMES.match(m)
                e = {"kind": "frames", "frame": _n(g.group(1)), "of": _n(g.group(2)), "ids": int(g.group(3))}
            elif _RE_MSG.match(m):
                g = _RE_MSG.match(m)
                e = {"kind": "msg", "name_len": _n(g.group(2)) if g.group(2) else 0, "colour": g.group(5),
                     "symbol": _n(g.group(6)), "id": _n(g.group(7))}
            elif _RE_DISP.match(m):
                e = {"kind": "disp", "number": int(_RE_DISP.match(m).group(1))}
            elif _RE_BOTTOM.match(m):
                t = _RE_BOTTOM.match(m).group(1)
                kind = ("latched" if "the whole row is BMW's again" in t else "info_bmw" if t.startswith("info is BMW's again")
                        else "waiting" if "waiting for the car's check-control message" in t else "other")
                e = {"kind": "bottom", "what": kind}
            elif _RE_SIG.match(m):
                g = _RE_SIG.match(m)
                e = {"kind": "sub", "iface": g.group(1), "ok": g.group(2) == "subscribed"}
            elif _RE_TWIN.match(m):
                g = _RE_TWIN.match(m)
                why = g.group(6)
                cls = ("noentry" if why.startswith("no ccList entry for number") else "d7" if why.startswith("D7:")
                       else "conflict" if "witnesses disagree" in why else "unread" if "have not been read" in why
                       else "none" if why.startswith("no message shown") else "ours" if why.startswith("our plate") else "other")
                e = {"kind": "twin", "id": _n(g.group(1)), "colour": g.group(2), "name_len": int(g.group(3)),
                     "shown_now": _n(g.group(4)), "state": g.group(5), "why": cls}
            elif _RE_TWIN_CONF.match(m):
                e = {"kind": "twin_conf", "number": int(_RE_TWIN_CONF.match(m).group(1))}
            if e:
                e.update({"ts": l.ts, "no": l.no, "src": l.src, "app": app, "line": l})
                evs.append(e)
    evs.sort(key=lambda x: (x["ts"] if x["ts"] is not None else 0, x["no"]))
    return evs


def probe_timeline(ctx: Ctx) -> List[dict]:
    """The same shapes from the probe's P1 / P2 lines (active-cc, displayed-cc, menu-cc, ccList)."""
    evs = []
    for p in ctx.probe:
        e = None
        if p.tag == "active-cc":
            e = {"kind": "act", "number": _num(p.kv.get("number")), "control": _num(p.kv.get("control")),
                 "frame_n": _num(p.kv.get("frameNumber")), "frame_of": _num(p.kv.get("frame"))}
        elif p.tag == "displayed-cc":
            e = {"kind": "disp", "number": _num(p.kv.get("number"))}
        elif p.tag == "menu-cc":
            e = {"kind": "frames", "frame": _num(p.kv.get("frameNumber")), "of": _num(p.kv.get("frames")),
                 "ids": [_num(p.kv.get(k)) for k in ("id1", "id2", "id3")]}
        elif p.tag == "ccList":
            ents = list_entries(p.body)
            ids = [(x.get("id"), (x.get("colour") or "?").lower()) for x in ents if x.get("id") not in (0, None)]
            e = {"kind": "list", "ids": ids, "rest": len(ids) == 0, "unfit": False, "entries": len(ents), "named": 0, "unnamed": 0,
                 "entries_full": ents}
        if e:
            e.update({"ts": p.ts, "no": p.no, "src": p.src, "app": "probe", "line": p, "t": p.t})
            evs.append(e)
    evs.sort(key=lambda x: (x["ts"] if x["ts"] is not None else 0, x["no"]))
    return evs


def _num(x):
    v = cl.num(x)
    return v


def list_entries(body: str) -> List[dict]:
    """The probe's 'entries=N [k=v k=v] [k=v ...]' -> [{k: number|enum|None}]."""
    out = []
    for grp in re.findall(r"\[([^\]]*)\]", body):
        d = {}
        for k, v in re.findall(r"([A-Za-z][A-Za-z0-9_.-]*)=(\S+)", grp):
            n = cl.num(v)
            d[k] = n if n is not None else (cl.enum_name(v) or (v if v in ("-", "?") else "?"))
        out.append(d)
    return out


# --------------------------------------------------------------------------------------------------------------------

def analyse_cc(evs: List[dict], runs: List[tuple], version_ok_ts: Optional[float] = None) -> dict:
    """Walk the timeline run by run; find every interval 'number is not 0 while the list is at rest'.

    runs = [(start_ts, end_ts, version)] of the app (an app start resets the state); with no runs one run is assumed.
    Returns {runs: [per-run dict]}.  Each hang: {kind, number, control, start, dur, open, how, evidence lines}.
    """
    if not runs:
        ts = [e["ts"] for e in evs if e["ts"] is not None]
        runs = [((min(ts) if ts else 0.0), (max(ts) if ts else 0.0), "?")]
    res = []
    for (r0, r1, ver) in runs:
        rev = [e for e in evs if e["ts"] is not None and r0 - 0.001 <= e["ts"] <= (r1 if r1 is not None else 1e18) + 0.001]
        out = {"start": r0, "end": r1, "version": ver, "n_act": 0, "n_list": 0, "act_first": None, "hangs": [], "order_effects": [],
               "episodes": [], "stored": [], "unfit": [], "values": [], "first_act_in_s": None, "disp": [], "noentry": [],
               "silent_act": False, "rest_after": []}
        act = {"number": None, "control": None, "ts": None, "line": None}
        rest: Optional[bool] = None
        ids: List[tuple] = []
        epi_open = None
        msg_before = False
        iv = None                      # the open hang interval
        stored = None                  # listed entry the field stays on
        last_ev = None

        def close_iv(t_end, open_at_end=False):
            nonlocal iv
            if iv is None:
                return
            dur = (t_end - iv["start"]) if t_end is not None else 0.0
            iv = dict(iv)
            iv["dur"] = round(dur, 3)
            iv["open"] = open_at_end
            if dur <= ORDER_S and not open_at_end:
                out["order_effects"].append(iv)
            elif open_at_end and dur < HANG_OPEN_S and dur <= ORDER_S:
                out["order_effects"].append(iv)
            else:
                out["hangs"].append(iv)
            iv = None

        def cond():
            return act["number"] not in (None, 0) and rest is True

        for e in rev:
            k = e["kind"]
            was = cond()
            t = e["ts"]
            if k == "act":
                if e["number"] is None:
                    continue
                out["n_act"] += 1
                if out["act_first"] is None:
                    out["act_first"] = e
                    out["first_act_in_s"] = round(t - r0, 3)
                if not out["values"] or out["values"][-1] != e["number"]:
                    out["values"].append(e["number"])
                prev = dict(act)
                act = {"number": e["number"], "control": e["control"], "ts": t, "line": e["line"]}
                if iv is not None and e["number"] not in (0,) and prev["number"] == e["number"] and prev["control"] != e["control"]:
                    iv["ctl_changed"] = e["control"]
                    iv["ctl_line"] = e["line"]
                if iv is not None and e["number"] != prev["number"] and e["number"] != 0:
                    iv["number_changed"] = e["number"]
            elif k == "list":
                out["n_list"] += 1
                if e["unfit"]:
                    out["unfit"].append(e)
                rest = e["rest"]
                ids = e["ids"]
                if not rest and epi_open is None:
                    epi_open = e
                    msg_before = True
                if rest and epi_open is not None:
                    out["episodes"].append({"start": epi_open["ts"], "end": t, "ids": [i for i, _c in epi_open["ids"]], "line": epi_open["line"]})
                    out["rest_after"].append({"ts": t, "act": act["number"], "control": act["control"], "line": e["line"],
                                              "act_ts": act["ts"]})
                    epi_open = None
                    stored = None
            elif k == "disp":
                out["disp"].append(e)
            elif k == "noentry":
                out["noentry"].append(e)
            now = cond()
            if now and not was:
                how = "list" if k == "list" else "act"
                iv = {"start": t, "number": act["number"], "control": act["control"], "how": how, "line": e["line"],
                      "msg_before": msg_before, "act_line": act["line"], "ctl_changed": None, "number_changed": None}
            elif was and not now:
                close_iv(t)
            elif was and now and k == "act" and iv is not None and iv.get("number") != act["number"]:
                # the number changed to another non-zero number while the list stays at rest: the interval goes on, its number is the latest
                iv["number_last"] = act["number"]
            # stored-entry pattern (A5): act N stays on a listed id for long
            if k in ("act", "list") and act["number"] not in (None, 0, 65535) and not (rest is True):
                listed = [i for i, _c in ids]
                if act["number"] in listed:
                    if stored is None or stored["number"] != act["number"]:
                        stored = {"number": act["number"], "start": t, "line": e["line"], "colour": dict(ids).get(act["number"])}
                else:
                    stored = None
            if stored is not None and k in ("act", "list", "disp"):
                stored["last"] = t
            last_ev = e
        end_t = r1 if r1 is not None else (last_ev["ts"] if last_ev else r0)
        if iv is not None:
            close_iv(end_t, open_at_end=True)
        if stored is not None:
            stored["last"] = max(stored.get("last") or 0, end_t or 0)    # nothing changed since: it holds to the end of the run
        if stored is not None and stored.get("last") is not None and stored["last"] - stored["start"] >= STORED_S:
            out["stored"].append(stored)
        out["silent_act"] = out["n_act"] == 0
        res.append(out)
    return {"runs": res}


def classify_hang(h: dict, run: dict) -> str:
    n = h.get("number_last") or h["number"]
    if n == 65535:
        return "A2" if h["msg_before"] else "A1"
    if h.get("ctl_changed") is not None:
        return "A4"
    return "A3"


# --------------------------------------------------------------------------------------------------------------------

def view_of(settings: Optional[dict]) -> dict:
    """Which of MC's four views the owner was in, from settings.json (hudLayout, g20, bottomRow)."""
    if not settings:
        return {"view": "unknown"}
    layout = settings.get("hudLayout")
    g20 = settings.get("g20")
    bottom = settings.get("bottomRow")
    opaque = layout in ("wb_comfort", "wb_sport", "wb_eco", "off", None) and not g20
    if g20 or (isinstance(layout, str) and layout.startswith("g20")):
        v = "g20-bmw-row" if bottom in (None, "allG20", "bmw") else "g20-our-row"
    else:
        v = "opaque"
    return {"view": v, "hudLayout": layout if isinstance(layout, str) else None, "bottomRow": bottom if isinstance(bottom, str) else None}


def _version_tuple(v: str):
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)", v or "")
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)


def l1_l2(ctx: Ctx) -> List[Ans]:
    """L1 (which case) and L2 (does the field notify, what it rests on, is its number the ccList id)."""
    a1 = Ans("L1", "why f30's window over BMW's panel stays open (MC section 6)")
    a2 = Ans("L2", "does statusActiveCCMessage notify, what it rests on, is its number the ccList id")
    app = "f30_cluster"
    lines = ctx.app_lines.get(app, [])
    runs = ctx.run_bounds(app)
    # only builds that write the lines (0.7.19 and later for ccList / active cc; 0.7.20 for the fallback)
    cur = [r for r in runs if _version_tuple(r[2]) >= (0, 7, 19)]
    a1.material = [cl.rel(p) for p in ctx.session.app_logs(app)]
    if not lines:
        a1.status = a2.status = "no-material"
        a1.needs = a2.needs = ["f30_cluster.log (collect.sh), from build 0.7.19 or later"]
        return [a1, a2]
    if not cur:
        vers = sorted({r[2] for r in runs})
        for a in (a1, a2):
            a.status = "no-material"
            a.dated = cl.fmt_ts(ctx.last_ts(app))[:10] if ctx.last_ts(app) else None
            a.why.append("the saved f30_cluster log is from build(s) %s; the check-control lines were added in 0.7.19 (list) and 0.7.20 (active cc)" %
                         ", ".join(vers))
            a.decided = {"builds_seen": [list(_version_tuple(v)) for v in vers], "needs_build_at_least": [0, 7, 19]}
        # the build predates the lines: the lead must read the car's log (collect.sh)
        a1.needs = a2.needs = ["a log of f30_cluster 0.7.19+ with a door message in it (P1 steps 2-4)"]
        return [a1, a2]
    evs = timeline(ctx, apps=(app,))
    res = analyse_cc(evs, cur)
    view = view_of(ctx.settings.get(app))
    cases: Dict[str, List[dict]] = {}
    total_hang_s = 0.0
    any_episode = False
    n_orders = 0
    for run in res["runs"]:
        any_episode = any_episode or bool(run["episodes"])
        n_orders += len(run["order_effects"])
        for h in run["hangs"]:
            if h["open"] and h["dur"] < HANG_OPEN_S:
                continue
            c = classify_hang(h, run)
            cases.setdefault(c, []).append(h)
            total_hang_s += h["dur"]
    # secondary cases
    stored = [s for r in res["runs"] for s in r["stored"]]
    silent_runs = [r for r in res["runs"] if r["silent_act"] and r["n_list"] > 0]
    unfit = [u for r in res["runs"] for u in r["unfit"]]
    blind = [r for r in res["runs"] if r["n_list"] == 0 and r["n_act"] == 0 and (r["end"] or 0) - r["start"] >= HANG_OPEN_S]
    msgs = [e for e in evs if e["kind"] == "msg"]
    ccm_stray = [e for e in msgs if e.get("id") == 65535 and e.get("name_len") == 0]
    disp = [e for e in evs if e["kind"] == "disp"]
    frames = [e for e in evs if e["kind"] == "frames"]
    latches = [e for e in evs if e["kind"] == "bottom" and e["what"] == "latched"]

    decided: Dict[str, object] = {"view": view.get("view")}
    rec_release: Dict[str, object] = {}
    clear_ids: List[int] = []
    rows: List[str] = []
    if "A1" in cases:
        rows.append("1")
        rec_release["deferValues"] = [65535]
        for h in cases["A1"][:2]:
            a1.cite(h["line"], "active cc: number 65535 with no ccList entry for %d s at the start of a run (A1)" % int(h["dur"]),
                    number=65535, dur_s=h["dur"], open_at_end=h["open"])
    if "A2" in cases:
        rows.append("2")
        rec_release["deferValues"] = [65535]
        for h in cases["A2"][:2]:
            a1.cite(h["line"], "active cc: number 65535 after a message, list at rest for %d s (A2)" % int(h["dur"]), number=65535, dur_s=h["dur"])
    if "A3" in cases:
        rows.append("3")
        rec_release["leftList"] = True
        for h in cases["A3"][:2]:
            a1.cite(h["line"], "number kept after the list went to rest, no further active cc line for %d s (A3)" % int(h["dur"]),
                    number=h["number"], control=h["control"], dur_s=h["dur"])
    if "A4" in cases:
        rows.append("4")
        rec_release["leftList"] = True
        h = cases["A4"][0]
        decided["control_when_gone"] = h["ctl_changed"]
        a1.cite(h["ctl_line"], "same number, control word changed to %s after the list went to rest (A4)" % h["ctl_changed"],
                number=h["number"], control=h["ctl_changed"])
    if cases and n_orders:
        pass
    if ccm_stray:
        rows.append("10")
        clear_ids = [65535]
        a1.cite(ccm_stray[0]["line"], "check-control message with no name and id 65535 (A11)", id=65535)
    if unfit:
        rows.append("8")
        a1.cite(unfit[0]["line"], "check-control list the config does not fit (A9)")
    if blind:
        rows.append("9")
        decided["blind_runs"] = len(blind)
    if silent_runs:
        reds = [r for r in silent_runs if any(c == "red" for e in evs if e["kind"] == "list" and e["ts"] is not None and
                                              r["start"] <= e["ts"] <= (r["end"] or 1e18) for _i, c in e["ids"])]
        if reds:
            rows.append("7")
            decided["silent_active_with_red"] = True
    if stored:
        rows.append("6")
        s = stored[0]
        a1.cite(s["line"], "active number %s stays on a listed entry for %d s (A5, the field is 'last shown')" % (s["number"], int(s["last"] - s["start"])),
                number=s["number"], dur_s=round(s["last"] - s["start"], 1))
    if disp:
        zeros = [d for d in disp if d["number"] == 0]
        decided["witness_spoke"] = True
        decided["witness_zero_seen"] = bool(zeros)
        if zeros and (cases or stored):
            rows.append("11")
            rec_release["witness"] = True
    if latches:
        rows.append("13")
        decided["latch_seen"] = True
    if frames and any(f.get("of") == 15 and f.get("frame") == 15 for f in frames):
        rows.append("12")
    decided["hang_cases"] = sorted(cases)
    decided["rows"] = sorted(set(rows), key=lambda r: int(r))
    decided["order_effects"] = n_orders
    decided["hang_total_s"] = round(total_hang_s, 1)
    if rec_release:
        decided["release"] = rec_release
    if clear_ids:
        decided["ccm_clearIds"] = clear_ids
    decided["window_view"] = view
    if cases or stored or ccm_stray or unfit or blind or silent_runs:
        a1.status = "answered"
        a1.label = "arrives"
        a1.why.append("a number other than 0 with the list at rest for longer than %.0f s is a hang; shorter is the order effect (row 5), not a hang" % ORDER_S)
    elif any_episode:
        a1.status = "answered"
        a1.label = "arrives"
        decided["hang_cases"] = []
        a1.why.append("message episodes were seen and every one ended with the list at rest and the number at 0 (case A0): 0.7.20 closes the window correctly; no release setting is needed")
        decided["release"] = None
    else:
        a1.status = "not-yet"
        a1.needs.append("a door message (open the driver's door until BMW hides it) while f30 0.7.19+ runs")
        a1.why.append("no message episode in the log: the list never left rest")
    if n_orders:
        a1.why.append("%d short 'number without a list entry' stretches (at most %.0f s) were the order effect and are not counted as hangs" % (n_orders, ORDER_S))
    a1.decided = decided
    a1.dated = (cl.fmt_ts(ctx.last_ts(app)) or "")[:10]
    # ---- L2
    d2: Dict[str, object] = {}
    acts = [e for e in evs if e["kind"] == "act"]
    d2["notifies"] = bool(acts)
    if not acts:
        a2.status = "answered" if (ctx.last_ts(app) and (ctx.last_ts(app) - (ctx.first_ts(app) or 0)) >= 300) else "partial"
        a2.label = "not-sent" if a2.status == "answered" else None
        d2["observed_minutes"] = round(((ctx.last_ts(app) or 0) - (ctx.first_ts(app) or 0)) / 60.0, 1)
        d2["silent"] = True
        a2.why.append("no 'active cc:' line in the log of a build that writes it: the field was not sent while it ran (the A8 situation)")
    else:
        a2.status = "answered"
        a2.label = "arrives"
        first = [r["act_first"] for r in res["runs"] if r["act_first"]][0]
        a2.cite(first["line"], "first active cc line: number %s, %s s after the app start" % (first["number"], res["runs"][0]["first_act_in_s"]),
                number=first["number"])
        d2["first_value"] = first["number"]
        d2["getter_at_start"] = any(r["first_act_in_s"] is not None and r["first_act_in_s"] < 10 for r in res["runs"])
        rests: List[object] = []
        for r in res["runs"]:
            for ra in r["rest_after"]:
                if ra["act"] is None:
                    continue
                # the value the field holds one ORDER_S after the list went to rest: 0, 65535 or the number it had
                nxt = [e for e in evs if e["kind"] == "act" and e["ts"] is not None and ra["ts"] <= e["ts"] <= ra["ts"] + 3.0]
                v = nxt[-1]["number"] if nxt else ra["act"]
                rests.append("0" if v == 0 else "65535" if v == 65535 else "kept")
        d2["rests_on"] = (sorted(set(rests))[0] if len(set(rests)) == 1 else ("mixed" if rests else None))
        d2["rest_samples"] = len(rests)
        matches = 0
        tot = 0
        for e in acts:
            if e["number"] in (0, None, 65535):
                continue
            tot += 1
            near = [x for x in evs if x["kind"] == "list" and x["ts"] is not None and abs(x["ts"] - e["ts"]) <= 3.0]
            if any(e["number"] in [i for i, _c in x["ids"]] for x in near):
                matches += 1
        d2["number_is_ccList_id"] = (matches == tot) if tot else None
        d2["number_matches"] = "%d/%d" % (matches, tot)
        d2["noneValues"] = [0]
        a2.why.append("0 stays the only rest value: 65535 in noneValues would cover a listed message (MC F0, UNSAFE)")
        if d2["rests_on"] == "65535":
            d2["deferValues"] = [65535]
        if d2["rests_on"] == "kept":
            d2["leftList"] = True
        a2.why.append("rests_on is measured on the value the field holds within 3 s after the list returns to rest")
    a2.decided = d2
    a2.dated = a1.dated
    a2.material = a1.material
    return [a1, a2]


# --------------------------------------------------------------------------------------------------------------------

def l8(ctx: Ctx) -> Ans:
    a = Ans("L8", "the second witness: displayed cc arrives and returns to 0")
    lines = ctx.app_lines.get("twin_dial", []) + ctx.app_lines.get("f30_cluster", [])
    disp = [l for l in lines if _RE_DISP.match(l.msg)]
    if not disp:
        a.status = "no-material" if not ctx.app_lines.get("twin_dial") else "partial"
        a.needs.append("a Twin Dial 0.1.0+ (or f30 with config.ccDisplayed) log with a door message in it")
        a.why.append("no 'displayed cc:' line: either never sent or the build does not subscribe it")
        return a
    vals = [int(_RE_DISP.match(l.msg).group(1)) for l in disp]
    a.status = "answered"
    a.label = "arrives"
    a.decided = {"arrives": True, "returns_to_zero": 0 in vals, "values": sorted(set(vals))[:8], "lines": len(vals)}
    for l in disp[:3]:
        a.cite(l, "displayed cc: number %d" % int(_RE_DISP.match(l.msg).group(1)), number=int(_RE_DISP.match(l.msg).group(1)))
    return a
