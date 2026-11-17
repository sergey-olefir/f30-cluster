"""Crop (and optionally scale) a region of an image for inspection: crop.py src x0 y0 x1 y1 out [scale] [fits.json ref]
With fits.json and the reference's name, the fitted bezel ellipses are drawn (1 px, green) over the crop."""
import json
import sys

import cv2

src, x0, y0, x1, y1, out = sys.argv[1], *map(int, sys.argv[2:6]), sys.argv[6]
sc = float(sys.argv[7]) if len(sys.argv) > 7 else 1.0
im = cv2.imread(src)
if len(sys.argv) > 9:
    d = json.load(open(sys.argv[8]))[sys.argv[9]]
    for k in ('tacho', 'speedo'):
        e = d[k]
        cv2.ellipse(im, ((e['cx'], e['cy']), (2 * e['a'], 2 * e['b']), e['angle_deg']), (0, 255, 0), 1, cv2.LINE_AA)
        cv2.drawMarker(im, (int(round(e['cx'])), int(round(e['cy']))), (0, 255, 0), cv2.MARKER_CROSS, 12, 1)
c = im[y0:y1, x0:x1]
if sc != 1.0:
    c = cv2.resize(c, None, fx=sc, fy=sc, interpolation=cv2.INTER_CUBIC if sc > 1 else cv2.INTER_AREA)
cv2.imwrite(out, c)
