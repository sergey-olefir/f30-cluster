"""Supersampled coverage rasterisers in DIAL-R units, so every package draws the same way at any R.

All functions return float32 coverage (0..1) of shape (h, w) for a canvas of w x h panel px whose dial centre is at
(cx, cy) px (in canvas coordinates, pixel centres at +0.5) and dial radius R px. Shapes are given in R units and
angles in cw12 degrees (clockwise from 12 o'clock). `ss` = supersampling per axis (box filter); 4 is a good default.

    canvas(w, h, cx, cy, R, ss)        -> polar grid (r in R units, angle cw12) at ss x ss subsamples
    ring(...)                          annulus r0..r1, optional soft edges (feather in R units)
    arc(...)                           annulus restricted to an angular span
    wedge(...)                         a radial tick: trapezoid from r_in to r_out, half widths w_in/w_out in R units
    radial_profile(...)                any f(r) (vectorised, r in R units) -> value image (no supersampling needed)
"""
import numpy as np


def _grid(w, h, cx, cy, R, ss):
    o = (np.arange(ss) + 0.5) / ss
    xs = (np.arange(w)[:, None] + o[None, :]).ravel()          # w*ss sample x
    ys = (np.arange(h)[:, None] + o[None, :]).ravel()
    X, Y = np.meshgrid(xs, ys)
    dx, dy = (X - cx) / R, (Y - cy) / R
    return dx, dy


def _down(a, ss):
    h, w = a.shape[0] // ss, a.shape[1] // ss
    return a.reshape(h, ss, w, ss).mean(axis=(1, 3)).astype(np.float32)


def _angle_in(ang, a0, span):
    """ang, a0 cw12 degrees; span >= 0 degrees clockwise from a0."""
    return ((ang - a0) % 360.0) <= span


def ring(w, h, cx, cy, R, r0, r1, ss=4, feather=0.0):
    """Annulus between r0 and r1 (R units). feather > 0: linear soft edge of that width (R units) on both sides."""
    dx, dy = _grid(w, h, cx, cy, R, ss)
    r = np.hypot(dx, dy)
    if feather > 0:
        cov = np.clip((r - r0) / feather + 0.5, 0, 1) * np.clip((r1 - r) / feather + 0.5, 0, 1)
    else:
        cov = ((r >= r0) & (r <= r1)).astype(np.float64)
    return _down(cov, ss)


def arc(w, h, cx, cy, R, r0, r1, a0, span, ss=4):
    """Annulus r0..r1 limited to angles a0 .. a0+span (cw12 degrees)."""
    dx, dy = _grid(w, h, cx, cy, R, ss)
    r = np.hypot(dx, dy)
    ang = np.degrees(np.arctan2(dx, -dy)) % 360.0
    cov = ((r >= r0) & (r <= r1) & _angle_in(ang, a0, span)).astype(np.float64)
    return _down(cov, ss)


def wedge(w, h, cx, cy, R, ang, r_in, r_out, w_in, w_out, ss=4):
    """A radial tick at angle `ang` (cw12 deg): from r_in to r_out, half width w_in at r_in, w_out at r_out (R units)."""
    dx, dy = _grid(w, h, cx, cy, R, ss)
    a = np.radians(ang)
    tx, ty = np.sin(a), -np.cos(a)                       # along the tick (y down)
    along = dx * tx + dy * ty
    across = np.abs(dx * -ty + dy * tx)
    t = np.clip((along - r_in) / max(r_out - r_in, 1e-9), 0, 1)
    hw = w_in + (w_out - w_in) * t
    cov = ((along >= r_in) & (along <= r_out) & (across <= hw)).astype(np.float64)
    return _down(cov, ss)


def radial_profile(w, h, cx, cy, R, f):
    """Evaluate f(r) at pixel centres (r in R units). For soft (smooth) profiles; use ring() for hard edges."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    r = np.hypot((xx + 0.5 - cx) / R, (yy + 0.5 - cy) / R)
    return np.asarray(f(r), dtype=np.float32)


def polar(w, h, cx, cy, R):
    """(r in R units, angle cw12 deg) at pixel centres, for custom shading."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    dx, dy = (xx + 0.5 - cx) / R, (yy + 0.5 - cy) / R
    return np.hypot(dx, dy), np.degrees(np.arctan2(dx, -dy)) % 360.0
