"""Twin Dial round 3b (package KA): the pictograms of the cruise / limiter readout and the renderer that draws any
pictogram in the step format (design/twin-dial/vt/pictograms.js, shared/twin_icons.js) from its distance field.

Our own drawings (MIT, as the rest of VT's set). The step format: unit box, y down, angles in degrees clockwise from 12
o'clock; 'cut' subtracts. Steps: seg (x0, y0, x1, y1, width), ring (cx, cy, r, width), arc (cx, cy, r, a0, a1, width),
disc (cx, cy, r), box (cx, cy, hw, hh, r), boxo (the same, an outline: ..., width), poly ([x, y]..., r = rounding).

The three symbols are drawn to fill the box (ink about 0.92 of it), so "36 px" is the box 38; mockup.cruise_readout asks
for size 38. They are NOT in shared/twin_icons.js yet: the build round moves them into design/twin-dial/vt/pictograms.js.

    PICTOS['cr_cruise'] cruise control: a dial arc, a pointer ending in an arrowhead
    PICTOS['cr_acc']    adaptive cruise: the same, smaller, with a car (seen from behind) ahead of it
    PICTOS['cr_lim']    speed limiter: "LIM" in a rounded frame
"""
import json
import math
import os
import re

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))


def s(k, *a, cut=False, r=None):
    d = {'k': k, 'a': list(a)}
    if cut:
        d['cut'] = True
    if r is not None:
        d['r'] = r
    return d


def _pointer(cx, cy, ang, length, width, head):
    """A pointer from (cx, cy) at `ang` deg for `length` with an arrowhead of `head` length at its tip."""
    t = math.radians(ang)
    ux, uy, nx, ny = math.sin(t), -math.cos(t), math.cos(t), math.sin(t)
    tip = (cx + length * ux, cy + length * uy)
    base = (tip[0] - head * ux, tip[1] - head * uy)
    hw = head * 0.62
    return [s('seg', cx, cy, base[0], base[1], width),
            s('poly', [round(tip[0], 4), round(tip[1], 4)], [round(base[0] + hw * nx, 4), round(base[1] + hw * ny, 4)],
              [round(base[0] - hw * nx, 4), round(base[1] - hw * ny, 4)], r=0.012)]


PICTOS = {
    'cr_cruise': [s('arc', 0.5, 0.56, 0.40, -125, 125, 0.10), s('disc', 0.5, 0.56, 0.085)] + _pointer(0.5, 0.56, 38, 0.34, 0.095, 0.17),
    'cr_acc': [s('arc', 0.5, 0.70, 0.27, -125, 125, 0.09), s('disc', 0.5, 0.70, 0.065)] + _pointer(0.5, 0.70, 38, 0.22, 0.08, 0.13) + [
        # the car ahead, seen from behind: a roof with its window cut out, the body, two wheels
        s('poly', [0.27, 0.27], [0.35, 0.06], [0.65, 0.06], [0.73, 0.27], r=0.02),
        s('poly', [0.355, 0.235], [0.405, 0.115], [0.595, 0.115], [0.645, 0.235], r=0.0, cut=True),
        s('box', 0.5, 0.275, 0.30, 0.06, 0.03),
        s('disc', 0.30, 0.335, 0.05), s('disc', 0.70, 0.335, 0.05)],
    'cr_lim': [s('boxo', 0.5, 0.5, 0.46, 0.31, 0.12, 0.09),
               s('seg', 0.17, 0.36, 0.17, 0.64, 0.085), s('seg', 0.17, 0.64, 0.31, 0.64, 0.085),                     # L
               s('seg', 0.42, 0.36, 0.42, 0.64, 0.085),                                                                # I
               s('seg', 0.53, 0.64, 0.53, 0.36, 0.085), s('seg', 0.53, 0.36, 0.685, 0.56, 0.085),                      # M
               s('seg', 0.685, 0.56, 0.84, 0.36, 0.085), s('seg', 0.84, 0.36, 0.84, 0.64, 0.085)],
}

# ---- the distance-field renderer (the same maths as K2's pages.py, which draws the round-3 pictures) ------------------------
_DRAW = {}


def drawings():
    if not _DRAW:
        src = open(os.path.join(ROOT, 'shared', 'twin_icons.js'), encoding='utf-8').read()
        for m in re.finditer(r'^\s+"(\w+)": (\[.*\]),?\s*$', src, re.M):
            _DRAW[m.group(1)] = json.loads(m.group(2))
        _DRAW.update(PICTOS)
    return _DRAW


def _seg(X, Y, ax, ay, bx, by):
    pax, pay, bax, bay = X - ax, Y - ay, bx - ax, by - ay
    h = np.clip((pax * bax + pay * bay) / ((bax * bax + bay * bay) or 1.0), 0, 1)
    return np.hypot(pax - bax * h, pay - bay * h)


def _box(X, Y, cx, cy, hw, hh, r):
    qx, qy = np.abs(X - cx) - (hw - r), np.abs(Y - cy) - (hh - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def _poly(X, Y, pts):
    d = np.full(X.shape, np.inf)
    inside = np.zeros(X.shape, bool)
    for i in range(len(pts)):
        (xi, yi), (xj, yj) = pts[i], pts[i - 1]
        d = np.minimum(d, _seg(X, Y, xj, yj, xi, yi))
        inside ^= ((yi > Y) != (yj > Y)) & (X < (xj - xi) * (Y - yi) / ((yj - yi) or 1e-12) + xi)
    return np.where(inside, -d, d)


def _step(st, X, Y):
    a, k = st['a'], st['k']
    if k == 'seg':
        return _seg(X, Y, *a[:4]) - a[4] / 2
    if k == 'ring':
        return np.abs(np.hypot(X - a[0], Y - a[1]) - a[2]) - a[3] / 2
    if k == 'arc':
        cx, cy, r, a0, a1, w = a[0], a[1], a[2], math.radians(a[3]), math.radians(a[4]), a[5]
        ang = a0 + np.mod(np.arctan2(X - cx, -(Y - cy)) - a0, 2 * math.pi)
        e0 = np.hypot(X - (cx + r * math.sin(a0)), Y - (cy - r * math.cos(a0)))
        e1 = np.hypot(X - (cx + r * math.sin(a1)), Y - (cy - r * math.cos(a1)))
        return np.where(ang <= a1, np.abs(np.hypot(X - cx, Y - cy) - r), np.minimum(e0, e1)) - w / 2
    if k == 'disc':
        return np.hypot(X - a[0], Y - a[1]) - a[2]
    if k == 'box':
        return _box(X, Y, *a[:5])
    if k == 'boxo':
        return np.abs(_box(X, Y, *a[:5])) - a[5] / 2
    if k == 'poly':
        return _poly(X, Y, a) - (st.get('r') or 0)
    raise ValueError(k)


_ALPHA = {}


def icon_alpha(name, size):
    """The pictogram `name` as a float alpha array (size x size)."""
    if (name, size) not in _ALPHA:
        g = (np.arange(size) + 0.5) / size
        X, Y = np.meshgrid(g, g)
        d = np.full(X.shape, np.inf)
        for st in drawings()[name]:
            p = _step(st, X, Y)
            d = np.maximum(d, -p) if st.get('cut') else np.minimum(d, p)
        _ALPHA[(name, size)] = np.clip(0.5 - d * size, 0, 1)
    return _ALPHA[(name, size)]


def paste_sdf(img, name, size, cx, cy, color=(255, 255, 255), alpha=1.0):
    size = int(round(size))
    a = icon_alpha(name, size) * alpha
    tile = Image.new('RGBA', (size, size), tuple(color) + (0,))
    tile.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    img.paste(tile, (int(round(cx - size / 2)), int(round(cy - size / 2))), tile)
