#!/usr/bin/env python3
"""Generates Twin Dial's layout (docs/twin-dial/SPEC.md; package C of round 2):
    python3 design/gen_twin.py [apps/twin_dial/hud/layouts] [--fonts DIR]
Writes twin.json. Edit this file, not the JSON (bench/test-twin-layout.js checks that this file reproduces the committed
layout exactly: regenerate after any change here, in the fonts or in the inputs, and commit the JSON with it).

Inputs, all numbers (no reference picture, no maker's mark is read):
  design/twin-dial/vg/layout.json    centres, R, the keep-outs (belt group, gear gap, the side lamps' holes), the frame
  design/twin-dial/vf/frame_spec.json  not read: its numbers are in the SPEC's tables below (SPEC 6.1) and were checked
  the SPEC itself                    every position below carries the SPEC section it comes from
  the atlases apps/twin_dial/hud/fonts/td_*.json (package A1) - or, while they are not in the tree, the snapshot
  design/twin-dial/c/font_metrics.json (tools/twin-dial/c/font_snapshot.py): cell height, baseline and advances

The gen_6wb pattern: a text is placed by its BASELINE; its box is built round the baseline from the font as baked now
(y = baseline - the font's baseline offset, h = the font's cell height, or less where the text has no descender: see
text(below=)). Re-baking a font moves boxes, never ink.

Layers (SPEC 13.2; "conn" = the connection to cluster-render, 8 layers each):
  conn 0  bg_l, bg_rt, bg_rb (tdback), dial_tach, dial_speed (tdial), speed (the digital speed on the GPU), the bottom row's sheet
          (SPEC-R3 5.5: the row is on the connection of the layer that opens BMW's window, so "row aside" and "window open" are
          one socket's order; B3)
  conn 1  gear (GPU), the tab bar's sheet, the centre pages' ONE layer (tdpage, round 3 B4), the left hub's labels
  conn 2  tab 2's sheet (the check-control card in the centre; the old bottom plate is gone, SPEC-R3 5.1; B3), the speed-limit
          sign's sheet and the cruise readout's (B5; not "cc:" layers)
Package B3 owns tab 2's sheet and the "cc:" logic; this file lays out the seam (tab2_sheet()).
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
VG = json.load(open(os.path.join(HERE, 'twin-dial', 'vg', 'layout.json')))

# --- fonts: the atlases, or the snapshot of them -------------------------------------------------------------------
_fonts_dir = None
for i, a in enumerate(sys.argv):
    if a == '--fonts':
        _fonts_dir = sys.argv[i + 1]
        del sys.argv[i:i + 2]
        break
FONTS = _fonts_dir or os.path.join(ROOT, 'apps', 'twin_dial', 'hud', 'fonts')
_SNAP = json.load(open(os.path.join(HERE, 'twin-dial', 'c', 'font_metrics.json')))['fonts']
_font = {}
SOURCE = {}


def font(name):
    """{ cell, base, adv } of an atlas: from the atlas file when it is there, else from the snapshot."""
    if name not in _font:
        p = os.path.join(FONTS, name + '.json')
        if os.path.exists(p):
            f = json.load(open(p))
            _font[name] = {'cell': f['cellHeight'], 'base': f['baseline'], 'adv': {c: g['advance'] for c, g in f['glyphs'].items()}}
            SOURCE[name] = 'atlas'
        else:
            s = _SNAP[name]
            _font[name] = {'cell': s['cellHeight'], 'base': s['baseline'], 'adv': s['advance']}
            SOURCE[name] = 'snapshot'
    return _font[name]


def width(name, s):
    return sum(font(name)['adv'][c] for c in s)


# --- geometry from VG ------------------------------------------------------------------------------------------------
R = VG['R_px']
CT = tuple(VG['dials']['tacho']['centre'])
CS = tuple(VG['dials']['speedo']['centre'])
MID = 960
HOLES = VG['keep_outs']['telltales_holes']['rects_plus_3px']
BELT = VG['keep_outs']['belt_group']['rect']
GEAR_GAP = VG['keep_outs']['gear_gap']['rect']


def text(id, x, base, w, t, fnt, color='fg', align='center', conn=0, z=5, below=None, **kw):
    """A text box w wide on the baseline `base`; x is the box's centre (center), left edge (left) or right edge (right).
    below: ink px wanted under the baseline (digits and capitals have no descender: 3), so the box stops there and two
    rows of text 47 px apart do not make their boxes overlap (an overlap costs a sheet); None = the font's whole cell."""
    f = font(fnt)
    y = int(round(base)) - f['base']
    h = f['cell'] if below is None else min(f['cell'], int(round(base)) + below - y)
    bx = x - w / 2.0 if align == 'center' else x if align == 'left' else x - w
    d = {'id': id, 'type': 'text', 'z': z, 'x': int(round(bx)), 'y': y, 'w': w, 'h': h,
         'text': t, 'font': fnt, 'color': color, 'align': align}
    if conn:
        d['conn'] = conn
    d.update(kw)
    return d


def icon(id, name, cx, cy, size, conn=1, z=5, live='fixed', color='fg'):
    """A tab-bar pictogram. tdLive: shared/twin_tokens.js repaints it when its state or the night colours change."""
    return {'id': id, 'type': 'icon', 'icon': name, 'z': z, 'x': int(round(cx - size / 2.0)), 'y': int(round(cy - size / 2.0)),
            'w': size, 'h': size, 'color': color, 'conn': conn, 'tdLive': live}


def hit(r, b):
    return r[0] < b[2] and b[0] < r[2] and r[1] < b[3] and b[1] < r[3]


# --- the two dials (ENGINE-CONTRACT 1.1) ---------------------------------------------------------------------------------
# the layer rects end at y 660 (the gear gap [1380, 660, 1460, 720] and the belt group are never touched); the faces
# (package A2) cover [cx - 308, 90, cx + 308, 650] 1:1 with the dial centre at face px (308, 310)
DIAL_Y, DIAL_W, DIAL_H = 90, 620, 570
FACE_W, FACE_H = 616, 560


def tdial(kind):
    c = CT if kind == 'tach' else CS
    d = {'id': 'dial_' + kind, 'type': 'tdial', 'class': 'content', 'z': 1, 'x': c[0] - 310, 'y': DIAL_Y, 'w': DIAL_W, 'h': DIAL_H,
         'conn': 0, 'kind': kind, 'centre': [c[0], c[1]], 'R': int(R),
         'face': {'tex': 'face_tacho' if kind == 'tach' else 'face_speedo', 'x': c[0] - 308, 'y': DIAL_Y, 'w': FACE_W, 'h': FACE_H},
         'sweep': 125}
    y = c[1] + round(0.73 * R)                        # 619: SPEC 5.1 / 5.2, the bar under the dial
    bar = {'y': y, 'x0': c[0] - 126, 'x1': c[0] + 126, 'h': 7.5, 'segs': 5, 'gap': 4}
    if kind == 'tach':
        d.update({'scaleMax': 8000, 'redline': 'setting', 'restDeg': -135, 'shadow': True})
        bar.update({'signal': 'fuel', 'min': 0, 'max': 1, 'reserve': 'reserve'})
    else:
        d.update({'shadow': True})
        bar.update({'signal': 'coolant', 'min': 50, 'max': 130, 'hotAt': 120})
    d['bar'] = bar
    return d


# --- the three background layers (ENGINE-CONTRACT 1.2) -------------------------------------------------------------------
BG = {'L': [0, 0, 1380, 720], 'RT': [1380, 0, 1920, 660], 'RB': [1460, 660, 1920, 720]}
# SPEC-R3 3.1 (package B2): separators 780 / 848 / 1168 / 1237 (tab 1 = 618-780, tab 2 = 780-848, tab 3 = 848-1168, tab 4 = 1168-1237,
# tab 5 = 1237-1302), the rule under the bar 3 px (y 170-173); "highlight" is tab 2's cell (the round 2 warning cell, used only while live tabs are off)
TAB = {'rect': [618, 127, 1302, 172], 'seps': [780, 848, 1168, 1237], 'rule': [170, 173], 'ramp': [0.002, 0.16], 'highlight': [780, 848]}
MASK = {'tex': 'panel_mask', 'x': 694, 'y': 592, 'w': 536, 'h': 112}           # package A2: 536 x 112 R8 at [694, 592, 1230, 704]
RULES = [
    {'x0': 739, 'y0': 295, 'x1': 1181, 'y1': 297.5, 'role': 'title'},          # SPEC-R3 4: the centre title's rule, 2.5 px at y 295-297.5, code 205 (role "title")
    # SPEC 6.3 / 8.1: the bottom row's rule, y 613, 2.2 px, white; while our plate shows it is 4 px (y 611-615) in the severity colour
    {'x0': 629, 'y0': 612.4, 'x1': 1292, 'y1': 614.6, 'role': 'rule', 'ours': {'y0': 611, 'y1': 615, 'x1': 1291, 'role': 'severity'}},
]


def tdback(part):
    r = BG[part]
    holes = [list(h) for h in HOLES + [BELT] if hit(h, r)]
    d = {'id': {'L': 'bg_l', 'RT': 'bg_rt', 'RB': 'bg_rb'}[part], 'type': 'tdback', 'class': 'content', 'z': 0, 'part': part,
         'x': r[0], 'y': r[1], 'w': r[2] - r[0], 'h': r[3] - r[1], 'conn': 0, 'holes': holes}
    if part == 'L':
        d.update({'tab': TAB, 'rules': RULES, 'panelMask': MASK})
    return d


# --- text, in the SPEC's own numbers ------------------------------------------------------------------------------------
# Baselines of the texts the mockup centres on their INK (tools/twin-dial/mockup/mockup.py ctext): the baseline that puts
# the ink's centre where the mockup has it, from the face's own ink box of the mockup's example string, rounded. Frozen:
# they are what the owner approved.
BASE = {'time': 404, 'weekday': 460, 'date': 519, 'speed': 441, 'title': 281}
# SPEC-R3 2.7, the tachometer's hub (centre (380, 400), R 300; every baseline puts the ink's centre where the SPEC has it, from the
# atlases' own ink: td_big caps 64 px above the baseline, td_prog 17, td_label 15):
#   gear (0, 0) R, cap 0.222 R = the digital speed's size: baseline 400 + 64 / 2 = 432, td_big, a 164 px box (two figure pitches of 82)
#   drive programme (0, +0.209) R = y 463, td_prog (Saira 24): baseline 463 + 17 / 2 = 471
#   READY (0, -0.29) R = y 313, td_label (Saira 22), green: baseline 313 + 15 / 2 = 321
HUB = {'gear': 432, 'program': 471, 'ready': 321}


ICON_Y = 147           # the icon boxes' centre line: K2's approved mockups (ICON_Y 147: the pump's ink 133-167, the warning triangle's 126-165 in the bar 127-172). The spec's
                       # "centred at y 143" is the round 2 box centre of a 38 px box; 36 px of ink centred on 143 would stand 1.5 px above the bar (reported)
ICON_BOX = 46          # SPEC-R3 3.1 "icons 36 px" is the INK height (SF: the references' 36 px against ours 29, the ink of the 38-box drawings); the
                       # drawings' ink is ~0.79 of their box, so the box is 46 (K2's mockup: ICON_BOX 46); B6's slot table says "tab 36" (a box): reported
TAB_FONT = 'td_tabs' if os.path.exists(os.path.join(FONTS, 'td_tabs.json')) else 'td_tab'      # SPEC-R3 7: tab text Noto 34 (B6's td_tabs); Noto 33 (td_tab) until it is baked


def _ink_fractions():
    """{icon name: (cx, cy)}: the centre of each tab-slot icon's INK in its box, as a fraction of the box (apps/twin_dial/hud/icons/icons.json:
    package A1 / B6's slot table), so an icon's ink - not its box - is what lands on the spec's centre."""
    p = os.path.join(ROOT, 'apps', 'twin_dial', 'hud', 'icons', 'icons.json')
    out = {}
    if os.path.exists(p):
        for it in json.load(open(p))['items']:
            if it['slot'] == 'tab':
                b = it['box']
                out[it['name']] = ((b[0] + b[2]) / 2.0 / it['w'], (b[1] + b[3]) / 2.0 / it['h'], b[0] / float(it['w']))
    return out


def tabs():
    """SPEC-R3 3.1 / 3.3 (package B2): the tab bar's contents. Icons 36 px of ink (a 46 px box centred at y 147, the approved mockups'), text baseline
    156 (Noto 34, cap 24). Tab 1: the pump's ink starts 18 px from the bar's left end (x 636), then the range and its unit. Tab 2: the
    warning icon, white or in the severity colour (shared/twin_tabs.js). Tab 3: ONE live widget that paints the source icon and its text
    centred as one group (icon only until the media probe has shown the field). Tab 4 / 5: the phone and navigation icons. No icon is
    ever dimmed, the state is the icon's variant. A live icon's box is placed from its PLAIN icon's ink, so a variant never moves it."""
    S, fr = ICON_BOX, _ink_fractions()
    def tab_icon(id, name, cx, live, left=None):
        f = fr.get(name, (0.5, 0.5, 0.0))
        x = (left - f[2] * S) if left is not None else (cx - f[0] * S)
        y = ICON_Y - S / 2.0
        return {'id': id, 'type': 'icon', 'icon': name, 'z': 5, 'x': int(round(x)), 'y': int(round(y)), 'w': S, 'h': S, 'color': 'fg', 'conn': 1, 'tdLive': live}
    W = [tab_icon('tab_range_i', 'td_fuel', None, 'fixed', left=636)]
    # the range value, then its unit 3 px after the value's widest form ("888"). The value's box starts where the icon's box ends: two
    # boxes that overlap cost the engine a sheet
    vx = W[0]['x'] + S
    vw = width(TAB_FONT, '888')
    W += [text('tab_range_v', vx + vw, 156, vw, '{{td:rangeTab}}', TAB_FONT, 'fg', 'right', 1, below=3),
          text('tab_range_u', vx + vw + 3, 156, width('td_u19', '\u043a\u043c') + 3, '\u043a\u043c', 'td_u19', 'fg', 'left', 1, below=3)]
    cell = lambda a, b: (a + b) / 2.0
    W += [tab_icon('tab_warn_i', 'cc_warn', cell(TAB['seps'][0], TAB['seps'][1]), 'warn')]
    # tab 3 (848-1168): one widget, 300 px wide inside its cell, as tall as an icon box; the media text's baseline is 156
    mw = TAB['seps'][2] - TAB['seps'][1] - 20
    my = int(round(ICON_Y - S / 2.0))
    W += [{'id': 'tab_media', 'type': 'icon', 'icon': 'td_radio', 'z': 5, 'x': TAB['seps'][1] + 10, 'y': my, 'w': mw, 'h': S,
           'color': 'fg', 'conn': 1, 'tdLive': 'media', 'font': TAB_FONT, 'textBase': 156 - my, 'iconBox': S},
          tab_icon('tab_phone_i', 'td_phone', cell(TAB['seps'][2], TAB['seps'][3]), 'phone'),
          tab_icon('tab_nav_i', 'td_nav', cell(TAB['seps'][3], TAB['rect'][2]), 'nav')]
    return W


# --- the centre pages (SPEC-R3 section 4; package B4) ---------------------------------------------------------------
# ONE image layer ("tdpage", painted in one go by shared/twin_pages.js) holds every page of every tab; a page is a list of
# items: texts by BASELINE, pictograms by centre, bars, a progress line. Geometry is here; values are tokens
# ({{td:pg...}}, shared/twin_pages.js token()), so a page change is a repaint and nothing is rebuilt. The grammar (SF, the
# mockups of round 3): title baseline 281, rule y 295-297.5 (tdback), body 300-565, a meta line at 326 (right edge 1190),
# a footer at 565. Fonts are named by role (twin_pages.js FONTS: B6 bakes the sizes). Colours are theme roles: fg white,
# dim 227, grey 111, hot red, ready green, amber.
PAGE = [729, 248, 462, 347]                                 # the layer's rect [x, y, w, h]: the title (ink from y 250) to y 595
MID_X = MID
BODY_R = 1190                                               # the meta line's right edge (SF: 1189.9)


def T(id, x, b, f, s, c='fg', al='c', mw=None, if_=None):
    d = {'k': 't', 'id': id, 'x': x, 'b': b, 'f': f, 's': s, 'c': c, 'al': al}
    if mw:
        d['mw'] = mw
    if if_:
        d['if'] = if_
    return d


def I(id, n, cx, cy, sz, c='fg'):
    return {'k': 'i', 'id': id, 'n': n, 'cx': cx, 'cy': cy, 'sz': sz, 'c': c}


def title():
    return T('title', MID_X, BASE['title'], 'title', '{{td:pgTitle}}', mw=440)


def meta(tok):
    return T('meta', BODY_R, 326, 'n31', tok, 'dim', 'r')


def page_items():
    P = {}
    P['clock'] = [title(), T('time', MID_X, BASE['time'], 'clock', '{{td:pgTime}}'),
                  T('weekday', MID_X, BASE['weekday'], 'n39', '{{td:pgWeekday}}'), T('date', MID_X, BASE['date'], 'n39', '{{td:pgDate}}')]
    # trip (02's table grammar): rows at 384 / 455, a pictogram 36 px (its box 46) at x 729, number columns right at 896 / 1109,
    # the unit 10 px after, the consumption's unit a stacked fraction, the footer at 565
    r1, r2 = 384, 455
    P['trip'] = [title(), meta('{{td:pgTripMeta}}'),
                 I('i1', '{{td:pgIconFuel}}', 752, r1 - 15, 46), T('cons', 896, r1, 'n42', '{{td:pgTripCons}}', 'fg', 'r'),
                 {'k': 'frac', 'id': 'cons_u', 'x': 906, 'b': r1, 'top': 'л', 'bot': '100 км', 'dt': -17, 'dr': -14, 'db': 3, 'c': 'fg'},
                 T('speed', 1109, r1, 'n42', '{{td:pgTripSpeed}}', 'fg', 'r'), T('speed_u', 1116, r1, 'u21', 'км/год', 'fg', 'l'),
                 I('i2', '{{td:pgIconRoad}}', 752, r2 - 15, 46), T('way', 896, r2, 'n42', '{{td:pgTripWay}}', 'fg', 'r'), T('way_u', 906, r2, 'u21', 'км', 'fg', 'l'),
                 T('foot', MID_X, 565, 'n31', '{{td:pgTripFooter}}', 'dim', 'c', 440)]
    # technical data (SV V1): four rows, label Noto 31 at x 745, value Noto 40 right at 1150, the unit 6 px after, a bar x 745-1175
    # 12 px under the baseline (6 px thick); the outside temperature has no bar. "бар" (37 px) starts 2 px after the value instead of 6
    # (x 1152): the layer ends at x 1191, and SPEC-R3's 6 px would clip its last letter
    tech = [title()]
    for i, (base, label) in enumerate(zip((352, 418, 484, 550), ('Олива', 'Охолодження', 'Наддув', 'Зовні'))):
        tech += [T('l%d' % i, 745, base, 'n31', label, 'dim', 'l'), T('v%d' % i, 1150, base, 'n40', '{{td:pgTechV%d}}' % i, '{{td:pgTechC%d}}' % i, 'r'),
                 T('u%d' % i, 1156 if i != 2 else 1152, base, 'u21', '{{td:pgTechU%d}}' % i, '{{td:pgTechC%d}}' % i, 'l')]
        if i < 3:
            tech.append({'k': 'bar', 'id': 'b%d' % i, 'x0': 745, 'x1': 1175, 'y': base + 12, 'h': 6, 'v': '{{td:pgTechF%d}}' % i, 'w': '{{td:pgTechW%d}}' % i, 'c': 'fg'})
    P['tech'] = tech
    # tyres (SV V1b, dark): our own top view at (960, 430), the pressure and its unit centred at each corner, the temperature under it
    ty = [title(), {'k': 'car', 'id': 'car', 'cx': 960, 'cy': 430, 'w': 110, 'h': 230, 'c': 'dim'}]
    for i, (cx, cy) in enumerate(((800, 360), (1120, 360), (800, 505), (1120, 505))):
        ty += [{'k': 'g', 'id': 'p%d' % i, 'cx': cx, 'b': cy, 'c': 'fg', 'parts': [{'s': '{{td:pgTyreP%d}}' % i, 'f': 'n40', 'c': '{{td:pgTyreC%d}}' % i},
                                                                                    {'s': 'бар', 'f': 'u21', 'gap': 4, 'c': '{{td:pgTyreC%d}}' % i}]},
               T('t%d' % i, cx, cy + 40, 'n31', '{{td:pgTyreT%d}}' % i, 'grey', 'c')]
    P['tyres'] = ty
    # tab 2: the title only (the card, the rows and the pointer page are twin_cc.js's sheet)
    P['msg'] = [title()]
    # tab 3 (SM): the certain page (the source pictogram, nothing else); radio and now playing are dark (config.pages.media)
    P['media'] = [title(), I('src', '{{td:pgSrcIcon}}', MID_X, 392, 66)]
    P['radio'] = [title(), meta('{{td:pgMediaMeta}}'), I('ic', '{{td:pgIconRadio}}', MID_X, 344, 54),
                  T('station', MID_X, 424, 'title', '{{td:pgStation}}', 'fg', 'c', 436), T('text', MID_X, 471, 'n29', '{{td:pgRadioText}}', 'dim', 'c', 436),
                  T('foot', MID_X, 565, 'n29', '{{td:pgRadioFoot}}', 'dim', 'c', 436)]
    P['track'] = [title(), meta('{{td:pgMediaMeta}}'),
                  T('name', MID_X, 400, 'title', '{{td:pgTrackTitle}}', 'fg', 'c', 436), T('artist', MID_X, 444, 'n31', '{{td:pgTrackArtist}}', 'dim', 'c', 436),
                  {'k': 'prog', 'id': 'prog', 'x0': 800, 'x1': 1120, 'y': 500, 'v': '{{td:pgTrackFrac}}'},
                  T('el', 800, 530, 'u21', '{{td:pgTrackEl}}', 'dim', 'l'), T('tot', 1120, 530, 'u21', '{{td:pgTrackTot}}', 'dim', 'r'),
                  T('no', MID_X, 530, 'u21', '{{td:pgTrackNo}}', 'dim', 'c'), I('mute', '{{td:pgMute}}', MID_X, 560, 26, 'grey')]
    # tab 4 (SP): the idle page (certain: the pictogram and "Немає даних" until the probe); the call card is dark (config.pages.phone)
    P['phone'] = [title(), I('ic', '{{td:pgIconPhone}}', MID_X, 344, 54),
                  T('l1', MID_X, 424, 'n39', '{{td:pgPhoneLine1}}', 'fg', 'c', 436), T('l2', MID_X, 471, 'n29', '{{td:pgPhoneLine2}}', 'dim', 'c', 436)]
    P['call'] = [title(), meta('{{td:pgCallPath}}'), I('ring', '{{td:pgCallIcon}}', MID_X, 372, 66, 'ready'),
                 T('timer', MID_X, 410, 's72', '{{td:pgCallTimer}}', 'fg', 'c'), T('who', MID_X, 478, 'n39', '{{td:pgCallWho}}', 'fg', 'c', 436),
                 I('mic', '{{td:pgCallMic}}', MID_X, 540, 30, 'grey')]
    # tab 5 (SN): the map window (a road bar at its foot only), the guidance page (dark), the fallback pages
    P['map'] = [{'k': 'r', 'id': 'bar', 'x0': 760, 'y0': 556, 'x1': 1160, 'y1': 594, 'c': 'bg', 'a': 0.6, 'if': '{{td:pgRoadBar}}'},
                T('road', MID_X, 588, 'n31', '{{td:pgRoadBar}}', 'fg', 'c', 380)]
    P['guide'] = [title(), I('arrow', '{{td:pgGuideIcon}}', 830, 378, 120), T('exit', 830, 386, 'u21', '{{td:pgGuideExit}}'),
                  {'k': 'g', 'id': 'dist', 'x': 915, 'al': 'l', 'b': 410, 'c': 'fg', 'parts': [{'s': '{{td:pgGuideDist}}', 'f': 's72'}, {'s': '{{td:pgGuideUnit}}', 'f': 'n29', 'gap': 8}]},
                  T('road', 770, 480, 'n33', '{{td:pgGuideRoad}}', 'fg', 'l', 410),
                  {'k': 'lanes', 'id': 'lanes', 'cx': MID_X, 'cy': 515, 'pitch': 34, 'sz': 30},
                  T('foot', MID_X, 560, 'n29', '{{td:pgGuideFoot}}', 'dim', 'c', 436)]
    P['calc'] = [title(), T('msg', MID_X, 400, 'n33', '{{td:pgCalc}}')]
    P['road'] = [title(), T('road', MID_X, 400, 'title', '{{td:pgRoad}}', 'fg', 'c', 436), T('sub', MID_X, 452, 'n29', '{{td:pgNavSub}}', 'dim')]
    P['none'] = [title(), T('sub', MID_X, 400, 'n29', 'Маршрут не прокладено', 'dim')]
    return P


def pages_widget():
    """The centre's one image layer (shared/twin_pages.js). "own": a layer of its own (not packed into a sheet), conn 1, z 6."""
    items = page_items()
    return {'id': 'c_page', 'type': 'tdpage', 'class': 'content', 'z': 6, 'x': PAGE[0], 'y': PAGE[1], 'w': PAGE[2], 'h': PAGE[3], 'conn': 1, 'own': True,
            'pages': {k: {'items': v} for k, v in items.items()}}


def hubs():
    """SPEC 5.1 / 5.2: the hubs. The units "1/хв x 1000" and "км/год" are in the faces (package A2 bakes them, SPEC 13.1), OFF too."""
    W = [text('ready', CT[0], HUB['ready'], 100, '{{td:ready}}', 'td_label', 'ready', 'center', 1, 7, below=3),
         text('program', CT[0], HUB['program'], 150, '{{td:program}}', 'td_prog', 'fg', 'center', 1, 7, below=3)]
    return W


def gpu_texts():
    """The digital speed and the gear: GPU texts (hud.js "gpu": the atlas text layers, one uniform per change)."""
    return [text('speed', CS[0], BASE['speed'], 260, '{{td:speed}}', 'td_big', 'fg', 'center', 0, 5, gpu=True, maxLen=3, below=3),
            text('gear', CT[0], HUB['gear'], 164, '{{td:gear}}', 'td_big', 'fg', 'center', 1, 5, gpu=True, maxLen=2, below=3)]


def row():
    """SPEC 6.3 / SPEC-R3 3.5: the bottom row. Rule y 613 (a tdback rule), baselines 656 and 703, numbers Noto 40 right-aligned at x 846
    and 1153, units Noto 21 five px after, on the number's baseline. A "cc:" layer: its ink steps aside while BMW's panel
    is open (B3's toggle "cc:row": drawn while the window is shut, so also while our card in the centre covers the panel;
    SPEC-R3 5.4). It is on connection 0, the window's own (SPEC-R3 5.5; B3, merged with B2's tokens by the integration). Slots: L1 the odometer, L2 the
    clock, R1 the trip distance (the range until probe P4), R2 the outside temperature - on tab 1. On every other tab the row is ONE
    line (package B2): the clock left and the temperature right on the upper baseline 656, the lower line empty (the sheet stays
    opaque over BMW's panel footprint). The layout carries both; the tokens rowL1 .. rowR2u answer by tab (shared/twin_tokens.js)."""
    z, tg = 8, 'cc:row'
    L, Rr = 846, 1153
    nw = lambda *worst: max(width('td_row', t) for t in worst) + 1          # a number's box: its worst text (the odometer "999 999")
    uw = lambda *worst: max(width('td_u21', t) for t in worst) + 1
    km, c = '\u043a\u043c', '\u00b0C'
    W = [text('row_l1', L, 656, nw('999\u2009999', '00:00', '\u2013\u2013:\u2013\u2013'), '{{td:rowL1}}', 'td_row', 'fg', 'right', 0, z, below=3, toggle=tg),
         text('row_l1u', L + 5, 656, uw(km), '{{td:rowL1u}}', 'td_u21', 'fg', 'left', 0, z, below=3, toggle=tg),
         text('row_l2', L, 703, nw('\u2013\u2013:\u2013\u2013', '00:00'), '{{td:rowL2}}', 'td_row', 'fg', 'right', 0, z, below=3, toggle=tg),
         text('row_r1', Rr, 656, nw('9999.9', '-30.5', '+88.8'), '{{td:rowR1}}', 'td_row', 'fg', 'right', 0, z, below=3, toggle=tg),
         text('row_r1u', Rr + 5, 656, uw(km, c), '{{td:rowR1u}}', 'td_u21', 'fg', 'left', 0, z, below=3, toggle=tg),
         text('row_r2', Rr, 703, nw('-30.5', '+88.8'), '{{td:rowR2}}', 'td_row', 'fg', 'right', 0, z, below=3, toggle=tg),
         text('row_r2u', Rr + 5, 703, uw(c), '{{td:rowR2u}}', 'td_u21', 'fg', 'left', 0, z, below=3, toggle=tg)]
    return W


def tab2_sheet():
    """SPEC-R3 5.1: tab 2's body, ONE image sheet [729, 298, 1191, 568] (462 x 270) on connection 2, above every centre layer,
    painted in one go by shared/twin_cc.js paintSheet: the card (symbol cell, Noto 42 headline up to 3 lines, the counter), the
    rows, the pointer and the empty page. Transparent while another tab is selected. The title "Повідомлення" is the ordinary
    text widget c_title (token cTitle). The old bottom plate is gone."""
    return [{'id': 'msg_sheet', 'type': 'ccsheet', 'z': 9, 'x': 729, 'y': 298, 'w': 462, 'h': 270,
             'font': 'td_msg', 'counterFont': 'td_cnt', 'rowFont': 'td_tab', 'textFont': 'td_val', 'conn': 2}]


def limit_seam():
    """SPEC-R3 8 / 9 (package B5; design/twin-dial/b5/limit.json): the speed-limit sign's sheet and the cruise readout's. The
    sign is a "tdsign" image sheet on connection 2, painted by shared/twin_limit.js; it carries NO "cc:" toggle, so it
    stays while BMW's fallback window is open. The readout is built only while config.cruise is set ("tl:cruise:<place>");
    one widget per place, only the one named by config.cruise.place is made. Their own z each, so the engine never packs
    them into a sheet with anything else (one sheet each: 0.03 MiB, 0.04 MiB)."""
    B5 = json.load(open(os.path.join(HERE, 'twin-dial', 'b5', 'limit.json')))
    s = B5['sign']
    W = [{'id': 'limit_sign', 'type': 'tdsign', 'z': s['z'], 'x': s['sheet'][0], 'y': s['sheet'][1], 'w': s['sheet'][2], 'h': s['sheet'][3], 'conn': s['conn']}]
    for place in ('C1', 'C2'):
        c = B5['cruise'][place]
        W.append({'id': 'cruise_' + place.lower(), 'type': 'tdcru', 'z': B5['cruise']['z'], 'x': c['sheet'][0], 'y': c['sheet'][1], 'w': c['sheet'][2], 'h': c['sheet'][3],
                  'conn': B5['cruise']['conn'], 'place': place, 'toggle': 'tl:cruise:' + place})
    return W


def widgets():
    W = [tdback('L'), tdback('RT'), tdback('RB'), tdial('tach'), tdial('speed')]
    W += gpu_texts() + tabs() + [pages_widget()] + hubs() + row() + tab2_sheet() + limit_seam()
    return W


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'apps', 'twin_dial', 'hud', 'layouts')
    lay = {'schemaVersion': 2, 'name': 'Twin Dial', 'packWaste': 8, 'theme': 'twin',
           '_about': 'Twin Dial (docs/twin-dial/SPEC.md), generated by design/gen_twin.py: edit that and regenerate.',
           'widgets': widgets()}
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'twin.json'), 'w') as f:
        json.dump(lay, f, indent=2, ensure_ascii=False)
        f.write('\n')
    src = sorted(set(SOURCE.values()))
    print('twin.json: %d widgets, fonts from %s' % (len(lay['widgets']), ' + '.join(src)))


if __name__ == '__main__':
    main()
