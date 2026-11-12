#!/usr/bin/env python3
"""The 'dials only' plan: we keep our speedo, tacho, fuel and oil-temperature dials; the G20 draws everything else.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python tools/overlay/plan_dials.py
    python3 tools/overlay/headless.py --plan design/overlay/plan.dials.json     # fills in the conflicts

Writes
  design/overlay/plan.dials.json     plan (schema planFile); conflicts left empty for headless.py --plan to fill in
  design/overlay/collar.dials.png    1920x720 grey: the collar's coverage, 0..255 (soft): where our black background
                                     stays (the 'collar' that hides the stock G20 dial graphics sticking out past our
                                     dials, the band under the dials' faded bottoms, the shade at their inner edges);
                                     0 = see-through. tools/bake_scene.py packs it black, quarter size.
  docs/overlay/dials_scheme.png      the scheme (our data and the G20 catalogue only; no photo pixels)
  bake/work/overlay/shots/dials_scheme_photo08.png   the same over rectified photo 08 (local only; git-ignored)
and prints the per-element table used in docs/OVERLAY-PLAN-DIALS.md.

The idea (numbers from the catalogue, design/overlay/g20_comfort.json):
  - every stock G20 dial graphic (structure.*) ends at y <= 652; the G20 bottom row starts at y >= 659.
    So both big dials are cut flat at CUT_Y = 656 ('horseshoe' dials): below it the G20 bottom row shows.
    Our scales end at y ~ 580 and the needles never go below, so the cut loses only the bottom of the bezel ring.
  - the speed-limit sign is ours (wbsign under the speed hub, as in 6WB Comfort): BMW's sign (y 581..663) is covered,
    except while ours has no data (app.json config.limit unset, today on the car): then a round window shows BMW's.
  - the check-control 'i' left of the tacho is 38 % under our tacho rim: a small soft window.
  - the fuel and oil minis move up 20 px so the G20 range ('467 km') clears the fuel mini.
  - our background turns transparent except the collar: pure black, soft-edged, never over a G20 item we show.
"""
import hashlib
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
W, H = 1920, 720
CUT_Y, CUT_FADE = 656, 26                                      # as design/gen_6wb.py
MINI_DY = -20
SP, RV, R = (412, 380), (1508, 380), 335                         # the big dials (gen_6wb G20 geometry)
# BMW's sign (centre 539, 622, r 41): the round window that shows it while ours has no data (gen_6wb: cut.round)
SIGN_WIN = {'rect': [495, 578, 583, 666], 'radius': 44}
SIGNS_BOX = [305, 460, 519, 553]                                # our wbsign widget (gen_6wb), under the speed hub
MAP_WIN = [748, 155, 1172, 612]                                 # the gap between the dials (no dial pixels)
# collar additions past the catalogue hulls: the stock '260' label reaches x 727 (bright pixels on rect 08 and 09);
# structure.speedo's hull stops at x 704
EXTRA_COLLAR = [[700, 66, 732, 110]]
# never collar: the stock bottom line between our dial and BMW's frame corner (the hook) at each side of the middle,
# so it runs on under our dial instead of stopping short (the stray dash right of the message panel; photo 16). The
# hulls only hold empty face there (rect 14, bench g20=startup|driving).
LINE_OPEN = [[596, 560, 712, 656], [1210, 560, 1330, 656]]
# the collar's look (polish B): soft edges, the shade at our dials' inner edges, the band under their faded bottoms
GROW, SOFT = 6, 4.0          # px the collar grows past the stock graphics, then a Gaussian of this sigma (px)
SHADE_K, SHADE_L = 0.80, 20.0  # the shade beside our dials toward the middle: strength at the rim, falloff (px)
SHADE_Y = (575.0, 605.0)     # ... fading out over these y, above the message panel and the check-control 'i'
# context elements that are not stock dial graphics: they never go into the collar. panel.background (added from the
# G20 parts, tools/overlay/parts_elements.json) is the stock background under everything; our see-through background
# shows it by design, and the collar itself takes its colour (tools/bake_scene.py).
NOT_IN_COLLAR = {
    'panel.background': 'context only: the stock background under everything; outside the collar our see-through '
                        'background shows it, and the collar takes its colour (tools/bake_scene.py)',
}

# our elements that stay: the four dials and what they draw (scales, numerals, needles, READY/OFF), and the road signs
KEEP_PREFIX = ('C1.', 'C2.', 'C3.', 'C4.', 'C7.', 'w.spd', 'w.rpm')
KEEP_IDS = {'w.speedo', 'w.tacho', 'w.fuel', 'w.oilt', 'w.fuel_full', 'w.fuel_zero', 'w.fuel_icon', 'w.oil_icon',
            'w.speed_unit', 'w.ready', 'w.off', 'w.signs', 'w.limit'}
DROP_EVEN_IF_PREFIX = set()

# G20 decisions (over -> keep-clear is forced by the schema)
REDRAW = {
    'assist.speed_limit': ([309, 464, 393, 549], 'ours: the wbsign under the speed hub (baked C7 sign_limit, its figure a '
                           'text), as in 6WB Comfort; BMW\'s is covered while ours shows. While ours has no data '
                           '(app.json config.limit unset, today on the car) a round window shows BMW\'s instead'),
}
COVER = {
    'assist.digital_speed': 'under our speedo hub; our needle shows the speed',
    'assist.rpm_label': 'under our tacho; cosmetic',
    'assist.cold': 'under our oil-temperature mini, which shows the same',
    'assist.off': 'under our tacho; our own READY/OFF stays. A window here would show the stock tacho needle at rest',
    'assist.mode_label': 'the bottom-row COMFORT PLUS: under a black patch in the collar (PATCHES; the lead\'s call '
                         'after package D, 2026-11-12), at least 3 px clear of the check-control outline',
}
# black patches in the collar over G20 items we cover outside our dials (rect, panel px; trimmed by the keep-out)
PATCHES = {'assist.mode_label': [1226, 659, 1366, 716]}
DROP = {
    'assist.mode_label_centre': 'BMW does not draw it with a custom theme; the bottom-row COMFORT PLUS shows instead',
    'assist.gear_centre': 'BMW does not draw it; the bottom-row gear (over) shows instead',
    'structure.tacho_info_line': 'BMW does not draw it; cosmetic',
}
NOTES = {
    'map.region': 'reveal between the dials only (edited hole = the gap); the parts under our dials stay hidden; '
                  'it darkens toward our dials (the collar\'s shade)',
    'assist.info_tacho': 'small soft window in our tacho rim; the collar keeps clear of it',
    'bottom.clock': 'below the speedo cut (y >= 656)',
    'bottom.belt_rear': 'below the speedo cut (y >= 656)',
    'bottom.range': 'below the speedo cut; the fuel mini moves up 20 px',
    'bottom.temperature': 'below the tacho cut (y >= 656)',
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


def blur(a, sigma):
    """A separable Gaussian of a float image (edges clamped)."""
    r = int(np.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    p = np.pad(a, r, mode='edge')
    p = sum(k[i] * p[:, i:i + a.shape[1]] for i in range(2 * r + 1))
    return sum(k[i] * p[i:i + a.shape[0], :] for i in range(2 * r + 1)).astype(np.float32)


def main():
    wb = json.load(open(rel('design/overlay/wb_comfort.json')))
    g20 = json.load(open(rel('design/overlay/g20_comfort.json')))
    G = {g['id']: g for g in g20['elements']}

    # ---- the plan ----
    pg = {}
    for g in g20['elements']:
        if g['relation'] == 'over':
            d = 'keep-clear'
        elif g['id'] in REDRAW:
            d = 'redraw'
        elif g['id'] in DROP:
            d = 'drop'
        elif g['id'] in COVER or g['group'] == 'structure':
            d = 'cover'
        else:
            d = 'reveal'
        o = {'decision': d}
        if d == 'redraw':
            o['redraw_at'] = REDRAW[g['id']][0]
        n = (REDRAW.get(g['id']) or (None, None))[1] or DROP.get(g['id']) or COVER.get(g['id']) or NOTES.get(g['id'])
        if g['group'] == 'structure' and d == 'cover':
            n = NOT_IN_COLLAR.get(g['id']) or 'stock dial graphics: hidden by our dials, and past their edge by the collar (collar.dials.png)'
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
        holes.append(h)
    plan = {
        '$comment': 'Dials only: our speedo, tacho, fuel and oil-temperature dials and our road signs stay; the G20 draws '
                    'the rest. Made by tools/overlay/plan_dials.py; conflicts by tools/overlay/headless.py --plan. The '
                    'hole-cuts-content warnings are the intended windows: the flat cut of both dials at y >= %d, the '
                    'check-control i. The speed-limit sign is ours (redraw); BMW\'s shows through a round window only '
                    'while ours has no data. The collar (design/overlay/collar.dials.png) is outside this schema. '
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
    # the windows: the check-control 'i' always; BMW's sign only while ours has no data (U below: ours shown, closed)
    b = G['assist.info_tacho']['bbox']
    win_i = rr_mask([int(b[0]) - 2, int(b[1]) - 2, int(np.ceil(b[2])) + 2, int(np.ceil(b[3])) + 2], 2)
    U &= ~win_i
    win_sign = rr_mask(SIGN_WIN['rect'], SIGN_WIN['radius'])

    show = [g for g in g20['elements'] if pg[g['id']]['decision'] in ('reveal', 'keep-clear') and g['group'] != 'structure']
    S = {g['id']: raster(g) for g in g20['elements']}
    stock = np.zeros((H, W), bool)       # what BMW draws under us that we hide: the stock dials and the 'cover' items
    for g in g20['elements']:
        if g['id'] in NOT_IN_COLLAR:
            continue
        if g['relation'] == 'under' and pg[g['id']]['decision'] == 'cover' or g['id'] in COVER:
            stock |= S[g['id']]
    for r in EXTRA_COLLAR:
        stock[r[1]:r[3], r[0]:r[2]] = True
    for r in LINE_OPEN:
        stock[r[1]:r[3], r[0]:r[2]] = False
    # keep-out: every G20 item we show (and BMW's sign, for its window) gets no collar, shade or band, nor 3 px round it
    shown = np.zeros((H, W), bool)
    for g in show:
        if g['id'] != 'map.region':
            shown |= S[g['id']]
    shown |= S['assist.speed_limit'] | win_sign
    clear = dilate(shown, 3)
    core = dilate(stock & ~U, 3) & ~U & ~clear
    # soft: grown GROW px, then blurred, so the full black still covers every stock pixel it hid before
    soft = np.clip(blur(dilate(core, GROW).astype(np.float32), SOFT) / 0.95, 0.0, 1.0)
    # the band under our dials' faded bottoms (y CUT_Y - CUT_FADE .. CUT_Y): black, so they fade into black rather than
    # over the stock bottom line, and that line runs on under them
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    out_sp = (np.hypot((xx - SP[0]) / R, (yy - SP[1]) / R) - 1.0) * R          # px outside each dial (< 0: inside)
    out_rv = (np.hypot((xx - RV[0]) / R, (yy - RV[1]) / R) - 1.0) * R
    outd = np.minimum(out_sp, out_rv)
    band = ((outd <= 1.0) & (yy >= CUT_Y - CUT_FADE - 4) & (yy < CUT_Y)).astype(np.float32)
    band = blur(band, 1.5)
    # the shade: our dials' inner edges darken the G20's middle toward them, as the stock map's veil does at its edges
    inner = ((xx > SP[0]) & (xx < RV[0])).astype(np.float32)
    vy = 1.0 - np.clip((yy - SHADE_Y[0]) / (SHADE_Y[1] - SHADE_Y[0]), 0.0, 1.0)
    rim = np.clip((outd + 3.0) / 3.0, 0.0, 1.0)                                # from just inside our rim outward
    shade = SHADE_K * np.exp(-np.maximum(outd, 0.0) / SHADE_L) * inner * vy * rim
    # the patches: the rect grown 5 px, a 1 px blur, so its edge still covers the item fully after the bake's quarter
    # size (the keep-out still holds it 3 px off the check-control outline)
    patch = np.zeros((H, W), np.float32)
    for r in PATCHES.values():
        patch[max(r[1] - 5, 0):r[3] + 5, max(r[0] - 5, 0):r[2] + 5] = 1.0
    patch = blur(patch, 1.0)
    ko = np.clip(blur(clear.astype(np.float32), 1.5) * 2.0, 0.0, 1.0)
    alpha = np.maximum(np.maximum(np.maximum(soft, band), shade), patch) * (1.0 - ko)
    Image.fromarray(np.round(alpha * 255).astype('uint8')).save(rel('design/overlay/collar.dials.png'), optimize=True)
    collar = alpha >= 0.5
    left = stock & ~U & ~collar

    rows = []
    Uc = U | win_sign                    # while our sign shows, the speedo covers BMW's (gen_6wb cut.cover)
    for g in g20['elements']:
        r = S[g['id']]
        n = int(r.sum())
        hid = int((r & (Uc | collar)).sum())
        vis = 100.0 if g['relation'] == 'over' else 0.0 if g['relation'] == 'gone' else 100.0 * (n - hid) / max(n, 1)
        rows.append((g['id'], g['relation'], g['safety'], pg[g['id']]['decision'], vis))
    ri = S['assist.info_tacho']
    print('the check-control i (assist.info_tacho): %.1f %% under the collar at alpha >= 0.5, mean collar alpha %.3f, '
          'max %.3f' % (100.0 * (ri & collar).sum() / ri.sum(), alpha[ri].mean(), alpha[ri].max()))
    print('collar (alpha >= 0.5): %d px; stock graphics left visible: %d px; cut at y >= %d' % (collar.sum(), left.sum(), CUT_Y))
    print('%-26s %-8s %-9s %-10s %s' % ('G20 element', 'relation', 'safety', 'decision', 'visible on the car'))
    for r in rows:
        print('%-26s %-8s %-9s %-10s %5.1f %%' % r)

    # ---- the scheme ----
    scheme(U, alpha, G, pg, show, None, rel('docs/overlay/dials_scheme.png'))
    ph = rel('bake/work/overlay/rect/08.png')
    if os.path.exists(ph):
        os.makedirs(rel('bake/work/overlay/shots'), exist_ok=True)
        scheme(U, alpha, G, pg, show, ph, rel('bake/work/overlay/shots/dials_scheme_photo08.png'))
    return 0


COL = {'reveal': (70, 220, 120), 'keep-clear': (255, 160, 40), 'cover': (150, 150, 160), 'drop': (230, 70, 70),
       'redraw': (90, 170, 255)}


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
    k = (np.asarray(collar, float) * 0.8)[..., None]           # the collar's soft coverage
    img = img * (1 - k) + np.array([90, 90, 100]) * k
    collar = collar >= 0.5
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
    d.rectangle([lx - 10, ly - 8, lx + 400, ly + 136], fill=(0, 0, 0, 190))
    items = [((30, 60, 105), 'ours: speedo, tacho, fuel, oil temp, signs (cut flat at y %d)' % CUT_Y),
             ((90, 90, 100), 'collar: our black bg (soft) over the stock G20 dials'),
             (COL['reveal'], 'G20 shows (reveal)'), (COL['keep-clear'], 'G20 on top of us (keep clear)'),
             (COL['cover'], 'G20 hidden under our dials (cover)'), (COL['drop'], 'G20 does not draw it (drop)'),
             (COL['redraw'], 'ours instead of the G20\'s (redraw; circle: its fallback window)')]
    for i, (c, t) in enumerate(items):
        d.rectangle([lx, ly + i * 18 + 2, lx + 12, ly + i * 18 + 14], fill=c + (255,))
        d.text((lx + 20, ly + i * 18), t, fill=(230, 230, 230, 255), font=f)
    im = Image.alpha_composite(im, ov).convert('RGB')
    im.save(out, optimize=True)


if __name__ == '__main__':
    raise SystemExit(main())
