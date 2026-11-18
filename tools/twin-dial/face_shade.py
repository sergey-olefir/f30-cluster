"""Reference decode of a baked Twin Dial face (package R2-A2, rewritten for 0.1.1 by B1): what the `tdial` shader does with the
R8 face, in numpy. Not a command; imported by compare_face.py, test_bake.py and test_shader.py (which checks the GPU shader
against it).

    shade(face_u8, regions, redline_rpm=6500, band_gain=1.0, bar_fills=None) -> uint8 (h, w, 3)

The decode (shared/shaders.js TDIAL, day, no needle, no markers; the regions JSON's "decode" says the same in words):

1. g = byte / 255 is the neutral sRGB code of the pixel, L = its linear light. rho, theta are the pixel centre's polar
   coordinates about the dial centre (theta degrees clockwise from 12 o'clock, rho in R).
2. MATERIAL. ink = max(smoothstep(0.70, 0.85, g), rho >= 0.975, red x smoothstep(0.50, 0.70, g)) (the bezel is all ink, so the red arc keeps its antialiased
   edge red); band = smoothstep(0.572, 0.580, rho) (1 - smoothstep(0.940, 0.948, rho)) for |theta| <= 144; strip =
   smoothstep(0.889, 0.896, rho) (...); line = the strip's bright line, rho 0.9225-0.9355.
3. TINT, linear light: the band's tint (0.76, 1, 1.064), the strip's own (its sRGB colour over its G), the line's own;
   bandGain scales band and strip. rgb = L x mix(background, ink colour, ink).
4. RED (tachometer, from the redline): ticks red from theta(redline) - 0.6, numerals red from theta(ceil(redline / 1000)) -
   half a step, the bezel ink red (210, 20, 21; black floor out) from theta(redline) to 143.6 (SPEC-R3 2.5). No wedge.
5. BAR FILLS: segment rectangles from regions.bar, white fill from the left, partial last; reserve / hot segment red.
"""
import math

import numpy as np

FLOOR = (0.0012, 0.0009, 0.0056)


def lin(c):
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, np.power((c + 0.055) / 1.055, 2.4))


def enc(l):
    l = np.clip(l, 0.0, 1.0)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(l, 1 / 2.4) - 0.055)


def lin_floor(rgb):
    return np.array([max(0.0, (float(lin(c / 255.0)) - FLOOR[i]) / (1 - FLOOR[i])) for i, c in enumerate(rgb)])


def tint_of(rgb):
    l = lin(np.array(rgb, np.float64) / 255.0)
    return l / l[1]


RED = lin(np.array([218, 13, 43]) / 255.0)
RARC = lin_floor((210, 20, 21))
TINT = np.array([0.76, 1.0, 1.064])
STINT, LTINT = tint_of((98, 109, 111)), tint_of((115, 124, 126))
ARC_END = 143.6


def _smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def tach_angle(k, sweep=125.0):
    return -sweep + 2 * sweep * k / 8.0


def _polar(h, w, cx, cy):
    ys, xs = np.mgrid[0:h, 0:w]
    X, Y = xs + 0.5 - cx, ys + 0.5 - cy
    return np.hypot(X, Y), np.degrees(np.arctan2(X, -Y))


def shade(face, reg, redline_rpm=6500.0, band_gain=1.0, bar_fills=None):
    h, w = face.shape
    cx, cy = reg['centre_face_px']
    R = reg['R_px']
    g = face.astype(np.float64) / 255.0
    L = lin(g)
    rd, th = _polar(h, w, cx, cy)
    rho = rd / R
    ath = np.abs(th)
    ang = 1.0 - _smooth(144.0, 145.5, ath)
    band = _smooth(0.572, 0.580, rho) * (1.0 - _smooth(0.940, 0.948, rho)) * ang
    strip = _smooth(0.889, 0.896, rho) * (1.0 - _smooth(0.940, 0.948, rho)) * ang
    ln = _smooth(0.9225, 0.9245, rho) * (1.0 - _smooth(0.9335, 0.9355, rho))
    tn = TINT[None, None, :] * (1 - strip[..., None]) + (STINT[None, None, :] * (1 - ln[..., None]) + LTINT[None, None, :] * ln[..., None]) * strip[..., None]
    bg = (1 - band[..., None]) + tn * band[..., None]
    bg = bg * (1 + (band_gain - 1) * band)[..., None]
    inkc = np.ones((h, w, 3))
    red = np.zeros((h, w))
    if 'red_arc' in reg:
        a_tick = tach_angle(redline_rpm / 1000.0) - 0.6
        a_num = tach_angle(math.ceil(redline_rpm / 1000.0)) - 15.625
        a_arc = tach_angle(redline_rpm / 1000.0)
        red = np.maximum((th >= a_num) * ang * (rho >= 0.575) * (rho < 0.893), (th >= a_tick) * strip)
        arc = (rho >= 0.975) * np.clip((th - a_arc) * rd * 0.0174533 + 0.5, 0, 1) * (th <= ARC_END)
        inkc = inkc * (1 - red[..., None]) + RED[None, None, :] * red[..., None]
        inkc = inkc * (1 - arc[..., None]) + RARC[None, None, :] * arc[..., None]
    ink = np.maximum(_smooth(0.70, 0.85, g), np.maximum((rho >= 0.975).astype(np.float64), red * _smooth(0.50, 0.70, g)))
    col = L[..., None] * (bg * (1 - ink[..., None]) + inkc * ink[..., None])
    if bar_fills:
        bar = reg['bar']
        segs = bar['segment_rects_face_px']
        xs = np.arange(w)[None, :] + 0.5
        ys = np.arange(h)[:, None] + 0.5
        for i, (xa, ya, xb, yb) in enumerate(segs):
            f = max(0.0, min(1.0, bar_fills['n'] - i))
            if f <= 0:
                continue
            x1 = xa + (xb - xa) * f
            c = RED if (bar_fills.get('red_first') and i == 0) or (bar_fills.get('red_last') and i == len(segs) - 1) else np.ones(3)
            cov_x = np.clip(np.minimum(xs + 0.5, x1) - np.maximum(xs - 0.5, xa), 0, 1)
            cov_y = np.clip(np.minimum(ys + 0.5, yb) - np.maximum(ys - 0.5, ya), 0, 1)
            m = (cov_x * cov_y)[..., None]
            col = col * (1 - m) + c[None, None, :] * m
    return np.clip(np.round(enc(col) * 255.0), 0, 255).astype(np.uint8)
