"""Print a row (axis=1) or column (axis=0) mean-luminance profile of a box: profile.py img x0 y0 x1 y1 axis"""
import sys

import cv2
import numpy as np

im = cv2.imread(sys.argv[1]).astype(np.float32) / 255
x0, y0, x1, y1, ax = map(int, sys.argv[2:7])
f = np.where(im <= 0.04045, im / 12.92, ((im + 0.055) / 1.055) ** 2.4)
Y = 0.2126 * f[..., 2] + 0.7152 * f[..., 1] + 0.0722 * f[..., 0]
p = Y[y0:y1, x0:x1].mean(ax)
o = y0 if ax == 1 else x0
print(' '.join('%d:%.3f' % (o + i, v) for i, v in enumerate(p)))
