"""Package VC: polar unwraps of each dial (theta across, rho down), for looking at the band's texture and shading.

Geometry: common.frame (VR's rectified frames when published, else the provisional ellipses); VR's valid
mask (glare, clipped and near-clipped pixels) is saved beside it (_valid.npy; tinted magenta in _valid.png): flat
materials use it, thin bright lines (bezel, ticks, numerals) cannot (it removes them) and report their clipping.
Output (photo-derived, git-ignored): bake/work/twin-dial/VC/unwrap_<ref>_<dial>.png, theta -150..150 deg at
UPD px per degree, rho 0.45..1.05 at UPR px per 0.001 R; plus a contrast-stretched copy of the band (0.55..0.90).
Also returns the unwrapped linear arrays for texture.py.
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

TH = (-150.0, 150.0)
RHO = (0.45, 1.05)


def unwrap(lin, e, upd=4.0, nrho=600, valid=None):
    cx, cy, a, b, phi = e
    ths = np.radians(np.arange(TH[0], TH[1], 1.0 / upd))
    rhos = np.linspace(RHO[0], RHO[1], nrho)
    T, Rr = np.meshgrid(ths, rhos)
    # frontal circle point (x0, y0) with y up = -image y; then into the ellipse frame
    x0, y0 = Rr * np.sin(T), -Rr * np.cos(T)
    c, s = np.cos(np.radians(phi)), np.sin(np.radians(phi))
    u = x0 * c + y0 * s
    v = -x0 * s + y0 * c
    dx = a * u * c - b * v * s
    dy = a * u * s + b * v * c
    mx = (cx - 0.5 + dx).astype(np.float32)
    my = (cy - 0.5 + dy).astype(np.float32)
    out = np.dstack([cv2.remap(lin[:, :, k].astype(np.float32), mx, my, cv2.INTER_LINEAR) for k in range(3)])
    ok = np.ones(out.shape[:2], bool)
    if valid is not None:
        ok = cv2.remap(valid.astype(np.float32), mx, my, cv2.INTER_LINEAR, borderValue=0) > 0.999
    return out, ok, ths, rhos


def main():
    for rid in sorted(C.REFS):
        lin, valid, dials, src = C.frame(rid)
        print(rid, 'frame:', src)
        for name, e in dials.items():
            u, ok, ths, rhos = unwrap(lin, e, valid=valid)
            np.save(os.path.join(C.WORK, 'unwrap_%s_%s.npy' % (rid, name)), u.astype(np.float32))
            np.save(os.path.join(C.WORK, 'unwrap_%s_%s_valid.npy' % (rid, name)), ok)
            vis = C.l2s(u)[:, :, ::-1].astype(np.uint8)
            cv2.imwrite(os.path.join(C.WORK, 'unwrap_%s_%s.png' % (rid, name)), vis)
            vis[~ok] = (vis[~ok] * 0.5 + np.array([128, 0, 128])).astype(np.uint8)
            cv2.imwrite(os.path.join(C.WORK, 'unwrap_%s_%s_valid.png' % (rid, name)), vis)
            sel = (rhos > 0.56) & (rhos < 0.86)
            band = C.lum(u[sel])
            lo, hi = np.percentile(band, 2), np.percentile(band, 98)
            st = np.clip((band - lo) / max(hi - lo, 1e-6), 0, 1) * 255
            cv2.imwrite(os.path.join(C.WORK, 'band_%s_%s.png' % (rid, name)), st.astype(np.uint8))


if __name__ == '__main__':
    main()
