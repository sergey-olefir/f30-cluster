"""Find the scale's ticks on a dial: bright (white) ticks in a radial window, and dark major lines in the band.

Usage: ticks.py KEY lo hi [dark lo hi]
  bright ticks: per 0.1 deg column, the max over rho in [lo, hi] of whiteness; peaks above a local threshold are ticks.
  For each tick: angle (centroid), angular FWHM -> width in R at the tick's mid radius, radial extent (inner, outer) where
  the column's whiteness is above half the peak.
  dark lines: per column, the mean luma over [lo, hi] in the band; minima deeper than 25 % below the local median.
"""
import sys, os, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from radial import sample, luma
from dialfit import whiteness
from scipy.signal import find_peaks
from scipy.ndimage import median_filter

STEP = 0.1


def bright_ticks(key, lo, hi, th0=0, th1=360, prom=0.08):
    th = np.arange(th0, th1, STEP)
    rho = np.arange(lo, hi, 0.002)
    p = sample(key, th, rho)
    w = whiteness(p)
    col = w.max(axis=0)
    base = median_filter(col, size=int(6 / STEP), mode='wrap')
    sig = col - base
    pk, pr = find_peaks(sig, prominence=prom, distance=int(0.8 / STEP))
    out = []
    for k in pk:
        h = sig[k]
        # angular FWHM
        a = k
        while a > 0 and sig[a] > h / 2: a -= 1
        b = k
        while b < len(sig) - 1 and sig[b] > h / 2: b += 1
        seg = slice(a + 1, b)
        wts = np.clip(sig[seg], 0, None)
        ang = float((th[seg] * wts).sum() / wts.sum()) if wts.sum() > 0 else float(th[k])
        c = w[:, k]
        on = np.where(c > base[k] + h / 2)[0]
        r_in, r_out = (float(rho[on[0]]), float(rho[on[-1]])) if len(on) else (np.nan, np.nan)
        fw = (b - a - 1) * STEP
        rm = (r_in + r_out) / 2
        out.append(dict(theta=ang, fwhm_deg=fw, width_R=float(np.radians(fw) * rm), r_in=r_in, r_out=r_out, peak=float(col[k]),
                        contrast=float(h)))
    return out


def dark_lines(key, lo, hi, th0=0, th1=360, depth=0.2):
    th = np.arange(th0, th1, STEP)
    rho = np.arange(lo, hi, 0.002)
    L = luma(sample(key, th, rho))
    col = np.median(L, axis=0)
    base = median_filter(col, size=int(8 / STEP), mode='wrap')
    rel = (base - col) / np.maximum(base, 1e-3)
    pk, _ = find_peaks(rel, height=depth, distance=int(1.5 / STEP))
    return [dict(theta=float(th[k]), depth=float(rel[k])) for k in pk]


if __name__ == '__main__':
    key, lo, hi = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    mode = sys.argv[4] if len(sys.argv) > 4 else 'bright'
    if mode == 'bright':
        for t in bright_ticks(key, lo, hi):
            print('%7.2f  fw %.2f deg  w %.4f R  r %.3f..%.3f  peak %.2f  c %.2f' % (
                t['theta'], t['fwhm_deg'], t['width_R'], t['r_in'], t['r_out'], t['peak'], t['contrast']))
    else:
        for t in dark_lines(key, lo, hi):
            print('%7.2f  depth %.2f' % (t['theta'], t['depth']))
