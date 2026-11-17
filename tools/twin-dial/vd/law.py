"""Fit the tick lattice of a dial: theta_k = theta0 + k * pitch over the bright ticks of ticks.py.

Usage: law.py KEY lo hi [min_contrast]
Ticks are unwrapped to the scale's direction (start in the lower left, clockwise), indexed by rounding to the
median pitch, and fitted by least squares; prints theta0, pitch, residual rms, the index range and outliers.
"""
import sys, os, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from ticks import bright_ticks


def fit(key, lo, hi, cmin=0.15, start=200.0):
    t = [x for x in bright_ticks(key, lo, hi) if x['contrast'] >= cmin and x['r_out'] - x['r_in'] > 0.01]
    th = np.array([(x['theta'] - start) % 360 + start for x in t])
    o = np.argsort(th); th = th[o]; t = [t[i] for i in o]
    th = th[th < start + 300]  # the scale stays clear of the bottom gap
    d = np.diff(th)
    pitch = np.median(d[d < 1.5 * np.median(d)])
    k = np.round((th - th[0]) / pitch)
    for _ in range(3):
        A = np.vstack([np.ones_like(k), k]).T
        (a, b), *_ = np.linalg.lstsq(A, th, rcond=None)
        res = th - (a + b * k)
        good = np.abs(res) < 0.8
        A = A[good]; (a, b), *_ = np.linalg.lstsq(A, th[good], rcond=None)
        k = np.round((th - a) / b)
    res = th - (a + b * k)
    good = np.abs(res) < 0.8
    return dict(theta0=a % 360, pitch=b, n=int(good.sum()), kmin=int(k[good].min()), kmax=int(k[good].max()),
                rms=float(np.sqrt(np.mean(res[good] ** 2))), first=float(th[good][0] % 360), last=float(th[good][-1] % 360),
                outliers=[(float(x % 360), float(r)) for x, r, g in zip(th, res, good) if not g],
                missing=sorted(set(range(int(k[good].min()), int(k[good].max()) + 1)) - set(k[good].astype(int).tolist())),
                width_R=float(np.median([x['width_R'] for x, g in zip(t, good) if g])),
                r_in=float(np.median([x['r_in'] for x, g in zip(t, good) if g])),
                r_out=float(np.median([x['r_out'] for x, g in zip(t, good) if g])))


if __name__ == '__main__':
    key, lo, hi = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    cmin = float(sys.argv[4]) if len(sys.argv) > 4 else 0.15
    r = fit(key, lo, hi, cmin)
    for k, v in r.items():
        print(k, v)
