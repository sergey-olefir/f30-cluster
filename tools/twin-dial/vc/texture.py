"""Package VC: the scale band's texture, measured on the polar unwraps (unwrap.py).

Windows clear of numerals and ticks: rho 0.585..0.655 (inner) and 0.825..0.860 (outer, under the track), theta
-115..115 minus the needle. In each window, linear Y:
- the smooth field = a running median over 6 deg along theta, per row (keeps the radial and angular shading);
- texture = Y / smooth - 1 (relative modulation), with pixels > 4 robust sigma (dividers, numeral edges) set aside;
- its rms and its 10 / 90 % (the 'two tones' as multipliers of the smooth field);
- its spectrum along theta (mean over rows, Welch): the strongest period in R units (arc length at the window's rho)
  and in degrees, with the noise floor; and the autocorrelation length along rho.
The camera's own noise / JPEG floor is estimated the same way on the hub disc just inside the inner ring
(rho 0.45..0.48, flat black; crushed to 0 on 02, so no floor there). Correlation lengths: the lag (in R) at which
the autocorrelation of the texture falls under 0.5, along rho and along theta; streaks along rho ('brushed'
radially) show as radial >> theta.

Writes bake/work/twin-dial/VC/texture.json.
"""
import os
import sys

import numpy as np
from scipy.ndimage import median_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
from profiles import NEEDLE  # noqa: E402

UPD = 4.0
TH0 = -150.0
RHO0, RHO1, NRHO = 0.45, 1.05, 600
WINDOWS = {'inner': (0.585, 0.655), 'outer': (0.825, 0.860)}


def rows(r0, r1):
    rh = np.linspace(RHO0, RHO1, NRHO)
    return np.nonzero((rh >= r0) & (rh <= r1))[0], rh


def analyse(Y, rho_mid, nd):
    nth = Y.shape[1]
    th = TH0 + np.arange(nth) / UPD
    keep_th = (th >= -115) & (th <= 115)
    if nd is not None:
        keep_th &= np.abs(((th - nd[0]) + 180) % 360 - 180) > nd[1] + 4
    smooth = median_filter(Y, size=(1, int(6 * UPD)), mode='nearest')  # per row: keeps the radial gradient
    t = Y / np.maximum(smooth, 1e-5) - 1.0
    tt = t[:, keep_th]
    med = np.median(tt)
    mad = 1.4826 * np.median(np.abs(tt - med))
    ok = np.abs(tt - med) < 4 * max(mad, 1e-4)
    vals = tt[ok]
    # spectrum along theta on the longest run of kept columns
    idx = np.nonzero(keep_th)[0]
    runs = np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1)
    run = max(runs, key=len)
    seg = np.clip(t[:, run], med - 4 * mad, med + 4 * mad)
    seg = seg - seg.mean(axis=1, keepdims=True)
    n = 256 if seg.shape[1] >= 256 else seg.shape[1]
    ps = []
    for s0 in range(0, seg.shape[1] - n + 1, n // 2):
        w = np.hanning(n)
        ps.append(np.abs(np.fft.rfft(seg[:, s0:s0 + n] * w, axis=1)) ** 2)
    P = np.mean(np.concatenate(ps, axis=0), axis=0)
    f = np.fft.rfftfreq(n, d=1.0 / UPD)  # cycles per degree
    band = (f > 0.17) & (f < 1.6)  # periods 0.6 .. 6 deg (the 6-deg median removes slower ones)
    k = np.argmax(P * band)
    floor = np.median(P[band])
    per_deg = 1.0 / f[k] if f[k] > 0 else float('nan')
    # radial autocorrelation length (rows are 0.001 R apart)
    a = seg - seg.mean()
    ac = [np.mean(a[:-d or None] * a[d:]) / np.mean(a * a) for d in range(0, min(30, a.shape[0] - 1))]
    lr = next((d for d, v in enumerate(ac) if v < 0.5), len(ac))
    act = [np.mean(a[:, :-d or None] * a[:, d:]) / np.mean(a * a) for d in range(0, min(40, a.shape[1] - 1))]
    lt = next((d for d, v in enumerate(act) if v < 0.5), len(act))
    return {'rho': rho_mid, 'rms': float(np.std(vals)), 'p10': float(np.percentile(vals, 10)),
            'p90': float(np.percentile(vals, 90)), 'mad': float(mad),
            'peak_period_deg': float(per_deg), 'peak_period_R': float(np.radians(per_deg) * rho_mid),
            'peak_over_floor': float(P[k] / max(floor, 1e-12)),
            'radial_corr_len_R': lr * (RHO1 - RHO0) / (NRHO - 1),
            'theta_corr_len_R': float(np.radians(lt / UPD) * rho_mid),
            'smooth_Y_med': float(np.median(smooth))}


def main():
    ell = C.jload(os.path.join(C.WORK, 'ellipses.json'))
    out = {}
    for rid in sorted(ell):
        out[rid] = {}
        for name in ell[rid]:
            u = np.load(os.path.join(C.WORK, 'unwrap_%s_%s.npy' % (rid, name)))
            Y = C.lum(u.astype(np.float64))
            res = {}
            for wn, (r0, r1) in list(WINDOWS.items()) + [('hub_floor', (0.45, 0.48))]:
                r_idx, rh = rows(r0, r1)
                res[wn] = analyse(Y[r_idx], (r0 + r1) / 2, NEEDLE.get((rid, name)))
            out[rid][name] = res
            print(rid, name, {k: (round(v['rms'], 3), round(v['p10'], 3), round(v['p90'], 3),
                                  round(v['radial_corr_len_R'], 4), round(v['theta_corr_len_R'], 4),
                                  round(v['smooth_Y_med'], 4)) for k, v in res.items()})
    C.jdump(out, os.path.join(C.WORK, 'texture.json'))


if __name__ == '__main__':
    main()
