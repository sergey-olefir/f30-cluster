"""Package D, step 1: the stock G20 scales and pointers, measured on the rectified photos.

  tools/g20sim/D/py bake/src/G20/live/fit_scales.py     ->  bake/work/g20sim/D/fit_scales.json (+ review PNGs)

What it measures (panel px, evidence in brackets):
  * every tick of the speedo (0..260 km/h) and tacho (0..7 x1000) on rect 08 and 09 [strong where seen]: centroid,
    axis, outer and inner end; values assigned from the scale structure (majors every 10 / 20 / 30 km/h, minors every
    2 / 5 / 10 km/h; tacho majors every 0.5, minors every 0.1). Ticks hidden under a pointer or numeral are filled in
    by interpolation along the scale (marked 'interp').
  * the pointer bars (guided ridge fit): tacho at 0 (08), idle (09, 14, 10), speedo at 0 (08, 09, 14).
  * the three pointer models: (A) bars on rays from one virtual centre, (B) bars parallel to the local tick axis,
    (C) bars normal to the scale polyline. Residuals for each.
"""
import json
import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common_live import (SCRATCH, bar_fit, elements, lsq_point, rect, tick_components)  # noqa: E402

os.makedirs(SCRATCH, exist_ok=True)
G = elements()

# rough centres only used to order the ticks along each scale (refined below)
C0 = {'speedo': (444.0, 378.0), 'tacho': (1476.0, 380.0)}
SGN = {'speedo': 1, 'tacho': -1}          # speedo values grow clockwise on screen (angle up), tacho counter-clockwise


def scale_structure(dial):
    """List of tick values in order and the set of major values."""
    if dial == 'speedo':
        vals = list(range(0, 60, 2)) + list(range(60, 140, 5)) + list(range(140, 261, 10))
        majors = set(range(0, 61, 10)) | {80, 100, 120, 140, 170, 200, 230, 260}
    else:
        vals = [round(i * 0.1, 1) for i in range(71)]
        majors = {round(i * 0.5, 1) for i in range(15)}
    return vals, majors


def ang_of(dial, p):
    C = C0[dial]
    a = math.degrees(math.atan2(p[1] - C[1], p[0] - C[0]))
    if dial == 'speedo' and a < 0:
        a += 360
    return SGN[dial] * a


def ticks_for(ph, dial):
    poly = np.array(G['structure.' + dial]['poly'], np.float32)
    out = []
    for t in tick_components(rect(ph)):
        c = t['c']
        dpt = cv2.pointPolygonTest(poly, (float(c[0]), float(c[1])), True)
        if dpt < -3 or dpt > 30:
            continue
        a = ang_of(dial, c)
        lo, hi = (100, 312) if dial == 'speedo' else (-80, 130)
        if not lo < a < hi:
            continue
        # outer end: the axis end farther from the centre
        C = np.array(C0[dial])
        d = t['dir'] if np.dot(t['dir'], c - C) > 0 else -t['dir']
        out.append(dict(ang=a, c=c, d=d, len=t['len'], outer=c + d * (t['len'] - 1) / 2, inner=c - d * (t['len'] - 1) / 2))
    out.sort(key=lambda r: r['ang'])
    return out


def assign(dial, ticks):
    """Give each detected tick its value: majors (len > 14) in order, minors evenly between majors."""
    vals, majors = scale_structure(dial)
    maj = [t for t in ticks if t['len'] > 14]
    majv = sorted(majors)
    # the first detected major: the speedo's 0 is always under its pointer; tacho 0 is seen on 09
    first = 10 if dial == 'speedo' else 0.0
    if dial == 'tacho' and maj and maj[0]['ang'] > -70:
        first = 0.5
    k0 = majv.index(first)
    # majors may be missing (merged with a numeral): place by angle gaps relative to the median major gap per segment
    assigned = []
    k = k0
    prev = None
    for t in maj:
        if prev is not None:
            gap = t['ang'] - prev['ang']
            # expected angular gap ~ 13..18 deg; a double gap means a missing major
            steps = max(1, int(round(gap / 15.0)))
            if dial == 'speedo' and prev['v'] >= 140:
                steps = max(1, int(round(gap / 16.0)))
            k += steps
        if k >= len(majv):
            break
        t['v'] = majv[k]
        assigned.append(t)
        prev = t
    # minors between consecutive assigned majors
    vi = {v: i for i, v in enumerate(vals)}
    for a, b in zip(assigned, assigned[1:]):
        inside = [t for t in ticks if a['ang'] < t['ang'] < b['ang'] and t['len'] <= 14]
        va = [v for v in vals if a['v'] < v < b['v']]
        span = b['ang'] - a['ang']
        for t in inside:
            f = (t['ang'] - a['ang']) / span
            j = int(round(f * (len(va) + 1))) - 1
            if 0 <= j < len(va):
                t['v'] = va[j]
    # minors below the first major (speedo 2..8; tacho none)
    a = assigned[0]
    below = [t for t in ticks if t['ang'] < a['ang'] and t['len'] <= 14]
    if below:
        step_ang = np.median(np.diff([t['ang'] for t in ticks if t['len'] <= 14][:6]))
        for t in below:
            n = int(round((a['ang'] - t['ang']) / step_ang))
            idx = vi[a['v']] - n
            if 0 <= idx:
                t['v'] = vals[idx]
    return [t for t in ticks if 'v' in t]


def merge(dial, per_photo):
    """Average the photos per value; -> {v: dict(outer, inner, c, d, n, photos)}."""
    vals, majors = scale_structure(dial)
    tab = {}
    for ph, ts in per_photo.items():
        for t in ts:
            tab.setdefault(t['v'], []).append((ph, t))
    out = {}
    for v in vals:
        if v not in tab:
            continue
        rows = tab[v]
        outer = np.mean([t['outer'] for _, t in rows], 0)
        inner = np.mean([t['inner'] for _, t in rows], 0)
        c = np.mean([t['c'] for _, t in rows], 0)
        d = np.mean([t['d'] for _, t in rows], 0)
        d /= np.linalg.norm(d)
        spread = float(max(np.linalg.norm(t['c'] - c) for _, t in rows)) if len(rows) > 1 else None
        out[v] = dict(outer=outer, inner=inner, c=c, d=d, major=v in majors, photos=[p for p, _ in rows], spread=spread,
                      len=float(np.mean([t['len'] for _, t in rows])))
    return out


def fill(dial, tab):
    """Interpolate missing ticks (by value, along the measured neighbours); extrapolate the speedo's 0."""
    vals, majors = scale_structure(dial)
    known = [v for v in vals if v in tab]
    full = {}
    for v in vals:
        if v in tab:
            full[v] = dict(tab[v], src='measured')
            continue
        lo = max([k for k in known if k < v], default=None)
        hi = min([k for k in known if k > v], default=None)
        if lo is None:      # extrapolate from the next two
            a, b = known[0], known[1]
            f = (v - a) / (b - a)
            src = 'extrapolated'
        elif hi is None:
            a, b = known[-2], known[-1]
            f = (v - a) / (b - a)
            src = 'extrapolated'
        else:
            a, b = lo, hi
            f = (v - a) / (b - a)
            src = 'interp'
        A, B = tab[a], tab[b]
        rec = {}
        for key in ('outer', 'inner', 'c', 'd'):
            rec[key] = A[key] + (B[key] - A[key]) * f
        rec['d'] = rec['d'] / np.linalg.norm(rec['d'])
        # majors are longer; keep the outer end, rebuild the inner end from the median major / minor length
        rec.update(major=v in majors, photos=[], spread=None, src=src, len=None)
        full[v] = rec
    return full


BAR_GUESS = {
    ('08', 'tacho'): ((1547, 648), (1499, 467)), ('09', 'tacho'): ((1650, 630), (1543, 482)),
    ('14', 'tacho'): ((1652, 627), (1590, 541)), ('10', 'tacho'): ((1650, 600), (1605, 523)),
    # the speedo's lower part is crossed by the '0' of '0 km/h': fit the clean upper part, then extend
    ('08', 'speedo'): ((404, 560), (420, 467)), ('09', 'speedo'): ((404, 560), (420, 467)),
    ('14', 'speedo'): ((404, 560), (420, 467)),
}


def bars():
    out = {}
    for (ph, dial), (po, pi) in BAR_GUESS.items():
        r = bar_fit(rect(ph), po, pi)
        out[ph + '.' + dial] = r
    # the speedo bar is crossed by the '0' of '0 km/h' (y ~ 585-612). Fit its short lower part too (y 615-648, down to
    # the bezel) and join: the line through the upper part's inner end and the lower part's outer end. (The upper
    # part alone gives 13.8 deg and misses the lower part by ~3.5 px: the rectification is not perfectly straight.)
    for ph in ('08', '09', '14'):
        up = out[ph + '.speedo']
        lo = bar_fit(rect(ph), (372, 646), (380, 614))
        o, i = np.array(lo['outer']), np.array(up['inner'])
        d = (i - o) / np.linalg.norm(i - o)
        out[ph + '.speedo'] = dict(up, outer=o.tolist(), dir=d.tolist(), length=float(np.linalg.norm(i - o)),
                                   angle_from_vertical=float(math.degrees(math.atan2(d[0], -d[1]))),
                                   lower_part=lo, upper_angle=up['angle_from_vertical'])
    return out


def main():
    res = {'ticks': {}, 'bars': {}, 'models': {}}
    for dial in ('speedo', 'tacho'):
        per = {}
        for ph in ('08', '09'):
            per[ph] = assign(dial, ticks_for(ph, dial))
        tab = fill(dial, merge(dial, per))
        res['ticks'][dial] = {str(v): {k: (x.tolist() if isinstance(x, np.ndarray) else x) for k, x in r.items()}
                              for v, r in tab.items()}
        n_meas = sum(1 for r in tab.values() if r['src'] == 'measured')
        print('%s: %d ticks, %d measured' % (dial, len(tab), n_meas))
        sp = [r['spread'] for r in tab.values() if r['spread'] is not None]
        print('  08 vs 09 tick centroid spread: median %.2f px, max %.2f px' % (np.median(sp), max(sp)))
    b = bars()
    res['bars'] = b
    for k, r in b.items():
        print('bar %-10s outer (%.1f, %.1f) inner (%.1f, %.1f) len %.1f fwhm %.1f ang %.2f resid %.2f' % (
            k, *r['outer'], *r['inner'], r['length'], r['fwhm'], r['angle_from_vertical'], r['resid_px']))

    # ---- models
    tl = [(b[k]['outer'], b[k]['dir']) for k in ('08.tacho', '09.tacho', '14.tacho')]
    X, rs = lsq_point(tl)
    print('A: tacho bars 08/09/14 meet at (%.1f, %.1f), rms dist %.2f px' % (X[0], X[1], math.sqrt(np.mean(np.square(rs)))))
    tl4 = tl + [(b['10.tacho']['outer'], b['10.tacho']['dir'])]
    X4, rs4 = lsq_point(tl4)
    print('   with 10: (%.1f, %.1f), dists %s' % (X4[0], X4[1], ['%.1f' % r for r in rs4]))
    sl = [(b[k]['outer'], b[k]['dir']) for k in ('08.speedo', '09.speedo', '14.speedo')]
    mirror = (1920 - X[0], X[1])
    for k in ('08.speedo', '09.speedo', '14.speedo'):
        p, d = np.array(b[k]['outer']), np.array(b[k]['dir'])
        dist = abs(np.cross(d, np.array(mirror) - p))
        print('   speedo bar %s passes %.1f px from the mirrored tacho centre (%.1f, %.1f)' % (k, dist, *mirror))
    res['models']['A'] = dict(tacho_centre=X.tolist(), rms=float(math.sqrt(np.mean(np.square(rs)))), with10=X4.tolist(),
                              dists10=rs4, speedo_mirror=list(mirror))
    # common point of the tick axes (majors only: their axis is long enough to trust)
    for dial in ('speedo', 'tacho'):
        T = res['ticks'][dial]
        maj = [(np.array(r['c']), np.array(r['d'])) for v, r in T.items() if r['major'] and r['src'] == 'measured']
        Xt, rt = lsq_point(maj)
        low = [(np.array(r['c']), np.array(r['d'])) for v, r in T.items() if r['major'] and r['src'] == 'measured'
               and ((dial == 'tacho' and float(v) <= 1.5) or (dial == 'speedo' and float(v) <= 40))]
        Xl, rl = lsq_point(low)
        print('ticks %s: majors meet at (%.1f, %.1f) rms %.1f px (n %d); lower majors only (%.1f, %.1f) rms %.1f' % (
            dial, *Xt, math.sqrt(np.mean(np.square(rt))), len(maj), *Xl, math.sqrt(np.mean(np.square(rl)))))
        res['models']['tick_axes_' + dial] = dict(all=Xt.tolist(), rms_all=float(math.sqrt(np.mean(np.square(rt)))),
                                                  low=Xl.tolist(), rms_low=float(math.sqrt(np.mean(np.square(rl)))))
    # B and C at the two tacho poses: compare the bar angle with the local tick axis and the scale normal
    T = res['ticks']['tacho']
    vals = [float(v) for v in T]

    def crossing(p, d):
        """Where the bar line crosses the polyline of tick outer ends: value, point, tick axis, scale tangent."""
        pts = [np.array(T[str(v) if str(v) in T else v]['outer']) for v in T]
        keys = list(T.keys())
        for i in range(len(pts) - 1):
            a, c = pts[i], pts[i + 1]
            M = np.array([d, a - c]).T
            try:
                s, u = np.linalg.solve(M, a - p)
            except np.linalg.LinAlgError:
                continue
            if 0 <= u <= 1:
                v = float(keys[i]) + (float(keys[i + 1]) - float(keys[i])) * u
                da, dc = np.array(T[keys[i]]['d']), np.array(T[keys[i + 1]]['d'])
                dd = da + (dc - da) * u
                tang = (c - a) / np.linalg.norm(c - a)
                return v, a + (c - a) * u, dd / np.linalg.norm(dd), tang
        return None

    def ang(v):
        return math.degrees(math.atan2(v[0], -v[1]))

    rows = []
    for k in ('08.tacho', '09.tacho', '14.tacho'):
        p, d = np.array(b[k]['outer']), np.array(b[k]['dir'])
        cr = crossing(p, d)
        if cr is None:
            continue
        v, P, td, tang = cr
        bar_axis = -d          # outward
        nrm = np.array([tang[1], -tang[0]])
        if np.dot(nrm, bar_axis) < 0:
            nrm = -nrm
        ray = P - X
        rows.append(dict(photo=k, value=v, point=P.tolist(), bar=ang(bar_axis), tick=ang(td), normal=ang(nrm), ray=ang(ray)))
        print('  %s crosses the tick ring at %.2f x1000 (%.1f, %.1f): bar %.2f deg, ray from A %.2f, tick axis %.2f, '
              'scale normal %.2f' % (k, v, P[0], P[1], ang(bar_axis), ang(ray), ang(td), ang(nrm)))
    res['models']['poses'] = rows
    json.dump(res, open(os.path.join(SCRATCH, 'fit_scales.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
