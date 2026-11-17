"""Rectify a dial to a frontal square (R = 400 px, centre at (600, 600)) and measure its numerals and hub items.

Usage: numerals.py KEY [lo hi [thr]]   (annulus for numerals, default 0.58..0.92 R; whiteness threshold 0.62)
Writes bake/work/twin-dial/vd/rect_<KEY>.png (photo pixels; never tracked).
Numerals: bright, low-saturation pixels (or red ones: a red numeral on the wedge) inside the annulus, dilated
horizontally to merge the digits of one numeral; each component's bbox centre (rho, theta) and its height / width in R.
Glyph height is the bbox height of the un-dilated pixels; the numerals are upright (not rotated) in every reference.
"""
import sys, os, json, numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from dialfit import DIALS, load
from radial import get_model

OUT = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'bake', 'work', 'twin-dial', 'vd')
RP, C0, N = 400.0, 600.0, 1200


def rectify(key):
    f, c, A = get_model(key)
    im = load(DIALS[key][0])
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    u = (xx + 0.5 - C0) / RP; v = (yy + 0.5 - C0) / RP
    x = c[0] + A[0, 0] * u + A[0, 1] * v
    y = c[1] + A[1, 0] * u + A[1, 1] * v
    r = cv2.remap(im, x.astype(np.float32), y.astype(np.float32), cv2.INTER_CUBIC)
    cv2.imwrite(os.path.join(OUT, f'rect_{key}.png'), np.clip(r * 255, 0, 255).astype(np.uint8))
    return r


def blobs(r, lo, hi, thr=0.62):
    b, g, rd = r[..., 0], r[..., 1], r[..., 2]
    mx = r.max(axis=2); mn = r.min(axis=2)
    white = (mn > thr) & (mx - mn < 0.25)
    red = (rd > 0.55) & (rd - np.maximum(g, b) > 0.30)
    yy, xx = np.mgrid[0:N, 0:N]
    rho = np.hypot(xx + 0.5 - C0, yy + 0.5 - C0) / RP
    ann = (rho > lo) & (rho < hi)
    out = []
    for kind, m in (('white', white & ann), ('red', red & ann)):
        m8 = m.astype(np.uint8)
        d = cv2.dilate(m8, np.ones((3, 31), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(d)
        for i in range(1, n):
            sel = (lab == i) & m
            if sel.sum() < 60:
                continue
            ys, xs = np.where(sel)
            x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
            h, w = (y1 - y0) / RP, (x1 - x0) / RP
            if h < 0.05 or w > 0.5 or h > 0.3:
                continue
            cx, cy = (x0 + x1) / 2 - C0, (y0 + y1) / 2 - C0
            out.append(dict(kind=kind, theta=float(np.degrees(np.arctan2(cx, -cy)) % 360), rho=float(np.hypot(cx, cy) / RP),
                            h=float(h), w=float(w), x=float(cx / RP), y=float(cy / RP)))
    return sorted(out, key=lambda o: (o['theta'] - 200) % 360)


if __name__ == '__main__':
    key = sys.argv[1]
    lo, hi = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else (0.58, 0.92)
    r = rectify(key)
    res = blobs(r, lo, hi, float(sys.argv[4]) if len(sys.argv) > 4 else 0.62)
    for o in res:
        print('%-5s th %6.1f  rho %.3f  h %.3f  w %.3f  (x %+.3f y %+.3f)' % (o['kind'], o['theta'], o['rho'], o['h'], o['w'], o['x'], o['y']))
    json.dump(res, open(os.path.join(OUT, f'numerals_{key}.json'), 'w'), indent=1)
