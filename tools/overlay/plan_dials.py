#!/usr/bin/env python3
"""The 'dials only' plan: we keep our speedo, tacho, fuel and oil-temperature dials; the G20 draws everything else.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python tools/overlay/plan_dials.py
    python3 tools/overlay/headless.py --plan design/overlay/plan.dials.json     # fills in the conflicts

Writes
  design/overlay/plan.dials.json     plan (schema planFile); conflicts left empty for headless.py --plan to fill in
  design/overlay/collar.dials.png    1920x720 grey: 255 where our background must stay opaque (the 'collar' that hides
                                     the stock G20 dial graphics sticking out past our dials); 0 = transparent
  docs/overlay/dials_scheme.png      the scheme (our data and the G20 catalogue only; no photo pixels)
  bake/work/overlay/shots/dials_scheme_photo08.png   the same over rectified photo 08 (local only; git-ignored)
and prints the per-element table used in docs/OVERLAY-PLAN-DIALS.md.

The idea (numbers from the catalogue, design/overlay/g20_comfort.json):
  - every stock G20 dial graphic (structure.*) ends at y <= 652; the G20 bottom row starts at y >= 659.
    So both big dials are cut flat at CUT_Y = 656 ('horseshoe' dials): below it the G20 bottom row shows.
    Our scales end at y ~ 580 and the needles never go below, so the cut loses only the bottom of the bezel ring.
  - the speed-limit sign (y 581..663) sits above the cut, in the empty sector of our speedo: a round window.
  - the check-control 'i' left of the tacho is 38 % under our tacho rim: a small window.
  - the fuel and oil minis move up 20 px so the G20 range ('467 km') clears the fuel mini.
  - our background turns transparent except the collar.
"""
import hashlib
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
W, H = 1920, 720
CUT_Y = 656
MINI_DY = -20
SIGN_WIN = {'rect': [494, 577, 584, 667], 'radius': 45}        # round: the sign is a circle
MAP_WIN = [748, 155, 1172, 612]                                 # the gap between the dials (no dial pixels)
# collar additions past the catalogue hulls: the stock '260' label reaches x 727 (bright pixels on rect 08 and 09);
# structure.speedo's hull stops at x 704
EXTRA_COLLAR = [[700, 66, 732, 110]]

# our elements that stay: the four dials and what they draw (scales, numerals, needles, READY/OFF)
KEEP_PREFIX = ('C1.', 'C2.', 'C3.', 'C4.', 'w.spd', 'w.rpm')
KEEP_IDS = {'w.speedo', 'w.tacho', 'w.fuel', 'w.oilt', 'w.fuel_full', 'w.fuel_zero', 'w.fuel_icon', 'w.oil_icon',
            'w.speed_unit', 'w.ready', 'w.off'}
DROP_EVEN_IF_PREFIX = set()

# G20 decisions (over -> keep-clear is forced by the schema)
COVER = {
    'assist.digital_speed': 'under our speedo hub; our needle shows the speed',
    'assist.rpm_label': 'under our tacho; cosmetic',
    'assist.cold': 'under our oil-temperature mini, which shows the same',
    'assist.off': 'under our tacho; our own READY/OFF stays. A window here would show the stock tacho needle at rest',
}
DROP = {
    'assist.mode_label_centre': 'BMW does not draw it with a custom theme; the bottom-row COMFORT PLUS shows instead',
    'assist.gear_centre': 'BMW does not draw it; the bottom-row gear (over) shows instead',
    'structure.tacho_info_line': 'BMW does not draw it; cosmetic',
}
NOTES = {
    'map.region': 'reveal between the dials only (edited hole = the gap); the parts under our dials stay hidden',
    'assist.speed_limit': 'round window in our speedo (the empty sector of the scale)',
    'assist.info_tacho': 'small window in our tacho rim',
    'bottom.clock': 'below the speedo cut (y >= 656)',
    'bottom.belt_rear': 'below the speedo cut (y >= 656)',
    'bottom.range': 'below the speedo cut; the fuel mini moves up 20 px',
    'bottom.temperature': 'below the tacho cut (y >= 656)',
    'assist.mode_label': 'below the tacho cut (y >= 656)',
    'tt.auto_h': 'about 6 % (the left edge of the A) stays under our tacho bezel',
}


def rel(p):
    return os.path.join(ROOT, p)


def sha(p):
    return 'sha256:' + hashlib.sha256(open(rel(p), 'rb').read()).hexdigest()


def keep(e):
    return e['id'] in KEEP_IDS or (e['id'].startswith(KEEP_PREFIX) and e['id'] not in DROP_EVEN_IF_PREFIX)


def raster(e, dy=0):
    m = np.zeros((H, W), bool)
    x0, y0, x1, y1 = [int(round(v)) for v in e['bbox']]
    y0 += dy
    y1 += dy
    if e.get('mask') and os.path.exists(rel(e['mask'])):
        a = np.array(Image.open(rel(e['mask'])).convert('L')) >= 64      # README: alpha >= 64
        ys, xs = slice(max(y0, 0), min(y0 + a.shape[0], H)), slice(max(x0, 0), min(x0 + a.shape[1], W))
        m[ys, xs] = a[ys.start - y0:ys.stop - y0, xs.start - x0:xs.stop - x0]
    elif e.get('poly'):
        im = Image.new('L', (W, H))
        ImageDraw.Draw(im).polygon([(p[0], p[1] + dy) for p in e['poly']], fill=1)
        m = np.array(im, bool)
    else:
        m[max(y0, 0):y1, max(x0, 0):x1] = True
    return m


def rr_mask(rect, r):
    im = Image.new('L', (W, H))
    ImageDraw.Draw(im).rounded_rectangle([rect[0], rect[1], rect[2] - 1, rect[3] - 1], radius=r, fill=1)
    return np.array(im, bool)


def dilate(m, px):
    return np.array(Image.fromarray((m * 255).astype('uint8')).filter(ImageFilter.MaxFilter(2 * px + 1))) > 0


def main():
    wb = json.load(open(rel('design/overlay/wb_comfort.json')))
    g20 = json.load(open(rel('design/overlay/g20_comfort.json')))
    G = {g['id']: g for g in g20['elements']}

    # ---- the plan ----
    pg = {}
    for g in g20['elements']:
        if g['relation'] == 'over':
            d = 'keep-clear'
        elif g['id'] in DROP:
            d = 'drop'
        elif g['id'] in COVER or g['group'] == 'structure':
            d = 'cover'
        else:
            d = 'reveal'
        o = {'decision': d}
        n = DROP.get(g['id']) or COVER.get(g['id']) or NOTES.get(g['id'])
        if g['group'] == 'structure' and d == 'cover':
            n = 'stock dial graphics: hidden by our dials, and past their edge by the collar (collar.dials.png)'
        if n:
            o['notes'] = n
        pg[g['id']] = o
    pw = {e['id']: {'hidden': True} for e in wb['elements'] if not keep(e)}
    holes = []
    for g in g20['elements']:
        if pg[g['id']]['decision'] != 'reveal':
            continue
        b = g['bbox']
        h = {'id': 'hole.' + g['id'], 'for': [g['id']], 'margin': 4, 'radius': 4, 'edited': False,
             'rect': [max(int(np.floor(b[0])) - 4, 0), max(int(np.floor(b[1])) - 4, 0), min(int(np.ceil(b[2])) + 4, W), min(int(np.ceil(b[3])) + 4, H)]}
        if g['id'] == 'map.region':
            h.update(rect=MAP_WIN, edited=True)
        if g['id'] == 'assist.speed_limit':
            h.update(rect=SIGN_WIN['rect'], radius=SIGN_WIN['radius'], edited=True)
        holes.append(h)
    plan = {
        '$comment': 'Dials only: our speedo, tacho, fuel and oil-temperature dials stay; the G20 draws the rest. Made by '
                    'tools/overlay/plan_dials.py; conflicts by tools/overlay/headless.py --plan. The hole-cuts-content '
                    'warnings are the intended windows: the flat cut of both dials at y >= %d, the round speed-limit '
                    'window, the check-control i. The collar (design/overlay/collar.dials.png) is outside this schema. '
                    'See docs/OVERLAY-PLAN-DIALS.md.' % CUT_Y,
        'kind': 'plan', 'schema_version': 1, 'version': 1, 'mode': g20.get('mode', 'comfort'),
        'based_on': {'g20': {'file': 'design/overlay/g20_comfort.json', 'sha256': sha('design/overlay/g20_comfort.json')},
                     'wb': {'file': 'design/overlay/wb_comfort.json', 'sha256': sha('design/overlay/wb_comfort.json')}},
        'settings': {'stockMap': False},
        'g20': pg, 'wb': pw,
        'anchors': {'mini.fuel': {'dy': MINI_DY}, 'mini.oil': {'dy': MINI_DY}},
        'holes': holes,
        'keep_clear': [{'id': 'kc.' + g['id'], 'for': [g['id']], 'rect': g['bbox'], 'poly': g.get('poly')} for g in g20['elements'] if g['relation'] == 'over'],
        'conflicts': [],
    }
    out = rel('design/overlay/plan.dials.json')
    if os.path.exists(out):     # keep the conflicts headless.py filled in, if the rest is unchanged
        old = json.load(open(out))
        if {k: v for k, v in old.items() if k != 'conflicts'} == {k: v for k, v in plan.items() if k != 'conflicts'}:
            plan['conflicts'] = old['conflicts']
    with open(out, 'w') as f:
        json.dump(plan, f, indent=1, ensure_ascii=False)
        f.write('\n')

    # ---- what the car would show: our shapes after the cut, windows and the mini move ----
    kept = [e for e in wb['elements'] if keep(e) and e.get('drawn_on_car', True)]
    U = np.zeros((H, W), bool)
    for e in kept:
        dy = MINI_DY if e.get('anchor') in ('mini.fuel', 'mini.oil') else 0
        m = raster(e, dy)
        if e.get('anchor') in ('speedo', 'tacho'):
            m[CUT_Y:, :] = False
        U |= m
    win_sign = rr_mask(SIGN_WIN['rect'], SIGN_WIN['radius'])
    b = G['assist.info_tacho']['bbox']
    win_i = rr_mask([int(b[0]) - 4, int(b[1]) - 4, int(np.ceil(b[2])) + 4, int(np.ceil(b[3])) + 4], 4)
    U &= ~(win_sign | win_i)

    show = [g for g in g20['elements'] if pg[g['id']]['decision'] in ('reveal', 'keep-clear') and g['group'] != 'structure']
    S = {g['id']: raster(g) for g in g20['elements']}
    stock = np.zeros((H, W), bool)       # what BMW draws under us that we hide: the stock dials and the 'cover' items
    for g in g20['elements']:
        if g['relation'] == 'under' and pg[g['id']]['decision'] == 'cover' or g['id'] in COVER:
            stock |= S[g['id']]
    for r in EXTRA_COLLAR:
        stock[r[1]:r[3], r[0]:r[2]] = True
    clear = np.zeros((H, W), bool)
    for g in show:
        clear |= dilate(S[g['id']], 3)
    collar = dilate(stock & ~U, 3) & ~U & ~clear
    Image.fromarray((collar * 255).astype('uint8')).save(rel('design/overlay/collar.dials.png'), optimize=True)
    left = stock & ~U & ~collar

    rows = []
    for g in g20['elements']:
        r = S[g['id']]
        n = int(r.sum())
        hid = int((r & (U | collar)).sum())
        vis = 100.0 if g['relation'] == 'over' else 0.0 if g['relation'] == 'gone' else 100.0 * (n - hid) / max(n, 1)
        rows.append((g['id'], g['relation'], g['safety'], pg[g['id']]['decision'], vis))
    print('collar: %d px; stock graphics left visible: %d px; cut at y >= %d' % (collar.sum(), left.sum(), CUT_Y))
    print('%-26s %-8s %-9s %-10s %s' % ('G20 element', 'relation', 'safety', 'decision', 'visible on the car'))
    for r in rows:
        print('%-26s %-8s %-9s %-10s %5.1f %%' % r)

    # ---- the scheme ----
    scheme(U, collar, G, pg, show, None, rel('docs/overlay/dials_scheme.png'))
    ph = rel('bake/work/overlay/rect/08.png')
    if os.path.exists(ph):
        os.makedirs(rel('bake/work/overlay/shots'), exist_ok=True)
        scheme(U, collar, G, pg, show, ph, rel('bake/work/overlay/shots/dials_scheme_photo08.png'))
    return 0


COL = {'reveal': (70, 220, 120), 'keep-clear': (255, 160, 40), 'cover': (150, 150, 160), 'drop': (230, 70, 70)}


def font(sz):
    for p in ('/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc', '/Library/Fonts/Arial.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def scheme(U, collar, G, pg, show, photo, out):
    if photo:
        base = np.array(Image.open(photo).convert('RGB').resize((W, H))).astype(float) * 0.55
    else:
        base = np.full((H, W, 3), 14.0)
    img = base.copy()
    img[collar] = img[collar] * 0.2 + np.array([90, 90, 100]) * 0.8
    img[U] = img[U] * 0.3 + np.array([30, 60, 105]) * 0.7
    im = Image.fromarray(img.clip(0, 255).astype('uint8')).convert('RGBA')
    ov = Image.new('RGBA', (W, H))
    hatch = np.zeros((H, W), bool)
    yy, xx = np.mgrid[0:H, 0:W]
    hatch[((xx + yy) % 10) < 2] = True
    a = np.array(ov)
    a[collar & hatch] = (200, 200, 210, 160)
    ov = Image.fromarray(a)
    d = ImageDraw.Draw(ov)
    d.line([(0, CUT_Y), (W, CUT_Y)], fill=(120, 200, 255, 200), width=1)
    for x in range(0, W, 16):
        d.line([(x, CUT_Y), (x + 8, CUT_Y)], fill=(120, 200, 255, 255), width=2)
    f = font(15)
    fs = font(13)
    for g in G.values():
        if g['group'] == 'structure':
            continue
        dec = pg[g['id']]['decision']
        c = COL[dec]
        if g.get('poly'):
            d.line([tuple(p) for p in g['poly']] + [tuple(g['poly'][0])], fill=c + (255,), width=2)
        else:
            d.rectangle(g['bbox'], outline=c + (255,), width=2)
        x0, y0, x1, y1 = g['bbox']
        lab = g['id'].split('.', 1)[1]
        ty = y0 - 16 if y0 > 20 else y1 + 2
        if g['id'] == 'map.region':
            ty = y0 + 4
            x0 += 4
        d.text((x0, ty), lab, fill=c + (255,), font=fs)
    for r, rad in ((SIGN_WIN['rect'], SIGN_WIN['radius']),):
        d.rounded_rectangle([r[0], r[1], r[2] - 1, r[3] - 1], radius=rad, outline=(120, 200, 255, 255), width=2)
    d.rectangle(MAP_WIN, outline=(70, 220, 120, 120), width=1)
    # legend
    lx, ly = 760, 20
    d.rectangle([lx - 10, ly - 8, lx + 400, ly + 118], fill=(0, 0, 0, 190))
    items = [((30, 60, 105), 'ours: speedo, tacho, fuel, oil temp (cut flat at y %d)' % CUT_Y),
             ((90, 90, 100), 'collar: our bg kept to hide the stock G20 dials'),
             (COL['reveal'], 'G20 shows (reveal)'), (COL['keep-clear'], 'G20 on top of us (keep clear)'),
             (COL['cover'], 'G20 hidden under our dials (cover)'), (COL['drop'], 'G20 does not draw it (drop)')]
    for i, (c, t) in enumerate(items):
        d.rectangle([lx, ly + i * 18 + 2, lx + 12, ly + i * 18 + 14], fill=c + (255,))
        d.text((lx + 20, ly + i * 18), t, fill=(230, 230, 230, 255), font=f)
    im = Image.alpha_composite(im, ov).convert('RGB')
    im.save(out, optimize=True)


if __name__ == '__main__':
    raise SystemExit(main())
