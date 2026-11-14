"""Rectify more stock G20 photos to panel px for the bench's "photo" backdrop (bench/page.html), next to
tools/overlay/rectify.py's set, without re-running that chain.

Run from the repo root (after tools/overlay/rectify.py, whose 09 and 08 rects it matches against):
    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        --with pillow python tools/overlay/rectify_more.py

Each photo: SIFT (CLAHE) from the 09 and the 08 rect (stock theme in panel px; the map window masked, its content
differs per photo) to the photo, RANSAC, then the homography + radial-k1 model of rectify.py on the inliers; the
template with more inliers wins. Writes (git-ignored, third-party pixels, never shipped):
    bake/work/overlay/rect/<id>.png   the photo warped to the panel frame (1920x720)
    bake/work/overlay/rect/H.json     its entry merged in (method, rms, inliers)
"""
import json
import os
import sys

import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rectify as R  # noqa: E402

# stock G20 photos only (no theme of ours in them): the bench shows what BMW draws round a see-through theme
MORE = {
    '17': 'reference/g20/17_stock-media-list_door-open_2026-11-12.jpg',        # the media list in the middle, door open
    '39': 'reference/g20/39_g20-look_map_comfort-plus_hires_2026-11-13.jpg',   # Comfort Plus, map, parked, day
}


def run():
    hj = os.path.join(R.OUT, 'H.json')
    res = json.load(open(hj)) if os.path.exists(hj) else {}
    tpls = {k: cv2.imread(os.path.join(R.OUT, k + '.png')) for k in ('09', '08')}
    if any(v is None for v in tpls.values()):
        sys.exit('rectify_more: run tools/overlay/rectify.py first (needs its 08 and 09 rects)')
    for k, src in MORE.items():
        ph = R.imread(src)
        size = (ph.shape[1], ph.shape[0])
        up = 1.0 if size[0] < 3000 else 0.5          # SIFT on a half-size copy of a 12 MP photo: same scale as the rect
        best = None
        for t, tpl in tpls.items():
            tm = R.box_mask(tpl.shape, [[600, 60, 1300, 600]], 0, 255)
            tm[tpl.sum(2) == 0] = 0
            s, d, ng = R.sift_pairs(tpl, ph, tm, up=up, ratio=0.8)
            if len(s) < 12:
                continue
            sc = size[0] / 1920.0
            m, inl, r, st, Hp = R.robust_fit(s, d, size, 3.0, True, ransac_panel=8.0, scale=sc)
            st['good_matches'], st['template'] = ng, t
            print(k, 'from', t, {x: st[x] for x in ('inliers', 'rms_panel_px', 'k1', 'inlier_bbox_panel')})
            if best is None or st['inliers'] > best[1]['inliers']:
                best = (m, st, Hp)
        if best is None:
            print(k, ': no match, skipped')
            continue
        m, st, Hp = best
        st['method'] = ('SIFT (CLAHE) from the %s rect (stock theme, map window masked) to the photo%s; RANSAC, then '
                        'homography + radial k1 on the inliers (tools/overlay/rectify_more.py)'
                        % (st['template'], '' if up == 1.0 else ' (half size)'))
        e = R.entry(m, st, Hp, src)
        e['panel_px_per_photo_px'] = round(1.0 / e['photo_px_per_panel_px'], 3)
        e['usable_for_geometry'] = e['rms_panel_px'] <= R.ACCEPT_RMS
        e['reason'] = None if e['usable_for_geometry'] else 'rms %.2f > %.1f panel px' % (e['rms_panel_px'], R.ACCEPT_RMS)
        res[k] = e
        cv2.imwrite(os.path.join(R.OUT, k + '.png'), m.warp(ph))
    json.dump(res, open(hj, 'w'), indent=1)


if __name__ == '__main__':
    run()
