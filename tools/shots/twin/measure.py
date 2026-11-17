"""tools/shots/twin: measuring a rendered dial. The needle's angle from the pixels, against the law of SPEC 5.1 / 5.2.

A needle is the only long straight white thing between the inner disc's rim (rho 0.545) and the scale numerals
(rho >= 0.65), so the angle is the ray (degrees clockwise from 12 o'clock) that is white along rho 0.47-0.52 and
0.585-0.65 R. Works on the picture of OUR layers over black (what the mockup is, too). numpy only.
"""
import math

import numpy as np

R = 300.0
CT, CS = (380.0, 400.0), (1540.0, 400.0)
SWEEP = 125.0


def tach_angle(rpm, off=False):
    if off:
        return -135.0
    return min(SWEEP, -SWEEP + 2 * SWEEP * rpm / 8000.0)


def speed_angle(v):
    return -SWEEP + 25.0 * (v / 20.0) if v <= 100 else min(SWEEP, 25.0 * (v - 100) / 40.0)


def _samples(img, c, ang_deg, rhos):
    t = math.radians(ang_deg)
    xs = c[0] + rhos * R * math.sin(t)
    ys = c[1] - rhos * R * math.cos(t)
    xi = np.clip(np.round(xs - 0.5).astype(int), 0, img.shape[1] - 1)
    yi = np.clip(np.round(ys - 0.5).astype(int), 0, img.shape[0] - 1)
    return img[yi, xi]


def needle_angle(rgb, c, lo=-160.0, hi=160.0):
    """-> (angle deg, confidence 0..1 = the white fraction along the ray) or (None, 0). rgb: H x W x 3 float 0..1."""
    luma = rgb.max(axis=2) if rgb.ndim == 3 else rgb
    rhos = np.concatenate([np.linspace(0.47, 0.52, 11), np.linspace(0.585, 0.65, 14)])
    ref = float(luma[int(c[1] - 0.99 * R):int(c[1] + 0.2 * R), int(c[0] - R):int(c[0] + R)].max()) or 1.0
    thr = 0.5 * ref

    def score(a):
        return float((_samples(luma, c, a, rhos) > thr).mean())
    grid = np.arange(lo, hi + 0.001, 0.25)
    sc = np.array([score(a) for a in grid])
    if sc.max() < 0.5:
        return None, float(sc.max())
    best = grid[sc >= sc.max() - 1e-9]
    a0 = float(best.mean())           # the middle of the plateau of equal scores
    fine = np.arange(a0 - 0.6, a0 + 0.6001, 0.05)
    fs = np.array([score(a) for a in fine])
    top = fine[fs >= fs.max() - 1e-9]
    return float(top.mean()), float(fs.max())
