"""crop.py RECT OUT x0 y0 x1 y1 zoom [grid] : zoomed crop of a rect photo with an optional 10 px grid (scratch only)."""
import sys, cv2, numpy as np
src, out, x0, y0, x1, y1, z = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:8])
g = len(sys.argv) > 8
im = cv2.imread(src)[y0:y1, x0:x1]
im = cv2.resize(im, None, fx=z, fy=z, interpolation=cv2.INTER_NEAREST)
if g:
    for x in range((x0 // 10 + 1) * 10, x1, 10):
        c = (0, 255, 255) if x % 50 == 0 else (60, 60, 60)
        cv2.line(im, ((x - x0) * z, 0), ((x - x0) * z, im.shape[0]), c, 1)
        if x % 50 == 0: cv2.putText(im, str(x), ((x - x0) * z + 2, 12), 0, 0.4, (0, 255, 255), 1)
    for y in range((y0 // 10 + 1) * 10, y1, 10):
        c = (0, 255, 255) if y % 50 == 0 else (60, 60, 60)
        cv2.line(im, (0, (y - y0) * z), (im.shape[1], (y - y0) * z), c, 1)
        if y % 50 == 0: cv2.putText(im, str(y), (2, (y - y0) * z - 2), 0, 0.4, (0, 255, 255), 1)
cv2.imwrite(out, im)
