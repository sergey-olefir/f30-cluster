#!/usr/bin/env python3
"""The strip lead (2026-11-16), the owner's decision 1: is BMW's red ring uniform round its sign, and does no rail stub
("whisker") show beside it? Read off our coverage as the engine draws it (package O's replay: alpha_4x.png of a state
where BMW's sign shows), against package ZL's measured sign (photos 60-64, 66-68; continuous panel px):

    centre (538.45, 621.2), red ring out to r 40.95, white face to r 31.54 with its centre 0.37 px to the right,
    BMW's rail at y 647.45 +- 3.25 (its half-max thickness 6.5), cut by BMW itself at r 42.44 from the centre.

Per degree, along the ray from ZL's centre at 0.02 px steps, sampling our coverage bilinearly on the 4x grid:
  red width  = the integral of (1 - our alpha) over the red ring (outside the face, inside the ring's outer edge)
  our edge   = the radius where our coverage crosses 0.5 (and a least-squares circle through those points)
Rail stubs: every 4x sample of BMW's rail band past r 42.44 within r 60 of the centre, and what of it shows.

    python3 tools/strip/sign_check.py <maps root> [layout/mode/state ...]      (numpy, opencv; -> stdout, JSON)
Default states: wb_dials and wb_sport_dials, allG20, drive. Numbers only; no photo is read.
"""
import json
import math
import os
import sys

import cv2
import numpy as np

C = (538.45, 621.2)
R_OUT, R_FACE, FACE_DX = 40.95, 31.54, 0.37
RAIL_Y, RAIL_HALF, RAIL_CUT = 647.45, 3.25, 42.44
N = 4


def coverage(path):
    a = cv2.imread(path, cv2.IMREAD_UNCHANGED).astype(np.float64) / 65535.0     # 7680 x 720, rows from panel y 540

    def at(x, y):
        # sample centres of the 4x grid are at ((k + .5) / 4, 540 + (r + .5) / 4)
        u, v = x * N - 0.5, (y - 540) * N - 0.5
        u0, v0 = np.floor(u).astype(int), np.floor(v).astype(int)
        fu, fv = u - u0, v - v0
        g = lambda i, j: a[np.clip(j, 0, a.shape[0] - 1), np.clip(i, 0, a.shape[1] - 1)]
        return g(u0, v0) * (1 - fu) * (1 - fv) + g(u0 + 1, v0) * fu * (1 - fv) + g(u0, v0 + 1) * (1 - fu) * fv + g(u0 + 1, v0 + 1) * fu * fv
    return a, at


def check(path):
    a, at = coverage(path)
    dr = 0.02
    rs = np.arange(28.0, 46.0, dr)
    widths, own, edges = [], [], []
    for deg in range(360):
        t = math.radians(deg)
        xs, ys = C[0] + rs * math.cos(t), C[1] + rs * math.sin(t)
        al = at(xs, ys)
        face = np.hypot(xs - (C[0] + FACE_DX), ys - C[1]) > R_FACE
        ring = face & (rs < R_OUT)
        widths.append(float(((1 - al) * ring).sum() * dr))
        own.append(float(ring.sum() * dr))
        k = np.nonzero(al >= 0.5)[0]
        k = k[k > 0]
        if len(k):
            i = k[0]
            r0 = rs[i - 1] + (0.5 - al[i - 1]) / max(al[i] - al[i - 1], 1e-9) * dr
            edges.append((C[0] + r0 * math.cos(t), C[1] + r0 * math.sin(t), r0))
    w = np.array(widths)
    o = np.array(own)
    E = np.array(edges)
    # circle through our 0.5 contour: x^2 + y^2 = 2 a x + 2 b y + c
    M = np.c_[2 * E[:, 0], 2 * E[:, 1], np.ones(len(E))]
    sol = np.linalg.lstsq(M, E[:, 0] ** 2 + E[:, 1] ** 2, rcond=None)[0]
    cx, cy = sol[0], sol[1]
    r = math.sqrt(sol[2] + cx * cx + cy * cy)
    res = np.hypot(E[:, 0] - cx, E[:, 1] - cy) - r
    # rail stubs: BMW's rail band past its own cut, within r 60
    ys = 540 + (np.arange(a.shape[0]) + 0.5) / N
    xs = (np.arange(a.shape[1]) + 0.5) / N
    X, Y = np.meshgrid(xs, ys)
    d = np.hypot(X - C[0], Y - C[1])
    rail = (np.abs(Y - RAIL_Y) <= RAIL_HALF) & (d >= RAIL_CUT) & (d <= 60)
    show = (1 - a)[rail]
    return {
        'red_width_px': {'min': round(float(w.min()), 3), 'max': round(float(w.max()), 3), 'mean': round(float(w.mean()), 3),
                         'max_over_min': round(float(w.max() / max(w.min(), 1e-9)), 4),
                         'right_bottom_left_top': [round(widths[a_], 3) for a_ in (0, 90, 180, 270)],
                         'full_ring_would_be': round(R_OUT - R_FACE, 2)},
        # BMW's own ring, nothing of ours over it: its face sits 0.37 px right, so it is 9.04 right / 9.78 left itself
        'bmw_own_width_px': {'min': round(float(o.min()), 3), 'max': round(float(o.max()), 3),
                             'max_over_min': round(float(o.max() / o.min()), 4)},
        'shown_fraction_of_bmw_own': {'min': round(float((w / o).min()), 4), 'max': round(float((w / o).max()), 4)},
        'our_edge': {'centre': [round(cx, 3), round(cy, 3)], 'r': round(r, 3), 'rms': round(float(np.sqrt((res ** 2).mean())), 4),
                     'r_min': round(float(E[:, 2].min()), 3), 'r_max': round(float(E[:, 2].max()), 3)},
        'rail_stubs': {'samples': int(rail.sum()), 'most_shown': round(float(show.max()), 4) if show.size else 0.0,
                       'shown_px_over_0.02': round(float((show > 0.02).sum()) / N ** 2, 2),
                       'sum_shown_px': round(float(show.sum()) / N ** 2, 3)},
    }


def main():
    root = sys.argv[1]
    which = sys.argv[2:] or ['wb_dials/allG20/drive', 'wb_sport_dials/allG20/drive']
    out = {}
    for w in which:
        p = os.path.join(root, w, 'alpha_4x.png')
        if os.path.exists(p):
            out[w] = check(p)
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
