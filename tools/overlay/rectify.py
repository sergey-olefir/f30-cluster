"""Package B (overlay constructor): rectify every G20 reference photo to panel px (1920x720, x right, y down).

Run from the repo root:
    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        --with pillow python tools/overlay/rectify.py

Writes (git-ignored, derived from photos):
    bake/work/overlay/rect/<id>.png   photo <id> warped to the panel frame (1920x720)
    bake/work/overlay/rect/H.json     per photo: the mapping, source, method, points, rms (panel px), usable
    bake/work/overlay/rect/check.png  every rect with C9's BMW boxes, our dial circles and our text boxes drawn on

Model. Photo 10's grid shows a clean cubic residual in x (+-3.5 px) under any homography: the phone lens' radial
distortion. So each photo is fitted with a homography plus one radial term about the photo centre:
    u = c + (q - c) * (1 + k1 * (|q - c| / s)^2)      q photo px, s = half the photo diagonal
    u = H_panel_to_undist(panel)
`H_panel_to_photo` in H.json is the best plain homography over the same points (its own rms is given too); the
rect PNGs use the full model. With k1 = 0 the two coincide.

Pixel convention: OpenCV's (pixel index = pixel centre). Our grid shader lights columns [100k, 100k+2), so a major
grid line's centre is at 100k + 0.5 in this convention.

How each photo is tied to the panel:
    10  our calibration grid over the stock theme: every visible major crossing located by NCC (green minus red,
        so the yellow labels drop out), starting from P0's Hm (reference/g20/10_grid_homography_panel-to-photo.json).
    09  stock theme by day: SIFT (CLAHE) from the 10 rect (stock theme in panel px; grid and map masked) to 09.
    08  stock theme at night: SIFT from the 09 rect to 08 (C9's align08.py approach), cross-checked against 10.
    11  our OLD-geometry theme: NCC of our static text (numerals, labels) cut from the bench render of that build
        (reference/ours/ref_comfort_bench_1920x720.png), starting from P0's 4-point fix.
    12  our theme cb28ce7 at night: the same from the bench render of cb28ce7 (bake/work/P10/bench_cb28ce7_comfort.png)
        on the static text widgets of apps/f30_cluster/hud/layouts/wb_comfort.json, starting from P10's align12.json.
    13  480x360 shot of the scene of 12: SIFT photo 12 -> photo 13 for the start, then the same text matching.
    14  0.7.2, only our text drawn over the full stock theme: SIFT from the 08 rect for the start, then the text
        matching (the text widgets sit where they do in cb28ce7; only colours and gains changed in between).
"""
import json
import os

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'bake', 'work', 'overlay', 'rect')
W, H_ = 1920, 720
ACCEPT_RMS = 3.0
COARSE = 4.0     # panel px per photo px above which a photo is for visual checks only

PHOTOS = {
    '08': 'reference/g20/08_stock_night_warnings-map.jpg',
    '09': 'reference/g20/09_stock_map_day.jpg',
    '10': 'reference/g20/10_grid_over-stock.jpg',
    '11': 'reference/g20/11_our-theme_on-car.jpg',
    '12': 'reference/g20/12_our-theme_night_2026-11-11.jpg',
    '13': 'reference/g20/13_our-theme_baked_on-car_2026-11-11.jpg',
    '14': 'reference/g20/14_stock-under-unbound-theme_2026-11-12.jpg',
}
BENCH_NEW = 'bake/work/P10/bench_cb28ce7_comfort.png'      # cb28ce7, the build in photo 12 (BAKE-P10-levels.md 1)
BENCH_OLD = 'reference/ours/ref_comfort_bench_1920x720.png'  # the OLD geometry build in photo 11 (BAKE-P0-inventory)
LAYOUT = 'apps/f30_cluster/hud/layouts/wb_comfort.json'
C9 = 'bake/work/C9/overlays.json'

BLACK_BOX = [1419.5, 320.8, 1610.8, 437.9]   # C9, measured on 10
BELT = [589.7, 664.9, 623.7, 713.9]
GEAR_P = [1398.4, 667.2, 1421.4, 700.2]
DIALS = [(412, 380, 335), (1508, 380, 335)]
DIALS_OLD = [(496, 360, 290), (1424, 360, 290)]  # photo 11's build (BAKE-P0-inventory 1)


def p(rel):
    return os.path.join(ROOT, rel)


def imread(rel):
    im = cv2.imread(p(rel), cv2.IMREAD_COLOR)
    if im is None:
        raise SystemExit('missing ' + rel)
    return im


def gray(im):
    return cv2.cvtColor(im, cv2.COLOR_BGR2GRAY) if im.ndim == 3 else im


def norm(H):
    H = np.asarray(H, np.float64)
    return H / H[2, 2]


def tf(H, pts):
    return cv2.perspectiveTransform(np.float64(pts).reshape(-1, 1, 2), H).reshape(-1, 2)


def box_mask(shape, boxes, val=255, base=0):
    m = np.full(shape[:2], base, np.uint8)
    for x0, y0, x1, y1 in boxes:
        m[max(0, int(y0)):int(y1), max(0, int(x0)):int(x1)] = val
    return m


def green_minus_red(im):
    b, g, r = [c.astype(np.float32) for c in cv2.split(im)]
    return np.clip(g - r, 0, 255)


# --------------------------------------------------------------------------- the model

class Model:
    """panel -> photo: homography H (panel -> undistorted photo) then the radial term undone."""

    def __init__(self, H, size, k1=0.0):
        self.H = norm(H)
        self.k1 = float(k1)
        w, h = size
        self.c = np.array([(w - 1) / 2.0, (h - 1) / 2.0])
        self.s = float(np.hypot(w, h) / 2.0)
        self.size = size

    def undist(self, q):
        d = np.asarray(q, np.float64) - self.c
        return self.c + d * (1 + self.k1 * (d ** 2).sum(-1, keepdims=True) / self.s ** 2)

    def dist(self, u):
        u = np.asarray(u, np.float64)
        q = u.copy()
        for _ in range(12):
            d = q - self.c
            q = self.c + (u - self.c) / (1 + self.k1 * (d ** 2).sum(-1, keepdims=True) / self.s ** 2)
        return q

    def to_photo(self, pts):
        return self.dist(tf(self.H, pts))

    def to_panel(self, q):
        return tf(np.linalg.inv(self.H), self.undist(q))

    def scale(self, x=960, y=380):
        a = self.to_photo([[x, y], [x + 1, y], [x, y + 1]])
        return float((np.linalg.norm(a[1] - a[0]) + np.linalg.norm(a[2] - a[0])) / 2)

    def warp(self, photo, x0=0, y0=0, w=W, h=H_, interp=cv2.INTER_CUBIC):
        xs, ys = np.meshgrid(np.arange(w, dtype=np.float64) + x0, np.arange(h, dtype=np.float64) + y0)
        q = self.to_photo(np.stack([xs.ravel(), ys.ravel()], 1)).reshape(h, w, 2).astype(np.float32)
        return cv2.remap(photo, q[..., 0], q[..., 1], interp, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

    def plain_H(self, step=40):
        """The best plain homography for this model over the panel."""
        xs, ys = np.meshgrid(np.arange(0, W + 1, step), np.arange(0, H_ + 1, step))
        pts = np.stack([xs.ravel(), ys.ravel()], 1).astype(np.float64)
        return norm(cv2.findHomography(pts, self.to_photo(pts), 0)[0])


def fit_model(src, dst, size, k1_free=True):
    """LSQ: homography for each k1 on a 1-D search (then a finer one), the k1 with the least panel rms."""
    def at(k):
        m = Model(np.eye(3), size, k)
        Hk = cv2.findHomography(src, m.undist(dst), 0)[0]
        m = Model(Hk, size, k)
        r = np.linalg.norm(m.to_panel(dst) - src, axis=1)
        return float(np.sqrt((r ** 2).mean())), m
    best = at(0.0)
    if k1_free:
        for lo, hi, n in ((-0.15, 0.15, 61), (-0.006, 0.006, 25)):
            base = best[1].k1 if lo > -0.1 else 0.0
            for k in np.linspace(base + lo, base + hi, n):
                rk = at(k)
                if rk[0] < best[0]:
                    best = rk
    return best[1]


def robust_fit(src, dst, size, thr_panel=3.0, k1_free=True, ransac_panel=6.0, scale=1.0):
    """RANSAC homography (generous threshold: the radial term is not in it yet), then the model on the inliers,
    then inliers re-chosen with the model at thr_panel, three rounds."""
    src, dst = np.float64(src), np.float64(dst)
    _, inl = cv2.findHomography(src, dst, cv2.RANSAC, ransac_panel * scale, maxIters=20000, confidence=0.999)
    inl = inl.ravel().astype(bool)
    for _ in range(3):
        m = fit_model(src[inl], dst[inl], size, k1_free)
        r = np.linalg.norm(m.to_panel(dst) - src, axis=1)
        inl = r < thr_panel
    m = fit_model(src[inl], dst[inl], size, k1_free)
    r = np.linalg.norm(m.to_panel(dst) - src, axis=1)
    inl = r < thr_panel
    Hp = norm(cv2.findHomography(src[inl], dst[inl], 0)[0])
    rp = np.linalg.norm(tf(np.linalg.inv(Hp), dst[inl]) - src[inl], axis=1)
    # coverage: the inliers' bounding box as a share of the panel (a fit on one corner extrapolates badly)
    x0, y0 = src[inl].min(0)
    x1, y1 = src[inl].max(0)
    st = {'inliers': int(inl.sum()), 'rms_panel_px': round(float(np.sqrt((r[inl] ** 2).mean())), 3),
          'max_panel_px': round(float(r[inl].max()), 3), 'k1': round(m.k1, 5),
          'plain_homography_rms_panel_px': round(float(np.sqrt((rp ** 2).mean())), 3),
          'inlier_bbox_panel': [round(float(v), 1) for v in (x0, y0, x1, y1)],
          'photo_px_per_panel_px': round(m.scale(), 4)}
    return m, inl, r, st, Hp


def mdiff(ma, mb, step=40, box=(0, 0, W, H_)):
    """max / mean distance in panel px between where two models put the panel's points (through mb's inverse)."""
    xs, ys = np.meshgrid(np.arange(box[0], box[2] + 1, step), np.arange(box[1], box[3] + 1, step))
    pts = np.stack([xs.ravel(), ys.ravel()], 1).astype(np.float64)
    d = np.linalg.norm(mb.to_panel(ma.to_photo(pts)) - pts, axis=1)
    return [round(float(d.max()), 2), round(float(d.mean()), 2)]


# --------------------------------------------------------------------------- SIFT

def sift_pairs(tpl, photo, tpl_mask=None, photo_mask=None, n=12000, ratio=0.8, up=1.0, gate=None):
    """SIFT (CLAHE) matches template (panel frame) -> photo. `gate` = (model, px): keep matches within px of it."""
    cl = cv2.createCLAHE(3.0, (8, 8))
    g1 = cl.apply(gray(tpl))
    ph = photo if up == 1.0 else cv2.resize(photo, None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC)
    g2 = cl.apply(gray(ph))
    pm = photo_mask
    if pm is not None and up != 1.0:
        pm = cv2.resize(pm, (g2.shape[1], g2.shape[0]), interpolation=cv2.INTER_NEAREST)
    sift = cv2.SIFT_create(n)
    k1, d1 = sift.detectAndCompute(g1, tpl_mask)
    k2, d2 = sift.detectAndCompute(g2, pm)
    mt = cv2.BFMatcher().knnMatch(d1, d2, k=2)
    good = [x[0] for x in mt if len(x) == 2 and x[0].distance < ratio * x[1].distance]
    s = np.float64([k1[a.queryIdx].pt for a in good])
    d = (np.float64([k2[a.trainIdx].pt for a in good]) + 0.5) / up - 0.5
    if gate is not None:
        e = np.linalg.norm(gate[0].to_panel(d) - s, axis=1)
        s, d = s[e < gate[1]], d[e < gate[1]]
    return s, d, len(good)


def sift_fit(tpl, photo, size, tpl_mask=None, photo_mask=None, gate=None, up=1.0, k1_free=True, thr=3.0):
    s, d, ng = sift_pairs(tpl, photo, tpl_mask, photo_mask, up=up, gate=gate)
    sc = gate[0].scale() if gate else 1.0
    m, inl, r, st, Hp = robust_fit(s, d, size, thr, k1_free, scale=sc)
    st['good_matches'] = ng
    st['gated'] = len(s)
    return m, st, Hp


# --------------------------------------------------------------------------- control-patch matching (NCC)

def subpix(res, x, y):
    def q(a, b, c):
        den = a - 2 * b + c
        return 0.0 if abs(den) < 1e-9 else float(np.clip(0.5 * (a - c) / den, -0.5, 0.5))
    dx = q(res[y, x - 1], res[y, x], res[y, x + 1]) if 0 < x < res.shape[1] - 1 else 0.0
    dy = q(res[y - 1, x], res[y, x], res[y + 1, x]) if 0 < y < res.shape[0] - 1 else 0.0
    return x + dx, y + dy


def match_patches(photo, model, ref, patches, search, prep, min_score=0.55):
    """For each panel box (x0, y0, x1, y1, name): cut the patch from `ref` (panel frame), find it in the photo
    warped to the panel by `model` within +-search px (NCC on prep()'d images, sub-px peak).
    Returns [(true panel centre, photo point, score, name)]."""
    rp = prep(ref)
    out = []
    pad = search + 4
    for x0, y0, x1, y1, name in patches:
        x0i, y0i, x1i, y1i = int(np.floor(x0)), int(np.floor(y0)), int(np.ceil(x1)), int(np.ceil(y1))
        x0i, y0i, x1i, y1i = max(x0i, 0), max(y0i, 0), min(x1i, W), min(y1i, H_)
        if x1i - x0i < 6 or y1i - y0i < 6:
            continue
        cw, ch = (x1i - x0i) + 2 * pad, (y1i - y0i) + 2 * pad
        crop = model.warp(photo, x0i - pad, y0i - pad, cw, ch)
        cp = prep(crop)
        tpl = rp[y0i:y1i, x0i:x1i]
        if tpl.std() < 1e-3:
            continue
        sr = cp[pad - search:pad + (y1i - y0i) + search, pad - search:pad + (x1i - x0i) + search]
        if sr.std() < 1e-3:
            continue
        res = cv2.matchTemplate(sr.astype(np.float32), tpl.astype(np.float32), cv2.TM_CCOEFF_NORMED)
        _, mx, _, loc = cv2.minMaxLoc(res)
        if mx < min_score or loc[0] in (0, res.shape[1] - 1) or loc[1] in (0, res.shape[0] - 1):
            continue
        sx, sy = subpix(res, loc[0], loc[1])
        c = np.array([(x0i + x1i - 1) / 2.0, (y0i + y1i - 1) / 2.0])
        out.append((c, model.to_photo([c + [sx - search, sy - search]])[0], float(mx), name))
    return out


def refine(photo, model, ref, patches, prep, searches=(28, 12, 6), thr=3.0, min_score=0.55, k1_free=True):
    size = (photo.shape[1], photo.shape[0])
    for srch in searches:
        pairs = match_patches(photo, model, ref, patches, srch, prep, min_score)
        if len(pairs) < 8:
            raise RuntimeError('only %d control points' % len(pairs))
        src = np.float64([a for a, _, _, _ in pairs])
        dst = np.float64([b for _, b, _, _ in pairs])
        model, inl, r, st, Hp = robust_fit(src, dst, size, thr, k1_free, ransac_panel=max(4.0, thr),
                                           scale=model.scale())
    # leave-one-out on the inliers: how well a point NOT in the fit lands
    loo = []
    si, di = src[inl], dst[inl]
    for i in range(len(si)):
        k = np.ones(len(si), bool)
        k[i] = False
        mk = fit_model(si[k], di[k], size, k1_free)
        loo.append(np.linalg.norm(mk.to_panel(di[i:i + 1])[0] - si[i]))
    st.update({'points': len(pairs), 'loo_rms_panel_px': round(float(np.sqrt(np.mean(np.square(loo)))), 3),
               'outliers': sorted(n for (_, _, _, n), k in zip(pairs, inl) if not k)})
    pts = [(a.tolist(), b.tolist(), n, bool(k), round(float(e), 2)) for (a, b, _, n), k, e in zip(pairs, inl, r)]
    return model, st, Hp, pts


def prep_gray(sigma):
    def f(im):
        g = gray(im).astype(np.float32)
        return cv2.GaussianBlur(g, (0, 0), sigma) if sigma > 0 else g
    return f


def text_patches(ref, boxes, thr=60, pad=3):
    """Tight boxes (+pad) of the bright pixels of `ref` inside each layout box."""
    g = gray(ref)
    out = []
    for x0, y0, x1, y1, name in boxes:
        sub = g[int(y0):int(y1), int(x0):int(x1)]
        ys, xs = np.nonzero(sub > thr)
        if len(xs) < 12:
            continue
        out.append((x0 + xs.min() - pad, y0 + ys.min() - pad, x0 + xs.max() + 1 + pad, y0 + ys.max() + 1 + pad, name))
    return out


def layout_text(static_only=True):
    lay = json.load(open(p(LAYOUT)))
    return [(w['x'], w['y'], w['x'] + w['w'], w['y'] + w['h'], w['id']) for w in lay['widgets']
            if w.get('type') == 'text' and not (static_only and '{{' in str(w.get('text', '')))]


def component_patches(ref, exclude, rings, thr=90, amin=30, amax=4000, pad=4, merge=6):
    """Static-text patches from a render with no layout at hand (photo 11's OLD build): bright blobs merged into
    words, minus the dynamic regions in `exclude` and the tick rings (cx, cy, r0, r1: repetitive, would alias)."""
    g = gray(ref)
    m = cv2.dilate((g > thr).astype(np.uint8), np.ones((merge, merge), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(m, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if not (amin <= a <= amax) or w > 160 or h > 60:
            continue
        cx, cy = x + w / 2.0, y + h / 2.0
        if any(e[0] <= cx <= e[2] and e[1] <= cy <= e[3] for e in exclude):
            continue
        if any(r0 <= np.hypot(cx - rx, cy - ry) <= r1 for rx, ry, r0, r1 in rings):
            continue
        out.append((x - pad, y - pad, x + w + pad, y + h + pad, 'blob@%d,%d' % (cx, cy)))
    return out


# --------------------------------------------------------------------------- per photo

def grid_template():
    """Our calibration grid (shared/shaders.js GRID, step 50, major 2) in green: majors light [100k, 100k+2),
    minors [50(2k+1), +1)."""
    t = np.zeros((H_, W), np.uint8)
    for v in range(0, W, 50):
        t[:, v:v + (2 if v % 100 == 0 else 1)] = np.maximum(t[:, v:v + (2 if v % 100 == 0 else 1)],
                                                             255 if v % 100 == 0 else 120)
    for v in range(0, H_, 50):
        t[v:v + (2 if v % 100 == 0 else 1), :] = np.maximum(t[v:v + (2 if v % 100 == 0 else 1), :],
                                                             255 if v % 100 == 0 else 120)
    out = np.zeros((H_, W, 3), np.uint8)
    out[..., 1] = t
    return out


def do_10(ph):
    size = (ph.shape[1], ph.shape[0])
    m0 = Model(json.load(open(p('reference/g20/10_grid_homography_panel-to-photo.json')))['Hm'], size)
    patches = []
    for k in range(1, 20):
        for j in range(1, 8):
            cx, cy = 100 * k + 0.5, 100 * j + 0.5
            patches.append((cx - 17.5, cy - 17.5, cx + 18.5, min(cy + 18.5, 719), 'x%d/y%d' % (100 * k, 100 * j)))

    def prep(im):
        return cv2.GaussianBlur(green_minus_red(im), (0, 0), 1.0)
    m, st, Hp, pts = refine(ph, m0, grid_template(), patches, prep, searches=(10, 6, 5), thr=3.0, min_score=0.5)
    st['method'] = ('grid crossings: our calibration grid (layout grid.json, majors every 100 px) located by NCC on '
                    'green-minus-red in the photo warped by the current fit (start: P0\'s Hm); homography + radial k1')
    st['existing'] = 'reference/g20/10_grid_homography_panel-to-photo.json (Hm)'
    st['delta_vs_existing_panel_px_max_mean'] = mdiff(m0, m)
    return m, st, Hp, pts


def stock_mask(rect10):
    """Template mask for SIFT from a stock rect: no map window (its content differs per photo), no grid."""
    tm = box_mask(rect10.shape, [[600, 60, 1300, 600]], 0, 255)
    tm[rect10.sum(2) == 0] = 0
    gm = (green_minus_red(rect10) > 25).astype(np.uint8)
    tm[cv2.dilate(gm, np.ones((7, 7), np.uint8)) > 0] = 0
    return tm


def entry(model, st, Hp, src, extra=None):
    e = {'source': src, 'H_panel_to_photo': Hp.tolist(),
         'model': {'H_panel_to_undistorted_photo': model.H.tolist(), 'k1': model.k1,
                   'centre_photo_px': model.c.tolist(), 'norm_radius_photo_px': model.s,
                   'formula': 'u = c + (q - c)(1 + k1 |q - c|^2 / s^2), u = H panel; q photo px'}}
    e.update(st)
    if extra:
        e.update(extra)
    return e


def run():
    os.makedirs(OUT, exist_ok=True)
    res, rects, pts_all, models = {}, {}, {}, {}
    ph = {k: imread(v) for k, v in PHOTOS.items()}
    sz = {k: (v.shape[1], v.shape[0]) for k, v in ph.items()}

    # ---- 10
    m10, st, Hp, pts = do_10(ph['10'])
    models['10'], rects['10'], pts_all['10'] = m10, m10.warp(ph['10']), pts
    res['10'] = entry(m10, st, Hp, PHOTOS['10'])
    print('10', {k: v for k, v in st.items() if k not in ('outliers', 'method')})

    # ---- 09
    m09_p0 = Model(json.load(open(p('bake/work/rect/09_stock_map_day.g20.PANEL.json')))['H_panel_to_photo'], sz['09'])
    m09, st, Hp = sift_fit(rects['10'], ph['09'], sz['09'], stock_mask(rects['10']), gate=(m09_p0, 40))
    st['method'] = ('SIFT (CLAHE) from the 10 rect (stock theme in panel px; our grid and the map window masked) to '
                    'photo 09, matches gated to 40 px of P0\'s H; RANSAC, then homography + radial k1, inliers 3 px')
    st['existing'] = 'bake/work/rect/09_stock_map_day.g20.PANEL.json (P0)'
    st['delta_vs_existing_panel_px_max_mean'] = mdiff(m09_p0, m09)
    models['09'], rects['09'] = m09, m09.warp(ph['09'])
    res['09'] = entry(m09, st, Hp, PHOTOS['09'])
    print('09', {k: v for k, v in st.items() if k != 'method'})

    # ---- 08
    m08_c9 = Model(json.load(open(p('bake/work/C9/08_H.json')))['H_panel_to_photo'], sz['08'])
    tm = box_mask(rects['09'].shape, [[600, 60, 1300, 600]], 0, 255)
    tm[rects['09'].sum(2) == 0] = 0
    m08, st, Hp = sift_fit(rects['09'], ph['08'], sz['08'], tm, gate=(m08_c9, 40))
    m08b, stb, _ = sift_fit(rects['10'], ph['08'], sz['08'], stock_mask(rects['10']), gate=(m08_c9, 40))
    st['cross_check_sift_to_10_rect'] = {'inliers': stb['inliers'], 'rms_panel_px': stb['rms_panel_px'],
                                         'delta_panel_px_max_mean': mdiff(m08b, m08)}
    st['method'] = ('SIFT (CLAHE) from the 09 rect (stock theme, map window masked) to photo 08 as in '
                    'bake/src/C9/align08.py, matches gated to 40 px of C9\'s H; RANSAC, homography + radial k1')
    st['existing'] = 'bake/work/C9/08_H.json (C9)'
    st['delta_vs_existing_panel_px_max_mean'] = mdiff(m08_c9, m08)
    models['08'], rects['08'] = m08, m08.warp(ph['08'])
    res['08'] = entry(m08, st, Hp, PHOTOS['08'])
    print('08', {k: v for k, v in st.items() if k != 'method'})

    # ---- 12: our text from the cb28ce7 bench render
    bench = imread(BENCH_NEW)
    tp = text_patches(bench, layout_text())
    m12_p10 = Model(json.load(open(p('bake/work/P10/align12.json')))['H_panel_to_photo'], sz['12'])
    m12, st, Hp, pts = refine(ph['12'], m12_p10, bench, tp, prep_gray(1.2), searches=(20, 8, 5))
    st['method'] = ('NCC of our static text (%d widgets of wb_comfort.json, patches cut from the cb28ce7 bench render) '
                    'in the photo warped by the current fit (start: P10 align12.json); homography + radial k1' % len(tp))
    st['existing'] = 'bake/work/P10/align12.json (P10, 8 hand points)'
    st['delta_vs_existing_panel_px_max_mean'] = mdiff(m12_p10, m12)
    models['12'], rects['12'], pts_all['12'] = m12, m12.warp(ph['12']), pts
    res['12'] = entry(m12, st, Hp, PHOTOS['12'])
    print('12', {k: v for k, v in st.items() if k != 'method'})

    # ---- 13: start from SIFT 12 -> 13 (photo to photo), chained; then the same text matching
    up = 2.0
    s, d, ng = sift_pairs(rects['12'], ph['13'], up=up, ratio=0.85)
    m13_0, inl, r, st0, _ = robust_fit(s, d, sz['13'], 8.0, k1_free=False, ransac_panel=12.0, scale=0.19)
    sc = m13_0.scale()
    m13, st, Hp, pts = refine(ph['13'], m13_0, bench, tp, prep_gray(2.5), searches=(16, 8, 6), thr=4.0,
                              min_score=0.5, k1_free=False)
    st['start'] = {'sift_12rect_to_13_inliers': st0['inliers'], 'rms_panel_px': st0['rms_panel_px']}
    st['method'] = ('start: SIFT from the 12 rect to photo 13 (upsampled 2x); then NCC of our static text (bench '
                    'cb28ce7, as 12) in the photo warped by the fit; homography only (k1 fixed 0: too few photo px)')
    models['13'], rects['13'], pts_all['13'] = m13, m13.warp(ph['13'], interp=cv2.INTER_LINEAR), pts
    res['13'] = entry(m13, st, Hp, PHOTOS['13'])
    print('13', {k: v for k, v in st.items() if k != 'method'})

    # ---- 14: start from SIFT 08 rect -> 14 (stock theme), then our text
    tm = box_mask(rects['08'].shape, [[600, 60, 1300, 600]], 0, 255)
    tm[rects['08'].sum(2) == 0] = 0
    s, d, ng = sift_pairs(rects['08'], ph['14'], tm, up=2.0, ratio=0.8)
    m14_0, inl, r, st0, _ = robust_fit(s, d, sz['14'], 4.0, k1_free=False, ransac_panel=8.0, scale=0.37)
    m14, st, Hp, pts = refine(ph['14'], m14_0, bench, tp, prep_gray(1.5), searches=(16, 8, 5), thr=3.0,
                              min_score=0.5)
    m14s, sts, _ = sift_fit(rects['08'], ph['14'], sz['14'], tm, gate=(m14, 25), up=2.0)
    st['start'] = {'sift_08rect_to_14_inliers': st0['inliers'], 'rms_panel_px': st0['rms_panel_px']}
    st['cross_check_sift_to_08_rect'] = {'inliers': sts['inliers'], 'rms_panel_px': sts['rms_panel_px'],
                                         'delta_panel_px_max_mean': mdiff(m14s, m14)}
    st['method'] = ('start: SIFT from the 08 rect (stock theme) to photo 14 (upsampled 2x); then NCC of our static '
                    'text (bench cb28ce7 patches; same positions in 0.7.2) in the warped photo; homography + radial k1')
    models['14'], rects['14'], pts_all['14'] = m14, m14.warp(ph['14']), pts
    res['14'] = entry(m14, st, Hp, PHOTOS['14'])
    print('14', {k: v for k, v in st.items() if k != 'method'})

    # ---- 11: OLD build; our static text from its bench render, components minus the dynamic regions
    old = imread(BENCH_OLD)
    excl = [[880, 130, 1040, 290],     # speed-limit sign
            [430, 500, 600, 560],      # range under the speedo
            [700, 570, 1220, 640],     # time / range / temp values
            [1360, 500, 1490, 570],    # gear in the pill
            [420, 290, 570, 430], [1350, 290, 1500, 430],  # hubs
            [0, 360, 200, 720], [1720, 360, 1920, 720]]    # minis (ticks)
    rings = [(496, 360, 0.80 * 290, 1.06 * 290), (1424, 360, 0.80 * 290, 1.06 * 290)]
    op = component_patches(old, excl, rings)
    m11_p0 = Model(json.load(open(p('bake/work/rect/11_our-theme_on-car.g20.PANEL.json')))['H_panel_to_photo'],
                   sz['11'])
    m11, st, Hp, pts = refine(ph['11'], m11_p0, old, op, prep_gray(1.2), searches=(28, 12, 6))
    st['method'] = ('NCC of our static text (%d blobs of the OLD-geometry bench render reference/ours/'
                    'ref_comfort_bench_1920x720.png: numerals, labels; needles, sign, values, gear, ticks excluded) in '
                    'the photo warped by the fit (start: P0\'s 4-point fix); homography + radial k1' % len(op))
    st['existing'] = 'bake/work/rect/11_our-theme_on-car.g20.PANEL.json (P0 4-point fix)'
    st['delta_vs_existing_panel_px_max_mean'] = mdiff(m11_p0, m11)
    models['11'], rects['11'], pts_all['11'] = m11, m11.warp(ph['11']), pts
    res['11'] = entry(m11, st, Hp, PHOTOS['11'])
    print('11', {k: v for k, v in st.items() if k != 'method'})

    # ---- usability
    for k, e in res.items():
        e['panel_px_per_photo_px'] = round(1.0 / e['photo_px_per_panel_px'], 3)
        ok = e['rms_panel_px'] <= ACCEPT_RMS
        why = []
        if not ok:
            why.append('rms %.2f > %.1f panel px' % (e['rms_panel_px'], ACCEPT_RMS))
        if e['panel_px_per_photo_px'] > COARSE:
            ok = False
            why.append('one photo px is %.1f panel px: too coarse for 3 px geometry; use the rect for visual '
                       'relation checks only' % e['panel_px_per_photo_px'])
        elif e['panel_px_per_photo_px'] > 2.0:
            e['note'] = ('coarse: one photo px is %.1f panel px; centres are good to the rms, edges blur over '
                         '~%.0f px' % (e['panel_px_per_photo_px'], 2 * e['panel_px_per_photo_px']))
        e['bmw_items_check'] = bmw_check(rects[k]) if k != '10' else 'skipped: C9 measured these items on 10'
        e['usable_for_geometry'] = ok
        e['reason'] = '; '.join(why) if why else None
    res['_about'] = {
        'frame': 'panel px 1920x720, x right, y down; OpenCV pixel-centre convention',
        'rms_panel_px': 'rms of the fit over its inlier control points, measured in panel px (photo point mapped '
                        'to the panel by the model vs the true panel point); loo_rms_panel_px (where given) is '
                        'leave-one-out',
        'H_panel_to_photo': 'best plain homography (no radial term), its own rms in plain_homography_rms_panel_px',
        'model': 'the mapping the rect PNGs use: homography + one radial term (see the formula)',
        'accept': 'usable_for_geometry: rms <= %.1f panel px and a photo px no bigger than %.1f panel px'
                  % (ACCEPT_RMS, COARSE),
        'bmw_items_check': 'independent check, not in any fit: BMW\'s fixed overlays found in the rect (white P glyph '
                           'centre, red/amber belt lamp centre, black-box left/top edge = steepest step) minus C9\'s '
                           'values (P centre 1409.9,683.7; belt centre 606.7,689.4; box left 1419.5, top 320.8; C9 '
                           'measured them on 10 with the old Hm plus local grid offsets). null = not there / no contrast',
        'chain': '10 is absolute (our grid); 09 <- 10 rect; 08 <- 09 rect; 11, 12, 13, 14 are absolute through our '
                 'own text at known panel positions (14 also cross-checked against the 08 rect)'}
    json.dump(res, open(os.path.join(OUT, 'H.json'), 'w'), indent=1)
    json.dump(pts_all, open(os.path.join(OUT, '_control_points.json'), 'w'))
    for k, im in rects.items():
        cv2.imwrite(os.path.join(OUT, k + '.png'), im)
    check_sheet(rects, res)
    return res


# --------------------------------------------------------------------------- independent check: BMW's items

def bmw_check(r):
    out = {}
    g = gray(r).astype(np.float32)
    b, gg, rr = [c.astype(np.float32) for c in cv2.split(r)]
    # gear P: the bright blob nearest the C9 centre in a window
    x0, y0, x1, y1 = 1380, 655, 1440, 714
    win = g[y0:y1, x0:x1]
    if win.max() > 90 and win.max() - np.median(win) > 60:
        m = (win > np.median(win) + 0.5 * (win.max() - np.median(win))).astype(np.uint8)
        n, lab, st, cen = cv2.connectedComponentsWithStats(m, 8)
        if n > 1:
            i = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
            if 40 < st[i, cv2.CC_STAT_AREA] < 900:
                ys, xs = np.nonzero(lab == i)
                out['gear_P_centre_d'] = [round(float((xs.min() + xs.max()) / 2 + x0 - 1409.9), 1),
                                          round(float((ys.min() + ys.max()) / 2 + y0 - 683.7), 1)]
    # belt lamp: saturated red/amber blob
    x0, y0, x1, y1 = 582, 650, 632, 720   # between the rear belts (to 579) and the passenger lamp (from 636)
    sat = (rr - np.minimum(gg, b))[y0:y1, x0:x1]
    m = ((sat > 70) & (rr[y0:y1, x0:x1] > 110)).astype(np.uint8)
    if m.sum() > 60:
        n, lab, st, cen = cv2.connectedComponentsWithStats(cv2.dilate(m, np.ones((5, 5), np.uint8)), 8)
        i = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        ys, xs = np.nonzero((lab == i) & (m > 0))
        out['belt_centre_d'] = [round(float((xs.min() + xs.max()) / 2 + x0 - 606.7), 1),
                                round(float((ys.min() + ys.max()) / 2 + y0 - 689.4), 1)]
    # black box: left edge on rows 345..415, top edge on columns 1450..1580 (steepest step, needs contrast)
    def edge(profile, lo, sign):
        d = np.diff(cv2.GaussianBlur(profile.reshape(1, -1), (0, 0), 1.0).ravel()) * sign
        i = int(np.argmax(d))
        return (lo + i + 0.5, float(d[i]))
    px = g[345:415, 1395:1445].mean(0)
    xl, sl = edge(px, 1395, -1)
    py = g[300:345, 1450:1580].mean(1)
    yt, stp = edge(py, 300, -1)
    inside = g[340:420, 1440:1590]
    if sl > 6 and np.percentile(inside, 50) < 0.5 * max(px[:10].mean(), 1) :
        out['black_box_left_d'] = round(xl - 1419.5, 1)
    if stp > 6 and np.percentile(inside, 50) < 0.5 * max(py[:10].mean(), 1):
        out['black_box_top_d'] = round(yt - 320.8, 1)
    return out or None


# --------------------------------------------------------------------------- check sheet

def check_sheet(rects, res):
    c9 = json.load(open(p(C9)))
    tt = [t['x0y0x1y1'] if isinstance(t, dict) else t
          for g, v in c9['telltales'].items() if g.startswith('08') for t in v]
    texts = layout_text(static_only=False)
    tiles = []
    for k in sorted(rects):
        im = rects[k].copy()
        o = im.copy()
        dials = DIALS_OLD if k == '11' else DIALS
        for cx, cy, r in dials:
            cv2.circle(o, (cx, cy), r, (255, 255, 0), 2)
            cv2.drawMarker(o, (cx, cy), (255, 255, 0), cv2.MARKER_CROSS, 30, 2)
        for b in tt:
            cv2.rectangle(o, (int(b[0]), int(b[1])), (int(b[2]), int(b[3])), (0, 165, 255), 2)
        for b, col in ((BLACK_BOX, (255, 0, 255)), (BELT, (0, 0, 255)), (GEAR_P, (0, 0, 255))):
            cv2.rectangle(o, (int(b[0]), int(b[1])), (int(round(b[2])), int(round(b[3]))), col, 2)
        if k in ('12', '13', '14'):
            for x0, y0, x1, y1, _ in texts:
                cv2.rectangle(o, (int(x0), int(y0)), (int(x1), int(y1)), (0, 255, 0), 1)
        if k == '10':
            for v in range(100, W, 100):
                cv2.line(o, (v, 0), (v, H_), (0, 0, 255), 1)
            for v in range(100, H_, 100):
                cv2.line(o, (0, v), (W, v), (0, 0, 255), 1)
        e = res[k]
        lab = '%s  rms %.2f px  n %d  k1 %.3f  %s' % (k, e['rms_panel_px'], e['inliers'], e['model']['k1'],
                                                     'usable' if e['usable_for_geometry'] else 'NOT for geometry')
        cv2.putText(o, lab, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 0), 6)
        cv2.putText(o, lab, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 2)
        tiles.append(cv2.resize(o, (960, 360), interpolation=cv2.INTER_AREA))
    while len(tiles) % 2:
        tiles.append(np.zeros_like(tiles[0]))
    rows = [np.hstack(tiles[i:i + 2]) for i in range(0, len(tiles), 2)]
    cv2.imwrite(os.path.join(OUT, 'check.png'), np.vstack(rows))
    # 1:1 detail crops for the BMW items (black box, P, belt) per photo
    crops = []
    for k in sorted(rects):
        o = rects[k].copy()
        for b, col in ((BLACK_BOX, (255, 0, 255)), (BELT, (0, 0, 255)), (GEAR_P, (0, 0, 255))):
            cv2.rectangle(o, (int(b[0]), int(b[1])), (int(round(b[2])), int(round(b[3]))), col, 1)
        a = o[290:470, 1380:1640]
        b_ = np.zeros((180, 200, 3), np.uint8)
        b_[:, :] = 0
        b_[:70] = o[650:720, 560:760][:, :200]
        b_[90:160] = o[650:720, 1330:1530]
        row = np.hstack([a, b_])
        cv2.putText(row, k, (5, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        crops.append(row)
    cv2.imwrite(os.path.join(OUT, 'check_bmw_items.png'), np.vstack(crops))


if __name__ == '__main__':
    run()
