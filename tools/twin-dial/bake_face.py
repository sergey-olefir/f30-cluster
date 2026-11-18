#!/usr/bin/env python3
"""Twin Dial baked dial faces (package R2-A2, SPEC §4, §5, §13.3; re-baked for 0.1.1 by package B1 to SPEC-R3 §2).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/bake_face.py
        [--stretch 1.06] [--out DIR] [--no-record] [--preview DIR]

Writes apps/twin_dial/hud/scene/face_tacho.json, face_speedo.json (R8 scene textures, 616 x 560, the engine's scene
format) and face_tacho.regions.json, face_speedo.regions.json beside them (what the shader needs: region ranges, the
numerals, ticks, bar segments, the decode rules). Each face is drawn at 3x and reduced with LANCZOS, our own drawing
from the numbers of design/twin-dial/{vd,vg} and SPEC §4-§5 (the mockup, tools/twin-dial/mockup/mockup.py, draws the same
numbers; no reference image or photo is an input). Fonts: Saira (scale numerals, OFF) and Noto Sans (unit labels, bar ends).

What the face carries (one byte per pixel = the NEUTRAL sRGB code, i.e. the G channel of the picture):
  the grey scale band, look B (SPEC-R3 §2.2: Y = 0.0188 exp(4.60 (rho - 0.60)) exp(0.59 (1 - cos th)), rho 0.5795-0.9375, to
  143.0 deg), the numerals' outline and drop shadow (SD's measured model, SHADOW_MODEL, darkening the band in linear light),
  the tick strip (G code 109) with its bright outer line (G 124, rho 0.924-0.934), the near-black major lines (6, width
  0.010 R), minor and major ticks (255), the numerals (255), the bezel ring open at the bottom (255, to 143.6 deg), the thin
  inner rim (255, rho 0.544, width 0.008, to 143.55 deg), "OFF" (tachometer), the static hub labels (unit labels, 227 / 255;
  the tachometer's "1/хв x 1000" at +0.40 R), the five empty bar segments (47) with their end labels and the icon under the dial.
What it does NOT carry (the shader draws it from uniforms): the red arc on the bezel from the redline (SPEC-R3 §2.5), the red
recolouring of the ticks and numerals past it, the limit and cruise markers and the red tick strip (§8, §9), the bar fills, the
needle, READY, gear (the hub's centre stays free of ink: the gear is GPU text), drive program, the digital speed.
The colour is made by the shader from the region ranges in the regions JSON; tools/twin-dial/face_shade.py is the numpy
reference of that decode (the tint rule is documented there and in the regions JSON "decode"). Band tint (linear light,
applied by the shader on the neutral G code): 0.76 : 1 : 1.064 (TINT); the strip's own tint follows from its sRGB colour.

Geometry (panel px): the face of a dial is the rectangle [cx - 308, 90, cx + 308, 650]; the dial centre is at face px
(308, 310) = panel (cx, 400). R = 300 px.
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np                                     # noqa: E402
from PIL import Image, ImageDraw                       # noqa: E402

import _bakecommon as bc                               # noqa: E402

SS = 3
R = 300.0
FW, FH = 616, 560
CX, CY = 308.0, 310.0                                  # the dial centre in face px
RECT_Y0 = 90
CENTRES = {'tach': 380.0, 'speed': 1540.0}             # panel x of the centres (y 400)
NAMES = {'tach': 'face_tacho', 'speed': 'face_speedo'}
SWEEP = 125.0
# SPEC-R3 §2.1-§2.4 (SD dials_v2.json, K1 looks.json look_06)
BAND_RHO = (0.5795, 0.9375)                            # was 0.580-0.940
STRIP_RHO = (0.893, 0.9375)
BAND_ANG = 143.0                                       # the band's one radial cut (was 144.0)
BEZEL_HALF, BEZEL_ANG = 0.0105, 143.6                  # the bezel ends 0.6 deg past the band, cut square
BAND_LAW = (0.0188, 4.60, 0.59)                        # K1's fit on rectified 06: Y = k exp(a (rho - 0.60)) exp(b (1 - cos th)), linear light
TINT = (0.76, 1.0, 1.064)                              # linear light R : G : B, applied by the shader (was 0.96 : 1 : 1.08)
STRIP_RGB, LINE_RGB = (98, 109, 111), (115, 124, 126)  # sRGB: strip body and its bright outer line (SPEC-R3 §2.3)
LINE_RHO = (0.924, 0.934)
STRIP_CODE, LINE_CODE, FRAME_CODE, GREY_TEXT = STRIP_RGB[1], 6, 47, 227   # neutral (G) codes; LINE_CODE is the major lines'
STRIP_LINE_CODE = LINE_RGB[1]
MAJOR_W = 0.010                                        # major lines across the band, R (was 0.0075 in 0.1.0: 0.006 drawn)
NEEDLE = [(0.465, 0.030), (0.56, 0.039), (0.68, 0.032), (0.77, 0.022), (0.86, 0.020), (0.89, 0.016), (0.99, 0.004)]
TACH_REST = -135.0                                     # SPEC §4: "OFF" position
SPD_LARGE = (0, 20, 40, 60, 80, 100, 140, 180, 220, 260, 300)
SPD_SMALL = (10, 30, 50, 70, 160, 200, 240, 280)       # 90 and 120 dropped (SPEC §5.3)
SPD_LARGE_PX, SPD_SMALL_PX = 28, 18
SPD_LARGE_RHO, SPD_SMALL_RHO = 0.76, 0.78
TACH_PX, TACH_RHO = 57, 0.745
MIN_GAP = 4.0                                          # SPEC §5.3: px of black between a numeral and anything else
RIM_RHO, RIM_HALF, RIM_ANG = 0.544, 0.004, 143.55      # SPEC-R3 §2.1: thin (0.008), ends with the band and the bezel
UNIT_Y = 0.40                                          # the tachometer's "1/хв x 1000" (R, below the centre; was -0.04)
# The numerals' shadow (SPEC-R3 §2.4): the band is darkened in LINEAR light, D = 1 - Y / Y_band. 'SD' = SD's measured model
# (dials_v2.json numeral_shadow_06.model_for_drawing): a dark outline hugging the ink, 0.008 R wide at 0.75, and a soft drop
# shadow, the ink moved by (+0.010, +0.012) R, blurred sigma 0.008 R, 0.35. 'K1' = K1's by-eye model of picture 80 (no outline;
# (0.008, 0.020) R, sigma 0.009, 0.70). None: no shadow. One constant: the owner's choice after the mockup round is one word.
SHADOW_MODEL = 'SD'
SHADOW_MODELS = {
    'SD': {'outline': (0.008, 0.75), 'drop': (0.010, 0.012, 0.008, 0.35)},
    'K1': {'outline': None, 'drop': (0.008, 0.020, 0.009, 0.70)},
}
BAR = {'y': 0.73, 'x0': -0.42, 'x1': 0.42, 'half': 0.0125, 'segs': 5, 'gap': 4}


# ------------------------------------------------------------------------------------------------- scale laws
def spd_angle(v):
    return -SWEEP + 25.0 * (v / 20.0) if v <= 100 else 25.0 * (v - 100) / 40.0


def tach_angle(k):
    return -SWEEP + 2 * SWEEP * k / 8.0


def srgb(L):
    L = np.clip(L, 0, 1)
    return np.where(L <= 0.0031308, 12.92 * L, 1.055 * np.power(L, 1 / 2.4) - 0.055) * 255.0


def lin1(c):                                           # sRGB code -> linear light
    v = c / 255.0
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def tint_of(rgb):
    """The linear-light R : G : B ratios of an sRGB colour against its own G (what the shader multiplies the neutral G code by)."""
    g = lin1(rgb[1])
    return (lin1(rgb[0]) / g, 1.0, lin1(rgb[2]) / g)


def polar(a, r):                                       # face px of (angle deg cw from 12, radius px) about the centre
    t = math.radians(a)
    return (CX + r * math.sin(t), CY - r * math.cos(t))


def radial_pts(a, r0, r1, w):
    t = math.radians(a)
    ux, uy, nx, ny = math.sin(t), -math.cos(t), math.cos(t), math.sin(t)
    p0 = (CX + r0 * ux, CY + r0 * uy)
    p1 = (CX + r1 * ux, CY + r1 * uy)
    h = w / 2.0
    return [(p0[0] - h * nx, p0[1] - h * ny), (p1[0] - h * nx, p1[1] - h * ny),
            (p1[0] + h * nx, p1[1] + h * ny), (p0[0] + h * nx, p0[1] + h * ny)]


def sector_pts(r0, r1, a0, a1, step=0.5):
    n = max(2, int(abs(a1 - a0) / step))
    outer = [polar(a0 + (a1 - a0) * i / n, r1) for i in range(n + 1)]
    inner = [polar(a0 + (a1 - a0) * i / n, r0) for i in range(n, -1, -1)]
    return outer + inner


def needle_pts(a):
    t = math.radians(a)
    ux, uy, nx, ny = math.sin(t), -math.cos(t), math.cos(t), math.sin(t)
    left = [(CX + r * R * ux - w * R / 2 * nx, CY + r * R * uy - w * R / 2 * ny) for r, w in NEEDLE]
    right = [(CX + r * R * ux + w * R / 2 * nx, CY + r * R * uy + w * R / 2 * ny) for r, w in NEEDLE]
    return left + right[::-1]


# ---------------------------------------------------------------------------------------------------- canvas
class Face:
    def __init__(self, kind, stretch):
        self.kind, self.stretch = kind, stretch
        self.img = Image.new('L', (FW * SS, FH * SS), 0)
        self.d = ImageDraw.Draw(self.img)
        self.tick_img = Image.new('L', (FW * SS, FH * SS), 0)      # ticks alone, for the clearance check
        self.tick_d = ImageDraw.Draw(self.tick_img)
        self.labels = []                                           # numerals and the OFF label, for the check
        self.icons = []

    def P(self, pts):
        return [(x * SS, y * SS) for x, y in pts]

    def poly(self, pts, fill, ticks=False):
        self.d.polygon(self.P(pts), fill=fill)
        if ticks:
            self.tick_d.polygon(self.P(pts), fill=255)

    def band(self):
        """The grey band and the lighter tick strip, SPEC-R3 §2.2-§2.3, in the neutral (G) channel: look B, Y = k exp(a (rho - 0.60))
        exp(b (1 - cos th)) in linear light (BAND_LAW), the strip's body at G code 109 and its bright outer line at 124; the cool
        tint (0.76 : 1 : 1.064) and the strip's own tint are the shader's (face_shade.py)."""
        n = int(2 * R * SS)
        x0, y0 = int(round((CX - R) * SS)), int(round((CY - R) * SS))
        ys, xs = np.mgrid[0:n, 0:n]
        X, Y = (xs + 0.5) / SS - R, (ys + 0.5) / SS - R
        rr = np.hypot(X, Y) / R
        ang = np.degrees(np.arctan2(X, -Y))
        cosT = -Y / np.maximum(rr * R, 1e-6)
        k, la, lb = BAND_LAW
        y = k * np.exp(la * (rr - 0.60)) * np.exp(lb * (1.0 - cosT))
        code = srgb(y)
        code[(rr >= STRIP_RHO[0]) & (rr <= STRIP_RHO[1])] = STRIP_CODE
        code[(rr >= LINE_RHO[0]) & (rr <= LINE_RHO[1])] = STRIP_LINE_CODE
        m = (np.abs(ang) <= BAND_ANG) & (rr >= BAND_RHO[0]) & (rr <= BAND_RHO[1])
        self.img.paste(Image.fromarray(np.clip(np.round(code), 0, 255).astype(np.uint8)), (x0, y0),
                       Image.fromarray((m * 255).astype(np.uint8)))

    def numeral_ink(self, items):
        """The union of the numerals' ink at SS x as a float 0..1 array of the whole canvas (the same placement as ctext)."""
        full = Image.new('L', (FW * SS, FH * SS), 0)
        for xy, s, f, stretch in items:
            m = self.text_mask(s, f, stretch)
            x0 = int(round(xy[0] * SS - m.width / 2.0))
            y0 = int(round(xy[1] * SS - m.height / 2.0))
            full.paste(255, (x0, y0), m)
        return np.asarray(full, np.float64) / 255.0

    def shadow(self, ink, model):
        """SPEC-R3 §2.4: darken the band around and under the numerals in LINEAR light, Y' = Y (1 - D), only on the band proper
        (rho below the strip, inside the band's radii), never on ink. D = 1 - (1 - D_outline)(1 - D_drop)."""
        if not model:
            return
        from PIL import ImageFilter
        H, W = ink.shape
        D = np.zeros((H, W))
        ol = model.get('outline')
        if ol:
            r = ol[0] * R * SS                                     # px at SS x
            ri = int(math.ceil(r)) + 1
            yy, xx = np.mgrid[-ri:ri + 1, -ri:ri + 1]
            disk = (np.hypot(xx, yy) <= r).astype(np.float64)
            # the dilation of the ink by the disc: an FFT convolution, thresholded at half a px of overlap, then softened
            fh, fw = H + 2 * ri + 1, W + 2 * ri + 1
            conv = np.fft.irfft2(np.fft.rfft2(ink, (fh, fw)) * np.fft.rfft2(disk, (fh, fw)), (fh, fw))[ri:ri + H, ri:ri + W]
            dil = Image.fromarray(((conv >= 0.5) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.5 * SS))
            D = 1.0 - (1.0 - D) * (1.0 - ol[1] * np.asarray(dil, np.float64) / 255.0)
        dr = model.get('drop')
        if dr:
            dx, dy, sigma, strength = dr
            sh = np.roll(np.roll(ink, int(round(dy * R * SS)), axis=0), int(round(dx * R * SS)), axis=1)
            blur = Image.fromarray(np.clip(np.round(sh * 255), 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma * R * SS))
            D = 1.0 - (1.0 - D) * (1.0 - strength * np.asarray(blur, np.float64) / 255.0)
        a = np.asarray(self.img, np.float64)
        ys, xs = np.mgrid[0:H, 0:W]
        rr = np.hypot((xs + 0.5) / SS - CX, (ys + 0.5) / SS - CY) / R
        where = (rr >= BAND_RHO[0]) & (rr < STRIP_RHO[0]) & (ink < 0.5)
        lin = np.where(a / 255.0 <= 0.04045, a / 255.0 / 12.92, np.power((a / 255.0 + 0.055) / 1.055, 2.4))
        lin = lin * (1.0 - D)
        out = np.where(where, np.clip(np.round(srgb(lin)), 0, 255), a)
        self.img = Image.fromarray(out.astype(np.uint8))
        self.d = ImageDraw.Draw(self.img)
        self.shadow_stats = {'max_darkening': round(float(D[where].max()), 3), 'mean_darkening_where_dark': round(float(D[where][D[where] > 0.05].mean()), 3) if (D[where] > 0.05).any() else 0.0}

    def text_mask(self, s, f, stretch):
        """The ink of s as an 'L' mask at SS x, widened by stretch; its centre is the ink's centre."""
        l, t, r, b = f.getbbox(s, anchor='ls')
        m = Image.new('L', (r - l + 6, b - t + 6), 0)
        ImageDraw.Draw(m).text((3 - l, 3 - t), s, font=f, fill=255, anchor='ls')
        if stretch != 1.0:
            m = m.resize((int(round(m.width * stretch)), m.height), Image.LANCZOS)
        return m

    def ctext(self, xy, s, f, fill=255, stretch=1.0, label=None):
        """Ink centred on xy (face px, as the mockup's ctext). label: remember the ink for the clearance check."""
        m = self.text_mask(s, f, stretch)
        x0 = int(round(xy[0] * SS - m.width / 2.0))
        y0 = int(round(xy[1] * SS - m.height / 2.0))
        self.img.paste(fill, (x0, y0), m)
        if label is not None:
            self.labels.append(dict(label=label, text=s, xy=xy, x0=x0, y0=y0, mask=np.asarray(m) >= 128))

    def icon(self, name, size, cx_panel, cy_panel, panel_x0):
        self.icons.append((name, size, cx_panel, cy_panel, panel_x0))


def ink_box_est(xy, s, f, stretch):
    """The ink box as the mockup's check measures it (the font's own box), widened by the stretch: px."""
    l, t, r, b = f.getbbox(s, anchor='ls')
    w, h = (r - l) / SS * stretch, (b - t) / SS
    return (xy[0] - w / 2, xy[1] - h / 2, xy[0] + w / 2, xy[1] + h / 2)


def gap_boxes(a, b):
    dx = max(b[0] - a[2], a[0] - b[2])
    dy = max(b[1] - a[3], a[1] - b[3])
    return max(dx, dy)


def speed_numerals(stretch):
    """SPEC §5.3: the large set always draws; a small numeral draws only if its ink box keeps MIN_GAP px of black to every
    large one. Returns [(value, face px centre, size px, rho)] and the dropped ones."""
    big = [(v, polar(spd_angle(v), SPD_LARGE_RHO * R), SPD_LARGE_PX, SPD_LARGE_RHO) for v in SPD_LARGE]
    boxes = [ink_box_est(xy, str(v), bc.font('saira', px, SS), stretch) for v, xy, px, _ in big]
    out, dropped = list(big), []
    for v in SPD_SMALL:
        xy = polar(spd_angle(v), SPD_SMALL_RHO * R)
        g = min(gap_boxes(ink_box_est(xy, str(v), bc.font('saira', SPD_SMALL_PX, SS), stretch), b) for b in boxes)
        if g >= MIN_GAP:
            out.append((v, xy, SPD_SMALL_PX, SPD_SMALL_RHO))
        else:
            dropped.append((v, round(g, 2)))
    return out, dropped


def draw_face(kind, stretch):
    fc = Face(kind, stretch)
    panel_x0 = int(round(CENTRES[kind] - CX))
    fc.band()
    if kind == 'tach':
        majors = [(k, tach_angle(k)) for k in range(0, 9)]
        minors = [tach_angle(k + 0.5) for k in range(0, 8)]
    else:
        majors = [(v, spd_angle(v)) for v in SPD_LARGE]
        minors = [spd_angle(v) for v in list(range(5, 100, 5)) + list(range(110, 300, 10))
                  if v not in (20, 40, 60, 80, 100, 140, 180, 220, 260)]
    for _, a in majors:                                # the near-black line across the band at each major mark
        fc.poly(radial_pts(a, BAND_RHO[0] * R, STRIP_RHO[0] * R, MAJOR_W * R), LINE_CODE)
    dropped = []
    numerals = []
    items = []                                         # (centre, text, font, label) of every scale numeral, drawn after the ticks
    if kind == 'tach':
        for k in range(1, 9):
            items.append((polar(tach_angle(k), TACH_RHO * R), str(k), bc.font('saira', TACH_PX, SS), ('numeral', k, tach_angle(k))))
            numerals.append((k, tach_angle(k), TACH_RHO, TACH_PX))
    else:
        nums, dropped = speed_numerals(stretch)
        for v, xy, px, rho in nums:
            items.append((xy, str(v), bc.font('saira', px, SS), ('numeral', v, spd_angle(v))))
            numerals.append((v, spd_angle(v), rho, px))
    # the numerals' outline and drop shadow darken the band (linear light) before any ink is drawn
    fc.shadow(fc.numeral_ink([(xy, t, f, stretch) for xy, t, f, _ in items]), SHADOW_MODELS.get(SHADOW_MODEL))
    for a in minors:
        fc.poly(radial_pts(a, 0.896 * R, 0.934 * R, 0.012 * R), 255, ticks=True)
    for _, a in majors:
        fc.poly(radial_pts(a, 0.896 * R, 0.934 * R, 0.018 * R), 255, ticks=True)
    for xy, t, f, lab in items:
        fc.ctext(xy, t, f, stretch=stretch, label=lab)
    # the bezel ring, open at the bottom, and the inner disc's rim: all three rings end on one radial line (SPEC-R3 §2.1)
    fc.poly(sector_pts(R - BEZEL_HALF * R, R + BEZEL_HALF * R, -BEZEL_ANG, BEZEL_ANG), 255)
    fc.poly(sector_pts(RIM_RHO * R - RIM_HALF * R, RIM_RHO * R + RIM_HALF * R, -RIM_ANG, RIM_ANG), 255)
    # static hub labels (SPEC §5.1 / §5.2); READY, gear, program and the digital speed are dynamic and NOT baked
    if kind == 'speed':
        fc.ctext((CX, CY + 0.24 * R), 'км/год', bc.font('notosans', 21, SS), 255)
    else:
        fc.ctext((CX, CY + UNIT_Y * R), '1/хв × 1000', bc.font('notosans', 20, SS), GREY_TEXT)
        fc.ctext((CX - 0.56 * R, CY + 0.58 * R), 'OFF', bc.font('saira', 22, SS), 255, stretch=stretch, label=('label', 'OFF', None))
    # the bar under the dial: five empty segments (the fills are the shader's), end labels, the icon under the dial
    y = CY + BAR['y'] * R
    x0 = CX + BAR['x0'] * R
    # package B's engine contract (CONTRACT.md `bar`): segment i spans x0 + i (sw + gap) .. + sw, sw = (x1 - x0 - (segs - 1) gap) / segs
    # (the mockup pitched them (x1 - x0) / segs and ended 4 px short; the fills are drawn by the shader, so the frames follow it)
    sw = ((BAR['x1'] - BAR['x0']) * R - (BAR['segs'] - 1) * BAR['gap']) / BAR['segs']
    segs = []
    for i in range(BAR['segs']):
        xa, xb = x0 + i * (sw + BAR['gap']), x0 + i * (sw + BAR['gap']) + sw
        ya, yb = y - BAR['half'] * R, y + BAR['half'] * R
        fc.d.rectangle([xa * SS, ya * SS, xb * SS - 1, yb * SS - 1], fill=FRAME_CODE)
        segs.append([xa, ya, xb, yb])
    lo, hi = ('0', '1/1') if kind == 'tach' else ('C', 'H')
    fc.ctext((CX - 0.35 * R, CY + 0.68 * R), lo, bc.font('notosans', 21, SS), 255)
    fc.ctext((CX + 0.35 * R, CY + 0.68 * R), hi, bc.font('notosans', 21, SS), 255)
    fc.icon('td_fuel_side' if kind == 'tach' else 'cc_coolant', 32, CENTRES[kind], 400 + 0.645 * R, panel_x0)
    return fc, numerals, dropped, segs, panel_x0


def reduce_face(fc):
    out = fc.img.resize((FW, FH), Image.LANCZOS)
    for name, size, cxp, cyp, panel_x0 in fc.icons:
        path = os.path.join(bc.ICONS, '%s_%dx%d.png' % (name, size, size))
        a = Image.open(path).convert('RGBA').split()[3]
        out.paste(255, (int(round(cxp - a.size[0] / 2)) - panel_x0, int(round(cyp - a.size[1] / 2)) - RECT_Y0), a)
    return out


# ------------------------------------------------------------------------------------------ clearance check
def _boundary(m):
    e = m.copy()
    e[1:] &= m[:-1]
    e[:-1] &= m[1:]
    e[:, 1:] &= m[:, :-1]
    e[:, :-1] &= m[:, 1:]
    return m & ~e


def _pts(mask, x0, y0):
    ys, xs = np.nonzero(_boundary(mask))
    return np.stack([xs + x0, ys + y0], 1).astype(np.float64)


def min_gap_px(a, b):
    """Smallest distance between two boundary point sets (3x px) in panel px, less the pixel's own width."""
    if not len(a) or not len(b):
        return float('inf')
    best = float('inf')
    for i in range(0, len(a), 256):
        d = np.hypot(a[i:i + 256, None, 0] - b[None, :, 0], a[i:i + 256, None, 1] - b[None, :, 1])
        best = min(best, float(d.min()))
    return max(0.0, (best - 1.0) / SS)


def clearance(fc):
    """SPEC §5.3: every numeral's ink keeps >= MIN_GAP px of black to every other numeral, every tick and the needle's rest
    position (a numeral the needle points at, at rest, is covered by design: reported, not counted)."""
    rest = spd_angle(0) if fc.kind == 'speed' else TACH_REST
    nimg = Image.new('L', (FW * SS, FH * SS), 0)
    ImageDraw.Draw(nimg).polygon(fc.P(needle_pts(rest)), fill=255)
    needle_m, tick_m = np.asarray(nimg) >= 128, np.asarray(fc.tick_img) >= 128
    res = {'min_numeral_numeral': float('inf'), 'min_numeral_tick': float('inf'), 'min_numeral_needle_rest': float('inf'),
           'by_design_covered_by_the_needle_at_rest': []}
    items = []
    for lb in fc.labels:
        p = _pts(lb['mask'], lb['x0'], lb['y0'])
        items.append((lb, p))
    full = lambda m: _pts(m, 0, 0)                      # noqa: E731
    tick_p, needle_p = full(tick_m), full(needle_m)
    worst = []
    for i, (la, pa) in enumerate(items):
        if la['label'][0] != 'numeral':
            continue                                    # OFF is covered by the needle at rest by design; its gaps below
        for lb, pb in items[i + 1:]:
            g = min_gap_px(pa, pb)
            res['min_numeral_numeral'] = min(res['min_numeral_numeral'], g)
            if g < MIN_GAP:
                worst.append(('numeral', la['text'], lb['text'], round(g, 2)))
        g = min_gap_px(pa, tick_p)
        res['min_numeral_tick'] = min(res['min_numeral_tick'], g)
        if g < MIN_GAP:
            worst.append(('tick', la['text'], '', round(g, 2)))
        ang = la['label'][2]
        if abs(ang - rest) < 4.0:
            res['by_design_covered_by_the_needle_at_rest'].append(la['text'])
        else:
            g = min_gap_px(pa, needle_p)
            res['min_numeral_needle_rest'] = min(res['min_numeral_needle_rest'], g)
            if g < MIN_GAP:
                worst.append(('needle rest', la['text'], '', round(g, 2)))
    for lb, pb in items:                                # the OFF label against the numerals, ticks (its needle overlap is by design)
        if lb['label'][0] == 'label':
            res['by_design_covered_by_the_needle_at_rest'].append(lb['text'])
            for lc, pc in items:
                if lc is not lb:
                    g = min_gap_px(pb, pc)
                    if g < MIN_GAP:
                        worst.append(('label', lb['text'], lc['text'], round(g, 2)))
            g = min_gap_px(pb, tick_p)
            if g < MIN_GAP:
                worst.append(('label', lb['text'], 'tick', round(g, 2)))
    for k in ('min_numeral_numeral', 'min_numeral_tick', 'min_numeral_needle_rest'):
        res[k] = None if res[k] == float('inf') else round(res[k], 2)
    res['violations'] = worst
    res['rule_px'] = MIN_GAP
    return res


# ----------------------------------------------------------------------------------------------- regions JSON
def regions(kind, fc, numerals, dropped, segs, panel_x0, stretch, clear):
    ys, xs = np.mgrid[0:FH, 0:FW]
    rho_all = np.hypot(xs + 0.5 - CX, ys + 0.5 - CY) / R
    nums = []
    n_lo, n_hi = 9.0, 0.0
    for lb in fc.labels:
        if lb['label'][0] != 'numeral':
            continue
        m = lb['mask']
        yy, xx = np.nonzero(m)
        fx, fy = (xx + lb['x0']) / SS, (yy + lb['y0']) / SS
        rr = np.hypot(fx - CX, fy - CY) / R
        n_lo, n_hi = min(n_lo, float(rr.min())), max(n_hi, float(rr.max()))
        val, ang = lb['label'][1], lb['label'][2]
        nums.append({'value': val, 'theta_deg': round(ang, 4), 'centre_px': [round(lb['xy'][0], 3), round(lb['xy'][1], 3)],
                     'ink_box_px': [round(float(fx.min()), 2), round(float(fy.min()), 2), round(float(fx.max()) + 1 / SS, 2),
                                    round(float(fy.max()) + 1 / SS, 2)]})
    ticks = []
    if kind == 'tach':
        for k in range(0, 17):
            ticks.append({'value_rpm': k * 500, 'theta_deg': round(tach_angle(k / 2.0), 4), 'kind': 'major' if k % 2 == 0 else 'minor'})
    else:
        majors = set(SPD_LARGE)
        for v in sorted(majors | set(range(5, 100, 5)) | set(range(110, 300, 10))):
            ticks.append({'value_kmh': v, 'theta_deg': round(spd_angle(v), 4), 'kind': 'major' if v in majors else 'minor'})
    y_bar = CY + BAR['y'] * R
    d = {
        '_about': 'package R2-A2: what the tdial shader needs to colour and animate %s (tools/twin-dial/bake_face.py). '
                  'theta = degrees clockwise from 12 o\'clock = atan2(dx, -dy) of the pixel centre about the dial centre; '
                  'rho = distance / R. Panel px = face px + rect_panel[0:2].' % NAMES[kind],
        'face': NAMES[kind], 'format': 'r8', 'w': FW, 'h': FH, 'R_px': R,
        'rect_panel': [panel_x0, RECT_Y0, panel_x0 + FW, RECT_Y0 + FH],
        'centre_face_px': [CX, CY], 'centre_panel_px': [CENTRES[kind], 400.0],
        'stretch_saira': stretch,
        'encoding': {
            'byte': 'the neutral sRGB code (the G channel of the picture) / 255; 0 = black',
            'band_strip_code': STRIP_CODE, 'major_line_code': LINE_CODE, 'bar_frame_code': FRAME_CODE, 'hub_text_grey_code': GREY_TEXT,
            'ink_code': 255, 'note': 'ticks, numerals, bezel, rim, OFF, end labels, icon: 255 (their antialiased edges blend with the band)'},
        'regions': {
            'band': {'rho': list(BAND_RHO), 'theta_abs_max_deg': BAND_ANG, 'tint_linear': list(TINT), 'tint_fade_g': [0.70, 0.80],
                     'law': {'k': BAND_LAW[0], 'a': BAND_LAW[1], 'b': BAND_LAW[2], 'what': 'Y = k exp(a (rho - 0.60)) exp(b (1 - cos theta)), linear light, the G channel (look B)'},
                     'what': 'the grey scale band (ticks strip included). Only here the tint is applied.'},
            'strip': {'rho': list(STRIP_RHO), 'code': STRIP_CODE, 'srgb': list(STRIP_RGB), 'tint_linear': [round(v, 4) for v in tint_of(STRIP_RGB)],
                      'what': 'the tick strip, constant G code inside band.theta_abs_max; its own tint (the strip is not the band\'s)'},
            'strip_line': {'rho': list(LINE_RHO), 'code': STRIP_LINE_CODE, 'srgb': list(LINE_RGB), 'tint_linear': [round(v, 4) for v in tint_of(LINE_RGB)],
                           'what': 'the bright line at the strip\'s outer edge (+45 % over the strip in linear light)'},
            'major_lines': {'rho': [BAND_RHO[0], STRIP_RHO[0]], 'width_R': MAJOR_W, 'code': LINE_CODE, 'what': 'near-black lines across the band at each major mark'},
            'ink_numerals': {'rho': [round(n_lo, 4), round(n_hi, 4)], 'what': 'every numeral ink pixel lies in this radius range'},
            'ink_ticks': {'rho': [0.896, 0.934], 'what': 'ticks (the strip is 0.893-0.9375)'},
            'bezel': {'rho': [1.0 - BEZEL_HALF, 1.0 + BEZEL_HALF], 'theta_abs_max_deg': BEZEL_ANG, 'what': 'white ring, open at the bottom, cut square at 143.6 (the tachometer\'s red arc recolours it from the redline)'},
            'rim': {'rho': [RIM_RHO - RIM_HALF, RIM_RHO + RIM_HALF], 'theta_abs_max_deg': RIM_ANG,
                    'what': 'white inner rim, width 0.008 R, ends with the band and the bezel (SPEC-R3 §2.1)'},
        },
        'decode': {
            'band_tint': 'inside regions.band: c_k = max(0, (k_k)^(1/2.4) * (g + 0.055) - 0.055), k = tint_linear * bandGain, '
                         'per channel; w = 1 - smoothstep(0.70, 0.80, g); rgb = mix(vec3(g), c, w). Outside the band rgb = g. '
                         'On the strip the tint is regions.strip.tint_linear (and regions.strip_line.tint_linear on its bright line), '
                         'not the band\'s. Exact for sRGB(Y*k) while Y*k > 0.0031308 (everywhere in the band at bandGain >= 0.6).',
            'night': 'multiply in linear light on top (SPEC-R3 §6), per material class: region + luma class',
            'red_arc': 'tachometer: the bezel ink (rho >= 0.975) from theta(redline) to red_arc.to_deg is sRGB (210, 20, 21); the band stays grey',
            'ink_alpha': 'red numerals and ticks recolour ink only: the shader mixes the ink colour by the face byte (smoothstep(0.70, 0.85, g))',
        },
        'numeral_shadow': {'model': SHADOW_MODEL, 'params': SHADOW_MODELS.get(SHADOW_MODEL),
                           'stats': getattr(fc, 'shadow_stats', None),
                           'what': 'baked: the band\'s codes under and around each numeral are darkened in linear light, Y\' = Y (1 - D)'},
        'numerals': nums, 'ticks': ticks,
        'bar': {'y_px': round(y_bar, 3), 'x0_px': round(CX + BAR['x0'] * R, 3), 'x1_px': round(CX + BAR['x1'] * R, 3),
                'segments': BAR['segs'], 'gap_px': BAR['gap'], 'half_thickness_px': round(BAR['half'] * R, 3),
                'segment_rects_face_px': [[round(v, 3) for v in s] for s in segs], 'frame_code': FRAME_CODE,
                'what': 'frames of the 5 segments are baked (47); the shader fills them (white; first segment red on reserve; last red when hot)'},
        'icons': [{'name': n, 'size': s, 'centre_panel_px': [round(cx, 2), round(cy, 2)]} for n, s, cx, cy, _ in fc.icons],
        'baked_text': (['км/год (unit, Noto 21, code 255)', 'C', 'H'] if kind == 'speed'
                       else ['1/хв × 1000 (unit, Noto 20, code 227, centre (0, +%.2f) R)' % UNIT_Y, 'OFF (Saira 22)', '0', '1/1']),
        'not_baked': ['needle', 'red arc', 'limit and cruise markers', 'red tick strip', 'bar fills', 'READY', 'gear', 'drive program',
                      'digital speed', 'cruise readout'],
        'clearance': clear, 'dropped_small_numerals': [{'value': v, 'gap_px': g} for v, g in dropped],
    }
    if kind == 'tach':
        d['scale'] = {'law': '0..8 x 1000 rpm linear, 0 at -125 deg, 8 at +125 deg (31.25 deg per 1000)', 'sweep_deg': SWEEP,
                      'rest_deg': TACH_REST, 'rest_note': 'OFF position, engine not running'}
        d['red_arc'] = {'rho': [0.990, 1.010], 'from': 'redline rpm (setting)', 'to_deg': BEZEL_ANG, 'srgb': [210, 20, 21],
                        'what': 'drawn by the shader (u_red.x .. u_red.w) over the bezel ink; no wedge (SPEC-R3 §2.5)'}
        d['hub'] = {'gear': {'centre_R': [0.0, 0.0], 'cap_R': 0.222, 'what': 'GPU text; the face keeps the centre free of ink'},
                    'program': {'centre_R': [0.0, 0.209], 'cap_R': 0.058}, 'ready': {'centre_R': [0.0, -0.29]},
                    'unit': {'centre_R': [0.0, UNIT_Y], 'baked': True}}
        d['red_rules'] = {'ticks': 'red when theta >= theta(redline) - 0.45 deg (half the width of a tick), rho in regions.ink_ticks',
                          'numerals': 'a numeral is red when its value >= redline rounded up to 1000: red when theta >= '
                                      'theta(ceil(redline/1000) - 0.5), rho in regions.ink_numerals',
                          'limit': 'both only for theta <= 140 deg (scale end + 15, the ink of 8 reaches 131): the bar end label "1/1" and the icon lie at larger theta'}
    else:
        d['scale'] = {'law': '0 at -125 deg, 100 at 0, 300 at +125; 20 km/h per major to 100, 40 above (piecewise linear)',
                      'sweep_deg': SWEEP, 'rest_deg': spd_angle(0)}
    return d


# ------------------------------------------------------------------------------------------------------ main
def bake(kind, stretch, out_dir, record=True):
    fc, numerals, dropped, segs, panel_x0 = draw_face(kind, stretch)
    img = reduce_face(fc)
    data = np.asarray(img, dtype=np.uint8)
    clear = clearance(fc)
    reg = regions(kind, fc, numerals, dropped, segs, panel_x0, stretch, clear)
    name = NAMES[kind]
    entry = {'kind': 'face', 'face': kind, 'centre': [CX, CY], 'R': R, 'rect': reg['rect_panel'], 'regions': name + '.regions.json'}
    path = os.path.join(out_dir, name + '.json')
    sha = bc.r8_scene(path, FW, FH, data.tobytes(), 'bilinear', entry,
                      'package R2-A2 / B1: %s, drawn from SPEC-R3 numbers by tools/twin-dial/bake_face.py (Saira stretch %.2f, shadow %s); '
                      'region ranges in %s.regions.json' % (name, stretch, SHADOW_MODEL, name))
    with open(os.path.join(out_dir, name + '.regions.json'), 'w') as f:
        json.dump(reg, f, indent=1)
        f.write('\n')
    if record and os.path.abspath(out_dir) == os.path.abspath(bc.SCENE):
        bc.record(name, {'file': 'apps/twin_dial/hud/scene/' + name + '.json', 'regions': 'apps/twin_dial/hud/scene/' + name + '.regions.json',
                         'w': FW, 'h': FH, 'format': 'r8', 'sha256_r8': sha, 'stretch_saira': stretch, 'shadow_model': SHADOW_MODEL, 'fonts': bc.font_inputs(),
                         'inputs': ['docs/twin-dial/SPEC-R3.md §2 (the numbers; SD dials_v2.json and K1 looks.json are their evidence)', 'docs/twin-dial/SPEC.md §4, §5', 'design/twin-dial/vt/pictograms/baked/*.png',
                                    'tools/twin-dial/bake_face.py'],
                         'pixel_memory_MiB_counted_twice': round(FW * FH * 2 / 1048576.0, 3)})
    return img, data, reg, clear, dropped


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--stretch', type=float, default=1.06, help='Saira horizontal stretch (SPEC §9; 1.0 = the mockup)')
    ap.add_argument('--out', default=bc.SCENE, help="where to write (default apps/twin_dial/hud/scene)")
    ap.add_argument('--no-record', action='store_true', help='do not write bake/manifest/twin_dial.json')
    ap.add_argument('--preview', help='also write a PNG of each face here (git-ignored place)')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    bad = 0
    for kind in ('tach', 'speed'):
        img, data, reg, clear, dropped = bake(kind, a.stretch, a.out, not a.no_record)
        print('%s: %d x %d R8, %.3f MiB as an asset (counted twice); numerals %d, ticks %d' % (
            NAMES[kind], FW, FH, FW * FH * 2 / 1048576.0, len(reg['numerals']), len(reg['ticks'])))
        print('  clearance (rule >= %.0f px): numeral-numeral %s, numeral-tick %s, numeral-needle-rest %s; by design under the needle at rest: %s'
              % (MIN_GAP, clear['min_numeral_numeral'], clear['min_numeral_tick'], clear['min_numeral_needle_rest'],
                 ', '.join(clear['by_design_covered_by_the_needle_at_rest']) or '-'))
        if dropped:
            print('  small numerals dropped by the 4 px rule:', dropped)
        for v in clear['violations']:
            print('  CLEARANCE VIOLATION:', v)
            bad += 1
        if a.preview:
            os.makedirs(a.preview, exist_ok=True)
            img.save(os.path.join(a.preview, NAMES[kind] + '_s%.2f.png' % a.stretch))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
