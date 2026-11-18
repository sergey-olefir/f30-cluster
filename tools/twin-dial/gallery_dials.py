#!/usr/bin/env python3
"""Twin Dial B1: a gallery of the dials alone (the real shader, the real faces): idle, driving, redline, the limit in every strip
reading, hollow marker, cruise, night. Writes bake/work/twin-dial/r3b/B1/gallery/*.png (git-ignored) and gallery.png (a contact sheet).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl python -I tools/twin-dial/gallery_dials.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np                                     # noqa: E402
from PIL import Image, ImageDraw                       # noqa: E402

import render_dials as rd                              # noqa: E402

OUT = os.path.join(rd.ROOT, 'bake', 'work', 'twin-dial', 'r3b', 'B1', 'gallery')
lim = lambda v, st=1, w=0, m=1: (rd.spd_deg(v), st, w, m)          # noqa: E731
STATES = [
    ('01_idle', 'idle: 0 km/h, 0 rpm', rd.tach_state(0), rd.spd_state(0)),
    ('02_driving', '87 km/h, 2400 rpm', rd.tach_state(2400), rd.spd_state(87)),
    ('03_redline', '210 km/h, 7000 rpm (redline 6500)', rd.tach_state(7000), rd.spd_state(210)),
    ('04_L1_below', 'limit 50, 42 km/h: L1 dim strip', rd.tach_state(1800), rd.spd_state(42, lim=lim(50))),
    ('05_L1_over', 'limit 50, 63 km/h: L1 full strip', rd.tach_state(2400), rd.spd_state(63, lim=lim(50))),
    ('06_L2_over', 'limit 50, 63 km/h: L2 between marker and needle', rd.tach_state(2400), rd.spd_state(63, lim=lim(50, m=2))),
    ('07_L3_below', 'limit 50, 42 km/h: L3 always full', rd.tach_state(1800), rd.spd_state(42, lim=lim(50, m=3))),
    ('08_conditional', 'limit 90 conditional (hollow marker, no strip)', rd.tach_state(2200), rd.spd_state(87, lim=lim(90, 2))),
    ('09_limit130_cruise110', 'limit 130 (L1) and cruise 110, 103 km/h', rd.tach_state(2600), rd.spd_state(103, lim=lim(130), cru=(rd.spd_deg(110), 1))),
    ('10_limit_cruise_over', 'limit 90 (L1), cruise 110, 103 km/h: over', rd.tach_state(2600), rd.spd_state(103, lim=lim(90), cru=(rd.spd_deg(110), 1))),
    ('11_night', 'night: 87 km/h, limit 90, cruise 110', rd.tach_state(2400, night=True), rd.spd_state(87, night=True, lim=lim(90), cru=(rd.spd_deg(110), 1))),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    fs = rd.shader_source()
    tiles = []
    for stem, label, t, s in STATES:
        im = Image.fromarray(rd.panel({'tach': t, 'speed': s}, fs=fs))
        im.save(os.path.join(OUT, stem + '.png'))
        crop = Image.new('RGB', (1300, 600), (0, 0, 0))
        crop.paste(im.crop((70, 90, 690, 660)), (0, 0))
        crop.paste(im.crop((1230, 90, 1850, 660)), (680, 0))
        crop = crop.resize((650, 300), Image.LANCZOS)
        ImageDraw.Draw(crop).text((6, 4), label, fill=(240, 200, 90))
        tiles.append(crop)
    cols = 2
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * 656, rows * 306), (24, 24, 26))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * 656, (i // cols) * 306))
    sheet.save(os.path.join(OUT, 'gallery.png'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
