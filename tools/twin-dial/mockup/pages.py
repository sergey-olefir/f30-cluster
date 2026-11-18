#!/usr/bin/env python3
"""Twin Dial round 3b, package KB: the tab bar and the pages behind every tab, in the final look (docs/twin-dial/MOCKUP-SPEC-R3B.md §4).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/pages.py

Writes bake/work/twin-dial/mockup/r3b/kb/ (git-ignored): one 1920 x 720 picture per state (folders tabs/ tab1/ .. tab5/), a close-up
beside every picture whose point is small (<id>_<name>_close.png), contact sheets, annotated copies, index.json. Every picture's file
name starts with its id in MOCKUP-SPEC-R3B §4. K2's set (docs/twin-dial/r3/K2-REPORT.md) is this file's ancestor: the page code is
K2's, re-numbered, re-checked against SPEC-R3 (the design authority) and extended; the old pictures come from K2's commit.

The dials: tools/twin-dial/mockup/mockup.py (package KA owns the dial drawing in this round). Default: K1's `look_06` with SD's
measured numeral shadow; set KB_DIALS=<KA's mockup.py> KB_LOOK=<name> to draw with KA's published look (pub/KA/). Every text is
invented and neutral, the map is a drawn stand-in that is no real place, the pictograms are our own (pictos_r3.py).
Numbers: SPEC-R3 §3-§5 and the JSON of SF / SC / SM / SP / SN / SV (bake/work/twin-dial/r3/pub/*); where they disagree the spec wins.
"""
import importlib.util
import json
import math
import os
import re
import shutil
import sys
from dataclasses import replace

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
from pictos_r3 import PICTOS, PICTOS_R3B, roundabout_steps  # noqa: E402

OWN_FONTS = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'refs', 'vt-fonts')
WORK = os.path.join(ROOT, 'bake', 'work', 'twin-dial')


def _load_mockup():
    path = os.environ.get('KB_DIALS') or os.path.join(HERE, 'mockup.py')
    spec = importlib.util.spec_from_file_location('twin_mockup', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not os.path.isdir(mod.FONTS):
        mod.FONTS = OWN_FONTS
    return mod, path


M, DIALS_PATH = _load_mockup()
W, H, SS = M.W, M.H, M.SS
CT, CS, R = M.CT, M.CS, M.R
OUT = os.environ.get('KB_OUT') or os.path.join(WORK, 'mockup', 'r3b', 'kb')
PUB = os.path.join(WORK, 'r3', 'pub')
LOOK_NAME = os.environ.get('KB_LOOK', 'look_06')

WHITE, GREEN = (255, 255, 255), (60, 155, 34)
GREY2, GREY_DIM, GREY_MID = (227, 227, 227), (150, 150, 150), (170, 170, 170)
LIT_GREEN = (90, 200, 80)


def lin(c):
    c = np.asarray(c, float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def enc(L):
    return tuple(int(round(v)) for v in M.srgb(np.asarray(L, float)))


# ---- the frame (SPEC-R3 §3, §4) ----------------------------------------------------------------------------------------
BAR = (618, 127, 1302, 170)                      # cells end at the rule's top (rule y 170-173)
SEPS = [780, 848, 1168, 1237]                    # SPEC-R3 §3.1 (SF: tab 1 holds icon + 3 digits + unit)
SEPS_TODAY = [744, 812, 1168, 1237]
TAB_RULE = (170, 173, 230)                       # 3 px, code 230
ICON_BOX, ICON_Y = 46, 147                       # 36 px of ink in our 46 px box (the drawings' ink is ~0.79 of the box)
TAB_FONT, TAB_UNIT = 34, 21                      # text cap 24 px
TEXT_BASE = 156
TAB_RIGHT_MARGIN = 14                            # SF: 18 inset + 36 icon + 7 + 3 digits + 6 + unit + 14
TAB_COLOUR = {1: (176, 10, 37), 2: (176, 10, 37), 3: (240, 150, 10), 4: (60, 155, 34), 5: (30, 150, 200)}
TITLE_Y = 270
TRULE = (739, 1181, 295, 297.5, 205)             # 2.5 px, code 205
META = (1190, 326)                               # right edge, baseline 326, cap 22
BROW = (629, 1291, 612.4, 614.6, 231)
BASE1, BASE2 = 655, 702
KOMBI_BOX_G20 = (1420, 320, 1611, 440)
MAP_BOX10, MAP_BOX90 = (700, 138, 1217, 594), (794, 209, 1150, 557)
KEEP = {'belt_group': (497, 660, 688, 720), 'gear_gap': (1380, 660, 1460, 720)}

SEV = {'red': dict(cell=(176, 7, 30), sym=WHITE, rule=(176, 7, 30), icon=(218, 16, 48)),
       'amber': dict(cell=(240, 170, 10), sym=(0, 0, 0), rule=(240, 170, 10), icon=(240, 170, 10)),
       'green': dict(cell=(59, 155, 26), sym=WHITE, rule=(59, 155, 26), icon=WHITE),
       'grey': dict(cell=None, sym=WHITE, rule=(231, 231, 231), icon=WHITE)}
ROW_SEV_INK = {'red': (218, 16, 48), 'amber': (240, 170, 10), 'green': (59, 155, 26), 'grey': WHITE}

# ---- data status: the three words of MOCKUP-SPEC-R3B §1 (arrives / unseen / after probe) plus certain / derived -------------
STATUS = {
    'clock': ('arrives', 'timeDateUTC + zone'),
    'range': ('arrives', 'statusRangeTankStatus'),
    'trip': ('unseen', 'KombiIF.statusBordcomputerAverage / TravelData; fallback chain research3/MK'),
    'outside': ('arrives', 'ExteriorTemperature'),
    'odo': ('unseen', 'odometer member, trip distance'),
    'cc': ('arrives', 'KombiInterface_2.ccList (names, colours, symbol ids)'),
    'cc_now': ('unseen', 'statusActiveCCMessage / which entry shows now (P1); until then D7: pointer page + BMW panel'),
    'cc_counter': ('unseen', 'statusMenuCCMessage frame n of m (P1)'),
    'media': ('after probe', 'HmiMediaState.playerMetadata (P8)'),
    'media_src': ('after probe', 'HmiMediaState.menu iconKind / MediaSource, an enum only (P8)'),
    'media_icon': ('certain', 'our own pictogram, no signal'),
    'progress': ('after probe', 'trackProgress elapsed / total; n of m CarPlay only (P8)'),
    'mute': ('after probe', 'mute state (not in this probe)'),
    'phone': ('after probe', 'DevicePresentation.deviceList: connected, roles, battery, signal (P9)'),
    'phone_icon': ('certain', 'our own pictogram, no signal'),
    'call': ('after probe', 'ConnectivityAggregator.aggregatedCallState / VoiceCall (P9)'),
    'contact_kind': ('after probe', 'contactID known or not -> Контакт or Номер; no text read'),
    'caller_name': ('after probe', "private text; drawn only with the owner's setting 'Показувати ім'я абонента'"),
    'timer': ('certain', 'our own timer from the state change'),
    'mic': ('after probe', 'VoiceCallManager.micMuted'),
    'oil': ('arrives', 'CDS.statusEngineTemperature.temperatureEngineOilDrive (raw - 48); scale a strong hypothesis'),
    'coolant': ('arrives', 'CDS.statusEngineTemperature.temperatureEngineDrive (raw - 48); scale verified'),
    'boost': ('arrives', "FES.statusSwitchDriveDynamicSport2.displayBoostPressure (0.01 bar); in another app's log; scale a hypothesis"),
    'tyres': ('after probe', "TPMS getters polled every 10 s; seen only in another app's log"),
    'guiding': ('arrives', 'NavigationStatus.guidingState'),
    'road': ('arrives', 'Guidance.currentRoad (text drawn, never logged)'),
    'dart': ('after probe', 'Guidance.conclusiveDart, currentLaneGuiding, nextDestinationInfo (P12)'),
    'map': ('after probe', "BMW's map through our window: experiment mapWindow, not yet photographed on the panel's own id"),
    'setting': ('certain', 'our own setting (Технічні дані / центр / таба)'),
}
STATUS_COL = {'arrives': (60, 175, 60), 'certain': (60, 175, 60), 'derived': (120, 160, 230), 'unseen': (240, 170, 10),
              'after probe': (225, 110, 40)}
MODELS = {}


def load_models():
    for pkg in ('SF', 'SC', 'SM', 'SP', 'SN', 'SV', 'SD'):
        d = os.path.join(PUB, pkg)
        if not os.path.exists(os.path.join(d, 'READY')):
            continue
        for fn in sorted(os.listdir(d)):
            if fn.endswith('.json') and fn != 'measured.json':
                try:
                    MODELS[(pkg, fn)] = json.load(open(os.path.join(d, fn)))
                except Exception as e:
                    print('model not read:', pkg, fn, e)
    print('models read:', ['%s/%s' % k for k in sorted(MODELS)])


# ---- pictograms as distance fields (as K2) ------------------------------------------------------------------------------
DRAW = {}


def _drawings():
    if not DRAW:
        src = open(os.path.join(ROOT, 'shared', 'twin_icons.js'), encoding='utf-8').read()
        for m in re.finditer(r'^\s+"(\w+)": (\[.*\]),?\s*$', src, re.M):
            DRAW[m.group(1)] = json.loads(m.group(2))
        DRAW.update(PICTOS)
    return DRAW


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
    for i in range(len(pts)):
        (xi, yi), (xj, yj) = pts[i], pts[i - 1]
        d = np.minimum(d, _seg(X, Y, xj, yj, xi, yi))
        inside ^= ((yi > Y) != (yj > Y)) & (X < (xj - xi) * (Y - yi) / ((yj - yi) or 1e-12) + xi)
    return np.where(inside, -d, d)


def _step(st, X, Y):
    a, k = st['a'], st['k']
    if k == 'seg':
        return _seg(X, Y, *a[:4]) - a[4] / 2
    if k == 'ring':
        return np.abs(np.hypot(X - a[0], Y - a[1]) - a[2]) - a[3] / 2
    if k == 'arc':
        cx, cy, r, a0, a1, w = a[0], a[1], a[2], math.radians(a[3]), math.radians(a[4]), a[5]
        ang = a0 + np.mod(np.arctan2(X - cx, -(Y - cy)) - a0, 2 * math.pi)
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
        return _poly(X, Y, a) - (st.get('r') or 0)
    raise ValueError(k)


_ALPHA = {}


def icon_alpha(name, size):
    if (name, size) not in _ALPHA:
        g = (np.arange(size) + 0.5) / size
        X, Y = np.meshgrid(g, g)
        d = np.full(X.shape, np.inf)
        for st in _drawings()[name]:
            p = _step(st, X, Y)
            d = np.maximum(d, -p) if st.get('cut') else np.minimum(d, p)
        _ALPHA[(name, size)] = np.clip(0.5 - d * size, 0, 1)
    return _ALPHA[(name, size)]


def icon_ink(name, size):
    """Ink box of an icon inside its size x size tile (x0, y0, x1, y1), px."""
    ys, xs = np.nonzero(icon_alpha(name, size) > 0.25)
    return (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1) if len(xs) else (0, 0, 0, 0)


def paste_sdf(img, name, size, cx, cy, color=WHITE, alpha=1.0):
    a = icon_alpha(name, size) * alpha
    tile = Image.new('RGBA', (size, size), tuple(color) + (0,))
    tile.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    img.paste(tile, (int(round(cx - size / 2)), int(round(cy - size / 2))), tile)


def register_pictos():
    """KB's additions (pictos_r3.py): projection, forks, a flag beside a road, and the roundabout with its exit stub (one drawing per exit 1-6)."""
    _drawings()
    DRAW.update(PICTOS_R3B)
    for ex in range(1, 7):
        DRAW['td_roundabout_%d' % ex] = roundabout_steps(ex)


# ---- fonts and canvas ----------------------------------------------------------------------------------------------------
def nb(size):
    return M.font(('notosans', 'NotoSans[wdth,wght].ttf'), size, 700, 100)


def lf(size, bold=False):
    return M.font(('notosans', 'NotoSans[wdth,wght].ttf'), size / SS, 700 if bold else 500, 100)


_INK = {}


def ink_rel(s, f):
    """Ink box of a string relative to its 'ls' origin, in 3x px, from a rendered mask (the advance box is looser)."""
    key = (s, id(f))
    if key not in _INK:
        adv = int(f.getlength(s)) + 40
        im = Image.new('L', (adv + 40, int(f.size * 2)), 0)
        ImageDraw.Draw(im).text((20, int(f.size * 1.4)), s, font=f, fill=255, anchor='ls')
        b = im.getbbox()
        _INK[key] = (b[0] - 20, b[1] - int(f.size * 1.4), b[2] - 20, b[3] - int(f.size * 1.4), f.getlength(s)) if b else (0, 0, 0, 0, 0)
    return _INK[key]


_BASE = {}


def look_for_dials():
    if not hasattr(M, 'look_named'):
        return None
    lk = M.look_named(LOOK_NAME)
    if LOOK_NAME == 'look_06' and not os.environ.get('KB_DIALS'):
        # SPEC-R3 §2.4: SD's measured drop shadow (+0.010, +0.012) R, sigma 0.008 R, 0.35 replaces K1's by-eye (0.008, 0.020, 0.009, 0.70).
        # The outline term of SD's model is KA's (mockup.py A04); this provisional base has the drop shadow only.
        lk = replace(lk, num_shadow=(0.010, 0.012, 0.008, 0.35))
    return lk


class Page:
    """mockup.Canvas with the dials drawn (cached per speed / rpm) plus our own icon queue and a record of every ink box."""

    def __init__(self, speed=87.0, rpm=2.4, gear='D3'):
        key = (speed, rpm, gear, LOOK_NAME, DIALS_PATH)
        if key not in _BASE:
            cv = M.Canvas()
            if hasattr(M, 'draw_dials'):
                M.draw_dials(cv, look_for_dials(), speed, rpm, gear)
            else:
                cv.speed_digits = speed
                cv.dial(CT, 'tach', rpm)
                cv.dial(CS, 'speed', speed)
            _BASE[key] = (cv.img.copy(), list(cv.icons))
        img, icons = _BASE[key]
        self.cv = M.Canvas.__new__(M.Canvas)
        self.cv.img = img.copy()
        self.cv.d = ImageDraw.Draw(self.cv.img)
        self.cv.icons = list(icons)
        self.cv.speed_digits = speed
        self.speed = speed
        self.sdf = []
        self.ink = []            # (group, kind, label, (x0, y0, x1, y1)) in panel px: ours only (the dials are KA's)
        self.g = 'page'
        self.cellinfo = {}

    # -- recording
    def _rec(self, kind, label, box):
        self.ink.append((self.g, kind, label, tuple(round(v, 2) for v in box)))

    def icon(self, name, size, cx, cy, color=WHITE, alpha=1.0):
        self.sdf.append((name, int(size), cx, cy, color, alpha))
        x0, y0, x1, y1 = icon_ink(name, int(size))
        self._rec('icon', name, (cx - size / 2 + x0, cy - size / 2 + y0, cx - size / 2 + x1, cy - size / 2 + y1))

    def rect(self, x0, y0, x1, y1, fill):
        self.cv.rect(x0, y0, x1, y1, fill)

    def rrect(self, x0, y0, x1, y1, r, fill=None, outline=None, width=1):
        self.cv.d.rounded_rectangle([x0 * SS, y0 * SS, x1 * SS - 1, y1 * SS - 1], radius=r * SS, fill=fill,
                                    outline=outline, width=int(round(width * SS)))

    def disc(self, cx, cy, r, fill):
        self.cv.d.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], fill=fill)

    def text(self, x, base, s, f, fill=WHITE, align='l', rec=True):
        self.cv.btext(x, base, s, f, fill, align)
        if rec and s.strip():
            l, t, r, b, adv = ink_rel(s, f)
            ox = {'l': 0, 'r': -adv, 'c': -adv / 2}[align]
            self._rec('text', s, ((x * SS + ox + l) / SS, (base * SS + t) / SS, (x * SS + ox + r) / SS, (base * SS + b) / SS))

    def ctext(self, xy, s, f, fill=WHITE, rec=True):
        self.cv.ctext(xy, s, f, fill)
        if rec and s.strip():
            l, t, r, b, adv = ink_rel(s, f)
            w, h = (r - l) / SS, (b - t) / SS
            self._rec('text', s, (xy[0] - w / 2, xy[1] - h / 2, xy[0] + w / 2, xy[1] + h / 2))

    def width(self, s, f):
        return self.cv.width(s, f)

    def paste_rgb(self, x0, y0, arr):
        self.cv.img.paste(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)), (int(round(x0 * SS)), int(round(y0 * SS))))

    def title(self, s, dots=None):
        self.g = 'title'
        self.ctext((960, TITLE_Y), s, M.noto(41))
        x0, x1, y0, y1, code = TRULE
        self.rect(x0, y0, x1, y1, (code, code, code))
        if dots:
            n, act = dots
            for k in range(n):
                self.disc(960 + (k - (n - 1) / 2) * 15, 308.5, 3.2, WHITE if k == act else (88, 88, 88))
        self.g = 'page'

    def meta(self, s):
        self.text(META[0], META[1], s, M.noto(30), GREY2, 'r')

    def finish(self):
        out = self.cv.img.resize((W, H), Image.LANCZOS)
        M.paste_icons(out, self.cv.icons)
        for name, size, cx, cy, color, alpha in self.sdf:
            paste_sdf(out, name, size, cx, cy, color, alpha)
        return out


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
    cut = len(lines) > max_lines
    if cut:
        lines = lines[:max_lines - 1] + [' '.join(lines[max_lines - 1:])]
    lines[-1] = fit(p, lines[-1], f, maxw)
    return lines, cut or lines[-1].endswith('…')


# ---- the tab bar (SPEC-R3 §3) ---------------------------------------------------------------------------------------------
def cells(seps=None, tab2=True):
    s = seps or SEPS
    c = [dict(id=1, x0=618, x1=s[0], icon='td_fuel', text='412', unit='км'),
         dict(id=2, x0=s[0], x1=s[1], icon='cc_warn'),
         dict(id=3, x0=s[1], x1=s[2], icon='td_radio', text='Радіо Приклад'),
         dict(id=4, x0=s[2], x1=s[3], icon='td_phone_bars'),
         dict(id=5, x0=s[3], x1=1302, icon='td_nav')]
    if not tab2:
        c = [x for x in c if x['id'] != 2]
        c[1]['x0'] = s[0]
    return c


def C(**kw):
    """cells() with per-tab changes: C(t3=dict(...), t4=dict(...), seps=..., tab2=...)."""
    cs = cells(kw.get('seps'), kw.get('tab2', True))
    for c in cs:
        c.update(kw.get('t%d' % c['id'], {}))
    return cs


def tab1_label(p, c, mode):
    """Range + unit in tab 1, placed by INK (SF's budget: icon ink 18 px from the cell's left end, 36 px wide, the value 7 px after it, the unit
    6 px after the value, 14 px to the separator). The unit is dropped when its ink would come nearer than 14 px to the separator; the
    value's own '...' (the spec's rule, a text that does not fit ends in '...') only when the value itself does not fit. mode 'spec' is
    the literal rule: the unit is cut to what fits, '...' included (here the same as dropping when even '...' does not fit); 'drop' drops
    the unit whole as soon as it does not fit. Returns the unit shown ('' when dropped)."""
    f, fu = M.noto(TAB_FONT), M.noto(TAB_UNIT)
    num, unit = c['text'], c.get('unit', '')
    ln, tn, rn, bn, an = ink_rel(num, f)
    x_ink = c['x0'] + 18 + 36 + 7                              # the value's ink starts here
    limit = c['x1'] - TAB_RIGHT_MARGIN
    room = limit - x_ink
    shown = num
    if (rn - ln) / SS > room:                                  # the value itself does not fit: cut with '...'
        while shown and (ink_rel(shown + '…', f)[2] - ln) / SS > room:
            shown = shown[:-1]
        shown = shown + '…'
        ln, tn, rn, bn, an = ink_rel(shown, f)
    ox = x_ink - ln / SS
    p.text(ox, TEXT_BASE, shown, f, WHITE)
    if not unit or shown != num:
        return ''
    lu, tu, ru, bu, au = ink_rel(unit, fu)
    ux_ink = ox + rn / SS + 6                                  # the unit's ink starts 6 px after the value's ink
    ox_u = ux_ink - lu / SS
    if ux_ink + (ru - lu) / SS <= limit:
        p.text(ox_u, TEXT_BASE, unit, fu, WHITE)
        return unit
    if mode == 'spec':                                         # the literal rule: cut the unit with '...' if even that fits
        u = unit
        while u and ux_ink + (ink_rel(u + '…', fu)[2] - lu) / SS > limit:
            u = u[:-1]
        if u:
            p.text(ox_u, TEXT_BASE, u + '…', fu, WHITE)
            return u + '…'
    return ''


def tab_bar(p, cs, sel=None, sel_colour=None, warn=None, s2=False, t1mode='spec'):
    """sel: the selected tab id, filled by SPEC-R3 §3.2 in the tab's own colour (or sel_colour). warn: the severity of the message the
    car shows ('red', 'amber', 'grey', 'green') or None; with tab 2 not selected its triangle takes the severity colour (§5.3)."""
    x0, y0, x1, y1 = BAR
    h, w = int(round((y1 - y0) * SS)), int(round((x1 - x0) * SS))
    ramp = np.linspace(0.002, 0.16, h)
    p.paste_rgb(x0, y0, np.stack([M.srgb(ramp)] * 3, -1)[:, None, :] * np.ones((1, w, 1)))
    ry0, ry1, rc = TAB_RULE
    p.rect(x0, ry0, x1, ry1, (rc, rc, rc))
    for c in cs:
        if c['id'] != sel:
            continue
        col = sel_colour or c.get('fill') or TAB_COLOUR[c['id']]
        if c['id'] == 2 and s2 and warn in ('red', 'amber'):
            col = SEV[warn]['cell']
        L = lin(col)[None, :] * (ramp / 0.16)[:, None]
        cw = int(round((c['x1'] - c['x0']) * SS))
        p.paste_rgb(c['x0'], y0, np.stack([M.srgb(L[:, k]) for k in range(3)], -1)[:, None, :] * np.ones((1, cw, 1)))
        rule = np.clip(lin(col) + 0.15 * lin((rc, rc, rc)), 0, 1)
        p.rect(c['x0'], ry0, c['x1'], ry1, enc(rule))
    for c in cs[1:]:
        p.rect(c['x0'] - 1, y0, c['x0'] + 1, y1, (0, 0, 0))
        p.rect(c['x0'] + 2, y0, c['x0'] + 3, y1, (84, 84, 84))
    for c in cs:
        p.g = 'tab%d' % c['id']
        n0 = len(p.ink)
        ink = c.get('ink', WHITE)
        if c['id'] == 2 and warn and sel != 2:
            ink = SEV[warn]['icon']
        if c['id'] == sel:
            ink = (0, 0, 0) if (c['id'] == 2 and s2 and warn == 'amber') else WHITE
        text = c.get('text')
        if c['id'] == 1:
            ix = c['x0'] + 18 - 0.06 * ICON_BOX + ICON_BOX / 2
            p.icon(c['icon'], ICON_BOX, ix, ICON_Y, ink)
            if text:
                tab1_label(p, c, c.get('mode', t1mode))
        elif text:
            f = M.noto(TAB_FONT)
            mk = 40 if c.get('mark') else 0
            room = c['x1'] - c['x0'] - 16 - ICON_BOX - 6 - mk
            text = fit(p, text, f, room)
            tw = ICON_BOX + 6 + p.width(text, f)
            gx = (c['x0'] + c['x1'] - mk) / 2 - tw / 2
            p.icon(c['icon'], ICON_BOX, gx + ICON_BOX / 2, ICON_Y, ink)
            p.text(gx + ICON_BOX + 6, TEXT_BASE, text, f, WHITE)
        else:
            p.icon(c['icon'], ICON_BOX, (c['x0'] + c['x1']) / 2 + 1, ICON_Y, ink)
        if c.get('mark'):
            p.icon(c['mark'], 30, c['x1'] - 24, ICON_Y, WHITE)
        mine = [b for g, k, lb, b in p.ink[n0:]]
        if mine:
            xa, xb = min(b[0] for b in mine), max(b[2] for b in mine)
            p.cellinfo[c['id']] = dict(ink=(round(xa, 1), round(xb, 1)), left_margin=round(xa - c['x0'], 1), right_margin=round(c['x1'] - xb, 1),
                                       cell=(c['x0'], c['x1']))
    p.g = 'page'


# ---- bottom row and BMW's panel ---------------------------------------------------------------------------------------------
def bottom_row(p, lines, rule=None):
    """lines 2: odometer + trip / clock + temperature (tab 1 only); 1: clock + temperature on line 1's baseline (SPEC-R3 §3.5)."""
    p.g = 'bottom'
    if rule:
        p.rect(629, 611, 1291, 615, rule)
    else:
        p.rect(BROW[0], BROW[2], BROW[1], BROW[3], (BROW[4],) * 3)
    f, fu = M.noto(40), M.noto(21)
    rows = [(846, BASE1, '48 215', 'км'), (1153, BASE1, '412.6', 'км'), (846, BASE2, '14:43', ''), (1153, BASE2, '+7.5', '°C')] \
        if lines == 2 else [(846, BASE1, '14:43', ''), (1153, BASE1, '+7.5', '°C')]
    for x, base, num, unit in rows:
        p.text(x, base, num, f, WHITE, 'r')
        if unit:
            p.text(x + 5, base, unit, fu, WHITE, 'l')
    p.g = 'page'


def bmw_panel(p):
    """BMW's message panel as the bench draws it: the fallback polygon, grey, labelled; the bottom row has stepped aside."""
    poly = json.load(open(os.path.join(ROOT, 'design', 'twin-dial', 'vf', 'message_panel.json')))['fallback_window']['polygon_px']
    p.cv.d.polygon([(x * SS, y * SS) for x, y in poly], fill=(70, 78, 90))
    p.cv.ctext((946, 652), 'BMW MESSAGE PANEL', nb(28), (240, 240, 240))
    p.rect(629, BROW[2], 694, BROW[3], (BROW[4],) * 3)
    p.rect(1230, BROW[2], 1291, BROW[3], (BROW[4],) * 3)


# ---- tab 1: the on-board computer (SPEC-R3 §4.1) -----------------------------------------------------------------------------
def pg_clock(p, dots=None):
    p.title('Дата і година' if False else 'Дата і час', dots)
    p.ctext((960, 372), '14:43', M.saira(92))
    p.ctext((960, 450), 'вівторок', M.noto(39))
    p.ctext((960, 505), '17.11.2026', M.noto(39))


def stacked_unit(p, x, base, top, bottom):
    f = M.noto(15)
    w = max(p.width(top, f), p.width(bottom, f))
    p.text(x + w / 2, base - 16, top, f, WHITE, 'c')
    p.rect(x, base - 13, x + w, base - 12, WHITE)
    p.text(x + w / 2, base + 1, bottom, f, WHITE, 'c')


def pg_trip(p, dashes=False, dots=None):
    """02's table grammar: meta (duration), rows at 384 / 455, icons 36 at x 729, numbers right at 896 / 1109, footer at 565."""
    p.title('Поточна поїздка', dots)
    p.meta('0:43 год')
    f = M.noto(42)
    for k, (base, ic) in enumerate(((384, 'td_fuel'), (455, 'td_road'))):
        p.g = 'row%d' % k
        p.icon(ic, 46, 729 + 23, base - 15)
        if k == 0:
            p.text(896, base, 'ø 6.8', f, WHITE, 'r')
            stacked_unit(p, 896 + 10, base, 'л', '100 км')
            p.text(1109, base, 'ø –' if dashes else 'ø 41', f, WHITE, 'r')
            p.text(1119, base, 'км/год', M.noto(21), WHITE)
        else:
            p.text(896, base, '12.4', f, WHITE, 'r')
            p.text(906, base, 'км', M.noto(21), WHITE)
    p.g = 'page'
    p.text(960, 565, 'від початку поїздки, 14:00', M.noto(32), GREY2, 'c')


TECH_ROWS = [  # label, unit, bar range, red from, source key
    ('Олива', '°C', (50, 150), 130), ('Охолодження', '°C', (50, 130), 120), ('Наддув', 'бар', (0, 1.6), None), ('Зовні', '°C', None, None)]


def pg_tech(p, vals=(104, 92, 0.42, 7.5), dots=None):
    """SPEC-R3 §4.1.3: labels Noto 31 from x 745, values Noto 40 right at 1150, unit 6 px after, baselines 352 / 418 / 484 / 550; a bar
    x 745-1175, 12 px under the baseline, 6 px thick, track 0.16, fill white and red from the warning value. None = no value."""
    p.title('Технічні дані', dots)
    track = enc(np.array([0.16] * 3))
    for k, ((label, unit, rng, warn), v, base) in enumerate(zip(TECH_ROWS, vals, (352, 418, 484, 550))):
        p.g = 'tech%d' % k
        p.text(745, base, label, M.noto(31), GREY2)
        shown = '–' if v is None else ('%+.1f' % v if label == 'Зовні' else ('%.2f' % v if label == 'Наддув' else '%d' % v))
        p.text(1150, base, shown, M.noto(40), WHITE, 'r')
        p.text(1156, base, unit, M.noto(21), WHITE)
        if rng:
            y = base + 12
            p.rect(745, y, 1175, y + 6, track)
            if v is not None:
                frac = lambda x: 745 + 430 * (min(max(x, rng[0]), rng[1]) - rng[0]) / (rng[1] - rng[0])   # noqa: E731
                if warn and v > warn:
                    p.rect(745, y, frac(warn), y + 6, WHITE)
                    p.rect(frac(warn), y, frac(v), y + 6, (218, 16, 48))
                else:
                    p.rect(745, y, frac(v), y + 6, WHITE)
    p.g = 'page'


def car_outline(p, cx, cy, wpx, hpx, colour=(200, 202, 206)):
    """Our own top-view car, outline only (front up)."""
    x0, y0, x1, y1 = cx - wpx / 2, cy - hpx / 2, cx + wpx / 2, cy + hpx / 2
    p.rrect(x0, y0, x1, y1, wpx * 0.32, outline=colour, width=3)
    p.cv.d.line([((x0 + wpx * 0.14) * SS, (y0 + hpx * 0.30) * SS), ((x1 - wpx * 0.14) * SS, (y0 + hpx * 0.30) * SS)], fill=colour, width=3 * SS)
    p.cv.d.line([((x0 + wpx * 0.18) * SS, (y0 + hpx * 0.78) * SS), ((x1 - wpx * 0.18) * SS, (y0 + hpx * 0.78) * SS)], fill=colour, width=3 * SS)
    p.rrect(x0 + wpx * 0.18, y0 + hpx * 0.36, x1 - wpx * 0.18, y0 + hpx * 0.70, 6, outline=colour, width=2)
    for yy in (0.36, 0.58):
        p.cv.d.line([(x0 * SS, (y0 + hpx * yy) * SS), ((x0 + 6) * SS, (y0 + hpx * yy) * SS)], fill=colour, width=2 * SS)
        p.cv.d.line([((x1 - 6) * SS, (y0 + hpx * yy) * SS), (x1 * SS, (y0 + hpx * yy) * SS)], fill=colour, width=2 * SS)
    p._rec('shape', 'car outline', (x0, y0, x1, y1))


def pg_tyres(p, low=None, dots=None):
    """SV V1b: our own outline at (960, 430), four pressures Noto 40 + 'бар' Noto 21, temperatures under them (Noto 31 grey). low: a corner
    ('FL' ...) that is >= 0.2 bar under its target: pressure and 'бар' amber."""
    p.title('Шини', dots)
    car_outline(p, 960, 430, 110, 230)
    vals = {'FL': ((800, 360), '2.4', '+6'), 'FR': ((1120, 360), '2.4', '+6'), 'RL': ((800, 505), '2.5', '+7'), 'RR': ((1120, 505), '2.4', '+6')}
    for cn, ((x, y), pr, t) in vals.items():
        p.g = 'tyre' + cn
        if cn == low:
            pr = '2.1'
        col = SEV['amber']['icon'] if cn == low else WHITE
        f = M.noto(40)
        w = p.width(pr, f) + 4 + p.width('бар', M.noto(21))
        p.text(x - w / 2, y, pr, f, col)
        p.text(x - w / 2 + p.width(pr, f) + 4, y, 'бар', M.noto(21), col)
        p.text(x, y + 40, t + ' °C', M.noto(31), GREY_DIM, 'c')
    p.g = 'page'


# ---- tab 2: messages (SPEC-R3 §5; SC card.json) -----------------------------------------------------------------------------
SAMPLES = {   # SC card.json samples_for_mockups (invented, neutral)
    'white1': ('grey', 'cc_door', 'Двері відчинено'),
    'amber2': ('amber', 'cc_tyre', 'Тиск у шинах: перевірте'),
    'red3': ('red', 'cc_brake', 'Несправність гальм: зупиніться в безпечному місці'),
    'redcut': ('red', 'cc_brake', 'Несправність гальмівної системи: обережно зупиніться та зверніться до сервісу'),
    'green1': ('green', 'cc_info', 'Система готова до роботи'),
}
ROWS = sorted([('grey', 'cc_washer', 'Мало рідини омивача'), ('grey', 'cc_service', 'Потрібне сервісне обслуговування'),
               ('amber', 'cc_battery', 'Акумулятор розряджається'), ('grey', 'cc_door', 'Багажник відчинено'),
               ('red', 'cc_brake', 'Несправність гальм'), ('grey', 'cc_bonnet', 'Капот відчинено'), ('amber', 'cc_oil', 'Рівень оливи: перевірте'),
               ('grey', 'cc_info', 'Технічне повідомлення')], key=lambda r: {'red': 0, 'amber': 1}.get(r[0], 2))


def sev_cell(p, box, sev):
    x0, y0, x1, y1 = box
    if SEV[sev]['cell'] is None:
        hh, ww = int((y1 - y0) * SS), int((x1 - x0) * SS)
        p.paste_rgb(x0, y0, np.stack([M.srgb(np.linspace(0.002, 0.16, hh))] * 3, -1)[:, None, :] * np.ones((1, ww, 1)))
    else:
        p.rect(x0, y0, x1, y1, SEV[sev]['cell'])


def scroll(p, frac0, frac1):
    p.rect(1188, 300, 1191, 564, (40, 40, 40))
    p.rect(1188, 300 + 264 * frac0, 1191, 300 + 264 * frac1, (180, 180, 180))


def list_rows(p, rows, top, n):
    for k, (sev, sym, name) in enumerate(rows[:n]):
        p.g = 'row%d' % k
        y = top + 44 * k
        p.icon(sym, 32, 757, y + 22, ROW_SEV_INK[sev])
        p.text(781, y + 33, fit(p, name, M.noto(33), 399), M.noto(33), WHITE)
    p.g = 'page'


def pg_card(p, key, counter=None, rows_n=None):
    """The card: severity cell [922, 306, 998, 382], symbol 54 at (960, 344), headline Noto 42 centred, up to 3 lines at 424 / 471 / 518
    (cut with '…'), counter top right (right edge 1180, baseline 326), then 2 / 1 / 0 rows of the other entries, scroll when more."""
    sev, sym, text = SAMPLES[key]
    p.title('Повідомлення')
    f = M.noto(42)
    sev_cell(p, (922, 306, 998, 382), sev)
    p.g = 'card'
    p.icon(sym, 54, 960, 344, SEV[sev]['sym'])
    lines, _ = wrap(p, text, f, 436, 3)
    for b, s in zip((424, 471, 518), lines):
        p.text(960, b, s, f, WHITE, 'c')
    if counter:
        p.g = 'counter'
        p.text(1180, 326, counter, M.noto(29), GREY2, 'r')
    p.g = 'page'
    n_rows = {1: 2, 2: 1, 3: 0}[len(lines)] if rows_n is None else rows_n
    top = (424, 471, 518)[len(lines) - 1] + 20 + 6
    others = [r for r in ROWS if r[2] != text]
    list_rows(p, others, top, n_rows)
    if len(others) > n_rows:
        scroll(p, 0, max(0.12, (n_rows + 1) / (len(others) + 1)))
    return sev


def pg_list(p):
    p.title('Повідомлення')
    list_rows(p, ROWS, 300, 6)
    scroll(p, 0, 6 / len(ROWS))


def pg_empty(p):
    p.title('Повідомлення')
    p.icon('cc_info', 66, 960, 392, (188, 188, 188))
    p.text(960, 478, 'Немає повідомлень', M.noto(39), GREY2, 'c')


def pg_pointer(p, sev='amber'):
    """SC pointer: the cell by the severity the machine knows (grey when none or unknown), the symbol generic by colour: cc_warn for red, amber
    and unknown (D7 not confirmed), cc_info otherwise. Our fixed words, never the message's."""
    p.title('Повідомлення')
    cell = 'grey' if sev == 'unknown' else sev
    sev_cell(p, (922, 306, 998, 382), cell)
    p.icon('cc_warn' if sev in ('red', 'amber', 'unknown') else 'cc_info', 54, 960, 344, SEV[cell]['sym'])
    p.text(960, 424, 'Повідомлення', M.noto(39), GREY2, 'c')
    p.text(960, 471, 'на панелі внизу', M.noto(39), GREY2, 'c')


# ---- tab 3: media (SPEC-R3 §4.3; SM model.json) --------------------------------------------------------------------------------
def pg_media_min(p):
    p.title('Медіа')
    p.icon('td_media', 66, 960, 392)


def pg_radio(p, band='FM'):
    p.title('Радіо')
    p.meta(band)
    p.icon('td_radio', 54, 960, 344)
    p.text(960, 424, 'Радіо Приклад', M.noto(41), WHITE, 'c')
    p.text(960, 471, "Новини о дев'ятій", M.noto(29), GREY_MID, 'c')
    foot = 'P3  ·  101.7  ·  TP' if band == 'FM' else 'P2  ·  DAB 12B  ·  TP'
    p.text(960, 565, foot, M.noto(32), GREY2, 'c')


def pg_track(p, source='USB', title='Ранкова хвиля', artist='Гурт Приклад', muted=False):
    p.title('Медіа')
    p.meta(source)
    f, fa = M.noto(41), M.noto(31)
    p.text(960, 400, fit(p, title, f, 440), f, WHITE, 'c')
    p.text(960, 444, fit(p, artist, fa, 440), fa, GREY_MID, 'c')
    p.rect(800, 499, 1120, 501, (80, 80, 80))
    p.rect(800, 499, 800 + 320 * 0.28, 501, WHITE)
    p.text(800, 530, '1:01', M.noto(21), GREY2)
    p.text(1120, 530, '3:35', M.noto(21), GREY2, 'r')
    p.text(960, 556, '4 / 12', M.noto(25), GREY_MID, 'c')
    if muted:
        p.icon('td_mute', 30, 757, 316, GREY2)


# ---- tab 4: phone (SPEC-R3 §4.4; SP model.json) ----------------------------------------------------------------------------------
def pg_phone_idle(p, kind='carplay'):
    p.title('Телефон')
    if kind in ('carplay', 'bt'):
        p.icon('td_phone', 54, 960, 344)
        p.text(960, 424, 'Підключено · ' + ('CarPlay' if kind == 'carplay' else 'Bluetooth'), M.noto(39), WHITE, 'c')
        if kind == 'carplay':                              # line 2 Noto 29 grey: battery and signal, as the car gives them
            f = M.noto(29)
            w1, w2 = p.width('80 %', f), p.width('3/4', f)
            total = 28 + 8 + w1 + 36 + 26 + 8 + w2
            x = 960 - total / 2
            p.icon('cc_battery', 28, x + 14, 462, GREY_MID)
            p.text(x + 36, 471, '80 %', f, GREY_MID)
            p.icon('td_bars', 26, x + 36 + w1 + 36 + 13, 462, GREY_MID)
            p.text(x + 36 + w1 + 36 + 34, 471, '3/4', f, GREY_MID)
    elif kind == 'none':
        p.icon('td_phone_none', 54, 960, 344)
        p.text(960, 424, 'Телефон не підключено', M.noto(39), WHITE, 'c')
    else:
        p.icon('td_phone', 54, 960, 344)
        p.text(960, 424, 'Немає даних', M.noto(39), GREY_MID, 'c')


def pg_phone_call(p, state, who='contact', muted=False):
    line = {'contact': 'Контакт', 'number': 'Номер', 'name': 'Абонент Приклад'}[who]
    if state == 'incoming':
        p.title('Вхідний дзвінок')
        p.meta('CarPlay')
        p.icon('td_handset', 66, 960, 372, LIT_GREEN)
    else:
        p.title('Розмова')
        p.meta('CarPlay')
        p.text(960, 410, '02:37', M.saira(72), WHITE, 'c')
    p.text(960, 478, line, M.noto(39), WHITE, 'c')
    if muted:
        p.icon('td_mic_off', 36, 960, 526, GREY2)


# ---- tab 5: navigation (SPEC-R3 §4.5; SN map.json / guidance.json) -----------------------------------------------------------------
W1_BOX, W1_FADE = (750, 180, 1170, 564), (120, 80, 80)


def map_layer(seed=11):
    """SN stand-in in BMW's box: navy ground, roads, a blue route, the car chevron, BMW's own soft edge (35 px). Returns (rgb, alpha, origin)
    over the union box [700, 138, 1220, 600]. Drawn: visibly not a real place."""
    ux0, uy0, ux1, uy1 = 700, 138, 1220, 600
    w, h = (ux1 - ux0) * SS, (uy1 - uy0) * SS
    bx0, by0, bx1, by1 = [(v - o) * SS for v, o in zip(MAP_BOX10, (ux0, uy0, ux0, uy0))]
    t = np.linspace(0, 1, h)[:, None]
    ground = (np.array([18, 32, 64]) * (1 - t)[..., None] + np.array([30, 50, 90]) * t[..., None]) * np.ones((1, w, 1))
    m = Image.fromarray(ground.astype(np.uint8))
    d = ImageDraw.Draw(m)
    rng = np.random.default_rng(seed)

    def P(x, y):
        return ((x - ux0) * SS, (y - uy0) * SS)
    for k in range(10):
        x = 690 + k * 58 + rng.uniform(-12, 12)
        d.line([P(x, 130), P(x + 70, 610)], fill=(120, 140, 170), width=int(3 * SS))
    for k in range(8):
        y = 140 + k * 62 + rng.uniform(-10, 10)
        d.line([P(690, y), P(1230, y - 40)], fill=(120, 140, 170), width=int(3 * SS))
    main = [P(950, 610), P(955, 480), P(965, 380), P(1040, 300), P(1230, 240)]
    d.line(main, fill=(150, 168, 196), width=int(6 * SS), joint='curve')
    side = [P(965, 380), P(900, 320), P(800, 290), P(690, 280)]
    d.line(side, fill=(150, 168, 196), width=int(6 * SS), joint='curve')
    d.line(main[:3] + side[1:], fill=(60, 120, 255), width=int(8 * SS), joint='curve')
    cx, cy = P(958, 480)
    s = 15 * SS
    d.polygon([(cx, cy - s), (cx + s * 0.75, cy + s * 0.8), (cx, cy + s * 0.35), (cx - s * 0.75, cy + s * 0.8)], fill=WHITE)
    d.text(P(770, 330), 'заглушка мапи: не реальне місце', font=M.noto(17), fill=(150, 160, 180), anchor='ls')
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    e = 35 * SS
    a = np.minimum.reduce([np.clip((xx - bx0) / e, 0, 1), np.clip((bx1 - xx) / e, 0, 1),
                           np.clip((yy - by0) / e, 0, 1), np.clip((by1 - yy) / e, 0, 1)])
    return np.asarray(m).astype(float), a, (ux0, uy0)


def window_alpha(shape, origin):
    """W1 (SPEC-R3 §4.5): zero box [750, 180, 1170, 564], fades 120 (top), 80 (sides and bottom), corner radius 24."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(float) / SS
    xx += origin[0]
    yy += origin[1]
    x0, y0, x1, y1 = W1_BOX
    ft, fs, fb = W1_FADE
    a = np.minimum.reduce([np.clip((yy - y0) / ft, 0, 1), np.clip((xx - x0) / fs, 0, 1), np.clip((x1 - xx) / fs, 0, 1),
                           np.clip((y1 - yy) / fb, 0, 1)])
    cr = 24.0                                                  # rounded corners of the zero box
    qx, qy = np.maximum(np.maximum(x0 + cr - xx, xx - (x1 - cr)), 0), np.maximum(np.maximum(y0 + cr - yy, yy - (y1 - cr)), 0)
    inside = (np.hypot(qx, qy) <= cr) & (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
    return a * inside


def pg_map(p, road=True):
    """W1: no title; our map stand-in under BMW's own soft edge, faded by the window; the road name (Noto 33, white) on a dark bar at the foot,
    baseline 590 (SPEC-R3 §4.5; SN's own bar was [760, 540, 1160, 584] at Noto 31: the spec wins)."""
    rgb, a_bmw, origin = map_layer()
    wa = window_alpha(a_bmw.shape, origin)
    a = a_bmw * wa
    x0, y0 = origin
    reg = np.asarray(p.cv.img.crop((x0 * SS, y0 * SS, x0 * SS + rgb.shape[1], y0 * SS + rgb.shape[0]))).astype(float)
    out = np.where((wa > 0)[..., None], rgb * a[..., None], reg)
    p.cv.img.paste(Image.fromarray(out.astype(np.uint8)), (x0 * SS, y0 * SS))
    p.cv.d = ImageDraw.Draw(p.cv.img)
    if road:
        bx = (760, 556, 1160, 600)
        reg = np.asarray(p.cv.img.crop(tuple(v * SS for v in bx))).astype(float) * 0.4
        p.cv.img.paste(Image.fromarray(reg.astype(np.uint8)), (bx[0] * SS, bx[1] * SS))
        p.cv.d = ImageDraw.Draw(p.cv.img)
        p.text(960, 590, 'вулиця Тестова', M.noto(33), WHITE, 'c')


def fmt_dist(m):
    """SN distance rule (hypothesis): < 100 m to 10 m; < 1000 m to 50 m; >= 1 km one decimal up to 10 km, whole km above."""
    if m < 100:
        return '%d' % (round(m / 10.0) * 10), 'м'
    if m < 1000:
        return '%d' % (round(m / 50.0) * 50), 'м'
    km = m / 1000.0
    return ('%.1f' % km if km < 10 else '%d' % round(km)), 'км'


def pg_guided(p, icon='td_turn_right', dist=350, road='вулиця Тестова', lanes=True, footer='прибуття 09:32 · 14.2 км', icon_text=None):
    """SPEC-R3 §4.5: arrow 120 x 120 at [770, 318, 890, 438]; distance Saira 72 left at x 915, baseline 410, unit Noto 29; next road Noto 33 at
    baseline 480 (clipped at x 1180); lane row (<= 8 lanes, 34 px pitch, 30 px arrows) y 498-532; footer Noto 29 grey at baseline 560."""
    p.title('Навігація')
    p.g = 'arrow'
    p.icon(icon, 120, 830, 378)
    if icon_text:
        p.ctext((830, 388), icon_text, M.saira(40))
    p.g = 'dist'
    num, unit = fmt_dist(dist)
    p.text(915, 410, num, M.saira(72), WHITE)
    p.text(915 + p.width(num, M.saira(72)) + 8, 410, unit, M.noto(29), WHITE)
    p.g = 'page'
    p.text(770, 480, fit(p, road, M.noto(33), 1180 - 770), M.noto(33), WHITE)
    if lanes:
        seq = (('td_turn_left', False), ('td_straight', True), ('td_straight', True), ('td_turn_right', False))
        for k, (name, hi) in enumerate(seq):
            p.icon(name, 30, 960 + (k - 1.5) * 34, 515, WHITE if hi else (110, 110, 110))
    p.text(960, 560, footer, M.noto(29), GREY_DIM, 'c')


def pg_nav_state(p, state):
    p.title('Навігація')
    if state == 'idle':
        p.ctext((960, 420), 'Маршрут не прокладено', M.noto(29), GREY_DIM)
    elif state == 'road_only':
        p.ctext((960, 400), 'вулиця Тестова', M.noto(41))
        p.ctext((960, 452), 'Маршрут не прокладено', M.noto(29), GREY_DIM)
    else:
        p.ctext((960, 400), 'Розрахунок маршруту…', M.noto(33))


# ---- the pictures -----------------------------------------------------------------------------------------------------------------
SHOTS = []
SEL_SEV = {}


def spec_status(keys):
    return {k: STATUS[k][0] for k in keys}


def audit_keepouts(img):
    """Non-black pixels (any channel > 8) of the picture inside the keep-outs of MOCKUP-SPEC-R3B §1: belt group, gear gap, the seven lamp holes."""
    a = np.asarray(img.convert('RGB')).max(-1)
    res = {}
    holes = json.load(open(os.path.join(ROOT, 'design', 'twin-dial', 'vg', 'layout.json')))['keep_outs']['telltales_holes']['rects_plus_3px']
    for nm, (x0, y0, x1, y1) in list(KEEP.items()) + [('lamp%d' % i, tuple(h)) for i, h in enumerate(holes)]:
        res[nm] = int((a[y0:y1, x0:x1] > 8).sum())
    return res


def gaps(p):
    """Pairs of ink boxes of ours (different groups) with < 6 px of black between them (negative: overlap). A page's own text only."""
    out = []
    boxes = [(g, k, lb, b) for g, k, lb, b in p.ink if k in ('text', 'icon', 'shape')]
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            (g1, k1, l1, a), (g2, k2, l2, b) = boxes[i], boxes[j]
            if g1 == g2 and g1 != 'page':
                continue
            if g1.startswith('tab') and g2.startswith('tab') and g1 == g2:
                continue
            dx = max(b[0] - a[2], a[0] - b[2])
            dy = max(b[1] - a[3], a[1] - b[3])
            g = max(dx, dy)
            if g < 6:
                out.append(dict(a=l1, b=l2, gap=round(g, 1)))
    return out


def edges(p):
    """Our ink outside its allowed place: centre pages inside the window [729, 1191] x [172, 613] (SF: content may reach 10 px beyond the title rule's
    ends, so 1191 is the window's edge), tab content within 4 px of its separators. Each: what, how far over (px)."""
    out = []
    for g, k, lb, b in p.ink:
        if g.startswith('tab') or g == 'bottom' or k == 'shape':
            continue
        over = max(729 - b[0], b[2] - 1191, 0)
        if over > 0:
            out.append(dict(what=lb, over_px=round(over, 1), box=b))
    for cid, ci in p.cellinfo.items():
        m = min(ci['left_margin'], ci['right_margin'])
        if m < 4:
            out.append(dict(what='tab %d content' % cid, over_px=round(4 - m, 1), box=ci['ink']))
    return out


def shot(folder, pid, name, caption, keys, sel=1, page=None, cs=None, warn=None, s2=False, bottom=None, sev_rule=None, window=False,
         speed=87.0, rpm=2.4, extra=None, sel_colour=None, close=None, sec='', variant=None, t1mode='spec', annotate=None, save=True):
    p = Page(speed, rpm)
    tab_bar(p, cs or cells(), sel, sel_colour, warn, s2, t1mode)
    if page:
        r = page(p)
        if sev_rule == 'auto' and r:
            sev_rule = SEV[r]['rule']
    if window:
        bmw_panel(p)
    else:
        bottom_row(p, bottom or (2 if sel == 1 else 1), sev_rule if sev_rule not in (None, 'auto') else None)
    if extra:
        extra(p)
    img = p.finish()
    if not save:
        return img, p
    fn = '%s_%s' % (pid, name)
    path = os.path.join(OUT, folder, fn + '.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    entry = dict(id=pid, folder=folder, file=os.path.relpath(path, OUT), name=name, caption=caption, variant=variant, spec=sec,
                 status=spec_status(keys), source={k: STATUS[k][1] for k in keys}, look=LOOK_NAME,
                 keepout_nonblack_px=audit_keepouts(img), close_pairs=gaps(p), edges=edges(p), cells=p.cellinfo)
    if close:
        x0, y0, x1, y1 = close
        cpath = os.path.join(OUT, folder, fn + '_close.png')
        img.crop(close).resize((int((x1 - x0) * 2), int((y1 - y0) * 2)), Image.LANCZOS).save(cpath)
        entry['close'] = os.path.relpath(cpath, OUT)
    if annotate:
        kp = os.path.join(OUT, folder, fn + '_annotated.png')
        annotate(img).save(kp)
        entry['annotated'] = os.path.relpath(kp, OUT)
    SHOTS.append(entry)
    print('wrote', path)
    return img, p


def save_composite(folder, pid, name, caption, keys, img, sec='', variant=None, extra_fields=None, p=None):
    fn = '%s_%s' % (pid, name)
    path = os.path.join(OUT, folder, fn + '.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    entry = dict(id=pid, folder=folder, file=os.path.relpath(path, OUT), name=name, caption=caption, variant=variant, spec=sec,
                 status=spec_status(keys), source={k: STATUS[k][1] for k in keys}, look=LOOK_NAME, composite=True,
                 keepout_nonblack_px=None)
    entry.update(extra_fields or {})
    SHOTS.append(entry)
    print('wrote', path)


def annotate_keepouts(img):
    """mockup.annotate (hood, belt group, gear gap, BMW's gear letter, fallback window, lamps) plus the G20 black box [1420, 320, 1611, 440]
    and BMW's stored-message marker [1240, 588, 1288, 630]."""
    out = M.annotate(img).convert('RGBA')
    ov = Image.new('RGBA', out.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rectangle(KOMBI_BOX_G20, fill=(255, 255, 255, 60), outline=(255, 255, 255, 255), width=2)
    d.rectangle((1240, 588, 1288, 630), outline=(255, 120, 200, 255), width=2)
    out = Image.alpha_composite(out, ov).convert('RGB')
    dd = ImageDraw.Draw(out)
    dd.text((KOMBI_BOX_G20[0] + 4, KOMBI_BOX_G20[1] + 4), 'KOMBI black box (G20)', font=lf(16), fill=(255, 255, 255))
    dd.rectangle([20, 20 + 6 * 26, 38, 38 + 6 * 26], fill=(255, 255, 255))
    dd.text((46, 20 + 6 * 26), 'KOMBI black box, G20 [1420, 320, 1611, 440]', font=lf(18), fill=(255, 255, 255))
    dd.text((1240, 634), "BMW's stored-message marker", font=lf(14), fill=(255, 120, 200))
    return out


def annotate_map(img):
    out = img.convert('RGBA')
    ov = Image.new('RGBA', out.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rectangle(MAP_BOX10, outline=(255, 220, 0, 255), width=2)
    d.rectangle(MAP_BOX90, outline=(0, 255, 120, 255), width=2)
    d.rectangle(W1_BOX, outline=(255, 120, 200, 255), width=2)
    out = Image.alpha_composite(out, ov).convert('RGB')
    dd = ImageDraw.Draw(out)
    for i, (col, t) in enumerate([((255, 220, 0), "BMW's map box, 10 % edge: x 700-1217, y 138-594"),
                                  ((0, 255, 120), 'full brightness (90 %): x 794-1150, y 209-557'),
                                  ((255, 120, 200), 'our window W1, zero box [750, 180, 1170, 564] (fades 120 / 80 / 80)')]):
        dd.rectangle([20, 20 + i * 26, 38, 38 + i * 26], fill=col)
        dd.text((46, 20 + i * 26), t, font=lf(18), fill=(255, 255, 255))
    return out


# ---- composites (bars, strips) -------------------------------------------------------------------------------------------------------
LAB = (225, 225, 225)


def new_canvas():
    return Image.new('RGB', (W, H), (0, 0, 0))


def label(img, xy, text, size=22, fill=LAB, bold=False, anchor='la'):
    ImageDraw.Draw(img).text(xy, text, font=lf(size, bold), fill=fill, anchor=anchor)


def crop_to(canvas, src, box, xy, scale):
    c = src.crop(box)
    c = c.resize((int(round(c.width * scale)), int(round(c.height * scale))), Image.LANCZOS)
    canvas.paste(c, (int(xy[0]), int(xy[1])))
    return c.size


def bar_page(cs, sel=1, warn=None, speed=87.0, t1mode='spec'):
    p = Page(speed)
    tab_bar(p, cs, sel, None, warn, False, t1mode)
    return p.finish(), p


def ref_panel_crop(rid, box, scale):
    """The rectified reference's region at our panel px (reference frames are R = 400 px; the midpoint of the two dial centres maps to
    x 960, y 400). Only for git-ignored contact sheets, labelled 'reference, not ours'. None when the frame is missing."""
    try:
        img = Image.open(os.path.join(PUB, 'SD', rid + '_rect.png')).convert('RGB')
        cv = json.load(open(os.path.join(PUB, 'SD', rid + '_model.json')))['canvas']
    except Exception as e:
        print('no reference', rid, e)
        return None
    mx, my, k = (cv['left_centre'][0] + cv['right_centre'][0]) / 2, cv['left_centre'][1], cv['R_px'] / R
    x0, y0, x1, y1 = box
    c = img.crop((int(round(mx + (x0 - 960) * k)), int(round(my + (y0 - 400) * k)), int(round(mx + (x1 - 960) * k)), int(round(my + (y1 - 400) * k))))
    return c.resize((int(round((x1 - x0) * scale)), int(round((y1 - y0) * scale))), Image.LANCZOS)


def t06(img, p):
    """T06: the bar measured. Ours (annotated) over the rectified 06 at the same scale; our separators drawn through both."""
    box = (606, 112, 1314, 182)
    sc = 2.6
    cv = new_canvas()
    y_ours, y_ref = 78, 78 + int(70 * sc) + 120
    crop_to(cv, img, box, (40, y_ours), sc)
    ref = ref_panel_crop('06', box, sc)
    d = ImageDraw.Draw(cv)

    def X(x):
        return 40 + (x - box[0]) * sc

    def Y(y, base=y_ours):
        return base + (y - box[1]) * sc
    label(cv, (40, 12), 'T06  the tab bar, measured: ours (final look) above, rectified 06 below (reference, not ours: same R)', 24, bold=True)
    for sx in SEPS + [618, 1302]:
        for base in ((y_ours, y_ref) if ref is not None else (y_ours,)):
            d.line([(X(sx), Y(112, base) - 8), (X(sx), Y(182, base) + 6)], fill=(0, 220, 255), width=1)
        label(cv, (X(sx), 52), '%d' % sx, 17, (0, 220, 255), anchor='ma')
    d.line([(X(618), Y(147) + 30), (X(636), Y(147) + 30)], fill=(255, 220, 0), width=3)          # the 18 px inset
    label(cv, (X(618) - 4, Y(182) + 8), '18 px inset (icon ink from 636)', 17, (255, 220, 0))
    d.line([(X(635), Y(129)), (X(635), Y(164))], fill=(255, 120, 200), width=2)                  # icon 36 px
    label(cv, (X(636) + 6, Y(121)), 'icon 36 px', 17, (255, 120, 200))
    label(cv, (X(780) + 10, Y(182) + 8), 'text cap 24 px (Noto 34), baseline 156', 17, (120, 255, 160))
    d.line([(X(740), Y(132)), (X(740), Y(156))], fill=(120, 255, 160), width=2)
    d.rectangle([X(618), Y(170), X(1302), Y(173)], outline=(255, 255, 255), width=1)
    label(cv, (X(1302) - 4, Y(173) + 4), 'rule 3 px, code 230', 17, WHITE, anchor='ra')
    label(cv, (X(1000), Y(182) + 8), "selected cell's rule = tab colour + 0.15 x white", 17, (255, 160, 160))
    if ref is not None:
        cv.paste(ref, (40, y_ref))
        label(cv, (40, y_ref - 30), 'reference 06, rectified (not ours): tab 1 filled red, its own content; its separators sit within a few px of ours', 18, GREY_MID)
        d = ImageDraw.Draw(cv)
        for sx in SEPS + [618, 1302]:
            d.line([(X(sx), Y(112, y_ref) - 8), (X(sx), Y(182, y_ref) + 6)], fill=(0, 220, 255), width=1)
    return cv


def rows_composite(title, rows, box, scale, pitch=None, **_):
    """rows: [(label, image)]: a crop of each image at `scale`, centred, the label in a band above it."""
    cv = new_canvas()
    label(cv, (40, 12), title, 24, bold=True)
    pitch = pitch or int((box[3] - box[1]) * scale + 44)
    cw = int((box[2] - box[0]) * scale)
    for i, (lab, img) in enumerate(rows):
        y = 52 + i * pitch
        label(cv, ((W - cw) / 2, y), lab, 20, WHITE, bold=True)
        crop_to(cv, img, box, ((W - cw) / 2, y + 26), scale)
    return cv


def frames_composite(title, frames, crop, cols, scale, label_h=44):
    """frames: [(label, image)]: crops side by side, `cols` per row, on one 1920 x 720 canvas."""
    cv = new_canvas()
    label(cv, (40, 10), title, 22, bold=True)
    cw, ch = int((crop[2] - crop[0]) * scale), int((crop[3] - crop[1]) * scale)
    rows = (len(frames) + cols - 1) // cols
    gx = (W - cols * cw) / (cols + 1)
    gy = (H - 44 - rows * (ch + label_h)) / (rows + 1)
    for i, (lab, img) in enumerate(frames):
        x = gx + (i % cols) * (cw + gx)
        y = 44 + gy + (i // cols) * (ch + label_h + gy)
        crop_to(cv, img, crop, (x, y + label_h), scale)
        for k, line in enumerate(lab.split('\n')[:2]):
            label(cv, (x, y + k * 20), line, 18 if k else 19, LAB if k else WHITE, bold=(k == 0))
    return cv


# ---- build ----------------------------------------------------------------------------------------------------------------------------
BARBOX = (600, 116, 1320, 186)


def build():
    register_pictos()
    # ---- the tab bar
    shot('tabs', 'T01', 'sel1', 'tab 1 selected (red): date and time, two-line bottom row', ['range', 'clock'], 1, pg_clock, close=BARBOX, sec='§3.2, §3.5',
         annotate=annotate_keepouts)
    shot('tabs', 'T02', 'sel2', 'tab 2 selected (red): an amber card; severity in the cell, not in the fill', ['cc', 'cc_now'], 2,
         lambda p: pg_card(p, 'amber2'), warn='amber', sev_rule='auto', close=BARBOX, sec='§3.2, §5.1')
    shot('tabs', 'T03', 'sel3', 'tab 3 selected (amber): radio', ['media'], 3, pg_radio, close=BARBOX, sec='§3.2, §4.3')
    shot('tabs', 'T04', 'sel4', 'tab 4 selected (green): phone idle', ['phone'], 4, pg_phone_idle, close=BARBOX, sec='§3.2, §4.4')
    shot('tabs', 'T05', 'sel5', 'tab 5 selected (blue): the map window W1', ['map', 'road'], 5, pg_map, close=BARBOX, sec='§3.2, §4.5')
    # the bar close-ups at 3x (the spec asks "a bar close-up at 3x")
    for pid, nm in (('T01', 'sel1'), ('T02', 'sel2'), ('T03', 'sel3'), ('T04', 'sel4'), ('T05', 'sel5')):
        im = Image.open(os.path.join(OUT, 'tabs', '%s_%s.png' % (pid, nm))).crop(BARBOX)
        im.resize((im.width * 3, im.height * 3), Image.LANCZOS).save(os.path.join(OUT, 'tabs', '%s_%s_close.png' % (pid, nm)))
    img, p = bar_page(cells(), 1)
    full, pf = shot('tabs', 'T06', 'bar_measured', '', [], 1, pg_clock, save=False)
    cv = t06(full, pf)
    save_composite('tabs', 'T06', 'bar_measured', 'the bar measured: separators 780 / 848 / 1168 / 1237, 18 px inset, icon 36, text cap 24, 3 px rule; beside rectified 06',
                   ['range'], cv, '§3.1', extra_fields=dict(cells=pf.cellinfo))
    t07()
    t08_t11()
    tab1_pages()
    tab2_pages()
    tab3_pages()
    tab4_pages()
    tab5_pages()


def t07():
    """Range values in tab 1 (cell 618-780): where the unit goes and where '...' starts (the value itself too long)."""
    info, rows = {}, []
    for val in ('8', '87', '412', '1024', '10240'):
        im, pp = bar_page(C(t1=dict(text=val, mode='spec')), 1)
        ink = pp.cellinfo[1]
        unit = [lb for g, k, lb, b in pp.ink if g == 'tab1' and k == 'text' and lb != val and not lb.startswith(val[:1] + '')]
        txt = [lb for g, k, lb, b in pp.ink if g == 'tab1' and k == 'text']
        info[val] = dict(texts=txt, ink=ink['ink'], right_margin=ink['right_margin'])
        rows.append((val, im, txt, ink))
    cv = new_canvas()
    label(cv, (40, 12), 'T07  range values in tab 1 (cell 618-780): the unit goes first when it comes nearer than 14 px to the separator; "…" starts only when the value itself does not fit',
          20, bold=True)
    box = (610, 127, 800, 173)
    sc = 2.8
    for i, (val, im, txt, ink) in enumerate(rows):
        y = 56 + i * 132
        label(cv, (40, y + 8), '"%s км"' % val, 30, WHITE, bold=True)
        label(cv, (40, y + 52), 'shown: %s' % ' '.join(txt[1:] if txt else []) if False else 'shown: ' + ' '.join(txt), 18, GREY2)
        label(cv, (40, y + 78), 'ink %.0f-%.0f, %.1f px to the separator' % (ink['ink'][0], ink['ink'][1], ink['right_margin']), 17, GREY_MID)
        crop_to(cv, im, box, (700, y), sc)
        d = ImageDraw.Draw(cv)
        sx = 700 + (780 - box[0]) * sc
        d.line([(sx, y - 4), (sx, y + 46 * sc + 4)], fill=(0, 220, 255), width=1)
    save_composite('tabs', 'T07', 'range_values', 'range values 8 / 87 / 412 / 1024 / 10240 in tab 1: where the unit goes and where "…" starts', ['range'], cv, '§3.1',
                   extra_fields=dict(measured=info))


def t08_t11():
    box = (606, 118, 1314, 182)
    sc = 2.0
    # T08 tab 2's icon: white (nothing), red, amber (a message while another tab is selected), white on the fill (selected)
    rows = []
    for lab, sel, warn in (('nothing shows: white, unfilled', 1, None), ('red message, another tab selected', 1, 'red'),
                           ('amber message, another tab selected', 1, 'amber'), ('tab 2 selected: white on the fill', 2, 'amber')):
        im, _ = bar_page(cells(), sel, warn)
        rows.append((lab, im))
    cv = rows_composite('T08  tab 2: the warning icon in its four states', rows, box, sc, pitch=164)
    save_composite('tabs', 'T08', 'tab2_icon', 'tab 2 icon: white, red, amber, white on the fill', ['cc'], cv, '§3.3, §5.3')
    # T09 tab 3's variants
    longname = 'Радіо Приклад Ніч Музика Новини 101.7'
    rows = []
    for lab, kw in (('tuner icon + a long station name, cut with "…"', dict(icon='td_radio', text=longname)),
                    ('player icon + a title', dict(icon='td_media', text='Ранкова хвиля')),
                    ('CarPlay icon + a title', dict(icon='td_projection', text='Ранкова хвиля')),
                    ('icon only (no data yet)', dict(icon='td_media', text=None)),
                    ('mute mark (after probe)', dict(icon='td_media', text='Ранкова хвиля', mark='td_mute'))):
        im, _ = bar_page(C(t3=kw), 1)
        rows.append((lab, im))
    cv = rows_composite('T09  tab 3: icon and text variants (cell 848-1168, 320 px)', rows, (606, 124, 1314, 176), sc, pitch=132)
    save_composite('tabs', 'T09', 'tab3_variants', 'tab 3: tuner + long name, player + title, CarPlay, icon only, mute mark', ['media', 'media_src', 'mute'], cv, '§3.3')
    # T10 tab 4's variants
    rows = []
    for lab, kw in (('plain phone (no data: until the probe)', dict(icon='td_phone')),
                    ('phone with bars 0 / 1 / 2 / 3 / 4 (after probe): bars 3 drawn', dict(icon='td_phone_bars')),
                    ('crossed-out phone (no phone connected)', dict(icon='td_phone_none')),
                    ('lit during a call (tab 1 selected)', dict(icon='td_phone', ink=LIT_GREEN))):
        im, _ = bar_page(C(t4=kw), 1)
        rows.append((lab, im))
    cv = rows_composite('T10  tab 4: phone icon variants', rows, box, sc, pitch=164)
    save_composite('tabs', 'T10', 'tab4_variants', 'tab 4: plain, with bars, crossed out, lit during a call', ['phone', 'phone_icon', 'call'], cv, '§3.3')
    # T11 tab 5
    rows = []
    for lab, kw in (('navigation arrow', dict(icon='td_nav')), ('within 300 m of a manoeuvre: the turn arrow (30 px; after probe)', dict(icon='td_turn_right'))):
        im, _ = bar_page(C(t5=kw), 1)
        rows.append((lab, im))
    cv = rows_composite('T11  tab 5: the arrow and the turn arrow', rows, box, sc, pitch=164)
    save_composite('tabs', 'T11', 'tab5_variants', 'tab 5: arrow, turn arrow', ['guiding', 'dart'], cv, '§3.3')


CENTRE = (729, 172, 1191, 613)


def tab1_pages():
    shot('tab1', '1A', 'clock', 'date and time (the large Saira clock of the approved mockup)', ['clock'], 1, pg_clock, sec='§4.1.1')
    shot('tab1', '1B', 'trip', 'trip: 02 table grammar, the stacked consumption unit, the meta line, the footer', ['trip'], 1, pg_trip, close=(729, 290, 1191, 580), sec='§4.1.2')
    shot('tab1', '1C', 'trip_dashes', 'trip with a silent field: only the average speed is dashed', ['trip'], 1, lambda p: pg_trip(p, dashes=True),
         close=(729, 290, 1191, 580), sec='§4.1.2', variant='a silent value shows "–", the others stay')
    shot('tab1', '1D', 'tech', 'technical data: normal values (oil 104, coolant 92, boost 0.42, outside +7.5)', ['oil', 'coolant', 'boost', 'outside'], 1,
         pg_tech, close=(729, 290, 1191, 580), sec='§4.1.3')
    shot('tab1', '1E', 'tech_oil_hot', 'oil at 134 °C: the bar turns red from 130', ['oil', 'coolant', 'boost', 'outside'], 1,
         lambda p: pg_tech(p, (134, 92, 0.42, 7.5)), close=(729, 290, 1191, 580), sec='§4.1.3')
    shot('tab1', '1F', 'tech_boost', 'boost under load: 1.10 бар', ['oil', 'coolant', 'boost', 'outside'], 1,
         lambda p: pg_tech(p, (104, 92, 1.10, 7.5)), close=(729, 290, 1191, 580), sec='§4.1.3', speed=112.0, rpm=3.1)
    shot('tab1', '1G', 'tech_no_value', 'a row with no value: a dash and an empty bar (boost silent)', ['oil', 'coolant', 'boost', 'outside'], 1,
         lambda p: pg_tech(p, (104, 92, None, 7.5)), close=(729, 290, 1191, 580), sec='§4.1.3')
    shot('tab1', '1H', 'tyres', 'tyres: our outline, four pressures and temperatures (after probe)', ['tyres'], 1, pg_tyres, close=(729, 290, 1191, 580), sec='§4.1.3')
    shot('tab1', '1I', 'tyres_low', 'tyres: one corner amber (0.3 bar under its target)', ['tyres'], 1, lambda p: pg_tyres(p, 'FL'),
         close=(729, 290, 1191, 580), sec='§4.1.3')
    # 1J the cycle as a strip of small frames
    frames = []
    for lab, pg in (('1 Дата і час', pg_clock), ('2 Поїздка', pg_trip), ('3 Технічні дані', pg_tech), ('4 Шини (after probe)', pg_tyres)):
        im, _ = shot('tab1', '1J', 'x', '', [], 1, pg, save=False)
        frames.append((lab, im))
    cv = new_canvas()
    label(cv, (40, 12), '1J  the cycle ("по колу": 10 s per page while the car stands, the page held above the lock speed) and the setting "Технічні дані"', 21, bold=True)
    crop = (729, 236, 1191, 580)
    sc = 0.72
    cw, ch = int(462 * sc), int(344 * sc)
    gap = 100

    def strip(y0, items, head):
        label(cv, (40, y0), head, 20, WHITE, bold=True)
        for i, (lab, im) in enumerate(items):
            x = 40 + i * (cw + gap)
            crop_to(cv, im, crop, (x, y0 + 34), sc)
            label(cv, (x, y0 + 34 + ch + 4), lab, 16, GREY2)
            label(cv, (x + cw + 30, y0 + 34 + ch // 2 - 16), '>', 30, WHITE)
    strip(52, frames, 'Технічні дані = показувати:   годинник  >  поїздка  >  технічні дані  >  шини  >  (знову годинник)')
    strip(52 + ch + 96, frames[:2], 'Технічні дані = сховати:   годинник  >  поїздка  >  (знову годинник); the technical and the tyres pages leave the choice and the cycle')
    label(cv, (40 + 2 * (cw + gap) - 30, 52 + ch + 96 + 34 + ch // 2 - 22), '(the setting is read in place: the cycle skips the hidden pages at once;', 17, GREY_MID)
    label(cv, (40 + 2 * (cw + gap) - 30, 52 + ch + 96 + 34 + ch // 2 + 2), ' the centre setting "технічні дані" alone while hidden falls back to "по колу")', 17, GREY_MID)
    save_composite('tab1', '1J', 'cycle', 'the cycle with and without "Технічні дані"', ['setting', 'trip', 'oil', 'tyres'], cv, '§4.1, §10')
    # 1K page dots
    a, _ = shot('tab1', '1K', 'x', '', [], 1, lambda p: pg_trip(p), save=False)
    b, _ = shot('tab1', '1K', 'x', '', [], 1, lambda p: pg_trip(p, dots=(4, 1)), save=False)
    a2, _ = shot('tab1', '1K', 'x', '', [], 1, pg_tech, save=False)
    b2, _ = shot('tab1', '1K', 'x', '', [], 1, lambda p: pg_tech(p, dots=(4, 2)), save=False)
    cv = frames_composite('1K  page dots under the title rule: none (left of each pair) or four small dots (right); 3 dots until the tyres page exists',
                          [('no dots - trip', a), ('dots - trip (2 of 4)', b), ('no dots - technical', a2), ('dots - technical (3 of 4)', b2)],
                          (729, 236, 1191, 420), 2, 0.9)
    save_composite('tab1', '1K', 'dots', 'page dots or none', ['setting'], cv, '§4.1',
                   variant='dots: r 3.2, pitch 15 px, y 308.5 (centre), 7 px under the rule; active white, others grey 88')
    shot('tab1', '1Ka', 'trip_nodots', '1K, no page dots: the trip page', ['trip'], 1, pg_trip, close=(729, 236, 1191, 420), sec='§4.1')
    shot('tab1', '1Kb', 'trip_dots', '1K, four page dots (2 of 4): the trip page', ['trip'], 1, lambda p: pg_trip(p, dots=(4, 1)), close=(729, 236, 1191, 420), sec='§4.1')


def tab2_pages():
    t2 = dict(warn=None, sev_rule='auto')

    def card(key, counter=None, rows_n=None):
        return lambda p: pg_card(p, key, counter, rows_n)
    shot('tab2', '2A', 'card_1_white', 'card, one line, white (grey cell) + two rows', ['cc', 'cc_now'], 2, card('white1'), warn='grey', sev_rule='auto', sec='§5.1', close=CENTRE_C)
    shot('tab2', '2B', 'card_2_amber', 'card, two lines, amber + one row', ['cc', 'cc_now'], 2, card('amber2'), warn='amber', sev_rule='auto', sec='§5.1')
    shot('tab2', '2C', 'card_3_red', 'card, three lines, red (no rows; the scroll line says more exist)', ['cc', 'cc_now'], 2, card('red3'), warn='red', sev_rule='auto', sec='§5.1')
    shot('tab2', '2D', 'card_cut_red', 'a name too long: cut with "…" on line 3', ['cc', 'cc_now'], 2, card('redcut'), warn='red', sev_rule='auto', sec='§5.1', close=CENTRE_C)
    shot('tab2', '2E', 'card_green', 'card, green', ['cc', 'cc_now'], 2, card('green1'), warn='green', sev_rule='auto', sec='§5.1, §5.3')
    shot('tab2', '2F', 'card_counter', 'card + counter "2/3" (needs the frame count, P1)', ['cc', 'cc_now', 'cc_counter'], 2, card('amber2', '2/3'), warn='amber',
         sev_rule='auto', sec='§5.1', close=CENTRE_C)
    shot('tab2', '2G', 'card_1_rows', 'card (one line) + two rows', ['cc', 'cc_now'], 2, card('white1'), warn='grey', sev_rule='auto', sec='§5.1', close=CENTRE_C)
    shot('tab2', '2H', 'card_2_row', 'card (two lines) + one row', ['cc', 'cc_now'], 2, card('amber2'), warn='amber', sev_rule='auto', sec='§5.1', close=CENTRE_C)
    shot('tab2', '2I', 'list', 'list only: six rows of mixed severity + the scroll line', ['cc'], 2, pg_list, sec='§5.1')
    shot('tab2', '2J', 'pointer', 'the pointer page: a message shows (amber) but ours cannot be drawn; BMW panel open, our fixed words', ['cc', 'cc_now'], 2,
         pg_pointer, warn='amber', window=True, sec='§5.1, §5.4 step 6')
    shot('tab2', '2K', 'empty', 'the empty page', ['cc'], 2, pg_empty, sec='§5.1')
    # the sequence
    f1, _ = shot('tab2', '2S1', 'rest', 'state none: rest on tab 1', ['clock'], 1, pg_clock, sec='§5.4')
    f2, _ = shot('tab2', '2S2', 'arrives', 'state window: the message arrives, BMW panel through the window, the bottom row gone, tab 2, our card painted', ['cc', 'cc_now'], 2,
                 card('amber2'), warn='amber', window=True, sec='§5.4 step 1')
    f3, _ = shot('tab2', '2S3', 'settled', 'state ours: >= 150 ms later, window closed, the bottom row back in one line, the rule amber', ['cc', 'cc_now'], 2, card('amber2'),
                 warn='amber', sev_rule='auto', sec='§5.4 step 2')
    f4, _ = shot('tab2', '2S4', 'left_tab2', 'state window: the driver selects tab 1 while the message shows; window open, the clock page, the warning icon amber',
                 ['cc', 'cc_now', 'clock'], 1, pg_clock, warn='amber', window=True, sec='§5.4 step 4', annotate=annotate_keepouts)
    f5, _ = shot('tab2', '2S5', 'back_on_tab2', 'state window: back on tab 2: our card is painted again, the window closes only after 150 ms (then as 2S3)',
                 ['cc', 'cc_now'], 2, card('amber2'), warn='amber', window=True, sec='§5.4 step 4')
    f6, _ = shot('tab2', '2S6', 'ended', 'state none: the message ends, tab 1 again', ['clock'], 1, pg_clock, sec='§5.4 step 5')
    labs = [('1  none', 'rest on tab 1; bottom row, two lines'), ('2  window', 'message arrives: BMW panel open, tab 2, card'),
            ('3  ours', '>= 150 ms: window closed, row back, rule amber'), ('4  window', 'driver selects tab 1: panel open, icon amber'),
            ('5  window', 'back on tab 2: card again; closes after 150 ms'), ('6  none', 'message ends: tab 1')]
    cv = frames_composite('2S  the message sequence (state of the machine on each frame: none / window / ours)',
                          [('%s\n%s' % l, f) for l, f in zip(labs, (f1, f2, f3, f4, f5, f6))], (606, 118, 1314, 720), 3, 0.46, label_h=46)
    save_composite('tab2', '2S', 'sequence', 'the six frames of the message sequence', ['cc', 'cc_now'], cv, '§5.4')
    shot('tab2', '2T', 'pointer_d7', 'D7 not yet confirmed (the first messages after an install): the pointer page, severity not known (grey cell, generic warning symbol), BMW panel open',
         ['cc', 'cc_now'], 2, lambda p: pg_pointer(p, 'unknown'), window=True, sec='§5.4 step 6', annotate=annotate_keepouts)


CENTRE_C = (729, 290, 1191, 600)


def tab3_pages():
    shot('tab3', '3A', 'certain_only', 'M3 certain only: the source pictogram, nothing else', ['media_icon'], 3, pg_media_min,
         cs=C(t3=dict(icon='td_media', text=None)), sec='§4.3')
    shot('tab3', '3B', 'radio_fm', 'radio, FM: station, radio text, footer (after probe)', ['media'], 3, pg_radio, sec='§4.3')
    shot('tab3', '3C', 'radio_dab', 'radio, DAB', ['media'], 3, lambda p: pg_radio(p, 'DAB'), sec='§4.3')
    shot('tab3', '3D', 'usb', 'now playing over USB: title, artist, progress, 4 / 12 (after probe)', ['media', 'progress'], 3, pg_track,
         cs=C(t3=dict(icon='td_media', text='Ранкова хвиля')), sec='§4.3')
    shot('tab3', '3E', 'carplay', 'now playing over CarPlay (the owner uses CarPlay)', ['media', 'media_src', 'progress'], 3,
         lambda p: pg_track(p, 'CarPlay'), cs=C(t3=dict(icon='td_projection', text='Ранкова хвиля')), sec='§4.3')
    shot('tab3', '3F', 'muted', 'muted: the mute mark in the tab and on the page (after probe)', ['media', 'mute'], 3, lambda p: pg_track(p, 'CarPlay', muted=True),
         cs=C(t3=dict(icon='td_projection', text='Ранкова хвиля', mark='td_mute')), sec='§4.3')
    shot('tab3', '3G', 'long', 'a very long title and artist: the "…" rule', ['media', 'progress'], 3,
         lambda p: pg_track(p, 'USB', 'Дуже довга назва композиції, яка не вміщується в рядок', 'Виконавець із дуже довгим псевдонімом та гуртом'),
         cs=C(t3=dict(icon='td_media', text='Дуже довга назва композиції, яка не вміщується в рядок')), sec='§4.3', close=CENTRE_C)


def tab4_pages():
    shot('tab4', '4A', 'idle_carplay', 'idle, connected over CarPlay with battery and signal, no missed-call count', ['phone'], 4, pg_phone_idle, sec='§4.4')
    shot('tab4', '4B', 'idle_bt', 'idle, Bluetooth', ['phone'], 4, lambda p: pg_phone_idle(p, 'bt'), sec='§4.4')
    shot('tab4', '4C', 'no_phone', 'no phone: the crossed-out icon in the tab, "Телефон не підключено"', ['phone'], 4, lambda p: pg_phone_idle(p, 'none'),
         cs=C(t4=dict(icon='td_phone_none')), sec='§3.3, §4.4', close=CENTRE_C)
    shot('tab4', '4D', 'no_data', 'no data: "Немає даних" (until the probe)', ['phone_icon'], 4, lambda p: pg_phone_idle(p, 'nodata'),
         cs=C(t4=dict(icon='td_phone')), sec='§4.4')
    inc = C(t4=dict(icon='td_phone'))
    shot('tab4', '4E', 'incoming_contact', 'incoming call, "Контакт" (the caller is in the contacts)', ['call', 'contact_kind'], 4, lambda p: pg_phone_call(p, 'incoming', 'contact'), cs=inc, sec='§4.4')
    shot('tab4', '4F', 'incoming_number', 'incoming call, "Номер" (an unknown caller)', ['call', 'contact_kind'], 4, lambda p: pg_phone_call(p, 'incoming', 'number'), cs=inc, sec='§4.4')
    shot('tab4', '4G', 'incoming_name', 'incoming call with the name setting on (an invented name)', ['call', 'caller_name'], 4, lambda p: pg_phone_call(p, 'incoming', 'name'), cs=inc, sec='§4.4')
    shot('tab4', '4H', 'active', 'active call with the timer', ['call', 'timer'], 4, lambda p: pg_phone_call(p, 'active', 'contact'), cs=inc, sec='§4.4')
    shot('tab4', '4I', 'active_muted', 'active call, microphone muted', ['call', 'timer', 'mic'], 4, lambda p: pg_phone_call(p, 'active', 'contact', muted=True), cs=inc, sec='§4.4', close=CENTRE_C)
    shot('tab4', '4J', 'call_during_message', 'a call while a message shows: tab 2 wins, the call only as tab 4 lit', ['call', 'cc', 'cc_now'], 2, lambda p: pg_card(p, 'amber2'),
         cs=C(t4=dict(icon='td_phone', ink=LIT_GREEN)), warn='amber', sev_rule='auto', close=BARBOX, sec='§3.4 rule 1-2')


def tab5_pages():
    shot('tab5', '5A', 'map_w1', 'the map window W1: the drawn stand-in, fading at the box edges; the road bar at the foot', ['map', 'road'], 5, pg_map, sec='§4.5')
    shot('tab5', '5B', 'map_noroad', 'the same without a road', ['map'], 5, lambda p: pg_map(p, False), sec='§4.5')
    shot('tab5', '5C', 'guided_right', 'guidance page: a right turn in 350 м, next road, lanes, arrival', ['guiding', 'dart'], 5, pg_guided, sec='§4.5')
    shot('tab5', '5D', 'roundabout', 'a roundabout, exit 3', ['guiding', 'dart'], 5,
         lambda p: pg_guided(p, 'td_roundabout_3', 150, lanes=False, footer='прибуття 09:32 · 13.9 км', icon_text='3'), sec='§4.5, §7')
    shot('tab5', '5E', 'fork', 'a fork, keep right', ['guiding', 'dart'], 5, lambda p: pg_guided(p, 'td_fork_right', 800, road='вулиця Друга'), sec='§4.5, §7')
    shot('tab5', '5F', 'destination_left', 'the destination on the left', ['guiding', 'dart'], 5,
         lambda p: pg_guided(p, 'td_flag_left', 50, road='пункт призначення', lanes=False, footer='прибуття 09:32 · 0.1 км'), sec='§4.5, §7')
    # 5G distances
    frames = []
    for d in (30, 350, 1200, 14000):
        im, _ = shot('tab5', '5G', 'x', '', [], 5, lambda p, d=d: pg_guided(p, 'td_turn_right', d, lanes=False), save=False)
        frames.append(('%s %s' % fmt_dist(d), im))
    cv = frames_composite('5G  the distance format: < 100 м to 10 м, < 1 км to 50 м, then one decimal to 10 км, whole kilometres above', frames,
                          (729, 300, 1191, 580), 4, 0.99, label_h=40)
    save_composite('tab5', '5G', 'distances', 'distances 30 м / 350 м / 1.2 км / 14 км', ['guiding', 'dart'], cv, '§4.5')
    img5, _ = shot('tab5', '5K', 'map_box_annotated', "BMW's map box over 5A: the 10 % edge, the 90 % area, our window W1's zero box", ['map'], 5, pg_map, sec='§4.5')
    annotate_map(img5).save(os.path.join(OUT, 'tab5', '5K_map_box_annotated_annotated.png'))
    shot('tab5', '5H', 'calculating', 'calculating the route', ['guiding'], 5, lambda p: pg_nav_state(p, 'calc'), sec='§4.5')
    shot('tab5', '5I', 'no_route_road', 'no route, the road is known', ['guiding', 'road'], 5, lambda p: pg_nav_state(p, 'road_only'), sec='§4.5')
    shot('tab5', '5J', 'nothing', 'nothing: no route, no road', ['guiding'], 5, lambda p: pg_nav_state(p, 'idle'), sec='§4.5')


# ---- contact sheets, index ------------------------------------------------------------------------------------------------------------
K2_EQUIVALENT = {   # K2's picture (r3/..., docs/twin-dial/r3/K2-REPORT.md) -> this set's id; None: not redrawn in 3b
    'T01': 'tabs/T1_sel1', 'T02': 'tabs/T2_sel2', 'T03': 'tabs/T3_sel3', 'T04': 'tabs/T4_sel4', 'T05': 'tabs/T5_sel5',
    'T07': 'tabs/T7_today_seps (K2 drew today\'s 744 / 812; 3b measures the range values instead)', 'T08': 'tabs/T8_no_msg_white, T10_msg_amber_icon, T11_msg_red_icon',
    'T09': 'tabs/T18_muted, tabs/T3_sel3', 'T10': 'tabs/T16_phone_none, T19_in_call', 'T11': 'tabs/T17_nav_arrow',
    '1A': 'tab1/1A_clock', '1B': 'tab1/1C_trip_short', '1C': None, '1D': 'tab4/V1_tech', '1H': 'tab4/V1b_tyres',
    '2A': 'tab2/2A_white_1', '2B': 'tab2/2D_amber_2_counter (without the counter)', '2C': 'tab2/2E_red_3', '2D': 'tab2/2F_red_cut', '2F': 'tab2/2D_amber_2_counter',
    '2I': 'tab2/2H_list', '2J': 'tab2/2L_pointer', '2K': 'tab2/2I_empty', '2S2': 'tab2/2J_opening', '2S3': 'tab2/2K_covered', '2S4': 'tab2/2M_left',
    '3A': 'tab3/3D_certain', '3B': 'tab3/3A_radio', '3D': 'tab3/3B_track', '4A': 'tab4/4A_idle', '4E': 'tab4/4C_incoming_a', '4G': 'tab4/4D_incoming_b',
    '4H': 'tab4/4F_active', '4I': 'tab4/4F_active', '5A': 'tab5/5A_map_W1', '5B': 'tab5/5C_map_W1_noroad', '5C': 'tab5/5D_guided', '5H': 'tab5/5F_calculating',
    '5I': 'tab5/5E_road_only', '5J': 'tab5/5G_idle'}


def pictos_sheet():
    """P01: the pictograms KB adds (pictos_r3.py PICTOS_R3B + the roundabout by exit), 120 px and 36 px, white on black, for review."""
    names = ['td_projection', 'td_fork_right', 'td_fork_left', 'td_flag_left'] + ['td_roundabout_%d' % k for k in range(1, 7)]
    cv = new_canvas()
    label(cv, (40, 12), 'P01  new pictograms of round 3b (ours; KB): large 240 px, small 36 px', 24, bold=True)
    for i, nm in enumerate(names):
        x, y = 60 + (i % 5) * 370, 70 + (i // 5) * 320
        for sz, dy in ((240, 0), (36, 250)):
            tile = Image.new('RGBA', (sz, sz), (255, 255, 255, 0))
            tile.putalpha(Image.fromarray((icon_alpha(nm, sz) * 255).astype(np.uint8)))
            cv.paste(tile, (x + (0 if sz == 240 else 100), y + dy), tile)
        label(cv, (x, y + 296), nm, 17, GREY2)
    path = os.path.join(OUT, 'tabs', 'P01_new_pictograms.png')
    cv.save(path)
    SHOTS.append(dict(id='P01', folder='tabs', file=os.path.relpath(path, OUT), name='new_pictograms', caption='the pictograms KB adds', variant=None, spec='§7',
                      status={'setting': 'certain'}, source={}, look=LOOK_NAME, composite=True, keepout_nonblack_px=None))


SHEETS = {
    'tabs': ((560, 100, 1360, 720), 0.45, 3, 'KB: the tab bar (SPEC-R3 §3): T01-T11'),
    'tab1': ((560, 100, 1360, 720), 0.45, 4, 'KB: tab 1, the on-board computer (§4.1)'),
    'tab2': ((560, 100, 1360, 720), 0.45, 4, 'KB: tab 2, messages in the centre (§5)'),
    'tab3': ((560, 100, 1360, 720), 0.45, 4, 'KB: tab 3, media (§4.3)'),
    'tab4': ((560, 100, 1360, 720), 0.45, 4, 'KB: tab 4, phone (§4.4)'),
    'tab5': ((560, 100, 1360, 720), 0.45, 4, 'KB: tab 5, navigation (§4.5)'),
}


def sheet(items, crop, scale, cols, title, path):
    cw, ch = int((crop[2] - crop[0]) * scale), int((crop[3] - crop[1]) * scale)
    pad, cap = 14, 54
    rows = (len(items) + cols - 1) // cols
    S = Image.new('RGB', (cols * (cw + pad) + pad, 56 + rows * (ch + cap + pad)), (24, 24, 26))
    d = ImageDraw.Draw(S)
    d.text((pad, 16), title, font=lf(24, True), fill=WHITE)
    for i, it in enumerate(items):
        im = Image.open(os.path.join(OUT, it['file']))
        if it.get('composite'):
            im = im.resize((int(cw * 1.0), int(cw * 1.0 * im.height / im.width)), Image.LANCZOS)
            im = im.crop((0, 0, cw, min(ch, im.height)))
        else:
            im = im.crop(crop).resize((cw, ch), Image.LANCZOS)
        x, y = pad + (i % cols) * (cw + pad), 56 + (i // cols) * (ch + cap + pad)
        S.paste(im, (x, y))
        cap1 = '%s  %s' % (it['id'], it['caption'])
        while d.textlength(cap1, font=lf(15)) > cw and len(cap1) > 4:
            cap1 = cap1[:-2] + '…'
        d.text((x, y + ch + 4), cap1, font=lf(15), fill=(230, 230, 230))
        xx = x
        for k, v in it['status'].items():
            t = '%s: %s' % (k, v)
            if xx + 24 + d.textlength(t, font=lf(14)) > x + cw:
                d.text((xx, y + ch + 26), '…', font=lf(14), fill=(200, 200, 200))
                break
            d.ellipse([xx, y + ch + 30, xx + 10, y + ch + 40], fill=STATUS_COL.get(v, (200, 200, 200)))
            d.text((xx + 14, y + ch + 26), t, font=lf(14), fill=(200, 200, 200))
            xx += 24 + d.textlength(t, font=lf(14))
    S.save(path)
    print('wrote', path)


def main():
    os.makedirs(OUT, exist_ok=True)
    for sub in SHEETS:
        shutil.rmtree(os.path.join(OUT, sub), ignore_errors=True)
    load_models()
    print('dials:', DIALS_PATH, 'look:', LOOK_NAME)
    build()
    pictos_sheet()
    for sh in SHOTS:
        if sh['id'] in K2_EQUIVALENT:
            sh['k2_equivalent'] = K2_EQUIVALENT[sh['id']]
    for name, (crop, scale, cols, title) in SHEETS.items():
        its = [s for s in SHOTS if s['folder'] == name]
        its.sort(key=lambda s: s['id'])
        sheet(its, crop, scale, cols, title, os.path.join(OUT, name + '_sheet.png'))
    json.dump(dict(generator='tools/twin-dial/mockup/pages.py', dials=DIALS_PATH, look=LOOK_NAME, models=['%s/%s' % k for k in sorted(MODELS)],
                   status_words=STATUS, pictures=SHOTS), open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)
    print('index.json:', len(SHOTS), 'pictures')


if __name__ == '__main__':
    main()
