"""Package ZL: a local model of photo 60 (our calibration grid over the stock cluster) for zone L.

The whole-panel fit (register.py) leaves 2-5 px residuals at x 100-300 on 60's grid, so zone L gets its own model,
fitted to points ALONG every major grid line in x -50..850, y 380..720 (not only at the crossings): each line is
located per row (vertical lines) or per column (horizontal lines) as the centroid of green-minus-red above half its
peak, in an 8x warp of the photo through the current model; the true line centre is 100k + 0.5 (OpenCV convention:
the grid shader lights [100k, 100k + 2)). Homography + radial k1, three rounds, inliers at 0.6 panel px.

Run from the main checkout:
    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/strip/ZL/local60.py
Writes the model into bake/work/strip/zone-L/H.json as '60L' (zoom.py schema), with its residuals.
"""
import json
import os
import sys

import cv2
import numpy as np

ROOT = os.environ.get('F30_MAIN', os.path.expanduser('~/projects/f30-cluster'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'overlay'))
import rectify as R  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

R.ROOT = ROOT
HJ = os.path.join(ROOT, 'bake', 'work', 'strip', 'zone-L', 'H.json')
N = 8          # supersample
HALF = 5       # panel px either side of the line searched
BOX = (-50, 280, 850, 720)


def gmr(im):
    im = im.astype(np.float32)
    return np.clip(im[..., 1] - im[..., 2], 0, None)


def centroid(prof):
    pk = prof.max()
    if pk < 25:
        return None
    i = int(prof.argmax())
    lo, hi = i, i
    while lo > 0 and prof[lo - 1] > pk / 2:
        lo -= 1
    while hi < len(prof) - 1 and prof[hi + 1] > pk / 2:
        hi += 1
    if lo == 0 or hi == len(prof) - 1:
        return None
    w = prof[lo:hi + 1] - pk / 2
    return float((np.arange(lo, hi + 1) * w).sum() / w.sum()), (hi - lo + 1) / N


def sample(G, lm, HALF=HALF):
    """G: the photo's green-minus-red (float32). Points along each major line through the current model."""
    offs = np.arange(-HALF * N, HALF * N + 1) / N
    pts = []
    for X in range(0, 900, 100):
        x = X + 0.5
        ys = [y for y in np.arange(max(BOX[1], 2), BOX[3] - 2, 1.0)
              if not any(abs(y - (100 * j + 0.5)) < 8 for j in range(3, 8))]
        P = np.array([[x + o, y] for y in ys for o in offs])
        q = lm.to_photo(P).astype(np.float32).reshape(len(ys), -1, 2)
        prof = cv2.remap(G, q[..., 0], q[..., 1], cv2.INTER_LINEAR)
        for y, pr in zip(ys, prof):
            c = centroid(pr)
            if c is None or not (1.2 < c[1] < 8):
                continue
            pts.append(((x, y), lm.to_photo([[x - HALF + c[0] / N, y]])[0], 'v%d' % X))
    for Y in range(300, 800, 100):
        if Y >= 720:
            continue
        y = Y + 0.5
        xs = [x for x in np.arange(BOX[0], BOX[2], 1.0) if not any(abs(x - (100 * k + 0.5)) < 8 for k in range(-1, 10))]
        P = np.array([[x, y + o] for x in xs for o in offs])
        q = lm.to_photo(P).astype(np.float32).reshape(len(xs), -1, 2)
        prof = cv2.remap(G, q[..., 0], q[..., 1], cv2.INTER_LINEAR)
        for x, pr in zip(xs, prof):
            c = centroid(pr)
            if c is None or not (1.2 < c[1] < 8):
                continue
            pts.append(((x, y), lm.to_photo([[x, y - HALF + c[0] / N]])[0], 'h%d' % Y))
    return pts


def main():
    import lmodel as LM
    H = json.load(open(HJ))
    e = H['60']
    ph = R.imread(e['source'])
    size = (ph.shape[1], ph.shape[0])
    G = gmr(ph)
    lm = LM.LModel(R.Model(np.array(e['model']['H_panel_to_undistorted_photo']), size, e['model']['k1']))
    for rnd, (half, thr) in enumerate(((10, 3.0), (6, 1.0), (4, 0.6), (4, 0.6))):
        pts = sample(G, lm, half)
        src = np.float64([p[0] for p in pts])
        dst = np.float64([p[1] for p in pts])
        ax = np.array([[p[2][0] == 'v', p[2][0] == 'h'] for p in pts])
        inl = np.ones(len(src), bool)
        for _ in range(4):
            lm = LM.fit_poly(lm, src[inl], dst[inl], ax[inl])
            rr = lm.to_panel(dst) - src
            r = np.where(ax[:, 0], rr[:, 0], rr[:, 1])
            inl = np.abs(r) < thr
        print('round', rnd, 'points', len(src), 'inliers', int(inl.sum()), 'rms', round(float(np.sqrt((r[inl] ** 2).mean())), 3), flush=True)
    per = {}
    for p, rv in zip(pts, r):
        per.setdefault(p[2], []).append(rv)
    stats = {n: [round(float(np.mean(v)), 3), round(float(np.std(v)), 3), len(v)] for n, v in sorted(per.items())}
    for n, v in stats.items():
        print(n, v)
    if os.environ.get('ZL_DUMP'):
        json.dump([[p[2], p[0][0], p[0][1], float(v)] for p, v in zip(pts, r)], open(os.environ['ZL_DUMP'], 'w'))
    st = {'inliers': int(inl.sum()), 'points': len(src),
          'rms_panel_px': round(float(np.sqrt((r[inl] ** 2).mean())), 3),
          'photo_px_per_panel_px': round(lm.scale(400, 640), 4), 'fit_box_panel': list(BOX),
          'per_line_mean_sd_n': stats,
          'method': 'ZL local model of 60: the whole-panel SIFT model plus a cubic panel-space correction, fitted on '
                    'points along every major grid line in the fit box (half-max centroid of green-minus-red, 1/8 px '
                    'profiles; only the line-normal component used) (tools/strip/ZL/local60.py)'}
    H['60L'] = dict(source=e['source'], model=lm.to_json(), provisional=True, valid_box_panel=[0, 300, 800, 720], **st)
    json.dump(H, open(HJ, 'w'), indent=1)


if __name__ == '__main__':
    main()
