"""Calibrate the stock pointer glow's gain (bench/g20/live/live.js PARAMS.glow) against the assembled simulation:
renders of 08 and 09 at glow gain 0 and 1 (tools/g20sim/shot.sh with ?g20glow=0|1, bench in the 08/09 states),
then per dial and photo the least-squares gain g in  photo - base = g * (glow1 - base)  over the pointer zone
(package B's zone mask, other elements and glare masked). The glow is additive ('lighter'), so this is linear
until the canvas clips.

  python tools/g20sim/calib_glow.py   (same uv command as tools/g20sim/qc.py)
"""
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(WT, "bake", "src", "G20", "structure"))
import lib            # noqa: E402
import fit_soft as fs  # noqa: E402

E = os.path.join(WT, "bake", "work", "g20sim", "E")


def load(p):
    return cv2.imread(p)[..., ::-1].astype(np.float64)


for photo in ("08", "09"):
    ref = lib.load_rect(photo).astype(np.float64) * 255
    g0, g1 = load(os.path.join(E, "glow_%s_0.png" % photo)), load(os.path.join(E, "glow_%s_1.png" % photo))
    zone, corridor = fs.zone_mask(photo, lib.load_rect(photo))
    bad = fs.element_mask(pad=4) | corridor | fs.glare_mask(photo) | fs.crisp_mask(lib.load_rect(photo))
    for dial, xs in (("speedo", slice(0, 960)), ("tacho", slice(960, 1920))):
        v = zone.copy()
        v[:, :] &= ~bad
        m = np.zeros_like(v)
        m[:, xs] = v[:, xs]
        G = (g1 - g0)[m].ravel()
        Y = (ref - g0)[m].ravel()
        g = float((G * Y).sum() / max(1e-9, (G * G).sum()))
        rms0 = float(np.sqrt(((ref - g0)[m] ** 2).mean()))
        rms1 = float(np.sqrt(((ref - g1)[m] ** 2).mean()))
        rmsg = float(np.sqrt(((ref - g0 - g * (g1 - g0))[m] ** 2).mean()))
        print("%s %-6s gain %.2f  rms: no glow %.1f, gain 1 %.1f, fitted %.1f  (%d px)" % (photo, dial, g, rms0, rms1, rmsg, m.sum()))
