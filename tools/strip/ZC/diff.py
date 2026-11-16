"""Package ZC: the pixel diff of zone C (x 690-1250, y 540-720): BMW's stock ink (the photos) against our coverage
(package O's maps), per layout, mode and state.

Classes, per element, at 4x (16 samples per panel px; counts are reported in panel px = samples / 16):
  OK      must show, alpha <= 0.02
  CLIP    must show, alpha > 0.02          (count, and summed alpha in panel px)
  LEAK    must be hidden, 1 - alpha > 0.02 (count, and the light that gets through: sum of (1 - alpha) * Yn)
  DOUBLE  our text ink within 3 px of BMW ink of the same job that is visible
  SAFETY  any alpha over a belt / airbag / over-element footprint dilated 3 px (none lies in zone C: checked)
  SEAM    every edge of our coverage: the luminance step of the composite across it (white text = 1.0) + dE2000
"must show / must hide" follow the owner's decisions (brief section 1.2, 1.3, 1.5, 1.6).
BMW's light: photo Y normalised Yn = (Y - black) / (white text - black), per channel likewise for colour.
Run from the repo root after atlas.py:  (uv line of atlas.py, plus --with scipy)
Writes bake/work/strip/zone-c/diff.json (numbers only).
"""
import hashlib
import json
import os
import sys

import cv2
import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zc_common as Z  # noqa: E402

O = os.path.join(Z.WORK, 'pub', 'O', 'maps')
# strip integration (the lead, 2026-11-16): re-run on another build's maps (STRIP_O_MAPS, made by tools/strip/O/states.py
# and maps.py) and write elsewhere (STRIP_DIFF_OUT); STRIP_O_INDEX (that run's index.json) gives whether the engine
# drew the row as ours in each state - with package X's all-or-nothing row, "all6WB" is BMW's row while it waits for a
# time zone or the first message, latched or in standby, so "ours or BMW's" is read off the engine, not the mode
O = os.environ.get('STRIP_O_MAPS') or O
OUT_DIR = os.environ.get('STRIP_DIFF_OUT') or os.path.join(Z.WORK, 'zone-c')
ROW_OURS = {}
if os.environ.get('STRIP_O_INDEX'):
    for _r in json.load(open(os.environ['STRIP_O_INDEX'])):
        ROW_OURS[(_r['layout'], _r['mode'], _r['state'])] = bool(_r.get('own')) and all((_r.get('own') or {}).values())
X0, X1 = 690, 1250                     # zone C
N = 4
WY = np.array([0.2126, 0.7152, 0.0722])

# element boxes (continuous panel px) and the photo states they exist in
EL = {
    'rail.centre.hook_l':     ([695, 608, 760, 654], 'nomsg'),
    'rail.centre.hook_r':     ([1159, 608, 1228, 654], 'nomsg'),
    'rail.left.end (ZL)':     ([690, 639, 699, 654], 'all'),
    'rail.right.start (ZR)':  ([1218, 639, 1250, 654], 'all'),
    'assist.cc_panel.arc':    ([697, 598, 1225, 624], 'msg'),
    'assist.cc_panel.fill':   ([700, 607, 1222, 702], 'msg'),
    'bottom.cc_info':         ([716, 628, 762, 688], 'msg'),
    'cc.text':                ([812, 615, 1125, 699], 'msg'),
    'bottom.street':          ([788, 662, 1132, 712], 'road'),
    'bottom.odometer':        ([800, 660, 1088, 702], 'odo'),
    'bottom.odometer.ghost':  ([800, 660, 1088, 702], 'ghost'),
    'map.region foot (neighbour)': ([690, 540, 1250, 601], 'all'),
}
STATE = {'61': {'nomsg', 'road'}, '64': {'nomsg', 'road'}, '67': {'nomsg', 'road'}, '68': {'nomsg', 'road'},
         '63': {'nomsg', 'ghost'}, '62': {'msg'}, '66': {'msg'}, '65': {'nomsg', 'odo'}}
NOMSG_STATES = ['unread', 'drive', 'drive-clock', 'park', 'limit-unknown', 'limit-end', 'limit-none', 'nopass', 'p-engine-off', 'no-zone']
MSG_STATES = ['msg', 'msg-long', 'msg-latched', 'road-latched-msg', 'msg-gap', 'standby-msg']
PANEL = ['assist.cc_panel.arc', 'assist.cc_panel.fill', 'bottom.cc_info', 'cc.text']
HIDE_ALWAYS = ['rail.centre.hook_l', 'rail.centre.hook_r', 'rail.left.end (ZL)', 'rail.right.start (ZR)',
               'bottom.odometer.ghost']


def must(mode, state, el, layout=None):
    """True = must show, False = must be hidden, None = not judged here (neighbour)."""
    if 'neighbour' in el:
        return None
    if el in HIDE_ALWAYS:
        return False
    if state in ('standby', 'standby-msg'):            # 1.6: standby is BMW's row in both modes
        return el == 'bottom.odometer' or (state == 'standby-msg' and el in PANEL)
    if el == 'bottom.odometer':
        return False
    if (layout, mode, state) in ROW_OURS:              # strip integration: the engine's own word (STRIP_O_INDEX)
        bmw_row = not ROW_OURS[(layout, mode, state)]
    else:
        bmw_row = mode == 'allG20' or state in ('msg-latched', 'road-latched-msg')
    if bmw_row:
        return el in PANEL or (el == 'bottom.street' and state not in MSG_STATES)      # 1.2, 1.5
    # the row ours: BMW's panel only while our text for its message is not on the screen yet (the safety rule)
    return el in PANEL and state == 'msg-gap'


def photos_for(state):
    if state == 'standby':
        return ['65']
    if state == 'standby-msg':
        return ['62', '66']
    if state in MSG_STATES:
        return ['62', '66']
    return ['61', '64', '67', '68', '63']


def ink_masks(pid):
    rgb, tag = Z.load(pid)
    rgb = rgb[:, (X0 - Z.ZX0) * N:(X1 - Z.ZX0) * N]
    Y = Z.lum(rgb)
    full, _ = Z.load(pid)
    bbox = Z.cut(full, 650, 600, 690, 636).reshape(-1, 3)
    black = np.median(bbox, 0)
    if pid in ('62', '66'):
        wb = (815, 615, 1125, 695)
    elif pid in ('65', '63'):
        wb = (600, 643, 690, 650) if pid == '63' else (800, 660, 1088, 702)
    else:
        wb = (790, 662, 1132, 712)
    wsub = Z.cut(full, *wb).reshape(-1, 3)
    wl = wsub @ WY
    white = wsub[wl >= np.percentile(wl, 99.5)].mean(0)
    if pid == '63':     # no white text in 63: the rails are pinkish; use 62's white balance scaled to the rails
        white = np.full(3, float(white @ WY))
    norm = (rgb - black) / (white - black)
    Yn = norm @ WY
    m = {}
    st = STATE[pid]
    for name, (b, when) in EL.items():
        if when != 'all' and when not in st:
            continue
        x0, y0, x1, y1 = b
        box = np.zeros(Yn.shape, bool)
        box[int((y0 - 540) * N):int((y1 - 540) * N), int((max(x0, X0) - X0) * N):int((min(x1, X1) - X0) * N)] = True
        thr = 0.005 if name == 'assist.cc_panel.fill' else (0.01 if 'ghost' in name else 0.03)
        mm = box & (Yn > thr)
        if name == 'assist.cc_panel.fill':       # the fill only: not the arc / symbol / text ink above 0.03
            mm &= Yn < 0.15
        m[name] = mm
    return {'tag': tag, 'Yn': Yn, 'norm': norm, 'masks': m}


def lab(rgb):
    """linear sRGB (white = 1) -> CIELAB D65."""
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = np.clip(rgb, 0, None) @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def de2000(l1, l2):
    L1, a1, b1 = l1[..., 0], l1[..., 1], l1[..., 2]
    L2, a2, b2 = l2[..., 0], l2[..., 1], l2[..., 2]
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cm = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p, h2p = np.degrees(np.arctan2(b1, a1p)) % 360, np.degrees(np.arctan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p
    dh = np.where(C1p * C2p == 0, 0, np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh)))
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lpm, Cpm = (L1 + L2) / 2, (C1p + C2p) / 2
    hs = h1p + h2p
    hpm = np.where(C1p * C2p == 0, hs, np.where(np.abs(h1p - h2p) > 180, np.where(hs < 360, (hs + 360) / 2, (hs - 360) / 2), hs / 2))
    T = 1 - 0.17 * np.cos(np.radians(hpm - 30)) + 0.24 * np.cos(np.radians(2 * hpm)) + 0.32 * np.cos(np.radians(3 * hpm + 6)) - 0.20 * np.cos(np.radians(4 * hpm - 63))
    Sl = 1 + 0.015 * (Lpm - 50) ** 2 / np.sqrt(20 + (Lpm - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cpm, 1 + 0.015 * Cpm * T
    Rt = -2 * np.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7)) * np.sin(np.radians(60 * np.exp(-((hpm - 275) / 25) ** 2)))
    return np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


def ours(layout, mode, state):
    d = os.path.join(O, layout, mode, state)
    a4 = cv2.imread(os.path.join(d, 'alpha_4x.png'), cv2.IMREAD_UNCHANGED).astype(np.float64) / 65535
    a4 = a4[:, X0 * N:X1 * N]
    z = np.load(os.path.join(d, 'maps_1x.npz'))
    lin = z['lin'][:, X0:X1].astype(np.float64)                      # premultiplied linear
    lin4 = np.repeat(np.repeat(lin, N, 0), N, 1)
    bd = json.load(open(os.path.join(d, 'breakdown.json')))
    texts = [t for t in bd['texts'] if t.get('ink_a002') and t['ink_a002'][2] > X0 and t['ink_a002'][0] < X1
             and t['ink_a002'][3] > 540]
    return a4, lin4, texts


def seams(a4, lin4, bmw_norm):
    # photo noise near black would read as dE: smooth BMW's side by ~1 panel px first
    bmw = cv2.GaussianBlur(np.clip(bmw_norm, 0, None).astype(np.float32), (0, 0), N * 0.5).astype(np.float64)
    comp = lin4 + (1 - a4)[..., None] * bmw
    gy, gx = np.gradient(a4)
    g = np.hypot(gx, gy)
    edge = g > 0.02
    ys, xs = np.nonzero(edge)
    nx, ny = gx[ys, xs] / g[ys, xs], gy[ys, xs] / g[ys, xs]
    k = 2 * N
    H, W = a4.shape

    def at(y, x):
        return comp[np.clip(np.round(y).astype(int), 0, H - 1), np.clip(np.round(x).astype(int), 0, W - 1)]
    cin, cout = at(ys + ny * k, xs + nx * k), at(ys - ny * k, xs - nx * k)
    dY = np.abs(cin @ WY - cout @ WY)
    dE = de2000(lab(cin), lab(cout))
    # aggregate on 4 x 4 panel-px cells; a cell is a seam cell when its 95th-pct step exceeds 1 % of white;
    # adjacent seam cells form one segment (ranked by the step, then the length)
    C = 4 * N
    cy, cx = ys // C, xs // C
    cells = {}
    for i, (a, b) in enumerate(zip(cy, cx)):
        cells.setdefault((a, b), []).append(i)
    grid = np.zeros((H // C + 1, W // C + 1), bool)
    p95 = {}
    for k, idx in cells.items():
        v = float(np.percentile(dY[idx], 95))
        p95[k] = v
        grid[k] = v > 0.01
    lab_c, n = ndimage.label(grid, np.ones((3, 3)))
    segs = []
    for i in range(1, n + 1):
        ks = [k for k in zip(*np.nonzero(lab_c == i))]
        idx = np.concatenate([cells[k] for k in ks if k in cells])
        yy, xx = ys[idx], xs[idx]
        horiz = float(np.mean(np.abs(ny[idx]) > np.abs(nx[idx])))
        segs.append({'box': [round(X0 + xx.min() / N, 1), round(540 + yy.min() / N, 1),
                             round(X0 + (xx.max() + 1) / N, 1), round(540 + (yy.max() + 1) / N, 1)],
                     'cells_4px': len(ks), 'horizontal_share': round(horiz, 2),
                     'dY_max_cell_p95': round(max(p95[k] for k in ks if k in p95), 4),
                     'dY_p95': round(float(np.percentile(dY[idx], 95)), 4),
                     'dE00_p95': round(float(np.percentile(dE[idx], 95)), 2)})
    segs.sort(key=lambda s: (-s['dY_max_cell_p95'], -s['cells_4px']))
    return segs


def main():
    layouts = [l for l in ('wb_dials', 'wb_sport_dials') if os.path.isdir(os.path.join(O, l))]
    inks = {pid: ink_masks(pid) for pid in STATE}
    out = {'_about': __doc__.split('\n')[0], 'sources': {pid: v['tag'] for pid, v in inks.items()}, 'cases': []}
    seen = {}
    for layout in layouts:
        for mode in ('allG20', 'all6WB'):
            for state in NOMSG_STATES + MSG_STATES + ['standby']:
                d = os.path.join(O, layout, mode, state)
                if not os.path.exists(os.path.join(d, 'maps_1x.npz')):
                    continue
                a4, lin4, texts = ours(layout, mode, state)
                key = hashlib.md5(a4.tobytes() + lin4.tobytes()).hexdigest()[:10]
                for pid in photos_for(state):
                    ink = inks[pid]
                    case = {'layout': layout, 'mode': mode, 'state': state, 'photo': pid, 'maps_hash': key,
                            'elements': {}}
                    for el, m in ink['masks'].items():
                        want = must(mode, state, el, layout)
                        n = int(m.sum())
                        if n == 0:
                            continue
                        a = a4[m]
                        r = {'ink_px': round(n / N ** 2, 1), 'must': {True: 'show', False: 'hide', None: '-'}[want]}
                        if want is True:
                            c = a > 0.02
                            r['CLIP_px'] = round(c.sum() / N ** 2, 1)
                            r['CLIP_sum_alpha_px'] = round(float(a[c].sum()) / N ** 2, 1)
                            # light lost: sum of alpha x BMW's light (white text = 1), in panel px
                            r['CLIP_light'] = round(float((a * ink['Yn'][m])[c].sum()) / N ** 2, 2)
                            r['OK_px'] = round((~c).sum() / N ** 2, 1)
                            if c.any():
                                ys, xs = np.nonzero(m & (a4 > 0.02))
                                r['CLIP_box'] = [round(X0 + xs.min() / N, 1), round(540 + ys.min() / N, 1),
                                                 round(X0 + (xs.max() + 1) / N, 1), round(540 + (ys.max() + 1) / N, 1)]
                        elif want is False:
                            v = (1 - a) > 0.02
                            r['LEAK_px'] = round(v.sum() / N ** 2, 1)
                            r['LEAK_light'] = round(float(((1 - a) * ink['Yn'][m])[v].sum()) / N ** 2, 2)
                            if v.any():
                                ys, xs = np.nonzero(m & ((1 - a4) > 0.02))
                                r['LEAK_box'] = [round(X0 + xs.min() / N, 1), round(540 + ys.min() / N, 1),
                                                 round(X0 + (xs.max() + 1) / N, 1), round(540 + (ys.max() + 1) / N, 1)]
                        else:
                            r['visible_px'] = round(((1 - a) > 0.02).sum() / N ** 2, 1)
                        case['elements'][el] = r
                    # DOUBLE: our text ink within 3 px of visible BMW ink of the same job
                    vis = np.zeros(a4.shape, bool)
                    for el in ('cc.text', 'bottom.street', 'bottom.cc_info', 'bottom.odometer'):
                        if el in ink['masks']:
                            vis |= ink['masks'][el] & ((1 - a4) > 0.02) & (ink['Yn'] > 0.1)
                    dbl = []
                    for t in texts:
                        x0, y0, x1, y1 = t['ink_a002']
                        bx = np.zeros(a4.shape, bool)
                        bx[max(0, int((y0 - 3 - 540) * N)):int((y1 + 3 - 540) * N),
                           max(0, int((x0 - 3 - X0) * N)):int((x1 + 3 - X0) * N)] = True
                        k = int((bx & vis).sum())
                        if k:
                            dbl.append({'ours': t['id'], 'bmw_visible_ink_px_within_3px': round(k / N ** 2, 1)})
                    case['DOUBLE'] = dbl
                    case['SAFETY'] = 'none: no belt, airbag or over-element footprint (dilated 3 px) lies in x 690-1250'
                    case['SEAMS_top'] = seams(a4, lin4, ink['norm'])[:8]
                    out['cases'].append(case)
                    seen.setdefault(key, []).append('%s/%s/%s' % (layout, mode, state))
                print(layout, mode, state, 'done')
    out['identical_maps'] = {k: v for k, v in seen.items()}
    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump(out, open(os.path.join(OUT_DIR, 'diff.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
