"""P9 light-model check (P1 vs P2): are the bezel lobes and the groove-rim key the same light on both dials, or mirror
images? Measured in each dial's OWN frame (no mirroring) on the photos that show both dials.

For each crop: the bezel ridge peak (r 0.965-1.02 R) and the groove inner rim (r 0.795-0.83 R, 30th percentile) per
cw12 angle (2 deg bins, mask bits 1|4|8 excluded; glare kept: the question is exactly what is drawn vs reflected).
Then per photo: correlation of speedo(t) with tacho(t) ("same light") and with tacho(360 - t) ("mirrored"), lobe peaks,
and the first-harmonic direction of the groove rim (math degrees)."""
import json
import math
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import geom  # noqa: E402

RECT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "work", "rect")
PAIRS = ["04_comfort_whole-cluster_mph.comfort", "17_physical-cluster_full.comfort",
         "03_three-modes_photo_bimmerstop.comfort", "06_comfort_wide_with-wheel.comfort",
         "02_three-modes_clean-render.comfort", "07_physical-cluster_all-lamps-lit.comfort"]
SINGLE = ["05_comfort_tach-closeup.comfort.C2", "12_speedo_signs_overspeed-wedge.comfort.C1"]
DA = 2.0


def unwrap(base, r0, r1, dr=0.002):
    meta = json.load(open(os.path.join(RECT, base + ".json")))
    k, box, cl = int(meta.get("scale", 1)), meta["box"], meta["cluster"]
    c, R = geom.G20[cl]["c"], geom.G20[cl]["R"]
    img = cv2.imread(os.path.join(RECT, base + ".png"), cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32)
    L = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    bp = os.path.join(RECT, base + ".maskbits.png")
    bits = cv2.imread(bp, cv2.IMREAD_GRAYSCALE) if os.path.exists(bp) else np.zeros(L.shape, np.uint8)
    bad = ((bits & (1 | 4 | 8)) > 0).astype(np.float32)
    A = np.arange(0, 360, 0.25)
    Rr = np.arange(r0, r1, dr)
    AA, RR = np.meshgrid(A, Rr)
    u, v = RR * np.sin(np.radians(AA)), -RR * np.cos(np.radians(AA))
    px = ((c[0] + u * R - box[0]) * k - 0.5).astype(np.float32)
    py = ((c[1] + v * R - box[1]) * k - 0.5).astype(np.float32)
    Lp = cv2.remap(L, px, py, cv2.INTER_LINEAR, borderValue=0)
    Bp = cv2.remap(bad, px, py, cv2.INTER_NEAREST, borderValue=1)
    return Lp, Bp, A


def profile(base, r0, r1, stat):
    Lp, Bp, A = unwrap(base, r0, r1)
    out = np.full(int(360 / DA), np.nan)
    for i in range(len(out)):
        sel = (A >= i * DA) & (A < (i + 1) * DA)
        col = Lp[:, sel]
        ok = Bp[:, sel] < 0.5
        if ok.mean() < 0.6:
            continue
        vals = col[ok]
        out[i] = vals.max() if stat == "max" else np.percentile(vals, 30)
    return out


def smooth(p, sd_deg=6.0):
    n = len(p)
    k = np.arange(-n // 2, n // 2) * DA
    g = np.exp(-0.5 * (k / sd_deg) ** 2)
    ok = np.isfinite(p).astype(float)
    v = np.nan_to_num(p)
    num = np.real(np.fft.ifft(np.fft.fft(v) * np.fft.fft(np.fft.ifftshift(g))))
    den = np.real(np.fft.ifft(np.fft.fft(ok) * np.fft.fft(np.fft.ifftshift(g))))
    s = num / np.maximum(den, 1e-6)
    s[den < 0.3] = np.nan
    return s


def lobes(p, n=3, min_sep=40.0):
    s = smooth(p)
    ang = np.arange(len(s)) * DA + DA / 2
    order = np.argsort(np.nan_to_num(s, nan=-1))[::-1]
    out = []
    for i in order:
        if not np.isfinite(s[i]):
            break
        if all(min(abs(ang[i] - a), 360 - abs(ang[i] - a)) >= min_sep for a, _ in out):
            # a peak only if it is a local max over +-10 deg
            w = int(10 / DA)
            idx = [(i + j) % len(s) for j in range(-w, w + 1)]
            if s[i] >= np.nanmax(s[idx]):
                out.append((round(float(ang[i]), 1), round(float(s[i]), 1)))
        if len(out) >= n:
            break
    return out


def harmonic_math(p):
    ok = np.isfinite(p)
    ang = (np.arange(len(p)) * DA + DA / 2)[ok]
    v = p[ok]
    if len(v) < 20:
        return None
    a = np.radians(90.0 - ang)
    c, s = np.mean(v * np.cos(a)) * 2, np.mean(v * np.sin(a)) * 2
    return {"dir_math_deg": round(float(np.degrees(np.arctan2(s, c)) % 360), 1),
            "modulation": round(float(np.hypot(c, s) / max(np.mean(v), 1e-6)), 3), "coverage_deg": int(ok.sum() * DA)}


def corr(a, b):
    ok = np.isfinite(a) & np.isfinite(b)
    if ok.sum() < 30:
        return None
    return round(float(np.corrcoef(a[ok], b[ok])[0, 1]), 3)


def mirror(p):
    """t -> 360 - t on the bin grid (bin i covers [i*DA, (i+1)*DA))."""
    n = len(p)
    return np.array([p[(n - 1 - i) % n] for i in range(n)])


def run():
    res = {"pairs": {}, "single": {}}
    for ph in PAIRS:
        b1, b2 = ph + ".C1", ph + ".C2"
        if not (os.path.exists(os.path.join(RECT, b1 + ".json")) and os.path.exists(os.path.join(RECT, b2 + ".json"))):
            continue
        r1, r2 = profile(b1, 0.965, 1.02, "max"), profile(b2, 0.965, 1.02, "max")
        g1, g2 = profile(b1, 0.795, 0.83, "p30"), profile(b2, 0.795, 0.83, "p30")
        s1, s2 = smooth(r1), smooth(r2)
        res["pairs"][ph] = {
            "ridge_lobes_speedo_cw12": lobes(r1), "ridge_lobes_tacho_cw12": lobes(r2),
            "ridge_corr_same": corr(s1, s2), "ridge_corr_mirrored": corr(s1, mirror(s2)),
            "rim_dir_speedo": harmonic_math(g1), "rim_dir_tacho": harmonic_math(g2),
            "rim_corr_same": corr(smooth(g1), smooth(g2)), "rim_corr_mirrored": corr(smooth(g1), mirror(smooth(g2))),
            "ridge_by_angle_speedo": [None if not np.isfinite(x) else round(float(x)) for x in s1[::5]],
            "ridge_by_angle_tacho": [None if not np.isfinite(x) else round(float(x)) for x in s2[::5]],
        }
    for b in SINGLE:
        r, g = profile(b, 0.965, 1.02, "max"), profile(b, 0.795, 0.83, "p30")
        res["single"][b] = {"ridge_lobes_cw12": lobes(r), "rim_dir": harmonic_math(g)}
    return res


if __name__ == "__main__":
    print(json.dumps(run(), indent=1))
