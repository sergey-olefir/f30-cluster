"""Package C helper: print an ASCII map of an icon on a rect ('#' > hi, '+' > lo) with panel x/y labels, for
reading geometry. python ascii.py PHOTO X0 Y0 X1 Y1 CHANNEL [LO HI] [YSTEP]; CHANNEL in r g b min max red green amber"""
import sys

import cv2
import numpy as np

p = sys.argv[1]
x0, y0, x1, y1 = map(int, sys.argv[2:6])
ch = sys.argv[6]
lo, hi = (float(sys.argv[7]), float(sys.argv[8])) if len(sys.argv) > 8 else (None, None)
ys = int(sys.argv[9]) if len(sys.argv) > 9 else 1
im = cv2.imread('/Users/solefir/projects/f30-cluster/bake/work/overlay/rect/%s.png' % p)[..., ::-1].astype(np.float32)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
v = {'r': r, 'g': g, 'b': b, 'min': im.min(2), 'max': im.max(2), 'red': r - np.maximum(g, b),
     'green': g - np.maximum(r, b), 'amber': np.minimum(r, g) - b}[ch][y0:y1, x0:x1]
if lo is None:
    a, z = np.percentile(v, 5), np.percentile(v, 99)
    lo, hi = a + 0.3 * (z - a), a + 0.6 * (z - a)
print('     ' + ''.join(str((x // 10) % 10) if x % 10 == 0 else ' ' for x in range(x0, x1)))
print('     ' + ''.join(str(x % 10) for x in range(x0, x1)))
for j in range(0, y1 - y0, ys):
    print('%4d ' % (y0 + j) + ''.join('#' if t > hi else ('+' if t > lo else '.') for t in v[j]))
