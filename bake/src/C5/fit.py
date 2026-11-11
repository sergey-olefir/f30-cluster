"""P4 / C5: fit the window model's numbers (C5/model.py) to the 17 crop stretched into our frame (C5.refs).

Writes bake/src/C5/params.json (the generator's input). Run once after C5.refs:
    cd bake/src && uv run ... --with scipy python -m C5.fit
"""
import json, os, sys
import cv2
import numpy as np
from scipy.optimize import least_squares

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from C5 import model  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
REF = os.path.join(ROOT, "bake", "work", "C5", "ref", "17_physical-cluster_full.ours.C5")
BOX = [680, 39, 560, 669]
LUMA = np.array([0.2126, 0.7152, 0.0722])

# hand-measured starting values (17, stretched): see bake/report/C5.md
P0 = {
    "top_y": 79.0, "top_half_w": 240.0, "corner_r": 10.0,
    "dial_clip_R": 1.04, "dial_clip_soft": 3.0,
    "rim_a": 0.06, "rim_d": 3.0, "rim_s": 1.6,
    "sky_y0": 398.0, "horizon_y": 458.0, "sky_pow": 1.4, "sky_amp": 108.0,
    "horizon_w": 2.5, "horizon_L": 48.0, "lip_a": 12.0, "lip_d": 1.5, "lip_s": 1.0,
    "front_y": 608.8,
    "fb0": 55.0, "fb1": 60.0, "fb2": 20.0, "fb3": 30.0, "fbh0": 140.0, "fbh1": 120.0, "fbq": 0.25,
    "bar_n": 5, "bar_yv": 250.0, "bar_u0": 0.004545, "bar_du": 0.000353,
    "bar_a0": 20.0, "bar_a1": 80.0, "bar_a2": 0.0, "bar_s0": 3.0, "bar_s1": 5.0, "bar_h0": 120.0, "bar_h1": 60.0, "bar_hp": 4.0,
    "wall_y0": 505.0, "wall_in": 25.0, "wall_x0": 165.0, "wall_x1": 1.0, "wall_x2": 0.0, "wall_a": 60.0, "wall_ag": 0.5,
    "wall_s0": 18.0, "wall_s1": 6.0, "wall_y1": 600.0, "wall_tail": 15.0,
}
FREE = ["fb0", "fb1", "fb2", "fb3", "fbh0", "fbh1", "fbq",
        "bar_yv", "bar_u0", "bar_du", "bar_a0", "bar_a1", "bar_a2", "bar_s0", "bar_s1", "bar_h0", "bar_h1", "bar_hp",
        "wall_y0", "wall_in", "wall_x0", "wall_x1", "wall_x2", "wall_a", "wall_ag", "wall_s0", "wall_s1", "wall_y1", "wall_tail"]

# keep the bars bar-like (flat-topped sideways, at least 2 px thick) and the walls narrow, as seen in 17 / 04 / 07
BOUNDS = {"bar_hp": (3.0, 8.0), "bar_s0": (1.5, 6.0), "wall_s0": (8.0, 22.0), "bar_h0": (60.0, 200.0)}


def load():
    im = cv2.imread(REF + ".png")[..., ::-1].astype(np.float64)
    bits = cv2.imread(REF + ".maskbits.png", cv2.IMREAD_GRAYSCALE)
    return im, bits == 0


def main():
    im, valid = load()
    L = im @ LUMA
    bx, by, bw, bh = BOX
    ys, xs = np.mgrid[0:bh, 0:bw]
    X = xs + bx + 0.5; Y = ys + by + 0.5
    P = dict(P0)

    # 1. background keys (rows, mean over valid px), colour keys
    keys_y = [79.0, 84.0, 100.0, 200.0, 300.0, 396.0, 470.0]
    rgb_keys, L_keys = [], []
    for ky in keys_y:
        yy = int(min(ky, 396) - by)
        m = valid[yy - 1:yy + 2]
        sel = im[yy - 1:yy + 2][m]
        rgb_keys.append([round(float(v), 1) for v in sel.mean(0)])
        L_keys.append(round(float((sel @ LUMA).mean()), 2))
    P["bg_keys_y"], P["bg_keys_rgb"] = keys_y, rgb_keys

    # 2. the floor-sky palette: per-channel quadratic in luma on the sky + floor pixels
    reg = valid & (Y > 400) & (Y < 607)
    Ls, C = L[reg], im[reg]
    pal = []
    for c in range(3):
        coef = np.polyfit(Ls / 255.0, C[:, c] / 255.0, 2)[::-1]
        pal.append([round(float(v), 5) for v in coef])
    P["palette"] = pal

    # 3. sky: amplitude and power over the rows 398..456 (centre columns)
    rows = np.arange(398, 457)
    prof = np.array([L[int(r - by)][valid[int(r - by)]].mean() for r in rows])
    base = np.interp(rows, keys_y, L_keys)

    def sky_res(v):
        y0, p, a = v
        t = np.clip((rows + 0.5 - y0) / (P["horizon_y"] - y0), 0, 1)
        return base + a * t ** p - prof
    s = least_squares(sky_res, [398.0, 1.4, 108.0])
    P["sky_y0"], P["sky_pow"], P["sky_amp"] = [round(float(v), 3) for v in s.x]

    # 4. the floor: luma least squares on every 2nd px of the valid floor area
    fl = valid & (Y > P["horizon_y"] + P["horizon_w"] + 0.5) & (Y < P["front_y"] - 1.5)
    fl[::2] = False
    fl[:, ::2] = False
    xf, yf, Lf = X[fl], Y[fl], L[fl]

    def res(v):
        Q = dict(P); Q.update(zip(FREE, v))
        Lm, _ = model.floor_luma(xf, yf, Q)
        return Lm - Lf
    v0 = [P[k] for k in FREE]
    lo = [-np.inf] * len(FREE); hi = [np.inf] * len(FREE)
    for k, (a, b) in BOUNDS.items():
        lo[FREE.index(k)], hi[FREE.index(k)] = a, b
    v0 = [min(max(v, l + 1e-9), h - 1e-9) for v, l, h in zip(v0, lo, hi)]
    r = least_squares(res, v0, bounds=(lo, hi), loss="soft_l1", f_scale=12.0, max_nfev=4000, x_scale="jac")
    P.update({k: round(float(v), 6) for k, v in zip(FREE, r.x)})
    rms = float(np.sqrt(np.mean(res(r.x) ** 2)))
    print("floor fit rms luma", round(rms, 2), "cost", r.cost, r.message)

    # 5. bar body and front line colours (measured)
    bar = valid & (Y > 616) & (Y < 640)
    P["bar_rgb"] = [round(float(v), 1) for v in im[bar].mean(0)]
    P["bar_fade0"], P["bar_fade1"] = 672.0, 690.0
    line = (np.abs(Y - 609.5) < 1.0) & valid & (np.abs(X - 960) < 150)
    P["line_rgb"] = [round(float(v), 1) for v in np.percentile(im[line], 90, axis=0)]
    P["line_w"], P["line_glow"], P["line_glow_d"], P["line_glow_s"] = 2.2, 0.75, 0.0, 1.7
    P["line_x0"], P["line_x1"], P["line_floor"] = 80.0, 300.0, 0.55
    P["horizon_tint"] = [1.0, 1.0, 1.0]
    json.dump(P, open(os.path.join(HERE, "params.json"), "w"), indent=1)
    print(json.dumps({k: P[k] for k in FREE}, indent=0))


if __name__ == "__main__":
    main()
