"""Package ZL: a local photo model for zone L = rectify.py's Model (homography + radial k1) with a cubic
panel-space correction on top:   photo = base.to_photo(p + C(p)),  C a 2-D cubic (10 terms per axis).

A plain homography + k1 leaves 2-4 px of structured residual at x 100-300 on photo 60's grid (and on 10's), so
zone L gets the correction, fitted on dense points along the grid lines (60) or on patch matches (the others).
Coordinates: OpenCV pixel-centre convention inside; reports convert to continuous (+0.5) at the boundary.
"""
import json
import os
import sys

import cv2
import numpy as np

ROOT = os.environ.get('F30_MAIN', os.path.expanduser('~/projects/f30-cluster'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'overlay'))
import rectify as R  # noqa: E402

R.ROOT = ROOT
HJ = os.path.join(ROOT, 'bake', 'work', 'strip', 'zone-L', 'H.json')
CX, CY, SC = 400.0, 620.0, 400.0     # normalisation of the polynomial's argument


def terms(p):
    p = np.atleast_2d(np.asarray(p, np.float64))
    u, v = (p[:, 0] - CX) / SC, (p[:, 1] - CY) / SC
    return np.stack([np.ones_like(u), u, v, u * u, u * v, v * v, u ** 3, u * u * v, u * v * v, v ** 3], 1)


class LModel:
    def __init__(self, base, cx=None, cy=None):
        self.base = base
        self.cx = np.zeros(10) if cx is None else np.asarray(cx, np.float64)
        self.cy = np.zeros(10) if cy is None else np.asarray(cy, np.float64)
        self.size = base.size

    def corr(self, p):
        t = terms(p)
        return np.stack([t @ self.cx, t @ self.cy], 1)

    def to_photo(self, p):
        p = np.atleast_2d(np.asarray(p, np.float64))
        return self.base.to_photo(p + self.corr(p))

    def to_panel(self, q):
        b = self.base.to_panel(q)
        p = b.copy()
        for _ in range(8):
            p = b - self.corr(p)
        return p

    def scale(self, x=400, y=640):
        a = self.to_photo([[x, y], [x + 1, y], [x, y + 1]])
        return float((np.linalg.norm(a[1] - a[0]) + np.linalg.norm(a[2] - a[0])) / 2)

    def warp(self, photo, box, n, interp=cv2.INTER_LANCZOS4, dtype=None):
        """panel box [x0, y0, x1, y1] (continuous coords) at n x: output pixel (i, j) samples the panel point
        (x0 + (i + 0.5)/n, y0 + (j + 0.5)/n) in continuous coords, i.e. minus 0.5 in OpenCV's."""
        x0, y0, x1, y1 = box
        w, h = int(round((x1 - x0) * n)), int(round((y1 - y0) * n))
        xs, ys = np.meshgrid(x0 + (np.arange(w) + 0.5) / n - 0.5, y0 + (np.arange(h) + 0.5) / n - 0.5)
        q = self.to_photo(np.stack([xs.ravel(), ys.ravel()], 1)).reshape(h, w, 2).astype(np.float32)
        return cv2.remap(photo, q[..., 0], q[..., 1], interp, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

    def to_json(self):
        return {'H_panel_to_undistorted_photo': self.base.H.tolist(), 'k1': self.base.k1,
                'centre_photo_px': self.base.c.tolist(), 'norm_radius_photo_px': self.base.s,
                'poly_cx': self.cx.tolist(), 'poly_cy': self.cy.tolist(), 'poly_norm': [CX, CY, SC],
                'formula': 'photo = dist(H (p + C(p))), C cubic in ((x-%g)/%g, (y-%g)/%g); OpenCV centres'
                           % (CX, SC, CY, SC)}


def load(key, hj=HJ):
    e = json.load(open(hj))[key]
    m = e['model']
    ph = R.imread(e['source'])
    base = R.Model(np.array(m['H_panel_to_undistorted_photo']), (ph.shape[1], ph.shape[0]), m['k1'])
    return LModel(base, m.get('poly_cx'), m.get('poly_cy')), ph, e


def fit_poly(lm, src, dst, axis_mask=None, ridge=1e-4):
    """Refit the correction so lm.to_photo(src) ~ dst. axis_mask[i] = (use_x, use_y)."""
    b = lm.base.to_panel(dst) - src            # wanted correction at src
    t = terms(src)
    out = []
    for k in (0, 1):
        sel = np.ones(len(src), bool) if axis_mask is None else axis_mask[:, k]
        A, y = t[sel], b[sel, k]
        c = np.linalg.solve(A.T @ A + ridge * np.eye(10) * len(A), A.T @ y)
        out.append(c)
    return LModel(lm.base, out[0], out[1])
