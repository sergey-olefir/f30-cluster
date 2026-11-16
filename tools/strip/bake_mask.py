#!/usr/bin/env python3
"""Package M (docs/AGENT-BRIEF-strip.md 4.4, docs/strip/M-REPORT.md): bake the STRIP mask.

The mask is our coverage over BMW's bottom strip (panel y 540-720) at FULL size, one byte a px, one "lane" per state of
the row. WBBACK (shared/shaders.js, the collar path) samples one cover lane and one hole lane, chosen live by
shared/hud.js _maskLanes():

    lane      kind    used when                                        what it is
    ours      cover   "all6WB", every row item ours, not standby       our black (opaque everywhere but its holes)
    bmw       cover   "allG20", or the row fallen back to BMW           our black round each stock row item
    standby   cover   the row BMW's and the car in P, engine off        our black round the standby row items
    msg       hole    the row BMW's and its message panel must show     a multiplier: BMW's panel, symbol and marker

(The brief's channel "bmw_msg" is bmw x msg; the shader multiplies them, so the panel's holes are drawn once.)
Inside the cover lanes' box the lane IS our black (no collar, cover or patch there); outside it the collar and the
cover draw as before. The bake therefore starts every cover lane from what WBBACK draws there today without any
patch - the collar and the cover, re-sampled at full size exactly as the shader samples them - so a lane differs from
"no mask" only where a shape says, and the box is the bounding box of those differences.

Input: the zone packages' shape lists (brief ZL-ZR.4), JSON, one list or {"shapes": [...]} per file:
    {"id", "channel": "ours" | "bmw" | "bmw_msg" | "standby" | "all", "kind": "hole" | "cover",
     "polygon": [[x, y], ...] (panel px, continuous: pixel (i, j) covers [i, i+1) x [j, j+1)),
     "feather_in_px", "feather_out_px", "reason", "evidence", "clearance"}
or, instead of "polygon", "circle": [cx, cy, r] or "rect": [x0, y0, x1, y1]; "per_edge": [[f_in, f_out], ...] (one
pair per polygon edge, edge i from vertex i to i+1) overrides the two numbers edge by edge. A shape's inside-ness is
1 from feather_in px inside its outline, 0 from feather_out px outside, linear between (a hard edge, both 0, is the
pixel's exact area coverage); a cover shape raises its lane to it, a hole multiplies its lane by 1 - it. All covers go
first, then all holes (a hole always wins). Channel "bmw_msg" takes holes only (they go to the msg lane); "all" goes
to the three cover lanes. Shapes are 8 x 8 supersampled.

    python3 tools/strip/bake_mask.py --today [--out NAME]          synthetic lanes from today's rectangles
    python3 tools/strip/bake_mask.py shapes_L.json shapes_C.json shapes_R.json [--out NAME] [--preview DIR]

Writes apps/f30_cluster/hud/scene/<NAME>.json (default "strip_mask": {w, h, format: "r8", r8: base64, sampling:
"nearest", mask: the layout entry}) - design/gen_6wb.py strip_mask() reads the layout entry from it - and prints the
lanes, their boxes and the memory. Needs numpy (and pillow for --preview). Our own geometry only: no photo pixel goes
into the texture.
"""
import argparse
import base64
import json
import os
import sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SCENE = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene')
LAYOUT = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', 'wb_dials.json')
X0, Y0, X1, Y1 = 0, 540, 1920, 720          # the STRIP, panel px
W, H = X1 - X0, Y1 - Y0
SS = 8
COVER_LANES = ('ours', 'bmw', 'standby')
TOL = 0.25 / 255                              # a lane counts as changed past this (the atlas holds 1/255 steps)


# ------------------------------------------------------------------------------------- WBBACK's maths, in numpy
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def box_out(px, py, b, r):
    """shaders.js boxOut(): px outside the box b, rounded by r; < 0 inside (its clamp to 64 kept)."""
    qx = np.maximum(b[0] - px, px - b[2]) + r
    qy = np.maximum(b[1] - py, py - b[3]) + r
    return np.hypot(np.clip(qx, 0, 64), np.clip(qy, 0, 64)) + np.minimum(np.maximum(qx, qy), 0.0) - r


def patch(px, py, b, soft):
    """shaders.js patch()."""
    if soft <= 0:
        return 1.0 - smoothstep(0.0, 2.0, box_out(px, py, b, 6.0))
    return (1.0 - smoothstep(0.0, 2.0, box_out(px, py, (b[0], b[1], b[2], b[3] + 8.0), 6.0))) * \
        (1.0 - smoothstep(b[3] - soft, b[3], py))


def tex_alpha(name):
    j = json.load(open(os.path.join(SCENE, name + '.json')))
    a = np.frombuffer(base64.b64decode(j['rgba']), np.uint8).reshape(j['h'], j['w'], 4)[..., 3]
    return a.astype(np.float64) / 255.0


def bilinear(t, u, v):
    """GLSL texture2D, LINEAR, CLAMP_TO_EDGE (the bench page and, for "bilinear" assets, the car)."""
    h, w = t.shape
    x, y = u * w - 0.5, v * h - 0.5
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    xa, xb = np.clip(x0, 0, w - 1), np.clip(x0 + 1, 0, w - 1)
    ya, yb = np.clip(y0, 0, h - 1), np.clip(y0 + 1, 0, h - 1)
    return (t[ya, xa] * (1 - fx) * (1 - fy) + t[ya, xb] * fx * (1 - fy) + t[yb, xa] * (1 - fx) * fy + t[yb, xb] * fx * fy)


def sampled(t, r, px, py):
    """A baked texture t over the box r (x, y, w, h), as WBBACK samples it: 0 outside [0, 1]."""
    u, v = (px - r[0]) / r[2], (py - r[1]) / r[3]
    ins = (u >= 0) & (v >= 0) & (u <= 1) & (v <= 1)
    return np.where(ins, bilinear(t, np.clip(u, 0, 1), np.clip(v, 0, 1)), 0.0)


def centres(x0=X0, y0=Y0, x1=X1, y1=Y1):
    return np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)


def bg_widget(path=LAYOUT):
    return next(w for w in json.load(open(path))['widgets'] if w['type'] == 'wbback')


def base_alpha(bg, px, py):
    """WBBACK's black where no patch and no lane is: the collar and the cover (max), at the pixel centres px, py."""
    c = bg['collar']
    a = sampled(tex_alpha(c['tex']), (c['x'], c['y'], c['w'], c['h']), px, py)
    if bg.get('cover'):
        v = bg['cover']
        a = np.maximum(a, sampled(tex_alpha(v['tex']), (v['x'], v['y'], v['w'], v['h']), px, py))
    return a


# ------------------------------------------------------------------------------------------------------ shapes
def _sd_poly(x, y, pts):
    """Signed distance to a simple polygon (< 0 inside) and, per point, the index of the nearest edge."""
    pts = np.asarray(pts, float)
    d = np.full(x.shape, np.inf)
    k = np.zeros(x.shape, int)
    s = np.ones(x.shape)
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        e = b - a
        wx, wy = x - a[0], y - a[1]
        t = np.clip((wx * e[0] + wy * e[1]) / max(e @ e, 1e-12), 0, 1)
        di = np.hypot(wx - e[0] * t, wy - e[1] * t)
        k = np.where(di < d, i, k)
        d = np.minimum(d, di)
        c1, c2, c3 = y >= a[1], y < b[1], e[0] * wy > e[1] * wx
        s = np.where((c1 & c2 & c3) | (~c1 & ~c2 & ~c3), -s, s)
    return s * d, k


def shape_inside(sh, x, y):
    """A shape's inside-ness at the points x, y (1 from feather_in px inside, 0 from feather_out outside, linear)."""
    fi, fo = float(sh.get('feather_in_px', 0) or 0), float(sh.get('feather_out_px', 0) or 0)
    if 'circle' in sh:
        cx, cy, r = sh['circle']
        d = np.hypot(x - cx, y - cy) - r
        fin, fout = np.full(x.shape, fi), np.full(x.shape, fo)
    else:
        pts = sh['polygon'] if 'polygon' in sh else [[sh['rect'][0], sh['rect'][1]], [sh['rect'][2], sh['rect'][1]],
                                                     [sh['rect'][2], sh['rect'][3]], [sh['rect'][0], sh['rect'][3]]]
        d, k = _sd_poly(x, y, pts)
        pe = sh.get('per_edge')
        if pe:
            pe = np.asarray(pe, float)
            if len(pe) != len(pts):
                raise SystemExit('shape %s: per_edge has %d pairs for %d edges' % (sh.get('id'), len(pe), len(pts)))
            fin, fout = pe[k, 0], pe[k, 1]
        else:
            fin, fout = np.full(x.shape, fi), np.full(x.shape, fo)
    hard = (fin + fout) <= 0
    ramp = np.clip((fout - d) / np.maximum(fin + fout, 1e-9), 0.0, 1.0)
    return np.where(hard, (d < 0).astype(np.float64), ramp)


def shape_cover(sh):
    """A shape's inside-ness over the STRIP, each px the mean of 8 x 8 samples, only over the shape's bounding box."""
    if 'circle' in sh:
        cx, cy, r = sh['circle']
        bb = [cx - r, cy - r, cx + r, cy + r]
    else:
        pts = np.asarray(sh['polygon'] if 'polygon' in sh else [[sh['rect'][0], sh['rect'][1]], [sh['rect'][2], sh['rect'][3]]], float)
        bb = [pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max()]
    f = max(float(sh.get('feather_in_px', 0) or 0), float(sh.get('feather_out_px', 0) or 0),
            max([max(p) for p in sh.get('per_edge', [[0, 0]])]))
    gx0, gy0 = int(max(np.floor(bb[0] - f - 2), X0)), int(max(np.floor(bb[1] - f - 2), Y0))
    gx1, gy1 = int(min(np.ceil(bb[2] + f + 2), X1)), int(min(np.ceil(bb[3] + f + 2), Y1))
    out = np.zeros((H, W))
    if gx1 <= gx0 or gy1 <= gy0:
        return out
    sx = gx0 + (np.arange((gx1 - gx0) * SS) + 0.5) / SS
    sy = gy0 + (np.arange((gy1 - gy0) * SS) + 0.5) / SS
    x, y = np.meshgrid(sx, sy)
    v = shape_inside(sh, x, y).reshape(gy1 - gy0, SS, gx1 - gx0, SS).mean((1, 3))
    out[gy0 - Y0:gy1 - Y0, gx0 - X0:gx1 - X0] = v
    return out


# ------------------------------------------------------------------------------------------------------- lanes
def lanes_today(bg):
    """The synthetic lanes: exactly what today's rectangles draw (layout wb_dials, shared/hud.js _wbPatches/_wbCcSend):
    "ours" every patch on (range, clock, temp, the foot band), "bmw" and "standby" the unconditional foot band only
    (BMW's standby row has no lane of its own today), "msg" u_cc over the "cc" box."""
    px, py = centres()
    base = base_alpha(bg, px, py)
    pats = [(p['rect'], float(p.get('soft', 0) or 0), p.get('when')) for p in bg.get('patches', [])]
    ours, bmw = base.copy(), base.copy()
    for r, s, when in pats:
        pa = patch(px, py, r, s)
        ours = np.maximum(ours, pa)
        if not when:
            bmw = np.maximum(bmw, pa)
    msg = smoothstep(-0.5, 3.0, box_out(px, py, bg['cc'], 8.0))
    return base, {'ours': ours, 'bmw': bmw, 'standby': bmw.copy()}, msg


def lanes_from_shapes(bg, shapes):
    px, py = centres()
    base = base_alpha(bg, px, py)
    cov = {k: base.copy() for k in COVER_LANES}
    msg = np.ones((H, W))
    order = [s for s in shapes if s.get('kind') == 'cover'] + [s for s in shapes if s.get('kind') == 'hole']
    for sh in order:
        ch, kind = sh.get('channel'), sh.get('kind')
        if ch not in COVER_LANES + ('bmw_msg', 'all') or kind not in ('cover', 'hole'):
            raise SystemExit('shape %s: channel %r / kind %r unknown' % (sh.get('id'), ch, kind))
        if ch == 'bmw_msg' and kind == 'cover':
            raise SystemExit('shape %s: bmw_msg takes holes only (it is bmw x the panel holes)' % sh.get('id'))
        s = shape_cover(sh)
        for lane in (COVER_LANES if ch == 'all' else ('msg',) if ch == 'bmw_msg' else (ch,)):
            if lane == 'msg':
                msg *= 1.0 - s
            elif kind == 'cover':
                cov[lane] = np.maximum(cov[lane], s)
            else:
                cov[lane] *= 1.0 - s
    return base, cov, msg


def bbox(mask):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return [int(xs.min()) + X0, int(ys.min()) + Y0, int(xs.max()) + 1 + X0, int(ys.max()) + 1 + Y0]


def pack(base, cov, msg):
    """The R8 atlas: one tile per distinct cover lane (all over one box) and one for the hole lane."""
    q = {k: np.round(np.clip(v, 0, 1) * 255).astype(np.uint8) for k, v in cov.items()}
    qm = np.round(np.clip(msg, 0, 1) * 255).astype(np.uint8)
    changed = np.zeros((H, W), bool)
    for v in cov.values():
        changed |= np.abs(v - base) > TOL
    cb = bbox(changed)
    hb = bbox(msg < 1 - TOL)
    if cb is None:
        raise SystemExit('no cover lane differs from the collar: nothing to bake')
    cw, chh = cb[2] - cb[0], cb[3] - cb[1]
    tiles, lanes = [], {}
    for k in COVER_LANES:
        t = q[k][cb[1] - Y0:cb[3] - Y0, cb[0] - X0:cb[2] - X0]
        same = next((i for i, (n, u) in enumerate(tiles) if np.array_equal(u, t)), None)
        if same is None:
            tiles.append((k, t))
            same = len(tiles) - 1
        lanes[k] = [0, same * chh]
    aw, ah = cw, len(tiles) * chh
    hole = None
    if hb is not None:
        hw, hh = hb[2] - hb[0], hb[3] - hb[1]
        ht = qm[hb[1] - Y0:hb[3] - Y0, hb[0] - X0:hb[2] - X0]
        cw4 = (cw + 3) // 4 * 4                  # beside the cover tiles when it fits, else under them
        if cw4 + hw <= 2048 and hh <= ah:
            lanes['msg'], aw = [cw4, 0], cw4 + hw
        else:
            lanes['msg'], aw, ah = [0, ah], max(cw, hw), ah + hh
        hole = (hb, ht)
    aw = (aw + 3) // 4 * 4                      # rows on a 4-byte boundary: GL's default unpack alignment
    atlas = np.zeros((ah, aw), np.uint8)
    for i, (n, t) in enumerate(tiles):
        atlas[i * chh:(i + 1) * chh, :cw] = t
    if hole:
        ax, ay = lanes['msg']
        atlas[ay:ay + hole[1].shape[0], ax:ax + hole[1].shape[1]] = hole[1]
    if aw > 2048 or ah > 2048:
        raise SystemExit('the atlas is %d x %d: past the 2048 px an asset may have' % (aw, ah))
    entry = {'tex': None, 'atlas': [aw, ah], 'cover': cb, 'hole': hb or [0, 0, 0, 0], 'lanes': lanes}
    return atlas, entry


def write(name, atlas, entry, about, where=SCENE):
    entry = dict(entry, tex=name)
    h, w = atlas.shape
    j = {'w': w, 'h': h, 'format': 'r8', 'sampling': 'nearest', 'mask': entry, '_about': about,
         'r8': base64.b64encode(atlas.tobytes()).decode('ascii')}
    path = os.path.join(where, name + '.json')
    json.dump(j, open(path, 'w'))
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('shapes', nargs='*', help='shape-list JSON files (zone packages)')
    ap.add_argument('--today', action='store_true', help="synthetic lanes from today's rectangles")
    ap.add_argument('--out', default='strip_mask', help='scene texture name (hud/scene/<name>.json)')
    ap.add_argument('--layout', default=LAYOUT, help='the layout whose bg (collar, cover, patches, cc) is the base')
    ap.add_argument('--dir', default=SCENE, help='where to write it (default the app\'s hud/scene; a trial bake elsewhere)')
    ap.add_argument('--preview', help='write a 1x PNG of each lane here (git-ignored place, e.g. bake/work/strip/M)')
    a = ap.parse_args()
    bg = bg_widget(a.layout)
    if a.today:
        base, cov, msg = lanes_today(bg)
        about = "package M synthetic lanes: today's rectangles (collar, cover, patches, u_cc) re-drawn exactly"
    else:
        shapes = []
        for f in a.shapes:
            d = json.load(open(f))
            shapes += d['shapes'] if isinstance(d, dict) else d
        if not shapes:
            raise SystemExit('no shapes given (or --today)')
        base, cov, msg = lanes_from_shapes(bg, shapes)
        about = 'package M lanes from %d shapes: %s' % (len(shapes), ', '.join(os.path.basename(f) for f in a.shapes))
    atlas, entry = pack(base, cov, msg)
    path = write(a.out, atlas, entry, about, a.dir)
    print('%s: %d x %d R8, %.3f MiB as an asset (counted twice)' % (os.path.relpath(path, ROOT), atlas.shape[1],
          atlas.shape[0], atlas.size * 2 / 1048576.0))
    print(json.dumps(dict(entry, tex=a.out)))
    if a.preview:
        from PIL import Image
        os.makedirs(a.preview, exist_ok=True)
        for k, v in list(cov.items()) + [('msg', msg)]:
            Image.fromarray(np.round(np.clip(v, 0, 1) * 255).astype(np.uint8)).save(os.path.join(a.preview, a.out + '.' + k + '.png'))


if __name__ == '__main__':
    sys.exit(main())
