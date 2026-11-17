"""Package VC: radial colour profiles of the dials, in dial units, on the references.

Works on the polar unwraps (unwrap.py: VR's rectified frames when published, rho = 1 on the bezel's centre line).
Bins of rho 0.005 wide over the scale arc only (theta in ARC, the needle's sector masked). Per bin: the median of
linear R, G, B over VR's valid pixels ('med', 'Y'), and over ALL pixels the 10 / 25 / 75 / 90 % of Y and the
clipped share (any channel >= 250) - so thin white lines that the valid mask removes still show. Also per 30-degree
sector the valid median of the band (0.63..0.87) to show angular shading.

Writes bake/work/twin-dial/VC/profiles.json.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

ARC = (-125.0, 125.0)
# the needle's sector per (ref, dial): masked (deg cw from 12, half width); 'needle' samples look here
NEEDLE = {
    ('01', 'tacho'): (-100, 8), ('01', 'speedo'): (-143, 10),
    ('02', 'tacho'): (-88, 8), ('02', 'speedo'): (-128, 10),
    ('03', 'tacho'): (-95, 8), ('03', 'speedo'): (-142, 10),
    ('04', 'tacho'): (-122, 10), ('04', 'speedo'): (-125, 10),
    ('05', 'tacho'): (-133, 10), ('05', 'speedo'): (-133, 10),
}
RHO0, RHO1, NRHO, UPD, TH0 = 0.45, 1.05, 600, 4.0, -150.0
STEP = 5  # rows per bin = 0.005 R


def load(rid, name):
    u = np.load(os.path.join(C.WORK, 'unwrap_%s_%s.npy' % (rid, name))).astype(np.float64)
    ok = np.load(os.path.join(C.WORK, 'unwrap_%s_%s_valid.npy' % (rid, name)))
    rh = np.linspace(RHO0, RHO1, NRHO)
    th = TH0 + np.arange(u.shape[1]) / UPD
    return u, ok, rh, th


def arc_mask(rid, name, th):
    m = (th >= ARC[0]) & (th <= ARC[1])
    nd = NEEDLE.get((rid, name))
    if nd is not None:
        m &= np.abs(((th - nd[0]) + 180) % 360 - 180) > nd[1]
    return m


def main():
    out = {}
    for rid in sorted(C.REFS):
        out[rid] = {}
        for name in ('tacho', 'speedo'):
            u, ok, rh, th = load(rid, name)
            tm = arc_mask(rid, name, th)
            rad = []
            for i in range(0, NRHO - STEP + 1, STEP):
                blk = u[i:i + STEP][:, tm].reshape(-1, 3)
                okb = ok[i:i + STEP][:, tm].ravel()
                Y = C.lum(blk)
                e = {'rho': round(float(rh[i:i + STEP].mean()), 4), 'n': int(len(Y)),
                     'valid': float(okb.mean()),
                     'Y10': float(np.percentile(Y, 10)), 'Y25': float(np.percentile(Y, 25)),
                     'Y75': float(np.percentile(Y, 75)), 'Y90': float(np.percentile(Y, 90)),
                     'Y99': float(np.percentile(Y, 99)),
                     'clip': float((blk.max(axis=1) >= C.s2l(250)).mean())}
                if okb.sum() >= 8:
                    e['med'] = np.median(blk[okb], axis=0)
                    e['Y'] = float(np.median(C.lum(blk[okb])))
                else:
                    e['med'] = np.median(blk, axis=0)
                    e['Y'] = float(np.median(Y))
                    e['unmasked'] = True
                rad.append(e)
            sec = []
            rsel = (rh > 0.63) & (rh < 0.87)
            for s0 in range(-120, 120, 30):
                tsel = tm & (th >= s0) & (th < s0 + 30)
                blk = u[rsel][:, tsel].reshape(-1, 3)
                okb = ok[rsel][:, tsel].ravel()
                if okb.sum() < 30:
                    continue
                v = blk[okb]
                Y = C.lum(v)
                v = v[Y < 2 * np.median(Y) + 0.003]  # numerals out
                sec.append({'from': s0, 'to': s0 + 30, 'n': int(len(v)), 'med': np.median(v, axis=0),
                            'Y': float(np.median(C.lum(v)))})
            out[rid][name] = {'radial': rad, 'band_sectors': sec}
    C.jdump(out, os.path.join(C.WORK, 'profiles.json'))


if __name__ == '__main__':
    main()
