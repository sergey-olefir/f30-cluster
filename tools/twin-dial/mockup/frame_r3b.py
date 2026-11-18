"""Twin Dial round 3b, package KA: the minimal frame round the dials (tab bar, one centre page, the bottom row, BMW's
fallback panel) so that KA's pictures are complete 1920 x 720 panels. It is NOT the tabs' and pages' drawing: that is
package KB's pages.py (the authority for every tab and page). The numbers are the same ones K2's pages.py took from SF's
tabs.json / pages.json (SPEC-R3 3, 3.5, 4); only tab 1's clock page and tab 3's certain-only page are drawn here.

    import mockup as M, frame_r3b as F
    cv = M.Canvas(); M.draw_dials(cv, M.look_named('r3b_base'), speed=87, limit=...); F.frame(cv, tab=1, limit=...)
    img = M.finish(cv)
"""
import json
import os

import numpy as np
from PIL import Image

import mockup as M

SS = M.SS
WHITE = M.WHITE
BAR = (618, 127, 1302, 170)                      # cells end at the rule's top (SF: rule y 170-173)
SEPS = [780, 848, 1168, 1237]
TAB_RULE = (170, 173, 230)                       # y0, y1, code (SPEC-R3 3.1: 3 px)
ICON_BOX, ICON_Y = 46, 147                       # 36 px of ink in a 46 box (our drawings' ink is about 0.79 of it)
TAB_FONT, TAB_UNIT, TEXT_BASE = 34, 21, 156
TAB_COLOUR = {1: (176, 10, 37), 2: (176, 10, 37), 3: (240, 150, 10), 4: (60, 155, 34), 5: (30, 150, 200)}
TRULE = (739, 1181, 295, 297.5, 205)             # the title rule (SPEC-R3 4)
BROW = (629, 1291, 612.4, 614.6, 231)            # the bottom rule
BASE1, BASE2 = 655, 702                          # the bottom row's baselines (SF)
GREY2 = (227, 227, 227)
PANEL_JSON = os.path.join(M.ROOT, 'design', 'twin-dial', 'vf', 'message_panel.json')
KEEP = {'belt_group': (497, 660, 688, 720), 'gear_gap': (1380, 660, 1460, 720)}      # + the seven side-lamp holes (vg/layout.json)
STORED_MARKER = (1240, 588, 1288, 630)           # BMW's stored-message marker (SPEC rev 2 3.3)
BLACK_BOX = (1420, 320, 1611, 440)               # the G20's KOMBI black box (SPEC-R3 12)


def _lin(c):
    return M.lin_of(c)


def _enc(L):
    return tuple(int(round(v)) for v in M.srgb(np.asarray(L, float)))


def paste_rgb(cv, x0, y0, arr):
    cv.img.paste(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)), (int(round(x0 * SS)), int(round(y0 * SS))))


def tab_bar(cv, sel=1, texts=None):
    """SPEC-R3 3: the bar's ramp, a 3 px rule, the separators (780 / 848 / 1168 / 1237), 36 px icons, the selected tab's
    cell filled by `colour x ramp / 0.16` with the rule under it lightened. texts: tab 1's range ("412"), tab 3's name."""
    nm = cv.nm
    x0, y0, x1, y1 = BAR
    h, w = int(round((y1 - y0) * SS)), int(round((x1 - x0) * SS))
    ramp = np.linspace(0.002, 0.16, h)
    k = M.NIGHT['tab'] if cv.night else 1.0
    kb = M.NIGHT['strip'] if cv.night else 1.0
    paste_rgb(cv, x0, y0, np.stack([M.srgb(ramp * kb)] * 3, -1)[:, None, :] * np.ones((1, w, 1)))
    ry0, ry1, rc = TAB_RULE
    rule_col = nm((rc, rc, rc), 'rules')
    cv.rect(x0, ry0, x1, ry1, rule_col)
    cells = [(618, SEPS[0], 1), (SEPS[0], SEPS[1], 2), (SEPS[1], SEPS[2], 3), (SEPS[2], SEPS[3], 4), (SEPS[3], 1302, 5)]
    for cx0, cx1, i in cells:
        if i != sel:
            continue
        L = _lin(TAB_COLOUR[i])[None, :] * (ramp / 0.16 * k)[:, None]
        cw = int(round((cx1 - cx0) * SS))
        paste_rgb(cv, cx0, y0, np.stack([M.srgb(L[:, j]) for j in range(3)], -1)[:, None, :] * np.ones((1, cw, 1)))
        cv.rect(cx0, ry0, cx1, ry1, _enc(np.clip(_lin(TAB_COLOUR[i]) * k + 0.15 * _lin(rule_col), 0, 1)))
    for sx in SEPS:
        cv.rect(sx - 1, y0, sx + 1, y1, (0, 0, 0))
        cv.rect(sx + 2, y0, sx + 3, y1, nm((84, 84, 84), 'rules'))
    ink = nm(WHITE, 'white')
    t1 = (texts or {}).get(1, '412')
    ix = 618 + 18 - 0.06 * ICON_BOX + ICON_BOX / 2
    cv.sdf_icon('td_fuel', ICON_BOX, ix, ICON_Y, ink)
    tx = 618 + 18 + 0.82 * ICON_BOX + 7
    cv.btext(tx, TEXT_BASE, t1, M.noto(TAB_FONT), ink)
    cv.btext(tx + cv.width(t1, M.noto(TAB_FONT)) + 7, TEXT_BASE, 'км', M.noto(TAB_UNIT), ink)
    cv.sdf_icon('cc_warn', ICON_BOX, (SEPS[0] + SEPS[1]) / 2 + 1, ICON_Y, ink)
    t3 = (texts or {}).get(3, 'Радіо Приклад')
    f = M.noto(TAB_FONT)
    tw = ICON_BOX + 6 + cv.width(t3, f)
    gx = (SEPS[1] + SEPS[2]) / 2 - tw / 2
    cv.sdf_icon('td_radio', ICON_BOX, gx + ICON_BOX / 2, ICON_Y, ink)
    cv.btext(gx + ICON_BOX + 6, TEXT_BASE, t3, f, ink)
    cv.sdf_icon('td_phone', ICON_BOX, (SEPS[2] + SEPS[3]) / 2 + 1, ICON_Y, ink)
    cv.sdf_icon('td_nav', ICON_BOX, (SEPS[3] + 1302) / 2 + 1, ICON_Y, ink)


def title(cv, s):
    cv.ctext((960, 270), s, M.noto(41), cv.nm(WHITE, 'white'))
    x0, x1, y0, y1, code = TRULE
    cv.rect(x0, y0, x1, y1, cv.nm((code,) * 3, 'rules'))


def page_clock(cv):
    """Tab 1, date and time (SPEC-R3 4.1): the large Saira clock of the approved mockup."""
    w = cv.nm(WHITE, 'white')
    title(cv, 'Дата і час')
    cv.ctext((960, 372), '14:43', M.saira(92), w)
    cv.ctext((960, 450), 'вівторок', M.noto(39), w)
    cv.ctext((960, 505), '17.11.2026', M.noto(39), w)


def page_media_min(cv):
    """Tab 3, M3 certain-only (SPEC-R3 4.3): the title and the source pictogram 66 px at (960, 392)."""
    title(cv, 'Медіа')
    cv.sdf_icon('td_media', 66 / 0.79, 960, 392, cv.nm(WHITE, 'white'))


def bottom_row(cv, lines=2, rule=None):
    """SPEC-R3 3.5: tab 1 two lines (odometer / trip distance; clock / temperature); any other tab one line (clock and
    temperature on the upper baseline)."""
    nm = cv.nm
    if rule:
        cv.rect(629, 611, 1291, 615, nm(rule, 'red'))
    else:
        cv.rect(BROW[0], BROW[2], BROW[1], BROW[3], nm((BROW[4],) * 3, 'rules'))
    f, fu = M.noto(40), M.noto(21)
    rows = [(846, BASE1, '48 215', 'км'), (1153, BASE1, '412.6', 'км'), (846, BASE2, '14:43', ''), (1153, BASE2, '+7.5', '°C')] \
        if lines == 2 else [(846, BASE1, '14:43', ''), (1153, BASE1, '+7.5', '°C')]
    for x, base, num, unit in rows:
        cv.btext(x, base, num, f, nm(WHITE, 'white'), 'r')
        if unit:
            cv.btext(x + 5, base, unit, fu, nm(WHITE, 'white'), 'l')


def fallback_polygon():
    return [tuple(p) for p in json.load(open(PANEL_JSON))['fallback_window']['polygon_px']]


def bmw_panel(cv):
    """BMW's message panel as the bench draws it (tools/shots/twin/backdrop.py): the fallback polygon, grey, labelled; the
    bottom row has stepped aside, the rule stays outside the window."""
    poly = fallback_polygon()
    cv.d.polygon([(x * SS, y * SS) for x, y in poly], fill=(70, 78, 90))
    cv.ctext((946, 652), 'BMW MESSAGE PANEL', M.font(('notosans', 'NotoSans[wdth,wght].ttf'), 28, 700, 100), (240, 240, 240))
    cv.rect(629, BROW[2], 694, BROW[3], (BROW[4],) * 3)
    cv.rect(1230, BROW[2], 1291, BROW[3], (BROW[4],) * 3)


def frame(cv, tab=1, limit=None, window=False):
    """Everything round the dials for tab 1 (clock page, two-line bottom row) or tab 3 (certain-only media page, one-line
    row), with the speed-limit sign at the row's right end on every tab (SPEC-R3 8). window: BMW's panel open (the bottom
    row steps aside; the sign stays)."""
    tab_bar(cv, tab)
    {1: page_clock, 3: page_media_min}[tab](cv)
    if window:
        bmw_panel(cv)
    else:
        bottom_row(cv, 2 if tab == 1 else 1)
    M.draw_sign(cv, limit)
