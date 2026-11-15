"""Package design/g20-spec: fit photo -> panel models for the extra reference photos this package needs.

tools/overlay/rectify.py and rectify_more.py cover 08-14, 17 and 39. The check-control message, the
"50" sign seen through our window and the bottom row with our theme up are only photographed in the
hi-res shots 34, 37, 40, 41, 42, 43 (reference/ours/, reference/g20/). This fits those the same way
rectify_more.py does - SIFT (CLAHE) from the stock rects to the photo, RANSAC, then rectify.py's
homography + radial-k1 model - but writes its own H file and rects so the shared
bake/work/overlay/rect/H.json is left alone.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/g20spec/rectify_spec.py --root <main checkout> --out-dir <scratch>
"""
import argparse
import json
import os
import sys

import cv2

MORE = {
    '34': 'reference/ours/34_wb-dials_0.7.7_bmw-sign-50_belts_2026-11-13.jpg',
    '37': 'reference/ours/37_zoom_wb-dials_bmw-sign-window_line-stubs_2026-11-13.jpg',
    '40': 'reference/g20/40_g20-look_zoom_fuel_speedo_empty-sign_2026-11-13.jpg',
    '41': 'reference/ours/41_wb-dials_0.7.7_map_D2_bmw-row-not-ours_2026-11-13.jpg',
    '42': 'reference/ours/42_wb-dials_0.7.7_message-heated-wheel_2026-11-13.jpg',
    '43': 'reference/ours/43_wb-dials_0.7.7_message-door-open_car-image_2026-11-13.jpg',
    '35': 'reference/ours/35_zoom_tacho-bottom-right_temp_oil_2026-11-13.jpg',
}
# the two dial discs our wb_dials theme draws over BMW's, plus the map window: masked out of the
# stock template so SIFT only matches where BMW still draws in these photos
OURS = [[40, 20, 790, 700], [1130, 20, 1880, 700]]


def run():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.environ.get('F30_MAIN'))
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--only', default=None)
    ap.add_argument('--full-template', action='store_true', help='do not mask the dial areas')
    a = ap.parse_args()
    sys.path.insert(0, os.path.join(a.root, 'tools', 'overlay'))
    import rectify as R
    R.ROOT = a.root
    rectdir = os.path.join(a.root, 'bake', 'work', 'overlay', 'rect')
    os.makedirs(a.out_dir, exist_ok=True)
    hj = os.path.join(a.out_dir, 'H.json')
    res = json.load(open(hj)) if os.path.exists(hj) else {}
    tpls = {k: cv2.imread(os.path.join(rectdir, k + '.png')) for k in ('39', '09', '08')}
    for k, src in sorted(MORE.items()):
        if a.only and k not in a.only.split(','):
            continue
        ph = R.imread(src)
        size = (ph.shape[1], ph.shape[0])
        up = 1.0 if size[0] < 3000 else 0.5
        best = None
        for t, tpl in tpls.items():
            if tpl is None:
                continue
            tm = R.box_mask(tpl.shape, [[600, 60, 1300, 600]], 0, 255)     # map window: content differs
            if not a.full_template:
                for b in OURS:
                    tm[b[1]:b[3], b[0]:b[2]] = 0
            tm[tpl.sum(2) == 0] = 0
            s, d, ng = R.sift_pairs(tpl, ph, tm, up=up, ratio=0.8)
            if len(s) < 12:
                print(k, 'from', t, ': only', len(s), 'pairs')
                continue
            sc = size[0] / 1920.0
            try:
                m, inl, r, st, Hp = R.robust_fit(s, d, size, 3.0, True, ransac_panel=8.0, scale=sc)
            except Exception as exc:                                        # noqa: BLE001
                print(k, 'from', t, ': fit failed', exc)
                continue
            st['good_matches'], st['template'] = ng, t
            print(k, 'from', t, {x: st[x] for x in ('inliers', 'rms_panel_px', 'k1', 'inlier_bbox_panel')})
            if best is None or st['inliers'] > best[1]['inliers']:
                best = (m, st, Hp)
        if best is None:
            print(k, ': no match, skipped')
            continue
        m, st, Hp = best
        st['method'] = ('SIFT (CLAHE) from the %s rect to the photo%s; RANSAC, then homography + radial k1 '
                        '(tools/g20spec/rectify_spec.py)' % (st['template'], '' if up == 1.0 else ' (half size)'))
        e = R.entry(m, st, Hp, src)
        e['panel_px_per_photo_px'] = round(1.0 / e['photo_px_per_panel_px'], 3)
        e['usable_for_geometry'] = e['rms_panel_px'] <= R.ACCEPT_RMS
        res[k] = e
        cv2.imwrite(os.path.join(a.out_dir, k + '.png'), m.warp(ph))
    json.dump(res, open(hj, 'w'), indent=1)
    print('wrote', hj)


if __name__ == '__main__':
    run()
