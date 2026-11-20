#!/usr/bin/env python3
"""beam HS: a night drive's HB recordings -> the signal report, the driver's timeline, labelled events, scenario files, a summary.

    python3 -I tools/car/hb_analyse.py <data/rec folder or rec files ...> -o <out folder> [--flash-max S] [--empty-status N ...]
                                       [--before S] [--after S] [--no-scenarios]

The input is what Signal Probe's recorder writes with the recording choice "HB" (set S18, apps/signal_probe/fields.js), as
tools/car/collect.sh copies it (apps/signal_probe/rec/). The brief: docs/highbeam/BRIEF-HS-signals.md; the drive:
docs/highbeam/DRIVE-PROTOCOL.md; the scenario format: docs/highbeam/CONTRACT.md section 5 (a copy in tools/beam-sim/).

<out>/report.md|json   per recording: every HB source present or silent, its arrival rate (written lines + folded repeats), gaps,
                       value ranges and enum names; the light objects (how many at once, per class, every member's range); the
                       parked check's bit table (which stalk bit is which movement, which lamp member follows the high beam); the
                       driver's timeline (high on / off / flash); the camera's verdict against the driver (agreement, lead / lag);
                       the decode helpers (does Distance fall before a dip, does XPosition move outward, which classes only while
                       following, which stalk bit precedes a lamp change); the labelled events and the "high kept with objects"
                       stretches
<out>/events.csv       one row per labelled event (numbers and enum names)
<out>/scenarios/       R.<session>.json (+ .jsonl frames) for each drive, R.<session>.e<NN>.<kind>.json for each labelled event:
                       the contract's scenario format, raw values, nothing scaled but the speed (km/h x 1/64, the kit's verified scale)
<out>/summary.md       for the owner, Ukrainian and English: what the car sends, what it means, what is still unknown

Every encoding of the camera's light objects and verdict is UNKNOWN until a drive: the tool never names a unit, and every "allow"
value, class meaning or status meaning it prints is a hypothesis drawn from the driver's own switching. Read only, local, numbers and
enum names only (the recorder writes no text). Plain Python 3, no third-party package. Mac only, never shipped.
Its test: tools/car/test_hb_analyse.py (synthetic drives made by tools/car/hb_synth.js).
"""
import argparse
import bisect
import csv
import json
import math
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import rec_convert as rc  # noqa: E402

VERSION = '0.1'
GRID = 100                                   # ms, the common clock of the timeline and the frames
OBJ_MEMBERS = [('id', 'Id'), ('cls', 'Class'), ('status', 'Status'), ('x', 'XPosition'), ('y', 'YPosition'), ('w', 'Width'), ('h', 'Height'),
               ('dist', 'Distance'), ('wl', 'AngularSpeedLeft'), ('wr', 'AngularSpeedRight')]
OBJ_DEFAULT = {'Id': 15, 'Class': 15, 'Status': 7, 'XPosition': 255, 'YPosition': 255, 'Width': 255, 'Height': 63, 'Distance': 127,
               'AngularSpeedLeft': 255, 'AngularSpeedRight': 255}            # the catalogue's defaultValue of each output
OBJ_TAGS = ['hb-obj%d' % n for n in range(1, 16)]
# the high-beam lamp: HR-REPORT Part C row 1 (the head unit's lamp status, probably the KOMBI telltale's source) first, row 2 second
HIGH_SOURCES = [('lights', 'statusMainBeam_headlightFlasher'), ('hb-lamps', 'controlFunctionMainBeam')]
VERDICT_DEFAULT = {'controlHighBeam': 3, 'statusCameraCalibration': 3, 'numberVehicles': 15, 'numberRoadSigns': 15, 'numberPedestrians': 15,
                   'reasonSwitchOffHighBeam': 65535, 'cameraCalibrationOffsetHorizontal': 255, 'cameraCalibrationOffsetVertical': 255,
                   'qualifierDataControlHighBeamAssistant': 15, 'qualifierExtendedControlHighBeamAsstistant': 15, 'syncSignal': 255}
PARKED = [('push', 'push forward (high beam on)'), ('pull', 'pull back (off)'), ('flash', 'pull and hold (flash)'),
          ('left_full', 'left indicator, full'), ('right_full', 'right indicator, full'), ('left_tip', 'left indicator, tip'),
          ('right_tip', 'right indicator, tip')]
LAMPISH = ['hb-lamps', 'lights', 'brake-light', 'hb-low-beam', 'hb-indicators', 'hb-indicators2', 'stalk-complete', 'hb-switch', 'hb-lightswitch',
           'hb-fog-front', 'hb-fog-rear', 'indicate']
SWITCH = {'AUTO': 'auto', 'LIGHT_OFF': 'off', 'DRIVINGLIGHT': 'low', 'POSITIONLIGHT': 'park', 'PARKINGLIGHT_LEFT': 'park', 'PARKINGLIGHT_RIGHT': 'park'}


# ---- reading ------------------------------------------------------------------------------------------------------------------
class Field:
    def __init__(self, tag, name):
        self.tag, self.name = tag, name
        self.cols = []
        self.t = []                  # ms of each written line
        self.rows = []               # {col: value} of each written line (enum names as names)
        self.folds = []              # (t of the line it precedes, n, t_last)
        self.arrivals = None         # every arrival, the folded ones placed evenly (built on demand)

    def arr(self):
        """Every arrival time: the written lines and the folded repeats, spread evenly from the line before to the last fold."""
        if self.arrivals is None:
            out = list(self.t)
            for (tl, n, tlast) in self.folds:
                i = bisect.bisect_left(self.t, tl) - 1
                ta = self.t[i] if i >= 0 else tlast
                if n > 0 and tlast is not None and tlast >= ta:
                    for k in range(1, n + 1):
                        out.append(ta + (tlast - ta) * k / n)
            out.sort()
            self.arrivals = out
        return self.arrivals

    def col(self, c):
        ts, vs = [], []
        for t, r in zip(self.t, self.rows):
            if c in r:
                ts.append(t)
                vs.append(r[c])
        return ts, vs

    def at(self, t):
        """The row in force at t (the last written line at or before t) and the age of the last arrival, or (None, None)."""
        i = bisect.bisect_right(self.t, t) - 1
        if i < 0:
            return None, None
        a = self.arr()
        j = bisect.bisect_right(a, t) - 1
        return self.rows[i], t - a[j]


class Session:
    def __init__(self, sid):
        self.id = sid
        self.fields = {}
        self.marks = []
        self.files, self.cut = [], []
        self.end = None
        self.header = None
        self.bad = 0
        self.ids = {}                # field id -> Field (ids hold for the whole recording)

    def f(self, tag):
        return self.fields.get(tag)

    def span(self):
        ts = [f.t[-1] for f in self.fields.values() if f.t]
        last = max(ts) if ts else 0
        if self.end and self.end.get('t') is not None:
            last = max(last, self.end['t'])
        return last


def load(inputs):
    paths = []
    for a in inputs:
        if os.path.isdir(a):
            paths += [os.path.join(a, n) for n in sorted(os.listdir(a)) if rc.FILE_RE.match(n)]
        elif rc.FILE_RE.match(os.path.basename(a)):
            paths.append(a)
    sessions = {}
    for p in sorted(paths, key=os.path.basename):
        m = rc.FILE_RE.match(os.path.basename(p))
        s = sessions.setdefault(m.group(1), Session(m.group(1)))
        parse_file(p, s)
    return sessions


def parse_file(path, sess):
    text, cut = rc.read_text(path)
    sess.files.append(os.path.basename(path))
    if cut:
        sess.cut.append(os.path.basename(path))
    by_id, codes, prev = {}, {}, {}
    lines = text.split('\n')
    if text and not text.endswith('\n'):
        lines = lines[:-1]
    for line in lines:
        if not line:
            continue
        p = line.split(',')
        if line[0] == '#':
            k = p[0]
            if k == '#rec':
                sess.header = sess.header or {'version': p[2], 'session': p[3], 'sets': p[7] if len(p) > 7 else ''}
            elif k == '#f':
                fid, tag, name, cols = p[1], p[2], p[3], p[4:]
                f = sess.fields.get(tag)
                if f is None:
                    f = sess.fields[tag] = Field(tag, name)
                for c in cols:
                    if c not in f.cols:
                        f.cols.append(c)
                by_id[fid] = (f, cols)
                sess.ids[fid] = f
                prev.pop(fid, None)
            elif k == '#n':
                codes['@' + p[1]] = p[2]
            elif k == '#m':
                sess.marks.append((rc.num(p[1]), rc.num(p[2])))
            elif k == '#s' and len(p) >= 4:
                f = sess.ids.get(p[2])
                if f is not None:
                    f.folds.append((rc.num(p[1]), rc.num(p[3]) or 0, rc.num(p[4]) if len(p) > 4 else rc.num(p[1])))
            elif k == '#end':
                sess.end = {'t': rc.num(p[1])}
                for kv in p[2:]:
                    if '=' in kv:
                        a, b = kv.split('=', 1)
                        sess.end[a] = rc.num(b)
            continue
        if len(p) < 6 or p[1] not in by_id:
            sess.bad += 1
            continue
        f, cols = by_id[p[1]]
        t = rc.num(p[0])
        if t is None:
            sess.bad += 1
            continue
        if p[5] == '=' and len(p) == 6:
            raw = prev.get(p[1])
            if raw is None:
                sess.bad += 1
                continue
        else:
            raw = p[5:]
            if len(raw) != len(cols):
                sess.bad += 1
                continue
            prev[p[1]] = raw
        row = {}
        for c, x in zip(cols, raw):
            if x == '':
                continue
            row[c] = codes.get(x, x) if x.startswith('@') else rc.num(x)
        f.t.append(t)
        f.rows.append(row)


# ---- small helpers ------------------------------------------------------------------------------------------------------------
def med(xs):
    return statistics.median(xs) if xs else None


def r3(x):
    return None if x is None else round(x, 3)


def linfit(xs, ys):
    n = len(xs)
    if n < 2:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx


def obj_col(slot, member):
    return '%sObject%d' % (member, slot)


def obj_of(row, slot):
    """One light object's raw members {id, cls, ...} from its event row, or None."""
    if row is None:
        return None
    o = {}
    for k, m in OBJ_MEMBERS:
        v = row.get(obj_col(slot, m))
        if v is None:
            return None
        o[k] = v
    return o


def is_default(o):
    return all(o[k] == OBJ_DEFAULT[m] for k, m in OBJ_MEMBERS)


def present(o, empty_status):
    return o is not None and not is_default(o) and o['status'] not in empty_status


def hb_tags():
    """The fields the HB set reads (its own and the shared ones), from design/car/probe_fields.json."""
    p = os.path.join(HERE, '..', '..', 'design', 'car', 'probe_fields.json')
    try:
        d = json.load(open(p, encoding='utf-8'))
    except (OSError, ValueError):
        return []
    return sorted(f['tag'] for f in d.get('fields', []) if f.get('set') == 'S18' or 'S18' in (f.get('also') or []))


def speed_at(s, t):
    f = s.f('car-speed2')
    if not f:
        return None
    row, age = f.at(t)
    if row is None or age > 3000:
        return None
    v = row.get('speedVehicleCentreOfGravity')
    return None if v is None else v / 64.0


def high_value(v):
    if v is None:
        return None
    v = str(v)
    if v in ('EIN',) or v.startswith('ON_MAB'):
        return True
    if v in ('AUS', 'OFF_MAB'):
        return False
    return None


# ---- the signal report ------------------------------------------------------------------------------------------------------------
def field_report(f, span_ms):
    a = f.arr()
    iv = [b - x for x, b in zip(a, a[1:]) if b > x]
    mi = med(iv)
    gaps = [g for g in iv if mi and g > max(3 * mi, 500)]
    rng = {}
    for c in f.cols:
        ts, vs = f.col(c)
        nums = [v for v in vs if isinstance(v, (int, float))]
        names = sorted(set(v for v in vs if isinstance(v, str)))
        if names:
            cnt = {}
            for v in vs:
                if isinstance(v, str):
                    cnt[v] = cnt.get(v, 0) + 1
            rng[c] = {'enum': cnt}
        elif nums:
            rng[c] = {'min': min(nums), 'max': max(nums), 'distinct': len(set(nums))}
    sp = (a[-1] - a[0]) / 1000.0 if len(a) > 1 else 0
    out = {'tag': f.tag, 'source': f.name, 'present': True, 'lines': len(f.t), 'folded': sum(n for _, n, _ in f.folds), 'arrivals': len(a),
           'first_s': r3(a[0] / 1000.0) if a else None, 'span_s': r3(sp), 'rate_hz': r3(len(a) / sp) if sp > 0 else None,
           'median_interval_ms': r3(mi), 'gaps': len(gaps), 'longest_gap_s': r3(max(gaps) / 1000.0) if gaps else 0, 'ranges': rng}
    nd = non_default(f)
    if nd is not None:
        out['non_default'] = nd          # HR-REPORT Part E 2: does any output ever differ from its catalogue default
    return out


def non_default(f):
    """For the camera's light-detection events: True when any output ever left its catalogue default, else False; None for others."""
    if f.tag in OBJ_TAGS:
        slot = int(f.tag[6:])
        return any(o is not None and not is_default(o) for o in (obj_of(r, slot) for r in f.rows))
    if f.tag == 'hb-control':
        return any(any(r.get(k) is not None and r.get(k) != d for k, d in VERDICT_DEFAULT.items()) for r in f.rows)
    if f.tag in ('hb-meid1', 'hb-meid2'):
        return any(any(v != 255 for v in r.values()) for r in f.rows)
    return None


def camera_state(s, tags):
    """HR-REPORT 3.1's three outcomes for a group of the camera's events: 'silent' (no event), 'defaults only', 'present' (real values)."""
    fs = [s.f(t) for t in tags if s.f(t)]
    if not fs:
        return 'silent'
    return 'present' if any(non_default(f) for f in fs) else 'defaults only'


def objects_report(s, empty_status):
    """How many light objects at once, per class, every member's range (present objects only)."""
    tags = [t for t in OBJ_TAGS if s.f(t)]
    if not tags:
        return {'present': False}
    t_end = s.span()
    counts = []
    per_cls = {}
    ranges = {k: [None, None] for k, _ in OBJ_MEMBERS}
    status_seen, tracks = {}, {}
    for t in range(0, int(t_end) + 1, GRID):
        n = 0
        for tag in tags:
            slot = int(tag[6:])
            row, age = s.f(tag).at(t)
            if row is None or age > 1500:
                continue
            o = obj_of(row, slot)
            if o is None:
                continue
            status_seen[o['status']] = status_seen.get(o['status'], 0) + 1
            if not present(o, empty_status):
                continue
            n += 1
            per_cls[o['cls']] = per_cls.get(o['cls'], 0) + 1
            tracks.setdefault((slot, o['id'], o['cls']), 0)
            tracks[(slot, o['id'], o['cls'])] += 1
            for k, _ in OBJ_MEMBERS:
                lo, hi = ranges[k]
                ranges[k] = [o[k] if lo is None else min(lo, o[k]), o[k] if hi is None else max(hi, o[k])]
        counts.append(n)
    busy = [c for c in counts if c > 0]
    cls_tracks = {}
    for (slot, oid, cls), n in tracks.items():
        cls_tracks[cls] = cls_tracks.get(cls, 0) + 1
    return {'present': True, 'slots_heard': len(tags), 'max_at_once': max(counts) if counts else 0, 'typical_when_any': med(busy),
            'share_of_time_with_any': r3(len(busy) / len(counts)) if counts else 0, 'samples_per_class': {str(k): v for k, v in sorted(per_cls.items())},
            'tracks_per_class': {str(k): v for k, v in sorted(cls_tracks.items())}, 'status_values_seen': {str(k): v for k, v in sorted(status_seen.items())},
            'ranges': {k: v for k, v in ranges.items()}}


# ---- the driver: the stalk, the lamps, the timeline ---------------------------------------------------------------------------------
def stalk_holds(s):
    """[{t0, t1, bits, main}] every stretch where the stalk byte is not 0 (main: the bit pattern held longest)."""
    f = s.f('stalk') or s.f('stalk-complete')
    if not f:
        return []
    ts, vs = f.col('operationColumnStalks')
    out, cur = [], None
    for t, v in zip(ts, vs):
        if not isinstance(v, (int, float)) or v == 255:
            continue
        v = int(v)
        if v and cur is None:
            cur = {'t0': t, 'bits': v, 'dur': {}, 'last': (t, v)}
        elif cur is not None:
            lt, lv = cur['last']
            cur['dur'][lv] = cur['dur'].get(lv, 0) + (t - lt)
            if v:
                cur['bits'] |= v
                cur['last'] = (t, v)
            else:
                cur['t1'] = t
                cur['main'] = max(cur['dur'].items(), key=lambda kv: kv[1])[0] if cur['dur'] else cur['bits']
                del cur['dur'], cur['last']
                out.append(cur)
                cur = None
    return out


def high_series(s):
    """(source 'tag.col', [(t, bool)]) of the first high-beam member that is present and changes, else (None, [])."""
    for tag, col in HIGH_SOURCES:
        f = s.f(tag)
        if not f:
            continue
        ts, vs = f.col(col)
        ch, last = [], None
        for t, v in zip(ts, vs):
            b = high_value(v)
            if b is None or b == last:
                continue
            ch.append((t, b))
            last = b
        if len(ch) > 1 or (ch and ch[0][1]):
            return tag + '.' + col, ch
    return None, []


def parked_check(s, holds):
    """The protocol's 7 holds, in order: the first run of 7 holds of 2 s or more, 1..20 s apart, while standing (after the last
    mark before it, if any). Returns None or {t0, rows: [...], push, pull, highMembers}."""
    long = [h for h in holds if (h['t1'] - h['t0']) >= 2000 and (speed_at(s, h['t0']) or 0) < 3]
    marks = [m[0] for m in s.marks if m[0] is not None]
    for i in range(0, len(long) - 6):
        run = long[i:i + 7]
        if not all(1000 <= b['t0'] - a['t1'] <= 20000 for a, b in zip(run, run[1:])):
            continue
        rows = []
        for (key, label), h in zip(PARKED, run):
            rows.append({'step': key, 'label': label, 't_s': r3(h['t0'] / 1000.0), 'held_s': r3((h['t1'] - h['t0']) / 1000.0),
                         'bits': '0x%02x' % h['main'], 'all_bits': '0x%02x' % h['bits'], 'changes': lamp_changes(s, h['t0'] - 200, h['t1'] + 1000)})
        mark = max([m for m in marks if m <= run[0]['t0']], default=None)
        res = {'t0_s': r3(run[0]['t0'] / 1000.0), 'after_mark_s': r3((run[0]['t0'] - mark) / 1000.0) if mark is not None else None, 'rows': rows,
               'push': rows[0]['bits'], 'pull': rows[1]['bits'], 'flash': rows[2]['bits']}
        # the members that follow the high beam: changed with the push, changed back with the pull, and on during the flash
        on_push = {c['member']: c for c in rows[0]['changes']}
        res['highMembers'] = sorted(m for m, c in on_push.items()
                                    if any(x['member'] == m and x['to'] == c['from'] for x in rows[1]['changes'])
                                    and any(x['member'] == m for x in rows[2]['changes']))
        return res
    return None


def lamp_changes(s, t0, t1):
    """Every enum / bool member of the lamp fields that changed inside [t0, t1]: [{member, from, to, t_s}]."""
    out = []
    for tag in LAMPISH:
        f = s.f(tag)
        if not f:
            continue
        for c in f.cols:
            ts, vs = f.col(c)
            if not vs or not any(isinstance(v, str) for v in vs) and tag not in ('hb-fog-front', 'hb-fog-rear'):
                continue
            i = bisect.bisect_left(ts, t0)
            prev = vs[i - 1] if i > 0 else None
            first = None
            for j in range(i, len(ts)):
                if ts[j] > t1:
                    break
                if prev is not None and vs[j] != prev:
                    if first is None:
                        first = {'member': tag + '.' + c, 'from': prev, 'to': vs[j], 'path': [prev, vs[j]], 't_s': r3(ts[j] / 1000.0)}
                    else:
                        first['to'] = vs[j]
                        first['path'].append(vs[j])
                prev = vs[j]
            if first is not None:
                out.append(first)
    return out


def timeline(s, flash_max_ms, parked):
    """The driver's actions from the high-beam member: [{t, kind, source, parked}] and the on-periods."""
    src, ch = high_series(s)
    holds = stalk_holds(s)
    out, periods = [], []
    if src is None:
        # no lamp member: the stalk alone, with the parked check's bits (push = on, pull = off; a pull while off = a flash)
        if not parked:
            return None, [], [], holds
        push, pull = int(parked['push'], 16), int(parked['pull'], 16)
        on = False
        for h in holds:
            if h['main'] == push and not on:
                on = True
                ch.append((h['t0'], True))
            elif h['main'] == pull and on:
                on = False
                ch.append((h['t0'], False))
            elif h['main'] == pull and not on:
                ch.append((h['t0'], True))
                ch.append((h['t1'], False))
        src = 'stalk (bits from the parked check)'
    on_at = None
    for t, b in ch:
        if b and on_at is None:
            on_at = t
        elif not b and on_at is not None:
            periods.append((on_at, t))
            on_at = None
    if on_at is not None:
        periods.append((on_at, None))
    pk = (parked_window(parked) if parked else None)
    inpk = lambda t: bool(pk and pk[0] <= t <= pk[1])  # noqa: E731
    for a, b in periods:
        if b is not None and b - a < flash_max_ms:
            out.append({'t': a, 'kind': 'flash', 'held_ms': b - a, 'parked': inpk(a)})
            continue
        out.append({'t': a, 'kind': 'high_on', 'parked': inpk(a)})
        if b is not None:
            out.append({'t': b, 'kind': 'high_off', 'parked': inpk(b)})
    out.sort(key=lambda e: e['t'])
    return src, out, periods, holds


def parked_window(parked):
    rows = parked['rows']
    return (rows[0]['t_s'] * 1000 - 1000, (rows[-1]['t_s'] + rows[-1]['held_s']) * 1000 + 2000)


def high_at(periods, t, flash_max_ms):
    for a, b in periods:
        if a <= t and (b is None or t < b):
            return True
    return False


# ---- the camera's verdict against the driver ----------------------------------------------------------------------------------------
def verdict_report(s, periods, events, flash_max_ms, parked):
    f = s.f('hb-control')
    if not f:
        return {'present': False, 'status': 'silent'}
    if not non_default(f):
        return {'present': True, 'status': 'defaults only', 'events': len(f.t) + sum(n for _, n, _ in f.folds)}
    ts, vs = f.col('controlHighBeam')
    pk = parked_window(parked) if parked else None
    grid = []
    for t in range(0, int(s.span()) + 1, GRID):
        if pk and pk[0] <= t <= pk[1]:
            continue
        sp = speed_at(s, t)
        if sp is not None and sp < 3:
            continue
        i = bisect.bisect_right(ts, t) - 1
        if i < 0:
            continue
        grid.append((t, vs[i], high_at(periods, t, flash_max_ms)))
    hist = {}
    for _, v, h in grid:
        e = hist.setdefault(v, [0, 0])
        e[0] += 1
        e[1] += 1 if h else 0
    if not grid:
        return {'present': True, 'status': 'present, no driving time to compare', 'values': {str(k): v[0] for k, v in hist.items()}}
    # the value that goes with the driver's high beam (a hypothesis: the share of its time with the high beam on is the largest)
    cand = [(v[1] / v[0], k) for k, v in hist.items() if v[0] >= 0.05 * len(grid)]
    allow = max(cand)[1] if cand else None
    agree = sum(1 for _, v, h in grid if (v == allow) == h) / len(grid)
    # lead / lag per driver switch: the nearest camera change the same way within 10 s (positive = the camera was earlier)
    cam = []
    for i in range(1, len(vs)):
        a, b = vs[i - 1] == allow, vs[i] == allow
        if a != b:
            cam.append((ts[i], b))
    leads = {'high_on': [], 'high_off': []}
    for e in events:
        if e['kind'] not in leads or e['parked']:
            continue
        want = e['kind'] == 'high_on'
        best = None
        for t, b in cam:
            if b == want and abs(e['t'] - t) <= 10000 and (best is None or abs(e['t'] - t) < abs(e['t'] - best)):
                best = t
        leads[e['kind']].append(None if best is None else (e['t'] - best) / 1000.0)
    lag = xcorr(grid, allow)
    return {'present': True, 'status': 'present', 'values': {str(k): {'share': r3(v[0] / len(grid)), 'share_with_driver_high': r3(v[1] / v[0])} for k, v in sorted(hist.items(), key=lambda kv: str(kv[0]))},
            'allow_value_guess': allow, 'agreement': r3(agree), 'compared_s': r3(len(grid) * GRID / 1000.0),
            'lead_s': {k: {'median': r3(med([x for x in v if x is not None])), 'each': [r3(x) if x is not None else None for x in v],
                           'unmatched': sum(1 for x in v if x is None)} for k, v in leads.items()},
            'best_shift_s': lag, 'reasons': reason_codes(s)}


def xcorr(grid, allow):
    """The shift of the camera's series (in s, + = the camera earlier) that agrees best with the driver, within 10 s."""
    cam = [1 if v == allow else 0 for _, v, _ in grid]
    drv = [1 if h else 0 for _, _, h in grid]
    best, best_k = -1, 0
    n = len(cam)
    for k in range(-100, 101):
        num = den = 0
        for i in range(max(0, -k), min(n, n - k)):
            num += 1 if cam[i] == drv[i + k] else 0
            den += 1
        if den and num / den > best:
            best, best_k = num / den, k
    return r3(best_k * GRID / 1000.0)


def reason_codes(s):
    f = s.f('hb-control')
    ts, vs = f.col('reasonSwitchOffHighBeam')
    cnt = {}
    for v in vs:
        cnt['0x%04x' % int(v) if isinstance(v, (int, float)) else str(v)] = cnt.get('0x%04x' % int(v) if isinstance(v, (int, float)) else str(v), 0) + 1
    return cnt


# ---- labelled events -------------------------------------------------------------------------------------------------------------
def tracks_in(s, t0, t1, empty_status):
    """Light objects inside [t0, t1], per (slot, id): cls, status values, first / last members and slopes per second."""
    out = []
    for tag in OBJ_TAGS:
        f = s.f(tag)
        if not f:
            continue
        slot = int(tag[6:])
        i0, i1 = bisect.bisect_left(f.t, t0), bisect.bisect_right(f.t, t1)
        by = {}
        row0, age0 = f.at(t0)
        pts = ([(t0, row0)] if row0 is not None and age0 is not None and age0 < 1500 else []) + list(zip(f.t[i0:i1], f.rows[i0:i1]))
        for t, row in pts:
            o = obj_of(row, slot)
            if not present(o, empty_status):
                continue
            by.setdefault((o['id'], o['cls']), []).append((t, o))
        for (oid, cls), xs in by.items():
            tt = [(t - t0) / 1000.0 for t, _ in xs]
            dist = [o['dist'] for _, o in xs]
            xx = [o['x'] for _, o in xs]
            dslope = linfit(tt, dist)
            steps = [b - a for a, b in zip(dist, dist[1:]) if b != a]
            out.append({'slot': slot, 'id': oid, 'cls': cls, 'status': sorted(set(o['status'] for _, o in xs)), 'lines': len(xs),
                        'seen_s': [r3(tt[0]), r3(tt[-1])], 'dist': [dist[0], dist[-1]], 'dist_slope': r3(dslope),
                        'dist_falls': bool(dslope is not None and dslope < 0 and steps and sum(1 for d in steps if d < 0) / len(steps) >= 0.6),
                        'x': [xx[0], xx[-1]], 'x_slope': r3(linfit(tt, xx)), 'y': [min(o['y'] for _, o in xs), max(o['y'] for _, o in xs)],
                        'w': [xs[0][1]['w'], xs[-1][1]['w']]})
    return out


SIGN_TAGS = ['cam-signs', 'cam-legacy2']
TOWN_IN, TOWN_OUT = ('CITY_LIMIT_START_OF', 'CITY_LIMIT_START_END_OF'), ('CITY_LIMIT_END_OF',)


def town_events(s):
    """The town in / out from the camera's town signs (the owner navigates with CarPlay, so the map's built-up flag is absent): a
    CITY_LIMIT_START_OF (or START_END_OF) sign = in, CITY_LIMIT_END_OF = out, each counted when it first shows after 5 s without it;
    and the recognised limit crossing 50 km/h (TrafficSignRecognition presentClassLimitSpeed x 5) as a weaker cue.
    [{t, kind: 'town_in' | 'town_out' | 'limit_50_or_less' | 'limit_over_50', src}] sorted by t; s.town_cache keeps it."""
    if getattr(s, 'town_cache', None) is not None:
        return s.town_cache
    out = []
    for tag in SIGN_TAGS:
        f = s.f(tag)
        if not f:
            continue
        last = {'in': -1e12, 'out': -1e12}
        for t, row in zip(f.t, f.rows):
            types = set(v for k, v in row.items() if k.endswith('.type') and isinstance(v, str))
            for kind, names in (('in', TOWN_IN), ('out', TOWN_OUT)):
                if types & set(names):
                    if t - last[kind] > 5000:
                        out.append({'t': t, 'kind': 'town_' + kind, 'src': tag})
                    last[kind] = t
    f = s.f('tsr')
    if f:
        ts, vs = f.col('presentClassLimitSpeed')
        prev = None
        for t, v in zip(ts, vs):
            if not isinstance(v, (int, float)) or not 0 < v * 5 <= 300:
                continue
            town = v * 5 <= 50
            if prev is not None and town != prev:
                out.append({'t': t, 'kind': 'limit_50_or_less' if town else 'limit_over_50', 'src': 'tsr'})
            prev = town
    out.sort(key=lambda e: e['t'])
    s.town_cache = out
    return out


def urban_at(s, t):
    """The map's built-up flag if it came (BMW navigation), else the town signs: in after a town_in, out after a town_out, None before."""
    f = s.f('ccp-builtup')
    if f:
        row, age = f.at(t)
        if row is not None and row.get('isBuiltupArea') is not None:
            return bool(row.get('isBuiltupArea'))
    st = None
    for e in town_events(s):
        if e['t'] > t:
            break
        if e['kind'] == 'town_in':
            st = True
        elif e['kind'] == 'town_out':
            st = False
    return st


def context_at(s, t):
    """Speed, brightness, wipers, the limit, the built-up flag, the vehicle ahead and the fallback objects at t (raw)."""
    def get(tag, col, max_age=5000):
        f = s.f(tag)
        if not f:
            return None
        row, age = f.at(t)
        if row is None or age > max_age:
            return None
        return row.get(col)
    lim = get('tsr', 'presentClassLimitSpeed')
    fv_q = get('front-vehicle', 'qualifierEventDataFunctionFrontVehicle', 2000)
    fv_gap = get('front-vehicle', 'frontVehicleGapX', 2000)
    cam = fallback_objects(s, t)
    lamps_ahead = get('gap-ahead', 'lampStatusVehicleDrivingAhead', 2000)
    return {'speed_kmh': r3(speed_at(s, t)), 'brightness': get('hb-brightness', 'valueBrightnessEnvironment'), 'prefield': get('hb-prefield', 'valueBrightnessPrefield'),
            'ambient_lowbeam': get('hb-low-beam', 'ambientBrightnessLowBeam'), 'rain': get('hb-rain', 'intensityRain'), 'wiper_speed': get('hb-rain', 'speedWiper'),
            'wiper_blade': get('hb-wiper', 'positionWiperBlade'), 'limit_kmh': lim * 5 if isinstance(lim, (int, float)) and 0 < lim * 5 <= 300 else None,
            'urban': urban_at(s, t),
            'following': bool(fv_q == 'EVENT_DATA_AVAILABLE' and isinstance(fv_gap, (int, float)) and fv_gap > 0) if fv_q is not None else None,
            'ahead_lamps': lamps_ahead,
            'fallback': [{k: o.get(k) for k in ('src', 'cls', 'mov', 'lane', 'x', 'vx_abs', 'head', 'rear') if o.get(k) is not None} for o in (cam or [])]}


def fallback_objects(s, t):
    """The camera's object lists at t, the PRIMARY fallback when the light objects are silent (HR-REPORT 3.2): first the object list
    with each object's lamp state (hb-objlist: head / rear / brake lamp, absolute speed), then the general lists (statusMovement says
    ONCOMMING / SAME_AS_EGOVEHICLE). [{src, id, cls, mov, lane, x, y, vx_abs, head, rear, brake}] or None when no list is fresh."""
    out, fresh = [], False
    fl = s.f('hb-objlist')
    if fl:
        row, age = fl.at(t)
        if row is not None and age <= 1000:
            fresh = True
            n = int(row.get('objectListSmall.n') or 0)
            for i in range(min(n, 16)):
                k = 'objectListSmall.%d.' % i
                if k + 'summary.id' not in row:
                    break
                cls = [(row.get(k + 'classification.' + c), c[6:]) for c in ('class_car', 'class_truck', 'class_motorcycle', 'class_bicycle', 'class_pedestrian', 'class_animal', 'class_unknown')]
                cls = [c for c in cls if isinstance(c[0], (int, float))]
                out.append({'src': 'objlist', 'id': row.get(k + 'summary.id'), 'cls': max(cls)[1] if cls else None, 'mov': row.get(k + 'summary.status_movement'),
                            'x': row.get(k + 'position.x.value'), 'y': row.get(k + 'position.y.value'), 'vx_abs': row.get(k + 'dynamics.velocity_absolute.x.value'),
                            'head': row.get(k + 'lights.status_head_light'), 'rear': row.get(k + 'lights.status_rear_light'), 'brake': row.get(k + 'lights.status_brake_light')})
    for pre in ('cam', 'cam2'):
        fo, fp = s.f(pre + '-objects'), s.f(pre + '-position')
        if not fo:
            continue
        row, age = fo.at(t)
        if row is None or age > 1000:
            continue
        fresh = True
        prow, page = fp.at(t) if fp else (None, None)
        n = int(row.get('objectRecognitionInfo.n') or 0)
        for i in range(min(n, 16)):
            k = 'objectRecognitionInfo.%d.' % i
            if k + 'objectID' not in row:
                break
            o = {'src': pre, 'id': row.get(k + 'objectID'), 'cls': row.get(k + 'classificationType'), 'mov': row.get(k + 'statusMovement'), 'lane': row.get(k + 'drivingTubeMapping')}
            if prow is not None and page is not None and page <= 1000:
                o['x'] = prow.get('objectPositionInfo.%d.positionX' % i)
                o['y'] = prow.get('objectPositionInfo.%d.positionY' % i)
            out.append(o)
    return out if fresh else None


def oncoming_obj(o):
    v = o.get('vx_abs')
    return 'ONCOMMING' in str(o.get('mov')) or (str(o.get('head')).endswith('_ON') and isinstance(v, (int, float)) and v < 0)


def ahead_obj(o):
    v = o.get('vx_abs')
    return ('SAME_AS_EGO' in str(o.get('mov')) and 'EGO_LANE' in str(o.get('lane'))) or (str(o.get('rear')).endswith('_ON') and isinstance(v, (int, float)) and v > 0)


def verdict_window(s, t0, t1):
    f = s.f('hb-control')
    if not f:
        return None
    ts, vs = f.col('controlHighBeam')
    _, rs = f.col('reasonSwitchOffHighBeam')
    i0, i1 = max(0, bisect.bisect_right(ts, t0) - 1), bisect.bisect_right(ts, t1)
    vals = vs[i0:i1]
    ch = [(r3((ts[i] - t1) / 1000.0), vs[i - 1], vs[i]) for i in range(max(1, i0), i1) if vs[i] != vs[i - 1]]
    return {'values': sorted(set(vals), key=str), 'reasons': sorted(set('0x%04x' % int(x) for x in rs[i0:i1] if isinstance(x, (int, float)))),
            'changes': [{'at_s': a, 'from': b, 'to': c} for a, b, c in ch]}


def label_kind(ev, ctx, tracks):
    if ev['kind'] == 'high_on':
        return 'clear'                    # the driver judged the road clear
    if ctx['urban'] or (ctx['limit_kmh'] is not None and ctx['limit_kmh'] <= 60):
        return 'town'
    fb = ctx.get('fallback') or []
    if any(oncoming_obj(o) for o in fb):
        return 'oncoming'
    if ctx.get('following') or ctx.get('ahead_lamps') == 'LICHT_AN' or any(ahead_obj(o) for o in fb):
        return 'preceding'
    if tracks:
        return 'light'
    return 'settle'


def labelled_events(s, events, before_ms, after_ms, empty_status):
    out = []
    for e in events:
        if e['parked'] or e['kind'] not in ('high_off', 'high_on'):
            continue
        t = e['t']
        tr = tracks_in(s, t - before_ms, t + after_ms, empty_status)
        for x in tr:
            x['seen_s'] = [r3(x['seen_s'][0] - before_ms / 1000.0), r3(x['seen_s'][1] - before_ms / 1000.0)]      # relative to the switch
        ctx = context_at(s, t)
        vw = verdict_window(s, t - before_ms, t + after_ms)
        if vw:
            for c in vw['changes']:
                c['at_s'] = r3(c['at_s'] + after_ms / 1000.0)          # relative to the driver's switch
        out.append({'n': len(out) + 1, 't_s': r3(t / 1000.0), 'driver': e['kind'], 'kind': label_kind(e, ctx, tr), 'objects': tr, 'verdict': vw, 'context': ctx})
    return out


def kept_high_stretches(s, periods, flash_max_ms, empty_status, min_ms=3000):
    """Stretches of 3 s or more with light objects present while the driver kept the high beam on."""
    tags = [t for t in OBJ_TAGS if s.f(t)]
    if not tags:
        return []
    out, cur = [], None
    for t in range(0, int(s.span()) + 1, GRID):
        objs = []
        if high_at(periods, t, flash_max_ms):
            for tag in tags:
                row, age = s.f(tag).at(t)
                o = obj_of(row, int(tag[6:])) if row is not None and age is not None and age < 1500 else None
                if present(o, empty_status):
                    objs.append(o)
        if objs:
            if cur is None or t - cur['t1'] > 1000:
                if cur is not None:
                    out.append(cur)
                cur = {'t0': t, 't1': t, 'classes': {}, 'max_at_once': 0, 'ids': set(), 'y': [None, None]}
            cur['t1'] = t
            cur['max_at_once'] = max(cur['max_at_once'], len(objs))
            for o in objs:
                cur['classes'][o['cls']] = cur['classes'].get(o['cls'], 0) + 1
                cur['ids'].add(o['id'])
                cur['y'] = [o['y'] if cur['y'][0] is None else min(cur['y'][0], o['y']), o['y'] if cur['y'][1] is None else max(cur['y'][1], o['y'])]
    if cur is not None:
        out.append(cur)
    res = []
    offs = [b for a, b in periods if b is not None]
    for c in out:
        if c['t1'] - c['t0'] + GRID < min_ms:
            continue
        if any(c['t1'] - GRID <= b <= c['t1'] + 1000 for b in offs):
            continue                      # it ended with the driver's dip: the lead-up of a labelled event, not "kept"
        ctx = context_at(s, (c['t0'] + c['t1']) // 2)
        res.append({'t0_s': r3(c['t0'] / 1000.0), 't1_s': r3((c['t1'] + GRID) / 1000.0), 'classes': {str(k): v for k, v in sorted(c['classes'].items())},
                    'distinct_ids': len(c['ids']), 'max_at_once': c['max_at_once'], 'y': c['y'], 'urban': ctx['urban'], 'limit_kmh': ctx['limit_kmh'],
                    'verdict': verdict_window(s, c['t0'], c['t1'] + GRID)})
    return res


# ---- decode helpers --------------------------------------------------------------------------------------------------------------
def decode_helpers(s, labelled, events, holds, periods, flash_max_ms, empty_status):
    dips = [e for e in labelled if e['driver'] == 'high_off']
    objs = [o for e in dips for o in e['objects']]
    falling = [o for o in objs if o['dist_falls']]
    # the centre: where the far objects are (the median x of the objects in the top quarter of Distance)
    far = []
    for tag in OBJ_TAGS:
        f = s.f(tag)
        if f:
            slot = int(tag[6:])
            for row in f.rows:
                o = obj_of(row, slot)
                if present(o, empty_status):
                    far.append((o['dist'], o['x']))
    far.sort(reverse=True)
    centre = med([x for _, x in far[:max(1, len(far) // 4)]]) if far else None
    out_ = [o for o in objs if centre is not None and abs(o['x'][1] - centre) > abs(o['x'][0] - centre) + 5]
    # classes and following (the vehicle ahead, or the fallback list's same-way object in our lane)
    cls_f, cls_all = {}, {}
    tags = [t for t in OBJ_TAGS if s.f(t)]
    for t in range(0, int(s.span()) + 1, GRID * 5):
        ctx_f = context_at(s, t)
        fol = ctx_f['following'] or ctx_f['ahead_lamps'] == 'LICHT_AN' or any(ahead_obj(o) for o in ctx_f['fallback'])
        for tag in tags:
            row, age = s.f(tag).at(t)
            o = obj_of(row, int(tag[6:])) if row is not None and age is not None and age < 1500 else None
            if not present(o, empty_status):
                continue
            cls_all[o['cls']] = cls_all.get(o['cls'], 0) + 1
            if fol:
                cls_f[o['cls']] = cls_f.get(o['cls'], 0) + 1
    only_following = sorted(k for k, n in cls_all.items() if n >= 10 and cls_f.get(k, 0) / n >= 0.8)
    # the stalk bits that rose within 1.5 s before each change of the high-beam member
    bits = {'high_on': {}, 'high_off': {}}
    for e in events:
        if e['kind'] not in bits:
            continue
        for h in holds:
            if e['t'] - 1500 <= h['t0'] <= e['t']:
                k = '0x%02x' % h['main']
                bits[e['kind']][k] = bits[e['kind']].get(k, 0) + 1
    # HR-REPORT Part E 1: how fast each high-beam member follows the stalk (ms from the press to the member's change)
    latency = {}
    for tag, col in HIGH_SOURCES:
        f = s.f(tag)
        if not f:
            continue
        ts, vs = f.col(col)
        ms, last = [], None
        for t, v in zip(ts, vs):
            b = high_value(v)
            if b is None or b == last:
                continue
            if last is not None:
                pre = [h['t0'] for h in holds if t - 1500 <= h['t0'] <= t]
                if pre:
                    ms.append(t - max(pre))
            last = b
        latency[tag + '.' + col] = {'changes_after_a_press': len(ms), 'median_ms': r3(med(ms)), 'max_ms': max(ms) if ms else None}
    # HR-REPORT Part E 3: the fallback lists at night: the farthest x an oncoming object is first listed at, the lamp states seen
    first_x, lamps = {}, {}
    for t in range(0, int(s.span()) + 1, GRID):
        for o in fallback_objects(s, t) or []:
            key = (o['src'], o.get('id'))
            if oncoming_obj(o) and key not in first_x and isinstance(o.get('x'), (int, float)):
                first_x[key] = o['x']
            for k in ('head', 'rear'):
                if o.get(k) is not None:
                    w = 'oncoming' if oncoming_obj(o) else 'ahead' if ahead_obj(o) else 'other'
                    lamps.setdefault(k + '.' + w, {})
                    lamps[k + '.' + w][o[k]] = lamps[k + '.' + w].get(o[k], 0) + 1
    gap = s.f('gap-ahead')
    gl = {}
    if gap:
        for v in gap.col('lampStatusVehicleDrivingAhead')[1]:
            gl[v] = gl.get(v, 0) + 1
    return {'stalk_to_lamp_latency': latency,
            'fallback_oncoming_first_x': {'objects': len(first_x), 'max': max(first_x.values()) if first_x else None, 'median': r3(med(list(first_x.values())))},
            'fallback_lamp_states': lamps, 'lamp_status_vehicle_ahead': gl,
            'distance_falls_before_dips': {'objects': len(objs), 'falling': len(falling), 'share': r3(len(falling) / len(objs)) if objs else None},
            'x_moves_outward_around_dips': {'objects': len(objs), 'outward': len(out_), 'centre_x': centre},
            'classes_only_while_following': only_following,
            'class_share_while_following': {str(k): r3(cls_f.get(k, 0) / n) for k, n in sorted(cls_all.items())},
            'stalk_bits_before_lamp_changes': bits}


# ---- the scenario files (docs/highbeam/CONTRACT.md section 5) -----------------------------------------------------------------------
def group(v, age, ok=True, qual=None):
    g = {'v': v, 'age': None if age is None else int(round(age)), 'ok': ok}
    if qual is not None:
        g['qual'] = qual
    return g


SIGHT_M = {'SIGHT_0': 0, 'SIGHT_1_TO_50': 1, 'SIGHT_50_TO_100': 50, 'SIGHT_100_TO_150': 100, 'SIGHT_150_TO_300': 150, 'SIGHT_GREATER_THAN_300': 300}
MOVE = [('STOPPED_OBJECT_MOVEMENT_DIRECTION_WAS_ONCOMING', 'stopped_oncoming'), ('ONCOMMING', 'oncoming'), ('ONCOMING', 'oncoming'), ('SAME_AS_EGO', 'same'),
        ('STATIONARY', 'stationary'), ('CROSSING', 'crossing')]


def contract_object(o):
    """One fallback object in CONTRACT.md 2.3's words: { id, cls, x, y, lane, move, head, rear, vabs } (raw where the contract says
    raw; vx, a RELATIVE speed, is not given: the lists carry an absolute one, vabs). src (the list it came from) is an added key."""
    out = {k: o.get(k) for k in ('id', 'cls', 'x', 'y', 'lane', 'src') if o.get(k) is not None}
    m = str(o.get('mov') or '')
    move = next((w for k, w in MOVE if k in m), None)
    if move is None and m.startswith('KMOVEMENTSTATUS_'):
        move = 'stationary' if m.endswith('STATIONARY') else None
    if move is not None:
        out['move'] = move
    for k in ('head', 'rear'):
        v = str(o.get(k) or '')
        if v.endswith('_ON'):
            out[k] = 'on'
        elif v.endswith('_OFF'):
            out[k] = 'off'
    if isinstance(o.get('vx_abs'), (int, float)):
        out['vabs'] = o['vx_abs']
    return out


def frame_at(s, t, prev_t, high_src, periods, events, flash_max_ms, empty_status):
    """One input frame of the contract (section 2) at t: raw values, each group { v, age, ok }; a source never heard is no group."""
    fr = {'t': int(t)}
    tags = [x for x in OBJ_TAGS if s.f(x)]
    if tags:
        lights, ages = [], []
        for tag in tags:
            row, age = s.f(tag).at(t)
            if row is None:
                continue
            o = obj_of(row, int(tag[6:]))
            if o is None:
                continue
            ages.append(age)
            if o['status'] == OBJ_DEFAULT['Status'] or is_default(o) or o['status'] in empty_status:
                continue
            o['age'] = int(round(age))
            lights.append(o)
        if ages:
            fr['lights'] = group(lights, min(ages))
    f = s.f('hb-control')
    if f:
        row, age = f.at(t)
        if row is not None:
            fr['verdict'] = group({'allow': row.get('controlHighBeam'), 'reason': row.get('reasonSwitchOffHighBeam'), 'vehicles': row.get('numberVehicles'),
                                   'signs': row.get('numberRoadSigns'), 'pedestrians': row.get('numberPedestrians'), 'calibration': row.get('statusCameraCalibration'),
                                   'qualifier': row.get('qualifierDataControlHighBeamAssistant'), 'qualifierExt': row.get('qualifierExtendedControlHighBeamAsstistant')}, age)
    ages, qual = [], None
    for tag in ('hb-objlist', 'cam-objects', 'cam2-objects'):
        fo = s.f(tag)
        if not fo:
            continue
        row, age = fo.at(t)
        if row is None:
            continue
        ages.append(age)
        if qual is None:
            qual = row.get('eventDataQualifier')
    if ages:
        # the contract's { id, cls, x, y, vx, lane } raw; vx is RELATIVE in the contract and the lists give an absolute speed, so it is
        # handed over as vx_abs (an added key), with the lamp states head / rear and the list it came from (src)
        objs = fallback_objects(s, t) or []
        fr['objects'] = group([contract_object(o) for o in objs], min(ages), qual=qual)
    car, ages = {}, []
    for tag, key, fn in (('car-speed2', 'speed_kmh', lambda r: r.get('speedVehicleCentreOfGravity') / 64.0 if r.get('speedVehicleCentreOfGravity') is not None else None),
                         ('gearbox-status', 'gear', lambda r: r.get('statusActualStageDrive') if r.get('statusActualStageDrive') in ('P', 'R', 'N', 'D') else None),
                         ('yaw-rate', 'yaw_raw', lambda r: r.get('yawRate.yawRate')),
                         ('steering', 'steer_raw', lambda r: r.get('actualValueSteeringAngleDriver'))):
        ff = s.f(tag)
        if not ff:
            continue
        row, age = ff.at(t)
        if row is None:
            continue
        car[key] = fn(row)
        if tag == 'car-speed2':
            ages.append(age)
    if car:
        car.setdefault('yaw_dps', None)                 # the yaw rate's and the steering angle's units are not known yet: raw beside
        car.setdefault('steer_deg', None)
        fr['car'] = group(car, min(ages) if ages else None)
    lamps, ages = {}, []
    lb = s.f('hb-low-beam')
    if lb:
        row, age = lb.at(t)
        if row is not None:
            lamps['low'] = {'FAHRLICHT_EINSCHALTEN': True, 'FAHRLICHT_AUSSCHALTEN': False}.get(row.get('statusLowBeam'))
            ages.append(age)
    li = s.f('lights')
    if li:
        row, age = li.at(t)
        if row is not None:
            if lamps.get('low') is None:
                lamps['low'] = {'EIN': True, 'AUS': False}.get(row.get('statusDippedBeam'))
            fog = [row.get('statusFrontFogLight'), row.get('statusRearFogLight')]
            lamps['fog'] = True if 'EIN' in fog else False if fog == ['AUS', 'AUS'] else None
            ages.append(age)
    for tag in ('hb-fog-front', 'hb-fog-rear'):
        ff = s.f(tag)
        if ff:
            row, age = ff.at(t)
            if row is not None and row.get('value') in (0, 1):
                lamps['fog'] = bool(lamps.get('fog')) or row.get('value') == 1
    sw = s.f('hb-lightswitch')
    if sw:
        row, age = sw.at(t)
        if row is not None:
            lamps['switch'] = SWITCH.get(row.get('value'))
    if high_src is not None:
        lamps['high'] = high_at(periods, t, flash_max_ms)
        tag = high_src.split('.')[0]
        if s.f(tag):
            row, age = s.f(tag).at(t)
            if age is not None:
                ages.append(age)
    elif lamps:
        lamps['high'] = None
    if lamps:
        fr['lamps'] = group(lamps, min(ages) if ages else None)
    if events is not None:
        evs = [{'t': int(e['t']), 'kind': e['kind']} for e in events if prev_t < e['t'] <= t]
        fr['stalk'] = group(evs, 0)
    env, ages = {}, []
    for tag, key, fn, max_age in (('hb-brightness', 'brightness', lambda r: r.get('valueBrightnessEnvironment'), None),
                                  ('tsr', 'limit_kmh', lambda r: r.get('presentClassLimitSpeed') * 5 if isinstance(r.get('presentClassLimitSpeed'), (int, float)) and 0 < r.get('presentClassLimitSpeed') * 5 <= 300 else None, None),
                                  ('hb-rain', 'rain_raw', lambda r: r.get('intensityRain'), None),
                                  ('hb-rain', 'wiper_raw', lambda r: r.get('speedWiper'), None)):
        ff = s.f(tag)
        if not ff:
            continue
        row, age = ff.at(t)
        if row is None:
            continue
        env[key] = fn(row)
        ages.append(age)
    if s.f('ccp-builtup') or town_events(s):
        env['urban'] = urban_at(s, t)
    # CONTRACT.md 2.4 additions of 2026-11-20: the car's day / night, the camera's weather and range of sight
    for tag, key, fn in (('hb-daynight', 'dayNight', lambda r: {'TAG': 'day', 'NACHT': 'night'}.get(r.get('dayNightChangeOver'))),
                         ('hb-weather', 'camWeather', lambda r: r.get('statusWeatherCamera') if r.get('statusWeatherCamera') in ('CLEAR', 'RAIN', 'SNOW', 'FOG', 'GLARE') else None),
                         ('hb-weather', 'sight_m', lambda r: SIGHT_M.get(r.get('rangeOfSightCamera')))):
        ff = s.f(tag)
        if not ff:
            continue
        row, age = ff.at(t)
        if row is not None:
            env[key] = fn(row)
            ages.append(age)
    # CONTRACT.md 2.5: the town signs passed since the previous frame
    if any(s.f(x) for x in SIGN_TAGS):
        fr['signs'] = group([{'t': int(e['t']), 'kind': e['kind']} for e in town_events(s) if e['kind'] in ('town_in', 'town_out') and prev_t < e['t'] <= t], 0)
    if env:
        env.setdefault('sun', None)
        env.setdefault('wiper', None)                  # the wiper's level mapping is not known yet: raw beside
        fr['env'] = group(env, min(ages) if ages else None)
    return fr


def write_scenario(path, sc, frames_inline=True):
    """THE writer of the contract's scenario file (section 5): one function, so a change of the format is made here only."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    doc = dict(sc)
    frames = doc.pop('frames')
    if frames_inline:
        doc['frames'] = frames
    else:
        jl = os.path.splitext(os.path.basename(path))[0] + '.jsonl'
        doc['framesFile'] = jl
        with open(os.path.join(os.path.dirname(path), jl), 'w') as fh:
            for fr in frames:
                fh.write(json.dumps(fr, separators=(',', ':')) + '\n')
    with open(path, 'w') as fh:
        json.dump(doc, fh, separators=(',', ':'))
    return path


def scenarios(s, out, res, flash_max_ms, empty_status, before_ms, after_ms):
    sid = s.id
    date = '%s-%s-%s' % (sid[0:4], sid[4:6], sid[6:8])
    events = res['timeline']
    periods = [(p[0], p[1]) for p in res['_periods']]
    high_src = res['high_source']
    end = int(s.span())
    files = []

    def frames(t0, t1):
        out_, prev = [], t0 - GRID
        for t in range(int(t0), int(t1) + 1, GRID):
            fr = frame_at(s, t, prev, high_src, periods, events, flash_max_ms, empty_status)
            fr['t'] = int(t - t0)
            for e in (fr.get('stalk') or {}).get('v') or []:
                e['t'] = int(e['t'] - t0)
            out_.append(fr)
            prev = t
        return out_

    driver = [{'t': int(e['t']), 'kind': e['kind']} for e in events]
    labels = [{'t0': max(0, int(e['t_s'] * 1000 - before_ms)), 't1': int(e['t_s'] * 1000 + after_ms), 'kind': e['kind'], 'note': 'driver_' + e['driver']} for e in res['labelled']]
    labels += [{'t0': int(k['t0_s'] * 1000), 't1': int(k['t1_s'] * 1000), 'kind': 'light', 'note': 'high_kept_with_objects'} for k in res['kept_high']]
    base = {'format': 'beam-scenario', 'version': 1, 'family': 'R', 'source': 'recorded'}
    full = dict(base, id='R.%s' % sid, name='Recorded drive %s' % sid, purpose='the whole recording, raw, for replay against the driver',
                meta={'created': date, 'tool': 'hb_analyse ' + VERSION, 'notes': '', 'session': sid, 'offset_ms': 0},
                duration_s=r3(end / 1000.0), frames=frames(0, end), driver=driver, labels=sorted(labels, key=lambda x: x['t0']))
    files.append(write_scenario(os.path.join(out, full['id'] + '.json'), full, frames_inline=False))
    for e in res['labelled']:
        t = int(e['t_s'] * 1000)
        t0, t1 = max(0, t - before_ms), min(end, t + after_ms)
        sc = dict(base, id='R.%s.e%02d.%s' % (sid, e['n'], e['kind']), name='Driver %s at %.1f s' % (e['driver'], e['t_s']),
                  purpose='a labelled event: the %d s before and %d s after the driver switched' % (before_ms // 1000, after_ms // 1000),
                  meta={'created': date, 'tool': 'hb_analyse ' + VERSION, 'notes': '', 'session': sid, 'offset_ms': t0},
                  duration_s=r3((t1 - t0) / 1000.0), frames=frames(t0, t1),
                  driver=[{'t': int(x['t'] - t0), 'kind': x['kind']} for x in events if t0 <= x['t'] <= t1],
                  labels=[{'t0': int(t - t0 - before_ms) if t - before_ms >= t0 else 0, 't1': int(t1 - t0), 'kind': e['kind'], 'note': 'driver_' + e['driver']}])
        files.append(write_scenario(os.path.join(out, sc['id'] + '.json'), sc))
    return [os.path.basename(p) for p in files]


def diag_report(s, parked):
    """The HB diagnostic reads (beam_diag.js, read only, while standing): per unit and identifier the replies, the refusals by NRC,
    the distinct payloads; and in the parked check, the payloads of the stalk contacts (BDC E3B8) and the lamp functions (BDC D542)
    during each hold: the ground truth for the stalk bits."""
    out = {}
    for tag in sorted(t for t in s.fields if t.startswith('diag-')):
        f = s.fields[tag]
        ok_rows = [r for r in f.rows if r.get('ok') == 1]
        nrc = {}
        for r in f.rows:
            if r.get('ok') == 0:
                k = '0x%02x' % int(r.get('nrc') or 0)
                nrc[k] = nrc.get(k, 0) + 1
        pay = {}
        for r in ok_rows:
            k = payload(r)
            pay[k] = pay.get(k, 0) + 1
        out[tag] = {'replies': len(ok_rows), 'refusals': nrc, 'payloads': pay}
    rows = []
    if parked:
        for row in parked['rows']:
            t0 = row['t_s'] * 1000
            t1 = t0 + row['held_s'] * 1000
            e = {'step': row['step'], 'bits': row['bits']}
            for tag in ('diag-bdc-e3b8', 'diag-bdc-d542'):
                f = s.f(tag)
                if f:
                    e[tag] = sorted(set(payload(r) for t, r in zip(f.t, f.rows) if t0 <= t <= t1 + 1000 and r.get('ok') == 1))
            rows.append(e)
    return {'reads': out, 'parked': rows}


def payload(r):
    n = int(r.get('n') or 0)
    return ' '.join('%02X' % int(r.get('b%02d' % i, 0)) for i in range(min(n, 64)))


# ---- one recording ---------------------------------------------------------------------------------------------------------------
def analyse(s, a, tags):
    empty = set(a.empty_status or [])
    fl = int(a.flash_max * 1000)
    span = s.span()
    present_tags = sorted(s.fields)
    fields = [field_report(s.fields[t], span) for t in present_tags]
    silent = [t for t in tags if t not in s.fields]
    holds = stalk_holds(s)
    parked = parked_check(s, holds)
    high_src, events, periods, holds = timeline(s, fl, parked)
    labelled = labelled_events(s, events, int(a.before * 1000), int(a.after * 1000), empty)
    kept = kept_high_stretches(s, periods, fl, empty)
    groups = {
        'lights': camera_state(s, OBJ_TAGS),
        'verdict': camera_state(s, ['hb-control']),
        'object_ids': camera_state(s, ['hb-meid1', 'hb-meid2']),
        'lamps_high_member': high_src or 'none',
        'stalk': 'present' if (s.f('stalk') or s.f('stalk-complete')) else 'silent',
        'fallback_objlist_lamps': 'present' if s.f('hb-objlist') else 'silent',
        'fallback_objects': 'present' if (s.f('cam-objects') or s.f('cam2-objects')) else 'silent',
        'vehicle_ahead_lamps': 'present' if s.f('gap-ahead') else 'silent',
        'brightness': 'present' if s.f('hb-brightness') else 'silent',
        'wipers': 'present' if (s.f('hb-rain') or s.f('hb-wiper')) else 'silent',
    }
    res = {'session': s.id, 'files': s.files, 'cut_files': s.cut, 'complete': s.end is not None, 'end': s.end, 'span_s': r3(span / 1000.0), 'bad_lines': s.bad,
           'sets': (s.header or {}).get('sets'), 'marks': [{'t_s': r3(m[0] / 1000.0), 'n': m[1]} for m in s.marks], 'groups': groups,
           'fields': fields, 'silent_fields': silent, 'objects': objects_report(s, empty), 'parked_check': parked,
           'high_source': high_src, 'high_sources_seen': [t + '.' + c for t, c in HIGH_SOURCES if s.f(t)],
           'timeline': events, '_periods': [[p[0], p[1]] for p in periods],
           'counts': {k: sum(1 for e in events if e['kind'] == k and not e['parked']) for k in ('high_on', 'high_off', 'flash')},
           'labelled': labelled, 'kept_high': kept,
           'town': [{'t_s': r3(e['t'] / 1000.0), 'kind': e['kind'], 'src': e['src']} for e in town_events(s)], 'diag': diag_report(s, parked)}
    res['verdict'] = verdict_report(s, periods, events, fl, parked)
    res['decode'] = decode_helpers(s, labelled, events, holds, periods, fl, empty)
    res['stalk_holds'] = [{'t_s': r3(h['t0'] / 1000.0), 'held_s': r3((h['t1'] - h['t0']) / 1000.0), 'bits': '0x%02x' % h['main']} for h in holds]
    return res


# ---- writing -------------------------------------------------------------------------------------------------------------------
def fmt(x):
    if x is None:
        return '-'
    if isinstance(x, float):
        return ('%.3f' % x).rstrip('0').rstrip('.')
    return str(x)


def report_md(results):
    L = ['# HB drive report (hb_analyse %s)' % VERSION, '',
         'Raw values only: the units and encodings of the camera\'s light objects and verdict are unknown; every "allow" value or class '
         'meaning below is a hypothesis drawn from the driver\'s own switching. Times are seconds since the recording started.', '']
    for r in results:
        L += ['## Recording %s' % r['session'], '',
              '%s, %.1f s, %d file(s)%s%s.' % ('complete' if r['complete'] else '**no #end: stopped by the app or the head unit**', r['span_s'] or 0, len(r['files']),
                                               (', cut: ' + ' '.join(r['cut_files'])) if r['cut_files'] else '', ', %d bad line(s)' % r['bad_lines'] if r['bad_lines'] else ''), '']
        L += ['### What the car sent', '', '| Group | Status |', '|---|---|'] + ['| %s | %s |' % (k, v) for k, v in r['groups'].items()] + ['']
        L += ['| Field | Source | Lines | Folded | Rate Hz | Median ms | Gaps | Longest gap s |', '|---|---|---|---|---|---|---|---|']
        for f in r['fields']:
            L.append('| %s | %s | %d | %d | %s | %s | %d | %s |' % (f['tag'], f['source'], f['lines'], f['folded'], fmt(f['rate_hz']), fmt(f['median_interval_ms']), f['gaps'], fmt(f['longest_gap_s'])))
        L += ['', 'Silent (declared by HB, never heard): ' + (', '.join(r['silent_fields']) or 'none') + '.', '']
        L += ['Enum names seen:', '']
        for f in r['fields']:
            for c, v in f['ranges'].items():
                if 'enum' in v:
                    L.append('- %s.%s: %s' % (f['tag'], c, ', '.join('%s (%d)' % kv for kv in sorted(v['enum'].items()))))
        L.append('')
        o = r['objects']
        L += ['### The light objects', '']
        if not o['present']:
            L += ['**Silent**: no light object event in this recording (the camera does not send them, or not on this drive).', '']
        elif r['groups']['lights'] == 'defaults only':
            L += ['**Defaults only**: the light object events arrive, every output at its catalogue default (an empty frame).', '']
        else:
            L += ['Slots heard: %d. At once: at most %s, typically %s when any; some object %s of the time.' % (o['slots_heard'], o['max_at_once'], fmt(o['typical_when_any']), fmt(o['share_of_time_with_any'])),
                  'Samples per class: %s. Tracks per class: %s. Status values seen (all slots): %s.' % (json.dumps(o['samples_per_class']), json.dumps(o['tracks_per_class']), json.dumps(o['status_values_seen'])),
                  'Member ranges (present objects): ' + ', '.join('%s %s..%s' % (k, fmt(v[0]), fmt(v[1])) for k, v in o['ranges'].items()) + '.', '']
        L += ['### The parked check (stalk bits)', '']
        pc = r['parked_check']
        if not pc:
            L += ['Not found (seven holds of 2 s or more, 1-20 s apart, standing). Stalk holds seen: ' + (', '.join('%s %s s at %s' % (h['bits'], h['held_s'], h['t_s']) for h in r['stalk_holds'][:20]) or 'none') + '.', '']
        else:
            L += ['Found at %s s%s.' % (pc['t0_s'], ' (%s s after a mark)' % pc['after_mark_s'] if pc['after_mark_s'] is not None else ''), '',
                  '| # | Movement | Bit | Held s | Lamp members that changed |', '|---|---|---|---|---|']
            for i, row in enumerate(pc['rows']):
                L.append('| %d | %s | %s | %s | %s |' % (i + 1, row['label'], row['bits'], row['held_s'], '; '.join('%s %s' % (c['member'], '->'.join(str(x) for x in c['path'])) for c in row['changes']) or '-'))
            L += ['', 'Push = %s, pull = %s, flash = %s. Members that follow the high beam: %s.' % (pc['push'], pc['pull'], pc['flash'], ', '.join(pc['highMembers']) or 'none found'), '']
        dg = r['diag']
        L += ['### The diagnostic reads (read only, standing)', '']
        if not dg['reads']:
            L += ['None in this recording (the checkbox was off, or the car was moving).', '']
        else:
            L += ['| Read | Replies | Refusals (NRC) | Payloads (data bytes after 62 <id>) |', '|---|---|---|---|']
            for k, x in dg['reads'].items():
                L.append('| %s | %d | %s | %s |' % (k, x['replies'], json.dumps(x['refusals'], sort_keys=True), '; '.join('%s (%d)' % kv for kv in sorted(x['payloads'].items())[:12])))
            if dg['parked']:
                L += ['', 'During the parked check (the stalk contacts by name are the ground truth for the bits):', '', '| Step | Bit | BDC E3B8 stalk contacts | BDC D542 lamp functions |', '|---|---|---|---|']
                for e in dg['parked']:
                    L.append('| %s | %s | %s | %s |' % (e['step'], e['bits'], ' / '.join(e.get('diag-bdc-e3b8', [])) or '-', ' / '.join(e.get('diag-bdc-d542', [])) or '-'))
            L.append('')
        L += ['### The driver', '', 'High-beam state from: %s (members present: %s).' % (r['high_source'] or 'nothing', ', '.join(r['high_sources_seen']) or 'none'),
              'On the road: %d switch(es) to high, %d dip(s), %d flash(es).' % (r['counts']['high_on'], r['counts']['high_off'], r['counts']['flash']), '']
        marks = [(e['t'], e['kind'], 'yes' if e['parked'] else '') for e in r['timeline']] + [(x['t_s'] * 1000, x['kind'] + ' (' + x['src'] + ')', '') for x in r['town']]
        L += ['The town in / out comes from the camera\'s town signs (CITY_LIMIT_*) and the recognised limit crossing 50 km/h.', '',
              '| t s | Action / town | Parked check |', '|---|---|---|'] + ['| %s | %s | %s |' % (fmt(t / 1000.0), k, pk) for t, k, pk in sorted(marks, key=lambda m: m[0])] + ['']
        v = r['verdict']
        L += ['### The camera\'s verdict against the driver', '']
        if not v['present']:
            L += ['**Silent**: no controlHighBeamAssistant event (not an error: the camera does not send it on this car, or not on this drive).', '']
        elif v['status'] == 'defaults only':
            L += ['**Defaults only**: %d event(s), every output at its catalogue default (controlHighBeam 3, counts 15, reason 0xffff): the gateway '
                  'publishes the frame, the camera does not fill it.' % v['events'], '']
        else:
            L += ['Values (share of the compared time; share of it with the driver\'s high beam on): ' + ', '.join('%s: %s / %s' % (k, fmt(x['share']), fmt(x['share_with_driver_high'])) for k, x in v.get('values', {}).items()) + '.']
            if 'agreement' in v:
                L += ['The value that goes with the high beam (hypothesis): **%s**. Agreement with the driver: **%s** over %s s.' % (v['allow_value_guess'], fmt(v['agreement']), fmt(v['compared_s'])),
                      'Lead (+ = the camera earlier) per driver switch, median: to high %s s, to low %s s; unmatched within 10 s: %d / %d. Best shift of the whole series: %s s.' % (
                          fmt(v['lead_s']['high_on']['median']), fmt(v['lead_s']['high_off']['median']), v['lead_s']['high_on']['unmatched'], v['lead_s']['high_off']['unmatched'], fmt(v['best_shift_s'])),
                      'Reason codes seen: ' + ', '.join('%s (%d)' % kv for kv in sorted(v['reasons'].items())) + '.']
            L.append('')
        d = r['decode']
        L += ['### Decode helpers', '',
              '- Stalk to lamp (ms, median / max): ' + '; '.join('%s %s / %s over %d change(s)' % (k, fmt(x['median_ms']), fmt(x['max_ms']), x['changes_after_a_press']) for k, x in d['stalk_to_lamp_latency'].items()) + '.',
              '- The fallback lists: an oncoming object first listed at x %s at most (median %s, %d object(s)); lamp states %s; the vehicle ahead\'s lamps %s.' % (
                  fmt(d['fallback_oncoming_first_x']['max']), fmt(d['fallback_oncoming_first_x']['median']), d['fallback_oncoming_first_x']['objects'],
                  json.dumps(d['fallback_lamp_states'], sort_keys=True), json.dumps(d['lamp_status_vehicle_ahead'], sort_keys=True)),
              '- Distance falls before a dip: %s of %s object(s) seen around the dips.' % (d['distance_falls_before_dips']['falling'], d['distance_falls_before_dips']['objects']),
              '- XPosition moves outward (away from the centre %s) around a dip: %s of %s.' % (fmt(d['x_moves_outward_around_dips']['centre_x']), d['x_moves_outward_around_dips']['outward'], d['x_moves_outward_around_dips']['objects']),
              '- Classes seen (almost) only while following a car: %s; share while following per class: %s.' % (d['classes_only_while_following'] or 'none', json.dumps(d['class_share_while_following'])),
              '- Stalk bits that rose within 1.5 s before the lamp went on: %s; went off: %s.' % (json.dumps(d['stalk_bits_before_lamp_changes']['high_on']), json.dumps(d['stalk_bits_before_lamp_changes']['high_off'])), '']
        L += ['### Labelled events', '', '| # | t s | Driver | Kind | Objects (slot id cls: dist first->last, falls, x first->last) | Verdict changes (s from the switch) | Speed | Bright | Limit | Urban |',
              '|---|---|---|---|---|---|---|---|---|---|']
        for e in r['labelled']:
            ob = '; '.join('%d %d %d: %s->%s%s, x %s->%s' % (o['slot'], o['id'], o['cls'], o['dist'][0], o['dist'][1], ' falls' if o['dist_falls'] else '', o['x'][0], o['x'][1]) for o in e['objects']) or '-'
            vc = '; '.join('%s->%s at %s' % (c['from'], c['to'], fmt(c['at_s'])) for c in (e['verdict'] or {}).get('changes', [])) or '-'
            c = e['context']
            L.append('| %d | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (e['n'], fmt(e['t_s']), e['driver'], e['kind'], ob, vc, fmt(c['speed_kmh']), fmt(c['brightness']), fmt(c['limit_kmh']), fmt(c['urban'])))
        L += ['', '### High beam kept with objects present (3 s or more: a street light, a sign, a false object?)', '']
        L += ['| From s | To s | Classes (samples) | Ids | At once | y | Urban | Verdict |', '|---|---|---|---|---|---|---|---|']
        for k in r['kept_high']:
            L.append('| %s | %s | %s | %d | %d | %s..%s | %s | %s |' % (fmt(k['t0_s']), fmt(k['t1_s']), json.dumps(k['classes']), k['distinct_ids'], k['max_at_once'], fmt(k['y'][0]), fmt(k['y'][1]), fmt(k['urban']),
                                                                     ', '.join(str(x) for x in (k['verdict'] or {}).get('values', [])) or '-'))
        L.append('')
    return '\n'.join(L) + '\n'


def summary_md(results):
    states = lambda g: sorted(set(r['groups'][g] for r in results))  # noqa: E731
    uk = {'present': 'так', 'defaults only': 'лише порожні кадри (значення за замовчуванням)', 'silent': 'ні'}
    lights_uk, verdict_uk = ' / '.join(uk[x] for x in states('lights')), ' / '.join(uk[x] for x in states('verdict'))
    en = {'present': 'yes', 'defaults only': 'empty frames only (every output at its default)', 'silent': 'no'}
    lights_en, verdict_en = ' / '.join(en[x] for x in states('lights')), ' / '.join(en[x] for x in states('verdict'))
    pcs = [r['parked_check'] for r in results if r['parked_check']]
    pc = pcs[0] if pcs else None
    hs = sorted(set(r['high_source'] for r in results if r['high_source']))
    ag = [r['verdict'] for r in results if r['verdict'].get('agreement') is not None]
    dips = sum(r['counts']['high_off'] for r in results)
    highs = sum(r['counts']['high_on'] for r in results)
    L = ['# Підсумок поїздки з дальнім світлом / Summary of the high-beam drive', '',
         '## Українською', '',
         '- Записів: %d. Водій увімкнув дальнє %d раз(и), перемкнув на ближнє %d раз(и).' % (len(results), highs, dips),
         '- Камера надсилає об’єкти світла: **%s**. Власне рішення камери щодо дальнього: **%s**.' % (lights_uk, verdict_uk)]
    if ag:
        L.append('- Рішення камери збігалося з водієм %s часу (значення «дозволено» = %s — це припущення з поведінки водія).' % (', '.join('%d %%' % round(100 * v['agreement']) for v in ag), ', '.join(str(v['allow_value_guess']) for v in ag)))
    if pc:
        L.append('- Перевірка на стоянці: від себе = біт %s, на себе = %s, блимання = %s. За дальнім стежать: %s.' % (pc['push'], pc['pull'], pc['flash'], ', '.join(pc['highMembers']) or 'не знайдено'))
    else:
        L.append('- Перевірку на стоянці не знайдено: значення бітів підрульового перемикача ще не підтверджено.')
    L.append('- Стан дальнього взято з: %s.' % (', '.join(hs) or 'нічого (немає ні сигналу ламп, ні перевірки на стоянці)'))
    L += ['- Досі невідомо: одиниці XPosition / YPosition / Distance / кутових швидкостей, значення Class і Status, масштаб яскравості, '
          'значення controlHighBeam і reasonSwitchOffHighBeam. Це припущення, поки їх не підтвердить ще одна поїздка.', '',
          '## English', '',
          '- Recordings: %d. The driver switched the high beam on %d time(s) and dipped %d time(s).' % (len(results), highs, dips),
          '- The camera sends its light objects: **%s**. The camera\'s own high-beam verdict: **%s**.' % (lights_en, verdict_en)]
    if ag:
        L.append('- The verdict agreed with the driver %s of the time ("allow" value %s: a hypothesis from the driver\'s switching).' % (', '.join('%d %%' % round(100 * v['agreement']) for v in ag), ', '.join(str(v['allow_value_guess']) for v in ag)))
    if pc:
        L.append('- Parked check: push = bit %s, pull = %s, flash = %s. Members that follow the high beam: %s.' % (pc['push'], pc['pull'], pc['flash'], ', '.join(pc['highMembers']) or 'none found'))
    else:
        L.append('- The parked check was not found: the stalk bits\' meaning is still unconfirmed.')
    L.append('- The high-beam state came from: %s.' % (', '.join(hs) or 'nothing (no lamp member and no parked check)'))
    L += ['- Still unknown: the units of XPosition / YPosition / Distance / the angular speeds, the meaning of Class and Status, the brightness '
          'scale, the values of controlHighBeam and reasonSwitchOffHighBeam. Hypotheses until a second drive confirms them.', '']
    return '\n'.join(L)


def events_csv(path, results):
    with open(path, 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['session', 'n', 't_s', 'driver', 'kind', 'objects', 'falling', 'classes', 'verdict_values', 'verdict_reasons', 'speed_kmh', 'brightness', 'rain', 'limit_kmh', 'urban', 'following'])
        for r in results:
            for e in r['labelled']:
                c = e['context']
                vw = e['verdict'] or {}
                w.writerow([r['session'], e['n'], e['t_s'], e['driver'], e['kind'], len(e['objects']), sum(1 for o in e['objects'] if o['dist_falls']),
                            ' '.join(str(o['cls']) for o in e['objects']), ' '.join(str(x) for x in vw.get('values', [])), ' '.join(vw.get('reasons', [])),
                            c['speed_kmh'], c['brightness'], c['rain'], c['limit_kmh'], c['urban'], c['following']])


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--flash-max', type=float, default=1.5, help='s: a high-beam period shorter than this is a flash (default 1.5)')
    ap.add_argument('--empty-status', type=int, nargs='*', default=[], help='StatusObjectN values that mean "no object" (default: none; all-default slots are always empty)')
    ap.add_argument('--before', type=float, default=5.0, help='s before a switch in a labelled event (default 5)')
    ap.add_argument('--after', type=float, default=2.0, help='s after a switch in a labelled event (default 2)')
    ap.add_argument('--no-scenarios', action='store_true')
    a = ap.parse_args(argv)
    sessions = load(a.inputs)
    if not sessions:
        print('hb_analyse: no recording found (rec-<session>-<n>.csv[.gz])')
        return 1
    tags = hb_tags()
    os.makedirs(a.out, exist_ok=True)
    results, files = [], []
    for sid in sorted(sessions):
        s = sessions[sid]
        r = analyse(s, a, tags)
        if not a.no_scenarios:
            files += scenarios(s, os.path.join(a.out, 'scenarios'), r, int(a.flash_max * 1000), set(a.empty_status or []), int(a.before * 1000), int(a.after * 1000))
        results.append(r)
    for r in results:
        r['periods_s'] = [[r3(p[0] / 1000.0), r3(p[1] / 1000.0) if p[1] is not None else None] for p in r.pop('_periods')]
        for e in r['timeline']:
            e['t_s'] = r3(e.pop('t') / 1000.0)
    with open(os.path.join(a.out, 'report.json'), 'w') as fh:
        json.dump({'tool': 'hb_analyse', 'version': VERSION, 'recordings': results, 'scenarios': files}, fh, indent=1)
    for r in results:          # report_md reads t in ms
        for e in r['timeline']:
            e['t'] = e['t_s'] * 1000
    with open(os.path.join(a.out, 'report.md'), 'w') as fh:
        fh.write(report_md(results))
    with open(os.path.join(a.out, 'summary.md'), 'w') as fh:
        fh.write(summary_md(results))
    events_csv(os.path.join(a.out, 'events.csv'), results)
    print('hb_analyse: %d recording(s); lights %s, verdict %s; %d labelled event(s); %d scenario file(s) -> %s' % (
        len(results), '/'.join(r['groups']['lights'] for r in results), '/'.join(r['groups']['verdict'] for r in results),
        sum(len(r['labelled']) for r in results), len(files), a.out))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
