"""Package design/g20-spec: tie a hi-res photo of the cluster to panel px through photo 39's model.

Photos 34, 37, 41, 42 and 43 were taken in the same session as 39 but with our 6WB Dials theme up, so
only BMW's bottom row, its speed-limit sign and its check-control frame are common with the stock
rect. That strip is too thin for a free homography, but 39's model already takes out almost all of the
perspective, so what is left between rect 39 and photo-39-model(photo X) is close to a similarity.

    panel --A (partial affine, fitted on the common strip)--> panel' --39's model--> photo X

A is fitted with SIFT + RANSAC inside a mask, then written as a full model entry (H = H39 . A, same
k1) in the package's own H.json, so tools/g20spec/zoom.py can cut panel-coordinate crops from it.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/g20spec/fit_strip.py --root <main checkout> --out-dir <scratch> --photo 42
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

SRC = {
    '34': 'reference/ours/34_wb-dials_0.7.7_bmw-sign-50_belts_2026-11-13.jpg',
    '35': 'reference/ours/35_zoom_tacho-bottom-right_temp_oil_2026-11-13.jpg',
    '37': 'reference/ours/37_zoom_wb-dials_bmw-sign-window_line-stubs_2026-11-13.jpg',
    '40': 'reference/g20/40_g20-look_zoom_fuel_speedo_empty-sign_2026-11-13.jpg',
    '41': 'reference/ours/41_wb-dials_0.7.7_map_D2_bmw-row-not-ours_2026-11-13.jpg',
    '42': 'reference/ours/42_wb-dials_0.7.7_message-heated-wheel_2026-11-13.jpg',
    '43': 'reference/ours/43_wb-dials_0.7.7_message-door-open_car-image_2026-11-13.jpg',
}
# where BMW still draws with 6WB Dials up: the bottom row strip (both photos show BMW's own row)
STRIP = [[60, 615, 1900, 720]]


def run():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.environ.get('F30_MAIN'))
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--photo', required=True)
    ap.add_argument('--base', default='39')
    ap.add_argument('--base-dir', default=None, help='take the base rect and H from here instead of bake/work')
    ap.add_argument('--mask', nargs='*', type=int, default=None, help='x0 y0 x1 y1 ... extra match boxes')
    ap.add_argument('--gate', type=float, default=140.0, help='max panel-px displacement a pair may have')
    ap.add_argument('--scale-range', nargs=2, type=float, default=(0.7, 1.4), help='sanity range for the affine scale')
    a = ap.parse_args()
    sys.path.insert(0, os.path.join(a.root, 'tools', 'overlay'))
    import rectify as R
    R.ROOT = a.root
    rectdir = a.base_dir or os.path.join(a.root, 'bake', 'work', 'overlay', 'rect')
    base = json.load(open(os.path.join(rectdir, 'H.json')))[a.base]
    tpl = cv2.imread(os.path.join(rectdir, a.base + '.png'))
    ph = R.imread(SRC[a.photo])
    size = (ph.shape[1], ph.shape[0])
    m0 = R.Model(np.asarray(base['model']['H_panel_to_undistorted_photo']), size, base['model']['k1'])
    warped = m0.warp(ph)

    boxes = STRIP if not a.mask else [a.mask[i:i + 4] for i in range(0, len(a.mask), 4)]
    mask = R.box_mask(tpl.shape, boxes, 255, 0)
    s, d, ng = R.sift_pairs(tpl, warped, mask, mask, ratio=0.85, n=20000)
    keep = np.hypot(*(np.asarray(d) - np.asarray(s)).T) <= a.gate      # the camera barely moved: gate the pairs
    s, d = np.asarray(s)[keep], np.asarray(d)[keep]
    print('pairs', len(s), 'good', ng, '(gated at %g panel px)' % a.gate)
    if len(s) < 8:
        sys.exit('fit_strip: only %d pairs after the gate' % len(s))
    A, inl = cv2.estimateAffinePartial2D(np.float32(s), np.float32(d), method=cv2.RANSAC,
                                         ransacReprojThreshold=4.0, maxIters=20000)
    if A is None:
        sys.exit('fit_strip: no affine')
    inl = inl.ravel().astype(bool)
    lo, hi = a.scale_range
    if not (lo < float(np.hypot(A[0, 0], A[0, 1])) < hi) or abs(np.degrees(np.arctan2(A[1, 0], A[0, 0]))) > 6:
        sys.exit('fit_strip: degenerate affine (scale %.3f, rot %.2f deg)'
                 % (np.hypot(A[0, 0], A[0, 1]), np.degrees(np.arctan2(A[1, 0], A[0, 0]))))
    res = (cv2.transform(np.float32(s[inl]).reshape(-1, 1, 2), A).reshape(-1, 2) - d[inl])
    rms = float(np.sqrt((res ** 2).sum(1).mean()))
    sc = float(np.hypot(A[0, 0], A[0, 1]))
    rot = float(np.degrees(np.arctan2(A[1, 0], A[0, 0])))
    print('inliers %d/%d  rms %.2f panel px  scale %.4f  rot %.2f deg  t (%.1f, %.1f)'
          % (inl.sum(), len(s), rms, sc, rot, A[0, 2], A[1, 2]))
    A3 = np.vstack([A, [0, 0, 1]])
    H = np.asarray(base['model']['H_panel_to_undistorted_photo']) @ A3
    model = R.Model(H, size, base['model']['k1'])
    e = {
        'source': SRC[a.photo],
        'model': {'H_panel_to_undistorted_photo': model.H.tolist(), 'k1': base['model']['k1'],
                  'centre_photo_px': [(size[0] - 1) / 2.0, (size[1] - 1) / 2.0],
                  'norm_radius_photo_px': float(np.hypot(*size) / 2.0),
                  'formula': 'u = c + (q - c)(1 + k1 |q - c|^2 / s^2), u = H panel; q photo px'},
        'H_panel_to_photo': model.plain_H().tolist(),
        'method': ('photo %s model composed with a partial affine fitted by SIFT+RANSAC on %s '
                   '(tools/g20spec/fit_strip.py)' % (a.base, boxes)),
        'inliers': int(inl.sum()), 'rms_panel_px': round(rms, 3),
        'affine_scale': round(sc, 4), 'affine_rot_deg': round(rot, 3),
        'photo_px_per_panel_px': round(model.scale(), 4),
        'usable_for_geometry': rms <= 3.0,
    }
    e['panel_px_per_photo_px'] = round(1.0 / e['photo_px_per_panel_px'], 3)
    os.makedirs(a.out_dir, exist_ok=True)
    hj = os.path.join(a.out_dir, 'H.json')
    allh = json.load(open(hj)) if os.path.exists(hj) else {}
    allh[a.photo] = e
    json.dump(allh, open(hj, 'w'), indent=1)
    cv2.imwrite(os.path.join(a.out_dir, a.photo + '.png'), model.warp(ph))
    print('wrote', hj, 'and', a.photo + '.png', '(%.3f photo px per panel px)' % e['photo_px_per_panel_px'])


if __name__ == '__main__':
    run()
