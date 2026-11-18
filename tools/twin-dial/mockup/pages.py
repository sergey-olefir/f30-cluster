#!/usr/bin/env python3
"""Twin Dial round 3, package K2: mockups of the live tab bar and the pages behind each tab (docs/AGENT-BRIEF-twin-r3.md §4 K2).

    K2_DIALS=<K1's mockup.py> K2_LOOK=r3_fixed \\
    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/pages.py

Writes bake/work/twin-dial/mockup/r3/ (git-ignored): one 1920 x 720 picture per state (tabs/, tab1/ .. tab5/, limit/),
a contact sheet per folder, the overview pages_sheet.png (and pages_sheet_lookC.png with K1's look_C_both), annotated
keep-out copies (*_keepouts.png) and index.json (every picture with its data status).

The dials are drawn by mockup.py (package K1 owns that drawing): K2_DIALS points at the mockup.py to use (K1's
worktree), K2_LOOK names one of its looks (design/twin-dial/r3/k1/looks.json); without them, this folder's mockup.py
and 0.1.0's dials. The pictograms are the repository's own (shared/twin_icons.js) plus K2's new ones in pictos_r3.py.

Round 3 v2 (all packages published, 2026-11-18): SF tabs.json / pages.json (the bar and the page grammar), SC card.json
(tab 2), SM / SP / SV / SN model.json (tabs 3, 4, 5 and the speed limit). Every number used below names its source;
every text is invented and neutral; the map is a drawn stand-in that is no real place.
"""
import importlib.util
import json
import math
import os
import re
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
from pictos_r3 import PICTOS  # noqa: E402

OWN_FONTS = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'refs', 'vt-fonts')


def _load_mockup():
    path = os.environ.get('K2_DIALS') or os.path.join(HERE, 'mockup.py')
    spec = importlib.util.spec_from_file_location('twin_mockup', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not os.path.isdir(mod.FONTS):                 # a worktree without the bake/work link: use ours
        mod.FONTS = OWN_FONTS
    return mod, path


M, DIALS_PATH = _load_mockup()
W, H, SS = M.W, M.H, M.SS
CT, CS, R = M.CT, M.CS, M.R
OUT = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'mockup', 'r3')
PUB = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'r3', 'pub')
LOOK_NAME = os.environ.get('K2_LOOK', 'r3_fixed') if hasattr(M, 'look_named') else None

WHITE, GREEN = (255, 255, 255), (60, 155, 34)
GREY2, GREY_DIM, GREY_MID = (227, 227, 227), (150, 150, 150), (170, 170, 170)


def lin(c):
    c = np.asarray(c, float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def enc(L):
    return tuple(int(round(v)) for v in M.srgb(np.asarray(L, float)))


# ---- the frame (SPEC §6; SF tabs.json / pages.json v2 proposals) -----------------------------------------------------
BAR = (618, 127, 1302, 170)                      # cells end at the rule's top (SF: rule y 170-173)
SEPS_SF = [780, 848, 1168, 1237]                 # SF ours_today_wrong: tab 1 must fit icon + 3 digits + unit
SEPS_TODAY = [744, 812, 1168, 1237]
TAB_RULE = (170, 173, 230)                       # SF bar_measured.rule_under_bar.proposal_P: 3 px, code 230
ICON_BOX, ICON_Y = 46, 147                       # SF: icons 36 px tall (ours 29): our 38-box drawings' ink is ~0.79 of the box
TAB_FONT, TAB_UNIT = 34, 21                      # SF: tab text cap 24 px (Noto 33-34)
TEXT_BASE = 156                                  # SF text baseline v -0.8163 -> 155.1
# SF proposal_for_us.fill_colour_sRGB_before_black_floor (1, 2 red as the maker; 3, 4, 5 hypotheses)
TAB_COLOUR = {1: (176, 10, 37), 2: (176, 10, 37), 3: (240, 150, 10), 4: (60, 155, 34), 5: (30, 150, 200)}
FN_COLOUR = {'red': (176, 10, 37), 'amber': (240, 150, 10), 'green': (60, 155, 34), 'blue': (30, 150, 200)}

TITLE_Y = 270                                    # SF pages.json title: baseline 281 (ours matches)
TRULE = (739, 1181, 295, 297.5, 205)             # SF title_rule.proposal_P
META = (1190, 326)                               # SF meta_line: right edge x 1190, baseline 326, cap 22.5
BODY = (741, 300, 1180, 564)
BROW = (629, 1291, 612.4, 614.6, 231)            # bottom rule (SPEC 6.3; SF: matches the references)
BASE1, BASE2 = 655, 702                          # bottom row baselines (SF bottom_row: 06 655.4 / 702.6)
KOMBI_BOX_G20 = (1420, 320, 1611, 440)           # lead's correction: the G20's black box (the brief's was the X3's)

# SC card.json severity colours
SEV = {'red': dict(cell=(176, 7, 30), sym=WHITE, rule=(176, 7, 30), icon=(218, 16, 48)),
       'amber': dict(cell=(240, 170, 10), sym=(0, 0, 0), rule=(240, 170, 10), icon=(240, 170, 10)),
       'green': dict(cell=(59, 155, 26), sym=WHITE, rule=(59, 155, 26), icon=WHITE),
       'grey': dict(cell=None, sym=WHITE, rule=(231, 231, 231), icon=WHITE)}
ROW_SEV_INK = {'red': (218, 16, 48), 'amber': (240, 170, 10), 'green': (59, 155, 26), 'grey': WHITE}

# ---- data status (models of SM, SP, SV, SN, SC; brief §3) ------------------------------------------------------------
STATUS = {
    'clock': ('arrives', 'timeDateUTC + zone'),
    'range': ('arrives', 'statusRangeTankStatus'),
    'odo_trip': ('unseen', 'odometer member (P3), trip distance (P4)'),
    'outside': ('arrives', 'ambient temperature'),
    'trip': ('unseen', 'KombiIF.statusBordcomputerAverage / TravelData (P4)'),
    'cc': ('arrives', 'KombiInterface_2.ccList (names, colours, symbol ids)'),
    'cc_now': ('unseen', 'statusActiveCCMessage: which entry shows now (P1); until then D7 -> pointer + BMW panel'),
    'cc_counter': ('unseen', 'statusMenuCCMessage frame n of m (P1)'),
    'media': ('unseen', 'HmiMediaState.playerMetadata (P8)'),
    'media_src': ('unseen', 'HmiMediaState.menu iconKind / MediaSource.playerType, enum only (P8)'),
    'media_icon': ('certain', 'our own pictogram, no signal'),
    'progress': ('unseen', 'trackProgress elapsed / total; n of m and play state CarPlay only (P8)'),
    'media_list': ('doubtful', 'dataStationList / HmiMediaState.tracks: sent when the head unit asks'),
    'mute': ('unseen', 'CommandControl sinkMuteStateChanged (not in this probe)'),
    'phone': ('unseen', 'DevicePresentation.deviceList: connected, roles, battery, signal (P9)'),
    'phone_icon': ('certain', 'our own pictogram, no signal'),
    'call': ('unseen', 'ConnectivityAggregator.aggregatedCallState (P9)'),
    'contact_kind': ('unseen', 'contactID != 0 -> Контакт, else Номер; no text read'),
    'caller_name': ('owner', 'private text, drawn only if the owner turns it on'),
    'timer': ('certain', 'our own timer from the ACTIVE edge'),
    'mic': ('unseen', 'VoiceCallManager.micMuted'),
    'oil': ('arrives', 'oil temperature (scale: strong hypothesis)'),
    'coolant': ('arrives', 'CDS.statusEngineTemperature (scale verified)'),
    'boost': ('arrives-other-app', 'boost (scale 0.01 bar hypothesis)'),
    'tyres': ('arrives-other-app', 'TPMS pressures / temperatures through the getters (car_vitals)'),
    'doors': ('unseen', 'door / lid contacts (P7); fallback ccList id 15 = driver door'),
    'limit': ('arrives-brief', 'speed-limit struct (f30_cluster signOf)'),
    'assist': ('unseen', 'set speed, gap bars, next limit (P13)'),
    'cons_now': ('unseen', 'instantaneous consumption (P15 / P4)'),
    'cons_hist': ('derived', 'our own history from the trip averages (P4)'),
    'guiding': ('arrives', 'NavigationStatus.guidingState'),
    'road': ('arrives', 'Guidance.currentRoad (brief; not re-verified); placeholder text only'),
    'dart': ('unseen', 'Guidance.conclusiveDart, nextIntersection, currentLaneGuiding, nextDestinationInfo (P12)'),
    'map': ('hypothesis', "BMW's map: mapped under the panel (slot table, verified); visible through our window: to photograph (SN X1)"),
}
STATUS_COL = {'arrives': (60, 175, 60), 'certain': (60, 175, 60), 'arrives-other-app': (140, 200, 60),
              'arrives-brief': (140, 200, 60), 'derived': (120, 160, 230), 'hypothesis': (120, 160, 230),
              'unseen': (240, 170, 10), 'doubtful': (225, 110, 40), 'owner': (190, 120, 230), 'not sent': (225, 40, 50)}
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


def sc_card():
    return MODELS.get(('SC', 'card.json'), {})


# ---- pictograms as distance fields ------------------------------------------------------------------------------------
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


def paste_sdf(img, name, size, cx, cy, color=WHITE, alpha=1.0):
    a = icon_alpha(name, size) * alpha
    tile = Image.new('RGBA', (size, size), tuple(color) + (0,))
    tile.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    img.paste(tile, (int(round(cx - size / 2)), int(round(cy - size / 2))), tile)


# ---- canvas -----------------------------------------------------------------------------------------------------------
_BASE = {}


def nb(size):
    return M.font(('notosans', 'NotoSans[wdth,wght].ttf'), size, 700, 100)


def saira_bold(size):
    return M.font(('saira', 'Saira[wdth,wght].ttf'), size, 700, 100)


def lf(size, bold=False):
    return M.font(('notosans', 'NotoSans[wdth,wght].ttf'), size / SS, 700 if bold else 500, 100)


class Page:
    """mockup.Canvas with the dials drawn (cached per speed / rpm / look) plus our own icon queue."""

    def __init__(self, speed=87.0, rpm=2.4, gear='D3'):
        key = (speed, rpm, gear, LOOK_NAME)
        if key not in _BASE:
            cv = M.Canvas()
            look = M.look_named(LOOK_NAME) if LOOK_NAME else None
            if hasattr(M, 'draw_dials'):
                M.draw_dials(cv, look, speed, rpm, gear)
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

    def icon(self, name, size, cx, cy, color=WHITE, alpha=1.0):
        self.sdf.append((name, int(size), cx, cy, color, alpha))

    def rect(self, x0, y0, x1, y1, fill):
        self.cv.rect(x0, y0, x1, y1, fill)

    def rrect(self, x0, y0, x1, y1, r, fill=None, outline=None, width=1):
        self.cv.d.rounded_rectangle([x0 * SS, y0 * SS, x1 * SS - 1, y1 * SS - 1], radius=r * SS, fill=fill,
                                    outline=outline, width=int(round(width * SS)))

    def disc(self, cx, cy, r, fill):
        self.cv.d.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], fill=fill)

    def text(self, x, base, s, f, fill=WHITE, align='l'):
        self.cv.btext(x, base, s, f, fill, align)

    def ctext(self, xy, s, f, fill=WHITE):
        self.cv.ctext(xy, s, f, fill)

    def width(self, s, f):
        return self.cv.width(s, f)

    def paste_rgb(self, x0, y0, arr):
        self.cv.img.paste(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)), (int(round(x0 * SS)), int(round(y0 * SS))))

    def title(self, s):
        self.ctext((960, TITLE_Y), s, M.noto(41))
        x0, x1, y0, y1, code = TRULE
        self.rect(x0, y0, x1, y1, (code, code, code))

    def meta(self, s):                               # SF meta_line: small, right-aligned under the title rule
        self.text(META[0], META[1], s, M.noto(30), GREY2, 'r')

    def finish(self, badge=None):
        out = self.cv.img.resize((W, H), Image.LANCZOS)
        M.paste_icons(out, self.cv.icons)
        for name, size, cx, cy, color, alpha in self.sdf:
            paste_sdf(out, name, size, cx, cy, color, alpha)
        if badge:
            d = ImageDraw.Draw(out)
            for i, line in enumerate(badge):            # top right (the hood hides it; the keep-out legend is top left)
                d.text((1906, 10 + i * 24), line, font=lf(19), fill=(200, 200, 200), anchor='ra')
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


# ---- the tab bar (SF tabs.json v2) ------------------------------------------------------------------------------------
def cells(seps=None, tab2=True):
    s = seps or SEPS_SF
    c = [dict(id=1, x0=618, x1=s[0], icon='td_fuel', text='412', unit='км'),
         dict(id=2, x0=s[0], x1=s[1], icon='cc_warn'),
         dict(id=3, x0=s[1], x1=s[2], icon='td_radio', text='Радіо Приклад'),
         dict(id=4, x0=s[2], x1=s[3], icon='td_phone_bars'),
         dict(id=5, x0=s[3], x1=1302, icon='td_nav')]
    if not tab2:                                     # the maker's rule: no message, no tab 2 (needs movable separators)
        c = [x for x in c if x['id'] != 2]
        c[1]['x0'] = s[0]
    return c


def tab_bar(p, cs, sel=None, sel_colour=None, warn=None, s2=False):
    """sel: the selected tab id, filled by SF's law in the tab's own colour (or sel_colour). warn: the severity of the
    message the car shows ('red', 'amber', 'grey', 'green') or None; with tab 2 not selected its triangle takes the
    severity colour (SC W2); s2=True is SC's variant S2 (tab 2's fill in the severity colour)."""
    x0, y0, x1, y1 = BAR
    h, w = int(round((y1 - y0) * SS)), int(round((x1 - x0) * SS))
    ramp = np.linspace(0.002, 0.16, h)                 # SPEC 6.1 neutral ramp, linear light
    p.paste_rgb(x0, y0, np.stack([M.srgb(ramp)] * 3, -1)[:, None, :] * np.ones((1, w, 1)))
    ry0, ry1, rc = TAB_RULE
    p.rect(x0, ry0, x1, ry1, (rc, rc, rc))
    for c in cs:
        if c['id'] != sel:
            continue
        col = sel_colour or c.get('fill') or TAB_COLOUR[c['id']]
        if c['id'] == 2 and s2 and warn in ('red', 'amber'):
            col = SEV[warn]['cell']
        L = lin(col)[None, :] * (ramp / 0.16)[:, None]  # SF fill_law: colour_linear x t(y), t = ramp / 0.16
        cw = int(round((c['x1'] - c['x0']) * SS))
        p.paste_rgb(c['x0'], y0, np.stack([M.srgb(L[:, k]) for k in range(3)], -1)[:, None, :] * np.ones((1, cw, 1)))
        rule = np.clip(lin(col) + 0.15 * lin((rc, rc, rc)), 0, 1)   # SF rule_in_selected_cell
        p.rect(c['x0'], ry0, c['x1'], ry1, enc(rule))
    for c in cs[1:]:                                   # SF separators: a dark column, a lighter line ~3 px to its right
        p.rect(c['x0'] - 1, y0, c['x0'] + 1, y1, (0, 0, 0))
        p.rect(c['x0'] + 2, y0, c['x0'] + 3, y1, (84, 84, 84))
    for c in cs:
        ink = c.get('ink', WHITE)
        if c['id'] == 2 and warn and sel != 2:
            ink = SEV[warn]['icon']
        if c['id'] == sel:
            ink = (0, 0, 0) if (c['id'] == 2 and s2 and warn == 'amber') else WHITE
        text = c.get('text')
        if c['id'] == 1:                               # SF: icon ink 18 px from the cell's left, value 7 px after, unit 7 px after
            ix = c['x0'] + 18 - 0.06 * ICON_BOX + ICON_BOX / 2
            p.icon(c['icon'], ICON_BOX, ix, ICON_Y, ink)
            tx = c['x0'] + 18 + 0.82 * ICON_BOX + 7
            p.text(tx, TEXT_BASE, text, M.noto(TAB_FONT), WHITE)
            p.text(tx + p.width(text, M.noto(TAB_FONT)) + 7, TEXT_BASE, c['unit'], M.noto(TAB_UNIT), WHITE)
        elif text:                                     # SF: icon + text centred as one group, ellipsis inside the cell
            f = M.noto(TAB_FONT)
            room = c['x1'] - c['x0'] - 16 - ICON_BOX - 6 - (40 if c.get('mark') else 0)
            text = fit(p, text, f, room)
            tw = ICON_BOX + 6 + p.width(text, f)
            gx = (c['x0'] + c['x1'] - (40 if c.get('mark') else 0)) / 2 - tw / 2
            p.icon(c['icon'], ICON_BOX, gx + ICON_BOX / 2, ICON_Y, ink)
            p.text(gx + ICON_BOX + 6, TEXT_BASE, text, f, WHITE)
        else:
            p.icon(c['icon'], ICON_BOX, (c['x0'] + c['x1']) / 2 + 1, ICON_Y, ink)
        if c.get('mark'):
            p.icon(c['mark'], 30, c['x1'] - 24, ICON_Y, WHITE)


# ---- bottom row and BMW's panel ---------------------------------------------------------------------------------------
def bottom_row(p, lines, rule=None):
    """lines 2: odometer + trip / clock + temperature (only with tab 1, SF); 1: clock + temperature on line 1's
    baseline. rule: the severity colour of the bottom rule while our card covers BMW's panel (SC: y 611-615)."""
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


def bmw_panel(p):
    """BMW's message panel as the bench draws it (tools/shots/twin/backdrop.py): the fallback polygon, grey, labelled;
    the bottom row has stepped aside, the rule stays outside the window."""
    poly = json.load(open(os.path.join(ROOT, 'design', 'twin-dial', 'vf', 'message_panel.json')))['fallback_window']['polygon_px']
    p.cv.d.polygon([(x * SS, y * SS) for x, y in poly], fill=(70, 78, 90))
    p.ctext((946, 652), 'BMW MESSAGE PANEL', nb(28), (240, 240, 240))
    p.rect(629, BROW[2], 694, BROW[3], (BROW[4],) * 3)
    p.rect(1230, BROW[2], 1291, BROW[3], (BROW[4],) * 3)


# ---- speed limit (SV model.json speed_limit) --------------------------------------------------------------------------
SIGN_RED = (214, 13, 18)                         # f30_cluster WBSIGN RED
LIM_A = (1300, 672, 33)
LIM_C = (1540, 526, 34)
LIM_D = (858, 432, 80)
MARK_RED = (181, 26, 17)


def sign(p, cx, cy, r, value, state='limit'):
    """SV: red ring 0.23 r wide, white disc, black figure (Saira bold; three digits shrink). Unknown: three dashes.
    End: white disc, five diagonal grey stripes. Conditional: a dot under the sign (a, c)."""
    if state == 'end':
        p.disc(cx, cy, r, (120, 120, 120))
        p.disc(cx, cy, r - 1.5, (245, 245, 245))
        t = math.radians(45)
        for k in range(-2, 3):
            ox, oy = k * r * 0.17 * math.cos(t), -k * r * 0.17 * math.sin(t)
            p.cv.d.line([((cx + ox - r * 0.7 * math.sin(t)) * SS, (cy + oy - r * 0.7 * math.cos(t)) * SS),
                         ((cx + ox + r * 0.7 * math.sin(t)) * SS, (cy + oy + r * 0.7 * math.cos(t)) * SS)],
                        fill=(110, 110, 110), width=int(max(1, r * 0.07) * SS))
        return
    p.disc(cx, cy, r, SIGN_RED)
    p.disc(cx, cy, r * 0.77, (250, 250, 250))
    if state == 'unknown':
        for k in (-1, 0, 1):
            p.rect(cx + k * r * 0.32 - r * 0.11, cy - r * 0.055, cx + k * r * 0.32 + r * 0.11, cy + r * 0.055, (0, 0, 0))
        return
    s = str(value)
    size = int(round(r * (0.95 if len(s) < 3 else 0.74)))
    p.ctext((cx, cy), s, saira_bold(size), (0, 0, 0))
    if state == 'conditional':
        p.disc(cx, cy + r + 9, 4.5, (250, 250, 250))


def limit_marker(p, value, over=None, hollow=False):
    """SV (b): a marker across the tick strip (radial 0.893-0.94 R, 2 deg wide) at the limit; over: the needle's value
    while the car says over the limit, the strip from the limit to the needle turns red."""
    a = M.spd_angle(value)
    if over:
        p.cv.sector(CS, 0.893 * R, 0.94 * R, a, M.spd_angle(over), MARK_RED)
        for v in range(int(value), int(over) + 1):
            step = 5 if v <= 100 else 10
            if v % step == 0:
                big = v in (0, 20, 40, 60, 80, 100, 140, 180, 220, 260, 300)
                p.cv.radial(CS, M.spd_angle(v), 0.896 * R, 0.934 * R, (0.018 if big else 0.012) * R, WHITE)
    if hollow:
        p.cv.sector(CS, 0.893 * R, 0.94 * R, a - 1.0, a + 1.0, MARK_RED)
        p.cv.sector(CS, 0.893 * R + 2, 0.94 * R - 2, a - 0.55, a + 0.55, (40, 40, 40))
    else:
        p.cv.sector(CS, 0.893 * R, 0.94 * R, a - 1.0, a + 1.0, MARK_RED)


# ---- tab 1: the on-board computer (SF pages.json value_page / table_page) ---------------------------------------------
def pg_clock(p, grammar='today'):
    p.title('Дата і час')
    if grammar == 'today':                            # the owner's mockup 1 (big Saira clock)
        p.ctext((960, 372), '14:43', M.saira(92))
        p.ctext((960, 450), 'вівторок', M.noto(39))
        p.ctext((960, 505), '17.11.2026', M.noto(39))
    else:                                             # SF value_page (06): time cap 44 at 392, weekday 448, date 498, leading symbol
        f = M.noto(61)
        tw = p.width('14:43', f)
        p.text(960 - tw / 2 + 20, 392, '14:43', f, WHITE)
        p.icon('td_clock', 34, 960 - tw / 2 + 20 - 20 - 17, 392 - 22, GREY2)
        p.text(960, 448, 'вівторок', M.noto(39), WHITE, 'c')
        p.text(960, 498, '17.11.2026', M.noto(39), WHITE, 'c')


def stacked_unit(p, x, base, top, bottom):
    """SF table_page: a consumption unit as a stacked fraction (two small lines, total 0.10 R high)."""
    f = M.noto(15)
    w = max(p.width(top, f), p.width(bottom, f))
    p.text(x + w / 2, base - 16, top, f, WHITE, 'c')
    p.rect(x, base - 13, x + w, base - 12, WHITE)
    p.text(x + w / 2, base + 1, bottom, f, WHITE, 'c')


def pg_trip(p, which=1):
    """SF table_page (02): meta line (duration), rows at 384 / 455, icons 36 at x 729, number columns right at 896 / 1109,
    units 10 px after, footer hint at 565."""
    if which == 1:
        p.title('Поточна поїздка')
        p.meta('0:43 год')
        rows = [('td_fuel', ('ø 6.8', 'cons'), ('ø 41', 'км/год')), ('td_road', ('12.4', 'км'), None)]
        foot = 'від початку поїздки, 14:00'
    else:
        p.title('Тривалий період')
        p.meta('24:37 год')
        rows = [('td_fuel', ('ø 7.4', 'cons'), ('ø 52', 'км/год')), ('td_road', ('1 284', 'км'), None)]
        foot = 'з 02.11.2026'
    f = M.noto(42)
    for (ic, left, right), base in zip(rows, (384, 455)):
        p.icon(ic, 46, 729 + 23, base - 15)
        for col, (x, right_edge) in zip((left, right), ((None, 896), (None, 1109))):
            if not col:
                continue
            num, unit = col
            p.text(right_edge, base, num, f, WHITE, 'r')
            if unit == 'cons':
                stacked_unit(p, right_edge + 10, base, 'л', '100 км')
            else:
                p.text(right_edge + 10, base, unit, M.noto(21), WHITE)
    p.text(960, 565, foot, M.noto(32), GREY2, 'c')


# ---- tab 2: messages (SC card.json) -----------------------------------------------------------------------------------
SAMPLES = {   # SC card.json samples_for_mockups (invented) + symbols by VT's community id table
    'white1': ('grey', 'cc_door', 'Двері відчинено'),
    'white2': ('grey', 'cc_belt', 'Готовність до руху: пристебніться'),
    'amber1': ('amber', 'cc_battery', 'Акумулятор розряджається'),
    'amber2': ('amber', 'cc_tyre', 'Тиск у шинах: перевірте'),
    'red3': ('red', 'cc_brake', 'Несправність гальм: зупиніться в безпечному місці'),
    'redcut': ('red', 'cc_brake', 'Несправність гальмівної системи: обережно зупиніться та зверніться до сервісу'),
}
ROWS = [('grey', 'cc_washer', 'Мало рідини омивача'), ('grey', 'cc_service', 'Потрібне сервісне обслуговування'),
        ('amber', 'cc_battery', 'Акумулятор розряджається'), ('grey', 'cc_door', 'Багажник відчинено'),
        ('grey', 'cc_bonnet', 'Капот відчинено'), ('amber', 'cc_oil', 'Рівень оливи: перевірте'),
        ('grey', 'cc_info', 'Технічне повідомлення')]


def sev_cell(p, box, sev):
    x0, y0, x1, y1 = box
    if SEV[sev]['cell'] is None:                      # grey: the tab ramp, top to bottom (as round 2's plate)
        hh, ww = int((y1 - y0) * SS), int((x1 - x0) * SS)
        p.paste_rgb(x0, y0, np.stack([M.srgb(np.linspace(0.002, 0.16, hh))] * 3, -1)[:, None, :] * np.ones((1, ww, 1)))
    else:
        p.rect(x0, y0, x1, y1, SEV[sev]['cell'])


def scroll(p, frac0, frac1):                          # SC / SF: x 1188, w 3, y 300-564, track 40, thumb 180
    p.rect(1188, 300, 1191, 564, (40, 40, 40))
    p.rect(1188, 300 + 264 * frac0, 1191, 300 + 264 * frac1, (180, 180, 180))


def list_rows(p, rows, top, n):
    for k, (sev, sym, name) in enumerate(rows[:n]):
        y = top + 44 * k
        p.icon(sym, 32, 757, y + 22, ROW_SEV_INK[sev])
        p.text(781, y + 33, fit(p, name, M.noto(33), 399), M.noto(33), WHITE)


def pg_card(p, key, counter=None, layout='centre', rows=ROWS):
    """SC: the card for the message the car shows now: severity cell [922, 306, 998, 382] with the symbol 54 at
    (960, 344), headline Noto 42 centred, up to 3 lines at 424 / 471 / 518 (cut with '…'), counter top right (needs P1),
    then rows of the other listed entries (2 / 1 / 0), the scroll indicator when more."""
    sev, sym, text = SAMPLES[key]
    p.title('Повідомлення')
    f = M.noto(42)
    if layout == 'centre':
        sev_cell(p, (922, 306, 998, 382), sev)
        p.icon(sym, 54, 960, 344, SEV[sev]['sym'])
        lines, _ = wrap(p, text, f, 436, 3)
        for b, s in zip((424, 471, 518), lines):
            p.text(960, b, s, f, WHITE, 'c')
        n_rows = {1: 2, 2: 1, 3: 0}[len(lines)]
        top = (424, 471, 518)[len(lines) - 1] + 20 + 6
    else:                                              # SC variant_card_left (for comparison)
        sev_cell(p, (741, 308, 817, 384), sev)
        p.icon(sym, 54, 779, 346, SEV[sev]['sym'])
        lines, _ = wrap(p, text, f, 345, 3)
        bases = {1: [361], 2: [338, 385], 3: [338, 385, 432]}[len(lines)]
        for b, s in zip(bases, lines):
            p.text(833, b, s, f, WHITE)
        n_rows, top = 2, 452
    if counter:
        p.text(1180, 334, counter, M.noto(29), GREY2, 'r')
    list_rows(p, rows, top, n_rows)
    if len(rows) > n_rows:
        scroll(p, 0, max(0.12, (n_rows + 1) / (len(rows) + 1)))
    return sev


def pg_list(p):
    """SC list page: nothing shows now, entries listed: up to six rows (icon 32 + Noto 33), scroll when more, no
    selection bar (no key yet)."""
    p.title('Повідомлення')
    list_rows(p, ROWS, 300, 6)
    scroll(p, 0, 6 / len(ROWS))


def pg_empty(p):
    p.title('Повідомлення')
    p.icon('cc_info', 66, 960, 392, (188, 188, 188))   # SC: white x 0.5 linear (188); a page symbol, not a tab icon
    p.text(960, 478, 'Немає повідомлень', M.noto(39), GREY2, 'c')


def pg_pointer(p, sev='amber'):
    """SC pointer: a message shows but ours cannot be drawn (D7 ...): our fixed words send the driver to BMW's panel."""
    p.title('Повідомлення')
    sev_cell(p, (922, 306, 998, 382), sev)
    p.icon('cc_warn' if sev in ('red', 'amber') else 'cc_info', 54, 960, 344, SEV[sev]['sym'])
    p.text(960, 424, 'Повідомлення', M.noto(39), GREY2, 'c')
    p.text(960, 471, 'на панелі внизу', M.noto(39), GREY2, 'c')


# ---- tab 3: media (SM model) ------------------------------------------------------------------------------------------
def progress(p, x0, x1, y, frac, left, right):
    p.rect(x0, y - 2, x1, y + 2, (80, 80, 80))
    p.rect(x0, y - 2, x0 + (x1 - x0) * frac, y + 2, WHITE)
    p.text(x0, y + 32, left, M.noto(25), GREY2)
    p.text(x1, y + 32, right, M.noto(25), GREY2, 'r')


def pg_radio(p):
    p.title('Радіо')
    p.meta('FM')
    p.icon('td_radio', 66, 960, 372)
    p.ctext((960, 450), 'Радіо Приклад', M.noto(42))
    p.ctext((960, 500), "Новини о дев'ятій", M.noto(31), GREY2)
    p.ctext((960, 550), 'P3  ·  101.7  ·  TP', M.noto(27), GREY_MID)


def pg_track(p, cover=False):
    p.title('Медіа')
    p.meta('USB')
    if cover:
        p.rrect(745, 340, 875, 470, 6, fill=(44, 46, 50))
        p.icon('td_media', 52, 810, 398, (140, 140, 140))
        p.ctext((810, 455), 'обкладинка (пізніше)', M.noto(14), GREY_DIM)
        p.text(895, 390, fit(p, 'Ранкова хвиля', M.noto(36), 285), M.noto(36), WHITE)
        p.text(895, 435, 'Гурт Приклад', M.noto(31), GREY2)
    else:
        p.ctext((960, 385), 'Ранкова хвиля', M.noto(42))
        p.ctext((960, 438), 'Гурт Приклад', M.noto(33), GREY2)
    progress(p, 745, 1176, 510, 0.28, '1:01', '3:35')
    p.text(960, 542, '4 / 12', M.noto(25), GREY_MID, 'c')
    p.icon('td_play', 24, 960, 572, GREY_MID)


def pg_media_min(p):
    p.title('Медіа')
    p.icon('td_media', 110, 960, 405)
    p.ctext((960, 512), 'Медіа', M.noto(42))


def pg_media_src(p):
    p.title('Медіа')
    p.icon('td_media', 96, 960, 390)
    p.ctext((960, 488), 'Bluetooth', M.noto(42))
    p.ctext((960, 538), 'джерело (лише тип)', M.noto(25), GREY_DIM)


def sel_bar(p, y_top, colour):
    """SF list proposal: x 733-1187, 40 px, 1 px outline ~200, fill the tab colour at ~20 %, a 3 px left edge in it."""
    fill = enc(lin(colour) * 0.20 ** 2.2 * 4)        # a dark tint of the tab colour
    p.rect(733, y_top + 2, 1187, y_top + 42, fill)
    p.rrect(733, y_top + 2, 1187, y_top + 42, 2, outline=(200, 200, 200), width=1)
    p.rect(733, y_top + 2, 736, y_top + 42, colour)


def pg_media_list(p, kind='stations'):
    if kind == 'stations':
        p.title('Радіо · станції')
        p.meta('FM')
        rows = [('Радіо Приклад', '101.7'), ('Друга станція', '91.7'), ('Третя станція', '95.4'), ('Станція чотири', '99.1'),
                ("П'ята станція", '102.8'), ('Шоста станція', '104.3')]
    else:
        p.title('Медіа · список')
        p.meta('USB')
        rows = [('Ранкова хвиля', '4'), ('Друга композиція', '5'), ('Третя композиція', '6'), ('Четверта композиція', '7'),
                ("П'ята композиція", '8'), ('Шоста композиція', '9')]
    sel_bar(p, 300, TAB_COLOUR[3])
    for k, (s, r) in enumerate(rows):                # SF: pitch 44, Noto 34, text from 781, right column to 1180
        y = 300 + 44 * k
        p.icon('td_radio' if kind == 'stations' else 'td_media', 32, 757, y + 22, WHITE if k == 0 else GREY2)
        p.text(781, y + 33, s, M.noto(34), WHITE if k == 0 else GREY2)
        p.text(1176, y + 33, r, M.noto(25), GREY_MID, 'r')
    scroll(p, 0, 0.5)


# ---- tab 4: phone (SP model) ------------------------------------------------------------------------------------------
def pg_phone_idle(p):
    p.title('Телефон')
    p.icon('td_phone', 70, 960, 365)
    p.ctext((960, 440), 'Підключено · CarPlay', M.noto(36))
    p.icon('cc_battery', 30, 852, 490)
    p.rect(876, 488, 976, 494, (60, 60, 60))
    p.rect(876, 488, 956, 494, WHITE)
    p.text(986, 500, '80 %', M.noto(25), GREY2)
    p.icon('td_bars', 26, 1062, 490)
    p.text(1080, 500, '3/4', M.noto(25), GREY2)
    p.ctext((960, 548), 'Пропущені: 2   ·   На зарядці', M.noto(27), GREY_MID)


def pg_phone_certain(p):
    p.title('Телефон')
    p.icon('td_phone', 110, 960, 405)
    p.ctext((960, 512), 'Телефон', M.noto(42))


def pg_phone_call(p, state, who='a'):
    line = {'a': 'Контакт', 'b': "Ім'я Прізвище", 'c': None}[who]
    if state == 'incoming':
        p.title('Вхідний дзвінок')
        p.meta('CarPlay')
        p.icon('td_phone_ring', 96, 960, 378, (90, 200, 80))
        if line:
            p.ctext((960, 478), line, M.noto(42))
        p.ctext((960, 545 if line else 495), 'Прийняти: кнопка телефону на кермі', M.noto(25), GREY_MID)
    elif state == 'active':
        p.title('Розмова')
        p.icon('td_handset', 70, 960, 352)
        p.ctext((960, 438), '02:37', M.saira(64))
        if line:
            p.ctext((960, 506), line, M.noto(36), GREY2)
        p.icon('td_mic_off', 30, 960, 558, GREY_MID)
    else:
        p.title('Дзвінок завершено')
        p.icon('td_handset', 70, 960, 385, GREY_DIM)
        p.ctext((960, 470), '02:41', M.saira(64), GREY2)
        p.ctext((960, 535), 'повернення за 3 с', M.noto(25), GREY_DIM)


# ---- alternatives for tab 3 / 4 (SV model) ----------------------------------------------------------------------------
def pg_tech(p):
    """SV V1: label Noto 31 at x 745, value Noto 40 right at 1150, unit +6, baselines 352 / 418 / 484 / 550, bars
    x 745-1175 12 px under the baseline, 6 px, track grey 0.16, white, red from warn_from."""
    p.title('Технічні дані')
    rows = [('Олива', '104', '°C', (50, 150), 130, 104), ('Охолодження', '92', '°C', (50, 130), 120, 92),
            ('Наддув', '0.42', 'бар', (0, 1.6), None, 0.42), ('Зовні', '+7.5', '°C', None, None, None)]
    track = enc(lin((111, 111, 111)))
    for (label, val, unit, rng, warn, v), base in zip(rows, (352, 418, 484, 550)):
        p.text(745, base, label, M.noto(31), GREY2)
        p.text(1150, base, val, M.noto(40), WHITE, 'r')
        p.text(1156, base, unit, M.noto(21), WHITE)
        if rng:
            y = base + 12
            p.rect(745, y, 1175, y + 6, track)
            frac = (v - rng[0]) / (rng[1] - rng[0])
            p.rect(745, y, 745 + 430 * frac, y + 6, WHITE)
            if warn:
                wx = 745 + 430 * (warn - rng[0]) / (rng[1] - rng[0])
                p.rect(wx, y, 1175, y + 6, (120, 20, 30))


def car_outline(p, cx, cy, wpx, hpx, door=None, colour=(200, 202, 206)):
    """Our own top-view car, outline only (front up). door 'fl': the driver's door swung out 35 deg, white, amber edge."""
    x0, y0, x1, y1 = cx - wpx / 2, cy - hpx / 2, cx + wpx / 2, cy + hpx / 2
    p.rrect(x0, y0, x1, y1, wpx * 0.32, outline=colour, width=3)
    p.cv.d.line([((x0 + wpx * 0.14) * SS, (y0 + hpx * 0.30) * SS), ((x1 - wpx * 0.14) * SS, (y0 + hpx * 0.30) * SS)], fill=colour, width=3 * SS)
    p.cv.d.line([((x0 + wpx * 0.18) * SS, (y0 + hpx * 0.78) * SS), ((x1 - wpx * 0.18) * SS, (y0 + hpx * 0.78) * SS)], fill=colour, width=3 * SS)
    p.rrect(x0 + wpx * 0.18, y0 + hpx * 0.36, x1 - wpx * 0.18, y0 + hpx * 0.70, 6, outline=colour, width=2)
    for yy in (0.36, 0.58):                             # door lines
        p.cv.d.line([(x0 * SS, (y0 + hpx * yy) * SS), ((x0 + 6) * SS, (y0 + hpx * yy) * SS)], fill=colour, width=2 * SS)
        p.cv.d.line([((x1 - 6) * SS, (y0 + hpx * yy) * SS), (x1 * SS, (y0 + hpx * yy) * SS)], fill=colour, width=2 * SS)
    if door == 'fl':
        hx, hy, L = x0, y0 + hpx * 0.33, hpx * 0.24
        a = math.radians(35)
        ex, ey = hx - L * math.sin(a), hy + L * math.cos(a)
        p.cv.d.line([(hx * SS, hy * SS), (ex * SS, ey * SS)], fill=(240, 170, 10), width=int(8 * SS))
        p.cv.d.line([(hx * SS, hy * SS), (ex * SS, ey * SS)], fill=WHITE, width=int(4 * SS))
        p.rect(x0 - 2, hy, x0 + 2, hy + L, (0, 0, 0))


def pg_tyres(p):
    """SV V1b: car outline centred (960, 430) 110 x 230; pressure Noto 40 + 'бар' Noto 21, temperature Noto 31 grey."""
    p.title('Шини')
    car_outline(p, 960, 430, 110, 230)
    vals = {'FL': ((800, 360), '2.4', '+6'), 'FR': ((1120, 360), '2.4', '+6'), 'RL': ((800, 505), '2.5', '+7'), 'RR': ((1120, 505), '2.4', '+6')}
    for (x, y), pr, t in vals.values():
        f = M.noto(40)
        w = p.width(pr, f) + 4 + p.width('бар', M.noto(21))
        p.text(x - w / 2, y, pr, f, WHITE)
        p.text(x - w / 2 + p.width(pr, f) + 4, y, 'бар', M.noto(21), WHITE)
        p.text(x, y + 40, t + ' °C', M.noto(31), GREY_DIM, 'c')


def pg_car(p):
    """SV V2: the drawing in [900, 306, 1020, 520], an open door swung out 35 deg (white, amber edge), one line at 552."""
    p.title('Автомобіль')
    car_outline(p, 960, 413, 120, 214, 'fl')
    p.text(960, 552, 'Відчинено: двері водія', M.noto(31), WHITE, 'c')


def no_passing(p, cx, cy, r):
    p.disc(cx, cy, r, SIGN_RED)
    p.disc(cx, cy, r * 0.77, (250, 250, 250))
    for dx, col in ((-0.3, (0, 0, 0)), (0.3, SIGN_RED)):
        p.rrect(cx + dx * r - r * 0.16, cy - r * 0.3, cx + dx * r + r * 0.16, cy + r * 0.3, r * 0.08, fill=col)


def pg_assist(p):
    """SV V3: the sign large (858, 432) r 80, the supplemental plate [798, 522, 918, 556], no-passing (1094, 362) r 42,
    set speed [1010, 420, 1180, 490], gap bars [1040, 505, 1150, 545], next limit at y 590."""
    p.title('Асистенти')
    sign(p, *LIM_D, 90)
    p.rrect(798, 522, 918, 556, 4, fill=(245, 245, 245))
    p.icon('td_rain', 28, 858, 539, (0, 0, 0))
    no_passing(p, 1094, 362, 42)
    p.icon('td_cruise', 36, 1030, 448, GREEN)
    p.text(1054, 470, '110', M.saira(60), GREEN)
    p.text(1054, 492, 'км/год', M.noto(21), GREEN)
    for k in range(4):
        p.rect(1040 + k * 28, 528 - 5 * k, 1062 + k * 28, 545, WHITE if k < 3 else (70, 70, 70))
    p.text(960, 592, 'далі 90 · 300 м', M.noto(27), GREY_MID, 'c')


def pg_consumption(p):
    """SV V4: '8.7' Saira 92 at (920, 372) + 'л/100 км'; 30 bars x 745-1175, y 420-520, average line; footer at 556."""
    p.title('Витрата')
    p.ctext((920, 372), '8.7', M.saira(92))
    p.text(990, 392, 'л/100 км', M.noto(31), WHITE)
    rng = np.random.default_rng(3)
    vals = np.clip(7.0 + np.cumsum(rng.normal(0, 0.9, 30)), 3.5, 13.5)
    bw = 430 / 30
    for k, v in enumerate(vals):
        h = v / 14.0 * 100
        p.rect(745 + k * bw + 1.5, 520 - h, 745 + (k + 1) * bw - 1.5, 520, (200, 200, 200))
    avg = float(vals.mean())
    p.rect(741, 520 - avg / 14 * 100 - 1, 1179, 520 - avg / 14 * 100 + 1, (218, 16, 48))
    p.text(960, 556, 'ø 6.8 л/100 км · запас 412 км', M.noto(29), GREY2, 'c')


# ---- tab 5: navigation (SN model) -------------------------------------------------------------------------------------
BMW_MAP_BOX = (700, 138, 1217, 594)              # SN a10 box on the car
W1_BOX, W1_FADE = (750, 180, 1170, 564), (120, 80, 80)
W2_BOX = (700, 173, 1220, 600)


def map_layer(seed=11):
    """SN stand-in in BMW's box: navy ground (18, 32, 64)-(30, 50, 90), roads (120, 140, 170) 3-6 px, a blue route
    (60, 120, 255) 8 px, the car chevron at (958, 480); BMW's own soft edge (35 px fall-off). Returns (rgb, alpha) at SS
    over the union box [700, 138, 1220, 600]."""
    ux0, uy0, ux1, uy1 = 700, 138, 1220, 600
    w, h = (ux1 - ux0) * SS, (uy1 - uy0) * SS
    bx0, by0, bx1, by1 = [(v - o) * SS for v, o in zip(BMW_MAP_BOX, (ux0, uy0, ux0, uy0))]
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


def window_alpha(shape, origin, variant):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(float) / SS
    xx += origin[0]
    yy += origin[1]
    if variant == 'W2':
        x0, y0, x1, y1 = W2_BOX
        return ((xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)).astype(float)
    x0, y0, x1, y1 = W1_BOX
    ft, fs, fb = W1_FADE
    a = np.minimum.reduce([np.clip((yy - y0) / ft, 0, 1), np.clip((xx - x0) / fs, 0, 1), np.clip((x1 - xx) / fs, 0, 1),
                           np.clip((y1 - yy) / fb, 0, 1)])
    return a * ((xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1))


def pg_map(p, variant='W1', road=True):
    """SN: no title (01, 07, 11); W1 the vignette (zero box [750, 180, 1170, 564], fades 120 / 80 / 80), W2 the open box
    [700, 173, 1220, 600] wider than BMW's box (its own edge shows); the road bar [760, 540, 1160, 584], black 60 %."""
    rgb, a_bmw, origin = map_layer()
    a = a_bmw * window_alpha(a_bmw.shape, origin, variant)
    x0, y0 = origin
    reg = np.asarray(p.cv.img.crop((x0 * SS, y0 * SS, x0 * SS + rgb.shape[1], y0 * SS + rgb.shape[0]))).astype(float)
    win = window_alpha(a_bmw.shape, origin, variant) > 0
    out = np.where(win[..., None], rgb * a[..., None], reg)
    p.cv.img.paste(Image.fromarray(out.astype(np.uint8)), (x0 * SS, y0 * SS))
    if road:
        bx = (760, 540, 1160, 584)
        reg = np.asarray(p.cv.img.crop(tuple(v * SS for v in bx))).astype(float) * 0.4
        p.cv.img.paste(Image.fromarray(reg.astype(np.uint8)), (bx[0] * SS, bx[1] * SS))
        p.text(960, 572, 'вулиця Тестова', M.noto(31), WHITE, 'c')


def pg_guided(p):
    """SN fallback 'guided': arrow [770, 318, 890, 438], distance '350' Saira 72 + 'м' at x 915 baseline 410, next road
    Noto 33 at 770 / 480, lanes [892, 498, 1028, 532] pitch 34, footer Noto 29 grey at (960, 560)."""
    p.title('Навігація')
    p.icon('td_turn_right', 120, 830, 378)
    p.text(915, 410, '350', M.saira(72), WHITE)
    p.text(915 + p.width('350', M.saira(72)) + 6, 410, 'м', M.noto(29), WHITE)
    p.text(770, 480, fit(p, 'вулиця Тестова', M.noto(33), 410), M.noto(33), WHITE)
    for k, (name, hi) in enumerate((('td_turn_left', False), ('td_straight', True), ('td_straight', True), ('td_turn_right', False))):
        p.icon(name, 28, 892 + 34 * k + 17, 515, WHITE if hi else (110, 110, 110))
    p.text(960, 568, 'прибуття 09:32 · 14.2 км', M.noto(29), GREY_DIM, 'c')


def pg_nav_state(p, state):
    p.title('Навігація')
    if state == 'idle':
        p.ctext((960, 420), 'Маршрут не прокладено', M.noto(29), GREY_DIM)
    elif state == 'road_only':
        p.ctext((960, 400), 'вулиця Тестова', M.noto(41))
        p.ctext((960, 452), 'Маршрут не прокладено', M.noto(29), GREY_DIM)
    else:
        p.ctext((960, 400), 'Розрахунок маршруту…', M.noto(33))


def hub_guidance(p):
    """SN hub_variant (07's idea, not recommended): arrow [1498, 248, 1582, 332], lanes [1460, 500, 1620, 530]."""
    p.icon('td_turn_right', 84, 1540, 290)
    for k, (name, hi) in enumerate((('td_turn_left', False), ('td_straight', True), ('td_straight', True), ('td_turn_right', False))):
        p.icon(name, 26, 1478 + 41 * k, 515, WHITE if hi else (110, 110, 110))


# ---- the pictures -----------------------------------------------------------------------------------------------------
SHOTS = []


def shot(sheet, name, caption, keys, sel=1, page=None, cs=None, warn=None, s2=False, bottom=None, sev_rule=None,
         window=False, limit=None, speed=87.0, rpm=2.4, extra=None, sel_colour=None, keepouts=False):
    p = Page(speed, rpm)
    tab_bar(p, cs or cells(), sel, sel_colour, warn, s2)
    if page:
        r = page(p)
        if sev_rule == 'auto' and r:
            sev_rule = SEV[r]['rule']
    if window:
        bmw_panel(p)
    else:
        bottom_row(p, bottom or (2 if sel == 1 else 1), sev_rule if sev_rule != 'auto' else None)
    lim = limit or {}
    if 'b' in lim:
        limit_marker(p, lim['b'], lim.get('over'), lim.get('state') == 'conditional')
    if 'a' in lim:
        sign(p, *LIM_A, lim['a'], lim.get('state', 'limit'))
    if 'c' in lim:
        sign(p, *LIM_C, lim['c'], lim.get('state', 'limit'))
    if extra:
        extra(p)
    status = {k: STATUS[k][0] for k in keys}
    img = p.finish([name + ' - ' + caption, 'data: ' + ', '.join('%s: %s' % kv for kv in status.items())])
    path = os.path.join(OUT, sheet, name + '.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    entry = dict(sheet=sheet, file=os.path.relpath(path, OUT), caption=caption, status=status,
                 source={k: STATUS[k][1] for k in keys}, look=LOOK_NAME)
    if keepouts:
        kp = os.path.join(OUT, sheet, name + '_keepouts.png')
        annotate(img).save(kp)
        entry['keepouts'] = os.path.relpath(kp, OUT)
    SHOTS.append(entry)
    print('wrote', path)
    return img


def annotate(img):
    """mockup.annotate (BMW's and the protected places) plus the G20 KOMBI black box [1420, 320, 1611, 440]."""
    out = M.annotate(img).convert('RGBA')
    ov = Image.new('RGBA', out.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rectangle(KOMBI_BOX_G20, fill=(255, 255, 255, 60), outline=(255, 255, 255, 255), width=2)
    out = Image.alpha_composite(out, ov).convert('RGB')
    d = ImageDraw.Draw(out)
    d.text((KOMBI_BOX_G20[0] + 4, KOMBI_BOX_G20[1] + 4), 'KOMBI black box (G20)', font=lf(16), fill=(255, 255, 255))
    d.rectangle([20, 20 + 6 * 26, 38, 38 + 6 * 26], fill=(255, 255, 255))
    d.text((46, 20 + 6 * 26), 'KOMBI black box, G20 [1420, 320, 1611, 440]', font=lf(18), fill=(255, 255, 255))
    return out


def C(**kw):
    """cells() with per-tab changes: C(t3=dict(...), t4=dict(...), seps=..., tab2=...)."""
    cs = cells(kw.get('seps'), kw.get('tab2', True))
    for c in cs:
        c.update(kw.get('t%d' % c['id'], {}))
    return cs


def build():
    # ---- the live tab bar
    shot('tabs', 'T1_sel1', 'tab 1 selected (red): date and time; two-line bottom row', ['range', 'clock'], 1, pg_clock)
    shot('tabs', 'T2_sel2', 'tab 2 selected (red): the amber card; severity in the cell, not the fill', ['cc', 'cc_now'], 2,
         lambda p: pg_card(p, 'amber2'), warn='amber', sev_rule='auto')
    shot('tabs', 'T3_sel3', 'tab 3 selected (amber, H): radio', ['media'], 3, pg_radio)
    shot('tabs', 'T4_sel4', 'tab 4 selected (green, H): phone idle', ['phone'], 4, pg_phone_idle)
    shot('tabs', 'T5_sel5', 'tab 5 selected (blue): map W1', ['map', 'road'], 5, pg_map)
    shot('tabs', 'T6_all_red', 'variant: every tab red when selected (tab 3)', ['media'], 3, pg_radio, sel_colour=(176, 10, 37))
    shot('tabs', 'T7_today_seps', "today's separators 744 / 812 (SF: tab 1 too narrow)", ['range', 'clock'], 1, pg_clock,
         cs=C(seps=SEPS_TODAY))
    shot('tabs', 'T8_no_msg_white', 'no message: tab 2 white, unfilled (SF a; SC W1; no dimming)', ['cc'], 1, pg_clock)
    shot('tabs', 'T9_no_msg_absent', "no message: tab 2 absent (maker's rule; needs movable separators)", ['cc'], 1, pg_clock,
         cs=C(tab2=False))
    shot('tabs', 'T10_msg_amber_icon', 'message, tab 1 selected: triangle amber (SC W2), BMW panel open', ['cc', 'cc_now'], 1,
         pg_clock, warn='amber', window=True)
    shot('tabs', 'T11_msg_red_icon', 'message, tab 3 selected: triangle red (SC W2), BMW panel open', ['cc', 'media'], 3,
         pg_radio, warn='red', window=True)
    shot('tabs', 'T12_s2_amber', 'SC variant S2: tab 2 fill in the severity colour (amber, black icon)', ['cc', 'cc_now'], 2,
         lambda p: pg_card(p, 'amber2'), warn='amber', s2=True, sev_rule='auto')
    shot('tabs', 'T13_four_no_phone', 'four tabs: phone removed, media wider', ['media'], 3, pg_radio,
         cs=[c for c in C(t3=dict(x1=1237)) if c['id'] != 4])
    shot('tabs', 'T14_four_no_media', 'four tabs: media removed, phone in the wide cell', ['phone'], 4, pg_phone_idle,
         cs=[c for c in C(t4=dict(x0=848, text='Підключено')) if c['id'] != 3])
    shot('tabs', 'T15_other_icons', 'tab 3 = technical (engine, oil text), tab 4 = tyres', ['oil', 'tyres'], 3, pg_tech,
         cs=C(t3=dict(icon='td_engine', text='Олива 104 °C', fill=FN_COLOUR['red']), t4=dict(icon='cc_tyre')))
    shot('tabs', 'T16_phone_none', 'no phone connected: tab 4 crossed out (SF, SP)', ['phone'], 1, pg_clock,
         cs=C(t4=dict(icon='td_phone_none')))
    shot('tabs', 'T17_nav_arrow', 'guided, turn within 300 m: the turn arrow in tab 5 (SN variant)', ['guiding', 'dart'], 1, pg_clock,
         cs=C(t5=dict(icon='td_turn_right')))
    shot('tabs', 'T18_muted', 'tab 3 with the mute mark', ['media', 'mute'], 1, pg_clock, cs=C(t3=dict(mark='td_mute')))
    shot('tabs', 'T19_in_call', 'tab 4 lit green during a call, tab 1 selected', ['call'], 1, pg_clock,
         cs=C(t4=dict(icon='td_phone', ink=(90, 200, 80))))

    # ---- tab 1
    shot('tab1', '1A_clock', "date and time, today's big clock (owner's mockup 1)", ['clock'], 1, pg_clock)
    shot('tab1', '1B_clock_06', "date and time in 06's grammar (time cap 44, symbol before it)", ['clock'], 1,
         lambda p: pg_clock(p, '06'))
    shot('tab1', '1C_trip_short', 'trip: this journey (02 table grammar, meta line, stacked unit)', ['trip'], 1, lambda p: pg_trip(p, 1))
    shot('tab1', '1D_trip_long', 'trip: long term', ['trip'], 1, lambda p: pg_trip(p, 2))

    # ---- tab 2
    tab2 = dict(sev_rule='auto')
    shot('tab2', '2A_white_1', 'card white, 1 line + 2 rows', ['cc', 'cc_now'], 2, lambda p: pg_card(p, 'white1'), warn='grey', **tab2)
    shot('tab2', '2B_white_2', 'card white, 2 lines + 1 row', ['cc', 'cc_now'], 2, lambda p: pg_card(p, 'white2'), warn='grey', **tab2)
    shot('tab2', '2C_amber_1', 'card amber, 1 line + 2 rows', ['cc', 'cc_now'], 2, lambda p: pg_card(p, 'amber1'), warn='amber', **tab2)
    shot('tab2', '2D_amber_2_counter', 'card amber, 2 lines, counter 2/3 (needs P1), 1 row, scroll', ['cc', 'cc_now', 'cc_counter'], 2,
         lambda p: pg_card(p, 'amber2', '2/3'), warn='amber', **tab2)
    shot('tab2', '2E_red_3', 'card red, 3 lines, no rows (scroll says more)', ['cc', 'cc_now'], 2, lambda p: pg_card(p, 'red3'), warn='red', **tab2)
    shot('tab2', '2F_red_cut', "card red, cut with '…' on line 3", ['cc', 'cc_now'], 2, lambda p: pg_card(p, 'redcut'), warn='red', **tab2)
    shot('tab2', '2G_card_left', 'card, left variant (rejected by SC, for comparison)', ['cc', 'cc_now'], 2,
         lambda p: pg_card(p, 'amber2', layout='left'), warn='amber', **tab2)
    shot('tab2', '2H_list', 'list: nothing shows now, six stored rows + scroll', ['cc'], 2, pg_list)
    shot('tab2', '2I_empty', 'empty: nothing listed', ['cc'], 2, pg_empty)
    shot('tab2', '2J_opening', 'opening: card painted, BMW panel still open (first 150 ms)', ['cc', 'cc_now'], 2,
         lambda p: pg_card(p, 'amber2'), warn='amber', window=True)
    shot('tab2', '2K_covered', 'after 150 ms with our card on screen: bottom row back, rule amber', ['cc', 'cc_now'], 2,
         lambda p: pg_card(p, 'amber2'), warn='amber', **tab2)
    shot('tab2', '2L_pointer', "pointer (D7: 'shown now' never seen): our words + BMW panel", ['cc', 'cc_now'], 2,
         pg_pointer, warn='amber', window=True)
    shot('tab2', '2M_left', 'driver left tab 2 during the message: clock, BMW panel, amber triangle', ['cc', 'clock'], 1,
         pg_clock, warn='amber', window=True, keepouts=True)

    # ---- tab 3
    shot('tab3', '3A_radio', 'SM M2 radio: band (meta), station, radio text, facts', ['media'], 3, pg_radio)
    shot('tab3', '3B_track', 'SM M1 now playing: title, artist, progress, n of m', ['media', 'progress'], 3, pg_track)
    shot('tab3', '3C_track_cover', 'SM M1 with a cover place (cover art: later)', ['media', 'progress'], 3, lambda p: pg_track(p, True))
    shot('tab3', '3D_certain', 'SM M3 only what is certain: pictogram, no tab text', ['media_icon'], 3, pg_media_min,
         cs=C(t3=dict(icon='td_media', text=None)))
    shot('tab3', '3E_source', 'SM M3 + source type (enum, our word)', ['media_src'], 3, pg_media_src,
         cs=C(t3=dict(icon='td_media', text='Bluetooth')))
    shot('tab3', '3F_stations', 'SM station list (doubtful), SF list grammar + selection bar', ['media_list'], 3, pg_media_list)
    shot('tab3', '3G_tracks', 'SM M4 track window (doubtful)', ['media_list'], 3, lambda p: pg_media_list(p, 'tracks'))

    # ---- tab 4 (phone) and the alternatives for 3 / 4
    shot('tab4', '4A_idle', 'SP P0 idle: connected, battery, signal, counts', ['phone'], 4, pg_phone_idle)
    shot('tab4', '4B_certain', 'SP P3 only what is certain', ['phone_icon'], 4, pg_phone_certain, cs=C(t4=dict(icon='td_phone')))
    incall = C(t4=dict(icon='td_phone'))
    shot('tab4', '4C_incoming_a', 'SP P1 incoming, (a) Контакт; auto-selected', ['call', 'contact_kind'], 4,
         lambda p: pg_phone_call(p, 'incoming', 'a'), cs=incall)
    shot('tab4', '4D_incoming_b', "SP P1 incoming, (b) the caller's name (owner setting)", ['call', 'caller_name'], 4,
         lambda p: pg_phone_call(p, 'incoming', 'b'), cs=incall)
    shot('tab4', '4E_incoming_c', 'SP P1 incoming, (c) no caller line', ['call'], 4, lambda p: pg_phone_call(p, 'incoming', 'c'), cs=incall)
    shot('tab4', '4F_active', 'SP P2 active: our timer, Контакт, mic muted', ['call', 'timer', 'mic'], 4,
         lambda p: pg_phone_call(p, 'active'), cs=incall)
    shot('tab4', '4G_ended', 'SP P4 call ended, 3 s then back', ['call'], 4, lambda p: pg_phone_call(p, 'ended'), cs=incall)
    red4 = lambda icon: C(t4=dict(icon=icon, fill=FN_COLOUR['red']))     # noqa: E731  (a car page: the car's red, H)
    shot('tab4', 'V1_tech', 'SV V1 technical: oil, coolant, boost, outside', ['oil', 'coolant', 'boost', 'outside'], 4, pg_tech,
         cs=red4('td_engine'))
    shot('tab4', 'V1b_tyres', 'SV V1b tyres: pressure and temperature per wheel', ['tyres'], 4, pg_tyres, cs=red4('cc_tyre'))
    shot('tab4', 'V2_car', 'SV V2 car picture, driver door open (may belong to tab 2)', ['doors'], 4, pg_car, cs=red4('td_car'))
    shot('tab4', 'V3_assist', 'SV V3 assistance: sign, plate, no passing, set speed, gap, next limit', ['limit', 'assist'], 4,
         pg_assist, cs=red4('td_limit'))
    shot('tab4', 'V4_consumption', 'SV V4 consumption: now, our history, average, range', ['cons_now', 'cons_hist', 'range'], 4,
         pg_consumption, cs=red4('td_avg'))

    # ---- tab 5
    shot('tab5', '5A_map_W1', 'SN W1: soft-edged window, no title, road bar', ['map', 'road'], 5, pg_map)
    shot('tab5', '5B_map_W2', "SN W2: wider than BMW's box (its own edge shows)", ['map', 'road'], 5, lambda p: pg_map(p, 'W2'))
    shot('tab5', '5C_map_W1_noroad', 'SN W1 without the road bar', ['map'], 5, lambda p: pg_map(p, 'W1', False))
    shot('tab5', '5D_guided', 'SN fallback, guided: arrow, distance, next road, lanes, arrival', ['guiding', 'dart'], 5, pg_guided)
    shot('tab5', '5E_road_only', 'SN fallback: road only, no route', ['guiding', 'road'], 5, lambda p: pg_nav_state(p, 'road_only'))
    shot('tab5', '5F_calculating', 'SN fallback: calculating', ['guiding'], 5, lambda p: pg_nav_state(p, 'calc'))
    shot('tab5', '5G_idle', 'SN fallback: idle', ['guiding'], 5, lambda p: pg_nav_state(p, 'idle'))
    shot('tab5', '5H_hub', "SN hub variant (07): arrow + lanes in the speedometer hub - NOT recommended", ['dart'], 5, pg_map,
         extra=hub_guidance, keepouts=True)

    # ---- speed limit (SV)
    lp = dict(sel=3, page=pg_radio)
    shot('limit', 'La', '(a) bottom row, right end: (1300, 672) r 33', ['limit'], limit={'a': 90}, **lp)
    shot('limit', 'Lb', '(b) marker on the strip at 90, needle 87', ['limit'], limit={'b': 90}, **lp)
    shot('limit', 'Lb_over', '(b) over the limit: strip red from 90 to the needle (104)', ['limit'], limit={'b': 90, 'over': 104}, speed=104.0, **lp)
    shot('limit', 'Lc', '(c) in the hub under the unit: (1540, 526) r 34', ['limit'], limit={'c': 90}, keepouts=True, **lp)
    shot('limit', 'Ld', '(d) large on the assistance page', ['limit', 'assist'], 4, pg_assist, cs=red4('td_limit'))
    shot('limit', 'Lab', '(a) + (b): SV recommendation', ['limit'], limit={'a': 90, 'b': 90}, keepouts=True, **lp)
    shot('limit', 'Lab_tab1', '(a) + (b) with tab 1 (two-line bottom row)', ['limit'], 1, pg_clock, limit={'a': 90, 'b': 90})
    shot('limit', 'La_unknown', '(a) unknown: three dashes, no marker', ['limit'], limit={'a': 0, 'state': 'unknown'}, **lp)
    shot('limit', 'La_end', '(a) end of restrictions', ['limit'], limit={'a': 0, 'state': 'end'}, **lp)
    shot('limit', 'Lab_cond', '(a) + (b) conditional: dot under the sign, hollow marker', ['limit'],
         limit={'a': 90, 'b': 90, 'state': 'conditional'}, **lp)
    shot('limit', 'La_130', '(a) three digits (130) at 112 km/h', ['limit'], limit={'a': 130, 'b': 130}, speed=112.0, rpm=3.1, **lp)


# ---- contact sheets ---------------------------------------------------------------------------------------------------
CENTRE = (560, 100, 1360, 720)
SHEETS = {
    'tabs': ((600, 116, 1320, 186), 1.0, 2, 'Live tab bar (SF v2: fill = selected, own colour, 3 px rule, 36 px icons, tab 1 widened)'),
    'tab1': (CENTRE, 0.5, 4, 'Tab 1: on-board computer (SF value / table page grammar)'),
    'tab2': (CENTRE, 0.5, 4, 'Tab 2: messages in the centre (SC card.json; severity in the cell, triangle, bottom rule)'),
    'tab3': (CENTRE, 0.5, 4, 'Tab 3: radio and media (SM: every media field unseen)'),
    'tab4': (CENTRE, 0.5, 4, 'Tab 4: phone (SP) and the alternatives for tab 3 or 4 (SV)'),
    'tab5': (CENTRE, 0.5, 4, 'Tab 5: navigation (SN: map windows W1 / W2, fallback pages)'),
    'limit': ((560, 60, 1920, 720), 0.4, 3, 'Speed limit (SV placements a-d, states)'),
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


PICK = ['T1_sel1', 'T2_sel2', 'T3_sel3', 'T4_sel4', 'T5_sel5', '1C_trip_short', '2D_amber_2_counter', '2J_opening',
        '2M_left', '3B_track', '4C_incoming_a', 'V1_tech', '5D_guided', 'Lab']


def overview(name, title):
    items = [s for n in PICK for s in SHOTS if os.path.basename(s['file'])[:-4] == n]
    sheet(items, (0, 0, 1920, 720), 0.3, 3, title, os.path.join(OUT, name))


def keep_v1():
    """The first pass's sheets (before SF v2, SV, SC, K1) are kept under r3/v1/ for comparison."""
    v1 = os.path.join(OUT, 'v1')
    if os.path.isdir(v1):
        return
    os.makedirs(v1)
    for fn in os.listdir(OUT):
        if fn.endswith('_sheet.png') and fn.split('_sheet')[0] in list(SHEETS) + ['pages']:   # ours only (K1 shares r3/)
            shutil.move(os.path.join(OUT, fn), os.path.join(v1, fn))
    if os.path.exists(os.path.join(OUT, 'index.json')):
        shutil.move(os.path.join(OUT, 'index.json'), os.path.join(v1, 'index.json'))


def main():
    global LOOK_NAME
    os.makedirs(OUT, exist_ok=True)
    keep_v1()
    for sub in SHEETS:
        shutil.rmtree(os.path.join(OUT, sub), ignore_errors=True)
    load_models()
    print('dials:', DIALS_PATH, 'look:', LOOK_NAME)
    build()
    for name, (crop, scale, cols, title) in SHEETS.items():
        sheet([s for s in SHOTS if s['sheet'] == name], crop, scale, cols, title, os.path.join(OUT, name + '_sheet.png'))
    overview('pages_sheet.png', 'Twin Dial r3 (K2 v2): tabs and pages, overview - dials: K1 look %s - every text invented' % LOOK_NAME)
    main_shots = list(SHOTS)
    alt = os.environ.get('K2_LOOK_ALT', 'look_C_both')
    if LOOK_NAME and alt:                            # the overview again with K1's middle look, pictures in r3/lookC/
        LOOK_NAME = alt
        SHOTS.clear()
        build_alt()
        overview('pages_sheet_lookC.png', 'Twin Dial r3 (K2 v2): overview with K1 look %s' % LOOK_NAME)
        SHOTS[:] = main_shots + SHOTS
    json.dump(dict(generator='tools/twin-dial/mockup/pages.py', dials=DIALS_PATH, look=os.environ.get('K2_LOOK', 'r3_fixed'),
                   models=['%s/%s' % k for k in sorted(MODELS)], status_words=STATUS, pictures=SHOTS),
              open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)


def build_alt():
    """Only the overview's pictures, drawn again into r3/lookC/."""
    orig = globals()['shot']

    def only(sheet_, name, *a, **kw):
        if name in PICK:
            return orig('lookC', name, *a, **kw)
    globals()['shot'] = only
    try:
        shutil.rmtree(os.path.join(OUT, 'lookC'), ignore_errors=True)
        build()
    finally:
        globals()['shot'] = orig


if __name__ == '__main__':
    main()
