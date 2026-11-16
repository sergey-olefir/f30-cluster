"""Package ZC: a PROVISIONAL registration of the 2026-11-16 photos, used only until package R publishes
bake/work/strip/rect/<id>.READY. Results are marked provisional wherever they are used.

    60      grid over stock: start = SIFT from the low-res rect of 10 (same grid theme), then every visible major
            grid crossing located by NCC on green-minus-red (rectify.do_10's method); homography + radial k1.
    others  stock: SIFT (CLAHE) from the 60 rect (our grid lines and labels masked, map window masked) to the
            photo; RANSAC, homography + radial k1; then NCC on stock-fixed patches of the 61 rect inside the
            lower panel (rails, ticks, numerals) for a local refinement.

Writes, git-ignored:  bake/work/strip/zone-c/reg/H.json (the schema of tools/g20spec/zoom.py),
                      bake/work/strip/zone-c/reg/<id>_strip_4x.png (x 600-1340, y 540-720 at 4x, 8-bit)
Run from the repo root with F30_MAIN set (reference/ and bake/work/ are links to the main checkout):
    UV_CACHE_DIR=$F30_MAIN/bake/work/.uvcache uv run -q --no-project --with opencv-python-headless \
        --with numpy python -I tools/strip/ZC/quickreg.py [ids...]
Pixel convention inside H.json: OpenCV's (index = centre), as rectify.py.
"""
import json
import os
import sys

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'overlay'))
import rectify as R  # noqa: E402

R.ROOT = ROOT
OUT = os.path.join(ROOT, 'bake', 'work', 'strip', 'zone-c', 'reg')
PH = {
    '60': 'reference/g20/60_grid-over-stock_P_2026-11-16.png',
    '61': 'reference/g20/61_stock_D_limit50_road_2026-11-16.png',
    '62': 'reference/g20/62_stock_P_msg-2line_sym-i_limit50_belts_2026-11-16.png',
    '63': 'reference/g20/63_stock_P_limit50_marker-i_service_2026-11-16.png',
    '64': 'reference/g20/64_stock_P_limit30_belt1_road_2026-11-16.png',
    '65': 'reference/g20/65_stock_standby_odometer_2026-11-16.png',
    '66': 'reference/g20/66_stock_P_msg-1line_limit30_marker-warn_2026-11-16.png',
    '67': 'reference/g20/67_stock_P_limit30_marker-warn_road_service_2026-11-16.png',
    '68': 'reference/g20/68_stock_D_nolimit_msa_map_2026-11-16.png',
}
ZBOX = (600, 540, 1340, 720)   # the zone-C crop written at 4x (continuous panel coords)


def grid_mask(rect):
    """255 where the 60 rect shows stock content, 0 on our grid lines and labels (green or yellow, saturated)."""
    b, g, r = [c.astype(np.int16) for c in cv2.split(rect)]
    ours = ((g - r) > 25) | ((g > 150) & (r > 150) & (b < 90))
    m = np.full(rect.shape[:2], 255, np.uint8)
    m[cv2.dilate(ours.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0] = 0
    m[rect.sum(2) == 0] = 0
    return m


def do_60(ph):
    size = (ph.shape[1], ph.shape[0])
    H = json.load(open(os.path.join(ROOT, 'bake/work/overlay/rect/H.json')))
    e = H['10']['model']
    m10 = R.Model(e['H_panel_to_undistorted_photo'], (2048, 1536), e['k1'])
    rect10 = m10.warp(R.imread(H['10']['source']))
    up = 0.36
    s, d, ng = R.sift_pairs(rect10, ph, up=up, ratio=0.8)
    m0, inl, r, st0, _ = R.robust_fit(s, d, size, 4.0, k1_free=False, ransac_panel=6.0, scale=2.7)
    print('60 start: SIFT from 10 rect, good %d inliers %d rms %.2f' % (ng, st0['inliers'], st0['rms_panel_px']))
    patches = []
    for k in range(1, 20):
        for j in range(1, 8):
            cx, cy = 100 * k + 0.5, 100 * j + 0.5
            patches.append((cx - 17.5, cy - 17.5, cx + 18.5, min(cy + 18.5, 719), 'x%d/y%d' % (100 * k, 100 * j)))

    def prep(im):
        return cv2.GaussianBlur(R.green_minus_red(im), (0, 0), 1.0)
    m, st, Hp, pts = R.refine(ph, m0, R.grid_template(), patches, prep, searches=(12, 6, 4), thr=2.5,
                              min_score=0.5)
    st['method'] = 'grid crossings by NCC (green-minus-red); start SIFT from the 10 rect; homography + radial k1'
    return m, st, Hp, pts


def strip_patches(ref):
    """Fixed stock content of the lower panel: bright blobs of the reference rect outside anything that changes."""
    vary = [[600, 60, 1300, 600],            # map / car image / centre texts
            [480, 560, 600, 720], [130, 655, 470, 720], [1500, 655, 1700, 720],   # sign, belts, range, clock, temp
            [690, 590, 1290, 720],            # the message panel, marker, road label, odometer
            [1380, 300, 1650, 450], [1400, 650, 1440, 710],   # gear, mode label areas
            [300, 300, 640, 420], [0, 150, 120, 470], [1780, 150, 1920, 330], [1830, 400, 1920, 700],
            [1180, 560, 1300, 640], [380, 450, 440, 660], [1490, 450, 1570, 660]]   # needles, telltales
    return R.component_patches(ref, vary, [], thr=80, amin=20, amax=6000, pad=5, merge=7)


def main(ids):
    os.makedirs(OUT, exist_ok=True)
    hj = os.path.join(OUT, 'H.json')
    res = json.load(open(hj)) if os.path.exists(hj) else {}
    ph60 = R.imread(PH['60'])
    if '60' not in res:
        m60, st, Hp, pts = do_60(ph60)
        res['60'] = R.entry(m60, st, Hp, PH['60'])
        json.dump(res, open(hj, 'w'), indent=1)
        print('60', {k: v for k, v in st.items() if k not in ('outliers', 'method')})
    e = res['60']['model']
    m60 = R.Model(e['H_panel_to_undistorted_photo'], (ph60.shape[1], ph60.shape[0]), e['k1'])
    rect60 = m60.warp(ph60)
    gm = grid_mask(rect60)
    gm[60:600, 600:1300] = 0
    ref61 = None
    for pid in ids:
        if pid == '60':
            continue
        ph = R.imread(PH[pid])
        size = (ph.shape[1], ph.shape[0])
        up = 0.36 if size[0] > 5000 else 0.5
        s, d, ng = R.sift_pairs(rect60, ph, tpl_mask=gm, up=up, ratio=0.8)
        m0, inl, r, st0, Hp0 = R.robust_fit(s, d, size, 2.5, k1_free=True, ransac_panel=5.0, scale=1 / up)
        st = dict(st0)
        st['good_matches'] = ng
        st['method'] = 'SIFT (CLAHE) from the 60 rect (grid, labels and map masked) to the photo; homography + k1'
        if pid != '61':
            if ref61 is None:
                e1 = res['61']['model']
                p61 = R.imread(PH['61'])
                ref61 = R.Model(e1['H_panel_to_undistorted_photo'], (p61.shape[1], p61.shape[0]), e1['k1']).warp(p61)
            try:
                m1, st1, Hp1, pts = R.refine(ph, m0, ref61, strip_patches(ref61), R.prep_gray(1.0),
                                             searches=(10, 5, 3), thr=2.0, min_score=0.6)
                st1['start'] = {'sift_inliers': st0['inliers'], 'rms_panel_px': st0['rms_panel_px']}
                st1['delta_sift_vs_refined_panel_px_max_mean'] = R.mdiff(m0, m1)
                st1['method'] = st['method'] + '; refined by NCC on fixed stock blobs of the 61 rect'
                m0, st, Hp0 = m1, st1, Hp1
            except RuntimeError as ex:
                st['refine_failed'] = str(ex)
        res[pid] = R.entry(m0, st, Hp0, PH[pid])
        json.dump(res, open(hj, 'w'), indent=1)
        print(pid, {k: v for k, v in st.items() if k not in ('outliers', 'method')})
    for pid in ['60'] + list(ids):
        e = res[pid]['model']
        ph = ph60 if pid == '60' else R.imread(PH[pid])
        n = 4.0
        S = np.diag([1 / n, 1 / n, 1.0])
        mm = R.Model(np.asarray(e['H_panel_to_undistorted_photo']) @ S, (ph.shape[1], ph.shape[0]), e['k1'])
        x0, y0, x1, y1 = ZBOX
        # pixel i of the crop centres at continuous x0 + (i + 0.5)/n = OpenCV index x0 + (i + 0.5)/n - 0.5;
        # the scaled model takes n * index, so the warp origin is n*x0 + 0.5 - n/2
        off = 0.5 - n / 2.0
        img = mm.warp(ph, x0 * n + off, y0 * n + off, int((x1 - x0) * n), int((y1 - y0) * n), cv2.INTER_LANCZOS4)
        cv2.imwrite(os.path.join(OUT, '%s_zone_4x.png' % pid), img)


if __name__ == '__main__':
    main(sys.argv[1:] or ['61', '62', '63', '64', '65', '66', '67', '68'])
