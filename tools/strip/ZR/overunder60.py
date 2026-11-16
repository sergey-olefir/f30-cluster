"""Package ZR: which stock elements of the right zone BMW draws OVER a theme, read on photo 60.

Photo 60 is our calibration grid (opaque only on its lines and labels) over the stock cluster. Where one of our
grid lines crosses a stock element's ink there are two possibilities: our line is on top (the element is drawn
UNDER a theme: the line stays green across the ink) or BMW's ink is on top (OVER: the line is interrupted by
white). For each crossing this compares the line pixels inside the element's 50 % ink mask (from atlas.py, on
the line's neighbours) with the same line just outside the element.

score = mean (G - max(R, B)) on the line inside the ink / the same just outside. ~1 -> our line on top (under);
~0 or negative -> BMW's ink on top (over).
Usage: python -I overunder60.py <crop_4x.png of 60>   (prints JSON; no pixels written)
"""
import json
import sys

import cv2
import numpy as np

X0, Y0, N = 1180, 520, 4
# (element, line orientation, line position, ink span along the line [a, b] in panel px)
CROSSINGS = [
    ('assist.mode_label', 'v', 1250, (657, 680)),
    ('assist.mode_label', 'v', 1300, (657, 680)),
    ('assist.mode_label', 'v', 1350, (657, 680)),
    ('assist.gear', 'v', 1400, (668, 699)),
    ('bottom.temperature', 'v', 1550, (667, 699)),
    ('bottom.temperature', 'v', 1600, (667, 699)),
    ('bottom.temperature', 'v', 1650, (667, 699)),
    ('assist.cold', 'v', 1850, (638, 657)),
    ('assist.cold', 'v', 1900, (638, 657)),
    ('assist.rpm_label', 'v', 1450, (575, 597)),
    ('assist.rpm_label', 'h', 600, (1430, 1505)),
    ('structure.tacho.num0', 'h', 600, (1520, 1544)),
    ('assist.mode_label', 'h', 700, (1225, 1300)),
    ('assist.gear', 'h', 700, (1396, 1420)),
    ('rail.right', 'v', 1300, (645, 651)),
    ('rail.right', 'v', 1400, (645, 651)),
]


def main():
    im = cv2.imread(sys.argv[1]).astype(np.float32)
    b, g, r = im[..., 0], im[..., 1], im[..., 2]
    green = g - np.maximum(r, b)
    white = np.minimum(np.minimum(r, g), b)
    out = []
    for name, o, pos, (a0, a1) in CROSSINGS:
        if o == 'v':
            # the line's own columns, and the columns 3-5 px beside it (BMW ink without the line)
            cols = [int(round((x - X0 - 0.5) * N)) for x in np.arange(pos + 0.25, pos + 1.8, 0.25)]
            side = [int(round((x - X0 - 0.5) * N)) for x in np.arange(pos + 4, pos + 6, 0.25)] + \
                   [int(round((x - X0 - 0.5) * N)) for x in np.arange(pos - 5, pos - 3, 0.25)]
            rin = slice(int((a0 - Y0 - 0.5) * N), int((a1 - Y0 - 0.5) * N))
            rout = list(range(int((a0 - 14 - Y0 - 0.5) * N), int((a0 - 6 - Y0 - 0.5) * N))) + \
                list(range(int((a1 + 6 - Y0 - 0.5) * N), int((a1 + 14 - Y0 - 0.5) * N)))
            line_in = green[rin][:, cols]
            line_out = green[rout][:, cols]
            ink_side = white[rin][:, side]
            ink_line = white[rin][:, cols]
            # only rows where the element has ink right beside the line count
            rows = ink_side.max(1) > 120
        else:
            rows_ = [int(round((y - Y0 - 0.5) * N)) for y in np.arange(pos + 0.25, pos + 1.8, 0.25)]
            side = [int(round((y - Y0 - 0.5) * N)) for y in np.arange(pos - 5, pos - 3, 0.25)]
            cin = slice(int((a0 - X0 - 0.5) * N), int((a1 - X0 - 0.5) * N))
            cout = list(range(int((a0 - 14 - X0 - 0.5) * N), int((a0 - 6 - X0 - 0.5) * N)))
            line_in = green[rows_][:, cin].T
            line_out = green[rows_][:, cout].T
            ink_side = white[side][:, cin].T
            ink_line = white[rows_][:, cin].T
            rows = ink_side.max(1) > 120
        if rows.sum() < 4:
            out.append({'element': name, 'line': '%s%d' % (o, pos), 'note': 'no ink beside the line'})
            continue
        sc = float(line_in[rows].mean() / max(line_out.mean(), 1.0))
        wl = float(ink_line[rows].mean())
        out.append({'element': name, 'line': '%s%d' % (o, pos), 'samples': int(rows.sum()),
                    'green_inside_over_outside': round(sc, 2), 'white_on_line': round(wl, 1),
                    'white_beside': round(float(ink_side[rows].mean()), 1),
                    'reads': 'under (our line on top)' if sc > 0.6 else ('over (BMW ink on top)' if sc < 0.25 else 'mixed')})
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
