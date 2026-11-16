"""Package T (strip typography): a PROVISIONAL photo -> panel model for the 2026-11-16 stock photos, used only
until package R publishes its registration (bake/work/strip/rect/H.json).

SIFT (CLAHE) from the low-resolution stock rects (39, 09, 08: bake/work/overlay/rect/) to the new photo,
RANSAC, then tools/overlay/rectify.py's homography + radial k1 - the same route as tools/g20spec/rectify_spec.py.
The map window and the strip itself are masked out of the template (their content changes between photos),
so the strip is tied only through the dials. Writes bake/work/strip/T/H.json in the schema zoom.py reads.
Typography needs this only for absolute positions (baselines, anchors); sizes, advances and stems are
differences inside one crop and do not depend on it beyond the local scale.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/strip/T/register_quick.py --root . [--only 61,62]
"""
import argparse
import glob
import json
import os
import sys

import cv2

IDS = ['60', '61', '62', '63', '64', '66', '67', '68', '65']


def run():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.environ.get('F30_MAIN', '.'))
    ap.add_argument('--only', default=None)
    a = ap.parse_args()
    a.root = os.path.abspath(a.root)
    sys.path.insert(0, os.path.join(a.root, 'tools', 'overlay'))
    import rectify as R
    R.ROOT = a.root
    rectdir = os.path.join(a.root, 'bake', 'work', 'overlay', 'rect')
    out = os.path.join(a.root, 'bake', 'work', 'strip', 'T')
    os.makedirs(out, exist_ok=True)
    hj = os.path.join(out, 'H.json')
    tpls = {k: cv2.imread(os.path.join(rectdir, k + '.png')) for k in ('39', '09', '08')}
    for k in IDS:
        if a.only and k not in a.only.split(','):
            continue
        src = os.path.relpath(glob.glob(os.path.join(a.root, 'reference', 'g20', k + '_*'))[0], a.root)
        ph = R.imread(src)
        size = (ph.shape[1], ph.shape[0])
        up = 0.5 if size[0] > 3000 else 1.0
        best = None
        for t, tpl in tpls.items():
            tm = R.box_mask(tpl.shape, [[600, 60, 1300, 600], [0, 640, 1920, 720]], 0, 255)
            tm[tpl.sum(2) == 0] = 0
            s, d, ng = R.sift_pairs(tpl, ph, tm, up=up, ratio=0.8)
            if len(s) < 12:
                print(k, 'from', t, ': only', len(s), 'pairs', flush=True)
                continue
            try:
                m, inl, r, st, Hp = R.robust_fit(s, d, size, 3.0, True, ransac_panel=8.0, scale=size[0] / 1920.0)
            except Exception as exc:                                        # noqa: BLE001
                print(k, 'from', t, ': fit failed', exc, flush=True)
                continue
            st['good_matches'], st['template'] = ng, t
            print(k, 'from', t, {x: st[x] for x in ('inliers', 'rms_panel_px', 'k1', 'inlier_bbox_panel')}, flush=True)
            if best is None or st['inliers'] > best[1]['inliers']:
                best = (m, st, Hp)
        if best is None:
            continue
        m, st, Hp = best
        st['method'] = ('PROVISIONAL: SIFT from the %s rect, RANSAC, homography + k1 '
                        '(tools/strip/T/register_quick.py)' % st['template'])
        e = R.entry(m, st, Hp, src)
        res = json.load(open(hj)) if os.path.exists(hj) else {}
        res[k] = e
        json.dump(res, open(hj, 'w'), indent=1)
        print('wrote', k, 'to', hj, flush=True)


if __name__ == '__main__':
    run()
