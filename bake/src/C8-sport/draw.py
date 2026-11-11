"""Procedural drawing of the Sport parts at any geometry (our G20 panel or a reference's 6WB layout).

geo = {"C1": (cx, cy), "C2": (cx, cy), "R": R} in panel px. Every function returns (rgba float straight alpha,
x0, y0) for a box in panel px at `scale` file px per panel px (soft layers are rendered at 1x with 2x2 supersampling
and box-reduced, crisp ones supersampled 4x).
"""
import math
import numpy as np

import params as P


def _grid(w, h, x0, y0, ss):
    o = (np.arange(ss) + 0.5) / ss
    xs = x0 + (np.arange(w)[:, None] + o[None, :]).ravel()
    ys = y0 + (np.arange(h)[:, None] + o[None, :]).ravel()
    return np.meshgrid(xs, ys)


def _down(a, ss):
    if ss == 1:
        return a.astype(np.float32)
    h, w = a.shape[0] // ss, a.shape[1] // ss
    return a.reshape(h, ss, w, ss).mean(axis=(1, 3)).astype(np.float32)


def _rgba(color, alpha):
    out = np.empty(alpha.shape + (4,), np.float32)
    out[..., :3] = color
    out[..., 3] = np.clip(alpha, 0, 1)
    return out


def _half(img):
    from common import imageio
    return imageio.half_res(img).astype(np.float32)


def _ang(dx, dy):
    return np.degrees(np.arctan2(dx, -dy)) % 360.0


# ------------------------------------------------------------------------------------------------------------ band
def band_level(r, p=None):
    p = p or P.BAND
    fin = np.clip((r - p["r_in"]) / 0.012 + 0.5, 0, 1)
    ramp = p["a0"] + (p["a1"] - p["a0"]) * np.clip((r - p["r_in"]) / (p["r1"] - p["r_in"]), 0, 1)
    t = np.clip((r - p["rim0"]) / (p["rim1"] - p["rim0"]), 0, 1)
    t = t * t * (3 - 2 * t)
    return (ramp + (1 - ramp) * t) * fin


def band_box(geo, C, p=None):
    p = p or P.BAND
    cx, cy = geo[C]
    R = geo["R"]
    half = int(math.ceil(p["r_out"] * R)) + 2
    half += half % 2
    x0, y0 = int(math.floor(cx)) - half, int(math.floor(cy)) - half
    return x0, y0, 2 * half, 2 * half


def band(geo, C, scale=0.5, tint=None, p=None, ss=4):
    """The red band (glow kind): level(r) inside the sweep, crisp outer edge and radial ends."""
    p = p or P.BAND
    cx, cy = geo[C]
    R = geo["R"]
    x0, y0, w, h = band_box(geo, C, p)
    a0, span = p["speedo_sweep"] if C == "C1" else p["tacho_sweep"]
    X, Y = _grid(w, h, x0, y0, ss)
    dx, dy = (X - cx) / R, (Y - cy) / R
    r = np.hypot(dx, dy)
    inside = ((_ang(dx, dy) - a0) % 360.0) <= span
    alpha = band_level(r, p) * (r <= p["r_out"]) * inside
    img = _rgba(tint or P.TINT["default"], _down(alpha, ss))
    if scale == 0.5:
        img = _half(img)
    return img, x0, y0, w, h


def hairlines(geo, C, angles=None, p=None, ss=4):
    """The radial hairlines as a 1x black 'shadow' raster (for QC / preview; the theme draws them procedurally)."""
    p = p or P.HAIRLINES
    cx, cy = geo[C]
    R = geo["R"]
    x0, y0, w, h = band_box(geo, C)
    angles = angles if angles is not None else (p["speedo_angles"] if C == "C1" else p["tacho_angles"])
    X, Y = _grid(w, h, x0, y0, ss)
    dx, dy = X - cx, Y - cy
    r = np.hypot(dx, dy) / R
    hw = p["width_px_at_R335"] * R / 335.0 / 2.0
    cov = np.zeros_like(dx)
    for a in angles:
        t = math.radians(a)
        ux, uy = math.sin(t), -math.cos(t)
        along = dx * ux + dy * uy
        across = np.abs(-dx * uy + dy * ux)
        cov = np.maximum(cov, ((across <= hw) & (along > 0)).astype(np.float64))
    cov *= (r >= p["r0"]) & (r <= p["r1"])
    return _rgba((0.0, 0.0, 0.0), _down(cov, ss) * p["darkness"]), x0, y0, w, h


# ---------------------------------------------------------------------------------------------------------- bridge
def bridge_box(geo):
    (lx, ly), (rx, ry) = geo["C1"], geo["C2"]
    R = geo["R"]
    cy = 0.5 * (ly + ry)
    x0 = int(math.floor(lx + 0.86 * R)) & ~1
    x1 = int(math.ceil(rx - 0.86 * R))
    y0 = int(math.floor(cy - 0.56 * R)) & ~1
    y1 = int(math.ceil(cy + 0.60 * R))
    w, h = x1 - x0, y1 - y0
    w += w % 2
    h += h % 2
    return x0, y0, w, h


def bridge(geo, scale=0.5, tint=None, p=None, ss=2):
    """Horizontal glow (uniform in x between the bezels) + a faint collar along each bezel's inner side."""
    p = p or P.BRIDGE
    (lx, ly), (rx, ry) = geo["C1"], geo["C2"]
    R = geo["R"]
    cy = 0.5 * (ly + ry)
    x0, y0, w, h = bridge_box(geo)
    X, Y = _grid(w, h, x0, y0, ss)
    v = (Y - cy) / R
    g = np.exp(-((v - p["v_c"]) ** 2) / (2 * p["sigma"] ** 2))
    rl = np.hypot(X - lx, Y - ly) / R
    rr = np.hypot(X - rx, Y - ry) / R
    rn = np.minimum(rl, rr)
    vwin = np.clip((p["collar_v"] - np.abs(v)) / p["collar_v_soft"] + 0.5, 0, 1)
    collar = p["collar_amp"] * np.exp(-np.clip(rn - 1.0, 0, None) / p["collar_len"]) * vwin
    between = (X > lx) & (X < rx)
    clip = np.clip((rn - p["clip_r"]) * R + 0.5, 0, 1)
    alpha = np.clip(g + collar, 0, 1) * between * clip
    img = _rgba(tint or P.TINT["default"], _down(alpha, ss))
    if scale == 0.5:
        img = _half(img)
    return img, x0, y0, w, h


# ----------------------------------------------------------------------------------------------------------- wings
def wing_v(u, p=None):
    """|v| of the centreline (upper-left frame, R units) at u."""
    p = p or P.WING
    return p["vt"] - p["s"] * (u - 1.0) + p["m"] / 2 * (np.sqrt((u - p["uc"]) ** 2 + p["b"] ** 2) - (u - p["uc"]))


def wing_root_u(p=None):
    """u where the centreline crosses the bezel (r = 1)."""
    u = np.linspace(0.5, 1.0, 50001)
    r = np.hypot(u, wing_v(u, p))
    return float(u[np.argmin(np.abs(r - 1.0))])


def _interp(tab, u):
    us, vs = zip(*tab)
    return np.interp(u, us, vs, left=vs[0], right=0.0)


def wing_box(geo, C, part, p=None):
    p = p or P.WING
    cx, cy = geo[C]
    R = geo["R"]
    side = 1 if C == "C1" else -1
    sv = -1 if part == "upper" else 1
    u0 = wing_root_u(p) - 0.03
    us = np.array([u0, p["u_tip"] + 0.01])
    vs = np.array([wing_v(u0, p) + 0.04, wing_v(p["u_tip"], p) - 0.03])
    xs = cx + side * us * R
    ys = cy + R * (p["v0"] + sv * vs)
    x0, x1 = int(math.floor(min(xs))) - 2, int(math.ceil(max(xs))) + 2
    y0, y1 = int(math.floor(min(ys))) - 2, int(math.ceil(max(ys))) + 2
    return x0, y0, x1 - x0, y1 - y0


def wing(geo, C, part, color=None, p=None, ss=4):
    """One wing highlight (crisp, 1x): white stroke along the centreline, width and level tables along u, hidden
    inside the bezel (r < 1)."""
    p = p or P.WING
    cx, cy = geo[C]
    R = geo["R"]
    side = 1 if C == "C1" else -1
    sv = -1 if part == "upper" else 1
    x0, y0, w, h = wing_box(geo, C, part, p)
    X, Y = _grid(w, h, x0, y0, ss)
    u = side * (X - cx) / R
    v = sv * ((Y - cy) / R - p["v0"])          # |v| frame: upper wing -> positive v
    # dense polyline of the centreline, nearest point per pixel (small canvas: brute force in chunks)
    uc = np.linspace(wing_root_u(p) - 0.03, p["u_tip"], 600)
    vc = wing_v(uc, p)
    best_d = np.full(u.shape, 1e9)
    best_u = np.zeros(u.shape)
    for i in range(0, len(uc), 50):
        du = u[..., None] - uc[None, None, i:i + 50]
        dv = v[..., None] - vc[None, None, i:i + 50]
        d = np.hypot(du, dv)
        k = np.argmin(d, axis=-1)
        dm = np.take_along_axis(d, k[..., None], -1)[..., 0]
        upd = dm < best_d
        best_d = np.where(upd, dm, best_d)
        best_u = np.where(upd, uc[i:i + 50][k], best_u)
    wid = _interp(p["width"], best_u) * R / 335.0 / R      # full width in R units
    lev = _interp(p["level"], best_u)
    cov = np.clip((wid / 2 - best_d) * R + 0.5, 0, 1)
    cov *= (best_u < p["u_tip"])
    rr = np.hypot(u, v)
    cov *= np.clip((rr - 1.0) * R + 0.5, 0, 1)
    alpha = _down(cov * lev, ss)
    return _rgba(color or P.WHITE, alpha), x0, y0, w, h
