#!/usr/bin/env python3
"""Bake the HUD's bitmap font atlases from the Barlow TTFs in tools/fonts-src/.

    UV_CACHE_DIR=... uv run --no-project --with pillow python tools/bake_fonts.py [app_id ...]

Runs on the Mac only (needs Pillow). The car never rasterizes fonts: it blits
these pre-drawn glyphs (shared/hud_text.js). Each app has its own set (FONTS below); output per
font, in apps/<app_id>/hud/fonts/<name>.json: the metrics plus the atlas as
one alpha byte per pixel (coverage), base64 in "alpha". JSON because the kit's
build packs the app's data folders into hud.pack, which holds JSON only, and
because then the car needs no PNG decoder. Barlow is SIL OFL 1.1; the licence
ships in each app's NOTICE.

Metrics: every glyph cell is the same height, from the highest ink to the lowest
ink across the font's glyph set, so a widget's y is the top of its tallest
character. `ox` shifts a cell from the pen position (ink overhang), `advance`
moves the pen. Digits get one shared advance (tabular), so a changing number
doesn't shift sideways.
"""
import base64, json, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'fonts-src')
APPS = os.path.join(HERE, '..', 'apps')

UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
DIGITS = '0123456789'
LOWER = 'abcdefghijklmnopqrstuvwxyz'
# HUD Widgets, fitted to the part of the 800x480 HUD the driver can see (485x278 from the Nov 5 2026 grid
# photo; 560x280 since Nov 9, the sizes stayed): hero 140 -> 96, big 42 -> 34, mid 30 -> 24; label and small stay, BMW's own "mph" is that size.
HUD_FONTS = [
    # name, file, px size, characters
    ('hero', 'BarlowSemiCondensed-SemiBold.ttf', 96, DIGITS + 'PRND-'),
    ('big', 'BarlowSemiCondensed-Medium.ttf', 34, DIGITS + ':.-° PRNDSM'),
    ('mid', 'BarlowSemiCondensed-Medium.ttf', 24, DIGITS + ':.-° ' + UPPER),
    ('label', 'Barlow-Medium.ttf', 15, UPPER + DIGITS + '/.:-°%>· '),
    ('small', 'Barlow-Medium.ttf', 13, UPPER + DIGITS + '/.:-°%>· '),
    # Retro: seven-segment digits (DSEG7 Classic, SIL OFL; the unlit 8s behind are the same font in "track")
    ('d7_hero', 'DSEG7Classic-Bold.ttf', 76, DIGITS + 'PRN-', 0, None, {'R': 'r', 'N': 'n'}),   # r and n: seven segments can't draw R or N
    ('d7_mid', 'DSEG7Classic-Bold.ttf', 26, DIGITS + '-.:'),
]
# --- package F (strip, 2026-11-16; docs/strip/F-REPORT.md): the car's own words, in Ukrainian ---
# The cluster runs in Ukrainian, and the road label and the check-control message are the car's text, so every font
# that may draw them carries the whole Ukrainian alphabet in both cases, the apostrophe forms, the guillemets and the
# other quotes, the dashes, the number sign and the plain punctuation a message or a street name holds. A character
# still missing makes the element fall back to BMW's (shared/hud.js _missingGlyphs; never a replacement glyph: a
# warning with a hole in it is not "our text for it on the screen"). Roboto (tools/fonts-src, SIL OFL) has all of it
# but U+02BC, the modifier-letter apostrophe Ukrainian spelling prefers: it is drawn with U+2019's glyph, the same
# shape (CAR_SUBS). CAR_WIDE is the wider option priced in the report (Russian and Belarusian letters, the Latin
# accents of European street names); off, it is not baked.
UA_UPPER = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ'
UA_LOWER = 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя'
CAR_PUNCT = ",;!?()'\"%&#*=_’ʼ‘«»„“”–—№…"
CAR_SUBS = {'ʼ': '’'}
CAR_WIDE = False
WIDE = 'ЁЪЫЭЎёъыэў' + 'ÄÖÜßäöüÀÂÇÉÈÊËÎÏÔÙÛàâçéèêëîïôùûÁÍÓÚÑáíóúñĄĆĘŁŃŚŹŻąćęłńśźżČĎĚŇŘŠŤŮŽčďěňřšťůž'
CAR_TEXT = UA_UPPER + UA_LOWER + CAR_PUNCT + (WIDE if CAR_WIDE else '')
# --- end package F ---
# Cluster Themes, 1920x720 LCD. GT3: the race-dash look, Barlow Condensed.
CLUSTER_FONTS = [
    ('gear', 'BarlowCondensed-Bold.ttf', 330, DIGITS + 'PRND-'),
    ('big', 'BarlowCondensed-Bold.ttf', 124, DIGITS + '.:-'),   # 124: "20.3 PSI" fits a 280 px box beside the hood; ':' for a clock in a readout slot
    ('value', 'BarlowCondensed-Bold.ttf', 92, DIGITS + '.:- PRND°', 0, None, None, '°'),   # °: a readout slot showing a temperature (tucked: the cell keeps its height)
    ('small', 'BarlowCondensed-Bold.ttf', 50, DIGITS + '.:-° '),
    ('unit', 'BarlowCondensed-SemiBold.ttf', 34, UPPER + DIGITS + '/°%>·.: -'),
    ('head', 'BarlowCondensed-SemiBold.ttf', 24, UPPER + DIGITS + '/°%>·.: -'),
    ('scale', 'BarlowCondensed-SemiBold.ttf', 30, DIGITS),
    ('badge', 'BarlowCondensed-SemiBold.ttf', 30, UPPER + LOWER + DIGITS + ' -'),   # the model badge (shared/badges.js)
    # M: the wide squared numbers (Michroma, SIL OFL) and Barlow for the small print
    ('m_num', 'Orbitron[wght].ttf', 36, DIGITS, 0, 'Black', {'0': 'O'}),
    ('m_gear', 'Orbitron[wght].ttf', 125, 'PRNDSM-' + DIGITS, 3, 'Black', {'0': 'O'}),
    ('m_speed', 'Orbitron[wght].ttf', 78, DIGITS + '-', 3, 'Black', {'0': 'O'}),
    ('m_gl', 'Orbitron[wght].ttf', 25, DIGITS + '/.-', 0, 'Black', {'0': 'O'}),
    ('m_val', 'Barlow-Medium.ttf', 54, DIGITS + ':+-.'),
    ('m_mid', 'Orbitron[wght].ttf', 34, DIGITS + ':+-.', 0, 'Bold', {'0': 'O'}),
    ('m_tyre', 'Orbitron[wght].ttf', 25, DIGITS + '.-', 0, 'Bold', {'0': 'O'}),
    ('m_unit', 'Barlow-Medium.ttf', 30, LOWER + UPPER + '°/-.'),
    ('m_label', 'Orbitron[wght].ttf', 20, UPPER + ' -', 0, 'Bold'),
    ('m_tiny', 'Barlow-Medium.ttf', 26, LOWER + DIGITS + 'CF./ -°'),
    ('m_badge', 'Barlow-Medium.ttf', 26, UPPER + LOWER + DIGITS + ' -'),
    # Sport: BMW Live Cockpit style, the wide numbers in Michroma like BMW's own
    ('s_scale', 'Michroma-Regular.ttf', 27, DIGITS, 1),
    ('s_speed', 'Michroma-Regular.ttf', 74, DIGITS + '-', 3),
    ('s_gear', 'Michroma-Regular.ttf', 70, DIGITS + 'PRNDSM-', 3),
    ('s_val', 'Michroma-Regular.ttf', 26, DIGITS + ':+-.', 1),
    ('s_unit', 'Barlow-Medium.ttf', 24, LOWER + UPPER + DIGITS + '°/-. '),
    ('s_label', 'BarlowSemiCondensed-SemiBold.ttf', 30, UPPER + DIGITS + ' .'),
    ('s_gl', 'Michroma-Regular.ttf', 21, DIGITS + '/', 1),
    # Minimal: one huge speed, the gear, small print
    ('n_speed', 'BarlowSemiCondensed-Medium.ttf', 260, DIGITS + '-'),
    ('n_gear', 'BarlowSemiCondensed-SemiBold.ttf', 110, DIGITS + 'PRNDSM-'),
    ('n_unit', 'Barlow-Medium.ttf', 34, LOWER + UPPER + '/'),
    # Roadster: dial numbers, readouts, the chrome gear
    ('r_num', 'BarlowSemiCondensed-SemiBold.ttf', 36, DIGITS),
    ('r_val', 'BarlowSemiCondensed-Medium.ttf', 58, DIGITS + '.:-+°'),
    ('r_gear', 'BarlowCondensed-Bold.ttf', 170, DIGITS + 'PRNDSM-'),
    ('r_label', 'BarlowSemiCondensed-SemiBold.ttf', 24, UPPER + LOWER + DIGITS + '/°%.: -'),
    # Drag: the 0-60 clock
    ('timer', 'BarlowCondensed-Bold.ttf', 220, DIGITS + '.-'),
    # Rally: the huge gear and the readouts in the arc
    ('y_gear', 'BarlowCondensed-Bold.ttf', 300, DIGITS + 'PRNDSM-'),
    ('y_val', 'BarlowCondensed-Bold.ttf', 76, DIGITS + '.:-+°', 0, None, None, '°'),
    # Retro 80s: seven-segment digits (DSEG7 Classic, SIL OFL; the unlit 8s behind are the same font in "track")
    ('d7_big', 'DSEG7Classic-Bold.ttf', 170, DIGITS + '-'),
    ('d7_val', 'DSEG7Classic-Bold.ttf', 60, DIGITS + '-.:'),
    ('d7_sm', 'DSEG7Classic-Bold.ttf', 42, DIGITS + '-.:'),
    ('d7_gear', 'DSEG7Classic-Bold.ttf', 190, DIGITS + 'PRN-', 0, None, {'R': 'r', 'N': 'n'}),   # r and n: seven segments can't draw R or N
    # Cruise: calm, light numbers
    ('c_speed', 'BarlowSemiCondensed-Medium.ttf', 150, DIGITS + '-'),
    ('c_val', 'BarlowSemiCondensed-Medium.ttf', 62, DIGITS + '.:-+°'),
]
# F30 Cluster's 6WB-style themes: Roboto variable (SIL OFL, tools/fonts-src/Roboto-OFL.txt) at width 87.5.
# Until 2026-11-15 these were Arimo, picked because Arimo is Helvetica-shaped and the 6WB's print was assumed
# to be. Measuring the 6WB references settled it the other way (docs/F30-FONT-SPEC.md): Arimo's "1" carries a
# foot serif and the 6WB's does not, and Arimo's figures are 50-60% too wide in the "1" and too round
# elsewhere - it ranked 17th, 17th and 11th of 22 free faces on the three runs with enough glyphs to rank on,
# while Roboto at width 87.5 ranked 1st, 1st and 3rd. Sizes below are the ones that keep each font's RENDERED
# height exactly what Arimo gave, so the layouts did not have to move; weights come from the measured
# stroke/cap of each text kind. The other fonts in apps/f30_cluster/hud/fonts are copies of Cluster Themes'
# (Barlow) - note Barlow has NO Cyrillic, so nothing the car supplies may be drawn in it.
F30_FONTS = [
    ('wb_spd', 'Roboto-wdth-wght.subset.ttf', 28, DIGITS + '.-', 0, [650, 87.5]),   # the speed scale's numbers, the range and consumption figures
    ('wb_rpm', 'Roboto-wdth-wght.subset.ttf', 43, DIGITS, 0, [650, 87.5]),          # the rev scale's numbers
    # package F (strip): wb_cap and wb_capb also draw the car's own words (the road label, the message), so both carry
    # CAR_TEXT. The taller cell this gives them does not move any text: design/gen_6wb.py places text by its baseline
    ('wb_cap', 'Roboto-wdth-wght.subset.ttf', 21, LOWER + UPPER + DIGITS + '/ .:+-°' + CAR_TEXT, 0, [650, 87.5], CAR_SUBS),   # km/h, 1/min x 1000, Time, OFF; the road label, the message
    ('wb_capb', 'Roboto-wdth-wght.subset.ttf', 21, UPPER + DIGITS + '/ ' + LOWER + '.:+-°' + CAR_TEXT, 0, [700, 87.5], CAR_SUBS),   # READY, 1/1; a message headline
    ('wb_gear', 'Roboto-wdth-wght.subset.ttf', 45, DIGITS + 'PRNDSM-', 0, [650, 87.5]),      # the gear in its box
    ('wb_val', 'Roboto-wdth-wght.subset.ttf', 36, DIGITS + ':+-.° kmCl/', 0, [650, 87.5]),   # the bottom row's values
    ('wb_mini', 'Roboto-wdth-wght.subset.ttf', 14, DIGITS + '/', 0, [650, 87.5]),            # the small gauges' 1/1 and 0
    # 6WB Dials + G20: our range, clock, temperature at BMW's places, its size (package F). Weight 500, not 650: this one stands in BMW's own row, so it takes the G20 spec's setting, not the F30's (docs/G20-DESIGN-SPEC.md 1.4).
    # Strip package F, 2026-11-16, from package T's measurement of photos 60-68 (bake/work/strip/pub/T/typography.json,
    # PROVISIONAL): wght 450, wdth 100 instead of [500, 87.5] - the same 43 px and the same figure height (31), the
    # tabular advance 24 (BMW 24.12; was 23) and the stem 4.47 (BMW 4.31; was 5.0). Same cell, same baseline: no box moves
    ('wb_row', 'Roboto-wdth-wght.subset.ttf', 43, DIGITS + ':+-.', 0, [450, 100]),
    ('wb_big', 'Roboto-wdth-wght.subset.ttf', 118, DIGITS + 'PRNDSM-', 0, [700, 87.5]),      # Sport: the speed and the gear in the discs
    # --- strip package F, 2026-11-16: the bottom row's own faces at BMW's sizes, from package T's measurement of the
    # stock strip (photos 60-68; bake/work/strip/pub/T/typography.json, PROVISIONAL). Baked so package X (and the lead)
    # can move the row's texts onto them; NO layout uses them yet, so they cost nothing but hud.pack bytes until then.
    # wb_cap (21 px, cap 15) draws the dial captions too, so it cannot simply grow to BMW's road label (cap 29.8).
    ('wb_road', 'Roboto-wdth-wght.subset.ttf', 42, LOWER + UPPER + DIGITS + ' ./:+-°' + CAR_TEXT, 0, [325, 90.625], CAR_SUBS),  # the road label: BMW cap 29.76, x 22.0, baseline 700.17, centred on 961.38
    ('wb_msg', 'Roboto-wdth-wght.subset.ttf', 35, LOWER + UPPER + DIGITS + ' ./:+-°' + CAR_TEXT, 0, [450, 87.5], CAR_SUBS),     # our message line: BMW cap 24.6-25.0, x 18.3-19.2; one line at baseline 669.23
    ('wb_rowu', 'Roboto-wdth-wght.subset.ttf', 34, 'kmiCF°l/h', 0, [300, 87.5]),                # the row's units (km, mi, °C, °F; T's set plus the i of mi): BMW's are smaller and lighter than wb_val (C 24.25 against 26)
    ('wb_lim', 'Roboto-wdth-wght.subset.ttf', 38, DIGITS, 0, [450, 87.5]),                      # our sign's limit (optional): BMW's digits 26.75 tall, stem 3.94 (wb_val: 26, 4.8)
    # --- end strip package F ---
    # G20 Comfort: Roboto (SIL OFL, tools/fonts-src/Roboto-OFL.txt) semi-condensed, the bench simulation's face (docs/G20SIM-REPORT.md)
    ('g20_spd', 'Roboto-wdth-wght.subset.ttf', 105, DIGITS, 0, [700, 87.5]),             # the digital speed
    ('g20_unit', 'Roboto-wdth-wght.subset.ttf', 27, 'km/h', 0, [600, 87.5]),          # its km/h
    ('g20_lab', 'Roboto-wdth-wght.subset.ttf', 34, '1/minx0', 0, [600, 87.5]),        # 1/min x1000
    # car3 J: the mode label ("COMFORT" / "PLUS") and the gear letter in the tacho's centre, as the stock layout
    # (photo 39: cap 22 px, COMFORT 142 px wide, strokes 3.8 px; the D 75 px tall, 53 wide, strokes 13.8)
    ('g20_mode', 'Roboto-wdth-wght.subset.ttf', 31.5, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ', 0, [500, 94]),
    ('g20_gear', 'Roboto-wdth-wght.subset.ttf', 105, 'PRNDSM-', 0, [650, 87.5]),
]
FONTS = {'idrive_hud_widgets': HUD_FONTS, 'cluster_themes': CLUSTER_FONTS, 'f30_cluster': F30_FONTS}
PAD = 2
ATLAS_W = 1024


def bake(out, name, file, size, chars, stroke=0, weight=None, subs=None, tuck=''):
    """stroke: px of extra weight round every glyph (Michroma has one weight). weight: a named instance of a
    variable font (Orbitron: Regular .. Black), for the M theme's squared BMW-style gear, speed and numbers.
    subs: {char: glyph drawn for it} (Orbitron's zero is slashed; the M8's is plain, so its O stands in).
    tuck: characters added to a font after layouts were built on its cell height (° on value / y_val, Nov 7 2026):
    they don't count towards the cell, and one that rises above it is drawn lower so its top meets the cell's."""
    font = ImageFont.truetype(os.path.join(SRC, file), size)
    if isinstance(weight, (list, tuple)): font.set_variation_by_axes(list(weight))     # [wght, wdth] of a variable font
    elif weight: font.set_variation_by_name(weight)
    subs = subs or {}
    glyph = lambda c: subs.get(c, c)
    ink = [c for c in chars if c != ' ']
    boxes = {c: font.getbbox(glyph(c), anchor='ls', stroke_width=stroke) for c in ink}
    top = min(b[1] for c, b in boxes.items() if c not in tuck)
    bottom = max(b[3] for c, b in boxes.items() if c not in tuck)
    drop = {c: max(0, top - boxes[c][1]) for c in tuck if c in boxes}
    height = bottom - top + 2 * PAD
    tab = (max(font.getlength(glyph(d)) for d in DIGITS if d in chars) + 2 * stroke) if any(d in chars for d in DIGITS) else 0

    cells = []
    for c in chars:
        adv = font.getlength(glyph(c)) + (2 * stroke if c != ' ' else 0)
        if c == ' ':
            cells.append((c, None, 0, round(adv if adv else size * 0.25)))
            continue
        l, _, r, _ = boxes[c]
        w = r - l + 2 * PAD
        img = Image.new('L', (w, height), 0)
        ImageDraw.Draw(img).text((PAD - l, PAD - top + drop.get(c, 0)), glyph(c), font=font, fill=255, anchor='ls', stroke_width=stroke, stroke_fill=255)
        shift = (tab - adv) / 2 if c in DIGITS else 0
        cells.append((c, img, round(l - PAD + shift), round(tab if c in DIGITS else adv)))

    # simple row packing
    x = y = 0
    placed = {}
    for c, img, ox, adv in cells:
        if img is None:
            continue
        if x + img.width > ATLAS_W:
            x, y = 0, y + height
        placed[c] = (x, y)
        x += img.width
    atlas_h = y + height
    atlas = Image.new('L', (ATLAS_W, atlas_h), 0)
    glyphs = {}
    for c, img, ox, adv in cells:
        if img is None:
            glyphs[c] = {'x': 0, 'y': 0, 'w': 0, 'h': 0, 'ox': 0, 'advance': adv}
            continue
        gx, gy = placed[c]
        atlas.paste(img, (gx, gy))
        glyphs[c] = {'x': gx, 'y': gy, 'w': img.width, 'h': img.height, 'ox': ox, 'advance': adv}
    meta = {'source': file, 'size': size, 'cellHeight': height, 'baseline': PAD - top, 'glyphs': glyphs,
            'width': ATLAS_W, 'height': atlas_h, 'alpha': base64.b64encode(atlas.tobytes()).decode('ascii')}
    with open(os.path.join(out, name + '.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'), ensure_ascii=False)
    print('%-6s %3dpx  cell height %3d  atlas %dx%d  %d glyphs' % (name, size, height, ATLAS_W, atlas_h, len(glyphs)))


if __name__ == '__main__':
    import sys
    for app in sys.argv[1:] or sorted(FONTS):
        out = os.path.join(APPS, app, 'hud', 'fonts')
        os.makedirs(out, exist_ok=True)
        print(app)
        for spec in FONTS[app]:
            bake(out, *spec)
