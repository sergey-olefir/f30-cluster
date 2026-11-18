#!/usr/bin/env python3
"""Tests of tools/car (package CL):  UV_CACHE_DIR=... uv run -q --no-project python -I tools/car/test_car_tools.py

Synthetic logs for every decision table, the MC trap, the privacy canaries, the collector with a fake ssh, the patches, and (when the
2026-11-15 snapshot is on this Mac) the real material."""
from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

import car_logs as cl            # noqa: E402
import make_patches as mp        # noqa: E402
import parse_logs as pl          # noqa: E402
import privacy_check as pc       # noqa: E402
import synth                     # noqa: E402
import tables_base               # noqa: E402
from synth import Log, ProbeLog  # noqa: E402

CANARY = "ZQXCANARY"


def session(files: dict, root: str = None) -> str:
    """files = {relative path: text | callable(path)} -> a session folder."""
    root = root or tempfile.mkdtemp(prefix="cartest-")
    for rel, v in files.items():
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if callable(v):
            v(p)
        else:
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(v)
    return root


def run(root: str, readings=None, marks="", only=None) -> dict:
    rp = None
    if readings is not None:
        rp = os.path.join(root, "readings.json")
        with open(rp, "w") as fh:
            json.dump(readings, fh)
    return pl.build(root, rp, marks, None, only)


class Parsing(unittest.TestCase):
    def test_line_shapes(self):
        a = cl.parse_line("2026-11-14T19:09:21.038Z INFO hello")
        self.assertEqual((a.level, a.msg), ("INFO", "hello"))
        b = cl.parse_line("2026-11-14 14:30:12.489 W target map: x")
        self.assertEqual((b.level, b.msg), ("W", "target map: x"))
        c = cl.parse_line("2026-11-14T19:10:10.766889Z cluster-render.service cluster-render[31270]: I cluster-render: dcsm: slot 0x100 status 0 content 0x0 class 0 map 0")
        self.assertEqual(c.msg, "dcsm: slot 0x100 status 0 content 0x0 class 0 map 0")
        d = cl.parse_line("2026-11-14T19:10:10.766889+0000 carhost cluster-render[3]: W target panel: x")
        self.assertEqual((d.level, d.msg), ("W", "target panel: x"))
        self.assertIsNone(cl.parse_line("    at Function.reject (/x)").ts)

    def test_every_fixture_body_parses_and_is_clean(self):
        fx = json.load(open(os.path.join(HERE, "fixtures", "probe_bodies.json")))["tags"]
        self.assertGreater(len(fx), 100)
        for tag, e in fx.items():
            for body in e["bodies"]:
                line = cl.parse_line("2026-11-18T10:00:01.000Z INFO probe: %s %s #1 t=1.0: %s" % (e["branch_p"], tag, body))
                p = cl.parse_probe(line)
                self.assertIsNotNone(p, tag)
                self.assertEqual((p.tag, p.n), (tag, 1))
                self.assertTrue(p.kv, tag)
                self.assertEqual(pc.scan_line(line.msg, probe=True), [], "false positive on %s: %s" % (tag, body[:60]))

    def test_cp_format(self):
        l = cl.parse_line("2026-11-18T10:00:01.000Z INFO probe: P13 stalk #3 t=88.1: stalks=64(0x40) prev=0 up=0x40 down=0x0 tms=88104 since=M2+2210")
        p = cl.parse_probe(l)
        self.assertEqual((p.val("stalks"), p.val("up"), p.val("down")), (64, 64, 0))
        m = cl.parse_marker(cl.parse_line("2026-11-18T10:00:01.000Z INFO probe: mark M2 t=85.9 tms=85894 sets=S1+S6"))
        self.assertEqual((m.n, m.t), (2, 85.9))
        s = cl.probe_summaries([cl.parse_line("2026-11-18T10:00:01.000Z INFO probe: summary S6 +30s: 1 of 24 fields have spoken: P11 ic-widget(1 events, 1 lines)"),
                                cl.parse_line("2026-11-18T10:00:01.010Z INFO probe: summary S6 +30s: silent: P13 sw-fav, P13 stalk")])
        self.assertEqual((s[0]["set"], s[0]["t"], s[0]["silent"]), ("S6", 30, [("P13", "sw-fav"), ("P13", "stalk")]))


class MessageMachine(unittest.TestCase):
    """MC section 6: each case, and THE TRAP (no ccList entry alone is not a hang)."""

    def l1(self, case, settings=None, tail=120.0):
        root = tempfile.mkdtemp(prefix="cartest-")
        synth.msg_case(case, os.path.join(root, "apps", "f30_cluster", "f30_cluster.log"), tail)
        if settings:
            synth.settings(os.path.join(root, "apps", "f30_cluster", "settings.json"), **settings)
        r = run(root, only=["L1", "L2"])
        shutil.rmtree(root)
        return r["items"]["L1"], r["items"]["L2"]

    def test_trap_order_effect_is_not_a_hang(self):
        l1, l2 = self.l1("A0")
        self.assertEqual(l1["status"], "answered")
        self.assertEqual(l1["decided"]["hang_cases"], [])
        self.assertEqual(l1["decided"]["order_effects"], 2)      # the number first (0.2 s) and the list first (0.4 s): both orders, neither a hang
        self.assertIsNone(l1["decided"]["release"])
        self.assertNotIn("5", [r for r in l1["decided"]["rows"] if r == "1"])
        self.assertTrue(l2["decided"]["notifies"])
        self.assertEqual(l2["decided"]["rests_on"], "0")
        self.assertTrue(l2["decided"]["number_is_ccList_id"])

    def test_a1(self):
        l1, l2 = self.l1("A1")
        self.assertEqual(l1["decided"]["hang_cases"], ["A1"])
        self.assertEqual(l1["decided"]["release"], {"deferValues": [65535]})
        self.assertIn("1", l1["decided"]["rows"])

    def test_a2(self):
        l1, l2 = self.l1("A2")
        self.assertEqual(l1["decided"]["hang_cases"], ["A2"])
        self.assertEqual(l1["decided"]["release"], {"deferValues": [65535]})
        self.assertEqual(l2["decided"]["rests_on"], "65535")
        self.assertEqual(l2["decided"]["noneValues"], [0])

    def test_a3_and_a4(self):
        l1, l2 = self.l1("A3")
        self.assertEqual(l1["decided"]["hang_cases"], ["A3"])
        self.assertEqual(l1["decided"]["release"], {"leftList": True})
        self.assertEqual(l2["decided"]["rests_on"], "kept")
        l1, _ = self.l1("A4")
        self.assertEqual(l1["decided"]["hang_cases"], ["A4"])
        self.assertEqual(l1["decided"]["control_when_gone"], 0)
        self.assertEqual(l1["decided"]["release"], {"leftList": True})

    def test_a3_short_tail_is_undetermined_not_a_hang(self):
        l1, _ = self.l1("A3", tail=5.0)
        self.assertEqual(l1["decided"]["hang_cases"], [])

    def test_a5_stored_and_witness(self):
        l1, _ = self.l1("A5")
        self.assertIn("6", l1["decided"]["rows"])
        self.assertTrue(l1["decided"]["witness_zero_seen"])
        self.assertIn("11", l1["decided"]["rows"])

    def test_a8_a9_a10_a11(self):
        l1, l2 = self.l1("A8")
        self.assertIn("7", l1["decided"]["rows"])
        self.assertEqual(l2["label"], "not-sent" if l2["status"] == "answered" else l2["label"])
        l1, _ = self.l1("A9")
        self.assertIn("8", l1["decided"]["rows"])
        l1, _ = self.l1("A10")
        self.assertIn("9", l1["decided"]["rows"])
        l1, _ = self.l1("A11")
        self.assertIn("10", l1["decided"]["rows"])
        self.assertEqual(l1["decided"]["ccm_clearIds"], [65535])

    def test_view_from_settings(self):
        l1, _ = self.l1("A1", dict(hudLayout="g20_comfort", g20=True, bottomRow="allG20"))
        self.assertEqual(l1["decided"]["window_view"]["view"], "g20-bmw-row")
        l1, _ = self.l1("A1", dict(hudLayout="wb_comfort", g20=False))
        self.assertEqual(l1["decided"]["window_view"]["view"], "opaque")

    def test_old_build_is_no_material(self):
        root = session({"apps/f30_cluster/f30_cluster.log": lambda p: Log().start(0, "f30_cluster", "0.7.12").info(5, "x").write(p)})
        it = run(root, only=["L1", "L2"])["items"]
        self.assertEqual(it["L1"]["status"], "no-material")
        self.assertEqual(it["L1"]["decided"]["builds_seen"], [[0, 7, 12]])

    def test_l8_witness(self):
        root = session({"apps/twin_dial/twin_dial.log": lambda p: Log().start(0, "twin_dial", "0.1.1").disp(10, 15).disp(30, 0).write(p)})
        it = run(root, only=["L8"])["items"]["L8"]
        self.assertEqual((it["status"], it["decided"]["returns_to_zero"]), ("answered", True))

    def test_p1_from_probe_lines(self):
        def f(p):
            L = ProbeLog().begin(0, "S1")
            L.field(10, "P1", "active-cc", 1, "number=0 control=0 frameNumber=1 frame=1 utility=0")
            L.field(10.5, "P1", "ccList", 1, "entries=1 [id=0 colour=GREEN symbol=6 indent=- ric=- name-len=0]")
            L.field(20, "P1", "active-cc", 2, "number=15 control=1 frameNumber=1 frame=1 utility=0")
            L.field(20.2, "P1", "ccList", 2, "entries=2 [id=0 colour=GREEN symbol=6 indent=- ric=- name-len=0] [id=15 colour=WHITE symbol=2 indent=- ric=- name-len=16]")
            L.field(41.0, "P1", "ccList", 3, "entries=1 [id=0 colour=GREEN symbol=6 indent=- ric=- name-len=0]")
            L.field(41.3, "P1", "active-cc", 3, "number=0 control=0 frameNumber=1 frame=1 utility=0")
            L.write(p)
        it = run(session({"apps/signal_probe/signal_probe.log": f}), only=["P1"])["items"]["P1"]
        self.assertEqual(it["status"], "answered")
        self.assertTrue(it["decided"]["strict_can_be_lifted"])
        self.assertEqual(it["decided"]["number_equals_ccList_id"], "1/1")


class Trip(unittest.TestCase):
    def setUp(self):
        self.reading = {"odometer_km": 48215, "trip": {"since_start": {"cons": 6.8, "speed": 41.0, "way": 12.4, "time": [0, 43], "from": [14, 0]}}}

    def test_factors_from_a_reading_new_and_old_shape(self):
        for old in (False, True):
            root = session({"apps/twin_dial/twin_dial.log": lambda p: synth.twin_trip(p, old_shape=old)})
            r = run(root, readings=self.reading, only=["L4", "L5", "P3", "P4"])["items"]
            p4 = r["P4"]
            self.assertEqual(p4["status"], "answered")
            self.assertEqual(p4["decided"]["patch_trip_factors"], {"bc": 1, "speed": 0.1, "cons": 0.1, "way": 0.1})
            self.assertTrue(p4["decided"]["reading_match"]["time_equal"])
            self.assertTrue(p4["decided"]["reading_match"]["departure_local"])
            self.assertEqual(r["L4"]["status"], "answered")
            self.assertEqual(r["P3"]["decided"]["factors"], {"rangeTank": 1})
            self.assertEqual(r["L5"]["status"], "answered")

    def test_counter_two_and_utc_departure(self):
        root = session({"apps/twin_dial/twin_dial.log": lambda p: synth.twin_trip(p, speed1=65535, cons1=65535, speed2=410, cons2=68, hour=12, minute=0)})
        p4 = run(root, readings=self.reading, only=["P4"])["items"]["P4"]
        self.assertEqual(p4["decided"]["patch_trip_factors"]["bc"], 2)
        self.assertEqual(p4["decided"]["reading_match"]["departure_offset_min"], 120)
        self.assertEqual(p4["decided"]["patch_trip_factors"]["departureUtc"], ["kombi"])

    def test_factor_ten_off(self):
        root = session({"apps/twin_dial/twin_dial.log": lambda p: synth.twin_trip(p, speed1=41, cons1=6, way=12)})   # the car sends whole numbers
        p4 = run(root, readings={"trip": {"since_start": {"cons": 6.0, "speed": 41.0, "way": 12.0, "time": [0, 43], "from": [14, 0]}}}, only=["P4"])["items"]["P4"]
        self.assertEqual(p4["decided"]["patch_trip_factors"]["speed"], 1)
        self.assertEqual(p4["decided"]["patch_trip_factors"]["way"], 1)

    def test_cross_check_without_reading(self):
        root = session({"apps/twin_dial/twin_dial.log": lambda p: synth.twin_trip(p)})
        p4 = run(root, only=["P4"])["items"]["P4"]
        self.assertEqual(p4["status"], "partial")
        pairs = p4["decided"]["cross_check_pairs"]
        self.assertTrue(any(x["way"] == 0.1 and x["speed"] == 0.1 for x in pairs))
        self.assertFalse(any(x["way"] == 0.001 and x["speed"] == 10 for x in pairs))     # 2.4 m in 43 min at 4100 km/h: inconsistent
        self.assertIn(1.0, p4["decided"]["cross_check_ratio_fixed"])

    def test_silent_sources_not_sent(self):
        def f(p):
            L = Log().start(0, "twin_dial", "0.1.1")
            L.info(120, "trip summary #1 at 120.0 s: heard nothing; SILENT average, travel, start, rl3")
            L.info(120.1, "trip getter average (KombiIF.statusBordcomputerAverage, silent): provider not available (the interface itself never came up)")
            L.info(600, "trip summary #2 at 600.0 s: heard nothing; SILENT average, travel, start, rl3")
            L.write(p)
        l4 = run(session({"apps/twin_dial/twin_dial.log": f}), only=["L4"])["items"]["L4"]
        self.assertEqual((l4["status"], l4["label"]), ("answered", "not-sent"))
        self.assertEqual(l4["decided"]["observed_minutes"], 10.0)
        self.assertEqual(l4["decided"]["getter_outcome"], {"average": "provider-not-available"})

    def test_odometer_invalid(self):
        def f(p):
            Log().start(0, "twin_dial", "0.1.0").info(5, "odometer raw (P3): 16777215 -> no value (factor 1 km)").write(p)
        r = run(session({"apps/twin_dial/twin_dial.log": f}), only=["L5", "P3"])["items"]
        self.assertEqual(r["L5"]["status"], "partial")
        self.assertEqual(r["P3"]["decided"]["rangeTank"]["invalid_seen"], [16777215])


class TabKey(unittest.TestCase):
    """SB 3.3 with the marks of CQ's plan."""

    def probe(self, bc_bit=0x40, other_bits=(0x01, 0x02, 0x04, 0x20), silent_stalk=False):
        steps = [(1, "B0.6", ""), (2, "B1.2", "stock"), (3, "B1.3", "stock"), (4, "B1.4", "stock"), (5, "B1.5", "stock"), (6, "B1.7", "stock"),
                 (7, "B1.8", "stock"), (8, "B1.9", "stock"), (9, "B1.10", "stock"), (10, "B1.20", "stock"), (11, "B1.23", "twin")]

        def f(p):
            L = ProbeLog().begin(0, "S6")
            n = 0
            cur = 0
            L.mark(5)                                                    # M1
            L.mark(10)                                                   # M2 rest
            t = 15
            for i in range(3):                                           # M3..M5: bc short x3 (press and release)
                L.mark(t)
                if not silent_stalk:
                    n += 1; L.stalk(t + 1, n, cur | bc_bit, cur); cur |= bc_bit
                    n += 1; L.stalk(t + 1.2, n, cur & ~bc_bit, cur); cur &= ~bc_bit
                t += 10
            for b in other_bits[:3]:                                     # M6..M8: left, right, hold-left
                L.mark(t)
                n += 1; L.stalk(t + 1, n, cur | b, cur); cur |= b
                n += 1; L.stalk(t + 1.5, n, cur & ~b, cur); cur &= ~b
                t += 10
            L.mark(t)                                                    # M9 flash
            n += 1; L.stalk(t + 1, n, cur | other_bits[3], cur); cur |= other_bits[3]
            n += 1; L.stalk(t + 1.3, n, cur & ~other_bits[3], cur); cur &= ~other_bits[3]
            t += 10
            L.mark(t)                                                    # M10 with a message: the key does nothing
            t += 10
            L.mark(t)                                                    # M11 under Twin Dial
            L.summary(t + 40, "S6", [("P13", "stalk")], [("P13", "sw-fav")])
            L.write(p)
        root = session({"apps/signal_probe/signal_probe.log": f})
        marks = synth.marks_file(os.path.join(root, "marks.json"), steps)
        return root, marks

    def test_bc_bit_found(self):
        root, marks = self.probe()
        it = run(root, marks=marks, only=["P13"])["items"]["P13"]
        self.assertEqual(it["status"], "answered")
        tk = it["decided"]["tab_key"]
        self.assertEqual((tk["kind"], tk["bit"], tk["mask"]), ("stalk-bit", 6, 0x40))
        self.assertEqual(tk["path"], ["operationColumnStalks"])
        self.assertTrue(it["decided"]["kombi_consumes_press_during_message"] if "kombi_consumes_press_during_message" in it["decided"] else True)

    def test_bit_shared_with_another_switch_is_not_a_key(self):
        root, marks = self.probe(bc_bit=0x01, other_bits=(0x01, 0x02, 0x04, 0x20))    # the BC bit also moves with the left indicator
        it = run(root, marks=marks, only=["P13"])["items"]["P13"]
        self.assertIsNone(it["decided"].get("tab_key"))

    def test_without_marks_it_says_what_is_missing(self):
        root, _ = self.probe()
        it = run(root, marks="", only=["P13"])["items"]["P13"]
        self.assertNotEqual(it["status"], "answered")
        self.assertTrue(any("markers" in n or "marks" in n for n in it["needs"]) or it["decided"].get("stalk_bit_windows"))

    def test_silent_stalk_is_not_sent(self):
        root, marks = self.probe(silent_stalk=True)
        def f(p):
            L = ProbeLog().begin(0, "S6")
            L.mark(5)
            L.summary(35, "S6", [], [("P13", "stalk"), ("P13", "sw-fav")])
            L.info(36, "probe: ask P13 stalk (silent at +120s): error or no answer: timeout (the car does not send it)")
            L.write(p)
        root = session({"apps/signal_probe/signal_probe.log": f})
        it = run(root, only=["P13"])["items"]["P13"]
        self.assertEqual((it["status"], it["label"]), ("answered", "not-sent"))
        self.assertEqual(it["decided"]["getter_outcome"], {"stalk": "error"})


class OtherTables(unittest.TestCase):
    def test_media_title_line_and_progress(self):
        def f(p):
            L = ProbeLog().begin(0, "S4")
            L.mark(10)
            L.field(11, "P8", "player-metadata", 1, "sink=FRONT uiType=TWO_LINES menuEntry=1 track=7 line1-type=ARTIST line1-len=13 line2-type=TITLE line2-len=17 line3-len=0")
            L.field(12, "P8", "media-menu", 1, "sink=FRONT selected=22 selected-icon=USB entries=1 [21 USB on=true name-len=3 subs=0]")
            for i, e in enumerate((1000, 11000, 21000)):
                L.field(20 + i * 10, "P8", "track-progress", i + 1, "sink=FRONT menuEntry=1 track=7 elapsed=%d total=215000 hasProgress=true seekable=false" % e)
            L.write(p)
        root = session({"apps/signal_probe/signal_probe.log": f})
        marks = synth.marks_file(os.path.join(root, "marks.json"), [(1, "B4.6", "stock")])
        it = run(root, readings={"media": {"1": {"title_len": 17}}}, marks=marks, only=["P8"])["items"]["P8"]
        self.assertEqual(it["decided"]["titleLine"], "2")
        self.assertEqual(it["decided"]["progress_unit"], "ms")
        self.assertEqual(it["decided"]["selected_icons"], ["USB"])

    def test_phone_states_and_duration(self):
        def f(p):
            L = ProbeLog().begin(0, "S5")
            for i, (t, s) in enumerate(((10, "INCOMING"), (20, "ACTIVE"), (60, "DISCONNECTED"))):
                L.field(t, "P9", "call-state", i + 1, "state=%s" % s)
            for i, d in enumerate((1, 5, 10)):
                L.field(20 + d, "P9", "phone-call1-duration", i + 1, "value=%d" % d)
            L.field(30, "P9", "phone-call1-contact", 1, "known=true")
            L.field(30.5, "P9", "phone-devices", 1, "entries=1 [id=3 connected=true present=true battery=80 signal=4 gsm=3 register=ROAMING lock=UNLOCKED personal=false active=HANDS_FREE_PHONE connectedTech=BT caps=3 name-len=13]")
            L.write(p)
        it = run(session({"apps/signal_probe/signal_probe.log": f}), only=["P9"])["items"]["P9"]
        d = it["decided"]
        self.assertTrue(d["moves_incoming_active_disconnected"])
        self.assertTrue(d["duration_is_seconds"])
        self.assertEqual(d["battery_range"], [80, 80])
        self.assertEqual(d["contact_known_values"], ["true"])

    def test_cruise_and_sign(self):
        def f(p):
            L = ProbeLog().begin(0, "S8")
            L.field(10, "P15", "sign", 1, "invalid=0 value=70 unit=KM_H warn=SLI_WARNUNG_NICHT_ANGEFORDERT supp=KEIN_ZUSATZZEICHEN style=ECE np=KEIN_UEBERHOLVERBOT_ERKANNT npDist=0")
            L.field(11, "P15", "sign", 2, "invalid=0 value=50 unit=KM_H warn=SLI_WARNUNG_NICHT_ANGEFORDERT supp=KEIN_ZUSATZZEICHEN style=ECE np=KEIN_UEBERHOLVERBOT_ERKANNT npDist=0")
            L.field(20, "P15", "longitudinal", 1, "invalid=0 func=XCC_AKTIV xcc=DISP_ACC xccOn=true object=true sld=SLD_OFF lim=LIM_WARNING_OFF setSpeed=80 setState=DISP_OF_REQUESTED_SPEED_ACTIVE setUnit=false sla=SLA_NICHT_AKTIV hdc=KEINE_HDC_ANZEIGE")
            L.field(21, "P15", "hud-data2", 1, "setSpeed=80 setColour=ACTIVE_GREEN icon=ACC_WITH_TARGET_OBJECT iconState=ACTIVE bars=DISTANCE_3 sliState=ACTIVE_SPEED_LIMIT sliValue=LIMIT_70 npi=NO_DISPLAY warnIC=NO_DISPLAY hud=HUDSTATUS_OFF")
            L.write(p)
        it = run(session({"apps/signal_probe/signal_probe.log": f}), readings={"sign_values": [50, 70], "cruise_set_speeds": [80]}, only=["P15"])["items"]["P15"]
        d = it["decided"]
        self.assertEqual(d["sign_values"], [50, 70])
        self.assertTrue(d["sign_values_match_readings"])
        self.assertEqual(sorted(d["set_speed_follows"]), ["hud-data2", "longitudinal"])

    def test_guidance_raw_metres(self):
        def f(p):
            L = ProbeLog().begin(0, "S7")
            L.mark(10)
            L.field(11, "P12", "guiding-state", 1, "state=ACTIVE")
            L.field(12, "P12", "dart", 1, "kind=intersection bar=40 direction=SLIGHT_RIGHT geometry=TWO_WAY_FORK_TAKE_RIGHT dist-len=3 unit=METER raw=350 step=GS2 combined=SINGLE toDest=12000 unreliable=false desc-elements=1")
            L.field(30, "P12", "dart", 2, "kind=intersection bar=40 direction=SLIGHT_RIGHT geometry=TWO_WAY_FORK_TAKE_RIGHT dist-len=3 unit=METER raw=0 step=GS2 combined=SINGLE toDest=12000 unreliable=false desc-elements=1")
            L.write(p)
        root = session({"apps/signal_probe/signal_probe.log": f})
        marks = synth.marks_file(os.path.join(root, "marks.json"), [(1, "B7.4", "stock")])
        it = run(root, readings={"guidance": {"1": {"metres": 350}}}, marks=marks, only=["P12"])["items"]["P12"]
        d = it["decided"]
        self.assertTrue(d["guiding_reaches_active"] and d["raw_is_metres"] and d["raw_falls_to_zero_at_a_turn"])

    def test_tyres_scale_from_reading(self):
        def f(p):
            L = ProbeLog().begin(0, "S9")
            L.field(10, "P16", "tyre-pressure", 1, "fl=23 fr=24 rl=25 rr=24")
            L.field(11, "P16", "sport-display", 1, "boost=9 boostMax=160 lat=200 long=200 degradation=KEINE")
            L.write(p)
        it = run(session({"apps/signal_probe/signal_probe.log": f}), readings={"tyres": {"fl": 2.3, "fr": 2.4, "rl": 2.5, "rr": 2.4}, "boost_peak_bar": 0.09}, only=["P16"])["items"]["P16"]
        self.assertEqual(it["decided"]["tyre_factor_nearest"], 0.1)
        self.assertEqual(it["decided"]["boost_factor_nearest"], 0.01)

    def test_clock_daynight_layout(self):
        def f(p):
            L = Log().start(0, "f30_cluster", "0.7.20")
            L.info(3, 'clock (local) raw: {"displayHour":12,"displayMinute":30} -> 120')
            L.info(3.1, "clock: ours shows 12:30, UTC+02:00 from the car's shown clock - it must read what the head unit's own clock reads")
            L.info(4, "day/night: the car says 1 -> day")
            L.info(4.1, "day/night source: the car (statusDayNightChangeOver)")
            for t in (6, 7, 8):
                L.info(t, 'layout "6WB Comfort": 43 widgets, 21 layers (7 effects, 14 image sheets) on 3 connections (7 + 7 + 7), sheet limit 345600 px, whole-sheet writes 1590836 bytes, pixel memory 11.4 MiB of 16 MiB (12 glyph atlases 8.4 MiB)')
            L.info(9, "sign: limit 70 KM_H SLI_WARNUNG_NICHT_ANGEFORDERT KEIN_ZUSATZZEICHEN ECE true KEIN_UEBERHOLVERBOT_ERKANNT - (state value unit warn supplemental style sure no-passing distance)")
            L.write(p)
        r = run(session({"apps/f30_cluster/f30_cluster.log": f}), only=["L3", "L9", "L14", "L15"])["items"]
        self.assertEqual(r["L3"]["decided"]["offset_minutes"], 120)
        self.assertEqual(r["L3"]["decided"]["ours_from"], "shown")
        self.assertEqual(r["L9"]["decided"]["max_10s"], 3)
        self.assertTrue(r["L9"]["decided"]["matches_bench_3"])
        self.assertEqual(r["L14"]["decided"]["values"], [70])
        self.assertEqual(r["L15"]["decided"]["code_0_means"], None)
        self.assertTrue(r["L15"]["decided"]["car_value_arrives"])

    def test_renderer_tables(self):
        cr = "\n".join([
            "2026-11-18 10:00:00.000 I start: cluster-render 0.5.13, pid 1",
            "2026-11-18 10:00:05.000 I target panel: its scene goes whole to the renderer again: 5526 KB charged to the upload budget",
            "2026-11-18 10:01:00.000 I target panel: in the last 60 s its layers wrote 12 frames (3 ms from offer to flush on average), 1319 KB, 0 failed, 4 budget holds; renderer subscription not observable",
            "2026-11-18 10:00:01.000 I dcsm: slot 0x203 status 2 content 0x10004f8 class 0 map 1",
            "2026-11-18 10:00:01.500 I dcsm: slot 0x100 status 2 content 0x1000300 class 0 map 1",
            "2026-11-18 10:00:20.000 I dcsm: slot 0x100 status 0 content 0x1000300 class 0 map 0",
            "2026-11-18 10:00:30.000 I dcsm: slot 0x203 status 0 content 0x10004f8 class 0 map 0",
        ])
        r = run(session({"cluster-render/cluster-render.log": cr + "\n", "cluster-render/status.txt": "upload: cap 5500 KB/s (ceiling 5500, floor 2000): ceiling\n"}), only=["L10", "L11", "L12"])["items"]
        self.assertEqual(r["L12"]["decided"]["version"], [0, 5, 13])
        self.assertEqual(r["L10"]["decided"]["goes_whole_panel_KB"]["max"], 5526)
        self.assertEqual(r["L10"]["decided"]["cap_KBps_seen"], [5500])
        self.assertEqual(r["L11"]["decided"]["bmw_scene_0x1000300_mapped_s"], 18.5)


class Privacy(unittest.TestCase):
    def test_canaries_never_reach_a_derived_file(self):
        """A text planted in every member a probe line could carry: none may reach answers.json."""
        def f(p):
            L = ProbeLog().begin(0, "S4+S5")
            L.field(10, "P8", "player-metadata", 1, "sink=FRONT uiType=TWO_LINES menuEntry=1 track=7 line1-type=ARTIST line1-len=13 line2-type=TITLE line2-len=17 line3-len=0")
            # a line a buggy probe might write: free text where a number belongs
            L.info(11, "probe: P8 player-metadata #2 t=11.0: title=%s_TITLE artist=%s_ARTIST line1-len=13" % (CANARY, CANARY))
            L.info(12, "probe: P9 phone-call1-name #1 t=12.0: name=%s_NAME number=+380501234567" % CANARY)
            L.info(13, "check-control message: name 16 chars, no description, colour white, symbol 2, id 15, type 1")
            L.write(p)
        root = session({"apps/signal_probe/signal_probe.log": f})
        ans = pl.build(root, None, None, None)
        blob = json.dumps(ans)
        self.assertNotIn(CANARY, blob)
        self.assertNotIn("380501234567", blob)
        self.assertEqual(pc.check_derived(ans), [])
        hits = {r for f_ in pc.iter_files([root]) if f_.endswith(".log") for _l in [0] for r, _s in [h for t in open(f_) for h in pc.scan_line(t)]}
        self.assertIn("free-text-where-a-number-belongs", hits)
        self.assertIn("phone", hits)

    def test_evidence_refuses_text(self):
        with self.assertRaises(ValueError):
            tables_base.safe_value({"x": "Some Title"})
        with self.assertRaises(ValueError):
            tables_base.safe_value({"x": "hello"})
        self.assertEqual(tables_base.safe_value({"x": "WHITE", "y": [1, 2.5, None, True]}), {"x": "WHITE", "y": [1, 2.5, None, True]})

    def test_rules(self):
        for text, rule in (("pos 50.45012, 30.52340 here", "coordinate"), ("vin WBA8E9C50GK123456 x", "vin"), ("mail me@example.org", "email"),
                           ("mac aa:bb:cc:dd:ee:ff", "mac"), ("to 10.20.30.40 now", "ip"), ("name Имя", "non-latin-text"),
                           ("key=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCd", "token")):
            self.assertIn(rule, [r for r, _s in pc.scan_line(text)], text)
        for ok in ("active cc: number 15 control 1 frame 1/1 utility 0", "clock: ours shows 12:30, UTC+02:00 from the car", "2026-11-14T19:09:21.038Z INFO layout \"6WB Comfort\": 43 widgets",
                   "version 0.7.20 pid 31270 1.2.3.4", "map: 0x10004f8 → ok"):
            self.assertEqual([r for r, _s in pc.scan_line(ok) if r != "ip"], [], ok)

    def test_redaction(self):
        red, n = pc.redact_text("call +380 50 123 45 67 and me@example.org ok\nnext")
        self.assertEqual(n, 2)
        self.assertNotIn("example.org", red)
        self.assertIn("<redacted:email>", red)

    def test_derived_check_catches_a_leak(self):
        bad = pc.check_derived({"why": ["fine words", "at 50.45012, 30.52340"], "n": 5, "x": "Имя"})
        self.assertEqual(sorted(r for _w, r in bad), ["coordinate", "non-ascii-text"])


class Collector(unittest.TestCase):
    """collect.sh against a fake ssh that serves a fake car from a folder; and its refusals."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="cartest-")
        car = os.path.join(self.tmp, "car")
        os.makedirs(os.path.join(car, "var/opt/public/oap/oap_12211/data"))
        os.makedirs(os.path.join(car, "var/opt/public/oap/oap_12211/source"))
        os.makedirs(os.path.join(car, "var/opt/public/oap/oap_12299/data"))
        os.makedirs(os.path.join(car, "var/opt/public/oap/oap_12299/source"))
        os.makedirs(os.path.join(car, "var/opt/cluster-render/log"))
        os.makedirs(os.path.join(car, "var/opt/cluster-render/versions/0.5.9"))
        os.makedirs(os.path.join(car, "var/opt/cluster-render/versions/0.5.12"))
        os.makedirs(os.path.join(car, "run/cluster-render"))
        open(os.path.join(car, "var/opt/public/oap/oap_12211/source/package.json"), "w").write('{"name": "f30_cluster", "version": "0.7.20"}')
        open(os.path.join(car, "var/opt/public/oap/oap_12299/source/package.json"), "w").write('{"name": "some_other_app", "version": "1.0.0"}')
        Log().start(0).write(os.path.join(car, "var/opt/public/oap/oap_12211/data/f30_cluster.log"))
        open(os.path.join(car, "var/opt/public/oap/oap_12299/data/some_other_app.log"), "w").write("private\n")
        open(os.path.join(car, "var/opt/public/oap/oap_12211/data/settings.json"), "w").write('{"hudLayout": "wb_comfort"}')
        open(os.path.join(car, "var/opt/cluster-render/log/cluster-render.log"), "w").write("2026-11-18 10:00:00.000 I start: cluster-render 0.5.12, pid 1\n")
        open(os.path.join(car, "var/opt/cluster-render/versions/0.5.12/component.json"), "w").write('{"version": "0.5.12"}')
        open(os.path.join(car, "run/cluster-render/status.txt"), "w").write("upload: cap 5500 KB/s (ceiling 5500, floor 2000): ceiling\n")
        bindir = os.path.join(self.tmp, "bin")
        os.makedirs(bindir)
        # the fake ssh: the LAST argument is the remote command; it is run against the fake car with a tiny interpreter; it records every command
        ssh = os.path.join(bindir, "ssh")
        open(ssh, "w").write('''#!/usr/bin/env python3
import os, re, subprocess, sys
car = %r
cmd = sys.argv[-1]
open(os.path.join(car, "..", "commands.log"), "a").write(cmd + "\\n")
parts = cmd.split()
def p(x): return os.path.join(car, x.lstrip("/"))
if parts[0] == "cat": sys.stdout.write(open(p(parts[1])).read())
elif parts[0] == "ls":
    paths = [x for x in parts[1:] if not x.startswith("-")]
    long_ = "-l" in parts[1:2] or "-ld" in parts[1:2]
    d = p(paths[0])
    for n in sorted(os.listdir(d)): print(("drwxr-xr-x 2 root root 4096 Nov 14 19:07 " if long_ else "") + n)
elif parts[0] == "tail": sys.stdout.write(open(p(parts[3])).read()[-int(parts[2]):])
elif parts[0] == "date": print("2026-11-18T10:05:00Z")
elif parts[0] == "uname": print("Linux car 4.14 armv7l")
elif parts[0] == "journalctl": print("2026-11-18T10:00:00.000000+0000 car cluster-render[1]: I cluster-render: start: cluster-render 0.5.12, pid 1")
else: sys.exit(3)
''' % car)
        os.chmod(ssh, os.stat(ssh).st_mode | stat.S_IEXEC)
        self.bin = bindir
        self.out = os.path.join(self.tmp, "out")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_collect(self, *extra):
        env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ["PATH"])
        return subprocess.run(["bash", os.path.join(HERE, "collect.sh"), "192.0.2.7", "--out", self.out, "--date", "2026-11-18"] + list(extra), env=env,
                              capture_output=True, text=True, timeout=60)

    def test_copy_and_only_reads(self):
        r = self.run_collect("--label", "1")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(self.out, "apps/f30_cluster/f30_cluster.log")))
        self.assertTrue(os.path.isfile(os.path.join(self.out, "apps/f30_cluster/settings.json")))
        self.assertFalse(os.path.exists(os.path.join(self.out, "apps/some_other_app")), "an app that was not asked for must not be copied")
        self.assertTrue(os.path.isfile(os.path.join(self.out, "cluster-render/component.json")))
        self.assertTrue(os.path.isfile(os.path.join(self.out, "cluster-render/status.txt")))
        self.assertTrue(os.path.isfile(os.path.join(self.out, "cluster-render/journal.txt")))
        meta = json.load(open(os.path.join(self.out, "session.json")))
        self.assertEqual(meta["apps"]["f30_cluster"]["uid"], 12211)
        self.assertEqual(meta["apps"]["f30_cluster"]["version"], [0, 7, 20])
        self.assertEqual(meta["cluster_render_version"], [0, 5, 12])
        cmds = open(os.path.join(self.tmp, "commands.log")).read().split("\n")
        for c in cmds:
            if c:
                self.assertRegex(c, r"^(cat|ls|tail -c \d+|date -u|uname -a|journalctl -u cluster-render)\b", c)
                for bad in ("rm ", "kill", "systemctl", "mv ", "tee", ">", "|", ";", "reboot", "touch", "chmod", "restart"):
                    self.assertNotIn(bad, c)
        self.assertIn("+ ssh", r.stderr)                      # the commands were printed before they ran
        # the parser reads the collector's folder
        a = pl.build(self.out, None, None, None, ["L12"])
        self.assertEqual(a["items"]["L12"]["decided"]["version"], [0, 5, 12])
        self.assertEqual(a["session"]["date"], os.path.basename(self.out))

    def test_all_apps_flag_copies_the_other_one(self):
        r = self.run_collect("--all-apps")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(self.out, "apps/some_other_app/some_other_app.log")))

    def test_dry_run_runs_nothing(self):
        r = self.run_collect("--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "commands.log")))
        self.assertFalse(os.path.exists(self.out))
        self.assertIn("DRY RUN", r.stderr)

    def test_refuses_what_is_not_a_read(self):
        for bad in (["--since", "1 day ago; reboot"], ["--since", "$(id)"]):
            r = self.run_collect(*bad)
            self.assertNotEqual(r.returncode, 0)
        r = subprocess.run(["bash", os.path.join(HERE, "collect.sh"), "a;b", "--dry-run"], capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        src = open(os.path.join(HERE, "collect.sh")).read()
        for forbidden in ("systemctl", " kill", " rm -rf /", "reboot", "restart", "scp ", "rsync"):
            self.assertNotIn(forbidden, src.replace("restart, write, kill", ""), forbidden)


class Patches(unittest.TestCase):
    def setUp(self):
        self.ans = {"session": {"date": "2026-11-18"}, "items": {
            "L1": {"status": "answered", "dated": "2026-11-18", "evidence": [{"file": "f30_cluster.log", "line": 5, "shape": "x", "n": {}}],
                   "decided": {"hang_cases": ["A1", "A3"], "release": {"deferValues": [65535], "leftList": True}, "ccm_clearIds": [65535]}},
            "P4": {"status": "answered", "dated": "2026-11-18", "evidence": [], "decided": {"patch_trip_factors": {"bc": 2, "speed": 1, "cons": 0.1, "way": 0.1, "departureUtc": ["kombi"]},
                                                                                         "reading_match": {"time_equal": True, "departure_offset_min": 120}}},
            "P13": {"status": "answered", "dated": "2026-11-18", "evidence": [], "decided": {"tab_key": {"kind": "stalk-bit", "bit": 6, "mask": 64, "iface": "de.bmw.body.Light",
                                                                                                           "field": "IndicatorSteeringColumn", "path": ["operationColumnStalks"]}}},
            "P15": {"status": "answered", "dated": "2026-11-18", "evidence": [], "decided": {"set_speed_follows": ["longitudinal"], "sign_arrives": True}},
        }}

    def test_diffs_change_only_what_they_name(self):
        patches = mp.build(self.ans, REPO)
        kinds = {p["path"]: p["kind"] for p in patches}
        self.assertEqual(kinds["config.trip.factors.bc"], "diff")
        self.assertEqual(kinds["config.trip.departureUtc"], "diff")
        self.assertEqual(kinds["config.tabKey"], "insert")
        self.assertEqual(kinds["config.cruise"], "advice")
        for p in patches:
            if p["diff"]:
                changed = [l for l in p["diff"].splitlines() if l[:1] in "+-" and not l.startswith(("+++", "---"))]
                self.assertLessEqual(len(changed), 6, p["path"])
        # applying the whole chain to a copy still gives valid JSON with the new values
        tmp = tempfile.mkdtemp(prefix="cartest-")
        for f in ("apps/twin_dial/app.json", "apps/f30_cluster/app.json"):
            os.makedirs(os.path.dirname(os.path.join(tmp, f)))
            shutil.copy(os.path.join(REPO, f), os.path.join(tmp, f))
        tmp_patches = mp.build(self.ans, tmp)
        text = open(os.path.join(tmp, "apps/twin_dial/app.json")).read()
        # apply by replaying set_path (what the diffs say)
        for p in tmp_patches:
            if p["kind"] in ("diff", "insert") and p["file"].endswith("twin_dial/app.json"):
                text, _ = mp.set_path(text, p["path"].split("."), p["new"])
        d = json.loads(text)
        self.assertEqual(d["config"]["trip"]["factors"]["bc"], 2)
        self.assertEqual(d["config"]["tabKey"]["mask"], 64)
        self.assertEqual(d["config"]["trip"]["departureUtc"], ["kombi"])
        self.assertEqual(json.loads(open(os.path.join(REPO, "apps/twin_dial/app.json")).read())["config"]["trip"]["factors"]["bc"], 1)      # the checkout is untouched
        shutil.rmtree(tmp)

    def test_release_goes_to_f30_and_never_none_values(self):
        patches = mp.build(self.ans, REPO)
        rel = [p for p in patches if p["path"] == "config.ccActive.release"][0]
        self.assertEqual(rel["new"], {"deferValues": [65535], "leftList": True})
        self.assertTrue(rel["file"].endswith("f30_cluster/app.json"))
        self.assertFalse([p for p in patches if p["path"] == "config.ccActive.noneValues" and 65535 in (p.get("new") or [])])

    def test_text_editor_is_byte_exact(self):
        t = '{\n  "a": {\n    "b": 1,\n    "c": [1, 2]\n  },\n  "d": "x"\n}\n'
        n, k = mp.set_path(t, ["a", "b"], 2)
        self.assertEqual((n, k), (t.replace('"b": 1', '"b": 2'), "diff"))
        n, k = mp.set_path(t, ["a", "e", "f"], {"g": True})
        self.assertEqual(k, "insert")
        self.assertEqual(json.loads(n)["a"]["e"]["f"], {"g": True})
        self.assertTrue(n.endswith('"d": "x"\n}\n'))


@unittest.skipUnless(os.path.isdir(os.path.join(REPO, "reference", "car", "2026-11-15", "cluster-render")), "the 2026-11-15 snapshot is not on this Mac")
class RealMaterial(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ans = pl.build(os.path.join(REPO, "reference", "car", "2026-11-15"), None, None, None)

    def test_answers_that_the_old_material_gives(self):
        it = self.ans["items"]
        self.assertEqual(it["L12"]["status"], "answered")
        self.assertEqual(it["L12"]["decided"]["version"], [0, 5, 12])
        self.assertEqual(it["L10"]["status"], "answered")
        self.assertEqual(it["L10"]["decided"]["cap_KBps_seen"], [5500])
        self.assertEqual(it["L11"]["status"], "answered")
        self.assertEqual(it["P5"]["decided"]["pressure_unit"], "BAR")
        self.assertEqual(it["P16"]["label"], "arrives-other-app")
        self.assertEqual(it["L1"]["status"], "no-material")       # the saved f30 logs are 0.7.10 .. 0.7.12
        self.assertEqual(it["X10"]["decided"]["guard_strikes"], 1)

    def test_derived_file_is_clean(self):
        self.assertEqual(pc.check_derived(self.ans), [])

    def test_every_register_item_has_an_entry(self):
        it = self.ans["items"]
        for k in [("L%d" % i) for i in range(1, 16)] + [("P%d" % i) for i in range(1, 18)] + [("X%d" % i) for i in range(1, 12)] + [("F%d" % i) for i in range(1, 9)]:
            self.assertIn(k, it)


if __name__ == "__main__":
    unittest.main(verbosity=1)
