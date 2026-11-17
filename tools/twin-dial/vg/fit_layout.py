"""VG: place the two facelift dials on the G20 panel (1920 x 720) and report every clearance.

No photo pixels: the inputs are numbers (dial units from VD / VF, or VG's provisional reading) and the G20's
keep-outs, which are copied here from the tracked sources named next to each one.

    python3 tools/twin-dial/vg/fit_layout.py [--dial design/twin-dial/vg/dial_units.json] [--out layout.json]

Model of one dial (dial units, R = the bezel ring's centre line):
  * the bezel ring: arc of radius ring_out (outer edge of the white ring incl. its anti-aliasing) from -theta_end to
    +theta_end degrees (clockwise from 12 o'clock); must be fully visible: below the hood line + HOOD_MARGIN;
  * the dial's disc and base: the polygon made of that arc closed by the chord between its ends, then the base
    furniture box [base_x0, base_y0, base_x1, base_y1] (labels and bars under the dial; dial units, from the
    centre). Our content: it must stay KEEP px off every BMW keep-out.
Search: symmetric about x = 960 (the references are), centre distance d = k * R with k free in [k_min, k_max];
for each R the best (cy, k) by the smallest |k - k_ref| among feasible ones; the answer is the largest feasible R.
"""
import argparse
import json
import math

PANEL_W, PANEL_H = 1920, 720
# shared/visible.js HOOD: the first visible y along x (grid photo, homography residual 3.5 px)
HOOD = [[0, 200], [100, 145], [200, 94], [300, 52], [400, 33], [500, 24], [600, 19], [700, 13], [800, 12],
        [900, 13], [1000, 14], [1100, 13], [1200, 15], [1300, 20], [1400, 28], [1500, 33], [1600, 48],
        [1700, 88], [1800, 139], [1900, 205], [1920, 225]]
HOOD_MARGIN = 4          # px below the hood line (the line's own residual is 3.5 px)
KEEP = 3                 # px our content keeps off BMW's items (the strip round's rule)

# BMW's items that stay, panel px [x0, y0, x1, y1]; source in each entry
KEEPOUTS = {
    # design/overlay/g20_comfort.json (relation unknown or over; critical): keep clear, background holes (safe plan)
    'tt.brake': [25, 214, 85, 255], 'tt.tpms': [24, 267, 77, 314], 'tt.abs': [14, 327, 73, 369],
    'tt.dsc': [19, 381, 63, 429], 'tt.auto_h': [1777, 179, 1870, 205], 'tt.parking_brake': [1838, 217, 1900, 260],
    'tt.steering': [1847, 265, 1905, 315],
    # design/strip/mask_final.json belt_group (hole in every lane): rear belts, driver's belt, airbag
    'belt_group': [497, 660, 688, 720],
    # brief section 2: the gear-letter gap (BMW draws its gear letter over us; covering the gap brings the black box)
    'gear_gap': [1380, 660, 1460, 720],
}
# BMW's message panel (design/strip/ZC/mask_proposal.json zc.panel bbox): ours to cover with our own message design,
# but the fallback window must open there, so no dial content may sit inside it either
CC_PANEL = [699.0, 598.7, 1223.0, 701.0]


def hood_y(x):
    if x <= HOOD[0][0]:
        return HOOD[0][1]
    for (x0, y0), (x1, y1) in zip(HOOD, HOOD[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return HOOD[-1][1]


def box_dist(px, py, b):
    """Distance from a point to a box (0 inside)."""
    dx = max(b[0] - px, 0, px - b[2])
    dy = max(b[1] - py, 0, py - b[3])
    return math.hypot(dx, dy)


def dial_points(cx, cy, R, u, step=1.0):
    """Outline samples of the dial's footprint: ring arc + chord + base box (panel px)."""
    te = u['theta_end']
    ro = u['ring_out'] * R
    pts = []
    a = -te
    while a <= te + 1e-9:
        t = math.radians(a)
        pts.append((cx + ro * math.sin(t), cy - ro * math.cos(t), 'ring'))
        a += step
    # chord between the arc ends
    t = math.radians(te)
    yb = cy - ro * math.cos(t)
    xl, xr = cx - ro * math.sin(t), cx + ro * math.sin(t)
    n = int(abs(xr - xl)) + 1
    for i in range(n + 1):
        pts.append((xl + (xr - xl) * i / n, yb, 'base'))
    b = u.get('base_box')
    if b:
        x0, y0, x1, y1 = cx + b[0] * R, cy + b[1] * R, cx + b[2] * R, cy + b[3] * R
        for i in range(41):
            f = i / 40
            pts += [(x0 + (x1 - x0) * f, y0, 'base'), (x0 + (x1 - x0) * f, y1, 'base'),
                    (x0, y0 + (y1 - y0) * f, 'base'), (x1, y0 + (y1 - y0) * f, 'base')]
    return pts


def inside_dial(px, py, cx, cy, R, u):
    ro = u['ring_out'] * R
    r = math.hypot(px - cx, py - cy)
    if r <= ro:
        ang = math.degrees(math.atan2(px - cx, -(py - cy)))
        te = u['theta_end']
        if abs(ang) <= te:
            return True
        # below the chord?
        yb = cy - ro * math.cos(math.radians(te))
        if py <= yb:
            return True
    b = u.get('base_box')
    if b and cx + b[0] * R <= px <= cx + b[2] * R and cy + b[1] * R <= py <= cy + b[3] * R:
        return True
    return False


def clearance(cx, cy, R, u, box):
    """Signed clearance of a dial footprint from a box: min distance, negative if they overlap (box corner inside
    the footprint or an outline point inside the box)."""
    pts = dial_points(cx, cy, R, u)
    d = min(box_dist(p[0], p[1], box) for p in pts)
    if d == 0:
        return -1.0
    for (x, y) in [(box[0], box[1]), (box[2], box[1]), (box[0], box[3]), (box[2], box[3]),
                   ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)]:
        if inside_dial(x, y, cx, cy, R, u):
            return -1.0
    return d


def hood_clear(cx, cy, R, u):
    """Smallest (ring y - hood y) over the ring arc; also the angle where it is smallest."""
    te = u['theta_end']
    ro = u['ring_out'] * R
    best = (1e9, None)
    a = -te
    while a <= te:
        t = math.radians(a)
        x, y = cx + ro * math.sin(t), cy - ro * math.cos(t)
        v = y - hood_y(x)
        if v < best[0]:
            best = (v, a)
        a += 0.5
    return best


def evaluate(R, cy, k, u, hard_base=False):
    """One placement. The ring and its chord are hard; the base furniture (base_box) is hard only with hard_base,
    else its clearances are reported in 'base_clear' (the furniture can be moved or shrunk: a design choice)."""
    disc = dict(u, base_box=None)
    d = k * R
    cl, cr = (960 - d / 2, cy), (960 + d / 2, cy)
    res = {'R': R, 'cy': cy, 'k': k, 'centres': [[round(cl[0], 2), cy], [round(cr[0], 2), cy]]}
    hl, hr = hood_clear(cl[0], cy, R, u), hood_clear(cr[0], cy, R, u)
    res['hood'] = {'left': [round(hl[0], 1), hl[1]], 'right': [round(hr[0], 1), hr[1]]}
    ro = u['ring_out'] * R
    res['edges'] = {'left_x': round(cl[0] - ro, 1), 'right_x': round(cr[0] + ro, 1)}
    clear = {}
    base = {}
    for name, box in list(KEEPOUTS.items()) + [('cc_panel', CC_PANEL)]:
        c = min(clearance(cl[0], cy, R, disc, box), clearance(cr[0], cy, R, disc, box))
        clear[name] = round(c, 1)
        if u.get('base_box'):
            base[name] = round(min(clearance(cl[0], cy, R, u, box), clearance(cr[0], cy, R, u, box)), 1)
    res['clear'] = clear
    res['base_clear'] = base
    te = math.radians(u['theta_end'])
    base_y = cy - ro * math.cos(te)
    res['ring_foot_y'] = round(base_y, 1)
    if u.get('base_box'):
        res['base_bottom_y'] = round(cy + u['base_box'][3] * R, 1)
        if hard_base:
            base_y = max(base_y, cy + u['base_box'][3] * R)
    ok = hl[0] >= HOOD_MARGIN and hr[0] >= HOOD_MARGIN and base_y <= PANEL_H - 2 \
        and cl[0] - ro >= 2 and cr[0] + ro <= PANEL_W - 2 \
        and all(v >= (KEEP if n != 'cc_panel' else 0) for n, v in clear.items()) \
        and (not hard_base or all(v >= (KEEP if n != 'cc_panel' else 0) for n, v in base.items()))
    res['ok'] = ok
    return res


def feasible(R, cy, k, u):
    """evaluate()'s 'ok' with early exits (the solver's inner loop)."""
    disc = dict(u, base_box=None)
    d = k * R
    ro = u['ring_out'] * R
    xl, xr = 960 - d / 2, 960 + d / 2
    if xl - ro < 2 or xr + ro > PANEL_W - 2:
        return False
    if cy - ro * math.cos(math.radians(u['theta_end'])) > PANEL_H - 2:
        return False
    for cx in (xl, xr):
        for name, box in KEEPOUTS.items():
            # far boxes cannot touch: skip the outline sampling
            if box_dist(cx, cy, box) > ro + KEEP + 1:
                continue
            if clearance(cx, cy, R, disc, box) < KEEP:
                return False
        if clearance(cx, cy, R, disc, CC_PANEL) < 0:
            return False
    return hood_clear(xl, cy, R, u)[0] >= HOOD_MARGIN and hood_clear(xr, cy, R, u)[0] >= HOOD_MARGIN


def solve(u, k_ref, k_rng, Rs, cys, k_step=0.02):
    """The largest R (Rs tried from the top down) with a feasible (cy, k); among those, k nearest k_ref, then cy
    nearest cy_pref. Coarse (cy every 2 px, k every k_step): a feasible R is then refined to 0.5 px by the caller."""
    ks = []
    k = k_rng[0]
    while k <= k_rng[1] + 1e-9:
        ks.append(round(k, 3))
        k += k_step
    ks.sort(key=lambda x: abs(x - k_ref))
    for R in sorted(Rs, reverse=True):
        cands = []
        for k in ks:
            for cy in cys:
                if feasible(R, cy, k, u):
                    r = evaluate(R, cy, k, u)
                    if r['ok']:
                        cands.append(r)
            if cands:
                break           # ks are in order of nearness to k_ref
        if cands:
            cands.sort(key=lambda r: (abs(r['k'] - k_ref), abs(r['cy'] - u.get('cy_pref', 370))))
            return cands[0]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dial', default='design/twin-dial/vg/dial_units.json')
    ap.add_argument('--out')
    ap.add_argument('--R', type=float, help='evaluate this R only (with --cy and --k)')
    ap.add_argument('--cy', type=float)
    ap.add_argument('--k', type=float)
    a = ap.parse_args()
    u = json.load(open(a.dial))
    if a.R:
        r = evaluate(a.R, a.cy, a.k, u)
        print(json.dumps(r, indent=1))
        return
    k_ref = u['k_ref']
    out = {'model': u, 'answers': {}}
    # 1. as close to the references as possible: k fixed at the reference value
    Rs = list(range(250, 341, 1))
    cys = list(range(330, 421, 2))
    out['answers']['k_fixed'] = solve(u, k_ref, (k_ref, k_ref), Rs, cys)
    # 2. k free within the references' spread
    out['answers']['k_free'] = solve(u, k_ref, tuple(u['k_range']), Rs, cys)
    print(json.dumps(out['answers'], indent=1))
    if a.out:
        json.dump(out, open(a.out, 'w'), indent=1)


if __name__ == '__main__':
    main()
