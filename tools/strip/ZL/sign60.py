"""Package ZL: BMW's sign centre straight off our grid in photo 60, with no model reaching further than 110 px.

The four grid lines round the sign (x 500, x 600, y 600, y 700) are sampled densely in the photo (local60.sample,
1/8 px profiles of green-minus-red), only inside panel [430, 545, 660, 720] and outside r 47 of the sign, and an
AFFINE correction (3 terms per axis) on top of the 60L model is fitted to them alone. The ring is then measured
through that model (sign.measure, rays crossing a grid line or label dropped). The difference to the 60L result
is the model error at the sign; the line residuals give the local fit's own error.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lmodel as LM  # noqa: E402
import local60 as L6  # noqa: E402
import sign as S  # noqa: E402

BOXL = (430, 545, 660, 720)
C = (538.4, 621.3)


def main():
    lm, ph, e = LM.load('60L')
    G = L6.gmr(ph)
    L6.BOX = (BOXL[0], BOXL[1], BOXL[2], BOXL[3])
    pts = L6.sample(G, lm, 5)
    keep = []
    for p in pts:
        x, y = p[0]
        n = p[2]
        if not (BOXL[0] <= x <= BOXL[2] and BOXL[1] <= y <= BOXL[3]):
            continue
        if np.hypot(x - C[0] + 0.5, y - C[1] + 0.5) < 47:
            continue
        if n not in ('v500', 'v600', 'h600', 'h700'):
            continue
        keep.append(p)
    src = np.float64([p[0] for p in keep])
    dst = np.float64([p[1] for p in keep])
    ax = np.array([[p[2][0] == 'v', p[2][0] == 'h'] for p in keep])
    base_resid = lm.to_panel(dst) - src
    # affine correction on top of 60L: d = a + b u + c v (u, v as in lmodel.terms), per axis, normal component only
    t = LM.terms(src)[:, :3]
    cx = np.linalg.lstsq(t[ax[:, 0]], base_resid[ax[:, 0], 0], rcond=None)[0]
    cy = np.linalg.lstsq(t[ax[:, 1]], base_resid[ax[:, 1], 1], rcond=None)[0]
    lm2 = LM.LModel(lm.base, lm.cx + np.r_[cx, np.zeros(7)], lm.cy + np.r_[cy, np.zeros(7)])
    r2 = lm2.to_panel(dst) - src
    per = {}
    for p, a, b in zip(keep, base_resid, r2):
        k = 0 if p[2][0] == 'v' else 1
        per.setdefault(p[2], [[], []])
        per[p[2]][0].append(a[k])
        per[p[2]][1].append(b[k])
    stats = {n: {'n': len(v[0]), 'mean_60L': round(float(np.mean(v[0])), 3), 'mean_local': round(float(np.mean(v[1])), 3),
                 'sd_local': round(float(np.std(v[1])), 3)} for n, v in per.items()}
    shift = lm2.to_panel(lm.to_photo([[C[0] - 0.5, C[1] - 0.5]]))[0] - (np.array(C) - 0.5)
    S.load = lambda photo, hjson=None: (lm2, ph, e)
    o = S.measure('60')
    out = {'line_stats': stats, 'model_shift_at_sign_vs_60L': [round(float(v), 3) for v in shift],
           'centre_outer': o['centre_outer'], 'r_outer': o['r_outer'], 'centre_inner': o['centre_inner'],
           'r_inner': o['r_inner'], 'rays_used': o['rays_used'], 'outer_resid_rms': o['outer_resid_rms']}
    json.dump(out, open(os.path.join(S.ZD, 'sign60_local.json'), 'w'), indent=1)
    print(json.dumps(out, indent=1, default=float))


if __name__ == '__main__':
    main()
