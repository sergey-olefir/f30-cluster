"""Package ZR: a PROVISIONAL registration of the 2026-11-16 photos to panel px, used only until package R's
rects (bake/work/strip/rect/<id>.READY) exist, and afterwards as an independent cross-check of R's models.

Method: SIFT (CLAHE) from an existing stock rect in panel px (bake/work/overlay/rect/09.png, rms ~1 px) to the
photo (downscaled), the map window masked; RANSAC homography, then tools/overlay/rectify.py's model (homography
plus one radial term).

Writes only under bake/work/strip/zone-R/qreg/ (git-ignored): H.json in the schema tools/g20spec/zoom.py reads,
and <id>_R4.png, the right zone x 1180-1920, y 520-720 at 4x. No photo pixel goes anywhere else.

Run: UV_CACHE_DIR=$F30_MAIN/bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
         python -I tools/strip/ZR/quickreg.py [ids...]
"""
import json
import os
import sys

import cv2
import numpy as np

MAIN = os.environ.get('F30_MAIN', os.path.expanduser('~/projects/f30-cluster'))
sys.path.insert(0, os.path.join(MAIN, 'tools', 'overlay'))
import rectify as R  # noqa: E402

R.ROOT = MAIN
OUT = os.path.join(MAIN, 'bake', 'work', 'strip', 'zone-R', 'qreg')
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
}
ZBOX = (1180, 520, 1920, 720)


def run(ids):
    os.makedirs(OUT, exist_ok=True)
    hj = os.path.join(OUT, 'H.json')
    res = json.load(open(hj)) if os.path.exists(hj) else {}
    tpl = cv2.imread(os.path.join(MAIN, 'bake/work/overlay/rect/09.png'))
    tm = R.box_mask(tpl.shape, [[560, 40, 1340, 610]], 0, 255)   # the map window differs per photo
    tm[tpl.sum(2) < 30] = 0
    for k in ids:
        ph = R.imread(PHOTOS[k])
        size = (ph.shape[1], ph.shape[0])
        s, d, ng = R.sift_pairs(tpl, ph, tm, up=0.5, ratio=0.8)
        m, inl, r, st, Hp = R.robust_fit(s, d, size, 3.0, True, ransac_panel=6.0, scale=2.5)
        st['good_matches'] = ng
        st['method'] = 'SIFT from rect 09 (map window masked), photo at 0.5x; RANSAC; homography + radial k1'
        src = np.float64(s)
        e = np.linalg.norm(m.to_panel(np.float64(d)) - src, axis=1)
        ins = (src[:, 1] >= 540) & (e < 3.0)
        st['strip_inliers'] = int(ins.sum())
        st['strip_rms_panel_px'] = round(float(np.sqrt((e[ins] ** 2).mean())), 3) if ins.any() else None
        res[k] = R.entry(m, st, Hp, PHOTOS[k])
        n = 4
        S = np.diag([1.0 / n, 1.0 / n, 1.0])
        mm = R.Model(m.H @ S, size, m.k1)
        x0, y0, x1, y1 = ZBOX
        img = mm.warp(ph, x0 * n, y0 * n, (x1 - x0) * n, (y1 - y0) * n, cv2.INTER_LANCZOS4)
        cv2.imwrite(os.path.join(OUT, '%s_R4.png' % k), img)
        print(k, {a: b for a, b in st.items() if a not in ('method', 'outliers')}, flush=True)
        json.dump(res, open(hj, 'w'), indent=1)


if __name__ == '__main__':
    run(sys.argv[1:] or sorted(PHOTOS))
