"""tools/twin-dial/fv: the contact sheets of the three placements (front-vehicle FV, docs/twin-dial/FV-SPEC.md section 3).

    UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with pillow python -I tools/twin-dial/fv/sheets.py <shots folder> [<out>]

Input: a tools/twin-dial/fv/shots.py run (its F/<look>_<nn>_<state>.png car views: the real app on the bench, rendered by the
gallery's moderngl painter). Output (default bake/work/front-vehicle/pub/FV/, git-ignored), file names numbers only:
  010 .. 015   whole frames (1920 x 720): A + B by day and night, B on tab 3, C on tab 3
  100 / 101    A, the centre page: every state, day / night (crops of the centre)
  200 / 201    B, the pictogram in the speedometer's hub: every state, day / night (crops of the hub, 2x)
  300 / 301    C, the strip in the bottom row's lower line (tabs 2-5): every state, day / night - NOT built: painted here over the
               bench's tab-3 frame, from the same numbers (geometry in STRIP below)
  400          A: the five gap levels side by side, one row (the glide's stops), day
Every picture is ours (our geometry, our generic car, Twin Dial's palette and Noto); no reference photo is read here.
"""
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SHOTS = os.path.abspath(sys.argv[1])
OUT = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(ROOT, 'bake', 'work', 'front-vehicle', 'pub', 'FV')
os.makedirs(OUT, exist_ok=True)

STATES = [('00_off', 'test off (0.1.4 as today)'), ('01_absent', 'signal absent'), ('02_none', 'no target (and stale)'),
          ('03_level5', 'level 5 (far)'), ('04_level4', 'level 4'), ('05_level3', 'level 3 (middle)'), ('06_level2', 'level 2'),
          ('07_level1_near', 'level 1 (near)'), ('08_closing', 'closing'), ('09_fast', 'closing fast'),
          ('10_cruise_standby', 'cruise standby'), ('11_limiter', 'limiter'), ('12_no_cruise', 'no cruise'), ('13_tab3', 'tab 3 (media)')]
LEVEL = {'03_level5': 5, '04_level4': 4, '05_level3': 3, '06_level2': 2, '07_level1_near': 1, '08_closing': 2, '09_fast': 2,
         '10_cruise_standby': 3, '11_limiter': 3, '12_no_cruise': 3, '13_tab3': 2}
CLOSING = {'08_closing': 1, '09_fast': 2}
NIGHT = {'fg': 0.80, 'dim': 0.75, 'amber': 0.80}


def font(px):
    """The captions in the repository's own Noto Sans (tools/fonts-src), the face Twin Dial's atlases are baked from."""
    f = os.path.join(ROOT, 'tools', 'fonts-src', 'NotoSans-wght.subset.ttf')
    return ImageFont.truetype(f, px) if os.path.exists(f) else ImageFont.load_default()


def frame(look, key):
    p = os.path.join(SHOTS, 'F', '%s_%s.png' % (look, key))
    return Image.open(p).convert('RGB') if os.path.exists(p) else None


def sheet(tiles, cols, title, scale=1.0):
    """tiles: [(image, caption)] -> one picture with a caption under each tile."""
    tiles = [t for t in tiles if t[0] is not None]
    w, h = tiles[0][0].size
    w2, h2 = int(w * scale), int(h * scale)
    rows = (len(tiles) + cols - 1) // cols
    cap = 26
    im = Image.new('RGB', (cols * (w2 + 8) + 8, 44 + rows * (h2 + cap + 8)), (24, 26, 30))
    d = ImageDraw.Draw(im)
    d.text((10, 10), title, fill=(230, 230, 230), font=font(20))
    for i, (t, c) in enumerate(tiles):
        x, y = 8 + (i % cols) * (w2 + 8), 44 + (i // cols) * (h2 + cap + 8)
        im.paste(t.resize((w2, h2), Image.LANCZOS) if scale != 1.0 else t, (x, y))
        d.text((x + 2, y + h2 + 4), c, fill=(200, 200, 200), font=font(15))
    return im


# ---- C: the strip (not built; painted from these numbers) ----------------------------------------------------------------------
STRIP = {'box': (880, 664, 1040, 712), 'cy': 688, 'ego_x': 902, 'car_w': 26, 'car_h': 15, 'rung0': 930, 'pitch': 18, 'rung_h': 14}


def paint_strip(img, level, closing, night, present=True):
    """A top-view strip in the bottom row's lower line: our car (outline) left, the rungs of the measured gap, the car ahead right."""
    S = 4
    x0, y0, x1, y1 = STRIP['box']
    W, H = (x1 - x0) * S, (y1 - y0) * S
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    k = lambda role: NIGHT[role] if night else 1.0
    col = lambda rgb, role, a=255: tuple(int(c * k(role)) for c in rgb) + (a,)
    white, grey, amber = (255, 255, 255), (227, 227, 227), (240, 170, 10)
    fast = closing == 2
    cy = (STRIP['cy'] - y0) * S
    cw, ch = STRIP['car_w'] * S, STRIP['car_h'] * S

    def car(cx, fill, outline):
        box = (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2)
        if outline:
            d.rounded_rectangle(box, radius=5 * S, outline=outline, width=int(1.6 * S))
        else:
            d.rounded_rectangle(box, radius=5 * S, fill=fill)
            d.rounded_rectangle((cx - cw * 0.12, cy - ch * 0.36, cx + cw * 0.18, cy + ch * 0.36), radius=2 * S, fill=(0, 0, 0, 200))
    car((STRIP['ego_x'] - x0) * S, None, col(grey, 'dim', 190))
    if present and level:
        rc = col(amber if fast else white, 'amber' if fast else 'fg', 255 if fast else 140 if not closing else 220)
        for i in range(level):
            rx = (STRIP['rung0'] + i * STRIP['pitch'] - x0) * S
            d.rounded_rectangle((rx - 1.4 * S, cy - STRIP['rung_h'] / 2 * S, rx + 1.4 * S, cy + STRIP['rung_h'] / 2 * S), radius=1.4 * S, fill=rc)
        if closing:
            for j in range(2 if fast else 1):
                cx = (STRIP['ego_x'] + 22 + j * 7 - x0) * S
                d.line([(cx - 3 * S, cy - 5 * S), (cx + 2 * S, cy), (cx - 3 * S, cy + 5 * S)], fill=rc, width=int(2.4 * S))
        car((STRIP['rung0'] + (level - 1) * STRIP['pitch'] + 20 - x0) * S, col(amber if fast else white, 'amber' if fast else 'fg'), None)
    lay = lay.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    out = img.copy()
    out.paste(lay, (x0, y0), lay)
    return out


def main():
    looks = ('day', 'night')
    have = {(lk, s): frame(lk, s) for lk in looks for s, _ in STATES}
    missing = [k for k, v in have.items() if v is None]
    if missing:
        print('missing frames:', missing)
    # whole frames
    for n, (lk, s) in zip(range(10, 14), [('day', '06_level2'), ('night', '08_closing'), ('day', '13_tab3'), ('night', '09_fast')]):
        if have[(lk, s)] is not None:
            have[(lk, s)].save(os.path.join(OUT, '%03d.png' % n))
    base3 = have[('day', '13_tab3')]
    if base3 is not None:
        paint_strip(base3, 2, 0, False).save(os.path.join(OUT, '014.png'))
    if have[('night', '13_tab3')] is not None:
        paint_strip(have[('night', '13_tab3')], 2, 2, True).save(os.path.join(OUT, '015.png'))
    # A
    for i, lk in enumerate(looks):
        tiles = [(have[(lk, s)].crop((700, 160, 1220, 612)) if have[(lk, s)] is not None else None, c) for s, c in STATES if s != '13_tab3']
        sheet(tiles, 5, 'A - the centre page "Авто попереду" (tab 1 while the test is on), %s - real app on the bench' % lk).save(os.path.join(OUT, '%03d.png' % (100 + i)))
    # B
    for i, lk in enumerate(looks):
        tiles = [(have[(lk, s)].crop((1400, 220, 1680, 600)) if have[(lk, s)] is not None else None, c) for s, c in STATES]
        sheet(tiles, 7, 'B - the pictogram in the speedometer hub (every tab), %s - real app on the bench' % lk).save(os.path.join(OUT, '%03d.png' % (200 + i)))
    # C (mockup over the bench's tab-3 frame)
    for i, lk in enumerate(looks):
        base = have[(lk, '13_tab3')]
        if base is None:
            continue
        tiles = []
        for s, c in STATES[1:13]:
            lv = LEVEL.get(s, 0)
            img = paint_strip(base, lv, CLOSING.get(s, 0), lk == 'night', present=s not in ('01_absent', '02_none'))
            tiles.append((img.crop((620, 590, 1300, 720)), c))
        sheet(tiles, 3, 'C - a strip in the bottom row\'s lower line (tabs 2-5 only), %s - NOT built: painted over the bench\'s tab-3 frame' % lk).save(os.path.join(OUT, '%03d.png' % (300 + i)))
    # the five levels in a row (A), day
    tiles = [(have[('day', s)].crop((780, 300, 1140, 600)) if have[('day', s)] is not None else None, c) for s, c in STATES[3:8]]
    sheet(tiles, 5, 'A - the five gap levels (the glide\'s stops), day').save(os.path.join(OUT, '400.png'))
    print('wrote', sorted(os.listdir(OUT)))


if __name__ == '__main__':
    main()
