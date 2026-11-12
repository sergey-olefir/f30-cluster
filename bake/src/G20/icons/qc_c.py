"""Package C QC: compare the harness screenshots (G20C alone over black, states 08 / 09 / 14) with the rects, per
element ROI, using bake/src/qc.py (SSIM on luma, dE2000) and writing review sheets to bake/work/g20sim/C/qc/.

Per element and photo:
  - geometry: ink box (half-max of the element's channel, p5..p99.5, on each image separately), ours - photo per edge;
  - look: qc.metrics() on the ROI box (bbox + 4 px), on two masks: `box` (all of it; the photo's background there is
    the dials/map, ours is black) and `ink` (union of both inks dilated by 3 px: the element itself).
  - psf: the same `ink` metrics after blurring OUR crop with a Gaussian whose sigma is fitted per photo (the camera's
    blur; the screenshot is crisp, the photos are not). This only separates shape errors from the photo's blur: what
    the bench draws is the crisp render.
Writes bake/work/g20sim/C/qc/qc.json and prints a table.

Run: UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
     python bake/src/G20/icons/qc_c.py
"""
import json
import os
import sys

import cv2
import numpy as np

WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
sys.path.insert(0, os.path.join(WT, 'bake', 'src'))
import qc  # noqa: E402

RECT = '/Users/solefir/projects/f30-cluster/bake/work/overlay/rect/'
C = os.path.join(WT, 'bake', 'work', 'g20sim', 'C')
OUT = os.path.join(C, 'qc')

EL = {e['id']: e for e in json.load(open(os.path.join(WT, 'design', 'overlay', 'g20_comfort.json')))['elements']}
EXTRA = {'assist.tacho_zero': [1513, 572, 1553, 615]}   # the tacho scale's '0' (engine on), drawn by C with OFF

# (element, photo, channel, group)
CASES = [
    ('tt.brake', '08', 'red', 'telltales'), ('tt.tpms', '08', 'amber', 'telltales'), ('tt.abs', '08', 'amber', 'telltales'),
    ('tt.dsc', '08', 'amber', 'telltales'), ('tt.auto_h', '08', 'green', 'telltales'), ('tt.auto_h', '09', 'green', 'telltales'),
    ('tt.auto_h', '14', 'green', 'telltales'), ('tt.parking_brake', '08', 'red', 'telltales'),
    ('tt.parking_brake', '09', 'green', 'telltales'), ('tt.parking_brake', '14', 'green', 'telltales'),
    ('tt.steering', '08', 'red', 'telltales'),
    ('bottom.range', '08', 'min', 'bottom row'), ('bottom.range', '09', 'min', 'bottom row'), ('bottom.range', '14', 'min', 'bottom row'),
    ('bottom.clock', '08', 'min', 'bottom row'), ('bottom.clock', '09', 'min', 'bottom row'), ('bottom.clock', '14', 'min', 'bottom row'),
    ('bottom.temperature', '08', 'min', 'bottom row'), ('bottom.temperature', '09', 'min', 'bottom row'),
    ('bottom.temperature', '14', 'min', 'bottom row'),
    ('bottom.street', '09', 'min', 'bottom row'), ('bottom.street', '14', 'min', 'bottom row'),
    ('bottom.belt_rear', '08', 'red', 'bottom row'), ('bottom.belt_driver', '08', 'red', 'bottom row'),
    ('bottom.belt_driver', '14', 'red', 'bottom row'), ('bottom.airbag', '08', 'red', 'bottom row'),
    ('assist.mode_label', '14', 'min', 'bottom row'), ('assist.gear', '14', 'min', 'bottom row'),
    ('assist.speed_limit', '08', 'max', 'assist/message'), ('assist.speed_limit', '09', 'max', 'assist/message'),
    ('assist.speed_limit', '14', 'max', 'assist/message'),
    ('assist.cc_panel', '08', 'min', 'assist/message'), ('bottom.cc_info', '08', 'min', 'assist/message'),
    ('assist.info_tacho', '08', 'min', 'assist/message'),
    ('assist.mode_label_centre', '08', 'min', 'assist/message'), ('assist.mode_label_centre', '09', 'min', 'assist/message'),
    ('assist.gear_centre', '08', 'min', 'assist/message'), ('assist.gear_centre', '09', 'min', 'assist/message'),
    ('assist.digital_speed', '08', 'min', 'assist/message'), ('assist.digital_speed', '09', 'min', 'assist/message'),
    ('assist.digital_speed', '14', 'min', 'assist/message'),
    ('assist.rpm_label', '08', 'min', 'assist/message'), ('assist.rpm_label', '09', 'min', 'assist/message'),
    ('assist.rpm_label', '14', 'min', 'assist/message'),
    ('assist.off', '08', 'min', 'assist/message'), ('assist.tacho_zero', '14', 'min', 'assist/message'),
    ('assist.cold', '14', 'min', 'assist/message'),
]


def chan(rgb, c):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return {'min': rgb.min(2), 'max': rgb.max(2), 'red': r - np.maximum(g, b), 'green': g - np.maximum(r, b),
            'amber': np.minimum(r, g) - b}[c]


def ink(v):
    lo, hi = np.percentile(v, 5), np.percentile(v, 99.5)
    if hi - lo < 20:
        return np.zeros_like(v, bool)
    return v > (lo + hi) / 2


def bb(m):
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)]


def main():
    os.makedirs(OUT, exist_ok=True)
    refs = {p: cv2.imread(RECT + p + '.png')[..., ::-1].astype(np.float32) / 255 for p in ('08', '09', '14')}
    ours = {p: cv2.imread(os.path.join(C, 'shot_%s.png' % p))[..., ::-1].astype(np.float32) / 255 for p in ('08', '09', '14')}
    # camera blur per photo: the sigma that maximises the mean ink SSIM of the white texts (crisp glyph edges)
    sig = {}
    for p in ('08', '09', '14'):
        best = None
        for sg in (0.0, 0.6, 0.9, 1.2, 1.5, 1.8, 2.2):
            vals = []
            for el, pp, ch, grp in CASES:
                if pp != p or ch != 'min':
                    continue
                x0, y0, x1, y1 = [int(round(v)) for v in (EXTRA.get(el) or EL[el]['bbox'])]
                R, O = refs[p][y0 - 4:y1 + 4, x0 - 4:x1 + 4], ours[p][y0 - 4:y1 + 4, x0 - 4:x1 + 4]
                if sg:
                    O = cv2.GaussianBlur(O, (0, 0), sg)
                m = cv2.dilate((ink(chan(R * 255, ch)) | ink(chan(O * 255, ch))).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
                vals.append(qc.metrics(R, O, m, want_edges=False)['ssim'])
            if best is None or np.mean(vals) > best[1]:
                best = (sg, np.mean(vals))
        sig[p] = best[0]
    print('camera blur sigma per photo:', sig)
    rows = []
    for el, p, ch, grp in CASES:
        box = EXTRA.get(el) or EL[el]['bbox']
        x0, y0, x1, y1 = [int(round(v)) for v in box]
        pad = 4
        X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(1920, x1 + pad), min(720, y1 + pad)
        R, O = refs[p][Y0:Y1, X0:X1], ours[p][Y0:Y1, X0:X1]
        mr, mo = ink(chan(R * 255, ch)), ink(chan(O * 255, ch))
        br, bo = bb(mr), bb(mo)
        geo = None if (br is None or bo is None) else [bo[i] - br[i] for i in range(4)]
        valid_box = np.ones(R.shape[:2], bool)
        valid_ink = cv2.dilate((mr | mo).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
        mb = qc.metrics(R, O, valid_box, want_edges=False)
        mi = qc.metrics(R, O, valid_ink, want_edges=True)
        Ob = cv2.GaussianBlur(O, (0, 0), sig[p]) if sig[p] else O
        mp = qc.metrics(R, Ob, valid_ink, want_edges=False)
        name = '%s__%s' % (el, p)
        qc.review_sheet(R, O, valid_ink, mi, os.path.join(OUT, 'qc_%s.png' % name), '%s vs rect %s (ink mask)' % (el, p), zoom=4)
        row = {'element': el, 'photo': p, 'group': grp, 'ink_ref': None if br is None else [br[0] + X0, br[1] + Y0, br[2] + X0, br[3] + Y0],
               'ink_ours': None if bo is None else [bo[0] + X0, bo[1] + Y0, bo[2] + X0, bo[3] + Y0], 'geo_d': geo,
               'geo_max': None if geo is None else max(abs(g) for g in geo),
               'ssim_box': mb['ssim'], 'dE_box': mb['dE2000_mean'], 'ssim_ink': mi['ssim'], 'dE_ink': mi['dE2000_mean'],
               'ssim_psf': mp['ssim'], 'dE_psf': mp['dE2000_mean'], 'sigma': sig[p],
               'edge_px': mi['edge_px_err'], 'luma_bias_ink': mi['luma_bias']}
        rows.append(row)
        print('%-26s %s %-14s geo %-18s max %-4s | box ssim %.3f dE %5.2f | ink ssim %.3f dE %5.2f | psf ssim %.3f dE %5.2f | edge %s bias %+.1f' % (
            el, p, grp, geo, row['geo_max'], mb['ssim'], mb['dE2000_mean'], mi['ssim'], mi['dE2000_mean'], mp['ssim'], mp['dE2000_mean'], mi['edge_px_err'], mi['luma_bias']))
    json.dump(rows, open(os.path.join(OUT, 'qc.json'), 'w'), indent=1)
    print('\nper group (mean): ssim_box  dE_box  ssim_ink  dE_ink  ssim_psf dE_psf  geo_max')
    for g in ('telltales', 'bottom row', 'assist/message'):
        rr = [r for r in rows if r['group'] == g]
        print('%-16s %.3f %6.2f %.3f %6.2f %.3f %6.2f  %.1f' % (g, np.mean([r['ssim_box'] for r in rr]), np.mean([r['dE_box'] for r in rr]),
              np.mean([r['ssim_ink'] for r in rr]), np.mean([r['dE_ink'] for r in rr]),
              np.mean([r['ssim_psf'] for r in rr]), np.mean([r['dE_psf'] for r in rr]),
              np.mean([r['geo_max'] for r in rr if r['geo_max'] is not None])))


if __name__ == '__main__':
    main()
