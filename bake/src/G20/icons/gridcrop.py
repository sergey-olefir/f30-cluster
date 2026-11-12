"""Package C helper: a zoomed crop of a rect photo with a panel-px grid (every 5 px, labelled every 10) for reading
icon geometry by eye. Scratch output only (bake/work/g20sim/C/grid_<name>.png).

python gridcrop.py NAME PHOTO X0 Y0 X1 Y1 [ZOOM]
"""
import os
import sys

import cv2
import numpy as np

RECT = os.path.join(os.environ.get('F30_MAIN', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))), 'bake', 'work', 'overlay', 'rect') + '/'
OUT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'work', 'g20sim', 'C'))

name, p = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = map(int, sys.argv[3:7])
z = int(sys.argv[7]) if len(sys.argv) > 7 else 8
im = cv2.imread(RECT + p + '.png')[y0:y1, x0:x1]
im = cv2.resize(im, None, fx=z, fy=z, interpolation=cv2.INTER_NEAREST)
L = 40
out = np.zeros((im.shape[0] + L, im.shape[1] + L, 3), np.uint8)
out[L:, L:] = im
for x in range(x0 - x0 % 5 + 5, x1, 5):
    X = L + (x - x0) * z
    c = (0, 200, 255) if x % 10 == 0 else (0, 90, 120)
    cv2.line(out, (X, L), (X, out.shape[0]), c, 1)
    if x % 10 == 0:
        cv2.putText(out, str(x), (X - 14, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
for y in range(y0 - y0 % 5 + 5, y1, 5):
    Y = L + (y - y0) * z
    c = (0, 200, 255) if y % 10 == 0 else (0, 90, 120)
    cv2.line(out, (L, Y), (out.shape[1], Y), c, 1)
    if y % 10 == 0:
        cv2.putText(out, str(y), (2, Y + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
cv2.imwrite(os.path.join(OUT, 'grid_%s.png' % name), out)
