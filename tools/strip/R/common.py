"""Package R (strip registration and photometry): shared helpers.

Pixel conventions (docs/AGENT-BRIEF-strip.md 4.1):
    continuous panel coordinates: pixel (i, j) covers [i, i+1) x [j, j+1), its centre is (i + 0.5, j + 0.5).
    The model in H.json is tools/overlay/rectify.py's Model and takes OpenCV panel coordinates (index = centre),
    i.e. continuous - 0.5. Everything this package writes says which one it uses; the rasters are aligned so that a
    pixel (I, J) of an n x raster covers continuous [x0 + I/n, x0 + (I+1)/n) x [y0 + J/n, y0 + (J+1)/n): a box
    average of n x n of them is exactly the 1 x pixel.

Photos are 8-bit sRGB-encoded PNG (HEIC converted by the phone; their maxima are 248..255, so the brightest
whites may be clipped). Linear light = the sRGB EOTF of the code values; no camera response is assumed beyond that.
"""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MAIN = os.environ.get('F30_MAIN', os.path.expanduser('~/projects/f30-cluster'))
sys.path.insert(0, os.path.join(REPO, 'tools', 'overlay'))
import rectify as RF  # noqa: E402

RF.ROOT = MAIN
W, H = 1920, 720
STRIP = (0, 540, 1920, 720)
OUT = os.path.join(MAIN, 'bake', 'work', 'strip', 'rect')
PUB = os.path.join(MAIN, 'bake', 'work', 'strip', 'pub', 'R')
OVR = os.path.join(MAIN, 'bake', 'work', 'overlay', 'rect')

PHOTOS = {
    '60': 'reference/g20/60_grid-over-stock_P_2026-11-16.png',
    '61': 'reference/g20/61_stock_D_limit50_road_2026-11-16.png',
    '62': 'reference/g20/62_stock_P_msg-2line_sym-i_limit50_belts_2026-11-16.png',
    '63': 'reference/g20/63_stock_P_limit50_marker-i_service_2026-11-16.png',
    '64': 'reference/g20/64_stock_P_limit30_belt1_road_2026-11-16.png',
    '65': 'reference/g20/65_stock_standby_odometer_2026-11-16.png',
    '66': 'reference/g20/66_stock_P_msg-1line_limit30_marker-warn_2026-11-16.png',
    '67': 'reference/g20/67_stock_P_limit30_marker-warn_road_service_2026-11-16.png',
    '68': 'reference/g20/68_stock_D_nolimit_msa_map_2026-11-16.png',
    '08': 'reference/g20/08_stock_night_warnings-map.jpg',
    '09': 'reference/g20/09_stock_map_day.jpg',
    '14': 'reference/g20/14_stock-under-unbound-theme_2026-11-12.jpg',
    '17': 'reference/g20/17_stock-media-list_door-open_2026-11-12.jpg',
    '39': 'reference/g20/39_g20-look_map_comfort-plus_hires_2026-11-13.jpg',
    '40': 'reference/g20/40_g20-look_zoom_fuel_speedo_empty-sign_2026-11-13.jpg',
}


def p(rel):
    return os.path.join(MAIN, rel)


def imread(pid):
    im = cv2.imread(p(PHOTOS[pid]), cv2.IMREAD_COLOR)
    if im is None:
        raise SystemExit('missing ' + PHOTOS[pid])
    return im


def size_of(im):
    return (im.shape[1], im.shape[0])


def srgb_to_lin(v8):
    v = np.asarray(v8, np.float32) / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_to_srgb(l):
    l = np.clip(np.asarray(l, np.float32), 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(l, 1 / 2.4) - 0.055).astype(np.float32)


def model_from(e, size):
    m = e['model']
    return RF.Model(np.asarray(m['H_panel_to_undistorted_photo'], np.float64), size, m['k1'])


def warp_n(photo, model, x0, y0, w, h, n, interp=cv2.INTER_CUBIC, border=0):
    """Panel box [x0, x0 + w) x [y0, y0 + h) (CONTINUOUS panel px) at n x: output (I, J) samples the continuous
    panel point (x0 + (I + .5)/n, y0 + (J + .5)/n), i.e. OpenCV panel point that minus 0.5."""
    W_, H_ = int(round(w * n)), int(round(h * n))
    xs = x0 + (np.arange(W_, dtype=np.float64) + 0.5) / n - 0.5
    ys = y0 + (np.arange(H_, dtype=np.float64) + 0.5) / n - 0.5
    X, Y = np.meshgrid(xs, ys)
    q = model.to_photo(np.stack([X.ravel(), Y.ravel()], 1)).reshape(H_, W_, 2).astype(np.float32)
    return cv2.remap(photo, q[..., 0], q[..., 1], interp, borderMode=cv2.BORDER_CONSTANT, borderValue=border)


def fit_fixed_k1(src, dst, size, k1):
    """Homography with the radial term held at k1 (OpenCV panel src -> photo dst)."""
    m = RF.Model(np.eye(3), size, k1)
    Hk = cv2.findHomography(np.float64(src), m.undist(np.float64(dst)), 0)[0]
    return RF.Model(Hk, size, k1)


def resid(model, src, dst):
    """Per point residual vector, panel px (model's panel point of the photo point minus the true panel point)."""
    return model.to_panel(np.float64(dst)) - np.float64(src)


def stats(r):
    d = np.linalg.norm(np.asarray(r).reshape(-1, 2), axis=1)
    if not len(d):
        return {'n': 0}
    return {'n': int(len(d)), 'rms': round(float(np.sqrt((d ** 2).mean())), 3), 'max': round(float(d.max()), 3)}


def strip_model(model, src, dst, size, y_min=520.0, thr=2.0):
    """Local model for the STRIP: the global form with its k1, H refitted on the points with y >= y_min only.
    Points beyond thr panel px of the local fit are dropped (twice). Returns (model, mask of points used)."""
    src, dst = np.float64(src), np.float64(dst)
    use = src[:, 1] >= y_min - 0.5
    if use.sum() < 6:
        return None, use
    for _ in range(3):
        m = fit_fixed_k1(src[use], dst[use], size, model.k1)
        r = np.linalg.norm(resid(m, src, dst), axis=1)
        use = (src[:, 1] >= y_min - 0.5) & (r < thr)
    return fit_fixed_k1(src[use], dst[use], size, model.k1), use


def loo(src, dst, size, k1, fixed=True):
    """Leave-one-out residuals, panel px (each point predicted by a fit without it)."""
    src, dst = np.float64(src), np.float64(dst)
    out = []
    for i in range(len(src)):
        k = np.ones(len(src), bool)
        k[i] = False
        m = fit_fixed_k1(src[k], dst[k], size, k1) if fixed else RF.fit_model(src[k], dst[k], size, True)
        out.append(resid(m, src[i:i + 1], dst[i:i + 1])[0])
    return np.array(out)


class FModel:
    """A base model (homography + radial k1) plus a smooth residual field in panel px (thin-plate spline through
    the control points' residuals, smoothed): to_photo(s) = base.to_photo(s + f(s)). Panel in OpenCV convention."""

    STEP = 4.0
    PAD = 64

    def __init__(self, base, pts=None, vals=None, smoothing=0.0):
        self.base, self.size = base, base.size
        self.k1, self.H, self.c, self.s = base.k1, base.H, base.c, base.s
        self.pts = None if pts is None else np.float64(pts)
        self.vals = None if vals is None else np.float64(vals)
        self.smoothing = float(smoothing)
        self._grid = None

    def _f(self):
        if self._grid is None:
            from scipy.interpolate import RBFInterpolator
            xs = np.arange(-self.PAD, W + self.PAD + 1, self.STEP)
            ys = np.arange(-self.PAD, H + self.PAD + 1, self.STEP)
            X, Y = np.meshgrid(xs, ys)
            f = RBFInterpolator(self.pts, self.vals, kernel='thin_plate_spline', smoothing=self.smoothing, degree=1)
            v = f(np.stack([X.ravel(), Y.ravel()], 1)).reshape(len(ys), len(xs), 2)
            self._grid = v.astype(np.float32)
        return self._grid

    def field(self, p):
        p = np.asarray(p, np.float64).reshape(-1, 2)
        if self.pts is None:
            return np.zeros_like(p)
        from scipy.ndimage import map_coordinates
        g = self._f()
        cx = (p[:, 0] + self.PAD) / self.STEP
        cy = (p[:, 1] + self.PAD) / self.STEP
        return np.stack([map_coordinates(g[..., k], [cy, cx], order=1, mode='nearest') for k in (0, 1)], 1)

    def to_photo(self, pts):
        p = np.asarray(pts, np.float64).reshape(-1, 2)
        return self.base.to_photo(p + self.field(p))

    def to_panel(self, q):
        p0 = self.base.to_panel(q)
        p = p0.copy()
        for _ in range(4):
            p = p0 - self.field(p)
        return p

    def scale(self, x=960, y=380):
        return self.base.scale(x, y)

    def plain_H(self, step=40):
        return self.base.plain_H(step)

    def json(self):
        if self.pts is None:
            return None
        return {'kind': 'thin-plate spline (scipy RBFInterpolator, degree 1) through the inlier control points\' '
                        'residuals; to_photo(s) = base.to_photo(s + f(s)), panel in OpenCV coordinates',
                'smoothing': self.smoothing, 'points': np.round(self.pts, 3).tolist(),
                'values': np.round(self.vals, 4).tolist()}


def fmodel_from(e, size):
    base = model_from(e, size)
    f = e.get('field')
    if not f:
        return FModel(base)
    return FModel(base, f['points'], f['values'], f['smoothing'])


def fit_field(base, src, dst, smoothings=(3.0, 30.0, 300.0, 3000.0)):
    """Field through the residuals of base at (src, dst); smoothing chosen by leave-one-out. Returns
    (FModel, loo residual vectors, chosen smoothing, {smoothing: loo rms})."""
    from scipy.interpolate import RBFInterpolator
    src, dst = np.float64(src), np.float64(dst)
    r = resid(base, src, dst)               # base.to_panel(d) - s  =  f(s) to first order
    n = len(src)
    best, table = None, {}
    for sm in smoothings:
        e = np.zeros_like(r)
        for i in range(n):
            k = np.ones(n, bool)
            k[i] = False
            f = RBFInterpolator(src[k], r[k], kernel='thin_plate_spline', smoothing=sm, degree=1)
            e[i] = r[i] - f(src[i:i + 1])[0]
        rms = float(np.sqrt((e ** 2).sum(1).mean()))
        table[sm] = round(rms, 4)
        if best is None or rms < best[0]:
            best = (rms, sm, e)
    return FModel(base, src, r, best[1]), best[2], best[1], table


def jdump(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def jload(path, default=None):
    try:
        return json.load(open(path))
    except (OSError, ValueError):
        return default
