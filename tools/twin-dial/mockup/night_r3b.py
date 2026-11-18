#!/usr/bin/env python3
"""KC (round 3b): the night versions of finished pictures (SPEC-R3 §6: SPEC rev 2 §7.2's multipliers on the new values).

A finished day picture is turned into its night version by one colour transform per material, in linear light, as the engine
does it with uniforms (no layer rebuilt): the material is found by REGION and COLOUR CLASS, not by re-drawing, so this is an
approximation of the engine at the edges of ink (antialiased pixels take the factor of their region and mix by their own colour):

    white ink (numerals, text, needle)          x 0.80        bezel and rim ring                          x 0.70
    ticks                                       x 0.75        rules (title rule, bottom rule)             x 0.70
    tick strip (and its bright line)            x 0.55        band: 0.60 inner / mid -> 0.55 outer -> 0.50 at the lit ends
    tab ramp (neutral part of the bar)          x 0.55        tab fills (saturated colour in the bar)     x 0.75
    red ink                                     x 0.85        green ink x 0.75        amber ink x 0.80        blue ink x 0.75
    BMW's own panel stand-in (70, 78, 90)       unchanged (it is BMW's, not ours)

The tab fills x 0.75 and amber x 0.80 are SPEC-R3 §6's additions; every night value is a hypothesis (no night reference of the
facelift exists; reference 12 is the classic generation).
"""
import math

import numpy as np

R = 300.0
CT, CS = (380.0, 400.0), (1540.0, 400.0)
H, W = 720, 1920


def to_lin(a):
    c = a / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(L):
    L = np.clip(L, 0, 1)
    return np.where(L <= 0.0031308, 12.92 * L, 1.055 * np.power(L, 1 / 2.4) - 0.055) * 255.0


def night(img):
    a = img.astype(np.float32)
    mx, mn = a.max(-1), a.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    ys, xs = np.mgrid[0:H, 0:W]
    px, py = xs + 0.5, ys + 0.5
    f = np.full((H, W), 0.80, np.float32)                       # neutral ink everywhere else
    # saturated colours by hue
    colour = sat > 0.45
    red = colour & (r > g * 2.6) & (r > b * 1.5)
    amber = colour & (r >= g) & (g >= b) & ~red & (g > 0.35 * r)
    green = colour & (g > r) & (g >= b)
    blue = colour & (b > r) & (b >= g * 0.9)
    f[red], f[amber], f[green], f[blue] = 0.85, 0.80, 0.75, 0.75
    f[colour & ~(red | amber | green | blue)] = 0.80
    # rules
    for (x0, x1, y0, y1) in ((739, 1181, 294, 298.5), (629, 1291, 610.5, 615.5)):
        m = (px >= x0) & (px <= x1) & (py >= y0) & (py <= y1) & ~colour
        f[m] = 0.70
    # the tab bar: ramp x 0.55 for the dark neutral part, fills x 0.75
    bar = (px >= 618) & (px <= 1302) & (py >= 127) & (py <= 173)
    f[bar & colour] = 0.75
    f[bar & ~colour & (mx < 150)] = 0.55
    f[bar & ~colour & (mx >= 150) & (mx < 215)] = 0.70          # the lit rule and light separators blend into the white
    # the dials
    for c in (CT, CS):
        X, Y = px - c[0], py - c[1]
        rho = np.hypot(X, Y) / R
        ang = np.degrees(np.arctan2(X, -Y))
        inner = np.abs(ang) <= 146
        light = mx >= 215
        # band (non-ink, grey): 0.60 -> 0.55 outward, 0.50 at the lit (lower) ends
        band = inner & (rho >= 0.5795) & (rho < 0.893) & ~colour & ~light
        fb = 0.60 - 0.05 * np.clip((rho - 0.6) / 0.29, 0, 1) - 0.05 * np.clip((np.abs(ang) - 100) / 43, 0, 1)
        f[band] = fb[band]
        strip = inner & (rho >= 0.893) & (rho <= 0.9395) & ~colour & ~light
        f[strip] = 0.55
        ticks = inner & (rho >= 0.893) & (rho <= 0.9395) & light
        f[ticks] = 0.75
        ring = (np.abs(rho - 1.0) <= 0.03) | (np.abs(rho - 0.544) <= 0.02)
        f[inner & ring & ~colour & light] = 0.70
        # white ink on the band (numerals, needle) keeps 0.80 (the default); dark bits of numerals' shadow follow the band
        mix = inner & (rho >= 0.5795) & (rho < 0.893) & ~colour & (mx >= 100) & (mx < 215)
        w = np.clip((mx - 100) / 115.0, 0, 1)
        f[mix] = (fb * (1 - w) + 0.80 * w)[mix]
    # BMW's panel stand-in stays as drawn
    stand = (np.abs(a - np.array([70, 78, 90])).max(-1) <= 6) & (px >= 690) & (px <= 1232) & (py >= 592) & (py <= 706)
    f[stand] = 1.0
    out = to_srgb(to_lin(a) * f[..., None])
    return np.clip(np.round(out), 0, 255).astype(np.uint8)
