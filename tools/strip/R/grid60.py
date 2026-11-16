"""Package R: photo 60 (our calibration grid over the stock cluster) -> panel model, from the grid crossings.

The grid (shared/shaders.js GRID, layout grid.json: step 50, major 2) lights, in continuous panel px, the columns /
rows [100k, 100k + 2) (majors), [50(2k+1), 50(2k+1) + 1) (minors) and a 2 px frame. A major crossing's centre is
therefore at continuous (100k + 1, 100j + 1).

Each crossing is located by NCC of green-minus-red (the yellow labels and BMW's white / red ink drop out) between the
photo warped into the panel frame at 4 x by the current model and the grid rendered at 4 x with the same blur.
The fit grows outwards from a 2-point start (eyeballed on the photo), then refines everywhere.

    UV_CACHE_DIR=$F30_MAIN/bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/strip/R/grid60.py           # prints the fit; writes nothing under the repo
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

RF = C.RF
N = 4                 # matching resolution, x panel
HALF = 18             # crossing patch half-size, panel px


ARITH = os.environ.get('R_GRID_ARITH', 'exact')   # 'fp16': test of the hypothesis that the car ran GRID at mediump


def lit_axis(size, arith):
    """Per pixel index along one axis: (major-or-edge lit, minor lit) as the GRID shader decides it, with p = v_uv *
    u_size and mod() evaluated in float64 ('exact') or IEEE half ('fp16': mediump on the car's GPU)."""
    i = np.arange(size)
    uv = (i + 0.5) / size
    if arith == 'fp16':
        h = np.float16
        p = (uv.astype(h) * h(size)).astype(h)

        def md(v, d):
            q = np.floor((p / h(d)).astype(h)).astype(h)
            return (p - (h(d) * q).astype(h)).astype(h).astype(np.float64)
        big, m = md(p, 100.0), md(p, 50.0)
        pf = p.astype(np.float64)
    else:
        pf = uv * size
        big, m = np.mod(pf, 100.0), np.mod(pf, 50.0)
    edge = (pf < 2.0) | (pf > size - 2.0)
    return (big < 2.0) | edge, m < 1.0


def grid_render(x0, y0, w, h, n):
    """The grid as the shader lights whole pixels (ARITH), at n x (nearest), continuous panel coordinates."""
    if ARITH in ('fp16', 'exact1'):
        bx, mx = lit_axis(C.W, 'fp16' if ARITH == 'fp16' else 'exact')
        by, my = lit_axis(C.H, 'fp16' if ARITH == 'fp16' else 'exact')
        xs = np.clip(np.floor(x0 + (np.arange(int(w * n)) + 0.5) / n).astype(int), 0, C.W - 1)
        ys = np.clip(np.floor(y0 + (np.arange(int(h * n)) + 0.5) / n).astype(int), 0, C.H - 1)
        major = by[ys][:, None] | bx[xs][None, :]
        minor = my[ys][:, None] | mx[xs][None, :]
        return np.where(major, 1.0, np.where(minor, 0.47, 0.0)).astype(np.float32)
    ss = 4
    xs = x0 + (np.arange(int(w * n * ss)) + 0.5) / (n * ss)
    ys = y0 + (np.arange(int(h * n * ss)) + 0.5) / (n * ss)

    def lit(v, size):
        big = np.mod(v, 100.0) < 2.0
        minor = np.mod(v, 50.0) < 1.0
        edge = (v < 2.0) | (v > size - 2.0)
        return big | edge, minor
    bx, mx = lit(xs, C.W)
    by, my = lit(ys, C.H)
    major = by[:, None] | bx[None, :]
    minor = my[:, None] | mx[None, :]
    g = np.where(major, 1.0, np.where(minor, 0.47, 0.0)).astype(np.float32)
    return cv2.resize(g, (int(w * n), int(h * n)), interpolation=cv2.INTER_AREA)


def gmr(im):
    b, g, r = [c.astype(np.float32) for c in cv2.split(im)]
    return np.clip(g - r, 0, 255)


def locate(photo, model, cx, cy, search, sigma=1.2, min_score=0.5):
    """Find the crossing whose true centre is continuous (cx, cy). Returns (dx, dy, score) in panel px or None."""
    pad = HALF + search
    x0, y0 = cx - pad, cy - pad
    crop = C.warp_n(photo, model, x0, y0, 2 * pad, 2 * pad, N)
    sr = cv2.GaussianBlur(gmr(crop), (0, 0), sigma * N)
    tpl = cv2.GaussianBlur(grid_render(cx - HALF, cy - HALF, 2 * HALF, 2 * HALF, N), (0, 0), sigma * N)
    if sr.std() < 2 or tpl.std() < 1e-3:
        return None
    res = cv2.matchTemplate(sr, tpl, cv2.TM_CCOEFF_NORMED)
    _, mx, _, loc = cv2.minMaxLoc(res)
    if mx < min_score or loc[0] in (0, res.shape[1] - 1) or loc[1] in (0, res.shape[0] - 1):
        return None
    sx, sy = RF.subpix(res, loc[0], loc[1])
    return (sx / N - search, sy / N - search, float(mx))


def crossings():
    out = []
    for k in range(0, 20):
        for j in range(0, 8):
            cx, cy = 100 * k + 1.0, 100 * j + 1.0
            if cx - HALF < 0 or cy - HALF < 0 or cy + HALF > C.H or cx + HALF > C.W:
                # border crossings: patch would leave the panel; the frame line differs, skip
                continue
            out.append((cx, cy, 'x%d/y%d' % (100 * k, 100 * j)))
    return out


def start_model(size):
    # eyeballed on the full-resolution photo: continuous panel (701, 101) and (1001, 201)
    src = np.float64([[700.5, 100.5], [1000.5, 200.5]])
    dst = np.float64([[2292.0, 1667.0], [3100.0, 1942.0]])
    A, _ = cv2.estimateAffinePartial2D(src, dst)
    Hs = np.vstack([A, [0, 0, 1]])
    return RF.Model(Hs, size, 0.0)


def match_all(photo, model, pts, search, min_score=0.5):
    src, dst, names, scores = [], [], [], []
    for cx, cy, name in pts:
        r = locate(photo, model, cx, cy, search, min_score=min_score)
        if r is None:
            continue
        dx, dy, sc = r
        # the crossing's true centre (cx, cy) shows at (cx + dx, cy + dy) in the warp: that panel point's photo point
        q = model.to_photo([[cx + dx - 0.5, cy + dy - 0.5]])[0]
        src.append([cx - 0.5, cy - 0.5])          # OpenCV panel coordinates for the model
        dst.append(q)
        names.append(name)
        scores.append(sc)
    return np.float64(src), np.float64(dst), names, scores


def fit(photo, verbose=True):
    size = C.size_of(photo)
    m = start_model(size)
    allp = crossings()
    c0 = np.array([851.0, 151.0])
    for radius, search, k1 in ((260, 30, False), (520, 20, False), (900, 14, True), (5000, 12, True),
                               (5000, 6, True), (5000, 4, True)):
        pts = [t for t in allp if np.hypot(t[0] - c0[0], t[1] - c0[1]) <= radius]
        src, dst, names, sc = match_all(photo, m, pts, search)
        if len(src) < 6:
            raise RuntimeError('only %d crossings at radius %d' % (len(src), radius))
        m, inl, r, st, Hp = RF.robust_fit(src, dst, size, thr_panel=2.0, k1_free=k1, ransac_panel=4.0,
                                          scale=m.scale())
        if verbose:
            print('radius %4d search %2d: %3d matched, %3d inliers, rms %.3f max %.3f k1 %.4f scale %.4f'
                  % (radius, search, len(src), st['inliers'], st['rms_panel_px'], st['max_panel_px'], m.k1,
                     m.scale()))
    return m, (src, dst, names, sc, inl, r, st, Hp)


def run(write=True):
    import publish as P
    ph = C.imread('60')
    size = C.size_of(ph)
    m, (src, dst, names, sc, inl, r, st, Hp) = fit(ph)
    # final control set: every matched crossing, inliers at 2 px
    rv = C.resid(m, src, dst)
    ms, use = C.strip_model(m, src, dst, size, y_min=400.0)
    fm, eloo, sm, table = C.fit_field(m, src[inl], dst[inl])
    model_out = fm if os.environ.get('R_FIELD60', '0') == '1'   # grid field not shared by BMW content (61 test) else m
    rvs = C.resid(ms, src, dst)
    inS = src[:, 1] >= 499.5
    lo = C.loo(src[inl], dst[inl], size, m.k1)
    los = C.loo(src[use], dst[use], size, m.k1)
    pts = [{'name': n_, 'panel_cont': [round(float(a) + .5, 2), round(float(b) + .5, 2)],
            'photo': [round(float(q[0]), 2), round(float(q[1]), 2)], 'ncc': round(s, 3), 'inlier': bool(k),
            'resid_global': [round(float(e[0]), 3), round(float(e[1]), 3)],
            'resid_strip_model': [round(float(e[0]), 3), round(float(e[1]), 3)] if y_ else None}
           for n_, (a, b), q, s, k, e, f, y_ in zip(names, src, dst, sc, inl, rv, rvs, inS)]
    for p_, f in zip(pts, rvs):
        if p_['resid_strip_model'] is not None:
            p_['resid_strip_model'] = [round(float(f[0]), 3), round(float(f[1]), 3)]
    ext = {
        'method': 'grid crossings: our calibration grid (grid.json; majors [100k, 100k+2) continuous) by NCC of '
                  'green-minus-red at 4 x in the photo warped by the current fit; grown from a 2-point start; '
                  'homography + radial k1; inliers at 2 px',
        'control_points': int(len(src)), 'inliers': int(inl.sum()),
        'panel': C.stats(rv[inl]), 'panel_loo': C.stats(lo),
        'strip_by_global_model': C.stats(rv[inl & inS]),
        'k1': round(m.k1, 5), 'plain_homography_rms_panel_px': st['plain_homography_rms_panel_px'],
        'inlier_bbox_panel_opencv': st['inlier_bbox_panel'],
        'outliers': [n_ for n_, k in zip(names, inl) if not k],
        'field_used': model_out is fm, 'field_smoothing': sm, 'field_loo_rms_by_smoothing': table,
        'panel_field_loo': C.stats(eloo), 'strip_field_loo': C.stats(eloo[src[inl][:, 1] >= 519.5]),
    }
    exts = {'method': 'the global model form (k1 held) refitted on the crossings with y >= 400 only',
            'control_points': int(use.sum()), 'strip': C.stats(rvs[use]), 'strip_loo': C.stats(los)}
    print('60', ext)
    print('60_strip', exts)
    if write:
        P.save_models({'60': P.entry(model_out, C.PHOTOS['60'], ext), '60_strip': P.entry(ms, C.PHOTOS['60'], exts)})
        C.jdump({'60': pts}, os.path.join(C.OUT, '60_control_points.json'))
        P.write_products('60', model_out, ms, ph)
        for f in os.listdir(C.OUT):
            if f.startswith('_cache_ref'):
                os.remove(os.path.join(C.OUT, f))
    return model_out, ms, pts


if __name__ == '__main__':
    run(write='--dry' not in sys.argv)
