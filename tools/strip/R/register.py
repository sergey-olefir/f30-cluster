"""Package R: register the stock photos of reference/g20 to panel px, absolutely, through photo 60's grid.

Chain: 60 is absolute (our calibration grid, grid60.py). Every other photo is tied to 60's rect through BMW content
that never moves (dial scales: ticks and numerals, the rails and hooks, the minis' scales), with everything that
changes masked: needles, map, texts, telltales, the sign, our own grid, labels, swatches and probes in 60.

    1. start: SIFT (CLAHE) from 60's rect (at 2 x, masked) to the photo; RANSAC; homography + radial k1.
    2. refine: masked NCC of fixed-content patches cut from 60's rect (grid and labels masked inside each patch)
       in the photo warped by the current model, searches 12 -> 6 -> 3 px; homography + radial k1.
    3. strip: a local correction fitted on the patches inside y >= 520 only (a homography on top of the global
       model), reported separately.

Usage (from anywhere; F30_MAIN must be the main checkout holding reference/ and bake/work/):
    UV_CACHE_DIR=$F30_MAIN/bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/strip/R/register.py 61 62 ...
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

RF = C.RF
NREF = 2          # reference rect resolution, x panel

# Boxes (continuous panel px) whose content changes between stock photos, or is ours in 60.
EXCLUDE = [
    (560, 20, 1370, 640, 'map window and centre content'),
    (380, 290, 580, 430, 'digital speed and its unit'),
    (1180, 300, 1520, 450, 'mode label, gear (drive), BMW black box'),
    (1740, 150, 1920, 300, 'AUTO H, parking brake telltales'),
    (0, 330, 70, 720, 'left telltale column'),
    (0, 655, 1920, 720, 'bottom row: range, clock, belts, road label / message, mode, gear, temperature, odometer'),
    (488, 570, 588, 672, 'speed-limit sign and its glow'),
    (580, 600, 670, 720, 'belt and airbag telltales'),
    (355, 500, 470, 652, 'speedometer needle at rest and its glow'),
    (1560, 500, 1712, 656, 'tachometer needle (idle .. 0) and its glow'),
    (1760, 640, 1920, 720, 'COLD label'),
]
EXCLUDE_60 = [
    (240, 430, 1370, 610, 'our swatches'),
    (680, 245, 1750, 300, 'our probe row L1..L16'),
    (690, 335, 1160, 392, 'our atlas text'),
]


def reference(rid, model=None):
    """Photo rid's rect at NREF x, and the mask of trustworthy reference pixels (fixed content only: no excluded
    box, and for 60 no grid line or label)."""
    path = os.path.join(C.OUT, '_cache_ref%s_%dx.png' % (rid, NREF))
    if model is None:
        ph = C.imread(rid)
        model = C.fmodel_from(C.jload(os.path.join(C.OUT, 'H.json'), {})[rid], C.size_of(ph))
        if os.path.exists(path):
            im = cv2.imread(path, cv2.IMREAD_COLOR)
        else:
            im = C.warp_n(ph, model, 0, 0, C.W, C.H, NREF, interp=cv2.INTER_LANCZOS4)
            cv2.imwrite(path, im)
    else:
        im = C.warp_n(C.imread(rid), model, 0, 0, C.W, C.H, NREF, interp=cv2.INTER_LANCZOS4)
        cv2.imwrite(path, im)
    ok = np.ones(im.shape[:2], bool)
    if rid == '60':
        b, g, r = [c.astype(np.float32) for c in cv2.split(im)]
        grid = (g - r) > 18                       # our green grid
        yellow = (np.minimum(r, g) - b) > 40      # our yellow labels
        bad = cv2.dilate((grid | yellow).astype(np.uint8), np.ones((4 * NREF + 1, 4 * NREF + 1), np.uint8)) > 0
        ok &= ~bad
        excl = EXCLUDE + EXCLUDE_60
    else:
        excl = EXCLUDE
    for x0, y0, x1, y1, _ in excl:
        ok[int(y0 * NREF):int(y1 * NREF), int(x0 * NREF):int(x1 * NREF)] = False
    ok[im.sum(2) == 0] = False
    return im, ok, model


def photo_start(rid, photo, sc=0.35):
    """Start model: SIFT (CLAHE) photo rid -> this photo, both at sc, RANSAC homography photo -> photo, composed
    with rid's model. Returns (model, stats)."""
    ph0 = C.imread(rid)
    m0 = C.model_from(C.jload(os.path.join(C.OUT, 'H.json'))[rid], C.size_of(ph0))
    cl = cv2.createCLAHE(3.0, (8, 8))
    g1 = cl.apply(RF.gray(cv2.resize(ph0, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)))
    sc2 = min(1.0, sc * ph0.shape[1] / photo.shape[1])      # the same nominal pixel scale for a smaller photo
    g2 = cl.apply(RF.gray(cv2.resize(photo, None, fx=sc2, fy=sc2, interpolation=cv2.INTER_AREA)))
    # only features on the panel of the reference photo
    xs, ys = np.meshgrid(np.arange(0, C.W + 1, 10), np.arange(0, C.H + 1, 10))
    poly = m0.to_photo(np.stack([xs.ravel(), ys.ravel()], 1).astype(np.float64)) * sc
    msk = np.zeros(g1.shape, np.uint8)
    cv2.fillConvexPoly(msk, cv2.convexHull(poly.astype(np.int32)), 255)
    sift = cv2.SIFT_create(30000)
    k1, d1 = sift.detectAndCompute(g1, msk)
    k2, d2 = sift.detectAndCompute(g2, None)
    mt = cv2.BFMatcher().knnMatch(d1, d2, k=2)
    good = [x[0] for x in mt if len(x) == 2 and x[0].distance < 0.75 * x[1].distance]
    a = (np.float64([k1[g.queryIdx].pt for g in good]) + 0.5) / sc - 0.5
    b = (np.float64([k2[g.trainIdx].pt for g in good]) + 0.5) / sc2 - 0.5
    Hpp, inl = cv2.findHomography(a, b, cv2.RANSAC, 12.0, maxIters=20000, confidence=0.999)
    pts = np.stack([xs.ravel(), ys.ravel()], 1).astype(np.float64)
    q = RF.tf(Hpp, m0.to_photo(pts))
    m = RF.fit_model(pts, q, C.size_of(photo), True)
    return m, {'good_matches': len(good), 'inliers': int(inl.sum()), 'from_photo': rid}


def sift_start(ref, ok, photo):
    cl = cv2.createCLAHE(3.0, (8, 8))
    g1 = cl.apply(RF.gray(ref))
    sc = 0.5                                  # photo at half size: ~1.35 photo px per panel px, near the 2 x ref
    ph = cv2.resize(photo, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)
    g2 = cl.apply(RF.gray(ph))
    sift = cv2.SIFT_create(20000)
    k1, d1 = sift.detectAndCompute(g1, (ok * 255).astype(np.uint8))
    k2, d2 = sift.detectAndCompute(g2, None)
    mt = cv2.BFMatcher().knnMatch(d1, d2, k=2)
    good = [x[0] for x in mt if len(x) == 2 and x[0].distance < 0.8 * x[1].distance]
    s = (np.float64([k1[a.queryIdx].pt for a in good]) + 0.5) / NREF - 0.5      # OpenCV panel
    d = (np.float64([k2[a.trainIdx].pt for a in good]) + 0.5) / sc - 0.5       # OpenCV photo
    m, inl, r, st, Hp = RF.robust_fit(s, d, C.size_of(photo), thr_panel=3.0, k1_free=True, ransac_panel=5.0,
                                      scale=2.7)
    st['good_matches'] = len(good)
    return m, st


def patches(ok, ref_p, size=36, step=24, ssize=24, sstep=12, y_strip=500, min_ok=0.6, min_iso=0.12):
    """Fixed-content windows: on a grid (finer inside the strip), enough trustworthy pixels, texture in both
    directions (the smaller structure-tensor eigenvalue at least min_iso of the larger: a lone rail only says y)."""
    out = []
    gx = cv2.Sobel(ref_p, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(ref_p, cv2.CV_32F, 0, 1, ksize=3)
    for sz, st, ya, yb in ((size, step, 0, y_strip), (ssize, sstep, y_strip - ssize // 2, C.H)):
        for y in range(ya, yb - sz + 1 if yb == C.H else yb, st):
            for x in range(0, C.W - sz + 1, st):
                sl = np.s_[y * NREF:(y + sz) * NREF, x * NREF:(x + sz) * NREF]
                sub = ok[sl]
                if sub.shape != (sz * NREF, sz * NREF) or sub.mean() < min_ok:
                    continue
                a, b, c = (gx[sl] ** 2)[sub].sum(), (gx[sl] * gy[sl])[sub].sum(), (gy[sl] ** 2)[sub].sum()
                tr, det = a + c, a * c - b * b
                disc = np.sqrt(max(tr * tr / 4 - det, 0))
                l1, l2 = tr / 2 + disc, tr / 2 - disc
                if l1 <= 0 or l2 / l1 < min_iso:
                    continue
                out.append((x, y, x + sz, y + sz))
    return out


def prep(im):
    g = RF.gray(im).astype(np.float32)
    return cv2.GaussianBlur(g, (0, 0), 0.8 * NREF)


def match(photo, model, ref_p, ok, boxes, search, min_score=0.7, min_std=6.0):
    """Masked NCC of each reference box in the photo warped by `model`. Returns [(panel pt, photo pt, score, box)]."""
    out = []
    for x0, y0, x1, y1 in boxes:
        tpl = ref_p[y0 * NREF:y1 * NREF, x0 * NREF:x1 * NREF]
        msk = ok[y0 * NREF:y1 * NREF, x0 * NREF:x1 * NREF]
        if tpl[msk].std() < min_std:
            continue
        crop = C.warp_n(photo, model, x0 - search, y0 - search, x1 - x0 + 2 * search, y1 - y0 + 2 * search, NREF)
        sr = prep(crop)
        res = cv2.matchTemplate(sr, tpl, cv2.TM_CCOEFF_NORMED, mask=msk.astype(np.float32))
        res = np.nan_to_num(res, nan=-1, posinf=-1, neginf=-1)
        _, mx, _, loc = cv2.minMaxLoc(res)
        if mx < min_score or loc[0] in (0, res.shape[1] - 1) or loc[1] in (0, res.shape[0] - 1):
            continue
        sx, sy = RF.subpix(res, loc[0], loc[1])
        dx, dy = sx / NREF - search, sy / NREF - search
        c = np.array([(x0 + x1) / 2.0 - 0.5, (y0 + y1) / 2.0 - 0.5])      # OpenCV panel centre of the box
        out.append((c, model.to_photo([c + [dx, dy]])[0], float(mx), (x0, y0, x1, y1)))
    return out


def refine(photo, m, ref, ok, searches=(12, 6, 3), thr=2.0):
    ref_p = prep(ref)
    boxes = patches(ok, ref_p)
    size = C.size_of(photo)
    for srch in searches:
        pr = match(photo, m, ref_p, ok, boxes, srch)
        src = np.float64([a for a, _, _, _ in pr])
        dst = np.float64([b for _, b, _, _ in pr])
        m, inl, r, st, Hp = RF.robust_fit(src, dst, size, thr_panel=thr, k1_free=True, ransac_panel=4.0,
                                          scale=m.scale())
    return m, st, pr, inl, len(boxes)


def register(pid, rid, init=None, write=True, sift_ref=None, bench=True):
    """Register photo pid to reference photo rid's rect (rid already in H.json). init: a starting model or None
    (SIFT from the reference rect, or from sift_ref's rect when given)."""
    import publish as P
    ref, ok, _ = reference(rid)
    photo = C.imread(pid)
    size = C.size_of(photo)
    st0 = None
    if init is None:
        init, st0 = photo_start(sift_ref or rid, photo)
    m, st, pr, inl, nbox = refine(photo, init, ref, ok)
    src = np.float64([a for a, _, _, _ in pr])
    dst = np.float64([b for _, b, _, _ in pr])
    sc = np.float64([s for _, _, s, _ in pr])
    rv = C.resid(m, src, dst)
    inS = src[:, 1] >= 519.5
    ms, use = C.strip_model(m, src, dst, size, y_min=400.0)
    lo = C.loo(src[inl], dst[inl], size, m.k1)
    fm, eloo, sm, table = C.fit_field(m, src[inl], dst[inl])
    sin = src[inl][:, 1] >= 519.5
    ext = {'method': 'start: %s; then masked NCC (grey, sigma %.1f panel px) of %d fixed-content windows of '
                     '%s\'s rect at %d x (24..36 px, 2-D texture only) in the photo warped by the current fit, searches '
                     '12/6/3 px; homography + radial k1; inliers at 2 px'
                     % ('SIFT (CLAHE) photo %s -> this photo, homography, composed with %s\'s model' % (sift_ref or rid, sift_ref or rid) if st0 is not None else 'given model',
                        0.8, nbox, rid, NREF),
           'reference': rid, 'control_points': int(len(src)), 'inliers': int(inl.sum()),
           'panel': C.stats(rv[inl]), 'panel_loo': C.stats(lo), 'strip_by_global_model': C.stats(rv[inl & inS]),
           'k1': round(m.k1, 5), 'plain_homography_rms_panel_px': st['plain_homography_rms_panel_px'],
           'inlier_bbox_panel_opencv': st['inlier_bbox_panel'], 'ncc_median': round(float(np.median(sc)), 3),
           'field_smoothing': sm, 'field_loo_rms_by_smoothing': table,
           'panel_field_loo': C.stats(eloo), 'strip_field_loo': C.stats(eloo[sin])}
    if st0 is not None:
        ext['start'] = st0
    exts = None
    if ms is not None:
        rvs = C.resid(ms, src, dst)
        los = C.loo(src[use], dst[use], size, m.k1)
        exts = {'method': 'the global model form (k1 held) refitted on the control points with y >= 400 only, '
                          'inliers at 2 px', 'reference': rid, 'control_points': int(use.sum()),
                'strip': C.stats(rvs[use & inS]), 'lower_half': C.stats(rvs[use]), 'lower_half_loo': C.stats(los),
                'strip_vs_global_shift_px': mdiff_strip(m, ms)}
    print(pid, {k: v for k, v in ext.items() if k != 'method'})
    print(pid + '_strip', exts and {k: v for k, v in exts.items() if k != 'method'})
    pts = [{'panel_cont': [round(float(a) + .5, 2), round(float(b) + .5, 2)], 'box': list(bx),
            'photo': [round(float(q[0]), 2), round(float(q[1]), 2)], 'ncc': round(float(s), 3), 'inlier': bool(k),
            'resid_global': [round(float(e[0]), 3), round(float(e[1]), 3)]}
           for (a, b), q, s, k, e, (_, _, _, bx) in zip(src, dst, sc, inl, rv, pr)]
    if write:
        up = {pid: P.entry(fm, C.PHOTOS[pid], ext)}
        if ms is not None:
            up[pid + '_strip'] = P.entry(ms, C.PHOTOS[pid], exts)
        P.save_models(up)
        C.jdump({pid: pts}, os.path.join(C.OUT, '%s_control_points.json' % pid))
        P.write_products(pid, fm, ms, photo, bench=bench)
        cache = os.path.join(C.OUT, '_cache_ref%s_%dx.png' % (pid, NREF))
        if os.path.exists(cache):
            os.remove(cache)
    return fm, ms, pts


def mdiff_strip(ma, mb):
    """max / mean distance (panel px) between where two models put the strip's points."""
    xs, ys = np.meshgrid(np.arange(0, C.W + 1, 20), np.arange(540, C.H + 1, 20))
    pts = np.stack([xs.ravel(), ys.ravel()], 1).astype(np.float64) - 0.5
    d = np.linalg.norm(mb.to_panel(ma.to_photo(pts)) - pts, axis=1)
    return [round(float(d.max()), 3), round(float(d.mean()), 3)]


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('photos', nargs='+')
    ap.add_argument('--ref', default='60')
    ap.add_argument('--sift-ref', default=None)
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--no-bench', action='store_true', help='do not write bake/work/overlay/rect/<id>.png')
    a = ap.parse_args()
    for pid in a.photos:
        register(pid, a.ref, write=not a.dry, sift_ref=a.sift_ref, bench=not a.no_bench)
