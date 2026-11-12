"""Cleaning of the photo-fitted soft tables (polish package C, 2026-11-12): keep what the cluster draws, drop what the
camera and the cabin added.

The raw (s, d) tables of fit_soft.py are medians of photo pixels per bin. They carry, besides the cluster's own
surfaces:
  - the live pointers' glow (every photo shows the pointers at 0 or idle, which light the dials' lower part orange);
  - the camera's haze and flare: a neutral grey added round the bright frame and band (the glow tables' far rows);
  - dark halos round the numerals (the phone's sharpening) and other spots: isolated dark or tinted bins;
  - row-to-row stripes where neighbouring depth rows were filled independently along s.

Here a bin is rejected when it disagrees with a smooth robust trend along its curve, the region under the pointers'
glow (curve point below Y_POINTER) is dropped and continued from above (as the old fit did for its narrower zone),
the glow keeps only its red-orange component (a per-bin split into the glow's own hue plus a neutral grey, the grey
dropped), and the tables are filled and smoothed in 2-D (normalised convolution) instead of row by row.
"""
import numpy as np
from scipy.ndimage import gaussian_filter, median_filter

import lib

Y_POINTER = 415.0        # below this the stock pointers' glow lights the faces in every photo (fit_soft.ZONE_Y)


def nconv(T, m, sig):
    """Normalised convolution: Gaussian-weighted mean of the valid bins (m) of T (ns, nd, C); weight sum returned."""
    W = gaussian_filter(m.astype(np.float64), sig, mode="nearest")
    V = np.stack([gaussian_filter(np.where(m, T[..., c], 0.0), sig, mode="nearest") for c in range(T.shape[-1])], -1)
    return V / np.maximum(W, 1e-9)[..., None], W


def reject(T, m, sig=(4.0, 0.8), k=3.0, floor=5 / 255.0, iters=2):
    """Drop bins that differ from the smooth trend of their neighbours by more than k robust sigmas (or the floor)."""
    m = m.copy()
    for _ in range(iters):
        ref, _ = nconv(T, m, sig)
        r = np.abs(np.where(m[..., None], T, ref) - ref).max(-1)
        mad = 1.4826 * np.median(r[m]) if m.any() else 0.0
        m &= r <= max(k * mad, floor)
    return m


def fill_smooth(T, m, sig=(2.0, 1.0)):
    """Smooth the valid bins in 2-D, then fill the rest: along s (constant past the ends: the continuation of a
    region seen from one side), then along d; then a final light smoothing."""
    S, W = nconv(T, m, sig)
    S = np.where((W > 0.15)[..., None], S, np.nan)
    Tf, _ = lib.table_fill(S, smooth_s=sig[0], smooth_d=sig[1])
    return Tf


def curve_y(curve, s_edges):
    """y of the curve at each s bin's centre (speedo space: the same for both dials)."""
    sc = 0.5 * (np.asarray(s_edges[:-1]) + np.asarray(s_edges[1:]))
    S = lib.arclen(curve)
    return np.interp(sc, S, curve[:, 1])


def face(raws, ys, sig=(3.0, 1.0)):
    """A face table (wing or its bevel E) from the raw tables of both dials: the dials are mirror images and BMW
    draws them alike, so where both are seen their mean is taken (one side's lighting averages out)."""
    ok = []
    for R in raws:
        m = ~np.isnan(R[..., 0])
        m[ys > Y_POINTER] = False
        ok.append(reject(np.nan_to_num(R), m))
    A = np.zeros_like(np.nan_to_num(raws[0]))
    n = np.zeros(A.shape[:2])
    for R, m in zip(raws, ok):
        A += np.where(m[..., None], np.nan_to_num(R), 0)
        n += m
    m = n > 0
    A = A / np.maximum(n, 1)[..., None]
    return np.clip(fill_smooth(A, m, sig), 0, 1), float(m.mean())


def glow_hue(T, m, d_centres):
    """The glow's own colour (r = 1): median chromaticity of the strong bins just outside the band line."""
    sel = m & (T[..., 0] > 0.3) & (d_centres[None, :] > 1.5) & (d_centres[None, :] < 10)
    c = T[sel]
    return np.array([1.0, np.median(c[:, 1] / c[:, 0]), np.median(c[:, 2] / c[:, 0])])


def glow(raw, ys, d_edges, sig=(2.0, 1.0), d_core=2.0):
    """The band glow (added over black): rejected bins, the neutral haze removed outside the band line's core
    (|d| < d_core keeps the measured colour: the line itself). Unlike the faces, the region under the pointers is
    not continued from above: the band's glow is thin along the bottom (08, 09), and the fit's own pointer zone
    already masks the needles' surroundings; what orange is left there is mostly split off as haze."""
    T = np.nan_to_num(raw)
    m = ~np.isnan(raw[..., 0])
    m = reject(T, m)
    dc = 0.5 * (np.asarray(d_edges[:-1]) + np.asarray(d_edges[1:]))
    h = glow_hue(T, m, dc)
    Tf = fill_smooth(T, m, sig)
    # split each bin into a * h + n * (1, 1, 1) (least squares), keep a * h
    hc = h - h.mean()
    a = ((Tf - Tf.mean(-1, keepdims=True)) * hc).sum(-1) / (hc * hc).sum()
    split = np.maximum(a, 0)[..., None] * h
    w = np.clip((np.abs(dc) - d_core) / 1.5, 0, 1)[None, :, None]
    out = (1 - w) * Tf + w * np.minimum(split, Tf.max(-1, keepdims=True))
    return np.clip(out, 0, 1), {"hue": h.round(3).tolist(), "kept": float(m.mean())}


def lift(col, level, width=0.10):
    """How much of a colour is the cluster's own light rather than the photo's black level: 0 at the photo's
    background luminance, 1 from level + width (smoothstep). Multiply a soft surface's alpha by it so that what was
    the lit-up black in the photo goes to pure black."""
    L = np.asarray(col)[..., :3].mean(-1)
    t = np.clip((L - level) / width, 0, 1)
    return t * t * (3 - 2 * t)


def smooth_along(T, sig_s=3.0, med=7):
    """Median then Gaussian along s (axis 0) of a filled table: removes blocks a single side left in it."""
    T = median_filter(T, size=(med, 1, 1), mode="nearest")
    return gaussian_filter(T, (sig_s, 0, 0), mode="nearest")
