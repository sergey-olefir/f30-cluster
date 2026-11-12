"""Acceptance 2 (package D): the stock pointers and their glow at rest vs the photos (SSIM, dE2000 in the pointer ROIs).

  tools/g20sim/D/py tools/g20sim/D/qc_rest.py        (harness server on :8093 must be running)

Package B's static dials are not available yet, so each photo is compared with OUR layers drawn by the real module in
headless Chrome over a stand-in base made from the OTHER photo ("cross" stand-in):
  for 08 (night, rpm 0):   base = 09 mapped to 08's exposure ((o09 - b) / a, the per-channel map fitted with the glow),
                           09's bars and rev band inpainted, 09's glow (our day model at 09's pose) taken out;
  for 09 (day, idle 700):  base = a * o08 + b, 08's bars inpainted, 08's glow (night model at 08's pose) taken out.
So the base holds everything static (faces, scale band, ticks) from the other photo, and the only thing that moved -
pointer, glow, rev band - must come from our drawing. The glow model was fitted on these same two photos: in-sample.
The reference is the photo itself. ROIs: bar = +-9 px corridor around the photo's and our bar; glow = the face polygon
within +-45 deg of the bar and 220 px of the ring, minus the catalogue's text/lamp boxes (OFF vs 0, P vs D differ
between the photos and are not ours). Also reported: the base alone (without our layers) in the same ROIs.
"""
import json
import math
import os
import re
import subprocess
import sys

import cv2
import numpy as np

WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
sys.path.insert(0, os.path.join(WT, 'bake', 'src', 'G20', 'live'))
sys.path.insert(0, os.path.join(WT, 'bake', 'src'))
from common_live import SCRATCH, elements, rect  # noqa: E402
import qc  # noqa: E402

H = os.path.join(SCRATCH, 'harness')
LIVE = os.path.join(WT, 'bench', 'g20', 'live', 'live.js')


def params():
    s = open(LIVE).read()
    return json.loads(re.search(r'/\*<PARAMS>\*/(.*?)/\*</PARAMS>\*/', s, re.S).group(1))


def V(x):
    return x['v'] if isinstance(x, dict) and 'v' in x and 'ev' in x else x


class Dial:
    """numpy twin of live.js's glow geometry."""

    def __init__(self, P, which):
        self.P, self.key, self.sgn = P, ('speedo' if which == 'speed' else 'tacho'), (1 if which == 'speed' else -1)
        D = P[self.key]
        self.C = np.array(V(D['centre']))
        sc = V(D['scale'])
        self.vals, self.pts = np.array(sc['values']), np.array(sc['pts'])
        self.th0 = math.degrees(math.atan2(self.pts[0][1] - self.C[1], self.pts[0][0] - self.C[0]))
        self.rp = self.psi(self.pts[:, 0], self.pts[:, 1])
        self.rr = np.hypot(self.pts[:, 0] - self.C[0], self.pts[:, 1] - self.C[1])

    def psi(self, x, y):
        th = np.degrees(np.arctan2(y - self.C[1], x - self.C[0]))
        d = self.sgn * (th - self.th0)
        return np.mod(d + 130, 360) - 130

    def ring(self, v):
        v = np.clip(v, self.vals[0], self.vals[-1])
        return np.array([np.interp(v, self.vals, self.pts[:, 0]), np.interp(v, self.vals, self.pts[:, 1])])

    def glow(self, v, day):
        G = self.P['glow']
        face = np.array(V(G['face'])[self.key], np.float32)
        m = np.zeros((720, 1920), np.uint8)
        cv2.fillPoly(m, [np.round(face * 8).astype(np.int32)], 1, shift=3)
        ys, xs = np.mgrid[0:720, 0:1920].astype(np.float32) + 0.5
        ps = self.psi(xs, ys)
        q = np.interp(ps, self.rp, self.rr) - np.hypot(xs - self.C[0], ys - self.C[1])
        t = np.clip((q - V(G['q0'])) / (V(G['q1']) - V(G['q0'])), 0, 1)
        wq = (1 - t * t * (3 - 2 * t)) * m
        R = self.ring(v)
        pb = self.psi(np.array([R[0]]), np.array([R[1]]))[0]
        phi = ps - pb
        s = np.where(phi > 0, V(G['sigma_hi']), V(G['sigma_lo']))
        A = np.exp(-phi ** 2 / (2 * s ** 2))
        col = np.array(V(G['rgb'])['day' if day else 'night']) * V(G['gain'])
        return (A * wq)[..., None] * col[None, None, :], ps, q, m.astype(bool), pb


def bar_mask(b, half=8):
    m = np.zeros((720, 1920), np.uint8)
    o, i = np.array(b['outer']), np.array(b['inner'])
    cv2.line(m, tuple(np.round(o).astype(int)), tuple(np.round(i).astype(int)), 1, 2 * half + 1)
    return m


def shot(name, query):
    out = os.path.join(H, name)
    url = 'http://127.0.0.1:8093/bake/work/g20sim/D/harness/index.html?' + query
    subprocess.run([os.path.join(WT, 'tools', 'g20sim', 'D', 'shot.sh'), 'png', out, url], check=True, capture_output=True)
    return cv2.imread(out)[..., ::-1].astype(np.float32)


def main():
    P = params()
    fg = json.load(open(os.path.join(SCRATCH, 'fit_glow.json')))
    fs = json.load(open(os.path.join(SCRATCH, 'fit_scales.json')))
    a, b = np.array(fg['exposure_a']), np.array(fg['exposure_b'])
    o8, o9 = rect('08'), rect('09')
    dt, dsp = Dial(P, 'rpm'), Dial(P, 'speed')
    # the photos' tacho values: 08 at 0; 09 where its bar crosses the ring (fit_scales poses)
    v09 = [r['value'] for r in fs['models']['poses'] if r['photo'] == '09.tacho'][0]
    g8t, ps8, q8, face_t, pb8 = dt.glow(0.0, False)
    g9t, ps9, q9, _, pb9 = dt.glow(v09, True)
    g8s, pss, qs, face_s, pbs = dsp.glow(0.0, False)
    g9s, _, _, _, _ = dsp.glow(0.0, True)
    # inpaint masks
    m8 = bar_mask(fs['bars']['08.tacho']) | bar_mask(fs['bars']['08.speedo'])
    m9 = bar_mask(fs['bars']['09.tacho']) | bar_mask(fs['bars']['09.speedo'])
    m9[608:633, 1532:1652] = 1                                     # 09's rev band
    u8 = cv2.inpaint(np.clip(o8, 0, 255).astype(np.uint8), m8, 6, cv2.INPAINT_TELEA).astype(np.float32)
    u9 = cv2.inpaint(np.clip(o9, 0, 255).astype(np.uint8), m9, 6, cv2.INPAINT_TELEA).astype(np.float32)
    base08 = (u9 - g9t - g9s - b) / a                               # stand-in for 08: from 09, in 08's exposure
    base09 = a * (u8 - g8t - g8s) + b                               # stand-in for 09: from 08, in 09's exposure
    for nm, im in (('base08.png', base08), ('base09.png', base09)):
        cv2.imwrite(os.path.join(H, nm), np.clip(im, 0, 255).astype(np.uint8)[..., ::-1])
    oil, fuel = 110, round(0.843 * 65, 2)
    our08 = shot('rest08.png', 'mode=scene&bg=base08.png&rpm=0&speed=0&fill=0&fuel=%s&oil=%s' % (fuel, oil))
    our09 = shot('rest09.png', 'mode=scene&bg=base09.png&rpm=%d&speed=0&day=1&fill=0&fuel=%s&oil=%s' % (round(v09 * 1000), fuel, oil))
    G = elements()
    txt = np.zeros((720, 1920), bool)
    for e in G.values():
        if e['group'] in ('structure', 'map-nav'):
            continue
        x0, y0, x1, y1 = [int(round(v)) for v in e['bbox']]
        txt[max(0, y0 - 3):y1 + 3, max(0, x0 - 3):x1 + 3] = True
    txt[562:618, 355:485] = True       # the speedo's '0 km/h' scale label (B's; the stock draws it OVER the pointer)

    def glow_roi(face, ps, q, pb):
        return face & (np.abs(ps - pb) < 45) & (q > -2) & (q < 220) & ~txt

    rows = []
    cases = [
        ('08 night, tacho at 0', o8, our08, base08, '08.tacho', glow_roi(face_t, ps8, q8, pb8)),
        ('09 day, tacho idle %.2f' % v09, o9, our09, base09, '09.tacho', glow_roi(face_t, ps9, q9, pb9)),
        ('08 night, speedo at 0', o8, our08, base08, '08.speedo', glow_roi(face_s, pss, qs, pbs)),
        ('09 day, speedo at 0', o9, our09, base09, '09.speedo', glow_roi(face_s, pss, qs, pbs)),
    ]
    for name, ref, ours, base, bk, groi in cases:
        broi = bar_mask(fs['bars'][bk], 9).astype(bool) & ~txt
        if 'tacho' in bk and '09' in bk:
            broi[608:633, 1532:1652] = True                         # the rev band is ours too
        for part, roi in (('bar', broi), ('glow', groi & ~broi)):
            m = qc.metrics(ref / 255.0, ours / 255.0, roi, want_edges=False)
            m0 = qc.metrics(ref / 255.0, np.clip(base, 0, 255) / 255.0, roi, want_edges=False)
            rows.append(dict(case=name, part=part, ssim=m['ssim'], dE=m['dE2000_mean'], dE_p95=m['dE2000_p95'],
                             luma_bias=m['luma_bias'], n=m['valid_px'], base_only_ssim=m0['ssim'], base_only_dE=m0['dE2000_mean']))
            tag = '%s_%s' % (bk.replace('.', '_'), part)
            qc.review_sheet(ref / 255.0, ours / 255.0, roi, m, os.path.join(SCRATCH, 'qc_rest_%s.png' % tag), title='%s %s' % (name, part))
    print('%-28s %-5s %7s %7s %7s %8s %7s | base only: %7s %7s' % ('case', 'part', 'SSIM', 'dE', 'dE p95', 'lumaBias', 'px', 'SSIM', 'dE'))
    for r in rows:
        print('%-28s %-5s %7.3f %7.2f %7.2f %8.2f %7d | %18.3f %7.2f' % (r['case'], r['part'], r['ssim'], r['dE'], r['dE_p95'],
                                                                         r['luma_bias'], r['n'], r['base_only_ssim'], r['base_only_dE']))
    json.dump(rows, open(os.path.join(SCRATCH, 'qc_rest.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
