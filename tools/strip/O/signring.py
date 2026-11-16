"""Package O, brief item 3: our coverage round BMW's speed-limit sign, every degree, r 30-60 in 0.25 px steps, on the
current tip and on the parent of 3bfce09 (window r 42, ring reach 8 px), and what that leaves of BMW's sign when
BMW's sign is not exactly where our window is.

    uv run ... --with moderngl --with numpy python -I tools/strip/O/signring.py <snapshot dir> [<out json>]

The coverage comes from render.py (the real shaders at 16 x 16 samples per panel px, every layer that reaches the
region), sampled bilinearly at (cx + r cos t, cy + r sin t), t = 0 at 3 o'clock, growing clockwise on screen (y down).
The parent of 3bfce09 is the same snapshot with exactly the two things that commit changed put back: u_cutW.z 40 -> 42
and the ring's reach "u_cut.w + 10.0, u_cut.w + 12.0" -> "u_cut.w + 8.0, u_cut.w + 10.0" in WBDIAL's source.
"""
import copy
import json
import os
import sys

import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render as RD   # noqa: E402

C = (537.3, 621.3)
REG = (477, 561, 598, 682)
S = 16
# BMW's sign in the bench's backdrops (tools/strip/O/signfit.py on bake/work/overlay/rect, and bench/g20/c.js)
BMW = {
    'photo08': {'c': (539.24, 621.21), 'rIn': 32.18, 'rOut': 41.39, 'cOut': (539.15, 621.63)},
    'photo09': {'c': (538.68, 621.47), 'rIn': 32.09, 'rOut': 41.65, 'cOut': (538.69, 621.85)},
    'photo17': {'c': (537.89, 621.13), 'rIn': 31.79, 'rOut': 41.18, 'cOut': (537.89, 621.71)},
    'photo39': {'c': (538.14, 621.63), 'rIn': 31.55, 'rOut': 41.01, 'cOut': (537.74, 621.74)},
    'g20sim': {'c': (539.3, 621.8), 'rIn': 33.2, 'rOut': 41.0, 'cOut': (539.3, 621.8)},
    # the 2026-11-16 photos on package R's provisional rects (registration rms 0.5-0.7 px), same fit on the 2x panels
    'photo61': {'c': (538.22, 621.58), 'rIn': 31.90, 'rOut': 41.86, 'cOut': (538.06, 621.81)},
    'photo62': {'c': (538.20, 621.65), 'rIn': 32.00, 'rOut': 41.62, 'cOut': (537.97, 621.87)},
    'photo63': {'c': (537.91, 621.79), 'rIn': 32.01, 'rOut': 41.64, 'cOut': (537.76, 621.95)},
    'photo64': {'c': (537.27, 622.73), 'rIn': 31.97, 'rOut': 41.99, 'cOut': (537.20, 622.85)},
    'photo68': {'c': (536.78, 622.35), 'rIn': 31.68, 'rOut': 41.05, 'cOut': (536.41, 622.41)},
    'new_mean': {'c': (537.68, 622.02), 'rIn': 31.91, 'rOut': 41.63, 'cOut': (537.48, 622.18)},
    'concentric': {'c': C, 'rIn': 31.91, 'rOut': 41.63, 'cOut': C},
}


def parent_of_3bfce09(snap):
    p = copy.copy(snap)
    p.layers = copy.deepcopy(snap.layers)
    n = 0
    for l in p.layers:
        u = l.get('uniforms') or {}
        if 'u_cutW' in u and u['u_cutW']['v'][2] > 0:
            u['u_cutW']['v'][2] = 42.0
            a = l['fs'].count('u_cut.w + 10.0, u_cut.w + 12.0')
            l['fs'] = l['fs'].replace('u_cut.w + 10.0, u_cut.w + 12.0', 'u_cut.w + 8.0, u_cut.w + 10.0')
            n += a
    p.by_key = {l['key']: l for l in p.layers}
    p.dir = snap.dir + '#parent'
    return p, n


def field(R, snap):
    r = R.compose(snap, REG, S, per_layer=True)
    return r


def sample(arr, x, y):
    # arr covers REG at S samples per px; sample centre k is at REG.x0 + (k + 0.5) / S
    X = (x - REG[0]) * S - 0.5
    Y = (y - REG[1]) * S - 0.5
    return ndimage.map_coordinates(arr, [Y, X], order=1, mode='nearest')


def ring_table(alpha):
    th = np.radians(np.arange(360.0))
    rs = np.arange(30.0, 60.0001, 0.25)
    T, Rr = np.meshgrid(th, rs)
    X = C[0] + Rr * np.cos(T)
    Y = C[1] + Rr * np.sin(T)
    return rs, sample(alpha, X, Y)          # [r, theta]


def edges(rs, tab, lvl=0.5):
    """Per angle: the first r where coverage reaches lvl (the window's edge) and, past it, the first r where it falls
    below lvl again (the ring's outer edge; nan if it never does inside r 60)."""
    inner, outer = [], []
    for j in range(tab.shape[1]):
        col = tab[:, j]
        i = np.argmax(col >= lvl)
        if col[i] < lvl:
            inner.append(np.nan); outer.append(np.nan); continue
        ri = rs[i - 1] + (lvl - col[i - 1]) / (col[i] - col[i - 1]) * (rs[i] - rs[i - 1]) if i > 0 else rs[0]
        k = i + np.argmax(col[i:] < lvl)
        if col[k] >= lvl:
            ro = np.nan
        else:
            ro = rs[k - 1] + (col[k - 1] - lvl) / (col[k - 1] - col[k]) * (rs[k] - rs[k - 1])
        inner.append(ri); outer.append(ro)
    return np.array(inner), np.array(outer)


def circfit(r_of_t):
    th = np.radians(np.arange(360.0))
    ok = np.isfinite(r_of_t)
    x = C[0] + r_of_t[ok] * np.cos(th[ok])
    y = C[1] + r_of_t[ok] * np.sin(th[ok])
    A = np.c_[2 * x, 2 * y, np.ones(len(x))]
    s = np.linalg.lstsq(A, x * x + y * y, rcond=None)[0]
    r = np.sqrt(s[2] + s[0] ** 2 + s[1] ** 2)
    return float(s[0]), float(s[1]), float(r), float(np.sqrt(np.mean((np.hypot(x - s[0], y - s[1]) - r) ** 2)))


def bmw_left(alpha, b):
    """What of BMW's red ring is left visible, per degree round BMW's own centre: from its face edge outward, the
    length along the ray where our coverage is < 0.5 and BMW's ring is still there."""
    th = np.radians(np.arange(360.0))
    out = []
    for t in th:
        rr = np.arange(b['rIn'], b['rOut'] + 3.0, 0.05)
        x = b['c'][0] + rr * np.cos(t)
        y = b['c'][1] + rr * np.sin(t)
        a = sample(alpha, x, y)
        # BMW's ring outer edge on this ray (its own circle may be a little off its face's centre)
        ox, oy = b['cOut']
        # distance along the ray to BMW's outer circle: solve |c + r u - cOut| = rOut
        ux, uy = np.cos(t), np.sin(t)
        dx, dy = b['c'][0] - ox, b['c'][1] - oy
        bq = dx * ux + dy * uy
        rout = -bq + np.sqrt(bq * bq - (dx * dx + dy * dy - b['rOut'] ** 2))
        vis = (a < 0.5) & (rr <= rout)
        # visible red: contiguous from the face edge
        k = np.argmax(~vis) if (~vis).any() else len(vis)
        red = rr[k - 1] - b['rIn'] + 0.05 if k > 0 else 0.0
        # dark gap: past BMW's ring, still see-through before our ring
        past = (rr > rout) & (a < 0.5)
        out.append((red, float(rout - b['rIn']), float(past.sum() * 0.05)))
    return np.array(out)


def summarise(name, alpha):
    rs, tab = ring_table(alpha)
    ri, ro = edges(rs, tab)
    fi = circfit(ri)
    fo = circfit(ro) if np.isfinite(ro).sum() > 180 else None
    res = {'name': name,
           'window_edge_r50': {'min': float(np.nanmin(ri)), 'max': float(np.nanmax(ri)), 'circle': fi},
           'ring_outer_r50': None if fo is None else {'min': float(np.nanmin(ro)), 'max': float(np.nanmax(ro)), 'circle': fo,
                                                       'open_degrees': int(np.isnan(ro).sum())},
           'by_radius': {}}
    for r in (38, 39, 40, 40.5, 41, 41.5, 42, 42.5, 43, 44, 46, 48, 50, 51, 52, 53, 54, 56, 58, 60):
        i = int(round((r - 30) / 0.25))
        row = tab[i]
        res['by_radius'][str(r)] = {'min': round(float(row.min()), 4), 'max': round(float(row.max()), 4),
                                    'mean': round(float(row.mean()), 4), 'argmin_deg': int(np.argmin(row))}
    res['bmw'] = {}
    for k, b in BMW.items():
        v = bmw_left(alpha, b)
        red = v[:, 0]
        card = {'right_0': round(float(red[0]), 2), 'bottom_90': round(float(red[90]), 2), 'left_180': round(float(red[180]), 2), 'top_270': round(float(red[270]), 2)}
        res['bmw'][k] = {'cardinal': card, 'red_min': round(float(red.min()), 2), 'red_min_deg': int(np.argmin(red)), 'red_max': round(float(red.max()), 2),
                         'red_max_deg': int(np.argmax(red)), 'red_full': round(float(np.median(v[:, 1])), 2),
                         'ratio_max_min': round(float(red.max() / max(red.min(), 1e-6)), 3),
                         'dark_gap_max': round(float(v[:, 2].max()), 2), 'dark_gap_max_deg': int(np.argmax(v[:, 2]))}
    return res, rs, tab


def main():
    snapdir = sys.argv[1]
    R = RD.Renderer()
    snap = RD.Snapshot(snapdir)
    par, n = parent_of_3bfce09(snap)
    if n == 0:
        print('WARNING: the ring reach string was not found in WBDIAL: parent not reproduced')
    out = {'snapshot': snapdir, 'centre': C, 'parent_replacements': n, 'states': []}
    for name, s in (('tip 3c8ef46', snap), ('parent of 3bfce09', par)):
        r = field(R, s)
        res, rs, tab = summarise(name, r['alpha'])
        # which layer holds the window edge and the ring: coverage per layer at r 41.5 and 50, by angle
        per = {}
        for e in r['layers']:
            if e.get('alpha') is None:
                continue
            _, t2 = ring_table(e['alpha'])
            per[e['key']] = {'role': (s.by_key[e['key']].get('kind')), 'max_r41.5': round(float(t2[46].max()), 3),
                             'max_r50': round(float(t2[80].max()), 3), 'max_r55': round(float(t2[100].max()), 3),
                             'max_r60': round(float(t2[120].max()), 3), 'min_r50': round(float(t2[80].min()), 3)}
        res['layers'] = per
        out['states'].append(res)
        print('==', name)
        w = res['window_edge_r50']
        print('  window edge (coverage 0.5): r %.3f..%.3f, fitted circle c (%.3f, %.3f) r %.3f rms %.4f' % (w['min'], w['max'], *w['circle']))
        o = res['ring_outer_r50']
        if o:
            print('  ring outer edge: r %.3f..%.3f, circle c (%.3f, %.3f) r %.3f rms %.4f, open over %d deg' % (o['min'], o['max'], *o['circle'], o['open_degrees']))
        for r_, v in res['by_radius'].items():
            print('   r %5s  min %.4f (at %3d deg) max %.4f mean %.4f' % (r_, v['min'], v['argmin_deg'], v['max'], v['mean']))
        for k, v in res['bmw'].items():
            print('  BMW sign as in %-10s red right/bottom/left/top %s' % (k, '/'.join('%.2f' % x for x in v['cardinal'].values())))
            print('  BMW sign as in %-10s red ring left %.2f..%.2f px (min at %d deg, max at %d deg; full %.2f), ratio %.2f, dark gap up to %.2f px at %d deg'
                  % (k, v['red_min'], v['red_max'], v['red_min_deg'], v['red_max_deg'], v['red_full'], v['ratio_max_min'], v['dark_gap_max'], v['dark_gap_max_deg']))
        for k, v in per.items():
            print('   layer', k, v)
    if len(sys.argv) > 2:
        json.dump(out, open(sys.argv[2], 'w'), indent=1)


if __name__ == '__main__':
    main()
