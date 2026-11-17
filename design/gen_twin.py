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
  conn 0  bg_l, bg_rt, bg_rb (tdback), dial_tach, dial_speed (tdial), speed (the digital speed on the GPU)
  conn 1  gear (GPU), the tab bar's sheet, the centre pages' sheets, the left hub's labels
  conn 2  the bottom row's sheet and the check-control plate's sheet (package D: both are "cc:" layers)
Package D owns the plate's content and the "cc:" logic; this file lays out the seam (plate_seam()).
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
TAB = {'rect': [618, 127, 1302, 172], 'seps': [744, 812, 1168, 1237], 'rule': [171.2, 172.7], 'ramp': [0.002, 0.16], 'highlight': [744, 812]}
MASK = {'tex': 'panel_mask', 'x': 694, 'y': 592, 'w': 536, 'h': 112}           # package A2: 536 x 112 R8 at [694, 592, 1230, 704]
RULES = [
    {'x0': 741, 'y0': 295.2, 'x1': 1180, 'y1': 296.7, 'role': 'rule'},         # SPEC 6.2: the centre title's rule, y 296
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
BASE = {'time': 404, 'weekday': 460, 'date': 519, 'footer': 528, 'speed': 441, 'gear': 539, 'program': 576, 'ready': 348, 'title': 282}


def tabs():
    """SPEC 6.1: the tab bar's contents. Icon 38 x 38 centred at y 143, text baseline 156."""
    W = [icon('tab_range_i', 'td_fuel', 636, 143, 38)]
    # the range value, then its unit 3 px after the value's widest form ("888"). The value's box starts at x 655, the icon
    # box's right edge (the ink at 654 is the box's own padding): two boxes that overlap cost the engine a sheet
    vw = width('td_body', '888')
    W += [text('tab_range_v', 654 + vw, 156, vw - 1, '{{td:rangeTab}}', 'td_body', 'fg', 'right', 1, below=3),
          text('tab_range_u', 654 + vw + 3, 156, width('td_u19', 'км') + 3, 'км', 'td_u19', 'fg', 'left', 1, below=3)]
    W += [icon('tab_warn_i', 'cc_warn', 778, 143, 38, live='warn'),
          icon('tab_media_i', 'td_radio', 905, 143, 38),
          # SPEC 6.1: the media text from x 925, clipped at x 1160; empty (icon only) until probe P8 has shown the field
          text('tab_media_t', 925, 156, 235, '{{td:media}}', 'td_tab', 'fg', 'left', 1),
          icon('tab_phone_i', 'td_phone', 1202, 143, 38, live='phone'),
          icon('tab_nav_i', 'td_nav', 1270, 143, 38, live='nav')]
    return W


def centre():
    """SPEC 6.2: the two centre pages. Both pages' texts are always in the layout; a token answers "" while its page is not
    the one showing (shared/twin_tokens.js), so a page change repaints text boxes and rebuilds nothing. A text of the
    clock page and one of the trip page overlap, so the engine puts the trip page in a sheet of its own (2 sheets)."""
    z = 6
    W = [text('c_title', MID, BASE['title'], 440, '{{td:cTitle}}', 'td_title', 'fg', 'center', 1, z)]
    # page "clock": the time in Saira 92, proportional digits (td_clock; the digital speed's td_big is tabular for the GPU), the weekday and the date in Noto 39
    W += [text('c_time', MID, BASE['time'], 360, '{{td:cTime}}', 'td_clock', 'fg', 'center', 1, z, below=3),
          text('c_weekday', MID, BASE['weekday'], 300, '{{td:cWeekday}}', 'td_val', 'fg', 'center', 1, z),
          text('c_date', MID, BASE['date'], 300, '{{td:cDate}}', 'td_val', 'fg', 'center', 1, z, below=3)]
    # page "trip": two rows, numbers right-aligned at x 905 and 1105, units 6 px after, baselines 362 and 430. A box is as
    # wide as its worst text (so the boxes of one row do not overlap: an overlap costs a sheet); every box's ink is at
    # the SPEC's place whatever the box's width
    rows = ((362, ('{{td:tConsAvg}}', 'ø 99.9', '{{td:tConsU}}', 'л/100 км'), ('{{td:tSpeedAvg}}', 'ø 999', '{{td:tSpeedU}}', 'км/год')),
            (430, ('{{td:tDist}}', '999.9', '{{td:tDistU}}', 'км'), ('{{td:tTime}}', '99:59', '{{td:tTimeU}}', 'год')))
    for n, (base, a, b) in enumerate(rows, 1):
        for k, (xr, (tok, worst, utok, ustr)) in enumerate(((905, a), (1105, b))):
            vw = width('td_val', worst) + 1
            uw = width('td_u21', ustr) + 1
            W += [text('t%d_%s' % (n, 'ab'[k]), xr, base, vw, tok, 'td_val', 'fg', 'right', 1, z, below=3),
                  text('t%d_%su' % (n, 'ab'[k]), xr + 6, base, uw, utok, 'td_u21', 'fg', 'left', 1, z, below=7)]
    W.append(text('t_from', MID, BASE['footer'], 440, '{{td:tFrom}}', 'td_body', 'dim', 'center', 1, z))
    return W


def hubs():
    """SPEC 5.1 / 5.2: the hubs. The units "1/хв x 1000" and "км/год" are in the faces (package A2 bakes them, SPEC 13.1), OFF too."""
    W = [text('ready', CT[0], BASE['ready'], 100, '{{td:ready}}', 'td_label', 'ready', 'center', 1, 7, below=3),
         text('program', CT[0] + round(0.02 * R), BASE['program'], 140, '{{td:program}}', 'td_label', 'fg', 'center', 1, 7, below=3)]
    return W


def gpu_texts():
    """The digital speed and the gear: GPU texts (hud.js "gpu": the atlas text layers, one uniform per change)."""
    return [text('speed', CS[0], BASE['speed'], 260, '{{td:speed}}', 'td_big', 'fg', 'center', 0, 5, gpu=True, maxLen=3, below=3),
            text('gear', CT[0] - round(0.02 * R), BASE['gear'], 120, '{{td:gear}}', 'td_gear', 'fg', 'center', 1, 5, gpu=True, maxLen=2, below=3)]


def row():
    """SPEC 6.3: the bottom row. Rule y 613 (a tdback rule), baselines 656 and 703, numbers Noto 40 right-aligned at x 846
    and 1153, units Noto 21 five px after, on the number's baseline. A "cc:" layer: it steps aside while BMW's panel or
    our plate shows (package D refines the toggle; "!cc:open" is the engine's own today). Slots: L1 the odometer, L2 the
    clock, R1 the trip distance (the range until probe P4), R2 the outside temperature."""
    z, tg = 8, '!cc:open'
    L, Rr = 846, 1153
    nw = lambda *worst: max(width('td_row', t) for t in worst) + 1          # a number's box: its worst text (the odometer "999 999")
    W = [text('row_l1', L, 656, nw('999\u2009999'), '{{td:odo}}', 'td_row', 'fg', 'right', 2, z, below=3, toggle=tg),
         text('row_l1u', L + 5, 656, width('td_u21', 'км') + 1, 'км', 'td_u21', 'fg', 'left', 2, z, below=3, toggle=tg),
         text('row_l2', L, 703, nw('––:––', '00:00'), '{{td:clock}}', 'td_row', 'fg', 'right', 2, z, below=3, toggle=tg),
         text('row_r1', Rr, 656, nw('9999.9'), '{{td:r1}}', 'td_row', 'fg', 'right', 2, z, below=3, toggle=tg),
         text('row_r1u', Rr + 5, 656, width('td_u21', 'км') + 1, 'км', 'td_u21', 'fg', 'left', 2, z, below=3, toggle=tg),
         text('row_r2', Rr, 703, nw('-30.5', '+88.8'), '{{td:ambient}}', 'td_row', 'fg', 'right', 2, z, below=3, toggle=tg),
         text('row_r2u', Rr + 5, 703, width('td_u21', '°C') + 1, '°C', 'td_u21', 'fg', 'left', 2, z, below=3, toggle=tg)]
    return W


def plate_seam():
    """Package D's seam (SPEC 8.1): our message's plate, [694.5, 592, 1230, 720], one "cc:" sheet on connection 2 above the
    bottom row. C lays out only the headline's first line as a placeholder, so the layer exists in the budget; D replaces
    it with the symbol cell, the two-line headline and the counter in ONE paint (package X's "ccLine")."""
    return [text('plate_head', 783, 680, 441, '{{ccHead}}', 'td_msg', 'fg', 'left', 2, 9, toggle='cc:ours')]


def widgets():
    W = [tdback('L'), tdback('RT'), tdback('RB'), tdial('tach'), tdial('speed')]
    W += gpu_texts() + tabs() + centre() + hubs() + row() + plate_seam()
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
