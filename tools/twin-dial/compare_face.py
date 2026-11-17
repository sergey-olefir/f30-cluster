#!/usr/bin/env python3
"""Baked faces against the mockup's dial crops (package R2-A2): SPEC §18 T2 "pixel diff vs mockup crops within 2 px on geometry".

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/compare_face.py
        [--stretch 1.0] [--redline 6500] [--out bake/work/twin-dial/r2/A2]

Rebakes both faces (into a scratch folder, nothing in the app changes), decodes them with tools/twin-dial/face_shade.py (the
numpy reference of the tdial shader, wedge and bar fills included, no needle), renders the mockup twice with different needle
and speed values to find the needle / digit pixels, and compares the rest of the dial crop (the same 616 x 560 rectangle) with
the mockup. Dynamic hub content (READY, gear, program, digits) is excluded by box. Prints the numbers; writes
<out>/cmp_<face>_s<stretch>.png (decoded | mockup | difference x4).
The mockup draws Saira unstretched: --stretch 1.0 compares like with like; 1.06 shows the cost of SPEC §9's stretch.
"""
import argparse
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np                                     # noqa: E402
from PIL import Image                                  # noqa: E402

import _bakecommon as bc                               # noqa: E402
import bake_face as bf                                 # noqa: E402
import face_shade as fs                                # noqa: E402

# dynamic hub content in the mockup (face px boxes): READY, gear, drive program, digital speed, the centre of the hub
# and the neighbours the mockup's crop catches: the tab bar [618, 127, 1302, 172] and the bottom rule at y 613
EXCLUDE = {'tach': [(250, 236, 366, 266), (236, 392, 380, 466), (240, 466, 392, 492), (540, 30, 616, 90), (550, 518, 616, 530)],
           'speed': [(215, 262, 401, 360), (0, 30, 76, 90), (0, 518, 66, 530)]}


def load_mockup():
    spec = importlib.util.spec_from_file_location('mockup', os.path.join(bc.ROOT, 'tools', 'twin-dial', 'mockup', 'mockup.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def dilate(m, r):
    out = m.copy()
    ri = int(np.ceil(r))
    for dy in range(-ri, ri + 1):
        for dx in range(-ri, ri + 1):
            if (dx or dy) and dx * dx + dy * dy <= r * r:
                s = np.zeros_like(m)
                ys, yd = (slice(dy, None), slice(0, -dy)) if dy > 0 else ((slice(0, dy), slice(-dy, None)) if dy < 0 else (slice(None), slice(None)))
                xs, xd = (slice(dx, None), slice(0, -dx)) if dx > 0 else ((slice(0, dx), slice(-dx, None)) if dx < 0 else (slice(None), slice(None)))
                s[ys, xs] = m[yd, xd]
                out |= s
    return out


def dist_ge(a, b, rmax=6):
    """Per px of a: the smallest integer r with a within r px of b (disc), 0 where a & b; rmax + 1 beyond."""
    d = np.full(a.shape, rmax + 1, np.int16)
    d[a & b] = 0
    for r in range(1, rmax + 1):
        hit = a & dilate(b, r) & (d > r)
        d[hit] = r
    d[~a] = 0
    return d


def luma(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def compare(kind, stretch, redline, out_dir, mk, renders):
    tmp = os.path.join(out_dir, 'scratch_s%.2f' % stretch)
    os.makedirs(tmp, exist_ok=True)
    img, data, reg, clear, dropped = bf.bake(kind, stretch, tmp, record=False)
    fills = {'n': 3.2} if kind == 'tach' else {'n': 2.6}
    dec = fs.shade(data, reg, redline, 1.0, fills)
    x0, y0, x1, y1 = reg['rect_panel']
    A, B = renders
    mock = np.asarray(A.convert('RGB'))[y0:y1, x0:x1].astype(np.float64)
    mB = np.asarray(B.convert('RGB'))[y0:y1, x0:x1].astype(np.float64)
    dyn = dilate(np.abs(mock - mB).max(axis=2) > 0, 3)           # the needle (and the speed digits) differ between renders
    ex = np.zeros(dyn.shape, bool)
    for bx in EXCLUDE[kind]:
        ex[bx[1]:bx[3], bx[0]:bx[2]] = True
    valid = ~(dyn | ex)
    d = np.abs(dec.astype(np.float64) - mock)
    dm = d.max(axis=2)
    res = {'face': bf.NAMES[kind], 'stretch': stretch, 'compared_px': int(valid.sum()),
           'mean_abs_diff_per_channel': round(float(d[valid].mean()), 3), 'p99_abs_diff': round(float(np.percentile(dm[valid], 99)), 1),
           'px_over_32': int((dm[valid] > 32).sum()), 'px_over_96': int((dm[valid] > 96).sum())}
    # geometry: where the picture is "ink-bright" (luma >= 128), how far the decoded picture's edge is from the mockup's
    Ld, Lm = luma(dec.astype(np.float64)) >= 128, luma(mock) >= 128
    gd = dist_ge(Ld & valid, Lm, 6)
    gm = dist_ge(Lm & valid, Ld, 6)
    for nm, g, m in (('decoded_to_mockup', gd, Ld & valid), ('mockup_to_decoded', gm, Lm & valid)):
        res[nm] = {'ink_px': int(m.sum()), 'beyond_1px': int((g > 1).sum()), 'beyond_2px': int((g > 2).sum()), 'max_px': int(g.max())}
    # also the dark side (the band's and the wedge's own edges: luma >= 40)
    Ld2, Lm2 = luma(dec.astype(np.float64)) >= 40, luma(mock) >= 40
    g1, g2 = dist_ge(Ld2 & valid, Lm2, 6), dist_ge(Lm2 & valid, Ld2, 6)
    res['band_edge_px_beyond_2'] = int((g1 > 2).sum() + (g2 > 2).sum())
    res['band_edge_max_px'] = int(max(g1.max(), g2.max()))
    # per region
    ys, xs = np.mgrid[0:bf.FH, 0:bf.FW]
    rho = np.hypot(xs + 0.5 - bf.CX, ys + 0.5 - bf.CY) / bf.R
    zones = {'bezel': rho >= 0.97, 'ticks and strip': (rho >= 0.885) & (rho < 0.97), 'band and numerals': (rho >= 0.58) & (rho < 0.885),
             'rim': (rho >= 0.52) & (rho < 0.58), 'hub (static labels)': rho < 0.52, 'bars, ends, icon': ys > 490}
    res['by_zone'] = {k: {'px': int((z & valid).sum()), 'mean_abs_diff': round(float(d[z & valid].mean()), 3) if (z & valid).any() else None,
                          'px_over_32': int((dm[z & valid] > 32).sum())} for k, z in zones.items()}
    sheet = np.concatenate([dec.astype(np.uint8), mock.astype(np.uint8), np.clip(d * 4, 0, 255).astype(np.uint8)], axis=1)
    Image.fromarray(sheet).save(os.path.join(out_dir, 'cmp_%s_s%.2f.png' % (bf.NAMES[kind], stretch)))
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--stretch', type=float, nargs='*', default=[1.0, 1.06])
    ap.add_argument('--redline', type=float, default=6500.0)
    ap.add_argument('--out', default=bc.WORK)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    mk = load_mockup()
    # two renders that differ only in needle and speed digits; the bakes and the decode are compared against the first
    mk.SS = mk.SS
    A = mk.render(speed=87.0, rpm=2.4, page='clock')
    B = mk.render(speed=41.0, rpm=5.6, page='clock')
    allres = []
    for s in a.stretch:
        for kind in ('tach', 'speed'):
            r = compare(kind, s, a.redline, a.out, mk, (A, B))
            allres.append(r)
            print(json.dumps(r))
    with open(os.path.join(a.out, 'compare.json'), 'w') as f:
        json.dump(allres, f, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
