"""Package T (strip typography): shared helpers - which photo model to use, and warping a panel box out of an
original photo at n x panel resolution.

Model preference: package R's registration (bake/work/strip/rect/H.json, the schema tools/g20spec/zoom.py reads)
when it has the photo, else this package's provisional one (bake/work/strip/T/H.json, tools/strip/T/register_quick.py),
else the old low-resolution models (bake/work/overlay/rect/H.json). Every result records which one it used.
No photo pixel is written inside the repo by anything here.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MODELS = [
    ('R', os.path.join('bake', 'work', 'strip', 'rect', 'H.json')),
    ('T-provisional', os.path.join('bake', 'work', 'strip', 'T', 'H.json')),
    ('overlay', os.path.join('bake', 'work', 'overlay', 'rect', 'H.json')),
]
_cache = {}


def rectify(root=ROOT):
    sys.path.insert(0, os.path.join(root, 'tools', 'overlay'))
    import rectify as R
    R.ROOT = root
    return R


def model(photo, root=ROOT, prefer=None):
    """(R module, entry, photo array, size, source label) for a photo id."""
    key = (photo, prefer)
    if key in _cache:
        return _cache[key]
    R = rectify(root)
    for label, rel in MODELS:
        if prefer and label != prefer:
            continue
        p = os.path.join(root, rel)
        if not os.path.exists(p):
            continue
        H = json.load(open(p))
        e = H.get(photo + '_strip') if label == 'R' and photo + '_strip' in H else H.get(photo)   # R: the STRIP refit
        if not e or 'model' not in e:
            continue
        if label == 'R' and not os.path.exists(os.path.join(root, 'bake', 'work', 'strip', 'rect', photo + '.READY')):
            continue
        if label == 'R' and photo + '_strip' in H:
            label = 'R-strip'
        ph = R.imread(e['source'])
        out = (R, e, ph, (ph.shape[1], ph.shape[0]), label)
        _cache[key] = out
        return out
    raise SystemExit('no model for photo %s' % photo)


def warp(photo, box, n, root=ROOT, prefer=None):
    """The panel box [x0, y0, x1, y1] (continuous panel coordinates) out of the photo at n x, float32 RGB 0..1.
    Output pixel (i, j) covers panel [x0 + i/n, x0 + (i+1)/n) etc. rectify.Model.warp maps output index centres to
    panel = index / n (OpenCV convention: index = centre), so we shift by half an output pixel to make index i's centre
    sit at x0 + (i + 0.5)/n."""
    import cv2
    R, e, ph, size, label = model(photo, root, prefer)
    m = e['model']
    # panel = (u + 0.5) / n + x0 - 0.5   (the last -0.5: rectify's panel coords are OpenCV index-centre coords)
    S = np.array([[1.0 / n, 0, 0.5 / n - 0.5], [0, 1.0 / n, 0.5 / n - 0.5], [0, 0, 1.0]])
    T = np.array([[1, 0, box[0]], [0, 1, box[1]], [0, 0, 1.0]])
    mod = R.Model(np.asarray(m['H_panel_to_undistorted_photo'], np.float64) @ T @ S, size, m['k1'])
    w, h = int(round((box[2] - box[0]) * n)), int(round((box[3] - box[1]) * n))
    img = mod.warp(ph, 0, 0, w, h, cv2.INTER_LANCZOS4)
    return img[:, :, ::-1].astype(np.float32) / 255.0, label, e.get('photo_px_per_panel_px')
