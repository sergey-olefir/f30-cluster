#!/usr/bin/env python3
"""SC (Twin Dial round 3): tab 2's page drawn from design/twin-dial/r3/sc/card.json, on top of the round-1 mockup.

    UV_CACHE_DIR=<main>/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/r3/sc/card_draw.py

Writes bake/work/twin-dial/r3/SC/preview/*.png (git-ignored) and a contact sheet. For K2: import draw_tab2(),
draw_warning_tab(), draw_window(), selected_fill() from here (the geometry is card.json's; the words are invented).
Wrapping uses PIL's measure of the same Noto at the atlas sizes: within a few px of the engine's atlas advances
(tools/twin-dial/r3/sc/centre_cc.js), so a line may break one word differently - the model is the authority.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'twin-dial', 'mockup'))
import mockup as mk  # noqa: E402

CARD = json.load(open(os.path.join(ROOT, 'design', 'twin-dial', 'r3', 'sc', 'card.json')))
OUT = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'r3', 'SC', 'preview')
SEV = {'red': 4, 'yellow': 3, 'orange': 3, 'green': 2, 'white': 1, 'default': 1}
SEVC = CARD['severity']['colours']
SEVN = {4: 'red', 3: 'amber', 2: 'green', 1: 'grey', 0: 'grey'}
SYMBOL_BY_ID = {15: 'cc_door', 19: 'cc_boot', 42: 'cc_brake', 50: 'cc_tyre', 164: 'cc_washer', 41: 'cc_service', 213: 'cc_battery', 987: 'cc_belt'}
PANEL = CARD['keep_outs']['bmw_panel_bbox']


def symbol_for(i, colour):
    return SYMBOL_BY_ID.get(i) or ('cc_warn' if colour in ('red', 'yellow', 'orange', None) else 'cc_info')


def wrap(cv, text, f, widths):
    words, lines, cur, i = text.split(), [], '', 0
    while i < len(words) and len(lines) < len(widths):
        trial = (cur + ' ' + words[i]).strip()
        if cv.width(trial, f) <= widths[len(lines)] or not cur:
            cur, i = trial, i + 1
        else:
            lines.append(cur)
            cur = ''
    if cur and len(lines) < len(widths):
        lines.append(cur)
        cur = ''
    cut = i < len(words)
    if cut:
        t = lines[-1] + ' ' + ' '.join(words[i:])
        while len(t) > 1 and cv.width(t + '…', f) > widths[len(lines) - 1]:
            t = t[:-1]
        lines[-1] = t.rstrip(' ,.;:') + '…'
    return lines, cut


def ramp_cell(cv, x0, y0, x1, y1):
    h = int((y1 - y0) * mk.SS)
    L = np.linspace(0.002, 0.16, h)[:, None] * np.ones((1, int((x1 - x0) * mk.SS)))
    cv.img.paste(Image.fromarray(np.stack([mk.srgb(L)] * 3, axis=-1).astype(np.uint8)), (int(x0 * mk.SS), int(y0 * mk.SS)))


def selected_fill(cv, x0, x1, colour, y0=127, y1=172):
    """SF's fill law: the tab colour in linear light times the ramp's own shape (1 at the rule)."""
    h = int((y1 - y0) * mk.SS)
    t = np.linspace(0.002, 0.16, h)[:, None] / 0.16
    lin = np.array([(c / 255.0) ** 2.2 for c in colour])[None, None, :]
    rgb = mk.srgb(lin * t[:, :, None] * np.ones((1, int((x1 - x0) * mk.SS), 1)))
    cv.img.paste(Image.fromarray(rgb.astype(np.uint8)), (int(x0 * mk.SS), int(y0 * mk.SS)))


def draw_warning_tab(cv, look, sev=0):
    """look: W0 nothing (dim icon), W1 listed (white), W2 a message, tab not selected (icon in the severity colour),
    W3 selected (the selection fill, white icon). Draw after mk.tab_bar(cv) (its own warning icon is replaced)."""
    x0, x1 = 744, 812
    ramp_cell(cv, x0 + 2, 127, x1, 171.2)
    if look == 'W3':
        selected_fill(cv, x0 + 2, x1, (176, 10, 37), 127, 171.2)
        cv.rect(x0 + 2, 169.7, x1, 172.7, (226, 120, 130))
    col = {'W0': (188, 188, 188), 'W1': (255, 255, 255), 'W3': (255, 255, 255)}.get(look)
    if look == 'W2':
        col = tuple(SEVC[SEVN[sev]]['icon'])
    cv.icons = [i for i in cv.icons if not (i[0] == 'cc_warn' and i[1] == 38)]
    cv.icon('cc_warn', 38, 778, 143, col)


def draw_title(cv, text='Повідомлення'):
    cv.btext(960, 281, text, mk.noto(41), mk.WHITE, 'c')
    r = CARD['grammar']['rule']
    cv.rect(r['x0'], r['y0'], r['x1'], r['y1'], (205, 205, 205))


def draw_tab2(cv, cand=None, entries=(), shown=False, sev=0, counter='', pointer_sev=1):
    """cand: {id, name, colour} the message shown now (or None); entries: the other listed ones; shown: a message shows
    (pointer page when cand is None)."""
    C, R, G = CARD['card'], CARD['rows'], CARD['grammar']
    draw_title(cv)
    top = G['body_top']
    if cand or shown:
        s = SEV.get(cand['colour'], 1) if cand else pointer_sev
        name = SEVN[s]
        x0, y0, x1, y1 = C['cell']
        if name == 'grey':
            ramp_cell(cv, x0, y0, x1, y1)
        else:
            cv.rect(x0, y0, x1, y1, tuple(SEVC[name]['cell']))
        scol = tuple(SEVC[name]['symbol'])
        sym = symbol_for(cand['id'], cand['colour']) if cand else ('cc_warn' if s in (3, 4) else 'cc_info')
        cv.icon(sym, 54, C['symbol']['centre'][0], C['symbol']['centre'][1], scol)
        if cand:
            f = mk.noto(42)
            lines, _ = wrap(cv, cand['name'], f, [C['headline']['max_w']] * 3)
            bases = C['headline']['baselines'][str(len(lines))]
        else:
            f = mk.noto(39)
            lines, bases = CARD['pointer']['lines'], CARD['pointer']['baselines']
        for ln, b in zip(lines, bases):
            cv.btext(960, b, ln, f, mk.WHITE if cand else (227, 227, 227), 'c')
        if counter:
            cv.btext(C['counter']['right'], C['counter']['baseline'], counter, mk.noto(29), (227, 227, 227), 'r')
        top = bases[-1] + 12 + 8 + 6
    elif not entries:
        e = CARD['empty']
        cv.icon('cc_info', 66, e['symbol']['centre'][0], e['symbol']['centre'][1], (188, 188, 188))
        cv.btext(960, e['text']['baseline'], e['text']['s'], mk.noto(39), (227, 227, 227), 'c')
        return
    ents = sorted(enumerate(entries), key=lambda p: ({4: 0, 3: 1}.get(SEV.get(p[1]['colour'], 1), 2), p[0]))
    y, n = top, 0
    for _, e in ents:
        if y + R['pitch'] > G['body_bottom']:
            break
        s = SEV.get(e['colour'], 1)
        col = tuple(SEVC[SEVN[s]]['icon']) if s in (3, 4) else ((59, 155, 26) if s == 2 else mk.WHITE)
        cv.icon(symbol_for(e['id'], e['colour']), 32, R['symbol']['centre_x'], y + 22, col)
        lines, _ = wrap(cv, e['name'], mk.noto(33), [R['name']['max_w']])
        cv.btext(R['name']['x'], y + 33, lines[0], mk.noto(33), mk.WHITE, 'l')
        y += R['pitch']
        n += 1
    if n < len(entries):
        si = R['scroll_indicator']
        cv.rect(si['x'], si['y'][0], si['x'] + si['w'], si['y'][1], tuple(si['track']))
        cv.rect(si['x'], si['y'][0], si['x'] + si['w'], si['y'][0] + max(8, (si['y'][1] - si['y'][0]) * n / len(entries)), tuple(si['thumb']))


def draw_window(cv):
    """BMW's panel showing through the fallback window, as the bench draws it (a neutral stand-in, not BMW's look)."""
    poly = json.load(open(os.path.join(ROOT, 'design', 'twin-dial', 'vf', 'message_panel.json')))['fallback_window']['polygon_px']
    cv.poly([tuple(p) for p in poly], (70, 76, 86))
    cv.btext(960, 664, "BMW'S MESSAGE PANEL", mk.noto(30), (230, 230, 230), 'c')


def paste_icons(img, icons):
    """mockup.paste_icons, with a fallback: a size VT did not bake is resized from the 66 px bake (preview only)."""
    for name, size, cx, cy, color in icons:
        path = os.path.join(mk.ICONS, '%s_%dx%d.png' % (name, size, size))
        if not os.path.exists(path):
            path = os.path.join(mk.ICONS, '%s_66x66.png' % name)
            if not os.path.exists(path):
                continue
        a = Image.open(path).convert('RGBA').split()[3]
        if a.size != (size, size):
            a = a.resize((size, size), Image.LANCZOS)
        solid = Image.new('RGBA', a.size, tuple(color) + (0,))
        solid.putalpha(a)
        img.paste(solid, (int(round(cx - a.size[0] / 2)), int(round(cy - a.size[1] / 2))), solid)


def frame(page, window=False, look='W3', sev=0, centre_page=None, **kw):
    cv = mk.Canvas()
    cv.speed_digits = 87.0
    cv.dial(mk.CT, 'tach', 2.4)
    cv.dial(mk.CS, 'speed', 87.0)
    mk.tab_bar(cv)
    draw_warning_tab(cv, look, sev)
    if page == 'tab2':
        draw_tab2(cv, **kw)
    else:
        mk.centre(cv, centre_page or 'clock')
    if window:
        draw_window(cv)
    else:
        mk.bottom_row(cv)
        if look in ('W3', 'W2') and sev:
            cv.rect(629, 611, 1291, 615, tuple(SEVC[SEVN[sev]]['rule']))
    out = cv.img.resize((mk.W, mk.H), Image.LANCZOS)
    paste_icons(out, cv.icons)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    S = CARD['samples_for_mockups']
    rows = S['rows']
    shots = [
        ('01_card_1line_white_ours', dict(page='tab2', cand=S['card_one_line'], entries=rows[:2], sev=1)),
        ('02_card_2lines_amber_counter_ours', dict(page='tab2', cand=S['card_two_lines'], entries=rows, counter='2/3', sev=3)),
        ('03_card_3lines_red_ours', dict(page='tab2', cand=S['card_three_lines'], entries=rows, sev=4)),
        ('04_card_cut_red_ours', dict(page='tab2', cand=S['card_cut'], entries=[], sev=4)),
        ('05_card_opening_window_150ms', dict(page='tab2', cand=S['card_two_lines'], entries=rows, window=True, sev=3)),
        ('06_list_stored_only', dict(page='tab2', cand=None, entries=rows + [{'id': 1, 'name': 'Перевірте рівень оливи', 'colour': 'white'}, {'id': 2, 'name': 'Фари: несправність', 'colour': 'yellow'}, {'id': 3, 'name': 'Ключ: замініть батарейку', 'colour': 'white'}, {'id': 4, 'name': 'Сервіс через 900 км', 'colour': 'white'}], look='W3')),
        ('07_empty', dict(page='tab2', cand=None, entries=[], look='W3')),
        ('08_pointer_window_d7', dict(page='tab2', cand=None, entries=[], shown=True, pointer_sev=1, window=True, sev=1)),
        ('09_left_tab2_window_amber_icon', dict(page='other', window=True, look='W2', sev=3)),
        ('10_no_message_dim_tab', dict(page='other', look='W0')),
    ]
    imgs = []
    for name, kw in shots:
        img = frame(**kw)
        img.save(os.path.join(OUT, name + '.png'))
        imgs.append((name, img))
        print('wrote', os.path.join(OUT, name + '.png'))
    # contact sheet: the centre crops
    cw, ch = 760, 620 - 100
    sheet = Image.new('RGB', (cw * 2 + 30, (ch + 40) * 5 + 10), (25, 25, 25))
    d = ImageDraw.Draw(sheet)
    for k, (name, img) in enumerate(imgs):
        x, y = 10 + (k % 2) * (cw + 10), 10 + (k // 2) * (ch + 40)
        sheet.paste(img.crop((580, 100, 580 + cw, 100 + ch)), (x, y + 30))
        d.text((x, y + 6), name, fill=(255, 255, 255), font=mk.ImageFont.truetype(os.path.join(mk.FONTS, 'notosans', 'NotoSans[wdth,wght].ttf'), 20))
    sheet.save(os.path.join(OUT, 'sheet.png'))
    print('wrote', os.path.join(OUT, 'sheet.png'))


if __name__ == '__main__':
    main()
