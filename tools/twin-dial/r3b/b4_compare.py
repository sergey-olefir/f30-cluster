#!/usr/bin/env python3
"""Side by side: B4's centre pages (bake/work/twin-dial/r3b/b4/<state>.png, from b4_gallery.js) against K2's round-3 mockups
(bake/work/twin-dial/mockup/r3/), the window [729, 172, 1191, 613] of each, ours left, the mockup right. Writes
bake/work/twin-dial/r3b/b4/compare/<state>.png, compare_sheet.png and compare.json (the ink boxes of both, body only).

    uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/r3b/b4_compare.py

The mockups are never an input to a bake: they are only looked at here. Differences are expected where SPEC-R3 changed a
number after the mockup (the trip row's stacked unit is a smaller atlas until B6, the media and phone pages follow the SPEC,
the dials and the tab bar are not ours). The ink-box columns are for the eye, not a gate.
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OURS = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'r3b', 'b4')
MOCK = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'mockup', 'r3')
WIN = (729, 175, 1191, 610)
PAIRS = [('clock', 'tab1/1A_clock.png'), ('trip', 'tab1/1C_trip_short.png'), ('tech', 'tab4/V1_tech.png'), ('tyres', 'tab4/V1b_tyres.png'),
         ('media', 'tab3/3D_certain.png'), ('radio', 'tab3/3A_radio.png'), ('track', 'tab3/3B_track.png'), ('phone', 'tab4/4A_idle.png'),
         ('call_in', 'tab4/4C_incoming_a.png'), ('call_active', 'tab4/4F_active.png'), ('nav_road', 'tab5/5E_road_only.png'),
         ('nav_calc', 'tab5/5F_calculating.png'), ('nav_none', 'tab5/5G_idle.png'), ('nav_guide', 'tab5/5D_guided.png'), ('nav_map', 'tab5/5A_map_W1.png')]


def ink_box(img, thr=60):
    a = np.asarray(img.convert('L').crop((WIN[0], 300, WIN[2], 570)))
    ys, xs = np.nonzero(a > thr)
    if not len(xs):
        return None
    return [int(xs.min()) + WIN[0], int(ys.min()) + 300, int(xs.max()) + WIN[0] + 1, int(ys.max()) + 301]


def main():
    out = os.path.join(OURS, 'compare')
    os.makedirs(out, exist_ok=True)
    rows, report = [], {}
    for state, mock in PAIRS:
        a, b = os.path.join(OURS, state + '.png'), os.path.join(MOCK, mock)
        if not (os.path.exists(a) and os.path.exists(b)):
            print('missing', state, a if not os.path.exists(a) else b)
            continue
        ia, ib = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
        w, h = WIN[2] - WIN[0], WIN[3] - WIN[1]
        pair = Image.new('RGB', (2 * w + 6, h + 22), (30, 30, 34))
        pair.paste(ia.crop(WIN), (0, 22))
        pair.paste(ib.crop(WIN), (w + 6, 22))
        d = ImageDraw.Draw(pair)
        d.text((4, 4), state + ' (ours)', fill=(200, 200, 200))
        d.text((w + 10, 4), mock + ' (K2 mockup)', fill=(200, 200, 200))
        pair.save(os.path.join(out, state + '.png'))
        rows.append(pair)
        report[state] = {'mockup': mock, 'ours_ink_box': ink_box(ia), 'mockup_ink_box': ink_box(ib)}
    if rows:
        cols = 2
        pw, ph = rows[0].size
        sheet = Image.new('RGB', (cols * pw, ((len(rows) + cols - 1) // cols) * ph), (20, 20, 22))
        for i, r in enumerate(rows):
            sheet.paste(r, ((i % cols) * pw, (i // cols) * ph))
        sheet.save(os.path.join(OURS, 'compare_sheet.png'))
    json.dump(report, open(os.path.join(OURS, 'compare.json'), 'w'), indent=1)
    for k, v in report.items():
        print('%-12s ours %s  mockup %s' % (k, v['ours_ink_box'], v['mockup_ink_box']))


if __name__ == '__main__':
    main()
