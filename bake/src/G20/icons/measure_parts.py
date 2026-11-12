"""Package C: ink extents of sub-parts (glyph runs, icons) on the rects, at half-max of min(RGB) (white) or of the
lamp's channel (colour). Prints one line per part; used to fill the style table of bench/g20/c.js.

Run: UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
     python bake/src/G20/icons/measure_parts.py
"""
import os
import cv2
import numpy as np

RECT = os.path.join(os.environ.get('F30_MAIN', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))), 'bake', 'work', 'overlay', 'rect') + '/'
IMS = {p: cv2.imread(RECT + p + '.png').astype(np.float32)[..., ::-1] for p in ('08', '09', '14')}

# (name, photo, search box x0 y0 x1 y1, channel: 'min' | 'max' | 'red' | 'green')
PARTS = [
    ('pump', '08', 128, 660, 181, 705, 'min'),
    ('range digits 467', '08', 181, 660, 258, 705, 'min'),
    ('range km', '08', 258, 660, 310, 705, 'min'),
    ('pump', '09', 128, 660, 181, 705, 'min'),
    ('range digits 473', '09', 181, 660, 258, 705, 'min'),
    ('range km', '09', 258, 660, 310, 705, 'min'),
    ('clock 16:43', '08', 338, 660, 458, 705, 'min'),
    ('clock 16:36', '09', 338, 660, 458, 705, 'min'),
    ('clock 10:15', '14', 338, 660, 458, 705, 'min'),
    ('temp +3.5', '08', 1532, 660, 1622, 705, 'min'),
    ('temp degC', '08', 1622, 660, 1670, 705, 'min'),
    ('temp +4.0', '09', 1532, 660, 1622, 705, 'min'),
    ('temp degC', '09', 1622, 660, 1670, 705, 'min'),
    ('street Луганська вулиця', '09', 780, 660, 1140, 714, 'min'),
    ('street Пасічна вулиця', '14', 800, 674, 1120, 714, 'min'),
    ('cc line1', '08', 800, 618, 1130, 655, 'min'),
    ('cc line2', '08', 800, 660, 1130, 697, 'min'),
    ('cc i', '08', 728, 630, 760, 690, 'min'),
    ('cc frame top', '08', 690, 596, 1240, 612, 'min'),
    ('cc frame left end', '08', 690, 596, 760, 630, 'min'),
    ('cc frame right end', '08', 1150, 596, 1250, 630, 'min'),
    ('info_tacho i', '08', 1250, 585, 1280, 632, 'min'),
    ('speed 0', '08', 470, 312, 535, 402, 'min'),
    ('speed km/h', '08', 535, 365, 612, 400, 'min'),
    ('speed 0', '14', 470, 312, 535, 402, 'min'),
    ('speed km/h', '14', 535, 365, 612, 400, 'min'),
    ('mode centre COMFORT', '08', 1218, 340, 1362, 369, 'min'),
    ('mode centre PLUS', '08', 1218, 370, 1362, 398, 'min'),
    ('mode bottom COMFORT', '14', 1220, 655, 1365, 686, 'min'),
    ('mode bottom PLUS', '14', 1220, 686, 1365, 714, 'min'),
    ('gear centre P', '08', 1488, 314, 1552, 400, 'min'),
    ('gear centre D', '09', 1488, 314, 1552, 400, 'min'),
    ('gear bottom P', '14', 1392, 662, 1432, 710, 'min'),
    ('rpm 1/min', '08', 1420, 570, 1512, 598, 'min'),
    ('rpm x1000', '08', 1420, 599, 1512, 630, 'min'),
    ('OFF', '08', 1512, 576, 1572, 607, 'min'),
    ('tacho 0', '09', 1512, 570, 1552, 615, 'min'),
    ('tacho 0', '14', 1512, 570, 1552, 615, 'min'),
    ('COLD', '14', 1838, 630, 1908, 662, 'min'),
    ('limit disc', '08', 488, 576, 590, 668, 'max'),
    ('limit 50', '08', 515, 600, 563, 642, 'dark'),
    ('limit 30', '14', 515, 600, 563, 642, 'dark'),
    ('auto_h', '08', 1770, 172, 1878, 210, 'green'),
    ('auto_h AUTO', '08', 1770, 172, 1852, 210, 'green'),
    ('auto_h H', '08', 1852, 172, 1878, 210, 'green'),
    ('park P red', '08', 1832, 210, 1908, 266, 'red'),
    ('park P green', '09', 1832, 210, 1908, 266, 'green'),
    ('park P green', '14', 1828, 210, 1904, 266, 'green'),
    ('steering', '08', 1840, 262, 1912, 322, 'red'),
    ('brake', '08', 18, 207, 92, 262, 'red'),
    ('tpms', '08', 18, 262, 90, 322, 'amber'),
    ('abs', '08', 8, 322, 80, 375, 'amber'),
    ('dsc', '08', 12, 376, 70, 440, 'amber'),
    ('belt_rear', '08', 496, 672, 582, 719, 'red'),
    ('belt_driver', '08', 586, 660, 630, 719, 'red'),
    ('belt_driver', '14', 586, 660, 630, 719, 'red'),
    ('airbag', '08', 630, 660, 686, 719, 'red'),
]


def chan(rgb, c):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return {'min': rgb.min(2), 'max': rgb.max(2), 'red': r - np.maximum(g, b), 'green': g - np.maximum(r, b),
            'amber': np.minimum(r, g) - b, 'dark': 255 - rgb.max(2)}[c]


for name, p, x0, y0, x1, y1, c in PARTS:
    crop = IMS[p][y0:y1, x0:x1]
    v = chan(crop, c)
    if c == 'dark':
        v = v * (IMS[p][y0:y1, x0:x1].min(2) < 128)  # text inside the white disc only
    lo, hi = np.percentile(v, 5), np.percentile(v, 99.5)
    m = v > (lo + hi) / 2
    ys, xs = np.nonzero(m)
    core = crop[m][v[m] >= np.percentile(v[m], 50)]
    print('%-26s %s ink [%d, %d, %d, %d]  w %d h %d  core %s' % (
        name, p, x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1, xs.max() + 1 - xs.min(),
        ys.max() + 1 - ys.min(), [int(t) for t in np.median(core, 0)]))
