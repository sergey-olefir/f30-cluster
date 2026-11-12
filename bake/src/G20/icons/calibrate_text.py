"""Package C: fit the free font (Roboto variable, bench/g20/fonts/) to each stock-G20 text run on the rects.

For each run: the ink box on the photo (half-max of min(RGB)); for each candidate weight x width, render the same
string with PIL at the size that gives the photo's ink height, stretch it horizontally to the photo's ink width,
blur it like the photo (sigma 1.1 px) and score the normalised cross-correlation with the photo crop. Prints the
best (wght, wdth, size px, scaleX) per run and writes bake/work/g20sim/C/text_fit.json. The style table in
bench/g20/c.js takes its numbers from here (size, weight, width keyword, scaleX, ink box -> anchor).

Run: UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy --with pillow \
     python bake/src/G20/icons/calibrate_text.py
"""
import json
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
FONT = os.path.join(WT, 'bench', 'g20', 'fonts', 'Roboto-wdth-wght.subset.ttf')
RECT = '/Users/solefir/projects/f30-cluster/bake/work/overlay/rect/'
OUT = os.path.join(WT, 'bake', 'work', 'g20sim', 'C', 'text_fit.json')
IMS = {p: cv2.imread(RECT + p + '.png').astype(np.float32)[..., ::-1] for p in ('08', '09', '14')}

# name, photo, text, search box, invert (dark text on light)
RUNS = [
    ('range_digits', '08', '467', (181, 660, 258, 705), False),
    ('range_digits_09', '09', '473', (181, 660, 258, 705), False),
    ('range_unit', '08', 'km', (258, 668, 310, 705), False),
    ('clock', '08', '16:43', (338, 660, 458, 705), False),
    ('clock_09', '09', '16:36', (338, 660, 458, 705), False),
    ('temp_digits', '08', '+3.5', (1532, 660, 1622, 705), False),
    ('temp_digits_09', '09', '+4.0', (1532, 660, 1622, 705), False),
    ('temp_unit_C', '08', 'C', (1636, 670, 1670, 705), False),
    ('street', '09', 'Луганська вулиця', (780, 660, 1140, 714), False),
    ('street_14', '14', 'Пасічна вулиця', (800, 674, 1120, 714), False),
    ('cc_line1', '08', 'Готовність до руху:', (800, 615, 1130, 656), False),
    ('cc_line2', '08', 'натисніть гальмо.', (800, 658, 1130, 697), False),
    ('speed_digits', '08', '0', (470, 312, 535, 402), False),
    ('speed_unit', '14', 'km/h', (535, 365, 608, 400), False),
    ('mode_c1', '09', 'COMFORT', (1218, 341, 1362, 369), False),
    ('mode_c2', '09', 'PLUS', (1218, 370, 1300, 398), False),
    ('mode_b1', '14', 'COMFORT', (1220, 655, 1365, 686), False),
    ('mode_b2', '14', 'PLUS', (1220, 686, 1300, 714), False),
    ('gear_centre_P', '08', 'P', (1488, 314, 1552, 400), False),
    ('gear_centre_D', '09', 'D', (1488, 314, 1552, 400), False),
    ('gear_bottom', '14', 'P', (1392, 662, 1432, 710), False),
    ('rpm1', '08', '1/min', (1420, 570, 1512, 599), False),
    ('rpm2', '08', 'x1000', (1420, 599, 1514, 630), False),
    ('off', '08', 'OFF', (1512, 576, 1572, 607), False),
    ('tacho0', '14', '0', (1515, 570, 1552, 616), False),
    ('cold', '14', 'COLD', (1838, 630, 1908, 662), False),
    ('limit50', '08', '50', (515, 600, 563, 642), True),
    ('auto_h', '08', 'AUTO H', (1770, 172, 1878, 210), 'green'),
]
WEIGHTS = [400, 500, 600, 700, 800, 900]
WIDTHS = [75, 87.5, 100]
# the chosen style per run (judged by eye on the crops: the camera's bloom makes every free fit pick the heaviest
# weight); the fit then only solves size, scaleX, pen x and baseline for these.
FIXED = {
    'range_digits': (700, 87.5), 'range_digits_09': (700, 87.5), 'clock': (700, 87.5), 'clock_09': (700, 87.5),
    'temp_digits': (700, 87.5), 'temp_digits_09': (700, 87.5), 'range_unit': (600, 87.5), 'temp_unit_C': (600, 100),
    'street': (500, 87.5), 'street_14': (500, 87.5), 'cc_line1': (750, 87.5), 'cc_line2': (750, 87.5),
    'speed_digits': (700, 87.5), 'speed_unit': (600, 87.5), 'mode_c1': (700, 75), 'mode_c2': (700, 75),
    'mode_b1': (700, 75), 'mode_b2': (700, 75), 'gear_centre_P': (700, 87.5), 'gear_centre_D': (700, 87.5),
    'gear_bottom': (750, 87.5), 'rpm1': (550, 87.5), 'rpm2': (550, 87.5), 'off': (750, 87.5), 'tacho0': (550, 100),
    'cold': (750, 75), 'limit50': (500, 87.5), 'auto_h': (750, 75),
}


def ink_box(v):
    lo, hi = np.percentile(v, 3), np.percentile(v, 99.5)
    m = v > (lo + hi) / 2
    ys, xs = np.nonzero(m)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1, lo, hi


def render(text, wght, wdth, size):
    ft = ImageFont.truetype(FONT, size)
    ft.set_variation_by_axes([wght, wdth])
    W = int(size * (len(text) + 2))
    img = Image.new('L', (W, int(size * 2)), 0)
    ImageDraw.Draw(img).text((size // 2, int(size * 1.5)), text, font=ft, fill=255, anchor='ls')
    a = np.array(img).astype(np.float32)
    ys, xs = np.nonzero(a > 127)
    return a, (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1), ft.getlength(text), (size // 2, int(size * 1.5))


def fit(name, p, text, box, inv):
    x0, y0, x1, y1 = box
    crop = IMS[p][y0:y1, x0:x1]
    if inv == 'green':
        v = crop[..., 1] - np.maximum(crop[..., 0], crop[..., 2])
    elif inv:
        v = 255 - crop.max(2)
        v = v * (crop.min(2) < 160)
    else:
        v = crop.min(2)
    bx0, by0, bx1, by1, lo, hi = ink_box(v)
    tw, th = bx1 - bx0, by1 - by0
    ref = (v - lo) / max(1e-3, hi - lo)
    pad = 4
    R = ref[max(0, by0 - pad):by1 + pad, max(0, bx0 - pad):bx1 + pad]
    best = None
    combos = [(wg, wd) for wd in WIDTHS for wg in WEIGHTS]
    if FIXED_ONLY:
        combos = [FIXED[name]]
    for wg, wd in combos:
        if True:
            a, (ax0, ay0, ax1, ay1), adv, org = render(text, wg, wd, 100)
            size = 100.0 * th / (ay1 - ay0)
            a, (ax0, ay0, ax1, ay1), adv, org = render(text, wg, wd, max(6, int(round(size * 4))))   # 4x supersampled
            sx = (tw * 4) / (ax1 - ax0)
            g = a[ay0:ay1, ax0:ax1]
            g = cv2.resize(g, (tw, th), interpolation=cv2.INTER_AREA) / 255.0
            G = np.zeros_like(R)
            oy, ox = min(pad, by0), min(pad, bx0)
            G[oy:oy + th, ox:ox + tw] = g
            G = cv2.GaussianBlur(G, (0, 0), 1.1)
            Rz, Gz = R - R.mean(), G - G.mean()
            ncc = float((Rz * Gz).sum() / np.sqrt((Rz ** 2).sum() * (Gz ** 2).sum() + 1e-9))
            # stroke darkness: mean ink coverage ratio
            cov = float(G.mean() / max(1e-6, R.mean()))
            if best is None or ncc > best['ncc']:
                # font px: size; baseline in panel px; left of the advance box in panel px
                ink_left_off = (ax0 - org[0]) / 4.0 * 1.0          # ink left minus pen origin, at 1x, before scaleX
                base_off = (org[1] - ay1) / 4.0                    # baseline minus ink bottom at 1x
                best = {'name': name, 'photo': p, 'text': text, 'ncc': round(ncc, 4), 'cov': round(cov, 3),
                        'wght': wg, 'wdth': wd, 'size': round(size, 2), 'scaleX': round(sx, 4),
                        'ink': [int(x0 + bx0), int(y0 + by0), int(x0 + bx1), int(y0 + by1)],
                        'pen_x': round(x0 + bx0 - ink_left_off * sx, 1),
                        'baseline': round(y0 + by1 + base_off, 1),
                        'advance': round(adv / 4.0 * sx, 1)}
    return best


FIXED_ONLY = True


def main():
    res = {}
    for r in RUNS:
        b = fit(*r)
        res[b['name']] = b
        print('%-16s %-22s ncc %.3f cov %.2f  wght %d wdth %5.1f size %6.2f sx %.3f ink %s pen_x %.1f base %.1f adv %.1f' % (
            b['name'], b['text'], b['ncc'], b['cov'], b['wght'], b['wdth'], b['size'], b['scaleX'], b['ink'], b['pen_x'], b['baseline'], b['advance']))
    json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
