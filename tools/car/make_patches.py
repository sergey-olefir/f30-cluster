#!/usr/bin/env python3
"""From answers.json to the exact app.json changes each answer implies (package CL).  NEVER APPLIED AUTOMATICALLY.

  python3 -I tools/car/make_patches.py [--answers design/car/answers.json] [--out bake/work/car/CL/patches] [--repo <checkout>]

Writes, under --out:
  patches.md          one section per patch: the answer's id and date, the evidence (numbers only) beside the diff, the unified diff
  patches.json        the same, machine-readable ({id, file, path, old, new, kind, evidence, requires})
  <n>-<id>.diff       one unified diff per patch (apply by hand with `git apply --check` first)

A patch is `kind: diff` when the key exists in the app.json of the checkout (the diff changes one value in place, the rest of the
file is byte for byte the same) or `kind: insert` when the key is not there yet (the diff adds it; `requires` names the branch that
brings the code reading it).  `kind: advice` is for an answer whose config shape does not exist anywhere yet (cruise, media, phone,
tyres, the map window): the answer is stated as the values to put in, with no diff.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import car_logs as cl  # noqa: E402

REPO = cl.REPO


# --------------------------------------------------------------------------------------------------------------------
# a JSON text editor that keeps every other byte

class Span:
    def __init__(self, start: int, end: int, kind: str):
        self.start, self.end, self.kind = start, end, kind
        self.members: Dict[str, Tuple[int, int, "Span"]] = {}   # key -> (key_start, member_end_after_value, value span)


def _ws(t: str, i: int) -> int:
    while i < len(t) and t[i] in " \t\r\n":
        i += 1
    return i


def _string_end(t: str, i: int) -> int:
    assert t[i] == '"'
    i += 1
    while t[i] != '"':
        i += 2 if t[i] == "\\" else 1
    return i + 1


def parse_span(t: str, i: int = 0) -> Tuple[Span, int]:
    i = _ws(t, i)
    c = t[i]
    if c == "{":
        sp = Span(i, 0, "object")
        i = _ws(t, i + 1)
        if t[i] == "}":
            sp.end = i + 1
            return sp, i + 1
        while True:
            i = _ws(t, i)
            ks = i
            ke = _string_end(t, i)
            key = json.loads(t[ks:ke])
            i = _ws(t, ke)
            assert t[i] == ":"
            v, i = parse_span(t, i + 1)
            sp.members[key] = (ks, v.end, v)
            i = _ws(t, i)
            if t[i] == ",":
                i += 1
                continue
            assert t[i] == "}"
            sp.end = i + 1
            return sp, i + 1
    if c == "[":
        sp = Span(i, 0, "array")
        i = _ws(t, i + 1)
        if t[i] == "]":
            sp.end = i + 1
            return sp, i + 1
        while True:
            v, i = parse_span(t, i)
            i = _ws(t, i)
            if t[i] == ",":
                i += 1
                continue
            assert t[i] == "]"
            sp.end = i + 1
            return sp, i + 1
    if c == '"':
        e = _string_end(t, i)
        return Span(i, e, "string"), e
    m = re.compile(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null").match(t, i)
    return Span(i, m.end(), "scalar"), m.end()


def get_path(root: Span, text: str, path: List[str]) -> Optional[Span]:
    cur = root
    for k in path:
        if cur.kind != "object" or k not in cur.members:
            return None
        cur = cur.members[k][2]
    return cur


def _indent_of(text: str, pos: int) -> str:
    ls = text.rfind("\n", 0, pos) + 1
    m = re.match(r"[ \t]*", text[ls:pos + 1])
    return m.group(0)


def set_path(text: str, path: List[str], value: Any) -> Tuple[str, str]:
    """Return (new_text, kind) with `path` set to value: 'diff' (replaced in place), 'insert' (a key added, parents created)."""
    root, _ = parse_span(text)
    # the deepest existing ancestor
    cur = root
    have = 0
    for k in path:
        if cur.kind == "object" and k in cur.members:
            cur = cur.members[k][2]
            have += 1
        else:
            break
    dumped = json.dumps(value, ensure_ascii=False)
    if have == len(path):
        return text[:cur.start] + dumped + text[cur.end:], "diff"
    if cur.kind != "object":
        raise ValueError("cannot insert under a non-object at %s" % "/".join(path[:have]))
    # build the missing keys as nested objects
    rest = path[have:]
    for k in reversed(rest[1:]):
        value = {k: value}
    new_key = rest[0]
    body = json.dumps(value, ensure_ascii=False)
    close = cur.end - 1                      # the '}' of the ancestor
    if cur.members:
        last_key = list(cur.members)[-1]
        ks, vend, _v = cur.members[last_key]
        ind = _indent_of(text, ks)
        ins = ",\n%s%s: %s" % (ind, json.dumps(new_key), body)
        return text[:vend] + ins + text[vend:], "insert"
    ind = _indent_of(text, cur.start) + "  "
    return text[:close] + "\n%s%s: %s\n%s" % (ind, json.dumps(new_key), body, _indent_of(text, cur.start)) + text[close:], "insert"


def unified(old: str, new: str, name: str) -> str:
    return "".join(difflib.unified_diff(old.splitlines(True), new.splitlines(True), "a/" + name, "b/" + name, n=2))


# --------------------------------------------------------------------------------------------------------------------
# the rules: answer -> changes

def _ev(item: dict, n: int = 3) -> List[dict]:
    return [{"file": e["file"], "line": e["line"], "shape": e["shape"], "n": e["n"]} for e in item.get("evidence", [])[:n]]


def rules(ans: dict) -> List[dict]:
    """[{id, file, path, value, requires, note}] -- `file` is relative to the checkout; value None means advice only."""
    items = ans.get("items", {})
    out: List[dict] = []

    def done(i):
        v = items.get(i)
        return v if v and v["status"] in ("answered",) else None

    TD, F30 = "apps/twin_dial/app.json", "apps/f30_cluster/app.json"
    # --- L1 / L2: the window's release
    l1 = done("L1")
    if l1:
        d = l1["decided"]
        rel = d.get("release")
        if isinstance(rel, dict) and rel:
            out.append({"id": "L1", "file": F30, "path": ["config", "ccActive", "release"], "value": rel, "requires": "research3/mc (config.ccActive.release; merged on main)",
                        "note": "case(s) %s; never noneValues [0, 65535] (MC F0, unsafe)" % ",".join(d.get("hang_cases", []))})
        if d.get("ccm_clearIds"):
            out.append({"id": "L1", "file": F30, "path": ["config", "ccm", "clearIds"], "value": d["ccm_clearIds"], "requires": "", "note": "case A11: a stray newCCMessage answer"})
        if d.get("witness_zero_seen") and (d.get("hang_cases") or d.get("rows")):
            out.append({"id": "L1", "file": F30, "path": ["config", "ccDisplayed", "use"], "value": True, "requires": "research3/mc; owner's call under the safety rule",
                        "note": "the witness went to 0 while the number was stuck (row 11)"})
    l2 = done("L2")
    if l2 and l2["decided"].get("noneValues"):
        out.append({"id": "L2", "file": F30, "path": ["config", "ccActive", "noneValues"], "value": l2["decided"]["noneValues"], "requires": "",
                    "note": "stays [0]: " + "65535 would cover a listed message (MC F0)"})
    # --- P1: D7 for Twin Dial
    p1 = done("P1")
    if p1 and p1["decided"].get("strict_can_be_lifted"):
        out.append({"id": "P1", "file": TD, "path": ["config", "ccActive", "strict"], "value": False, "requires": "",
                    "note": "OWNER'S DECISION (SPEC rev 2 8.4 D7): the number equals the ccList id, returns to 0, and no hang stretch was seen"})
    # --- P13: the tab key
    p13 = done("P13")
    if p13:
        tk = p13["decided"].get("tab_key")
        if isinstance(tk, dict):
            if tk.get("kind") == "stalk-bit":
                out.append({"id": "P13", "file": TD, "path": ["config", "tabKey"],
                            "value": {"iface": tk["iface"], "field": tk["field"], "path": tk["path"], "mask": tk["mask"]},
                            "requires": "twin-r3/sb (shared/twin_tabs.js); declare the field 's' in the normal build",
                            "note": "the bit moved in bc-short steps and in no other stalk step"})
            elif tk.get("kind") == "indirect-any":
                out.append({"id": "P13", "file": TD, "path": ["config", "tabKey"], "value": {"tag": tk["tag"], "any": True}, "requires": "twin-r3/sb; fill iface / field of that tag",
                            "note": "indirect key: any change of the cluster's view state is one step"})
            else:
                out.append({"id": "P13", "file": TD, "path": ["config", "tabKey"], "value": None, "requires": "twin-r3/sb", "note": "candidate key %s (advice: see the answer)" % tk.get("kind")})
    # --- P4 / P3: trip and odometer factors
    p4 = done("P4")
    if p4:
        pt = p4["decided"].get("patch_trip_factors") or {}
        base = ["config", "trip", "factors"]
        for k in ("bc", "speed", "cons", "way"):
            if k in pt:
                out.append({"id": "P4", "file": TD, "path": base + [k], "value": pt[k], "requires": "research3/mk (merged)", "note": "matched the owner's reading of iDrive's trip page"})
        if isinstance(pt.get("rl3"), dict):
            for k, v in pt["rl3"].items():
                out.append({"id": "P4", "file": TD, "path": base + ["rl3", k], "value": v, "requires": "research3/mk", "note": "ResetLogic3 against the same reading"})
        if pt.get("departureUtc"):
            out.append({"id": "P4", "file": TD, "path": ["config", "trip", "departureUtc"], "value": pt["departureUtc"], "requires": "research3/mk", "note": "the departure differs by a whole zone offset"})
        rm = p4["decided"].get("reading_match") or {}
        if pt and rm.get("time_equal") and (rm.get("departure_local") is True or "departureUtc" in pt):
            out.append({"id": "P4", "file": TD, "path": ["config", "trip", "verified"], "value": True, "requires": "research3/mk", "note": "every shown value matched; the log stops saying UNVERIFIED"})
    p3 = done("P3")
    if p3:
        d3 = p3["decided"]
        if d3.get("order"):
            out.append({"id": "P3", "file": TD, "path": ["config", "odometer", "order"], "value": d3["order"], "requires": "research3/mk", "note": "carriers that match the cluster's odometer first"})
        if isinstance(d3.get("factors"), dict):
            for k, v in d3["factors"].items():
                out.append({"id": "P3", "file": TD, "path": ["config", "odometer", "factors", k], "value": v, "requires": "research3/mk", "note": "matched the reading"})
            out.append({"id": "P3", "file": TD, "path": ["config", "odometer", "verified"], "value": True, "requires": "research3/mk", "note": "the cluster's odometer matched"})
    # --- advice-only answers (the config shape does not exist yet)
    p15 = done("P15")
    if p15:
        d = p15["decided"]
        out.append({"id": "P15", "file": TD, "path": ["config", "cruise"], "value": None, "requires": "SPEC-R3 section 9 (config.cruise is null until now)",
                    "advice": {"set_speed_follows": d.get("set_speed_follows"), "set_speed_sources": d.get("set_speed_sources"), "active_function_values": d.get("active_function_values"),
                               "acc_not_equipped": d.get("acc_not_equipped")},
                    "note": "the set speed and the active function come from the field(s) named; sign: %s" % ("arrives" if d.get("sign_arrives") else "silent")})
    p8 = done("P8")
    if p8:
        d = p8["decided"]
        out.append({"id": "P8", "file": TD, "path": ["config", "media"], "value": None, "requires": "twin-r3/sm",
                    "advice": {"titleLine": d.get("titleLine"), "progress_unit": d.get("progress_unit"), "selected_icons": d.get("selected_icons"),
                               "radio_arrives": d.get("radio_arrives")}, "note": "which media line is the title, and what the progress counts in"})
    p9 = done("P9")
    if p9:
        d = p9["decided"]
        out.append({"id": "P9", "file": TD, "path": ["config", "phone"], "value": None, "requires": "twin-r3/sp",
                    "advice": {"call_states_seen": d.get("call_states_seen"), "call1_state_moves": d.get("call1_state_moves"), "duration_is_seconds": d.get("duration_is_seconds"),
                               "battery_nonzero": d.get("battery_nonzero"), "signal_nonzero": d.get("signal_nonzero")}, "note": "the phone card's states and bars"})
    p16 = items.get("P16")
    if p16 and p16["status"] in ("answered", "partial"):
        d = p16["decided"]
        adv = {k: d.get(k) for k in ("tyre_factor_nearest", "boost_factor_nearest", "tyre_pressure_plausible_factors", "boost_raw_range_without_255", "tyre_notifies_after_first") if k in d}
        if adv:
            out.append({"id": "P16", "file": TD, "path": ["config", "tyres"], "value": None, "requires": "SPEC-R3 section 4.1 (V1 / V1b)", "advice": adv,
                        "note": "scales: a reading of iDrive's tyre page / a gauge decides; plausible-only numbers are not verified"})
    p14 = done("P14")
    p11 = done("P11")
    if p14 or p11:
        out.append({"id": "P14" if p14 else "P11", "file": TD, "path": ["config", "mapWindow"], "value": None, "requires": "twin-r3/sn (presence rule S1 / S2 / S3)",
                    "advice": {"map_without_route_values": (p14 or {}).get("decided", {}).get("map_without_route_values"),
                               "navDisplay_values": (p11 or p14 or {}).get("decided", {}).get("navDisplay_values", (p14 or {}).get("decided", {}).get("navDisplay_seen"))},
                    "note": "the map window's presence rule is read from these fields"})
    return out


def build(ans: dict, repo: str) -> List[dict]:
    patches: List[dict] = []
    cache: Dict[str, str] = {}
    cur: Dict[str, str] = {}
    for r in rules(ans):
        item = ans["items"].get(r["id"], {})
        base = {"id": r["id"], "dated": item.get("dated"), "file": r["file"], "path": ".".join(r["path"]), "requires": r["requires"], "note": r["note"], "evidence": _ev(item)}
        if r.get("value") is None:
            patches.append(dict(base, kind="advice", advice=r.get("advice"), diff=None))
            continue
        fpath = os.path.join(repo, r["file"])
        if r["file"] not in cache:
            with open(fpath, "r", encoding="utf-8") as fh:
                cache[r["file"]] = fh.read()
            cur[r["file"]] = cache[r["file"]]
        before = cur[r["file"]]
        root, _ = parse_span(before)
        sp = get_path(root, before, r["path"])
        old = json.loads(before[sp.start:sp.end]) if sp is not None else None
        after, kind = set_path(before, r["path"], r["value"])
        if after == before:
            patches.append(dict(base, kind="same", old=old, new=r["value"], diff=None))
            continue
        # one diff per patch, against the file as the patches before it left it
        patches.append(dict(base, kind=kind, old=old, new=r["value"], diff=unified(before, after, r["file"])))
        cur[r["file"]] = after
    return patches


def main(argv: List[str]) -> int:
    answers = os.path.join(REPO, "design", "car", "answers.json")
    out = os.path.join(REPO, "bake", "work", "car", "CL", "patches")
    repo = REPO
    i = 0
    while i < len(argv):
        if argv[i] == "--answers":
            answers = argv[i + 1]; i += 2
        elif argv[i] == "--out":
            out = argv[i + 1]; i += 2
        elif argv[i] == "--repo":
            repo = argv[i + 1]; i += 2
        elif argv[i] in ("-h", "--help"):
            print(__doc__); return 0
        else:
            print(__doc__); return 2
    with open(answers, "r", encoding="utf-8") as fh:
        ans = json.load(fh)
    patches = build(ans, repo)
    os.makedirs(out, exist_ok=True)
    md = ["# Patches implied by %s (session %s)\n" % (os.path.basename(answers), ans.get("session", {}).get("date", "?")),
          "Never applied automatically. Review each diff with its evidence; `git apply --check <file>.diff` first.\n"]
    for n, p in enumerate(patches, 1):
        md.append("\n## %d. %s -> %s `%s` (%s)\n" % (n, p["id"], p["file"], p["path"], p["kind"]))
        md.append("- answer dated %s; %s\n" % (p.get("dated"), p["note"]))
        if p.get("requires"):
            md.append("- requires: %s\n" % p["requires"])
        for e in p["evidence"]:
            md.append("- evidence: `%s:%d` %s %s\n" % (e["file"], e["line"], e["shape"], json.dumps(e["n"])))
        if p.get("diff"):
            md.append("\n```diff\n%s```\n" % p["diff"])
            with open(os.path.join(out, "%02d-%s.diff" % (n, p["id"])), "w", encoding="utf-8") as fh:
                fh.write(p["diff"])
        elif p["kind"] == "advice":
            md.append("\nAdvice (no diff: the config shape does not exist yet): `%s`\n" % json.dumps(p.get("advice")))
    with open(os.path.join(out, "patches.md"), "w", encoding="utf-8") as fh:
        fh.write("".join(md))
    with open(os.path.join(out, "patches.json"), "w", encoding="utf-8") as fh:
        json.dump(patches, fh, indent=1)
    print("make_patches: %d patch(es) (%s) in %s" % (len(patches), ", ".join(sorted({p["kind"] for p in patches})) or "none", os.path.relpath(out, REPO)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
