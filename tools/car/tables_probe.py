"""Decision tables for the probe's lines: P1 P2 P6 P7 P8 P9 P10 P11 P12 P13 P14 P15 P16 P17 (final numbering of brief 3.2).

Each table is the code form of a table in a report:
  P1  docs/twin-dial/PROBE-PROTOCOL.md P1 (D7: strict -> false), research3/MC section 7 (H1..H5)
  P2  PROBE-PROTOCOL.md P2 (the stored-message marker)
  P6  PROBE-PROTOCOL.md P6 (cold start to warm)
  P7  PROBE-PROTOCOL.md P7 (doors: notifies at all; sends once at subscribe)
  P10 PROBE-PROTOCOL.md P10 (voltage)
  P8  twin-r3/sm SM-REPORT.md section 6 (media)
  P9  twin-r3/sp SP-REPORT.md section 5.2 (phone)
  P11, P13  twin-r3/sb SB-REPORT.md section 3.3 (the tab key)
  P12, P14  twin-r3/sn SN-REPORT.md section 3.1 (guidance, map presence)
  P15, P16, P17  twin-r3/sv SV-REPORT.md section 5 (sign, cruise, technical, others)

The tag names are the probe's labels (twin_probe.js TABLE); CP's final names are mapped in TAG_ALIASES.
Marker windows come from design/car/markers.json (class per marker number); without it the tables that need steps say so.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

import car_logs as cl
from context import Ctx
from tables_base import Ans
from tables_msg import analyse_cc, probe_timeline, list_entries
import tables_vitals

# CP may rename a tag; add the new name here and every table follows.
TAG_ALIASES: Dict[str, str] = {}


def canon(tag: str) -> str:
    return TAG_ALIASES.get(tag, tag)


def pstate(ctx: Ctx, *tags: str) -> Tuple[str, float]:
    """('no-material' | 'spoke' | 'silent' | 'unseen', minutes observed)"""
    if not ctx.probe and not ctx.summaries():
        return "no-material", 0.0
    if any(canon(p.tag) in tags for p in ctx.probe):
        return "spoke", ctx.probe_t_max() / 60.0
    sil = ctx.silent_tags()
    hit = [sil[t] for t in tags if t in sil]
    if hit:
        return "silent", max(hit)
    return "unseen", ctx.probe_t_max() / 60.0


def _mk(ctx: Ctx, aid: str, title: str, *tags: str) -> Tuple[Ans, Optional[str]]:
    """An answer pre-filled for the cases 'no probe material' and 'every field silent'; returns (ans, stop-reason)."""
    a = Ans(aid, title)
    st, mins = pstate(ctx, *tags)
    a.material = sorted({cl.rel(p) for app in ("signal_probe", "twin_dial") for p in ctx.session.app_logs(app)})
    pts = [p.ts for p in ctx.probe if p.ts]
    a.dated = (cl.fmt_ts(max(pts)) or "")[:10] if pts else None
    if st == "no-material":
        a.status = "no-material"
        a.needs.append("the probe's log (signal_probe or Twin Dial's probe build) of the session")
        return a, "stop"
    if st == "silent":
        # what was done meanwhile: the session steps whose marks were pressed and that expected one of these fields
        done = []
        for m in ctx.markers:
            e = ctx.marker_map.get(str(m.n)) if isinstance(ctx.marker_map, dict) else None
            if isinstance(e, dict) and any(len(x) == 2 and x[1] in tags for x in e.get("expect", [])) and e.get("step") and e["step"] not in done:
                done.append(e["step"])
        a.status = "answered" if mins >= 2.0 else "partial"
        a.label = "not-sent" if mins >= 2.0 else None
        a.decided = {"arrives": False, "observed_minutes": round(mins, 1), "tags": list(tags), "steps_done_that_expected_it": done[:12], "marks_pressed": len(ctx.markers)}
        a.why.append("the probe's summary names every one of these fields silent after %.1f minutes" % mins)
        if mins < 2.0:
            a.needs.append("at least 2 minutes of the set switched on after the action (the +120 s summary): too short to call it not sent")
        asks = {}
        for app in ("signal_probe", "twin_dial"):
            asks.update(cl.probe_asks(ctx.app_lines.get(app, [])))
        out = {t: asks[t] for t in tags if t in asks}
        if out:
            a.decided["getter_outcome"] = out
        return a, "stop"
    if st == "unseen":
        a.status = "not-yet"
        a.label = "unseen"
        a.needs.append("the probe build that carries these fields (they are not in its table / its summary)")
        return a, "stop"
    a.label = "arrives"
    return a, None


def lines_in(ctx: Ctx, tags, a: Optional[float], b: Optional[float]) -> List[cl.ProbeLine]:
    return [p for p in ctx.probe if canon(p.tag) in tags and p.ts is not None and (a is None or p.ts >= a - 0.001) and (b is None or p.ts <= b + 0.001)]


def seq_of(ctx: Ctx, tag: str, key: str) -> List[Tuple[cl.ProbeLine, object]]:
    out = []
    for p in ctx.probe:
        if canon(p.tag) == tag:
            v = p.val(key)
            out.append((p, v if v is not None else p.enum(key)))
    return out


# --------------------------------------------------------------------------------------------------------------------
# P1 / P2

def p1(ctx: Ctx) -> Ans:
    a, stop = _mk(ctx, "P1", "which message the cluster shows now (decides D7; the frame counter)", "active-cc", "displayed-cc", "menu-cc", "ccList")
    if stop:
        return a
    evs = probe_timeline(ctx)
    runs = [(min(e["ts"] for e in evs), max(e["ts"] for e in evs), "probe")] if evs else []
    d: Dict[str, object] = {}
    acts = [e for e in evs if e["kind"] == "act"]
    lists = [e for e in evs if e["kind"] == "list"]
    disp = [e for e in evs if e["kind"] == "disp"]
    frames = [e for e in evs if e["kind"] == "frames"]
    d["active_cc_arrives"] = bool(acts)
    d["displayed_cc_arrives"] = bool(disp)
    d["list_arrives"] = bool(lists)
    if acts and lists:
        res = analyse_cc(evs, runs)
        r = res["runs"][0]
        matched = 0
        total = 0
        for e in acts:
            if e["number"] in (0, None, 65535):
                continue
            total += 1
            near = [x for x in lists if abs(x["ts"] - e["ts"]) <= 3.0]
            if any(e["number"] in [i for i, _c in x["ids"]] for x in near):
                matched += 1
        d["number_equals_ccList_id"] = "%d/%d" % (matched, total)
        d["returns_to_zero"] = any(e["number"] == 0 for e in acts if any(x["rest"] for x in lists if abs(x["ts"] - e["ts"]) <= 3.0))
        d["order_effects"] = len(r["order_effects"])
        d["hang_stretches"] = [{"number": h["number"], "dur_s": h["dur"], "open_at_end": h["open"]} for h in r["hangs"][:4]]
        d["strict_can_be_lifted"] = bool(total and matched == total and d["returns_to_zero"] and not r["hangs"])
        for h in r["hangs"][:2]:
            a.cite(h["line"], "number %s with the list at rest for %d s" % (h["number"], int(h["dur"])), number=h["number"], dur_s=h["dur"])
        if acts:
            a.cite(acts[0]["line"], "first active-cc line, number %s" % acts[0]["number"], number=acts[0]["number"])
        a.why.append("D7 may be lifted (owner's decision) only when the number equals a ccList id during messages, returns to 0, and no hang stretch exists")
        a.status = "answered"
    elif lists and not acts:
        a.status = "answered"
        a.label = "not-sent"
        d["active_cc_arrives"] = False
        d["observed_minutes"] = round(ctx.probe_t_max() / 60.0, 1)
        a.why.append("the list arrives but active-cc stays silent: keep D7 strict (the window is open while a message may show)")
    else:
        a.status = "partial"
        a.needs.append("a door opened and closed in the log (steps P1.2-P1.4)")
    if disp:
        zero = any(e["number"] == 0 for e in disp)
        d["displayed_returns_to_zero"] = zero
    if frames:
        of = [e for e in frames if e.get("of") and e["of"] >= 2]
        d["frame_counter_follows_cycle"] = bool(of)
    a.decided = d
    return a


def p2(ctx: Ctx) -> Ans:
    a, stop = _mk(ctx, "P2", "the stored-message mark: basicList / ccListRiskClass", "basicList", "ccListRiskClass")
    if stop:
        return a
    ents: Dict[str, List[Tuple[float, str]]] = {}
    for p in ctx.probe:
        if canon(p.tag) == "basicList":
            for e in list_entries(p.body):
                ents.setdefault(str(e.get("id")), []).append((p.ts, "%s/%s" % (e.get("reason"), e.get("state"))))
    evs = probe_timeline(ctx)
    lists = [e for e in evs if e["kind"] == "list"]
    flips = {}
    for k, v in ents.items():
        states = [s for _t, s in v]
        if len(set(states)) > 1:
            flips[k] = states
    # does a state change coincide (within 3 s) with a ccList episode starting or ending?
    coincide = {}
    for k, v in ents.items():
        cnt = 0
        for i in range(1, len(v)):
            if v[i][1] != v[i - 1][1] and any(abs(x["ts"] - v[i][0]) <= 3.0 for x in lists):
                cnt += 1
        if cnt:
            coincide[k] = cnt
    d: Dict[str, object] = {"basicList_entries": len(ents), "entries_that_flip": {k: [s.split("/")[1] for s in v if "/" in s and re.match(r"^[A-Z0-9_]+/[A-Z0-9_]+$", s)] for k, v in flips.items()},
                            "flips_with_list_episode": coincide}
    risk = {}
    for p in ctx.probe:
        if canon(p.tag) == "ccListRiskClass":
            for e in list_entries(p.body):
                if e.get("risk") and e.get("colour"):
                    risk.setdefault(str(e["risk"]), set()).add(str(e["colour"]))
    d["risk_to_colours"] = {k: sorted(v) for k, v in risk.items() if re.match(r"^[A-Z0-9_]+$", k)}
    a.decided = d
    a.status = "partial" if flips or ents else "answered"
    if coincide:
        k = sorted(coincide)[0]
        d["candidate_marker"] = {"id": int(k) if k.isdigit() else None, "field": "basicList", "key": "state"}
        a.why.append("an entry that flips together with a message episode is a candidate; the photo of BMW's marker (visible / not) must confirm before config.ccMarker is set")
        a.needs.append("owner's photo: BMW's stored-message marker visible / not visible at the same time")
    elif ents:
        a.why.append("no basicList entry changed state with a message episode: the marker stays covered (D7)")
        a.status = "answered"
    return a


# --------------------------------------------------------------------------------------------------------------------
# P6 P7 P10

def p6(ctx: Ctx) -> Ans:
    a, stop = _mk(ctx, "P6", "cold start to warm: the car's own coolant verdict against the temperature", "engine-verdict", "coolant")
    if stop:
        vit = tables_vitals.vitals(ctx)
        if vit is not None and vit["eng"] and a.status in ("no-material", "not-yet"):
            f = tables_vitals.facts(vit)
            a.status = "partial"
            a.label = "arrives-other-app"
            a.decided = {k: f[k] for k in f if k.startswith("engine_temp")}
            a.dated = (cl.fmt_ts(vit["last"]) or "")[:10]
            a.material = sorted({cl.rel(p) for p in ctx.session.app_logs("car_vitals")})
            a.cite(vit["first_line"]["engine_temps"], "car_vitals raw engine temperatures line (another app's log)")
            a.why.append("the engine temperatures arrive (another app's log); the raw range is in the decided block (raw - 48 is the scale SV verified for the coolant); the car's own verdict (COLD / OK / HOT) is not in that log")
            a.needs.append("the probe's engine-verdict through a cold start (P6)")
        return a
    verd = [(p.ts, p.enum("verdict")) for p in ctx.probe if canon(p.tag) == "engine-verdict" and p.enum("verdict")]
    temps = []
    for p in ctx.probe:
        if canon(p.tag) == "coolant":
            m = re.search(r"coolant-raw=(\d+)", p.body)
            if m and int(m.group(1)) < 255:
                temps.append((p.ts, int(m.group(1)) - 48))
    d: Dict[str, object] = {"verdicts_seen": sorted({v for _t, v in verd}), "temps_lines": len(temps)}
    cold_to_ok = None
    for i in range(1, len(verd)):
        if verd[i - 1][1] == "COLD" and verd[i][1] != "COLD":
            before = [t for ts, t in temps if ts <= verd[i][0]]
            cold_to_ok = before[-1] if before else None
            d["coldC"] = cold_to_ok
            break
    hot = [i for i in range(1, len(verd)) if verd[i][1] == "HOT"]
    if hot and temps:
        before = [t for ts, t in temps if ts <= verd[hot[0]][0]]
        d["hotC"] = before[-1] if before else None
    d["temp_min_max"] = [min(t for _s, t in temps), max(t for _s, t in temps)] if temps else None
    a.decided = d
    a.status = "answered" if (cold_to_ok is not None or verd) else "partial"
    if verd:
        a.cite(_by_ts(ctx, "engine-verdict", verd[0][0]), "first engine verdict %s" % verd[0][1], verdict=verd[0][1])
    if not verd and temps:
        a.why.append("the verdict is silent but the coolant value moves: keep the 50 to 130 C linear hypothesis")
    if verd and not temps:
        a.why.append("the verdict fires but the coolant value does not: the bar uses the verdict (four steps)")
    if cold_to_ok is None and "COLD" in d["verdicts_seen"]:
        a.needs.append("the engine warming through the COLD -> OK change in the log (cold start)")
    return a


def _by_ts(ctx: Ctx, tag: str, ts):
    for p in ctx.probe:
        if canon(p.tag) == tag and p.ts == ts:
            return p
    return ctx.probe[0]


def p7(ctx: Ctx) -> Ans:
    a, stop = _mk(ctx, "P7", "doors, boot, bonnet, central locking: notifies at all; sends once at subscribe", "doors", "lids", "zv-status")
    if stop:
        return a
    d: Dict[str, object] = {}
    first_t = {}
    vals: Dict[str, List[str]] = {}
    for p in ctx.probe:
        if canon(p.tag) in ("doors", "lids", "zv-status"):
            first_t.setdefault(canon(p.tag), p.t)
            for k, v in p.kv.items():
                if re.match(r"^[A-Z0-9_]+$", v) or cl.num(v) is not None:
                    vals.setdefault(canon(p.tag) + "." + k, [])
                    if v not in vals[canon(p.tag) + "." + k]:
                        vals[canon(p.tag) + "." + k].append(v)
    d["once_at_subscribe"] = {t: (s <= 10.0) for t, s in first_t.items()}
    d["fields_with_two_values"] = sorted(k for k, v in vals.items() if len(v) > 1)
    # the open value: the one that differs from the first value seen, per field
    ov = {}
    for k, v in vals.items():
        if len(v) > 1:
            ov[k] = [x for x in v[1:] if re.match(r"^[A-Z0-9_]+$", x)][:2]
    d["changed_to"] = ov
    d["notifies"] = bool(d["fields_with_two_values"])
    a.decided = d
    a.status = "answered" if d["notifies"] else "partial"
    if not d["notifies"]:
        a.needs.append("one door opened and closed in the log (P7 steps)")
    a.why.append("the car picture starts 'unknown', never 'closed', unless the first line comes at subscribe (once_at_subscribe)")
    return a


def p10(ctx: Ctx) -> Ans:
    a, stop = _mk(ctx, "P10", "voltage: a plausible 12-14.8 V; the scale", "voltage-basic", "voltage-hu", "battery-condition")
    if stop:
        return a
    series = seq_of(ctx, "voltage-basic", "voltage") + seq_of(ctx, "voltage-hu", "value")
    vs = [v for _p, v in series if isinstance(v, (int, float))]
    d: Dict[str, object] = {"lines": len(vs)}
    cand = []
    for f in (1.0, 0.1, 0.01, 0.001):
        sc = [v * f for v in vs]
        if sc and all(8.0 <= x <= 16.5 for x in sc):
            cand.append(f)
    d["scale_candidates"] = cand
    if vs:
        d["min_max_raw"] = [min(vs), max(vs)]
    a.decided = d
    a.status = "answered" if cand else "partial"
    if len(cand) > 1:
        a.why.append("more than one scale gives a plausible range; engine off / on (a rise of ~1-2 V) picks one")
    if not cand and vs:
        a.why.append("no scale puts every value in 8-16.5 V: a wrong member, or bits packed")
    return a


# --------------------------------------------------------------------------------------------------------------------
# P8 media (SM)

def p8(ctx: Ctx) -> Ans:
    a, stop = _mk(ctx, "P8", "media: titles, progress, source icon, radio detail, CarPlay player", "player-metadata", "main-menu-metadata", "track-progress",
                  "media-menu", "station", "cp-player-state", "cp-item-time", "cp-item-position", "cp-item-metadata", "cp-device", "main-connections", "active-source", "sources")
    if stop:
        return a
    d: Dict[str, object] = {}
    tags = {canon(p.tag) for p in ctx.probe}
    d["arrives"] = sorted(t for t in tags if t in {"player-metadata", "main-menu-metadata", "track-progress", "media-menu", "station", "cp-player-state",
                                                    "cp-item-time", "cp-item-position", "cp-item-metadata", "cp-device", "main-connections", "active-source", "sources"})
    # which line is the title: line1-len / line2-len / line3-len equal to the owner's counted length
    reads = ctx.readings.get("media") if isinstance(ctx.readings.get("media"), dict) else {}
    votes: Dict[str, int] = {}
    n = 0
    for mk, r in reads.items():
        if not isinstance(r, dict) or "title_len" not in r:
            continue
        m = next((x for x in ctx.markers if str(x.n) == str(mk)), None)
        if m is None:
            continue
        nxt = [x.ts for x in ctx.markers if x.ts and x.ts > m.ts]
        pl = lines_in(ctx, ("player-metadata",), m.ts, (nxt[0] if nxt else m.ts + 60))
        if not pl:
            continue
        n += 1
        last = pl[-1]
        for key in ("line1-len", "line2-len", "line3-len"):
            if last.val(key) == r["title_len"]:
                votes[key] = votes.get(key, 0) + 1
    if n:
        best = sorted(votes.items(), key=lambda kv: -kv[1])
        d["titleLine_votes"] = {k: v for k, v in votes.items()}
        d["titleLine"] = best[0][0].split("-")[0].replace("line", "") if best and best[0][1] == n else None
        d["titleLine_readings"] = n
    # the source's icon follows the source
    icons = sorted({p.enum("selected-icon") for p in ctx.probe if canon(p.tag) == "media-menu" and p.enum("selected-icon")})
    mm = [p for p in ctx.probe if canon(p.tag) == "media-menu"]
    d["selected_icons"] = icons
    for p in mm:
        m = re.search(r"selected-icon=([A-Z0-9_]+)", p.body)
        if m and m.group(1) not in icons:
            icons.append(m.group(1))
    d["selected_icons"] = sorted(set(icons))
    # progress and its unit
    prog = [p for p in ctx.probe if canon(p.tag) == "track-progress" and re.search(r"hasProgress=true", p.body)]
    d["progress_arrives"] = bool(prog)
    if len(prog) >= 2:
        steps = []
        for i in range(1, len(prog)):
            e0, e1 = prog[i - 1].val("elapsed"), prog[i].val("elapsed")
            dt = (prog[i].ts - prog[i - 1].ts) if prog[i].ts and prog[i - 1].ts else None
            if e0 is not None and e1 is not None and dt and dt >= 2 and e1 > e0:
                steps.append((e1 - e0) / dt)
        if steps:
            med = sorted(steps)[len(steps) // 2]
            d["progress_units_per_s"] = round(med, 2)
            d["progress_unit"] = "ms" if 700 <= med <= 1300 else "s" if 0.7 <= med <= 1.3 else "other"
    st = [p for p in ctx.probe if canon(p.tag) == "station"]
    d["radio_arrives"] = bool(st)
    if st:
        d["radio_bands"] = sorted({p.enum("band") for p in st if p.enum("band")})
        d["radio_text_len_seen"] = any((p.val("rt-len") or 0) > 0 for p in st)
        d["radio_freq_band_only"] = all(re.search(r"freq=(fm|am|dab)-range", p.body) for p in st)
    cp = [p for p in ctx.probe if canon(p.tag).startswith("cp-")]
    d["carplay_lines"] = len(cp)
    cpw = ctx.class_windows("src-carplay")
    if cp and cpw:
        inside = sum(1 for p in cp if any(a_ <= p.ts <= b_ for a_, b_, _n in cpw))
        d["carplay_lines_inside_carplay_windows"] = "%d/%d" % (inside, len(cp))
    mc = [p for p in ctx.probe if canon(p.tag) == "main-connections"]
    if mc:
        d["connection_states"] = sorted({s for p in mc for s in re.findall(r"state=([A-Z0-9_]+)", p.body)})
    a.decided = d
    a.status = "answered" if d["arrives"] else "partial"
    if not d["arrives"]:
        a.label = "not-sent"
        a.why.append("tab 3 = M3 (pictogram only), or tab 3 goes to another page (SV's candidates)")
    for p in (ctx.probe_by("player-metadata") or ctx.probe_by("media-menu") or [])[:1]:
        a.cite(p, "first %s line (lengths and enum names only)" % canon(p.tag), **{k: p.val(k) for k in ("line1-len", "line2-len", "line3-len") if p.val(k) is not None})
    if reads == {}:
        a.needs.append("the owner's counted title length per marker (readings.json media.<marker>.title_len) to pick the title line")
    return a


# --------------------------------------------------------------------------------------------------------------------
# P9 phone (SP)

def p9(ctx: Ctx) -> Ans:
    tags = ("call-state", "carplay-call", "phone-call1-state", "phone-call1-duration", "phone-call1-contact", "phone-call1-modem", "phone-call1-name",
            "phone-devices", "phone-active-roles", "phone-calllist", "audio-tel-mute", "nad-call", "nad-register", "hmi-app", "phone-mic-muted")
    a, stop = _mk(ctx, "P9", "phone: the call's states, battery / signal, the car's own modem", *tags)
    if stop:
        return a
    d: Dict[str, object] = {}
    cs = seq_of(ctx, "call-state", "state")
    states = []
    for _p, v in cs:
        if isinstance(v, str) and v not in states:
            states.append(v)
    d["call_states_seen"] = states
    d["moves_incoming_active_disconnected"] = all(s in states for s in ("INCOMING", "ACTIVE", "DISCONNECTED"))
    c1 = seq_of(ctx, "phone-call1-state", "state")
    d["call1_state_moves"] = len({v for _p, v in c1 if v}) > 1
    d["call1_silent_while_call_state_moves"] = bool(cs) and not c1 and len(states) > 1
    dur = [(p.ts, p.val("value")) for p in ctx.probe if canon(p.tag) == "phone-call1-duration" and p.val("value") is not None]
    if len(dur) >= 3:
        rates = [(dur[i][1] - dur[i - 1][1]) / (dur[i][0] - dur[i - 1][0]) for i in range(1, len(dur)) if dur[i][0] - dur[i - 1][0] > 0 and dur[i][1] >= dur[i - 1][1]]
        if rates:
            d["duration_units_per_s"] = round(sorted(rates)[len(rates) // 2], 2)
            d["duration_is_seconds"] = 0.8 <= d["duration_units_per_s"] <= 1.2
    known = sorted({p.enum("known") or re.search(r"known=(\w+)", p.body).group(1) for p in ctx.probe if canon(p.tag) == "phone-call1-contact" and re.search(r"known=(\w+)", p.body)})
    d["contact_known_values"] = [k for k in known if k in ("true", "false")]
    d["name_len_gt0"] = any((p.val("len") or 0) > 0 for p in ctx.probe if canon(p.tag) == "phone-call1-name")
    dv = [p for p in ctx.probe if canon(p.tag) == "phone-devices"]
    if dv:
        bat = [int(x) for p in dv for x in re.findall(r"battery=(\d+)", p.body)]
        sig = [int(x) for p in dv for x in re.findall(r"signal=(\d+)", p.body)]
        d["battery_range"] = [min(bat), max(bat)] if bat else None
        d["signal_range"] = [min(sig), max(sig)] if sig else None
        d["battery_nonzero"] = any(b > 0 for b in bat)
        d["signal_nonzero"] = any(s > 0 for s in sig)
    cl_ = [p for p in ctx.probe if canon(p.tag) == "phone-calllist"]
    if cl_:
        ms = [int(re.search(r"missed=(\d+)", p.body).group(1)) for p in cl_ if re.search(r"missed=(\d+)", p.body)]
        d["missed_rises"] = bool(ms) and max(ms) > ms[0]
    d["audio_tel_mute_changes"] = len({p.val("mute") for p in ctx.probe if canon(p.tag) == "audio-tel-mute"}) > 1
    nad = [p for p in ctx.probe if canon(p.tag) in ("nad-call", "nad-register")]
    d["nad_moves_during_phone_call"] = False
    cpw = ctx.class_windows("call-phone")
    if nad and cpw:
        d["nad_moves_during_phone_call"] = any(any(a_ <= p.ts <= b_ for a_, b_, _n in cpw) for p in nad)
    d["carplay_call_arrives"] = any(canon(p.tag) == "carplay-call" for p in ctx.probe)
    a.decided = d
    a.status = "answered" if d["call_states_seen"] or d["call1_state_moves"] or dv else "partial"
    if not cs:
        a.label = "not-sent"
        a.why.append("nothing moved in call-state: no phone card; the icon stays static, tab 4 goes to SV")
    for p, v in cs[:2]:
        a.cite(p, "call-state line: %s" % v, state=v)
    if not d.get("battery_nonzero") and dv:
        a.why.append("battery / signal zero throughout: no bars; idle page shows connected / not only")
    return a


# --------------------------------------------------------------------------------------------------------------------
# P11 / P13 the tab key (SB 3.3)

WHEEL_TAGS = ("sw-special1", "sw-special2", "sw-fav", "sw-fc", "sw-wheel-steps", "sw-wheel-press", "sw-skip", "sw-volume", "sw-voice", "sw-phone")
VIEW_TAGS = ("ic-widget", "ic-context", "ic-widget2", "ic-context2", "kombi-selection", "kombi-available", "kombi-config", "display-kombi")
BC_CLASSES = ("bc-short",)
OTHER_STALK = ("stalk-left", "stalk-right", "stalk-hold-left", "stalk-flash")


def _class_wins(ctx: Ctx, classes) -> List[tuple]:
    out = []
    for c in classes:
        out.extend((a_, b_, n, c) for a_, b_, n in ctx.class_windows(c))
    return out


def stalk_bits(ctx: Ctx) -> List[dict]:
    """Every bit change of the stalk byte with the marker (number and class) in force: [{ts, bit, to, marker, cls, line}].

    signal_probe's line carries up= (bits 0 -> 1) and down= (bits 1 -> 0) and since=M<n>+<ms>; the older probe line carries only
    the byte, so the change is derived from two neighbours.  The marker is the one in the line's since= when there is one."""
    out = []
    prev = None
    for p in ctx.probe:
        if canon(p.tag) != "stalk":
            continue
        v = p.val("stalks")
        if v is None:
            continue
        v = int(v)
        up, down = p.val("up"), p.val("down")
        if up is not None and down is not None:
            changes = [(b, 1) for b in range(16) if int(up) & (1 << b)] + [(b, 0) for b in range(16) if int(down) & (1 << b)]
        elif prev is not None:
            diff = v ^ prev
            changes = [(b, 1 if v & (1 << b) else 0) for b in range(16) if diff & (1 << b)]
        else:
            changes = []
        mn = None
        sm = re.search(r"since=M(\d+)\+", p.body)
        mk = None
        if sm:
            mn = int(sm.group(1))
            mk = next((m for m in reversed(ctx.markers) if m.n == mn and m.ts is not None and m.ts <= p.ts + 0.001), None)
        else:
            mk = ctx.marker_at(p.ts)
            mn = mk.n if mk else None
        for bit, to in changes:
            out.append({"ts": p.ts, "bit": bit, "to": to, "marker": mn, "cls": ctx.marker_class(mk), "line": p})
        prev = v
    return out


def p13(ctx: Ctx) -> Ans:
    tags = ("stalk", "stalk-complete") + WHEEL_TAGS + ("controller", "controller-keys", "hmi-shortcut")
    a, stop = _mk(ctx, "P13", "the tab key: which button, which bit (SB 3.3)", *tags)
    if stop:
        return a
    d: Dict[str, object] = {}
    spoke = {canon(p.tag) for p in ctx.probe}
    d["lines_by_tag"] = {t: sum(1 for p in ctx.probe if canon(p.tag) == t) for t in tags if t in spoke}
    chg = stalk_bits(ctx)
    mapped = bool(ctx.marker_map)
    # row 1: a stalk bit that changes in bc-short windows and in no other stalk window
    if chg:
        by_bit: Dict[int, Dict[str, set]] = {}
        for c in chg:
            by_bit.setdefault(c["bit"], {}).setdefault(c["cls"] or "unlabelled", set()).add(c["marker"])
        d["stalk_bit_windows"] = {str(b): {k: sorted(x for x in v if x is not None) for k, v in ws.items()} for b, ws in sorted(by_bit.items())}
        if mapped:
            cand = []
            for b, ws in by_bit.items():
                in_bc = "bc-short" in ws
                elsewhere = any(k in OTHER_STALK or k in ("bc-long", "msg-bc-short") and False for k in ws) or any(k in OTHER_STALK for k in ws)
                if in_bc and not elsewhere:
                    cand.append(b)
            if len(cand) == 1:
                b = cand[0]
                d["tab_key"] = {"kind": "stalk-bit", "bit": b, "mask": 1 << b, "iface": "de.bmw.body.Light", "field": "IndicatorSteeringColumn",
                                "path": ["operationColumnStalks"]}
                a.why.append("bit %d moved in bc-short windows and in no other stalk window: the on-board-computer button" % b)
                a.cite(next(c["line"] for c in chg if c["bit"] == b), "stalk bit %d changed in a bc-short window" % b, bit=b, mask=1 << b)
            elif len(cand) > 1:
                d["tab_key"] = None
                d["ambiguous_bits"] = cand
                a.why.append("more than one bit moved only in bc-short windows: repeat with one press at a time")
            else:
                d["stalk_row_private_bit"] = False
                a.why.append("the stalk byte moved, but no bit is private to the bc-short steps")
        else:
            a.needs.append("design/car/markers.json (marker number -> step class) to say which bit moved on which step")
            a.why.append("the stalk byte changed; without the marker map the bits cannot be attributed to steps")
    else:
        d["stalk_silent"] = "stalk" not in spoke
    # row 2: indirect key: view state changes in every bc-short window while the stalk is silent
    bcw = ctx.class_windows("bc-short")
    if bcw and "tab_key" not in d:
        hits = {}
        for tag in VIEW_TAGS:
            n_hit = sum(1 for (a_, b_, _n) in bcw if lines_in(ctx, (tag,), a_, b_))
            if n_hit == len(bcw):
                hits[tag] = n_hit
        if hits:
            t = sorted(hits)[0]
            d["tab_key"] = {"kind": "indirect-any", "tag": t, "any": True}
            a.why.append("the stalk is silent but %s changes in every bc-short window: an indirect key (any change = one step)" % t)
    # row 3: a spare special button: changes in its wheel-special window
    for tag, cls in (("sw-special1", "wheel-special1"), ("sw-special2", "wheel-special2")):
        ws = ctx.class_windows(cls)
        if ws and any(lines_in(ctx, (tag,), a_, b_) for a_, b_, _n in ws):
            d.setdefault("spare_buttons", []).append(tag)
    if d.get("spare_buttons") and "tab_key" not in d:
        d["tab_key"] = {"kind": "press", "tags": d["spare_buttons"], "press": [1, "TASTER_GEDRUECKT"], "only_if": "the button does nothing on the stock car (owner)"}
    # row 4: thumbwheel: free only if it changes with no list open and not only with one
    free = False
    nol = [w for c in ("thumb-up", "thumb-down") for w in ctx.class_windows(c)]
    lst = [w for c in ("thumb-list-up", "thumb-list-down") for w in ctx.class_windows(c)]
    if nol or lst:
        in_free = any(lines_in(ctx, ("sw-wheel-steps",), a_, b_) for a_, b_, _n in nol)
        in_list = any(lines_in(ctx, ("sw-wheel-steps",), a_, b_) for a_, b_, _n in lst)
        d["thumbwheel"] = {"changes_without_list": in_free, "changes_with_list": in_list}
        if in_free and "tab_key" not in d:
            d["tab_key"] = {"kind": "scroll", "tag": "sw-wheel-steps", "counter": True, "only_if": "BMW does nothing visible on the same clicks (owner)"}
        elif in_list and not in_free:
            d["thumbwheel_owned_by_cluster"] = True
    # row 5/6: controller; step 6 (message showing)
    d["controller_lines"] = d["lines_by_tag"].get("controller", 0)
    msgw = ctx.class_windows("msg-bc-short")
    if msgw and bcw and d.get("tab_key", {}) and d["tab_key"].get("kind") == "stalk-bit":
        b = d["tab_key"]["bit"]
        in_msg = any(c["bit"] == b and c["cls"] == "msg-bc-short" for c in chg)
        d["key_seen_while_message_shows"] = in_msg
        if not in_msg:
            d["kombi_consumes_press_during_message"] = True
    a.decided = d
    if d.get("tab_key"):
        a.status = "answered"
    elif not spoke.intersection(tags):
        a.status = "answered"
        a.label = "not-sent"
        a.why.append("nothing at all from the control-element fields: the setting and the auto rules only")
    else:
        a.status = "partial" if (chg or d["lines_by_tag"]) else "answered"
        if not d.get("tab_key"):
            d["tab_key"] = None
            a.why.append("no candidate key: the setting (Tab = auto / 1 / 2 / 5) and the auto rules remain")
    return a


def p11(ctx: Ctx) -> Ans:
    a, stop = _mk(ctx, "P11", "the cluster's view setting (map view) and the indirect key", *VIEW_TAGS)
    if stop:
        return a
    d: Dict[str, object] = {"arrives": sorted({canon(p.tag) for p in ctx.probe if canon(p.tag) in VIEW_TAGS})}
    nav = []
    for p in ctx.probe:
        if canon(p.tag) == "kombi-config":
            m = re.search(r"navDisplay=([A-Z0-9_]+|\d+)", p.body)
            if m:
                nav.append(m.group(1))
    d["navDisplay_values"] = sorted(set(nav))
    d["navDisplay_changes"] = len(set(nav)) > 1
    vw = sorted({p.enum("view") for p in ctx.probe if canon(p.tag) == "display-kombi" and p.enum("view")})
    d["display_kombi_views"] = vw
    ch = {t: sum(1 for p in ctx.probe if canon(p.tag) == t) for t in VIEW_TAGS if any(canon(p.tag) == t for p in ctx.probe)}
    d["lines_by_tag"] = ch
    cvw = ctx.class_windows("cluster-view")
    if cvw:
        d["changes_in_cluster_view_windows"] = {t: sum(1 for (a_, b_, _n) in cvw if lines_in(ctx, (t,), a_, b_)) for t in VIEW_TAGS if t in ch}
    a.decided = d
    a.status = "answered" if ch else "partial"
    a.why.append("navDisplay changing with the owner's cluster-view steps means the map-view setting is readable (SN presence rule)")
    return a


# --------------------------------------------------------------------------------------------------------------------
# P12 / P14 navigation (SN)

def p12(ctx: Ctx) -> Ans:
    tags = ("guiding-state", "guidance-state", "next-intersection", "dart", "lanes", "next-destination", "road", "on-guidable-road", "guiding-provider",
            "kombi-lanes", "kombi-lanes-ext", "carplay-guidance", "aa-guidance")
    a, stop = _mk(ctx, "P12", "guided route: guidance state, the manoeuvre kind, the distance unit, lanes (SN 3.1)", *tags)
    if stop:
        return a
    d: Dict[str, object] = {}
    gs = [p.enum("state") for p in ctx.probe if canon(p.tag) in ("guiding-state", "guidance-state") and p.enum("state")]
    d["guiding_states"] = sorted(set(gs))
    d["guiding_reaches_active"] = "ACTIVE" in gs
    dart = [p for p in ctx.probe if canon(p.tag) == "dart"]
    d["dart_arrives"] = bool(dart)
    if dart:
        d["dart_kinds"] = sorted({(p.enum("kind") or str(p.kv.get("kind"))) if (p.enum("kind") or str(p.kv.get("kind"))) in ("intersection", "roundabout", "destinationManeuver", "fork", "exit", "ferry", "tunnel", "lane") else "other"
                                      for p in dart if p.kv.get("kind")})[:8]
        d["dart_directions"] = sorted({p.enum("direction") for p in dart if p.enum("direction")})[:12]
        raws = [p.val("raw") for p in dart if p.val("raw") is not None]
        d["raw_falls_to_zero_at_a_turn"] = bool(raws) and min(raws) == 0 and max(raws) > 0
        units = sorted({p.enum("unit") for p in dart if p.enum("unit")})
        d["dart_units"] = units
        d["destination_manoeuvre_seen"] = any("destinationManeuver" in p.body or p.kv.get("kind") == "destinationManeuver" for p in dart)
        # raw against the car's text: the owner reads the distance as text at a marker (readings.guidance.<marker>.text_m)
        gr = ctx.readings.get("guidance") if isinstance(ctx.readings.get("guidance"), dict) else {}
        votes = []
        for mk, r in gr.items():
            if not isinstance(r, dict) or "metres" not in r:
                continue
            m = next((x for x in ctx.markers if str(x.n) == str(mk)), None)
            if m is None:
                continue
            near = [p for p in dart if p.ts and abs(p.ts - m.ts) <= 20 and p.val("raw") is not None]
            if near:
                p = min(near, key=lambda q: abs(q.ts - m.ts))
                votes.append(round(p.val("raw") / r["metres"], 3) if r["metres"] else None)
        if votes:
            d["raw_over_shown_metres"] = votes
            d["raw_is_metres"] = all(v is not None and 0.8 <= v <= 1.2 for v in votes)
        a.cite(dart[0], "first dart line, kind present, raw %s" % dart[0].val("raw"), raw=dart[0].val("raw"))
    d["next_intersection_arrives"] = any(canon(p.tag) == "next-intersection" for p in ctx.probe)
    lanes = [p for p in ctx.probe if canon(p.tag) == "lanes"]
    d["lanes_rows_ge1"] = any((p.val("rows") or 0) >= 1 for p in lanes)
    kl = [p for p in ctx.probe if canon(p.tag) == "kombi-lanes"]
    d["bmw_shows_its_own_turn"] = any("GUIDING_MANEUVER_DISPLAYED" in p.body for p in kl)
    prov = sorted({p.enum("state") for p in ctx.probe if canon(p.tag) == "guiding-provider" and p.enum("state")})
    d["guiding_providers"] = prov
    d["carplay_guidance_active_seen"] = any(re.search(r"active=true", p.body) for p in ctx.probe if canon(p.tag) in ("carplay-guidance", "aa-guidance"))
    a.decided = d
    a.status = "answered" if (gs or dart) else "partial"
    if gs and not dart and d["next_intersection_arrives"]:
        a.why.append("dart silent, next-intersection speaks: distance and next road only, no arrow (the tab still lit)")
    if gs and not dart and not d["next_intersection_arrives"]:
        a.why.append("guidance state arrives but no manoeuvre field: tab 5 lit with the map window only")
    return a


def p14(ctx: Ctx) -> Ans:
    a, stop = _mk(ctx, "P14", "when BMW's map exists: map-without-route and junction-3d-in-kombi", "map-without-route", "junction-3d-in-kombi")
    if stop:
        return a
    d: Dict[str, object] = {}
    for tag in ("map-without-route", "junction-3d-in-kombi"):
        v = sorted({m.group(1) for p in ctx.probe if canon(p.tag) == tag for m in [re.search(r"active=(\w+)", p.body)] if m})
        d[tag.replace("-", "_") + "_values"] = v
    nav = [p for p in ctx.probe if canon(p.tag) == "kombi-config" and re.search(r"navDisplay=", p.body)]
    d["navDisplay_seen"] = sorted({re.search(r"navDisplay=([A-Z0-9_]+|\d+)", p.body).group(1) for p in nav})
    a.decided = d
    a.status = "answered"
    a.why.append("map-without-route false with no route predicts no map in slot 0x100 (S3); confirm against L11 / X6")
    return a


# --------------------------------------------------------------------------------------------------------------------
# P15 assistance, P16 technical, P17 others (SV)

def p15(ctx: Ctx) -> Ans:
    tags = ("sign", "longitudinal", "foresight", "ldm-guidance", "next-limit", "no-passing", "hud-data", "hud-data2", "assist-avail", "front-vehicle")
    a, stop = _mk(ctx, "P15", "the sign arrives; the cruise set speed and the active function (SPEC-R3 section 9)", *tags)
    if stop:
        return a
    d: Dict[str, object] = {}
    sg = [p for p in ctx.probe if canon(p.tag) == "sign"]
    d["sign_arrives"] = bool(sg)
    sv = sorted({int(p.val("value")) for p in sg if p.val("value") is not None})
    d["sign_values"] = sv[:30]
    d["sign_units"] = sorted({p.enum("unit") for p in sg if p.enum("unit")})
    d["sign_special_values_seen"] = [v for v in (0, 254, 255) if v in sv]
    rd = ctx.readings.get("sign_values")
    if isinstance(rd, list) and sv:
        d["sign_values_match_readings"] = sorted(set(sv) & set(rd)) == sorted(set(rd) & set(sv)) and set(rd) <= set(sv)
    # the set speed: which field follows it
    srcs = {}
    for tag, key in (("longitudinal", "setSpeed"), ("hud-data2", "setSpeed"), ("assist-avail", "setSpeed"), ("ldm-guidance", "setSpeed"), ("hud-data", "cruise")):
        vals = [int(p.val(key)) for p in ctx.probe if canon(p.tag) == tag and p.val(key) is not None]
        if vals:
            srcs[tag] = sorted(set(vals))[:12]
    d["set_speed_sources"] = srcs
    want = ctx.readings.get("cruise_set_speeds")
    if isinstance(want, list) and srcs:
        best = [t for t, v in srcs.items() if set(want) <= set(v)]
        d["set_speed_follows"] = best
    func = sorted({p.enum("func") for p in ctx.probe if canon(p.tag) == "longitudinal" and p.enum("func")})
    d["active_function_values"] = func
    d["longitudinal_arrives"] = any(canon(p.tag) == "longitudinal" for p in ctx.probe)
    ac = [p for p in ctx.probe if canon(p.tag) == "assist-avail"]
    d["acc_not_equipped"] = any("acc=NOT_EQUIPPED" in p.body for p in ac)
    d["limiter_values"] = sorted({m.group(1) for p in ctx.probe if canon(p.tag) == "hud-data" for m in [re.search(r"limiter=([A-Z0-9_]+)", p.body)] if m})
    a.decided = d
    a.status = "answered"
    if sg:
        a.cite(sg[0], "first sign line, value %s" % sg[0].val("value"), value=sg[0].val("value"))
    if not sg:
        a.why.append("the sign never arrived: V3 and the sign drawing stay off")
    if d["acc_not_equipped"] and not srcs:
        a.why.append("assist-avail acc=NOT_EQUIPPED: no set-speed row")
    return a


def p16(ctx: Ctx) -> Ans:
    tags = ("sport-display", "power-torque", "engine-max", "oil-temp2", "oil-level", "tyre-pressure", "tyre-temp", "tyre-target", "tyres-status")
    a, stop = _mk(ctx, "P16", "technical: boost scale, tyres' scale and whether the car notifies", *tags)
    vit = tables_vitals.vitals(ctx)
    if stop:
        if vit is not None and (a.status in ("no-material", "not-yet")):
            return _from_vitals(ctx, a, vit)
        return a
    d: Dict[str, object] = {}
    bs = [p.val("boost") for p in ctx.probe if canon(p.tag) == "sport-display" and p.val("boost") is not None]
    if bs:
        d["boost_raw_min_max"] = [min(bs), max(bs)]
        mx = [p.val("boostMax") for p in ctx.probe if canon(p.tag) == "sport-display" and p.val("boostMax") is not None]
        d["boostMax_raw"] = max(mx) if mx else None
        pk = ctx.readings.get("boost_peak_bar")
        if isinstance(pk, (int, float)) and pk > 0:
            valid = [x for x in bs if x != 255]
            if valid:
                f = pk / max(valid)
                d["boost_factor_from_reading"] = round(f, 4)
                d["boost_factor_nearest"] = min((0.001, 0.01, 0.1, 1), key=lambda c: abs(c - f))
    tp = [(p, [p.val(k) for k in ("fl", "fr", "rl", "rr")]) for p in ctx.probe if canon(p.tag) == "tyre-pressure"]
    if tp:
        d["tyre_pressure_raw_last"] = tp[-1][1]
        rd = ctx.readings.get("tyres") if isinstance(ctx.readings.get("tyres"), dict) else None
        if rd:
            ratios = []
            for k, raw in zip(("fl", "fr", "rl", "rr"), tp[-1][1]):
                s = rd.get(k)
                if raw and isinstance(s, (int, float)) and s:
                    ratios.append(round(s / raw, 4))
            d["tyre_factor_from_reading"] = ratios
            if ratios:
                d["tyre_factor_nearest"] = min((0.001, 0.01, 0.1, 1), key=lambda c: abs(c - sorted(ratios)[len(ratios) // 2]))
        d["tyre_lines"] = len(tp)
        d["tyre_notifies_after_first"] = len(tp) > 1
    tt = [p for p in ctx.probe if canon(p.tag) == "tyre-target"]
    if tt:
        d["tyre_target_raw_last"] = [tt[-1].val(k) for k in ("fl", "fr", "rl", "rr")]
    ot = [p for p in ctx.probe if canon(p.tag) == "oil-temp2"]
    if ot:
        d["oil_temp2_raw_min_max"] = [min(p.val("oil") for p in ot if p.val("oil") is not None), max(p.val("oil") for p in ot if p.val("oil") is not None)]
    ol = sorted({p.enum("level") for p in ctx.probe if canon(p.tag) == "oil-level" and p.enum("level")})
    d["oil_level_values"] = ol
    pt = [p for p in ctx.probe if canon(p.tag) == "power-torque"]
    if pt:
        pv = [p.val("power") for p in pt if p.val("power") is not None]
        d["power_range"] = [min(pv), max(pv)] if pv else None
    a.decided = d
    a.status = "answered" if d else "partial"
    a.why.append("a scale is settled only with a reading of iDrive's own page or a gauge (readings.json: boost_peak_bar, tyres)")
    return a


def _from_vitals(ctx: Ctx, a: Ans, vit: dict) -> Ans:
    """P16 from another app's log (car_vitals): raw ranges only; every scale stays a hypothesis until a reading is compared."""
    d = tables_vitals.facts(vit)
    if not d:
        return a
    a.status = "partial"
    a.label = "arrives-other-app"
    a.decided = d
    a.dated = (cl.fmt_ts(vit["last"]) or "")[:10]
    a.material = sorted({cl.rel(p) for p in ctx.session.app_logs("car_vitals")})
    for k in ("tyre_pressure", "tyre_target", "tyre_temp", "boost"):
        l = vit["first_line"].get(k)
        if l is not None:
            a.cite(l, "car_vitals raw %s line (another app's log)" % k.replace("_", " "))
    a.why.append("another app's log shows the car sends tyre pressure / temperature, target pressure and FES boost through getters; raw values only, scale from a reading")
    if d.get("tyre_pressure_plausible_factors") == [0.1]:
        a.why.append("tyre pressure: factor 0.1 is the only one that puts the raw values in 1.5-4 bar (car_vitals also logs the car's pressure unit BAR)")
    a.needs.append("iDrive's tyre page read next to a probe line (readings.json: tyres), and a drive under load for boost (readings.json: boost_peak_bar)")
    return a


def p17(ctx: Ctx) -> Ans:
    tags = ("heading", "gps-ext", "cbs-list", "cons-now", "cons-history")
    a, stop = _mk(ctx, "P17", "others: heading, altitude, service due, instantaneous consumption: only whether they arrive", *tags)
    if stop:
        return a
    d: Dict[str, object] = {"arrives": sorted({canon(p.tag) for p in ctx.probe if canon(p.tag) in tags}),
                            "silent": sorted(t for t in tags if t in ctx.silent_tags())}
    cb = [p for p in ctx.probe if canon(p.tag) == "cbs-list"]
    if cb:
        d["cbs_entries_seen"] = len({(p.val("id")) for p in cb})
    cn = [p for p in ctx.probe if canon(p.tag) == "cons-now"]
    if cn:
        dg = [p.val("digit") for p in cn if p.val("digit") is not None]
        d["cons_now_digit_range"] = [min(dg), max(dg)] if dg else None
    hd = [p.val("heading") for p in ctx.probe if canon(p.tag) == "heading" and p.val("heading") is not None]
    d["heading_range_deg"] = [min(hd), max(hd)] if hd else None
    a.decided = d
    a.status = "answered"
    return a
