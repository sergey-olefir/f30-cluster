#!/usr/bin/env python3
"""r1120 AC: a drive's ACC recordings -> the Phase 1 signal report, the Phase 2 plant fit (a simulator plant JSON) and a summary.

    python3 -I tools/car/acc_analyse.py <data/rec folder or rec files ...> -o <out folder> [--anchors anchors.json] [--name TEXT]

The input is what Signal Probe's recorder writes (apps/signal_probe/recorder.js, set S17 "ACC" or S14), as collect.sh copies it
(apps/signal_probe/rec/). Parent brief: docs/cruise-set-speed-brief.md (Phase 1, Phase 2); the drive: docs/cruise/DRIVE-PROTOCOL.md.

<out>/phase1.md|json   per recording and per field: samples, native rate (median interval), jitter, gaps, the recorder's drops, the
                       car's missed messages (payload counters), the payload clock against the receive clock; the ACC fields that
                       never spoke; UNITS against the anchors (every speed source against car-speed2 = km/h x 1/64, the kit's verified
                       scale; every acceleration source against the derivative of that speed; every set-speed source against
                       DisplayDataServer2's ldmSetSpeedValue, km/h; the gap sources against the passenger's metres from --anchors; the
                       front vehicle's speedX against the derivative of the calibrated gap): scale, offset, R^2, residual noise; and
                       LATENCY estimates: each source's receive delay relative to its anchor by cross-correlation (positive = later)
<out>/phase2.md|json   the set-speed steps the driver made (grouped presses), each kept or left out with the reason (cruise not
                       active, accelerator, brake, not settled, too short); the steady-state map (the speed the cruise holds for a set
                       speed); the coast-down; the fit of tau v' + v = v_set(t - Td), a_min <= v' <= a_max separately for speeding up and
                       slowing down (P2), validated on held-out steps (the brief's exit: speed RMS below 0.5 km/h); per step size its own
                       fit (the step-size nonlinearity); whether the cruise braked (the brake lamp without the driver's brake)
<out>/plant.json       the simulator's plant file (tools/cruise-sim README "Load an identified plant"), "assumed": false; written
                       only when at least one step each way was fitted
<out>/steps.csv, steps.svg   every kept step: observed and fitted speed (the fit plots)
<out>/summary.md       a short summary for the owner, Ukrainian and English

Read only, local; numbers and our own words only (the recorder writes no text). Plain Python 3, no third-party package.
Mac only, never shipped. Its test: tools/car/test_acc_analyse.py (synthetic drives made by tools/car/acc_synth.js).
"""
import argparse
import bisect
import json
import math
import os
import re
import statistics
import sys
from array import array

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import rec_convert as rc  # noqa: E402

VERSION = 1
GRID = 0.05                      # s, the common clock of the analysis
KMH = 1 / 3.6

# ---- what is read, by (tag, column); the columns are the recorder's flattened member paths of the car's own types ----------------
SPEED_ANCHOR = ('car-speed2', 'speedVehicleCentreOfGravity', 1 / 64.0)          # km/h x 1/64 (kit/runtime/car.js, read on the car)
SPEED_SOURCES = [('speed', 'speedVehicleCentreOfGravity'), ('dynamics-long', 'vehicleSpeedLongitudinal'),
                 ('velocity', 'velocityVehicleCog.velocityVehicleCog'), ('velocity-long', 'velocityVehicleLongitudinal.velocityVehicleLongitudinal'),
                 ('display-speed', 'displayedValueSpeed'), ('hud-data', 'speed.kmH'), ('hud-data2', 'speed.kmh_Digital'),
                 ('characteristic-speed', 'characteristicSpeed'),
                 ('wheel-rpm', 'actualValueRPMWheelFLH'), ('wheel-rpm', 'actualValueRPMwheelFRH'), ('wheel-rpm', 'actualValueRPMWheelRLH'), ('wheel-rpm', 'actualValueRPMWheelRRH')]
ACCEL_SOURCES = [('accel-long', 'longitudinalAccelerationCentreOfGravity'), ('accel-long-cog', 'accelerationLongitudinalCog.accelerationLongitudinalCentreOfGravity'),
                 ('accel-long-est', 'vehicleAccelerationLongitudinalEstimated.VehicleAccelerationLongitudinalEstimated'),
                 ('cds-accel-long', 'longitudinalAccelerationCentreOfGravity'), ('dynamics-long', 'longitudinalAccelerationDrivingDirection2')]
SET_ANCHOR = ('hud-data2', 'ldmSetSpeed.ldmSetSpeedValue')                     # km/h, 65535 = none (seen on the car)
SET_SOURCES = [('hud-data', 'cruiseCtrlSpeedHUD'), ('ldm-guidance', 'valueRequestSpeed'), ('longitudinal', 'valueRequestedSpeed'),
               ('assist-avail', 'valueSetSpeed'), ('ad-velocity', 'displayedVelocity')]
STATE = ('hud-data2', 'ldmIconState')
ICON = ('hud-data2', 'ldmIconId')
GAP_SOURCES = [('front-vehicle', 'frontVehicleGapX'), ('gap-ahead', 'gapVehicleDrivingAhead'), ('cam2-polar', 'polarCoordinates.0.distance'),
               ('cam-position', 'objectPositionInfo.0.positionX'), ('cam2-position', 'objectPositionInfo.0.positionX'),
               ('keep-dist-1', 'keepDistObjects1.KeepDistObjDistanceLongitudinal0')]
REL_SOURCES = [('front-vehicle', 'frontVehicleSpeedX'), ('cam2-polar', 'polarCoordinates.0.distanceRate'),
               ('object-lanes', 'assignedObjectInfo.0.relativeFrenetSpeed.speedLongitudinal')]
PEDAL = [('accel-pedal', 'actualValueAngleAcceleratorPedal'), ('accel-pedal', 'dummy2'), ('drive-torque', 'statusInterfaceDriverAssistenceSystemTargetLimit')]
BRAKE = [('brake-driver', 'statusBrakingDriver'), ('brake-switch', 'dummy2')]
LAMP = ('brake-light', 'controlFunctionBrakeLight')
GRADE = ('gradient', 'longitudinalGradientSurface.longitudinalGradientSurface')
NONE_VALUES = {('front-vehicle', 'frontVehicleGapX'): (4093, 4094, 4095), SET_ANCHOR: (65535,), ('hud-data', 'cruiseCtrlSpeedHUD'): (65535,)}
WANT = set([SPEED_ANCHOR[:2], SET_ANCHOR, STATE, ICON, LAMP, GRADE] + SPEED_SOURCES + ACCEL_SOURCES + SET_SOURCES + GAP_SOURCES + REL_SOURCES + PEDAL + BRAKE)


# ---- reading: a streaming parse that keeps per field only its times, counters, time stamps and the wanted columns ---------------
class Field:
    def __init__(self, tag, name):
        self.tag, self.name = tag, name
        self.t = array('d')
        self.seq = array('l')
        self.ctr = []
        self.pts = []                 # (t, payload seconds)
        self.same = 0
        self.cols = []
        self.vals = {}                # col -> ([t], [v])


class Session:
    def __init__(self, sid):
        self.id = sid
        self.fields = {}
        self.marks = []
        self.files = []
        self.cut = []
        self.end = None
        self.header = None
        self.bad = 0


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
        if line[0] == '#':
            p = line.split(',')
            k = p[0]
            if k == '#rec':
                sess.header = sess.header or {'version': p[2], 'session': p[3], 'wall': p[5], 'sets': p[7] if len(p) > 7 else ''}
            elif k == '#f':
                fid, tag, name, cols = p[1], p[2], p[3], p[4:]
                f = sess.fields.get(tag)
                if f is None:
                    f = sess.fields[tag] = Field(tag, name)
                for c in cols:
                    if c not in f.cols:
                        f.cols.append(c)
                keep = [(i, c) for i, c in enumerate(cols) if (tag, c) in WANT]
                by_id[fid] = (f, cols, keep)
                prev.pop(fid, None)
            elif k == '#n':
                codes['@' + p[1]] = p[2]
            elif k == '#m':
                sess.marks.append((rc.num(p[1]), rc.num(p[2])))
            elif k == '#end':
                sess.end = {'t': rc.num(p[1])}
            continue
        p = line.split(',')
        if len(p) < 6 or p[1] not in by_id:
            sess.bad += 1
            continue
        f, cols, keep = by_id[p[1]]
        t = rc.num(p[0])
        if t is None:
            sess.bad += 1
            continue
        if p[5] == '=' and len(p) == 6:
            raw = prev.get(p[1])
            if raw is None:
                sess.bad += 1
                continue
            f.same += 1
        else:
            raw = p[5:]
            if len(raw) != len(cols):
                sess.bad += 1
                continue
            if prev.get(p[1]) == raw:
                f.same += 1
            prev[p[1]] = raw
        f.t.append(t / 1000.0)
        f.seq.append(rc.num(p[2]) or 0)
        f.ctr.append(rc.num(p[3]))
        if p[4]:
            ps = rc.pts_seconds(p[4])
            if ps is not None:
                f.pts.append((t / 1000.0, ps))
        for i, c in keep:
            x = raw[i]
            v = codes.get(x, x) if x.startswith('@') else rc.num(x)
            if v is None:
                continue
            tv = f.vals.setdefault(c, ([], []))
            tv[0].append(t / 1000.0)
            tv[1].append(v)


# ---- small numerics ---------------------------------------------------------------------------------------------------------------
def series(sess, key, scale=1.0, numeric=True):
    f = sess.fields.get(key[0])
    if not f or key[1] not in f.vals:
        return [], []
    ts, vs = f.vals[key[1]]
    bad = NONE_VALUES.get(tuple(key[:2]), ())
    out_t, out_v = [], []
    for t, v in zip(ts, vs):
        if numeric:
            if not isinstance(v, (int, float)) or v in bad:
                continue
            out_t.append(t)
            out_v.append(v * scale)
        else:
            out_t.append(t)
            out_v.append(v)
    return out_t, out_v


def grid_of(sess):
    t_all = [f.t[0] for f in sess.fields.values() if len(f.t)] + [f.t[-1] for f in sess.fields.values() if len(f.t)]
    if not t_all:
        return []
    t0, t1 = min(t_all), max(t_all)
    n = int((t1 - t0) / GRID) + 1
    return [t0 + i * GRID for i in range(n)]


def interp(ts, vs, grid, max_gap=1.0):
    """Linear between two samples no further apart than max_gap s; None elsewhere."""
    out = [None] * len(grid)
    if len(ts) < 2:
        return out
    j = 0
    for i, g in enumerate(grid):
        while j + 1 < len(ts) and ts[j + 1] <= g:
            j += 1
        if ts[j] <= g and j + 1 < len(ts) and ts[j + 1] - ts[j] <= max_gap:
            a, b = ts[j], ts[j + 1]
            out[i] = vs[j] + (vs[j + 1] - vs[j]) * (g - a) / (b - a) if b > a else vs[j]
    return out


def zoh(ts, vs, grid, max_age=2.0):
    out = [None] * len(grid)
    j = -1
    for i, g in enumerate(grid):
        while j + 1 < len(ts) and ts[j + 1] <= g:
            j += 1
        if j >= 0 and g - ts[j] <= max_age:
            out[i] = vs[j]
    return out


def smooth(x, w):
    """Centred moving mean over 2w+1 points (None-aware)."""
    n = len(x)
    out = [None] * n
    for i in range(n):
        lo, hi = max(0, i - w), min(n, i + w + 1)
        seg = [v for v in x[lo:hi] if v is not None]
        if len(seg) >= (hi - lo) * 0.6:
            out[i] = sum(seg) / len(seg)
    return out


def deriv(x, h):
    """Centred difference over +-h points, per second."""
    n = len(x)
    out = [None] * n
    for i in range(h, n - h):
        if x[i + h] is not None and x[i - h] is not None:
            out[i] = (x[i + h] - x[i - h]) / (2 * h * GRID)
    return out


def linfit(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = statistics.mean(xs), statistics.mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx <= 0:
        return None
    k = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    c = my - k * mx
    res = [y - (k * x + c) for x, y in zip(xs, ys)]
    syy = sum((y - my) ** 2 for y in ys)
    r2 = 1 - sum(r * r for r in res) / syy if syy > 0 else None
    return {'k': k, 'c': c, 'r2': r2, 'resid_sd': statistics.pstdev(res), 'n': n}


def xcorr_lag(x, y, max_lag_s=2.0):
    """The lag (s) of x behind y at the best correlation of their changes (positive = x later); None when too little moves."""
    dx, dy = deriv(smooth(x, 3), 2), deriv(smooth(y, 3), 2)
    L = int(max_lag_s / GRID)
    idx = [i for i in range(L, len(dy) - L) if dy[i] is not None]
    if len(idx) < 100:
        return None
    mag = sorted(abs(dy[i]) for i in idx)
    thr = mag[int(0.6 * (len(mag) - 1))]
    idx = [i for i in idx if abs(dy[i]) >= thr and thr > 0]
    if len(idx) > 8000:
        idx = idx[::len(idx) // 8000 + 1]
    if len(idx) < 50:
        return None
    best, scores = None, {}
    for lag in range(-L, L + 1):
        sxy = sxx = syy = 0.0
        m = 0
        for i in idx:
            a = dx[i + lag]
            if a is None:
                continue
            b = dy[i]
            sxy += a * b
            sxx += a * a
            syy += b * b
            m += 1
        if m < 50 or sxx <= 0 or syy <= 0:
            continue
        r = sxy / math.sqrt(sxx * syy)
        scores[lag] = r
        if best is None or r > scores[best]:
            best = lag
    if best is None or scores[best] < 0.3:
        return None
    lag = float(best)
    if best - 1 in scores and best + 1 in scores:
        a, b, c = scores[best - 1], scores[best], scores[best + 1]
        den = a - 2 * b + c
        if den < 0:
            lag += 0.5 * (a - c) / den
    return {'lag_s': lag * GRID, 'r': scores[best]}


# ---- Phase 1 ----------------------------------------------------------------------------------------------------------------------
def field_stats(f):
    t = list(f.t)
    rep = {'tag': f.tag, 'member': f.name, 'samples': len(t), 'columns': len(f.cols)}
    if len(t) < 2:
        rep['note'] = 'fewer than two samples'
        return rep
    dt = [(b - a) * 1000 for a, b in zip(t, t[1:])]
    med = statistics.median(dt)
    span = t[-1] - t[0]
    rep.update({'span_s': round(span, 3), 'rate_hz': round(1000.0 / med, 3) if med > 0 else None,
                'mean_rate_hz': round((len(t) - 1) / span, 3) if span > 0 else None, 'jitter_ms': round(statistics.pstdev(dt), 2)})
    s = sorted(dt)
    rep['interval_p5_p95_ms'] = [round(s[int(0.05 * (len(s) - 1))], 1), round(s[int(0.95 * (len(s) - 1))], 1)]
    lim = 3 * med if med > 0 else 1000
    rep['gaps'] = sum(1 for x in dt if x > lim)
    rep['longest_gap_ms'] = round(max(dt), 1)
    seq = list(f.seq)
    rep['recorder_drops'] = sum(b - a - 1 for a, b in zip(seq, seq[1:]) if b > a + 1)
    cm = rc.counter_misses(f.ctr)
    if cm:
        rep['counter'] = cm
    if len(f.pts) >= 3:
        xs, ys = [p[1] for p in f.pts], [p[0] for p in f.pts]
        fit = linfit(xs, ys)
        pd = [b - a for a, b in zip(xs, xs[1:])]
        pos = [x for x in pd if x > 0]
        if fit:
            rep['payload_clock'] = {'median_interval_ms': round(statistics.median(pos) * 1000, 2) if pos else None,
                                    'receive_s_per_payload_s': round(fit['k'], 5), 'receive_minus_payload_spread_ms': round(fit['resid_sd'] * 1000, 2),
                                    'backwards': sum(1 for x in pd if x < 0)}
    rep['repeated_share'] = round(f.same / max(1, len(t)), 3)
    return rep


def unit_guess(k):
    for name, v in (('same unit', 1.0), ('m/s -> km/h', 3.6), ('1/64', 1 / 64.0), ('0.01', 0.01), ('0.1', 0.1), ('0.5', 0.5), ('0.25', 0.25), ('2', 2.0)):
        if k and abs(k - v) / v < 0.02:
            return name
    return None


def fit_against(sess_list, cand, prefilter, scale_note, lag=True):
    """Scale / offset / noise of a candidate against an anchor series, over every session where both are there; and the lag.
    prefilter: the centred mean (grid points each side) the anchor went through, applied to the candidate too (a noisy
    candidate against a smoothed anchor would otherwise read a scale too small)."""
    xs, ys, lags = [], [], []
    for s, grid, anc in sess_list:
        ts, vs = series(s, cand)
        if len(ts) < 10 or anc is None:
            continue
        x = interp(ts, vs, grid, 1.0)
        if prefilter:
            x = smooth(x, prefilter)
        if lag:
            lg = xcorr_lag(x, anc)
            if lg:
                lags.append(lg)
        sh = int(round((statistics.median([g['lag_s'] for g in lags]) if lags else 0.0) / GRID))
        for i in range(len(grid)):
            j = i + sh
            if 0 <= j < len(x) and x[j] is not None and anc[i] is not None:
                xs.append(x[j])
                ys.append(anc[i])
    if len(xs) < 20:
        return None
    if len(xs) > 40000:
        st = len(xs) // 40000 + 1
        xs, ys = xs[::st], ys[::st]
    fit = linfit(xs, ys)
    if not fit:
        return {'source': cand[0] + '.' + cand[1], 'samples': len(xs), 'note': 'does not move: no scale'}
    out = {'source': cand[0] + '.' + cand[1], 'k': round(fit['k'], 6), 'c': round(fit['c'], 4), 'r2': round(fit['r2'], 5) if fit['r2'] is not None else None,
           'noise': round(fit['resid_sd'], 4), 'samples': fit['n'], 'anchor': scale_note, 'unit': unit_guess(fit['k'])}
    if lags:
        out['lag_ms'] = round(statistics.median([g['lag_s'] for g in lags]) * 1000, 1)
        out['lag_r'] = round(statistics.median([g['r'] for g in lags]), 3)
    return out


def phase1(sessions, anchors, acc_tags):
    rep = {'recordings': [], 'units': {}, 'silent': [], 'anchors_used': bool(anchors)}
    ctx = []
    for sid, s in sorted(sessions.items()):
        grid = grid_of(s)
        ts, vs = series(s, SPEED_ANCHOR[:2], SPEED_ANCHOR[2])
        v = interp(ts, vs, grid, 1.0) if len(ts) > 2 else None
        ctx.append((s, grid, v))
        rep['recordings'].append({'session': sid, 'header': s.header, 'files': s.files, 'cut_files': s.cut, 'bad_lines': s.bad,
                                  'complete': s.end is not None, 'marks': len(s.marks), 'fields': [field_stats(f) for _, f in sorted(s.fields.items())]})
    seen = set(t for s in sessions.values() for t, f in s.fields.items() if len(f.t))
    rep['silent'] = sorted(t for t in acc_tags if t not in seen)
    # speed: against car-speed2 (km/h)
    rep['units']['speed'] = [x for x in (fit_against(ctx, c, 0, 'car-speed2 km/h') for c in SPEED_SOURCES) if x]
    for x in rep['units']['speed']:
        if x['source'].startswith('wheel-rpm.') and x.get('k'):
            x['wheel_radius_m'] = round(x['k'] / 3.6 * 60 / (2 * math.pi), 4)       # km/h per raw -> m per (raw rpm): the radius if raw is rpm
    # acceleration: against the derivative of car-speed2 (m/s^2)
    actx = [(s, g, smooth(deriv(smooth([None if x is None else x * KMH for x in v], 4), 4), 2) if v else None) for s, g, v in ctx]
    rep['units']['acceleration'] = [x for x in (fit_against(actx, c, 6, 'd/dt of car-speed2, m/s^2') for c in ACCEL_SOURCES) if x]
    # set speed: against DisplayDataServer2's value (km/h), at the same moments (no lag: a held value)
    sets = []
    for c in SET_SOURCES:
        xs, ys = [], []
        for s, grid, _v in ctx:
            at, av = series(s, SET_ANCHOR)
            ct, cv = series(s, c)
            if len(at) < 2 or len(ct) < 2:
                continue
            a = zoh(at, av, grid, 3.0)
            b = zoh(ct, cv, grid, 3.0)
            for i in range(0, len(grid), 10):
                if a[i] is not None and b[i] is not None:
                    xs.append(b[i])
                    ys.append(a[i])
        fit = linfit(xs, ys)
        if fit:
            sets.append({'source': c[0] + '.' + c[1], 'k': round(fit['k'], 5), 'c': round(fit['c'], 3), 'r2': round(fit['r2'], 5) if fit['r2'] is not None else None,
                         'samples': fit['n'], 'anchor': 'hud-data2 ldmSetSpeedValue km/h', 'unit': unit_guess(fit['k'])})
    rep['units']['set_speed'] = sets
    # the gap: the passenger's metres
    rep['units']['gap'] = gap_units(sessions, ctx, anchors)
    # the relative speed: against the derivative of the calibrated gap
    rep['units']['relative_speed'] = rel_units(ctx, rep['units']['gap'])
    rep['latency'] = sorted([{'source': x['source'], 'relative_to': x['anchor'], 'lag_ms': x['lag_ms'], 'r': x.get('lag_r')}
                             for kind in ('speed', 'acceleration', 'gap', 'relative_speed') for x in rep['units'].get(kind) or [] if isinstance(x, dict) and 'lag_ms' in x],
                            key=lambda r: r['lag_ms'])
    return rep


def mark_time(sessions, sid, n):
    s = sessions.get(sid)
    if not s:
        return None
    for t, k in s.marks:
        if k == n:
            return t / 1000.0
    return None


def gap_units(sessions, ctx, anchors):
    if not anchors:
        return [{'note': 'no anchors given (--anchors): the gap stays raw'}]
    pts = []          # (session, t0, t1, metres)
    for a in anchors.get('static', []):
        t = mark_time(sessions, a.get('session'), a.get('mark'))
        if t is not None:
            pts.append((a['session'], t + 2.0, t + float(a.get('hold_s', 15)), float(a['gap_m'])))
    for p in anchors.get('pairs', []):
        s = sessions.get(p.get('session'))
        t1, t2 = mark_time(sessions, p.get('session'), p.get('lead')), mark_time(sessions, p.get('session'), p.get('us'))
        if s is None or t1 is None or t2 is None or t2 <= t1:
            continue
        ts, vs = series(s, SPEED_ANCHOR[:2], SPEED_ANCHOR[2])
        seg = [v for t, v in zip(ts, vs) if t1 <= t <= t2]
        if seg:
            pts.append((p['session'], t1, t2, statistics.mean(seg) * KMH * (t2 - t1)))
    out = []
    for c in GAP_SOURCES:
        xs, ys = [], []
        for sid, t0, t1, m in pts:
            s = sessions.get(sid)
            ts, vs = series(s, c) if s else ([], [])
            seg = [v for t, v in zip(ts, vs) if t0 <= t <= t1]
            if seg:
                xs.append(statistics.mean(seg))
                ys.append(m)
        fit = linfit(xs, ys)
        if fit:
            out.append({'source': c[0] + '.' + c[1], 'k': round(fit['k'], 6), 'c': round(fit['c'], 3), 'r2': round(fit['r2'], 5) if fit['r2'] is not None else None,
                        'noise': round(fit['resid_sd'], 3), 'samples': fit['n'], 'anchor': 'passenger metres', 'unit': unit_guess(fit['k']),
                        'range_m': [round(min(ys), 1), round(max(ys), 1)]})
    if not out:
        out.append({'note': 'the anchors gave no point with a gap value beside it', 'points': len(pts)})
    return out


def rel_units(ctx, gaps):
    g = next((x for x in gaps if x.get('source') == 'front-vehicle.frontVehicleGapX' and x.get('k')), None)
    if not g:
        g = next((x for x in gaps if x.get('k')), None)
    if not g:
        return [{'note': 'no calibrated gap: the relative speed stays raw'}]
    tag, col = g['source'].split('.', 1)
    rctx = []
    for s, grid, _v in ctx:
        ts, vs = series(s, (tag, col))
        if len(ts) < 20:
            rctx.append((s, grid, None))
            continue
        m = interp(ts, [v * g['k'] + g['c'] for v in vs], grid, 0.5)
        rctx.append((s, grid, smooth(deriv(smooth(m, 20), 10), 10)))
    out = [x for x in (fit_against(rctx, c, 40, 'd/dt of the calibrated ' + g['source'] + ', m/s', lag=False) for c in REL_SOURCES) if x]
    return out or [{'note': 'no relative-speed source moved with the gap'}]


# ---- Phase 2 ----------------------------------------------------------------------------------------------------------------------
def flags_of(s, grid):
    """Per grid point: pedal pressed, driver braking, brake lamp lit (None where unknown)."""
    n = len(grid)
    pedal, brake, lamp = [False] * n, [False] * n, [False] * n
    for c in PEDAL:
        ts, vs = series(s, c, numeric=False)
        z = zoh(ts, vs, grid, 1.0)
        for i, v in enumerate(z):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                if c[1] == 'actualValueAngleAcceleratorPedal' and v > 0:
                    pedal[i] = True
            elif (v.startswith('FAHRPEDAL_GETRETEN') or (v.startswith('FAHRPEDAL_MINUS__FAHRER') and not v.startswith('KEINE'))):
                pedal[i] = True
    for c in BRAKE:
        ts, vs = series(s, c, numeric=False)
        z = zoh(ts, vs, grid, 1.0)
        for i, v in enumerate(z):
            if v is None:
                continue
            if (isinstance(v, (int, float)) and v > 0) or v == 'BLS_MINUS_BETAETIGUNG':
                brake[i] = True
    ts, vs = series(s, LAMP, numeric=False)
    for i, v in enumerate(zoh(ts, vs, grid, 1.0)):
        lamp[i] = v == 'ON_BL'
    return pedal, brake, lamp


def prepare(s):
    grid = grid_of(s)
    ts, vs = series(s, SPEED_ANCHOR[:2], SPEED_ANCHOR[2])
    if len(ts) < 20 or not grid:
        return None
    v = interp(ts, vs, grid, 1.0)
    at, av = series(s, SET_ANCHOR)
    st, sv = series(s, STATE, numeric=False)
    if not at or not st:
        return None
    setv = zoh(at, av, grid, 2.0)
    state = zoh(st, sv, grid, 2.0)
    acc = deriv(smooth([None if x is None else x * KMH for x in v], 4), 4)
    pedal, brake, lamp = flags_of(s, grid)
    return {'s': s, 'grid': grid, 'v': v, 'set': setv, 'state': state, 'acc': acc, 'pedal': pedal, 'brake': brake, 'lamp': lamp,
            'changes': [(t, x) for t, x in zip(at, av)]}


def find_steps(d):
    """The driver's set-speed changes while the cruise is active, presses less than 2.5 s apart grouped into one step."""
    grid, setv, state = d['grid'], d['set'], d['state']
    ch = []
    for i in range(1, len(grid)):
        if setv[i] is not None and setv[i - 1] is not None and setv[i] != setv[i - 1]:
            ch.append(i)
    groups = []
    for i in ch:
        if groups and grid[i] - grid[groups[-1][-1]] < 2.5:
            groups[-1].append(i)
        else:
            groups.append([i])
    steps = []
    for k, g in enumerate(groups):
        i0, i1 = g[0], g[-1]
        nxt = groups[k + 1][0] if k + 1 < len(groups) else len(grid) - 1
        end = min(nxt - int(0.5 / GRID), i0 + int(25 / GRID), len(grid) - 1)
        # the window ends 0.5 s before the cruise is cancelled or suspended (a later act of the driver, not this step's)
        for i in range(i0, end + 1):
            if state[i] in ('STANDBY', 'OFF'):
                end = max(i0, i - int(0.5 / GRID))
                break
        start = max(0, i0 - int(2 / GRID))
        steps.append({'session': d['s'].id, 'i0': i0, 'i_start': start, 'i_end': end, 't0_s': round(grid[i0], 3),
                      'before': setv[i0 - 1], 'after': setv[i1], 'size': setv[i1] - setv[i0 - 1], 'presses': len(g),
                      'single_changes': [setv[i] - setv[i - 1] for i in g]})
    return steps


def judge(d, st, ss):
    """Why a step cannot be used, or None."""
    a, b = st['i_start'], st['i_end']
    if (b - st['i0']) * GRID < 8:
        return 'too short (the next press came within 8 s)'
    if any(d['pedal'][a:b + 1]):
        return 'accelerator pressed'
    if any(d['brake'][a:b + 1]):
        return 'driver braking'
    if any(x not in ('ACTIVE',) for x in d['state'][a:b + 1] if x is not None) or any(x is None for x in d['state'][st['i0']:b + 1]):
        return 'cruise not active throughout'
    pre = [x for x in d['v'][a:st['i0']] if x is not None]
    pa = [x for x in d['acc'][a:st['i0']] if x is not None]
    if not pre or len(pre) < (st['i0'] - a) * 0.8:
        return 'speed signal missing'
    target = ss['k'] * st['before'] + ss['c']
    if abs(statistics.mean(pre) - target) > 1.5 or (pa and max(abs(x) for x in pa) > 0.25):
        return 'not settled before the press'
    if sum(1 for x in d['v'][st['i0']:b + 1] if x is None) > 0.1 * (b - st['i0']):
        return 'speed signal missing'
    return None


def steady_map(ds):
    """The speed the cruise holds for a set speed: v = k x set + c (from the last 4 s of every 10 s hold without input)."""
    xs, ys = [], []
    for d in ds:
        grid, setv, state, v, acc = d['grid'], d['set'], d['state'], d['v'], d['acc']
        n = len(grid)
        i = 0
        while i < n:
            if setv[i] is None or state[i] != 'ACTIVE':
                i += 1
                continue
            j = i
            while j + 1 < n and setv[j + 1] == setv[i] and state[j + 1] == 'ACTIVE' and not d['pedal'][j + 1] and not d['brake'][j + 1]:
                j += 1
            if (j - i) * GRID >= 10:
                lo = j - int(4 / GRID)
                seg = [v[k] for k in range(lo, j + 1) if v[k] is not None]
                ac = [acc[k] for k in range(lo, j + 1) if acc[k] is not None]
                if seg and ac and max(abs(x) for x in ac) < 0.1:
                    xs.append(setv[i])
                    ys.append(statistics.mean(seg))
            i = j + 1
    if len(set(xs)) >= 2:
        f = linfit(xs, ys)
        if f:
            return {'k': round(f['k'], 5), 'c': round(f['c'], 3), 'holds': len(xs), 'resid_sd_kmh': round(f['resid_sd'], 3)}
    if xs:
        return {'k': 1.0, 'c': round(statistics.mean(y - x for x, y in zip(xs, ys)), 3), 'holds': len(xs), 'note': 'one set speed only: an offset'}
    return {'k': 1.0, 'c': 0.0, 'holds': 0, 'note': 'no steady hold found: the set speed is taken as the true speed'}


def coast(ds):
    """Coasting with the cruise off or suspended, no pedal, no brake, above 30 km/h, 4 s or more: the deceleration by speed."""
    pts = []
    for d in ds:
        grid, state, v, acc = d['grid'], d['state'], d['v'], d['acc']
        n = len(grid)
        i = 0
        while i < n:
            ok = lambda k: state[k] is not None and state[k] not in ('ACTIVE', 'OVERRIDE') and not d['pedal'][k] and not d['brake'][k] and v[k] is not None and v[k] > 30
            if not ok(i):
                i += 1
                continue
            j = i
            while j + 1 < n and ok(j + 1):
                j += 1
            if (j - i) * GRID >= 4:
                lo = i + int(1 / GRID)
                ac = [acc[k] for k in range(lo, j + 1) if acc[k] is not None]
                vv = [v[k] for k in range(lo, j + 1) if v[k] is not None]
                if ac and vv:
                    pts.append({'v_kmh': round(statistics.mean(vv), 1), 'a_ms2': round(statistics.mean(ac), 3), 'seconds': round((j - i) * GRID, 1)})
            i = j + 1
    return pts


def simulate(d, st, ss, td, tau, amax, amin, dt_steps=1):
    """The model on the grid of one step: tau v' + v = target(t - Td), the demand clipped; from the measured speed at the start."""
    a, b = st['i_start'], st['i_end']
    v = d['v'][a]
    if v is None:
        return None
    sh = td / GRID
    g = math.exp(-GRID / tau)
    out = []
    setv = d['set']
    last = st['before']

    def at(j):
        return setv[j] if 0 <= j < len(setv) and setv[j] is not None else None
    for i in range(a, b + 1):
        # the set speed Td ago, averaged over this grid step (so the error is smooth in Td)
        x = i - sh
        j = int(math.floor(x))
        fr = x - j
        s0, s1 = at(j), at(j + 1)
        s0 = last if s0 is None else s0
        s1 = s0 if s1 is None else s1
        last = s0
        sv = (1 - fr) * s0 + fr * s1
        out.append(v)
        target = ss['k'] * sv + ss['c']
        e = (target - v) * KMH
        dem = e * (1 - g) / GRID
        dem = max(amin, min(amax, dem))
        v += dem * GRID / KMH
    return out


def sse(d_steps, ss, td, tau, amax, amin):
    tot, n = 0.0, 0
    for d, st in d_steps:
        m = simulate(d, st, ss, td, tau, amax, amin)
        if m is None:
            continue
        obs = d['v'][st['i_start']:st['i_end'] + 1]
        for x, y in zip(m, obs):
            if y is not None:
                tot += (x - y) ** 2
                n += 1
    return tot, n


def fit_dir(d_steps, ss, amax, amin, coarse=False):
    """Td and tau by a coarse grid, then a finer one; returns {td, tau, rms}."""
    if not d_steps:
        return None
    nt = 12 if coarse else 24
    taus = [0.4 * (8 / 0.4) ** (k / (nt - 1.0)) for k in range(nt)]
    best = None
    for k in range(0, 26 if coarse else 51):
        td = k * (0.1 if coarse else 0.05)
        for tau in taus:
            e, n = sse(d_steps, ss, td, tau, amax, amin)
            if n and (best is None or e / n < best[0]):
                best = (e / n, td, tau)
    _, td0, tau0 = best
    for k in range(-4, 5):
        td = max(0.0, td0 + k * 0.0125)
        for m in range(-6, 7):
            tau = tau0 * (1 + m * 0.025)
            e, n = sse(d_steps, ss, td, tau, amax, amin)
            if n and e / n < best[0]:
                best = (e / n, td, tau)
    return {'td': round(best[1], 3), 'tau': round(best[2], 3), 'rms_kmh': round(math.sqrt(best[0]), 3)}


def rolling_extreme(d, st, sign, w_s=1.0):
    w = int(w_s / GRID)
    acc = d['acc'][st['i0']:min(st['i_end'], st['i0'] + int(12 / GRID)) + 1]
    vals = []
    for i in range(0, max(0, len(acc) - w)):
        seg = [x for x in acc[i:i + w] if x is not None]
        if len(seg) >= w * 0.8:
            vals.append(statistics.mean(seg))
    if not vals:
        return None
    return max(vals) if sign > 0 else min(vals)


def first_change(d, st):
    """The first time after the press the acceleration leaves its band before it (the brief's 'first measurable change')."""
    pre = [x for x in d['acc'][st['i_start']:st['i0']] if x is not None]
    if len(pre) < 10:
        return None
    m, sd = statistics.mean(pre), statistics.pstdev(pre)
    thr = 3 * sd + 0.05
    sgn = 1 if st['size'] > 0 else -1
    for i in range(st['i0'], st['i_end']):
        x = d['acc'][i]
        if x is not None and (x - m) * sgn > thr:
            return round((i - st['i0']) * GRID, 3)
    return None


def phase2(sessions):
    ds = [x for x in (prepare(s) for _, s in sorted(sessions.items())) if x]
    rep = {'steps': [], 'kept': 0, 'left_out': {}, 'interventions': {}, 'fit': None, 'notes': []}
    if not ds:
        rep['notes'].append('no recording has car-speed2, the set speed and the cruise state together')
        return rep, None, []
    ss = steady_map(ds)
    rep['steady_state'] = ss
    rep['coast'] = coast(ds)
    rep['interventions'] = {'suspensions': sum(1 for d in ds for i in range(1, len(d['grid'])) if d['state'][i - 1] == 'ACTIVE' and d['state'][i] == 'STANDBY'),
                            'overrides': sum(1 for d in ds for i in range(1, len(d['grid'])) if d['state'][i - 1] == 'ACTIVE' and d['state'][i] == 'OVERRIDE'),
                            'min_active_speed_kmh': round(min([d['v'][i] for d in ds for i in range(len(d['grid'])) if d['state'][i] == 'ACTIVE' and d['v'][i] is not None] or [0]), 1)}
    kept = []
    for d in ds:
        for st in find_steps(d):
            why = judge(d, st, ss)
            st['used'] = why is None
            st['why'] = why
            if why:
                rep['left_out'][why] = rep['left_out'].get(why, 0) + 1
            else:
                kept.append((d, st))
                st['a_extreme_ms2'] = rolling_extreme(d, st, 1 if st['size'] > 0 else -1)
                st['first_change_s'] = first_change(d, st)
                lamp = any(d['lamp'][st['i0']:st['i_end'] + 1])
                st['brake_lamp_without_driver'] = bool(lamp) if st['size'] < 0 else None
            rep['steps'].append(st)
    rep['kept'] = len(kept)
    singles = sorted(set(abs(c) for st in rep['steps'] for c in st['single_changes'] if c))
    rep['set_changes'] = {'single_change_sizes_kmh': singles[:12], 'resolution_kmh': singles[0] if singles else None}
    up = [x for x in kept if x[1]['size'] > 0]
    down = [x for x in kept if x[1]['size'] < 0]
    if not up or not down:
        rep['notes'].append('no usable step %s: no plant is written' % ('up' if not up else 'down'))
    aup = [st['a_extreme_ms2'] for _, st in up if st['a_extreme_ms2'] is not None]
    adn = [st['a_extreme_ms2'] for _, st in down if st['a_extreme_ms2'] is not None]
    amax = max(aup) if aup else 1.5
    amin = min(adn) if adn else -1.8
    big_up = max([st['size'] for _, st in up] or [0])
    big_dn = min([st['size'] for _, st in down] or [0])
    if big_up < 10:
        rep['notes'].append('no up step of 10 km/h or more: a_max is a lower bound')
    if big_dn > -10:
        rep['notes'].append('no down step of 10 km/h or more: a_min is a lower bound of the braking')
    if not up or not down:
        return rep, None, kept
    # held out: every second step of each direction
    hold = {'up': (up[0::2], up[1::2]), 'down': (down[0::2], down[1::2])}
    val = {}
    for name, (fit_on, check) in hold.items():
        if fit_on and check:
            f = fit_dir(fit_on, ss, amax, amin)
            e, n = sse(check, ss, f['td'], f['tau'], amax, amin)
            val[name] = {'fitted_on': len(fit_on), 'held_out': len(check), 'held_out_rms_kmh': round(math.sqrt(e / n), 3) if n else None, 'td': f['td'], 'tau': f['tau']}
    fu = fit_dir(up, ss, amax, amin)
    fd = fit_dir(down, ss, amax, amin)
    # a_max / a_min refined on the large steps with the fitted dynamics, then the dynamics again
    def refine(steps, f, which):
        cur = amax if which == 'max' else amin
        best = None
        for m in range(-12, 13):
            x = cur * (1 + m * 0.02)
            e, n = sse(steps, ss, f['td'], f['tau'], x if which == 'max' else amax, amin if which == 'max' else x)
            if n and (best is None or e / n < best[0]):
                best = (e / n, x)
        return best[1]
    large_up = [x for x in up if x[1]['size'] >= 10] or up
    large_dn = [x for x in down if x[1]['size'] <= -10] or down
    amax = refine(large_up, fu, 'max')
    amin = refine(large_dn, fd, 'min')
    fu = fit_dir(up, ss, amax, amin)
    fd = fit_dir(down, ss, amax, amin)
    eu, nu = sse(up, ss, fu['td'], fu['tau'], amax, amin)
    ed, nd = sse(down, ss, fd['td'], fd['tau'], amax, amin)
    rms_all = math.sqrt((eu + ed) / max(1, nu + nd))
    # per step size: its own dynamics (the step-size nonlinearity)
    by_size = {}
    for d, st in kept:
        key = ('+' if st['size'] > 0 else '') + ('%g' % st['size'])
        by_size.setdefault(key, []).append((d, st))
    nonlin = []
    for key, lst in sorted(by_size.items(), key=lambda kv: float(kv[0])):
        f = fit_dir(lst, ss, amax, amin, coarse=True)
        nonlin.append({'size_kmh': float(key), 'steps': len(lst), 'td': f['td'], 'tau': f['tau'], 'rms_kmh': f['rms_kmh']})
    # per step, the final model's error
    for d, st in kept:
        f = fu if st['size'] > 0 else fd
        e, n = sse([(d, st)], ss, f['td'], f['tau'], amax, amin)
        st['rms_kmh'] = round(math.sqrt(e / n), 3) if n else None
    coastp = rep['coast']
    brake_max, brake_note = None, None
    if coastp:
        vs_amin = statistics.mean([d['v'][st['i0']] for d, st in large_dn if d['v'][st['i0']] is not None])
        near = min(coastp, key=lambda p: abs(p['v_kmh'] - vs_amin))
        brake_max = max(0.0, round(-amin + near['a_ms2'], 2))
        brake_note = 'a_min %.2f against the coast-down %.2f m/s^2 at %.0f km/h' % (amin, near['a_ms2'], near['v_kmh'])
    lamps = [st['brake_lamp_without_driver'] for _, st in down if st['brake_lamp_without_driver'] is not None]
    rep['fit'] = {
        'model': 'P2', 'deadTime_s': fu['td'], 'tau_s': fu['tau'], 'deadTimeDown_s': fd['td'], 'tauDown_s': fd['tau'],
        'aMax_ms2': round(amax, 3), 'aMin_ms2': round(amin, 3), 'brakeMax_ms2': brake_max, 'brakeMax_from': brake_note,
        'rms_kmh': {'up': fu['rms_kmh'], 'down': fd['rms_kmh'], 'all': round(rms_all, 3)}, 'validation': val,
        'exit_criterion_rms_below_kmh': 0.5,
        'exit_criterion_met': all(v.get('held_out_rms_kmh') is not None and v['held_out_rms_kmh'] < 0.5 for v in val.values()) if len(val) == 2 else None,
        'first_change_median_s': {'up': med([st['first_change_s'] for _, st in up]), 'down': med([st['first_change_s'] for _, st in down])},
        'cruise_brakes': {'down_steps': len(lamps), 'brake_lamp_lit_without_driver': sum(1 for x in lamps if x)},
        'by_step_size': nonlin,
        'dead_time_is': 'apparent: from the set speed arriving on DisplayDataServer2 to the speed on Vehicle2.statusCarSpeed2 (their two reading delays included)',
    }
    plant = {
        'name': 'G20 DCC, identified from %d step(s) in %d recording(s)' % (len(kept), len(ds)),
        'model': 'P2', 'assumed': False,
        'params': {k: v for k, v in (('deadTime_s', clamp(fu['td'], 0, 3)), ('tau_s', clamp(fu['tau'], 0.2, 10)), ('deadTimeDown_s', clamp(fd['td'], 0, 3)),
                                     ('tauDown_s', clamp(fd['tau'], 0.2, 10)), ('aMax_ms2', round(clamp(amax, 0.2, 4), 3)), ('aMin_ms2', round(clamp(amin, -6, -0.1), 3)),
                                     ('brakeMax_ms2', None if brake_max is None else clamp(brake_max, 0, 8)),
                                     ('resolution_kmh', clamp(singles[0], 0.1, 10) if singles else None)) if v is not None},
        'source': 'tools/car/acc_analyse.py v%d, recordings %s' % (VERSION, ' '.join(sorted(d['s'].id for d in ds))),
        'fit': {'rms_kmh': rep['fit']['rms_kmh'], 'validation': val, 'steady_state': ss},
        'notes': ['dead times are apparent (display to speed signal)', 'the steady-state map of the set speed is not a plant setting: see fit.steady_state'] +
                 ([] if brake_max is not None else ['brakeMax_ms2 not identified (no coast-down): the simulator keeps its default']),
    }
    return rep, plant, kept


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 3) if xs else None


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


# ---- outputs ----------------------------------------------------------------------------------------------------------------------
def fmt(x, nd=3):
    if x is None:
        return '-'
    if isinstance(x, float):
        return ('%.' + str(nd) + 'g') % x if abs(x) < 1e-3 and x != 0 else str(round(x, nd))
    return str(x)


def phase1_md(p1):
    o = ['# Phase 1: signal report', '']
    for r in p1['recordings']:
        h = r['header'] or {}
        o.append('## Recording %s (app %s, sets %s, %d file(s)%s%s)' % (r['session'], h.get('version'), h.get('sets'), len(r['files']),
                 '' if r['complete'] else ', **no #end: stopped by the app or the head unit**', (', cut: ' + ' '.join(r['cut_files'])) if r['cut_files'] else ''))
        o.append('')
        o.append('| Field | Samples | Native Hz | Mean Hz | Jitter ms | p5..p95 ms | Gaps | Longest gap ms | Drops | Counter missed / repeats | Payload clock ms | Recv-payload spread ms | Repeated |')
        o.append('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
        for f in r['fields']:
            c, pc = f.get('counter') or {}, f.get('payload_clock') or {}
            o.append('| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
                f['tag'], f['samples'], fmt(f.get('rate_hz')), fmt(f.get('mean_rate_hz')), fmt(f.get('jitter_ms')), '..'.join(fmt(x) for x in f.get('interval_p5_p95_ms', [])),
                f.get('gaps', '-'), fmt(f.get('longest_gap_ms')), f.get('recorder_drops', '-'), ('%s / %s (mod %s)' % (c['missed'], c['repeats'], c['modulo'])) if c else '-',
                fmt(pc.get('median_interval_ms')), fmt(pc.get('receive_minus_payload_spread_ms')), fmt(f.get('repeated_share'))))
        o.append('')
    o.append('## Fields of the ACC set that never spoke')
    o.append('')
    o.append(', '.join(p1['silent']) if p1['silent'] else 'none')
    o.append('')
    titles = {'speed': 'Speed sources against car-speed2 (km/h)', 'acceleration': 'Acceleration sources against the derivative of car-speed2 (m/s^2)',
              'set_speed': 'Set-speed sources against DisplayDataServer2 (km/h)', 'gap': 'Gap sources against the passenger\'s metres',
              'relative_speed': 'Relative-speed sources against the derivative of the calibrated gap (m/s)'}
    for kind in ('speed', 'acceleration', 'set_speed', 'gap', 'relative_speed'):
        o.append('## ' + titles[kind])
        o.append('')
        rows = p1['units'].get(kind) or []
        if not rows or all('note' in x and 'k' not in x for x in rows):
            o.append(' '.join(x.get('note', '') for x in rows) or 'no source moved')
            o.append('')
            continue
        o.append('anchor = k x raw + c')
        o.append('')
        o.append('| Source | k | c | R^2 | Noise (anchor units) | Samples | Unit guess | Lag ms (+ = later) |')
        o.append('|---|---|---|---|---|---|---|---|')
        for x in rows:
            if 'k' not in x:
                continue
            o.append('| %s | %s | %s | %s | %s | %s | %s | %s |' % (x['source'], fmt(x['k'], 6), fmt(x['c'], 4), fmt(x.get('r2'), 5), fmt(x.get('noise'), 4), x['samples'],
                                                                    x.get('unit') or '-', fmt(x.get('lag_ms'), 4)))
        o.append('')
    o.append('## Latency (receive delay against the anchor; cross-correlation of the changes)')
    o.append('')
    for x in p1['latency']:
        o.append('- %s: %+.0f ms against %s (r %.2f)' % (x['source'], x['lag_ms'], x['relative_to'], x['r'] or 0))
    o.append('')
    return '\n'.join(o)


def phase2_md(p2):
    o = ['# Phase 2: the stock cruise as a plant', '']
    ss = p2.get('steady_state') or {}
    o.append('Steady state: the cruise holds car-speed2 = %s x set + %s km/h (%s holds)%s.' % (fmt(ss.get('k'), 5), fmt(ss.get('c')), ss.get('holds'),
                                                                                              (' ' + ss['note']) if ss.get('note') else ''))
    o.append('')
    o.append('Steps found: %d, kept %d; left out: %s.' % (len(p2['steps']), p2['kept'], ', '.join('%s %d' % kv for kv in sorted(p2['left_out'].items())) or 'none'))
    o.append('Driver interventions while the cruise was on: %(suspensions)s suspension(s), %(overrides)s override(s); lowest speed with the cruise active %(min_active_speed_kmh)s km/h.' % p2['interventions'] if p2['interventions'] else '')
    if p2.get('set_changes'):
        o.append('Single set-speed changes seen: %s km/h (resolution %s).' % (', '.join(fmt(x) for x in p2['set_changes']['single_change_sizes_kmh']), fmt(p2['set_changes']['resolution_kmh'])))
    if p2.get('coast'):
        o.append('Coast-down (cruise off, no pedal): ' + '; '.join('%.2f m/s^2 at %.0f km/h over %.0f s' % (c['a_ms2'], c['v_kmh'], c['seconds']) for c in p2['coast']) + '.')
    o.append('')
    f = p2.get('fit')
    if f:
        o.append('| Parameter | Up | Down |')
        o.append('|---|---|---|')
        o.append('| Dead time s (apparent) | %s | %s |' % (f['deadTime_s'], f['deadTimeDown_s']))
        o.append('| First measurable change s (median) | %s | %s |' % (fmt(f['first_change_median_s']['up']), fmt(f['first_change_median_s']['down'])))
        o.append('| Time constant s | %s | %s |' % (f['tau_s'], f['tauDown_s']))
        o.append('| a_max / a_min m/s^2 | %s | %s |' % (f['aMax_ms2'], f['aMin_ms2']))
        o.append('| Fit RMS km/h | %s | %s |' % (f['rms_kmh']['up'], f['rms_kmh']['down']))
        for k, v in sorted(f['validation'].items()):
            o.append('| Held out (%s): fitted on %d, checked on %d | RMS %s km/h | Td %s, tau %s |' % (k, v['fitted_on'], v['held_out'], v['held_out_rms_kmh'], v['td'], v['tau']))
        o.append('')
        o.append('Exit criterion (held-out speed RMS below %s km/h): %s.' % (f['exit_criterion_rms_below_kmh'], {True: 'met', False: 'NOT met', None: 'not tested (too few steps)'}[f['exit_criterion_met']]))
        o.append('Brake authority: %s. The brake lamp lit without the driver\'s brake in %d of %d down steps.' % (
            ('%s m/s^2 beyond lift-off (%s)' % (f['brakeMax_ms2'], f['brakeMax_from'])) if f['brakeMax_ms2'] is not None else 'not identified (no coast-down)',
            f['cruise_brakes']['brake_lamp_lit_without_driver'], f['cruise_brakes']['down_steps']))
        o.append('')
        o.append('Step-size nonlinearity (each size fitted alone):')
        o.append('')
        o.append('| Step km/h | Steps | Td s | tau s | RMS km/h |')
        o.append('|---|---|---|---|---|')
        for r in f['by_step_size']:
            o.append('| %+g | %d | %s | %s | %s |' % (r['size_kmh'], r['steps'], r['td'], r['tau'], r['rms_kmh']))
        o.append('')
        o.append('Dead time is ' + f['dead_time_is'] + '.')
    for n in p2['notes']:
        o.append('- ' + n)
    o.append('')
    o.append('| Recording | t s | Step km/h | Presses | Used | Why not | RMS km/h | Extreme a m/s^2 | First change s |')
    o.append('|---|---|---|---|---|---|---|---|---|')
    for st in p2['steps']:
        o.append('| %s | %.1f | %+g | %d | %s | %s | %s | %s | %s |' % (st['session'], st['t0_s'], st['size'], st['presses'], 'yes' if st['used'] else 'no', st['why'] or '',
                                                                     fmt(st.get('rms_kmh')), fmt(st.get('a_extreme_ms2')), fmt(st.get('first_change_s'))))
    o.append('')
    return '\n'.join(o)


def write_steps(out, kept, fit, ss):
    rows = ['session,step,t_s,set_kmh,v_obs_kmh,v_fit_kmh']
    svg = []
    W, H, cols = 260, 150, 4
    n = len(kept)
    if not fit:
        return
    for k, (d, st) in enumerate(kept):
        up = st['size'] > 0
        m = simulate(d, st, ss, fit['deadTime_s'] if up else fit['deadTimeDown_s'], fit['tau_s'] if up else fit['tauDown_s'], fit['aMax_ms2'], fit['aMin_ms2']) or []
        obs = d['v'][st['i_start']:st['i_end'] + 1]
        tt = d['grid'][st['i_start']:st['i_end'] + 1]
        sv = d['set'][st['i_start']:st['i_end'] + 1]
        for t, s, y, x in zip(tt, sv, obs, m):
            rows.append('%s,%d,%.2f,%s,%s,%.3f' % (st['session'], k + 1, t - tt[0], '' if s is None else s, '' if y is None else round(y, 3), x))
        ys = [y for y in obs if y is not None] + m
        lo, hi = min(ys) - 0.5, max(ys) + 0.5
        ox, oy = (k % cols) * W, (k // cols) * H
        px = lambda i: ox + 10 + (W - 20) * i / max(1, len(tt) - 1)
        py = lambda v: oy + H - 20 - (H - 40) * (v - lo) / (hi - lo)
        pts_o = ' '.join('%.1f,%.1f' % (px(i), py(y)) for i, y in enumerate(obs) if y is not None)
        pts_m = ' '.join('%.1f,%.1f' % (px(i), py(x)) for i, x in enumerate(m))
        svg.append('<g><rect x="%d" y="%d" width="%d" height="%d" fill="none" stroke="#999"/><text x="%d" y="%d" font-size="11">%s %+g km/h, RMS %s</text>'
                   '<polyline fill="none" stroke="#1f6feb" stroke-width="1.5" points="%s"/><polyline fill="none" stroke="#d1242f" stroke-width="1" stroke-dasharray="3 2" points="%s"/></g>'
                   % (ox + 2, oy + 2, W - 4, H - 4, ox + 8, oy + 15, st['session'][-6:], st['size'], fmt(st.get('rms_kmh')), pts_o, pts_m))
    with open(os.path.join(out, 'steps.csv'), 'w') as fh:
        fh.write('\n'.join(rows) + '\n')
    rows_n = (n + cols - 1) // cols
    with open(os.path.join(out, 'steps.svg'), 'w') as fh:
        fh.write('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" font-family="sans-serif"><rect width="100%%" height="100%%" fill="#fff"/>%s'
                 '<text x="8" y="%d" font-size="11">blue: car-speed2 (measured), red dashed: the fitted plant</text></svg>' % (cols * W, rows_n * H + 20, ''.join(svg), rows_n * H + 14))


def summary_md(p1, p2, plant, name):
    f = p2.get('fit')
    sp = {x['source']: x for x in p1['units'].get('speed', []) if 'k' in x}
    fv = None
    for r in p1['recordings']:
        for x in r['fields']:
            if x['tag'] == 'front-vehicle' and x.get('rate_hz'):
                fv = x
    gap = next((x for x in p1['units'].get('gap', []) if x.get('source') == 'front-vehicle.frontVehicleGapX' and 'k' in x), None)
    lat = {x['source']: x['lag_ms'] for x in p1['latency']}
    ok = f and f['exit_criterion_met']
    uk, en = [], []
    title = name or ', '.join(r['session'] for r in p1['recordings'])
    uk.append('# Підсумок: ' + title)
    uk.append('')
    if f:
        brakes = f['brakeMax_ms2'] is not None and f['brakeMax_ms2'] > 0.1
        uk.append('- **Гальмування круїзу:** найсильніше сповільнення на кроках униз %.2f м/с²%s; стоп-сигнал без педалі водія світився в %d з %d кроків униз.' % (
            f['aMin_ms2'], ('; понад вибіг %.2f м/с², тобто круїз гальмує' % f['brakeMax_ms2']) if brakes else ('; гальмування понад вибіг не видно' if f['brakeMax_ms2'] is not None else '; вибігу без круїзу не записано'),
            f['cruise_brakes']['brake_lamp_lit_without_driver'], f['cruise_brakes']['down_steps']))
        uk.append('- **Мертвий час** (від уставки на дисплеї до швидкості): угору %.2f с, униз %.2f с. **Стала часу:** %.2f / %.2f с. **Найбільше прискорення:** %.2f м/с².' % (
            f['deadTime_s'], f['deadTimeDown_s'], f['tau_s'], f['tauDown_s'], f['aMax_ms2']))
        uk.append('- **Модель** (P2) повторює відкладені кроки з похибкою швидкості %s км/год: критерій брифу (< 0,5) %s. Файл моделі для симулятора: `plant.json` (`assumed: false`).' % (
            ' / '.join(str(v['held_out_rms_kmh']) for _, v in sorted(f['validation'].items())) or '-', 'виконано' if ok else 'НЕ виконано' if ok is False else 'не перевірено'))
    else:
        uk.append('- **Модель круїзу не побудовано:** ' + '; '.join(p2['notes']) + '.')
    if fv:
        uk.append('- **Авто попереду** (`DataFrontVehicle`): власна частота %.1f Гц, розкид інтервалів %s мс, найдовша пауза %s мс.' % (fv['rate_hz'], fmt(fv.get('jitter_ms')), fmt(fv.get('longest_gap_ms'))))
    uk.append('- **Дистанція:** ' + (('gapX × %.4f %+.2f = метри (R² %.3f, %d точок).' % (gap['k'], gap['c'], gap['r2'] or 0, gap['samples'])) if gap else 'не прив’язана до метрів (немає нотаток пасажира).'))
    if 'speed.speedVehicleCentreOfGravity' in sp:
        x = sp['speed.speedVehicleCentreOfGravity']
        uk.append('- **Швидкість шасі** (`vehicleSpeed`): %.5f км/год на одиницю, на %s мс %s за `statusCarSpeed2`.' % (x['k'], fmt(abs(x.get('lag_ms') or 0)), 'раніше' if (x.get('lag_ms') or 0) < 0 else 'пізніше'))
    uk.append('- Мовчали в цьому записі: %d полів набору ACC.' % len(p1['silent']))
    uk.append('')
    en.append('## In English')
    en.append('')
    if f:
        en.append('- **Cruise braking:** strongest deceleration on the down steps %.2f m/s^2%s; brake lamp without the driver\'s pedal in %d of %d down steps.' % (
            f['aMin_ms2'], (', %.2f m/s^2 beyond the coast-down: the cruise brakes' % f['brakeMax_ms2']) if f['brakeMax_ms2'] is not None and f['brakeMax_ms2'] > 0.1 else (', no braking beyond the coast-down' if f['brakeMax_ms2'] is not None else ', no coast-down recorded'),
            f['cruise_brakes']['brake_lamp_lit_without_driver'], f['cruise_brakes']['down_steps']))
        en.append('- **Dead time** (display to speed): up %.2f s, down %.2f s. **Time constant:** %.2f / %.2f s. **Max acceleration:** %.2f m/s^2.' % (
            f['deadTime_s'], f['deadTimeDown_s'], f['tau_s'], f['tauDown_s'], f['aMax_ms2']))
        en.append('- **The model** (P2) reproduces the held-out steps to %s km/h: the brief\'s exit (< 0.5) %s. The simulator\'s plant file: `plant.json` (`assumed: false`).' % (
            ' / '.join(str(v['held_out_rms_kmh']) for _, v in sorted(f['validation'].items())) or '-', 'met' if ok else 'NOT met' if ok is False else 'not tested'))
    else:
        en.append('- **No plant identified:** ' + '; '.join(p2['notes']) + '.')
    if fv:
        en.append('- **Vehicle ahead** (`DataFrontVehicle`): native rate %.1f Hz, interval jitter %s ms, longest pause %s ms.' % (fv['rate_hz'], fmt(fv.get('jitter_ms')), fmt(fv.get('longest_gap_ms'))))
    en.append('- **Gap:** ' + (('gapX x %.4f %+.2f = metres (R^2 %.3f, %d points).' % (gap['k'], gap['c'], gap['r2'] or 0, gap['samples'])) if gap else 'not tied to metres (no passenger notes).'))
    en.append('- Silent in this recording: %d fields of the ACC set.' % len(p1['silent']))
    en.append('')
    en.append('Details: `phase1.md`, `phase2.md`, `steps.svg`. Everything here comes from this recording only; until it is repeated on another drive it is one measurement.')
    uk = [re.sub(r'(\d)\.(\d)', r'\1,\2', x) for x in uk]          # Ukrainian decimal commas
    return '\n'.join(uk + en) + '\n'


def acc_tags():
    p = os.path.join(HERE, '..', '..', 'design', 'car', 'probe_fields.json')
    try:
        d = json.load(open(p, encoding='utf-8'))
    except (OSError, ValueError):
        return []
    return sorted(f['tag'] for f in d.get('fields', []) if f.get('set') == 'S17' or 'S17' in (f.get('also') or []))


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--anchors', help='the passenger\'s notes: {"static": [{session, mark, gap_m, hold_s}], "pairs": [{session, lead, us}]}')
    ap.add_argument('--name', default='')
    a = ap.parse_args(argv)
    sessions = load(a.inputs)
    if not sessions:
        print('acc_analyse: no recording found (rec-<session>-<n>.csv[.gz])')
        return 1
    anchors = json.load(open(a.anchors, encoding='utf-8')) if a.anchors else None
    os.makedirs(a.out, exist_ok=True)
    p1 = phase1(sessions, anchors, acc_tags())
    p2, plant, kept = phase2(sessions)
    write_steps(a.out, kept, p2.get('fit'), p2.get('steady_state'))
    for st in p2['steps']:
        for k in ('i0', 'i_start', 'i_end'):
            st.pop(k, None)
    with open(os.path.join(a.out, 'phase1.json'), 'w') as fh:
        json.dump(p1, fh, indent=1)
    with open(os.path.join(a.out, 'phase1.md'), 'w') as fh:
        fh.write(phase1_md(p1))
    with open(os.path.join(a.out, 'phase2.json'), 'w') as fh:
        json.dump(p2, fh, indent=1)
    with open(os.path.join(a.out, 'phase2.md'), 'w') as fh:
        fh.write(phase2_md(p2))
    if plant:
        with open(os.path.join(a.out, 'plant.json'), 'w') as fh:
            json.dump(plant, fh, indent=1)
    with open(os.path.join(a.out, 'summary.md'), 'w') as fh:
        fh.write(summary_md(p1, p2, plant, a.name))
    print('acc_analyse: %d recording(s), %d step(s) kept of %d%s -> %s' % (len(sessions), p2['kept'], len(p2['steps']), ', plant.json written' if plant else ', no plant', a.out))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
