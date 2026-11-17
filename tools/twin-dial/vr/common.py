"""Package VR (twin-dial references): shared helpers.

Conventions
    Source pixel coordinates: OpenCV's (pixel index = pixel centre). Continuous coordinates (pixel (i, j) covers
    [i, i+1) x [j, j+1)) are index + 0.5; every JSON written by this package says which one it uses.
    Rectified frame ("dial frame"): x right, y down, the line through the two dial centres horizontal, scale fixed so
    that the LEFT dial's bezel radius R = 400 px. Angles in degrees clockwise from 12 o'clock.

Photo pixels never leave bake/work/twin-dial/ (git-ignored through the bake/work symlink).
"""
import json
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MAIN = os.environ.get('F30_MAIN', '/Users/solefir/projects/f30-cluster')
WORK = os.path.join(MAIN, 'bake', 'work', 'twin-dial')
VRW = os.path.join(WORK, 'vr')           # intermediate (diagnostics)
PUB = os.path.join(WORK, 'pub', 'VR')    # published to the other packages
R_PX = 400.0


def cfg():
    with open(os.path.join(HERE, 'refs.json')) as f:
        return json.load(f)


def src_path(ref):
    p = ref['path']
    return p if os.path.isabs(p) else os.path.join(MAIN, p)


def imread(ref):
    im = cv2.imread(src_path(ref), cv2.IMREAD_COLOR)
    if im is None:
        raise SystemExit('missing ' + src_path(ref))
    return im


def srgb_to_lin(v8):
    v = np.asarray(v8, np.float32) / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_to_srgb(l):
    l = np.clip(np.asarray(l, np.float32), 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(l, 1 / 2.4) - 0.055).astype(np.float32)


def luma(im_bgr):
    """Rec.709 luminance of the linearised codes (float32, 0..1)."""
    lin = srgb_to_lin(im_bgr)
    return 0.0722 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.2126 * lin[..., 2]


def tf(H, pts):
    pts = np.asarray(pts, np.float64).reshape(-1, 2)
    q = np.c_[pts, np.ones(len(pts))] @ np.asarray(H, np.float64).T
    return q[:, :2] / q[:, 2:3]


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1)
        f.write('\n')
