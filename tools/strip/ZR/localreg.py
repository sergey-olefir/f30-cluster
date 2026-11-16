"""Package ZR: a LOCAL correction of the provisional registrations inside the right zone of the strip
(x 1180-1920, y 520-720), tied to absolute panel coordinates by our own grid in photo 60.

Chain:  photo 60's crop  -> absolute     : our grid lines (centre of a major line = 100k + 1.0 continuous)
        photo 61's crop  -> photo 60's   : NCC of static stock content on min(R, B) (kills our green grid and
                                            yellow labels, keeps BMW's white rails, ticks and numerals)
        photo k's crop   -> photo 61's   : NCC of static stock content (grey), many patches, robust fit
Each link is a smooth displacement field d(x, y) = a0 + a1 u + b0 v (affine: higher orders extrapolated wildly where the static content is thin), u = (x - 1550) / 370,
v = (y - 620) / 100, fitted with 3-sigma clipping, so that  true = provisional + d.

Inputs : bake/work/strip/zone-R/qreg/H.json and <id>_R4.png (tools/strip/ZR/quickreg.py)
Outputs: bake/work/strip/zone-R/lreg/<id>_R4.png   (the photo re-warped through model + correction)
         bake/work/strip/zone-R/lreg/corr.json       (coefficients, per-link residuals, patch counts)
Crop convention: crop index j <-> continuous panel x = 1180 + j/4 + 0.5 (likewise y from 520).
"""
import json
import os
import subprocess
import sys

import cv2
import numpy as np

MAIN = os.environ.get('F30_MAIN', os.path.expanduser('~/projects/f30-cluster'))
sys.path.insert(0, os.path.join(MAIN, 'tools', 'overlay'))
import rectify as R  # noqa: E402

R.ROOT = MAIN
Q = os.path.join(MAIN, 'bake/work/strip/zone-R/qreg')
OUT = os.path.join(MAIN, 'bake/work/strip/zone-R/lreg')
X0, Y0, X1, Y1 = 1180, 520, 1920, 720
N = 4


def basis(x, y):
    u = (np.asarray(x, float) - 1550) / 370.0
    v = (np.asarray(y, float) - 620) / 100.0
    return np.stack([np.ones_like(u), u, v], -1)


def robust(xs, ys, d, w=None, it=5):
    A = basis(xs, ys)
    keep = np.ones(len(d), bool)
    for _ in range(it):
        c, *_ = np.linalg.lstsq(A[keep], d[keep], rcond=None)
        r = d - A @ c
        s = max(1.4826 * np.median(np.abs(r[keep])), 0.05)
        keep = np.abs(r) < 3 * s
    return c, float(np.sqrt(np.mean(r[keep] ** 2))), int(keep.sum()), int(len(d))


def to_cont(j, origin):
    return origin + j / N + 0.5


def grid_link():
    out = subprocess.run([sys.executable, '-I', os.path.join(os.path.dirname(__file__), 'gridcheck.py'),
                          os.path.join(Q, '60_R4.png'), str(X0), str(Y0)], capture_output=True, text=True, check=True)
    g = json.loads(out.stdout)
    vx = [(v['measured_x'], 660.0, v['expect_x'] - v['measured_x']) for v in g['verticals'] if v['peak'] > 60]
    hy = [(h['at_x'], h['measured_y'], h['expect_y'] - h['measured_y']) for h in g['horizontals'] if h['peak'] > 60]
    vx, hy = np.array(vx), np.array(hy)
    # x: only verticals (one effective row): fit poly in u only (v terms are not constrained -> ridge to 0)
    Ax = basis(vx[:, 0], vx[:, 1])[:, :2]
    cx, *_ = np.linalg.lstsq(Ax, vx[:, 2], rcond=None)
    rx = vx[:, 2] - Ax @ cx
    cy, rmsy, ky, ny = robust(hy[:, 0], hy[:, 1], hy[:, 2])
    return (np.r_[cx, 0], cy), {'vertical_lines': len(vx), 'rms_x': round(float(np.sqrt(np.mean(rx ** 2))), 3),
                                   'max_x': round(float(np.abs(rx).max()), 3),
                                   'horizontal_samples': ny, 'rms_y': round(rmsy, 3)}


def chan(im, kind):
    im = im.astype(np.float32)
    if kind == 'minRB':
        return np.minimum(im[..., 2], im[..., 0])
    return cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)


def shifts(ref, tgt, step=16, half=24, search=14, min_std=18.0, ref_valid=None):
    """NCC of ref patches (2*half px square, 4x crop px) searched +-search in tgt. Returns rows
    (x_ref_cont, y_ref_cont, dx_cont, dy_cont, score) where the feature at ref's (x, y) sits at tgt's (x+dx, y+dy)."""
    rows = []
    h, w = ref.shape
    for cy in range(half + search, h - half - search, step):
        for cx in range(half + search, w - half - search, step):
            t = ref[cy - half:cy + half, cx - half:cx + half]
            if t.std() < min_std:
                continue
            if ref_valid is not None and ref_valid[cy - half:cy + half, cx - half:cx + half].mean() < 0.9:
                continue
            gx = cv2.Sobel(t, cv2.CV_32F, 1, 0)
            gy = cv2.Sobel(t, cv2.CV_32F, 0, 1)
            sxx, syy = float((gx * gx).sum()), float((gy * gy).sum())
            fx, fy = sxx / (sxx + syy + 1e-6), syy / (sxx + syy + 1e-6)   # aperture: 1-D structure fixes 1 axis
            s = tgt[cy - half - search:cy + half + search, cx - half - search:cx + half + search]
            res = cv2.matchTemplate(s, t, cv2.TM_CCOEFF_NORMED)
            _, mx, _, loc = cv2.minMaxLoc(res)
            if mx < 0.8 or loc[0] in (0, res.shape[1] - 1) or loc[1] in (0, res.shape[0] - 1):
                continue
            sx, sy = R.subpix(res, loc[0], loc[1])
            rows.append((to_cont(cx, X0), to_cont(cy, Y0), (sx - search) / N, (sy - search) / N, mx, fx, fy))
    return np.array(rows)


def static_mask(shape):
    """Where the stock content of the right zone does not change between photos: not the map / message panel
    corner (x < 1250, y < 644) and not the bottom-row texts (y > 655, x < 1690: mode label, gear, temperature)."""
    h, w = shape[:2]
    xs, ys = np.meshgrid(X0 + np.arange(w) / N + 0.5, Y0 + np.arange(h) / N + 0.5)
    bad = ((xs < 1250) & (ys < 644)) | ((ys > 655) & (xs < 1690))
    return (~bad).astype(np.float32)


def link(ref, tgt, kind, ref_valid=None):
    sm = static_mask(ref.shape)
    ref_valid = sm if ref_valid is None else ref_valid * sm
    r = shifts(chan(ref, kind), chan(tgt, kind), ref_valid=ref_valid)
    # true(tgt point) = true(ref point): d_tgt(x+dx) = d_ref(x) - dx ; return the raw shift field fit
    okx, oky = r[:, 5] > 0.25, r[:, 6] > 0.25
    a = r[okx]
    cx, rx, kx, nx = robust(a[:, 0] + a[:, 2], a[:, 1] + a[:, 3], -a[:, 2])
    a = r[oky]
    cy, ry, ky, ny = robust(a[:, 0] + a[:, 2], a[:, 1] + a[:, 3], -a[:, 3])
    return (cx, cy), {'patches': len(r), 'usable_x': nx, 'usable_y': ny, 'kept_x': kx, 'kept_y': ky, 'rms_x': round(rx, 3), 'rms_y': round(ry, 3),
                      'median_abs_shift': round(float(np.median(np.hypot(r[:, 2], r[:, 3]))), 3)}


def ev(c, x, y):
    return basis(x, y) @ c


def rewarp(k, H, corr):
    e = H[k]['model']
    ph = R.imread(H[k]['source'])
    size = (ph.shape[1], ph.shape[0])
    m = R.Model(e['H_panel_to_undistorted_photo'], size, e['k1'])
    w, h = (X1 - X0) * N, (Y1 - Y0) * N
    xs, ys = np.meshgrid(X0 + np.arange(w) / N + 0.5, Y0 + np.arange(h) / N + 0.5)
    # true P -> provisional P - d(P)  (one fixed-point step is plenty: d is < 3 px and smooth)
    px = xs - ev(corr[0], xs, ys)
    py = ys - ev(corr[1], xs, ys)
    px = xs - ev(corr[0], px, py)
    py = ys - ev(corr[1], px, py)
    q = m.to_photo(np.stack([(px - 0.5).ravel(), (py - 0.5).ravel()], 1)).reshape(h, w, 2).astype(np.float32)
    return cv2.remap(ph, q[..., 0], q[..., 1], cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT)


def main(ids):
    os.makedirs(OUT, exist_ok=True)
    H = json.load(open(os.path.join(Q, 'H.json')))
    crops = {k: cv2.imread(os.path.join(Q, '%s_R4.png' % k)) for k in H}
    rep = {}
    c60, rep['60_grid'] = grid_link()
    corr = {'60': c60}
    # 61 -> 60 on min(R,B); 60's crop pixels on/near the green grid or yellow labels are invalid
    im60 = crops['60'].astype(np.float32)
    bad = ((im60[..., 1] - im60[..., 2]) > 40).astype(np.uint8)
    bad = cv2.dilate(bad, np.ones((9, 9), np.uint8))
    valid60 = 1.0 - bad
    l61, rep['61_to_60'] = link(crops['60'], crops['61'], 'minRB', ref_valid=valid60)
    # d61(x) = d60(x - shift) - shift ; approximate d60 at the target point (d varies by < 0.1 px over 3 px)
    corr['61'] = (np.asarray(c60[0]) + l61[0], np.asarray(c60[1]) + l61[1])
    for k in ids:
        if k in ('60', '61'):
            continue
        lk, rep['%s_to_61' % k] = link(crops['61'], crops[k], 'gray')
        corr[k] = (corr['61'][0] + lk[0], corr['61'][1] + lk[1])
    for k in ids:
        img = rewarp(k, H, corr[k])
        cv2.imwrite(os.path.join(OUT, '%s_R4.png' % k), img)
        xs = np.linspace(1200, 1900, 15)
        for y in (560, 620, 690):
            dd = np.hypot(ev(corr[k][0], xs, xs * 0 + y), ev(corr[k][1], xs, xs * 0 + y))
            rep.setdefault('%s_correction_max_px' % k, {})['y%d' % y] = round(float(dd.max()), 2)
        print(k, rep.get('%s_to_61' % k, rep.get('61_to_60') if k == '61' else rep['60_grid']),
              rep['%s_correction_max_px' % k], flush=True)
    json.dump({'about': __doc__.strip().splitlines()[0],
               'corr': {k: {'dx': list(map(float, v[0])), 'dy': list(map(float, v[1]))} for k, v in corr.items()},
               'report': rep}, open(os.path.join(OUT, 'corr.json'), 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1:] or ['60', '61', '62', '63', '64', '65', '66', '67', '68'])
