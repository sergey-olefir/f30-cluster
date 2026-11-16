"""Package R: cross-check. The same fixed strip landmark, located in every photo's published 4 x strip by NCC against
photo 61's (the common reference), must land within the stated error. Prints and writes the offsets (panel px) to
bake/work/strip/pub/R/crosscheck.json. The landmarks were inside the fit's control windows, so this checks the
published rasters (model + field + resampling) end to end, not the fit's independence; the field's leave-one-out in
H.json is the independent estimate.
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

N, Y0 = 4, 540
LANDMARKS = {
    'speedo_rail_hook_right': (728, 598, 772, 654),
    'tacho_rail_hook_left': (1190, 598, 1250, 654),
    'fuel_mini_zero': (160, 592, 200, 630),
    'speedo_ticks_20': (255, 545, 330, 600),
    'tacho_label_1min_x1000': (1450, 590, 1550, 645),
    'temp_mini_scale_end': (1840, 560, 1900, 650),
}


def strip(pid):
    s = cv2.imread(os.path.join(C.OUT, '%s_strip_4x.png' % pid), cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
    y = 0.2126 * s[..., 2] + 0.7152 * s[..., 1] + 0.0722 * s[..., 0]
    return np.power(np.clip(y, 0, 1), 1 / 2.2)   # perceptual-ish, so dim structure counts


def locate(img, ref, box, search=4):
    x0, y0, x1, y1 = box
    sl = np.s_[int((y0 - Y0) * N):int((y1 - Y0) * N), int(x0 * N):int(x1 * N)]
    tpl = ref[sl]
    a, b = int((y0 - Y0 - search) * N), int((y1 - Y0 + search) * N)
    sr = img[max(a, 0):b, int((x0 - search) * N):int((x1 + search) * N)]
    if a < 0:
        sr = np.pad(sr, ((-a, 0), (0, 0)))
    res = cv2.matchTemplate(sr, tpl, cv2.TM_CCOEFF_NORMED)
    _, mx, _, loc = cv2.minMaxLoc(res)
    sx, sy = C.RF.subpix(res, loc[0], loc[1])
    return sx / N - search, sy / N - search, mx


def run(pids):
    ref = strip('61')
    out = {}
    for pid in pids:
        img = strip(pid)
        out[pid] = {}
        for name, box in LANDMARKS.items():
            dx, dy, sc = locate(img, ref, box)
            out[pid][name] = {'dx': round(dx, 3), 'dy': round(dy, 3), 'ncc': round(sc, 3)}
        d = np.array([[v['dx'], v['dy']] for v in out[pid].values() if v['ncc'] > 0.8])
        out[pid]['_rms_ncc_gt_0.8'] = round(float(np.sqrt((d ** 2).sum(1).mean())), 3) if len(d) else None
        print(pid, ' '.join('%s %+.2f,%+.2f(%.2f)' % (k[:12], v['dx'], v['dy'], v['ncc'])
                            for k, v in out[pid].items() if not k.startswith('_')), out[pid]['_rms_ncc_gt_0.8'])
    C.jdump(out, os.path.join(C.PUB, 'crosscheck.json'))


if __name__ == '__main__':
    run(sys.argv[1:] or ['60', '62', '63', '64', '65', '66', '67', '68'])
