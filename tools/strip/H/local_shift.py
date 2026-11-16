"""Package H: the local offset between two registered rects inside named static windows (is a difference real, or
registration?). Grey -> 8x bicubic -> Sobel magnitude -> phase correlation; prints dx, dy in panel px (b relative to
a: positive dx = b's content lies further right) and the correlation peak response.

Usage: ... python -I tools/strip/H/local_shift.py <a.png> <b.png> name=x0,y0,x1,y1 ...
"""
import sys
import cv2
import numpy as np

UP = 8


def prep(img, w):
    x0, y0, x1, y1 = w
    g = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY).astype(np.float32)
    g = cv2.resize(g, None, fx=UP, fy=UP, interpolation=cv2.INTER_CUBIC)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    m = cv2.magnitude(gx, gy)
    return m * cv2.createHanningWindow(m.shape[::-1], cv2.CV_32F)


if __name__ == "__main__":
    a = cv2.imread(sys.argv[1]); b = cv2.imread(sys.argv[2])
    for spec in sys.argv[3:]:
        name, box = spec.split("=")
        w = [int(v) for v in box.split(",")]
        (dx, dy), r = cv2.phaseCorrelate(prep(a, w), prep(b, w))
        print("%-12s dx %+6.2f dy %+6.2f  peak %.3f" % (name, dx / UP, dy / UP, r))
