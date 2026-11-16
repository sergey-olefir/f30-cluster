"""Package ZC: unattributed light in zone C (x 690-1250, y 540-720) of every stock photo.

Every catalogued element of the photo's state is masked (its box dilated by 2 px for blur); what is still lit is
listed as connected blobs at 1x. "Lit" = above the local background (a 31 px median of the photo at 1x, which
follows the glare of 64-67) by more than `THR` in linear luminance, or above the photo's black by `THR_ABS`.
Run from the repo root (see atlas.py for the uv line, plus --with scipy).
"""
import json
import os
import sys

import cv2
import numpy as np
from scipy.ndimage import median_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zc_common as Z  # noqa: E402

THR = 0.006        # linear Y above the local background (stock white text is ~0.92 in these photos)
THR_ABS = 0.010    # linear Y above the photo's black, for wide soft light the median follows
RX0, RY0, RX1, RY1 = 690, 560, 1250, 720

# boxes are continuous panel px; the state lists say in which photos each element is present
EL = {
    'rail.left (speedo bottom line, end)':   ([600, 639, 699, 654], 'all'),
    'rail.right (tacho bottom line, start)': ([1218, 639, 1340, 654], 'all'),
    'rail.centre.hook_l':                    ([695, 608, 760, 654], 'nomsg'),
    'rail.centre.hook_r':                    ([1159, 608, 1228, 654], 'nomsg'),
    'assist.cc_panel (arc)':                 ([697, 598, 1225, 624], 'msg'),
    'assist.cc_panel (fill)':                ([700, 605, 1222, 705], 'msg'),
    'bottom.cc_info (symbol)':               ([716, 628, 762, 688], 'msg'),
    'cc.text':                               ([812, 615, 1125, 695], 'msg'),
    'bottom.street':                         ([788, 662, 1132, 712], 'road'),
    'bottom.odometer':                       ([800, 660, 1088, 702], 'odo'),
    'assist.info_tacho (marker, ZR)':        ([1236, 584, 1292, 634], 'marker'),
    'assist.mode_label (ZR)':                ([1222, 655, 1370, 716], 'modelabel'),
    'map.region / centre content (above)':   ([555, 540, 1395, 600], 'all'),
    'structure.speedo foot (dial glow)':     ([600, 540, 700, 640], 'all'),
    'structure.tacho foot (dial glow)':      ([1216, 540, 1340, 640], 'all'),
}
STATE = {
    '61': {'nomsg', 'road'}, '62': {'msg', 'marker'}, '63': {'nomsg', 'odo', 'marker'},
    '64': {'nomsg', 'road'}, '65': {'nomsg', 'odo', 'modelabel'}, '66': {'msg', 'marker'},
    '67': {'nomsg', 'road', 'marker'}, '68': {'nomsg', 'road'},
}


def main():
    out = {}
    for pid, st in STATE.items():
        rgb, tag = Z.load(pid)
        Y = Z.lum(rgb)
        Y1 = cv2.resize(Y, (Y.shape[1] // Z.N, Y.shape[0] // Z.N), interpolation=cv2.INTER_AREA)  # 1x, x0 600, y0 540
        bk = float(np.median(Y1[60:96, 50:90]))     # y 600-636, x 650-690
        bg = median_filter(Y1, size=31, mode='nearest')
        lit = ((Y1 - bg) > THR) | ((Y1 - bk) > THR_ABS)
        known = np.zeros_like(lit)
        used = []
        for name, (b, when) in EL.items():
            if when == 'all' or when in st:
                x0, y0, x1, y1 = b
                known[max(0, int(y0 - 2 - 540)):int(y1 + 2 - 540), max(0, int(x0 - 2 - 600)):int(x1 + 2 - 600)] = True
                used.append(name)
        roi = np.zeros_like(lit)
        roi[RY0 - 540:RY1 - 540, RX0 - 600:RX1 - 600] = True
        rest = (lit & ~known & roi).astype(np.uint8)
        n, lab, sts, _ = cv2.connectedComponentsWithStats(rest, 8)
        blobs = []
        for i in range(1, n):
            x, y, w, h, a = sts[i]
            m = lab == i
            blobs.append({'box': [int(600 + x), int(540 + y), int(600 + x + w), int(540 + y + h)], 'area_px': int(a),
                          'peak_above_black': round(float((Y1[m] - bk).max()), 4),
                          'mean_above_bg': round(float((Y1[m] - bg[m]).mean()), 4)})
        blobs.sort(key=lambda b: -b['area_px'] * b['peak_above_black'])
        # how much of the zone is lit at all and explained
        lit_roi = lit & roi
        out[pid] = {'source': tag, 'black_Y': round(bk, 5), 'lit_px': int(lit_roi.sum()),
                    'lit_explained_px': int((lit_roi & known).sum()), 'unexplained_px': int(rest.sum()),
                    'blobs': blobs[:40], 'elements_masked': used}
        print(pid, tag, 'black %.4f lit %d explained %d unexplained %d in %d blobs' % (
            bk, lit_roi.sum(), (lit_roi & known).sum(), rest.sum(), n - 1))
        for b in blobs[:12]:
            print('    ', b)
    json.dump(out, open(os.path.join(Z.WORK, 'zone-c', 'unattributed.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
