"""P2 measurement helpers: polar unwraps of the rectified C2 crops, radial / angular profiles.

Run from bake/src:  $PY -m C2.meas   (writes polar sheets + profiles to bake/work/C2/meas/)
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import geom  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
RECT = os.path.join(ROOT, "bake", "work", "rect")
OUT = os.path.join(ROOT, "bake", "work", "C2", "meas")
CX, CY = geom.G20["C2"]["c"]
R = geom.G20["C2"]["R"]


def load(base):
    meta = json.load(open(os.path.join(RECT, base + ".json")))
    rgb = cv2.imread(os.path.join(RECT, base + ".png"))[..., ::-1].astype(np.float32)
    bp = os.path.join(RECT, base + ".maskbits.png")
    bits = cv2.imread(bp, cv2.IMREAD_GRAYSCALE) if os.path.exists(bp) else np.zeros(rgb.shape[:2], np.uint8)
    return rgb, bits, meta["box"], int(meta.get("scale", 1))


def sample(img, box, k, r, ang, interp=cv2.INTER_LINEAR):
    """img in crop px; r (R units), ang (cw12 deg) arrays -> sampled values."""
    a = np.radians(ang)
    x = (CX + np.sin(a) * r * R - box[0]) * k - 0.5
    y = (CY - np.cos(a) * r * R - box[1]) * k - 0.5
    return cv2.remap(img, x.astype(np.float32), y.astype(np.float32), interp, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def unwrap(base, r0, r1, a0, a1, nr, na, bits_ok=31):
    rgb, bits, box, k = load(base)
    rr = np.linspace(r0, r1, nr)
    aa = np.linspace(a0, a1, na)
    A, Rr = np.meshgrid(aa, rr)
    pol = sample(rgb, box, k, Rr, A)
    pb = sample(bits.astype(np.float32), box, k, Rr, A, cv2.INTER_NEAREST).astype(np.uint8)
    return rr, aa, pol, pb


def luma(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for base, a0, a1 in [("05_comfort_tach-closeup.comfort.C2", -180, 180), ("17_physical-cluster_full.comfort.C2", -180, 180),
                         ("13_ticks_closeup.comfort.C2@4x", 64, 100)]:
        rr, aa, pol, pb = unwrap(base, 0.0 if "13" not in base else 0.6, 1.06, a0, a1, 800, 1440 if "13" not in base else 900)
        cv2.imwrite(os.path.join(OUT, f"polar_{base}.png"), np.clip(pol[..., ::-1], 0, 255).astype(np.uint8))
