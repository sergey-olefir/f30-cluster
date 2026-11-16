"""Package H: is there a fill under BMW's check-control message? (G20-DESIGN-SPEC section 5.1 claims none.)

Per rect: the 25th / 50th percentile of max(R, G, B) in boxes that hold no ink, inside the panel (between the rail and
the text, and between the text and the panel's foot) and outside it (left of the left tip, right of the right
tip, under the panel), so a fill shows as inside > outside beyond the photo's own vignetting, which is read off the
same boxes in a photo with no message. Numbers only.

Usage: ... python -I tools/strip/H/fill_check.py <label>=<rect.png> ...
"""
import sys
import cv2
import numpy as np

BOX = {
    "in_above_text": [800, 612, 1120, 626],
    "in_left_of_text": [770, 640, 800, 690],
    "in_right_of_text": [1130, 630, 1170, 690],
    "out_left": [690, 630, 715, 645],
    "out_right": [1205, 630, 1235, 645],
    "out_below": [800, 708, 1120, 718],
    "out_above": [800, 585, 1120, 596],
}

if __name__ == "__main__":
    for a in sys.argv[1:]:
        lab, p = a.split("=", 1)
        im = cv2.imread(p).astype(np.float32).max(axis=2)
        out = {}
        for k, (x0, y0, x1, y1) in BOX.items():
            v = im[y0:y1, x0:x1]
            out[k] = (round(float(np.percentile(v, 25)), 1), round(float(np.median(v)), 1))
        print(lab, out)
