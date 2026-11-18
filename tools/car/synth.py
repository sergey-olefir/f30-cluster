"""Synthetic logs for the tests of tools/car (package CL).  Invented values; the shapes are the ones the apps write
(shared/hud.js, shared/twin_cc.js, shared/twin_tokens.js, shared/twin_probe.js and the signal_probe format fmt=1 of
bake/work/car/pub/CP/LOG-FORMAT.md)."""
from __future__ import annotations

import datetime as dt
import json
import os
from typing import List, Optional

T0 = dt.datetime(2026, 11, 18, 10, 0, 0, tzinfo=dt.timezone.utc)


def stamp(t: float) -> str:
    d = T0 + dt.timedelta(seconds=t)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (d.microsecond // 1000)


class Log:
    def __init__(self):
        self.lines: List[str] = []

    def info(self, t: float, msg: str, level: str = "INFO") -> "Log":
        self.lines.append("%s %s %s" % (stamp(t), level, msg))
        return self

    def start(self, t: float, app: str = "f30_cluster", ver: str = "0.7.20") -> "Log":
        return self.info(t, "starting %s %s" % (app, ver)).info(t + 0.5, "signal KombiIF subscribed")

    def write(self, path: str) -> str:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(self.lines) + "\n")
        return path

    # ---- the message machine's lines
    def act(self, t, number, control=0, frame=1, of=1, utility=0):
        return self.info(t, "active cc: number %s control %s frame %s/%s utility %s" % (number, control, frame, of, utility))

    def listing(self, t, ids=(), entries=None, unfit=False):
        """ids = [(15, 'white'), ...]; none = list at rest."""
        n = len(ids)
        seg = ", ".join("%d %s" % i for i in ids) if ids else "none"
        e = len(ids) + 1 if entries is None else entries
        return self.info(t, "check-control list: %d messages, name lengths %s%s; listed %s of %d entries" %
                         (n, "/".join("16" for _ in ids), " (not a list config.ccList fits)" if unfit else "", seg, e))

    def noentry(self, t, n):
        return self.info(t, "active cc: no ccList entry for number %d - shown, BMW's panel stays open" % n)

    def disp(self, t, n):
        return self.info(t, "displayed cc: number %d" % n)

    def ccm(self, t, id_=65535):
        return self.info(t, "check-control message: no name, no description, colour default, symbol 0, id %d, type 1" % id_)


def msg_case(name: str, path: str, tail_s: float = 120.0) -> str:
    """One f30_cluster log (0.7.20) for MC's case `name`; the file ends tail_s seconds after the last event."""
    L = Log().start(0)
    L.listing(4, ())
    if name == "A0":              # a door message that ends properly, list and number arriving in the 'wrong' order (the trap)
        L.act(20, 15, 1).listing(20.2, [(15, "white")])
        L.listing(40.0, ()).noentry(40.1, 15).act(40.4, 0, 0)
        end = 60
    elif name == "A1":
        L.act(2, 65535, 4095, 15, 15).noentry(2.1, 65535)
        end = 2 + tail_s
    elif name == "A2":
        L.act(20, 15, 1).listing(20.2, [(15, "white")])
        L.listing(40.0, ()).act(40.3, 65535, 4095, 15, 15).noentry(40.4, 65535)
        end = 40 + tail_s
    elif name == "A3":
        L.act(20, 15, 1).listing(20.2, [(15, "white")])
        L.listing(40.0, ()).noentry(40.1, 15)
        end = 40 + tail_s
    elif name == "A4":
        L.act(20, 15, 1).listing(20.2, [(15, "white")])
        L.listing(40.0, ()).noentry(40.1, 15).act(40.5, 15, 0)
        end = 40 + tail_s
    elif name == "A5":
        L.act(20, 987, 1).listing(20.1, [(987, "white")])
        L.disp(45, 0)
        end = 20 + 60
    elif name == "A8":
        L.listing(20, [(40, "red")])
        end = 20 + 60
    elif name == "A9":
        L.listing(20, [(40, "red")], unfit=True)
        end = 20 + 60
    elif name == "A10":
        end = 60
    elif name == "A11":
        L.ccm(10, 65535)
        end = 60
    else:
        raise ValueError(name)
    if name == "A10":
        L.lines = L.lines[:2]
    L.info(end, "display: 1 fps sent, renderer 1 fps, 1.70 ms per frame (max 1.7)")
    return L.write(path)


def settings(path: str, **kw) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(kw, fh)
    return path


# ---- Twin Dial's trip lines -------------------------------------------------------------------------------------------------

def twin_trip(path: str, speed1=410, cons1=68, speed2=520, cons2=55, hours=0, minutes=43, way=124, hour=14, minute=0, odo=48215, old_shape=False,
              with_probe=False) -> str:
    L = Log().start(0, "twin_dial", "0.1.1")
    if old_shape:
        L.info(26.8, "trip average raw (P4): %d,%d,%d,%d" % (speed1, cons1, speed2, cons2))
        L.info(26.9, "trip travel raw (P4): %d,%d,%d" % (hours, minutes, way))
        L.info(27.0, "trip departure raw (P4): %d,%d" % (hour, minute))
        L.info(27.1, "odometer raw (P3): %d -> %d km (factor 1 km)" % (odo, odo))
    else:
        L.info(26.8, "trip average (statusBordcomputerAverage) first at 26.8 s: raw speed1=%d cons1=%d speed2=%d cons2=%d speedUnit=KM_S_H consUnit=VERBRAUCH_IN_L_S_100KM -> speed 41.0 km/h, cons 6.8 l/100 km (BC1) [UNVERIFIED: compare with the car's trip page]" % (speed1, cons1, speed2, cons2))
        L.info(26.9, "trip travel (statusBordcomputerTravelData) first at 26.9 s: raw hours=%d minutes=%d way=%d -> distance 12.4 km, time 0:43 [UNVERIFIED: compare with the car's trip page]" % (hours, minutes, way))
        L.info(27.0, "trip start (statusBordcomputerTravelStart) first at 27.0 s: raw hour=%d minute=%d -> departure 14:00 [UNVERIFIED: compare with the car's trip page]" % (hour, minute))
        L.info(27.1, "odometer raw (P3): %d -> %d km (factor 1 km) [rangeTank, first at 27.1 s, UNVERIFIED: compare with the cluster's odometer]" % (odo, odo))
        L.info(120.0, "trip summary #1 at 120.0 s: heard average (#3, first 26.8 s), travel (#2, first 26.9 s), start (#1, first 27.0 s); SILENT rl3")
        L.info(120.1, "trip getter rl3 (ResetLogic3.bcDataAll, silent): error or no answer: timeout (the car does not send it)")
        L.info(120.2, "trip check [kombi]: distance / time = 17.3 km/h, average speed 41.0 km/h, ratio 2.37 -> consistent (above 1: standing time not counted)")
    L.info(130, "display: 1 fps sent, renderer 1 fps, 1.70 ms per frame (max 1.7)")
    return L.write(path)


# ---- the signal_probe app's lines (fmt=1) --------------------------------------------------------------------------------------

class ProbeLog(Log):
    def __init__(self):
        super().__init__()
        self.mk = 0
        self.mk_ts = None

    def begin(self, t=0.0, sets="S6"):
        return self.info(t, "starting signal_probe 0.1.0").info(t + 0.1, "probe: start signal_probe v=0.1.0 fmt=1 sets=%s fields=24 of 144" % sets)

    def mark(self, t):
        self.mk += 1
        self.mk_ts = t
        return self.info(t, "probe: mark M%d t=%.1f tms=%d sets=S6" % (self.mk, t, int(t * 1000)))

    def field(self, t, item, tag, n, body):
        since = ""
        if self.mk_ts is not None:
            since = " tms=%d since=M%d+%d" % (int(t * 1000), self.mk, int((t - self.mk_ts) * 1000))
        return self.info(t, "probe: %s %s #%d t=%.1f: %s%s" % (item, tag, n, t, body, since))

    def stalk(self, t, n, new, prev):
        up, down = new & ~prev, prev & ~new
        return self.field(t, "P13", "stalk", n, "stalks=%d(0x%x) prev=%d(0x%x) up=0x%x down=0x%x" % (new, new, prev, prev, up, down))

    def summary(self, t, st, spoke, silent, plus=30):
        self.info(t, "probe: summary %s +%ds: %d of 24 fields have spoken: %s" % (st, plus, len(spoke), ", ".join("%s %s(1 events, 1 lines)" % x for x in spoke) or "none"))
        return self.info(t + 0.01, "probe: summary %s +%ds: silent: %s" % (st, plus, ", ".join("%s %s" % x for x in silent) or "none"))


def marks_file(path: str, steps: List[tuple]) -> str:
    """steps = [(mark, step, tag)] in CQ's session_marks.json form."""
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"about": "synthetic", "count": len(steps), "marks": [{"mark": m, "step": s, "block": s.split(".")[0], "items": [], "expect": [], "tag": t,
                                                                        "parked": True, "optional": False, "sets": []} for m, s, t in steps]}, fh)
    return path
