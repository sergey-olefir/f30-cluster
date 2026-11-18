#!/usr/bin/env python3
"""KC (round 3b): automatic checks on every mockup picture of K1, K2 (r3/) and of KA, KB (r3b/ka, r3b/kb).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/checks_r3b.py
        [--set r3|ka|kb ...] [--out bake/work/twin-dial/mockup/r3b/kc/checks.json]

Two kinds of input. The picture itself (1920 x 720 PNG): keep-outs, the fallback window, the window's sides, the sign.
The ink boxes of our text and icons, recorded while the generator drew the picture (inkrec_r3b.py; <set>'s ink_<set>.json
in r3b/kc/_work/): cells, the title rule, gaps on the dials and in the bottom row, the numerals' clearance.
Every check returns {status: pass | fail | note | skip, ...}; "note" = a measurement without a limit in the specifications.
The thresholds are those of docs/twin-dial/MOCKUP-SPEC-R3B.md §1 and §5 (KC 1) and SPEC-R3 §8 / SPEC rev 2 §5.3.
"""
import argparse
import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MOCK = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'mockup')
KC = os.path.join(MOCK, 'r3b', 'kc')

W, H = 1920, 720
R = 300.0
CT, CS = (380.0, 400.0), (1540.0, 400.0)
BELT = (497, 660, 688, 720)
GEAR_GAP = (1380, 660, 1460, 720)
BLACK_BOX = (1420, 320, 1611, 440)
STORED_MARK = (1240, 588, 1288, 630)
FALLBACK_BBOX = (696, 595.75, 1226, 704)
WINDOW = (729, 172, 1191, 613)
BAR = (618, 127, 1302, 172)
SEP_CANDIDATES = (744, 780, 812, 848, 1168, 1237)
SEP_WIDTH = 4                                    # a dark column and a light line 3 px to its right
TITLE_RULE = (739, 295, 1181, 297.5)
PANEL_RGB = (70, 78, 90)                         # the bench's stand-in for BMW's panel (pages.bmw_panel)
SIGN_C, SIGN_R = (1300.0, 672.0), 33.0
SIGN_NUMBERS = {'stored_marker': 10.7, 'our_ink': 26.0, 'fallback_window': 41.0, 'gear_gap': 47.0, 'panel_bottom': 15.0}
CORNER_PX = 1                                    # see ck_keepouts
FAINT = 6                                        # levels: below this a "non-black" pixel is Lanczos ringing of the 3x reduction


def load_json(p, default=None):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return default


LAYOUT = load_json(os.path.join(ROOT, 'design', 'twin-dial', 'vg', 'layout.json'), {})
HOLES = [tuple(r) for r in LAYOUT.get('keep_outs', {}).get('telltales_holes', {}).get('rects_plus_3px', [])]
PANEL_POLY = load_json(os.path.join(ROOT, 'design', 'twin-dial', 'vf', 'message_panel.json'), {}).get('fallback_window', {}).get('polygon_px', [])


# ---- geometry helpers ------------------------------------------------------------------------------------------------
def gap(a, b):
    """Black between two boxes (x0, y0, x1, y1); negative = overlap (the mockup's own rule, mockup._gap)."""
    dx = max(b[0] - a[2], a[0] - b[2])
    dy = max(b[1] - a[3], a[1] - b[3])
    return max(dx, dy)


def box_centre(b):
    return ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0)


def dist_pt_rect(p, r):
    dx = max(r[0] - p[0], 0, p[0] - r[2])
    dy = max(r[1] - p[1], 0, p[1] - r[3])
    return math.hypot(dx, dy)


def dist_pt_seg(p, a, b):
    ax, ay, bx, by = a[0], a[1], b[0], b[1]
    vx, vy = bx - ax, by - ay
    t = 0.0 if vx == vy == 0 else max(0.0, min(1.0, ((p[0] - ax) * vx + (p[1] - ay) * vy) / (vx * vx + vy * vy)))
    return math.hypot(p[0] - (ax + t * vx), p[1] - (ay + t * vy))


def inside_poly(p, poly):
    x, y, c = p[0], p[1], False
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def dist_pt_poly(p, poly):
    if inside_poly(p, poly):
        return 0.0
    return min(dist_pt_seg(p, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))


def poly_mask():
    m = np.zeros((H, W), bool)
    if not PANEL_POLY:
        return m
    xs = [p[0] for p in PANEL_POLY]
    ys = [p[1] for p in PANEL_POLY]
    for y in range(int(min(ys)), int(max(ys)) + 1):
        for x in range(int(min(xs)), int(max(xs)) + 1):
            if inside_poly((x + 0.5, y + 0.5), PANEL_POLY):
                m[y, x] = True
    return m


_PMASK = None


def panel_mask():
    global _PMASK
    if _PMASK is None:
        _PMASK = poly_mask()
    return _PMASK


# ---- ink ------------------------------------------------------------------------------------------------------------
def is_badge(it):
    """The picture's own name / data-status label, top right (pages.Page.finish): not part of the design."""
    return it['kind'] == 'text' and it['box'][1] < 70 and it['box'][0] > 1100 and it.get('size', 0) <= 20


def design_ink(ink):
    return [it for it in ink if not is_badge(it)]


def dial_of(box):
    c = box_centre(box)
    for name, cc in (('tach', CT), ('speed', CS)):
        if math.hypot(c[0] - cc[0], c[1] - cc[1]) <= R:
            return name, cc
    return None, None


# ---- the checks --------------------------------------------------------------------------------------------------------
def ck_keepouts(img):
    out, bad, corner = {}, False, False
    for name, r in [('belt_group', BELT), ('gear_gap', GEAR_GAP)] + [('hole_%d' % i, h) for i, h in enumerate(HOLES)]:
        a = img[int(r[1]):int(math.ceil(r[3])), int(r[0]):int(math.ceil(r[2]))].max(-1)
        strict, strong = int((a > 0).sum()), int((a >= FAINT).sum())
        out[name] = dict(nonblack=strict, nonblack_ge6=strong, max=int(a.max()) if a.size else 0)
        if strong:
            ys, xs = np.nonzero(a >= FAINT)
            out[name]['at'] = [[int(x + r[0]), int(y + r[1])] for x, y in zip(xs[:4], ys[:4])]
        if strong > (CORNER_PX if name.startswith('hole') else 0):
            bad = True
        elif strong:
            corner = True
    return dict(status='fail' if bad else 'note' if corner else 'pass', rects=out,
                rule='0 non-black pixels (levels < %d are Lanczos ringing of the 3x reduction and are reported in nonblack only); '
                     'at most %d px in a hole = the right dial ring\'s antialiased edge grazing the +3 px rectangle of the lamp at its corner '
                     '(geometry of VG, the same in 0.1.0 and in every picture): a note, not a failure' % (FAINT, CORNER_PX))


def seps_of(img):
    found = []
    for x in SEP_CANDIDATES:
        col = img[134:164, x].astype(float)
        right = img[134:164, x + 1:x + 4].astype(float)
        if (col.max(-1) <= 28).mean() > 0.7 and right.mean() > 55 and right.mean() > col.mean() + 40:
            found.append(x)
    return found


def ck_cells(img, ink):
    """Every text and icon of the tab bar lies wholly in one cell: between the separators (dark column + light line) and
    the bar's ends; no ink crosses a separator."""
    seps = seps_of(img)
    edges = [BAR[0]] + [s + SEP_WIDTH for s in seps] + [BAR[2]]
    rights = [s for s in seps] + [BAR[2]]
    cells = list(zip(edges[:-1], rights))
    items, bad, tight = [], [], []
    for it in design_ink(ink):
        b = it['box']
        if not (b[1] >= 120 and b[3] <= 178 and b[0] >= BAR[0] - 8 and b[2] <= BAR[2] + 8):
            continue
        cx = box_centre(b)[0]
        cell = next(((l, r) for l, r in cells if l - SEP_WIDTH <= cx <= r), None)
        if cell is None:
            continue
        gl, gr = b[0] - cell[0], cell[1] - b[2]
        rec = dict(kind=it['kind'], text=it.get('text'), box=b, cell=list(cell), gap_left=round(gl, 1), gap_right=round(gr, 1))
        items.append(rec)
        if min(gl, gr) < 0:
            bad.append(rec)
        elif min(gl, gr) < 4:
            tight.append(rec)
    return dict(status='fail' if bad else 'pass', separators=seps, items=len(items), crossing=bad,
                tight_lt4px=tight, note='separators are detected in the picture; a missing one (tab removed) joins its cells')


MAP_PIC = re.compile(r'^(5[A-K]|T0?5\b|T5_|map)', re.I)


def ck_centre(img, ink, pid):
    """The centre page: our ink inside the window sides [729, 1191], nothing crossing the title rule, the columns beside the
    window black (the map pictures excepted: BMW's map, drawn as a stand-in, is wider than our window by design)."""
    bad, outside = [], []
    for it in design_ink(ink):
        b = it['box']
        c = box_centre(b)
        if not (WINDOW[1] <= c[1] <= WINDOW[3] and 690 <= c[0] <= 1230):
            continue
        if b[0] < WINDOW[0] - 1.0 or b[2] > WINDOW[2] + 1.0:
            outside.append(dict(kind=it['kind'], text=it.get('text'), box=b))
        if b[3] > TITLE_RULE[1] and b[1] < TITLE_RULE[3] and b[2] > TITLE_RULE[0] and b[0] < TITLE_RULE[2] and b[1] > 280:
            bad.append(dict(kind=it['kind'], text=it.get('text'), box=b))
    side = {}
    for name, (x0, x1) in (('left', (688, 728)), ('right', (1193, 1232))):
        a = img[176:590, x0:x1 + 1].max(-1)       # above BMW's panel (595.75): its footprint is wider than our window
        side[name] = int((a >= FAINT).sum())
    mapp = bool(MAP_PIC.match(pid))
    fail = bool(bad or outside or (not mapp and sum(side.values())))
    return dict(status='fail' if fail else 'pass', outside_window=outside, crossing_title_rule=bad, side_columns_px=side,
                side_columns_checked=not mapp)


def merge_items(items, hgap=12.0):
    """items: (box, font size). A number and its unit (same row, < hgap apart, the unit's font at most 0.65 of the number's)
    are one item."""
    items = sorted(items, key=lambda it: (round(it[0][3] / 6), it[0][0]))
    out = []
    for b, sz in items:
        if out and abs(out[-1][0][3] - b[3]) < 6 and 0 <= b[0] - out[-1][0][2] < hgap and sz <= 0.65 * out[-1][1]:
            o, osz = out[-1]
            out[-1] = ((min(o[0], b[0]), min(o[1], b[1]), max(o[2], b[2]), max(o[3], b[3])), osz)
        else:
            out.append((tuple(b), sz))
    return [b for b, _ in out]


def ck_dial_gaps(ink):
    """>= 4 px between any two ink boxes of one dial (numerals, hub text, bars' labels, icons); numerals keep >= 4 px to the
    tick strip (rho 0.893) and to the band's inner edge (0.5795 R)."""
    res = {}
    worst = 99.0
    bad = []
    for name, c in (('tach', CT), ('speed', CS)):
        items = []
        for it in design_ink(ink):
            b = it['box']
            bc = box_centre(b)
            if math.hypot(bc[0] - c[0], bc[1] - c[1]) <= R and not (b[1] < 178 and BAR[0] <= bc[0] <= BAR[2]):
                items.append(it)
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                g = gap(items[i]['box'], items[j]['box'])
                if g < worst:
                    worst = g
                if g < 4.0:
                    bad.append(dict(dial=name, a=items[i].get('text') or items[i]['kind'], b=items[j].get('text') or items[j]['kind'], gap=round(g, 1)))
        nums = [it for it in items if it['kind'] == 'text' and re.fullmatch(r'\d+', it['text'])
                and 0.62 * R <= math.hypot(*(a - b for a, b in zip(box_centre(it['box']), c))) <= 0.86 * R]
        outer = inner = 99.0
        for it in nums:
            x0, y0, x1, y1 = it['box']
            far = max(math.hypot(x - c[0], y - c[1]) for x in (x0, x1) for y in (y0, y1))
            near = dist_pt_rect(c, it['box'])
            outer, inner = min(outer, 0.893 * R - far), min(inner, near - 0.5795 * R)
        res[name] = dict(items=len(items), numerals=len(nums), to_strip=round(outer, 1) if nums else None, to_band_inner=round(inner, 1) if nums else None)
        if nums and (outer < 4.0 or inner < 4.0):
            bad.append(dict(dial=name, rule='numeral clearance to the strip / band edge', to_strip=round(outer, 1), to_band_inner=round(inner, 1)))
    return dict(status='fail' if bad else 'pass', min_gap=round(worst, 1) if worst < 99 else None, dials=res, failing=bad)


def ck_bottom_row(img, ink, sign):
    """>= 6 px between the items of the bottom row (a number and its unit count as one) and round the sign."""
    boxes = [(it['box'], it.get('size', 0)) for it in design_ink(ink)
             if it['kind'] == 'text' and it['box'][1] >= 615 and 620 <= box_centre(it['box'])[0] <= 1295 and 'BMW' not in it['text']]
    items = merge_items(boxes)
    if sign:
        items.append(sign['box'])
    worst, bad = 99.0, []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            g = gap(items[i], items[j])
            worst = min(worst, g)
            if g < 6.0:
                bad.append(dict(a=[round(v, 1) for v in items[i]], b=[round(v, 1) for v in items[j]], gap=round(g, 1)))
    return dict(status='fail' if bad else 'pass', items=len(items), min_gap=round(worst, 1) if worst < 99 else None, failing=bad)


def panel_open(img):
    pm = panel_mask()
    sel = img[pm]
    return float((np.abs(sel.astype(int) - np.array(PANEL_RGB)).max(-1) <= 6).mean()) > 0.5


def ck_window(img, ink):
    """While BMW's panel is drawn open, nothing of ours inside the fallback window (the panel's own label excepted)."""
    if not panel_open(img):
        return dict(status='skip', reason='the fallback window is not drawn open in this picture')
    pm = panel_mask()
    lab = [it['box'] for it in ink if it['kind'] == 'text' and 'BMW' in it['text']]
    lab = lab[0] if lab else (800, 632, 1095, 668)
    m = pm.copy()
    pad = np.pad(m, 2)
    for dy in range(-2, 3):                          # erode 2 px: the polygon's own antialiased edge is not ours
        for dx in range(-2, 3):
            m &= pad[2 + dy:2 + dy + H, 2 + dx:2 + dx + W]
    m[int(lab[1]) - 5:int(lab[3]) + 6, int(lab[0]) - 5:int(lab[2]) + 6] = False
    d = np.abs(img.astype(int) - np.array(PANEL_RGB)).max(-1)
    alien = m & (d > 12)
    n = int(alien.sum())
    ours = []
    for it in design_ink(ink):
        b = it['box']
        if it['kind'] == 'text' and 'BMW' in it['text']:
            continue
        pts = [(b[0], b[1]), (b[2], b[1]), (b[0], b[3]), (b[2], b[3])]
        if any(inside_poly(p, PANEL_POLY) for p in pts):
            ours.append(dict(kind=it['kind'], text=it.get('text'), box=b))
    ys, xs = np.nonzero(alien)
    return dict(status='fail' if n or ours else 'pass', alien_px=n, bbox=[int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if n else None, ink_boxes_inside=ours)


def find_sign(img):
    """The speed-limit sign by its red ring near (1300, 672): the measured centre and outer radius, or None."""
    x0, y0, x1, y1 = 1230, 600, 1370, 720
    sub = img[y0:y1, x0:x1].astype(int)
    red = np.abs(sub - np.array([214, 13, 18])).max(-1) <= 28           # the ring's red; the severity rule (176, 7, 30) is not it
    if red.sum() < 150:
        return None
    ys, xs = np.nonzero(red)
    cx, cy = (xs.min() + xs.max() + 1) / 2.0 + x0, (ys.min() + ys.max() + 1) / 2.0 + y0
    r = max(xs.max() - xs.min() + 1, ys.max() - ys.min() + 1) / 2.0
    box = (cx - r, cy - r, cx + r, cy + r)
    return dict(centre=(round(cx, 2), round(cy, 2)), r=round(r, 2), box=box)


COOLANT_ICON = (1526, 579, 1554, 609)
GREEN = (60, 155, 34)


def nearest_ink(img, box, skip_boxes=(), reach=60, level=40):
    """Distance (px) from `box` to the nearest non-black pixel of the picture outside `box` and `skip_boxes` (each grown by 2 px)."""
    x0, y0 = int(max(0, box[0] - reach)), int(max(0, box[1] - reach))
    x1, y1 = int(min(W, box[2] + reach)), int(min(H, box[3] + reach))
    sub = img[y0:y1, x0:x1].max(-1) > level
    ys, xs = np.mgrid[y0:y1, x0:x1]
    px, py = xs + 0.5, ys + 0.5
    for b in [box] + list(skip_boxes):
        sub &= ~((px >= b[0] - 2) & (px <= b[2] + 2) & (py >= b[1] - 2) & (py <= b[3] + 2))
    if not sub.any():
        return None
    dx = np.maximum(np.maximum(box[0] - px[sub], px[sub] - box[2]), 0)
    dy = np.maximum(np.maximum(box[1] - py[sub], py[sub] - box[3]), 0)
    return float(np.hypot(dx, dy).min())


def ck_readout(img, ink):
    """The cruise / limiter readout in the speedometer hub (SPEC-R3 §9): the green or grey set speed with its unit and the
    function's symbol. Found by the recorded ink (text in green (60, 155, 34) or grey 227 at Saira 40 / Noto 19, the icon beside
    it). Reports the union box, its clearance to the G20's black box, to the gear gap, and to the nearest ink of ours (pixels)."""
    its = [it for it in design_ink(ink) if it['kind'] == 'text' and 1440 <= it['box'][0] <= 1660 and 480 <= it['box'][1] <= 660
           and it.get('fill') in (list(GREEN), [227, 227, 227]) and it.get('size') in (40.0, 19.0)]
    if not its:
        return dict(status='skip', reason='no cruise / limiter readout in the picture')
    num = max(its, key=lambda i: i['size'])
    nb = num['box']
    icons = [it for it in design_ink(ink) if it['kind'] == 'icon' and 1440 <= it['box'][0] <= 1660 and 480 <= it['box'][1] <= 660
             and all(abs(a - b) > 3 for a, b in zip(it['box'], COOLANT_ICON)) and abs(box_centre(it['box'])[1] - box_centre(nb)[1]) <= 30]
    boxes = [i['box'] for i in its] + [i['box'] for i in icons]
    u = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    others = [it for it in design_ink(ink) if it['box'] not in boxes and math.hypot(*(a - b for a, b in zip(box_centre(it['box']), CS))) <= R]
    gaps = [(gap(u, o['box']), o.get('text') or o['kind']) for o in others]
    g_ink, who = min(gaps)
    near = nearest_ink(img, u, reach=50)
    disc = (1540.0, 528.0, 45.0)
    far = max(math.hypot(x - disc[0], y - disc[1]) for x in (u[0], u[2]) for y in (u[1], u[3]))
    bad = g_ink < 4.0 or (near is not None and near < 4.0)
    return dict(status='fail' if bad else 'note', readout_box=[round(v, 1) for v in u], items=[i.get('text') or 'symbol' for i in its] + ['symbol'] * len(icons),
                to_black_box_px=round(gap(u, BLACK_BOX), 1), to_gear_gap_px=round(gap(u, GEAR_GAP), 1),
                to_nearest_ink_box_px=round(g_ink, 1), nearest_ink_box=who, to_nearest_ink_pixel_px=None if near is None else round(near, 1),
                farthest_corner_from_disc_centre_px=round(far, 1), disc_r_spec=45.0,
                rule='>= 4 px to every other ink of the dial; the spec quotes 14 px (disc to ink) and 52 px (disc to the black box)')


def ck_sign(img, ink):
    s = find_sign(img)
    if not s:
        return dict(status='skip', reason='no red-ringed sign in the picture'), None
    (cx, cy), r = s['centre'], s['r']
    d = {}
    d['stored_marker'] = dist_pt_rect((cx, cy), STORED_MARK) - r
    d['gear_gap'] = dist_pt_rect((cx, cy), GEAR_GAP) - r
    d['panel_bottom'] = H - cy - r
    d['fallback_window'] = float(gap(s['box'], FALLBACK_BBOX))      # SV: the sign's box to the window's bbox (x 1226)
    # our ink: every non-black pixel outside the sign and its own parts (a dot under a conditional sign, 8 px), the nearest
    sub = img[560:720, 1180:1480].max(-1) > 40
    ys, xs = np.nonzero(sub)
    px = np.stack([xs + 1180 + 0.5, ys + 560 + 0.5], 1)
    dd = np.hypot(px[:, 0] - cx, px[:, 1] - cy)
    keep = dd > r + 2.5                                # the sign and its antialiasing
    keep &= ~((np.abs(px[:, 0] - cx) < 9) & (px[:, 1] > cy + r - 3) & (px[:, 1] < cy + r + 14))   # a conditional sign's dot under it
    # the bottom row's own text is "our ink" too, as is the right dial's ring; BMW's panel stand-in is not
    if panel_open(img):
        pm = panel_mask()
        keep &= ~pm[(px[:, 1] - 0.5).astype(int), (px[:, 0] - 0.5).astype(int)]
    d['our_ink'] = float(dd[keep].min() - r) if keep.any() else None
    rows = {}
    d['fallback_polygon_note'] = dist_pt_poly((cx, cy), PANEL_POLY) - r if PANEL_POLY else None
    for k, v in d.items():
        if k not in SIGN_NUMBERS:
            rows[k] = dict(measured=None if v is None else round(v, 1), spec=None, ok=None)
            continue
        spec = SIGN_NUMBERS[k]
        rows[k] = dict(measured=None if v is None else round(v, 1), spec=spec, ok=None if v is None else abs(v - spec) <= 1.5)
    bad = [k for k, v in rows.items() if v['ok'] is False]
    return dict(status='fail' if bad else 'pass', centre=s['centre'], r=r, clearances_px=rows, differ=bad,
                rule='SPEC-R3 §8: 10.7 / 26 / 41 / 47 / 15 px (tolerance 1.5 px)'), s


def markers(img):
    """The speedometer's two scale markers by colour: red (181, 26, 17) and green (60, 155, 34) in the strip's annulus."""
    n = 2 * int(R * 1.05)
    x0, y0 = int(CS[0] - n / 2), int(CS[1] - n / 2)
    sub = img[y0:y0 + n, x0:x0 + n].astype(int)
    ys, xs = np.mgrid[0:n, 0:n]
    rho = np.hypot(xs + x0 + 0.5 - CS[0], ys + y0 + 0.5 - CS[1]) / R
    ann = (rho >= 0.88) & (rho <= 0.995)
    red = ann & (np.abs(sub - np.array([181, 26, 17])).max(-1) <= 24)
    grn = ann & (np.abs(sub - np.array([60, 155, 34])).max(-1) <= 30)
    return red, grn


def ck_markers(img, meta):
    """The limit's red marker and the cruise's green one never overlap when >= 2 degrees apart (needs the angles: the
    picture's index entry carries limit / set in km/h)."""
    lim, st = meta.get('limit'), meta.get('set')
    if lim is None or st is None:
        return dict(status='skip', reason='no limit and set speed together in the index entry')

    def ang(v):
        return -125.0 + 1.25 * v if v <= 100 else 0.625 * (v - 100)
    da = abs(ang(lim) - ang(st))
    red, grn = markers(img)
    if not red.any() or not grn.any():
        return dict(status='note', delta_deg=round(da, 2), red_px=int(red.sum()), green_px=int(grn.sum()), reason='one of the markers is not found by colour')
    touch = red.copy()
    g = grn
    pad = np.pad(g, 1)
    near = np.zeros_like(g)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            near |= pad[1 + dy:1 + dy + g.shape[0], 1 + dx:1 + dx + g.shape[1]]
    overlap = int((red & near).sum())
    return dict(status=('fail' if (da >= 2.0 and overlap) else 'pass' if da >= 2.0 else 'note'), delta_deg=round(da, 2), touching_px=overlap,
                rule='no touching when the markers are >= 2 degrees apart; at the same angle they sit side by side in two annuli')


# ---- driver ----------------------------------------------------------------------------------------------------------------
ANNOTATED = re.compile(r'(black_box|_annotated|clearances_annotated|_keepouts|protected_zones|_annot|_sheet|/close/|/v1/|/lookC/|/_work/|scratch|/pub/)')
ID_OK = re.compile(r'^(A0\d|L\d\d|C0\d|C10|T\d\d|T\d+_|1[A-K]|2[A-K]|2S[1-6]|2T|3[A-G]|4[A-J]|5[A-K]|Z0[1-4]|C00|[0-8]\d_|Lab?|La|Lb|Lc|Ld|\d[A-M]_|V\d|S\d)')

SETS = {
    'r3': dict(root=os.path.join(MOCK, 'r3'), ink=os.path.join(KC, '_work', 'ink_r3.json'), ink_prefix='r3/', index=os.path.join(MOCK, 'r3', 'index.json')),
    'ka': dict(root=os.path.join(MOCK, 'r3b', 'ka'), ink=os.path.join(KC, '_work', 'ink_ka.json'), ink_prefix='r3b/ka/', index=os.path.join(MOCK, 'r3b', 'ka', 'index.json')),
    'kbf': dict(root=os.path.join(KC, 'kb_final'), ink=os.path.join(KC, '_work', 'ink_kbf.json'), ink_prefix='r3b/kb/', index=os.path.join(KC, 'kb_final', 'index.json')),
    'z': dict(root=os.path.join(KC, 'z'), ink=os.path.join(KC, '_work', 'ink_z.json'), ink_prefix='r3b/kc/z/', index=os.path.join(KC, 'z', 'index.json')),
    'kb': dict(root=os.path.join(MOCK, 'r3b', 'kb'), ink=os.path.join(KC, '_work', 'ink_kb.json'), ink_prefix='r3b/kb/', index=os.path.join(MOCK, 'r3b', 'kb', 'index.json')),
}


def index_meta(index_path):
    d = load_json(index_path, {})
    items = d.get('pictures') if isinstance(d, dict) and 'pictures' in d else d.get('variants') if isinstance(d, dict) else d
    meta = {}
    for it in items or []:
        if isinstance(it, dict) and 'file' in it:
            meta[it['file']] = it
        elif isinstance(it, dict) and 'id' in it:
            meta[it.get('file') or it['id']] = it
    import re as _re
    for k, v in meta.items():
        base = os.path.basename(k)
        ml, ms = _re.search(r'limit_?(\d+)', base), _re.search(r'set_?(\d+)', base)
        if 'equals_limit' in base:
            ml = ms = _re.search(r'(\d+)\.png', base)
        if ml and v.get('limit') is None:
            v['limit'] = int(ml.group(1))
        if ms and v.get('set') is None:
            v['set'] = int(ms.group(1))
    return meta


def pictures(root, top_only=False):
    out = []
    for dp, dn, fn in os.walk(root):
        rel = os.path.relpath(dp, root)
        dn[:] = [d for d in dn if d not in ('v1', 'lookC', 'close', 'closeup', 'annotated', '_work', 'pub', 'sheets')]
        if top_only and rel != '.':
            continue
        for f in sorted(fn):
            if not f.endswith('.png'):
                continue
            p = os.path.join(dp, f)
            if ANNOTATED.search(p.replace(root, '')) or ANNOTATED.search('/' + f):
                continue
            try:
                with Image.open(p) as im:
                    if im.size != (W, H):
                        continue
            except Exception:
                continue
            out.append(p)
    return sorted(out)


def ck_naming(rel, m):
    """MOCKUP-SPEC-R3B §1: a file name starts with the picture's id (the index entry's id)."""
    base = os.path.basename(rel)
    pid = m.get('id')
    if not pid:
        return dict(status='note', reason='no id in the index entry')
    return dict(status='pass' if base.startswith(str(pid)) else 'fail', id=pid, file=base)


def run_set(name):
    cfg = SETS[name]
    if not os.path.isdir(cfg['root']):
        return None
    ink_all = load_json(cfg['ink'], {})
    if name == 'r3':                                 # K1's dial pictures were recorded in a second run
        ink_all.update(load_json(os.path.join(KC, '_work', 'ink_r3_k1.json'), {}))
    meta = index_meta(cfg['index'])
    res = {}
    for p in pictures(cfg['root'], cfg.get('top_only', False)):
        rel = os.path.relpath(p, cfg['root'])
        pid = os.path.splitext(os.path.basename(p))[0]
        img = np.asarray(Image.open(p).convert('RGB'))
        ink = ink_all.get(cfg['ink_prefix'] + rel)
        m = meta.get(rel) or meta.get(os.path.basename(p)) or meta.get(pid) or {}
        if m.get('composite'):                       # a sheet of several frames: each frame is a picture of its own elsewhere
            checks = {'composite': dict(status='skip', reason='composite picture (several frames): frame checks do not apply')}
            if name != 'r3':
                checks['naming'] = ck_naming(rel, m)
            res[rel] = dict(id=pid, file=rel, composite=True, checks=checks, failed=[k for k, v in checks.items() if v['status'] == 'fail'])
            continue
        checks = {'keepouts': ck_keepouts(img), 'window_open_nothing_ours': ck_window(img, ink or [])}
        sign_res, sign = ck_sign(img, ink or [])
        checks['sign_clearances'] = sign_res
        checks['markers'] = ck_markers(img, m)
        checks['readout'] = ck_readout(img, ink) if ink is not None else dict(status='skip', reason='no ink record')
        if ink is not None:
            checks['cells'] = ck_cells(img, ink)
            checks['centre_page'] = ck_centre(img, ink, pid)
            checks['dial_gaps'] = ck_dial_gaps(ink)
            checks['bottom_row_gaps'] = ck_bottom_row(img, ink, sign)
        else:
            for k in ('cells', 'centre_page', 'dial_gaps', 'bottom_row_gaps'):
                checks[k] = dict(status='skip', reason='no ink record for this picture (generator not recorded)')
        if name != 'r3':
            checks['naming'] = ck_naming(rel, m)
        checks['documentation'] = dict(status='pass' if (m.get('status') or m.get('data') or m.get('data_status')) else 'note',
                                       reason='index entry carries a data status' if (m.get('status') or m.get('data') or m.get('data_status')) else 'no data status in the index entry')
        res[rel] = dict(id=pid, file=rel, checks=checks, failed=[k for k, v in checks.items() if v['status'] == 'fail'])
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--set', nargs='*', default=['r3', 'ka', 'kb'])
    ap.add_argument('--out', default=os.path.join(KC, 'checks.json'))
    a = ap.parse_args()
    allres = {}
    for s in a.set:
        r = run_set(s)
        if r is None:
            print('set %s: no pictures yet' % s)
            continue
        allres[s] = r
        fails = {k: v['failed'] for k, v in r.items() if v['failed']}
        print('set %s: %d pictures, %d with a failing check' % (s, len(r), len(fails)))
        for k, v in fails.items():
            print('   ', k, v)
    summary = {s: {k: v['failed'] for k, v in r.items() if v['failed']} for s, r in allres.items()}
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, 'w') as f:
        json.dump(dict(generator='tools/twin-dial/mockup/checks_r3b.py', sets=allres, failing=summary), f, indent=1, ensure_ascii=False,
                  default=lambda o: o.item() if hasattr(o, 'item') else str(o))
    print('wrote', a.out)


if __name__ == '__main__':
    main()
