"""Panel and dial frames (brief §5) and the dial-to-panel transforms.

Panel frame: 1920x720 px, origin top-left, y down.
Dial frame:  units of the dial radius R, origin at the dial centre, +x right, +y DOWN (same handedness as the
             panel, so a dial-frame point (u, v) sits at panel (cx + u*R, cy + v*R)).
Angles:      `cw12` = degrees clockwise from 12 o'clock (the theme's convention: u_start/u_sweep in shared/shaders.js);
             `math` = degrees counter-clockwise from +x with y UP (used for light directions: 135 = upper left).

R is the OUTER edge of the bezel ring (shared/shaders.js WBDIAL: R = half the layer size - 1, ring from R-ringW to R).
"""
import math
import numpy as np

PANEL_W, PANEL_H = 1920, 720

# current COMFORT geometry on the G20 (design/gen_6wb.py G20)
G20 = {
    "C1": {"name": "speedo", "c": (412.0, 380.0), "R": 335.0},
    "C2": {"name": "tacho", "c": (1508.0, 380.0), "R": 335.0},
    "C3": {"name": "fuel", "c": (80.0, 628.0), "R": 70.0},
    "C4": {"name": "oil", "c": (1840.0, 628.0), "R": 70.0},
}
WINDOW = {"x0": 720, "x1": 1200, "y0": 79, "y1": 688}       # centre window (C5), panel px
# the first geometry (design/gen_6wb.py OLD) still used by Sport/Eco Pro, and by reference/ours/ref_comfort_bench_1920x720.png
OLD = {
    "C1": {"c": (496.0, 360.0), "R": 290.0},
    "C2": {"c": (1424.0, 360.0), "R": 290.0},
    "C3": {"c": (103.0, 473.0), "R": 90.0},
    "C4": {"c": (1817.0, 473.0), "R": 90.0},
}

# radii of the current theme, fractions of R (brief §12)
RADII = {"inner_disc": 0.51, "inner_ring": 0.36, "floor_dy": 0.26, "groove_in": 0.80, "groove_out": 0.915,
         "tick_major_in": 0.82, "tick_half_in": 0.85, "tick_minor_in": 0.872, "tick_out": 0.905, "hub_ring": 0.135}
SPD_START, SPD_SWEEP = 230.0, 260.0                     # cw12 degrees
RPM_START, RPM_PER, RPM_OFF = 250.5, 32.1, 20.5


def crop_box(cluster, margin=1.04):
    """Integer panel box (x, y, w, h) a cluster's rectified crop covers, clipped to the panel.
    Dials: centre +- margin*R. C5 / C6: the window box (C6 is its bottom info-bar part, y >= 520)."""
    if cluster in G20:
        g = G20[cluster]
        r = g["R"] * margin
        x0, y0 = int(math.floor(g["c"][0] - r)), int(math.floor(g["c"][1] - r))
        x1, y1 = int(math.ceil(g["c"][0] + r)), int(math.ceil(g["c"][1] + r))
    elif cluster == "C5":
        x0, y0, x1, y1 = WINDOW["x0"] - 40, WINDOW["y0"] - 40, WINDOW["x1"] + 40, WINDOW["y1"] + 20
    elif cluster == "PANEL":
        x0, y0, x1, y1 = 0, 0, PANEL_W, PANEL_H
    else:
        raise KeyError(cluster)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(PANEL_W, x1), min(PANEL_H, y1)
    return x0, y0, x1 - x0, y1 - y0


def dial_to_panel(cluster, u, v):
    g = G20[cluster]
    return g["c"][0] + u * g["R"], g["c"][1] + v * g["R"]


def panel_to_dial(cluster, x, y):
    g = G20[cluster]
    return (x - g["c"][0]) / g["R"], (y - g["c"][1]) / g["R"]


def cw12_to_vec(deg):
    """Unit vector (x right, y down) for an angle clockwise from 12 o'clock."""
    a = math.radians(deg)
    return math.sin(a), -math.cos(a)


def dial_polar_grid(w, h, cx, cy, R):
    """For a w x h image whose dial centre sits at (cx, cy) px with radius R px: (r in R units, angle cw12 deg)."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    dx, dy = (xx + 0.5 - cx), (yy + 0.5 - cy)
    r = np.hypot(dx, dy) / R
    ang = (np.degrees(np.arctan2(dx, -dy)) + 360.0) % 360.0
    return r, ang
