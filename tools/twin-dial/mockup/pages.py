#!/usr/bin/env python3
"""Twin Dial round 3, package K2: mockups of the live tab bar and the pages behind each tab (docs/AGENT-BRIEF-twin-r3.md §4 K2).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/pages.py

Writes bake/work/twin-dial/mockup/r3/ (git-ignored): one 1920 x 720 picture per state, a contact sheet per tab
(tabs_sheet, tab1_sheet .. tab5_sheet, limit_sheet) and the overview pages_sheet.png, plus index.json (every picture
with its data status). The dials come from mockup.py (package K1 owns that drawing; set K2_DIALS=<path to a mockup.py>
to render with another copy of it, e.g. K1's worktree, and K2_LOOK=<look name> for one of its band looks). No photo is read; every text is invented and neutral; the map
is a drawn stand-in that is no real place. Pictograms are the repository's own (shared/twin_icons.js) plus a few drawn
here in the same step format (OWN below).

Inputs it reads when they exist (the other packages' publications, bake/work/twin-dial/r3/pub/<PKG>/): SF tabs.json
(fill colours), the models of SM / SP / SN / SV / SC (only to label data status; see STATUS and load_models()).
"""
import importlib.util
import json
import math
import os
import re

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))


def _load_mockup():
    path = os.environ.get('K2_DIALS') or os.path.join(HERE, 'mockup.py')
    spec = importlib.util.spec_from_file_location('twin_mockup', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


M = _load_mockup()
W, H, SS = M.W, M.H, M.SS
CT, CS, R = M.CT, M.CS, M.R
OUT = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'mockup', 'r3')
PUB = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'r3', 'pub')

WHITE, RED, AMBER, GREEN = M.WHITE, M.RED, M.AMBER, M.GREEN
TAB_RED, RULE = M.TAB_RED, M.RULE
GREY2, GREY_DIM = (227, 227, 227), (150, 150, 150)
SEV = {'red': {'cell': (176, 10, 37), 'ink': (232, 40, 60), 'rule': RED},
       'warn': {'cell': AMBER, 'ink': AMBER, 'rule': AMBER},
       'info': {'cell': (111, 111, 111), 'ink': WHITE, 'rule': (231, 231, 231)}}

# ---- the frame (SPEC §6, VG layout rev 2) ---------------------------------------------------------------------------
BAR = (618, 127, 1302, 172)
SEPS5 = [744, 812, 1168, 1237]
CW = (729, 172, 1191, 613)                     # centre window
TITLE_Y, RULE_Y, RULE_X = 270, 296, (741, 1180)
BODY = (741, 300, 1180, 600)

# Tab fill per function (SF v1 §2: the colour is the tab's own; red measured on 06 here: top (45, 25, 27) -> bottom
# (150, 38, 43) in 06's sRGB, its black ~15-20; the others are the maker's convention, hypothesis). Rule = the fill's rule.
FILL = {
    'red':   ((45, 25, 27), (150, 38, 43), (210, 40, 58)),
    'amber': ((62, 40, 6), (188, 118, 12), (240, 170, 10)),
    'green': ((14, 44, 16), (44, 138, 40), (92, 190, 72)),
    'blue':  ((12, 38, 70), (28, 108, 196), (64, 152, 236)),
    'flat':  ((176, 10, 37), (176, 10, 37), (218, 16, 48)),     # today's highlight: one flat red
}
FN_COLOUR = {1: 'red', 2: 'red', 3: 'amber', 4: 'green', 5: 'blue'}

# Data status per picture element (brief §3 + SPEC §11 until the models arrive; load_models() overrides).
STATUS = {
    'clock': ('arrives', 'timeDateUTC + zone'),
    'range': ('arrives', 'statusRangeTankStatus'),
    'trip': ('unseen', 'KombiIF.statusBordcomputerAverage / TravelData (P4)'),
    'cc': ('arrives', 'KombiInterface_2.ccList; shown-now number unseen (P1)'),
    'media': ('unseen', 'HmiMediaState.playerMetadata, MediaSource (P8)'),
    'media_src': ('unseen', 'HmiMediaState.menu iconKind / MediaSource.playerType, enum only (P8)'),
    'media_icon': ('certain', 'our own pictogram, no signal'),
    'progress': ('unseen', 'trackProgress elapsed / total (ms hypothesis); n of m and play state CarPlay only'),
    'media_list': ('doubtful', 'TunerFmAmDabMetadata.dataStationList / HmiMediaState.tracks: sent on the head unit\'s request'),
    'mute': ('unseen', 'CommandControl sinkMuteStateChanged (not in this probe)'),
    'phone': ('unseen', 'DevicePresentation.deviceList: connected, roles, battery, signal (P9)'),
    'phone_icon': ('certain', 'our own pictogram, no signal'),
    'call': ('unseen', 'ConnectivityAggregator.aggregatedCallState (P9); CarPlayManager.projectedTelephonyActive'),
    'contact_kind': ('unseen', 'contactID != 0 -> Контакт, else Номер; no text read'),
    'caller_name': ('owner', 'private text, drawn only if the owner turns it on'),
    'timer': ('certain', 'our own timer from the ACTIVE edge (once the call state arrives)'),
    'mic': ('unseen', 'VoiceCallManager.micMuted'),
    'guiding': ('arrives', 'guidingState'),
    'road': ('arrives', 'currentRoad (text never drawn from life: placeholder)'),
    'turn': ('unseen', 'Guidance.nextIntersection'),
    'map': ('hypothesis', "BMW's map slot under our window (SN)"),
    'limit': ('arrives', 'speed-limit struct (f30_cluster signOf)'),
    'oil': ('arrives', 'oil temperature'),
    'coolant': ('arrives', 'CDS.statusEngineTemperature'),
    'voltage': ('unseen', 'battery voltage'),
    'boost': ('unseen', 'boost pressure'),
    'tyres': ('unseen', 'tyre pressures'),
    'doors': ('unseen', 'door and lid contacts'),
    'cruise': ('unseen', 'cruise / limiter set speed'),
    'consumption': ('unseen', 'instantaneous consumption'),
    'outside': ('arrives', 'ambient temperature'),
}
STATUS_COL = {'arrives': (60, 175, 60), 'certain': (60, 175, 60), 'owner': (190, 120, 230), 'doubtful': (225, 110, 40), 'unseen': (240, 170, 10), 'not sent': (225, 40, 50),
              'hypothesis': (120, 160, 230), 'computed': (120, 160, 230), 'mixed': (200, 200, 200)}
MODELS = {}


def load_models():
    """Read what the signal packages published. The formats are theirs; only status words are taken, and only for the
    keys named in MODEL_KEYS. Anything unexpected is left at the default (and reported)."""
    for pkg in ('SF', 'SC', 'SM', 'SP', 'SN', 'SV', 'SB'):
        d = os.path.join(PUB, pkg)
        if not os.path.exists(os.path.join(d, 'READY')):
            continue
        for fn in sorted(os.listdir(d)):
            if fn.endswith('.json'):
                try:
                    MODELS[(pkg, fn)] = json.load(open(os.path.join(d, fn)))
                except Exception as e:
                    print('model not read:', pkg, fn, e)
    print('models read:', sorted(MODELS))


# ---- pictograms: the repository's step format, rendered as distance fields ------------------------------------------
def _parse_drawings():
    src = open(os.path.join(ROOT, 'shared', 'twin_icons.js'), encoding='utf-8').read()
    out = {}
    for m in re.finditer(r'^\s+"(\w+)": (\[.*\]),?\s*$', src, re.M):
        out[m.group(1)] = json.loads(m.group(2))
    return out


def _s(k, *a, cut=False, r=None):
    d = {'k': k, 'a': list(a)}
    if cut:
        d['cut'] = True
    if r is not None:
        d['r'] = r
    return d


OWN = {   # our own drawings for this mockup (unit box, y down, angles clockwise from 12 o'clock)
    'td_car': [_s('boxo', 0.5, 0.5, 0.21, 0.43, 0.13, 0.065), _s('seg', 0.33, 0.33, 0.67, 0.33, 0.06),
               _s('seg', 0.36, 0.74, 0.64, 0.74, 0.06), _s('seg', 0.29, 0.38, 0.2, 0.41, 0.05), _s('seg', 0.71, 0.38, 0.8, 0.41, 0.05)],
    'td_gauge': [_s('arc', 0.5, 0.58, 0.36, -125, 125, 0.07), _s('seg', 0.5, 0.58, 0.7, 0.36, 0.07), _s('disc', 0.5, 0.58, 0.07)],
    'td_clock': [_s('ring', 0.5, 0.5, 0.38, 0.07), _s('seg', 0.5, 0.5, 0.5, 0.26, 0.07), _s('seg', 0.5, 0.5, 0.68, 0.6, 0.07)],
    'td_road': [_s('seg', 0.28, 0.92, 0.42, 0.1, 0.07), _s('seg', 0.72, 0.92, 0.58, 0.1, 0.07), _s('seg', 0.5, 0.82, 0.5, 0.66, 0.05),
                _s('seg', 0.5, 0.5, 0.5, 0.38, 0.05), _s('seg', 0.5, 0.24, 0.5, 0.17, 0.045)],
    'td_play': [_s('poly', [0.3, 0.18], [0.82, 0.5], [0.3, 0.82], r=0.02)],
    'td_pause': [_s('box', 0.35, 0.5, 0.08, 0.32, 0.01), _s('box', 0.65, 0.5, 0.08, 0.32, 0.01)],
    'td_handset': [_s('arc', 0.5, 0.86, 0.42, -62, 62, 0.11), _s('box', 0.16, 0.66, 0.11, 0.08, 0.04), _s('box', 0.84, 0.66, 0.11, 0.08, 0.04)],
    'td_mic_off': [_s('boxo', 0.5, 0.36, 0.12, 0.22, 0.12, 0.065), _s('arc', 0.5, 0.42, 0.25, 95, 265, 0.065),
                   _s('seg', 0.5, 0.67, 0.5, 0.86, 0.065), _s('seg', 0.36, 0.87, 0.64, 0.87, 0.065),
                   _s('seg', 0.16, 0.1, 0.84, 0.9, 0.17, cut=True), _s('seg', 0.16, 0.1, 0.84, 0.9, 0.07)],
    'td_bars': [_s('box', 0.17, 0.78, 0.07, 0.1, 0.01), _s('box', 0.39, 0.66, 0.07, 0.22, 0.01),
                _s('box', 0.61, 0.54, 0.07, 0.34, 0.01), _s('box', 0.83, 0.42, 0.07, 0.46, 0.01)],
    'td_phone_bars': [_s('boxo', 0.32, 0.5, 0.18, 0.38, 0.05, 0.065), _s('seg', 0.27, 0.21, 0.37, 0.21, 0.045),
                      _s('box', 0.66, 0.79, 0.04, 0.07, 0.01), _s('box', 0.77, 0.7, 0.04, 0.16, 0.01), _s('box', 0.88, 0.6, 0.04, 0.26, 0.01)],
    'td_phone_none': [_s('boxo', 0.5, 0.5, 0.22, 0.4, 0.06, 0.07), _s('seg', 0.44, 0.2, 0.56, 0.2, 0.045),
                      _s('seg', 0.18, 0.92, 0.82, 0.08, 0.18, cut=True), _s('seg', 0.18, 0.92, 0.82, 0.08, 0.065)],
    'td_turn_right': [_s('seg', 0.34, 0.95, 0.34, 0.52, 0.15), _s('arc', 0.6, 0.52, 0.26, 270, 360, 0.15),
                      _s('seg', 0.6, 0.26, 0.66, 0.26, 0.15), _s('poly', [0.62, 0.04], [0.95, 0.26], [0.62, 0.48], r=0.01)],
    'td_straight': [_s('seg', 0.5, 0.95, 0.5, 0.4, 0.15), _s('poly', [0.5, 0.05], [0.78, 0.42], [0.22, 0.42], r=0.01)],
    'td_flag': [_s('seg', 0.25, 0.1, 0.25, 0.92, 0.07), _s('poly', [0.27, 0.1], [0.82, 0.25], [0.27, 0.42], r=0.01)],
    'td_limit': [_s('ring', 0.5, 0.5, 0.38, 0.12)],
    'td_check': [_s('seg', 0.18, 0.52, 0.42, 0.76, 0.09), _s('seg', 0.42, 0.76, 0.84, 0.26, 0.09)],
    'td_compass': [_s('ring', 0.5, 0.5, 0.4, 0.06), _s('poly', [0.5, 0.18], [0.62, 0.52], [0.38, 0.52], r=0.0)],
    'td_dot': [_s('disc', 0.5, 0.5, 0.3)],
    'td_phone_ring': [_s('boxo', 0.5, 0.55, 0.17, 0.32, 0.05, 0.065), _s('seg', 0.45, 0.3, 0.55, 0.3, 0.04),
                      _s('arc', 0.5, 0.55, 0.31, 35, 75, 0.05), _s('arc', 0.5, 0.55, 0.42, 30, 80, 0.05),
                      _s('arc', 0.5, 0.55, 0.31, 285, 325, 0.05), _s('arc', 0.5, 0.55, 0.42, 280, 330, 0.05)],
    'td_mute': [_s('poly', [0.12, 0.38], [0.3, 0.38], [0.52, 0.16], [0.52, 0.84], [0.3, 0.62], [0.12, 0.62], r=0.02),
                _s('seg', 0.66, 0.36, 0.9, 0.64, 0.07), _s('seg', 0.66, 0.64, 0.9, 0.36, 0.07)],
}
DRAW = {}


def _seg(X, Y, ax, ay, bx, by):
    pax, pay, bax, bay = X - ax, Y - ay, bx - ax, by - ay
    h = np.clip((pax * bax + pay * bay) / ((bax * bax + bay * bay) or 1.0), 0, 1)
    return np.hypot(pax - bax * h, pay - bay * h)


def _box(X, Y, cx, cy, hw, hh, r):
    qx, qy = np.abs(X - cx) - (hw - r), np.abs(Y - cy) - (hh - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def _poly(X, Y, pts):
    d = np.full(X.shape, np.inf)
    inside = np.zeros(X.shape, bool)
    n = len(pts)
    for i in range(n):
        (xi, yi), (xj, yj) = pts[i], pts[i - 1]
        d = np.minimum(d, _seg(X, Y, xj, yj, xi, yi))
        cond = ((yi > Y) != (yj > Y)) & (X < (xj - xi) * (Y - yi) / ((yj - yi) or 1e-12) + xi)
        inside ^= cond
    return np.where(inside, -d, d)


def _step(s, X, Y):
    a, k = s['a'], s['k']
    if k == 'seg':
        return _seg(X, Y, a[0], a[1], a[2], a[3]) - a[4] / 2
    if k == 'ring':
        return np.abs(np.hypot(X - a[0], Y - a[1]) - a[2]) - a[3] / 2
    if k == 'arc':
        cx, cy, r, a0, a1, w = a[0], a[1], a[2], math.radians(a[3]), math.radians(a[4]), a[5]
        ang = np.arctan2(X - cx, -(Y - cy))
        ang = a0 + np.mod(ang - a0, 2 * math.pi)
        e0 = np.hypot(X - (cx + r * math.sin(a0)), Y - (cy - r * math.cos(a0)))
        e1 = np.hypot(X - (cx + r * math.sin(a1)), Y - (cy - r * math.cos(a1)))
        return np.where(ang <= a1, np.abs(np.hypot(X - cx, Y - cy) - r), np.minimum(e0, e1)) - w / 2
    if k == 'disc':
        return np.hypot(X - a[0], Y - a[1]) - a[2]
    if k == 'box':
        return _box(X, Y, *a[:5])
    if k == 'boxo':
        return np.abs(_box(X, Y, *a[:5])) - a[5] / 2
    if k == 'poly':
        return _poly(X, Y, a) - (s.get('r') or 0)
    raise ValueError(k)


_ALPHA = {}


def icon_alpha(name, size):
    key = (name, size)
    if key not in _ALPHA:
        if not DRAW:
            DRAW.update(_parse_drawings())
            DRAW.update(OWN)
        g = (np.arange(size) + 0.5) / size
        X, Y = np.meshgrid(g, g)
        d = np.full(X.shape, np.inf)
        for s in DRAW[name]:
            p = _step(s, X, Y)
            d = np.maximum(d, -p) if s.get('cut') else np.minimum(d, p)
        _ALPHA[key] = np.clip(0.5 - d * size, 0, 1)
    return _ALPHA[key]


def paste_sdf(img, name, size, cx, cy, color=WHITE, alpha=1.0):
    a = icon_alpha(name, size) * alpha
    x0, y0 = int(round(cx - size / 2)), int(round(cy - size / 2))
    tile = Image.new('RGBA', (size, size), tuple(color) + (0,))
    tile.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    img.paste(tile, (x0, y0), tile)


# ---- canvas -----------------------------------------------------------------------------------------------------------
_BASE = {}


class Page:
    """mockup.Canvas plus a queue of our own icons (pasted after the 3x canvas is shrunk)."""

    def __init__(self, speed=87.0, rpm=2.4, gear='D3'):
        key = (speed, rpm, gear)
        if key not in _BASE:
            cv = M.Canvas()
            cv.speed_digits = speed
            kw = {}
            if os.environ.get('K2_LOOK') and hasattr(M, 'look_named'):   # K1's band looks, when its mockup.py has them
                kw['look'] = M.look_named(os.environ['K2_LOOK'])
            cv.dial(CT, 'tach', rpm, gear, **kw)
            cv.dial(CS, 'speed', speed, **kw)
            _BASE[key] = (cv.img.copy(), list(cv.icons))
        img, icons = _BASE[key]
        self.cv = M.Canvas.__new__(M.Canvas)
        self.cv.img = img.copy()
        self.cv.d = ImageDraw.Draw(self.cv.img)
        self.cv.icons = list(icons)
        self.cv.speed_digits = speed
        self.sdf = []
        self.post = []                               # callables(img) run on the final 1x picture

    # drawing helpers in panel px
    def icon(self, name, size, cx, cy, color=WHITE, alpha=1.0):
        self.sdf.append((name, size, cx, cy, color, alpha))

    def rect(self, x0, y0, x1, y1, fill):
        self.cv.rect(x0, y0, x1, y1, fill)

    def rrect(self, x0, y0, x1, y1, r, fill=None, outline=None, width=1):
        self.cv.d.rounded_rectangle([x0 * SS, y0 * SS, x1 * SS - 1, y1 * SS - 1], radius=r * SS, fill=fill,
                                    outline=outline, width=int(round(width * SS)))

    def text(self, x, base, s, f, fill=WHITE, align='l'):
        self.cv.btext(x, base, s, f, fill, align)

    def ctext(self, xy, s, f, fill=WHITE):
        self.cv.ctext(xy, s, f, fill)

    def width(self, s, f):
        return self.cv.width(s, f)

    def vramp(self, x0, y0, x1, y1, top, bottom):
        w, h = int(round((x1 - x0) * SS)), int(round((y1 - y0) * SS))
        t = np.linspace(0, 1, h)[:, None, None]
        rgb = (np.array(top)[None, None, :] * (1 - t) + np.array(bottom)[None, None, :] * t) * np.ones((1, w, 1))
        self.cv.img.paste(Image.fromarray(rgb.astype(np.uint8)), (int(round(x0 * SS)), int(round(y0 * SS))))

    def title(self, s, right=None):
        self.ctext((960, TITLE_Y), s, M.noto(41))
        self.rect(RULE_X[0], RULE_Y - 0.8, RULE_X[1], RULE_Y + 0.7, RULE)
        if right:
            self.text(RULE_X[1], TITLE_Y + 14, right, M.noto(27), GREY2, 'r')

    def finish(self, badge=None):
        out = self.cv.img.resize((W, H), Image.LANCZOS)
        M.paste_icons(out, self.cv.icons)
        for name, size, cx, cy, color, alpha in self.sdf:
            paste_sdf(out, name, size, cx, cy, color, alpha)
        for fn in self.post:
            fn(out)
        if badge:
            draw_badge(out, *badge)
        return out


def nb(size):                                       # Noto Sans bold (numbers on the sign, headlines)
    return M.font(('notosans', 'NotoSans[wdth,wght].ttf'), size, 700, 100)


def fit(p, s, f, maxw):
    if p.width(s, f) <= maxw:
        return s
    while s and p.width(s + '…', f) > maxw:
        s = s[:-1]
    return s.rstrip() + '…'


def wrap(p, text, f, maxw, max_lines):
    lines, cur = [], ''
    for word in text.split():
        t = (cur + ' ' + word).strip()
        if p.width(t, f) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = word
    lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines - 1] + [' '.join(lines[max_lines - 1:])]
    lines[-1] = fit(p, lines[-1], f, maxw)
    return lines


_LF = {}


def lf(size, bold=False):
    k = (size, bold)
    if k not in _LF:
        _LF[k] = M.font(('notosans', 'NotoSans[wdth,wght].ttf'), size / SS, 700 if bold else 500, 100)
    return _LF[k]


def draw_badge(img, label, status):
    """The picture's name and data status, in the top-left corner (the hood hides it on the car)."""
    d = ImageDraw.Draw(img)
    f = lf(19)
    y = 10
    lines = [label] + (['data: ' + ', '.join(status)] if status else [])
    for i, line in enumerate(lines):
        d.text((14, y + i * 24), line, font=f, fill=(200, 200, 200))
    return img


# ---- the tab bar ------------------------------------------------------------------------------------------------------
def cells5():
    return [dict(id=1, x0=618, x1=744, icon='td_fuel', text='412', unit='км'),
            dict(id=2, x0=744, x1=812, icon='cc_warn'),
            dict(id=3, x0=812, x1=1168, icon='td_radio', text='Радіо Приклад'),
            dict(id=4, x0=1168, x1=1237, icon='td_phone_bars'),
            dict(id=5, x0=1237, x1=1302, icon='td_nav')]


def cells4(drop):
    c = cells5()
    if drop == 4:                                     # phone gone: media widens to the navigation cell
        c = [x for x in c if x['id'] != 4]
        c[2]['x1'] = 1237
    elif drop == 3:                                   # media gone: the wide cell carries tab 4's content
        c = [x for x in c if x['id'] != 3]
        c[2].update(x0=812, x1=1237, icon='td_phone_bars', text='Телефон 1')
    elif drop == 2:                                   # the maker's rule: no message, no warning tab
        c = [x for x in c if x['id'] != 2]
        c[1]['x0'] = 744
    return c


def tab_bar(p, cells, sel=None, style='fn', warn=None, warn_style='icon', no_msg='dim'):
    """sel: the selected tab id. style: 'fn' (each tab its own colour, SF v1), 'red' (06's red ramp for every tab),
    'flat' (today's flat red). warn: None or a severity ('red', 'warn', 'info'); warn_style when tab 2 is NOT selected:
    'icon' (the triangle in the severity colour) or 'cell' (today: the cell filled with it). no_msg: tab 2 with no
    message: 'dim' (icon at 0.4), 'white', 'hidden' (empty cell)."""
    x0, y0, x1, y1 = BAR
    L = np.linspace(0.002, 0.16, int((y1 - y0) * SS))[:, None] * np.ones((1, int((x1 - x0) * SS)))
    p.cv.img.paste(Image.fromarray(np.stack([M.srgb(L)] * 3, -1).astype(np.uint8)), (x0 * SS, y0 * SS))
    p.rect(x0, 171.2, x1, 172.7, (237, 237, 237))
    for c in cells:
        fill = None
        if c['id'] == sel:
            fill = FILL['flat'] if style == 'flat' else FILL['red'] if style == 'red' else FILL[c.get('fn') or FN_COLOUR[c['id']]]
            if c['id'] == 2 and style == 'sev' and warn:
                fill = {'red': FILL['red'], 'warn': FILL['amber'], 'info': ((40, 40, 40), (111, 111, 111), (231, 231, 231))}[warn]
        elif c['id'] == 2 and warn and warn_style == 'cell':
            col = SEV[warn]['cell']
            fill = (col, col, SEV[warn]['rule'])
        if fill:
            p.vramp(c['x0'], y0, c['x1'], 171.2, fill[0], fill[1])
            p.rect(c['x0'], 170.6, c['x1'], 172.9, fill[2])
    for c in cells[1:]:
        p.rect(c['x0'], y0, c['x0'] + 1, 171.2, (0, 0, 0))
        p.rect(c['x0'] + 1, y0, c['x0'] + 2, 171.2, (96, 96, 96))
    for c in cells:
        col, alpha = WHITE, 1.0
        if c['id'] == 2:
            if warn and sel != 2 and warn_style == 'icon':
                col = SEV[warn]['ink']
            elif warn and warn_style == 'cell' and sel != 2 and warn == 'warn':
                col = (0, 0, 0)
            elif not warn:
                if no_msg == 'hidden':
                    continue
                alpha = 0.4 if no_msg == 'dim' else 1.0
        if c.get('dim'):
            alpha = 0.45
        if c.get('ink') and c['id'] != sel:
            col = c['ink']
        text = c.get('text')
        if text:
            f, fu = (M.noto(31), M.noto(19)) if c['id'] == 1 else (M.noto(33), None)
            if c['id'] == 1:
                tw = p.width(text, f) + 3 + p.width(c['unit'], fu)
                gx = c['x0'] + 18
                p.icon(c['icon'], 38, gx + 0, 143, col, alpha)
                p.text(gx + 18, 156, text, f, WHITE)
                p.text(gx + 18 + p.width(text, f) + 3, 156, c['unit'], fu, WHITE)
            else:
                maxw = c['x1'] - c['x0'] - (110 if c.get('mark') else 70)
                text = fit(p, text, f, maxw)
                tw = 38 + 8 + p.width(text, f)
                gx = (c['x0'] + c['x1'] - (44 if c.get('mark') else 0)) / 2 - tw / 2
                p.icon(c['icon'], 38, gx + 19, 143, col, alpha)
                p.text(gx + 46, 156, text, f, WHITE)
        else:
            p.icon(c['icon'], 38, (c['x0'] + c['x1']) / 2 + 1, 143, col, alpha)
        if c.get('mark'):
            p.icon(c['mark'], 28, c['x1'] - 22, 143, WHITE)


# ---- the bottom row ---------------------------------------------------------------------------------------------------
def bottom_row(p, lines=2, limit_a=None):
    """lines=2: today's row (odometer, trip / clock, temperature) - SF v1 §6: only while tab 1 shows. lines=1: clock and
    outside temperature on one line (the references with another tab selected)."""
    p.rect(629, 612.4, 1291, 614.6, RULE)
    if lines == 2:
        for x, base, num, unit in ((846, 656, '48 215', 'км'), (1153, 656, '412.6', 'км'), (846, 703, '14:43', ''), (1153, 703, '+7.5', '°C')):
            p.text(x, base, num, M.noto(40), WHITE, 'r')
            if unit:
                p.text(x + 5, base, unit, M.noto(21), WHITE, 'l')
    else:
        p.text(846, 680, '14:43', M.noto(40), WHITE, 'r')
        p.text(1153, 680, '+7.5', M.noto(40), WHITE, 'r')
        p.text(1158, 680, '°C', M.noto(21), WHITE, 'l')
    if limit_a:
        sign(p, LIMIT_A[0], LIMIT_A[1], LIMIT_A[2], limit_a)


def bmw_panel(p):
    """BMW's message panel as the bench draws it (tools/shots/twin/backdrop.py): the fallback polygon, grey, labelled."""
    poly = json.load(open(os.path.join(ROOT, 'design', 'twin-dial', 'vf', 'message_panel.json')))['fallback_window']['polygon_px']
    p.cv.d.polygon([(x * SS, y * SS) for x, y in poly], fill=(70, 78, 90))
    p.ctext((946, 652), 'BMW MESSAGE PANEL', nb(28), (240, 240, 240))


# ---- speed limit ------------------------------------------------------------------------------------------------------
LIMIT_A = (1290, 667, 28)          # (a) right end of the bottom row: between BMW's panel (x <= 1226) and the ring foot
LIMIT_C = (1540, 524, 25)          # (c) under the unit in the speedometer hub; the black box is y 342-419


def sign(p, cx, cy, r, value):
    p.cv.d.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], fill=(230, 20, 40))
    ri = r * 0.80
    p.cv.d.ellipse([(cx - ri) * SS, (cy - ri) * SS, (cx + ri) * SS, (cy + ri) * SS], fill=(250, 250, 250))
    p.ctext((cx, cy + r * 0.02), str(value), nb(int(round(r * (0.95 if value < 100 else 0.78)))), (0, 0, 0))


def limit_marker(p, value):
    """(b) a red marker on the speedometer's bezel at the limit, pointing in (shader in the build)."""
    a = M.spd_angle(value)
    tip = p.cv.polar(CS, a, R + 2)
    t = math.radians(a)
    ux, uy, nx, ny = math.sin(t), -math.cos(t), math.cos(t), math.sin(t)
    b = (CS[0] + (R + 28) * ux, CS[1] + (R + 28) * uy)
    p.cv.poly([tip, (b[0] + 12 * nx, b[1] + 12 * ny), (b[0] - 12 * nx, b[1] - 12 * ny)], (230, 20, 40))
    p.cv.radial(CS, a, 0.893 * R, 0.94 * R, 0.022 * R, (230, 20, 40))


# ---- tab 1: the on-board computer ------------------------------------------------------------------------------------
def page_dots(p, n, i):
    for k in range(n):
        x = 960 + (k - (n - 1) / 2) * 20
        col = WHITE if k == i else (90, 90, 90)
        p.cv.d.ellipse([(x - 4) * SS, (588 - 4) * SS, (x + 4) * SS, (588 + 4) * SS], fill=col)


def pg_clock(p, dots=True):
    p.title('Дата і час')
    p.ctext((960, 372), '14:43', M.saira(92))
    p.ctext((960, 450), 'вівторок', M.noto(39))
    p.ctext((960, 505), '17.11.2026', M.noto(39))
    if dots:
        page_dots(p, 3, 0)


def pg_trip(p, which=1, dots=True):
    if which == 1:
        p.title('Поточна поїздка')
        rows = [('td_fuel', 'ø 6.8', 'л/100 км'), ('td_gauge', 'ø 41', 'км/год'), ('td_road', '12.4', 'км'), ('td_clock', '0:43', 'год')]
        foot = 'від початку поїздки, 14:00'
    else:
        p.title('Тривалий період')
        rows = [('td_fuel', 'ø 7.4', 'л/100 км'), ('td_gauge', 'ø 52', 'км/год'), ('td_road', '1 284', 'км'), ('td_clock', '24:37', 'год')]
        foot = 'з 02.11.2026'
    for k, (ic, num, unit) in enumerate(rows):          # 02's grammar: an icon in front of each row
        base = 352 + k * 52
        p.icon(ic, 34, 838, base - 13)
        p.text(1010, base, num, M.noto(39), WHITE, 'r')
        p.text(1017, base, unit, M.noto(21), WHITE, 'l')
    p.ctext((960, 553), foot, M.noto(29), GREY2)
    if dots:
        page_dots(p, 3, which)


# ---- tab 2: messages --------------------------------------------------------------------------------------------------
MSG = {
    ('info', 1): ('cc_door', 'Двері відчинено'),
    ('info', 2): ('cc_door', 'Водійські двері відчинено'),
    ('warn', 1): ('cc_tyre', 'Тиск у шинах'),
    ('warn', 2): ('cc_tyre', 'Тиск у шинах: перевірте колеса'),
    ('red', 1): ('cc_brake', 'Гальма: зупиніться'),
    ('red', 2): ('cc_coolant', 'Двигун перегрівся: зупиніться'),
}


def pg_card(p, sev, lines, layout='centre', counter='1/2'):
    """The message card (tab 2). layout 'centre': the symbol large and centred, coloured by severity, the headline under
    it; 'cell': today's plate grammar moved up - a severity-filled cell left, the headline right of it."""
    sym, text = MSG[(sev, lines)]
    p.title('Повідомлення', counter)
    if layout == 'centre':
        p.icon(sym, 96, 960, 370, SEV[sev]['ink'])
        f = M.noto(42)
        ls = wrap(p, text, f, 430, 2)
        bases = [486] if len(ls) == 1 else [470, 520]
        for b, s in zip(bases, ls):
            p.text(960, b, s, f, WHITE, 'c')
    else:
        cell = SEV[sev]['cell']
        if sev == 'info':
            p.vramp(745, 336, 849, 440, (0, 0, 0), (111, 111, 111))
        else:
            p.rect(745, 336, 849, 440, cell)
        p.icon(sym, 66, 797, 388, (0, 0, 0) if sev == 'warn' else WHITE)
        f = M.noto(42)
        ls = wrap(p, text, f, 311, 3)
        b0 = 403 - (len(ls) - 1) * 25
        for k, s in enumerate(ls):
            p.text(869, b0 + k * 50, s, f, WHITE)


def pg_list(p):
    p.title('Повідомлення', '3')
    rows = [('red', 'cc_coolant', 'Двигун перегрівся', True, True), ('warn', 'cc_tyre', 'Тиск у шинах', False, True),
            ('info', 'cc_door', 'Двері відчинено', False, True)]
    stored = [('info', 'cc_service', 'Сервіс: через 1 200 км'), ('info', 'cc_washer', 'Рідина омивача: мало')]
    y = 336
    for sev, sym, text, now, active in rows:
        if now:                                         # 10's selection bar: the row the car shows now
            p.rrect(743, y - 26, 1170, y + 26, 6, fill=(52, 54, 58), outline=(220, 220, 220), width=1.5)
        p.icon(sym, 36, 778, y, SEV[sev]['ink'])
        p.text(808, y + 12, fit(p, text, M.noto(33), 350), M.noto(33), WHITE)
        y += 58
    p.text(745, y + 2, 'збережені', M.noto(21), (150, 150, 150))
    p.rect(820, y - 5, 1170, y - 4, (80, 80, 80))
    y += 36
    for sev, sym, text in stored:
        p.icon(sym, 30, 778, y, (150, 150, 150))
        p.text(808, y + 10, fit(p, text, M.noto(29), 350), M.noto(29), (150, 150, 150))
        y += 46
    p.rect(1182, 312, 1184, 590, (70, 70, 70))          # 05 / SF: the scroll bar on the right margin
    p.rect(1181, 312, 1185, 440, (220, 220, 220))


def pg_empty(p):
    p.title('Повідомлення')
    p.icon('td_check', 66, 960, 395, (150, 150, 150))
    p.ctext((960, 478), 'Повідомлень немає', M.noto(39), GREY2)


# ---- tab 3 / 4: media, phone, alternatives ----------------------------------------------------------------------------
def progress(p, x0, x1, y, frac, left, right):
    p.rect(x0, y - 2, x1, y + 2, (80, 80, 80))
    p.rect(x0, y - 2, x0 + (x1 - x0) * frac, y + 2, WHITE)
    p.text(x0, y + 32, left, M.noto(25), GREY2)
    p.text(x1, y + 32, right, M.noto(25), GREY2, 'r')


def pg_radio(p):
    """SM M2 (unseen): band in the title, station name, radio text, small facts."""
    p.title('Радіо', 'FM')
    p.icon('td_radio', 66, 960, 362)
    p.ctext((960, 445), 'Радіо Приклад', M.noto(42))
    p.ctext((960, 495), "Новини о дев'ятій", M.noto(31), GREY2)
    p.ctext((960, 548), 'P3  ·  101.7  ·  TP', M.noto(27), (170, 170, 170))


def pg_track(p, cover=False):
    """SM M1 (unseen): source in the title, title large, artist, progress with n of m; play state CarPlay only.
    cover=True: the one alternative with a neutral cover place (SM: cover art possible later, not this round)."""
    p.title('Медіа', 'USB')
    x = 760
    if cover:
        p.rrect(745, 322, 885, 462, 6, fill=(44, 46, 50))
        p.icon('td_media', 56, 815, 384, (140, 140, 140))
        p.ctext((815, 446), 'обкладинка (пізніше)', M.noto(15), (150, 150, 150))
        x = 905
    f = M.noto(42 if not cover else 36)
    if cover:
        p.text(x, 372, fit(p, 'Ранкова хвиля', f, 1176 - x), f, WHITE)
        p.text(x, 420, fit(p, 'Гурт Приклад', M.noto(31), 1176 - x), M.noto(31), GREY2)
    else:
        p.ctext((960, 372), 'Ранкова хвиля', f)
        p.ctext((960, 428), 'Гурт Приклад', M.noto(33), GREY2)
    progress(p, 745, 1176, 510, 0.28, '1:01', '3:35')
    p.text(960, 542, '4 / 12', M.noto(25), (170, 170, 170), 'c')
    p.icon('td_play', 24, 960, 578, (170, 170, 170))


def pg_media_min(p):
    """SM M3 (certain): our pictogram and the word; nothing that needs a signal."""
    p.title('Медіа')
    p.icon('td_media', 110, 960, 400)
    p.ctext((960, 510), 'Медіа', M.noto(42))


def pg_media_src(p):
    """SM M3 + the optional source line (enum only, our own words)."""
    p.title('Медіа')
    p.icon('td_media', 96, 960, 385)
    p.ctext((960, 482), 'Bluetooth', M.noto(42))
    p.ctext((960, 532), 'джерело (лише тип)', M.noto(25), (150, 150, 150))


def pg_media_list(p, kind='stations'):
    """SM: the station list (M2 list) or the track window (M4) - both unseen and doubtful."""
    if kind == 'stations':
        p.title('Радіо · станції', 'FM')
        rows = [('Радіо Приклад', '101.7'), ('Друга станція', '91.7'), ('Третя станція', '95.4'), ('Станція чотири', '99.1'),
                ("П'ята станція", '102.8')]
    else:
        p.title('Медіа · список', 'USB')
        rows = [('Ранкова хвиля', '4'), ('Друга композиція', '5'), ('Третя композиція', '6'), ('Четверта композиція', '7'),
                ("П'ята композиція", '8')]
    y = 334
    for k, (s, r) in enumerate(rows):
        if k == 0:
            p.rrect(743, y - 24, 1170, y + 24, 6, fill=(52, 54, 58), outline=(220, 220, 220), width=1.5)
        p.text(770, y + 11, s, M.noto(31), WHITE if k == 0 else GREY2)
        p.text(1160, y + 11, r, M.noto(25), (170, 170, 170), 'r')
        y += 52
    p.rect(1182, 312, 1184, 590, (70, 70, 70))
    p.rect(1181, 312, 1185, 400, (220, 220, 220))


def pg_phone_idle(p, extras=True):
    """SP P0 (unseen): connected + role, battery, signal; optional missed-call count and charging. No device name."""
    p.title('Телефон')
    p.icon('td_phone', 70, 960, 358)
    p.ctext((960, 432), 'Підключено · CarPlay', M.noto(36))
    p.icon('cc_battery', 30, 852, 482)
    p.rect(876, 480, 976, 486, (60, 60, 60))
    p.rect(876, 480, 956, 486, WHITE)
    p.text(986, 492, '80 %', M.noto(25), GREY2)
    p.icon('td_bars', 26, 1062, 482)
    p.text(1080, 492, '3/4', M.noto(25), GREY2)
    if extras:
        p.ctext((960, 538), 'Пропущені: 2   ·   На зарядці', M.noto(27), (170, 170, 170))


def pg_phone_certain(p):
    """SP P3 (certain): the pictogram and the word; nothing else."""
    p.title('Телефон')
    p.icon('td_phone', 110, 960, 400)
    p.ctext((960, 510), 'Телефон', M.noto(42))


def pg_phone_call(p, state, who='a'):
    """SP P1 incoming / P2 active / P4 ended. who: (a) 'Контакт' / 'Номер' from contactID (no text read),
    (b) the caller's name (owner setting, off by default), (c) nothing."""
    line = {'a': 'Контакт', 'b': "Ім'я Прізвище", 'c': None}[who]
    if state == 'incoming':
        p.title('Вхідний дзвінок')
        p.icon('td_phone_ring', 96, 960, 368, (90, 200, 80))
        if line:
            p.ctext((960, 470), line, M.noto(42))
        p.ctext((960, 535 if line else 490), 'Прийняти: кнопка телефону на кермі', M.noto(25), (170, 170, 170))
        p.rrect(1086, 310, 1176, 338, 6, outline=(150, 150, 150), width=1.2)
        p.text(1131, 331, 'CarPlay', M.noto(19), (170, 170, 170), 'c')
    elif state == 'active':
        p.title('Розмова')
        p.icon('td_handset', 70, 960, 350)
        p.ctext((960, 440), '02:37', M.saira(64))
        if line:
            p.ctext((960, 510), line, M.noto(36), GREY2)
        p.icon('td_mic_off', 30, 960, 563, (170, 170, 170))
    else:
        p.title('Дзвінок завершено')
        p.icon('td_handset', 70, 960, 380, (150, 150, 150))
        p.ctext((960, 470), '02:41', M.saira(64), GREY2)
        p.ctext((960, 535), 'повернення за 3 с', M.noto(25), (150, 150, 150))


def hbar(p, y, label, icon, value, unit, frac, warn=False, status=None):
    p.icon(icon, 34, 762, y - 12)
    p.text(790, y, label, M.noto(27), GREY2)
    p.text(1110, y, value, M.noto(33), WHITE, 'r')
    p.text(1115, y, unit, M.noto(21), WHITE)
    p.rect(790, y + 12, 1176, y + 17, (60, 60, 60))
    p.rect(790, y + 12, 790 + 386 * frac, y + 17, RED if warn else WHITE)


def pg_tech(p):
    p.title('Автомобіль')
    hbar(p, 350, 'Олива', 'cc_oil', '98', '°C', 0.62)
    hbar(p, 412, 'Охолодження', 'cc_coolant', '90', '°C', 0.55)
    hbar(p, 474, 'Акумулятор', 'cc_battery', '14.2', 'В', 0.7)
    hbar(p, 536, 'Наддув', 'td_gauge', '0.8', 'бар', 0.35)


def draw_car(p, cx, cy, s, door_open=None):
    """Our own top-view car (front up), s = length in px. door_open: 'fl' draws the driver's door swung out, red."""
    w = s * 0.45
    x0, y0, x1, y1 = cx - w / 2, cy - s / 2, cx + w / 2, cy + s / 2
    body, glass, edge = (196, 198, 202), (40, 44, 50), (120, 122, 126)
    for wx, wy in ((x0 - 3, y0 + s * 0.16), (x1 - 9, y0 + s * 0.16), (x0 - 3, y1 - s * 0.3), (x1 - 9, y1 - s * 0.3)):
        p.rrect(wx, wy, wx + 12, wy + s * 0.14, 3, fill=(30, 30, 30))
    p.rrect(x0, y0, x1, y1, w * 0.35, fill=body, outline=edge, width=1.5)
    p.cv.d.polygon([((x0 + w * 0.12) * SS, (y0 + s * 0.30) * SS), ((x1 - w * 0.12) * SS, (y0 + s * 0.30) * SS),
                    ((x1 - w * 0.18) * SS, (y0 + s * 0.40) * SS), ((x0 + w * 0.18) * SS, (y0 + s * 0.40) * SS)], fill=glass)
    p.rrect(x0 + w * 0.18, y0 + s * 0.42, x1 - w * 0.18, y0 + s * 0.70, 6, fill=(150, 152, 156))
    p.cv.d.polygon([((x0 + w * 0.18) * SS, (y0 + s * 0.72) * SS), ((x1 - w * 0.18) * SS, (y0 + s * 0.72) * SS),
                    ((x1 - w * 0.12) * SS, (y0 + s * 0.80) * SS), ((x0 + w * 0.12) * SS, (y0 + s * 0.80) * SS)], fill=glass)
    if door_open == 'fl':
        hx, hy = x0, y0 + s * 0.33                    # hinge at the front of the driver's door, swung 55 degrees out
        L = s * 0.24
        a = math.radians(55)
        ex, ey = hx - L * math.sin(a), hy + L * math.cos(a)
        p.cv.d.line([(hx * SS, hy * SS), (ex * SS, ey * SS)], fill=(232, 40, 60), width=int(7 * SS))
        p.cv.d.line([(hx * SS, (hy + 2) * SS), (hx * SS, (hy + L) * SS)], fill=(232, 40, 60), width=int(2 * SS))


def pg_car(p):
    p.title('Стан автомобіля')
    draw_car(p, 960, 430, 230, 'fl')
    p.icon('cc_door', 38, 800, 560, (232, 40, 60))
    p.text(826, 572, 'Двері водія відчинено', M.noto(29), WHITE)


def pg_assist(p):
    p.title('Допомога водієві')
    sign(p, 880, 430, 78, 50)
    p.text(990, 400, 'Круїз', M.noto(29), GREY2)
    p.text(990, 452, '90', M.noto(42), WHITE)
    p.text(990 + p.width('90', M.noto(42)) + 6, 452, 'км/год', M.noto(21), WHITE)
    p.text(990, 500, 'дистанція 3', M.noto(27), (170, 170, 170))
    p.ctext((960, 560), 'обмеження з камери / карти', M.noto(25), (150, 150, 150))


def pg_consumption(p):
    p.title('Витрата', '30 хв')
    p.text(1010, 372, '8.4', M.noto(52), WHITE, 'r')
    p.text(1017, 372, 'л/100 км', M.noto(21), WHITE)
    rng = np.random.default_rng(3)
    vals = np.clip(7.0 + np.cumsum(rng.normal(0, 1.2, 15)), 3.5, 13.5)
    x = 760
    for v in vals:                                      # a history we compute ourselves, one bar per 2 min
        h = (v / 15.0) * 120
        p.rect(x, 540 - h, x + 20, 540, (200, 200, 200))
        x += 27
    avg = float(vals.mean())
    p.rect(752, 540 - avg / 15 * 120 - 1, 1172, 540 - avg / 15 * 120 + 1, RED)
    p.text(1172, 575, 'запас ходу 412 км', M.noto(25), GREY2, 'r')
    p.text(752, 575, 'ø %.1f' % avg, M.noto(25), GREY2)


def pg_tyres(p):
    p.title('Тиск у шинах', 'бар')
    draw_car(p, 960, 440, 210)
    for (x, y, v) in ((850, 372, '2.4'), (1070, 372, '2.4'), (850, 520, '2.5'), (1070, 520, '2.3')):
        p.ctext((x, y), v, M.noto(39))


# ---- tab 5: navigation ------------------------------------------------------------------------------------------------
def map_standin(p, rect, seed=11):
    """A drawn map stand-in: procedural roads on a dark ground, a route and our position. No real place."""
    x0, y0, x1, y1 = rect
    w, h = int((x1 - x0) * SS), int((y1 - y0) * SS)
    m = Image.new('RGB', (w, h), (34, 37, 36))
    d = ImageDraw.Draw(m)
    rng = np.random.default_rng(seed)
    d.polygon([(0, h * 0.15), (w * 0.22, h * 0.1), (w * 0.3, h * 0.38), (0, h * 0.45)], fill=(36, 52, 40))   # park
    d.polygon([(w, h * 0.55), (w * 0.82, h * 0.62), (w * 0.86, h), (w, h)], fill=(30, 42, 60))              # water
    for k in range(9):                                 # a skewed street grid
        x = (k + rng.uniform(-0.3, 0.3)) * w / 8
        d.line([(x, 0), (x + w * 0.12, h)], fill=(62, 66, 68), width=int(4 * SS))
    for k in range(6):
        y = (k + rng.uniform(-0.3, 0.3)) * h / 5
        d.line([(0, y), (w, y - h * 0.08)], fill=(62, 66, 68), width=int(4 * SS))
    pts = [(w * 0.52, h * 1.02), (w * 0.53, h * 0.7), (w * 0.56, h * 0.45), (w * 0.7, h * 0.3), (w * 1.02, h * 0.18)]
    d.line(pts, fill=(98, 100, 96), width=int(16 * SS), joint='curve')                                     # main road
    d.line(pts[:3] + [(w * 0.4, h * 0.3), (w * 0.2, h * 0.24), (-10, h * 0.22)], fill=(98, 100, 96), width=int(11 * SS), joint='curve')
    d.line(pts[:3] + [(w * 0.4, h * 0.3), (w * 0.2, h * 0.24)], fill=(70, 160, 235), width=int(9 * SS), joint='curve')  # route
    cx, cy = w * 0.525, h * 0.84
    s = 16 * SS
    d.polygon([(cx, cy - s), (cx + s * 0.75, cy + s * 0.8), (cx, cy + s * 0.35), (cx - s * 0.75, cy + s * 0.8)], fill=(255, 255, 255))
    f = M.noto(19)
    d.text((10 * SS, 26 * SS), 'заглушка мапи: не реальне місце', font=f, fill=(150, 150, 150), anchor='ls')
    p.cv.img.paste(m, (int(x0 * SS), int(y0 * SS)))


def pg_map(p, with_title=True):
    if with_title:
        map_standin(p, (729, 300, 1191, 609))
        p.title('Навігація')
    else:
        map_standin(p, (729, 173, 1191, 609))
    p.rrect(800, 560, 1120, 598, 8, fill=(20, 22, 24))   # road label bar (07): placeholder text only
    p.icon('td_dot', 14, 828, 579, (70, 160, 235))
    p.text(844, 590, 'Назва дороги', M.noto(27), GREY2)


def pg_guidance(p):
    p.title('Навігація')
    p.icon('td_turn_right', 150, 870, 420)
    p.rect(966, 340, 974, 500, (60, 60, 60))           # the distance bar of 07's hub, ours
    p.rect(966, 420, 974, 500, (70, 160, 235))
    p.text(1110, 430, '300', M.saira(64), WHITE, 'r')
    p.text(1116, 430, 'м', M.noto(29), WHITE)
    p.text(990, 485, 'потім прямо', M.noto(25), (170, 170, 170))
    p.rrect(760, 525, 1160, 563, 8, fill=(40, 43, 46))
    p.text(960, 553, 'Назва дороги', M.noto(27), GREY2, 'c')
    p.icon('td_flag', 26, 820, 586, (170, 170, 170))
    p.text(840, 595, '14:58  ·  12.3 км', M.noto(25), (170, 170, 170))


def pg_nav_idle(p):
    p.title('Навігація')
    p.icon('td_compass', 80, 960, 390, (170, 170, 170))
    p.ctext((960, 480), 'Маршрут не задано', M.noto(39), GREY2)
    p.ctext((960, 530), 'Назва дороги', M.noto(29), (150, 150, 150))


# ---- the pictures -----------------------------------------------------------------------------------------------------
SHOTS = []          # (sheet, file, caption, status keys, picture)


def st(*keys):
    return [('%s: %s' % (k, STATUS[k][0])) for k in keys]


def shot(sheet, name, caption, keys, sel=1, page=None, warn=None, bottom=2, cells=None, style='fn', warn_style='icon',
         no_msg='dim', limit=None, speed=87.0, rpm=2.4, fallback=False):
    p = Page(speed, rpm)
    tab_bar(p, cells or cells5(), sel, style, warn, warn_style, no_msg)
    if page:
        page(p)
    lim = limit or {}
    if fallback:
        bmw_panel(p)
        p.rect(629, 612.4, 694, 614.6, RULE)
        p.rect(1230, 612.4, 1291, 614.6, RULE)
    elif bottom:
        bottom_row(p, bottom, lim.get('a'))
    if 'b' in lim:
        limit_marker(p, lim['b'])
    if 'c' in lim:
        sign(p, LIMIT_C[0], LIMIT_C[1], LIMIT_C[2], lim['c'])
    img = p.finish((name + ' - ' + caption, st(*keys)))
    path = os.path.join(OUT, sheet, name + '.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    SHOTS.append(dict(sheet=sheet, file=os.path.relpath(path, OUT), caption=caption,
                      status={k: STATUS[k][0] for k in keys}, source={k: STATUS[k][1] for k in keys}))
    print('wrote', path)
    return img


def build():
    # the live tab bar: each tab selected in turn, with its own page (full pictures)
    shot('tabs', 'T1_sel1_clock', 'tab 1 selected: date and time', ['range', 'clock'], 1, pg_clock)
    shot('tabs', 'T2_sel2_card', 'tab 2 selected: message card (yellow)', ['cc'], 2, lambda p: pg_card(p, 'warn', 2), warn='warn', bottom=1)
    shot('tabs', 'T3_sel3_radio', 'tab 3 selected: radio', ['media'], 3, pg_radio, bottom=1)
    shot('tabs', 'T4_sel4_phone', 'tab 4 selected: phone idle', ['phone'], 4, pg_phone_idle, bottom=1)
    shot('tabs', 'T5_sel5_map', "tab 5 selected: BMW's map in the window", ['map', 'road'], 5, pg_map, bottom=1)
    shot('tabs', 'T6_red_all', "every tab red (06's ramp), tab 3 selected", ['media'], 3, pg_radio, style='red', bottom=1)
    shot('tabs', 'T7_flat', "today's flat red highlight used for selection", ['range', 'clock'], 1, pg_clock, style='flat')
    # tab 2's states in the bar
    shot('tabs', 'T8_warn_none_dim', 'no message: warning tab dim', ['range', 'clock'], 1, pg_clock, no_msg='dim')
    shot('tabs', 'T9_warn_none_hidden', 'no message: warning cell empty', ['range', 'clock'], 1, pg_clock, no_msg='hidden')
    shot('tabs', 'T10_warn_none_gone', "no message: no warning tab (maker's rule)", ['range', 'clock'], 1, pg_clock, cells=cells4(2))
    shot('tabs', 'T11_msg_icon', 'message, tab 1 selected: triangle in severity colour', ['cc', 'range', 'clock'], 1, pg_clock, warn='red')
    shot('tabs', 'T12_msg_cell', 'message, tab 1 selected: cell in severity colour (today)', ['cc', 'range', 'clock'], 1, pg_clock, warn='warn', warn_style='cell')
    shot('tabs', 'T13_sel2_sev', 'tab 2 selected, fill in the severity colour', ['cc'], 2, lambda p: pg_card(p, 'warn', 1), warn='warn', style='sev', bottom=1)
    # four tabs, other icons
    shot('tabs', 'T14_four_no_phone', 'four tabs: phone removed, media wider', ['media'], 3, pg_radio, cells=cells4(4), bottom=1)
    shot('tabs', 'T15_four_no_media', 'four tabs: media removed, phone in the wide cell', ['phone'], 4, pg_phone_idle, cells=cells4(3), bottom=1)
    c = cells5()
    c[2].update(icon='td_car', text='Олива 98 °C', fn='red')
    c[3].update(icon='td_gauge')
    shot('tabs', 'T16_other_icons', 'tab 3 = car (oil text), tab 4 = gauge; tab 3 selected', ['oil', 'coolant'], 3, pg_tech, cells=c, bottom=1)
    c = cells5()
    c[3].update(icon='td_phone_none')
    shot('tabs', 'T17_phone_none', 'tab 4: no phone connected (crossed out)', ['phone'], 1, pg_clock, cells=c)

    # tab 1
    shot('tab1', '1A_clock', 'date and time (page 1 of 3)', ['clock'], 1, pg_clock)
    shot('tab1', '1B_trip_now', 'trip computer: this trip (page 2)', ['trip'], 1, lambda p: pg_trip(p, 1))
    shot('tab1', '1C_trip_long', 'trip computer: long term (page 3)', ['trip'], 1, lambda p: pg_trip(p, 2))
    shot('tab1', '1D_clock_nodots', 'date and time, no page dots', ['clock'], 1, lambda p: pg_clock(p, False))

    # tab 2
    for sev, lab in (('info', 'info'), ('warn', 'yellow'), ('red', 'red')):
        for n in (1, 2):
            shot('tab2', '2_%s_%d' % (lab, n), 'card %s, %d line%s' % (lab, n, 's' if n > 1 else ''), ['cc'], 2,
                 lambda p, s=sev, n=n: pg_card(p, s, n), warn=sev, bottom=1)
    shot('tab2', '2_cell_red', 'card, cell layout (today\'s plate moved up), red', ['cc'], 2, lambda p: pg_card(p, 'red', 2, 'cell'), warn='red', bottom=1)
    shot('tab2', '2_cell_yellow', 'card, cell layout, yellow', ['cc'], 2, lambda p: pg_card(p, 'warn', 2, 'cell'), warn='warn', bottom=1)
    shot('tab2', '2_list', 'list: shown now + active + stored', ['cc'], 2, pg_list, warn='red', bottom=1)
    shot('tab2', '2_empty', 'empty state', ['cc'], 2, pg_empty, bottom=1)
    shot('tab2', '2_window_open', "message arrives: card painted, window open (BMW's panel visible)", ['cc'], 2,
         lambda p: pg_card(p, 'warn', 2), warn='warn', fallback=True)
    shot('tab2', '2_window_closed', 'after CC_SETTLE_MS with our card on screen: bottom row back', ['cc'], 2,
         lambda p: pg_card(p, 'warn', 2), warn='warn', bottom=1)
    shot('tab2', '2_left_tab2', 'driver on tab 1 while the message shows: window open again', ['cc', 'clock'], 1,
         pg_clock, warn='warn', fallback=True)

    # tab 3 / 4 candidates
    shot('tab3', '3A_radio', 'SM M2 radio: band, station, radio text, facts', ['media'], 3, pg_radio, bottom=1)
    shot('tab3', '3B_track', 'SM M1 now playing: title, artist, progress, n of m', ['media', 'progress'], 3, pg_track, bottom=1)
    shot('tab3', '3B2_track_cover', 'SM M1 with a cover place (cover art: later, not this round)', ['media', 'progress'], 3,
         lambda p: pg_track(p, True), bottom=1)
    c = cells5()
    c[2].update(icon='td_media', text=None)
    shot('tab3', '3C_media_certain', 'SM M3 only what is certain: pictogram, no text in the tab', ['media_icon'], 3, pg_media_min, cells=c, bottom=1)
    c = cells5()
    c[2].update(icon='td_media', text='Bluetooth')
    shot('tab3', '3C2_media_source', 'SM M3 + source type (enum, our word)', ['media_src'], 3, pg_media_src, cells=c, bottom=1)
    shot('tab3', '3D_station_list', 'SM M2 list: stations (doubtful)', ['media_list'], 3, pg_media_list, bottom=1)
    shot('tab3', '3E_track_list', 'SM M4 track window (doubtful)', ['media_list'], 3, lambda p: pg_media_list(p, 'tracks'), bottom=1)
    c = cells5()
    c[2].update(mark='td_mute')
    shot('tab3', '3F_tab_muted', 'tab 3 with the mute mark, tab 1 selected', ['media', 'mute'], 1, pg_clock, cells=c)
    shot('tab4', '4A_phone_idle', 'SP P0 idle: connected, battery, signal, counts', ['phone'], 4, pg_phone_idle, bottom=1)
    shot('tab4', '4A2_phone_certain', 'SP P3 only what is certain', ['phone_icon'], 4, pg_phone_certain, bottom=1)
    c = cells5()
    c[3].update(icon='td_phone', ink=(90, 200, 80))
    shot('tab4', '4B_phone_in', 'SP P1 incoming, (a) Контакт (auto: tab 4 selected)', ['call', 'contact_kind'], 4, lambda p: pg_phone_call(p, 'incoming', 'a'), cells=c, bottom=1)
    shot('tab4', '4B2_phone_in_name', "SP P1 incoming, (b) the caller's name: owner setting", ['call', 'caller_name'], 4, lambda p: pg_phone_call(p, 'incoming', 'b'), cells=c, bottom=1)
    shot('tab4', '4B3_phone_in_none', 'SP P1 incoming, (c) no caller line', ['call'], 4, lambda p: pg_phone_call(p, 'incoming', 'c'), cells=c, bottom=1)
    shot('tab4', '4C_phone_call', 'SP P2 active: our timer, Контакт, mic muted', ['call', 'timer', 'mic'], 4, lambda p: pg_phone_call(p, 'active'), cells=c, bottom=1)
    shot('tab4', '4D_phone_ended', 'SP P4 call ended, 3 s then back', ['call'], 4, lambda p: pg_phone_call(p, 'ended'), bottom=1)
    shot('tab4', '4E_tab_in_call', 'tab 4 lit (green icon) during a call, tab 1 selected', ['call', 'clock'], 1, pg_clock, cells=c)
    c = cells5()
    c[3].update(icon='td_gauge', fn='red')
    shot('tab4', 'X1_tech', 'alternative: technical page', ['oil', 'coolant', 'voltage', 'boost'], 4, pg_tech, cells=c, bottom=1)
    c = cells5()
    c[3].update(icon='td_car', fn='red')
    shot('tab4', 'X2_car_door', 'alternative: car picture, driver door open', ['doors'], 4, pg_car, cells=c, bottom=1)
    shot('tab4', 'X3_tyres', 'alternative: tyre pressures on the car picture', ['tyres'], 4, pg_tyres, cells=c, bottom=1)
    c = cells5()
    c[3].update(icon='td_limit', fn='red')
    shot('tab4', 'X4_assist', 'alternative: driver assistance, limit large', ['limit', 'cruise'], 4, pg_assist, cells=c, bottom=1)
    c = cells5()
    c[3].update(icon='td_avg', fn='red')
    shot('tab4', 'X5_consumption', 'alternative: consumption with our own history', ['consumption', 'range'], 4, pg_consumption, cells=c, bottom=1)

    # tab 5
    shot('tab5', '5A_map_title', "BMW's map in the window, our title and rule over it", ['map', 'road'], 5, pg_map, bottom=1)
    shot('tab5', '5B_map_full', "BMW's map in the whole centre window, no title", ['map', 'road'], 5, lambda p: pg_map(p, False), bottom=1)
    shot('tab5', '5C_guidance', 'fallback guidance page: arrow, distance, road label', ['guiding', 'turn', 'road'], 5, pg_guidance, bottom=1)
    shot('tab5', '5D_not_guided', 'navigation tab, no route', ['guiding', 'road'], 5, pg_nav_idle, bottom=1)

    # speed limit
    shot('limit', 'La_bottom_row', '(a) sign at the bottom row\'s right end', ['limit'], 3, pg_radio, bottom=1, limit={'a': 50}, speed=47.0)
    shot('limit', 'Lb_scale', '(b) marker on the speedometer scale', ['limit'], 3, pg_radio, bottom=1, limit={'b': 50}, speed=47.0)
    shot('limit', 'Lc_hub', '(c) sign under the unit in the hub', ['limit'], 3, pg_radio, bottom=1, limit={'c': 50}, speed=47.0)
    c = cells5()
    c[3].update(icon='td_limit', fn='red')
    shot('limit', 'Ld_page', '(d) large on the assistance page', ['limit'], 4, pg_assist, cells=c, bottom=1, speed=47.0)
    shot('limit', 'Lab', '(a) + (b)', ['limit'], 1, pg_clock, limit={'a': 50, 'b': 50}, speed=47.0)
    shot('limit', 'Lbc', '(b) + (c)', ['limit'], 1, pg_clock, limit={'b': 50, 'c': 50}, speed=47.0)
    shot('limit', 'Labc_over', '(a) + (b) + (c), speed above the limit', ['limit'], 3, pg_radio, bottom=1, limit={'a': 50, 'b': 50, 'c': 50}, speed=62.0)
    img = shot('limit', 'La_120', '(a) with a three-digit limit', ['limit'], 1, pg_clock, limit={'a': 120}, speed=112.0, rpm=3.1)
    M.annotate(img).save(os.path.join(OUT, 'limit', 'La_120_keepouts.png'))


# ---- contact sheets ---------------------------------------------------------------------------------------------------
SHEETS = {   # crop in panel px, scale, columns, title
    'tabs': ((606, 116, 1314, 182), 1.0, 2, 'Live tab bar: selection, the warning tab, four tabs, other icons'),
    'tab1': ((560, 100, 1360, 720), 0.5, 4, 'Tab 1: on-board computer'),
    'tab2': ((560, 100, 1360, 720), 0.5, 4, 'Tab 2: messages in the centre'),
    'tab3': ((560, 100, 1360, 720), 0.5, 4, 'Tab 3: radio and media (SM model: every media field unseen on this car)'),
    'tab4': ((560, 100, 1360, 720), 0.5, 4, 'Tab 4: phone, and the alternatives for tab 3 or 4'),
    'tab5': ((560, 100, 1360, 720), 0.5, 4, 'Tab 5: navigation'),
    'limit': ((560, 60, 1920, 720), 0.4, 3, 'Speed limit: placements (a)-(d), alone and combined'),
}


def sheet(items, crop, scale, cols, title, path):
    cw, ch = int((crop[2] - crop[0]) * scale), int((crop[3] - crop[1]) * scale)
    pad, cap = 14, 54
    rows = (len(items) + cols - 1) // cols
    S = Image.new('RGB', (cols * (cw + pad) + pad, 56 + rows * (ch + cap + pad)), (24, 24, 26))
    d = ImageDraw.Draw(S)
    d.text((pad, 16), title, font=lf(24, True), fill=WHITE)
    for i, it in enumerate(items):
        im = Image.open(os.path.join(OUT, it['file'])).crop(crop).resize((cw, ch), Image.LANCZOS)
        x, y = pad + (i % cols) * (cw + pad), 56 + (i // cols) * (ch + cap + pad)
        S.paste(im, (x, y))
        cap1 = os.path.splitext(os.path.basename(it['file']))[0] + '  ' + it['caption']
        while d.textlength(cap1, font=lf(15)) > cw and len(cap1) > 4:
            cap1 = cap1[:-2] + '…' if not cap1.endswith('…') else cap1[:-2] + '…'
        d.text((x, y + ch + 4), cap1, font=lf(15), fill=(230, 230, 230))
        xx = x
        for k, v in it['status'].items():
            t = '%s: %s' % (k, v)
            if xx + 24 + d.textlength(t, font=lf(14)) > x + cw:
                d.text((xx, y + ch + 26), '…', font=lf(14), fill=(200, 200, 200))
                break
            col = STATUS_COL.get(v, (200, 200, 200))
            d.ellipse([xx, y + ch + 30, xx + 10, y + ch + 40], fill=col)
            d.text((xx + 14, y + ch + 26), t, font=lf(14), fill=(200, 200, 200))
            xx += 24 + d.textlength(t, font=lf(14))
    S.save(path)
    print('wrote', path)


def overview():
    pick = ['T1_sel1_clock', 'T2_sel2_card', 'T3_sel3_radio', 'T4_sel4_phone', 'T5_sel5_map', '1B_trip_now', '2_list',
            '2_window_open', '3B_track', '4B_phone_in', '4C_phone_call', 'X1_tech', 'X2_car_door', '5C_guidance', 'Labc_over']
    items = [s for n in pick for s in SHOTS if os.path.basename(s['file'])[:-4] == n]
    sheet(items, (0, 0, 1920, 720), 0.3, 3, 'Twin Dial r3 (K2): tabs and pages, overview - every text invented', os.path.join(OUT, 'pages_sheet.png'))


def main():
    os.makedirs(OUT, exist_ok=True)
    load_models()
    build()
    for name, (crop, scale, cols, title) in SHEETS.items():
        sheet([s for s in SHOTS if s['sheet'] == name], crop, scale, cols, title, os.path.join(OUT, name + '_sheet.png'))
    overview()
    json.dump(dict(generator='tools/twin-dial/mockup/pages.py', dials=os.environ.get('K2_DIALS') or 'mockup.py',
                   models=['%s/%s' % k for k in sorted(MODELS)], status_keys=STATUS, pictures=SHOTS),
              open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
