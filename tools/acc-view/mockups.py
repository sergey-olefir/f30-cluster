"""tools/acc-view: the park of mockups for the adaptive-cruise view (round 1120, package AA; the spec is docs/r1120/AA-SPEC.md).

    UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with pillow python -I tools/acc-view/mockups.py [--out <dir>]

Four visual directions x three placements x every state x day / night, drawn from geometry only (our own generic car shapes,
the repository's own OFL fonts: Noto Sans for words, Saira for figures), then contact sheets per direction and per placement,
a few pictures of the `map` target seen through Twin Dial's and f30_cluster's map windows (their own bench renders, read from
bake/work if they are there), and an index.html that shows them all with the state names.

    directions  A lane (perspective)   B ladder (flat, 6WB floor stripes)   C arc (a round instrument)   D top view (plan)
    placements  map (1088 x 480, slot 0x100)   hud (800 x 480)   centre (the centre screen's 1600 x 520 canvas)

Default out: bake/work/r1120/pub/AA/ (git-ignored). Nothing here is another maker's artwork; the reference photos are not read.
Rules the pictures keep (AA-SPEC section 4): no red anywhere, nothing flashes, no symbol of a brake or of an assistant that
holds the distance, the bars are the MEASURED gap only, the loop's set speed is a suggestion in its own colour (cyan, an
outline), the car's own collision warning dims our picture and says "Увага" in words (never a symbol of ours).
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
FONTS = os.path.join(ROOT, 'tools', 'fonts-src')
S = 3                                   # supersampling

# ------------------------------------------------------------------------------------------------ the states
# tgt: level 1 (nearest) .. 5 (farthest) or None; clo: 0 / 1 closing / 2 closing fast; data: 'ok' | 'none' | 'stale' | 'absent'
# cru: None (cruise off) or (kind 'cruise' | 'limiter', status 'active' | 'standby', set km/h); warn: the car's own collision
# warning is requested; adv: the outer loop's suggested set speed (km/h) or None.
def _s(tgt=3, clo=0, data='ok', cru=('cruise', 'active', 90), warn=False, adv=None):
    return dict(tgt=tgt if data == 'ok' else None, clo=clo, data=data, cru=cru, warn=warn, adv=adv)


STATES = [
    ('01', 'absent', 'signal absent (nothing since the start)', 'Немає даних', _s(data='absent')),
    ('02', 'none', 'no target', 'Авто не видно', _s(data='none')),
    ('03', 'far', 'far (level 5)', 'далеко', _s(tgt=5)),
    ('04', 'middle', 'middle (level 3)', 'середньо', _s(tgt=3)),
    ('05', 'near', 'near (level 1)', 'близько', _s(tgt=1)),
    ('06', 'closing', 'closing', 'наближення', _s(tgt=3, clo=1)),
    ('07', 'fast', 'closing fast', 'швидке наближення', _s(tgt=2, clo=2)),
    ('08', 'cruise-off', 'cruise off', 'круїз вимкнено', _s(tgt=3, cru=None)),
    ('09', 'standby', 'cruise standby', 'круїз чекає', _s(tgt=3, cru=('cruise', 'standby', 90))),
    ('10', 'active', 'cruise active, 3-figure set speed', 'круїз 110', _s(tgt=4, cru=('cruise', 'active', 110))),
    ('11', 'limiter', 'limiter active', 'обмежувач 110', _s(tgt=3, cru=('limiter', 'active', 110))),
    ('12', 'stale', 'data stale (no value for 2 s)', 'дані застаріли', _s(data='stale')),
    ('13', 'warn', "the car's own collision warning active", 'Увага', _s(tgt=1, clo=2, warn=True)),
    ('14', 'advice', "the loop's suggested set speed", 'порада 96', _s(tgt=2, clo=1, cru=('cruise', 'active', 110), adv=96)),
]

DIRECTIONS = [
    ('A', 'lane', 'Смуга: the lane in perspective, the car ahead on it, rungs for the measured gap'),
    ('B', 'ladder', 'Шкала: flat floor stripes (the 6WB floor), the car ahead on its stripe, a set-speed capsule'),
    ('C', 'arc', 'Дуга: a round instrument, the gap on a ring from near to far, the set speed in the hub'),
    ('D', 'top', 'Згори: a plan of the lane, our car and the car ahead with the gap bracket between them'),
]

PLACEMENTS = [
    ('map', 1088, 480, "the cluster's map target (slot 0x100), seen through a theme's map window or on BMW's own cluster"),
    ('hud', 800, 480, 'the HUD (slot 0x323); black is see-through, only the window x 120 y 100 485 x 278 reaches the eye'),
    ('centre', 1600, 520, "the centre screen: the app's own canvas (1600 x 520)"),
]

# The parts of the map target a driver sees (map-target px; the slot assumed centred on the panel at x 416, y 140, MW-REPORT):
MAP_W2 = (700 - 416, 173 - 140, 520, 427)     # Twin Dial's map window W2 [700, 173, 1220, 600]
MAP_F30 = (750 - 416, 180 - 140, 420, 384)    # f30_cluster's map window [750, 180, 1170, 564] (CAR3-H; fades 120/80/80)
MAP_CORE = (334, 44, 420, 372)                # what both show: every essential element of a map picture lies inside
MAP_F30_FULL = (414, 160, 260, 184)           # where f30's window passes the map at full (inside its 120 / 80 / 80 px fades)
HUD_WIN = (120, 100, 485, 278)                # the HUD's visible window (measured on an X3; the G20's is not measured)

WORDS = {1: 'близько', 2: 'близько', 3: 'середньо', 4: 'далеко', 5: 'далеко'}
DEPTH = {1: 0.18, 2: 0.36, 3: 0.55, 4: 0.75, 5: 0.93}       # the car ahead's place on a 0 (us) .. 1 (far) axis
LANE_Z = {1: 0.12, 2: 0.22, 3: 0.35, 4: 0.53, 5: 0.80}      # the same on the lane's perspective depth (A)


# ------------------------------------------------------------------------------------------------ colours
def palette(placement, night):
    p = dict(bg=(0, 0, 0), ink=(236, 239, 243), dim=(150, 156, 165), faint=(58, 62, 68), road=(24, 26, 30),
             green=(76, 176, 40), amber=(240, 170, 10), cyan=(86, 192, 236), panel=(14, 15, 18))
    if placement == 'centre':
        p.update(bg=(22, 24, 28), road=(36, 39, 44), faint=(70, 74, 82), panel=(30, 33, 38))
    if placement == 'hud':
        p.update(ink=(246, 246, 246), dim=(176, 180, 186), faint=(84, 88, 92), road=(0, 0, 0),
                 green=(104, 232, 72), amber=(255, 192, 40), cyan=(112, 212, 255))
    if night:                                   # Twin Dial's night roles: white x 0.80, dim x 0.75, green x 0.75, amber x 0.80
        mul = dict(ink=0.80, dim=0.75, green=0.75, amber=0.80, cyan=0.78, faint=0.80, road=0.70, panel=0.6)
        for k, m in mul.items():
            p[k] = tuple(int(round(c * m)) for c in p[k])
        if placement == 'centre':
            p['bg'] = (6, 7, 9)
            p['road'] = (18, 19, 22)
            p['panel'] = (13, 14, 17)
    return p


def mix(c, a, bg):
    return tuple(int(round(bg[i] + (c[i] - bg[i]) * a)) for i in range(3))


# ------------------------------------------------------------------------------------------------ the canvas
_FONTS = {}


def font(kind, size):
    key = (kind, int(size))
    if key not in _FONTS:
        if kind in ('word', 'wordb'):
            f = ImageFont.truetype(os.path.join(FONTS, 'NotoSans-wght.subset.ttf'), int(size))
            try:
                f.set_variation_by_axes([600 if kind == 'wordb' else 450])
            except Exception:
                pass
        else:
            f = ImageFont.truetype(os.path.join(FONTS, 'Saira[wdth,wght].ttf'), int(size))
            try:
                f.set_variation_by_axes([100, 600])
            except Exception:
                pass
        _FONTS[key] = f
    return _FONTS[key]


class Cv:
    def __init__(self, w, h, bg):
        self.w, self.h, self.bg = w, h, bg
        self.im = Image.new('RGB', (w * S, h * S), bg)
        self.d = ImageDraw.Draw(self.im)

    def _p(self, pts):
        return [(x * S, y * S) for x, y in pts]

    def poly(self, pts, fill=None, outline=None, width=1.0):
        self.d.polygon(self._p(pts), fill=fill, outline=outline, width=max(1, int(round(width * S))) if outline else 0)

    def line(self, pts, col, width):
        self.d.line(self._p(pts), fill=col, width=max(1, int(round(width * S))), joint='curve')
        r = width * S / 2.0
        if width >= 2.5:                        # round caps
            for x, y in (pts[0], pts[-1]):
                self.d.ellipse([x * S - r, y * S - r, x * S + r, y * S + r], fill=col)

    def rrect(self, x0, y0, x1, y1, r, fill=None, outline=None, width=1.0):
        self.d.rounded_rectangle([x0 * S, y0 * S, x1 * S, y1 * S], radius=max(0, r * S), fill=fill, outline=outline,
                                 width=max(1, int(round(width * S))) if outline else 0)

    def ellipse(self, cx, cy, rx, ry, fill=None, outline=None, width=1.0):
        self.d.ellipse([(cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S], fill=fill, outline=outline,
                       width=max(1, int(round(width * S))) if outline else 0)

    def arc(self, cx, cy, r, a0, a1, col, width):
        """Angles in degrees, 0 = east, clockwise (PIL's convention)."""
        self.d.arc([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], a0, a1, fill=col, width=max(1, int(round(width * S))))

    def text(self, x, y, s, kind, size, col, anchor='ls'):
        self.d.text((x * S, y * S), s, font=font(kind, size * S), fill=col, anchor=anchor)

    def tw(self, s, kind, size):
        return self.d.textlength(s, font=font(kind, size * S)) / S

    def fit(self, s, kind, size, maxw):
        while size > 10 and self.tw(s, kind, size) > maxw:
            size -= 1
        return size

    def out(self):
        return self.im.resize((self.w, self.h), Image.LANCZOS)


# ------------------------------------------------------------------------------------------------ shapes (ours, generic)
def car_rear(c, cx, wy, w, col, bg, filled=True, lw=1.5):
    """A plain rear view: a rounded body, a narrower glasshouse, lamp slots and two wheels. wy = the wheel line."""
    h = w * 0.62
    top = wy - h
    body = (cx - w / 2, top + h * 0.38, cx + w / 2, wy - h * 0.12)
    cab = [(cx - w * 0.30, top), (cx + w * 0.30, top), (cx + w * 0.42, top + h * 0.40), (cx - w * 0.42, top + h * 0.40)]
    wheel_w, wheel_h = w * 0.16, h * 0.16
    if filled:
        c.poly(cab, fill=col)
        c.rrect(*body, r=w * 0.12, fill=col)
        win = [(cx - w * 0.25, top + h * 0.07), (cx + w * 0.25, top + h * 0.07), (cx + w * 0.34, top + h * 0.36), (cx - w * 0.34, top + h * 0.36)]
        c.poly(win, fill=bg)
        for sx in (-1, 1):
            x0 = cx + sx * w * 0.30
            c.rrect(min(x0, x0 + sx * w * 0.14), top + h * 0.50, max(x0, x0 + sx * w * 0.14), top + h * 0.62, r=w * 0.03, fill=bg)
            xw = cx + sx * w * 0.32
            c.rrect(min(xw, xw + sx * wheel_w), wy - wheel_h, max(xw, xw + sx * wheel_w), wy, r=w * 0.03, fill=col)
        c.rrect(cx - w * 0.14, top + h * 0.62, cx + w * 0.14, top + h * 0.72, r=w * 0.02, fill=bg)     # the plate's slot
    else:
        c.poly(cab, outline=col, width=lw)
        c.rrect(*body, r=w * 0.12, outline=col, width=lw)
        for sx in (-1, 1):
            xw = cx + sx * w * 0.32
            c.rrect(min(xw, xw + sx * wheel_w), wy - wheel_h, max(xw, xw + sx * wheel_w), wy, r=w * 0.03, outline=col, width=lw)


def car_top(c, x, y, length, col, bg, filled=True, lw=1.5, facing='right'):
    """A plan view seen from above, nose to `facing` ('right' or 'up'): a rounded body, a windscreen and a rear window."""
    wid = length * 0.47
    if facing == 'up':
        def P(u, v):                      # u along the car (+ = nose), v across
            return (x + v, y - u)
    else:
        def P(u, v):
            return (x + u, y + v)
    L2, W2 = length / 2, wid / 2
    xs = [P(-L2, -W2), P(L2, W2)]
    x0, x1 = min(p[0] for p in xs), max(p[0] for p in xs)
    y0, y1 = min(p[1] for p in xs), max(p[1] for p in xs)
    if filled:
        c.rrect(x0, y0, x1, y1, r=wid * 0.32, fill=col)
        c.poly([P(L2 * 0.10, -W2 * 0.80), P(L2 * 0.40, -W2 * 0.66), P(L2 * 0.40, W2 * 0.66), P(L2 * 0.10, W2 * 0.80)], fill=bg)
        c.poly([P(-L2 * 0.55, -W2 * 0.78), P(-L2 * 0.72, -W2 * 0.64), P(-L2 * 0.72, W2 * 0.64), P(-L2 * 0.55, W2 * 0.78)], fill=bg)
    else:
        c.rrect(x0, y0, x1, y1, r=wid * 0.32, outline=col, width=lw)
        c.poly([P(L2 * 0.10, -W2 * 0.80), P(L2 * 0.40, -W2 * 0.66), P(L2 * 0.40, W2 * 0.66), P(L2 * 0.10, W2 * 0.80)], outline=col, width=lw)
        c.poly([P(-L2 * 0.55, -W2 * 0.78), P(-L2 * 0.72, -W2 * 0.64), P(-L2 * 0.72, W2 * 0.64), P(-L2 * 0.55, W2 * 0.78)], outline=col, width=lw)


def chevron(c, cx, cy, w, h, col, lw, up=True, right=False):
    if right:
        c.line([(cx - h / 2, cy - w / 2), (cx + h / 2, cy), (cx - h / 2, cy + w / 2)], col, lw)
    else:
        s = -1 if up else 1
        c.line([(cx - w / 2, cy - s * h / 2), (cx, cy + s * h / 2), (cx + w / 2, cy - s * h / 2)], col, lw)


# ------------------------------------------------------------------------------------------------ what each state says
def gap_colour(st, P):
    return P['amber'] if st['clo'] == 2 else P['ink']


def state_word(st):
    if st['data'] == 'absent':
        return 'Немає даних'
    if st['data'] == 'stale':
        return 'Дані застаріли'
    if st['data'] == 'none':
        return 'Авто не видно'
    return WORDS[st['tgt']]


def closing_word(st):
    return '' if st['data'] != 'ok' or not st['clo'] else ('швидке наближення' if st['clo'] == 2 else 'наближення')


def cruise_bits(st, P):
    """-> (figure, label, colour) of the cruise / limiter, or None."""
    cr = st['cru']
    if not cr:
        return None
    kind, status, kmh = cr
    col = P['green'] if status == 'active' else P['dim']
    label = 'обмежувач' if kind == 'limiter' else ('круїз' if status == 'active' else 'круїз чекає')
    return str(kmh), label, col


def cruise_text(st, P):
    cb = cruise_bits(st, P)
    if not cb:
        return 'круїз вимкнено', P['dim']
    fig, label, col = cb
    return label + ' ' + fig, col


# ------------------------------------------------------------------------------------------------ A: the lane
def lane_hero(c, P, st, box, lw=1.0):
    """Our lane in perspective. The car ahead sits at its level's depth; the lane between us and it is lit faintly and
    carries one rung per level (the MEASURED gap); chevrons up the lane while we close on it. Our own car is an outline cut
    by the box's foot."""
    x, y, w, h = box
    cx = x + w / 2
    foot = y + h
    vy = y - h * 0.16                               # the vanishing point, just above the box
    ytop = y + h * 0.03
    hw0 = w * 0.47
    k = (foot - vy) / (ytop - vy) - 1.0

    def Y(z):                                        # depth 0 (foot) .. 1 (far end) -> screen y
        return vy + (foot - vy) / (1.0 + k * z)

    def HW(yy):
        return hw0 * (yy - vy) / (foot - vy)
    dim_all = st['data'] != 'ok'
    n = 30
    for i in range(n):
        za, zb = i / float(n), (i + 1) / float(n)
        ya, yb = Y(za), Y(zb)
        a = (1.0 - 0.85 * za) * (0.45 if dim_all else 1.0)
        c.poly([(cx - HW(ya), ya), (cx + HW(ya), ya), (cx + HW(yb), yb), (cx - HW(yb), yb)], fill=mix(P['road'], a, P['bg']))
    L = st['tgt']
    if L:
        zl = LANE_Z[L]
        ya, yb = Y(0.0), Y(zl)
        c.poly([(cx - HW(ya) * 0.84, ya), (cx + HW(ya) * 0.84, ya), (cx + HW(yb) * 0.84, yb), (cx - HW(yb) * 0.84, yb)],
               fill=mix(gap_colour(st, P), 0.16 if st['clo'] == 2 else 0.09, P['road']))
    m = 20
    for i in range(m):
        za, zb = i / float(m), (i + 1) / float(m)
        ya, yb = Y(za), Y(zb)
        a = (0.95 - 0.70 * za) * (0.5 if dim_all else 1.0)
        wl = lw * (4.0 - 2.8 * za)
        for sx in (-1, 1):
            c.line([(cx + sx * HW(ya), ya), (cx + sx * HW(yb), yb)], mix(P['ink'], a, P['bg']), wl)
    if L:
        rc = P['amber'] if st['clo'] == 2 else mix(P['ink'], 0.85 if st['clo'] else 0.50, P['bg'])
        marks = [0.10] + [(LANE_Z[q] + LANE_Z[q + 1]) / 2 for q in range(1, L)]
        marks = [z for z in marks if z < LANE_Z[L] - 0.06]
        for z in marks:
            yy = Y(z)
            c.line([(cx - HW(yy) * 0.74, yy), (cx + HW(yy) * 0.74, yy)], rc, lw * (1.6 + 3.4 * (1 - z)))
        if st['clo']:
            col = P['amber'] if st['clo'] == 2 else P['ink']
            yy = (Y(0.04) + Y(LANE_Z[L])) / 2 if L > 1 else (Y(0.0) + Y(LANE_Z[L])) / 2 + 6
            cw = HW(yy) * 0.62
            for q in range(st['clo']):
                chevron(c, cx, yy + cw * 0.10 - q * cw * 0.30, cw, cw * 0.28, col, lw * 3.2, up=True)
        yy = Y(LANE_Z[L])
        car_rear(c, cx, yy, 2 * HW(yy) * 0.60, gap_colour(st, P), P['road'], filled=True)
    # our car: an outline at the foot, cut by the box
    ow = 2 * hw0 * 0.50
    car_rear(c, cx, foot + ow * 0.62 * 0.42, ow, mix(P['ink'], 0.70, P['bg']), P['bg'], filled=False, lw=lw * 2.0)
    c.rrect(x - 40, foot, x + w + 40, foot + ow, r=0, fill=P['bg'])


def lane_layout(c, P, st, placement):
    if placement == 'map':
        x, y, w, h = MAP_CORE
        top_line(c, P, st, (x, y, w), 30)
        lane_hero(c, P, st, (x + 22, y + 82, w - 44, h - 82))
        overlay_text(c, P, st, (x, y + 82, w, h - 82), 32)
    elif placement == 'hud':
        x, y, w, h = HUD_WIN[0] + 12, HUD_WIN[1] + 12, HUD_WIN[2] - 24, HUD_WIN[3] - 24
        lane_hero(c, P, st, (x, y + 46, w * 0.54, h - 46), lw=1.6)
        hud_word(c, P, st, (x, y, w * 0.54), 26)
        overlay_text(c, P, st, (x, y + 46, w * 0.54, h - 46), 26)
        side_figures(c, P, st, (x + w * 0.56, y, w * 0.44, h))
    else:
        centre_frame(c, P, st)
        top_line(c, P, st, (90, 70, 640), 34)
        lane_hero(c, P, st, (110, 160, 600, 360), lw=1.4)
        overlay_text(c, P, st, (90, 160, 640, 360), 40)


def top_line(c, P, st, row, size):
    """The meta line (Twin Dial's page grammar): the gap word and the closing word left, the cruise right, the suggestion
    under the cruise (cyan, 'порада')."""
    x, y, w = row
    base = y + size
    if st['warn']:
        c.text(x + 2, base, 'Увага', 'wordb', size, P['ink'])
    elif st['data'] == 'ok':
        c.text(x + 2, base, WORDS[st['tgt']], 'word', size, gap_colour(st, P))
        cw = closing_word(st)
        if cw:
            c.text(x + 2, base + size * 1.05, cw, 'word', size * 0.78, gap_colour(st, P))
    t, col = cruise_text(st, P)
    c.text(x + w - 2, base, t, 'word', size, col, anchor='rs')
    if st['adv']:
        c.text(x + w - 2, base + size * 1.05, 'порада ' + str(st['adv']), 'word', size * 0.78, P['cyan'], anchor='rs')


def hud_word(c, P, st, row, size):
    x, y, w = row
    if st['warn']:
        c.text(x + w / 2, y + size, 'Увага', 'wordb', size, P['ink'], anchor='ms')
    elif st['data'] == 'ok':
        s = WORDS[st['tgt']]
        if st['clo']:
            s += ' · ' + ('швидко' if st['clo'] == 2 else 'ближче')
        c.text(x + w / 2, y + size, s, 'word', c.fit(s, 'word', size, w), gap_colour(st, P), anchor='ms')


def overlay_text(c, P, st, box, size):
    """The words that stand in for a car: no target, stale, absent (on a plate of the background; the lane stops under it)."""
    if st['data'] == 'ok':
        return
    x, y, w, h = box
    s = state_word(st)
    size = c.fit(s, 'word', size, w * 0.9)
    tw = c.tw(s, 'word', size)
    cy = y + h * 0.46
    c.rrect(x + w / 2 - tw / 2 - 14, cy - size * 0.95, x + w / 2 + tw / 2 + 14, cy + size * 0.45, r=8, fill=P['bg'])
    c.text(x + w / 2, cy, s, 'word', size, P['ink'] if st['data'] == 'absent' else P['dim'], anchor='ms')


def side_figures(c, P, st, box):
    """The set speed big, its label, the suggestion as a cyan outline under it."""
    x, y, w, h = box
    cb = cruise_bits(st, P)
    fs = h * 0.40
    cy = y + h * 0.44
    if cb:
        fig, label, col = cb
        fs = c.fit(fig, 'fig', fs, w * 0.92)
        c.text(x + w / 2, cy, fig, 'fig', fs, col, anchor='ms')
        c.text(x + w / 2, cy + fs * 0.40, label, 'word', 24, col, anchor='ms')
    else:
        c.text(x + w / 2, cy, '–', 'fig', fs, P['faint'], anchor='ms')
        c.text(x + w / 2, cy + fs * 0.40, 'круїз вимкнено', 'word', 22, P['dim'], anchor='ms')
    if st['adv']:
        a = str(st['adv'])
        s2 = fs * 0.44
        tw = c.tw(a, 'fig', s2)
        yb = cy + fs * 0.56
        c.rrect(x + w / 2 - tw / 2 - 16, yb, x + w / 2 + tw / 2 + 16, yb + s2 * 1.08, r=s2 * 0.54, outline=P['cyan'], width=2.2)
        c.text(x + w / 2, yb + s2 * 0.88, a, 'fig', s2, P['cyan'], anchor='ms')


# ------------------------------------------------------------------------------------------------ B: the ladder
def ladder_hero(c, P, st, box, lw=1.0):
    """Five floor stripes, near at the foot (the 6WB floor's stripes, flat). The stripes between us and the car ahead are
    lit (the measured gap); the car ahead stands on its own stripe; the stripes beyond are outlines."""
    x, y, w, h = box
    cx = x + w / 2
    n = 5
    foot = y + h
    us_h = h * 0.17
    step = (h - us_h) / n
    car_rear(c, cx, foot - 2, w * 0.34, mix(P['ink'], 0.70, P['bg']), P['bg'], filled=False, lw=lw * 1.8)
    dim_all = st['data'] != 'ok'
    L = st['tgt']
    for q in range(1, n + 1):
        yb = foot - us_h - (q - 1) * step - step * 0.12
        wk = w * (0.98 - 0.10 * (q - 1))
        hk = step * (0.42 - 0.04 * (q - 1))
        if L and q < L:
            col = P['amber'] if st['clo'] == 2 else mix(P['ink'], 0.85 if st['clo'] else 0.55, P['bg'])
            c.rrect(cx - wk / 2, yb - hk, cx + wk / 2, yb, r=hk / 2, fill=col)
        elif L and q == L:
            car_rear(c, cx, yb + step * 0.08, min(wk * 0.52, step * 1.45), gap_colour(st, P), P['bg'], filled=True)
        else:
            col = mix(P['ink'], 0.12 if dim_all else 0.24, P['bg'])
            c.rrect(cx - wk / 2, yb - hk, cx + wk / 2, yb, r=hk / 2, outline=col, width=lw * 1.5)
    if L and st['clo']:
        col = P['amber'] if st['clo'] == 2 else P['ink']
        yc = foot - us_h - step * (L - 1) * 0.5 - step * 0.2
        for sx in (-1, 1):
            xx = cx + sx * (w * 0.5 + 18)
            for q in range(st['clo']):
                chevron(c, xx, yc - q * 13, 20, 9, col, lw * 2.8, up=True)


def capsule(c, P, st, box, figsize):
    """The set speed in a capsule (the status colour), its label under it, the suggestion in a cyan outline below."""
    x, y, w, h = box
    cb = cruise_bits(st, P)
    cx = x + w / 2
    caph = figsize * 1.22
    if cb:
        fig, label, col = cb
        c.rrect(x, y, x + w, y + caph, r=caph / 2, outline=col, width=2.6)
        fs = c.fit(fig, 'fig', figsize, w * 0.80)
        c.text(cx, y + caph * 0.80, fig, 'fig', fs, col, anchor='ms')
        c.text(cx, y + caph + figsize * 0.46, label, 'word', figsize * 0.36, col, anchor='ms')
    else:
        c.rrect(x, y, x + w, y + caph, r=caph / 2, outline=P['faint'], width=2.0)
        c.text(cx, y + caph * 0.80, '–', 'fig', figsize, P['faint'], anchor='ms')
        c.text(cx, y + caph + figsize * 0.46, 'круїз вимкнено', 'word', figsize * 0.32, P['dim'], anchor='ms')
    if st['adv']:
        yb = y + caph + figsize * 0.80
        ah = figsize * 0.80
        c.rrect(x + w * 0.14, yb, x + w * 0.86, yb + ah, r=ah / 2, outline=P['cyan'], width=2.0)
        c.text(cx, yb + ah * 0.80, str(st['adv']), 'fig', figsize * 0.62, P['cyan'], anchor='ms')
        c.text(cx, yb + ah + figsize * 0.38, 'порада', 'word', figsize * 0.32, P['cyan'], anchor='ms')


def ladder_layout(c, P, st, placement):
    if placement == 'map':
        x, y, w, h = MAP_CORE
        gap_words(c, P, st, (x, y + 4, 236), 30)
        ladder_hero(c, P, st, (x + 34, y + 86, 172, h - 88))
        overlay_text(c, P, st, (x, y + 86, 240, h - 88), 28)
        capsule(c, P, st, (x + 262, y + 64, 150, h), 66)
    elif placement == 'hud':
        x, y, w, h = HUD_WIN[0] + 12, HUD_WIN[1] + 8, HUD_WIN[2] - 24, HUD_WIN[3] - 16
        hud_word(c, P, st, (x, y, w * 0.50), 26)
        ladder_hero(c, P, st, (x + 40, y + 40, w * 0.50 - 80, h - 40), lw=1.6)
        overlay_text(c, P, st, (x, y + 40, w * 0.50, h - 40), 24)
        capsule(c, P, st, (x + w * 0.60, y + 24, w * 0.34, h), 58)
    else:
        centre_frame(c, P, st)
        gap_words(c, P, st, (90, 70, 400), 36)
        ladder_hero(c, P, st, (150, 170, 300, 330), lw=1.4)
        overlay_text(c, P, st, (90, 170, 420, 330), 36)
        capsule(c, P, st, (520, 120, 200, 380), 84)


def gap_words(c, P, st, row, size):
    x, y, w = row
    if st['warn']:
        c.text(x + w / 2, y + size, 'Увага', 'wordb', size, P['ink'], anchor='ms')
    elif st['data'] == 'ok':
        c.text(x + w / 2, y + size, WORDS[st['tgt']], 'word', size, gap_colour(st, P), anchor='ms')
        cw = closing_word(st)
        if cw:
            lines = [cw] if c.fit(cw, 'word', size * 0.72, w) >= size * 0.6 or ' ' not in cw else cw.split(' ')
            for i, ln in enumerate(lines):
                c.text(x + w / 2, y + size * (1.95 + 0.85 * i), ln, 'word', c.fit(ln, 'word', size * 0.72, w), gap_colour(st, P), anchor='ms')


# ------------------------------------------------------------------------------------------------ C: the arc
def arc_hero(c, P, st, box, figsize, lw=1.0):
    """A round instrument: the gap on a 240-degree ring from near (lower left) to far (lower right), the measured part lit,
    a puck and the little car outside the ring where the car ahead is; the set speed in the hub."""
    x, y, w, h = box
    R = min(w * 0.40, h * 0.40)
    cx, cy = x + w / 2, y + R + 52 * lw
    a0, a1 = 150.0, 390.0
    dim_all = st['data'] != 'ok'
    for dr, a in ((12, 0.10), (9, 0.16), (6, 0.26), (3, 0.42)):
        c.arc(cx, cy, R + dr + 10, a0 - 5, a1 + 5, mix(P['ink'], a * (0.6 if dim_all else 1), P['bg']), 1.6 * lw)
    c.arc(cx, cy, R, a0, a1, mix(P['ink'], 0.13, P['bg']), 12 * lw)
    for q in range(6):
        a = math.radians(a0 + (a1 - a0) * q / 5.0)
        r0, r1 = R - 10 * lw, R + 10 * lw
        c.line([(cx + r0 * math.cos(a), cy + r0 * math.sin(a)), (cx + r1 * math.cos(a), cy + r1 * math.sin(a))], mix(P['ink'], 0.45, P['bg']), 1.8 * lw)
    if st['tgt']:
        z = (st['tgt'] - 0.5) / 5.0
        am = a0 + (a1 - a0) * z
        col = gap_colour(st, P)
        c.arc(cx, cy, R, a0, am, mix(col, 0.90 if st['clo'] else 0.62, P['bg']), 12 * lw)
        ar = math.radians(am)
        mx, my = cx + R * math.cos(ar), cy + R * math.sin(ar)
        if st['clo']:                                # arrowheads on the ring, pointing back towards "near"
            ccol = P['amber'] if st['clo'] == 2 else P['ink']
            for q in range(st['clo']):
                ab = math.radians(am - (22 + 14 * q) * 150.0 / max(R, 80))
                px, py = cx + (R + 26 * lw) * math.cos(ab), cy + (R + 26 * lw) * math.sin(ab)
                tx, ty = math.sin(ab), -math.cos(ab)          # the tangent towards smaller angles
                nx, ny = math.cos(ab), math.sin(ab)
                s = 7 * lw
                c.line([(px - tx * s + nx * s, py - ty * s + ny * s), (px + tx * s, py + ty * s), (px - tx * s - nx * s, py - ty * s - ny * s)], ccol, 2.8 * lw)
        c.ellipse(mx, my, 15 * lw, 15 * lw, fill=P['bg'])
        c.ellipse(mx, my, 11 * lw, 11 * lw, fill=col)
        ro = R + 34 * lw
        car_rear(c, cx + ro * math.cos(ar), cy + ro * math.sin(ar) + 9 * lw, 30 * lw, col, P['bg'], filled=True)
    fs = max(16, figsize * 0.24)
    for a, s in ((a0, 'близько'), (a1, 'далеко')):
        ar = math.radians(a)
        c.text(cx + R * math.cos(ar), cy + R * math.sin(ar) + fs * 1.6, s, 'word', fs, P['dim'], anchor='ms')
    cb = cruise_bits(st, P)
    wy = cy - R * 0.40
    if st['warn']:
        c.text(cx, wy, 'Увага', 'wordb', figsize * 0.38, P['ink'], anchor='ms')
    elif st['data'] == 'ok':
        c.text(cx, wy, WORDS[st['tgt']], 'word', figsize * 0.34, gap_colour(st, P), anchor='ms')
        cw = closing_word(st)
        if cw:
            c.text(cx, wy + figsize * 0.32, cw, 'word', c.fit(cw, 'word', figsize * 0.24, R * 1.3), gap_colour(st, P), anchor='ms')
    else:
        s = state_word(st)
        c.text(cx, wy, s, 'word', c.fit(s, 'word', figsize * 0.32, R * 1.4), P['ink'] if st['data'] == 'absent' else P['dim'], anchor='ms')
    fy = cy + figsize * 0.42
    if cb:
        fig, label, col = cb
        c.text(cx, fy, fig, 'fig', figsize, col, anchor='ms')
        c.text(cx, fy + figsize * 0.40, label, 'word', figsize * 0.27, col, anchor='ms')
    else:
        c.text(cx, fy, '–', 'fig', figsize, P['faint'], anchor='ms')
        c.text(cx, fy + figsize * 0.40, 'круїз вимкнено', 'word', figsize * 0.25, P['dim'], anchor='ms')
    if st['adv']:
        s = 'порада ' + str(st['adv'])
        fs2 = figsize * 0.27
        tw = c.tw(s, 'word', fs2)
        yb = fy + figsize * 0.55
        c.rrect(cx - tw / 2 - 12, yb, cx + tw / 2 + 12, yb + fs2 * 1.5, r=fs2 * 0.75, outline=P['cyan'], width=2.0)
        c.text(cx, yb + fs2 * 1.13, s, 'word', fs2, P['cyan'], anchor='ms')


def arc_layout(c, P, st, placement):
    if placement == 'map':
        x, y, w, h = MAP_CORE
        arc_hero(c, P, st, (x, y - 6, w, h), 84)
    elif placement == 'hud':
        x, y, w, h = HUD_WIN
        arc_hero(c, P, st, (x + 20, y - 18, w - 40, h + 10), 64, lw=1.2)
    else:
        centre_frame(c, P, st)
        arc_hero(c, P, st, (100, 50, 600, 450), 100, lw=1.2)


# ------------------------------------------------------------------------------------------------ D: top view
def top_hero(c, P, st, box, lw=1.0, up=True):
    """A plan of our lane (driving up, or to the right): our car an outline, the car ahead filled at its level, a bracket
    beside the lane for the measured gap, chevrons between the cars while we close; the next lanes as faint dashes."""
    x, y, w, h = box
    dim_all = st['data'] != 'ok'
    if up:
        lane = min(w * 0.52, 118)
        clen = lane * 0.74 / 0.47                   # a car is 74 % of the lane wide
        cx = x + w / 2
        # the lane and its neighbours
        c.rrect(cx - lane / 2, y, cx + lane / 2, y + h, r=0, fill=mix(P['road'], 1.0 if not dim_all else 0.5, P['bg']))
        for i in range(16):
            ya, yb = y + h * i / 16.0, y + h * (i + 1) / 16.0
            a = (0.30 + 0.65 * (i / 16.0)) * (0.5 if dim_all else 1.0)
            for sx in (-1, 1):
                c.line([(cx + sx * lane / 2, ya), (cx + sx * lane / 2, yb)], mix(P['ink'], a, P['bg']), 3.0 * lw)
        uy = y + h - clen / 2 - 4
        car_top(c, cx, uy, clen, mix(P['ink'], 0.72, P['bg']), P['bg'], filled=False, lw=1.8 * lw, facing='up')
        if st['tgt']:
            z = DEPTH[st['tgt']]
            ly_near = uy - clen - 10
            ly_far = y + clen / 2 + 4
            ly = ly_near + (ly_far - ly_near) * z
            col = gap_colour(st, P)
            car_top(c, cx, ly, clen, col, P['road'], filled=True, facing='up')
            bc = P['amber'] if st['clo'] == 2 else mix(P['ink'], 0.85 if st['clo'] else 0.6, P['bg'])
            bx = cx + lane / 2 + 16 * lw
            b0, b1 = uy - clen / 2 - 5, ly + clen / 2 + 5
            if b0 - b1 > 8:
                c.line([(bx, b0), (bx, b1)], bc, 2.6 * lw)
                c.line([(bx - 8 * lw, b0), (bx + 8 * lw, b0)], bc, 2.6 * lw)
                c.line([(bx - 8 * lw, b1), (bx + 8 * lw, b1)], bc, 2.6 * lw)
            if st['clo'] and b0 - b1 > 24:
                ccol = P['amber'] if st['clo'] == 2 else P['ink']
                ym = (b0 + b1) / 2
                for q in range(st['clo']):
                    chevron(c, cx, ym + 6 * lw - q * 13 * lw, lane * 0.40, 10 * lw, ccol, 3.0 * lw, up=True)
    else:
        lane = min(h * 0.62, 96)
        clen = lane * 0.74 / 0.47
        cy = y + h / 2
        c.rrect(x, cy - lane / 2, x + w, cy + lane / 2, r=0, fill=mix(P['road'], 1.0 if not dim_all else 0.5, P['bg']))
        for i in range(16):
            xa, xb = x + w * i / 16.0, x + w * (i + 1) / 16.0
            a = (0.95 - 0.65 * (i / 16.0)) * (0.5 if dim_all else 1.0)
            for sy in (-1, 1):
                c.line([(xa, cy + sy * lane / 2), (xb, cy + sy * lane / 2)], mix(P['ink'], a, P['bg']), 3.0 * lw)
        ux = x + clen / 2 + 4
        car_top(c, ux, cy, clen, mix(P['ink'], 0.72, P['bg']), P['bg'], filled=False, lw=1.8 * lw)
        if st['tgt']:
            z = DEPTH[st['tgt']]
            lx0, lx1 = ux + clen + 10, x + w - clen / 2 - 4
            lx = lx0 + (lx1 - lx0) * z
            col = gap_colour(st, P)
            car_top(c, lx, cy, clen, col, P['road'], filled=True)
            bc = P['amber'] if st['clo'] == 2 else mix(P['ink'], 0.85 if st['clo'] else 0.6, P['bg'])
            by = cy + lane / 2 + 16 * lw
            b0, b1 = ux + clen / 2 + 5, lx - clen / 2 - 5
            if b1 - b0 > 8:
                c.line([(b0, by), (b1, by)], bc, 2.6 * lw)
                c.line([(b0, by - 8 * lw), (b0, by + 8 * lw)], bc, 2.6 * lw)
                c.line([(b1, by - 8 * lw), (b1, by + 8 * lw)], bc, 2.6 * lw)
            if st['clo'] and b1 - b0 > 24:
                ccol = P['amber'] if st['clo'] == 2 else P['ink']
                xm = (b0 + b1) / 2
                for q in range(st['clo']):
                    chevron(c, xm - 6 * lw + q * 13 * lw, cy, lane * 0.40, 10 * lw, ccol, 3.0 * lw, right=True)


def top_layout(c, P, st, placement):
    if placement == 'map':
        x, y, w, h = MAP_CORE
        top_hero(c, P, st, (x + 136, y, 150, h), up=True)
        overlay_text(c, P, st, (x, y, 290, h), 30)
        gap_words(c, P, st, (x, y + 40, 136), 30)
        side_figures(c, P, st, (x + 296, y + 20, 124, 300))
    elif placement == 'hud':
        x, y, w, h = HUD_WIN[0] + 12, HUD_WIN[1] + 12, HUD_WIN[2] - 24, HUD_WIN[3] - 24
        top_hero(c, P, st, (x, y + 4, w, 118), lw=1.4, up=False)
        overlay_text(c, P, st, (x, y + 4, w, 118), 24)
        hud_row(c, P, st, (x, y + 150, w, h - 150))
    else:
        centre_frame(c, P, st)
        top_line(c, P, st, (90, 70, 640), 34)
        top_hero(c, P, st, (110, 200, 600, 240), lw=1.4, up=False)
        overlay_text(c, P, st, (90, 200, 640, 240), 38)


def hud_row(c, P, st, box):
    x, y, w, h = box
    cb = cruise_bits(st, P)
    if st['warn']:
        c.text(x, y + 40, 'Увага', 'wordb', 34, P['ink'])
    elif st['data'] == 'ok':
        c.text(x, y + 40, WORDS[st['tgt']], 'word', 32, gap_colour(st, P))
        cw = closing_word(st)
        if cw:
            c.text(x, y + 76, cw, 'word', 24, gap_colour(st, P))
    if cb:
        fig, label, col = cb
        c.text(x + w, y + 50, fig, 'fig', 62, col, anchor='rs')
        tw = c.tw(fig, 'fig', 62)
        c.text(x + w - tw - 12, y + 48, label, 'word', 22, col, anchor='rs')
    else:
        c.text(x + w, y + 46, 'круїз вимкнено', 'word', 22, P['dim'], anchor='rs')
    if st['adv']:
        c.text(x + w, y + 88, 'порада ' + str(st['adv']), 'word', 24, P['cyan'], anchor='rs')


# ------------------------------------------------------------------------------------------------ the centre screen's frame
def centre_frame(c, P, st):
    W, H = c.w, c.h
    c.rrect(0, 0, W, 52, r=0, fill=P['panel'])
    c.text(32, 36, 'Авто попереду і круїз', 'wordb', 28, P['ink'])
    c.text(W - 32, 36, 'лише показ', 'word', 22, P['dim'], anchor='rs')
    # the data column
    x0, x1, y = 860, W - 48, 104
    rows = []
    rows.append(('Авто попереду', state_word(st) if st['data'] != 'ok' else WORDS[st['tgt']], gap_colour(st, P) if st['data'] == 'ok' else P['dim']))
    clo = '—' if st['data'] != 'ok' else ('швидке' if st['clo'] == 2 else 'так' if st['clo'] else 'ні')
    rows.append(('Наближення', clo, P['amber'] if st['clo'] == 2 and st['data'] == 'ok' else P['ink']))
    cb = cruise_bits(st, P)
    rows.append(('Круїз', (cb[1] + ' · ' + cb[0] + ' км/год') if cb else 'вимкнено', cb[2] if cb else P['dim']))
    rows.append(('Порада циклу', (str(st['adv']) + ' км/год') if st['adv'] else '—', P['cyan'] if st['adv'] else P['dim']))
    rows.append(('Попередження авто', 'активне' if st['warn'] else 'немає', P['ink'] if st['warn'] else P['dim']))
    cam = {'ok': 'свіжі', 'none': 'свіжі, цілі немає', 'stale': 'застаріли (2 с)', 'absent': 'не надходять'}[st['data']]
    rows.append(('Дані камери', cam, P['dim'] if st['data'] != 'ok' else P['ink']))
    for i, (k, v, col) in enumerate(rows):
        yy = y + i * 62
        c.text(x0, yy + 30, k, 'word', 24, P['dim'])
        c.text(x1, yy + 30, v, 'wordb' if (k == 'Попередження авто' and st['warn']) else 'word', 28, col, anchor='rs')
        c.line([(x0, yy + 46), (x1, yy + 46)], mix(P['ink'], 0.10, P['bg']), 1.0)
    c.text(x0, H - 22, 'Застосунок лише читає дані й малює; в автомобіль нічого не пише.', 'word', 18, P['dim'])
    c.line([(800, 76), (800, H - 40)], mix(P['ink'], 0.10, P['bg']), 1.0)


LAYOUTS = {'A': lane_layout, 'B': ladder_layout, 'C': arc_layout, 'D': top_layout}


def render(direction, placement, st, night):
    pw, ph = [(p[1], p[2]) for p in PLACEMENTS if p[0] == placement][0]
    P = palette(placement, night)
    c = Cv(pw, ph, P['bg'])
    LAYOUTS[direction](c, P, st, placement)
    im = c.out()
    if st['warn']:
        # the car's own warning: our picture steps back (35 %), only the word "Увага" stays at full
        bg = Image.new('RGB', im.size, P['bg'])
        dimmed = Image.blend(bg, im, 0.35)
        dimmed.paste(im, (0, 0), word_mask(direction, placement, P, st))
        im = dimmed
    return im


def word_mask(direction, placement, P, st):
    """Where the word "Увага" (and the centre screen's warning row) is drawn: that part stays at full brightness. The same
    layout is drawn again into a grey mask with every drawing call switched off except those two texts."""
    pw, ph = [(p[1], p[2]) for p in PLACEMENTS if p[0] == placement][0]
    c = Cv(pw, ph, (0, 0, 0))
    c.im = Image.new('L', (pw * S, ph * S), 0)
    c.d = ImageDraw.Draw(c.im)
    _only_warn[0] = True
    try:
        LAYOUTS[direction](c, P, st, placement)
    finally:
        _only_warn[0] = False
    return c.im.resize((pw, ph), Image.LANCZOS).point(lambda v: 255 if v > 8 else 0)


_only_warn = [False]
_orig_text = Cv.text


def _text(self, x, y, s, kind, size, col, anchor='ls'):
    if _only_warn[0]:
        if not (s.startswith('Увага') or s == 'активне'):
            return
        col = 255
    _orig_text(self, x, y, s, kind, size, col, anchor)


Cv.text = _text
for _name in ('poly', 'line', 'rrect', 'ellipse', 'arc'):
    _f = getattr(Cv, _name)

    def _wrap(f):
        def g(self, *a, **k):
            if _only_warn[0]:
                return None
            return f(self, *a, **k)
        return g
    setattr(Cv, _name, _wrap(_f))


# ------------------------------------------------------------------------------------------------ context: the map target seen through a theme's window
def map_in_context(pic, theme, night, src):
    """The map-target picture placed on the panel at the slot's assumed place (416, 140), seen through the theme's window."""
    if theme == 'twin':
        f = os.path.join(src, 'car-issues', 'pub', 'MW', 'mw_%s_noroad_slot.png' % ('night' if night else 'day'))
        if not os.path.isfile(f):
            return None
        frame = Image.open(f).convert('RGB').crop((0, 40, 1920, 760))
        mask = Image.new('L', (1920, 720), 0)
        ImageDraw.Draw(mask).rectangle([700, 173, 1219, 599], fill=255)          # W2 as built (a hard cut)
    else:
        f = os.path.join(src, 'shots', '20261118-2239', 'C-scenarios', 'comfort', '02-motorway-130-nopass.png')
        if not os.path.isfile(f):
            return None
        frame = Image.open(f).convert('RGB')
        if night:
            frame = Image.blend(Image.new('RGB', frame.size, (0, 0, 0)), frame, 0.72)
        mask = Image.new('L', (1920, 720), 0)
        px = mask.load()
        x0, y0, x1, y1 = 750, 180, 1170, 564                                       # f30's map window, fades 120 / 80 / 80 (CAR3-H)
        for yy in range(y0, y1):
            for xx in range(x0, x1):
                a = min(1.0, (yy - y0) / 120.0, (xx - x0) / 80.0, (x1 - xx) / 80.0, (y1 - yy) / 80.0)
                if a > 0:
                    px[xx, yy] = int(255 * a)
    layer = frame.copy()
    layer.paste(pic, (416, 140))
    return Image.composite(layer, frame, mask)


# ------------------------------------------------------------------------------------------------ sheets and the index
def sheet(cells, cols, title, cell_w):
    """cells: [(image, caption)]. One contact sheet, each cell scaled to cell_w, a caption under it."""
    if not cells:
        return None
    ims = [im for im, _ in cells]
    scale = cell_w / float(ims[0].width)
    ch = int(ims[0].height * scale)
    rows = (len(cells) + cols - 1) // cols
    pad, cap, head = 10, 26, 44
    W = cols * (cell_w + pad) + pad
    H = head + rows * (ch + cap + pad) + pad
    out = Image.new('RGB', (W, H), (26, 27, 31))
    d = ImageDraw.Draw(out)
    d.text((pad, 12), title, font=font('word', 22), fill=(230, 230, 230))
    for i, (im, capt) in enumerate(cells):
        r, k = divmod(i, cols)
        x = pad + k * (cell_w + pad)
        y = head + r * (ch + cap + pad)
        out.paste(im.resize((cell_w, ch), Image.LANCZOS), (x, y))
        d.text((x + 2, y + ch + 4), capt, font=font('word', 16), fill=(200, 200, 200))
    return out


def guides(placement):
    """One picture per placement with the parts that reach the eye drawn in (for the sheets and the spec)."""
    pw, ph = [(p[1], p[2]) for p in PLACEMENTS if p[0] == placement][0]
    im = Image.new('RGB', (pw, ph), (0, 0, 0))
    d = ImageDraw.Draw(im)
    f = font('word', 18)
    if placement == 'map':
        for (x, y, w, h), col, s in ((MAP_W2, (90, 160, 255), "Twin Dial's W2"), (MAP_F30, (120, 220, 120), "f30's map window"),
                                     (MAP_CORE, (240, 170, 10), 'the core: every essential element'),
                                     (MAP_F30_FULL, (220, 120, 220), "f30: full level")):
            d.rectangle([x, y, x + w - 1, y + h - 1], outline=col, width=2)
            d.text((x + 6, y + h - 26 if s.startswith('the core') else y + 6), s, font=f, fill=col)
        d.rectangle([0, 0, pw - 1, ph - 1], outline=(110, 110, 110), width=1)
        d.text((8, ph - 28), 'map target 1088 x 480 (slot 0x100); on the stock cluster about x 124-984 shows between the dials', font=f, fill=(170, 170, 170))
    elif placement == 'hud':
        x, y, w, h = HUD_WIN
        d.rectangle([x, y, x + w - 1, y + h - 1], outline=(240, 170, 10), width=2)
        d.text((x + 6, y + 6), 'the window seen through the windshield (X3; the G20 is not measured)', font=f, fill=(240, 170, 10))
        d.rectangle([0, 0, pw - 1, ph - 1], outline=(110, 110, 110), width=1)
    else:
        d.rectangle([0, 0, pw - 1, ph - 1], outline=(110, 110, 110), width=1)
        d.text((10, 10), 'the canvas 1600 x 520: no slot, no other app; shown only while the driver opens the app', font=f, fill=(170, 170, 170))
    return im


INDEX = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ACC view mockups</title>
<style>
:root { --bg:#16171a; --fg:#e8e8ea; --dim:#9a9ca3; --line:#2c2e33; --acc:#56c0ec; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.45 system-ui, sans-serif; }
header { padding:16px; border-bottom:1px solid var(--line); }
h1 { font-size:20px; margin:0 0 6px; } p { margin:4px 0; color:var(--dim); max-width:1100px; }
.bar { display:flex; flex-wrap:wrap; gap:8px; padding:10px 16px; position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); z-index:2; }
.bar label { color:var(--dim); } select, button { background:#22242a; color:var(--fg); border:1px solid #3a3d44; border-radius:6px; padding:5px 8px; font:inherit; }
main { padding:16px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(330px, 1fr)); gap:14px; }
figure { margin:0; background:#0d0e10; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
figure img { display:block; width:100%; height:auto; cursor:zoom-in; }
figcaption { padding:6px 9px; font-size:13px; color:var(--dim); } figcaption b { color:var(--fg); font-weight:600; }
h2 { font-size:16px; margin:22px 0 10px; } .sheets a { color:var(--acc); margin-right:14px; }
#zoom { position:fixed; inset:0; background:rgba(0,0,0,.92); display:none; align-items:center; justify-content:center; z-index:5; }
#zoom img { max-width:96vw; max-height:92vh; } #zoom.on { display:flex; }
@media (max-width:600px) { .grid { grid-template-columns:1fr; } }
</style></head><body>
<header><h1>ACC view: a park of mockups (round 1120, package AA)</h1>
<p>A separate read-only app for the cruise and the vehicle ahead. Four directions x three placements x 14 states, day and night. Every picture is drawn from geometry with the repository's own OFL fonts; no other maker's artwork. The gap is shown as a measured level (no metres until a calibrated drive); "closing" comes from the gap's change; the loop's set speed is a suggestion (cyan outline); the car's own collision warning dims our picture.</p>
<p class="sheets" id="sheets"></p></header>
<div class="bar">
<label>Direction <select id="fd"></select></label>
<label>Placement <select id="fp"></select></label>
<label>State <select id="fs"></select></label>
<label>Light <select id="fl"><option value="">both</option><option>day</option><option>night</option></select></label>
</div>
<main><div id="out"></div></main>
<div id="zoom"><img alt=""></div>
<script>
const M = __MANIFEST__;
const $ = (id) => document.getElementById(id);
function opts(sel, items, all) { sel.innerHTML = '<option value="">' + all + '</option>' + items.map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join(''); }
opts($('fd'), M.directions.map((d) => [d.id, d.id + ' ' + d.name]), 'all');
opts($('fp'), M.placements.map((p) => [p.id, p.id]), 'all');
opts($('fs'), M.states.map((s) => [s.n, s.n + ' ' + s.en]), 'all');
$('sheets').innerHTML = 'Contact sheets: ' + M.sheets.map((s) => '<a href="' + s.file + '">' + s.title + '</a>').join('');
function draw() {
  const fd = $('fd').value, fp = $('fp').value, fs = $('fs').value, fl = $('fl').value;
  let html = '';
  if (!fd && !fp && !fs && !fl && M.context.length) {
    html += '<h2>The map target in context (through Twin Dial\'s and f30_cluster\'s map windows)</h2><div class="grid">' +
      M.context.map((c) => '<figure><img loading="lazy" src="' + c.file + '" alt="' + c.title + '"><figcaption>' + c.title + '</figcaption></figure>').join('') + '</div>';
  }
  if (!fd && !fp && !fs && M.skeleton && M.skeleton.length) {
    html += '<h2>The skeleton app\'s own picture (direction B without words, 420 x 372 on the map target; the bench draws exactly this)</h2><div class="grid">' +
      M.skeleton.filter((f) => !fl || f.indexOf('_' + fl + '.png') > 0).map((f) => '<figure><img loading="lazy" src="' + f + '" alt=""><figcaption>' + f.replace('skeleton/', '').replace('.png', '') + '</figcaption></figure>').join('') + '</div>';
  }
  M.directions.filter((d) => !fd || d.id === fd).forEach((d) => {
    M.placements.filter((p) => !fp || p.id === fp).forEach((p) => {
      const items = M.images.filter((i) => i.d === d.id && i.p === p.id && (!fs || i.n === fs) && (!fl || i.l === fl));
      if (!items.length) return;
      html += '<h2>' + d.id + ' ' + d.name + ' — ' + p.id + ' <span style="color:var(--dim);font-weight:400">' + p.about + '</span></h2><div class="grid">' +
        items.map((i) => { const s = M.states.find((x) => x.n === i.n); return '<figure><img loading="lazy" src="' + i.file + '" alt="' + s.en + '"><figcaption><b>' + s.n + ' ' + s.en + '</b> · ' + s.uk + ' · ' + i.l + '</figcaption></figure>'; }).join('') + '</div>';
    });
  });
  $('out').innerHTML = html;
}
['fd', 'fp', 'fs', 'fl'].forEach((id) => $(id).addEventListener('change', draw));
document.addEventListener('click', (e) => { const z = $('zoom'); if (e.target.tagName === 'IMG' && !z.contains(e.target)) { z.querySelector('img').src = e.target.src; z.classList.add('on'); } else if (z.classList.contains('on')) z.classList.remove('on'); });
draw();
</script></body></html>
"""


def main():
    args = sys.argv[1:]
    out = os.path.join(ROOT, 'bake', 'work', 'r1120', 'pub', 'AA')
    if '--out' in args:
        out = os.path.abspath(args[args.index('--out') + 1])
    only = None
    if '--only' in args:                       # e.g. --only A:map (a quick look while drawing)
        only = args[args.index('--only') + 1]
    src = os.path.join(ROOT, 'bake', 'work')
    os.makedirs(out, exist_ok=True)
    man = dict(directions=[dict(id=d, key=k, name=n) for d, k, n in DIRECTIONS],
               placements=[dict(id=p, w=w, h=h, about=a) for p, w, h, a in PLACEMENTS],
               states=[dict(n=n, key=k, en=e, uk=u) for n, k, e, u, _ in STATES],
               images=[], sheets=[], context=[])
    shots = {}
    for d, dk, dn in DIRECTIONS:
        for p, pw, ph, _ in PLACEMENTS:
            if only and only != d + ':' + p:
                continue
            folder = os.path.join(out, 'park', d, p)
            os.makedirs(folder, exist_ok=True)
            for n, k, en, uk, st in STATES:
                for light in ('day', 'night'):
                    im = render(d, p, st, light == 'night')
                    rel = 'park/%s/%s/%s_%s_%s.png' % (d, p, n, k, light)
                    im.save(os.path.join(out, rel), optimize=True)
                    shots[(d, p, n, light)] = im
                    man['images'].append(dict(d=d, p=p, n=n, l=light, file=rel))
    if only:
        print('only', only, len(shots), 'pictures')
        return
    sd = os.path.join(out, 'sheets')
    os.makedirs(sd, exist_ok=True)
    # a sheet per direction (day / night): rows = placements, the 14 states across in two rows each
    for d, dk, dn in DIRECTIONS:
        for light in ('day', 'night'):
            cells = []
            for p, pw, ph, _ in PLACEMENTS:
                for n, k, en, uk, st in STATES:
                    cells.append((shots[(d, p, n, light)], '%s %s %s' % (p, n, k)))
            title = 'Direction %s (%s), %s: every placement x every state' % (d, dn.split(':')[0], light)
            im = sheet(cells, 7, title, 300)
            rel = 'sheets/direction_%s_%s.png' % (d, light)
            im.save(os.path.join(out, rel), optimize=True)
            man['sheets'].append(dict(file=rel, title='direction %s %s' % (d, light)))
    # a sheet per placement (day / night): rows = directions, the states across
    for p, pw, ph, about in PLACEMENTS:
        for light in ('day', 'night'):
            cells = [(guides(p), 'guides: what reaches the eye')]
            for d, dk, dn in DIRECTIONS:
                for n, k, en, uk, st in STATES:
                    cells.append((shots[(d, p, n, light)], '%s %s %s' % (d, n, k)))
            title = 'Placement %s, %s: every direction x every state (%s)' % (p, light, about)
            im = sheet(cells, 8, title, 300 if p != 'centre' else 330)
            rel = 'sheets/placement_%s_%s.png' % (p, light)
            im.save(os.path.join(out, rel), optimize=True)
            man['sheets'].append(dict(file=rel, title='placement %s %s' % (p, light)))
    # the guides
    for p, pw, ph, _ in PLACEMENTS:
        rel = 'sheets/guides_%s.png' % p
        guides(p).save(os.path.join(out, rel), optimize=True)
        man['sheets'].append(dict(file=rel, title='guides %s' % p))
    # the map target in context: two states per direction, through Twin Dial's W2 (day / night) and f30's window (day / night)
    cd = os.path.join(out, 'context')
    os.makedirs(cd, exist_ok=True)
    ctx_cells = []
    for d, dk, dn in DIRECTIONS:
        for n in ('04', '07'):
            for theme in ('twin', 'f30'):
                for light in ('day', 'night'):
                    im = map_in_context(shots[(d, 'map', n, light)], theme, light == 'night', src)
                    if im is None:
                        continue
                    rel = 'context/%s_%s_%s_%s.png' % (d, n, theme, light)
                    im.save(os.path.join(out, rel), optimize=True)
                    sname = [s for s in STATES if s[0] == n][0][2]
                    t = '%s %s, %s %s, %s' % (d, dk, 'Twin Dial W2' if theme == 'twin' else 'f30 window', light, sname)
                    man['context'].append(dict(file=rel, title=t))
                    ctx_cells.append((im.crop((400, 100, 1520, 660)), t))
    if ctx_cells:
        im = sheet(ctx_cells, 4, 'The map target in context (bench renders of our own themes; the window opened, our picture under it)', 460)
        im.save(os.path.join(out, 'sheets', 'context.png'), optimize=True)
        man['sheets'].append(dict(file='sheets/context.png', title='context'))
    # the skeleton app's own painter (tools/acc-view/app/acc_view/view.js), when its pictures were made into skeleton/
    sk = os.path.join(out, 'skeleton')
    man['skeleton'] = sorted('skeleton/' + n for n in os.listdir(sk) if n.endswith('.png')) if os.path.isdir(sk) else []
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    with open(os.path.join(out, 'index.html'), 'w') as f:
        f.write(INDEX.replace('__MANIFEST__', json.dumps(man, ensure_ascii=False)))
    print('%d pictures, %d sheets, %d context -> %s' % (len(man['images']), len(man['sheets']), len(man['context']), out))


if __name__ == '__main__':
    main()
