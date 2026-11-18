#!/usr/bin/env python3
"""Package B6: lays out the alpha planes of tools/twin-dial/b6/icon_sheet.js on labelled sheets, white ink on black.

    uv run -q --no-project --with pillow python -I tools/twin-dial/b6/icon_sheet.py <dir written by icon_sheet.js> <out dir>

Writes <out>/icons_1x.png and <out>/icons_4x.png (git-ignored: bake/work). The label font is Noto Sans from tools/fonts-src.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, '..', '..', 'fonts-src', 'NotoSans-wght.subset.ttf')
src, out = sys.argv[1], sys.argv[2]
rows = json.load(open(os.path.join(src, 'icons.json')))
blob = open(os.path.join(src, 'icons.bin'), 'rb').read()
os.makedirs(out, exist_ok=True)
font = ImageFont.truetype(FONT, 13)
for sc in sorted({r['scale'] for r in rows}):
    items = [r for r in rows if r['scale'] == sc]
    slots = []
    for r in items:
        if r['slot'] not in slots: slots.append(r['slot'])
    W = 1900 if sc == 1 else 2400
    y = 8
    plan = []
    for s in slots:
        its = [r for r in items if r['slot'] == s]
        cellw = max(max(r['w'] for r in its) + 14, 110)
        cellh = max(r['h'] for r in its) + 38
        per = max(1, (W - 16) // cellw)
        y += 24
        plan.append((s, its, cellw, cellh, per, y))
        y += ((len(its) + per - 1) // per) * cellh + 10
    img = Image.new('RGB', (W, y + 8), (0, 0, 0))
    d = ImageDraw.Draw(img)
    for s, its, cellw, cellh, per, y0 in plan:
        d.text((8, y0 - 22), '%s  %dx%d px  x%d' % (s, its[0]['w'] // sc, its[0]['h'] // sc, sc), font=font, fill=(255, 190, 60))
        for i, r in enumerate(its):
            cx, cy = 8 + (i % per) * cellw, y0 + (i // per) * cellh
            a = Image.frombytes('L', (r['w'], r['h']), blob[r['off']:r['off'] + r['w'] * r['h']])
            d.rectangle([cx, cy, cx + r['w'] - 1, cy + r['h'] - 1], outline=(40, 40, 40))
            img.paste(Image.merge('RGB', (a, a, a)), (cx, cy))
            d.text((cx, cy + r['h'] + 3), r['name'].replace('td_', ''), font=font, fill=(170, 170, 170))
    img.save(os.path.join(out, 'icons_%dx.png' % sc))
    print('icons_%dx.png' % sc, img.size)
