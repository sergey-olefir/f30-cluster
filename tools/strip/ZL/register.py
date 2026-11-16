"""Package ZL: a quick, provisional registration of the 2026-11-16 photos (60-68) to panel px, for zone L only
until package R's models (bake/work/strip/rect/H.json) land.

Run from the main checkout (it needs reference/ and bake/work/):
    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        --with pillow --with scipy python -I tools/strip/ZL/register.py [ids...]

Method (tools/overlay/rectify.py's model: homography + one radial term, OpenCV pixel-centre convention):
  every photo   SIFT (CLAHE) from the 09 and 08 rects (stock theme, map window masked) to the photo at half size,
                RANSAC, homography + k1 (as tools/overlay/rectify_more.py);
  60            then our calibration grid's major crossings by NCC on green-minus-red (as rectify.py's do_10).
Writes (git-ignored, photo-derived):  bake/work/strip/zone-L/H.json  in the schema tools/g20spec/zoom.py reads.
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
R.OUT = os.path.join(ROOT, 'bake', 'work', 'overlay', 'rect')
OUT = os.path.join(ROOT, 'bake', 'work', 'strip', 'zone-L')

PH = {
    '60': '60_grid-over-stock_P_2026-11-16.png', '61': '61_stock_D_limit50_road_2026-11-16.png',
    '62': '62_stock_P_msg-2line_sym-i_limit50_belts_2026-11-16.png',
    '63': '63_stock_P_limit50_marker-i_service_2026-11-16.png', '64': '64_stock_P_limit30_belt1_road_2026-11-16.png',
    '65': '65_stock_standby_odometer_2026-11-16.png', '66': '66_stock_P_msg-1line_limit30_marker-warn_2026-11-16.png',
    '67': '67_stock_P_limit30_marker-warn_road_service_2026-11-16.png', '68': '68_stock_D_nolimit_msa_map_2026-11-16.png',
}


def grid_refine(ph, m0):
    patches = []
    for k in range(1, 20):
        for j in range(1, 8):
            cx, cy = 100 * k + 0.5, 100 * j + 0.5
            patches.append((cx - 17.5, cy - 17.5, cx + 18.5, min(cy + 18.5, 719), 'x%d/y%d' % (100 * k, 100 * j)))

    def prep(im):
        return cv2.GaussianBlur(R.green_minus_red(im), (0, 0), 2.0)
    return R.refine(ph, m0, R.grid_template(), patches, prep, searches=(14, 8, 5), thr=2.5, min_score=0.5)


def main(ids):
    hj = os.path.join(OUT, 'H.json')
    res = json.load(open(hj)) if os.path.exists(hj) else {}
    tpls = {k: cv2.imread(os.path.join(R.OUT, k + '.png')) for k in ('09', '08')}
    for k in ids:
        src = 'reference/g20/' + PH[k]
        ph = R.imread(src)
        size = (ph.shape[1], ph.shape[0])
        up = 0.5 if size[0] > 5000 else 0.6
        best = None
        for t, tpl in tpls.items():
            tm = R.stock_mask(tpl)
            pm = None
            if k == '60':   # the grid and its labels: keep only dark-ish, non-green photo pixels
                g = R.green_minus_red(ph)
                pm = np.where(cv2.dilate((g > 30).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0, 0, 255).astype(np.uint8)
            s, d, ng = R.sift_pairs(tpl, ph, tm, pm, up=up, ratio=0.8)
            if len(s) < 12:
                continue
            m, inl, r, st, Hp = R.robust_fit(s, d, size, 3.0, True, ransac_panel=8.0, scale=size[0] / 1920.0)
            st['good_matches'], st['template'] = ng, t
            print(k, 'sift from', t, {x: st[x] for x in ('inliers', 'rms_panel_px', 'k1', 'photo_px_per_panel_px')},
                  flush=True)
            if best is None or st['inliers'] > best[1]['inliers']:
                best = (m, st, Hp)
        m, st, Hp = best
        st['method'] = ('SIFT (CLAHE) from the %s rect to the photo (x%.1f); RANSAC, homography + radial k1 '
                        '(tools/strip/ZL/register.py)' % (st['template'], up))
        if k == '60':
            m, st2, Hp, pts = grid_refine(ph, m)
            st2['method'] = ('grid crossings (our calibration grid, majors every 100 px) by NCC on green-minus-red, '
                             'start: SIFT from the %s rect; homography + radial k1' % st['template'])
            st2['sift_start'] = {x: st[x] for x in ('inliers', 'rms_panel_px', 'k1')}
            st = st2
            res['60_points'] = pts
            print('60 grid', {x: st[x] for x in ('inliers', 'rms_panel_px', 'loo_rms_panel_px', 'k1',
                                                 'photo_px_per_panel_px', 'outliers')}, flush=True)
        res[k] = R.entry(m, st, Hp, src, {'provisional': True, 'by': 'ZL quick registration'})
        json.dump(res, open(hj, 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1:] or sorted(PH))
