#!/usr/bin/env python3
"""Twin Dial mockup: draws the round-1 specification (docs/twin-dial/SPEC.md) as pictures of the G20's 1920 x 720 panel.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/mockup.py

Writes bake/work/twin-dial/mockup/*.png (git-ignored). No photo is read: every shape comes from the numbers in
design/twin-dial/{vd,vf,vg,vc,vt}, every symbol from design/twin-dial/vt/pictograms, every text is invented.
It is a MOCKUP of the specification, not the app: the dial's alpha, glow and band level are as specified, not tuned on the car.
Drawn at 3x and shrunk; icons are pasted afterwards at their baked pixel size.

Round 3 (package K1): the dial drawing takes a Look (defaults = 0.1.0, so this script's own pictures stay byte-identical);
named looks are in design/twin-dial/r3/k1/looks.json, the round-3 dial variants and their contact sheet are drawn by
tools/twin-dial/mockup/dials_r3.py. To draw dials from another script (round 3's pages.py):
    sys.path.insert(0, <this folder>); import mockup
    cv = mockup.Canvas(); mockup.draw_dials(cv, mockup.look_named('r3_fixed')); ...; img = mockup.finish(cv)
"""
import json
import math
import os
import sys
from dataclasses import asdict, dataclass, fields, replace

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
OUT = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'mockup')
FONTS = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'refs', 'vt-fonts')
ICONS = os.path.join(ROOT, 'design', 'twin-dial', 'vt', 'pictograms', 'baked')
W, H, SS = 1920, 720, 3
R = 300.0                                   # VG rev 3
CT, CS = (380.0, 400.0), (1540.0, 400.0)    # tachometer, speedometer centres
SWEEP = 125.0                               # decision 1 (proposed)

WHITE, RED, WEDGE_FILL = (255, 255, 255), (218, 16, 48), (78, 2, 11)
STRIP, FEET, GREEN, GREY_CELL = (135, 137, 142), (95, 97, 101), (60, 155, 34), (111, 111, 111)
AMBER, TAB_RED, TAB_RULE, RULE = (240, 170, 10), (176, 10, 37), (237, 237, 237), (231, 231, 231)
_FONTS = {}


@dataclass(frozen=True)
class Look:
    """How a dial is drawn (round 3, package K1). The defaults ARE 0.1.0 (SPEC rev 2, the round-1 drawing of this file):
    render() / draw_dials() without a look draw exactly the pictures they drew before round 3, byte for byte.
    Lengths in R, angles in degrees clockwise from 12 o'clock, colours sRGB codes. Named looks: design/twin-dial/r3/k1/looks.json
    (load with look_named()); every value there carries its source."""
    name: str = 'today'
    # the scale band: Y = k exp(a (rho - 0.60)) exp(b (1 - cos th)) in linear light, times tint per channel
    band_rho: tuple = (0.580, 0.940)
    band_ang: float = 144.0
    band_law: tuple = (0.010, 7.5, 0.85)
    tint: tuple = (0.96, 1.0, 1.08)
    strip_rho: tuple = (0.893, 0.940)
    strip: tuple = STRIP
    strip_line: tuple = None              # (rho0, rho1, (r, g, b)): a brighter line at the strip's outer edge
    # the three rings: bezel (outer thin), band (thick), rim (inner thin)
    bezel_half: float = 0.0105
    bezel_ang: float = 144.0
    rim_rho: float = 0.545
    rim_half: float = 0.008
    rim_ang: float = 150.0
    # the red zone (tachometer)
    red_from: float = 6.5                 # x 1000 rpm: the redline setting
    red_to: float = None                  # deg where the zone ends; None = the scale's end, tach_angle(8) = 125 (0.1.0)
    red_style: str = 'wedge'              # 'wedge' (04 / 08), 'arc' (red bezel, 06), 'both'
    wedge_rho: tuple = (0.550, 0.940)
    red_rim: bool = False                 # 08: the inner rim is red inside the zone
    # numerals: a soft shadow under the scale numerals (06): (dx, dy, sigma) in R, strength 0..1 (darkening)
    num_shadow: tuple = None
    # the hub: gear 'low' (0.1.0, as 02) or 'centre' (gear in the hub's centre, the program under it: 06, 07, 11)
    gear_pos: str = 'low'
    # needle: the engine's shadow (shaders.js TDIAL: 0.05 R either side, 15 % darker, on the band only)
    needle_shadow: bool = False


LOOKS_JSON = os.path.join(ROOT, 'design', 'twin-dial', 'r3', 'k1', 'looks.json')


def look_from(d, base=None):
    """A Look from a dict (lists become tuples; keys starting with '_' are notes and ignored)."""
    names = {f.name for f in fields(Look)}
    kw = {}
    for k, v in d.items():
        if k.startswith('_') or k not in names:
            continue
        if isinstance(v, list):
            v = tuple(tuple(x) if isinstance(x, list) else x for x in v)
        kw[k] = v
    return replace(base or Look(), **kw)


def look_named(name, path=LOOKS_JSON):
    """A named look from looks.json; 'extends' chains to another named look (or to 'today', the defaults)."""
    looks = json.load(open(path))['looks']
    d = looks[name]
    base = Look() if d.get('extends', 'today') == 'today' else look_named(d['extends'], path)
    return look_from(dict(d, name=name), base)


def srgb(L):
    L = np.clip(L, 0, 1)
    return np.where(L <= 0.0031308, 12.92 * L, 1.055 * np.power(L, 1 / 2.4) - 0.055) * 255.0


def font(name, size, wght, wdth):
    key = (name, size, wght, wdth)
    if key not in _FONTS:
        f = ImageFont.truetype(os.path.join(FONTS, *name), int(round(size * SS)))
        try:
            vals = []
            for a in f.get_variation_axes():
                n = a['name'].decode() if isinstance(a['name'], bytes) else a['name']
                n = n.lower()
                vals.append(wdth if 'width' in n or n == 'wdth' else wght if 'weight' in n or n == 'wght' else a['default'])
            f.set_variation_by_axes(vals)
        except Exception as e:                       # a static build of the face: use it as it is
            print('font axes not set:', e)
        _FONTS[key] = f
    return _FONTS[key]


def saira(size):
    return font(('saira', 'Saira[wdth,wght].ttf'), size, 550, 125)


def noto(size):
    return font(('notosans', 'NotoSans[wdth,wght].ttf'), size, 500, 100)


def spd_angle(v):                                    # VD: 20 km/h per major to 100, 40 above, 25 deg per major
    return -SWEEP + 25.0 * (v / 20.0) if v <= 100 else 25.0 * (v - 100) / 40.0


def tach_angle(k):                                   # 0..8 x 1000 rpm over the same sweep
    return -SWEEP + 2 * SWEEP * k / 8.0


SPD_LARGE = (0, 20, 40, 60, 80, 100, 140, 180, 220, 260, 300)
SPD_SMALL = (10, 30, 50, 70, 160, 200, 240, 280)      # 90 and 120 dropped: they crowd 100 at the top
SPD_LARGE_PX, SPD_SMALL_PX = 28, 18                  # small: VT's own "160" (0.046 R), not VD's 0.054
SPD_LARGE_RHO, SPD_SMALL_RHO = 0.76, 0.78
SPD_MIN_GAP = 4.0                                    # panel px of black between two numerals' ink boxes (a check)


def _ink_box(xy, s, f):
    l, t, r, b = f.getbbox(s, anchor='ls')
    w, h = (r - l) / SS, (b - t) / SS
    return (xy[0] - w / 2, xy[1] - h / 2, xy[0] + w / 2, xy[1] + h / 2)


def _gap(a, b):                                      # black between two boxes (negative = overlap)
    dx = max(b[0] - a[2], a[0] - b[2])
    dy = max(b[1] - a[3], a[1] - b[3])
    return max(dx, dy)


def speedo_numerals(c, cv):
    """Owner (2026-11-17): 'thin the numerals out a little'. The large set always draws; a small numeral draws
    only if its ink box keeps SPD_MIN_GAP px of black to every large one (with 90 and 120 left out of the set, every
    one does). Returns (value, centre, font)."""
    big = [(v, cv.polar(c, spd_angle(v), SPD_LARGE_RHO * R), saira(SPD_LARGE_PX)) for v in SPD_LARGE]
    boxes = [_ink_box(xy, str(v), f) for v, xy, f in big]
    out = list(big)
    for v in SPD_SMALL:
        xy, f = cv.polar(c, spd_angle(v), SPD_SMALL_RHO * R), saira(SPD_SMALL_PX)
        g = min(_gap(_ink_box(xy, str(v), f), b) for b in boxes)
        if g >= SPD_MIN_GAP:
            out.append((v, xy, f))
        else:
            print(f'speedometer: small numeral {v} dropped (gap {g:.1f} px)')
    return out


def eight_extent(cv, c):
    """The tachometer's '8' ink box as (angle min, angle max, rho min, rho max) about the dial centre (deg, R): the check
    that the red zone holds the numeral wholly, and 08's 'just past the 8' end."""
    x0, y0, x1, y1 = _ink_box(cv.polar(c, tach_angle(8), 0.745 * R), '8', saira(57))
    pts = [(x, y) for x in (x0, x1) for y in (y0, y1)]
    ang = [math.degrees(math.atan2(x - c[0], -(y - c[1]))) for x, y in pts]
    rho = [math.hypot(x - c[0], y - c[1]) / R for x, y in pts]
    return min(ang), max(ang), min(rho), max(rho)


class Canvas:
    def __init__(self):
        self.img = Image.new('RGB', (W * SS, H * SS), (0, 0, 0))
        self.d = ImageDraw.Draw(self.img)
        self.icons = []

    def P(self, x, y):
        return (x * SS, y * SS)

    def polar(self, c, a, r):                        # a: degrees clockwise from 12 o'clock
        t = math.radians(a)
        return (c[0] + r * math.sin(t), c[1] - r * math.cos(t))

    def poly(self, pts, fill):
        self.d.polygon([self.P(*p) for p in pts], fill=fill)

    def rect(self, x0, y0, x1, y1, fill):
        self.d.rectangle([x0 * SS, y0 * SS, x1 * SS - 1, y1 * SS - 1], fill=fill)

    def sector(self, c, r0, r1, a0, a1, fill, step=0.5):
        n = max(2, int(abs(a1 - a0) / step))
        outer = [self.polar(c, a0 + (a1 - a0) * i / n, r1) for i in range(n + 1)]
        inner = [self.polar(c, a0 + (a1 - a0) * i / n, r0) for i in range(n, -1, -1)]
        self.poly(outer + inner, fill)

    def radial(self, c, a, r0, r1, w, fill):
        t = math.radians(a)
        ux, uy, nx, ny = math.sin(t), -math.cos(t), math.cos(t), math.sin(t)
        p0 = (c[0] + r0 * ux, c[1] + r0 * uy)
        p1 = (c[0] + r1 * ux, c[1] + r1 * uy)
        h = w / 2.0
        self.poly([(p0[0] - h * nx, p0[1] - h * ny), (p1[0] - h * nx, p1[1] - h * ny),
                   (p1[0] + h * nx, p1[1] + h * ny), (p0[0] + h * nx, p0[1] + h * ny)], fill)

    def ctext(self, xy, s, f, fill=WHITE):           # ink centred on xy
        l, t, r, b = f.getbbox(s, anchor='ls')
        self.d.text((xy[0] * SS - (l + r) / 2, xy[1] * SS - (t + b) / 2), s, font=f, fill=fill, anchor='ls')

    def btext(self, x, base, s, f, fill=WHITE, align='l'):
        self.d.text((x * SS, base * SS), s, font=f, fill=fill, anchor={'l': 'ls', 'r': 'rs', 'c': 'ms'}[align])

    def width(self, s, f):
        return f.getlength(s) / SS

    def icon(self, name, size, cx, cy, color=WHITE):
        self.icons.append((name, size, cx, cy, color))

    def band(self, c, look=None):
        """The grey scale band and the lighter tick strip, shaded as VC specifies (a two-way ramp, slightly cool).
        Round 3: the law, tint, radii and strip come from the look (defaults = 0.1.0)."""
        lk = look or Look()
        k, la, lb = lk.band_law
        n = int(2 * R * SS)
        x0, y0 = int(round((c[0] - R) * SS)), int(round((c[1] - R) * SS))
        ys, xs = np.mgrid[0:n, 0:n]
        X, Y = (xs + 0.5) / SS - R, (ys + 0.5) / SS - R
        rr = np.hypot(X, Y) / R
        ang = np.degrees(np.arctan2(X, -Y))
        cosT = -Y / np.maximum(rr * R, 1e-6)
        y = k * np.exp(la * (rr - 0.60)) * np.exp(-lb * (cosT - 1.0))
        rgb = np.stack([srgb(y * lk.tint[0]), srgb(y * lk.tint[1]), srgb(y * lk.tint[2])], axis=-1)
        strip = (rr >= lk.strip_rho[0]) & (rr <= lk.strip_rho[1])
        rgb[strip] = lk.strip
        if lk.strip_line:
            r0, r1, col = lk.strip_line
            rgb[(rr >= r0) & (rr <= r1)] = col
        m = (np.abs(ang) <= lk.band_ang) & (rr >= lk.band_rho[0]) & (rr <= lk.band_rho[1])
        patch = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
        self.img.paste(patch, (x0, y0), Image.fromarray((m * 255).astype(np.uint8)))

    def _darken(self, c, mask, strength, where=None):
        """Multiply the dial's square (2R about c) by 1 - strength * mask (mask: L image of that square, 0..255);
        `where` (bool array of the square, optional) limits it."""
        n = mask.size[0]
        x0, y0 = int(round((c[0] - R) * SS)), int(round((c[1] - R) * SS))
        box = (x0, y0, x0 + n, y0 + n)
        sq = np.asarray(self.img.crop(box)).astype(np.float32)
        f = 1.0 - strength * np.asarray(mask).astype(np.float32)[..., None] / 255.0
        if where is not None:
            f = np.where(where[..., None], f, 1.0)
        self.img.paste(Image.fromarray(np.clip(np.round(sq * f), 0, 255).astype(np.uint8)), box[:2])
        self.d = ImageDraw.Draw(self.img)

    def _square_rho(self):
        n = int(2 * R * SS)
        ys, xs = np.mgrid[0:n, 0:n]
        X, Y = (xs + 0.5) / SS - R, (ys + 0.5) / SS - R
        return np.hypot(X, Y) / R, n

    def numeral_shadow(self, c, items, look):
        """06's soft shadow under the scale numerals: their ink, moved by (dx, dy), blurred, darkens what is under it."""
        dx, dy, sigma, strength = look.num_shadow
        rr, n = self._square_rho()
        m = Image.new('L', (n, n), 0)
        md = ImageDraw.Draw(m)
        ox, oy = (c[0] - R) * SS, (c[1] - R) * SS
        for xy, s, f in items:
            l, t, r, b = f.getbbox(s, anchor='ls')
            md.text(((xy[0] + dx * R) * SS - ox - (l + r) / 2, (xy[1] + dy * R) * SS - oy - (t + b) / 2), s, font=f, fill=255, anchor='ls')
        m = m.filter(ImageFilter.GaussianBlur(sigma * R * SS))
        self._darken(c, m, strength, (rr >= look.band_rho[0]) & (rr <= look.band_rho[1]))

    def needle_shadow(self, c, a, prof, look):
        """The engine's needle shadow (TDIAL): the needle widened by 0.05 R either side, 15 % darker, on the band
        outside the strip, not on ink."""
        rr, n = self._square_rho()
        m = Image.new('L', (n, n), 0)
        md = ImageDraw.Draw(m)
        t = math.radians(a)
        ux, uy, nx, ny = math.sin(t), -math.cos(t), math.cos(t), math.sin(t)
        side = lambda sg: [((R + r * R * ux + sg * (w * R / 2 + 0.05 * R) * nx) * SS, (R + r * R * uy + sg * (w * R / 2 + 0.05 * R) * ny) * SS)
                           for r, w in prof]
        md.polygon(side(-1) + side(1)[::-1], fill=255)
        x0, y0 = int(round((c[0] - R) * SS)), int(round((c[1] - R) * SS))
        sq = np.asarray(self.img.crop((x0, y0, x0 + n, y0 + n))).astype(np.float32)
        ink = sq.max(-1) > 0.80 * 255
        where = (rr >= look.band_rho[0]) & (rr < look.strip_rho[0]) & ~ink
        self._darken(c, m, 0.15, where)

    def dial(self, c, kind, value, gear='D3', look=None, program='COMFORT'):
        lk = look or Look()
        self.band(c, lk)
        # no "feet": on references 02 and 04 the band simply ends in a radial cut and the black below is free
        if kind == 'tach':
            majors = [(k, tach_angle(k)) for k in range(0, 9)]
            minors = [tach_angle(k + 0.5) for k in range(0, 8)]
            red_a0 = tach_angle(lk.red_from)
            red_a1 = tach_angle(8.0) if lk.red_to is None else eight_extent(self, c)[1] + 2.0 if lk.red_to == 'past8' else lk.red_to
            red_num = math.ceil(lk.red_from - 1e-9)   # a numeral is red from the redline rounded up (engine: _twinDialSend)
        else:
            majors = [(v, spd_angle(v)) for v in (0, 20, 40, 60, 80, 100, 140, 180, 220, 260, 300)]
            minors = [spd_angle(v) for v in list(range(5, 100, 5)) + list(range(110, 300, 10))
                      if v not in (20, 40, 60, 80, 100, 140, 180, 220, 260)]
            red_a0 = red_a1 = None
        for _, a in majors:                          # the near-black line across the band at each major mark
            self.radial(c, a, lk.band_rho[0] * R, lk.strip_rho[0] * R, 0.006 * R, (6, 6, 8))
        wedge = kind == 'tach' and lk.red_style in ('wedge', 'both')
        if wedge:                                    # the red wedge: dark fill, bright outline (decision 3)
            self.sector(c, lk.wedge_rho[0] * R, lk.wedge_rho[1] * R, red_a0, red_a1, RED)
            self.sector(c, lk.wedge_rho[0] * R + 3, lk.wedge_rho[1] * R - 3, red_a0 + 0.9, red_a1 - 0.9, WEDGE_FILL)
        if kind == 'tach':
            nums = [(k, self.polar(c, tach_angle(k), 0.745 * R), saira(57)) for k in range(1, 9)]
        else:
            nums = speedo_numerals(c, self)
        if lk.num_shadow:
            self.numeral_shadow(c, [(xy, str(v), f) for v, xy, f in nums], lk)
        for a in minors:
            col = RED if red_a0 is not None and a >= red_a0 - 0.01 else WHITE
            self.radial(c, a, 0.896 * R, 0.934 * R, 0.012 * R, col)
        for v, a in majors:
            col = RED if red_a0 is not None and a >= tach_angle(red_num) - 0.01 else WHITE
            self.radial(c, a, 0.896 * R, 0.934 * R, 0.018 * R, col)
        if kind == 'tach':
            for k, xy, f in nums:
                self.ctext(xy, str(k), f, RED if k >= red_num else WHITE)
        else:
            for v, xy, f in nums:
                self.ctext(xy, str(v), f)
        # bezel ring (open at the bottom) and the inner disc's rim
        self.sector(c, R - lk.bezel_half * R, R + lk.bezel_half * R, -lk.bezel_ang, lk.bezel_ang, WHITE)
        self.sector(c, lk.rim_rho * R - lk.rim_half * R, lk.rim_rho * R + lk.rim_half * R, -lk.rim_ang, lk.rim_ang, WHITE)
        if kind == 'tach' and lk.red_style in ('arc', 'both'):      # 06: the bezel is red over the zone
            self.sector(c, R - lk.bezel_half * R, R + lk.bezel_half * R, red_a0, min(red_a1, lk.bezel_ang), RED)
        if kind == 'tach' and lk.red_rim:                          # 08: the rim is red over the zone
            self.sector(c, lk.rim_rho * R - lk.rim_half * R, lk.rim_rho * R + lk.rim_half * R, red_a0, min(red_a1, lk.rim_ang), RED)
        # needle: white, tapered, no cap
        a = spd_angle(value) if kind == 'speed' else tach_angle(value)
        prof = [(0.465, 0.030), (0.56, 0.039), (0.68, 0.032), (0.77, 0.022), (0.86, 0.020), (0.89, 0.016), (0.99, 0.004)]
        if lk.needle_shadow:
            self.needle_shadow(c, a, prof, lk)
        t = math.radians(a)
        ux, uy, nx, ny = math.sin(t), -math.cos(t), math.cos(t), math.sin(t)
        left = [(c[0] + r * R * ux - w * R / 2 * nx, c[1] + r * R * uy - w * R / 2 * ny) for r, w in prof]
        right = [(c[0] + r * R * ux + w * R / 2 * nx, c[1] + r * R * uy + w * R / 2 * ny) for r, w in prof]
        self.poly(left + right[::-1], WHITE)
        # hub content
        if kind == 'speed':
            self.ctext((c[0], c[1] + 0.03 * R), str(int(round(self.speed_digits))), saira(92))
            self.ctext((c[0], c[1] + 0.24 * R), 'км/год', noto(21))
        elif lk.gear_pos == 'centre':                # 06 / 07 / 11: the gear in the hub's centre, the program under it
            self.ctext((c[0], c[1] - 0.01 * R), gear, saira(92))
            self.ctext((c[0], c[1] + 0.20 * R), program, saira(22))
            self.ctext((c[0], c[1] - 0.29 * R), 'READY', saira(22), GREEN)
            self.ctext((c[0] - 0.56 * R, c[1] + 0.58 * R), 'OFF', saira(22))
            self.ctext((c[0], c[1] + 0.40 * R), '1/хв × 1000', noto(20), (227, 227, 227))
        else:
            self.ctext((c[0] - 0.02 * R, c[1] + 0.39 * R), gear, saira(64))
            self.ctext((c[0] + 0.02 * R, c[1] + 0.56 * R), program, saira(22))
            self.ctext((c[0], c[1] - 0.20 * R), 'READY', saira(22), GREEN)
            self.ctext((c[0] - 0.56 * R, c[1] + 0.58 * R), 'OFF', saira(22))
            self.ctext((c[0], c[1] - 0.04 * R), '1/хв × 1000', noto(20), (227, 227, 227))
        # the bar under the dial: fuel (left) / coolant (right), 5 segments
        fill_n = 3.2 if kind == 'tach' else 2.6
        y = c[1] + 0.73 * R
        x0, seg, gap = c[0] - 0.42 * R, 0.84 * R / 5, 4
        for i in range(5):
            xa, xb = x0 + i * seg, x0 + (i + 1) * seg - gap
            self.rect(xa, y - 0.0125 * R, xb, y + 0.0125 * R, (46, 47, 50))
            f = max(0.0, min(1.0, fill_n - i))
            if f > 0:
                self.rect(xa, y - 0.0125 * R, xa + (xb - xa) * f, y + 0.0125 * R, RED if (kind == 'tach' and i == 0 and fill_n < 1.0) else WHITE)   # red = reserve only (SPEC §5.1)
        lo, hi = ('0', '1/1') if kind == 'tach' else ('C', 'H')
        self.ctext((c[0] - 0.35 * R, c[1] + 0.68 * R), lo, noto(21))
        self.ctext((c[0] + 0.35 * R, c[1] + 0.68 * R), hi, noto(21))
        self.icon('td_fuel_side' if kind == 'tach' else 'cc_coolant', 32, c[0], c[1] + 0.645 * R)


def paste_icons(img, icons):
    for name, size, cx, cy, color in icons:
        path = os.path.join(ICONS, '%s_%dx%d.png' % (name, size, size))
        if not os.path.exists(path):
            continue
        a = Image.open(path).convert('RGBA').split()[3]
        solid = Image.new('RGBA', a.size, tuple(color) + (0,))
        solid.putalpha(a)
        img.paste(solid, (int(round(cx - a.size[0] / 2)), int(round(cy - a.size[1] / 2))), solid)


def tab_bar(cv, warn_color=None):
    x0, y0, x1, y1 = 618, 127, 1302, 172
    w, h = int((x1 - x0) * SS), int((y1 - y0) * SS)
    L = np.linspace(0.002, 0.16, h)[:, None] * np.ones((1, w))
    rgb = np.stack([srgb(L)] * 3, axis=-1)
    cv.img.paste(Image.fromarray(rgb.astype(np.uint8)), (x0 * SS, y0 * SS))
    seps = [744, 812, 1168, 1237]
    if warn_color:
        cv.rect(744, y0, 812, y1, warn_color)
    for sx in seps:
        cv.rect(sx, y0, sx + 1, y1, (0, 0, 0))
        cv.rect(sx + 1, y0, sx + 2, y1, (96, 96, 96))
    cv.rect(x0, 171.2, x1, 172.7, TAB_RULE)
    if warn_color:
        cv.rect(744, 171.2, 812, 172.7, warn_color)
    # tab contents
    cv.btext(654, 156, '412', noto(31), WHITE, 'l')
    cv.btext(654 + cv.width('412', noto(31)) + 3, 156, 'км', noto(19), WHITE, 'l')
    cv.icon('td_fuel', 38, 636, 143)
    cv.icon('cc_warn', 38, 778, 143)
    cv.icon('td_radio', 38, 905, 143)
    cv.btext(925, 156, 'Радіо FM 101.7', noto(33), WHITE, 'l')
    cv.icon('td_phone', 38, 1202, 143)
    cv.icon('td_nav', 38, 1270, 143)


def centre(cv, page):
    if page == 'clock':
        cv.ctext((960, 270), 'Дата і час', noto(41))
        cv.rect(741, 295.2, 1180, 296.7, RULE)
        cv.ctext((960, 372), '14:43', saira(92))
        cv.ctext((960, 450), 'вівторок', noto(39))
        cv.ctext((960, 505), '17.11.2026', noto(39))
    else:
        cv.ctext((960, 270), 'Поїздка', noto(41))
        cv.rect(741, 295.2, 1180, 296.7, RULE)
        for base, (n1, u1, n2, u2) in ((362, ('ø 6.8', 'л/100 км', 'ø 41', 'км/год')), (430, ('12.4', 'км', '0:43', 'год'))):
            cv.btext(905, base, n1, noto(39), WHITE, 'r')
            cv.btext(911, base, u1, noto(21), WHITE, 'l')
            cv.btext(1105, base, n2, noto(39), WHITE, 'r')
            cv.btext(1111, base, u2, noto(21), WHITE, 'l')
        cv.ctext((960, 520), 'від початку поїздки, 14:00', noto(31), (227, 227, 227))   # we never reset: no "OK" hint


def bottom_row(cv):
    cv.rect(629, 612.4, 1291, 614.6, RULE)           # rule at y 613
    xl, xr = 846, 1153
    for x, base, num, unit in ((xl, 656, '48 215', 'км'), (xr, 656, '412.6', 'км'), (xl, 703, '14:43', ''), (xr, 703, '+7.5', '°C')):
        cv.btext(x, base, num, noto(40), WHITE, 'r')
        if unit:
            cv.btext(x + 5, base, unit, noto(21), WHITE, 'l')


def message_plate(cv, text, sev, icon):
    """VF's M2: the bottom plate. Our text takes the bottom row's place; BMW's fallback window opens on the same area."""
    cv.rect(694.5, 592, 1230, 720, (0, 0, 0))
    col = {'info': (231, 231, 231), 'warn': AMBER, 'red': TAB_RED}[sev]
    cv.rect(629, 611, 1291, 615, col)
    cell = {'info': GREY_CELL, 'warn': AMBER, 'red': TAB_RED}[sev]
    cv.rect(702, 623.5, 768, 707.5, cell)
    f, maxw, lines, cur = noto(42), 441.0, [], ''
    for word in text.split():                        # VF: 441 px wide; wrap, then an ellipsis on line two
        trial = (cur + ' ' + word).strip()
        if cv.width(trial, f) <= maxw or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    lines.append(cur)
    if len(lines) > 2:
        lines = [lines[0], ' '.join(lines[1:])]
    while len(lines) == 2 and cv.width(lines[1], f) > maxw and len(lines[1]) > 1:
        lines[1] = lines[1][:-2].rstrip() + '…' if not lines[1].endswith('…') else lines[1][:-2] + '…'
    if len(lines) == 1:
        cv.btext(783, 680, lines[0], f, WHITE, 'l')
    else:
        cv.btext(783, 656, lines[0], f, WHITE, 'l')
        cv.btext(783, 703, lines[1], f, WHITE, 'l')
    cv.icon(icon, 54, 735, 665.5, (0, 0, 0) if sev == 'warn' else WHITE)


def draw_dials(cv, look=None, speed=87.0, rpm=2.4, gear='D3', program='COMFORT'):
    """Both dials onto a Canvas (for round 3's pages, tools/twin-dial/mockup/pages.py): look None = 0.1.0."""
    cv.speed_digits = speed
    cv.dial(CT, 'tach', rpm, gear, look, program)
    cv.dial(CS, 'speed', speed, gear, look, program)


def finish(cv):
    """The canvas at panel size with the icons pasted (what render() returns)."""
    out = cv.img.resize((W, H), Image.LANCZOS)
    paste_icons(out, cv.icons)
    return out


def render(speed=87.0, rpm=2.4, page='clock', message=None, look=None, gear='D3', program='COMFORT'):
    cv = Canvas()
    draw_dials(cv, look, speed, rpm, gear, program)
    tab_bar(cv, AMBER if message and message[1] == 'warn' else TAB_RED if message and message[1] == 'red' else None)
    centre(cv, page)
    if message:
        message_plate(cv, *message)
    else:
        bottom_row(cv)
    out = cv.img.resize((W, H), Image.LANCZOS)
    paste_icons(out, cv.icons)
    return out


def annotate(base):
    """The same picture with every place that is BMW's or protected, drawn over it."""
    img = base.convert('RGBA')
    ov = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    hood = [(0, 200), (100, 145), (200, 94), (300, 52), (400, 33), (500, 24), (600, 19), (700, 13), (800, 12), (900, 13),
            (1000, 14), (1100, 13), (1200, 15), (1300, 20), (1400, 28), (1500, 33), (1600, 48), (1700, 88), (1800, 139),
            (1900, 205), (1920, 225)]
    d.polygon([(0, 0)] + hood + [(1920, 0)], fill=(255, 40, 40, 70))
    d.rectangle([497, 660, 688, 720], fill=(0, 200, 255, 70), outline=(0, 200, 255, 255), width=2)
    d.rectangle([1380, 660, 1460, 720], fill=(255, 150, 0, 70), outline=(255, 150, 0, 255), width=2)
    d.rectangle([1398, 668, 1424, 703], outline=(255, 255, 0, 255), width=2)
    try:
        poly = json.load(open(os.path.join(ROOT, 'design', 'twin-dial', 'vf', 'message_panel.json')))['fallback_window']['polygon_px']
        d.polygon([tuple(p) for p in poly], outline=(0, 255, 120, 255))
        d.line([tuple(p) for p in poly] + [tuple(poly[0])], fill=(0, 255, 120, 255), width=2)
    except Exception as e:
        print('no fallback polygon:', e)
    try:
        cat = json.load(open(os.path.join(ROOT, 'design', 'overlay', 'g20_comfort.json')))['elements']
        for e in cat:
            if e.get('group') == 'telltale' and e.get('bbox'):
                x0, y0, x1, y1 = e['bbox']
                d.rectangle([x0 - 3, y0 - 3, x1 + 3, y1 + 3], outline=(255, 0, 255, 255), width=2)
    except Exception as e:
        print('no catalogue:', e)
    img = Image.alpha_composite(img, ov).convert('RGB')
    dd = ImageDraw.Draw(img)
    lf = ImageFont.truetype(os.path.join(FONTS, 'notosans', 'NotoSans[wdth,wght].ttf'), 18)
    for i, (col, txt) in enumerate([((255, 40, 40), 'hood hides it'), ((0, 200, 255), "BMW's belt and airbag group (never covered)"),
                                    ((255, 150, 0), 'gap over the gear letter (layers split here)'),
                                    ((255, 255, 0), "BMW's gear letter (drawn over us)"), ((0, 255, 120), "fallback window over BMW's message panel"),
                                    ((255, 0, 255), "BMW's own lamps (see-through holes)")]):
        dd.rectangle([20, 20 + i * 26, 38, 38 + i * 26], fill=col)
        dd.text((46, 20 + i * 26), txt, font=lf, fill=(255, 255, 255))
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    shots = {
        '1_clock.png': dict(page='clock'),
        '2_trip.png': dict(page='trip', speed=112.0, rpm=3.1),
        '3_message_info.png': dict(page='clock', message=('Водійські двері відчинено', 'info', 'cc_door')),
        '4_message_warning.png': dict(page='trip', message=('Тиск у шинах: перевірте', 'warn', 'cc_tyre')),
    }
    imgs = {}
    for name, kw in shots.items():
        imgs[name] = render(**kw)
        imgs[name].save(os.path.join(OUT, name))
        print('wrote', os.path.join(OUT, name))
    annotate(imgs['1_clock.png']).save(os.path.join(OUT, '5_protected_zones.png'))
    print('wrote', os.path.join(OUT, '5_protected_zones.png'))


if __name__ == '__main__':
    main()
