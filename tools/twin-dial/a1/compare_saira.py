#!/usr/bin/env python3
"""Saira at stretch 1.00 and 1.06 against the mockup's own crops (package A1; SPEC 9: "the gallery compares 1.00 / 1.06").

    UV_CACHE_DIR=... uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/a1/compare_saira.py

Reads the mockup's pictures (bake/work/twin-dial/mockup/1_clock.png, git-ignored) and bakes the same text with
tools/bake_fonts.py at both stretches. Writes bake/work/twin-dial/r2/A1/saira_stretch.png (git-ignored): each row is
mockup crop | atlas 1.00 | atlas 1.06, all at 4x, the ink centred where the mockup centres it, with the zero's width
over height and the digit advance under each. The mockup draws Saira unstretched, so its crop and the 1.00 column should
agree (they differ in anti-aliasing only: the mockup is drawn at 3x and reduced, the atlas is a 1x rendering);
the question for the owner is whether 1.06 reads closer to what is wanted (VT measured the references' zero at w/h 0.97
against Saira's 0.90, docs/twin-dial/VT-REPORT.md).
"""
import json, math, os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import bake_fonts as bf

MOCK = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'mockup', '1_clock.png')
OUT = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'r2', 'A1')
ZOOM = 3
R = 300.0
CT, CS = (380.0, 400.0), (1540.0, 400.0)


def polar(c, a, r):
    t = math.radians(a)
    return (c[0] + r * math.sin(t), c[1] - r * math.cos(t))


FACE = ('Saira[wdth,wght].ttf', [550, 125])
# (label, text, atlas entry, mockup centre of the ink)
SAMPLES = [
    ('tachometer 3 (57 px)', '3', ('td_tach', 57, '0123456789'), polar(CT, -125 + 250 * 3 / 8, 0.745 * R)),
    ('tachometer 8 (57 px)', '8', ('td_tach', 57, '0123456789'), polar(CT, -125 + 250 * 8 / 8, 0.745 * R)),
    ('digital speed 87 (92 px)', '87', ('td_big', 92, '0123456789:-–'), (CS[0], CS[1] + 0.03 * R)),
    ('clock 14:43 (92 px)', '14:43', ('td_big', 92, '0123456789:-–'), (960.0, 372.0)),
    ('gear D3 (64 px)', 'D3', ('td_gear', 64, '0123456789PRNDMS-–'), (CT[0] - 0.02 * R, CT[1] + 0.39 * R)),
    ('speedometer 140 (28 px)', '140', ('td_scale_l', 28, '0123456789'), polar(CS, 25.0 * (140 - 100) / 40.0, 0.76 * R)),
    ('speedometer 160 (18 px)', '160', ('td_scale_s', 18, '0123456789'), polar(CS, 25.0 * (160 - 100) / 40.0, 0.78 * R)),
    ('dial label COMFORT (22 px)', 'COMFORT', ('td_label', 22, bf.TD_LABELS), (CT[0] + 0.02 * R, CT[1] + 0.56 * R)),
]


def render(meta, text):
    """The text as hud_text.js draws it: a black image with the ink's box centred; returns (img, ink box)."""
    g = meta['glyphs']
    atlas = Image.frombytes('L', (meta['width'], meta['height']), __import__('base64').b64decode(meta['alpha']))
    w = sum(g[c]['advance'] for c in text)
    img = Image.new('L', (w + 40, meta['cellHeight'] + 20), 0)
    pen = 20
    for c in text:
        q = g[c]
        if q['w']:
            img.paste(atlas.crop((q['x'], q['y'], q['x'] + q['w'], q['y'] + q['h'])), (pen + q['ox'], 10), None)
        pen += q['advance']
    return img, img.getbbox()


def zero_ratio(meta):
    g = meta['glyphs']['0']
    a = Image.frombytes('L', (meta['width'], meta['height']), __import__('base64').b64decode(meta['alpha'])).crop((g['x'], g['y'], g['x'] + g['w'], g['y'] + g['h']))
    b = a.point(lambda v: 255 if v > 127 else 0).getbbox()
    return (b[2] - b[0]) / (b[3] - b[1])


def main():
    if not os.path.exists(MOCK):
        sys.exit('no mockup picture at ' + MOCK + ' (run tools/twin-dial/mockup/mockup.py first)')
    mock = Image.open(MOCK).convert('L')
    os.makedirs(OUT, exist_ok=True)
    rows, notes = [], {}
    for label, text, (name, size, chars), (cx, cy) in SAMPLES:
        metas = {s: bf.bake(None, name, FACE[0], size, chars, 0, FACE[1], None, '', None, s) for s in (1.0, 1.06)}
        tiles = []
        # the mockup crop: the same window round the centre for all three columns
        imgs = {s: render(m, text) for s, m in metas.items()}
        bw = max(i[1][2] - i[1][0] for i in imgs.values())
        bh = max(i[1][3] - i[1][1] for i in imgs.values())
        cw, ch = int(bw + 24), int(bh + 24)
        crop = mock.crop((int(round(cx - cw / 2)), int(round(cy - ch / 2)), int(round(cx - cw / 2)) + cw, int(round(cy - ch / 2)) + ch))
        tiles.append(('mockup', crop))
        for s, (img, bb) in imgs.items():
            t = Image.new('L', (cw, ch), 0)
            t.paste(img.crop(bb), (int(round((cw - (bb[2] - bb[0])) / 2)), int(round((ch - (bb[3] - bb[1])) / 2))))
            tiles.append(('stretch %.2f' % s, t))
        rows.append((label, tiles, {s: (zero_ratio(m), m['glyphs'].get('0', {}).get('advance')) for s, m in metas.items()},
                     {s: bb[2] - bb[0] for s, (_, bb) in imgs.items()}))
    f = ImageFont.load_default()
    pad, lab = 10, 340
    wmax = max(sum(t[1].width * ZOOM + pad for t in r[1]) for r in rows) + lab
    H = sum(max(t[1].height for t in r[1]) * ZOOM + pad + 22 for r in rows) + pad
    sheet = Image.new('RGB', (wmax, H), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    y = pad
    for label, tiles, zr, wd in rows:
        d.text((pad, y), label, fill=(255, 255, 255), font=f)
        d.text((pad, y + 12), 'zero w/h %.3f -> %.3f   ink width %d -> %d px (x%.3f)' % (zr[1.0][0], zr[1.06][0], wd[1.0], wd[1.06], wd[1.06] / wd[1.0]), fill=(200, 200, 120), font=f)
        x = lab
        h = 0
        for cap, t in tiles:
            big = t.resize((t.width * ZOOM, t.height * ZOOM), Image.NEAREST).convert('RGB')
            sheet.paste(big, (x, y + 22))
            d.text((x, y + 8), cap, fill=(160, 200, 255), font=f)
            x += big.width + pad
            h = max(h, big.height)
        y += h + pad + 22
    p = os.path.join(OUT, 'saira_stretch.png')
    sheet.save(p)
    print('wrote', p, sheet.size)
    for label, tiles, zr, wd in rows:
        print('%-28s zero w/h %.3f -> %.3f   ink width %2d -> %2d px (x%.3f)' % (label, zr[1.0][0], zr[1.06][0], wd[1.0], wd[1.06], wd[1.06] / wd[1.0]))


if __name__ == '__main__':
    main()
