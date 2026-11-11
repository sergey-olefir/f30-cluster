"""Polar unwrap of a rect crop (dial frame, C2 mirrored into the speedo's handedness). Measurement only."""
import json, os, sys
import cv2
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import geom  # noqa
RECT = os.path.join(os.path.dirname(__file__), "..", "..", "work", "rect")


def unwrap(base, a0, a1, r0, r1, da=0.05, dr=0.0015, suffix=".png"):
    p = os.path.join(RECT, base)
    meta = json.load(open(p + ".json")); k = int(meta.get("scale", 1)); box = meta["box"]; cl = meta["cluster"]
    c = geom.G20[cl]["c"]; R = geom.G20[cl]["R"]
    img = cv2.imread(p + suffix, cv2.IMREAD_UNCHANGED).astype(np.float32)
    A = np.arange(a0, a1, da); Rr = np.arange(r0, r1, dr)
    AA, RR = np.meshgrid(A, Rr)
    u = RR * np.sin(np.radians(AA)); v = -RR * np.cos(np.radians(AA))
    if cl == "C2":
        u = -u
    px = (c[0] + u * R - box[0]) * k - 0.5; py = (c[1] + v * R - box[1]) * k - 0.5
    out = cv2.remap(img, px.astype(np.float32), py.astype(np.float32), cv2.INTER_LINEAR, borderValue=0)
    return out, A, Rr
