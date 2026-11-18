#!/usr/bin/env python3
"""KC: the checks must FAIL on doctored input (a check that cannot fail proves nothing).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/test_checks_r3b.py
"""
import os
import sys

import numpy as np
from PIL import ImageDraw, Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import checks_r3b as C  # noqa: E402

fails = []


def expect(name, got, want):
    ok = got == want
    print(('ok   ' if ok else 'FAIL ') + name, got if not ok else '')
    if not ok:
        fails.append(name)


blank = np.zeros((C.H, C.W, 3), np.uint8)


def with_px(x, y, v=255):
    a = blank.copy()
    a[y, x] = v
    return a


expect('belt group pixel', C.ck_keepouts(with_px(550, 700))['status'], 'fail')
expect('gear gap pixel', C.ck_keepouts(with_px(1400, 700))['status'], 'fail')
expect('side-lamp hole pixels', C.ck_keepouts(np.where(np.zeros((C.H, C.W, 1), bool), blank, blank) + 0)['status'], 'pass')
h = C.HOLES[0]
a = blank.copy()
a[int(h[1]) + 3:int(h[1]) + 9, int(h[0]) + 3:int(h[0]) + 9] = 200
expect('hole 0 block', C.ck_keepouts(a)['status'], 'fail')
expect('one corner pixel in hole 4 is a note', C.ck_keepouts(with_px(1774, 207))['status'], 'note')

bar = blank.copy()
for x in (780, 848, 1168, 1237):
    bar[130:168, x - 1:x + 1] = 0
    bar[130:168, x + 1:x + 4] = 96
bar[130:168, 620:777] = 30
ink_ok = [dict(kind='text', text='412', box=[640, 130, 760, 156], size=34, fill=[255, 255, 255])]
ink_bad = [dict(kind='text', text='412', box=[700, 130, 790, 156], size=34, fill=[255, 255, 255])]
expect('cells: inside', C.ck_cells(bar, ink_ok)['status'], 'pass')
expect('cells: crossing a separator', C.ck_cells(bar, ink_bad)['status'], 'fail')

t = lambda b, s='5': dict(kind='text', text=s, box=b, size=28, fill=[255, 255, 255])
expect('dial gap 2 px', C.ck_dial_gaps([t([300, 300, 340, 330]), t([342, 300, 380, 330])])['status'], 'fail')
expect('dial gap 6 px', C.ck_dial_gaps([t([300, 300, 340, 330]), t([346, 300, 380, 330])])['status'], 'pass')
expect('numeral on the strip', C.ck_dial_gaps([t([600, 380, 650, 420], '300')])['status'], 'fail')

b1 = dict(kind='text', text='14:43', box=[740, 626, 846, 656], size=40, fill=[255, 255, 255])
b2 = dict(kind='text', text='+7.5', box=[850, 626, 930, 656], size=40, fill=[255, 255, 255])
expect('bottom row gap 4 px (different items)', C.ck_bottom_row(blank, [b1, b2], None)['status'], 'fail')
b2['box'] = [870, 626, 930, 656]
expect('bottom row gap 24 px', C.ck_bottom_row(blank, [b1, b2], None)['status'], 'pass')
unit = dict(kind='text', text='км', box=[851, 640, 873, 656], size=21, fill=[255, 255, 255])
expect('a number and its unit are one item', C.ck_bottom_row(blank, [b1, unit], None)['status'], 'pass')

pan = blank.copy()
pm = C.panel_mask()
pan[pm] = C.PANEL_RGB
expect('window open, empty', C.ck_window(pan, [])['status'], 'pass')
pan2 = pan.copy()
pan2[690:700, 1000:1040] = 255
expect('window open, our ink inside', C.ck_window(pan2, [])['status'], 'fail')
expect('window closed: skipped', C.ck_window(blank, [])['status'], 'skip')


def disc(cx, cy, r):
    im = Image.new('RGB', (C.W, C.H), (0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(214, 13, 18))
    return np.asarray(im)


res, _ = C.ck_sign(disc(1300, 672, 33), [])
expect('sign at its place', res['status'], 'pass')
res, _ = C.ck_sign(disc(1290, 672, 33), [])
expect('sign 10 px off', res['status'], 'fail')

ink = [dict(kind='text', text='x', box=[700, 300, 740, 330], size=33, fill=[255, 255, 255])]
expect('text beyond the window side', C.ck_centre(blank, ink, '2A')['status'], 'fail')
ink = [dict(kind='text', text='x', box=[800, 294, 840, 330], size=33, fill=[255, 255, 255])]
expect('text over the title rule', C.ck_centre(blank, ink, '2A')['status'], 'fail')
sidepx = blank.copy()
sidepx[300, 700] = 200
expect('ink beside the window', C.ck_centre(sidepx, [], '2A')['status'], 'fail')
expect('map pictures exempt from the side columns', C.ck_centre(sidepx, [], '5A')['status'], 'pass')

print('FAILED:' if fails else 'all passed', fails)
sys.exit(1 if fails else 0)
