#!/usr/bin/env python3
"""Baked faces against the approved mockup's dial crops (package R2-A2; for 0.1.1 package B1): K1's picture
`bake/work/twin-dial/mockup/r3/80_look_06.png` (look 06, the owner's choice R1; tachometer 2400 rpm, speedometer 87 km/h).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/compare_face.py
        [--stretch 1.0 1.06] [--mockup PNG] [--out bake/work/twin-dial/r3b/B1]

Rebakes both faces into a scratch folder (nothing in the app changes), decodes them with tools/twin-dial/face_shade.py (the
numpy reference of the tdial shader, no needle) and compares the dial crop (the same 616 x 560 rectangle) with the mockup,
leaving out the needle and its shadow, the hub's dynamic text, the bars and the mockup's neighbours. Prints per-zone numbers
and the geometry check (bright ink edges within 2 px); writes <out>/cmp_face_<face>_s<stretch>.png (decoded | mockup | diff x4).
The mockup draws Saira unstretched: --stretch 1.0 compares like with like; 1.06 (the shipped bake) shows the stretch's cost.
Where the mockup and SPEC-R3 disagree the spec wins (major lines 0.010 R, not the mockup's 0.006; the arc (210, 20, 21),
not the mockup's (218, 16, 48)): those show as differences by design.
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np                                     # noqa: E402
from PIL import Image, ImageDraw                       # noqa: E402

import _bakecommon as bc                               # noqa: E402
import bake_face as bf                                 # noqa: E402
import face_shade as fs                                # noqa: E402

MOCKUP = os.path.join(bc.ROOT, 'bake', 'work', 'twin-dial', 'mockup', 'r3', '80_look_06.png')
OUT = os.path.join(bc.ROOT, 'bake', 'work', 'twin-dial', 'r3b', 'B1')
STATE = {'tach': bf.tach_angle(2.4), 'speed': bf.spd_angle(87.0)}


def needle_mask(deg, grow):
    t = math.radians(deg)
    ux, uy, nx, ny = math.sin(t), -math.cos(t), math.cos(t), math.sin(t)
    pts = lambda sg: [(bf.CX + r * bf.R * ux + sg * (w * bf.R / 2 + grow * bf.R) * nx, bf.CY + r * bf.R * uy + sg * (w * bf.R / 2 + grow * bf.R) * ny)
                      for r, w in bf.NEEDLE]                                                   # noqa: E731
    im = Image.new('L', (bf.FW, bf.FH), 0)
    ImageDraw.Draw(im).polygon(pts(-1) + pts(1)[::-1], fill=255)
    return np.asarray(im) > 0


def dist_to(b, rmax):
    out = np.full(b.shape, rmax + 1, np.int16)
    out[b] = 0
    cur = b.copy()
    for r in range(1, rmax + 1):
        g = cur.copy()
        g[1:] |= cur[:-1]; g[:-1] |= cur[1:]; g[:, 1:] |= cur[:, :-1]; g[:, :-1] |= cur[:, 1:]          # noqa: E702
        g[1:, 1:] |= cur[:-1, :-1]; g[:-1, :-1] |= cur[1:, 1:]; g[1:, :-1] |= cur[:-1, 1:]; g[:-1, 1:] |= cur[1:, :-1]   # noqa: E702
        out[g & ~cur] = r
        cur = g
    return out


def luma(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def valid_mask(kind):
    ys, xs = np.mgrid[0:bf.FH, 0:bf.FW]
    rho = np.hypot(xs + 0.5 - bf.CX, ys + 0.5 - bf.CY) / bf.R
    v = ~needle_mask(STATE[kind], 0.07)
    v &= ~((rho < 0.50) & (ys + 0.5 > bf.CY - 0.31 * bf.R) & (ys + 0.5 < bf.CY + 0.27 * bf.R))      # READY, gear, program, digits, km/h
    v &= ~((np.abs(xs + 0.5 - bf.CX) < 0.5 * bf.R) & (np.abs(ys + 0.5 - (bf.CY + bf.UNIT_Y * bf.R)) < 22) & (rho < 0.55))  # the unit label
    v &= ys + 0.5 < bf.CY + 0.60 * bf.R                                                           # bars, end labels, icon
    v &= rho < 1.02                                                                             # the mockup's tab bar and rule
    return v, rho


def compare(kind, stretch, mock, tmp, out_dir=None, face_fn=None):
    img, data, reg, clear, dropped = (face_fn or bf.bake)(kind, stretch, tmp, record=False)
    dec = fs.shade(data, reg, 6500.0, 1.0).astype(np.float64)
    x0, y0, x1, y1 = reg['rect_panel']
    ref = np.asarray(mock.convert('RGB'))[y0:y1, x0:x1].astype(np.float64)
    valid, rho = valid_mask(kind)
    d = np.abs(dec - ref)
    dm = d.max(axis=2)
    res = {'face': bf.NAMES[kind], 'stretch': stretch, 'compared_px': int(valid.sum()),
           'mean_abs_diff_per_channel': round(float(d[valid].mean()), 3), 'p99_abs_diff': round(float(np.percentile(dm[valid], 99)), 1),
           'px_over_32': int((dm[valid] > 32).sum()), 'px_over_96': int((dm[valid] > 96).sum())}
    A, B = (luma(dec) >= 128) & valid, (luma(ref) >= 128) & valid
    for nm, a, b in (('decoded_to_mockup', A, B), ('mockup_to_decoded', B, A)):
        g = dist_to(b, 6)
        res[nm] = {'ink_px': int(a.sum()), 'beyond_1px': int((a & (g > 1)).sum()), 'beyond_2px': int((a & (g > 2)).sum())}
    zones = {'bezel': rho >= 0.97, 'gap 0.94-0.97': (rho >= 0.94) & (rho < 0.97), 'strip': (rho >= 0.893) & (rho < 0.94),
             'band and numerals': (rho >= 0.5795) & (rho < 0.893), 'gap and rim 0.50-0.58': (rho >= 0.50) & (rho < 0.5795)}
    res['by_zone'] = {k: {'px': int((z & valid).sum()), 'mean_abs_diff': round(float(d[z & valid].mean()), 3) if (z & valid).any() else None,
                          'px_over_32': int((dm[z & valid] > 32).sum())} for k, z in zones.items()}
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        sheet = np.concatenate([dec.astype(np.uint8), ref.astype(np.uint8), np.clip(d * 4, 0, 255).astype(np.uint8)], axis=1)
        Image.fromarray(sheet).save(os.path.join(out_dir, 'cmp_face_%s_s%.2f.png' % (bf.NAMES[kind], stretch)))
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--stretch', type=float, nargs='*', default=[1.0, 1.06])
    ap.add_argument('--mockup', default=MOCKUP)
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    mock = Image.open(a.mockup)
    allres = []
    for s in a.stretch:
        for kind in ('tach', 'speed'):
            r = compare(kind, s, mock, os.path.join(a.out, 'scratch_s%.2f' % s), a.out)
            allres.append(r)
            print(json.dumps(r))
    with open(os.path.join(a.out, 'compare_face.json'), 'w') as f:
        json.dump(allres, f, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
