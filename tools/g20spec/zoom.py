"""Package design/g20-spec: cut a panel-coordinate crop out of a reference photo, supersampled.

Research tool: it reads the photo-to-panel models that tools/overlay/rectify.py fitted
(bake/work/overlay/rect/H.json) and warps one panel box out of the original photo at n x panel
resolution, so glyphs can be measured in panel px with sub-pixel edges.

Run from the repo root (the main checkout: it needs reference/ and bake/work/):
    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/g20spec/zoom.py --photo 08 --box 498 581 580 663 --scale 8 --out /tmp/sign08.png

No pixels from reference/ are written anywhere inside the repo by this tool: --out must be given.
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def model_for(root, photo, hjson=None):
    sys.path.insert(0, os.path.join(root, 'tools', 'overlay'))
    import rectify as R
    R.ROOT = root
    R.OUT = os.path.join(root, 'bake', 'work', 'overlay', 'rect')
    hj = hjson or os.path.join(R.OUT, 'H.json')
    H = json.load(open(hj))
    if photo not in H:
        sys.exit('zoom: no model for photo %s in %s (have %s)' % (photo, hj, ', '.join(sorted(H))))
    e = H[photo]
    ph = R.imread(e['source'])
    size = (ph.shape[1], ph.shape[0])
    return R, e, ph, size


def warp_box(R, e, ph, size, box, n):
    m = e['model']
    S = np.diag([1.0 / n, 1.0 / n, 1.0])                       # panel/n -> panel
    model = R.Model(np.asarray(m['H_panel_to_undistorted_photo'], np.float64) @ S, size, m['k1'])
    x0, y0, x1, y1 = box
    w, h = int(round((x1 - x0) * n)), int(round((y1 - y0) * n))
    return model.warp(ph, x0 * n, y0 * n, w, h, cv2.INTER_LANCZOS4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.environ.get('F30_MAIN', os.path.abspath(os.path.join(HERE, '..', '..'))))
    ap.add_argument('--photo', required=True)
    ap.add_argument('--box', nargs=4, type=float, required=True, metavar=('X0', 'Y0', 'X1', 'Y1'))
    ap.add_argument('--scale', type=float, default=8.0)
    ap.add_argument('--out', required=True)
    ap.add_argument('--grid', type=float, default=0.0, help='draw a faint panel-px grid every N panel px')
    ap.add_argument('--hjson', default=None)
    a = ap.parse_args()

    R, e, ph, size = model_for(a.root, a.photo, a.hjson)
    n = float(a.scale)
    img = warp_box(R, e, ph, size, a.box, n)
    h, w = img.shape[:2]
    if a.grid:
        g = img.copy()
        for k in range(int((a.box[2] - a.box[0]) / a.grid) + 1):
            cv2.line(g, (int(k * a.grid * n), 0), (int(k * a.grid * n), h), (0, 255, 0), 1)
        for k in range(int((a.box[3] - a.box[1]) / a.grid) + 1):
            cv2.line(g, (0, int(k * a.grid * n)), (w, int(k * a.grid * n)), (0, 255, 0), 1)
        img = cv2.addWeighted(img, 0.75, g, 0.25, 0)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)) or '.', exist_ok=True)
    cv2.imwrite(a.out, img)
    print('%s  panel [%g %g %g %g] x%g -> %dx%d px  (%.3f photo px per panel px)'
          % (a.out, a.box[0], a.box[1], a.box[2], a.box[3], n, w, h, e['photo_px_per_panel_px']))


if __name__ == '__main__':
    main()
