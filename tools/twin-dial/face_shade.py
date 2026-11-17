"""Reference decode of a baked Twin Dial face (package R2-A2): what the `tdial` shader does with the R8 face, in numpy.

Not a command; imported by compare_face.py and test_bake.py, and the thing package B's shader is checked against.

    shade(face_u8, regions, redline_rpm=6500, band_gain=1.0, bar_fills=None, rgb_out=True) -> uint8 (h, w, 3)

The decode (the regions JSON's "decode" says the same in words):

1. g = byte / 255 is the neutral sRGB code of the pixel. rho, theta are the pixel centre's polar coordinates about the dial
   centre (theta degrees clockwise from 12 o'clock, rho in R).
2. BAND TINT. Inside regions.band (rho 0.58-0.94, |theta| <= 144) the band and the strip are "slightly cool": the picture's
   R and B channels are the neutral colour scaled in LINEAR light by tint = (0.96, 1.0, 1.08) (VC) and by bandGain (a
   setting, 0.6-1.7, band and strip level). Because sRGB(k Y) = k^(1/2.4) (sRGB(Y) + 0.055) - 0.055 while k Y > 0.0031308,
   one multiply-add per channel does it exactly from the neutral code:  c = max(0, k^(1/2.4) (g + 0.055) - 0.055).
   White ink on the band (ticks, numerals, OFF) must stay white: weight w = 1 - smoothstep(0.70, 0.80, g) (the band's own
   codes stay under 0.68), rgb = mix(g, c, w). Outside the band rgb = g.
3. RED WEDGE (tachometer, from the `redline` uniform): coverage of rho 0.55-0.94, theta(redline) .. 125 deg is the dark
   red "outline" colour; its inset by 3 px radially and 0.9 deg at the radial edges is the fill colour. Inside the wedge the
   band is replaced, so only the face's ink survives: alpha = clamp((g - t0) / (1 - t0), 0, 1) with t0 = 0.54 in the tick
   radii (the strip is the constant 137/255, exact) and t0 = 0.52 in the numerals' radii (the band under them is
   0.30-0.50 there); ink colour white, red where the red rules hold:
   ticks red when theta >= theta(redline) - 0.45 (half the width of a tick in degrees; rho 0.896-0.934); numerals red when theta >= theta(ceil(redline/1000) - 0.5);
   both only up to theta 140 deg (the scale's end + 15, room for the ink of 8: the bar's end label "1/1" and the icon lie at larger theta).
4. BAR FILLS (shader): segment rectangles from regions.bar, white fill from the left, partial last; reserve / hot = first /
   last segment red.
Not here: the needle, night multipliers, READY, gear, program, digital speed.
"""
import math

import numpy as np

RED = (218, 16, 48)
WEDGE_FILL = (78, 2, 11)
SS = 4                                                  # sub-samples per axis for the wedge's edge coverage


def _smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def tach_angle(k, sweep=125.0):
    return -sweep + 2 * sweep * k / 8.0


def _polar(h, w, cx, cy, ox=0.5, oy=0.5):
    ys, xs = np.mgrid[0:h, 0:w]
    X, Y = xs + ox - cx, ys + oy - cy
    return np.hypot(X, Y), np.degrees(np.arctan2(X, -Y))


def wedge_coverage(h, w, cx, cy, R, a0, a1, r0=0.55, r1=0.94, inset_px=3.0, inset_deg=0.9):
    """(outline+fill coverage, fill coverage) by sub-sampling: the mockup's two sectors, antialiased."""
    out = np.zeros((h, w))
    fill = np.zeros((h, w))
    for sy in range(SS):
        for sx in range(SS):
            r, a = _polar(h, w, cx, cy, (sx + 0.5) / SS, (sy + 0.5) / SS)
            out += ((r >= r0 * R) & (r <= r1 * R) & (a >= a0) & (a <= a1))
            fill += ((r >= r0 * R + inset_px) & (r <= r1 * R - inset_px) & (a >= a0 + inset_deg) & (a <= a1 - inset_deg))
    return out / (SS * SS), fill / (SS * SS)


def shade(face, reg, redline_rpm=6500.0, band_gain=1.0, bar_fills=None):
    h, w = face.shape
    cx, cy = reg['centre_face_px']
    R = reg['R_px']
    g = face.astype(np.float64) / 255.0
    rho_px, theta = _polar(h, w, cx, cy)
    rho = rho_px / R
    b = reg['regions']['band']
    in_band = (rho >= b['rho'][0]) & (rho <= b['rho'][1]) & (np.abs(theta) <= b['theta_abs_max_deg'])
    k = np.array(b['tint_linear']) * band_gain
    lo, hi = b['tint_fade_g']
    wt = 1.0 - _smooth(lo, hi, g)
    rgb = np.repeat(g[..., None], 3, axis=2)
    c = np.maximum(0.0, np.power(k[None, None, :], 1 / 2.4) * (g[..., None] + 0.055) - 0.055)
    rgb = np.where(in_band[..., None], rgb + (c - rgb) * wt[..., None], rgb)
    rgb = rgb * 255.0
    if 'wedge' in reg:
        wd = reg['wedge']
        a0 = tach_angle(redline_rpm / 1000.0)
        cov, fill = wedge_coverage(h, w, cx, cy, R, a0, wd['to_deg'], wd['rho'][0], wd['rho'][1], wd['outline_px'], wd['edge_inset_deg'])
        col = np.array(RED, float)[None, None, :] * (cov - fill)[..., None] + np.array(WEDGE_FILL, float)[None, None, :] * fill[..., None]
        base = rgb * (1 - cov[..., None]) + col
        t_lo, t_hi = reg['regions']['ink_ticks']['rho']
        n_lo, n_hi = reg['regions']['ink_numerals']['rho']
        rm_lo, rm_hi = reg['regions']['rim']['rho']
        in_tick = (rho >= t_lo - 0.003) & (rho <= t_hi + 0.003)
        in_num = (rho >= n_lo - 0.003) & (rho <= n_hi + 0.003)
        in_rim = (rho >= rm_lo - 0.003) & (rho <= rm_hi + 0.003)
        t0 = np.where(in_tick, 0.54, reg['decode']['ink_alpha_t0_numerals'])
        # ink alpha only where ink can be (ticks, numerals, the rim at the wedge's foot); the band between has none
        alpha = (np.clip((g - t0) / (1 - t0), 0, 1) * (in_tick | in_num | in_rim))[..., None]
        on_scale = theta <= wd['to_deg'] + 15.0          # not the bar's end labels or the icon below the dial
        ink_red = (on_scale & ((in_tick & (theta >= a0 - 0.45)) | (in_num & (theta >= tach_angle(math.ceil(redline_rpm / 1000.0) - 0.5)))))[..., None]
        ink = np.where(ink_red, np.array(RED, float)[None, None, :], 255.0)
        in_wedge = (cov > 0)[..., None]
        # inside the wedge the baked band is gone: the face's ink over the wedge colours. Outside it only a red tick or
        # numeral is recoloured, over the band's colour at g = t0 (the under-colour the alpha rule assumes), which also
        # takes the white out of its antialiased edge
        under_t0 = np.maximum(0.0, np.power(np.array(b['tint_linear'], float)[None, None, :] * band_gain, 1 / 2.4) * (t0[..., None] + 0.055) - 0.055) * 255.0
        under_t0 = np.where(in_band[..., None], under_t0, t0[..., None] * 255.0)
        rgb = np.where(in_wedge, base * (1 - alpha) + ink * alpha,
                       np.where(ink_red & (alpha > 0), under_t0 * (1 - alpha) + ink * alpha, rgb))
    if bar_fills:
        bar = reg['bar']
        for i, (xa, ya, xb, yb) in enumerate(bar['segment_rects_face_px']):
            f = max(0.0, min(1.0, bar_fills['n'] - i))
            if f <= 0:
                continue
            x1 = xa + (xb - xa) * f
            col = np.array(RED if (bar_fills.get('red_first') and i == 0) or (bar_fills.get('red_last') and i == len(bar['segment_rects_face_px']) - 1)
                           else (255, 255, 255), float)
            xs = np.arange(w)[None, :] + 0.5
            ys = np.arange(h)[:, None] + 0.5
            cov_x = np.clip(np.minimum(xs + 0.5, x1) - np.maximum(xs - 0.5, xa), 0, 1)
            cov_y = np.clip(np.minimum(ys + 0.5, yb) - np.maximum(ys - 0.5, ya), 0, 1)
            m = (cov_x * cov_y)[..., None]
            rgb = rgb * (1 - m) + col[None, None, :] * m
    return np.clip(np.round(rgb), 0, 255).astype(np.uint8)
