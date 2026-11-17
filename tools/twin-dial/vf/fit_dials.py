"""Package VF: fit the two bezel rings of every reference (provisional frame for the frame measurements).

The bezel is the thin bright ring at the dial's outer edge. From a rough seed (centre, radius) we cast rays every
2 degrees over the arc where the ring exists (default -125..125 deg, clockwise from 12 o'clock), take on each ray the
OUTERMOST luminance peak that reaches 55 % of the ray's own maximum inside [0.9 r, 1.1 r], refine it to sub-pixel
(parabola), and fit an ellipse (cv2.fitEllipse), twice, with 2.5-sigma rejection. R is the mean of the semi-axes.

This works on the ORIGINAL references (package VR's rectified ones replace them when published): a slanted photo
gives ellipses, and the frame numbers made on it are PROVISIONAL.

Run from the repo root:
    UV_CACHE_DIR=/Users/solefir/projects/f30-cluster/bake/work/.uvcache uv run -q --no-project \
      --with opencv-python-headless --with numpy python -I tools/twin-dial/vf/fit_dials.py [src_dir] [out.json]
"""
import json
import math
import os
import sys

import cv2
import numpy as np

SRC = sys.argv[1] if len(sys.argv) > 1 else 'reference/vc'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'bake/work/twin-dial/vf/dials_orig.json'

# rough seeds read off the images by eye: (cx, cy, r) in original px; refined below
SEEDS = {
    '01_classic_map_tacho-left_mph.png': {'tacho': (345, 400, 168), 'speedo': (989, 390, 169)},
    '02_facelift_hybrid_powermeter_trip.png': {'tacho': (693, 787, 224), 'speedo': (1497, 798, 208)},
    '03_classic_compact_date-panel_led-bars.png': {'tacho': (385, 527, 300, 125), 'speedo': (1533, 528, 298)},
    '04_facelift_bench_red-wedge_car.png': {'tacho': (333, 290, 108), 'speedo': (737, 292, 105)},
    '05_facelift_render_settings.png': {'tacho': (297, 222, 107), 'speedo': (687, 222, 108)},
}


def lum(img):
    f = img.astype(np.float32) / 255.0
    f = np.where(f <= 0.04045, f / 12.92, ((f + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f[..., 2] + 0.7152 * f[..., 1] + 0.0722 * f[..., 0]


def ray_points(Y, cx, cy, r, a0=-125, a1=125, step=2.0, lo=0.9, hi=1.1):
    pts = []
    H, W = Y.shape
    for a in np.arange(a0, a1 + 1e-6, step):
        t = math.radians(a)
        dx, dy = math.sin(t), -math.cos(t)
        rr = np.arange(lo * r, hi * r, 0.25)
        xs, ys = cx + rr * dx, cy + rr * dy
        ok = (xs >= 1) & (xs < W - 2) & (ys >= 1) & (ys < H - 2)
        if ok.sum() < len(rr) * 0.8:
            continue
        rr, xs, ys = rr[ok], xs[ok], ys[ok]
        v = cv2.remap(Y, xs.astype(np.float32)[None, :], ys.astype(np.float32)[None, :], cv2.INTER_LINEAR)[0]
        v = cv2.GaussianBlur(v.reshape(-1, 1), (1, 5), 0).ravel()
        base = np.percentile(v, 20)
        thr = base + 0.55 * (v.max() - base)
        pk = [i for i in range(2, len(v) - 2) if v[i] >= thr and v[i] >= v[i - 1] and v[i] >= v[i + 1]]
        if not pk:
            continue
        i = pk[-1]
        d = v[i - 1] - 2 * v[i] + v[i + 1]
        off = 0.5 * (v[i - 1] - v[i + 1]) / d if d < 0 else 0.0
        R = rr[i] + off * 0.25
        pts.append((a, cx + R * dx, cy + R * dy))
    return pts


def fit(Y, seed, a1=125):
    cx, cy, r = seed
    for it in range(3):
        pts = ray_points(Y, cx, cy, r, a1=a1)
        P = np.array([[p[1], p[2]] for p in pts], np.float32)
        keep = np.ones(len(P), bool)
        for _ in range(2):
            (ex, ey), (w, h), ang = cv2.fitEllipse(P[keep])
            res = ellipse_res(P, ex, ey, w / 2, h / 2, ang)
            s = np.std(res[keep])
            keep = np.abs(res) < max(2.5 * s, 0.6)
        cx, cy, r = ex, ey, (w + h) / 4
    res = ellipse_res(P, ex, ey, w / 2, h / 2, ang)
    return {'cx': float(ex), 'cy': float(ey), 'a': float(w / 2), 'b': float(h / 2), 'angle_deg': float(ang),
            'R': float((w + h) / 4), 'n': int(keep.sum()), 'n_rays': len(P),
            'rms_px': float(np.sqrt(np.mean(res[keep] ** 2))), 'ellipticity': float(abs(w - h) / (w + h))}


def ellipse_res(P, ex, ey, a, b, ang):
    t = math.radians(ang)
    x = (P[:, 0] - ex) * math.cos(t) + (P[:, 1] - ey) * math.sin(t)
    y = -(P[:, 0] - ex) * math.sin(t) + (P[:, 1] - ey) * math.cos(t)
    rho = np.sqrt((x / a) ** 2 + (y / b) ** 2)
    return (rho - 1) * (a + b) / 2


def main():
    out = {}
    for name, dials in SEEDS.items():
        p = os.path.join(SRC, name)
        if not os.path.exists(p):
            continue
        Y = lum(cv2.imread(p))
        # the tacho's red zone (40..125 deg) has its own bright edge outside the bezel: fit it on -125..35 only
        # (03's red zone sits inside the ring, so 03 keeps the full arc: a 4th seed element overrides the end angle)
        d = {k: fit(Y, s[:3], s[3] if len(s) > 3 else (35 if k == 'tacho' else 125)) for k, s in dials.items()}
        t, s = d['tacho'], d['speedo']
        D = math.hypot(s['cx'] - t['cx'], s['cy'] - t['cy'])
        d['D_px'] = D
        d['R_mean_px'] = (t['R'] + s['R']) / 2
        d['D_over_R'] = D / d['R_mean_px']
        d['roll_deg'] = math.degrees(math.atan2(s['cy'] - t['cy'], s['cx'] - t['cx']))
        d['size'] = list(Y.shape[::-1])
        out[name] = d
        print(f"{name[:2]} tacho c=({t['cx']:.1f},{t['cy']:.1f}) R={t['R']:.1f} e={t['ellipticity']:.3f} "
              f"rms={t['rms_px']:.2f} | speedo c=({s['cx']:.1f},{s['cy']:.1f}) R={s['R']:.1f} "
              f"e={s['ellipticity']:.3f} rms={s['rms_px']:.2f} | D={D:.1f} D/R={d['D_over_R']:.3f} "
              f"roll={d['roll_deg']:.2f}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w'), indent=1)


if __name__ == '__main__':
    main()
