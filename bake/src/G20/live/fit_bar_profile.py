"""Package D, step 2: the pointer bar's cross profile and caps (colour, width, dark rim), per look.

  tools/g20sim/D/py bake/src/G20/live/fit_bar_profile.py   (after fit_scales.py)

Averages the perpendicular RGB profile over the clean middle of each bar (rect 08 = night, 09 = day, 14 = connected)
and fits: core colour (mean of the central 3 px), FWHM, dark-rim depth and width on each side, the face colour beside
it. Also the along-bar profile at the inner cap (how round / soft the end is).
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common_live import SCRATCH, rect  # noqa: E402


def profile(rgb, outer, inner, t0, t1, half=14, step=0.5):
    outer, inner = np.array(outer), np.array(inner)
    d = (inner - outer) / np.linalg.norm(inner - outer)
    n = np.array([-d[1], d[0]])       # +n: to the bar's right when looking from the outer end inward
    offs = np.arange(-half, half + 1e-6, step)
    acc = []
    for t in np.arange(t0, t1, 1.0):
        P = outer + d * t
        xy = P[None, :] + offs[:, None] * n[None, :]
        mx, my = xy[:, 0].astype(np.float32).reshape(1, -1), xy[:, 1].astype(np.float32).reshape(1, -1)
        acc.append(np.stack([cv2.remap(rgb[..., c], mx, my, cv2.INTER_LINEAR).ravel() for c in range(3)], 1))
    return offs, np.median(np.array(acc), 0), n


def along(rgb, outer, inner, ext=12, step=0.5):
    outer, inner = np.array(outer), np.array(inner)
    d = (inner - outer) / np.linalg.norm(inner - outer)
    L = np.linalg.norm(inner - outer)
    ts = np.arange(-ext, L + ext, step)
    xy = outer[None, :] + ts[:, None] * d[None, :]
    mx, my = xy[:, 0].astype(np.float32).reshape(1, -1), xy[:, 1].astype(np.float32).reshape(1, -1)
    return ts, np.stack([cv2.remap(rgb[..., c], mx, my, cv2.INTER_LINEAR).ravel() for c in range(3)], 1)


def main():
    fs = json.load(open(os.path.join(SCRATCH, 'fit_scales.json')))
    out = {}
    # clean stretches of each bar (t from the outer end), avoiding numerals, the '0 km/h' digits, the info line
    spans = {'08.tacho': (40, 150), '09.tacho': (40, 150), '14.tacho': (20, 90),
             '08.speedo': (75, 165), '09.speedo': (75, 165), '14.speedo': (75, 165)}
    for k, (t0, t1) in spans.items():
        b = fs['bars'][k]
        rgb = rect(k.split('.')[0])
        offs, P, n = profile(rgb, b['outer'], b['inner'], t0, t1)
        G = P[:, 1]
        k0 = int(np.argmax(G))
        core = P[np.abs(offs - offs[k0]) <= 1.5].mean(0)
        # face beside the bar: 10..14 px each side
        left = P[(offs < offs[k0] - 10)].mean(0)
        right = P[(offs > offs[k0] + 10)].mean(0)
        # rim minimum each side within 3..8 px
        lm = P[(offs < offs[k0] - 2.5) & (offs > offs[k0] - 8)]
        rm = P[(offs > offs[k0] + 2.5) & (offs < offs[k0] + 8)]
        li, ri = np.argmin(lm.sum(1)), np.argmin(rm.sum(1))
        base = np.minimum(left, right)
        hm = base[1] + (core[1] - base[1]) / 2
        above = offs[G > hm]
        fwhm = float(above.max() - above.min()) if len(above) else None
        out[k] = dict(core=core.round(1).tolist(), fwhm=fwhm, rim_left=lm[li].round(1).tolist(), rim_right=rm[ri].round(1).tolist(),
                      rim_left_at=float(offs[(offs < offs[k0] - 2.5) & (offs > offs[k0] - 8)][li] - offs[k0]),
                      rim_right_at=float(offs[(offs > offs[k0] + 2.5) & (offs < offs[k0] + 8)][ri] - offs[k0]),
                      face_left=left.round(1).tolist(), face_right=right.round(1).tolist(), centre_off=float(offs[k0]),
                      profile=[[float(o)] + p.round(1).tolist() for o, p in zip(offs, P)])
        print('%-10s core %s fwhm %.1f  rim L %s @%.1f  rim R %s @%.1f  face L %s R %s' % (
            k, out[k]['core'], fwhm, out[k]['rim_left'], out[k]['rim_left_at'], out[k]['rim_right'], out[k]['rim_right_at'],
            out[k]['face_left'], out[k]['face_right']))
        ts, A = along(rgb, b['outer'], b['inner'])
        out[k]['along'] = [[float(t)] + a.round(1).tolist() for t, a in zip(ts, A)]
    json.dump(out, open(os.path.join(SCRATCH, 'fit_bar_profile.json'), 'w'), indent=1)
    # print the cross profiles compactly for the two tacho looks
    for k in ('08.tacho', '09.tacho'):
        print(k, ' '.join('%+.1f:%d/%d/%d' % tuple(r) for r in out[k]['profile'][::2]))
    for k in ('08.tacho', '09.tacho', '14.tacho'):
        A = out[k]['along']
        L = fs['bars'][k]['length']
        print(k, 'inner cap', ' '.join('%.0f:%d' % (r[0], r[2]) for r in A if L - 10 < r[0] < L + 10 and int(r[0] * 2) % 2 == 0))
        print(k, 'outer cap', ' '.join('%.0f:%d' % (r[0], r[2]) for r in A if -10 < r[0] < 12 and int(r[0] * 2) % 2 == 0))


if __name__ == '__main__':
    main()
