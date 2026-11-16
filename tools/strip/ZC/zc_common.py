"""Package ZC: shared loading for the zone-C (x 600-1340, y 540-720) measurements.

Every image here is a 4x crop of the zone in CONTINUOUS panel coordinates (pixel i of the crop covers
[x0 + i/4, x0 + (i+1)/4)). Source, in order of preference:
    1. package R:  bake/work/strip/rect/<id>_strip_4x.png (7680 x 720, x 0-1920, y 540-720) once <id>.READY exists
    2. provisional: bake/work/strip/zone-c/reg/<id>_zone_4x.png from tools/strip/ZC/quickreg.py
`source(id)` says which one was used; every number derived from (2) is provisional.
Nothing here writes into the repository.
"""
import json
import os

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
WORK = os.path.join(ROOT, 'bake', 'work', 'strip')
ZX0, ZY0, ZX1, ZY1 = 600, 540, 1340, 720
N = 4


def source(pid):
    r = os.path.join(WORK, 'rect', '%s_strip_4x.png' % pid)
    if os.path.exists(os.path.join(WORK, 'rect', '%s.READY' % pid)) and os.path.exists(r):
        return 'R', r
    return 'provisional', os.path.join(WORK, 'zone-c', 'reg', '%s_zone_4x.png' % pid)


def srgb_to_lin(v):
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(v):
    v = np.clip(v, 0, None)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055)


def load(pid):
    """Linear-light RGB (float64, H x W x 3, RGB order) of the zone at 4x, and the source tag."""
    tag, path = source(pid)
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit('missing ' + path)
    if tag == 'R':
        im = im[:, ZX0 * N:ZX1 * N]
        meta = os.path.join(WORK, 'rect', 'photometry.json')
        scale = 65535.0 if im.dtype == np.uint16 else 255.0
        v = im[..., ::-1].astype(np.float64) / scale
        # R publishes 16-bit linear light (checked on 60: its values are the sRGB decode of the photo's);
        # photometry.json may override with 'strip_4x_encoding'
        enc = 'linear'
        if os.path.exists(meta):
            try:
                enc = json.load(open(meta)).get('strip_4x_encoding', 'srgb')
            except ValueError:
                pass
        rgb = v if enc == 'linear' else srgb_to_lin(v)
    else:
        rgb = srgb_to_lin(im[..., ::-1].astype(np.float64) / 255.0)
    return rgb, tag


def lum(rgb):
    return rgb @ np.array([0.2126, 0.7152, 0.0722])


def cut(a, x0, y0, x1, y1):
    """Panel box (continuous) -> slice of a zone 4x array."""
    return a[int(round((y0 - ZY0) * N)):int(round((y1 - ZY0) * N)), int(round((x0 - ZX0) * N)):int(round((x1 - ZX0) * N))]


def to_panel_x(i):
    return ZX0 + (i + 0.5) / N


def to_panel_y(j):
    return ZY0 + (j + 0.5) / N
