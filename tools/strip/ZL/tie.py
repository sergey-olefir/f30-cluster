"""Package ZL: tie each stock photo (61-68) to photo 60's local zone-L model through content that never moves.

Reference: photo 60 warped by its local model ('60L', tools/strip/ZL/local60.py) over panel [0, 380, 800, 720] at 2x,
with our grid and its labels masked out (green-minus-red > 25, yellow labels, both dilated). Patches of 36 x 36
panel px on a 12 px step, wherever the reference has fixed stock texture (fuel mini, speedo rail and ticks, numerals)
and outside everything that changes between photos (needles' tips are the same at rest; the sign, the row texts,
the belts, the speed readout and the map are excluded). Each patch is found in the photo warped by its current
model by masked zero-mean NCC (+-SEARCH px at 2x, parabolic sub-px peak); the photo model is then the photo's SIFT
model plus a cubic panel-space correction (tools/strip/ZL/lmodel.py) fitted to the matches, three rounds.

Run from the main checkout:
    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/strip/ZL/tie.py 61 62 ...
Writes bake/work/strip/zone-L/HL.json (one entry per photo, LModel schema) and prints the residuals.
"""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lmodel as LM  # noqa: E402

R = LM.R
ROOT = LM.ROOT
ZD = os.path.join(ROOT, 'bake', 'work', 'strip', 'zone-L')
HL = os.path.join(ZD, 'HL.json')
BOX = (0.0, 300.0, 800.0, 720.0)
N = 2
P = 36          # patch size, panel px
STEP = 12
SEARCH = 5      # panel px
EXCL = [        # panel boxes of content that changes between photos (continuous coords)
    (488, 570, 592, 672),     # the sign
    (125, 655, 800, 720),     # the row: range, clock, belts, airbag, message
    (350, 560, 490, 625),     # the speed readout at the speedo's foot
    (700, 300, 800, 600),     # the map / car picture / service text at the centre's left edge
    (120, 380, 330, 470),     # left of the speedo hub (empty in P)
]


def ref60():
    lm, ph, e = LM.load('60L')
    im = lm.warp(ph, BOX, N, cv2.INTER_CUBIC)
    f = im.astype(np.float32)
    g = np.clip(f[..., 1] - f[..., 2], 0, None)
    yl = np.clip(np.minimum(f[..., 2], f[..., 1]) - f[..., 0] - 40, 0, None)      # yellow labels: R,G high, B low
    bad = ((g > 25) | (yl > 0)).astype(np.uint8)
    bad = cv2.dilate(bad, np.ones((7, 7), np.uint8))
    return im, 1 - bad


def lum(im):
    return im.astype(np.float32).max(2)


def mzncc(T, W, S):
    """masked zero-mean NCC of template T (weights W in {0,1}) over search image S, every integer offset."""
    th, tw = T.shape
    out = np.full((S.shape[0] - th + 1, S.shape[1] - tw + 1), -1.0)
    n = W.sum()
    tm = (T * W).sum() / n
    t = (T - tm) * W
    tn = np.sqrt((t * t).sum())
    for dy in range(out.shape[0]):
        for dx in range(out.shape[1]):
            s = S[dy:dy + th, dx:dx + tw]
            sm = (s * W).sum() / n
            sz = (s - sm) * W
            den = tn * np.sqrt((sz * sz).sum())
            out[dy, dx] = (t * sz).sum() / den if den > 0 else -1
    return out


def excluded(x0, y0, x1, y1):
    return any(not (x1 <= a or x0 >= c or y1 <= b or y0 >= d) for a, b, c, d in EXCL)


def matches(lm, ph, ref, W, min_score=0.75):
    Rl = lum(ref)
    pad = SEARCH
    out = []
    for y0 in np.arange(BOX[1], BOX[3] - P + 1, STEP):
        for x0 in np.arange(BOX[0], BOX[2] - P + 1, STEP):
            if excluded(x0, y0, x0 + P, y0 + P):
                continue
            i0, j0 = int((x0 - BOX[0]) * N), int((y0 - BOX[1]) * N)
            T = Rl[j0:j0 + P * N, i0:i0 + P * N]
            Wt = W[j0:j0 + P * N, i0:i0 + P * N].astype(np.float32)
            if Wt.mean() < 0.5 or (T * Wt).std() < 12:
                continue
            S = lum(lm.warp(ph, (x0 - pad, y0 - pad, x0 + P + pad, y0 + P + pad), N, cv2.INTER_CUBIC))
            c = mzncc(T, Wt, S)
            j, i = np.unravel_index(np.argmax(c), c.shape)
            if c[j, i] < min_score or i in (0, c.shape[1] - 1) or j in (0, c.shape[0] - 1):
                continue
            sx, sy = R.subpix(c, i, j)
            dx, dy = sx / N - pad, sy / N - pad
            ctr = np.array([x0 + P / 2 - 0.5, y0 + P / 2 - 0.5])          # OpenCV convention
            out.append((ctr, lm.to_photo([ctr + [dx, dy]])[0], float(c[j, i])))
    return out


def main(ids):
    ref, W = ref60()
    res = json.load(open(HL)) if os.path.exists(HL) else {}
    for k in ids:
        lm, ph, e = LM.load(k, os.path.join(ZD, 'H.json'))
        for rnd in range(3):
            mt = matches(lm, ph, ref, W)
            src = np.float64([a for a, _, _ in mt])
            dst = np.float64([b for _, b, _ in mt])
            inl = np.ones(len(src), bool)
            for _ in range(3):
                lm = LM.fit_poly(lm, src[inl], dst[inl])
                r = np.linalg.norm(lm.to_panel(dst) - src, axis=1)
                inl = r < max(0.5, 3 * np.median(r))
            print(k, 'round', rnd, 'matches', len(src), 'inliers', int(inl.sum()),
                  'rms', round(float(np.sqrt((r[inl] ** 2).mean())), 3), 'max', round(float(r[inl].max()), 3), flush=True)
        res[k] = {'source': e['source'], 'model': lm.to_json(), 'provisional': True,
                  'matches': len(src), 'inliers': int(inl.sum()),
                  'rms_panel_px': round(float(np.sqrt((r[inl] ** 2).mean())), 3),
                  'photo_px_per_panel_px': round(lm.scale(), 4), 'valid_box_panel': list(BOX),
                  'tie_points': [[round(float(a[0]), 2), round(float(a[1]), 2), round(float(v), 3), bool(q)]
                                 for a, v, q in zip(src, r, inl)],
                  'method': 'tied to photo 60\'s local model by masked ZNCC of fixed stock content (tools/strip/ZL/tie.py)'}
        json.dump(res, open(HL, 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1:])
